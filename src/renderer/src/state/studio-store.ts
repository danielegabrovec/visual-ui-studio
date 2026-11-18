import { create } from 'zustand';
import {
  compileBlueprintToTs,
  createStarterBlueprintGraph,
  type BlueprintGraphDocument,
} from '@shared/blueprint-ir';
import { compileAutomationRuleToCode, upsertManagedAutomationInFile } from '@shared/automation-ir';
import { DEFAULT_BREAKPOINTS } from '@shared/default-tokens';
import {
  createStarterScriptModuleTs,
  extractScriptFunctions,
  inferScriptLanguageFromPath,
} from '@shared/script-ir';
import { createThreeSceneFromPreset, type ThreeSceneDocument } from '@shared/three-ir';
import {
  BUILTIN_TARGET_DESCRIPTORS,
  type AutomationRule,
  type CodegenTargetId,
  type DesignTheme,
  type DesignTokenEntry,
  type EventTriggerType,
  type InteractiveStateKey,
  type LinkedScriptModuleRef,
  type NodeId,
  type ReusableCssClass,
  type StyleSpec,
  type StylingDialect,
  type TargetArtifactBundle,
  type TargetDescriptor,
  type TypographySpec,
  type UINode,
  type UIRScriptModuleDecl,
  type UISheetDocument,
  type UISheetStateSpec,
} from '@shared/ui-ir';
import { applyPatchOpsToSheet, generateNodeId, type UIPatchOp } from '@shared/ui-patch';
import {
  filterAndRankLocalModels,
  isEmbeddingOnlyModelName,
  isTextFileVfsKind,
  pickPreferredLocalModel,
  type AgentChatMessageDTO,
  type AgentExecutionMode,
  type AgentToolCallRecord,
  type CheckpointSummaryDTO,
  type EnsureOllamaResult,
  type ExportBundleToDiskResult,
  type ExportUnslothDatasetResult,
  type GenerateProjectWithAiRequest,
  type HardwareAdvisorReport,
  type LocalAIProviderKind,
  type LocalAIProviderStatus,
  type OfflineIconEntry,
  type ProjectBootstrapPayload,
  type ProjectSummary,
  type SheetSummaryDTO,
  type StartupAssistantMessageTurn,
  type UnslothModelRecommendation,
  type UnslothTrainingPairDTO,
  type VfsEntryKind,
  type VfsNodeDTO,
} from '@shared/ipc-contract';
import type {
  DiskProjectInitSpec,
  ToolchainDoctorReport,
  ToolchainTaskRequest,
  ToolchainTaskStatus,
} from '@shared/project-stacks';
import {
  createStarterSqlDocument,
  type SqlConnectionProfile,
  type SqlDesignDocument,
  type SqlDialect,
  type SqlQueryRequest,
  type SqlQueryResult,
} from '@shared/sql-ir';
import type { ProjectWizardSpec } from '@shared/wizard-templates';
import { getStudioApi } from '@renderer/api/studio-client';
import { PALETTE_ELEMENT_PRESETS, REUSABLE_COMPONENT_TEMPLATES } from '@renderer/utils/palette-catalog';

export type WorkspaceTabKind =
  | 'canvas'
  | 'css'
  | 'code'
  | 'blueprint'
  | 'script'
  | 'automation'
  | 'sql_studio'
  | 'three_scene'
  | 'preview'
  | 'source_file';

export type SplitWorkspacePreset =
  | 'canvas'
  | 'split-css'
  | 'split-code'
  | 'split-blueprint'
  | 'split-script'
  | 'split-automation'
  | 'split-sql'
  | 'three-studio'
  | 'split-preview';

export type GroupNodesPreset = 'auto' | 'row' | 'column' | 'grid' | 'card' | 'freeform';

export interface CopiedNodeStylePayload {
  style: StyleSpec;
  typography?: TypographySpec;
  stateOverrides?: UINode['stateOverrides'];
  classNames?: string[];
}

export type CanvasDrawingTool =
  | 'select'
  | 'pan'
  | 'frame'
  | 'rect'
  | 'circle'
  | 'text'
  | 'button'
  | 'input'
  | 'three_viewport';

export interface WorkspaceTab {
  id: string;
  kind: WorkspaceTabKind;
  title: string;
  sheetId?: string;
  vfsEntryId?: string;
  targetId?: CodegenTargetId;
  dialect?: StylingDialect;
  activeFilePath?: string;
  blueprintId?: string;
  threeSceneId?: string;
  automationId?: string;
  sqlTableId?: string;
}

export interface SourceDraft {
  content: string;
  baseContent: string;
}

export interface EditorGroup {
  id: string;
  tabs: WorkspaceTab[];
  activeTabId: string;
}

export interface ToastItem {
  id: string;
  kind: 'success' | 'info' | 'warn' | 'error';
  message: string;
}

export interface ConsoleLogEntry {
  id: string;
  kind:
    | 'log'
    | 'info'
    | 'warn'
    | 'error'
    | 'blueprint'
    | 'script'
    | 'htmx'
    | 'ipc'
    | 'terminal'
    | 'sql';
  source: string;
  message: string;
  timestamp: number;
  nodeId?: NodeId;
}

export interface StreamingRunState {
  runId: string;
  text: string;
  thinking: string;
  toolCalls: AgentToolCallRecord[];
  preCheckpointId?: string;
}

export type HubSectionId = 'architect' | 'recents' | 'templates' | 'ollama';

export interface StartupChatMessageItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  modelName?: string;
  provider?: LocalAIProviderKind;
  latencyMs?: number;
  suggestedProjectPrompt?: string;
  usedFallbackOffline?: boolean;
  createdAt: number;
}

export interface AiProjectGenProgressState {
  runId: string;
  status: string;
  percent: number;
  startedAt: number;
  streamedTokens: string;
}

function shouldShowProjectHubInitially(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('autostart') !== 'demo';
  } catch {
    return true;
  }
}

export interface StudioState {
  bootstrapped: boolean;
  loadingError: string | null;

  // v2.1 IDE Startup Workbench, Guided Wizard, Command Palette & Bottom Console
  showProjectHub: boolean;
  hasOpenedProjectInSession: boolean;
  hubActiveSection: HubSectionId;
  wizardOpen: boolean;
  commandPaletteOpen: boolean;
  shortcutsHelpOpen: boolean;
  bottomConsoleOpen: boolean;
  bottomConsoleHeight: number;
  consoleEntries: ConsoleLogEntry[];

  // Project & VFS
  project: ProjectSummary | null;
  recentProjects: ProjectSummary[];
  vfsTree: VfsNodeDTO[];
  sheets: SheetSummaryDTO[];
  sheetDocuments: Record<string, UISheetDocument>;
  sourceFiles: Record<string, string>;
  sourceDrafts: Record<string, SourceDraft>;
  blueprintGraphs: Record<string, BlueprintGraphDocument>;
  activeBlueprintId: string | null;
  threeScenes: Record<string, ThreeSceneDocument>;
  activeThreeSceneId: string | null;
  activeScriptVfsId: string | null;
  themes: DesignTheme[];
  tokens: DesignTokenEntry[];
  targets: TargetDescriptor[];

  // Global Header & Theme
  studioTheme: 'dark' | 'light';
  activeBreakpointId: string;
  globalTarget: CodegenTargetId;
  globalDialect: StylingDialect;

  // Left Permanent Sidebar
  leftSidebarWidth: number;
  leftTopRatio: number;
  leftActiveMode: 'insert' | 'components' | 'layers' | 'assets' | 'tokens';
  selectedFolderId: string | null;

  // Center Multi-Sheet Split Workspace
  editorGroups: EditorGroup[];
  activeGroupId: string;
  splitOrientation: 'horizontal' | 'vertical';
  groupSizes: number[];

  // Active Canvas Sheet, Freeform/Drawing Tools & Selection
  activeSheetId: string;
  canvasPlacementMode: 'freeform' | 'auto';
  activeDrawingTool: CanvasDrawingTool;
  showRulers: boolean;
  cursorCanvasPos: { x: number; y: number } | null;
  codeSelectPulseNodeId: NodeId | null;
  selectedNodeIds: NodeId[];
  hoveredNodeId: NodeId | null;
  viewports: Record<string, { x: number; y: number; zoom: number }>;
  snapToGrid8px: boolean;
  copiedClipboard: {
    rootIds: NodeId[];
    nodes: Record<NodeId, UINode>;
    pasteCount: number;
  } | null;
  copiedNodeStyle: CopiedNodeStylePayload | null;
  simulatedCanvasState: 'base' | InteractiveStateKey;
  hoveredBoxModelOverlay: 'margin' | 'padding' | 'border' | null;
  activeAutomationId: string | null;
  canUndo: boolean;
  canRedo: boolean;

  // v3.0 Multi-Dialect SQL & Data Studio State
  sqlDocument: SqlDesignDocument | null;
  activeSqlDialect: SqlDialect;
  sqlConnections: SqlConnectionProfile[];
  activeSqlConnectionId: string | null;
  lastSqlQueryResult: SqlQueryResult | null;

  // v3.0 Real Disk Projects & Toolchain Runner State
  toolchainDoctor: ToolchainDoctorReport | null;
  toolchainTasks: ToolchainTaskStatus[];

  // Codegen Bundle Cache
  compiledBundles: Record<string, TargetArtifactBundle>;
  codeDrafts: Record<string, Record<string, string | null>>;
  compilingKeys: Record<string, boolean>;

  // Right Operational Dock
  rightPanelMode: 'agent' | 'inspector' | 'split';
  rightPanelWidth: number;
  aiPromptFocusTick: number;

  // Local AI, Ollama Auto-Start, Startup Architect & Unsloth
  ollamaEnsureStatus: 'idle' | 'starting' | 'online' | 'offline';
  ollamaStartedByApp: boolean;
  ollamaStatusMessage: string | null;
  hardwareReport: HardwareAdvisorReport | null;
  providers: LocalAIProviderStatus[];
  activeProvider: LocalAIProviderKind;
  activeModel: string;
  agentMode: AgentExecutionMode;
  activeThreadId: string | null;
  messages: AgentChatMessageDTO[];
  streamingRun: StreamingRunState | null;
  isRunningAgent: boolean;
  isGeneratingAiProject: boolean;
  aiProjectGenStatus: AiProjectGenProgressState | null;
  startupChatMessages: StartupChatMessageItem[];
  isRunningStartupChat: boolean;
  startupChatStreaming: { runId: string; text: string; thinking: string } | null;
  visionImageBase64: string | null;
  checkpoints: CheckpointSummaryDTO[];
  unslothCatalog: UnslothModelRecommendation[];
  unslothPairs: UnslothTrainingPairDTO[];
  pullProgress: { modelRef: string; status: string; percent?: number } | null;
  lastUnslothExport: ExportUnslothDatasetResult | null;

  // Modals & Toasts
  isUnslothModalOpen: boolean;
  isNewProjectModalOpen: boolean;
  isImportCodeModalOpen: boolean;
  isA11yModalOpen: boolean;
  lastScaffoldExportDir: string | null;
  toasts: ToastItem[];

  // Core Lifecycle & Hub Actions
  initStudio: () => Promise<void>;
  pushToast: (kind: ToastItem['kind'], message: string) => void;
  dismissToast: (id: string) => void;
  setShowProjectHub: (open: boolean) => void;
  setHubActiveSection: (section: HubSectionId) => void;
  setWizardOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setShortcutsHelpOpen: (open: boolean) => void;
  setBottomConsoleOpen: (open: boolean) => void;
  setBottomConsoleHeight: (h: number) => void;
  appendConsoleEntry: (entry: Omit<ConsoleLogEntry, 'id' | 'timestamp'>) => void;
  clearConsoleEntries: () => void;

  // Project & Header Actions
  createNewProject: (
    name: string,
    target: CodegenTargetId,
    dialect: StylingDialect,
    layoutMode?: 'freeform' | 'auto',
  ) => Promise<void>;
  createProjectFromWizard: (spec: ProjectWizardSpec) => Promise<void>;
  createQuickFreeformProject: (name?: string) => Promise<void>;
  openDemoProject: () => Promise<void>;
  openRecentProject: (projectId: string) => Promise<void>;
  removeRecentProject: (projectId: string) => Promise<void>;
  linkDiskFolder: () => Promise<void>;
  setStudioTheme: (theme: 'dark' | 'light') => Promise<void>;
  setActiveBreakpoint: (bpId: string) => void;
  setGlobalTarget: (targetId: CodegenTargetId) => Promise<void>;
  applyLayoutPreset: (preset: SplitWorkspacePreset) => void;
  openSplitMode: (preset: SplitWorkspacePreset) => void;

  // Left Sidebar & VFS Actions
  setLeftSidebarWidth: (w: number) => void;
  setLeftTopRatio: (r: number) => void;
  setLeftActiveMode: (mode: StudioState['leftActiveMode']) => void;
  setSelectedFolderId: (folderId: string | null) => void;
  createVfsEntry: (
    name: string,
    kind: VfsEntryKind,
    parentId?: string | null,
    initialContent?: string,
  ) => Promise<VfsNodeDTO | null>;
  renameVfsEntry: (entryId: string, newName: string) => Promise<void>;
  moveVfsEntry: (entryId: string, newParentId: string | null) => Promise<void>;
  deleteVfsEntry: (entryId: string) => Promise<void>;
  openVfsNode: (node: VfsNodeDTO, mode?: 'workbench') => Promise<void>;
  openVfsSource: (node: VfsNodeDTO, groupId?: string) => Promise<boolean>;
  saveSourceFileContent: (vfsEntryId: string, content: string, silent?: boolean, expectedContent?: string) => Promise<void>;
  setSourceDraft: (vfsEntryId: string, draft: SourceDraft | null) => void;
  saveSourceDraft: (vfsEntryId: string, silent?: boolean) => Promise<boolean>;

  // Blueprint, Script & Three.js Helpers
  ensureActiveBlueprintGraph: () => Promise<{ vfsEntryId: string; graph: BlueprintGraphDocument }>;
  saveBlueprintGraph: (graph: BlueprintGraphDocument, vfsEntryId?: string) => Promise<void>;
  ensureActiveThreeScene: () => Promise<{ vfsEntryId: string; scene: ThreeSceneDocument }>;
  saveThreeScene: (scene: ThreeSceneDocument, vfsEntryId?: string) => Promise<void>;
  embedThreeSceneInActiveSheet: (sceneId?: string, sceneName?: string) => Promise<void>;
  ensureActiveScriptFile: () => Promise<{ vfsEntryId: string; content: string; name: string }>;
  createAndBindScriptFunctionForNode: (
    nodeId: NodeId,
    trigger?: EventTriggerType,
  ) => Promise<{ vfsEntryId: string; fnName: string } | null>;

  // Center Workspace Tab & Split Actions
  setGroupSizes: (sizes: number[]) => void;
  openTabInGroup: (tab: Omit<WorkspaceTab, 'id'>, groupId?: string) => void;
  activateTab: (groupId: string, tabId: string) => void;
  closeTab: (groupId: string, tabId: string) => void;
  splitEditorGroup: (direction: 'horizontal' | 'vertical', initialKind?: WorkspaceTabKind) => void;
  updateCodeTabTarget: (groupId: string, tabId: string, targetId: CodegenTargetId, dialect?: StylingDialect) => void;
  updateCodeTabActiveFile: (groupId: string, tabId: string, filePath: string) => void;
  compileSheetForTarget: (
    sheetId: string,
    targetId: CodegenTargetId,
    dialect: StylingDialect,
  ) => Promise<TargetArtifactBundle | null>;
  setCodeDraft: (key: string, filePath: string, content: string | null | undefined) => void;
  saveCodeDrafts: (sheetId: string, targetId: CodegenTargetId, dialect: StylingDialect) => Promise<boolean>;
  saveBundleToDisk: (bundle: TargetArtifactBundle) => Promise<void>;
  exportProjectScaffold: (
    sheetId: string,
    targetId: CodegenTargetId,
    dialect: StylingDialect,
    targetDir?: string,
  ) => Promise<ExportBundleToDiskResult | null>;

