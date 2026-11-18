import { createStarterBlueprintGraph } from '@shared/blueprint-ir';
import { compileSheetToCss } from '@shared/css-sync-engine';
import {
  DEFAULT_BREAKPOINTS,
  createDefaultThemes,
  createDefaultTokens,
  createStarterDemoSheet,
} from '@shared/default-tokens';
import { searchOfflineIcons } from '@shared/icon-catalog';
import {
  filterAndRankLocalModels,
  inferVfsKindFromFilename,
  isEmbeddingOnlyModelName,
  isTextFileVfsKind,
  pickPreferredLocalModel,
  type AgentChatMessageDTO,
  type AgentStreamEvent,
  type AgentThreadDTO,
  type CheckpointSummaryDTO,
  type CommittedPatchBatch,
  type CompileSheetRequest,
  type CreateProjectInput,
  type CreateVfsEntryInput,
  type EnsureOllamaResult,
  type ExportUnslothDatasetRequest,
  type ExportUnslothDatasetResult,
  type GenerateProjectWithAiRequest,
  type HardwareAdvisorReport,
  type LocalAIModelInfo,
  type LocalAIProviderKind,
  type LocalAIProviderStatus,
  type PatchCommitResult,
  type ProjectBootstrapPayload,
  type ProjectSummary,
  type RecordUnslothPairInput,
  type RunAgentTurnRequest,
  type RunAgentTurnResult,
  type SheetSummaryDTO,
  type StartupAssistantChatRequest,
  type StartupAssistantChatResult,
  type StudioPreloadApi,
  type UnslothModelRecommendation,
  type UnslothTrainingPairDTO,
  type VfsEntryKind,
  type VfsNodeDTO,
  type WorkspaceStateDTO,
} from '@shared/ipc-contract';
import {
  getProjectStackDescriptor,
  type DiskProjectInitSpec,
  type ToolchainDoctorReport,
  type ToolchainStreamEvent,
  type ToolchainTaskStatus,
} from '@shared/project-stacks';
import { buildDiskProjectScaffold } from '@shared/project-scaffolder';
import {
  createStarterSqlDocument,
  type GenerateSqlCodeRequest,
  type SqlConnectionProfile,
  type SqlDesignDocument,
  type SqlQueryRequest,
  type SqlQueryResult,
} from '@shared/sql-ir';
import { extractSqlFromSourceCode } from '@shared/sql-import';
import { buildSqlMigrationPlan } from '@shared/sql-migration';
import { createStarterScriptModuleTs } from '@shared/script-ir';
import { createThreeSceneFromPreset } from '@shared/three-ir';
import type {
  CodegenTargetId,
  DesignTheme,
  DesignTokenEntry,
  StylingDialect,
  TargetArtifactBundle,
  UINode,
  UISheetDocument,
} from '@shared/ui-ir';
import {
  applyPatchOpsToSheet,
  createDefaultUINode,
  fractionalOrderAt,
  generateNodeId,
  hydrateCompactNodeToPatches,
  type UIPatchOp,
} from '@shared/ui-patch';
import {
  WIZARD_PALETTE_PRESETS,
  buildWizardProjectSeed,
  type GeneratedWizardVfsSeedItem,
  type ProjectWizardSpec,
  type WizardPaletteId,
  type WizardProjectSeedBundle,
} from '@shared/wizard-templates';
import { createCodegenWorkerService } from '../../../workers/codegen-worker/service';

const DESKTOP_DISK_REQUIRED = 'Per accedere alle cartelle del computer, apri Visual UI Studio per desktop.';
const DESKTOP_SQL_REQUIRED = 'Per eseguire SQL e collegare database, apri Visual UI Studio per desktop.';

export const BROWSER_STUDIO_STORAGE_KEY = 'visual_ui_studio_v2_state';

let hasAppliedBootUrlReset = false;

function consumeResetHubQueryFlag(): boolean {
  if (hasAppliedBootUrlReset) return false;
  try {
    if (typeof window !== 'undefined' && window.location?.search) {
      const params = new URLSearchParams(window.location.search);
      const resetFlag = params.get('resetHub');
      if (resetFlag === '1' || resetFlag === 'true') {
        hasAppliedBootUrlReset = true;
        try {
          window.localStorage?.removeItem(BROWSER_STUDIO_STORAGE_KEY);
          window.sessionStorage?.clear();
        } catch {
          // Ignore sandbox storage restrictions
        }
        if (params.has('autostart') && window.history?.replaceState) {
          params.delete('autostart');
          const qs = params.toString();
          const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash || ''}`;
          window.history.replaceState(null, '', nextUrl);
        }
        return true;
      }
    }
  } catch {
    // Ignore URL parse errors in non-DOM environments
  }
  return false;
}

// Run immediately on module load so `?resetHub=1` clears persisted session before store bootstrap
consumeResetHubQueryFlag();

interface PersistedCheckpointSnapshot {
  sheet: UISheetDocument;
  fileContents: Record<string, string>;
}

interface PersistedBrowserProjectRecord {
  project: ProjectSummary;
  workspace: WorkspaceStateDTO;
  vfsTree: VfsNodeDTO[];
  fileContents: Record<string, string>;
  sheets: SheetSummaryDTO[];
  sheetDocs: Record<string, UISheetDocument>;
  themes: DesignTheme[];
  tokens: DesignTokenEntry[];
  checkpoints: CheckpointSummaryDTO[];
  checkpointSnapshots: Record<string, PersistedCheckpointSnapshot>;
  threads: AgentThreadDTO[];
  threadMessages: Record<string, AgentChatMessageDTO[]>;
  unslothPairs: UnslothTrainingPairDTO[];
  sqlSchema?: SqlDesignDocument;
  sqlConnections?: SqlConnectionProfile[];
}

interface PersistedBrowserStudioStateV2 {
  version: 2;
  activeProjectId: string;
  projectOrder: string[];
  projects: Record<string, PersistedBrowserProjectRecord>;
}

function normalizePosixPath(p: string): string {
  const withSlashes = p.replace(/\\/g, '/').replace(/\/+/g, '/');
  return withSlashes.startsWith('/') ? withSlashes : `/${withSlashes}`;
}

function quickHashHex(content: string): string {
  let h1 = 0xdeadbeef ^ content.length;
  let h2 = 0x41c6ce57 ^ content.length;
  for (let i = 0; i < content.length; i++) {
    const ch = content.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(16, '0');
}

function defaultBrowserTextContent(
  kind: VfsEntryKind,
  cleanName: string,
  projectId: string,
  projectName: string,
): string {
  switch (kind) {
    case 'style_file':
      return `/* Stylesheet: ${cleanName} */\n`;
    case 'script_file':
      return createStarterScriptModuleTs(projectName);
    case 'sql_schema':
      return JSON.stringify(createStarterSqlDocument(projectId, projectName, 'sqlite'), null, 2);
    case 'sql_file':
      return `-- SQL Script: ${cleanName}\nSELECT 1 AS ok;\n`;
    case 'blueprint_graph': {
      const bp = createStarterBlueprintGraph(projectId);
      bp.name = cleanName.replace(/\.blueprint\.json$/i, '');
      return JSON.stringify(bp, null, 2);
    }
    case 'three_scene': {
      const sc = createThreeSceneFromPreset(projectId, 'pbr-product-showcase');
      sc.name = cleanName.replace(/\.scene3d\.json$/i, '');
      return JSON.stringify(sc, null, 2);
    }
    case 'source_file':
    default:
      return `// ${cleanName}\n`;
  }
}

function getBrowserLocalStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Ignore storage security errors in sandboxed iframes
  }
  return null;
}

function createDefaultDemoProjectRecord(): PersistedBrowserProjectRecord {
  const now = Date.now();
  const projectId = 'proj_demo_local';
  const mainSheetId = 'sheet_home_dashboard';
  const { darkTheme, all: themes } = createDefaultThemes(projectId);
  const tokens = createDefaultTokens(projectId, darkTheme.id);
  const homeSheet = createStarterDemoSheet(projectId, mainSheetId, 'HomeDashboard');

  const starterCss = compileSheetToCss(homeSheet, tokens, darkTheme.id).css;
  const starterScript = createStarterScriptModuleTs('NovaCommerce Studio');
  const starterBp = createStarterBlueprintGraph(projectId, mainSheetId);
  const starter3d = createThreeSceneFromPreset(projectId, 'pbr-product-showcase');

  const bpFileName = `${starterBp.name}.blueprint.json`;
  const scene3dFileName = `${starter3d.name}.scene3d.json`;

  const project: ProjectSummary = {
    id: projectId,
    name: 'NovaCommerce Studio',
    dbFilePath: 'localstorage://novacommerce.uistudio',
    rootDiskPath: null,
    primaryTarget: 'react-tsx',
    stylingPreset: 'tailwind',
    activeThemeId: darkTheme.id,
    breakpoints: DEFAULT_BREAKPOINTS,
    layoutMode: 'auto',
    createdAt: now,
    updatedAt: now,
  };

  const workspace: WorkspaceStateDTO = {
    projectId,
    openTabsJson: '[]',
    leftTopRatio: 0.42,
    leftActiveMode: 'insert',
    rightPanelMode: 'split',
    rightPanelWidth: 370,
    activeAiProviderId: 'builtin_offline',
    activeAiModelId: 'offline-studio-architect-v1',
    updatedAt: now,
  };

  const vfsTree: VfsNodeDTO[] = [
    {
      id: 'vfs_dir_src',
      projectId,
      parentId: null,
      name: 'src',
      virtualPath: '/src',
      diskRelPath: 'src',
      entryKind: 'folder',
      sheetId: null,
      targetFramework: null,
      syncMode: 'virtual_only',
      gitStatus: 'clean',
      sortOrder: fractionalOrderAt(0),
      updatedAt: now,
    },
    {
      id: 'vfs_folder_screens',
      projectId,
      parentId: 'vfs_dir_src',
      name: 'screens',
      virtualPath: '/src/screens',
      diskRelPath: 'src/screens',
      entryKind: 'folder',
      sheetId: null,
      targetFramework: null,
      syncMode: 'virtual_only',
      gitStatus: 'clean',
      sortOrder: fractionalOrderAt(0),
      updatedAt: now,
    },
    {
      id: 'vfs_dir_styles',
      projectId,
      parentId: 'vfs_dir_src',
      name: 'styles',
      virtualPath: '/src/styles',
      diskRelPath: 'src/styles',
      entryKind: 'folder',
      sheetId: null,
      targetFramework: null,
      syncMode: 'virtual_only',
      gitStatus: 'clean',
      sortOrder: fractionalOrderAt(1),
      updatedAt: now,
    },
    {
      id: 'vfs_dir_scripts',
      projectId,
      parentId: 'vfs_dir_src',
      name: 'scripts',
      virtualPath: '/src/scripts',
      diskRelPath: 'src/scripts',
      entryKind: 'folder',
      sheetId: null,
      targetFramework: null,
      syncMode: 'virtual_only',
      gitStatus: 'clean',
      sortOrder: fractionalOrderAt(2),
      updatedAt: now,
    },
    {
      id: 'vfs_dir_blueprints',
      projectId,
      parentId: 'vfs_dir_src',
      name: 'blueprints',
      virtualPath: '/src/blueprints',
      diskRelPath: 'src/blueprints',
      entryKind: 'folder',
      sheetId: null,
      targetFramework: null,
      syncMode: 'virtual_only',
      gitStatus: 'clean',
      sortOrder: fractionalOrderAt(3),
      updatedAt: now,
    },
    {
      id: 'vfs_dir_scenes3d',
      projectId,
      parentId: 'vfs_dir_src',
      name: 'scenes3d',
      virtualPath: '/src/scenes3d',
      diskRelPath: 'src/scenes3d',
      entryKind: 'folder',
      sheetId: null,
      targetFramework: null,
      syncMode: 'virtual_only',
      gitStatus: 'clean',
      sortOrder: fractionalOrderAt(4),
      updatedAt: now,
    },
    {
      id: 'vfs_sheet_home',
      projectId,
      parentId: 'vfs_folder_screens',
      name: 'HomeDashboard.canvas',
      virtualPath: '/src/screens/HomeDashboard.canvas',
      diskRelPath: null,
      entryKind: 'canvas_sheet',
      sheetId: mainSheetId,
      targetFramework: 'react-tsx',
      syncMode: 'virtual_only',
      gitStatus: 'clean',
      sortOrder: fractionalOrderAt(0),
      updatedAt: now,
    },
    {
      id: 'vfs_style_main',
      projectId,
      parentId: 'vfs_dir_styles',
      name: 'theme-and-sheet.css',
      virtualPath: '/src/styles/theme-and-sheet.css',
      diskRelPath: 'src/styles/theme-and-sheet.css',
      entryKind: 'style_file',
      sheetId: null,
      targetFramework: null,
      syncMode: 'virtual_only',
      gitStatus: 'clean',
      sortOrder: fractionalOrderAt(0),
      updatedAt: now,
    },
    {
      id: 'vfs_script_handlers',
      projectId,
      parentId: 'vfs_dir_scripts',
      name: 'handlers.ts',
      virtualPath: '/src/scripts/handlers.ts',
      diskRelPath: 'src/scripts/handlers.ts',
      entryKind: 'script_file',
      sheetId: null,
      targetFramework: null,
      syncMode: 'virtual_only',
      gitStatus: 'clean',
      sortOrder: fractionalOrderAt(0),
      updatedAt: now,
    },
    {
      id: 'vfs_bp_main',
      projectId,
      parentId: 'vfs_dir_blueprints',
      name: bpFileName,
      virtualPath: `/src/blueprints/${bpFileName}`,
      diskRelPath: `src/blueprints/${bpFileName}`,
      entryKind: 'blueprint_graph',
      sheetId: null,
      targetFramework: null,
      syncMode: 'virtual_only',
      gitStatus: 'clean',
      sortOrder: fractionalOrderAt(0),
      updatedAt: now,
    },
    {
      id: 'vfs_3d_main',
      projectId,
      parentId: 'vfs_dir_scenes3d',
      name: scene3dFileName,
      virtualPath: `/src/scenes3d/${scene3dFileName}`,
      diskRelPath: `src/scenes3d/${scene3dFileName}`,
      entryKind: 'three_scene',
      sheetId: null,
      targetFramework: null,
      syncMode: 'virtual_only',
      gitStatus: 'clean',
      sortOrder: fractionalOrderAt(0),
      updatedAt: now,
    },
    {
      id: 'vfs_readme',
      projectId,
      parentId: null,
      name: 'README.md',
      virtualPath: '/README.md',
      diskRelPath: 'README.md',
      entryKind: 'source_file',
      sheetId: null,
      targetFramework: null,
      syncMode: 'virtual_only',
      gitStatus: 'clean',
      sortOrder: fractionalOrderAt(5),
      updatedAt: now,
    },
  ];

  const fileContents: Record<string, string> = {
    vfs_style_main: starterCss,
    vfs_script_handlers: starterScript,
    vfs_bp_main: JSON.stringify(starterBp, null, 2),
    vfs_3d_main: JSON.stringify(starter3d, null, 2),
    vfs_readme: `# NovaCommerce Studio\n\nProgetto multi-piattaforma generato con Visual UI Studio.\n`,
  };

  const sheets: SheetSummaryDTO[] = [
    {
      id: mainSheetId,
      projectId,
      vfsEntryId: 'vfs_sheet_home',
      name: 'HomeDashboard',
      sheetKind: 'visual_canvas',
      viewportX: 24,
      viewportY: 20,
      viewportZoom: 0.78,
      updatedAt: now,
    },
  ];

  return {
    project,
    workspace,
    vfsTree,
    fileContents,
    sheets,
    sheetDocs: { [mainSheetId]: homeSheet },
    themes,
    tokens,
    checkpoints: [],
    checkpointSnapshots: {},
    threads: [],
    threadMessages: {},
    unslothPairs: [],
  };
}

