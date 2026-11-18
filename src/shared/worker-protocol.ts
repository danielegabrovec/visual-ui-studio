import type {
  AgentChatMessageDTO,
  AgentStreamEvent,
  AgentThreadDTO,
  CheckpointReason,
  CheckpointSummaryDTO,
  CommittedPatchBatch,
  CreateProjectInput,
  CreateVfsEntryInput,
  ExportUnslothDatasetRequest,
  ExportUnslothDatasetResult,
  GenerateProjectWithAiRequest,
  HardwareAdvisorReport,
  LocalAIProviderKind,
  LocalAIProviderStatus,
  OfflineIconEntry,
  PatchCommitResult,
  ProjectBootstrapPayload,
  ProjectSummary,
  RecordUnslothPairInput,
  RunAgentTurnRequest,
  RunAgentTurnResult,
  SheetSummaryDTO,
  StartupAssistantChatRequest,
  StartupAssistantChatResult,
  UnslothModelRecommendation,
  UnslothTrainingPairDTO,
  VfsNodeDTO,
  WorkspaceStateDTO,
} from './ipc-contract';
import type {
  CodegenCompileOptions,
  DesignTheme,
  DesignTokenEntry,
  NodeId,
  TargetArtifactBundle,
  TargetDescriptor,
  UISheetDocument,
} from './ui-ir';
import type { UIPatchOp } from './ui-patch';
import type {
  ProjectWizardSpec,
  WizardPaletteId,
  WizardProjectSeedBundle,
} from './wizard-templates';
import type {
  DetectedDiskProjectInfo,
  PrimaryCodeLanguage,
  ProjectStackId,
  PythonCompanionKind,
} from './project-stacks';
import type {
  ExtractedSqlOperation,
  GenerateSqlCodeRequest,
  SqlConnectionProfile,
  SqlDataChange,
  SqlDesignDocument,
  SqlDialect,
  SqlMigrationPlan,
  SqlQueryHistoryEntry,
  SqlQueryRequest,
  SqlQueryResult,
} from './sql-ir';

// ============================================================================
// TYPED WORKER SERVICE INTERFACES (DB, CODEGEN, LOCAL-AI)
// ============================================================================

export interface PersistProjectSeedOptions {
  layoutMode?: 'freeform' | 'auto';
  category?: string;
  paletteId?: string;
  defaultThemeMode?: 'dark' | 'light';
  rootDiskPath?: string | null;
  stackId?: ProjectStackId;
  primaryLanguage?: PrimaryCodeLanguage;
  pythonCompanion?: PythonCompanionKind;
  sqlDocument?: SqlDesignDocument;
  extraDiskFiles?: Array<{ relativePath: string; content: string | Uint8Array }>;
  activeAiProviderId?: LocalAIProviderKind;
  activeAiModelId?: string;
  initialPrompt?: string;
  initialAssistantSummary?: string;
}

export interface AiGeneratedProjectSeedOutput {
  runId: string;
  seed: WizardProjectSeedBundle;
  paletteId: WizardPaletteId;
  defaultThemeMode: 'dark' | 'light';
  provider: LocalAIProviderKind;
  modelName: string;
  assistantSummary: string;
  usedFallbackOffline: boolean;
  latencyMs: number;
}

export interface SaveAiTurnPayload {
  projectId: string;
  threadId?: string | null;
  titleHint: string;
  mode: RunAgentTurnRequest['mode'];
  provider: LocalAIProviderKind;
  modelName: string;
  userPrompt: string;
  assistantReply: string;
  thinkingText?: string;
  preCheckpointId?: string | null;
  toolCalls?: NonNullable<AgentChatMessageDTO['toolCalls']>;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
}

