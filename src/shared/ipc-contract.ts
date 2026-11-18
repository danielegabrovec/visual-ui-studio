import type {
  BreakpointPreset,
  CodegenCompileOptions,
  CodegenTargetId,
  DesignTheme,
  DesignTokenEntry,
  NodeId,
  StylingDialect,
  TargetArtifactBundle,
  TargetDescriptor,
  UISheetDocument,
} from './ui-ir';
import type { UIPatchOp } from './ui-patch';
import type { ProjectWizardSpec } from './wizard-templates';
import type {
  DetectedDiskProjectInfo,
  DiskProjectInitSpec,
  PrimaryCodeLanguage,
  ProjectStackId,
  PythonCompanionKind,
  ToolchainDoctorReport,
  ToolchainStreamEvent,
  ToolchainTaskRequest,
  ToolchainTaskStatus,
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
// SHARED DTOs FOR IPC & WORKER SERVICES
// ============================================================================

export interface ProjectSummary {
  id: string;
  name: string;
  dbFilePath: string;
  rootDiskPath: string | null;
  primaryTarget: CodegenTargetId;
  stylingPreset: StylingDialect;
  stackId?: ProjectStackId;
  primaryLanguage?: PrimaryCodeLanguage;
  pythonCompanion?: PythonCompanionKind;
  activeThemeId: string | null;
  breakpoints: BreakpointPreset[];
  layoutMode?: 'freeform' | 'auto';
  createdAt: number;
  updatedAt: number;
}

export type RecentProjectItem = ProjectSummary;

export interface CreateProjectInput {
  name: string;
  rootDiskPath?: string | null;
  primaryTarget?: CodegenTargetId;
  stylingPreset?: StylingDialect;
  stackId?: ProjectStackId;
  primaryLanguage?: PrimaryCodeLanguage;
  pythonCompanion?: PythonCompanionKind;
  layoutMode?: 'freeform' | 'auto';
  seedDemoContent?: boolean;
}

export type VfsEntryKind =
  | 'folder'
  | 'canvas_sheet'
  | 'component_doc'
  | 'source_file'
  | 'style_file'
  | 'script_file'
  | 'blueprint_graph'
  | 'three_scene'
  | 'sql_schema'
  | 'sql_file'
  | 'asset_ref';
export type VfsSyncMode = 'virtual_only' | 'two_way_disk' | 'export_only';

export function isTextFileVfsKind(kind: VfsEntryKind): boolean {
  return (
    kind === 'source_file' ||
    kind === 'style_file' ||
    kind === 'script_file' ||
    kind === 'blueprint_graph' ||
    kind === 'three_scene' ||
    kind === 'sql_schema' ||
    kind === 'sql_file'
  );
}

const BINARY_ASSET_FILE_PATTERN =
  /\.(sqlite|sqlite3|db|db3|png|jpe?g|gif|webp|ico|bmp|avif|woff2?|ttf|otf|eot|mp3|wav|ogg|mp4|webm|glb|gltf|wasm|pdf|zip)$/i;

export function inferVfsKindFromFilename(name: string, relPosix = ''): VfsEntryKind {
  const lower = name.trim().toLowerCase();
  const normRel = relPosix.replace(/\\/g, '/').toLowerCase();
  if (BINARY_ASSET_FILE_PATTERN.test(lower)) return 'asset_ref';
  if (lower.endsWith('.blueprint.json')) return 'blueprint_graph';
  if (lower.endsWith('.scene3d.json')) return 'three_scene';
  if (lower.endsWith('.schema.sql.json')) return 'sql_schema';
  if (lower.endsWith('.sql')) return 'sql_file';
  if (lower.endsWith('.css') || lower.endsWith('.scss')) return 'style_file';
  if (
    /\.(m?[jt]s|py)$/i.test(lower) &&
    !lower.endsWith('.d.ts') &&
    !/\.(config|conf|spec|test)\.[jt]s$/i.test(lower) &&
    (normRel.includes('scripts/') || normRel.includes('automations/'))
  ) {
    return 'script_file';
  }
  return 'source_file';
}

export interface VfsNodeDTO {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  virtualPath: string;
  diskRelPath: string | null;
  entryKind: VfsEntryKind;
  sheetId?: string | null;
  targetFramework: CodegenTargetId | null;
  syncMode: VfsSyncMode;
  gitStatus: 'clean' | 'modified' | 'untracked' | 'conflict' | null;
  sortOrder: string;
  updatedAt: number;
}

export interface CreateVfsEntryInput {
  projectId: string;
  parentId: string | null;
  name: string;
  entryKind: VfsEntryKind;
  initialContent?: string;
  targetFramework?: CodegenTargetId;
}

export interface WorkspaceStateDTO {
  projectId: string;
  openTabsJson: string;
  leftTopRatio: number;
  leftActiveMode: 'insert' | 'components' | 'layers' | 'assets' | 'tokens';
  rightPanelMode: 'agent' | 'inspector' | 'split' | 'floating_hud';
  rightPanelWidth: number;
  activeAiProviderId: string;
  activeAiModelId: string;
  updatedAt: number;
}

export interface SheetSummaryDTO {
  id: string;
  projectId: string;
  vfsEntryId: string | null;
  name: string;
  sheetKind: 'visual_canvas' | 'component_master';
  viewportX: number;
  viewportY: number;
  viewportZoom: number;
  updatedAt: number;
}

export interface ProjectBootstrapPayload {
  project: ProjectSummary;
  workspace: WorkspaceStateDTO;
  vfsTree: VfsNodeDTO[];
  sheets: SheetSummaryDTO[];
  initialSheet: UISheetDocument | null;
  themes: DesignTheme[];
  tokens: DesignTokenEntry[];
}

export interface CommittedPatchBatch {
  projectId: string;
  sheetId: string;
  actor: 'user' | 'ai_agent' | 'layout_solver' | 'code_sync';
  label: string;
  ops: UIPatchOp[];
  aiRunId?: string;
}

export interface PatchCommitResult {
  seq: number;
  sheet: UISheetDocument;
  canUndo: boolean;
  canRedo: boolean;
}

export type CheckpointReason = 'periodic' | 'manual' | 'pre_ai_step' | 'pre_disk_sync';

export interface CheckpointSummaryDTO {
  id: string;
  projectId: string;
  sheetId: string | null;
  reason: CheckpointReason;
  label: string;
  aiRunId: string | null;
  commandSeqAt: number;
  createdAt: number;
}

export interface OfflineIconEntry {
  id: string;
  name: string;
  category: 'layout' | 'navigation' | 'actions' | 'commerce' | 'media' | 'data' | 'system' | 'ai';
  tags: string[];
  viewBox: string;
  svgBody: string;
}

// ============================================================================
// LOCAL AI & UNSLOTH INTEGRATION DTOs
// ============================================================================

export type LocalAIProviderKind = 'ollama' | 'lmstudio' | 'openai_compat' | 'builtin_offline';

export interface LocalAIModelInfo {
  id: string;
  name: string;
  provider: LocalAIProviderKind;
  sizeBytes?: number;
  quantization?: string;
  supportsVision: boolean;
  supportsTools: boolean;
  isUnsloth?: boolean;
  loadedInVram?: boolean;
  vramUsedMb?: number;
}

export interface HardwareAdvisorReport {
  totalSystemRamMb: number;
  freeSystemRamMb: number;
  cpuCores: number;
  platform: string;
  arch: string;
  recommendedTier: 'entry' | 'mid' | 'high';
  vramHeadroomReservedMb: number;
  recommendedCodingModel: string;
  recommendedVisionModel: string;
  adviceSummary: string;
}

export interface LocalAIProviderStatus {
  id: LocalAIProviderKind;
  displayName: string;
  baseUrl: string;
  online: boolean;
  latencyMs?: number;
  error?: string;
  models: LocalAIModelInfo[];
}

export interface UnslothModelRecommendation {
  id: string;
  repoId: string;
  ollamaPullUri: string;
  displayName: string;
  quantization: string;
  estimatedVramGb: number;
  role: 'coding' | 'vision' | 'reasoning';
  tier: 'entry' | 'mid' | 'high';
  description: string;
}

export type AgentExecutionMode = 'prompt_to_ui' | 'vision_to_ui' | 'surgical' | 'refactor';

export interface AgentToolCallRecord {
  id: string;
  toolName: string;
  argsJson: string;
  resultSummary: string;
  status: 'running' | 'succeeded' | 'failed' | 'reverted';
  durationMs: number;
}

export interface AgentChatMessageDTO {
  id: string;
  threadId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  contentText: string;
  thinkingText?: string;
  preCheckpointId?: string | null;
  toolCalls?: AgentToolCallRecord[];
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
  createdAt: number;
}

export interface AgentThreadDTO {
  id: string;
  projectId: string;
  title: string;
  mode: AgentExecutionMode;
  provider: LocalAIProviderKind;
  modelName: string;
  createdAt: number;
  updatedAt: number;
}

export interface RunAgentTurnRequest {
  projectId: string;
  sheetId: string;
  threadId?: string | null;
  mode: AgentExecutionMode;
  provider: LocalAIProviderKind;
  modelName: string;
  prompt: string;
  selectedNodeIds?: NodeId[];
  activeTarget?: CodegenTargetId;
  activeDialect?: StylingDialect;
  visionImageBase64?: string;
}

export interface RunAgentTurnResult {
  runId: string;
  threadId: string;
  preCheckpointId: string;
  userMessage: AgentChatMessageDTO;
  assistantMessage: AgentChatMessageDTO;
  appliedOps: UIPatchOp[];
  updatedSheet: UISheetDocument;
  generatedCode?: TargetArtifactBundle;
  usedFallbackOffline: boolean;
}

export interface EnsureOllamaResult {
  online: boolean;
  startedByApp: boolean;
  binaryPath?: string | null;
  baseUrl?: string;
  models: LocalAIModelInfo[];
  preferredModel: string | null;
  message: string;
}

export interface StartupAssistantMessageTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StartupAssistantChatRequest {
  prompt: string;
  history?: StartupAssistantMessageTurn[];
  provider?: LocalAIProviderKind;
  modelName?: string;
  primaryTarget?: CodegenTargetId;
  runId?: string;
}

export interface StartupAssistantChatResult {
  runId: string;
  reply: string;
  thinkingText?: string;
  provider: LocalAIProviderKind;
  modelName: string;
  usedFallbackOffline: boolean;
  suggestedProjectPrompt?: string;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs: number;
}

export interface GenerateProjectWithAiRequest {
  prompt: string;
  projectName?: string;
  primaryTarget?: CodegenTargetId;
  stylingPreset?: StylingDialect;
  layoutMode?: 'freeform' | 'auto';
  provider?: LocalAIProviderKind;
  modelName?: string;
  rootDiskPath?: string | null;
  runId?: string;
}

export type AgentStreamEvent =
  | { type: 'run_started'; runId: string; threadId: string; preCheckpointId: string }
  | { type: 'token_delta'; runId: string; delta: string; isThinking?: boolean }
  | { type: 'tool_call'; runId: string; toolCall: AgentToolCallRecord }
  | { type: 'canvas_patched'; runId: string; opsCount: number }
  | { type: 'pull_progress'; modelRef: string; status: string; completedPercent?: number }
  | { type: 'project_gen_status'; runId: string; status: string; completedPercent?: number }
  | { type: 'run_completed'; runId: string }
  | { type: 'run_error'; runId: string; error: string };

/**
 * Returns true if a local model name or family metadata indicates an embedding-only
 * or non-chat model (e.g. `nomic-embed-text`, `mxbai-embed-large`, `all-minilm`, `bge-*`).
 */
export function isEmbeddingOnlyModelName(modelName: string, families?: string[]): boolean {
  const lower = (modelName || '').trim().toLowerCase();
  if (!lower) return true;
  if (
    lower.includes('embed') ||
    lower.startsWith('all-minilm') ||
    lower.includes('/all-minilm') ||
    lower.startsWith('bge-') ||
    lower.includes('/bge-') ||
    lower.startsWith('snowflake-arctic-embed') ||
    lower.startsWith('paraphrase-') ||
    lower.startsWith('jina-embeddings') ||
    lower.includes('whisper') ||
    lower.includes('rerank')
  ) {
    return true;
  }
  if (families && families.length > 0) {
    const lowerFams = families.map((f) => f.toLowerCase());
    const hasOnlyBert = lowerFams.every((f) => f.includes('bert'));
    if (hasOnlyBert) return true;
  }
  return false;
}

/**
 * Computes a deterministic priority score for local chat / UI-codegen models:
 * - Loaded-in-VRAM models & dedicated local coding models (`qwen3-coder*`, `qwen2.5-coder*`,
 *   `deepseek-coder*`, `qwen3.8-opencode*`, `gpt-oss*`, `gemma4*`, `qwen3*`, `deepseek-r1*`) rank FIRST.
 * - Remote proxy `:cloud` tags and completion-only `-base` tags rank LAST.
 */
export function scoreLocalChatCodingModel(model: LocalAIModelInfo): number {
  const lower = model.name.toLowerCase();
  let score = 50;

  // Heavy penalties for cloud proxy tags & non-instruct base models
  if (lower.endsWith(':cloud') || lower.includes(':cloud') || lower.includes('-cloud')) {
    score -= 500;
  }
  if (lower.includes('-base') || lower.endsWith(':base')) {
    score -= 400;
  }

  // Hot-in-VRAM models respond with zero cold-load latency
  if (model.loadedInVram) {
    score += 300;
  }
  if (model.isUnsloth) {
    score += 45;
  }

  // Coding & flagship local model family tiers
  if (lower.includes('qwen3-coder') || lower.includes('qwen3.8-opencode') || lower.includes('opencode')) {
    score += 245;
  } else if (
    lower.includes('qwen2.5-coder') ||
    lower.includes('deepseek-coder') ||
    lower.includes('codestral') ||
    lower.includes('starcoder')
  ) {
    score += 225;
  } else if (lower.includes('gpt-oss')) {
    score += 195;
  } else if (lower.includes('gemma4') || lower.includes('gemma-4') || lower.includes('qwen3')) {
    score += 175;
  } else if (lower.includes('deepseek-r1') || lower.includes('qwq')) {
    score += 155;
  } else if (
    lower.includes('gemma3') ||
    lower.includes('gemma-3') ||
    lower.includes('qwen2.5') ||
    lower.includes('llama3') ||
    lower.includes('llama-3') ||
    lower.includes('mistral')
  ) {
    score += 120;
  }

  // Extended context tie-breaker (e.g. :14b-16k over :14b, :20b-64k over :20b)
  if (/(128k|64k|32k|16k)\b/i.test(lower)) {
    score += 18;
  }

  // Parameter sweet-spot tie-breaker
  if (/\b(14b|16b|20b|22b|24b|26b|27b|30b|32b)\b/i.test(lower)) {
    score += 16;
  } else if (/\b(7b|8b|9b|12b)\b/i.test(lower)) {
    score += 12;
  } else if (/\b(0\.5b|1b|1\.5b)\b/i.test(lower)) {
    score -= 25;
  }

  return score;
}

export function filterAndRankLocalModels(models: LocalAIModelInfo[]): LocalAIModelInfo[] {
  return models
    .filter((m) => !isEmbeddingOnlyModelName(m.name))
    .sort((a, b) => {
      const diff = scoreLocalChatCodingModel(b) - scoreLocalChatCodingModel(a);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name);
    });
}