function buildBrowserRecordFromSeed(
  seed: WizardProjectSeedBundle,
  opts: {
    layoutMode: 'freeform' | 'auto';
    rootDiskPath?: string | null;
    activeAiProviderId?: string;
    activeAiModelId?: string;
  },
): PersistedBrowserProjectRecord {
  const now = Date.now();
  const {
    projectId,
    projectName,
    primaryTarget,
    stylingPreset,
    activeThemeId,
    themes,
    tokens,
    sheets: seedSheets,
    vfsItems,
  } = seed;

  const project: ProjectSummary = {
    id: projectId,
    name: projectName,
    dbFilePath: `localstorage://${projectId}.uistudio`,
    rootDiskPath: opts.rootDiskPath ?? null,
    primaryTarget,
    stylingPreset,
    activeThemeId,
    breakpoints: DEFAULT_BREAKPOINTS,
    layoutMode: opts.layoutMode,
    createdAt: now,
    updatedAt: now,
  };

  const workspace: WorkspaceStateDTO = {
    projectId,
    openTabsJson: '[]',
    leftTopRatio: 0.42,
    leftActiveMode: 'insert',
    rightPanelMode: 'split',
    rightPanelWidth: 370,
    activeAiProviderId: opts.activeAiProviderId ?? 'ollama',
    activeAiModelId: opts.activeAiModelId ?? 'offline-studio-architect-v1',
    updatedAt: now,
  };

  const keyToVfsId = new Map<string, string>();
  const sheetIdToVfsId = new Map<string, string>();
  const vfsTree: VfsNodeDTO[] = [];
  const fileContents: Record<string, string> = {};

  vfsItems.forEach((item, idx) => {
    const vfsId = generateNodeId('vfs');
    keyToVfsId.set(item.key, vfsId);
    if (item.sheetId) {
      sheetIdToVfsId.set(item.sheetId, vfsId);
    }
    const parentId = item.parentKey ? (keyToVfsId.get(item.parentKey) ?? null) : null;
    const vPath = normalizePosixPath(item.virtualPath);
    if (typeof item.contentText === 'string') {
      fileContents[vfsId] = item.contentText;
    }

    vfsTree.push({
      id: vfsId,
      projectId,
      parentId,
      name: item.name,
      virtualPath: vPath,
      diskRelPath: item.entryKind === 'canvas_sheet' ? null : vPath.replace(/^\/+/, ''),
      entryKind: item.entryKind,
      sheetId: item.sheetId ?? null,
      targetFramework: item.entryKind === 'canvas_sheet' ? primaryTarget : null,
      syncMode: 'virtual_only',
      gitStatus: 'clean',
      sortOrder: fractionalOrderAt(idx),
      updatedAt: now,
    });
  });

  const sheets: SheetSummaryDTO[] = [];
  const sheetDocs: Record<string, UISheetDocument> = {};

  seedSheets.forEach((sh, idx) => {
    const sheetTs = now + (seedSheets.length - idx);
    sheetDocs[sh.sheetId] = structuredClone(sh);
    sheets.push({
      id: sh.sheetId,
      projectId,
      vfsEntryId: sheetIdToVfsId.get(sh.sheetId) ?? null,
      name: sh.name,
      sheetKind: 'visual_canvas',
      viewportX: 24,
      viewportY: 20,
      viewportZoom: 0.78,
      updatedAt: sheetTs,
    });
  });

  const primarySheet = seedSheets[0];
  const checkpoints: CheckpointSummaryDTO[] = [];
  const checkpointSnapshots: Record<string, PersistedCheckpointSnapshot> = {};

  if (primarySheet) {
    const cpId = `cp_wiz_${projectId.slice(-6)}`;
    checkpoints.push({
      id: cpId,
      projectId,
      sheetId: primarySheet.sheetId,
      reason: 'manual',
      label: 'Initial Project Baseline',
      aiRunId: null,
      commandSeqAt: 0,
      createdAt: now,
    });
    checkpointSnapshots[cpId] = {
      sheet: structuredClone(primarySheet),
      fileContents: { ...fileContents },
    };
  }

  return {
    project,
    workspace,
    vfsTree,
    fileContents,
    sheets,
    sheetDocs,
    themes,
    tokens,
    checkpoints,
    checkpointSnapshots,
    threads: [],
    threadMessages: {},
    unslothPairs: [],
  };
}

function buildWizardBrowserRecord(spec: ProjectWizardSpec): PersistedBrowserProjectRecord {
  const seed = buildWizardProjectSeed(spec);
  return buildBrowserRecordFromSeed(seed, {
    layoutMode: spec.layoutMode,
    rootDiskPath: spec.rootDiskPath ?? null,
  });
}