  // Canvas, Freeform, Drawing & SceneGraph Actions
  setCanvasPlacementMode: (mode: 'freeform' | 'auto') => void;
  setActiveDrawingTool: (tool: CanvasDrawingTool) => void;
  setShowRulers: (show: boolean) => void;
  setCursorCanvasPos: (pos: { x: number; y: number } | null) => void;
  selectNode: (nodeId: NodeId | null, multi?: boolean) => void;
  selectNodeFromCode: (nodeId: NodeId | null) => void;
  setHoveredNode: (nodeId: NodeId | null) => void;
  setViewport: (sheetId: string, vp: { x: number; y: number; zoom: number }, persist?: boolean) => void;
  toggleSnapToGrid8px: () => void;
  commitOps: (
    ops: UIPatchOp[],
    label: string,
    actor?: 'user' | 'layout_solver' | 'code_sync',
    sheetId?: string,
  ) => Promise<void>;
  insertPaletteElement: (
    presetId: string,
    dropPos?: { x: number; y: number },
    explicitParentId?: NodeId | null,
  ) => Promise<void>;
  insertReusableComponent: (templateId: string) => Promise<void>;
  insertOfflineIcon: (icon: OfflineIconEntry) => Promise<void>;
  duplicateSelectedNode: () => Promise<void>;
  copySelectedNodes: () => void;
  cutSelectedNodes: () => Promise<void>;
  pasteCopiedNodes: (atCanvasPos?: { x: number; y: number }) => Promise<void>;
  copySelectedNodeStyle: () => void;
  pasteStyleToSelectedNodes: () => Promise<void>;
  setSimulatedCanvasState: (state: 'base' | InteractiveStateKey) => void;
  setHoveredBoxModelOverlay: (part: 'margin' | 'padding' | 'border' | null) => void;
  groupSelectedNodes: (preset?: GroupNodesPreset) => Promise<void>;
  ungroupSelectedContainer: () => Promise<void>;
  distributeSelectedNodes: (axis: 'horizontal' | 'vertical') => Promise<void>;
  upsertReusableCssClass: (cls: ReusableCssClass) => Promise<void>;
  deleteReusableCssClass: (classId: string) => Promise<void>;
  toggleNodeCssClass: (nodeId: NodeId, className: string) => Promise<void>;
  nudgeSelectedNodes: (dx: number, dy: number) => Promise<void>;
  alignSelectedNodes: (alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => Promise<void>;
  adjustSelectedZIndex: (delta: number) => Promise<void>;
  toggleNodeFreeformDetach: (nodeId?: NodeId) => Promise<void>;
  deleteSelectedNode: () => Promise<void>;
  reorderNode: (nodeId: NodeId, delta: -1 | 1) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  solveAutoLayoutOnActive: () => Promise<void>;

  // v3.0 External Scripts & No-Code Visual Automations Actions
  setActiveAutomationId: (automationId: string | null) => void;
  linkScriptFileToSheet: (ref: LinkedScriptModuleRef, sheetId?: string) => Promise<void>;
  unlinkScriptFileFromSheet: (vfsEntryIdOrPath: string, sheetId?: string) => Promise<void>;
  saveAndApplyAutomationRule: (
    rule: AutomationRule, compiledFileContent?: string, expectedFileContent?: string, sheetId?: string,
  ) => Promise<void>;
  deleteAutomationRule: (
    automationId: string, updatedFileContent?: string, expectedFileContent?: string, sheetId?: string,
  ) => Promise<void>;

  // v3.0 Multi-Dialect SQL & Data Studio Actions
  setActiveSqlDialect: (dialect: SqlDialect) => Promise<void>;
  setActiveSqlConnectionId: (connectionId: string | null) => void;
  loadSqlSchemaAction: (projectId?: string) => Promise<SqlDesignDocument | null>;
  saveSqlSchemaAction: (doc: SqlDesignDocument, silent?: boolean) => Promise<void>;
  executeSqlQueryAction: (
    req: Omit<SqlQueryRequest, 'projectId'> & { projectId?: string },
  ) => Promise<SqlQueryResult | null>;
  generateUiFromSqlTableAction: (input: {
    tableName: string;
    ops: UIPatchOp[];
    automations: AutomationRule[];
    stateEntries: UISheetStateSpec[];
  }) => Promise<void>;

  // v3.0 Real Disk Projects & Toolchain Runner Actions
  refreshToolchainDoctor: () => Promise<ToolchainDoctorReport | null>;
  createAndInitDiskProjectAction: (spec: DiskProjectInitSpec) => Promise<ProjectBootstrapPayload | null>;
  openExistingDiskProjectAction: (dirPath?: string) => Promise<ProjectBootstrapPayload | null>;
  runToolchainTaskAction: (
    req: Omit<ToolchainTaskRequest, 'projectId'> & { projectId?: string },
  ) => Promise<string | null>;
  stopToolchainTaskAction: (taskId: string) => Promise<void>;

  // Tokens Actions
  upsertDesignToken: (entry: Omit<DesignTokenEntry, 'id'> & { id?: string }) => Promise<void>;

  // Right Dock, Ollama Engine & AI Actions
  setRightPanelMode: (mode: StudioState['rightPanelMode']) => void;
  setRightPanelWidth: (w: number) => void;
  askAiAboutSelection: () => void;
  ensureOllamaRunningAction: (silentToast?: boolean) => Promise<EnsureOllamaResult>;
  refreshAiProviders: () => Promise<void>;
  setActiveProvider: (provider: LocalAIProviderKind) => void;
  setActiveModel: (model: string) => void;
  setAgentMode: (mode: AgentExecutionMode) => void;
  setVisionImageBase64: (b64: string | null) => void;
  sendAgentPrompt: (prompt: string) => Promise<void>;
  generateProjectWithAiAction: (req: GenerateProjectWithAiRequest) => Promise<void>;
  sendStartupChatPrompt: (prompt: string) => Promise<void>;
  clearStartupChat: () => void;
  restoreAiCheckpoint: (checkpointId: string) => Promise<void>;
  setUnslothModalOpen: (open: boolean) => void;
  setNewProjectModalOpen: (open: boolean) => void;
  setImportCodeModalOpen: (open: boolean) => void;
  setA11yModalOpen: (open: boolean) => void;
  pullUnslothModel: (ollamaUri: string) => Promise<void>;
  recordGoldenPairFromActiveSheet: (promptNote?: string) => Promise<void>;
  exportUnslothBundle: (format: 'sharegpt' | 'alpaca', baseModelRepo: string) => Promise<void>;
}

export function bundleCacheKey(sheetId: string, targetId: CodegenTargetId, dialect: StylingDialect): string {
  return `${sheetId}::${targetId}::${dialect}`;
}

export function codeOverrideKey(targetId: CodegenTargetId, dialect: StylingDialect): string {
  return `${targetId}::${dialect}`;
}

export function codeDraftKey(projectId: string, sheetId: string, targetId: CodegenTargetId, dialect: StylingDialect): string {
  return `${projectId}::${bundleCacheKey(sheetId, targetId, dialect)}`;
}

export function applyCodeDrafts(
  saved: Record<string, string> | undefined,
  drafts: Record<string, string | null> | undefined,
): Record<string, string> {
  const result = { ...saved };
  for (const [path, content] of Object.entries(drafts ?? {})) {
    if (content === null) delete result[path];
    else result[path] = content;
  }
  return result;
}

export function bundleWithCodeOverrides(
  bundle: TargetArtifactBundle,
  overrides: Record<string, string>,
): TargetArtifactBundle {
  return {
    ...bundle,
    files: bundle.files.map((file) => {
      const code = Object.hasOwn(overrides, file.relativePath) ? overrides[file.relativePath] : file.code;
      return code === file.code ? file : { ...file, code, sourceMap: [], diagnostics: [] };
    }),
  };
}

function resolveInsertionParent(sheet: UISheetDocument, selectedNodeIds: NodeId[]): NodeId | null {
  const selId = selectedNodeIds[0];
  if (selId && sheet.nodes[selId]) {
    const sel = sheet.nodes[selId];
    if (sel.kind === 'artboard' || sel.kind === 'container' || sel.kind === 'collection') {
      return sel.id;
    }
    if (sel.parentId && sheet.nodes[sel.parentId]) {
      return sel.parentId;
    }
  }
  return sheet.rootIds[0] ?? null;
}

function cloneNodeSubtreeFromMapAsPatches(
  sourceId: NodeId,
  parentId: NodeId | null,
  nodesMap: Record<NodeId, UINode>,
  offsetPx = 20,
  isRootClone = true,
  labelSuffix = 'Copy',
): { ops: UIPatchOp[]; rootId: NodeId | null } {
  const orig: UINode | undefined = nodesMap[sourceId];
  if (!orig) return { ops: [], rootId: null };
  const newId = generateNodeId('dup');
  const clonedFrame = isRootClone
    ? { ...orig.layout.frame, x: orig.layout.frame.x + offsetPx, y: orig.layout.frame.y + offsetPx }
    : { ...orig.layout.frame };

  const ops: UIPatchOp[] = [
    {
      op: 'insert_node',
      parentId,
      node: {
        ...structuredClone(orig),
        id: newId,
        name: isRootClone ? `${orig.name} ${labelSuffix}` : orig.name,
        childIds: [],
        layout: {
          ...structuredClone(orig.layout),
          frame: clonedFrame,
        },
      },
    },
  ];
  for (const cid of orig.childIds) {
    const childRes = cloneNodeSubtreeFromMapAsPatches(cid, newId, nodesMap, offsetPx, false, labelSuffix);
    ops.push(...childRes.ops);
  }
  return { ops, rootId: newId };
}

function collectSubtreeDictionary(rootId: NodeId, sheet: UISheetDocument, out: Record<NodeId, UINode>): void {
  const n = sheet.nodes[rootId];
  if (!n || out[rootId]) return;
  out[rootId] = structuredClone(n);
  for (const cid of n.childIds) {
    collectSubtreeDictionary(cid, sheet, out);
  }
}

function filterTopMostSelectedIds(selectedIds: NodeId[], sheet: UISheetDocument): NodeId[] {
  const selectedSet = new Set(selectedIds);
  return selectedIds.filter((id) => {
    let cur = sheet.nodes[id]?.parentId ?? null;
    const seen = new Set<NodeId>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (selectedSet.has(cur)) return false;
      cur = sheet.nodes[cur]?.parentId ?? null;
    }
    return Boolean(sheet.nodes[id]);
  });
}

const IDE_THEME_STORAGE_KEY = 'visual_ui_studio_ide_theme';

function readPreferredIdeTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  try {
    const saved = window.localStorage?.getItem(IDE_THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // ignore storage access restrictions
  }
  return 'dark';
}

if (typeof document !== 'undefined') {
  document.documentElement.dataset.theme = readPreferredIdeTheme();
}

let streamUnsubscribe: (() => void) | null = null;
let toolchainUnsubscribe: (() => void) | null = null;
let diskWatchUnsubscribe: (() => void) | null = null;
let pulseTimer: ReturnType<typeof setTimeout> | null = null;

function resolveScriptModulesForSheet(
  sheet: UISheetDocument | undefined,
  vfsTree: VfsNodeDTO[],
  sourceFiles: Record<string, string>,
): UIRScriptModuleDecl[] {
  if (!sheet) return [];
  const modules: UIRScriptModuleDecl[] = [];
  const seenPaths = new Set<string>();

  for (const linked of sheet.linkedScripts ?? []) {
    const code = sourceFiles[linked.vfsEntryId] ?? '';
    const rel = linked.relativePath.replace(/^\/+/, '');
    if (seenPaths.has(rel)) continue;
    seenPaths.add(rel);
    modules.push({
      vfsEntryId: linked.vfsEntryId,
      relativePath: rel,
      language: linked.language,
      loadStrategy: linked.loadStrategy,
      sourceCode: code,
      exportedFunctions: extractScriptFunctions(code).map((f) => f.name),
      autoInitOnLoad: linked.autoInitOnLoad,
    });
  }

  for (const entry of vfsTree) {
    if (entry.entryKind !== 'script_file' || entry.virtualPath.startsWith('/generated/')) continue;
    const rel = (entry.diskRelPath || entry.virtualPath).replace(/^\/+/, '');
    if (seenPaths.has(rel)) continue;
    const code = sourceFiles[entry.id];
    if (!code) continue;
    seenPaths.add(rel);
    const lower = entry.name.toLowerCase();
    const language = lower.endsWith('.py') ? 'python' : lower.endsWith('.ts') ? 'typescript' : 'javascript';
    modules.push({
      vfsEntryId: entry.id,
      relativePath: rel,
      language,
      loadStrategy: language === 'python' ? 'backend-route' : 'module',
      sourceCode: code,
      exportedFunctions: extractScriptFunctions(code).map((f) => f.name),
    });
  }

  return modules;
}