export function pickPreferredLocalModel(models: LocalAIModelInfo[]): string | null {
  const ranked = filterAndRankLocalModels(models);
  return ranked[0]?.id ?? null;
}

export interface UnslothTrainingPairDTO {
  id: string;
  projectId: string;
  sheetId: string | null;
  promptSummary: string;
  normalizedUiIrJson: string;
  tokensSnapshotJson?: string;
  targetFramework: CodegenTargetId;
  acceptedCodeOutput: string;
  qualityScore: number;
  createdAt: number;
}

export interface RecordUnslothPairInput {
  projectId: string;
  sheetId?: string | null;
  promptSummary: string;
  normalizedUiIrJson: string;
  tokensSnapshotJson?: string;
  targetFramework: CodegenTargetId;
  acceptedCodeOutput: string;
  qualityScore?: number;
}

export interface ExportUnslothDatasetRequest {
  projectId: string;
  format: 'sharegpt' | 'alpaca';
  outputDir?: string;
  baseModelRepo?: string;
}

export interface ExportUnslothDatasetResult {
  outputDir: string;
  datasetFilePath: string;
  trainScriptPath: string;
  modelfilePath: string;
  pairCount: number;
}

// ============================================================================
// PRELOAD CONTEXT-BRIDGE API (`window.studioApi`)
// ============================================================================