export interface IDbWorkerService {
  // Project lifecycle
  listRecentProjects(): Promise<ProjectSummary[]>;
  removeRecentProject(projectId: string): Promise<ProjectSummary[]>;
  createProject(input: CreateProjectInput): Promise<ProjectBootstrapPayload>;
  createProjectFromWizard(spec: ProjectWizardSpec): Promise<ProjectBootstrapPayload>;
  createProjectFromSeed(
    seed: WizardProjectSeedBundle,
    options?: PersistProjectSeedOptions,
  ): Promise<ProjectBootstrapPayload>;
  openProject(idOrPath: string): Promise<ProjectBootstrapPayload>;
  importExistingDiskProject(input: {
    rootDiskPath: string;
    detected: DetectedDiskProjectInfo;
    liftedInitialSheet?: UISheetDocument | null;
    linkedEntryRelPath?: string | null;
  }): Promise<ProjectBootstrapPayload>;
  reconcileDiskPaths(projectId: string, relPaths?: string[]): Promise<{ syncedCount: number }>;
  getCurrentProject(): Promise<ProjectBootstrapPayload>;
  linkDiskDirectory(projectId: string, dirPath: string): Promise<{ rootDiskPath: string; syncedCount: number }>;
  updateProjectSettings(
    projectId: string,
    patch: Partial<
      Pick<
        ProjectSummary,
        | 'name'
        | 'primaryTarget'
        | 'stylingPreset'
        | 'stackId'
        | 'primaryLanguage'
        | 'pythonCompanion'
        | 'activeThemeId'
        | 'layoutMode'
      >
    >,
  ): Promise<ProjectSummary>;

  // Workspace Shell state
  loadWorkspaceState(projectId: string): Promise<WorkspaceStateDTO>;
  saveWorkspaceState(
    projectId: string,
    patch: Partial<Omit<WorkspaceStateDTO, 'projectId' | 'updatedAt'>>,
  ): Promise<WorkspaceStateDTO>;

  // Virtual & Disk-Mapped File System
  listVfsTree(projectId: string): Promise<VfsNodeDTO[]>;
  createVfsEntry(input: CreateVfsEntryInput): Promise<{ entry: VfsNodeDTO; createdSheet?: UISheetDocument }>;
  renameVfsEntry(entryId: string, newName: string): Promise<VfsNodeDTO>;
  moveVfsEntry(entryId: string, newParentId: string | null): Promise<VfsNodeDTO>;
  deleteVfsEntry(entryId: string, deleteOnDisk?: boolean): Promise<void>;
  readVfsFile(entryId: string): Promise<{ content: string; sha256: string }>;
  writeVfsFile(entryId: string, content: string, expectedContent?: string): Promise<{ sha256: string }>;
  writeGeneratedBundleToDisk(projectId: string, bundle: TargetArtifactBundle): Promise<{ writtenPaths: string[] }>;
  installRustTauriSqlModule(projectId: string, bundle: TargetArtifactBundle): Promise<{ writtenPaths: string[] }>;

  // Canvas Sheets, Patch Log, Undo/Redo & Atomic Checkpoints
  listSheets(projectId: string): Promise<SheetSummaryDTO[]>;
  loadSheet(sheetId: string): Promise<UISheetDocument>;
  saveSheetViewport(sheetId: string, x: number, y: number, zoom: number): Promise<void>;
  commitPatchBatch(batch: CommittedPatchBatch): Promise<PatchCommitResult>;
  undo(sheetId: string): Promise<PatchCommitResult | null>;
  redo(sheetId: string): Promise<PatchCommitResult | null>;
  listCheckpoints(sheetId: string): Promise<CheckpointSummaryDTO[]>;
  createCheckpoint(input: {
    projectId: string;
    sheetId: string;
    reason: CheckpointReason;
    label: string;
    aiRunId?: string;
  }): Promise<CheckpointSummaryDTO>;
  restoreCheckpoint(checkpointId: string): Promise<UISheetDocument>;

  // Design Tokens, Themes & Offline FTS5 Icons
  listTokens(projectId: string): Promise<DesignTokenEntry[]>;
  upsertToken(entry: Omit<DesignTokenEntry, 'id'> & { id?: string }): Promise<DesignTokenEntry>;
  deleteToken(tokenId: string): Promise<void>;
  listThemes(projectId: string): Promise<DesignTheme[]>;
  searchIcons(query: string, category?: string): Promise<OfflineIconEntry[]>;

  // Assets (for studio-asset:// protocol)
  getAssetByHash(projectId: string, sha256: string): Promise<{ mimeType: string; data: Uint8Array } | null>;

  // AI Threads, Messages & Unsloth Dataset Pairs
  getAiProviderConfigs(): Promise<Record<string, { baseUrl: string; apiKey?: string }>>;
  saveAiProviderConfig(id: LocalAIProviderKind, baseUrl: string, apiKey?: string): Promise<void>;
  listAiThreads(projectId: string): Promise<AgentThreadDTO[]>;
  getAiThreadMessages(threadId: string): Promise<AgentChatMessageDTO[]>;
  recordAiTurnMessages(payload: SaveAiTurnPayload): Promise<{
    threadId: string;
    userMessage: AgentChatMessageDTO;
    assistantMessage: AgentChatMessageDTO;
  }>;
  recordUnslothPair(input: RecordUnslothPairInput): Promise<UnslothTrainingPairDTO>;
  listUnslothPairs(projectId: string): Promise<UnslothTrainingPairDTO[]>;

