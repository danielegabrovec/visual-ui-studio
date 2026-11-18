import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  safeStorage,
  shell,
  utilityProcess,
  type UtilityProcess,
} from 'electron';

import {
  pickPreferredLocalModel,
  type AgentStreamEvent,
  type CompileSheetRequest,
  type EnsureOllamaResult,
  type ExportBundleToDiskInput,
  type ExportBundleToDiskResult,
  type ExportUnslothDatasetRequest,
  type GenerateProjectWithAiRequest,
  type ProjectBootstrapPayload,
  type RunAgentTurnRequest,
  type RunAgentTurnResult,
  type StartupAssistantChatRequest,
} from '../shared/ipc-contract';
import {
  type DetectedDiskProjectInfo,
  type DiskProjectInitSpec,
  type ToolchainDoctorReport,
  type ToolchainStreamEvent,
  type ToolchainTaskRequest,
} from '../shared/project-stacks';
import type { GenerateSqlCodeRequest } from '../shared/sql-ir';
import { resolveInteractiveExportDir, writeBundleFilesToDir } from './bundle-exporter';
import {
  ToolchainRunnerService,
  createAndInitDiskProjectWithRunner,
  inspectDiskDirectory,
  openExistingDiskProjectWithRunner,
} from './toolchain-runner';
import {
  createWorkerRpcProxy,
  type IAiWorkerService,
  type ICodegenWorkerService,
  type IDbWorkerService,
} from '../shared/worker-protocol';

if (process.platform === 'win32') {
  app.setAppUserModelId('com.gabrovec.visualuistudio');
}

// Register custom zero-copy asset scheme before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'studio-asset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

let dbChild: UtilityProcess | null = null;
let codegenChild: UtilityProcess | null = null;
let aiChild: UtilityProcess | null = null;

let dbWorker!: IDbWorkerService;
let codegenWorker!: ICodegenWorkerService;
let aiWorker!: IAiWorkerService;

function getStudioDataDir(): string {
  if (process.env.STUDIO_DATA_DIR) {
    mkdirSync(process.env.STUDIO_DATA_DIR, { recursive: true });
    return process.env.STUDIO_DATA_DIR;
  }
  const dir = join(app.getPath('userData'), 'studio-data');
  if (app.isPackaged && !existsSync(join(dir, 'studio-global.sqlite'))) {
    const previous = join(app.getPath('appData'), 'frontend-next', 'studio-data');
    if (existsSync(join(previous, 'studio-global.sqlite'))) return previous;
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

function broadcastAgentStreamEvent(event: AgentStreamEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('studio:ai:stream-event', event);
    }
  }
}

function broadcastToolchainStreamEvent(event: ToolchainStreamEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('studio:toolchain:stream', event);
    }
  }
}

function broadcastDiskVfsChanged(payload: { projectId: string; paths: string[] }): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('studio:vfs:changed', payload);
    }
  }
}

const toolchainRunner = new ToolchainRunnerService({
  onStreamEvent: (ev) => broadcastToolchainStreamEvent(ev),
  onDiskVfsChanged: (ev) => broadcastDiskVfsChanged(ev),
});

function spawnUtilityWorkers(): void {
  const dataDir = getStudioDataDir();
  const workerEnv = {
    ...process.env,
    STUDIO_DATA_DIR: dataDir,
  };

  const spawnDb = () => {
    const script = join(__dirname, 'workers/db-worker.js');
    dbChild = utilityProcess.fork(script, [], {
      serviceName: 'visual-ui-studio-db',
      env: workerEnv,
    });
    dbWorker = createWorkerRpcProxy<IDbWorkerService>(dbChild);
    dbChild.on('exit', (code) => {
      if (!isQuitting && code !== 0) {
        setTimeout(spawnDb, 250);
      }
    });
  };

  const spawnCodegen = () => {
    const script = join(__dirname, 'workers/codegen-worker.js');
    codegenChild = utilityProcess.fork(script, [], {
      serviceName: 'visual-ui-studio-codegen',
      env: workerEnv,
    });
    codegenWorker = createWorkerRpcProxy<ICodegenWorkerService>(codegenChild);
    codegenChild.on('exit', (code) => {
      if (!isQuitting && code !== 0) {
        setTimeout(spawnCodegen, 250);
      }
    });
  };

  const spawnAi = () => {
    const script = join(__dirname, 'workers/ai-worker.js');
    aiChild = utilityProcess.fork(script, [], {
      serviceName: 'visual-ui-studio-ai',
      env: workerEnv,
    });
    aiWorker = createWorkerRpcProxy<IAiWorkerService>(aiChild, (channel, payload) => {
      if (channel === 'ai-stream' && payload) {
        broadcastAgentStreamEvent(payload as AgentStreamEvent);
      }
    });
    aiChild.on('exit', (code) => {
      if (!isQuitting && code !== 0) {
        setTimeout(spawnAi, 250);
      }
    });
  };

  spawnDb();
  spawnCodegen();
  spawnAi();
}