export interface CompileSheetRequest extends CodegenCompileOptions {
  projectId: string;
  sheetId: string;
}

export interface ExportBundleToDiskInput {
  targetDir?: string;
  defaultFolderName: string;
  files: Array<{ relativePath: string; code: string }>;
}

export interface ExportBundleToDiskResult {
  exportedDir: string | null;
  fileCount: number;
}

export interface StudioPreloadApi {
  project: {
    listRecent(): Promise<ProjectSummary[]>;
    removeRecent(projectId: string): Promise<RecentProjectItem[]>;
    create(input: CreateProjectInput): Promise<ProjectBootstrapPayload>;
    createFromWizard(spec: ProjectWizardSpec): Promise<ProjectBootstrapPayload>;
    createAndInitDiskProject(spec: DiskProjectInitSpec): Promise<ProjectBootstrapPayload>;
    open(idOrPath: string): Promise<ProjectBootstrapPayload>;
    openDirectory?(): Promise<ProjectBootstrapPayload | null>;
    openExistingDiskProject(dirPath?: string): Promise<ProjectBootstrapPayload | null>;
    pickDirectory(title?: string): Promise<string | null>;
    inspectDirectory(dirPath: string): Promise<DetectedDiskProjectInfo>;
    getCurrent(): Promise<ProjectBootstrapPayload>;
    linkDiskDirectory(projectId: string, dirPath?: string): Promise<{ rootDiskPath: string; syncedCount: number }>;
    updateSettings(
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
    exportBundleToDisk(input: ExportBundleToDiskInput): Promise<ExportBundleToDiskResult>;
  };

  workspace: {
    loadState(projectId: string): Promise<WorkspaceStateDTO>;
    saveState(projectId: string, patch: Partial<Omit<WorkspaceStateDTO, 'projectId' | 'updatedAt'>>): Promise<WorkspaceStateDTO>;
  };

  vfs: {
    listTree(projectId: string): Promise<VfsNodeDTO[]>;
    createEntry(input: CreateVfsEntryInput): Promise<{ entry: VfsNodeDTO; createdSheet?: UISheetDocument }>;
    renameEntry(entryId: string, newName: string): Promise<VfsNodeDTO>;
    moveEntry(entryId: string, newParentId: string | null): Promise<VfsNodeDTO>;
    deleteEntry(entryId: string, deleteOnDisk?: boolean): Promise<void>;
    readFile(entryId: string): Promise<{ content: string; sha256: string }>;
    writeFile(entryId: string, content: string, expectedContent?: string): Promise<{ sha256: string }>;
  };

  canvas: {
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
  };

  tokens: {
    listTokens(projectId: string): Promise<DesignTokenEntry[]>;
    upsertToken(entry: Omit<DesignTokenEntry, 'id'> & { id?: string }): Promise<DesignTokenEntry>;
    deleteToken(tokenId: string): Promise<void>;
    listThemes(projectId: string): Promise<DesignTheme[]>;
    searchIcons(query: string, category?: string): Promise<OfflineIconEntry[]>;
  };

  codegen: {
    listTargets(): Promise<TargetDescriptor[]>;
    compileSheet(req: CompileSheetRequest): Promise<TargetArtifactBundle>;
    solveFreeformLayout(sheetId: string, rootNodeId: NodeId): Promise<{ ops: UIPatchOp[]; summary: string }>;
    saveBundleToDisk(projectId: string, bundle: TargetArtifactBundle): Promise<{ writtenPaths: string[] }>;
  };

  ai: {
    ensureOllamaRunning(): Promise<EnsureOllamaResult>;
    getHardwareReport(): Promise<HardwareAdvisorReport>;
    listProvidersAndModels(): Promise<LocalAIProviderStatus[]>;
    configureProvider(config: { id: LocalAIProviderKind; baseUrl: string; apiKey?: string }): Promise<LocalAIProviderStatus>;
    getUnslothCatalog(): Promise<UnslothModelRecommendation[]>;
    pullOllamaModel(modelRef: string): Promise<{ ok: boolean; message: string }>;
    askStartupAssistant(req: StartupAssistantChatRequest): Promise<StartupAssistantChatResult>;
    generateProjectWithAi(req: GenerateProjectWithAiRequest): Promise<ProjectBootstrapPayload>;
    listThreads(projectId: string): Promise<AgentThreadDTO[]>;
    getThreadMessages(threadId: string): Promise<AgentChatMessageDTO[]>;
    runAgentTurn(req: RunAgentTurnRequest): Promise<RunAgentTurnResult>;
    cancelAgentRun(runId: string): Promise<void>;
    recordUnslothPair(input: RecordUnslothPairInput): Promise<UnslothTrainingPairDTO>;
    listUnslothPairs(projectId: string): Promise<UnslothTrainingPairDTO[]>;
    exportUnslothDataset(req: ExportUnslothDatasetRequest): Promise<ExportUnslothDatasetResult>;
    onAgentStreamEvent(listener: (event: AgentStreamEvent) => void): () => void;
  };

  toolchain: {
    checkDoctor(): Promise<ToolchainDoctorReport>;
    runTask(req: ToolchainTaskRequest): Promise<{ taskId: string }>;
    stopTask(taskId: string): Promise<void>;
    listActiveTasks(projectId?: string): Promise<ToolchainTaskStatus[]>;
    onEvent(listener: (event: ToolchainStreamEvent) => void): () => void;
    onDiskVfsChanged(listener: (event: { projectId: string; paths: string[] }) => void): () => void;
  };

  sql: {
    loadSchema(projectId: string): Promise<SqlDesignDocument>;
    saveSchema(projectId: string, doc: SqlDesignDocument): Promise<SqlDesignDocument>;
    listConnections(projectId: string): Promise<SqlConnectionProfile[]>;
    saveConnection(
      profile: Omit<SqlConnectionProfile, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
      secret?: string,
    ): Promise<SqlConnectionProfile>;
    deleteConnection(connectionId: string): Promise<void>;
    testConnection(
      connectionId: string,
      secretOverride?: string,
    ): Promise<{ ok: boolean; message: string; version?: string; latencyMs?: number }>;
    introspectConnection(connectionId: string): Promise<SqlDesignDocument>;
    executeQuery(req: SqlQueryRequest): Promise<SqlQueryResult>;
    applyDataChanges(input: {
      projectId: string;
      connectionId?: string | null;
      sandboxMode?: boolean;
      dialect?: SqlDialect;
      tableName: string;
      schema?: string;
      changes: SqlDataChange[];
      schemaDoc?: SqlDesignDocument;
    }): Promise<{ ok: boolean; appliedCount: number; sqlPreview: string[]; error?: string }>;
    resetSandbox(projectId: string, schemaDoc?: SqlDesignDocument): Promise<{ ok: boolean; message: string }>;
    compileMigration(input: {
      projectId: string;
      schemaDoc: SqlDesignDocument;
      connectionId?: string | null;
    }): Promise<SqlMigrationPlan>;
    applyMigration(input: {
      projectId: string;
      plan: SqlMigrationPlan;
      connectionId?: string | null;
      sandboxMode?: boolean;
      allowDestructive?: boolean;
    }): Promise<{ ok: boolean; executedStatements: number; error?: string }>;
    listQueryHistory(projectId: string, limit?: number): Promise<SqlQueryHistoryEntry[]>;
    extractSqlFromProjectFiles(projectId: string): Promise<ExtractedSqlOperation[]>;
    generateCodeBundle(req: GenerateSqlCodeRequest): Promise<TargetArtifactBundle>;
    installRustTauriModule(projectId: string, bundle: TargetArtifactBundle): Promise<{ writtenPaths: string[] }>;
  };
}

declare global {
  interface Window {
    studioApi?: StudioPreloadApi;
  }
}