  // Multi-Dialect SQL & Data Studio Engine (v3.0)
  loadSqlSchema(projectId: string): Promise<SqlDesignDocument>;
  saveSqlSchema(projectId: string, doc: SqlDesignDocument): Promise<SqlDesignDocument>;
  listSqlConnections(projectId: string): Promise<SqlConnectionProfile[]>;
  saveSqlConnection(
    profile: Omit<SqlConnectionProfile, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    encryptedSecretHex?: string | null,
  ): Promise<SqlConnectionProfile>;
  deleteSqlConnection(connectionId: string): Promise<void>;
  getSqlConnectionSecretMeta(
    connectionId: string,
  ): Promise<{ encryptedSecretHex: string | null; envVarRef: string | null } | null>;
  testSqlConnection(
    connectionId: string,
    decryptedSecret?: string | null,
  ): Promise<{ ok: boolean; message: string; version?: string; latencyMs?: number }>;
  introspectSqlConnection(connectionId: string, decryptedSecret?: string | null): Promise<SqlDesignDocument>;
  executeSqlQuery(req: SqlQueryRequest & { decryptedSecret?: string | null }): Promise<SqlQueryResult>;
  applySqlDataChanges(input: {
    projectId: string;
    connectionId?: string | null;
    sandboxMode?: boolean;
    dialect?: SqlDialect;
    tableName: string;
    schema?: string;
    changes: SqlDataChange[];
    schemaDoc?: SqlDesignDocument;
    decryptedSecret?: string | null;
  }): Promise<{ ok: boolean; appliedCount: number; sqlPreview: string[]; error?: string }>;
  resetSqlSandbox(projectId: string, schemaDoc?: SqlDesignDocument): Promise<{ ok: boolean; message: string }>;
  compileSqlMigration(input: {
    projectId: string;
    schemaDoc: SqlDesignDocument;
    connectionId?: string | null;
    decryptedSecret?: string | null;
  }): Promise<SqlMigrationPlan>;
  applySqlMigration(input: {
    projectId: string;
    plan: SqlMigrationPlan;
    connectionId?: string | null;
    sandboxMode?: boolean;
    allowDestructive?: boolean;
    decryptedSecret?: string | null;
  }): Promise<{ ok: boolean; executedStatements: number; error?: string }>;
  listSqlQueryHistory(projectId: string, limit?: number): Promise<SqlQueryHistoryEntry[]>;
  extractSqlFromProjectFiles(projectId: string): Promise<ExtractedSqlOperation[]>;
}

export interface ICodegenWorkerService {
  listTargets(): Promise<TargetDescriptor[]>;
  compileSheet(input: {
    sheet: UISheetDocument;
    tokens: DesignTokenEntry[];
    themes: DesignTheme[];
    options: CodegenCompileOptions;
  }): Promise<TargetArtifactBundle>;
  solveFreeformLayout(input: {
    sheet: UISheetDocument;
    rootNodeId: NodeId;
  }): Promise<{ ops: UIPatchOp[]; summary: string }>;
  generateSqlCodeBundle(req: GenerateSqlCodeRequest): Promise<TargetArtifactBundle>;
}

export interface AiTurnExecutionContext {
  request: RunAgentTurnRequest;
  sheet: UISheetDocument;
  tokens: DesignTokenEntry[];
  themes: DesignTheme[];
  preCheckpointId: string;
}

export interface AiTurnWorkerOutput {
  runId: string;
  assistantReply: string;
  thinkingText?: string;
  appliedOps: UIPatchOp[];
  updatedSheet: UISheetDocument;
  toolCalls: NonNullable<AgentChatMessageDTO['toolCalls']>;
  usedFallbackOffline: boolean;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs: number;
}