function handleStudioIpc(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Origine del comando Studio non autorizzata.');
    }
    return listener(event, ...args);
  });
}

function registerIpcHandlers(): void {
  // 1. Project Lifecycle
  handleStudioIpc('studio:project:listRecent', () => dbWorker.listRecentProjects());
  handleStudioIpc('studio:project:removeRecent', (_e, projectId: string) =>
    dbWorker.removeRecentProject(projectId),
  );
  handleStudioIpc('studio:project:create', (_e, input) => dbWorker.createProject(input));
  handleStudioIpc('studio:project:createFromWizard', (_e, spec) => dbWorker.createProjectFromWizard(spec));
  handleStudioIpc('studio:project:createAndInitDiskProject', async (_e, spec: DiskProjectInitSpec) => {
    const defaultParentDir = join(getStudioDataDir(), 'disk-projects');
    return createAndInitDiskProjectWithRunner(spec, {
      dbWorker,
      runner: toolchainRunner,
      defaultProjectsParentDir: defaultParentDir,
    });
  });
  handleStudioIpc('studio:project:pickDirectory', async (_e, title?: string) => {
    const dialogOpts: Electron.OpenDialogOptions = {
      title: title || 'Seleziona Cartella su Disco',
      properties: ['openDirectory', 'createDirectory'],
    };
    const res = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts);
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });
  handleStudioIpc('studio:project:inspectDirectory', async (_e, dirPath: string): Promise<DetectedDiskProjectInfo> => {
    return inspectDiskDirectory(dirPath);
  });
  handleStudioIpc('studio:project:openExistingDiskProject', async (_e, explicitDirPath?: string) => {
    let chosenDir = explicitDirPath?.trim();
    if (!chosenDir) {
      const dialogOpts: Electron.OpenDialogOptions = {
        title: 'Apri Cartella Progetto da Disco',
        properties: ['openDirectory', 'createDirectory'],
      };
      const res = mainWindow
        ? await dialog.showOpenDialog(mainWindow, dialogOpts)
        : await dialog.showOpenDialog(dialogOpts);
      if (res.canceled || res.filePaths.length === 0) return null;
      chosenDir = res.filePaths[0];
    }
    return openExistingDiskProjectWithRunner(chosenDir, {
      dbWorker,
      runner: toolchainRunner,
    });
  });
  handleStudioIpc('studio:project:open', async (_e, idOrPath: string) => {
    const opened = await dbWorker.openProject(idOrPath);
    toolchainRunner.unwatchDirectory();
    if (opened.project.rootDiskPath && existsSync(opened.project.rootDiskPath)) {
      toolchainRunner.watchProjectDirectory(opened.project.id, opened.project.rootDiskPath, dbWorker);
    }
    return opened;
  });
  handleStudioIpc('studio:project:openDirectory', async () => {
    const dialogOpts: Electron.OpenDialogOptions = {
      title: 'Apri Cartella Progetto da Disco',
      properties: ['openDirectory', 'createDirectory'],
    };
    const res = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts);
    if (res.canceled || res.filePaths.length === 0) {
      return null;
    }
    return openExistingDiskProjectWithRunner(res.filePaths[0], {
      dbWorker,
      runner: toolchainRunner,
    });
  });
  handleStudioIpc('studio:project:getCurrent', () => dbWorker.getCurrentProject());
  handleStudioIpc('studio:project:updateSettings', (_e, projectId: string, patch) =>
    dbWorker.updateProjectSettings(projectId, patch),
  );
  handleStudioIpc('studio:project:linkDiskDirectory', async (_e, projectId: string, dirPath?: string) => {
    let targetDir = dirPath;
    if (!targetDir && mainWindow) {
      const res = await dialog.showOpenDialog(mainWindow, {
        title: 'Link Project Repository Folder',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (res.canceled || res.filePaths.length === 0) {
        const cur = await dbWorker.getCurrentProject();
        return { rootDiskPath: cur.project.rootDiskPath ?? '', syncedCount: 0 };
      }
      targetDir = res.filePaths[0];
    }
    if (!targetDir) {
      throw new Error('No disk directory specified.');
    }
    const linked = await dbWorker.linkDiskDirectory(projectId, targetDir);
    toolchainRunner.watchProjectDirectory(projectId, linked.rootDiskPath, dbWorker);
    return linked;
  });

  handleStudioIpc(
    'studio:project:exportBundleToDisk',
    async (_e, input: ExportBundleToDiskInput): Promise<ExportBundleToDiskResult> => {
      let destinationDir = input.targetDir?.trim() || '';
      if (!destinationDir) {
        const dialogOpts: Electron.OpenDialogOptions = {
          title: 'Esporta Progetto su Disco',
          properties: ['openDirectory', 'createDirectory'],
        };
        const res = mainWindow
          ? await dialog.showOpenDialog(mainWindow, dialogOpts)
          : await dialog.showOpenDialog(dialogOpts);
        if (res.canceled || res.filePaths.length === 0) {
          return { exportedDir: null, fileCount: 0 };
        }
        destinationDir = resolveInteractiveExportDir(
          res.filePaths[0],
          input.defaultFolderName || 'studio-scaffold-export',
        );
      }
      return writeBundleFilesToDir(destinationDir, input.files ?? []);
    },
  );

  // 2. Workspace Shell State
  handleStudioIpc('studio:workspace:loadState', (_e, projectId: string) =>
    dbWorker.loadWorkspaceState(projectId),
  );
  handleStudioIpc('studio:workspace:saveState', (_e, projectId: string, patch) =>
    dbWorker.saveWorkspaceState(projectId, patch),
  );

  // 3. Virtual & Disk-Mapped File System
  handleStudioIpc('studio:vfs:listTree', (_e, projectId: string) => dbWorker.listVfsTree(projectId));
  handleStudioIpc('studio:vfs:createEntry', (_e, input) => dbWorker.createVfsEntry(input));
  handleStudioIpc('studio:vfs:renameEntry', (_e, entryId: string, newName: string) =>
    dbWorker.renameVfsEntry(entryId, newName),
  );
  handleStudioIpc('studio:vfs:moveEntry', (_e, entryId: string, newParentId: string | null) =>
    dbWorker.moveVfsEntry(entryId, newParentId),
  );
  handleStudioIpc('studio:vfs:deleteEntry', (_e, entryId: string, deleteOnDisk?: boolean) =>
    dbWorker.deleteVfsEntry(entryId, deleteOnDisk),
  );
  handleStudioIpc('studio:vfs:readFile', (_e, entryId: string) => dbWorker.readVfsFile(entryId));
  handleStudioIpc('studio:vfs:writeFile', (_e, entryId: string, content: string, expectedContent?: string) =>
    dbWorker.writeVfsFile(entryId, content, expectedContent),
  );

  // 4. Canvas Sheets, Undo/Redo & Checkpoints
  handleStudioIpc('studio:canvas:listSheets', (_e, projectId: string) => dbWorker.listSheets(projectId));
  handleStudioIpc('studio:canvas:loadSheet', (_e, sheetId: string) => dbWorker.loadSheet(sheetId));
  handleStudioIpc('studio:canvas:saveSheetViewport', (_e, sheetId: string, x: number, y: number, zoom: number) =>
    dbWorker.saveSheetViewport(sheetId, x, y, zoom),
  );
  handleStudioIpc('studio:canvas:commitPatchBatch', (_e, batch) => dbWorker.commitPatchBatch(batch));
  handleStudioIpc('studio:canvas:undo', (_e, sheetId: string) => dbWorker.undo(sheetId));
  handleStudioIpc('studio:canvas:redo', (_e, sheetId: string) => dbWorker.redo(sheetId));
  handleStudioIpc('studio:canvas:listCheckpoints', (_e, sheetId: string) =>
    dbWorker.listCheckpoints(sheetId),
  );
  handleStudioIpc('studio:canvas:createCheckpoint', (_e, input) => dbWorker.createCheckpoint(input));
  handleStudioIpc('studio:canvas:restoreCheckpoint', (_e, checkpointId: string) =>
    dbWorker.restoreCheckpoint(checkpointId),
  );

  // 5. Design Tokens, Themes & Offline FTS5 Icons
  handleStudioIpc('studio:tokens:listTokens', (_e, projectId: string) => dbWorker.listTokens(projectId));
  handleStudioIpc('studio:tokens:upsertToken', (_e, entry) => dbWorker.upsertToken(entry));
  handleStudioIpc('studio:tokens:deleteToken', (_e, tokenId: string) => dbWorker.deleteToken(tokenId));
  handleStudioIpc('studio:tokens:listThemes', (_e, projectId: string) => dbWorker.listThemes(projectId));
  handleStudioIpc('studio:tokens:searchIcons', (_e, query: string, category?: string) =>
    dbWorker.searchIcons(query, category),
  );

  // 6. Multi-Target Codegen & Spatial Layout Solver
  handleStudioIpc('studio:codegen:listTargets', () => codegenWorker.listTargets());
  handleStudioIpc('studio:codegen:compileSheet', async (_e, req: CompileSheetRequest) => {
    const [sheet, tokens, themes] = await Promise.all([
      dbWorker.loadSheet(req.sheetId),
      dbWorker.listTokens(req.projectId),
      dbWorker.listThemes(req.projectId),
    ]);
    return codegenWorker.compileSheet({
      sheet,
      tokens,
      themes,
      options: req,
    });
  });
  handleStudioIpc('studio:codegen:solveFreeformLayout', async (_e, sheetId: string, rootNodeId: string) => {
    const sheet = await dbWorker.loadSheet(sheetId);
    return codegenWorker.solveFreeformLayout({ sheet, rootNodeId });
  });
  handleStudioIpc('studio:codegen:saveBundleToDisk', (_e, projectId: string, bundle) =>
    dbWorker.writeGeneratedBundleToDisk(projectId, bundle),
  );

  // 7. Local AI Gateway, Agentic Loop & Unsloth Flywheel
  handleStudioIpc('studio:ai:ensureOllamaRunning', () => ensureOllamaRunning());
  handleStudioIpc('studio:ai:getHardwareReport', () => aiWorker.getHardwareReport());
  handleStudioIpc('studio:ai:listProvidersAndModels', () => aiWorker.listProvidersAndModels());
  handleStudioIpc('studio:ai:configureProvider', async (_e, config) => {
    await dbWorker.saveAiProviderConfig(config.id, config.baseUrl, config.apiKey);
    return aiWorker.configureProvider(config);
  });
  handleStudioIpc('studio:ai:getUnslothCatalog', () => aiWorker.getUnslothCatalog());
  handleStudioIpc('studio:ai:pullOllamaModel', (_e, modelRef: string) => aiWorker.pullOllamaModel(modelRef));
  handleStudioIpc('studio:ai:askStartupAssistant', (_e, req: StartupAssistantChatRequest) =>
    aiWorker.askStartupAssistant(req),
  );
  handleStudioIpc(
    'studio:ai:generateProjectWithAi',
    async (_e, req: GenerateProjectWithAiRequest): Promise<ProjectBootstrapPayload> => {
      const seedOut = await aiWorker.generateProjectSeedWithAi(req);
      const bootstrap = await dbWorker.createProjectFromSeed(seedOut.seed, {
        layoutMode: req.layoutMode ?? 'freeform',
        paletteId: seedOut.paletteId,
        defaultThemeMode: seedOut.defaultThemeMode,
        rootDiskPath: req.rootDiskPath ?? null,
        activeAiProviderId: seedOut.provider,
        activeAiModelId: seedOut.modelName,
        initialPrompt: req.prompt,
        initialAssistantSummary: seedOut.assistantSummary,
      });
      broadcastAgentStreamEvent({ type: 'run_completed', runId: seedOut.runId });
      return bootstrap;
    },
  );
  handleStudioIpc('studio:ai:listThreads', (_e, projectId: string) => dbWorker.listAiThreads(projectId));
  handleStudioIpc('studio:ai:getThreadMessages', (_e, threadId: string) =>
    dbWorker.getAiThreadMessages(threadId),
  );
  handleStudioIpc('studio:ai:cancelAgentRun', (_e, runId: string) => aiWorker.cancelAgentRun(runId));

  handleStudioIpc('studio:ai:runAgentTurn', async (_e, req: RunAgentTurnRequest): Promise<RunAgentTurnResult> => {
    // 1. Mandatory pre-AI atomic SQLite checkpoint
    const checkpoint = await dbWorker.createCheckpoint({
      projectId: req.projectId,
      sheetId: req.sheetId,
      reason: 'pre_ai_step',
      label: `Pre-AI: ${req.prompt.slice(0, 56)}`,
    });

    const [sheet, tokens, themes] = await Promise.all([
      dbWorker.loadSheet(req.sheetId),
      dbWorker.listTokens(req.projectId),
      dbWorker.listThemes(req.projectId),
    ]);

    // 2. Execute crash-isolated AI turn
    const aiOut = await aiWorker.executeAgentTurn({
      request: req,
      sheet,
      tokens,
      themes,
      preCheckpointId: checkpoint.id,
    });

    // 3. Persist emitted UIPatchOps through single-writer db-worker
    let finalSheet = aiOut.updatedSheet;
    if (aiOut.appliedOps.length > 0) {
      const committed = await dbWorker.commitPatchBatch({
        projectId: req.projectId,
        sheetId: req.sheetId,
        actor: 'ai_agent',
        aiRunId: aiOut.runId,
        label: `AI (${req.mode}): ${req.prompt.slice(0, 48)}`,
        ops: aiOut.appliedOps,
      });
      finalSheet = committed.sheet;
      broadcastAgentStreamEvent({
        type: 'canvas_patched',
        runId: aiOut.runId,
        opsCount: aiOut.appliedOps.length,
      });
    }

    // 4. Generate target code & log Unsloth dataset supervision pair
    const targetId = req.activeTarget ?? 'react-tsx';
    let generatedCode;
    try {
      generatedCode = await codegenWorker.compileSheet({
        sheet: finalSheet,
        tokens,
        themes,
        options: {
          targetId,
          dialect: req.activeDialect ?? 'tailwind',
          mode: 'component',
        },
      });
      const entryCode = generatedCode.files[0]?.code ?? '';
      if (entryCode) {
        await dbWorker.recordUnslothPair({
          projectId: req.projectId,
          sheetId: req.sheetId,
          promptSummary: req.prompt,
          normalizedUiIrJson: JSON.stringify({
            sheetName: finalSheet.name,
            rootIds: finalSheet.rootIds,
            nodes: finalSheet.nodes,
          }),
          tokensSnapshotJson: JSON.stringify(tokens.slice(0, 20)),
          targetFramework: targetId,
          acceptedCodeOutput: entryCode,
          qualityScore: 5,
        });
      }
    } catch {
      // Non-fatal if codegen is skipped
    }

    // 5. Persist chat messages & tool execution trace
    const savedChat = await dbWorker.recordAiTurnMessages({
      projectId: req.projectId,
      threadId: req.threadId,
      titleHint: req.prompt.slice(0, 64),
      mode: req.mode,
      provider: req.provider,
      modelName: req.modelName,
      userPrompt: req.prompt,
      assistantReply: aiOut.assistantReply,
      thinkingText: aiOut.thinkingText,
      preCheckpointId: checkpoint.id,
      toolCalls: aiOut.toolCalls,
      tokensIn: aiOut.tokensIn,
      tokensOut: aiOut.tokensOut,
      latencyMs: aiOut.latencyMs,
    });

    broadcastAgentStreamEvent({ type: 'run_completed', runId: aiOut.runId });

    return {
      runId: aiOut.runId,
      threadId: savedChat.threadId,
      preCheckpointId: checkpoint.id,
      userMessage: savedChat.userMessage,
      assistantMessage: savedChat.assistantMessage,
      appliedOps: aiOut.appliedOps,
      updatedSheet: finalSheet,
      generatedCode,
      usedFallbackOffline: aiOut.usedFallbackOffline,
    };
  });

  handleStudioIpc('studio:ai:recordUnslothPair', (_e, input) => dbWorker.recordUnslothPair(input));
  handleStudioIpc('studio:ai:listUnslothPairs', (_e, projectId: string) =>
    dbWorker.listUnslothPairs(projectId),
  );
  handleStudioIpc('studio:ai:exportUnslothDataset', async (_e, req: ExportUnslothDatasetRequest) => {
    const pairs = await dbWorker.listUnslothPairs(req.projectId);
    const resolvedOutputDir =
      req.outputDir ?? join(getStudioDataDir(), 'exports', `unsloth-${req.projectId}`);
    mkdirSync(resolvedOutputDir, { recursive: true });
    return aiWorker.exportUnslothBundleFiles({
      pairs,
      request: req,
      resolvedOutputDir,
    });
  });

  // 8. Toolchain Doctor & Live Process Runner (v3.0)
  handleStudioIpc('studio:toolchain:checkDoctor', (): Promise<ToolchainDoctorReport> =>
    toolchainRunner.checkDoctor(),
  );
  handleStudioIpc('studio:toolchain:runTask', async (_e, req: ToolchainTaskRequest) => {
    const { project } = await dbWorker.getCurrentProject();
    if (project.id !== req.projectId || !project.rootDiskPath) {
      throw new Error('Apri o crea un progetto su disco per eseguire i comandi della toolchain.');
    }
    return toolchainRunner.runTask({ ...req, rootDiskPath: project.rootDiskPath });
  });
  handleStudioIpc('studio:toolchain:stopTask', (_e, taskId: string) =>
    toolchainRunner.stopTask(taskId),
  );
  handleStudioIpc('studio:toolchain:listActiveTasks', (_e, projectId?: string) =>
    toolchainRunner.listActiveTasks(projectId),
  );

  // 9. Multi-Dialect SQL & Data Studio IPC Bridge
  const encryptSqlSecret = (secret?: string): string | null | undefined => {
    if (secret === undefined) return undefined;
    if (!secret) return null;
    if (!safeStorage.isEncryptionAvailable() ||
        (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
      throw new Error('Cifratura del sistema indisponibile. Usa una variabile d’ambiente per la password SQL.');
    }
    return safeStorage.encryptString(secret).toString('hex');
  };

  const resolveSqlSecret = async (connectionId?: string | null, explicitSecret?: string): Promise<string | null> => {
    if (explicitSecret) return explicitSecret;
    if (!connectionId) return null;
    const meta = await dbWorker.getSqlConnectionSecretMeta(connectionId);
    if (!meta) return null;
    if (meta.envVarRef && process.env[meta.envVarRef]) {
      return process.env[meta.envVarRef] ?? null;
    }
    if (!meta.encryptedSecretHex) return null;
    try {
      if (safeStorage.isEncryptionAvailable() &&
          (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')) {
        return safeStorage.decryptString(Buffer.from(meta.encryptedSecretHex, 'hex'));
      }
    } catch {
      // A stored value may belong to a different OS account or an older build.
    }
    throw new Error('Password SQL illeggibile. Salvala di nuovo o usa una variabile d’ambiente.');
  };

  handleStudioIpc('studio:sql:loadSchema', (_e, projectId: string) => dbWorker.loadSqlSchema(projectId));
  handleStudioIpc('studio:sql:saveSchema', (_e, projectId: string, doc) => dbWorker.saveSqlSchema(projectId, doc));
  handleStudioIpc('studio:sql:listConnections', (_e, projectId: string) => dbWorker.listSqlConnections(projectId));
  handleStudioIpc('studio:sql:saveConnection', (_e, profile, secret?: string) =>
    dbWorker.saveSqlConnection(profile, encryptSqlSecret(secret)),
  );
  handleStudioIpc('studio:sql:deleteConnection', (_e, connectionId: string) =>
    dbWorker.deleteSqlConnection(connectionId),
  );
  handleStudioIpc('studio:sql:testConnection', async (_e, connectionId: string, secretOverride?: string) => {
    const decrypted = await resolveSqlSecret(connectionId, secretOverride);
    return dbWorker.testSqlConnection(connectionId, decrypted);
  });
  handleStudioIpc('studio:sql:introspectConnection', async (_e, connectionId: string) => {
    const decrypted = await resolveSqlSecret(connectionId);
    return dbWorker.introspectSqlConnection(connectionId, decrypted);
  });
  handleStudioIpc('studio:sql:executeQuery', async (_e, req) => {
    const decrypted = await resolveSqlSecret(req.connectionId);
    return dbWorker.executeSqlQuery({ ...req, decryptedSecret: decrypted });
  });
  handleStudioIpc('studio:sql:applyDataChanges', async (_e, input) => {
    const decrypted = await resolveSqlSecret(input.connectionId);
    return dbWorker.applySqlDataChanges({ ...input, decryptedSecret: decrypted });
  });
  handleStudioIpc('studio:sql:resetSandbox', (_e, projectId: string, schemaDoc) =>
    dbWorker.resetSqlSandbox(projectId, schemaDoc),
  );
  handleStudioIpc('studio:sql:compileMigration', async (_e, input) => {
    const decrypted = await resolveSqlSecret(input.connectionId);
    return dbWorker.compileSqlMigration({ ...input, decryptedSecret: decrypted });
  });
  handleStudioIpc('studio:sql:applyMigration', async (_e, input) => {
    const decrypted = await resolveSqlSecret(input.connectionId);
    return dbWorker.applySqlMigration({ ...input, decryptedSecret: decrypted });
  });
  handleStudioIpc('studio:sql:listQueryHistory', (_e, projectId: string, limit?: number) =>
    dbWorker.listSqlQueryHistory(projectId, limit),
  );
  handleStudioIpc('studio:sql:extractSqlFromProjectFiles', (_e, projectId: string) =>
    dbWorker.extractSqlFromProjectFiles(projectId),
  );
  handleStudioIpc('studio:sql:generateCodeBundle', (_e, req: GenerateSqlCodeRequest) =>
    codegenWorker.generateSqlCodeBundle(req),
  );
  handleStudioIpc('studio:sql:installRustTauriModule', (_e, projectId, bundle) =>
    dbWorker.installRustTauriSqlModule(projectId, bundle),
  );
}

function registerStudioAssetProtocol(): void {
  protocol.handle('studio-asset', async (request) => {
    try {
      const parsed = new URL(request.url);
      const projectId = parsed.hostname;
      const sha256 = parsed.pathname.replace(/^\/+/, '');
      const asset = await dbWorker.getAssetByHash(projectId, sha256);
      if (!asset) {
        return new Response('Asset not found', { status: 404 });
      }
      const bodyBuffer = Buffer.from(asset.data);
      return new Response(bodyBuffer, {
        status: 200,
        headers: {
          'Content-Type': asset.mimeType,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:",
        },
      });
    } catch {
      return new Response('Internal asset error', { status: 500 });
    }
  });
}

function resolvePreloadPath(): string {
  const cjsPath = join(__dirname, '../preload/index.js');
  if (existsSync(cjsPath)) return cjsPath;
  const mjsPath = join(__dirname, '../preload/index.mjs');
  if (existsSync(mjsPath)) return mjsPath;
  return cjsPath;
}

function resolveAppIconPath(): string | undefined {
  const candidates =
    process.platform === 'win32'
      ? [
          join(__dirname, '../../resources/icon.ico'),
          join(process.cwd(), 'resources/icon.ico'),
          join(__dirname, '../../resources/icon.png'),
          join(process.cwd(), 'resources/icon.png'),
          join(__dirname, '../renderer/app-icon.png'),
        ]
      : [
          join(__dirname, '../../resources/icon.png'),
          join(process.cwd(), 'resources/icon.png'),
          join(__dirname, '../../resources/icon.ico'),
          join(process.cwd(), 'resources/icon.ico'),
          join(__dirname, '../renderer/app-icon.png'),
        ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function probeOllamaTagsOnline(baseUrl: string, timeoutMs = 1500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
      signal: controller.signal,
    });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function resolveOllamaBinaryPath(): string | null {
  const isWindows = process.platform === 'win32';
  const executable = isWindows ? 'ollama.exe' : 'ollama';
  const directories = isWindows
    ? [
        process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'Ollama') : '',
        process.env.ProgramFiles ? join(process.env.ProgramFiles, 'Ollama') : '',
        process.env['ProgramFiles(x86)'] ? join(process.env['ProgramFiles(x86)'], 'Ollama') : '',
      ]
    : ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin'];
  directories.push(...(process.env.PATH ?? '').split(delimiter).map((path) => path.replace(/^"|"$/g, '')));
  for (const directory of directories) {
    if (!isAbsolute(directory)) continue;
    const candidate = join(directory, executable);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

let inFlightEnsureOllama: Promise<EnsureOllamaResult> | null = null;

async function ensureOllamaRunning(): Promise<EnsureOllamaResult> {
  if (inFlightEnsureOllama) {
    return inFlightEnsureOllama;
  }

  inFlightEnsureOllama = (async (): Promise<EnsureOllamaResult> => {
    const baseUrl = 'http://127.0.0.1:11434';
    const alreadyOnline = await probeOllamaTagsOnline(baseUrl, 1500);

    if (alreadyOnline) {
      let models: EnsureOllamaResult['models'] = [];
      try {
        const statuses = await aiWorker.listProvidersAndModels();
        models = statuses.find((s) => s.id === 'ollama')?.models ?? [];
      } catch {
        models = [];
      }
      return {
        online: true,
        startedByApp: false,
        baseUrl,
        models,
        preferredModel: pickPreferredLocalModel(models),
        message: 'Ollama già attivo su :11434',
      };
    }

    const ollamaBin = resolveOllamaBinaryPath();
    if (!ollamaBin) {
      return {
        online: false,
        startedByApp: false,
        binaryPath: null,
        baseUrl,
        models: [],
        preferredModel: null,
        message: 'Ollama non rilevato sul sistema (:11434 offline). Installa Ollama per attivare i modelli locali.',
      };
    }

    try {
      const daemon = spawn(ollamaBin, ['serve'], {
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
      });
      daemon.on('error', () => {
        // Ignore background spawn errors
      });
      daemon.unref();
    } catch (err) {
      return {
        online: false,
        startedByApp: false,
        binaryPath: ollamaBin,
        baseUrl,
        models: [],
        preferredModel: null,
        message: `Impossibile avviare Ollama: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const deadline = Date.now() + 8000;
    let onlineNow = false;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400));
      if (await probeOllamaTagsOnline(baseUrl, 1200)) {
        onlineNow = true;
        break;
      }
    }

    if (!onlineNow) {
      return {
        online: false,
        startedByApp: true,
        binaryPath: ollamaBin,
        baseUrl,
        models: [],
        preferredModel: null,
        message: 'Processo Ollama avviato, in attesa che la porta :11434 risponda...',
      };
    }

    let models: EnsureOllamaResult['models'] = [];
    try {
      const statuses = await aiWorker.listProvidersAndModels();
      models = statuses.find((s) => s.id === 'ollama')?.models ?? [];
    } catch {
      models = [];
    }

    return {
      online: true,
      startedByApp: true,
      binaryPath: ollamaBin,
      baseUrl,
      models,
      preferredModel: pickPreferredLocalModel(models),
      message: 'Ollama avviato automaticamente su :11434',
    };
  })().finally(() => {
    inFlightEnsureOllama = null;
  });

  return inFlightEnsureOllama;
}

function createMainWindow(): void {
  Menu.setApplicationMenu(null);
  const iconPath = resolveAppIconPath();

  mainWindow = new BrowserWindow({
    width: 1540,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    title: `Visual UI Studio ${app.isPackaged ? app.getVersion() : "0.1.0"}`,
    backgroundColor: '#0b1120',
    icon: iconPath,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
    },
  });

  if (iconPath && (process.platform === 'win32' || process.platform === 'linux')) {
    try {
      mainWindow.setIcon(iconPath);
    } catch {
      // Ignore non-fatal icon binding issues on headless CI
    }
  }

  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame && event.url === 'about:srcdoc') return;
    event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write');
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const external = new URL(url);
      if ((external.protocol === 'https:' || external.protocol === 'http:') &&
          !external.username && !external.password) {
        void shell.openExternal(external.href).catch(() => {});
      }
    } catch {
      // Malformed links stay in the app.
    }
    return { action: 'deny' };
  });

  const rendererUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  if (rendererUrl) void mainWindow.loadURL(rendererUrl);
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  spawnUtilityWorkers();
  registerStudioAssetProtocol();
  registerIpcHandlers();

  // Auto-start or connect to local Ollama immediately on program launch
  void ensureOllamaRunning();

  // Warm up default project in SQLite before first renderer request
  try {
    await dbWorker.getCurrentProject();
  } catch {
    // Renderer will retry if needed
  }

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('before-quit', (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  toolchainRunner.unwatchDirectory();
  void toolchainRunner.stopAllTasks().catch(() => {}).finally(() => {
    dbChild?.kill();
    codegenChild?.kill();
    aiChild?.kill();
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