export const useStudioStore = create<StudioState>((set, get) => {
  const savingSourceDrafts = new Set<string>();
  const savingCodeSheets = new Set<string>();
  const writeAutomationModule = async (
    projectId: string,
    relativePath: string,
    compiledFileContent?: string,
    expectedFileContent?: string,
    entryId?: string,
  ) => {
    const relClean = relativePath
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    const segments = relClean.split('/');
    if (segments.some((part) => !part || part === '.' || part === '..' || part.includes(':'))) {
      throw new Error('Il file dell’automazione deve avere un percorso interno al progetto.');
    }
    const api = getStudioApi();
    const latestTree = await api.vfs.listTree(projectId);
    let vfsEntry = latestTree.find(
      (n) =>
        (entryId && n.id === entryId) ||
        n.virtualPath.replace(/^\/+/, '') === relClean ||
        n.diskRelPath?.replace(/^\/+/, '') === relClean,
    );

    if (!vfsEntry) {
      const fileName = segments.pop()!;
      let parentId: string | null = null;
      for (const name of segments) {
        const folder = latestTree.find((node) => node.parentId === parentId && node.name === name);
        if (folder && folder.entryKind !== 'folder') {
          throw new Error(`Il percorso dell’automazione contiene un file al posto della cartella "${name}".`);
        }
        parentId = folder?.id ?? (await api.vfs.createEntry({
          projectId,
          parentId,
          name,
          entryKind: 'folder',
        })).entry.id;
      }
      const created = await api.vfs.createEntry({
        projectId,
        parentId,
        name: fileName,
        entryKind: 'script_file',
        initialContent: compiledFileContent ?? '',
      });
      vfsEntry = created.entry;
      const refreshedTree = await api.vfs.listTree(projectId);
      if (get().project?.id === projectId) set({ vfsTree: refreshedTree });
    } else if (compiledFileContent !== undefined) {
      if (expectedFileContent !== undefined && (await api.vfs.readFile(vfsEntry.id)).content !== expectedFileContent) {
        throw new Error('Il file è stato modificato. Riaprilo per aggiornare l’automazione.');
      }
      await api.vfs.writeFile(vfsEntry.id, compiledFileContent);
    }

    if (get().project?.id === projectId && compiledFileContent !== undefined) {
      set((s) => ({
        sourceFiles: { ...s.sourceFiles, [vfsEntry.id]: compiledFileContent },
      }));
    }
    return vfsEntry;
  };

  const applyBootstrapPayload = async (payload: ProjectBootstrapPayload, markBootstrapped = true) => {
    const api = getStudioApi();
    const firstSheetSummary = payload.sheets[0];
    let firstDoc = payload.initialSheet;
    if (!firstDoc && firstSheetSummary) {
      firstDoc = await api.canvas.loadSheet(firstSheetSummary.id);
    }

    const activeSheetId = firstDoc?.sheetId ?? firstSheetSummary?.id ?? '';
    const sheetDocuments: Record<string, UISheetDocument> = {};
    if (firstDoc) {
      sheetDocuments[firstDoc.sheetId] = firstDoc;
    }

    const viewports: Record<string, { x: number; y: number; zoom: number }> = {};
    for (const s of payload.sheets) {
      viewports[s.id] = {
        x: s.viewportX || 24,
        y: s.viewportY || 20,
        zoom: s.viewportZoom && s.viewportZoom > 0.1 ? s.viewportZoom : 0.78,
      };
    }

    const primaryTarget = payload.project.primaryTarget || 'react-tsx';
    const targetMeta =
      BUILTIN_TARGET_DESCRIPTORS.find((t) => t.id === primaryTarget) ?? BUILTIN_TARGET_DESCRIPTORS[1];
    const stylingPreset = targetMeta.supportedDialects.includes(payload.project.stylingPreset)
      ? payload.project.stylingPreset
      : targetMeta.defaultDialect;

    // Preload script / blueprint / 3D scene files from VFS
    const sourceFiles: Record<string, string> = {};
    const blueprintGraphs: Record<string, BlueprintGraphDocument> = {};
    const threeScenes: Record<string, ThreeSceneDocument> = {};
    let activeBlueprintId: string | null = null;
    let activeThreeSceneId: string | null = null;
    let activeScriptVfsId: string | null = null;

    for (const entry of payload.vfsTree) {
      if (
        entry.entryKind === 'folder' ||
        entry.entryKind === 'canvas_sheet' ||
        entry.entryKind === 'component_doc' ||
        entry.entryKind === 'asset_ref'
      ) {
        continue;
      }
      try {
        const read = await api.vfs.readFile(entry.id);
        sourceFiles[entry.id] = read.content;

        if (entry.entryKind === 'script_file' || /\.(ts|js)$/i.test(entry.name)) {
          if (!activeScriptVfsId) activeScriptVfsId = entry.id;
        } else if (entry.entryKind === 'blueprint_graph' || entry.name.endsWith('.blueprint.json')) {
          const parsed = JSON.parse(read.content) as BlueprintGraphDocument;
          if (parsed && parsed.id && Array.isArray(parsed.nodes)) {
            blueprintGraphs[parsed.id] = parsed;
            if (!activeBlueprintId) activeBlueprintId = parsed.id;
          }
        } else if (entry.entryKind === 'three_scene' || entry.name.endsWith('.scene3d.json')) {
          const parsed3d = JSON.parse(read.content) as ThreeSceneDocument;
          if (parsed3d && parsed3d.id && Array.isArray(parsed3d.objects)) {
            threeScenes[parsed3d.id] = parsed3d;
            if (!activeThreeSceneId) activeThreeSceneId = parsed3d.id;
          }
        }
      } catch {
        // non-fatal VFS preload skip
      }
    }

    // Ensure at least 1 default in-memory Blueprint & Three.js scene exist so Blueprint/3D views open immediately
    if (!activeBlueprintId) {
      const starterBp = createStarterBlueprintGraph(payload.project.id, activeSheetId);
      blueprintGraphs[starterBp.id] = starterBp;
      activeBlueprintId = starterBp.id;
    }
    if (!activeThreeSceneId) {
      const starter3d = createThreeSceneFromPreset(payload.project.id, 'pbr-product-showcase');
      threeScenes[starter3d.id] = starter3d;
      activeThreeSceneId = starter3d.id;
    }

    const canvasTabId = `tab_canvas_${activeSheetId || 'main'}`;
    const codeTabId = `tab_code_${activeSheetId || 'main'}`;

    const initialGroups: EditorGroup[] = [
      {
        id: 'group_1',
        activeTabId: canvasTabId,
        tabs: [
          {
            id: canvasTabId,
            kind: 'canvas',
            title: `${firstDoc?.name ?? 'HomeDashboard'}.canvas`,
            sheetId: activeSheetId,
          },
          {
            id: codeTabId,
            kind: 'code',
            title: `Codice: ${firstDoc?.name ?? 'HomeDashboard'}`,
            sheetId: activeSheetId,
            targetId: primaryTarget,
            dialect: stylingPreset,
          },
          {
            id: `tab_preview_${activeSheetId || 'main'}`,
            kind: 'preview',
            title: `Preview: ${firstDoc?.name ?? 'HomeDashboard'}`,
            sheetId: activeSheetId,
          },
        ],
      },
    ];

    const studioTheme: 'dark' | 'light' = get().studioTheme || readPreferredIdeTheme();
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = studioTheme;
    }

    const rootNode = firstDoc?.rootIds[0] ? firstDoc.nodes[firstDoc.rootIds[0]] : undefined;
    const inferredPlacement: 'freeform' | 'auto' =
      payload.project.layoutMode === 'freeform' ||
      firstDoc?.defaultLayoutMode === 'freeform' ||
      rootNode?.layout.mode === 'freeform'
        ? 'freeform'
        : 'auto';

    const firstFolder = payload.vfsTree.find((n) => n.entryKind === 'folder')?.id ?? null;

    set((s) => ({
      bootstrapped: markBootstrapped ? true : s.bootstrapped,
      loadingError: null,
      project: payload.project,
      vfsTree: payload.vfsTree,
      sheets: payload.sheets,
      sheetDocuments,
      sourceFiles,
      blueprintGraphs,
      activeBlueprintId,
      threeScenes,
      activeThreeSceneId,
      activeScriptVfsId,
      themes: payload.themes,
      tokens: payload.tokens,
      studioTheme,
      globalTarget: primaryTarget,
      globalDialect: stylingPreset,
      activeSheetId,
      canvasPlacementMode: inferredPlacement,
      activeDrawingTool: 'select',
      selectedNodeIds: firstDoc?.rootIds[0] ? [firstDoc.rootIds[0]] : [],
      selectedFolderId: firstFolder,
      viewports,
      editorGroups: initialGroups,
      activeGroupId: 'group_1',
      splitOrientation: 'horizontal',
      groupSizes: [100],
      canUndo: false,
      canRedo: false,
      compiledBundles: {},
      sqlDocument: null,
      sqlConnections: [],
      activeSqlDialect: 'sqlite',
      activeSqlConnectionId: null,
      lastSqlQueryResult: null,
    }));

    if (activeSheetId) {
      void get().compileSheetForTarget(activeSheetId, primaryTarget, stylingPreset);
      try {
        const cps = await api.canvas.listCheckpoints(activeSheetId);
        set({ checkpoints: cps });
      } catch {
        // ignore non-critical checkpoint load error
      }
    }

    // Load project SQL schema & connections in background
    void get().loadSqlSchemaAction(payload.project.id);
  };

  return {
    bootstrapped: false,
    loadingError: null,

    showProjectHub: shouldShowProjectHubInitially(),
    hasOpenedProjectInSession: !shouldShowProjectHubInitially(),
    hubActiveSection: 'architect',
    wizardOpen: false,
    commandPaletteOpen: false,
    shortcutsHelpOpen: false,
    bottomConsoleOpen: false,
    bottomConsoleHeight: 168,
    consoleEntries: [
      {
        id: 'boot_log_1',
        kind: 'info',
        source: 'Studio IDE',
        message: 'Visual UI Studio v2.1 pronto — 26 target GUI, CSS Sync, Script TS, Blueprints, Three.js & Ollama Locale attivi.',
        timestamp: Date.now(),
      },
    ],

    project: null,
    recentProjects: [],
    vfsTree: [],
    sheets: [],
    sheetDocuments: {},
    sourceFiles: {},
    sourceDrafts: {},
    blueprintGraphs: {},
    activeBlueprintId: null,
    threeScenes: {},
    activeThreeSceneId: null,
    activeScriptVfsId: null,
    themes: [],
    tokens: [],
    targets: BUILTIN_TARGET_DESCRIPTORS,

    studioTheme: readPreferredIdeTheme(),
    activeBreakpointId: DEFAULT_BREAKPOINTS[0].id,
    globalTarget: 'react-tsx',
    globalDialect: 'tailwind',

    leftSidebarWidth: 288,
    leftTopRatio: 0.42,
    leftActiveMode: 'insert',
    selectedFolderId: null,

    editorGroups: [],
    activeGroupId: 'group_1',
    splitOrientation: 'horizontal',
    groupSizes: [100],

    activeSheetId: '',
    canvasPlacementMode: 'freeform',
    activeDrawingTool: 'select',
    showRulers: true,
    cursorCanvasPos: null,
    codeSelectPulseNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    viewports: {},
    snapToGrid8px: true,
    copiedClipboard: null,
    copiedNodeStyle: null,
    simulatedCanvasState: 'base',
    hoveredBoxModelOverlay: null,
    activeAutomationId: null,
    canUndo: false,
    canRedo: false,

    sqlDocument: null,
    activeSqlDialect: 'sqlite',
    sqlConnections: [],
    activeSqlConnectionId: null,
    lastSqlQueryResult: null,

    toolchainDoctor: null,
    toolchainTasks: [],

    compiledBundles: {},
    codeDrafts: {},
    compilingKeys: {},

    rightPanelMode: 'split',
    rightPanelWidth: 372,
    aiPromptFocusTick: 0,

    ollamaEnsureStatus: 'starting',
    ollamaStartedByApp: false,
    ollamaStatusMessage: 'Connessione automatica a Ollama (:11434)...',
    hardwareReport: null,
    providers: [],
    activeProvider: 'ollama',
    activeModel: 'qwen2.5-coder:7b',
    agentMode: 'prompt_to_ui',
    activeThreadId: null,
    messages: [],
    streamingRun: null,
    isRunningAgent: false,
    isGeneratingAiProject: false,
    aiProjectGenStatus: null,
    startupChatMessages: [],
    isRunningStartupChat: false,
    startupChatStreaming: null,
    visionImageBase64: null,
    checkpoints: [],
    unslothCatalog: [],
    unslothPairs: [],
    pullProgress: null,
    lastUnslothExport: null,

    isUnslothModalOpen: false,
    isNewProjectModalOpen: false,
    isImportCodeModalOpen: false,
    isA11yModalOpen: false,
    lastScaffoldExportDir: null,
    toasts: [],

    pushToast: (kind, message) => {
      const id = `toast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
      set((s) => ({ toasts: [...s.toasts.slice(-2), { id, kind, message }] }));
      setTimeout(() => {
        get().dismissToast(id);
      }, 3600);
    },

    dismissToast: (id) => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },

    setShowProjectHub: (open) => {
      set((s) => ({
        showProjectHub: open,
        hasOpenedProjectInSession: !open ? true : s.hasOpenedProjectInSession,
      }));
    },

    setHubActiveSection: (section) => {
      set({ hubActiveSection: section });
    },

    setWizardOpen: (open) => {
      set({ wizardOpen: open });
    },

    setCommandPaletteOpen: (open) => {
      set({ commandPaletteOpen: open });
    },

    setShortcutsHelpOpen: (open) => {
      set({ shortcutsHelpOpen: open });
    },

    setBottomConsoleOpen: (open) => {
      set({ bottomConsoleOpen: open });
    },

    setBottomConsoleHeight: (h) => {
      set({ bottomConsoleHeight: Math.max(110, Math.min(420, Math.round(h))) });
    },

    appendConsoleEntry: (entry) => {
      const full: ConsoleLogEntry = {
        ...entry,
        id: `clog_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
      };
      set((s) => ({
        consoleEntries: [full, ...s.consoleEntries.slice(0, 99)],
      }));
    },

    clearConsoleEntries: () => {
      set({ consoleEntries: [] });
    },

    initStudio: async () => {
      const api = getStudioApi();
      try {
        if (streamUnsubscribe) streamUnsubscribe();
        if (toolchainUnsubscribe) toolchainUnsubscribe();
        if (diskWatchUnsubscribe) diskWatchUnsubscribe();

        toolchainUnsubscribe = api.toolchain.onEvent((ev) => {
          if (ev.type === 'task_started') {
            set((s) => ({
              toolchainTasks: [ev.task, ...s.toolchainTasks.filter((t) => t.taskId !== ev.task.taskId)],
              bottomConsoleOpen: true,
            }));
            get().appendConsoleEntry({
              kind: 'terminal',
              source: ev.task.label,
              message: `▶ Avviato task "${ev.task.label}" in ${ev.task.cwd}`,
            });
          } else if (ev.type === 'stdout' || ev.type === 'stderr') {
            get().appendConsoleEntry({
              kind: ev.type === 'stderr' ? 'warn' : 'terminal',
              source: 'Toolchain',
              message: ev.line,
            });
          } else if (ev.type === 'server_ready') {
            set((s) => ({
              toolchainTasks: s.toolchainTasks.map((t) =>
                t.taskId === ev.taskId ? { ...t, serverUrl: ev.url } : t,
              ),
            }));
            get().appendConsoleEntry({
              kind: 'terminal',
              source: 'Dev Server',
              message: `🟢 Server attivo su ${ev.url}`,
            });
          } else if (ev.type === 'task_completed') {
            set((s) => ({
              toolchainTasks: s.toolchainTasks.map((t) =>
                t.taskId === ev.taskId
                  ? { ...t, status: ev.status, exitCode: ev.exitCode, endedAt: Date.now() }
                  : t,
              ),
            }));
            get().appendConsoleEntry({
              kind: ev.status === 'failed' ? 'error' : 'terminal',
              source: 'Toolchain',
              message: `Task terminato (${ev.status}, exit=${ev.exitCode ?? 0}, ${ev.durationMs}ms)`,
            });
          }
        });

        diskWatchUnsubscribe = api.toolchain.onDiskVfsChanged((ev) => {
          if (get().project?.id !== ev.projectId) return;
          void (async () => {
            const tree = await api.vfs.listTree(ev.projectId);
            if (get().project?.id !== ev.projectId) return;
            const before = get().sourceFiles;
            const changedPaths = new Set(ev.paths.map((path) => path.replace(/\\/g, '/')));
            const changedFiles = tree.filter((entry) =>
              entry.diskRelPath && changedPaths.has(entry.diskRelPath) &&
              (entry.id in before || entry.entryKind === 'script_file' || /\.(?:[cm]?[jt]s)$/i.test(entry.name)),
            );
            const refreshedFiles = await Promise.allSettled(
              changedFiles.map(async (entry) => [entry.id, (await api.vfs.readFile(entry.id)).content] as const),
            );
            set((state) => {
              if (state.project?.id !== ev.projectId) return state;
              const sourceFiles = { ...state.sourceFiles };
              for (const refreshed of refreshedFiles) {
                if (refreshed.status !== 'fulfilled') continue;
                const [id, content] = refreshed.value;
                if (sourceFiles[id] === before[id]) sourceFiles[id] = content;
              }
              return { vfsTree: tree, sourceFiles };
            });
          })().catch(() => {});
        });

        void get().refreshToolchainDoctor();
        streamUnsubscribe = api.ai.onAgentStreamEvent((ev) => {
          if (ev.type === 'run_started') {
            set((s) => ({
              streamingRun: {
                runId: ev.runId,
                text: '',
                thinking: '',
                toolCalls: [],
                preCheckpointId: ev.preCheckpointId,
              },
              startupChatStreaming:
                ev.threadId === 'startup-assistant' || ev.runId.startsWith('startup')
                  ? { runId: ev.runId, text: '', thinking: '' }
                  : s.startupChatStreaming,
            }));
          } else if (ev.type === 'project_gen_status') {
            set((s) => ({
              aiProjectGenStatus: {
                runId: ev.runId,
                status: ev.status,
                percent: ev.completedPercent ?? s.aiProjectGenStatus?.percent ?? 20,
                startedAt: s.aiProjectGenStatus?.startedAt ?? Date.now(),
                streamedTokens: s.aiProjectGenStatus?.streamedTokens ?? '',
              },
            }));
          } else if (ev.type === 'token_delta') {
            set((s) => {
              const nextStreamingRun = s.streamingRun
                ? {
                    ...s.streamingRun,
                    thinking: ev.isThinking ? s.streamingRun.thinking + ev.delta : s.streamingRun.thinking,
                    text: !ev.isThinking ? s.streamingRun.text + ev.delta : s.streamingRun.text,
                  }
                : null;

              const nextStartupChat =
                s.startupChatStreaming && s.startupChatStreaming.runId === ev.runId
                  ? {
                      ...s.startupChatStreaming,
                      thinking: ev.isThinking
                        ? s.startupChatStreaming.thinking + ev.delta
                        : s.startupChatStreaming.thinking,
                      text: !ev.isThinking
                        ? s.startupChatStreaming.text + ev.delta
                        : s.startupChatStreaming.text,
                    }
                  : s.startupChatStreaming;

              const nextProjGen =
                s.aiProjectGenStatus && s.aiProjectGenStatus.runId === ev.runId && !ev.isThinking
                  ? {
                      ...s.aiProjectGenStatus,
                      streamedTokens: (s.aiProjectGenStatus.streamedTokens + ev.delta).slice(-2400),
                    }
                  : s.aiProjectGenStatus;

              return {
                streamingRun: nextStreamingRun,
                startupChatStreaming: nextStartupChat,
                aiProjectGenStatus: nextProjGen,
              };
            });
          } else if (ev.type === 'tool_call') {
            set((s) => {
              if (!s.streamingRun) return s;
              const filtered = s.streamingRun.toolCalls.filter((tc) => tc.id !== ev.toolCall.id);
              return {
                streamingRun: {
                  ...s.streamingRun,
                  toolCalls: [...filtered, ev.toolCall],
                },
              };
            });
          } else if (ev.type === 'pull_progress') {
            set({
              pullProgress: {
                modelRef: ev.modelRef,
                status: ev.status,
                percent: ev.completedPercent,
              },
            });
          } else if (ev.type === 'run_completed' || ev.type === 'run_error') {
            set((s) => ({
              streamingRun: null,
              startupChatStreaming:
                s.startupChatStreaming?.runId === ev.runId ? null : s.startupChatStreaming,
            }));
          }
        });

        // Immediately start / verify Ollama in parallel with workspace bootstrap
        const ollamaBootPromise = get()
          .ensureOllamaRunningAction(true)
          .catch(() => null);

        let bootstrap: ProjectBootstrapPayload | null = null;
        try {
          bootstrap = await api.project.getCurrent();
        } catch {
          bootstrap = null;
        }
        if (!bootstrap || !bootstrap.project) {
          const recents = await api.project.listRecent().catch(() => []);
          if (recents.length > 0) {
            bootstrap = await api.project.open(recents[0].id);
          } else {
            bootstrap = await api.project.create({
              name: 'NovaCommerce Studio',
              primaryTarget: 'react-tsx',
              stylingPreset: 'tailwind',
              seedDemoContent: true,
            });
          }
        }

        await applyBootstrapPayload(bootstrap, false);

        const [targets, recentProjects, hw, provsRaw, catalog, pairs, threads, ollamaQuick] = await Promise.all([
          api.codegen.listTargets().catch(() => BUILTIN_TARGET_DESCRIPTORS),
          api.project.listRecent().catch(() => []),
          api.ai.getHardwareReport().catch(() => null),
          api.ai.listProvidersAndModels().catch(() => []),
          api.ai.getUnslothCatalog().catch(() => []),
          api.ai.listUnslothPairs(bootstrap.project.id).catch(() => []),
          api.ai.listThreads(bootstrap.project.id).catch(() => []),
          Promise.race([
            ollamaBootPromise,
            new Promise<EnsureOllamaResult | null>((resolve) => setTimeout(() => resolve(null), 2400)),
          ]),
        ]);

        // Sanitize local models so embedding-only models are never offered as chat/UI generators
        const provs: LocalAIProviderStatus[] = provsRaw.map((p) =>
          p.id === 'ollama' || p.id === 'lmstudio'
            ? { ...p, models: filterAndRankLocalModels(p.models) }
            : p,
        );

        const currentState = get();
        const ollamaProv = provs.find((p) => p.id === 'ollama');
        const ollamaIsOnline = Boolean(ollamaQuick?.online || ollamaProv?.online || currentState.ollamaEnsureStatus === 'online');

        let chosenProv: LocalAIProviderKind = currentState.activeProvider;
        let chosenModel: string = currentState.activeModel;

        if (ollamaIsOnline) {
          chosenProv = 'ollama';
          const rankedModels = filterAndRankLocalModels(
            ollamaQuick?.models?.length ? ollamaQuick.models : (ollamaProv?.models ?? []),
          );
          const pref =
            ollamaQuick?.preferredModel && !isEmbeddingOnlyModelName(ollamaQuick.preferredModel)
              ? ollamaQuick.preferredModel
              : pickPreferredLocalModel(rankedModels);
          chosenModel = pref || rankedModels[0]?.id || chosenModel;
        } else {
          const onlineOther = provs.find((p) => p.online && p.id !== 'builtin_offline' && p.models.length > 0);
          chosenProv = onlineOther
            ? onlineOther.id
            : provs.find((p) => p.id === 'builtin_offline')?.id ?? 'ollama';
          chosenModel =
            onlineOther?.models[0]?.id ??
            provs.find((p) => p.id === chosenProv)?.models[0]?.id ??
            'offline-studio-architect-v1';
        }

        let initialMessages: AgentChatMessageDTO[] = [];
        const activeThreadId = threads[0]?.id ?? null;
        if (activeThreadId) {
          initialMessages = await api.ai.getThreadMessages(activeThreadId).catch(() => []);
        }

        set((s) => ({
          bootstrapped: true,
          targets: targets.length > 0 ? targets : BUILTIN_TARGET_DESCRIPTORS,
          recentProjects,
          hardwareReport: hw,
          providers: s.providers.length > 0 && s.ollamaEnsureStatus === 'online' ? s.providers : provs,
          activeProvider: chosenProv,
          activeModel: chosenModel,
          unslothCatalog: catalog,
          unslothPairs: pairs,
          activeThreadId,
          messages: initialMessages,
        }));
      } catch (err) {
        set({
          bootstrapped: true,
          loadingError: err instanceof Error ? err.message : String(err),
        });
      }
    },

    createNewProject: async (name, target, dialect, layoutMode = 'freeform') => {
      const api = getStudioApi();
      const payload = await api.project.create({
        name: name.trim() || 'Nuovo Progetto UI',
        primaryTarget: target,
        stylingPreset: dialect,
        layoutMode,
        seedDemoContent: layoutMode === 'auto',
      });
      await applyBootstrapPayload(payload);
      const recents = await api.project.listRecent().catch(() => []);
      set({
        recentProjects: recents,
        isNewProjectModalOpen: false,
        wizardOpen: false,
        showProjectHub: false,
        hasOpenedProjectInSession: true,
        canvasPlacementMode: layoutMode,
        messages: [],
        activeThreadId: null,
      });
      get().pushToast('success', `Progetto "${payload.project.name}" creato e caricato!`);
    },

    createProjectFromWizard: async (spec) => {
      const api = getStudioApi();
      const payload = await api.project.createFromWizard(spec);
      await applyBootstrapPayload(payload);
      if (spec.defaultThemeMode === 'light' || spec.defaultThemeMode === 'dark') {
        await get().setStudioTheme(spec.defaultThemeMode);
      }
      const recents = await api.project.listRecent().catch(() => []);
      set({
        recentProjects: recents,
        wizardOpen: false,
        isNewProjectModalOpen: false,
        showProjectHub: false,
        hasOpenedProjectInSession: true,
        canvasPlacementMode: spec.layoutMode,
        messages: [],
        activeThreadId: null,
      });
      get().appendConsoleEntry({
        kind: 'info',
        source: 'Wizard',
        message: `Generato progetto "${payload.project.name}" (${spec.primaryTarget} • ${spec.layoutMode}) con ${payload.vfsTree.length} voci VFS.`,
      });
      get().pushToast('success', `Progetto "${payload.project.name}" generato dal Wizard!`);
    },

    createQuickFreeformProject: async (name = 'Tela Libera Studio') => {
      await get().createProjectFromWizard({
        name,
        category: 'web',
        primaryTarget: get().globalTarget || 'html-vanilla',
        stylingPreset: 'vanilla-css',
        layoutMode: 'freeform',
        starterPages: ['home'],
        includeTsScript: true,
        includeBlueprint: true,
        includeThreeScene: true,
        threePresetId: 'pbr-product-showcase',
        paletteId: 'dark-pro',
        defaultThemeMode: 'dark',
        seedDemoContent: false,
      });
    },

    openDemoProject: async () => {
      const api = getStudioApi();
      const recents = await api.project.listRecent().catch(() => []);
      const existingDemo = recents.find((r) => r.name.toLowerCase().includes('novacommerce'));
      if (existingDemo) {
        await get().openRecentProject(existingDemo.id);
        return;
      }
      const payload = await api.project.create({
        name: 'NovaCommerce Studio',
        primaryTarget: 'react-tsx',
        stylingPreset: 'tailwind',
        layoutMode: 'auto',
        seedDemoContent: true,
      });
      await applyBootstrapPayload(payload);
      const updatedRecents = await api.project.listRecent().catch(() => []);
      set({
        recentProjects: updatedRecents,
        showProjectHub: false,
        hasOpenedProjectInSession: true,
        wizardOpen: false,
      });
      get().pushToast('success', 'Demo completa NovaCommerce aperta!');
    },

    openRecentProject: async (projectId) => {
      const api = getStudioApi();
      const payload = await api.project.open(projectId);
      await applyBootstrapPayload(payload);
      set({
        isNewProjectModalOpen: false,
        wizardOpen: false,
        showProjectHub: false,
        hasOpenedProjectInSession: true,
      });
      get().pushToast('info', `Progetto "${payload.project.name}" aperto.`);
    },

    removeRecentProject: async (projectId) => {
      const api = getStudioApi();
      try {
        const updated = await api.project.removeRecent(projectId);
        set({ recentProjects: updated });
        get().pushToast('info', 'Progetto rimosso dalla cronologia recenti.');
      } catch (err) {
        set((s) => ({ recentProjects: s.recentProjects.filter((p) => p.id !== projectId) }));
        get().pushToast('warn', err instanceof Error ? err.message : 'Progetto rimosso.');
      }
    },

    linkDiskFolder: async () => {
      const { project } = get();
      if (!project) return;
      try {
        const res = await getStudioApi().project.linkDiskDirectory(project.id);
        const tree = await getStudioApi().vfs.listTree(project.id).catch(() => get().vfsTree);
        set((s) => ({
          project: s.project ? { ...s.project, rootDiskPath: res.rootDiskPath } : null,
          vfsTree: tree,
          showProjectHub: false,
          hasOpenedProjectInSession: true,
        }));
        get().pushToast('success', `Cartella collegata: ${res.rootDiskPath} (${res.syncedCount} voci)`);
      } catch (err) {
        get().pushToast('warn', err instanceof Error ? err.message : 'Collegamento cartella annullato.');
      }
    },

    setStudioTheme: async (theme) => {
      if (typeof document !== 'undefined') {
        document.documentElement.dataset.theme = theme;
      }
      if (typeof window !== 'undefined') {
        try {
          window.localStorage?.setItem(IDE_THEME_STORAGE_KEY, theme);
        } catch {
          // ignore storage restrictions
        }
      }
      const { project, themes } = get();
      const matching = themes.find((t) => t.name.toLowerCase() === theme);
      set({ studioTheme: theme });
      if (project && matching) {
        try {
          const updated = await getStudioApi().project.updateSettings(project.id, { activeThemeId: matching.id });
          set({ project: updated });
        } catch {
          set((s) => ({ project: s.project ? { ...s.project, activeThemeId: matching.id } : null }));
        }
      }
    },

    setActiveBreakpoint: (bpId) => {
      set({ activeBreakpointId: bpId });
    },

    setGlobalTarget: async (targetId) => {
      const { project, targets, activeSheetId, editorGroups } = get();
      const desc = targets.find((t) => t.id === targetId) ?? BUILTIN_TARGET_DESCRIPTORS[0];
      const nextDialect = desc.supportedDialects.includes(get().globalDialect)
        ? get().globalDialect
        : desc.defaultDialect;

      const nextGroups = editorGroups.map((g) => ({
        ...g,
        tabs: g.tabs.map((tab) =>
          tab.kind === 'code' ? { ...tab, targetId, dialect: nextDialect, activeFilePath: undefined } : tab,
        ),
      }));

      set({ globalTarget: targetId, globalDialect: nextDialect, editorGroups: nextGroups });

      if (project) {
        void getStudioApi()
          .project.updateSettings(project.id, { primaryTarget: targetId, stylingPreset: nextDialect })
          .then((updated) => set({ project: updated }))
          .catch(() => {});
      }
      if (activeSheetId) {
        void get().compileSheetForTarget(activeSheetId, targetId, nextDialect);
      }
    },

    applyLayoutPreset: (preset) => {
      const {
        activeSheetId,
        sheetDocuments,
        globalTarget,
        globalDialect,
        activeBlueprintId,
        activeThreeSceneId,
        activeScriptVfsId,
      } = get();
      const sheetName = sheetDocuments[activeSheetId]?.name ?? 'HomeDashboard';
      const cTab: WorkspaceTab = {
        id: `tab_canvas_${activeSheetId}`,
        kind: 'canvas',
        title: `${sheetName}.canvas`,
        sheetId: activeSheetId,
      };
      const cssTab: WorkspaceTab = {
        id: `tab_css_${activeSheetId}`,
        kind: 'css',
        title: `CSS: ${sheetName}`,
        sheetId: activeSheetId,
      };
      const codeTab: WorkspaceTab = {
        id: `tab_code_${activeSheetId}`,
        kind: 'code',
        title: `Codice: ${sheetName}`,
        sheetId: activeSheetId,
        targetId: globalTarget,
        dialect: globalDialect,
      };
      const prevTab: WorkspaceTab = {
        id: `tab_preview_${activeSheetId}`,
        kind: 'preview',
        title: `Preview: ${sheetName}`,
        sheetId: activeSheetId,
      };
      const bpTab: WorkspaceTab = {
        id: `tab_bp_${activeBlueprintId || 'main'}`,
        kind: 'blueprint',
        title: `Blueprint: Logica Visuale`,
        sheetId: activeSheetId,
        blueprintId: activeBlueprintId ?? undefined,
      };
      const scriptTab: WorkspaceTab = {
        id: `tab_script_${activeScriptVfsId || 'main'}`,
        kind: 'script',
        title: `Script TS/JS`,
        sheetId: activeSheetId,
        vfsEntryId: activeScriptVfsId ?? undefined,
      };
      const threeTab: WorkspaceTab = {
        id: `tab_three_${activeThreeSceneId || 'main'}`,
        kind: 'three_scene',
        title: `Studio 3D Three.js`,
        sheetId: activeSheetId,
        threeSceneId: activeThreeSceneId ?? undefined,
      };
      const autoTab: WorkspaceTab = {
        id: `tab_auto_${activeSheetId || 'main'}`,
        kind: 'automation',
        title: `Automazioni No-Code`,
        sheetId: activeSheetId,
        vfsEntryId: activeScriptVfsId ?? undefined,
      };
      const sqlTab: WorkspaceTab = {
        id: `tab_sql_${get().project?.id || 'main'}`,
        kind: 'sql_studio',
        title: `SQL & Data Studio`,
        sheetId: activeSheetId,
      };

      if (preset === 'canvas') {
        set({
          splitOrientation: 'horizontal',
          activeGroupId: 'group_1',
          groupSizes: [100],
          editorGroups: [{ id: 'group_1', activeTabId: cTab.id, tabs: [cTab, cssTab, codeTab, prevTab] }],
        });
      } else if (preset === 'split-css') {
        set({
          splitOrientation: 'horizontal',
          activeGroupId: 'group_2',
          groupSizes: [56, 44],
          editorGroups: [
            { id: 'group_1', activeTabId: cTab.id, tabs: [cTab] },
            { id: 'group_2', activeTabId: cssTab.id, tabs: [cssTab, codeTab] },
          ],
        });
      } else if (preset === 'split-code') {
        set({
          splitOrientation: 'horizontal',
          activeGroupId: 'group_2',
          groupSizes: [54, 46],
          editorGroups: [
            { id: 'group_1', activeTabId: cTab.id, tabs: [cTab, cssTab] },
            { id: 'group_2', activeTabId: codeTab.id, tabs: [codeTab, prevTab] },
          ],
        });
        if (activeSheetId) void get().compileSheetForTarget(activeSheetId, globalTarget, globalDialect);
      } else if (preset === 'split-blueprint') {
        void get().ensureActiveBlueprintGraph();
        set({
          splitOrientation: 'horizontal',
          activeGroupId: 'group_2',
          groupSizes: [44, 56],
          editorGroups: [
            { id: 'group_1', activeTabId: cTab.id, tabs: [cTab, prevTab] },
            { id: 'group_2', activeTabId: bpTab.id, tabs: [bpTab, scriptTab] },
          ],
        });
      } else if (preset === 'split-script') {
        void get().ensureActiveScriptFile();
        set({
          splitOrientation: 'horizontal',
          activeGroupId: 'group_2',
          groupSizes: [48, 52],
          editorGroups: [
            { id: 'group_1', activeTabId: cTab.id, tabs: [cTab, prevTab] },
            { id: 'group_2', activeTabId: scriptTab.id, tabs: [scriptTab, autoTab, bpTab] },
          ],
        });
      } else if (preset === 'split-automation') {
        void get().ensureActiveScriptFile();
        set({
          splitOrientation: 'horizontal',
          activeGroupId: 'group_2',
          groupSizes: [46, 54],
          editorGroups: [
            { id: 'group_1', activeTabId: cTab.id, tabs: [cTab, prevTab] },
            { id: 'group_2', activeTabId: autoTab.id, tabs: [autoTab, scriptTab] },
          ],
        });
      } else if (preset === 'split-sql') {
        void get().loadSqlSchemaAction();
        set({
          splitOrientation: 'horizontal',
          activeGroupId: 'group_2',
          groupSizes: [45, 55],
          editorGroups: [
            { id: 'group_1', activeTabId: cTab.id, tabs: [cTab, prevTab] },
            { id: 'group_2', activeTabId: sqlTab.id, tabs: [sqlTab, autoTab] },
          ],
        });
      } else if (preset === 'three-studio') {
        void get().ensureActiveThreeScene();
        set({
          splitOrientation: 'horizontal',
          activeGroupId: 'group_1',
          groupSizes: [100],
          editorGroups: [{ id: 'group_1', activeTabId: threeTab.id, tabs: [threeTab, cTab, codeTab] }],
        });
      } else {
        set({
          splitOrientation: 'horizontal',
          activeGroupId: 'group_2',
          groupSizes: [52, 48],
          editorGroups: [
            { id: 'group_1', activeTabId: cTab.id, tabs: [cTab, codeTab] },
            { id: 'group_2', activeTabId: prevTab.id, tabs: [prevTab] },
          ],
        });
      }
    },

    openSplitMode: (preset) => {
      get().applyLayoutPreset(preset);
    },

    setLeftSidebarWidth: (w) => {
      set({ leftSidebarWidth: Math.max(256, Math.min(480, w)) });
    },

    setLeftTopRatio: (r) => {
      set({ leftTopRatio: Math.max(0.22, Math.min(0.72, r)) });
    },

    setLeftActiveMode: (mode) => {
      set({ leftActiveMode: mode });
      const { project } = get();
      if (project) {
        void getStudioApi().workspace.saveState(project.id, { leftActiveMode: mode }).catch(() => {});
      }
    },

    setSelectedFolderId: (folderId) => {
      set({ selectedFolderId: folderId });
    },

    createVfsEntry: async (name, kind, explicitParentId, explicitInitialContent) => {
      const { project, selectedFolderId } = get();
      if (!project || !name.trim()) return null;
      const parentId = explicitParentId !== undefined ? explicitParentId : selectedFolderId;
      const api = getStudioApi();

      let initialContent = explicitInitialContent;
      let cleanName = name.trim();
      if (kind === 'style_file' && !cleanName.endsWith('.css')) cleanName = `${cleanName}.css`;
      if (kind === 'script_file' && !/\.(ts|js)$/i.test(cleanName)) cleanName = `${cleanName}.ts`;
      if (kind === 'blueprint_graph' && !cleanName.endsWith('.blueprint.json')) {
        cleanName = `${cleanName.replace(/\.json$/i, '')}.blueprint.json`;
      }
      if (kind === 'three_scene' && !cleanName.endsWith('.scene3d.json')) {
        cleanName = `${cleanName.replace(/\.json$/i, '')}.scene3d.json`;
      }

      if (initialContent === undefined) {
        if (kind === 'script_file') {
          initialContent = createStarterScriptModuleTs(project.name);
        } else if (kind === 'blueprint_graph') {
          const bp = createStarterBlueprintGraph(project.id, get().activeSheetId);
          bp.name = cleanName.replace(/\.blueprint\.json$/i, '');
          initialContent = JSON.stringify(bp, null, 2);
        } else if (kind === 'three_scene') {
          const sc = createThreeSceneFromPreset(project.id, 'pbr-product-showcase');
          sc.name = cleanName.replace(/\.scene3d\.json$/i, '');
          initialContent = JSON.stringify(sc, null, 2);
        } else if (kind === 'style_file') {
          initialContent = `/* Stili custom: ${cleanName} */\n`;
        }
      }

      const res = await api.vfs.createEntry({
        projectId: project.id,
        parentId,
        name: cleanName,
        entryKind: kind,
        initialContent,
        targetFramework: kind === 'source_file' || kind === 'script_file' ? get().globalTarget : undefined,
      });
      const nextTree = await api.vfs.listTree(project.id);
      const nextSheets = await api.canvas.listSheets(project.id);

      set((s) => ({
        vfsTree: nextTree,
        sheets: nextSheets,
        selectedFolderId: kind === 'folder' ? res.entry.id : s.selectedFolderId,
        sourceFiles:
          initialContent !== undefined ? { ...s.sourceFiles, [res.entry.id]: initialContent } : s.sourceFiles,
        sheetDocuments: res.createdSheet
          ? { ...s.sheetDocuments, [res.createdSheet.sheetId]: res.createdSheet }
          : s.sheetDocuments,
      }));

      if (kind === 'canvas_sheet' && (res.createdSheet || res.entry.sheetId)) {
        const sid = res.createdSheet?.sheetId ?? res.entry.sheetId!;
        const doc = res.createdSheet ?? (await api.canvas.loadSheet(sid));
        set((s) => ({
          sheetDocuments: { ...s.sheetDocuments, [sid]: doc },
          activeSheetId: sid,
          selectedNodeIds: doc.rootIds[0] ? [doc.rootIds[0]] : [],
          viewports: { ...s.viewports, [sid]: { x: 24, y: 20, zoom: 0.78 } },
        }));
        get().openTabInGroup({
          kind: 'canvas',
          title: res.entry.name,
          sheetId: sid,
        });
        void get().compileSheetForTarget(sid, get().globalTarget, get().globalDialect);
      } else if (kind !== 'folder') {
        await get().openVfsNode(res.entry);
      }
      get().pushToast('success', `Creato: ${res.entry.name}`);
      return res.entry;
    },

    renameVfsEntry: async (entryId, newName) => {
      const { project } = get();
      if (!project || !newName.trim()) return;
      const api = getStudioApi();
      await api.vfs.renameEntry(entryId, newName.trim());
      const [nextTree, nextSheets] = await Promise.all([
        api.vfs.listTree(project.id),
        api.canvas.listSheets(project.id),
      ]);
      set({ vfsTree: nextTree, sheets: nextSheets });
      get().pushToast('info', `Rinominato in "${newName.trim()}"`);
    },

    moveVfsEntry: async (entryId, newParentId) => {
      const { project } = get();
      if (!project || entryId === newParentId) return;
      const api = getStudioApi();
      await api.vfs.moveEntry(entryId, newParentId);
      const nextTree = await api.vfs.listTree(project.id);
      set({ vfsTree: nextTree });
      get().pushToast('info', 'Percorso elemento aggiornato.');
    },

    deleteVfsEntry: async (entryId) => {
      const { project } = get();
      if (!project) return;
      const api = getStudioApi();
      await api.vfs.deleteEntry(entryId, false);
      const [nextTree, nextSheets] = await Promise.all([
        api.vfs.listTree(project.id),
        api.canvas.listSheets(project.id),
      ]);
      set((s) => ({
        vfsTree: nextTree,
        sheets: nextSheets,
        selectedFolderId: s.selectedFolderId === entryId ? null : s.selectedFolderId,
      }));
      get().pushToast('info', 'Elemento rimosso dal progetto.');
    },

    openVfsSource: async (node, groupId) => {
      if (!isTextFileVfsKind(node.entryKind) || get().project?.id !== node.projectId) return false;
      try {
        const { content } = await getStudioApi().vfs.readFile(node.id);
        if (get().project?.id !== node.projectId) return false;
        set((s) => ({ sourceFiles: { ...s.sourceFiles, [node.id]: content } }));
        get().openTabInGroup({ kind: 'source_file', title: node.name, vfsEntryId: node.id }, groupId);
        return true;
      } catch (error) {
        get().pushToast('error', error instanceof Error ? error.message : 'Impossibile aprire il sorgente.');
        return false;
      }
    },

    openVfsNode: async (node, mode) => {
      const api = getStudioApi();
      if (node.entryKind === 'folder') {
        set({ selectedFolderId: node.id });
        return;
      }
      if ((node.entryKind === 'canvas_sheet' || node.entryKind === 'component_doc') && node.sheetId) {
        let doc = get().sheetDocuments[node.sheetId];
        if (!doc) {
          doc = await api.canvas.loadSheet(node.sheetId);
          set((s) => ({
            sheetDocuments: { ...s.sheetDocuments, [node.sheetId!]: doc },
            viewports: s.viewports[node.sheetId!]
              ? s.viewports
              : { ...s.viewports, [node.sheetId!]: { x: 24, y: 20, zoom: 0.78 } },
          }));
        }
        set({
          activeSheetId: node.sheetId,
          selectedNodeIds: doc.rootIds[0] ? [doc.rootIds[0]] : [],
        });
        get().openTabInGroup({
          kind: 'canvas',
          title: node.name,
          sheetId: node.sheetId,
        });
        void get().compileSheetForTarget(node.sheetId, get().globalTarget, get().globalDialect);
        return;
      }

      if (node.entryKind === 'asset_ref') {
        if (/\.(sqlite|sqlite3|db|db3)$/i.test(node.name)) {
          void get().loadSqlSchemaAction();
          get().openTabInGroup({
            kind: 'sql_studio',
            title: `SQL: ${node.name}`,
            vfsEntryId: node.id,
            sheetId: get().activeSheetId,
          });
          return;
        }
        get().pushToast('info', `Asset binario selezionato: ${node.name}`);
        return;
      }

      const res = await api.vfs.readFile(node.id);
      set((s) => ({ sourceFiles: { ...s.sourceFiles, [node.id]: res.content } }));

      if (mode !== 'workbench' && node.diskRelPath && /\.(?:[cm]?[jt]sx?|py|css|sql)$/i.test(node.name)) {
        get().openTabInGroup({ kind: 'source_file', title: node.name, vfsEntryId: node.id });
        return;
      }

      if (
        node.entryKind === 'sql_schema' ||
        node.entryKind === 'sql_file' ||
        node.name.toLowerCase().endsWith('.sql') ||
        node.name.toLowerCase().endsWith('.schema.sql.json')
      ) {
        if (node.entryKind === 'sql_schema' || node.name.toLowerCase().endsWith('.schema.sql.json')) {
          try {
            const parsedSql = JSON.parse(res.content) as SqlDesignDocument;
            if (parsedSql && Array.isArray(parsedSql.tables)) {
              set({ sqlDocument: parsedSql, activeSqlDialect: parsedSql.dialect });
            }
          } catch {
            // fallback
          }
        } else {
          void get().loadSqlSchemaAction();
        }
        get().openTabInGroup({
          kind: 'sql_studio',
          title: `SQL: ${node.name}`,
          vfsEntryId: node.id,
          sheetId: get().activeSheetId,
        });
        return;
      }

      if (node.entryKind === 'style_file' || node.name.toLowerCase().endsWith('.css')) {
        get().openTabInGroup({
          kind: 'css',
          title: `CSS: ${node.name}`,
          sheetId: get().activeSheetId,
          vfsEntryId: node.id,
        });
        return;
      }

      const isConfigOrEntryCode =
        /\.(config|conf)\.[cm]?[jt]s$/i.test(node.name) ||
        /^(main|app|server|index)\.[jt]sx?$/i.test(node.name);

      if (
        node.entryKind === 'script_file' ||
        (!isConfigOrEntryCode &&
          /\.(ts|js|py)$/i.test(node.name) &&
          (node.virtualPath.toLowerCase().includes('/scripts/') ||
            node.virtualPath.toLowerCase().includes('/automations/')))
      ) {
        set({ activeScriptVfsId: node.id });
        get().openTabInGroup({
          kind: 'script',
          title: `Script: ${node.name}`,
          sheetId: get().activeSheetId,
          vfsEntryId: node.id,
        });
        return;
      }

      if (node.entryKind === 'blueprint_graph' || node.name.toLowerCase().endsWith('.blueprint.json')) {
        try {
          const parsed = JSON.parse(res.content) as BlueprintGraphDocument;
          set((s) => ({
            blueprintGraphs: { ...s.blueprintGraphs, [parsed.id]: parsed },
            activeBlueprintId: parsed.id,
          }));
          get().openTabInGroup({
            kind: 'blueprint',
            title: `Blueprint: ${parsed.name || node.name}`,
            vfsEntryId: node.id,
            blueprintId: parsed.id,
            sheetId: get().activeSheetId,
          });
          return;
        } catch {
          // fallback to source_file
        }
      }

      if (node.entryKind === 'three_scene' || node.name.toLowerCase().endsWith('.scene3d.json')) {
        try {
          const parsed3d = JSON.parse(res.content) as ThreeSceneDocument;
          set((s) => ({
            threeScenes: { ...s.threeScenes, [parsed3d.id]: parsed3d },
            activeThreeSceneId: parsed3d.id,
          }));
          get().openTabInGroup({
            kind: 'three_scene',
            title: `3D: ${parsed3d.name || node.name}`,
            vfsEntryId: node.id,
            threeSceneId: parsed3d.id,
            sheetId: get().activeSheetId,
          });
          return;
        } catch {
          // fallback to source_file
        }
      }

      get().openTabInGroup({
        kind: 'source_file',
        title: node.name,
        vfsEntryId: node.id,
      });
    },

    saveSourceFileContent: async (vfsEntryId, content, silent = false, expectedContent) => {
      const projectId = get().project?.id;
      const { vfs } = getStudioApi();
      try {
        await vfs.writeFile(vfsEntryId, content, expectedContent);
      } catch (error) {
        if (expectedContent !== undefined && get().project?.id === projectId) {
          const latest = await vfs.readFile(vfsEntryId).catch(() => null);
          if (latest && get().project?.id === projectId) {
            set((s) => ({ sourceFiles: { ...s.sourceFiles, [vfsEntryId]: latest.content } }));
          }
        }
        throw error;
      }
      if (get().project?.id !== projectId) return;
      set((s) => ({ sourceFiles: { ...s.sourceFiles, [vfsEntryId]: content } }));
      if (!silent) {
        get().pushToast('success', 'File salvato su VFS / Disco.');
      }
    },

    setSourceDraft: (vfsEntryId, draft) => {
      set((s) => {
        const next = { ...s.sourceDrafts };
        if (!draft || draft.content === draft.baseContent) delete next[vfsEntryId];
        else next[vfsEntryId] = draft;
        return { sourceDrafts: next };
      });
    },

    saveSourceDraft: async (vfsEntryId, silent = false) => {
      const draft = get().sourceDrafts[vfsEntryId];
      if (!draft) return true;
      if (savingSourceDrafts.has(vfsEntryId)) return false;
      savingSourceDrafts.add(vfsEntryId);
      try {
        await get().saveSourceFileContent(vfsEntryId, draft.content, silent, draft.baseContent);
        const latest = get().sourceDrafts[vfsEntryId];
        if (latest?.baseContent === draft.baseContent) {
          get().setSourceDraft(vfsEntryId, { ...latest, baseContent: draft.content });
        }
        return true;
      } catch (error) {
        get().pushToast('error', error instanceof Error ? error.message : 'Impossibile salvare il sorgente.');
        return false;
      } finally {
        savingSourceDrafts.delete(vfsEntryId);
      }
    },

    ensureActiveBlueprintGraph: async () => {
      const { project, vfsTree, blueprintGraphs, activeBlueprintId, activeSheetId } = get();
      const existingEntry = vfsTree.find(
        (n) => n.entryKind === 'blueprint_graph' || n.name.endsWith('.blueprint.json'),
      );
      if (existingEntry && activeBlueprintId && blueprintGraphs[activeBlueprintId]) {
        return { vfsEntryId: existingEntry.id, graph: blueprintGraphs[activeBlueprintId] };
      }
      const graph =
        (activeBlueprintId ? blueprintGraphs[activeBlueprintId] : undefined) ??
        createStarterBlueprintGraph(project?.id ?? 'proj_local', activeSheetId);
      set((s) => ({
        blueprintGraphs: { ...s.blueprintGraphs, [graph.id]: graph },
        activeBlueprintId: graph.id,
      }));
      if (existingEntry) {
        return { vfsEntryId: existingEntry.id, graph };
      }
      if (!project) return { vfsEntryId: 'mem_bp', graph };
      const bpFolder = vfsTree.find((n) => n.entryKind === 'folder' && n.name === 'blueprints');
      const created = await getStudioApi().vfs.createEntry({
        projectId: project.id,
        parentId: bpFolder?.id ?? null,
        name: `${graph.name}.blueprint.json`,
        entryKind: 'blueprint_graph',
        initialContent: JSON.stringify(graph, null, 2),
      });
      const nextTree = await getStudioApi().vfs.listTree(project.id);
      set((s) => ({
        vfsTree: nextTree,
        sourceFiles: { ...s.sourceFiles, [created.entry.id]: JSON.stringify(graph, null, 2) },
      }));
      return { vfsEntryId: created.entry.id, graph };
    },

    saveBlueprintGraph: async (graph, explicitVfsId) => {
      const updatedGraph: BlueprintGraphDocument = { ...graph, updatedAt: Date.now() };
      set((s) => ({
        blueprintGraphs: { ...s.blueprintGraphs, [updatedGraph.id]: updatedGraph },
        activeBlueprintId: updatedGraph.id,
      }));

      const { project, vfsTree } = get();
      if (!project) return;
      const api = getStudioApi();
      const bpEntry =
        (explicitVfsId ? vfsTree.find((n) => n.id === explicitVfsId) : undefined) ??
        vfsTree.find((n) => n.entryKind === 'blueprint_graph' || n.name.endsWith('.blueprint.json'));

      const jsonStr = JSON.stringify(updatedGraph, null, 2);
      if (bpEntry) {
        await api.vfs.writeFile(bpEntry.id, jsonStr);
        set((s) => ({ sourceFiles: { ...s.sourceFiles, [bpEntry.id]: jsonStr } }));
      } else {
        const bpFolder = vfsTree.find((n) => n.entryKind === 'folder' && n.name === 'blueprints');
        const created = await api.vfs.createEntry({
          projectId: project.id,
          parentId: bpFolder?.id ?? null,
          name: `${updatedGraph.name}.blueprint.json`,
          entryKind: 'blueprint_graph',
          initialContent: jsonStr,
        });
        set((s) => ({ sourceFiles: { ...s.sourceFiles, [created.entry.id]: jsonStr } }));
      }

      // Also keep generated TypeScript mirror file synced in scripts/
      const compiledTs = compileBlueprintToTs(updatedGraph).code;
      const existingGenTs = vfsTree.find((n) => n.name === 'blueprint.generated.ts');
      if (existingGenTs) {
        await api.vfs.writeFile(existingGenTs.id, compiledTs);
        set((s) => ({ sourceFiles: { ...s.sourceFiles, [existingGenTs.id]: compiledTs } }));
      } else {
        const scriptsFolder = vfsTree.find((n) => n.entryKind === 'folder' && (n.name === 'scripts' || n.name === 'src'));
        const createdTs = await api.vfs.createEntry({
          projectId: project.id,
          parentId: scriptsFolder?.id ?? null,
          name: 'blueprint.generated.ts',
          entryKind: 'script_file',
          initialContent: compiledTs,
        });
        const refreshed = await api.vfs.listTree(project.id);
        set((s) => ({
          vfsTree: refreshed,
          sourceFiles: { ...s.sourceFiles, [createdTs.entry.id]: compiledTs },
        }));
      }
    },

    ensureActiveThreeScene: async () => {
      const { project, vfsTree, threeScenes, activeThreeSceneId } = get();
      const existingEntry = vfsTree.find(
        (n) => n.entryKind === 'three_scene' || n.name.endsWith('.scene3d.json'),
      );
      const scene =
        (activeThreeSceneId ? threeScenes[activeThreeSceneId] : undefined) ??
        createThreeSceneFromPreset(project?.id ?? 'proj_local', 'pbr-product-showcase');
      set((s) => ({
        threeScenes: { ...s.threeScenes, [scene.id]: scene },
        activeThreeSceneId: scene.id,
      }));
      if (existingEntry) {
        return { vfsEntryId: existingEntry.id, scene };
      }
      if (!project) return { vfsEntryId: 'mem_3d', scene };
      const folder3d = vfsTree.find((n) => n.entryKind === 'folder' && n.name === 'scenes3d');
      const jsonStr = JSON.stringify(scene, null, 2);
      const created = await getStudioApi().vfs.createEntry({
        projectId: project.id,
        parentId: folder3d?.id ?? null,
        name: `${scene.name}.scene3d.json`,
        entryKind: 'three_scene',
        initialContent: jsonStr,
      });
      const refreshed = await getStudioApi().vfs.listTree(project.id);
      set((s) => ({
        vfsTree: refreshed,
        sourceFiles: { ...s.sourceFiles, [created.entry.id]: jsonStr },
      }));
      return { vfsEntryId: created.entry.id, scene };
    },

    saveThreeScene: async (scene, explicitVfsId) => {
      const updated: ThreeSceneDocument = { ...scene, updatedAt: Date.now() };
      set((s) => ({
        threeScenes: { ...s.threeScenes, [updated.id]: updated },
        activeThreeSceneId: updated.id,
      }));
      const { project, vfsTree } = get();
      if (!project) return;
      const api = getStudioApi();
      const jsonStr = JSON.stringify(updated, null, 2);
      const entry =
        (explicitVfsId ? vfsTree.find((n) => n.id === explicitVfsId) : undefined) ??
        vfsTree.find((n) => n.entryKind === 'three_scene' || n.name.endsWith('.scene3d.json'));
      if (entry) {
        await api.vfs.writeFile(entry.id, jsonStr);
        set((s) => ({ sourceFiles: { ...s.sourceFiles, [entry.id]: jsonStr } }));
      } else {
        const folder3d = vfsTree.find((n) => n.entryKind === 'folder' && n.name === 'scenes3d');
        const created = await api.vfs.createEntry({
          projectId: project.id,
          parentId: folder3d?.id ?? null,
          name: `${updated.name}.scene3d.json`,
          entryKind: 'three_scene',
          initialContent: jsonStr,
        });
        const refreshed = await api.vfs.listTree(project.id);
        set((s) => ({
          vfsTree: refreshed,
          sourceFiles: { ...s.sourceFiles, [created.entry.id]: jsonStr },
        }));
      }
    },

    embedThreeSceneInActiveSheet: async (explicitSceneId, explicitSceneName) => {
      const { activeSheetId, sheetDocuments, selectedNodeIds, canvasPlacementMode } = get();
      const sheet = sheetDocuments[activeSheetId];
      if (!sheet) return;
      const { scene } = await get().ensureActiveThreeScene();
      const targetSceneId = explicitSceneId ?? scene.id;
      const label = explicitSceneName ?? scene.name;
      const parentId = resolveInsertionParent(sheet, selectedNodeIds);
      const newId = generateNodeId('three_vp');
      const isFree = canvasPlacementMode === 'freeform' || (parentId ? sheet.nodes[parentId]?.layout.mode === 'freeform' : false);

      await get().commitOps(
        [
          {
            op: 'insert_node',
            parentId,
            node: {
              id: newId,
              kind: 'control',
              name: `${label}Viewport`,
              semanticTag: 'div',
              layout: {
                mode: 'freeform',
                positioning: isFree ? 'absolute' : 'flow',
                frame: { x: 80, y: 80, width: 480, height: 320 },
                width: { mode: isFree ? 'fixed' : 'fill', value: 480 },
                height: { mode: 'fixed', value: 320 },
                padding: { top: 0, right: 0, bottom: 0, left: 0 },
              },
              style: {
                fills: [{ type: 'solid', color: '#0b1120' }],
                border: { width: 1, style: 'solid', color: '#3b82f6' },
                radius: 14,
                zIndex: 4,
              },
              content: {
                controlType: 'three-viewport',
                text: `Scena 3D: ${label}`,
                threeSceneId: targetSceneId,
              },
            },
          },
        ],
        `Inserisci Scena 3D ${label}`,
      );
      set({ selectedNodeIds: [newId] });
      get().pushToast('success', `Viewport 3D "${label}" inserito nel foglio Canvas!`);
    },

    ensureActiveScriptFile: async () => {
      const { project, vfsTree, sourceFiles, activeScriptVfsId } = get();
      const existing =
        (activeScriptVfsId ? vfsTree.find((n) => n.id === activeScriptVfsId) : undefined) ??
        vfsTree.find(
          (n) =>
            (n.entryKind === 'script_file' || /\.(ts|js)$/i.test(n.name)) &&
            !n.name.endsWith('.generated.ts'),
        ) ??
        vfsTree.find((n) => n.entryKind === 'script_file' || /\.(ts|js)$/i.test(n.name));

      if (existing) {
        let content = sourceFiles[existing.id];
        if (content === undefined) {
          const read = await getStudioApi().vfs.readFile(existing.id);
          content = read.content;
        }
        set((s) => ({
          activeScriptVfsId: existing.id,
          sourceFiles: { ...s.sourceFiles, [existing.id]: content },
        }));
        return { vfsEntryId: existing.id, content, name: existing.name };
      }

      const starterCode = createStarterScriptModuleTs(project?.name ?? 'Visual UI Studio');
      if (!project) {
        return { vfsEntryId: 'mem_script', content: starterCode, name: 'handlers.ts' };
      }
      const scriptsFolder = vfsTree.find((n) => n.entryKind === 'folder' && (n.name === 'scripts' || n.name === 'src'));
      const created = await getStudioApi().vfs.createEntry({
        projectId: project.id,
        parentId: scriptsFolder?.id ?? null,
        name: 'handlers.ts',
        entryKind: 'script_file',
        initialContent: starterCode,
      });
      const refreshed = await getStudioApi().vfs.listTree(project.id);
      set((s) => ({
        vfsTree: refreshed,
        activeScriptVfsId: created.entry.id,
        sourceFiles: { ...s.sourceFiles, [created.entry.id]: starterCode },
      }));
      return { vfsEntryId: created.entry.id, content: starterCode, name: created.entry.name };
    },

    createAndBindScriptFunctionForNode: async (nodeId, trigger = 'onClick') => {
      const { activeSheetId, sheetDocuments } = get();
      const sheet = sheetDocuments[activeSheetId];
      const node = sheet?.nodes[nodeId];
      if (!sheet || !node) return null;

      const { vfsEntryId, content } = await get().ensureActiveScriptFile();
      const safeBase = node.name.replace(/[^a-zA-Z0-9]+/g, '') || 'Element';
      const suffix = trigger.replace(/^on/, '') || 'Click';
      const fnName = `on${safeBase.charAt(0).toUpperCase() + safeBase.slice(1)}${suffix}`;

      let nextCode = content;
      if (!content.includes(`function ${fnName}`)) {
        nextCode =
          content.trimEnd() +
          `\n\nexport function ${fnName}(ctx: StudioRuntimeContext): void {\n  ctx.log('[Evento ${trigger}] ${node.name} attivato!');\n  ctx.toast('Eseguito ${fnName}', 'info');\n}\n`;
        await get().saveSourceFileContent(vfsEntryId, nextCode, true);
      }

      const existingInteractions = (node.interactions ?? []).filter(
        (b) => !(b.trigger === trigger && b.action.kind === 'call_script_fn'),
      );
      await get().commitOps(
        [
          {
            op: 'set_interaction',
            id: node.id,
            interactions: [
              ...existingInteractions,
              {
                trigger,
                action: { kind: 'call_script_fn', vfsEntryId, fnName },
              },
            ],
          },
        ],
        `Collega ${trigger} -> ${fnName}`,
      );

      get().pushToast('success', `Funzione "${fnName}" creata e collegata a ${node.name}!`);
      return { vfsEntryId, fnName };
    },

    setGroupSizes: (sizes) => {
      set({ groupSizes: sizes });
    },

    openTabInGroup: (tabInput, explicitGroupId) => {
      const { editorGroups, activeGroupId } = get();
      const targetGroupId = explicitGroupId ?? activeGroupId ?? editorGroups[0]?.id ?? 'group_1';
      const nextGroups = editorGroups.map((grp) => {
        if (grp.id !== targetGroupId) return grp;
        const existing = grp.tabs.find(
          (t) =>
            t.kind === tabInput.kind &&
            t.sheetId === tabInput.sheetId &&
            t.vfsEntryId === tabInput.vfsEntryId &&
            t.blueprintId === tabInput.blueprintId &&
            t.threeSceneId === tabInput.threeSceneId,
        );
        if (existing) {
          return { ...grp, activeTabId: existing.id };
        }
        const id = `tab_${tabInput.kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
        const newTab: WorkspaceTab = { ...tabInput, id };
        return {
          ...grp,
          tabs: [...grp.tabs, newTab],
          activeTabId: id,
        };
      });
      set({ editorGroups: nextGroups, activeGroupId: targetGroupId });

      if (tabInput.kind === 'code' && tabInput.sheetId) {
        const tId = tabInput.targetId ?? get().globalTarget;
        const dId = tabInput.dialect ?? get().globalDialect;
        void get().compileSheetForTarget(tabInput.sheetId, tId, dId);
      }
    },

    activateTab: (groupId, tabId) => {
      const { editorGroups } = get();
      const group = editorGroups.find((g) => g.id === groupId);
      const tab = group?.tabs.find((t) => t.id === tabId);
      set({
        activeGroupId: groupId,
        editorGroups: editorGroups.map((g) => (g.id === groupId ? { ...g, activeTabId: tabId } : g)),
        ...(tab?.sheetId ? { activeSheetId: tab.sheetId } : {}),
      });
      if (tab?.kind === 'code' && tab.sheetId) {
        void get().compileSheetForTarget(
          tab.sheetId,
          tab.targetId ?? get().globalTarget,
          tab.dialect ?? get().globalDialect,
        );
      }
    },

    closeTab: (groupId, tabId) => {
      const { editorGroups } = get();
      const targetGrp = editorGroups.find((g) => g.id === groupId);
      if (!targetGrp) return;

      if (editorGroups.length === 1 && targetGrp.tabs.length <= 1) {
        return;
      }

      const remainingTabs = targetGrp.tabs.filter((t) => t.id !== tabId);
      if (remainingTabs.length === 0) {
        const remainingGroups = editorGroups.filter((g) => g.id !== groupId);
        const eqSize = Math.round(100 / Math.max(1, remainingGroups.length));
        set({
          editorGroups: remainingGroups,
          activeGroupId: remainingGroups[0]?.id ?? 'group_1',
          groupSizes: remainingGroups.map(() => eqSize),
        });
        return;
      }

      const nextActive =
        targetGrp.activeTabId === tabId ? remainingTabs[remainingTabs.length - 1].id : targetGrp.activeTabId;
      set({
        editorGroups: editorGroups.map((g) =>
          g.id === groupId ? { ...g, tabs: remainingTabs, activeTabId: nextActive } : g,
        ),
      });
    },

    splitEditorGroup: (direction, initialKind = 'code') => {
      const {
        editorGroups,
        activeSheetId,
        sheetDocuments,
        globalTarget,
        globalDialect,
        activeBlueprintId,
        activeThreeSceneId,
        activeScriptVfsId,
      } = get();
      if (editorGroups.length >= 3) {
        set({ splitOrientation: direction });
        get().pushToast('info', 'Massimo 3 gruppi affiancati raggiunti.');
        return;
      }
      const sheetName = sheetDocuments[activeSheetId]?.name ?? 'HomeDashboard';
      const newGroupId = `group_${Date.now().toString(36)}`;
      const tabId = `tab_${initialKind}_${Date.now().toString(36)}`;

      const titleByKind: Record<WorkspaceTabKind, string> = {
        canvas: `${sheetName}.canvas`,
        css: `CSS: ${sheetName}`,
        code: `Codice: ${sheetName}`,
        blueprint: `Blueprint: Logica`,
        script: `Script TS/JS`,
        automation: `Automazioni No-Code`,
        sql_studio: `SQL & Data Studio`,
        three_scene: `Studio 3D Three.js`,
        preview: `Preview: ${sheetName}`,
        source_file: `File Sorgente`,
      };

      const newTab: WorkspaceTab = {
        id: tabId,
        kind: initialKind,
        title: titleByKind[initialKind],
        sheetId: activeSheetId,
        ...(initialKind === 'code' ? { targetId: globalTarget, dialect: globalDialect } : {}),
        ...(initialKind === 'blueprint' ? { blueprintId: activeBlueprintId ?? undefined } : {}),
        ...(initialKind === 'three_scene' ? { threeSceneId: activeThreeSceneId ?? undefined } : {}),
        ...(initialKind === 'script' ? { vfsEntryId: activeScriptVfsId ?? undefined } : {}),
      };

      const nextGroups = [...editorGroups, { id: newGroupId, activeTabId: tabId, tabs: [newTab] }];
      const equalShare = Math.round(100 / nextGroups.length);

      set({
        splitOrientation: direction,
        activeGroupId: newGroupId,
        editorGroups: nextGroups,
        groupSizes: nextGroups.map(() => equalShare),
      });

      if (initialKind === 'code' && activeSheetId) {
        void get().compileSheetForTarget(activeSheetId, globalTarget, globalDialect);
      }
    },

    updateCodeTabTarget: (groupId, tabId, targetId, explicitDialect) => {
      const { targets, editorGroups } = get();
      const desc = targets.find((t) => t.id === targetId) ?? BUILTIN_TARGET_DESCRIPTORS[0];
      let chosenSheetId = get().activeSheetId;
      let chosenDialect: StylingDialect = explicitDialect ?? desc.defaultDialect;

      const nextGroups = editorGroups.map((g) => {
        if (g.id !== groupId) return g;
        return {
          ...g,
          tabs: g.tabs.map((t) => {
            if (t.id !== tabId) return t;
            chosenSheetId = t.sheetId ?? chosenSheetId;
            const currentDialect = explicitDialect ?? t.dialect ?? desc.defaultDialect;
            chosenDialect = desc.supportedDialects.includes(currentDialect)
              ? currentDialect
              : desc.defaultDialect;
            return {
              ...t,
              targetId,
              dialect: chosenDialect,
              activeFilePath: undefined,
            };
          }),
        };
      });

      set({ editorGroups: nextGroups, globalTarget: targetId, globalDialect: chosenDialect });
      if (chosenSheetId) {
        void get().compileSheetForTarget(chosenSheetId, targetId, chosenDialect);
      }
    },

    updateCodeTabActiveFile: (groupId, tabId, filePath) => {
      set((s) => ({
        editorGroups: s.editorGroups.map((g) =>
          g.id === groupId
            ? {
                ...g,
                tabs: g.tabs.map((t) => (t.id === tabId ? { ...t, activeFilePath: filePath } : t)),
              }
            : g,
        ),
      }));
    },

    compileSheetForTarget: async (sheetId, targetId, dialect) => {
      const { project, sheetDocuments, vfsTree, sourceFiles } = get();
      if (!project || !sheetId) return null;
      const key = bundleCacheKey(sheetId, targetId, dialect);
      set((s) => ({ compilingKeys: { ...s.compilingKeys, [key]: true } }));
      try {
        const sheet = sheetDocuments[sheetId];
        const scriptModules = resolveScriptModulesForSheet(sheet, vfsTree, sourceFiles);
        const scriptLanguage = project.primaryLanguage === 'javascript' ? 'javascript' : 'typescript';
        const bundle = await getStudioApi().codegen.compileSheet({
          projectId: project.id,
          sheetId,
          targetId,
          dialect,
          mode: 'bundle',
          selectedNodeId: get().selectedNodeIds[0] ?? null,
          scriptLanguage,
          scriptModules,
        });
        set((s) => ({
          compiledBundles: { ...s.compiledBundles, [key]: bundle },
          compilingKeys: { ...s.compilingKeys, [key]: false },
        }));
        return bundle;
      } catch (err) {
        set((s) => ({ compilingKeys: { ...s.compilingKeys, [key]: false } }));
        get().pushToast('error', `Errore codegen (${targetId}): ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    },

    setCodeDraft: (key, filePath, content) => {
      set((s) => {
        const drafts = { ...s.codeDrafts[key] };
        if (content === undefined) delete drafts[filePath];
        else drafts[filePath] = content;
        return { codeDrafts: { ...s.codeDrafts, [key]: drafts } };
      });
    },

    saveCodeDrafts: async (sheetId, targetId, dialect) => {
      const { project, sheetDocuments, codeDrafts } = get();
      const sheet = sheetDocuments[sheetId];
      if (!project || !sheet) return false;
      const draftKey = codeDraftKey(project.id, sheetId, targetId, dialect);
      const drafts = codeDrafts[draftKey];
      if (!drafts || Object.keys(drafts).length === 0) return true;
      const lockKey = `${project.id}::${sheetId}`;
      if (savingCodeSheets.has(lockKey)) return false;
      savingCodeSheets.add(lockKey);
      try {
        const key = codeOverrideKey(targetId, dialect);
        const codeOverrides = { ...sheet.codeOverrides };
        const saved = applyCodeDrafts(codeOverrides[key], drafts);
        if (Object.keys(saved).length === 0) delete codeOverrides[key];
        else codeOverrides[key] = saved;
        await get().commitOps([{ op: 'update_sheet_meta', codeOverrides }], 'Salva modifiche al codice', 'user', sheetId);
        for (const [path, content] of Object.entries(drafts)) {
          if (get().codeDrafts[draftKey]?.[path] === content) get().setCodeDraft(draftKey, path, undefined);
        }
        get().pushToast('success', 'Modifiche al codice salvate nel foglio.');
        return true;
      } catch (error) {
        get().pushToast('error', error instanceof Error ? error.message : 'Impossibile salvare le modifiche al codice.');
        return false;
      } finally {
        savingCodeSheets.delete(lockKey);
      }
    },

    saveBundleToDisk: async (bundle) => {
      const { project } = get();
      if (!project) return;
      try {
        const api = getStudioApi();
        const res = await api.codegen.saveBundleToDisk(project.id, bundle);
        const tree = await api.vfs.listTree(project.id);
        if (get().project?.id !== project.id) return;
        const entries = new Map(tree.map((entry) => [entry.virtualPath, entry.id]));
        set((s) => {
          const sourceFiles = { ...s.sourceFiles };
          for (const file of bundle.files) {
            const entryId = entries.get(`/generated/${bundle.targetId}/${file.relativePath.replace(/\\/g, '/')}`);
            if (entryId) sourceFiles[entryId] = file.code;
          }
          return { vfsTree: tree, sourceFiles };
        });
        get().pushToast('success', `Salvati ${res.writtenPaths.length} file ${project.rootDiskPath ? 'su disco' : 'nel progetto'} (${res.writtenPaths[0] ?? ''})`);
      } catch (err) {
        get().pushToast('error', err instanceof Error ? err.message : 'Impossibile salvare il bundle su disco.');
      }
    },

    exportProjectScaffold: async (sheetId, targetId, dialect, targetDir) => {
      const { project, sheetDocuments, vfsTree, sourceFiles, codeDrafts } = get();
      if (!project || !sheetId) return null;
      try {
        const api = getStudioApi();
        const sheet = sheetDocuments[sheetId];
        const scriptModules = resolveScriptModulesForSheet(sheet, vfsTree, sourceFiles);
        const scriptLanguage = project.primaryLanguage === 'javascript' ? 'javascript' : 'typescript';
        const scaffoldBundle = await api.codegen.compileSheet({
          projectId: project.id,
          sheetId,
          targetId,
          dialect,
          mode: 'scaffold',
          selectedNodeId: get().selectedNodeIds[0] ?? null,
          scriptLanguage,
          scriptModules,
        });

        if (get().project?.id !== project.id) return null;
        const overrides = applyCodeDrafts(
          sheet?.codeOverrides?.[codeOverrideKey(targetId, dialect)],
          codeDrafts[codeDraftKey(project.id, sheetId, targetId, dialect)],
        );
        const scaffoldPaths = scaffoldBundle.files.map((file) => file.relativePath);
        const exportOverrides: Record<string, string> = {};
        for (const [path, content] of Object.entries(overrides)) {
          if (scaffoldPaths.includes(path)) {
            exportOverrides[path] = content;
            continue;
          }
          const candidates = scaffoldPaths.filter((scaffoldPath) =>
            scaffoldPath.endsWith(`/${path}`) || path.endsWith(`/${scaffoldPath}`),
          );
          if (candidates.length !== 1 || Object.hasOwn(overrides, candidates[0])) {
            throw new Error(`Il progetto generato non contiene un file univoco per la modifica a "${path}". Usa Salva Bundle per salvare questo file.`);
          }
          exportOverrides[candidates[0]] = content;
        }
        const editedScaffold = bundleWithCodeOverrides(scaffoldBundle, exportOverrides);
        const key = bundleCacheKey(sheetId, targetId, dialect);
        set((s) => ({
          compiledBundles: { ...s.compiledBundles, [key]: scaffoldBundle },
        }));

        const cleanSlug =
          project.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || 'studio-project';
        const defaultFolderName = `${cleanSlug}-${targetId}`;

        const res = await api.project.exportBundleToDisk({
          targetDir,
          defaultFolderName,
          files: editedScaffold.files.map((f) => ({
            relativePath: f.relativePath,
            code: f.code,
          })),
        });

        if (res.exportedDir) {
          set({ lastScaffoldExportDir: res.exportedDir });
          get().pushToast(
            'success',
            `Progetto ${targetId} esportato (${res.fileCount} file) in ${res.exportedDir}`,
          );
        } else {
          get().pushToast('info', 'Esportazione progetto annullata.');
        }
        return res;
      } catch (err) {
        get().pushToast(
          'error',
          `Errore esportazione progetto (${targetId}): ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    },

    setCanvasPlacementMode: (mode) => {
      set({ canvasPlacementMode: mode });
      get().pushToast(
        'info',
        mode === 'freeform'
          ? 'Modalità Posizionamento Libero (X, Y) attiva'
          : 'Modalità Auto-Layout Flusso (Flex/Grid) attiva',
      );
    },

    setActiveDrawingTool: (tool) => {
      set({ activeDrawingTool: tool });
    },

    setShowRulers: (show) => {
      set({ showRulers: show });
    },

    setCursorCanvasPos: (pos) => {
      set({ cursorCanvasPos: pos });
    },

    selectNode: (nodeId, multi = false) => {
      if (!nodeId) {
        set({ selectedNodeIds: [] });
        return;
      }
      set((s) => {
        if (!multi) return { selectedNodeIds: [nodeId] };
        const exists = s.selectedNodeIds.includes(nodeId);
        return {
          selectedNodeIds: exists
            ? s.selectedNodeIds.filter((id) => id !== nodeId)
            : [...s.selectedNodeIds, nodeId],
        };
      });
    },

    selectNodeFromCode: (nodeId) => {
      if (!nodeId) {
        set({ selectedNodeIds: [], codeSelectPulseNodeId: null });
        return;
      }
      if (pulseTimer) clearTimeout(pulseTimer);
      set({ selectedNodeIds: [nodeId], codeSelectPulseNodeId: nodeId });
      pulseTimer = setTimeout(() => {
        set({ codeSelectPulseNodeId: null });
      }, 1300);
    },

    setHoveredNode: (nodeId) => {
      set({ hoveredNodeId: nodeId });
    },

    setViewport: (sheetId, vp, persist = false) => {
      const clamped = {
        x: vp.x,
        y: vp.y,
        zoom: Math.max(0.25, Math.min(4, Number(vp.zoom.toFixed(2)))),
      };
      set((s) => ({ viewports: { ...s.viewports, [sheetId]: clamped } }));
      if (persist) {
        void getStudioApi().canvas.saveSheetViewport(sheetId, clamped.x, clamped.y, clamped.zoom).catch(() => {});
      }
    },

    toggleSnapToGrid8px: () => {
      set((s) => ({ snapToGrid8px: !s.snapToGrid8px }));
    },

    commitOps: async (ops, label, actor = 'user', sheetId = get().activeSheetId) => {
      const { project, editorGroups } = get();
      if (!project || !sheetId || ops.length === 0) return;

      const res = await getStudioApi().canvas.commitPatchBatch({
        projectId: project.id,
        sheetId,
        actor,
        label,
        ops,
      });

      if (get().project?.id !== project.id) return;
      set((s) => ({
        sheetDocuments: { ...s.sheetDocuments, [sheetId]: res.sheet },
        ...(s.activeSheetId === sheetId && { canUndo: res.canUndo, canRedo: res.canRedo }),
      }));

      const pairsToCompile = new Set<string>();
      pairsToCompile.add(`${get().globalTarget}::${get().globalDialect}`);
      for (const grp of editorGroups) {
        for (const tab of grp.tabs) {
          if (tab.kind === 'code' && tab.sheetId === sheetId && tab.targetId && tab.dialect) {
            pairsToCompile.add(`${tab.targetId}::${tab.dialect}`);
          }
        }
      }
      for (const pair of pairsToCompile) {
        const [tId, dId] = pair.split('::') as [CodegenTargetId, StylingDialect];
        void get().compileSheetForTarget(sheetId, tId, dId);
      }
    },

    insertPaletteElement: async (presetId, dropPos, explicitParentId) => {
      const { activeSheetId, sheetDocuments, selectedNodeIds, canvasPlacementMode } = get();
      const sheet = sheetDocuments[activeSheetId];
      if (!sheet) return;
      const preset = PALETTE_ELEMENT_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      const parentId =
        explicitParentId !== undefined ? explicitParentId : resolveInsertionParent(sheet, selectedNodeIds);
      const effectivePos =
        dropPos ?? (canvasPlacementMode === 'freeform' ? { x: 64, y: 64 } : undefined);
      const ops = preset.buildPatches(parentId, activeSheetId, effectivePos);

      // Ensure root inserted node gets `positioning: 'absolute'` if dropped at coordinates or in Freeform mode
      if (effectivePos && ops[0]?.op === 'insert_node' && ops[0].node.kind !== 'artboard') {
        const existingLayout = ops[0].node.layout;
        const w = existingLayout?.frame?.width ?? 220;
        const h = existingLayout?.frame?.height ?? 44;
        ops[0] = {
          ...ops[0],
          node: {
            ...ops[0].node,
            layout: {
              ...(existingLayout ?? {
                mode: 'freeform',
                positioning: 'absolute',
                frame: { x: effectivePos.x, y: effectivePos.y, width: w, height: h },
                width: { mode: 'fixed', value: w },
                height: { mode: 'hug', value: h },
                padding: { top: 8, right: 12, bottom: 8, left: 12 },
              }),
              positioning: 'absolute',
              frame: {
                x: Math.round(effectivePos.x),
                y: Math.round(effectivePos.y),
                width: w,
                height: h,
              },
              width:
                existingLayout?.width?.mode === 'fill'
                  ? { mode: 'fixed', value: Math.max(160, w) }
                  : existingLayout?.width ?? { mode: 'fixed', value: w },
            },
          },
        };
      }

      await get().commitOps(ops, `Inserisci ${preset.label}`);
      const insertedId = ops[0]?.op === 'insert_node' ? ops[0].node.id : undefined;
      if (insertedId) {
        set({ selectedNodeIds: [insertedId] });
      }
      get().pushToast('success', `Aggiunto "${preset.label}" sul foglio.`);
    },

    insertReusableComponent: async (templateId) => {
      const { activeSheetId, sheetDocuments, selectedNodeIds } = get();
      const sheet = sheetDocuments[activeSheetId];
      if (!sheet) return;
      const tpl = REUSABLE_COMPONENT_TEMPLATES.find((c) => c.id === templateId);
      if (!tpl) return;
      const parentId = resolveInsertionParent(sheet, selectedNodeIds);
      const ops = tpl.buildPatches(parentId, activeSheetId);
      await get().commitOps(ops, `Inserisci componente ${tpl.name}`);
      const insertedId = ops[0]?.op === 'insert_node' ? ops[0].node.id : undefined;
      if (insertedId) set({ selectedNodeIds: [insertedId] });
      get().pushToast('success', `Componente "${tpl.name}" inserito!`);
    },

    insertOfflineIcon: async (icon) => {
      const { activeSheetId, sheetDocuments, selectedNodeIds, canvasPlacementMode } = get();
      const sheet = sheetDocuments[activeSheetId];
      if (!sheet) return;
      const sel = selectedNodeIds[0] ? sheet.nodes[selectedNodeIds[0]] : null;

      if (sel && sel.kind === 'control') {
        await get().commitOps(
          [{ op: 'update_node', id: sel.id, content: { ...sel.content, iconName: icon.id } }],
          `Imposta icona ${icon.name}`,
        );
        get().pushToast('info', `Icona "${icon.name}" applicata a ${sel.name}`);
        return;
      }

      const parentId = resolveInsertionParent(sheet, selectedNodeIds);
      const nodeId = generateNodeId('ico');
      const isFree = canvasPlacementMode === 'freeform';
      await get().commitOps(
        [
          {
            op: 'insert_node',
            parentId,
            node: {
              id: nodeId,
              kind: 'vector',
              name: `Icon_${icon.id}`,
              semanticTag: 'span',
              layout: {
                mode: 'freeform',
                positioning: isFree ? 'absolute' : 'flow',
                frame: { x: 48, y: 48, width: 32, height: 32 },
                width: { mode: 'fixed', value: 32 },
                height: { mode: 'fixed', value: 32 },
                padding: { top: 4, right: 4, bottom: 4, left: 4 },
              },
              style: { radius: 6 },
              content: { iconName: icon.id, svgPath: icon.svgBody },
            },
          },
        ],
        `Inserisci icona ${icon.name}`,
      );
      set({ selectedNodeIds: [nodeId] });
      get().pushToast('success', `Icona "${icon.name}" inserita nel Canvas.`);
    },

    duplicateSelectedNode: async () => {
      const { activeSheetId, sheetDocuments, selectedNodeIds } = get();
      const sheet = sheetDocuments[activeSheetId];
      if (!sheet || selectedNodeIds.length === 0) return;
      const topIds = filterTopMostSelectedIds(selectedNodeIds, sheet);
      if (topIds.length === 0) return;

      const allOps: UIPatchOp[] = [];
      const newRoots: NodeId[] = [];
      for (const sid of topIds) {
        const target = sheet.nodes[sid];
        if (!target) continue;
        const { ops, rootId } = cloneNodeSubtreeFromMapAsPatches(sid, target.parentId, sheet.nodes, 16, true, 'Copy');
        allOps.push(...ops);
        if (rootId) newRoots.push(rootId);
      }
      if (allOps.length === 0) return;
      await get().commitOps(allOps, `Duplica ${newRoots.length} elementi`);
      if (newRoots.length > 0) set({ selectedNodeIds: newRoots });
      get().pushToast('info', newRoots.length > 1 ? `Duplicati ${newRoots.length} nodi` : 'Nodo duplicato');
    },

    copySelectedNodes: () => {
      const { activeSheetId, sheetDocuments, selectedNodeIds } = get();
      const sheet = sheetDocuments[activeSheetId];
      if (!sheet || selectedNodeIds.length === 0) return;

      const nonArtboards = selectedNodeIds.filter((id) => sheet.nodes[id] && sheet.nodes[id].kind !== 'artboard');
      const candidateIds = nonArtboards.length > 0 ? nonArtboards : selectedNodeIds;
      const topIds = filterTopMostSelectedIds(candidateIds, sheet).filter(
        (id) => sheet.nodes[id]?.kind !== 'artboard',
      );

      if (topIds.length === 0) {
        get().pushToast('info', "Seleziona uno o più elementi interni all'Artboard da copiare (Ctrl+C).");
        return;
      }

      const nodesDict: Record<NodeId, UINode> = {};
      for (const rid of topIds) {
        collectSubtreeDictionary(rid, sheet, nodesDict);
      }

      set({
        copiedClipboard: {
          rootIds: topIds,
          nodes: nodesDict,
          pasteCount: 0,
        },
      });
      get().pushToast('info', `Copiati ${topIds.length} elementi negli appunti Canvas.`);
    },

    cutSelectedNodes: async () => {
      const { activeSheetId, sheetDocuments, selectedNodeIds } = get();
      const sheet = sheetDocuments[activeSheetId];
      if (!sheet || selectedNodeIds.length === 0) return;
      get().copySelectedNodes();
      await get().deleteSelectedNode();
      get().pushToast('info', 'Elementi tagliati negli appunti (Ctrl+X).');
    },

    pasteCopiedNodes: async (atCanvasPos) => {
      const { activeSheetId, sheetDocuments, selectedNodeIds, copiedClipboard } = get();
      const sheet = sheetDocuments[activeSheetId];
      if (!sheet || !copiedClipboard || copiedClipboard.rootIds.length === 0) return;

      const nextCount = copiedClipboard.pasteCount + 1;
      const offsetPx = atCanvasPos ? 0 : 16 * nextCount;
      const targetParent = resolveInsertionParent(sheet, selectedNodeIds);

      const minCopiedX = Math.min(
        ...copiedClipboard.rootIds.map((rid) => copiedClipboard.nodes[rid]?.layout.frame.x ?? 0),
      );
      const minCopiedY = Math.min(
        ...copiedClipboard.rootIds.map((rid) => copiedClipboard.nodes[rid]?.layout.frame.y ?? 0),
      );

      const allOps: UIPatchOp[] = [];
      const newRoots: NodeId[] = [];
      for (const rid of copiedClipboard.rootIds) {
        const { ops, rootId } = cloneNodeSubtreeFromMapAsPatches(
          rid,
          targetParent,
          copiedClipboard.nodes,
          offsetPx,
          true,
          'Copy',
        );
        if (atCanvasPos && ops[0]?.op === 'insert_node' && ops[0].node.layout?.frame) {
          const origFrame = copiedClipboard.nodes[rid]?.layout.frame ?? ops[0].node.layout.frame;
          ops[0] = {
            ...ops[0],
            node: {
              ...ops[0].node,
              layout: {
                ...ops[0].node.layout,
                positioning: 'absolute',
                frame: {
                  ...origFrame,
                  x: Math.round(atCanvasPos.x + (origFrame.x - minCopiedX)),
                  y: Math.round(atCanvasPos.y + (origFrame.y - minCopiedY)),
                },
              },
            },
          };
        }
        allOps.push(...ops);
        if (rootId) newRoots.push(rootId);
      }
      if (allOps.length === 0) return;

      await get().commitOps(allOps, `Incolla ${newRoots.length} elementi`);
      set({
        selectedNodeIds: newRoots,
        copiedClipboard: { ...copiedClipboard, pasteCount: nextCount },
      });
      get().pushToast('success', `Incollati ${newRoots.length} elementi nel Canvas.`);
    },

    copySelectedNodeStyle: () => {
      const { activeSheetId, sheetDocuments, selectedNodeIds } = get();
      const sheet = sheetDocuments[activeSheetId];
      const primary = selectedNodeIds[0] ? sheet?.nodes[selectedNodeIds[0]] : undefined;
      if (!primary) return;
      set({
        copiedNodeStyle: {
          style: structuredClone(primary.style),
          typography: primary.typography ? structuredClone(primary.typography) : undefined,
          stateOverrides: primary.stateOverrides ? structuredClone(primary.stateOverrides) : undefined,
          classNames: primary.classNames ? [...primary.classNames] : primary.style.classNames ? [...primary.style.classNames] : undefined,
        },
      });
      get().pushToast('info', `Stile CSS copiato da "${primary.name}" (Ctrl+Alt+C)`);
    },

    pasteStyleToSelectedNodes: async () => {
      const { activeSheetId, sheetDocuments, selectedNodeIds, copiedNodeStyle } = get();
      const sheet = sheetDocuments[activeSheetId];
      if (!sheet || !copiedNodeStyle || selectedNodeIds.length === 0) return;
      const ops: UIPatchOp[] = selectedNodeIds
        .map((id) => sheet.nodes[id])
        .filter((n): n is UINode => Boolean(n && !n.locked))
        .map((n) => ({
          op: 'update_node',
          id: n.id,
          classNames: copiedNodeStyle.classNames ? [...copiedNodeStyle.classNames] : undefined,
          style: structuredClone(copiedNodeStyle.style),
          typography: copiedNodeStyle.typography ? structuredClone(copiedNodeStyle.typography) : undefined,
          stateOverrides: copiedNodeStyle.stateOverrides ? structuredClone(copiedNodeStyle.stateOverrides) : undefined,
        }));
      if (ops.length === 0) return;
      await get().commitOps(ops, `Incolla stile CSS su ${ops.length} elementi`);
      get().pushToast('success', `Stile CSS applicato a ${ops.length} elementi!`);
    },

    setSimulatedCanvasState: (state) => {
      set({ simulatedCanvasState: state });
    },

    setHoveredBoxModelOverlay: (part) => {
      set({ hoveredBoxModelOverlay: part });
    },

    groupSelectedNodes: async (preset = 'auto') => {
      const { activeSheetId, sheetDocuments, selectedNodeIds } = get();
      const sheet = sheetDocuments[activeSheetId];
      if (!sheet || selectedNodeIds.length === 0) return;
      const topIds = filterTopMostSelectedIds(selectedNodeIds, sheet).filter(
        (id) => sheet.nodes[id] && sheet.nodes[id].kind !== 'artboard',
      );
      if (topIds.length === 0) return;

      let direction: 'row' | 'column' = 'row';
      if (preset === 'column' || preset === 'card') {
        direction = 'column';
      } else if (preset === 'auto' && topIds.length >= 2) {
        const xs = topIds.map((id) => sheet.nodes[id].layout.frame.x);
        const ys = topIds.map((id) => sheet.nodes[id].layout.frame.y);
        const spanX = Math.max(...xs) - Math.min(...xs);
        const spanY = Math.max(...ys) - Math.min(...ys);
        direction = spanY > spanX ? 'column' : 'row';
      }

      const wrapperId = generateNodeId('grp');
      const mode: 'flex' | 'grid' | 'freeform' =
        preset === 'grid' ? 'grid' : preset === 'freeform' ? 'freeform' : 'flex';
      const wrapperName =
        preset === 'card'
          ? 'CardContainer'
          : preset === 'grid'
            ? 'GridContainer'
            : preset === 'freeform'
              ? 'FreeformGroup'
              : direction === 'column'
                ? 'VStackGroup'
                : 'HStackGroup';

      await get().commitOps(
        [
          {
            op: 'wrap_container',
            targetNodeIds: topIds,
            wrapperId,
            wrapperName,
            mode,
            direction,
            gap: 12,
            padding: preset === 'card' ? 16 : mode === 'freeform' ? 0 : 12,
            gridCols:
              mode === 'grid'
                ? [
                    { track: 'fr', value: 1 },
                    { track: 'fr', value: 1 },
                  ]
                : undefined,
            presetStyle: preset === 'card' ? 'card' : 'plain',
          },
        ],
        `Raggruppa in ${wrapperName}`,
      );
      set({ selectedNodeIds: [wrapperId] });
      get().pushToast('success', `Elementi raggruppati in "${wrapperName}"`);
    },

    ungroupSelectedContainer: async () => {
      const { activeSheetId, sheetDocuments, selectedNodeIds } = get();
      const sheet = sheetDocuments[activeSheetId];
      const targetId = selectedNodeIds[0];
      const target = targetId ? sheet?.nodes[targetId] : undefined;
      if (!sheet || !target || target.kind === 'artboard' || target.childIds.length === 0) return;
      const liftedIds = [...target.childIds];
      await get().commitOps([{ op: 'ungroup_container', id: target.id }], `Separa gruppo ${target.name}`);
      set({ selectedNodeIds: liftedIds });
      get().pushToast('info', `Gruppo "${target.name}" separato.`);
    },

    distributeSelectedNodes: async (axis) => {
      const { activeSheetId, sheetDocuments, selectedNodeIds } = get();
      const sheet = sheetDocuments[activeSheetId];
      if (!sheet || selectedNodeIds.length < 3) return;
      const nodes = selectedNodeIds
        .map((id) => sheet.nodes[id])
        .filter((n): n is UINode => Boolean(n && !n.locked && n.kind !== 'artboard'));
      if (nodes.length < 3) return;

      const sorted = [...nodes].sort((a, b) =>
        axis === 'horizontal' ? a.layout.frame.x - b.layout.frame.x : a.layout.frame.y - b.layout.frame.y,
      );
      const first = sorted[0];
      const last = sorted[sorted.length - 1];

      if (axis === 'horizontal') {
        const totalSpan = last.layout.frame.x + last.layout.frame.width - first.layout.frame.x;
        const sumWidths = sorted.reduce((acc, n) => acc + n.layout.frame.width, 0);
        const gap = (totalSpan - sumWidths) / (sorted.length - 1);
        let cursor = first.layout.frame.x;
        const ops: UIPatchOp[] = sorted.map((n) => {
          const nextX = Math.round(cursor);
          cursor += n.layout.frame.width + gap;
          return {
            op: 'update_node',
            id: n.id,
            layout: {
              positioning: 'absolute',
              frame: { ...n.layout.frame, x: nextX },
            },
          };
        });
        await get().commitOps(ops, 'Distribuisci orizzontalmente');
      } else {
        const totalSpan = last.layout.frame.y + last.layout.frame.height - first.layout.frame.y;
        const sumHeights = sorted.reduce((acc, n) => acc + n.layout.frame.height, 0);
        const gap = (totalSpan - sumHeights) / (sorted.length - 1);
        let cursor = first.layout.frame.y;
        const ops: UIPatchOp[] = sorted.map((n) => {
          const nextY = Math.round(cursor);
          cursor += n.layout.frame.height + gap;
          return {
            op: 'update_node',
            id: n.id,
            layout: {
              positioning: 'absolute',
              frame: { ...n.layout.frame, y: nextY },
            },
          };
        });
        await get().commitOps(ops, 'Distribuisci verticalmente');
      }
    },

    upsertReusableCssClass: async (cls) => {
      const { activeSheetId, sheetDocuments } = get();
      const sheet = sheetDocuments[activeSheetId];
      if (!sheet) return;
      const cleanName = cls.name.trim().replace(/^\.+/, '').replace(/[^a-zA-Z0-9_-]/g, '-');
      if (!cleanName) return;
      const normalized: ReusableCssClass = {
        ...cls,
        name: cleanName,
        stateOverrides: cls.stateOverrides ?? cls.states,
        states: cls.states ?? cls.stateOverrides,
      };
      const existing = sheet.reusableClasses ?? [];
      const nextClasses = existing.some((c) => c.id === normalized.id || c.name === normalized.name)
        ? existing.map((c) => (c.id === normalized.id || c.name === normalized.name ? normalized : c))
        : [...existing, normalized];
      await get().commitOps(
        [{ op: 'update_sheet_meta', reusableClasses: nextClasses }],
        `Salva classe CSS .${cleanName}`,
      );
    },

    deleteReusableCssClass: async (classId) => {
      const { activeSheetId, sheetDocuments } = get();
      const sheet = sheetDocuments[activeSheetId];
      if (!sheet) return;
      const target = (sheet.reusableClasses ?? []).find((c) => c.id === classId || c.name === classId);
      if (!target) return;
      const nextClasses = (sheet.reusableClasses ?? []).filter((c) => c.id !== target.id);
      const ops: UIPatchOp[] = [{ op: 'update_sheet_meta', reusableClasses: nextClasses }];
      for (const node of Object.values(sheet.nodes)) {
        const curNames = node.classNames ?? node.style.classNames ?? [];
        if (curNames.includes(target.name)) {
          ops.push({
            op: 'update_node',
            id: node.id,
            classNames: curNames.filter((cn) => cn !== target.name),
          });
        }
      }
      await get().commitOps(ops, `Elimina classe CSS .${target.name}`);
    },

    toggleNodeCssClass: async (nodeId, className) => {
      const { activeSheetId, sheetDocuments } = get();
      const sheet = sheetDocuments[activeSheetId];
      const node = sheet?.nodes[nodeId];
      if (!sheet || !node) return;
      const clean = className.trim().replace(/^\.+/, '');
      if (!clean) return;
      const current = node.classNames ?? node.style.classNames ?? [];
      const next = current.includes(clean)
        ? current.filter((c) => c !== clean)
        : [...current, clean];
      await get().commitOps(
        [{ op: 'update_node', id: nodeId, classNames: next }],
        next.includes(clean) ? `Applica .${clean}` : `Rimuovi .${clean}`,
      );
    },

    nudgeSelectedNodes: async (dx, dy) => {
      const { activeSheetId, sheetDocuments, selectedNodeIds } = get();
      const sheet = sheetDocuments[activeSheetId];
      if (!sheet || selectedNodeIds.length === 0) return;

      const movable = selectedNodeIds
        .map((id) => sheet.nodes[id])
        .filter((n): n is UINode => Boolean(n && !n.locked && n.kind !== 'artboard'));

      if (movable.length === 0) return;

      const ops: UIPatchOp[] = movable.map((n) => {
        const parentMode = n.parentId ? sheet.nodes[n.parentId]?.layout.mode : 'freeform';
        return {
          op: 'update_node',
          id: n.id,
          layout: {
            positioning: parentMode === 'freeform' ? n.layout.positioning : 'absolute',
            frame: {
              ...n.layout.frame,
              x: Math.round(n.layout.frame.x + dx),
              y: Math.round(n.layout.frame.y + dy),
            },
          },
        };
      });

      await get().commitOps(ops, `Sposta selezione (${dx}, ${dy})px`);
    },

    alignSelectedNodes: async (alignment) => {
      const { activeSheetId, sheetDocuments, selectedNodeIds } = get();
      const sheet = sheetDocuments[activeSheetId];
      if (!sheet || selectedNodeIds.length === 0) return;
      const targets = selectedNodeIds
        .map((id) => sheet.nodes[id])
        .filter((n): n is UINode => Boolean(n && !n.locked && n.kind !== 'artboard'));
      if (targets.length === 0) return;

      const minX = Math.min(...targets.map((t) => t.layout.frame.x));
      const maxX = Math.max(...targets.map((t) => t.layout.frame.x + t.layout.frame.width));
      const minY = Math.min(...targets.map((t) => t.layout.frame.y));
      const maxY = Math.max(...targets.map((t) => t.layout.frame.y + t.layout.frame.height));

      const ops: UIPatchOp[] = targets.map((t) => {
        let { x, y } = t.layout.frame;
        const { width, height } = t.layout.frame;
        if (alignment === 'left') x = minX;
        else if (alignment === 'center') x = Math.round((minX + maxX) / 2 - width / 2);
        else if (alignment === 'right') x = maxX - width;
        else if (alignment === 'top') y = minY;
        else if (alignment === 'middle') y = Math.round((minY + maxY) / 2 - height / 2);
        else if (alignment === 'bottom') y = maxY - height;

        return {
          op: 'update_node',
          id: t.id,
          layout: {
            positioning: 'absolute',
            frame: { ...t.layout.frame, x, y },
          },
        };
      });
      await get().commitOps(ops, `Allinea selezione (${alignment})`);
    },

    adjustSelectedZIndex: async (delta) => {
      const { activeSheetId, sheetDocuments, selectedNodeIds } = get();
      const sheet = sheetDocuments[activeSheetId];
      if (!sheet || selectedNodeIds.length === 0) return;
      const ops: UIPatchOp[] = selectedNodeIds
        .map((id) => sheet.nodes[id])
        .filter((n): n is UINode => Boolean(n && !n.locked))
        .map((n) => ({
          op: 'update_node',
          id: n.id,
          style: { zIndex: Math.max(0, (n.style.zIndex ?? 1) + delta) },
        }));
      if (ops.length > 0) await get().commitOps(ops, delta > 0 ? 'Porta avanti' : 'Porta dietro');
    },

    toggleNodeFreeformDetach: async (explicitNodeId) => {
      const { activeSheetId, sheetDocuments, selectedNodeIds } = get();
      const sheet = sheetDocuments[activeSheetId];
      const targetId = explicitNodeId ?? selectedNodeIds[0];
      const node = targetId ? sheet?.nodes[targetId] : undefined;
      if (!sheet || !node || node.kind === 'artboard') return;

      const nextPos = node.layout.positioning === 'absolute' ? 'flow' : 'absolute';
      await get().commitOps(
        [
          {
            op: 'update_node',
            id: node.id,
            layout: {
              positioning: nextPos,
              ...(nextPos === 'absolute' && node.layout.width.mode === 'fill'
                ? { width: { mode: 'fixed', value: Math.max(160, node.layout.frame.width) } }
                : {}),
            },
          },
        ],
        nextPos === 'absolute' ? `Sgancia ${node.name} in coordinate (X,Y)` : `Riaggancia ${node.name} al flusso`,
      );
    },

    deleteSelectedNode: async () => {
      const { activeSheetId, sheetDocuments, selectedNodeIds } = get();
      const sheet = sheetDocuments[activeSheetId];
      if (!sheet || selectedNodeIds.length === 0) return;
      const deletable = selectedNodeIds.filter((id) => {
        const n = sheet.nodes[id];
        if (!n || n.locked) return false;
        if (n.kind === 'artboard' && sheet.rootIds.length <= 1) return false;
        return true;
      });
      if (deletable.length === 0) {
        get().pushToast('warn', "L'artboard principale o un nodo bloccato non può essere eliminato.");
        return;
      }
      const ops: UIPatchOp[] = deletable.map((id) => ({ op: 'delete_node', id }));
      await get().commitOps(ops, `Elimina ${deletable.length} nodi`);
      set({ selectedNodeIds: sheet.rootIds[0] ? [sheet.rootIds[0]] : [] });
    },

    reorderNode: async (nodeId, delta) => {
      const { activeSheetId, sheetDocuments } = get();
      const sheet = sheetDocuments[activeSheetId];
      const node = sheet?.nodes[nodeId];
      if (!sheet || !node) return;
      const list = node.parentId ? sheet.nodes[node.parentId]?.childIds ?? [] : sheet.rootIds;
      const curIdx = list.indexOf(nodeId);
      const nextIdx = curIdx + delta;
      if (curIdx < 0 || nextIdx < 0 || nextIdx >= list.length) return;
      await get().commitOps(
        [{ op: 'move_node', id: nodeId, newParentId: node.parentId, index: nextIdx }],
        `Riordina ${node.name}`,
      );
    },

    undo: async () => {
      const { activeSheetId } = get();
      if (!activeSheetId) return;
      const res = await getStudioApi().canvas.undo(activeSheetId);
      if (res) {
        set((s) => ({
          sheetDocuments: { ...s.sheetDocuments, [activeSheetId]: res.sheet },
          canUndo: res.canUndo,
          canRedo: res.canRedo,
        }));
        void get().compileSheetForTarget(activeSheetId, get().globalTarget, get().globalDialect);
      }
    },

    redo: async () => {
      const { activeSheetId } = get();
      if (!activeSheetId) return;
      const res = await getStudioApi().canvas.redo(activeSheetId);
      if (res) {
        set((s) => ({
          sheetDocuments: { ...s.sheetDocuments, [activeSheetId]: res.sheet },
          canUndo: res.canUndo,
          canRedo: res.canRedo,
        }));
        void get().compileSheetForTarget(activeSheetId, get().globalTarget, get().globalDialect);
      }
    },

    solveAutoLayoutOnActive: async () => {
      const { activeSheetId, sheetDocuments, selectedNodeIds } = get();
      const sheet = sheetDocuments[activeSheetId];
      if (!sheet) return;
      const candidateId = resolveInsertionParent(sheet, selectedNodeIds) ?? sheet.rootIds[0];
      if (!candidateId) return;
      try {
        const res = await getStudioApi().codegen.solveFreeformLayout(activeSheetId, candidateId);
        if (res.ops.length > 0) {
          await get().commitOps(res.ops, 'Converti in Auto-Layout', 'layout_solver');
          set({ canvasPlacementMode: 'auto' });
          get().pushToast('success', res.summary || 'Convertito in Auto-Layout strutturato!');
        } else {
          await get().commitOps(
            [
              {
                op: 'convert_auto_layout',
                id: candidateId,
                direction: sheet.nodes[candidateId]?.layout.direction === 'row' ? 'column' : 'row',
                gap: 16,
                padding: 20,
              },
            ],
            'Converti in Auto-Layout',
            'layout_solver',
          );
          set({ canvasPlacementMode: 'auto' });
          get().pushToast('success', `Contenitore "${sheet.nodes[candidateId]?.name}" ottimizzato in Auto-Layout!`);
        }
      } catch (err) {
        get().pushToast('error', err instanceof Error ? err.message : 'Errore Spatial Layout Solver');
      }
    },

    upsertDesignToken: async (entry) => {
      const saved = await getStudioApi().tokens.upsertToken(entry);
      const { project, activeSheetId } = get();
      if (project) {
        const list = await getStudioApi().tokens.listTokens(project.id);
        set({ tokens: list });
      } else {
        set((s) => ({
          tokens: s.tokens.some((t) => t.id === saved.id)
            ? s.tokens.map((t) => (t.id === saved.id ? saved : t))
            : [...s.tokens, saved],
        }));
      }
      if (activeSheetId) {
        void get().compileSheetForTarget(activeSheetId, get().globalTarget, get().globalDialect);
      }
      get().pushToast('success', `Token "${saved.tokenPath}" aggiornato.`);
    },

    setRightPanelMode: (mode) => {
      set({ rightPanelMode: mode });
      const { project } = get();
      if (project) {
        void getStudioApi().workspace.saveState(project.id, { rightPanelMode: mode }).catch(() => {});
      }
    },

    setRightPanelWidth: (w) => {
      set({ rightPanelWidth: Math.max(300, Math.min(560, w)) });
    },

    askAiAboutSelection: () => {
      set((s) => ({
        rightPanelMode: s.rightPanelMode === 'inspector' ? 'split' : s.rightPanelMode,
        agentMode: 'surgical',
        aiPromptFocusTick: s.aiPromptFocusTick + 1,
      }));
    },

    ensureOllamaRunningAction: async (silentToast = false) => {
      const api = getStudioApi();
      set({
        ollamaEnsureStatus: 'starting',
        ollamaStatusMessage: 'Verifica / avvio automatico di Ollama su :11434...',
      });
      try {
        const res = await api.ai.ensureOllamaRunning();
        const provsRaw = await api.ai.listProvidersAndModels().catch(() => get().providers);
        const provs: LocalAIProviderStatus[] = provsRaw.map((p) =>
          p.id === 'ollama' || p.id === 'lmstudio'
            ? {
                ...p,
                online: p.id === 'ollama' ? Boolean(res.online || p.online) : p.online,
                models: filterAndRankLocalModels(
                  p.id === 'ollama' && res.models.length > 0 ? res.models : p.models,
                ),
              }
            : p,
        );

        const rankedModels = filterAndRankLocalModels(
          res.models.length > 0 ? res.models : (provs.find((p) => p.id === 'ollama')?.models ?? []),
        );
        const preferred =
          res.preferredModel && !isEmbeddingOnlyModelName(res.preferredModel)
            ? res.preferredModel
            : pickPreferredLocalModel(rankedModels);

        set((s) => {
          const curInRanked = rankedModels.some((m) => m.id === s.activeModel);
          const nextModel = res.online
            ? curInRanked && !isEmbeddingOnlyModelName(s.activeModel)
              ? s.activeModel
              : (preferred ?? rankedModels[0]?.id ?? s.activeModel)
            : s.activeModel;

          return {
            ollamaEnsureStatus: res.online ? 'online' : 'offline',
            ollamaStartedByApp: Boolean(res.startedByApp),
            ollamaStatusMessage: res.message,
            providers: provs.length > 0 ? provs : s.providers,
            activeProvider: res.online ? 'ollama' : s.activeProvider,
            activeModel: nextModel,
          };
        });

        if (!silentToast) {
          get().pushToast(
            res.online ? 'success' : 'warn',
            res.online
              ? `${res.message}${preferred ? ` (${preferred})` : ''}`
              : res.message || 'Ollama non raggiungibile su :11434.',
          );
        }
        return { ...res, models: rankedModels, preferredModel: preferred };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Impossibile contattare Ollama (:11434)';
        set({
          ollamaEnsureStatus: 'offline',
          ollamaStatusMessage: msg,
        });
        if (!silentToast) {
          get().pushToast('warn', msg);
        }
        return {
          online: false,
          startedByApp: false,
          models: [],
          preferredModel: null,
          message: msg,
        };
      }
    },

    refreshAiProviders: async () => {
      const api = getStudioApi();
      const [hw, provsRaw] = await Promise.all([
        api.ai.getHardwareReport().catch(() => get().hardwareReport),
        api.ai.listProvidersAndModels().catch(() => get().providers),
      ]);
      const provs: LocalAIProviderStatus[] = provsRaw.map((p) =>
        p.id === 'ollama' || p.id === 'lmstudio'
          ? { ...p, models: filterAndRankLocalModels(p.models) }
          : p,
      );
      const ollamaProv = provs.find((p) => p.id === 'ollama');
      set((s) => {
        const ollamaOnline = Boolean(ollamaProv?.online);
        const pref = ollamaProv ? pickPreferredLocalModel(ollamaProv.models) : null;
        const shouldSwitchModel =
          ollamaOnline &&
          pref &&
          (s.activeModel === 'offline-studio-architect-v1' ||
            isEmbeddingOnlyModelName(s.activeModel) ||
            !ollamaProv?.models.some((m) => m.id === s.activeModel));

        return {
          hardwareReport: hw,
          providers: provs,
          ollamaEnsureStatus: ollamaOnline ? 'online' : 'offline',
          ollamaStatusMessage: ollamaOnline
            ? `Ollama attivo (${ollamaProv?.models.length ?? 0} modelli)`
            : 'Ollama offline su :11434',
          activeProvider: ollamaOnline && s.activeProvider === 'builtin_offline' ? 'ollama' : s.activeProvider,
          activeModel: shouldSwitchModel && pref ? pref : s.activeModel,
        };
      });
      get().pushToast('info', 'Stato provider Local AI e telemetria VRAM aggiornati.');
    },

    setActiveProvider: (provider) => {
      const provObj = get().providers.find((p) => p.id === provider);
      const cleanModels =
        provider === 'ollama' || provider === 'lmstudio'
          ? filterAndRankLocalModels(provObj?.models ?? [])
          : (provObj?.models ?? []);
      const firstModel =
        cleanModels[0]?.id ??
        (provider === 'builtin_offline' ? 'offline-studio-architect-v1' : 'qwen2.5-coder:7b');
      set({ activeProvider: provider, activeModel: firstModel });
    },

    setActiveModel: (model) => {
      if (isEmbeddingOnlyModelName(model)) return;
      set({ activeModel: model });
    },

    setAgentMode: (mode) => {
      set({ agentMode: mode });
    },

    setVisionImageBase64: (b64) => {
      set({ visionImageBase64: b64 });
    },

    generateProjectWithAiAction: async (req) => {
      if (!req.prompt.trim() || get().isGeneratingAiProject) return;
      const api = getStudioApi();
      const runId = req.runId || `projgen_${Date.now().toString(36)}`;
      const ollamaProv = get().providers.find((p) => p.id === 'ollama');
      const effectiveProvider: LocalAIProviderKind =
        req.provider ?? (ollamaProv?.online ? 'ollama' : get().activeProvider);
      const effectiveModel =
        req.modelName ||
        (effectiveProvider === 'ollama' && ollamaProv?.models.length
          ? ollamaProv.models.some((m) => m.id === get().activeModel)
            ? get().activeModel
            : (pickPreferredLocalModel(ollamaProv.models) ?? get().activeModel)
          : get().activeModel);

      set({
        isGeneratingAiProject: true,
        aiProjectGenStatus: {
          runId,
          status:
            effectiveProvider === 'ollama'
              ? `Generazione architettura con Ollama (${effectiveModel})...`
              : 'Generazione progetto con Architetto Locale...',
          percent: 12,
          startedAt: Date.now(),
          streamedTokens: '',
        },
      });

      try {
        const payload = await api.ai.generateProjectWithAi({
          ...req,
          prompt: req.prompt.trim(),
          provider: effectiveProvider,
          modelName: effectiveModel,
          runId,
        });
        await applyBootstrapPayload(payload);
        const recents = await api.project.listRecent().catch(() => get().recentProjects);
        set({
          recentProjects: recents,
          isGeneratingAiProject: false,
          aiProjectGenStatus: null,
          showProjectHub: false,
          hasOpenedProjectInSession: true,
          wizardOpen: false,
          isNewProjectModalOpen: false,
          messages: [],
          activeThreadId: null,
        });
        get().appendConsoleEntry({
          kind: 'info',
          source: 'AI Architect',
          message: `Progetto "${payload.project.name}" generato (${payload.sheets.length} schermate, ${payload.vfsTree.length} file VFS).`,
        });
        get().pushToast(
          'success',
          `Progetto "${payload.project.name}" generato e pronto nell'area di lavoro!`,
        );
      } catch (err) {
        set({ isGeneratingAiProject: false, aiProjectGenStatus: null });
        get().pushToast(
          'error',
          `Errore generazione progetto AI: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    sendStartupChatPrompt: async (prompt) => {
      const trimmed = prompt.trim();
      if (!trimmed || get().isRunningStartupChat) return;

      const api = getStudioApi();
      const runId = `startup_chat_${Date.now().toString(36)}`;
      const history: StartupAssistantMessageTurn[] = get()
        .startupChatMessages.slice(-8)
        .map((m) => ({ role: m.role, content: m.content }));

      const userMsg: StartupChatMessageItem = {
        id: `schat_u_${Date.now().toString(36)}`,
        role: 'user',
        content: trimmed,
        createdAt: Date.now(),
      };

      const ollamaProv = get().providers.find((p) => p.id === 'ollama');
      const effectiveProvider: LocalAIProviderKind = ollamaProv?.online ? 'ollama' : get().activeProvider;
      const effectiveModel =
        effectiveProvider === 'ollama' && ollamaProv?.models.length
          ? ollamaProv.models.some((m) => m.id === get().activeModel)
            ? get().activeModel
            : (pickPreferredLocalModel(ollamaProv.models) ?? get().activeModel)
          : get().activeModel;

      set((s) => ({
        startupChatMessages: [...s.startupChatMessages, userMsg],
        isRunningStartupChat: true,
        startupChatStreaming: { runId, text: '', thinking: '' },
      }));

      try {
        const res = await api.ai.askStartupAssistant({
          prompt: trimmed,
          history,
          provider: effectiveProvider,
          modelName: effectiveModel,
          primaryTarget: get().globalTarget,
          runId,
        });

        const assistantMsg: StartupChatMessageItem = {
          id: `schat_a_${Date.now().toString(36)}`,
          role: 'assistant',
          content: res.reply,
          thinking: res.thinkingText,
          modelName: res.modelName,
          provider: res.provider,
          latencyMs: res.latencyMs,
          suggestedProjectPrompt: res.suggestedProjectPrompt || trimmed,
          usedFallbackOffline: res.usedFallbackOffline,
          createdAt: Date.now(),
        };

        set((s) => ({
          startupChatMessages: [...s.startupChatMessages, assistantMsg],
          isRunningStartupChat: false,
          startupChatStreaming: null,
        }));
      } catch (err) {
        set({ isRunningStartupChat: false, startupChatStreaming: null });
        get().pushToast(
          'error',
          `Errore Chat Ollama: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    clearStartupChat: () => {
      set({ startupChatMessages: [], startupChatStreaming: null });
    },

    sendAgentPrompt: async (prompt) => {
      const {
        project,
        activeSheetId,
        activeThreadId,
        agentMode,
        activeProvider,
        activeModel,
        selectedNodeIds,
        globalTarget,
        globalDialect,
        visionImageBase64,
      } = get();
      if (!project || !activeSheetId || !prompt.trim() || get().isRunningAgent) return;

      set({ isRunningAgent: true });
      try {
        const res = await getStudioApi().ai.runAgentTurn({
          projectId: project.id,
          sheetId: activeSheetId,
          threadId: activeThreadId,
          mode: agentMode,
          provider: activeProvider,
          modelName: activeModel,
          prompt: prompt.trim(),
          selectedNodeIds,
          activeTarget: globalTarget,
          activeDialect: globalDialect,
          visionImageBase64: agentMode === 'vision_to_ui' ? visionImageBase64 ?? undefined : undefined,
        });

        const cps = await getStudioApi().canvas.listCheckpoints(activeSheetId).catch(() => get().checkpoints);

        set((s) => ({
          isRunningAgent: false,
          streamingRun: null,
          activeThreadId: res.threadId,
          messages: [...s.messages, res.userMessage, res.assistantMessage],
          sheetDocuments: { ...s.sheetDocuments, [activeSheetId]: res.updatedSheet },
          checkpoints: cps,
          canUndo: true,
        }));

        void get().compileSheetForTarget(activeSheetId, globalTarget, globalDialect);
        get().pushToast(
          'success',
          `Agent AI: applicate ${res.appliedOps.length} operazioni sul Canvas${res.usedFallbackOffline ? ' (Sintetizzatore Locale)' : ''}.`,
        );
      } catch (err) {
        set({ isRunningAgent: false, streamingRun: null });
        get().pushToast('error', `Errore Agent AI: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    restoreAiCheckpoint: async (checkpointId) => {
      const { activeSheetId, globalTarget, globalDialect } = get();
      try {
        const restored = await getStudioApi().canvas.restoreCheckpoint(checkpointId);
        set((s) => ({
          sheetDocuments: { ...s.sheetDocuments, [restored.sheetId]: restored },
        }));
        if (activeSheetId) {
          void get().compileSheetForTarget(activeSheetId, globalTarget, globalDialect);
        }
        get().pushToast('success', 'Checkpoint pre-AI ripristinato con successo!');
      } catch (err) {
        get().pushToast('error', err instanceof Error ? err.message : 'Impossibile ripristinare il checkpoint.');
      }
    },

    setUnslothModalOpen: (open) => {
      set({ isUnslothModalOpen: open });
      if (open && get().project) {
        void getStudioApi()
          .ai.listUnslothPairs(get().project!.id)
          .then((pairs) => set({ unslothPairs: pairs }))
          .catch(() => {});
      }
    },

    setNewProjectModalOpen: (open) => {
      set({ isNewProjectModalOpen: open });
    },

    setImportCodeModalOpen: (open) => {
      set({ isImportCodeModalOpen: open });
    },

    setA11yModalOpen: (open) => {
      set({ isA11yModalOpen: open });
    },

    pullUnslothModel: async (ollamaUri) => {
      set({ pullProgress: { modelRef: ollamaUri, status: 'Avvio download GGUF da HuggingFace Unsloth...', percent: 5 } });
      try {
        const res = await getStudioApi().ai.pullOllamaModel(ollamaUri);
        get().pushToast(res.ok ? 'success' : 'warn', res.message);
        await get().refreshAiProviders();
      } catch (err) {
        get().pushToast('error', err instanceof Error ? err.message : 'Errore pull modello Ollama');
      } finally {
        setTimeout(() => set({ pullProgress: null }), 2500);
      }
    },

    recordGoldenPairFromActiveSheet: async (promptNote) => {
      const { project, activeSheetId, sheetDocuments, tokens, globalTarget, globalDialect } = get();
      const sheet = sheetDocuments[activeSheetId];
      if (!project || !sheet) return;

      let bundle = get().compiledBundles[bundleCacheKey(activeSheetId, globalTarget, globalDialect)];
      if (!bundle) {
        bundle = (await get().compileSheetForTarget(activeSheetId, globalTarget, globalDialect)) ?? undefined!;
      }
      const acceptedCode = bundle?.files.map((f) => `// File: ${f.relativePath}\n${f.code}`).join('\n\n') ?? '';

      const pair = await getStudioApi().ai.recordUnslothPair({
        projectId: project.id,
        sheetId: activeSheetId,
        promptSummary: promptNote?.trim() || `Build ${sheet.name} screen for ${globalTarget} (${globalDialect})`,
        normalizedUiIrJson: JSON.stringify(sheet),
        tokensSnapshotJson: JSON.stringify(tokens),
        targetFramework: globalTarget,
        acceptedCodeOutput: acceptedCode,
        qualityScore: 5,
      });

      set((s) => ({ unslothPairs: [pair, ...s.unslothPairs] }));
      get().pushToast('success', `Esempio Golden registrato per fine-tuning Unsloth (${globalTarget})!`);
    },

    exportUnslothBundle: async (format, baseModelRepo) => {
      const { project } = get();
      if (!project) return;
      if (get().unslothPairs.length === 0) {
        await get().recordGoldenPairFromActiveSheet();
      }
      const res = await getStudioApi().ai.exportUnslothDataset({
        projectId: project.id,
        format,
        baseModelRepo,
      });
      set({ lastUnslothExport: res });
      get().pushToast(
        'success',
        `Dataset Unsloth esportato (${res.pairCount} esempi): ${res.datasetFilePath}`,
      );
    },

    // ========================================================================
    // v3.0 EXTERNAL SCRIPTS & NO-CODE VISUAL AUTOMATION ACTIONS
    // ========================================================================

    setActiveAutomationId: (automationId) => {
      set({ activeAutomationId: automationId });
    },

    linkScriptFileToSheet: async (ref, explicitSheetId) => {
      const sid = explicitSheetId || get().activeSheetId;
      const sheet = get().sheetDocuments[sid];
      if (!sheet) return;
      const current = sheet.linkedScripts ?? [];
      const next = current.some((l) => l.vfsEntryId === ref.vfsEntryId || l.relativePath === ref.relativePath)
        ? current.map((l) =>
            l.vfsEntryId === ref.vfsEntryId || l.relativePath === ref.relativePath ? ref : l,
          )
        : [...current, ref];
      await get().commitOps([{ op: 'update_sheet_meta', linkedScripts: next }],
        `Collega modulo script ${ref.relativePath}`, 'user', sid);
    },

    unlinkScriptFileFromSheet: async (vfsEntryIdOrPath, explicitSheetId) => {
      const sid = explicitSheetId || get().activeSheetId;
      const sheet = get().sheetDocuments[sid];
      if (!sheet) return;
      const next = (sheet.linkedScripts ?? []).filter(
        (l) => l.vfsEntryId !== vfsEntryIdOrPath && l.relativePath !== vfsEntryIdOrPath,
      );
      await get().commitOps([{ op: 'update_sheet_meta', linkedScripts: next }],
        'Scollega modulo script', 'user', sid);
    },

    saveAndApplyAutomationRule: async (rule, compiledFileContent, expectedFileContent, sheetId = get().activeSheetId) => {
      const { project, sheetDocuments } = get();
      const sheet = sheetDocuments[sheetId];
      if (!project || !sheet) return;

      const vfsEntry = await writeAutomationModule(
        project.id, rule.targetFileRelPath || 'scripts/automations.js',
        compiledFileContent, expectedFileContent, rule.targetFileVfsId,
      );
      if (get().project?.id !== project.id) return;
      const relClean = (vfsEntry.diskRelPath ?? vfsEntry.virtualPath).replace(/^\/+/, '');
      const lang = rule.language ?? inferScriptLanguageFromPath(relClean);

      const normalizedRule: AutomationRule = {
        ...rule,
        targetFileVfsId: vfsEntry.id,
        targetFileRelPath: relClean,
        language: lang,
        updatedAt: Date.now(),
      };

      const existingAutos = sheet.automations ?? [];
      const nextAutos = existingAutos.some((a) => a.id === normalizedRule.id)
        ? existingAutos.map((a) => (a.id === normalizedRule.id ? normalizedRule : a))
        : [...existingAutos, normalizedRule];

      const existingLinks = sheet.linkedScripts ?? [];
      const nextLinks: LinkedScriptModuleRef[] =
        !existingLinks.some((l) => l.vfsEntryId === vfsEntry.id || l.relativePath === relClean)
          ? [
              ...existingLinks,
              {
                vfsEntryId: vfsEntry.id,
                relativePath: relClean,
                language: lang,
                loadStrategy: lang === 'python' ? 'backend-route' : 'module',
                autoInitOnLoad: true,
                scope: 'sheet',
              },
            ]
          : existingLinks;

      const ops: UIPatchOp[] = [
        {
          op: 'update_sheet_meta',
          automations: nextAutos,
          linkedScripts: nextLinks,
        },
      ];

      for (const node of Object.values(sheet.nodes)) {
        const existing = node.interactions ?? [];
        const otherInteractions = existing.filter(
          (inter) => !(inter.action.kind === 'call_script_fn' && inter.action.automationId === normalizedRule.id),
        );
        const attachesToNode = normalizedRule.enabled &&
          normalizedRule.trigger.sourceNodeId === node.id && normalizedRule.trigger.type !== 'callable';
        if (!attachesToNode) {
          if (otherInteractions.length !== existing.length) {
            ops.push({ op: 'set_interaction', id: node.id, interactions: otherInteractions });
          }
        } else if (normalizedRule.trigger.type !== 'callable') {
          ops.push({
            op: 'set_interaction',
            id: node.id,
            interactions: [
              ...otherInteractions,
              {
                trigger: normalizedRule.trigger.type,
                action: {
                  kind: 'call_script_fn',
                  vfsEntryId: vfsEntry.id,
                  moduleRelPath: relClean,
                  fnName: normalizedRule.generatedFnName,
                  debounceMs: normalizedRule.trigger.debounceMs,
                  keyFilter: normalizedRule.trigger.keyFilter,
                  intervalMs: normalizedRule.trigger.intervalMs,
                  automationId: normalizedRule.id,
                },
              },
            ],
          });
        }
      }

      await get().commitOps(ops, `Applica automazione "${normalizedRule.name}"`, 'user', sheetId);
      set({ activeAutomationId: normalizedRule.id, activeScriptVfsId: vfsEntry.id });
      get().appendConsoleEntry({
        kind: 'script',
        source: relClean,
        message: `✓ Funzione "${normalizedRule.generatedFnName}" applicata in ${relClean}`,
      });
      get().pushToast('success', `Automazione "${normalizedRule.name}" applicata su ${relClean}!`);
    },

    deleteAutomationRule: async (automationId, updatedFileContent, expectedFileContent, sheetId = get().activeSheetId) => {
      const sheet = get().sheetDocuments[sheetId];
      if (!sheet) return;
      const target = (sheet.automations ?? []).find((a) => a.id === automationId);
      if (!target) return;

      if (updatedFileContent !== undefined && target.targetFileVfsId) {
        const { vfs } = getStudioApi();
        if (expectedFileContent !== undefined && (await vfs.readFile(target.targetFileVfsId)).content !== expectedFileContent) {
          throw new Error('Il file è stato modificato. Riaprilo per aggiornare l’automazione.');
        }
        await vfs.writeFile(target.targetFileVfsId, updatedFileContent);
        set((s) => ({
          sourceFiles: { ...s.sourceFiles, [target.targetFileVfsId!]: updatedFileContent },
        }));
      }

      const nextAutos = (sheet.automations ?? []).filter((a) => a.id !== automationId);
      const ops: UIPatchOp[] = [{ op: 'update_sheet_meta', automations: nextAutos }];

      for (const node of Object.values(sheet.nodes)) {
        if (
          node.interactions?.some(
            (i) => i.action.kind === 'call_script_fn' && i.action.automationId === automationId,
          )
        ) {
          ops.push({
            op: 'set_interaction',
            id: node.id,
            interactions: node.interactions.filter(
              (i) => !(i.action.kind === 'call_script_fn' && i.action.automationId === automationId),
            ),
          });
        }
      }

      await get().commitOps(ops, `Elimina automazione "${target.name}"`, 'user', sheetId);
      if (get().activeAutomationId === automationId) {
        set({ activeAutomationId: nextAutos[0]?.id ?? null });
      }
      get().pushToast('info', `Automazione "${target.name}" rimossa.`);
    },

    // ========================================================================
    // v3.0 MULTI-DIALECT SQL & DATA STUDIO ACTIONS
    // ========================================================================

    setActiveSqlDialect: async (dialect) => {
      set({ activeSqlDialect: dialect });
      const { sqlDocument } = get();
      if (sqlDocument && sqlDocument.dialect !== dialect) {
        await get().saveSqlSchemaAction({ ...sqlDocument, dialect }, true);
      }
    },

    setActiveSqlConnectionId: (connectionId) => {
      set({ activeSqlConnectionId: connectionId });
    },

    loadSqlSchemaAction: async (explicitProjectId) => {
      const pid = explicitProjectId ?? get().project?.id;
      if (!pid) return null;
      try {
        const [doc, conns] = await Promise.all([
          getStudioApi().sql.loadSchema(pid),
          getStudioApi().sql.listConnections(pid).catch(() => []),
        ]);
        if (get().project?.id !== pid) return null;
        set({
          sqlDocument: doc,
          activeSqlDialect: doc.dialect,
          sqlConnections: conns,
        });
        return doc;
      } catch {
        if (get().project?.id !== pid) return null;
        const fallback = createStarterSqlDocument(pid, get().project?.name ?? 'Studio DB', 'sqlite');
        set({ sqlDocument: fallback });
        return fallback;
      }
    },

    saveSqlSchemaAction: async (doc, silent = false) => {
      const pid = get().project?.id ?? doc.projectId;
      const saved = await getStudioApi().sql.saveSchema(pid, doc);
      set({
        sqlDocument: saved,
        activeSqlDialect: saved.dialect,
      });
      if (!silent) {
        get().pushToast('success', `Schema SQL "${saved.name}" (${saved.dialect}) salvato.`);
      }
    },

    executeSqlQueryAction: async (req) => {
      const pid = req.projectId ?? get().project?.id;
      if (!pid) return null;
      const res = await getStudioApi().sql.executeQuery({
        ...req,
        projectId: pid,
        dialect: req.dialect ?? get().activeSqlDialect,
        connectionId: req.connectionId !== undefined ? req.connectionId : get().activeSqlConnectionId,
        schemaDoc: req.schemaDoc ?? get().sqlDocument ?? undefined,
      });
      set({ lastSqlQueryResult: res });
      get().appendConsoleEntry({
        kind: res.ok ? 'sql' : 'error',
        source: `SQL (${res.dialect})`,
        message: res.ok
          ? `${res.rowCount} righe in ${res.durationMs}ms — ${res.executedSql.slice(0, 120)}`
          : `Errore SQL: ${res.error ?? 'Query fallita'}`,
      });
      return res;
    },

    generateUiFromSqlTableAction: async ({ tableName, ops, automations, stateEntries }) => {
      const { project, activeSheetId, sheetDocuments, sqlDocument, globalTarget } = get();
      const sheet = sheetDocuments[activeSheetId];
      if (!project || !sheet || !sqlDocument) return;
      const states = new Map((sheet.stateSchema ?? []).map((entry) => [entry.name, entry]));
      const rules = new Map((sheet.automations ?? []).map((rule) => [rule.id, rule]));
      for (const entry of stateEntries) {
        if (!states.has(entry.name)) states.set(entry.name, entry);
      }
      const updatedSheet = applyPatchOpsToSheet(sheet, ops).nextSheet;
      const links = new Map((sheet.linkedScripts ?? []).map((entry) => [entry.relativePath, entry]));
      const byFile = new Map<string, AutomationRule[]>();
      for (const rule of automations) {
        const fileRules = byFile.get(rule.targetFileRelPath) ?? [];
        fileRules.push(rule);
        byFile.set(rule.targetFileRelPath, fileRules);
      }
      const api = getStudioApi();
      const tree = await api.vfs.listTree(project.id);
      for (const [path, fileRules] of byFile) {
        if (get().project?.id !== project.id) return;
        const existing = tree.find((entry) =>
          (entry.diskRelPath ?? entry.virtualPath).replace(/^\/+/, '') === path,
        );
        const original = existing ? (await api.vfs.readFile(existing.id)).content : '';
        let content = original;
        for (const rule of fileRules) {
          const compiled = compileAutomationRuleToCode(rule, {
            target: globalTarget, language: rule.language, sheet: updatedSheet, sqlDocument,
          });
          content = upsertManagedAutomationInFile(content, rule, compiled);
        }
        const file = await writeAutomationModule(project.id, path, content, original, existing?.id);
        const language = fileRules[0].language ?? inferScriptLanguageFromPath(path);
        links.set(path, {
          relativePath: path, language, vfsEntryId: file.id,
          loadStrategy: language === 'python' ? 'backend-route' : 'module', scope: 'sheet',
        });
        for (const rule of fileRules) rules.set(rule.id, { ...rule, language, targetFileVfsId: file.id });
      }
      if (get().project?.id !== project.id) return;
      await get().commitOps([
        ...ops,
        {
          op: 'update_sheet_meta',
          stateSchema: [...states.values()],
          automations: [...rules.values()],
          linkedScripts: [...links.values()],
        },
      ], `Genera UI CRUD da tabella SQL "${tableName}"`, 'user', activeSheetId);
      get().pushToast('success', `Interfaccia CRUD per "${tableName}" generata sul Canvas!`);
    },

    // ========================================================================
    // v3.0 REAL DISK PROJECTS & TOOLCHAIN RUNNER ACTIONS
    // ========================================================================

    refreshToolchainDoctor: async () => {
      try {
        const report = await getStudioApi().toolchain.checkDoctor();
        set({ toolchainDoctor: report });
        return report;
      } catch {
        return null;
      }
    },

    createAndInitDiskProjectAction: async (spec) => {
      const api = getStudioApi();
      try {
        const payload = await api.project.createAndInitDiskProject(spec);
        await applyBootstrapPayload(payload);
        const recents = await api.project.listRecent().catch(() => get().recentProjects);
        set({
          recentProjects: recents,
          showProjectHub: false,
          hasOpenedProjectInSession: true,
          wizardOpen: false,
          isNewProjectModalOpen: false,
        });
        get().pushToast(
          'success',
          payload.project.rootDiskPath
            ? `Progetto "${payload.project.name}" (${spec.stackId} • ${spec.primaryLanguage}) creato su disco!`
            : `Progetto "${payload.project.name}" creato nell’area di lavoro del browser.`,
        );
        return payload;
      } catch (err) {
        get().pushToast(
          'error',
          `Errore creazione progetto su disco: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    },

    openExistingDiskProjectAction: async (dirPath) => {
      const api = getStudioApi();
      try {
        const payload = await api.project.openExistingDiskProject(dirPath);
        if (!payload) return null;
        await applyBootstrapPayload(payload);
        const recents = await api.project.listRecent().catch(() => get().recentProjects);
        set({
          recentProjects: recents,
          showProjectHub: false,
          hasOpenedProjectInSession: true,
          wizardOpen: false,
        });
        get().pushToast(
          'success',
          `Aperto progetto da disco "${payload.project.name}" (${payload.project.stackId ?? payload.project.primaryTarget})`,
        );
        return payload;
      } catch (err) {
        get().pushToast(
          'error',
          `Errore apertura cartella: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    },

    runToolchainTaskAction: async (req) => {
      const project = get().project;
      const pid = req.projectId ?? project?.id;
      if (!pid) return null;
      set({ bottomConsoleOpen: true });
      try {
        const res = await getStudioApi().toolchain.runTask({
          ...req,
          projectId: pid,
          rootDiskPath: req.rootDiskPath ?? project?.rootDiskPath ?? undefined,
          stackId: req.stackId ?? project?.stackId,
          primaryLanguage: req.primaryLanguage ?? project?.primaryLanguage,
          pythonCompanion: req.pythonCompanion ?? project?.pythonCompanion,
        });
        return res.taskId;
      } catch (err) {
        get().pushToast('error', err instanceof Error ? err.message : 'Errore esecuzione task toolchain.');
        return null;
      }
    },

    stopToolchainTaskAction: async (taskId) => {
      await getStudioApi().toolchain.stopTask(taskId);
      set((s) => ({
        toolchainTasks: s.toolchainTasks.map((t) =>
          t.taskId === taskId ? { ...t, status: 'stopped', endedAt: Date.now() } : t,
        ),
      }));
      get().pushToast('info', 'Processo toolchain interrotto.');
    },
  };
});