export interface IAiWorkerService {
  getHardwareReport(): Promise<HardwareAdvisorReport>;
  listProvidersAndModels(): Promise<LocalAIProviderStatus[]>;
  configureProvider(config: {
    id: LocalAIProviderKind;
    baseUrl: string;
    apiKey?: string;
  }): Promise<LocalAIProviderStatus>;
  getUnslothCatalog(): Promise<UnslothModelRecommendation[]>;
  pullOllamaModel(modelRef: string): Promise<{ ok: boolean; message: string }>;
  askStartupAssistant(
    req: StartupAssistantChatRequest,
    onStream?: (event: AgentStreamEvent) => void,
  ): Promise<StartupAssistantChatResult>;
  generateProjectSeedWithAi(
    req: GenerateProjectWithAiRequest,
    onStream?: (event: AgentStreamEvent) => void,
  ): Promise<AiGeneratedProjectSeedOutput>;
  executeAgentTurn(
    ctx: AiTurnExecutionContext,
    onStream?: (event: AgentStreamEvent) => void,
  ): Promise<AiTurnWorkerOutput>;
  cancelAgentRun(runId: string): Promise<void>;
  exportUnslothBundleFiles(input: {
    pairs: UnslothTrainingPairDTO[];
    request: ExportUnslothDatasetRequest;
    resolvedOutputDir: string;
  }): Promise<ExportUnslothDatasetResult>;
}

// ============================================================================
// GENERIC MESSAGE-PORT / UTILITY-PROCESS JSON-RPC BRIDGE
// ============================================================================

export interface WorkerRpcRequest {
  kind: 'rpc_request';
  id: string;
  method: string;
  args: unknown[];
}

export interface WorkerRpcResponse {
  kind: 'rpc_response';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface WorkerStreamMessage {
  kind: 'worker_event';
  channel: string;
  payload: unknown;
}

export type WorkerWireMessage = WorkerRpcRequest | WorkerRpcResponse | WorkerStreamMessage;

export interface MinimalPortLike {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (msg: any) => void): void;
  off?(event: 'message', listener: (msg: any) => void): void;
  removeListener?(event: 'message', listener: (msg: any) => void): void;
}

/**
 * Attaches an async service implementation to Electron `process.parentPort` or Node `worker_threads.parentPort`.
 */
export function attachWorkerRpcHandler<TService extends object>(
  port: MinimalPortLike,
  service: TService,
  emitEvent?: (emitFn: (channel: string, payload: unknown) => void) => void,
): void {
  if (emitEvent) {
    emitEvent((channel, payload) => {
      const ev: WorkerStreamMessage = { kind: 'worker_event', channel, payload };
      port.postMessage(ev);
    });
  }

  port.on('message', async (raw: any) => {
    const msg: WorkerWireMessage = raw && typeof raw === 'object' && 'data' in raw ? raw.data : raw;
    if (!msg || msg.kind !== 'rpc_request') return;

    const fn = (service as Record<string, unknown>)[msg.method];
    if (typeof fn !== 'function') {
      const errResp: WorkerRpcResponse = {
        kind: 'rpc_response',
        id: msg.id,
        ok: false,
        error: `Unknown worker method: ${msg.method}`,
      };
      port.postMessage(errResp);
      return;
    }

    try {
      const result = await (fn as (...a: unknown[]) => Promise<unknown>).apply(service, msg.args);
      const okResp: WorkerRpcResponse = {
        kind: 'rpc_response',
        id: msg.id,
        ok: true,
        result,
      };
      port.postMessage(okResp);
    } catch (err) {
      const errResp: WorkerRpcResponse = {
        kind: 'rpc_response',
        id: msg.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
      port.postMessage(errResp);
    }
  });
}

/**
 * Creates a strongly-typed Proxy client over an Electron `UtilityProcess` or `MessagePortMain`.
 */
export function createWorkerRpcProxy<TService extends object>(
  port: MinimalPortLike,
  onEvent?: (channel: string, payload: unknown) => void,
): TService {
  let reqSeq = 0;
  const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();

  port.on('message', (raw: any) => {
    const msg: WorkerWireMessage = raw && typeof raw === 'object' && 'data' in raw ? raw.data : raw;
    if (!msg || typeof msg !== 'object') return;

    if (msg.kind === 'rpc_response') {
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.ok) {
        entry.resolve(msg.result);
      } else {
        entry.reject(new Error(msg.error ?? 'Worker RPC error'));
      }
    } else if (msg.kind === 'worker_event' && onEvent) {
      onEvent(msg.channel, msg.payload);
    }
  });

  return new Proxy({} as TService, {
    get(_target, prop) {
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      return (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          const id = `req_${++reqSeq}_${Date.now()}`;
          pending.set(id, { resolve, reject });
          const req: WorkerRpcRequest = {
            kind: 'rpc_request',
            id,
            method: prop,
            args,
          };
          port.postMessage(req);
        });
    },
  });
}