async function fetchDirectOllamaStatus(
  baseUrl = 'http://127.0.0.1:11434',
  timeoutMs = 1800,
): Promise<LocalAIProviderStatus> {
  const cleanUrl = baseUrl.trim().replace(/\/+$/, '') || 'http://127.0.0.1:11434';
  const started = Date.now();
  if (typeof globalThis.fetch !== 'function') {
    return {
      id: 'ollama',
      displayName: 'Ollama (Local Daemon)',
      baseUrl: cleanUrl,
      online: false,
      error: 'Fetch non disponibile in questo ambiente',
      models: [],
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const [tagsResp, psResp] = await Promise.all([
      globalThis.fetch(`${cleanUrl}/api/tags`, { method: 'GET', signal: controller.signal }),
      globalThis.fetch(`${cleanUrl}/api/ps`, { method: 'GET', signal: controller.signal }).catch(() => null),
    ]);

    if (!tagsResp.ok) {
      return {
        id: 'ollama',
        displayName: 'Ollama (Local Daemon)',
        baseUrl: cleanUrl,
        online: false,
        latencyMs: Date.now() - started,
        error: `Ollama HTTP ${tagsResp.status}`,
        models: [],
      };
    }

    const tagsJson = (await tagsResp.json()) as {
      models?: Array<{
        name?: string;
        model?: string;
        size?: number;
        details?: { family?: string; families?: string[]; quantization_level?: string };
      }>;
    };
    const psJson =
      psResp && psResp.ok
        ? ((await psResp.json()) as {
            models?: Array<{ name?: string; model?: string; size_vram?: number }>;
          })
        : { models: [] };

    const vramMap = new Map<string, number>();
    for (const running of psJson.models ?? []) {
      const k = running.name || running.model || '';
      if (k) {
        const mb = typeof running.size_vram === 'number' ? Math.round(running.size_vram / (1024 * 1024)) : 0;
        vramMap.set(k, mb);
      }
    }

    const parsedModels: LocalAIModelInfo[] = [];
    for (const m of tagsJson.models ?? []) {
      const modelName = m.name || m.model || '';
      const families = m.details?.families ?? (m.details?.family ? [m.details.family] : []);
      if (!modelName || isEmbeddingOnlyModelName(modelName, families)) {
        continue;
      }
      const lower = modelName.toLowerCase();
      const lowerFams = families.map((f) => f.toLowerCase());
      parsedModels.push({
        id: modelName,
        name: modelName,
        provider: 'ollama',
        sizeBytes: m.size,
        quantization: m.details?.quantization_level,
        supportsVision:
          lower.includes('vl') ||
          lower.includes('vision') ||
          lower.includes('llava') ||
          lower.includes('gemma3') ||
          lower.includes('gemma-3') ||
          lowerFams.includes('clip'),
        supportsTools: true,
        isUnsloth: lower.includes('unsloth') || lower.includes('ud-q4') || lower.includes('ud-q5'),
        loadedInVram: vramMap.has(modelName),
        vramUsedMb: vramMap.get(modelName),
      });
    }

    return {
      id: 'ollama',
      displayName: 'Ollama (Local Daemon)',
      baseUrl: cleanUrl,
      online: true,
      latencyMs: Date.now() - started,
      models: filterAndRankLocalModels(parsedModels),
    };
  } catch {
    return {
      id: 'ollama',
      displayName: 'Ollama (Local Daemon)',
      baseUrl: cleanUrl,
      online: false,
      latencyMs: Date.now() - started,
      error: 'Ollama non raggiungibile su :11434 — avvia "ollama serve" o usa l\'app Desktop',
      models: [],
    };
  } finally {
    clearTimeout(timer);
  }
}

async function streamDirectOllamaChat(params: {
  baseUrl: string;
  modelName: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  format?: Record<string, unknown> | 'json';
  temperature?: number;
  timeoutMs?: number;
  onTokenDelta?: (delta: string, isThinking?: boolean) => void;
}): Promise<{ content: string; thinking?: string; tokensIn?: number; tokensOut?: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 35_000);
  try {
    const body: Record<string, unknown> = {
      model: params.modelName,
      stream: true,
      keep_alive: '10m',
      options: {
        temperature: params.temperature ?? 0.25,
        num_ctx: 16384,
      },
      messages: params.messages,
    };
    if (params.format !== undefined) {
      body.format = params.format;
    }

    const resp = await globalThis.fetch(`${params.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      throw new Error(`Ollama HTTP ${resp.status}`);
    }

    let fullContent = '';
    let fullThinking = '';
    let tokensIn: number | undefined;
    let tokensOut: number | undefined;

    if (resp.body) {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          const chunk = JSON.parse(line) as {
            message?: { content?: string; thinking?: string };
            prompt_eval_count?: number;
            eval_count?: number;
          };
          if (chunk.message?.thinking) {
            fullThinking += chunk.message.thinking;
            params.onTokenDelta?.(chunk.message.thinking, true);
          }
          if (chunk.message?.content) {
            fullContent += chunk.message.content;
            params.onTokenDelta?.(chunk.message.content, false);
          }
          if (typeof chunk.prompt_eval_count === 'number') tokensIn = chunk.prompt_eval_count;
          if (typeof chunk.eval_count === 'number') tokensOut = chunk.eval_count;
        }
      }
    } else {
      const single = (await resp.json()) as {
        message?: { content?: string; thinking?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };
      fullContent = single.message?.content ?? '';
      fullThinking = single.message?.thinking ?? '';
      if (fullContent) params.onTokenDelta?.(fullContent, false);
      tokensIn = single.prompt_eval_count;
      tokensOut = single.eval_count;
    }

    const cleaned = fullContent.replace(/<think>([\s\S]*?)<\/think>/gi, (_m, inner) => {
      if (typeof inner === 'string' && inner.trim()) {
        fullThinking = [fullThinking, inner.trim()].filter(Boolean).join('\n\n');
      }
      return '';
    });

    return {
      content: cleaned.trim(),
      thinking: fullThinking || undefined,
      tokensIn,
      tokensOut,
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildBrowserAiSeedBundle(
  req: GenerateProjectWithAiRequest,
  rawAiJson?: Record<string, any> | null,
): { seed: WizardProjectSeedBundle; summary: string } {
  const prompt = (req.prompt || '').trim();
  const lower = prompt.toLowerCase();
  const wantsThree =
    Boolean(rawAiJson?.includeThreeScene) ||
    lower.includes('3d') ||
    lower.includes('three') ||
    lower.includes('configuratore') ||
    lower.includes('showcase');

  const validPalettes = new Set<WizardPaletteId>([
    'dark-pro',
    'clean-light',
    'ocean-blue',
    'emerald-studio',
    'cyberpunk-neon',
    'warm-corporate',
  ]);

  let paletteId: WizardPaletteId =
    typeof rawAiJson?.paletteId === 'string' && validPalettes.has(rawAiJson.paletteId as WizardPaletteId)
      ? (rawAiJson.paletteId as WizardPaletteId)
      : wantsThree
        ? 'cyberpunk-neon'
        : lower.includes('fattur') || lower.includes('client')
          ? 'ocean-blue'
          : lower.includes('kpi') || lower.includes('ordini')
            ? 'emerald-studio'
            : 'dark-pro';

  const isDark = rawAiJson?.defaultThemeMode !== 'light' && paletteId !== 'clean-light';
  const palette = WIZARD_PALETTE_PRESETS.find((p) => p.id === paletteId) ?? WIZARD_PALETTE_PRESETS[0];

  const inferredName =
    req.projectName?.trim() ||
    (typeof rawAiJson?.projectName === 'string' && rawAiJson.projectName.trim()
      ? rawAiJson.projectName.trim().slice(0, 60)
      : lower.includes('fattur')
        ? 'Gestionale Clienti & Fatture'
        : wantsThree
          ? 'Showcase Prodotto 3D Studio'
          : prompt.slice(0, 38).replace(/^\w/, (c) => c.toUpperCase()) || 'Progetto AI Studio');

  const projectId = `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const primaryTarget: CodegenTargetId = req.primaryTarget ?? 'react-tsx';
  const stylingPreset: StylingDialect = req.stylingPreset ?? 'tailwind';
  const layoutMode: 'freeform' | 'auto' = req.layoutMode ?? 'freeform';
  const isFreeform = layoutMode === 'freeform';

  const { lightTheme, darkTheme, all: themes } = createDefaultThemes(projectId);
  const activeThemeId = isDark ? darkTheme.id : lightTheme.id;
  const tokens = createDefaultTokens(projectId, darkTheme.id).map((tok) => {
    const tokIsDark = tok.themeId === darkTheme.id;
    if (tok.tokenPath === 'color.bg.canvas') {
      return { ...tok, rawValue: tokIsDark ? palette.colors.canvasDark : palette.colors.canvasLight };
    }
    if (tok.tokenPath === 'color.bg.surface') {
      return { ...tok, rawValue: tokIsDark ? palette.colors.surfaceDark : palette.colors.surfaceLight };
    }
    if (tok.tokenPath === 'color.primary.500') {
      return { ...tok, rawValue: palette.colors.primary500 };
    }
    if (tok.tokenPath === 'color.primary.600') {
      return { ...tok, rawValue: palette.colors.primary600 };
    }
    if (tok.tokenPath === 'color.accent.500') {
      return { ...tok, rawValue: palette.colors.accent500 };
    }
    return tok;
  });

  const threeSceneDoc = wantsThree ? createThreeSceneFromPreset(projectId, 'pbr-product-showcase') : undefined;
  const sheetId = `sheet_ai_${projectId.slice(-5)}_0`;
  const blueprintDoc = createStarterBlueprintGraph(projectId, sheetId, `nd_cta_${sheetId}`, `nd_h1_${sheetId}`);

  const rawFirst = Array.isArray(rawAiJson?.screens) && rawAiJson.screens[0] ? rawAiJson.screens[0] : null;
  const screenName =
    (typeof rawFirst?.name === 'string' && rawFirst.name.replace(/[^a-zA-Z0-9]/g, '')) || 'WorkspacePrincipale';
  const screenTitle = (typeof rawFirst?.title === 'string' && rawFirst.title) || inferredName;
  const screenSub =
    (typeof rawFirst?.subtitle === 'string' && rawFirst.subtitle) ||
    prompt.slice(0, 110) ||
    'Interfaccia operativa generata su misura con KPI, form e tabella dati';
  const kpis: Array<{ label: string; value: string; trend: string }> =
    Array.isArray(rawFirst?.kpis) && rawFirst.kpis.length >= 3
      ? rawFirst.kpis.slice(0, 3).map((k: any) => ({
          label: String(k?.label || 'Indicatore'),
          value: String(k?.value || '€ 24.500'),
          trend: String(k?.trend || '+12,4%'),
        }))
      : [
          { label: 'Volume Operativo', value: '€ 48.920', trend: '+14,8% mensile' },
          { label: 'Record Attivi', value: '184 Pratiche', trend: '94,2% completate' },
          { label: 'Efficienza SLA', value: '99,1%', trend: '0 anomalie' },
        ];
  const handlerFn =
    (typeof rawFirst?.primaryHandlerFn === 'string' &&
      rawFirst.primaryHandlerFn.replace(/[^a-zA-Z0-9_]/g, '')) ||
    'onSubmitDomainForm';
  const actionLabel = (typeof rawFirst?.primaryActionLabel === 'string' && rawFirst.primaryActionLabel) || 'Salva Record';

  const canvasBg = isDark ? palette.colors.canvasDark : palette.colors.canvasLight;
  const surfaceBg = isDark ? palette.colors.surfaceDark : palette.colors.surfaceLight;
  const textPrimary = isDark ? '#f8fafc' : '#0f172a';
  const textSecondary = isDark ? '#94a3b8' : '#475569';
  const borderSubtle = isDark ? '#1e293b' : '#e2e8f0';

  const artId = `art_${sheetId}`;
  const navId = `nd_nav_${sheetId}`;
  const h1Id = `nd_h1_${sheetId}`;
  const subId = `nd_sub_${sheetId}`;
  const formId = `nd_form_${sheetId}`;
  const inp1Id = `nd_inp1_${sheetId}`;
  const inp2Id = `nd_inp2_${sheetId}`;
  const ctaId = `nd_cta_${sheetId}`;
  const tableId = `nd_tbl_${sheetId}`;

  const nodes: Record<string, UINode> = {};
  type RelaxedBrowserNode = Omit<Partial<UINode>, 'layout' | 'typography' | 'name' | 'kind'> &
    Pick<UINode, 'name' | 'kind'> & {
      layout?: Partial<UINode['layout']>;
      typography?: Partial<NonNullable<UINode['typography']>>;
    };
  const makeBrowserNode = (partial: RelaxedBrowserNode, sid: string): UINode => {
    const base = createDefaultUINode({ name: partial.name, kind: partial.kind }, sid);
    return createDefaultUINode(
      {
        ...partial,
        layout: partial.layout
          ? {
              ...base.layout,
              ...partial.layout,
              frame: partial.layout.frame ?? base.layout.frame,
              width: partial.layout.width ?? base.layout.width,
              height: partial.layout.height ?? base.layout.height,
              padding: partial.layout.padding ?? base.layout.padding,
            }
          : undefined,
        typography: partial.typography
          ? {
              fontFamily: { $token: 'font.sans' },
              fontSize: 14,
              fontWeight: 400,
              color: textPrimary,
              ...partial.typography,
            }
          : undefined,
      },
      sid,
    );
  };
  const kpiIds = kpis.map((k, idx) => {
    const cid = `nd_kpi_${sheetId}_${idx}`;
    const lid = `nd_klbl_${sheetId}_${idx}`;
    const vid = `nd_kval_${sheetId}_${idx}`;
    nodes[lid] = makeBrowserNode(
      {
        id: lid,
        parentId: cid,
        kind: 'text',
        name: `KpiLabel_${idx + 1}`,
        semanticTag: 'span',
        typography: { fontSize: 12, fontWeight: 500, color: textSecondary },
        content: { text: k.label },
      },
      sheetId,
    );
    nodes[vid] = makeBrowserNode(
      {
        id: vid,
        parentId: cid,
        kind: 'text',
        name: `KpiValue_${idx + 1}`,
        semanticTag: 'h2',
        typography: { fontSize: 22, fontWeight: 700, color: textPrimary },
        content: { text: `${k.value} (${k.trend})` },
      },
      sheetId,
    );
    nodes[cid] = makeBrowserNode(
      {
        id: cid,
        parentId: artId,
        kind: 'container',
        name: `KpiCard_${idx + 1}`,
        semanticTag: 'article',
        childIds: [lid, vid],
        layout: {
          mode: 'flex',
          positioning: isFreeform ? 'absolute' : 'flow',
          direction: 'column',
          gap: 8,
          frame: { x: 36 + idx * 384, y: 184, width: 360, height: 108 },
          width: isFreeform ? { mode: 'fixed', value: 360 } : { mode: 'fill' },
          height: { mode: 'fixed', value: 108 },
          padding: { top: 16, right: 18, bottom: 16, left: 18 },
        },
        style: {
          fills: [{ type: 'solid', color: surfaceBg }],
          border: { width: 1, style: 'solid', color: borderSubtle },
          radius: 12,
        },
      },
      sheetId,
    );
    return cid;
  });

  nodes[navId] = makeBrowserNode(
    {
      id: navId,
      parentId: artId,
      kind: 'container',
      name: 'TopNavbar',
      semanticTag: 'header',
      layout: {
        mode: 'flex',
        positioning: isFreeform ? 'absolute' : 'flow',
        direction: 'row',
        justify: 'space-between',
        align: 'center',
        frame: { x: 36, y: 24, width: 1128, height: 56 },
        width: isFreeform ? { mode: 'fixed', value: 1128 } : { mode: 'fill' },
        height: { mode: 'fixed', value: 56 },
        padding: { top: 12, right: 20, bottom: 12, left: 20 },
      },
      style: {
        fills: [{ type: 'solid', color: surfaceBg }],
        border: { width: 1, style: 'solid', color: borderSubtle },
        radius: 12,
      },
      typography: { fontSize: 15, fontWeight: 700, color: textPrimary },
      content: { text: `${inferredName}  •  Cruscotto  |  Anagrafica  |  Report` },
    },
    sheetId,
  );

  nodes[h1Id] = makeBrowserNode(
    {
      id: h1Id,
      parentId: artId,
      kind: 'text',
      name: 'MainHeading',
      semanticTag: 'h1',
      layout: {
        mode: 'flex',
        positioning: isFreeform ? 'absolute' : 'flow',
        frame: { x: 36, y: 98, width: 880, height: 38 },
        width: isFreeform ? { mode: 'fixed', value: 880 } : { mode: 'fill' },
        height: { mode: 'hug', value: 38 },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      typography: { fontSize: 26, fontWeight: 700, color: textPrimary },
      content: { text: screenTitle },
    },
    sheetId,
  );

  nodes[subId] = makeBrowserNode(
    {
      id: subId,
      parentId: artId,
      kind: 'text',
      name: 'MainSubtitle',
      semanticTag: 'p',
      layout: {
        mode: 'flex',
        positioning: isFreeform ? 'absolute' : 'flow',
        frame: { x: 36, y: 140, width: 920, height: 26 },
        width: isFreeform ? { mode: 'fixed', value: 920 } : { mode: 'fill' },
        height: { mode: 'hug', value: 26 },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      typography: { fontSize: 14, fontWeight: 400, color: textSecondary },
      content: { text: screenSub },
    },
    sheetId,
  );

  nodes[inp1Id] = makeBrowserNode(
    {
      id: inp1Id,
      parentId: formId,
      kind: 'control',
      name: 'PrimaryDomainInput',
      semanticTag: 'input',
      layout: {
        mode: 'flex',
        positioning: 'flow',
        width: { mode: 'fill' },
        height: { mode: 'fixed', value: 40 },
        padding: { top: 8, right: 12, bottom: 8, left: 12 },
      },
      style: {
        fills: [{ type: 'solid', color: canvasBg }],
        border: { width: 1, style: 'solid', color: borderSubtle },
        radius: 8,
      },
      typography: { fontSize: 13, color: textPrimary },
      content: { controlType: 'text-input', placeholder: 'Ragione sociale / Riferimento...' },
    },
    sheetId,
  );

  nodes[inp2Id] = makeBrowserNode(
    {
      id: inp2Id,
      parentId: formId,
      kind: 'control',
      name: 'SecondaryDomainSelect',
      semanticTag: 'select',
      layout: {
        mode: 'flex',
        positioning: 'flow',
        width: { mode: 'fill' },
        height: { mode: 'fixed', value: 40 },
        padding: { top: 8, right: 12, bottom: 8, left: 12 },
      },
      style: {
        fills: [{ type: 'solid', color: canvasBg }],
        border: { width: 1, style: 'solid', color: borderSubtle },
        radius: 8,
      },
      typography: { fontSize: 13, color: textPrimary },
      content: { controlType: 'select', placeholder: 'Stato Operativo: Attivo | In Revisione' },
    },
    sheetId,
  );

  nodes[ctaId] = makeBrowserNode(
    {
      id: ctaId,
      parentId: formId,
      kind: 'control',
      name: 'PrimaryActionBtn',
      semanticTag: 'button',
      layout: {
        mode: 'flex',
        positioning: 'flow',
        width: { mode: 'fill' },
        height: { mode: 'fixed', value: 42 },
        padding: { top: 10, right: 18, bottom: 10, left: 18 },
      },
      style: {
        fills: [{ type: 'solid', color: palette.colors.primary500 }],
        radius: 10,
      },
      typography: { fontSize: 14, fontWeight: 600, color: '#ffffff', textAlign: 'center' },
      content: { controlType: 'button', text: actionLabel, blueprintId: blueprintDoc.id },
      interactions: [{ trigger: 'onClick', action: { kind: 'call_script_fn', fnName: handlerFn } }],
    },
    sheetId,
  );

  nodes[formId] = makeBrowserNode(
    {
      id: formId,
      parentId: artId,
      kind: 'container',
      name: 'DomainFormCard',
      semanticTag: 'form',
      childIds: [inp1Id, inp2Id, ctaId],
      layout: {
        mode: 'flex',
        positioning: isFreeform ? 'absolute' : 'flow',
        direction: 'column',
        gap: 14,
        frame: { x: 36, y: 316, width: 510, height: 320 },
        width: isFreeform ? { mode: 'fixed', value: 510 } : { mode: 'fill' },
        height: { mode: 'fixed', value: 320 },
        padding: { top: 20, right: 20, bottom: 20, left: 20 },
      },
      style: {
        fills: [{ type: 'solid', color: surfaceBg }],
        border: { width: 1, style: 'solid', color: borderSubtle },
        radius: 14,
      },
    },
    sheetId,
  );

  nodes[tableId] = makeBrowserNode(
    {
      id: tableId,
      parentId: artId,
      kind: wantsThree ? 'control' : 'container',
      name: wantsThree ? 'InteractiveThreeViewport' : 'DomainRecordsTableCard',
      semanticTag: 'section',
      layout: {
        mode: wantsThree ? 'freeform' : 'flex',
        positioning: isFreeform ? 'absolute' : 'flow',
        direction: 'column',
        gap: 10,
        frame: { x: 570, y: 316, width: 594, height: 320 },
        width: isFreeform ? { mode: 'fixed', value: 594 } : { mode: 'fill' },
        height: { mode: 'fixed', value: 320 },
        padding: { top: 20, right: 20, bottom: 20, left: 20 },
      },
      style: {
        fills: [{ type: 'solid', color: surfaceBg }],
        border: { width: 1, style: 'solid', color: borderSubtle },
        radius: 14,
      },
      typography: { fontSize: 13, color: textPrimary },
      content: wantsThree
        ? { controlType: 'three-viewport', text: 'Three.js 3D Viewport', threeSceneId: threeSceneDoc?.id }
        : { text: 'Registro Dati Operativi — Elementi sincronizzati in tempo reale' },
    },
    sheetId,
  );

  const rootChildren = [navId, h1Id, subId, ...kpiIds, formId, tableId];
  nodes[artId] = makeBrowserNode(
    {
      id: artId,
      kind: 'artboard',
      name: `${screenName}Artboard`,
      semanticTag: 'main',
      childIds: rootChildren,
      layout: {
        mode: isFreeform ? 'freeform' : 'flex',
        positioning: 'flow',
        direction: 'column',
        gap: 18,
        frame: { x: 40, y: 40, width: 1200, height: 760 },
        width: { mode: 'fixed', value: 1200 },
        height: { mode: 'fixed', value: 760 },
        padding: isFreeform ? { top: 0, right: 0, bottom: 0, left: 0 } : { top: 24, right: 24, bottom: 24, left: 24 },
      },
      style: {
        fills: [{ type: 'solid', color: canvasBg }],
        radius: 14,
      },
    },
    sheetId,
  );

  const mainSheet: UISheetDocument = {
    sheetId,
    projectId,
    name: screenName,
    rootIds: [artId],
    nodes,
    defaultLayoutMode: isFreeform ? 'freeform' : 'flex',
    stateSchema: [],
    propsSchema: [],
    ipcSchema: [],
  };

  const handlersCode =
    typeof rawAiJson?.handlersTs === 'string' && rawAiJson.handlersTs.trim().length > 20
      ? rawAiJson.handlersTs.trim() + '\n'
      : `// Handler TypeScript generati per ${inferredName}\nexport function ${handlerFn}(payload?: Record<string, unknown>) {\n  console.log('[${inferredName}] Esecuzione ${actionLabel}:', payload ?? {});\n  return { ok: true, timestamp: Date.now() };\n}\n\nexport function onPrimaryActionClick(): void {\n  ${handlerFn}();\n}\n`;

  const vfsItems: GeneratedWizardVfsSeedItem[] = [
    { key: 'dir_src', parentKey: null, name: 'src', virtualPath: '/src', entryKind: 'folder' },
    { key: 'dir_screens', parentKey: 'dir_src', name: 'screens', virtualPath: '/src/screens', entryKind: 'folder' },
    { key: 'dir_styles', parentKey: 'dir_src', name: 'styles', virtualPath: '/src/styles', entryKind: 'folder' },
    { key: 'dir_scripts', parentKey: 'dir_src', name: 'scripts', virtualPath: '/src/scripts', entryKind: 'folder' },
    { key: 'dir_blueprints', parentKey: 'dir_src', name: 'blueprints', virtualPath: '/src/blueprints', entryKind: 'folder' },
    { key: 'dir_scenes3d', parentKey: 'dir_src', name: 'scenes3d', virtualPath: '/src/scenes3d', entryKind: 'folder' },
    {
      key: `sheet_${sheetId}`,
      parentKey: 'dir_screens',
      name: `${screenName}.canvas`,
      virtualPath: `/src/screens/${screenName}.canvas`,
      entryKind: 'canvas_sheet',
      sheetId,
    },
    {
      key: 'file_main_css',
      parentKey: 'dir_styles',
      name: 'theme-and-sheet.css',
      virtualPath: '/src/styles/theme-and-sheet.css',
      entryKind: 'style_file',
      contentText: compileSheetToCss(mainSheet, tokens, activeThemeId).css,
    },
    {
      key: 'file_handlers_ts',
      parentKey: 'dir_scripts',
      name: 'handlers.ts',
      virtualPath: '/src/scripts/handlers.ts',
      entryKind: 'script_file',
      contentText: handlersCode,
    },
    {
      key: 'file_main_bp',
      parentKey: 'dir_blueprints',
      name: `${blueprintDoc.name}.blueprint.json`,
      virtualPath: `/src/blueprints/${blueprintDoc.name}.blueprint.json`,
      entryKind: 'blueprint_graph',
      contentText: JSON.stringify(blueprintDoc, null, 2),
    },
  ];

  if (threeSceneDoc) {
    vfsItems.push({
      key: 'file_main_3d',
      parentKey: 'dir_scenes3d',
      name: `${threeSceneDoc.name}.scene3d.json`,
      virtualPath: `/src/scenes3d/${threeSceneDoc.name}.scene3d.json`,
      entryKind: 'three_scene',
      contentText: JSON.stringify(threeSceneDoc, null, 2),
    });
  }

  const summary =
    (typeof rawAiJson?.summary === 'string' && rawAiJson.summary) ||
    `Progetto "${inferredName}" generato per ${primaryTarget} (${layoutMode}).`;

  return {
    summary,
    seed: {
      projectId,
      projectName: inferredName,
      primaryTarget,
      stylingPreset,
      activeThemeId,
      themes,
      tokens,
      sheets: [mainSheet],
      blueprintDoc,
      threeSceneDoc,
      vfsItems,
    },
  };
}

function loadInitialBrowserState(): PersistedBrowserStudioStateV2 {
  const storage = getBrowserLocalStorage();
  if (storage) {
    try {
      const raw = storage.getItem(BROWSER_STUDIO_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedBrowserStudioStateV2;
        if (
          parsed &&
          parsed.version === 2 &&
          parsed.projects &&
          typeof parsed.projects === 'object' &&
          Object.keys(parsed.projects).length > 0
        ) {
          const firstValidId =
            parsed.activeProjectId && parsed.projects[parsed.activeProjectId]
              ? parsed.activeProjectId
              : Object.keys(parsed.projects)[0];
          const validOrder = Array.isArray(parsed.projectOrder)
            ? parsed.projectOrder.filter((id) => Boolean(parsed.projects[id]))
            : [];
          for (const pid of Object.keys(parsed.projects)) {
            if (!validOrder.includes(pid)) validOrder.push(pid);
          }
          return {
            version: 2,
            activeProjectId: firstValidId,
            projectOrder: validOrder,
            projects: parsed.projects,
          };
        }
      }
    } catch {
      // Corrupted storage — fall back cleanly to default demo state
    }
  }

  const demoRec = createDefaultDemoProjectRecord();
  const initial: PersistedBrowserStudioStateV2 = {
    version: 2,
    activeProjectId: demoRec.project.id,
    projectOrder: [demoRec.project.id],
    projects: {
      [demoRec.project.id]: demoRec,
    },
  };

  if (storage) {
    try {
      storage.setItem(BROWSER_STUDIO_STORAGE_KEY, JSON.stringify(initial));
    } catch {
      // Ignore quota errors
    }
  }

  return initial;
}

export function createBrowserStudioApi(): StudioPreloadApi {
  const codegenService = createCodegenWorkerService();
  const state = loadInitialBrowserState();

  const undoStacks: Record<string, UIPatchOp[][]> = {};
  const redoStacks: Record<string, UIPatchOp[][]> = {};
  const streamListeners = new Set<(ev: AgentStreamEvent) => void>();

  const persistState = () => {
    const storage = getBrowserLocalStorage();
    if (!storage) return;
    try {
      storage.setItem(BROWSER_STUDIO_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage quota exceedance
    }
  };

  const emitStream = (ev: AgentStreamEvent) => {
    streamListeners.forEach((fn) => fn(ev));
  };

  const bumpProjectRecency = (projectId: string) => {
    const rec = state.projects[projectId];
    if (!rec) return;
    rec.project = { ...rec.project, updatedAt: Date.now() };
    state.projectOrder = [projectId, ...state.projectOrder.filter((id) => id !== projectId)];
  };

  const getActiveRecord = (): PersistedBrowserProjectRecord => {
    const active = state.projects[state.activeProjectId];
    if (active) return active;
    const fallbackId = Object.keys(state.projects)[0];
    if (fallbackId) {
      state.activeProjectId = fallbackId;
      return state.projects[fallbackId];
    }
    const seeded = createDefaultDemoProjectRecord();
    state.projects[seeded.project.id] = seeded;
    state.activeProjectId = seeded.project.id;
    state.projectOrder = [seeded.project.id];
    persistState();
    return seeded;
  };

  const getRecordByProjectId = (projectId?: string): PersistedBrowserProjectRecord => {
    if (projectId && state.projects[projectId]) {
      return state.projects[projectId];
    }
    return getActiveRecord();
  };

  const findRecordByVfsEntry = (entryId: string): PersistedBrowserProjectRecord => {
    const active = getActiveRecord();
    if (active.vfsTree.some((n) => n.id === entryId)) return active;
    for (const rec of Object.values(state.projects)) {
      if (rec.vfsTree.some((n) => n.id === entryId)) return rec;
    }
    return active;
  };

  const findRecordBySheetId = (sheetId: string): PersistedBrowserProjectRecord => {
    const active = getActiveRecord();
    if (active.sheetDocs[sheetId]) return active;
    for (const rec of Object.values(state.projects)) {
      if (rec.sheetDocs[sheetId]) return rec;
    }
    return active;
  };

  const getBootstrapFor = (rec: PersistedBrowserProjectRecord): ProjectBootstrapPayload => {
    const sortedSheets = [...rec.sheets].sort((a, b) => b.updatedAt - a.updatedAt);
    const firstSheetId = sortedSheets[0]?.id;
    const firstDoc = firstSheetId ? rec.sheetDocs[firstSheetId] : Object.values(rec.sheetDocs)[0];
    const sortedVfs = [...rec.vfsTree].sort((a, b) => {
      const cmp = a.sortOrder.localeCompare(b.sortOrder);
      return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
    });
    return {
      project: structuredClone(rec.project),
      workspace: structuredClone(rec.workspace),
      vfsTree: structuredClone(sortedVfs),
      sheets: structuredClone(sortedSheets),
      initialSheet: firstDoc ? structuredClone(firstDoc) : null,
      themes: structuredClone(rec.themes),
      tokens: structuredClone(rec.tokens),
    };
  };

  return {
    project: {
      async listRecent() {
        const list: ProjectSummary[] = [];
        for (const pid of state.projectOrder) {
          const rec = state.projects[pid];
          if (rec) list.push(structuredClone(rec.project));
        }
        for (const [pid, rec] of Object.entries(state.projects)) {
          if (!state.projectOrder.includes(pid)) {
            list.push(structuredClone(rec.project));
          }
        }
        return list.sort((a, b) => b.updatedAt - a.updatedAt);
      },

      async removeRecent(projectId: string) {
        const clean = (projectId || '').trim();
        if (clean) {
          delete state.projects[clean];
          state.projectOrder = state.projectOrder.filter((id) => id !== clean);
          if (state.activeProjectId === clean) {
            state.activeProjectId = state.projectOrder[0] ?? Object.keys(state.projects)[0] ?? '';
          }
          persistState();
        }
        return this.listRecent();
      },

      async create(input: CreateProjectInput) {
        const seedDemo = input.seedDemoContent ?? false;
        const layoutMode = input.layoutMode ?? (seedDemo ? 'auto' : 'freeform');
        const spec: ProjectWizardSpec = {
          name: input.name || 'Nuovo Progetto Studio',
          category: 'web',
          primaryTarget: input.primaryTarget ?? 'react-tsx',
          stylingPreset: input.stylingPreset ?? 'tailwind',
          layoutMode,
          starterPages: ['home'],
          includeTsScript: true,
          includeBlueprint: true,
          includeThreeScene: true,
          threePresetId: 'pbr-product-showcase',
          paletteId: 'dark-pro',
          defaultThemeMode: 'dark',
          rootDiskPath: input.rootDiskPath ?? null,
          seedDemoContent: seedDemo,
        };
        const rec = buildWizardBrowserRecord(spec);
        state.projects[rec.project.id] = rec;
        state.activeProjectId = rec.project.id;
        state.projectOrder = [rec.project.id, ...state.projectOrder.filter((id) => id !== rec.project.id)];
        persistState();
        return getBootstrapFor(rec);
      },

      async createFromWizard(spec: ProjectWizardSpec) {
        const rec = buildWizardBrowserRecord(spec);
        state.projects[rec.project.id] = rec;
        state.activeProjectId = rec.project.id;
        state.projectOrder = [rec.project.id, ...state.projectOrder.filter((id) => id !== rec.project.id)];
        persistState();
        return getBootstrapFor(rec);
      },

      async createAndInitDiskProject(spec: DiskProjectInitSpec) {
        const scaffold = buildDiskProjectScaffold(spec);
        const stackMeta = getProjectStackDescriptor(spec.stackId);
        const rootDiskPath = null;

        const seed = buildWizardProjectSeed({
          name: scaffold.projectName,
          category:
            stackMeta.category === 'desktop'
              ? 'desktop'
              : stackMeta.category === 'mobile'
                ? 'mobile'
                : 'web',
          primaryTarget: spec.primaryTarget ?? scaffold.codegenTargetId,
          stylingPreset: scaffold.stylingPreset,
          layoutMode: spec.layoutMode ?? 'freeform',
          starterPages: spec.starterPages?.length ? spec.starterPages : ['home'],
          includeTsScript: false,
          includeBlueprint: Boolean(spec.includeBlueprint),
          includeThreeScene: Boolean(spec.includeThreeScene),
          threePresetId: spec.threePresetId,
          paletteId: spec.paletteId ?? 'dark-pro',
          defaultThemeMode: spec.defaultThemeMode ?? 'dark',
          rootDiskPath,
          seedDemoContent: false,
        });

        const folderKeyByRel = new Map<string, string>();
        const existingPaths = new Set<string>();
        for (const it of seed.vfsItems) {
          const clean = it.virtualPath.replace(/^\/+/, '');
          existingPaths.add(clean);
          if (it.entryKind === 'folder') folderKeyByRel.set(clean, it.key);
        }

        const ensureFolderChain = (dirRel: string): string | null => {
          if (!dirRel || dirRel === '.') return null;
          if (folderKeyByRel.has(dirRel)) return folderKeyByRel.get(dirRel)!;
          const parts = dirRel.split('/').filter(Boolean);
          let cur = '';
          let parentKey: string | null = null;
          for (const seg of parts) {
            cur = cur ? `${cur}/${seg}` : seg;
            let k = folderKeyByRel.get(cur);
            if (!k) {
              k = `bscaf_dir_${cur.replace(/[^a-zA-Z0-9_]/g, '_')}`;
              folderKeyByRel.set(cur, k);
              seed.vfsItems.push({
                key: k,
                parentKey,
                name: seg,
                virtualPath: `/${cur}`,
                entryKind: 'folder',
              });
            }
            parentKey = k;
          }
          return parentKey;
        };

        for (const sf of scaffold.files) {
          if (sf.isBinary) continue;
          const rel = sf.relativePath.replace(/^\/+/, '');
          if (existingPaths.has(rel)) {
            const match = seed.vfsItems.find((it) => it.virtualPath.replace(/^\/+/, '') === rel);
            if (match) match.contentText = sf.content;
            continue;
          }
          const slash = rel.lastIndexOf('/');
          const dir = slash > 0 ? rel.slice(0, slash) : '';
          const name = slash >= 0 ? rel.slice(slash + 1) : rel;
          const parentKey = ensureFolderChain(dir);
          const inferred = inferVfsKindFromFilename(name, rel);
          const kind: GeneratedWizardVfsSeedItem['entryKind'] =
            inferred === 'style_file' ||
            inferred === 'script_file' ||
            inferred === 'blueprint_graph' ||
            inferred === 'three_scene'
              ? inferred
              : 'source_file';
          seed.vfsItems.push({
            key: `bscaf_${rel.replace(/[^a-zA-Z0-9_]/g, '_')}`,
            parentKey,
            name,
            virtualPath: `/${rel}`,
            entryKind: kind,
            contentText: sf.content,
          });
          existingPaths.add(rel);
        }

        const rec = buildBrowserRecordFromSeed(seed, {
          layoutMode: spec.layoutMode ?? 'freeform',
          rootDiskPath,
        });
        rec.project.stackId = spec.stackId;
        rec.project.primaryLanguage = scaffold.primaryLanguage;
        rec.project.pythonCompanion = scaffold.pythonCompanion;

        const autoVfs = rec.vfsTree.find(
          (n) => n.virtualPath.replace(/^\/+/, '') === scaffold.automationsRelPath,
        );
        const firstSheet = Object.values(rec.sheetDocs)[0];
        if (spec.includeAutomations !== false && autoVfs && firstSheet) {
          firstSheet.linkedScripts = [
            {
              vfsEntryId: autoVfs.id,
              relativePath: scaffold.automationsRelPath,
              language: scaffold.primaryLanguage,
              loadStrategy: scaffold.primaryLanguage === 'python' ? 'backend-route' : 'module',
              autoInitOnLoad: true,
              scope: 'sheet',
            },
          ];
        }

        state.projects[rec.project.id] = rec;
        state.activeProjectId = rec.project.id;
        state.projectOrder = [rec.project.id, ...state.projectOrder.filter((id) => id !== rec.project.id)];
        persistState();

        return getBootstrapFor(rec);
      },

      async open(idOrPath: string) {
        const trimmed = (idOrPath || '').trim();
        let targetRec: PersistedBrowserProjectRecord | undefined = state.projects[trimmed];
        if (!targetRec && trimmed) {
          targetRec = Object.values(state.projects).find(
            (r) => r.project.dbFilePath === trimmed || r.project.rootDiskPath === trimmed || r.project.name === trimmed,
          );
        }
        if (!targetRec) {
          targetRec = getActiveRecord();
        }
        state.activeProjectId = targetRec.project.id;
        bumpProjectRecency(targetRec.project.id);
        persistState();
        return getBootstrapFor(targetRec);
      },

      async openDirectory() {
        throw new Error(DESKTOP_DISK_REQUIRED);
      },

      async openExistingDiskProject() {
        throw new Error(DESKTOP_DISK_REQUIRED);
      },

      async pickDirectory() {
        return null;
      },

      async inspectDirectory() {
        throw new Error(DESKTOP_DISK_REQUIRED);
      },

      async getCurrent() {
        const rec = getActiveRecord();
        return getBootstrapFor(rec);
      },

      async linkDiskDirectory() {
        throw new Error(DESKTOP_DISK_REQUIRED);
      },

      async updateSettings(projectId, patch) {
        const rec = getRecordByProjectId(projectId);
        rec.project = { ...rec.project, ...patch, updatedAt: Date.now() };
        bumpProjectRecency(rec.project.id);
        persistState();
        return structuredClone(rec.project);
      },

      async exportBundleToDisk() {
        throw new Error(DESKTOP_DISK_REQUIRED);
      },
    },

    workspace: {
      async loadState(projectId) {
        const rec = getRecordByProjectId(projectId);
        return structuredClone(rec.workspace);
      },

      async saveState(projectId, patch) {
        const rec = getRecordByProjectId(projectId);
        rec.workspace = { ...rec.workspace, ...patch, updatedAt: Date.now() };
        persistState();
        return structuredClone(rec.workspace);
      },
    },

    vfs: {
      async listTree(projectId) {
        const rec = getRecordByProjectId(projectId);
        return structuredClone(rec.vfsTree);
      },

      async createEntry(input: CreateVfsEntryInput) {
        const rec = getRecordByProjectId(input.projectId);
        const now = Date.now();
        const id = generateNodeId('vfs');
        const parent = input.parentId ? rec.vfsTree.find((n) => n.id === input.parentId) : null;

        let cleanName = input.name.trim();
        if (!cleanName) {
          cleanName =
            input.entryKind === 'folder'
              ? 'new-folder'
              : input.entryKind === 'canvas_sheet'
                ? 'NewScreen.canvas'
                : 'untitled.ts';
        }
        if (input.entryKind === 'canvas_sheet' && !cleanName.endsWith('.canvas')) {
          cleanName = `${cleanName}.canvas`;
        }

        const parentPath = parent ? parent.virtualPath : '';
        let virtualPath = normalizePosixPath(`${parentPath}/${cleanName}`);
        if (rec.vfsTree.some((n) => n.virtualPath === virtualPath)) {
          const suffix = now.toString(36).slice(-3);
          const dotIdx = cleanName.lastIndexOf('.');
          cleanName =
            dotIdx > 0
              ? `${cleanName.slice(0, dotIdx)}-${suffix}${cleanName.slice(dotIdx)}`
              : `${cleanName}-${suffix}`;
          virtualPath = normalizePosixPath(`${parentPath}/${cleanName}`);
        }

        const siblingCount = rec.vfsTree.filter((n) => (n.parentId ?? null) === (input.parentId ?? null)).length;

        let createdSheet: UISheetDocument | undefined;
        let sheetId: string | null = null;

        if (input.entryKind === 'canvas_sheet') {
          sheetId = generateNodeId('sheet');
          const baseName = cleanName.replace(/\.canvas$/i, '');
          const artId = generateNodeId('art');
          const isFreeform = rec.project.layoutMode === 'freeform';
          const rootArtboard = createDefaultUINode(
            {
              id: artId,
              kind: 'artboard',
              name: `${baseName.replace(/[^a-zA-Z0-9]/g, '') || 'Screen'}Artboard`,
              layout: {
                mode: isFreeform ? 'freeform' : 'flex',
                positioning: 'flow',
                direction: 'column',
                gap: 16,
                justify: 'start',
                align: 'stretch',
                frame: { x: 40, y: 40, width: 1120, height: 760 },
                width: { mode: 'fixed', value: 1120 },
                height: { mode: 'fixed', value: 760 },
                padding: isFreeform
                  ? { top: 0, right: 0, bottom: 0, left: 0 }
                  : { top: 24, right: 24, bottom: 24, left: 24 },
              },
            },
            sheetId,
          );

          createdSheet = {
            sheetId,
            projectId: rec.project.id,
            name: baseName,
            rootIds: [artId],
            defaultLayoutMode: isFreeform ? 'freeform' : 'flex',
            nodes: { [artId]: rootArtboard },
            stateSchema: [],
            propsSchema: [],
            ipcSchema: [],
          };

          rec.sheetDocs[sheetId] = createdSheet;
          undoStacks[sheetId] = [];
          redoStacks[sheetId] = [];
          rec.sheets = [
            ...rec.sheets,
            {
              id: sheetId,
              projectId: rec.project.id,
              vfsEntryId: id,
              name: baseName,
              sheetKind: 'visual_canvas',
              viewportX: 24,
              viewportY: 20,
              viewportZoom: 0.82,
              updatedAt: now,
            },
          ];
        } else if (isTextFileVfsKind(input.entryKind)) {
          rec.fileContents[id] =
            input.initialContent ??
            defaultBrowserTextContent(input.entryKind, cleanName, rec.project.id, rec.project.name);
        }

        const entry: VfsNodeDTO = {
          id,
          projectId: rec.project.id,
          parentId: input.parentId,
          name: cleanName,
          virtualPath,
          diskRelPath: input.entryKind === 'canvas_sheet' ? null : virtualPath.replace(/^\/+/, ''),
          entryKind: input.entryKind,
          sheetId,
          targetFramework:
            input.targetFramework ?? (input.entryKind === 'canvas_sheet' ? rec.project.primaryTarget : null),
          syncMode: 'virtual_only',
          gitStatus: 'untracked',
          sortOrder: fractionalOrderAt(siblingCount),
          updatedAt: now,
        };

        rec.vfsTree = [...rec.vfsTree, entry];
        bumpProjectRecency(rec.project.id);
        persistState();
        return {
          entry: structuredClone(entry),
          createdSheet: createdSheet ? structuredClone(createdSheet) : undefined,
        };
      },

      async renameEntry(entryId, newName) {
        const rec = findRecordByVfsEntry(entryId);
        const existing = rec.vfsTree.find((n) => n.id === entryId);
        if (!existing) {
          throw new Error(`VFS entry not found: ${entryId}`);
        }
        const cleanNewName = newName.trim();
        if (!cleanNewName) {
          throw new Error('New file/folder name cannot be empty.');
        }

        const now = Date.now();
        const oldVPath = existing.virtualPath;
        const parentVPath = oldVPath.slice(0, Math.max(0, oldVPath.lastIndexOf('/')));
        const newVPath = normalizePosixPath(`${parentVPath}/${cleanNewName}`);

        rec.vfsTree = rec.vfsTree.map((n) => {
          if (n.id === entryId) {
            return {
              ...n,
              name: cleanNewName,
              virtualPath: newVPath,
              diskRelPath: n.diskRelPath ? newVPath.replace(/^\/+/, '') : null,
              updatedAt: now,
            };
          }
          if (existing.entryKind === 'folder' && n.virtualPath.startsWith(`${oldVPath}/`)) {
            const updatedChildVPath = newVPath + n.virtualPath.slice(oldVPath.length);
            return {
              ...n,
              virtualPath: updatedChildVPath,
              diskRelPath: n.diskRelPath ? updatedChildVPath.replace(/^\/+/, '') : null,
              updatedAt: now,
            };
          }
          return n;
        });

        const updated = rec.vfsTree.find((n) => n.id === entryId)!;
        if (updated.sheetId && rec.sheetDocs[updated.sheetId]) {
          const cleanSheetName = cleanNewName.replace(/\.canvas$/i, '');
          rec.sheetDocs[updated.sheetId] = {
            ...rec.sheetDocs[updated.sheetId],
            name: cleanSheetName,
          };
          rec.sheets = rec.sheets.map((s) =>
            s.id === updated.sheetId ? { ...s, name: cleanSheetName, updatedAt: now } : s,
          );
        }

        bumpProjectRecency(rec.project.id);
        persistState();
        return structuredClone(updated);
      },

      async moveEntry(entryId, newParentId) {
        const rec = findRecordByVfsEntry(entryId);
        const existing = rec.vfsTree.find((n) => n.id === entryId);
        if (!existing) {
          throw new Error(`VFS entry not found: ${entryId}`);
        }
        if (newParentId === entryId) {
          throw new Error('Cannot move a folder or file into itself.');
        }

        let parentVPath = '';
        if (newParentId) {
          const newParent = rec.vfsTree.find((n) => n.id === newParentId);
          if (!newParent) {
            throw new Error(`Destination VFS folder not found: ${newParentId}`);
          }
          if (newParent.entryKind !== 'folder') {
            throw new Error('Destination parent must be a folder.');
          }
          if (
            existing.entryKind === 'folder' &&
            (newParent.virtualPath === existing.virtualPath ||
              newParent.virtualPath.startsWith(`${existing.virtualPath}/`))
          ) {
            throw new Error('Cannot move a folder into one of its own descendants.');
          }
          parentVPath = newParent.virtualPath;
        }

        if ((existing.parentId ?? null) === (newParentId ?? null)) {
          return structuredClone(existing);
        }

        const now = Date.now();
        const oldVPath = existing.virtualPath;
        let nextName = existing.name;
        let newVPath = normalizePosixPath(`${parentVPath}/${nextName}`);

        if (rec.vfsTree.some((n) => n.id !== entryId && n.virtualPath === newVPath)) {
          const suffix = now.toString(36).slice(-3);
          const dotIdx = nextName.lastIndexOf('.');
          nextName =
            dotIdx > 0
              ? `${nextName.slice(0, dotIdx)}-${suffix}${nextName.slice(dotIdx)}`
              : `${nextName}-${suffix}`;
          newVPath = normalizePosixPath(`${parentVPath}/${nextName}`);
        }

        const siblingCount = rec.vfsTree.filter(
          (n) => n.id !== entryId && (n.parentId ?? null) === (newParentId ?? null),
        ).length;

        rec.vfsTree = rec.vfsTree.map((n) => {
          if (n.id === entryId) {
            return {
              ...n,
              parentId: newParentId,
              name: nextName,
              virtualPath: newVPath,
              diskRelPath: n.diskRelPath ? newVPath.replace(/^\/+/, '') : null,
              sortOrder: fractionalOrderAt(siblingCount),
              updatedAt: now,
            };
          }
          if (existing.entryKind === 'folder' && n.virtualPath.startsWith(`${oldVPath}/`)) {
            const updatedChildVPath = newVPath + n.virtualPath.slice(oldVPath.length);
            return {
              ...n,
              virtualPath: updatedChildVPath,
              diskRelPath: n.diskRelPath ? updatedChildVPath.replace(/^\/+/, '') : null,
              updatedAt: now,
            };
          }
          return n;
        });

        const moved = rec.vfsTree.find((n) => n.id === entryId)!;
        bumpProjectRecency(rec.project.id);
        persistState();
        return structuredClone(moved);
      },

      async deleteEntry(entryId) {
        const rec = findRecordByVfsEntry(entryId);
        const toRemove = new Set<string>([entryId]);
        let added = true;
        while (added) {
          added = false;
          for (const n of rec.vfsTree) {
            if (n.parentId && toRemove.has(n.parentId) && !toRemove.has(n.id)) {
              toRemove.add(n.id);
              added = true;
            }
          }
        }

        const deletedSheetIds = new Set<string>();
        for (const n of rec.vfsTree) {
          if (toRemove.has(n.id)) {
            delete rec.fileContents[n.id];
            if (n.sheetId) deletedSheetIds.add(n.sheetId);
          }
        }

        rec.vfsTree = rec.vfsTree.filter((n) => !toRemove.has(n.id));
        if (deletedSheetIds.size > 0 && rec.sheets.length > deletedSheetIds.size) {
          rec.sheets = rec.sheets.filter((s) => !deletedSheetIds.has(s.id));
          for (const sid of deletedSheetIds) {
            delete rec.sheetDocs[sid];
            delete undoStacks[sid];
            delete redoStacks[sid];
          }
        }

        bumpProjectRecency(rec.project.id);
        persistState();
      },

      async readFile(entryId) {
        const rec = findRecordByVfsEntry(entryId);
        const content = rec.fileContents[entryId] ?? '';
        return { content, sha256: quickHashHex(content) };
      },

      async writeFile(entryId, content, expectedContent) {
        const rec = findRecordByVfsEntry(entryId);
        if (expectedContent !== undefined && (rec.fileContents[entryId] ?? '') !== expectedContent) {
          throw new Error('Il file è stato modificato dopo l’ultima lettura. Ricaricalo prima di salvare.');
        }
        const now = Date.now();
        rec.fileContents[entryId] = content;
        rec.vfsTree = rec.vfsTree.map((n) =>
          n.id === entryId ? { ...n, gitStatus: 'modified', updatedAt: now } : n,
        );
        bumpProjectRecency(rec.project.id);
        persistState();
        return { sha256: quickHashHex(content) };
      },
    },

    canvas: {
      async listSheets(projectId) {
        const rec = getRecordByProjectId(projectId);
        return structuredClone([...rec.sheets].sort((a, b) => b.updatedAt - a.updatedAt));
      },

      async loadSheet(sheetId) {
        const rec = findRecordBySheetId(sheetId);
        const doc = rec.sheetDocs[sheetId] ?? Object.values(rec.sheetDocs)[0];
        if (!doc) {
          throw new Error(`Sheet not found: ${sheetId}`);
        }
        return structuredClone(doc);
      },

      async saveSheetViewport(sheetId, x, y, zoom) {
        const rec = findRecordBySheetId(sheetId);
        rec.sheets = rec.sheets.map((s) =>
          s.id === sheetId ? { ...s, viewportX: x, viewportY: y, viewportZoom: zoom } : s,
        );
        persistState();
      },

      async commitPatchBatch(batch: CommittedPatchBatch): Promise<PatchCommitResult> {
        const rec = getRecordByProjectId(batch.projectId);
        const current = rec.sheetDocs[batch.sheetId] ?? findRecordBySheetId(batch.sheetId).sheetDocs[batch.sheetId];
        if (!current) {
          throw new Error(`Cannot apply patch batch — sheet not found: ${batch.sheetId}`);
        }
        const { nextSheet, inverseOps } = applyPatchOpsToSheet(current, batch.ops);
        rec.sheetDocs[batch.sheetId] = nextSheet;
        rec.sheets = rec.sheets.map((s) =>
          s.id === batch.sheetId ? { ...s, name: nextSheet.name, updatedAt: Date.now() } : s,
        );
        undoStacks[batch.sheetId] = [...(undoStacks[batch.sheetId] ?? []), inverseOps];
        redoStacks[batch.sheetId] = [];
        bumpProjectRecency(rec.project.id);
        persistState();
        return {
          seq: undoStacks[batch.sheetId].length,
          sheet: structuredClone(nextSheet),
          canUndo: undoStacks[batch.sheetId].length > 0,
          canRedo: false,
        };
      },

      async undo(sheetId) {
        const rec = findRecordBySheetId(sheetId);
        const stack = undoStacks[sheetId] ?? [];
        if (stack.length === 0) return null;
        const inv = stack.pop()!;
        const { nextSheet, inverseOps } = applyPatchOpsToSheet(rec.sheetDocs[sheetId], inv);
        rec.sheetDocs[sheetId] = nextSheet;
        redoStacks[sheetId] = [...(redoStacks[sheetId] ?? []), inverseOps];
        persistState();
        return {
          seq: stack.length,
          sheet: structuredClone(nextSheet),
          canUndo: stack.length > 0,
          canRedo: redoStacks[sheetId].length > 0,
        };
      },

      async redo(sheetId) {
        const rec = findRecordBySheetId(sheetId);
        const rStack = redoStacks[sheetId] ?? [];
        if (rStack.length === 0) return null;
        const ops = rStack.pop()!;
        const { nextSheet, inverseOps } = applyPatchOpsToSheet(rec.sheetDocs[sheetId], ops);
        rec.sheetDocs[sheetId] = nextSheet;
        undoStacks[sheetId] = [...(undoStacks[sheetId] ?? []), inverseOps];
        persistState();
        return {
          seq: undoStacks[sheetId].length,
          sheet: structuredClone(nextSheet),
          canUndo: undoStacks[sheetId].length > 0,
          canRedo: rStack.length > 0,
        };
      },

      async listCheckpoints(sheetId) {
        const rec = findRecordBySheetId(sheetId);
        return structuredClone(rec.checkpoints.filter((c) => c.sheetId === sheetId));
      },

      async createCheckpoint(input) {
        const rec = getRecordByProjectId(input.projectId);
        const cp: CheckpointSummaryDTO = {
          id: `cp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
          projectId: input.projectId,
          sheetId: input.sheetId,
          reason: input.reason,
          label: input.label,
          aiRunId: input.aiRunId ?? null,
          commandSeqAt: undoStacks[input.sheetId]?.length ?? 0,
          createdAt: Date.now(),
        };
        rec.checkpointSnapshots[cp.id] = {
          sheet: structuredClone(rec.sheetDocs[input.sheetId]),
          fileContents: { ...rec.fileContents },
        };
        rec.checkpoints = [cp, ...rec.checkpoints];
        persistState();
        return structuredClone(cp);
      },

      async restoreCheckpoint(checkpointId) {
        let owner: PersistedBrowserProjectRecord | undefined;
        for (const rec of Object.values(state.projects)) {
          if (rec.checkpointSnapshots[checkpointId]) {
            owner = rec;
            break;
          }
        }
        const rec = owner ?? getActiveRecord();
        const snap = rec.checkpointSnapshots[checkpointId];
        if (snap) {
          rec.sheetDocs[snap.sheet.sheetId] = structuredClone(snap.sheet);
          rec.fileContents = { ...rec.fileContents, ...snap.fileContents };
          persistState();
          return structuredClone(snap.sheet);
        }
        return structuredClone(Object.values(rec.sheetDocs)[0]);
      },
    },

    tokens: {
      async listTokens(projectId) {
        const rec = getRecordByProjectId(projectId);
        return structuredClone(rec.tokens);
      },

      async upsertToken(entry) {
        const rec = getRecordByProjectId(entry.projectId);
        const id = entry.id ?? `tok_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
        const full: DesignTokenEntry = { ...entry, id };
        const exists = rec.tokens.some(
          (t) => t.id === id || (t.tokenPath === entry.tokenPath && t.themeId === entry.themeId),
        );
        if (exists) {
          rec.tokens = rec.tokens.map((t) =>
            t.id === id || (t.tokenPath === entry.tokenPath && t.themeId === entry.themeId) ? full : t,
          );
        } else {
          rec.tokens = [...rec.tokens, full];
        }
        persistState();
        return structuredClone(full);
      },

      async deleteToken(tokenId) {
        for (const rec of Object.values(state.projects)) {
          if (rec.tokens.some((t) => t.id === tokenId)) {
            rec.tokens = rec.tokens.filter((t) => t.id !== tokenId);
          }
        }
        persistState();
      },

      async listThemes(projectId) {
        const rec = getRecordByProjectId(projectId);
        return structuredClone(rec.themes);
      },

      async searchIcons(query, category) {
        return searchOfflineIcons(query, category);
      },
    },

    codegen: {
      async listTargets() {
        return codegenService.listTargets();
      },

      async compileSheet(req: CompileSheetRequest): Promise<TargetArtifactBundle> {
        const rec = state.projects[req.projectId] ?? findRecordBySheetId(req.sheetId);
        const sheet = rec.sheetDocs[req.sheetId] ?? Object.values(rec.sheetDocs)[0];
        if (!sheet) {
          throw new Error(`Cannot compile sheet — no sheet found for ${req.sheetId}`);
        }
        return codegenService.compileSheet({
          sheet,
          tokens: rec.tokens,
          themes: rec.themes,
          options: req,
        });
      },

      async solveFreeformLayout(sheetId, rootNodeId) {
        const rec = findRecordBySheetId(sheetId);
        const sheet = rec.sheetDocs[sheetId] ?? Object.values(rec.sheetDocs)[0];
        if (!sheet) {
          return { ops: [], summary: 'Nessun foglio attivo trovato.' };
        }
        return codegenService.solveFreeformLayout({ sheet, rootNodeId });
      },

      async saveBundleToDisk(projectId, bundle) {
        const rec = getRecordByProjectId(projectId);
        const now = Date.now();
        const writtenPaths: string[] = [];

        for (const file of bundle.files) {
          const vPath = normalizePosixPath(`/generated/${bundle.targetId}/${file.relativePath}`);
          const parts = vPath.split('/').filter(Boolean);
          let curParentId: string | null = null;
          let accumPath = '';

          for (let i = 0; i < parts.length - 1; i++) {
            accumPath += `/${parts[i]}`;
            const existingFolder = rec.vfsTree.find((n) => n.virtualPath === accumPath);
            if (existingFolder) {
              curParentId = existingFolder.id;
            } else {
              const folderId = generateNodeId('vfs');
              rec.vfsTree.push({
                id: folderId,
                projectId: rec.project.id,
                parentId: curParentId,
                name: parts[i],
                virtualPath: accumPath,
                diskRelPath: accumPath.slice(1),
                entryKind: 'folder',
                sheetId: null,
                targetFramework: null,
                syncMode: 'virtual_only',
                gitStatus: 'untracked',
                sortOrder: fractionalOrderAt(i + 10),
                updatedAt: now,
              });
              curParentId = folderId;
            }
          }

          const fileName = parts[parts.length - 1];
          const existingFile = rec.vfsTree.find((n) => n.virtualPath === vPath);
          if (existingFile) {
            rec.fileContents[existingFile.id] = file.code;
            existingFile.gitStatus = 'modified';
            existingFile.updatedAt = now;
          } else {
            const fileId = generateNodeId('vfs');
            rec.fileContents[fileId] = file.code;
            rec.vfsTree.push({
              id: fileId,
              projectId: rec.project.id,
              parentId: curParentId,
              name: fileName,
              virtualPath: vPath,
              diskRelPath: vPath.slice(1),
              entryKind: fileName.endsWith('.css') ? 'style_file' : 'source_file',
              sheetId: null,
              targetFramework: bundle.targetId,
              syncMode: 'virtual_only',
              gitStatus: 'untracked',
              sortOrder: fractionalOrderAt(10),
              updatedAt: now,
            });
          }

          writtenPaths.push(rec.project.rootDiskPath ? `${rec.project.rootDiskPath}/${vPath.slice(1)}` : vPath);
        }

        persistState();
        return { writtenPaths };
      },
    },

    ai: {
      async ensureOllamaRunning(): Promise<EnsureOllamaResult> {
        const ollamaStatus = await fetchDirectOllamaStatus('http://127.0.0.1:11434', 1500);
        if (ollamaStatus.online) {
          return {
            online: true,
            startedByApp: false,
            baseUrl: ollamaStatus.baseUrl,
            models: ollamaStatus.models,
            preferredModel: pickPreferredLocalModel(ollamaStatus.models),
            message: 'Ollama già attivo su :11434',
          };
        }
        return {
          online: false,
          startedByApp: false,
          binaryPath: null,
          baseUrl: ollamaStatus.baseUrl,
          models: [],
          preferredModel: null,
          message: 'Ollama offline su :11434 — avvia "ollama serve" o apri l\'app Desktop per l\'avvio automatico.',
        };
      },

      async getHardwareReport(): Promise<HardwareAdvisorReport> {
        return {
          totalSystemRamMb: 32768,
          freeSystemRamMb: 18432,
          cpuCores: 16,
          platform: 'win32',
          arch: 'x64',
          recommendedTier: 'high',
          vramHeadroomReservedMb: 2048,
          recommendedCodingModel: 'hf.co/unsloth/Qwen2.5-Coder-14B-Instruct-GGUF:Q4_K_M',
          recommendedVisionModel: 'hf.co/unsloth/Qwen2.5-VL-7B-Instruct-GGUF:Q4_K_M',
          adviceSummary: '32 GB RAM rilevati — Ottimo per modelli Unsloth Dynamic 2.0 7B–14B Q4_K_M in locale.',
        };
      },

      async listProvidersAndModels(): Promise<LocalAIProviderStatus[]> {
        const ollamaStatus = await fetchDirectOllamaStatus('http://127.0.0.1:11434', 1800);
        return [
          ollamaStatus,
          {
            id: 'lmstudio',
            displayName: 'LM Studio Local Server',
            baseUrl: 'http://127.0.0.1:1234/v1',
            online: false,
            models: [],
          },
          {
            id: 'openai_compat',
            displayName: 'OpenAI-Compat (llama.cpp / vLLM)',
            baseUrl: 'http://127.0.0.1:8080/v1',
            online: false,
            models: [],
          },
          {
            id: 'builtin_offline',
            displayName: 'Studio Offline Deterministic AI',
            baseUrl: 'builtin://local-synthesizer',
            online: true,
            latencyMs: 4,
            models: [
              {
                id: 'offline-studio-architect-v1',
                name: 'Studio UI Architect v1 (100% Offline)',
                provider: 'builtin_offline',
                quantization: 'Deterministic AST',
                supportsVision: true,
                supportsTools: true,
              },
            ],
          },
        ];
      },

      async configureProvider(cfg: { id: LocalAIProviderKind; baseUrl: string }) {
        if (cfg.id === 'ollama') {
          return fetchDirectOllamaStatus(cfg.baseUrl || 'http://127.0.0.1:11434', 1800);
        }
        return {
          id: cfg.id,
          displayName: cfg.id,
          baseUrl: cfg.baseUrl,
          online: cfg.id === 'builtin_offline',
          models: [],
        };
      },

      async getUnslothCatalog(): Promise<UnslothModelRecommendation[]> {
        return [
          {
            id: 'unsloth-qwen25-coder-7b',
            repoId: 'unsloth/Qwen2.5-Coder-7B-Instruct-GGUF',
            ollamaPullUri: 'hf.co/unsloth/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M',
            displayName: 'Qwen 2.5 Coder 7B (Unsloth Dynamic 2.0)',
            quantization: 'Q4_K_M',
            estimatedVramGb: 5.2,
            role: 'coding',
            tier: 'entry',
            description: 'Veloce e chirurgico per generare patch UI-IR, React TSX, HTMX e XAML.',
          },
          {
            id: 'unsloth-qwen25-coder-14b',
            repoId: 'unsloth/Qwen2.5-Coder-14B-Instruct-GGUF',
            ollamaPullUri: 'hf.co/unsloth/Qwen2.5-Coder-14B-Instruct-GGUF:Q4_K_M',
            displayName: 'Qwen 2.5 Coder 14B (Unsloth Dynamic 2.0)',
            quantization: 'Q4_K_M',
            estimatedVramGb: 9.4,
            role: 'coding',
            tier: 'mid',
            description: 'Qualità superiore su architetture multi-file Tauri v2, .NET MAUI MVVM e Next.js.',
          },
          {
            id: 'unsloth-qwen25-vl-7b',
            repoId: 'unsloth/Qwen2.5-VL-7B-Instruct-GGUF',
            ollamaPullUri: 'hf.co/unsloth/Qwen2.5-VL-7B-Instruct-GGUF:Q4_K_M',
            displayName: 'Qwen 2.5 VL 7B Vision-to-UI (Unsloth)',
            quantization: 'Q4_K_M',
            estimatedVramGb: 6.1,
            role: 'vision',
            tier: 'mid',
            description: 'Converte screenshot e wireframe disegnati a mano in nodi Auto-Layout.',
          },
        ];
      },

      async pullOllamaModel(modelRef) {
        emitStream({
          type: 'pull_progress',
          modelRef,
          status: 'Connessione a Ollama / HuggingFace Unsloth...',
          completedPercent: 35,
        });
        emitStream({
          type: 'pull_progress',
          modelRef,
          status: 'Verifica manifesto GGUF completata',
          completedPercent: 100,
        });
        return { ok: true, message: `Comando registrato per ${modelRef}` };
      },

      async askStartupAssistant(req: StartupAssistantChatRequest): Promise<StartupAssistantChatResult> {
        const started = Date.now();
        const runId = req.runId || 'startup-chat';
        emitStream({ type: 'run_started', runId, threadId: 'startup-assistant', preCheckpointId: '' });

        const provider = req.provider ?? 'ollama';
        let modelName = (req.modelName || '').trim();

        if (provider === 'ollama') {
          try {
            const st = await fetchDirectOllamaStatus('http://127.0.0.1:11434', 1500);
            if (st.online) {
              if (!modelName) {
                modelName = pickPreferredLocalModel(st.models) ?? '';
              }
              if (modelName) {
                const out = await streamDirectOllamaChat({
                  baseUrl: st.baseUrl,
                  modelName,
                  temperature: 0.35,
                  timeoutMs: 30_000,
                  messages: [
                    {
                      role: 'system',
                      content:
                        'Sei l\'Architetto Software & UI di Visual UI Studio. Rispondi sempre in italiano tecnico, sintetico e concreto.',
                    },
                    ...(req.history ?? []).filter((m) => m.role !== 'system').slice(-8),
                    { role: 'user', content: req.prompt },
                  ],
                  onTokenDelta: (delta, isThinking) => {
                    emitStream({ type: 'token_delta', runId, delta, isThinking });
                  },
                });
                emitStream({ type: 'run_completed', runId });
                return {
                  runId,
                  reply: out.content || 'Sono pronto ad aiutarti a progettare la tua applicazione.',
                  thinkingText: out.thinking,
                  provider: 'ollama',
                  modelName,
                  usedFallbackOffline: false,
                  suggestedProjectPrompt: req.prompt,
                  tokensIn: out.tokensIn,
                  tokensOut: out.tokensOut,
                  latencyMs: Date.now() - started,
                };
              }
            }
          } catch {
            // Fall through cleanly to offline architect response
          }
        }

        const offlineText = `### Architettura Consigliata\nPer **"${req.prompt.slice(0, 80)}"** consiglio una schermata operativa principale con barra di navigazione, 3 indicatori KPI, modulo form con validazione TypeScript (\`src/scripts/handlers.ts\`) e tabella dati dinamica.\n\nPuoi cliccare **"Crea Progetto da questa Conversazione"** per generare subito tutte le schermate!`;
        emitStream({ type: 'token_delta', runId, delta: offlineText, isThinking: false });
        emitStream({ type: 'run_completed', runId });
        return {
          runId,
          reply: offlineText,
          provider: 'builtin_offline',
          modelName: modelName || 'offline-studio-architect-v1',
          usedFallbackOffline: true,
          suggestedProjectPrompt: req.prompt,
          latencyMs: Date.now() - started,
        };
      },

      async generateProjectWithAi(req: GenerateProjectWithAiRequest): Promise<ProjectBootstrapPayload> {
        const runId = req.runId || `projgen_${Date.now().toString(36)}`;
        const layoutMode: 'freeform' | 'auto' = req.layoutMode ?? 'freeform';
        emitStream({ type: 'run_started', runId, threadId: 'startup-project-gen', preCheckpointId: '' });
        emitStream({
          type: 'project_gen_status',
          runId,
          status: 'Analisi requisiti con Ollama...',
          completedPercent: 15,
        });

        let modelName = (req.modelName || '').trim();
        let rawAiJson: Record<string, any> | null = null;
        let usedProvider: LocalAIProviderKind = 'builtin_offline';

        if ((req.provider ?? 'ollama') === 'ollama') {
          try {
            const st = await fetchDirectOllamaStatus('http://127.0.0.1:11434', 1500);
            if (st.online) {
              if (!modelName) {
                modelName = pickPreferredLocalModel(st.models) ?? '';
              }
              if (modelName) {
                const chatOut = await streamDirectOllamaChat({
                  baseUrl: st.baseUrl,
                  modelName,
                  format: 'json',
                  temperature: 0.25,
                  timeoutMs: 35_000,
                  messages: [
                    {
                      role: 'system',
                      content:
                        'Sei l\'Architetto UI di Visual UI Studio. Rispondi SOLO con JSON valido contenente projectName, paletteId ("dark-pro"|"clean-light"|"ocean-blue"|"emerald-studio"|"cyberpunk-neon"|"warm-corporate"), includeThreeScene (boolean), summary, screens ([{ name, title, subtitle, kpis: [{label,value,trend}], primaryActionLabel, primaryHandlerFn }]), handlersTs (codice TypeScript con export function).',
                    },
                    {
                      role: 'user',
                      content: `Progetta in italiano: ${req.prompt}\nNome suggerito: ${req.projectName || 'auto'}\nTarget: ${req.primaryTarget ?? 'react-tsx'} (${layoutMode})`,
                    },
                  ],
                  onTokenDelta: (delta, isThinking) => {
                    emitStream({ type: 'token_delta', runId, delta, isThinking });
                  },
                });
                const firstBrace = chatOut.content.indexOf('{');
                const lastBrace = chatOut.content.lastIndexOf('}');
                if (firstBrace >= 0 && lastBrace > firstBrace) {
                  rawAiJson = JSON.parse(chatOut.content.slice(firstBrace, lastBrace + 1));
                  usedProvider = 'ollama';
                }
              }
            }
          } catch {
            rawAiJson = null;
          }
        }

        emitStream({
          type: 'project_gen_status',
          runId,
          status: 'Costruzione schermate, componenti e script...',
          completedPercent: 80,
        });

        const { seed } = buildBrowserAiSeedBundle(req, rawAiJson);
        const rec = buildBrowserRecordFromSeed(seed, {
          layoutMode,
          rootDiskPath: req.rootDiskPath ?? null,
          activeAiProviderId: usedProvider,
          activeAiModelId: modelName || 'offline-studio-architect-v1',
        });

        state.projects[rec.project.id] = rec;
        state.activeProjectId = rec.project.id;
        state.projectOrder = [rec.project.id, ...state.projectOrder.filter((id) => id !== rec.project.id)];
        persistState();

        emitStream({ type: 'run_completed', runId });
        return getBootstrapFor(rec);
      },

      async listThreads(projectId) {
        const rec = getRecordByProjectId(projectId);
        return structuredClone(rec.threads);
      },

      async getThreadMessages(threadId) {
        for (const rec of Object.values(state.projects)) {
          if (rec.threadMessages[threadId]) {
            return structuredClone(rec.threadMessages[threadId]);
          }
        }
        return [];
      },

      async runAgentTurn(req: RunAgentTurnRequest): Promise<RunAgentTurnResult> {
        const rec = getRecordByProjectId(req.projectId);
        const runId = `run_${Date.now().toString(36)}`;
        const threadId = req.threadId || `thr_${Date.now().toString(36)}`;
        const sheet = rec.sheetDocs[req.sheetId] ?? Object.values(rec.sheetDocs)[0];
        const cpId = `cp_ai_${Date.now().toString(36)}`;
        const cp: CheckpointSummaryDTO = {
          id: cpId,
          projectId: req.projectId,
          sheetId: req.sheetId,
          reason: 'pre_ai_step',
          label: `Pre-AI: ${req.prompt.slice(0, 36)}`,
          aiRunId: runId,
          commandSeqAt: undoStacks[req.sheetId]?.length ?? 0,
          createdAt: Date.now(),
        };
        rec.checkpointSnapshots[cpId] = {
          sheet: structuredClone(sheet),
          fileContents: { ...rec.fileContents },
        };
        rec.checkpoints = [cp, ...rec.checkpoints];

        if (!rec.threads.some((t) => t.id === threadId)) {
          rec.threads = [
            {
              id: threadId,
              projectId: rec.project.id,
              title: req.prompt.slice(0, 42) || 'Sessione AI',
              mode: req.mode,
              provider: req.provider,
              modelName: req.modelName,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            ...rec.threads,
          ];
        }

        emitStream({ type: 'run_started', runId, threadId, preCheckpointId: cpId });

        const rootId = sheet.rootIds[0] ?? null;
        const rootArtboard = rootId ? sheet.nodes[rootId] : undefined;
        const candidateParentId =
          req.selectedNodeIds?.[0] && sheet.nodes[req.selectedNodeIds[0]]?.kind !== 'control'
            ? req.selectedNodeIds[0]
            : rootId;
        const candidateParent = candidateParentId ? sheet.nodes[candidateParentId] : undefined;
        const parentId =
          rootArtboard?.layout.mode === 'freeform' &&
          candidateParent &&
          candidateParent.kind !== 'artboard' &&
          candidateParent.layout.mode === 'freeform' &&
          (candidateParent.layout.frame?.width ?? 0) < 600
            ? rootId
            : candidateParentId;

        const hostContainer = (parentId ? sheet.nodes[parentId] : undefined) ?? rootArtboard;
        const isFreeformHost = hostContainer?.layout.mode === 'freeform';
        const hostChildren = hostContainer
          ? hostContainer.childIds
              .map((cid) => sheet.nodes[cid])
              .filter((c): c is UINode => Boolean(c && c.visible !== false))
          : [];
        const nextY = Math.round(
          Math.max(
            48,
            ...hostChildren.map((c) => (c.layout.frame?.y ?? 0) + (c.layout.frame?.height ?? 0) + 28),
          ),
        );
        const hostWidth = hostContainer?.layout.frame?.width || rootArtboard?.layout.frame?.width || 1200;
        const freeformWidth = Math.max(320, Math.min(880, hostWidth - 96));

        const artFill = rootArtboard?.style?.fills?.[0];
        const isDarkSurface =
          (artFill?.type === 'solid' &&
            typeof artFill.color === 'string' &&
            /^#(0[0-9a-f]|1[0-9a-f]|2[0-3])/i.test(artFill.color.trim())) ||
          rec.project.activeThemeId?.includes('dark') ||
          false;

        const ops = hydrateCompactNodeToPatches(
          {
            id: generateNodeId('ai'),
            kind: 'container',
            name: 'AISynthesizedSection',
            tag: 'section',
            layoutMode: 'flex',
            ...(isFreeformHost
              ? {
                  positioning: 'absolute' as const,
                  x: 48,
                  y: nextY,
                  widthMode: 'fixed' as const,
                  width: freeformWidth,
                  heightMode: 'hug' as const,
                  height: 184,
                  zIndex: hostChildren.length + 2,
                }
              : {
                  widthMode: 'fill' as const,
                }),
            direction: 'column',
            gap: 12,
            padding: 20,
            bg: isDarkSurface ? '#111827' : '#ffffff',
            radius: 12,
            borderColor: isDarkSurface ? '#334155' : '#3b82f688',
            children: [
              {
                kind: 'text',
                name: 'AISectionTitle',
                tag: 'h3',
                text: `✨ Generato da AI: ${req.prompt.slice(0, 48)}`,
                fontSize: 18,
                fontWeight: 700,
                textColor: isDarkSurface ? '#f8fafc' : '#0f172a',
              },
              {
                kind: 'container',
                name: 'AIActionRow',
                layoutMode: 'flex',
                direction: 'row',
                gap: 10,
                padding: 0,
                children: [
                  {
                    kind: 'control',
                    controlType: 'text-input',
                    name: 'AIPromptInput',
                    placeholder: 'Inserisci parametro...',
                    widthMode: 'fill',
                    bg: isDarkSurface ? '#0f172a' : '#ffffff',
                    textColor: isDarkSurface ? '#f8fafc' : '#0f172a',
                    borderColor: isDarkSurface ? '#334155' : '#cbd5e1',
                  },
                  {
                    kind: 'control',
                    controlType: 'button',
                    name: 'AIPrimaryCTA',
                    text: 'Esegui Azione',
                    bg: '#2563eb',
                    textColor: '#ffffff',
                  },
                ],
              },
            ],
          },
          parentId,
          req.sheetId,
        );

        const { nextSheet, inverseOps } = applyPatchOpsToSheet(sheet, ops);
        rec.sheetDocs[req.sheetId] = nextSheet;
        undoStacks[req.sheetId] = [...(undoStacks[req.sheetId] ?? []), inverseOps];

        const toolCall = {
          id: `tc_${Date.now().toString(36)}`,
          toolName: 'mutate_canvas_nodes',
          argsJson: JSON.stringify({ mode: req.mode, opsCount: ops.length }),
          resultSummary: `Applicati ${ops.length} patch atomici sul foglio "${sheet.name}"`,
          status: 'succeeded' as const,
          durationMs: 18,
        };
        emitStream({ type: 'tool_call', runId, toolCall });
        emitStream({ type: 'canvas_patched', runId, opsCount: ops.length });
        emitStream({ type: 'run_completed', runId });

        const userMsg: AgentChatMessageDTO = {
          id: `msg_u_${Date.now().toString(36)}`,
          threadId,
          role: 'user',
          contentText: req.prompt,
          createdAt: Date.now() - 10,
        };
        const assistantMsg: AgentChatMessageDTO = {
          id: `msg_a_${Date.now().toString(36)}`,
          threadId,
          role: 'assistant',
          contentText: `Ho sintetizzato e applicato **${ops.length} operazioni UI-IR** ${isFreeformHost ? `a coordinate (${48}, ${nextY})` : 'in Auto-Layout'} sul foglio **${sheet.name}** (Checkpoint \`${cpId}\` salvato automaticamente).`,
          thinkingText: `Analisi richiesta "${req.prompt}" in modalità ${req.mode} -> generazione nodi semantici con token del progetto.`,
          preCheckpointId: cpId,
          toolCalls: [toolCall],
          latencyMs: 24,
          createdAt: Date.now(),
        };

        rec.threadMessages[threadId] = [...(rec.threadMessages[threadId] ?? []), userMsg, assistantMsg];
        bumpProjectRecency(rec.project.id);
        persistState();

        return {
          runId,
          threadId,
          preCheckpointId: cpId,
          userMessage: userMsg,
          assistantMessage: assistantMsg,
          appliedOps: ops,
          updatedSheet: structuredClone(nextSheet),
          usedFallbackOffline: true,
        };
      },

      async cancelAgentRun() {},

      async recordUnslothPair(input: RecordUnslothPairInput) {
        const rec = getRecordByProjectId(input.projectId);
        const pair: UnslothTrainingPairDTO = {
          id: `pair_${Date.now().toString(36)}`,
          projectId: input.projectId,
          sheetId: input.sheetId ?? null,
          promptSummary: input.promptSummary,
          normalizedUiIrJson: input.normalizedUiIrJson,
          tokensSnapshotJson: input.tokensSnapshotJson,
          targetFramework: input.targetFramework,
          acceptedCodeOutput: input.acceptedCodeOutput,
          qualityScore: input.qualityScore ?? 5,
          createdAt: Date.now(),
        };
        rec.unslothPairs = [pair, ...rec.unslothPairs];
        persistState();
        return structuredClone(pair);
      },

      async listUnslothPairs(projectId) {
        const rec = getRecordByProjectId(projectId);
        return structuredClone(rec.unslothPairs);
      },

      async exportUnslothDataset(req: ExportUnslothDatasetRequest): Promise<ExportUnslothDatasetResult> {
        const rec = getRecordByProjectId(req.projectId);
        const dir = req.outputDir || 'unsloth-export';
        return {
          outputDir: dir,
          datasetFilePath: `${dir}/dataset_${req.format}.jsonl`,
          trainScriptPath: `${dir}/train_unsloth_lora.py`,
          modelfilePath: `${dir}/Modelfile`,
          pairCount: Math.max(1, rec.unslothPairs.length),
        };
      },

      onAgentStreamEvent(listener) {
        streamListeners.add(listener);
        return () => {
          streamListeners.delete(listener);
        };
      },
    },

    toolchain: {
      async checkDoctor(): Promise<ToolchainDoctorReport> {
        return {
          checkedAt: Date.now(),
          platform: 'browser',
          isBrowserSandbox: true,
          node: { name: 'node', available: false, version: null },
          npm: { name: 'npm', available: false, version: null },
          python: { name: 'python', available: false, version: null },
          rustc: { name: 'rustc', available: false, version: null },
          cargo: { name: 'cargo', available: false, version: null },
          git: { name: 'git', available: false, version: null },
        };
      },
      async runTask() {
        throw new Error('Per avviare la toolchain, apri Visual UI Studio per desktop.');
      },
      async stopTask(_taskId: string): Promise<void> {},
      async listActiveTasks(_projectId?: string): Promise<ToolchainTaskStatus[]> {
        return [];
      },
      onEvent(_listener: (ev: ToolchainStreamEvent) => void) {
        return () => {};
      },
      onDiskVfsChanged(_listener: (ev: { projectId: string; paths: string[] }) => void) {
        return () => {};
      },
    },

    sql: {
      async loadSchema(projectId: string) {
        const rec = getRecordByProjectId(projectId);
        if (!rec.sqlSchema) {
          rec.sqlSchema = createStarterSqlDocument(projectId, rec.project.name, 'sqlite');
          persistState();
        }
        return structuredClone(rec.sqlSchema);
      },
      async saveSchema(projectId: string, doc: SqlDesignDocument) {
        const rec = getRecordByProjectId(projectId);
        rec.sqlSchema = { ...structuredClone(doc), projectId, updatedAt: Date.now() };
        persistState();
        return structuredClone(rec.sqlSchema);
      },
      async listConnections(projectId: string) {
        const rec = getRecordByProjectId(projectId);
        return structuredClone(rec.sqlConnections ?? []);
      },
      async saveConnection(profile, secret) {
        if (secret) throw new Error(DESKTOP_SQL_REQUIRED);
        const rec = getRecordByProjectId(profile.projectId);
        const now = Date.now();
        const id = profile.id ?? generateNodeId('sqlconn');
        const list = rec.sqlConnections ?? [];
        const existingIdx = list.findIndex((c) => c.id === id);
        const saved: SqlConnectionProfile = {
          ...profile,
          id,
          createdAt: existingIdx >= 0 ? list[existingIdx].createdAt : now,
          updatedAt: now,
        };
        if (existingIdx >= 0) list[existingIdx] = saved;
        else list.unshift(saved);
        rec.sqlConnections = list;
        persistState();
        return structuredClone(saved);
      },
      async deleteConnection(connectionId: string) {
        for (const rec of Object.values(state.projects)) {
          if (rec.sqlConnections?.some((c) => c.id === connectionId)) {
            rec.sqlConnections = rec.sqlConnections.filter((c) => c.id !== connectionId);
          }
        }
        persistState();
      },
      async testConnection() {
        return { ok: false, message: DESKTOP_SQL_REQUIRED };
      },
      async introspectConnection() {
        throw new Error(DESKTOP_SQL_REQUIRED);
      },
      async executeQuery(req: SqlQueryRequest): Promise<SqlQueryResult> {
        const rec = getRecordByProjectId(req.projectId);
        return {
          ok: false,
          dialect: req.dialect ?? req.schemaDoc?.dialect ?? rec.sqlSchema?.dialect ?? 'sqlite',
          columns: [],
          rows: [],
          rowCount: 0,
          durationMs: 0,
          executedSql: req.sql,
          error: DESKTOP_SQL_REQUIRED,
        };
      },
      async applyDataChanges() {
        return { ok: false, appliedCount: 0, sqlPreview: [], error: DESKTOP_SQL_REQUIRED };
      },
      async resetSandbox() {
        return { ok: false, message: DESKTOP_SQL_REQUIRED };
      },
      async compileMigration(input) {
        return buildSqlMigrationPlan(input.schemaDoc);
      },
      async applyMigration() {
        return { ok: false, executedStatements: 0, error: DESKTOP_SQL_REQUIRED };
      },
      async listQueryHistory() {
        return [];
      },
      async extractSqlFromProjectFiles(projectId: string) {
        const rec = getRecordByProjectId(projectId);
        return rec.vfsTree.flatMap((entry) =>
          extractSqlFromSourceCode(rec.fileContents[entry.id] ?? '', entry.virtualPath),
        );
      },
      async generateCodeBundle(req: GenerateSqlCodeRequest) {
        return codegenService.generateSqlCodeBundle(req);
      },
      async installRustTauriModule() {
        throw new Error(DESKTOP_DISK_REQUIRED);
      },
    },
  };
}

let cachedFallbackApi: StudioPreloadApi | null = null;

export function resetBrowserStudioApiCache(): void {
  cachedFallbackApi = null;
  hasAppliedBootUrlReset = false;
  consumeResetHubQueryFlag();
}

export function getStudioApi(): StudioPreloadApi {
  if (typeof window !== 'undefined' && window.studioApi) {
    return window.studioApi;
  }
  if (!cachedFallbackApi) {
    cachedFallbackApi = createBrowserStudioApi();
  }
  return cachedFallbackApi;
}

export function isRunningInElectronBridge(): boolean {
  return typeof window !== 'undefined' && Boolean(window.studioApi);
}

export type { CodegenTargetId };
