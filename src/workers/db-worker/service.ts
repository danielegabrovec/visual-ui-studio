import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { deflateSync, inflateSync } from 'node:zlib';

import { createStarterBlueprintGraph } from '../../shared/blueprint-ir';
import { compileSheetToCss } from '../../shared/css-sync-engine';
import {
  createDefaultThemes,
  createDefaultTokens,
  createStarterDemoSheet,
  DEFAULT_BREAKPOINTS,
} from '../../shared/default-tokens';
import { searchOfflineIcons } from '../../shared/icon-catalog';
import { createStarterScriptModuleTs } from '../../shared/script-ir';
import { createThreeSceneFromPreset } from '../../shared/three-ir';
import {
  inferVfsKindFromFilename,
  isTextFileVfsKind,
  type AgentChatMessageDTO,
  type AgentThreadDTO,
  type CheckpointReason,
  type CheckpointSummaryDTO,
  type CommittedPatchBatch,
  type CreateProjectInput,
  type CreateVfsEntryInput,
  type LocalAIProviderKind,
  type OfflineIconEntry,
  type PatchCommitResult,
  type ProjectBootstrapPayload,
  type ProjectSummary,
  type RecordUnslothPairInput,
  type SheetSummaryDTO,
  type UnslothTrainingPairDTO,
  type VfsEntryKind,
  type VfsNodeDTO,
  type WorkspaceStateDTO,
} from '../../shared/ipc-contract';
import type {
  DetectedDiskProjectInfo,
  PrimaryCodeLanguage,
  ProjectStackId,
  PythonCompanionKind,
} from '../../shared/project-stacks';
import { planRustTauriSqlInstall, RUST_TAURI_SQL_PATHS } from '../../shared/rust-tauri-sql-install';
import {
  createStarterSqlDocument,
  type ExtractedSqlOperation,
  type SqlConnectionProfile,
  type SqlDataChange,
  type SqlDesignDocument,
  type SqlDialect,
  type SqlMigrationPlan,
  type SqlQueryHistoryEntry,
  type SqlQueryRequest,
  type SqlQueryResult,
} from '../../shared/sql-ir';
import type {
  CodegenTargetId,
  DesignTheme,
  DesignTokenEntry,
  StylingDialect,
  TargetArtifactBundle,
  UINode,
  UISheetDocument,
} from '../../shared/ui-ir';
import {
  applyPatchOpsToSheet,
  createDefaultUINode,
  fractionalOrderAt,
  generateNodeId,
  type UIPatchOp,
} from '../../shared/ui-patch';
import type {
  IDbWorkerService,
  PersistProjectSeedOptions,
  SaveAiTurnPayload,
} from '../../shared/worker-protocol';
import {
  buildWizardProjectSeed,
  type ProjectWizardSpec,
  type WizardProjectSeedBundle,
} from '../../shared/wizard-templates';
import { extractSqlFromSourceCode, importSqlDdlToTables } from '../../shared/sql-import';
import { attachBaselinesToDocument } from '../../shared/sql-migration';
import { migrateGlobalDb, migrateProjectDb } from './schema';
import { SqlStudioEngine } from './sql-studio-engine';

function defaultTextContentForKind(kind: VfsEntryKind, cleanName: string, projectId: string, projectName: string): string {
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

export interface DbWorkerOptions {
  storageRootDir?: string;
}

interface CompressedCheckpointPayload {
  sheet: UISheetDocument;
  vfsBackups: Array<{ id: string; contentText: string | null; contentSha256: string | null }>;
}

function sha256Hex(text: string | Uint8Array): string {
  return createHash('sha256').update(text).digest('hex');
}

function sanitizeSlug(name: string): string {
  const clean = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean || 'project';
}

function normalizePosixPath(p: string): string {
  const withSlashes = p.replace(/\\/g, '/').replace(/\/+/g, '/');
  return withSlashes.startsWith('/') ? withSlashes : `/${withSlashes}`;
}

function resolveProjectDiskPath(rootDir: string, relativePath: string): string {
  const root = realpathSync(rootDir);
  const parts = relativePath.split(/[/\\]+/);
  if (isAbsolute(relativePath) || parts.some((part) => !part || part === '..' || part === '.' || part.includes(':'))) {
    throw new Error(`Percorso di progetto non valido: ${relativePath}`);
  }
  let path = root;
  for (const part of parts) {
    path = join(path, part);
    if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error(`I collegamenti simbolici non possono essere sincronizzati: ${relativePath}`);
    }
  }
  return path;
}

export class DbWorkerService implements IDbWorkerService {
  private readonly storageRootDir: string;
  private readonly projectsDir: string;
  private readonly globalDb: DatabaseSync;
  private readonly sqlEngine = new SqlStudioEngine();
  private activeProjectDb: DatabaseSync | null = null;
  private activeProjectId: string | null = null;
  private activeProjectDbPath: string | null = null;
  private txDepth = 0;

  constructor(options: DbWorkerOptions = {}) {
    this.storageRootDir =
      options.storageRootDir ??
      process.env.STUDIO_DATA_DIR ??
      join(homedir(), '.visual-ui-studio');
    this.projectsDir = join(this.storageRootDir, 'projects');
    mkdirSync(this.projectsDir, { recursive: true });

    const globalDbPath = join(this.storageRootDir, 'studio-global.sqlite');
    this.globalDb = new DatabaseSync(globalDbPath);
    migrateGlobalDb(this.globalDb);
  }

  public close(): void {
    this.sqlEngine.closeAll();
    if (this.activeProjectDb) {
      try {
        this.activeProjectDb.close();
      } catch {
        // ignore close error
      }
      this.activeProjectDb = null;
      this.activeProjectId = null;
      this.activeProjectDbPath = null;
    }
    try {
      this.globalDb.close();
    } catch {
      // ignore close error
    }
  }

  private withTx<T>(db: DatabaseSync, fn: () => T): T {
    const spName = `sp_${++this.txDepth}`;
    if (this.txDepth === 1) {
      db.exec('BEGIN IMMEDIATE');
    } else {
      db.exec(`SAVEPOINT ${spName}`);
    }
    try {
      const out = fn();
      if (this.txDepth === 1) {
        db.exec('COMMIT');
      } else {
        db.exec(`RELEASE SAVEPOINT ${spName}`);
      }
      this.txDepth--;
      return out;
    } catch (err) {
      try {
        if (this.txDepth === 1) {
          db.exec('ROLLBACK');
        } else {
          db.exec(`ROLLBACK TO SAVEPOINT ${spName}`);
          db.exec(`RELEASE SAVEPOINT ${spName}`);
        }
      } catch {
        // ignore rollback nested failure
      }
      this.txDepth--;
      throw err;
    }
  }

  private requireProjectDb(expectedProjectId?: string): DatabaseSync {
    if (!this.activeProjectDb || !this.activeProjectId) {
      throw new Error('No active project database is open.');
    }
    if (expectedProjectId && expectedProjectId !== this.activeProjectId) {
      const recent = this.globalDb
        .prepare('SELECT db_file_path FROM recent_projects WHERE id = ?')
        .get(expectedProjectId) as { db_file_path: string } | undefined;
      if (recent && existsSync(recent.db_file_path)) {
        this.switchProjectDbSync(recent.db_file_path);
      }
    }
    return this.activeProjectDb!;
  }

  private switchProjectDbSync(dbFilePath: string): DatabaseSync {
    if (this.activeProjectDb && this.activeProjectDbPath === dbFilePath) {
      return this.activeProjectDb;
    }
    if (this.activeProjectDb) {
      try {
        this.activeProjectDb.close();
      } catch {
        // ignore
      }
    }
    mkdirSync(dirname(dbFilePath), { recursive: true });
    const db = new DatabaseSync(dbFilePath);
    migrateProjectDb(db);
    const projRow = db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: string } | undefined;
    this.activeProjectDb = db;
    this.activeProjectDbPath = dbFilePath;
    this.activeProjectId = projRow?.id ?? null;
    return db;
  }

  // ==========================================================================
  // PROJECT LIFECYCLE
  // ==========================================================================

  public async listRecentProjects(): Promise<ProjectSummary[]> {
    const rows = this.globalDb
      .prepare('SELECT * FROM recent_projects ORDER BY updated_at DESC LIMIT 25')
      .all() as Array<Record<string, any>>;

    return rows
      .filter((r) => existsSync(String(r.db_file_path)))
      .map((r) => ({
        id: String(r.id),
        name: String(r.name),
        dbFilePath: String(r.db_file_path),
        rootDiskPath: r.root_disk_path ? String(r.root_disk_path) : null,
        primaryTarget: String(r.primary_target) as CodegenTargetId,
        stylingPreset: String(r.styling_preset) as StylingDialect,
        stackId: r.stack_id ? (String(r.stack_id) as ProjectStackId) : undefined,
        primaryLanguage: r.primary_language ? (String(r.primary_language) as PrimaryCodeLanguage) : undefined,
        activeThemeId: null,
        breakpoints: DEFAULT_BREAKPOINTS,
        layoutMode:
          r.layout_mode === 'freeform' || r.layout_mode === 'auto'
            ? r.layout_mode
            : undefined,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
      }));
  }

  public async removeRecentProject(projectId: string): Promise<ProjectSummary[]> {
    const clean = (projectId || '').trim();
    if (clean) {
      this.globalDb
        .prepare('DELETE FROM recent_projects WHERE id = ? OR db_file_path = ?')
        .run(clean, clean);
    }
    return this.listRecentProjects();
  }

  public async getCurrentProject(): Promise<ProjectBootstrapPayload> {
    if (this.activeProjectDb && this.activeProjectId) {
      return this.buildBootstrapPayloadSync(this.activeProjectDb, this.activeProjectDbPath!);
    }
    const recents = await this.listRecentProjects();
    if (recents.length > 0) {
      return this.openProject(recents[0].dbFilePath);
    }
    return this.createProject({
      name: 'NovaCommerce Studio',
      primaryTarget: 'react-tsx',
      stylingPreset: 'tailwind',
      seedDemoContent: true,
    });
  }

  public async createProject(input: CreateProjectInput): Promise<ProjectBootstrapPayload> {
    const now = Date.now();
    const projectId = `proj_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const cleanName = input.name.trim() || 'Untitled Studio Project';
    const rootDiskPath = input.rootDiskPath ? resolve(input.rootDiskPath) : null;
    const primaryTarget = input.primaryTarget ?? 'react-tsx';
    const stylingPreset = input.stylingPreset ?? 'tailwind';
    const seedDemo = input.seedDemoContent !== false;
    const layoutMode: 'freeform' | 'auto' = input.layoutMode ?? (seedDemo ? 'auto' : 'freeform');

    let dbFilePath: string;
    if (rootDiskPath) {
      const dotDir = join(rootDiskPath, '.uistudio');
      mkdirSync(dotDir, { recursive: true });
      dbFilePath = join(dotDir, 'project.uistudio');
    } else {
      dbFilePath = join(this.projectsDir, `${sanitizeSlug(cleanName)}-${projectId.slice(-6)}.uistudio`);
    }

    const db = this.switchProjectDbSync(dbFilePath);
    const { lightTheme, darkTheme, all: allThemes } = createDefaultThemes(projectId);
    const defaultTokens = createDefaultTokens(projectId, darkTheme.id);

    const starterSqlDoc = attachBaselinesToDocument(
      createStarterSqlDocument(projectId, cleanName, 'sqlite'),
    );

    this.withTx(db, () => {
      db.prepare(`
        INSERT INTO projects (
          id, name, root_disk_path, primary_target, styling_preset, stack_id, primary_language,
          active_theme_id, breakpoints_json, settings_json, sql_schema_json, schema_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2, ?, ?)
      `).run(
        projectId,
        cleanName,
        rootDiskPath,
        primaryTarget,
        stylingPreset,
        input.stackId ?? null,
        input.primaryLanguage ?? null,
        lightTheme.id,
        JSON.stringify(DEFAULT_BREAKPOINTS),
        JSON.stringify({
          layoutMode,
          stackId: input.stackId,
          primaryLanguage: input.primaryLanguage,
          pythonCompanion: input.pythonCompanion,
        }),
        JSON.stringify(starterSqlDoc),
        now,
        now,
      );

      for (const th of allThemes) {
        db.prepare('INSERT INTO themes (id, project_id, name, is_default) VALUES (?, ?, ?, ?)').run(
          th.id,
          projectId,
          th.name,
          th.isDefault ? 1 : 0,
        );
      }

      const insToken = db.prepare(`
        INSERT INTO design_tokens (id, project_id, theme_id, token_path, category, raw_value, alias_of_path)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const tok of defaultTokens) {
        insToken.run(tok.id, projectId, tok.themeId, tok.tokenPath, tok.category, tok.rawValue, tok.aliasOfPath ?? null);
      }

      // Seed VFS folders & starter sheet + v2.0 CSS / TS / Blueprint / 3D assets
      const srcFolderId = generateNodeId('vfs');
      const screensFolderId = generateNodeId('vfs');
      const componentsFolderId = generateNodeId('vfs');
      const stylesFolderId = generateNodeId('vfs');
      const scriptsFolderId = generateNodeId('vfs');
      const blueprintsFolderId = generateNodeId('vfs');
      const scenes3dFolderId = generateNodeId('vfs');
      const homeSheetVfsId = generateNodeId('vfs');
      const apiFileVfsId = generateNodeId('vfs');
      const styleFileVfsId = generateNodeId('vfs');
      const scriptFileVfsId = generateNodeId('vfs');
      const bpFileVfsId = generateNodeId('vfs');
      const scene3dFileVfsId = generateNodeId('vfs');
      const homeSheetId = `sheet_home_${projectId.slice(-5)}`;

      const starterSheet: UISheetDocument = seedDemo
        ? createStarterDemoSheet(projectId, homeSheetId, 'HomeDashboard')
        : {
            sheetId: homeSheetId,
            projectId,
            name: 'HomeDashboard',
            rootIds: ['art_blank_root'],
            defaultLayoutMode: layoutMode === 'freeform' ? 'freeform' : 'flex',
            nodes: {
              art_blank_root: createDefaultUINode(
                {
                  id: 'art_blank_root',
                  kind: 'artboard',
                  name: 'MainArtboard',
                  layout: {
                    mode: layoutMode === 'freeform' ? 'freeform' : 'flex',
                    positioning: 'flow',
                    direction: 'column',
                    gap: 16,
                    justify: 'start',
                    align: 'stretch',
                    frame: { x: 40, y: 40, width: 1200, height: 800 },
                    width: { mode: 'fixed', value: 1200 },
                    height: { mode: 'fixed', value: 800 },
                    padding:
                      layoutMode === 'freeform'
                        ? { top: 0, right: 0, bottom: 0, left: 0 }
                        : { top: 24, right: 24, bottom: 24, left: 24 },
                  },
                },
                homeSheetId,
              ),
            },
            stateSchema: [],
            propsSchema: [],
            ipcSchema: [],
          };

      const insVfs = db.prepare(`
        INSERT INTO vfs_entries (
          id, project_id, parent_id, name, virtual_path, disk_rel_path, entry_kind,
          target_framework, sync_mode, content_text, content_sha256, last_disk_mtime,
          git_status, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const syncMode = rootDiskPath ? 'two_way_disk' : 'virtual_only';
      insVfs.run(srcFolderId, projectId, null, 'src', '/src', rootDiskPath ? 'src' : null, 'folder', null, syncMode, null, null, null, 'clean', fractionalOrderAt(0), now, now);
      insVfs.run(screensFolderId, projectId, srcFolderId, 'screens', '/src/screens', rootDiskPath ? 'src/screens' : null, 'folder', null, syncMode, null, null, null, 'clean', fractionalOrderAt(0), now, now);
      insVfs.run(componentsFolderId, projectId, srcFolderId, 'components', '/src/components', rootDiskPath ? 'src/components' : null, 'folder', null, syncMode, null, null, null, 'clean', fractionalOrderAt(1), now, now);
      insVfs.run(stylesFolderId, projectId, srcFolderId, 'styles', '/src/styles', rootDiskPath ? 'src/styles' : null, 'folder', null, syncMode, null, null, null, 'clean', fractionalOrderAt(2), now, now);
      insVfs.run(scriptsFolderId, projectId, srcFolderId, 'scripts', '/src/scripts', rootDiskPath ? 'src/scripts' : null, 'folder', null, syncMode, null, null, null, 'clean', fractionalOrderAt(3), now, now);
      insVfs.run(blueprintsFolderId, projectId, srcFolderId, 'blueprints', '/src/blueprints', rootDiskPath ? 'src/blueprints' : null, 'folder', null, syncMode, null, null, null, 'clean', fractionalOrderAt(4), now, now);
      insVfs.run(scenes3dFolderId, projectId, srcFolderId, 'scenes3d', '/src/scenes3d', rootDiskPath ? 'src/scenes3d' : null, 'folder', null, syncMode, null, null, null, 'clean', fractionalOrderAt(5), now, now);
      insVfs.run(homeSheetVfsId, projectId, screensFolderId, 'HomeDashboard.canvas', '/src/screens/HomeDashboard.canvas', null, 'canvas_sheet', primaryTarget, 'virtual_only', null, null, null, 'clean', fractionalOrderAt(0), now, now);

      const sampleApiContent = `// Mock Local API & HTMX Hypermedia Endpoints\nexport async function fetchProducts(query = '') {\n  return [\n    { id: 'SKU-4090', title: 'Workstation GPU Module', stock: 24, price: 1599 },\n    { id: 'SKU-2088', title: 'Tactile Studio Keyboard', stock: 86, price: 189 },\n  ].filter((p) => p.title.toLowerCase().includes(query.toLowerCase()));\n}\n`;
      const starterCssContent = compileSheetToCss(starterSheet, defaultTokens, lightTheme.id).css;
      const starterScriptContent = createStarterScriptModuleTs(cleanName);
      const starterBpDoc = createStarterBlueprintGraph(projectId, homeSheetId);
      const starterBpContent = JSON.stringify(starterBpDoc, null, 2);
      const starterScene3dDoc = createThreeSceneFromPreset(projectId, 'pbr-product-showcase');
      const starterScene3dContent = JSON.stringify(starterScene3dDoc, null, 2);

      insVfs.run(
        apiFileVfsId,
        projectId,
        srcFolderId,
        'api.ts',
        '/src/api.ts',
        rootDiskPath ? 'src/api.ts' : null,
        'source_file',
        null,
        syncMode,
        sampleApiContent,
        sha256Hex(sampleApiContent),
        now,
        'clean',
        fractionalOrderAt(6),
        now,
        now,
      );

      insVfs.run(
        styleFileVfsId,
        projectId,
        stylesFolderId,
        'theme-and-sheet.css',
        '/src/styles/theme-and-sheet.css',
        rootDiskPath ? 'src/styles/theme-and-sheet.css' : null,
        'style_file',
        null,
        syncMode,
        starterCssContent,
        sha256Hex(starterCssContent),
        now,
        'clean',
        fractionalOrderAt(0),
        now,
        now,
      );

      insVfs.run(
        scriptFileVfsId,
        projectId,
        scriptsFolderId,
        'handlers.ts',
        '/src/scripts/handlers.ts',
        rootDiskPath ? 'src/scripts/handlers.ts' : null,
        'script_file',
        null,
        syncMode,
        starterScriptContent,
        sha256Hex(starterScriptContent),
        now,
        'clean',
        fractionalOrderAt(0),
        now,
        now,
      );

      const bpFileName = `${starterBpDoc.name}.blueprint.json`;
      insVfs.run(
        bpFileVfsId,
        projectId,
        blueprintsFolderId,
        bpFileName,
        `/src/blueprints/${bpFileName}`,
        rootDiskPath ? `src/blueprints/${bpFileName}` : null,
        'blueprint_graph',
        null,
        syncMode,
        starterBpContent,
        sha256Hex(starterBpContent),
        now,
        'clean',
        fractionalOrderAt(0),
        now,
        now,
      );

      const scene3dFileName = `${starterScene3dDoc.name}.scene3d.json`;
      insVfs.run(
        scene3dFileVfsId,
        projectId,
        scenes3dFolderId,
        scene3dFileName,
        `/src/scenes3d/${scene3dFileName}`,
        rootDiskPath ? `src/scenes3d/${scene3dFileName}` : null,
        'three_scene',
        null,
        syncMode,
        starterScene3dContent,
        sha256Hex(starterScene3dContent),
        now,
        'clean',
        fractionalOrderAt(0),
        now,
        now,
      );

      if (rootDiskPath) {
        mkdirSync(join(rootDiskPath, 'src', 'screens'), { recursive: true });
        mkdirSync(join(rootDiskPath, 'src', 'components'), { recursive: true });
        mkdirSync(join(rootDiskPath, 'src', 'styles'), { recursive: true });
        mkdirSync(join(rootDiskPath, 'src', 'scripts'), { recursive: true });
        mkdirSync(join(rootDiskPath, 'src', 'blueprints'), { recursive: true });
        mkdirSync(join(rootDiskPath, 'src', 'scenes3d'), { recursive: true });
        writeFileSync(join(rootDiskPath, 'src', 'api.ts'), sampleApiContent, 'utf8');
        writeFileSync(join(rootDiskPath, 'src', 'styles', 'theme-and-sheet.css'), starterCssContent, 'utf8');
        writeFileSync(join(rootDiskPath, 'src', 'scripts', 'handlers.ts'), starterScriptContent, 'utf8');
        writeFileSync(join(rootDiskPath, 'src', 'blueprints', bpFileName), starterBpContent, 'utf8');
        writeFileSync(join(rootDiskPath, 'src', 'scenes3d', scene3dFileName), starterScene3dContent, 'utf8');
      }

      db.prepare(`
        INSERT INTO sheets (
          id, project_id, vfs_entry_id, name, sheet_kind, viewport_x, viewport_y, viewport_zoom,
          state_schema_json, props_schema_json, ipc_schema_json, custom_css, default_layout_mode, updated_at
        ) VALUES (?, ?, ?, ?, 'visual_canvas', 0, 0, 0.85, ?, ?, ?, ?, ?, ?)
      `).run(
        homeSheetId,
        projectId,
        homeSheetVfsId,
        starterSheet.name,
        JSON.stringify(starterSheet.stateSchema ?? []),
        JSON.stringify(starterSheet.propsSchema ?? []),
        JSON.stringify(starterSheet.ipcSchema ?? []),
        starterSheet.customCss ?? '',
        starterSheet.defaultLayoutMode ?? (layoutMode === 'freeform' ? 'freeform' : 'flex'),
        now,
      );

      this.persistSheetNodesSync(db, starterSheet, now);

      const defaultOpenTabs = [
        { id: `tab_canvas_${homeSheetId}`, kind: 'canvas', sheetId: homeSheetId, title: 'HomeDashboard.canvas' },
        { id: `tab_code_${homeSheetId}`, kind: 'code', sheetId: homeSheetId, title: 'HomeDashboard (Code)', targetId: primaryTarget },
      ];

      db.prepare(`
        INSERT INTO workspace_state (
          project_id, open_tabs_json, left_top_ratio, left_active_mode,
          right_panel_mode, right_panel_width, active_ai_provider_id, active_ai_model_id, updated_at
        ) VALUES (?, ?, 0.45, 'insert', 'split', 380, 'ollama', 'qwen2.5-coder:7b', ?)
      `).run(projectId, JSON.stringify(defaultOpenTabs), now);

      // Initial baseline checkpoint
      const compressed = this.compressCheckpointSync(starterSheet, []);
      db.prepare(`
        INSERT INTO history_checkpoints (
          id, project_id, sheet_id, reason, label, ai_run_id, command_seq_at,
          compressed_snapshot, touched_files_backup_json, created_at
        ) VALUES (?, ?, ?, 'manual', 'Initial Project Baseline', NULL, 0, ?, '[]', ?)
      `).run(`chk_init_${projectId.slice(-6)}`, projectId, homeSheetId, compressed, now);

      if (seedDemo) {
        this.seedDemoUnslothPairsSync(db, projectId, homeSheetId, starterSheet, defaultTokens, now);
      }
    });

    this.activeProjectId = projectId;
    this.upsertRecentProjectSync(
      projectId,
      cleanName,
      dbFilePath,
      rootDiskPath,
      primaryTarget,
      stylingPreset,
      now,
      now,
      layoutMode,
      input.stackId,
      input.primaryLanguage,
    );

    return this.buildBootstrapPayloadSync(db, dbFilePath);
  }

  public async createProjectFromWizard(spec: ProjectWizardSpec): Promise<ProjectBootstrapPayload> {
    const seed = buildWizardProjectSeed(spec);
    return this.createProjectFromSeed(seed, {
      layoutMode: spec.layoutMode,
      category: spec.category,
      paletteId: spec.paletteId,
      defaultThemeMode: spec.defaultThemeMode,
      rootDiskPath: spec.rootDiskPath ?? null,
    });
  }

  public async createProjectFromSeed(
    seed: WizardProjectSeedBundle,
    options: PersistProjectSeedOptions = {},
  ): Promise<ProjectBootstrapPayload> {
    const now = Date.now();
    const {
      projectId,
      projectName,
      primaryTarget,
      stylingPreset,
      activeThemeId,
      themes: seedThemes,
      tokens: seedTokens,
      sheets: seedSheets,
      vfsItems,
    } = seed;
    const layoutMode: 'freeform' | 'auto' = options.layoutMode ?? 'freeform';
    const rootDiskPath = options.rootDiskPath ? resolve(options.rootDiskPath) : null;
    const activeAiProviderId = options.activeAiProviderId ?? 'ollama';
    const activeAiModelId = options.activeAiModelId ?? 'qwen2.5-coder:7b';

    let dbFilePath: string;
    if (rootDiskPath) {
      const dotDir = join(rootDiskPath, '.uistudio');
      mkdirSync(dotDir, { recursive: true });
      dbFilePath = join(dotDir, 'project.uistudio');
    } else {
      dbFilePath = join(this.projectsDir, `${sanitizeSlug(projectName)}-${projectId.slice(-6)}.uistudio`);
    }

    const db = this.switchProjectDbSync(dbFilePath);
    const seedSqlDoc = attachBaselinesToDocument(
      options.sqlDocument ?? createStarterSqlDocument(projectId, projectName, 'sqlite'),
    );

    this.withTx(db, () => {
      db.prepare(`
        INSERT INTO projects (
          id, name, root_disk_path, primary_target, styling_preset, stack_id, primary_language,
          active_theme_id, breakpoints_json, settings_json, sql_schema_json, schema_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2, ?, ?)
      `).run(
        projectId,
        projectName,
        rootDiskPath,
        primaryTarget,
        stylingPreset,
        options.stackId ?? null,
        options.primaryLanguage ?? null,
        activeThemeId,
        JSON.stringify(DEFAULT_BREAKPOINTS),
        JSON.stringify({
          layoutMode,
          category: options.category ?? 'web',
          paletteId: options.paletteId ?? 'dark-pro',
          defaultThemeMode: options.defaultThemeMode ?? 'dark',
          stackId: options.stackId,
          primaryLanguage: options.primaryLanguage,
          pythonCompanion: options.pythonCompanion,
        }),
        JSON.stringify(seedSqlDoc),
        now,
        now,
      );

      const insTheme = db.prepare('INSERT INTO themes (id, project_id, name, is_default) VALUES (?, ?, ?, ?)');
      for (const th of seedThemes) {
        insTheme.run(th.id, projectId, th.name, th.isDefault ? 1 : 0);
      }

      const insToken = db.prepare(`
        INSERT INTO design_tokens (id, project_id, theme_id, token_path, category, raw_value, alias_of_path)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const tok of seedTokens) {
        insToken.run(tok.id, projectId, tok.themeId, tok.tokenPath, tok.category, tok.rawValue, tok.aliasOfPath ?? null);
      }

      const insVfs = db.prepare(`
        INSERT INTO vfs_entries (
          id, project_id, parent_id, name, virtual_path, disk_rel_path, entry_kind,
          target_framework, sync_mode, content_text, content_sha256, last_disk_mtime,
          git_status, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'clean', ?, ?, ?)
      `);

      const keyToVfsId = new Map<string, string>();
      const sheetIdToVfsId = new Map<string, string>();
      const vfsBackups: Array<{ id: string; contentText: string | null; contentSha256: string | null }> = [];

      vfsItems.forEach((item, idx) => {
        const vfsId = generateNodeId('vfs');
        keyToVfsId.set(item.key, vfsId);
        if (item.sheetId) {
          sheetIdToVfsId.set(item.sheetId, vfsId);
        }

        const parentId = item.parentKey ? (keyToVfsId.get(item.parentKey) ?? null) : null;
        const vPath = normalizePosixPath(item.virtualPath);
        const isDiskBacked = Boolean(rootDiskPath && item.entryKind !== 'canvas_sheet');
        const relDisk = isDiskBacked ? vPath.replace(/^\/+/, '') : null;
        const syncMode = isDiskBacked ? 'two_way_disk' : 'virtual_only';
        const contentText = typeof item.contentText === 'string' ? item.contentText : null;
        const sha = contentText !== null ? sha256Hex(contentText) : null;

        insVfs.run(
          vfsId,
          projectId,
          parentId,
          item.name,
          vPath,
          relDisk,
          item.entryKind,
          item.entryKind === 'canvas_sheet' ? primaryTarget : null,
          syncMode,
          contentText,
          sha,
          isDiskBacked && contentText !== null ? now : null,
          fractionalOrderAt(idx),
          now,
          now,
        );

        if (isTextFileVfsKind(item.entryKind)) {
          vfsBackups.push({ id: vfsId, contentText, contentSha256: sha });
        }

        if (rootDiskPath && relDisk) {
          const fullTarget = join(rootDiskPath, relDisk);
          if (item.entryKind === 'folder') {
            mkdirSync(fullTarget, { recursive: true });
          } else if (contentText !== null) {
            mkdirSync(dirname(fullTarget), { recursive: true });
            writeFileSync(fullTarget, contentText, 'utf8');
          }
        }
      });

      // Persist extra scaffolded disk files (including binary Uint8Array icons & stack configs)
      if (options.extraDiskFiles && options.extraDiskFiles.length > 0) {
        options.extraDiskFiles.forEach((extra, extraIdx) => {
          const relClean = extra.relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
          if (!relClean) return;
          const vPath = normalizePosixPath(relClean);

          if (rootDiskPath) {
            const fullTarget = join(rootDiskPath, relClean);
            mkdirSync(dirname(fullTarget), { recursive: true });
            if (typeof extra.content === 'string') {
              writeFileSync(fullTarget, extra.content, 'utf8');
            } else {
              writeFileSync(fullTarget, extra.content);
            }
          }

          // Ensure parent VFS folders exist
          const parts = vPath.split('/').filter(Boolean);
          let curParentId: string | null = null;
          let accumPath = '';
          for (let i = 0; i < parts.length - 1; i++) {
            accumPath += `/${parts[i]}`;
            const existingFolder = db
              .prepare('SELECT id FROM vfs_entries WHERE project_id = ? AND virtual_path = ?')
              .get(projectId, accumPath) as { id: string } | undefined;
            if (existingFolder) {
              curParentId = existingFolder.id;
            } else {
              const folderId = generateNodeId('vfs');
              insVfs.run(
                folderId,
                projectId,
                curParentId,
                parts[i],
                accumPath,
                rootDiskPath ? accumPath.slice(1) : null,
                'folder',
                null,
                rootDiskPath ? 'two_way_disk' : 'virtual_only',
                null,
                null,
                null,
                fractionalOrderAt(vfsItems.length + extraIdx + i),
                now,
                now,
              );
              curParentId = folderId;
            }
          }

          const existingEntry = db
            .prepare('SELECT id FROM vfs_entries WHERE project_id = ? AND virtual_path = ?')
            .get(projectId, vPath) as { id: string } | undefined;
          const fileName = parts[parts.length - 1];
          const isBinaryContent = typeof extra.content !== 'string';
          const inferredKind: VfsEntryKind = isBinaryContent
            ? 'asset_ref'
            : inferVfsKindFromFilename(fileName, relClean);
          const textBody = typeof extra.content === 'string' && isTextFileVfsKind(inferredKind) ? extra.content : null;
          const sha = textBody !== null ? sha256Hex(textBody) : null;

          if (existingEntry) {
            db.prepare(
              'UPDATE vfs_entries SET content_text = ?, content_sha256 = ?, last_disk_mtime = ?, updated_at = ? WHERE id = ?',
            ).run(textBody, sha, rootDiskPath ? now : null, now, existingEntry.id);
          } else {
            const extraVfsId = generateNodeId('vfs');
            insVfs.run(
              extraVfsId,
              projectId,
              curParentId,
              fileName,
              vPath,
              rootDiskPath ? relClean : null,
              inferredKind,
              null,
              rootDiskPath ? 'two_way_disk' : 'virtual_only',
              textBody,
              sha,
              rootDiskPath ? now : null,
              fractionalOrderAt(vfsItems.length + extraIdx + 20),
              now,
              now,
            );
            if (textBody !== null) {
              vfsBackups.push({ id: extraVfsId, contentText: textBody, contentSha256: sha });
            }
          }
        });
      }

      const insSheet = db.prepare(`
        INSERT INTO sheets (
          id, project_id, vfs_entry_id, name, sheet_kind, viewport_x, viewport_y, viewport_zoom,
          state_schema_json, props_schema_json, ipc_schema_json, custom_css, default_layout_mode, updated_at
        ) VALUES (?, ?, ?, ?, 'visual_canvas', 0, 0, 0.82, ?, ?, ?, ?, ?, ?)
      `);

      seedSheets.forEach((sh, idx) => {
        const sheetTs = now + (seedSheets.length - idx);
        const vfsEntryId = sheetIdToVfsId.get(sh.sheetId) ?? null;
        insSheet.run(
          sh.sheetId,
          projectId,
          vfsEntryId,
          sh.name,
          JSON.stringify(sh.stateSchema ?? []),
          JSON.stringify(sh.propsSchema ?? []),
          JSON.stringify(sh.ipcSchema ?? []),
          sh.customCss ?? '',
          sh.defaultLayoutMode ?? (layoutMode === 'freeform' ? 'freeform' : 'flex'),
          sheetTs,
        );
        this.persistSheetNodesSync(db, sh, sheetTs);
      });

      const primarySheet = seedSheets[0];
      const defaultOpenTabs = primarySheet
        ? [
            { id: `tab_canvas_${primarySheet.sheetId}`, kind: 'canvas', sheetId: primarySheet.sheetId, title: `${primarySheet.name}.canvas` },
            { id: `tab_code_${primarySheet.sheetId}`, kind: 'code', sheetId: primarySheet.sheetId, title: `${primarySheet.name} (Code)`, targetId: primaryTarget },
          ]
        : [];

      db.prepare(`
        INSERT INTO workspace_state (
          project_id, open_tabs_json, left_top_ratio, left_active_mode,
          right_panel_mode, right_panel_width, active_ai_provider_id, active_ai_model_id, updated_at
        ) VALUES (?, ?, 0.45, 'insert', 'split', 380, ?, ?, ?)
      `).run(projectId, JSON.stringify(defaultOpenTabs), activeAiProviderId, activeAiModelId, now);

      if (primarySheet) {
        const compressed = this.compressCheckpointSync(primarySheet, vfsBackups);
        db.prepare(`
          INSERT INTO history_checkpoints (
            id, project_id, sheet_id, reason, label, ai_run_id, command_seq_at,
            compressed_snapshot, touched_files_backup_json, created_at
          ) VALUES (?, ?, ?, 'manual', 'Initial Project Baseline', NULL, 0, ?, ?, ?)
        `).run(
          `chk_wiz_${projectId.slice(-6)}`,
          projectId,
          primarySheet.sheetId,
          compressed,
          JSON.stringify(vfsBackups.map((b) => b.id)),
          now,
        );
      }

      if (options.initialPrompt && options.initialAssistantSummary) {
        const threadId = `thr_init_${projectId.slice(-6)}`;
        db.prepare(`
          INSERT INTO ai_threads (id, project_id, title, mode, provider, model_name, created_at, updated_at)
          VALUES (?, ?, ?, 'prompt_to_ui', ?, ?, ?, ?)
        `).run(
          threadId,
          projectId,
          options.initialPrompt.slice(0, 64),
          activeAiProviderId,
          activeAiModelId,
          now,
          now,
        );
        db.prepare(`
          INSERT INTO ai_messages (id, thread_id, role, content_text, created_at)
          VALUES (?, ?, 'user', ?, ?), (?, ?, 'assistant', ?, ?)
        `).run(
          `msg_init_u_${projectId.slice(-5)}`,
          threadId,
          options.initialPrompt,
          now,
          `msg_init_a_${projectId.slice(-5)}`,
          threadId,
          options.initialAssistantSummary,
          now + 1,
        );
      }
    });

    this.activeProjectId = projectId;
    this.upsertRecentProjectSync(
      projectId,
      projectName,
      dbFilePath,
      rootDiskPath,
      primaryTarget,
      stylingPreset,
      now,
      now,
      layoutMode,
      options.stackId,
      options.primaryLanguage,
    );

    return this.buildBootstrapPayloadSync(db, dbFilePath);
  }

  public async openProject(idOrPath: string): Promise<ProjectBootstrapPayload> {
    let dbPath = idOrPath;
    if (!idOrPath.endsWith('.uistudio') && !idOrPath.endsWith('.sqlite')) {
      const byId = this.globalDb
        .prepare('SELECT db_file_path FROM recent_projects WHERE id = ?')
        .get(idOrPath) as { db_file_path: string } | undefined;
      if (byId) {
        dbPath = byId.db_file_path;
      } else if (existsSync(join(idOrPath, '.uistudio', 'project.uistudio'))) {
        dbPath = join(idOrPath, '.uistudio', 'project.uistudio');
      }
    }
    if (!existsSync(dbPath)) {
      throw new Error(`Project database file not found: ${dbPath}`);
    }
    const db = this.switchProjectDbSync(dbPath);
    const summary = this.getProjectSummarySync(db, dbPath);
    this.upsertRecentProjectSync(
      summary.id,
      summary.name,
      dbPath,
      summary.rootDiskPath,
      summary.primaryTarget,
      summary.stylingPreset,
      summary.createdAt,
      Date.now(),
    );
    return this.buildBootstrapPayloadSync(db, dbPath);
  }

  public async linkDiskDirectory(
    projectId: string,
    dirPath: string,
  ): Promise<{ rootDiskPath: string; syncedCount: number }> {
    const db = this.requireProjectDb(projectId);
    const resolvedDir = resolve(dirPath);
    mkdirSync(resolvedDir, { recursive: true });
    const now = Date.now();
    let syncedCount = 0;

    this.withTx(db, () => {
      db.prepare('UPDATE projects SET root_disk_path = ?, updated_at = ? WHERE id = ?').run(
        resolvedDir,
        now,
        projectId,
      );

      // Export existing virtual folders and text files onto disk
      const vfsRows = db
        .prepare('SELECT * FROM vfs_entries WHERE project_id = ? ORDER BY virtual_path ASC')
        .all(projectId) as Array<Record<string, any>>;

      for (const row of vfsRows) {
        const rel = String(row.virtual_path).replace(/^\/+/, '');
        if (!rel) continue;
        const kind = String(row.entry_kind) as VfsEntryKind;
        if (kind === 'folder') {
          mkdirSync(join(resolvedDir, rel), { recursive: true });
          db.prepare('UPDATE vfs_entries SET disk_rel_path = ?, sync_mode = ? WHERE id = ?').run(
            rel,
            'two_way_disk',
            row.id,
          );
          syncedCount++;
        } else if (isTextFileVfsKind(kind) && typeof row.content_text === 'string') {
          const fullFile = join(resolvedDir, rel);
          mkdirSync(dirname(fullFile), { recursive: true });
          writeFileSync(fullFile, row.content_text, 'utf8');
          db.prepare('UPDATE vfs_entries SET disk_rel_path = ?, sync_mode = ?, last_disk_mtime = ? WHERE id = ?').run(
            rel,
            'two_way_disk',
            now,
            row.id,
          );
          syncedCount++;
        }
      }

      // Import existing top-level & nested source files from disk (up to depth 4, skipping node_modules/.git)
      syncedCount += this.scanDiskDirIntoVfsSync(db, projectId, resolvedDir, resolvedDir, null, 0, now);
    });

    const summary = this.getProjectSummarySync(db, this.activeProjectDbPath!);
    this.upsertRecentProjectSync(
      summary.id,
      summary.name,
      this.activeProjectDbPath!,
      resolvedDir,
      summary.primaryTarget,
      summary.stylingPreset,
      summary.createdAt,
      now,
    );

    return { rootDiskPath: resolvedDir, syncedCount };
  }

  private scanDiskDirIntoVfsSync(
    db: DatabaseSync,
    projectId: string,
    rootDir: string,
    currentDir: string,
    parentVfsId: string | null,
    depth: number,
    now: number,
  ): number {
    if (depth > 8) return 0;
    const ignored = new Set([
      'node_modules',
      '.git',
      'out',
      'dist',
      'build',
      '.uistudio',
      '.next',
      '.nuxt',
      '.svelte-kit',
      '.angular',
      '.expo',
      'target',
      '.venv',
      'venv',
      '__pycache__',
      '.pytest_cache',
      '.mypy_cache',
      'coverage',
    ]);
    const items = readdirSync(currentDir, { withFileTypes: true });
    let imported = 0;

    items.forEach((dirent, idx) => {
      if (ignored.has(dirent.name)) return;
      const full = join(currentDir, dirent.name);
      const relPosix = relative(rootDir, full).replace(/\\/g, '/');
      const vPath = normalizePosixPath(relPosix);

      const existing = db
        .prepare('SELECT id FROM vfs_entries WHERE project_id = ? AND virtual_path = ?')
        .get(projectId, vPath) as { id: string } | undefined;

      if (dirent.isDirectory()) {
        let folderId = existing?.id;
        if (!folderId) {
          folderId = generateNodeId('vfs');
          db.prepare(`
            INSERT INTO vfs_entries (
              id, project_id, parent_id, name, virtual_path, disk_rel_path, entry_kind,
              sync_mode, git_status, sort_order, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'folder', 'two_way_disk', 'clean', ?, ?, ?)
          `).run(folderId, projectId, parentVfsId, dirent.name, vPath, relPosix, fractionalOrderAt(idx + 20), now, now);
          imported++;
        }
        imported += this.scanDiskDirIntoVfsSync(db, projectId, rootDir, full, folderId, depth + 1, now);
      } else if (dirent.isFile() && !existing) {
        const inferredKind = inferVfsKindFromFilename(dirent.name, relPosix);
        const st = statSync(full);
        if (inferredKind === 'asset_ref') {
          const fileId = generateNodeId('vfs');
          db.prepare(`
            INSERT INTO vfs_entries (
              id, project_id, parent_id, name, virtual_path, disk_rel_path, entry_kind,
              sync_mode, content_text, content_sha256, last_disk_mtime, git_status, sort_order, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'asset_ref', 'two_way_disk', NULL, NULL, ?, 'clean', ?, ?, ?)
          `).run(
            fileId,
            projectId,
            parentVfsId,
            dirent.name,
            vPath,
            relPosix,
            Math.floor(st.mtimeMs),
            fractionalOrderAt(idx + 20),
            now,
            now,
          );
          imported++;
        } else if (st.size <= 512 * 1024 && isTextFileVfsKind(inferredKind)) {
          const text = readFileSync(full, 'utf8');
          const fileId = generateNodeId('vfs');
          db.prepare(`
            INSERT INTO vfs_entries (
              id, project_id, parent_id, name, virtual_path, disk_rel_path, entry_kind,
              sync_mode, content_text, content_sha256, last_disk_mtime, git_status, sort_order, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'two_way_disk', ?, ?, ?, 'clean', ?, ?, ?)
          `).run(
            fileId,
            projectId,
            parentVfsId,
            dirent.name,
            vPath,
            relPosix,
            inferredKind,
            text,
            sha256Hex(text),
            Math.floor(st.mtimeMs),
            fractionalOrderAt(idx + 20),
            now,
            now,
          );
          imported++;
        }
      }
    });

    return imported;
  }

  public async importExistingDiskProject(input: {
    rootDiskPath: string;
    detected: DetectedDiskProjectInfo;
    liftedInitialSheet?: UISheetDocument | null;
    linkedEntryRelPath?: string | null;
  }): Promise<ProjectBootstrapPayload> {
    const resolvedDir = resolve(input.rootDiskPath);
    const sidecarDbPath = join(resolvedDir, '.uistudio', 'project.uistudio');
    if (existsSync(sidecarDbPath)) {
      const opened = await this.openProject(resolvedDir);
      await this.reconcileDiskPaths(opened.project.id);
      return this.getCurrentProject();
    }

    const now = Date.now();
    const projectId = generateNodeId('proj');
    const db = this.switchProjectDbSync(sidecarDbPath);
    const { darkTheme, all: themes } = createDefaultThemes(projectId);
    const tokens = createDefaultTokens(projectId, darkTheme.id);
    const initialSheetId = input.liftedInitialSheet?.sheetId ?? `sheet_home_${projectId.slice(-5)}`;
    const initialSheet: UISheetDocument =
      input.liftedInitialSheet ??
      createStarterDemoSheet(projectId, initialSheetId, 'MainView');
    initialSheet.projectId = projectId;

    this.withTx(db, () => {
      const settingsJson = JSON.stringify({
        layoutMode: 'auto',
        stackId: input.detected.stackId,
        primaryLanguage: input.detected.primaryLanguage,
        pythonCompanion: input.detected.pythonCompanion,
      });
      const projDisplayName = input.detected.name || basename(resolvedDir);
      let importedSqlDoc = attachBaselinesToDocument(
        createStarterSqlDocument(projectId, projDisplayName, 'sqlite'),
      );

      db.prepare(`
        INSERT INTO projects (
          id, name, root_disk_path, primary_target, styling_preset, stack_id, primary_language,
          active_theme_id, breakpoints_json, settings_json, sql_schema_json, schema_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2, ?, ?)
      `).run(
        projectId,
        projDisplayName,
        resolvedDir,
        input.detected.primaryTarget,
        input.detected.stylingPreset,
        input.detected.stackId,
        input.detected.primaryLanguage,
        darkTheme.id,
        JSON.stringify(DEFAULT_BREAKPOINTS),
        settingsJson,
        JSON.stringify(importedSqlDoc),
        now,
        now,
      );

      const defaultOpenTabs = [
        {
          id: `tab_canvas_${initialSheet.sheetId}`,
          kind: 'canvas',
          sheetId: initialSheet.sheetId,
          title: `${initialSheet.name}.canvas`,
        },
        {
          id: `tab_code_${initialSheet.sheetId}`,
          kind: 'code',
          sheetId: initialSheet.sheetId,
          title: `${initialSheet.name} (Code)`,
          targetId: input.detected.primaryTarget,
        },
      ];
      db.prepare(`
        INSERT INTO workspace_state (project_id, open_tabs_json, updated_at) VALUES (?, ?, ?)
      `).run(projectId, JSON.stringify(defaultOpenTabs), now);

      const insTheme = db.prepare('INSERT INTO themes (id, project_id, name, is_default) VALUES (?, ?, ?, ?)');
      for (const th of themes) {
        insTheme.run(th.id, projectId, th.name, th.isDefault ? 1 : 0);
      }
      const insTok = db.prepare(
        'INSERT INTO design_tokens (id, project_id, theme_id, token_path, category, raw_value, alias_of_path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      for (const tok of tokens) {
        insTok.run(tok.id, projectId, tok.themeId, tok.tokenPath, tok.category, tok.rawValue, tok.aliasOfPath ?? null);
      }

      // Non-destructive scan: NEVER writes or deletes user files on disk!
      this.scanDiskDirIntoVfsSync(db, projectId, resolvedDir, resolvedDir, null, 0, now);

      // Auto-discover existing .sql DDL files & local .sqlite/.db files on disk
      const sqlVfsRows = db
        .prepare("SELECT name, disk_rel_path, entry_kind, content_text FROM vfs_entries WHERE project_id = ? AND (entry_kind IN ('sql_file', 'sql_schema') OR name LIKE '%.sqlite' OR name LIKE '%.db')")
        .all(projectId) as Array<{
        name: string;
        disk_rel_path: string | null;
        entry_kind: string;
        content_text: string | null;
      }>;

      for (const sRow of sqlVfsRows) {
        if (sRow.entry_kind === 'sql_schema' && sRow.content_text) {
          try {
            const parsedDoc = JSON.parse(sRow.content_text) as SqlDesignDocument;
            if (parsedDoc && Array.isArray(parsedDoc.tables)) {
              importedSqlDoc = { ...parsedDoc, projectId };
              db.prepare('UPDATE projects SET sql_schema_json = ? WHERE id = ?').run(
                JSON.stringify(importedSqlDoc),
                projectId,
              );
            }
          } catch {
            // ignore malformed schema json
          }
        } else if (sRow.entry_kind === 'sql_file' && sRow.content_text) {
          const ddlRes = importSqlDdlToTables(sRow.content_text);
          if (ddlRes.tables.length > 0) {
            importedSqlDoc = {
              ...importedSqlDoc,
              dialect: ddlRes.dialect,
              tables: ddlRes.tables,
              seedRows: [],
              updatedAt: now,
            };
            db.prepare('UPDATE projects SET sql_schema_json = ? WHERE id = ?').run(
              JSON.stringify(importedSqlDoc),
              projectId,
            );
          }
        } else if (sRow.disk_rel_path && /\.(sqlite|sqlite3|db|db3)$/i.test(sRow.name)) {
          db.prepare(`
            INSERT INTO sql_connections (
              id, project_id, name, dialect, mode, sqlite_file_path, ssl, read_only, created_at, updated_at
            ) VALUES (?, ?, ?, 'sqlite', 'local_sqlite', ?, 0, 0, ?, ?)
          `).run(
            generateNodeId('sqlconn'),
            projectId,
            `SQLite (${sRow.name})`,
            sRow.disk_rel_path,
            now,
            now,
          );
        }
      }

      const sheetVfsId = generateNodeId('vfs');
      db.prepare(`
        INSERT INTO vfs_entries (
          id, project_id, parent_id, name, virtual_path, disk_rel_path, entry_kind,
          target_framework, sync_mode, sort_order, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, ?, NULL, 'canvas_sheet', ?, 'virtual_only', ?, ?, ?)
      `).run(
        sheetVfsId,
        projectId,
        `${initialSheet.name}.canvas`,
        `/${initialSheet.name}.canvas`,
        input.detected.primaryTarget,
        fractionalOrderAt(0),
        now,
        now,
      );

      db.prepare(`
        INSERT INTO sheets (
          id, project_id, vfs_entry_id, name, sheet_kind,
          state_schema_json, props_schema_json, ipc_schema_json, custom_css, default_layout_mode, updated_at
        ) VALUES (?, ?, ?, ?, 'visual_canvas', ?, ?, ?, ?, ?, ?)
      `).run(
        initialSheet.sheetId,
        projectId,
        sheetVfsId,
        initialSheet.name,
        JSON.stringify(initialSheet.stateSchema ?? []),
        JSON.stringify(initialSheet.propsSchema ?? []),
        JSON.stringify(initialSheet.ipcSchema ?? []),
        initialSheet.customCss ?? '',
        initialSheet.defaultLayoutMode ?? 'flex',
        now,
      );

      this.persistSheetNodesSync(db, initialSheet, now);

      const compressed = this.compressCheckpointSync(initialSheet, []);
      db.prepare(`
        INSERT INTO history_checkpoints (
          id, project_id, sheet_id, reason, label, ai_run_id, command_seq_at,
          compressed_snapshot, touched_files_backup_json, created_at
        ) VALUES (?, ?, ?, 'manual', 'Imported Disk Project Baseline', NULL, 0, ?, '[]', ?)
      `).run(`chk_imp_${projectId.slice(-6)}`, projectId, initialSheet.sheetId, compressed, now);

      if (input.linkedEntryRelPath) {
        db.prepare(`
          INSERT OR REPLACE INTO codegen_sync_mappings (
            id, project_id, sheet_id, target_id, relative_repo_path, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          generateNodeId('sync'),
          projectId,
          initialSheet.sheetId,
          input.detected.primaryTarget,
          input.linkedEntryRelPath,
          now,
        );
      }
    });

    this.activeProjectId = projectId;
    this.upsertRecentProjectSync(
      projectId,
      input.detected.name || basename(resolvedDir),
      sidecarDbPath,
      resolvedDir,
      input.detected.primaryTarget,
      input.detected.stylingPreset,
      now,
      now,
      'auto',
      input.detected.stackId,
      input.detected.primaryLanguage,
    );

    return this.buildBootstrapPayloadSync(db, sidecarDbPath);
  }

  public async reconcileDiskPaths(projectId: string, relPaths?: string[]): Promise<{ syncedCount: number }> {
    const db = this.requireProjectDb(projectId);
    const summary = this.getProjectSummarySync(db, this.activeProjectDbPath!);
    if (!summary.rootDiskPath || !existsSync(summary.rootDiskPath)) {
      return { syncedCount: 0 };
    }
    const rootDir = summary.rootDiskPath;
    const now = Date.now();
    const changedPaths = new Set(relPaths?.map((path) => path.replace(/\\/g, '/')));
    const syncedCount = this.withTx(db, () => {
      let count = this.scanDiskDirIntoVfsSync(db, projectId, rootDir, rootDir, null, 0, now);
      // Refresh existing two_way_disk text buffers modified externally & prune deleted disk files
      const trackedRows = db
        .prepare("SELECT id, disk_rel_path, entry_kind, last_disk_mtime, content_sha256 FROM vfs_entries WHERE project_id = ? AND sync_mode = 'two_way_disk' AND disk_rel_path IS NOT NULL")
        .all(projectId) as Array<{
        id: string;
        disk_rel_path: string;
        entry_kind: VfsEntryKind;
        last_disk_mtime: number | null;
        content_sha256: string | null;
      }>;

      for (const row of trackedRows) {
        let fullPath: string | undefined;
        try {
          fullPath = resolveProjectDiskPath(rootDir, row.disk_rel_path);
        } catch {
          // A replaced or previously indexed link is outside the synchronized VFS.
        }
        if (!fullPath || !existsSync(fullPath)) {
          db.prepare('DELETE FROM vfs_entries WHERE id = ?').run(row.id);
          count++;
          continue;
        }
        if (isTextFileVfsKind(row.entry_kind)) {
          const st = statSync(fullPath);
          const mtime = Math.floor(st.mtimeMs);
          if (st.isFile() && st.size <= 512 * 1024 && (changedPaths.has(row.disk_rel_path) || mtime !== row.last_disk_mtime)) {
            const diskText = readFileSync(fullPath, 'utf8');
            const sha = sha256Hex(diskText);
            if (sha !== row.content_sha256 || mtime !== row.last_disk_mtime) {
              db.prepare(
                'UPDATE vfs_entries SET content_text = ?, content_sha256 = ?, last_disk_mtime = ?, updated_at = ? WHERE id = ?',
              ).run(diskText, sha, mtime, now, row.id);
              if (sha !== row.content_sha256) count++;
            }
          }
        }
      }
      return count;
    });
    return { syncedCount };
  }

  public async updateProjectSettings(
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
  ): Promise<ProjectSummary> {
    const db = this.requireProjectDb(projectId);
    const cur = this.getProjectSummarySync(db, this.activeProjectDbPath!);
    const rawSettingsRow = db
      .prepare('SELECT settings_json FROM projects WHERE id = ?')
      .get(projectId) as { settings_json?: string } | undefined;
    let parsedSettings: Record<string, unknown> = {};
    if (rawSettingsRow?.settings_json) {
      try {
        parsedSettings = JSON.parse(rawSettingsRow.settings_json) as Record<string, unknown>;
      } catch {
        parsedSettings = {};
      }
    }

    const now = Date.now();
    const nextName = patch.name ?? cur.name;
    const nextTarget = patch.primaryTarget ?? cur.primaryTarget;
    const nextStyle = patch.stylingPreset ?? cur.stylingPreset;
    const nextStack = patch.stackId ?? cur.stackId ?? null;
    const nextLang = patch.primaryLanguage ?? cur.primaryLanguage ?? null;
    const nextPy = patch.pythonCompanion ?? cur.pythonCompanion ?? 'none';
    const nextTheme = patch.activeThemeId !== undefined ? patch.activeThemeId : cur.activeThemeId;
    const nextLayoutMode = patch.layoutMode ?? cur.layoutMode ?? 'auto';
    const nextSettingsJson = JSON.stringify({
      ...parsedSettings,
      layoutMode: nextLayoutMode,
      stackId: nextStack,
      primaryLanguage: nextLang,
      pythonCompanion: nextPy,
    });

    db.prepare(`
      UPDATE projects
      SET name = ?, primary_target = ?, styling_preset = ?, stack_id = ?, primary_language = ?, active_theme_id = ?, settings_json = ?, updated_at = ?
      WHERE id = ?
    `).run(nextName, nextTarget, nextStyle, nextStack, nextLang, nextTheme, nextSettingsJson, now, projectId);

    this.upsertRecentProjectSync(
      projectId,
      nextName,
      this.activeProjectDbPath!,
      cur.rootDiskPath,
      nextTarget,
      nextStyle,
      cur.createdAt,
      now,
      nextLayoutMode,
      nextStack ?? undefined,
      nextLang ?? undefined,
    );

    return this.getProjectSummarySync(db, this.activeProjectDbPath!);
  }

  // ==========================================================================
  // WORKSPACE SHELL STATE
  // ==========================================================================

  public async loadWorkspaceState(projectId: string): Promise<WorkspaceStateDTO> {
    const db = this.requireProjectDb(projectId);
    return this.getWorkspaceStateSync(db, projectId);
  }

  public async saveWorkspaceState(
    projectId: string,
    patch: Partial<Omit<WorkspaceStateDTO, 'projectId' | 'updatedAt'>>,
  ): Promise<WorkspaceStateDTO> {
    const db = this.requireProjectDb(projectId);
    const cur = this.getWorkspaceStateSync(db, projectId);
    const now = Date.now();

    const updated: WorkspaceStateDTO = {
      projectId,
      openTabsJson: patch.openTabsJson ?? cur.openTabsJson,
      leftTopRatio: patch.leftTopRatio ?? cur.leftTopRatio,
      leftActiveMode: patch.leftActiveMode ?? cur.leftActiveMode,
      rightPanelMode: patch.rightPanelMode ?? cur.rightPanelMode,
      rightPanelWidth: patch.rightPanelWidth ?? cur.rightPanelWidth,
      activeAiProviderId: patch.activeAiProviderId ?? cur.activeAiProviderId,
      activeAiModelId: patch.activeAiModelId ?? cur.activeAiModelId,
      updatedAt: now,
    };

    db.prepare(`
      INSERT INTO workspace_state (
        project_id, open_tabs_json, left_top_ratio, left_active_mode,
        right_panel_mode, right_panel_width, active_ai_provider_id, active_ai_model_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        open_tabs_json = excluded.open_tabs_json,
        left_top_ratio = excluded.left_top_ratio,
        left_active_mode = excluded.left_active_mode,
        right_panel_mode = excluded.right_panel_mode,
        right_panel_width = excluded.right_panel_width,
        active_ai_provider_id = excluded.active_ai_provider_id,
        active_ai_model_id = excluded.active_ai_model_id,
        updated_at = excluded.updated_at
    `).run(
      projectId,
      updated.openTabsJson,
      updated.leftTopRatio,
      updated.leftActiveMode,
      updated.rightPanelMode,
      updated.rightPanelWidth,
      updated.activeAiProviderId,
      updated.activeAiModelId,
      now,
    );

    return updated;
  }

  // ==========================================================================
  // VFS & DISK SYNC
  // ==========================================================================

  public async listVfsTree(projectId: string): Promise<VfsNodeDTO[]> {
    const db = this.requireProjectDb(projectId);
    return this.listVfsTreeSync(db, projectId);
  }

  public async createVfsEntry(
    input: CreateVfsEntryInput,
  ): Promise<{ entry: VfsNodeDTO; createdSheet?: UISheetDocument }> {
    const db = this.requireProjectDb(input.projectId);
    const proj = this.getProjectSummarySync(db, this.activeProjectDbPath!);
    const now = Date.now();

    let cleanName = input.name.trim();
    if (!cleanName) {
      cleanName = input.entryKind === 'folder' ? 'new-folder' : input.entryKind === 'canvas_sheet' ? 'NewScreen.canvas' : 'untitled.ts';
    }
    if (input.entryKind === 'canvas_sheet' && !cleanName.endsWith('.canvas')) {
      cleanName = `${cleanName}.canvas`;
    }

    let parentPath = '';
    if (input.parentId) {
      const parentRow = db
        .prepare('SELECT virtual_path FROM vfs_entries WHERE id = ?')
        .get(input.parentId) as { virtual_path: string } | undefined;
      if (parentRow) parentPath = parentRow.virtual_path;
    }

    let virtualPath = normalizePosixPath(`${parentPath}/${cleanName}`);
    // Ensure uniqueness if duplicate name in same folder
    const collision = db
      .prepare('SELECT id FROM vfs_entries WHERE project_id = ? AND virtual_path = ?')
      .get(input.projectId, virtualPath);
    if (collision) {
      const suffix = Date.now().toString(36).slice(-3);
      const dotIdx = cleanName.lastIndexOf('.');
      cleanName =
        dotIdx > 0
          ? `${cleanName.slice(0, dotIdx)}-${suffix}${cleanName.slice(dotIdx)}`
          : `${cleanName}-${suffix}`;
      virtualPath = normalizePosixPath(`${parentPath}/${cleanName}`);
    }

    const siblingCountRow = db
      .prepare(
        input.parentId
          ? 'SELECT COUNT(*) as cnt FROM vfs_entries WHERE project_id = ? AND parent_id = ?'
          : 'SELECT COUNT(*) as cnt FROM vfs_entries WHERE project_id = ? AND parent_id IS NULL',
      )
      .get(...(input.parentId ? [input.projectId, input.parentId] : [input.projectId])) as { cnt: number | bigint };
    const sortOrder = fractionalOrderAt(Number(siblingCountRow?.cnt ?? 0));

    const entryId = generateNodeId('vfs');
    const relDisk = proj.rootDiskPath && input.entryKind !== 'canvas_sheet' ? virtualPath.replace(/^\/+/, '') : null;
    const syncMode = relDisk ? 'two_way_disk' : 'virtual_only';
    const contentText = isTextFileVfsKind(input.entryKind)
      ? (input.initialContent ?? defaultTextContentForKind(input.entryKind, cleanName, input.projectId, proj.name))
      : null;
    const sha = contentText !== null ? sha256Hex(contentText) : null;

    let createdSheet: UISheetDocument | undefined;

    this.withTx(db, () => {
      db.prepare(`
        INSERT INTO vfs_entries (
          id, project_id, parent_id, name, virtual_path, disk_rel_path, entry_kind,
          target_framework, sync_mode, content_text, content_sha256, last_disk_mtime,
          git_status, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'untracked', ?, ?, ?)
      `).run(
        entryId,
        input.projectId,
        input.parentId,
        cleanName,
        virtualPath,
        relDisk,
        input.entryKind,
        input.targetFramework ?? (input.entryKind === 'canvas_sheet' ? proj.primaryTarget : null),
        syncMode,
        contentText,
        sha,
        relDisk ? now : null,
        sortOrder,
        now,
        now,
      );

      if (proj.rootDiskPath && relDisk) {
        const fullDiskTarget = join(proj.rootDiskPath, relDisk);
        if (input.entryKind === 'folder') {
          mkdirSync(fullDiskTarget, { recursive: true });
        } else if (isTextFileVfsKind(input.entryKind) && contentText !== null) {
          mkdirSync(dirname(fullDiskTarget), { recursive: true });
          writeFileSync(fullDiskTarget, contentText, { encoding: 'utf8', flag: 'wx' });
        }
      }

      if (input.entryKind === 'canvas_sheet') {
        const sheetId = generateNodeId('sheet');
        const sheetTitle = cleanName.replace(/\.canvas$/i, '');
        const artId = generateNodeId('art');
        const isFreeform = proj.layoutMode === 'freeform';
        const rootArtboard = createDefaultUINode(
          {
            id: artId,
            kind: 'artboard',
            name: `${sheetTitle.replace(/[^a-zA-Z0-9]/g, '') || 'Screen'}Artboard`,
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
          projectId: input.projectId,
          name: sheetTitle,
          rootIds: [artId],
          defaultLayoutMode: isFreeform ? 'freeform' : 'flex',
          nodes: { [artId]: rootArtboard },
          stateSchema: [],
          propsSchema: [],
          ipcSchema: [],
        };

        db.prepare(`
          INSERT INTO sheets (
            id, project_id, vfs_entry_id, name, sheet_kind, viewport_x, viewport_y, viewport_zoom,
            state_schema_json, props_schema_json, ipc_schema_json, custom_css, default_layout_mode, updated_at
          ) VALUES (?, ?, ?, ?, 'visual_canvas', 0, 0, 0.85, '[]', '[]', '[]', '', ?, ?)
        `).run(sheetId, input.projectId, entryId, sheetTitle, isFreeform ? 'freeform' : 'flex', now);

        this.persistSheetNodesSync(db, createdSheet, now);
      }
    });

    const tree = this.listVfsTreeSync(db, input.projectId);
    const createdDto = tree.find((n) => n.id === entryId)!;
    return { entry: createdDto, createdSheet };
  }

  public async renameVfsEntry(entryId: string, newName: string): Promise<VfsNodeDTO> {
    const db = this.requireProjectDb();
    const row = db.prepare('SELECT * FROM vfs_entries WHERE id = ?').get(entryId) as Record<string, any> | undefined;
    if (!row) throw new Error(`VFS entry not found: ${entryId}`);

    const projectId = String(row.project_id);
    const proj = this.getProjectSummarySync(db, this.activeProjectDbPath!);
    const cleanNewName = newName.trim();
    if (!cleanNewName) throw new Error('New file/folder name cannot be empty.');

    const oldVPath = String(row.virtual_path);
    const parentVPath = oldVPath.slice(0, Math.max(0, oldVPath.lastIndexOf('/')));
    const newVPath = normalizePosixPath(`${parentVPath}/${cleanNewName}`);
    const now = Date.now();

    this.withTx(db, () => {
      const newRelDisk = row.disk_rel_path ? newVPath.replace(/^\/+/, '') : null;
      db.prepare(`
        UPDATE vfs_entries
        SET name = ?, virtual_path = ?, disk_rel_path = ?, updated_at = ?
        WHERE id = ?
      `).run(cleanNewName, newVPath, newRelDisk, now, entryId);

      if (row.entry_kind === 'canvas_sheet') {
        db.prepare('UPDATE sheets SET name = ?, updated_at = ? WHERE vfs_entry_id = ?').run(
          cleanNewName.replace(/\.canvas$/i, ''),
          now,
          entryId,
        );
      }

      if (row.entry_kind === 'folder') {
        const descendants = db
          .prepare('SELECT id, virtual_path, disk_rel_path FROM vfs_entries WHERE project_id = ? AND virtual_path LIKE ?')
          .all(projectId, `${oldVPath}/%`) as Array<{ id: string; virtual_path: string; disk_rel_path: string | null }>;

        for (const desc of descendants) {
          const updatedChildVPath = newVPath + desc.virtual_path.slice(oldVPath.length);
          const updatedChildDisk = desc.disk_rel_path ? updatedChildVPath.replace(/^\/+/, '') : null;
          db.prepare('UPDATE vfs_entries SET virtual_path = ?, disk_rel_path = ?, updated_at = ? WHERE id = ?').run(
            updatedChildVPath,
            updatedChildDisk,
            now,
            desc.id,
          );
        }
      }

      if (proj.rootDiskPath && row.disk_rel_path && newRelDisk) {
        const oldFull = join(proj.rootDiskPath, String(row.disk_rel_path));
        const newFull = join(proj.rootDiskPath, newRelDisk);
        if (existsSync(oldFull)) {
          renameSync(oldFull, newFull);
        }
      }
    });

    const tree = this.listVfsTreeSync(db, projectId);
    return tree.find((n) => n.id === entryId)!;
  }

  public async moveVfsEntry(entryId: string, newParentId: string | null): Promise<VfsNodeDTO> {
    const db = this.requireProjectDb();
    const row = db.prepare('SELECT * FROM vfs_entries WHERE id = ?').get(entryId) as Record<string, any> | undefined;
    if (!row) throw new Error(`VFS entry not found: ${entryId}`);
    if (newParentId === entryId) {
      throw new Error('Cannot move a folder or file into itself.');
    }

    const projectId = String(row.project_id);
    const proj = this.getProjectSummarySync(db, this.activeProjectDbPath!);
    const oldVPath = String(row.virtual_path);
    const currentParentId = row.parent_id ? String(row.parent_id) : null;

    if (currentParentId === (newParentId ?? null)) {
      const tree = this.listVfsTreeSync(db, projectId);
      return tree.find((n) => n.id === entryId)!;
    }

    let parentVPath = '';
    if (newParentId) {
      const pRow = db
        .prepare('SELECT id, virtual_path, entry_kind FROM vfs_entries WHERE id = ? AND project_id = ?')
        .get(newParentId, projectId) as { id: string; virtual_path: string; entry_kind: string } | undefined;
      if (!pRow) {
        throw new Error(`Destination VFS folder not found: ${newParentId}`);
      }
      if (pRow.entry_kind !== 'folder') {
        throw new Error('Destination parent must be a folder.');
      }
      if (
        row.entry_kind === 'folder' &&
        (pRow.virtual_path === oldVPath || pRow.virtual_path.startsWith(`${oldVPath}/`))
      ) {
        throw new Error('Cannot move a folder into one of its own descendants.');
      }
      parentVPath = pRow.virtual_path;
    }

    const now = Date.now();
    let nextName = String(row.name);
    let newVPath = normalizePosixPath(`${parentVPath}/${nextName}`);

    const collision = db
      .prepare('SELECT id FROM vfs_entries WHERE project_id = ? AND virtual_path = ? AND id != ?')
      .get(projectId, newVPath, entryId);
    if (collision) {
      const suffix = now.toString(36).slice(-3);
      const dotIdx = nextName.lastIndexOf('.');
      nextName =
        dotIdx > 0
          ? `${nextName.slice(0, dotIdx)}-${suffix}${nextName.slice(dotIdx)}`
          : `${nextName}-${suffix}`;
      newVPath = normalizePosixPath(`${parentVPath}/${nextName}`);
    }

    const siblingCountRow = db
      .prepare(
        newParentId
          ? 'SELECT COUNT(*) as cnt FROM vfs_entries WHERE project_id = ? AND parent_id = ? AND id != ?'
          : 'SELECT COUNT(*) as cnt FROM vfs_entries WHERE project_id = ? AND parent_id IS NULL AND id != ?',
      )
      .get(...(newParentId ? [projectId, newParentId, entryId] : [projectId, entryId])) as { cnt: number | bigint };
    const sortOrder = fractionalOrderAt(Number(siblingCountRow?.cnt ?? 0));

    this.withTx(db, () => {
      const newRelDisk =
        proj.rootDiskPath && row.entry_kind !== 'canvas_sheet' ? newVPath.replace(/^\/+/, '') : null;

      db.prepare(`
        UPDATE vfs_entries
        SET parent_id = ?, name = ?, virtual_path = ?, disk_rel_path = ?, sort_order = ?, updated_at = ?
        WHERE id = ?
      `).run(newParentId, nextName, newVPath, newRelDisk, sortOrder, now, entryId);

      if (row.entry_kind === 'folder') {
        const descendants = db
          .prepare('SELECT id, virtual_path, disk_rel_path FROM vfs_entries WHERE project_id = ? AND virtual_path LIKE ?')
          .all(projectId, `${oldVPath}/%`) as Array<{ id: string; virtual_path: string; disk_rel_path: string | null }>;

        for (const desc of descendants) {
          const updatedChildVPath = newVPath + desc.virtual_path.slice(oldVPath.length);
          const updatedChildDisk = desc.disk_rel_path ? updatedChildVPath.replace(/^\/+/, '') : null;
          db.prepare('UPDATE vfs_entries SET virtual_path = ?, disk_rel_path = ?, updated_at = ? WHERE id = ?').run(
            updatedChildVPath,
            updatedChildDisk,
            now,
            desc.id,
          );
        }
      }

      if (proj.rootDiskPath && row.disk_rel_path && newRelDisk) {
        const oldFull = join(proj.rootDiskPath, String(row.disk_rel_path));
        const newFull = join(proj.rootDiskPath, newRelDisk);
        if (existsSync(oldFull)) {
          mkdirSync(dirname(newFull), { recursive: true });
          renameSync(oldFull, newFull);
        }
      }
    });

    const tree = this.listVfsTreeSync(db, projectId);
    return tree.find((n) => n.id === entryId)!;
  }

  public async deleteVfsEntry(entryId: string, deleteOnDisk = false): Promise<void> {
    const db = this.requireProjectDb();
    const row = db.prepare('SELECT * FROM vfs_entries WHERE id = ?').get(entryId) as Record<string, any> | undefined;
    if (!row) return;

    const proj = this.getProjectSummarySync(db, this.activeProjectDbPath!);
    this.withTx(db, () => {
      db.prepare('DELETE FROM vfs_entries WHERE id = ?').run(entryId);
      if (deleteOnDisk && proj.rootDiskPath && row.disk_rel_path) {
        const fullTarget = join(proj.rootDiskPath, String(row.disk_rel_path));
        if (existsSync(fullTarget)) {
          rmSync(fullTarget, { recursive: true, force: true });
        }
      }
    });
  }

  public async readVfsFile(entryId: string): Promise<{ content: string; sha256: string }> {
    const db = this.requireProjectDb();
    const row = db.prepare('SELECT * FROM vfs_entries WHERE id = ?').get(entryId) as Record<string, any> | undefined;
    if (!row) throw new Error(`VFS entry not found: ${entryId}`);

    const proj = this.getProjectSummarySync(db, this.activeProjectDbPath!);
    if (proj.rootDiskPath && row.disk_rel_path) {
      const fullPath = resolveProjectDiskPath(proj.rootDiskPath, String(row.disk_rel_path));
      if (existsSync(fullPath)) {
        const diskContent = readFileSync(fullPath, 'utf8');
        const sha = sha256Hex(diskContent);
        db.prepare('UPDATE vfs_entries SET content_text = ?, content_sha256 = ? WHERE id = ?').run(
          diskContent,
          sha,
          entryId,
        );
        return { content: diskContent, sha256: sha };
      }
    }

    const content = typeof row.content_text === 'string' ? row.content_text : '';
    return { content, sha256: row.content_sha256 ? String(row.content_sha256) : sha256Hex(content) };
  }

  public async writeVfsFile(entryId: string, content: string, expectedContent?: string): Promise<{ sha256: string }> {
    const db = this.requireProjectDb();
    const row = db.prepare('SELECT * FROM vfs_entries WHERE id = ?').get(entryId) as Record<string, any> | undefined;
    if (!row) throw new Error(`VFS entry not found: ${entryId}`);
    if (!isTextFileVfsKind(row.entry_kind as VfsEntryKind)) throw new Error('Il file non è modificabile come testo.');

    const proj = this.getProjectSummarySync(db, this.activeProjectDbPath!);
    const sha = sha256Hex(content);
    const now = Date.now();
    const conflict = 'Il file è stato modificato dopo l’ultima lettura. Ricaricalo prima di salvare.';

    let diskMtime: number | null = null;
    if (proj.rootDiskPath && row.disk_rel_path) {
      const fullPath = resolveProjectDiskPath(proj.rootDiskPath, String(row.disk_rel_path));
      mkdirSync(dirname(fullPath), { recursive: true });
      const pending = join(dirname(fullPath), `.uistudio-save-${randomUUID()}.tmp`);
      try {
        writeFileSync(pending, content, { encoding: 'utf8', flag: 'wx', mode: statSync(fullPath, { throwIfNoEntry: false })?.mode });
        if (expectedContent !== undefined && (!existsSync(fullPath) || readFileSync(fullPath, 'utf8') !== expectedContent)) {
          throw new Error(conflict);
        }
        renameSync(pending, fullPath);
      } finally {
        rmSync(pending, { force: true });
      }
      diskMtime = Math.floor(statSync(fullPath).mtimeMs);
    } else if (expectedContent !== undefined && (row.content_text ?? '') !== expectedContent) {
      throw new Error(conflict);
    }

    db.prepare(`
      UPDATE vfs_entries
      SET content_text = ?, content_sha256 = ?, last_disk_mtime = ?, git_status = 'modified', updated_at = ?
      WHERE id = ?
    `).run(content, sha, diskMtime, now, entryId);

    return { sha256: sha };
  }

  public async writeGeneratedBundleToDisk(
    projectId: string,
    bundle: TargetArtifactBundle,
  ): Promise<{ writtenPaths: string[] }> {
    const db = this.requireProjectDb(projectId);
    const proj = this.getProjectSummarySync(db, this.activeProjectDbPath!);
    const writtenPaths: string[] = [];
    const now = Date.now();
    const files = bundle.files.map((file) => {
      const path = file.relativePath.replace(/\\/g, '/');
      const generatedPath = `generated/${bundle.targetId}/${path}`;
      const segments = generatedPath.split('/');
      if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes(':'))) {
        throw new Error(`Percorso di esportazione non valido: ${file.relativePath}`);
      }
      const diskPath = proj.rootDiskPath ? resolveProjectDiskPath(proj.rootDiskPath, generatedPath) : null;
      return { file, vPath: `/${generatedPath}`, diskPath };
    });

    this.withTx(db, () => {
      for (const { file, vPath, diskPath } of files) {
        const sha = sha256Hex(file.code);

        // Ensure parent folders in VFS
        const parts = vPath.split('/').filter(Boolean);
        let curParentId: string | null = null;
        let accumPath = '';
        for (let i = 0; i < parts.length - 1; i++) {
          accumPath += `/${parts[i]}`;
          const existingFolder = db
            .prepare('SELECT id FROM vfs_entries WHERE project_id = ? AND virtual_path = ?')
            .get(projectId, accumPath) as { id: string } | undefined;
          if (existingFolder) {
            curParentId = existingFolder.id;
          } else {
            const newFolderId = generateNodeId('vfs');
            db.prepare(`
              INSERT INTO vfs_entries (
                id, project_id, parent_id, name, virtual_path, disk_rel_path, entry_kind,
                sync_mode, git_status, sort_order, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, 'folder', ?, 'untracked', ?, ?, ?)
            `).run(
              newFolderId,
              projectId,
              curParentId,
              parts[i],
              accumPath,
              proj.rootDiskPath ? accumPath.slice(1) : null,
              proj.rootDiskPath ? 'two_way_disk' : 'virtual_only',
              fractionalOrderAt(i + 10),
              now,
              now,
            );
            curParentId = newFolderId;
          }
        }

        const fileName = basename(vPath);
        const existingFile = db
          .prepare('SELECT id FROM vfs_entries WHERE project_id = ? AND virtual_path = ?')
          .get(projectId, vPath) as { id: string } | undefined;

        if (existingFile) {
          db.prepare(`
            UPDATE vfs_entries
            SET content_text = ?, content_sha256 = ?, target_framework = ?, git_status = 'modified', updated_at = ?
            WHERE id = ?
          `).run(file.code, sha, bundle.targetId, now, existingFile.id);
        } else {
          db.prepare(`
            INSERT INTO vfs_entries (
              id, project_id, parent_id, name, virtual_path, disk_rel_path, entry_kind,
              target_framework, sync_mode, content_text, content_sha256, git_status, sort_order, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'source_file', ?, ?, ?, ?, 'untracked', ?, ?, ?)
          `).run(
            generateNodeId('vfs'),
            projectId,
            curParentId,
            fileName,
            vPath,
            proj.rootDiskPath ? vPath.slice(1) : null,
            bundle.targetId,
            proj.rootDiskPath ? 'two_way_disk' : 'virtual_only',
            file.code,
            sha,
            fractionalOrderAt(10),
            now,
            now,
          );
        }

        if (diskPath) {
          mkdirSync(dirname(diskPath), { recursive: true });
          writeFileSync(diskPath, file.code, 'utf8');
          writtenPaths.push(diskPath);
        } else {
          writtenPaths.push(vPath);
        }
      }
    });

    return { writtenPaths };
  }

  public async installRustTauriSqlModule(
    projectId: string,
    bundle: TargetArtifactBundle,
  ): Promise<{ writtenPaths: string[] }> {
    const db = this.requireProjectDb(projectId);
    const project = this.getProjectSummarySync(db, this.activeProjectDbPath!);
    const root = project.rootDiskPath;
    if (project.stackId !== 'rust-tauri' || !root) {
      throw new Error('L’integrazione automatica richiede un progetto Rust + Tauri su disco.');
    }

    const manifestPath = resolveProjectDiskPath(root, RUST_TAURI_SQL_PATHS.manifest);
    const libraryPath = resolveProjectDiskPath(root, RUST_TAURI_SQL_PATHS.library);
    const library = readFileSync(libraryPath, 'utf8');
    const plan = planRustTauriSqlInstall(bundle, readFileSync(manifestPath, 'utf8'), library);
    const files = plan.files.map((file) => ({
      ...file,
      fullPath: resolveProjectDiskPath(root, file.relativePath),
    }));
    const newFiles = files.filter((file) => {
      if (!existsSync(file.fullPath)) return true;
      if (!statSync(file.fullPath).isFile() || readFileSync(file.fullPath, 'utf8') !== file.content) {
        throw new Error(`Il percorso ${file.relativePath} contiene un file diverso. I sorgenti sono stati conservati.`);
      }
      return false;
    });

    const created: typeof newFiles = [];
    const writtenPaths: string[] = [];
    try {
      for (const file of newFiles) {
        mkdirSync(dirname(file.fullPath), { recursive: true });
        writeFileSync(file.fullPath, file.content, { encoding: 'utf8', flag: 'wx' });
        created.push(file);
        writtenPaths.push(file.relativePath);
      }

      if (plan.library !== library) {
        const stagedLibrary = join(dirname(libraryPath), `.uistudio-save-${randomUUID()}.tmp`);
        try {
          writeFileSync(stagedLibrary, plan.library, { encoding: 'utf8', flag: 'wx', mode: statSync(libraryPath).mode });
          if (readFileSync(libraryPath, 'utf8') !== library) {
            throw new Error('lib.rs è cambiato durante l’installazione. Riprova dopo aver salvato il file.');
          }
          renameSync(stagedLibrary, libraryPath);
        } finally {
          rmSync(stagedLibrary, { force: true });
        }
        writtenPaths.push(RUST_TAURI_SQL_PATHS.library);
      }
    } catch (error) {
      for (const file of created.reverse()) rmSync(file.fullPath, { force: true });
      throw error;
    }
    if (writtenPaths.length) await this.reconcileDiskPaths(projectId, writtenPaths);
    return { writtenPaths };
  }

  // ==========================================================================
  // CANVAS SHEETS, SCENE NODES, <1MS UNDO/REDO & ATOMIC CHECKPOINTS
  // ==========================================================================

  public async listSheets(projectId: string): Promise<SheetSummaryDTO[]> {
    const db = this.requireProjectDb(projectId);
    return this.listSheetsSync(db, projectId);
  }

  public async loadSheet(sheetId: string): Promise<UISheetDocument> {
    const db = this.requireProjectDb();
    return this.loadSheetSync(db, sheetId);
  }

  public async saveSheetViewport(sheetId: string, x: number, y: number, zoom: number): Promise<void> {
    const db = this.requireProjectDb();
    db.prepare('UPDATE sheets SET viewport_x = ?, viewport_y = ?, viewport_zoom = ?, updated_at = ? WHERE id = ?').run(
      x,
      y,
      zoom,
      Date.now(),
      sheetId,
    );
  }

  public async commitPatchBatch(batch: CommittedPatchBatch): Promise<PatchCommitResult> {
    const db = this.requireProjectDb(batch.projectId);
    const current = this.loadSheetSync(db, batch.sheetId);
    const { nextSheet, inverseOps } = applyPatchOpsToSheet(current, batch.ops);
    const now = Date.now();
    let seq = 0;

    this.withTx(db, () => {
      this.persistSheetNodesSync(db, nextSheet, now);

      // Truncate any undone redo branch for this sheet
      db.prepare('DELETE FROM command_log WHERE sheet_id = ? AND is_undone = 1').run(batch.sheetId);

      const res = db
        .prepare(`
          INSERT INTO command_log (
            project_id, sheet_id, actor, ai_run_id, label,
            forward_ops_json, inverse_ops_json, is_undone, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
        `)
        .run(
          batch.projectId,
          batch.sheetId,
          batch.actor,
          batch.aiRunId ?? null,
          batch.label,
          JSON.stringify(batch.ops),
          JSON.stringify(inverseOps),
          now,
        );
      seq = Number(res.lastInsertRowid);
    });

    const { canUndo, canRedo } = this.getUndoRedoAvailabilitySync(db, batch.sheetId);
    return { seq, sheet: nextSheet, canUndo, canRedo };
  }

  public async undo(sheetId: string): Promise<PatchCommitResult | null> {
    const db = this.requireProjectDb();
    const row = db
      .prepare('SELECT * FROM command_log WHERE sheet_id = ? AND is_undone = 0 ORDER BY seq DESC LIMIT 1')
      .get(sheetId) as Record<string, any> | undefined;
    if (!row) return null;

    const current = this.loadSheetSync(db, sheetId);
    const inverseOps = JSON.parse(String(row.inverse_ops_json)) as UIPatchOp[];
    const { nextSheet } = applyPatchOpsToSheet(current, inverseOps);
    const now = Date.now();
    const seq = Number(row.seq);

    this.withTx(db, () => {
      this.persistSheetNodesSync(db, nextSheet, now);
      db.prepare('UPDATE command_log SET is_undone = 1 WHERE seq = ?').run(seq);
    });

    const { canUndo, canRedo } = this.getUndoRedoAvailabilitySync(db, sheetId);
    return { seq, sheet: nextSheet, canUndo, canRedo };
  }

  public async redo(sheetId: string): Promise<PatchCommitResult | null> {
    const db = this.requireProjectDb();
    const row = db
      .prepare('SELECT * FROM command_log WHERE sheet_id = ? AND is_undone = 1 ORDER BY seq ASC LIMIT 1')
      .get(sheetId) as Record<string, any> | undefined;
    if (!row) return null;

    const current = this.loadSheetSync(db, sheetId);
    const forwardOps = JSON.parse(String(row.forward_ops_json)) as UIPatchOp[];
    const { nextSheet } = applyPatchOpsToSheet(current, forwardOps);
    const now = Date.now();
    const seq = Number(row.seq);

    this.withTx(db, () => {
      this.persistSheetNodesSync(db, nextSheet, now);
      db.prepare('UPDATE command_log SET is_undone = 0 WHERE seq = ?').run(seq);
    });

    const { canUndo, canRedo } = this.getUndoRedoAvailabilitySync(db, sheetId);
    return { seq, sheet: nextSheet, canUndo, canRedo };
  }

  public async listCheckpoints(sheetId: string): Promise<CheckpointSummaryDTO[]> {
    const db = this.requireProjectDb();
    const rows = db
      .prepare('SELECT * FROM history_checkpoints WHERE sheet_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(sheetId) as Array<Record<string, any>>;

    return rows.map((r) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      sheetId: r.sheet_id ? String(r.sheet_id) : null,
      reason: String(r.reason) as CheckpointReason,
      label: String(r.label),
      aiRunId: r.ai_run_id ? String(r.ai_run_id) : null,
      commandSeqAt: Number(r.command_seq_at),
      createdAt: Number(r.created_at),
    }));
  }

  public async createCheckpoint(input: {
    projectId: string;
    sheetId: string;
    reason: CheckpointReason;
    label: string;
    aiRunId?: string;
  }): Promise<CheckpointSummaryDTO> {
    const db = this.requireProjectDb(input.projectId);
    const sheet = this.loadSheetSync(db, input.sheetId);
    const maxSeqRow = db
      .prepare('SELECT COALESCE(MAX(seq), 0) as max_seq FROM command_log WHERE sheet_id = ? AND is_undone = 0')
      .get(input.sheetId) as { max_seq: number | bigint };
    const commandSeqAt = Number(maxSeqRow?.max_seq ?? 0);

    const vfsFiles = db
      .prepare(
        "SELECT id, content_text, content_sha256 FROM vfs_entries WHERE project_id = ? AND entry_kind IN ('source_file', 'style_file', 'script_file', 'blueprint_graph', 'three_scene', 'sql_schema', 'sql_file')",
      )
      .all(input.projectId) as Array<{ id: string; content_text: string | null; content_sha256: string | null }>;

    const vfsBackups = vfsFiles.map((f) => ({
      id: f.id,
      contentText: f.content_text,
      contentSha256: f.content_sha256,
    }));

    const compressed = this.compressCheckpointSync(sheet, vfsBackups);
    const checkpointId = generateNodeId('chk');
    const now = Date.now();

    db.prepare(`
      INSERT INTO history_checkpoints (
        id, project_id, sheet_id, reason, label, ai_run_id, command_seq_at,
        compressed_snapshot, touched_files_backup_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      checkpointId,
      input.projectId,
      input.sheetId,
      input.reason,
      input.label,
      input.aiRunId ?? null,
      commandSeqAt,
      compressed,
      JSON.stringify(vfsBackups.map((b) => b.id)),
      now,
    );

    return {
      id: checkpointId,
      projectId: input.projectId,
      sheetId: input.sheetId,
      reason: input.reason,
      label: input.label,
      aiRunId: input.aiRunId ?? null,
      commandSeqAt,
      createdAt: now,
    };
  }

  public async restoreCheckpoint(checkpointId: string): Promise<UISheetDocument> {
    const db = this.requireProjectDb();
    const row = db.prepare('SELECT * FROM history_checkpoints WHERE id = ?').get(checkpointId) as
      | Record<string, any>
      | undefined;
    if (!row) throw new Error(`Checkpoint not found: ${checkpointId}`);

    const blob = row.compressed_snapshot as Uint8Array;
    const inflatedJson = inflateSync(Buffer.from(blob)).toString('utf8');
    const parsed = JSON.parse(inflatedJson) as CompressedCheckpointPayload;
    const restoredSheet = parsed.sheet;
    const seqAt = Number(row.command_seq_at);
    const now = Date.now();

    this.withTx(db, () => {
      this.persistSheetNodesSync(db, restoredSheet, now);

      // Restore VFS source buffers captured at checkpoint time
      const updVfs = db.prepare('UPDATE vfs_entries SET content_text = ?, content_sha256 = ?, updated_at = ? WHERE id = ?');
      for (const b of parsed.vfsBackups ?? []) {
        updVfs.run(b.contentText, b.contentSha256, now, b.id);
      }

      // Mark commands after seqAt as undone so history remains consistent
      db.prepare('UPDATE command_log SET is_undone = 1 WHERE sheet_id = ? AND seq > ?').run(
        restoredSheet.sheetId,
        seqAt,
      );
      db.prepare('UPDATE command_log SET is_undone = 0 WHERE sheet_id = ? AND seq <= ?').run(
        restoredSheet.sheetId,
        seqAt,
      );

      if (row.ai_run_id) {
        db.prepare(`
          UPDATE ai_tool_executions SET status = 'reverted'
          WHERE message_id IN (SELECT id FROM ai_messages WHERE pre_checkpoint_id = ?)
        `).run(checkpointId);
      }
    });

    return restoredSheet;
  }

  // ==========================================================================
  // DESIGN TOKENS, THEMES & SQLITE FTS5 OFFLINE ICON SEARCH
  // ==========================================================================

  public async listTokens(projectId: string): Promise<DesignTokenEntry[]> {
    const db = this.requireProjectDb(projectId);
    return this.listTokensSync(db, projectId);
  }

  public async upsertToken(entry: Omit<DesignTokenEntry, 'id'> & { id?: string }): Promise<DesignTokenEntry> {
    const db = this.requireProjectDb(entry.projectId);
    const id =
      entry.id ??
      `${entry.projectId}_tok_${entry.themeId ? 'th_' : ''}${entry.tokenPath.replace(/[^a-zA-Z0-9]/g, '_')}`;

    if (entry.themeId === null) {
      const existing = db
        .prepare('SELECT id FROM design_tokens WHERE project_id = ? AND theme_id IS NULL AND token_path = ?')
        .get(entry.projectId, entry.tokenPath) as { id: string } | undefined;
      if (existing) {
        db.prepare('UPDATE design_tokens SET category = ?, raw_value = ?, alias_of_path = ? WHERE id = ?').run(
          entry.category,
          entry.rawValue,
          entry.aliasOfPath ?? null,
          existing.id,
        );
        return { ...entry, id: existing.id };
      }
    }

    db.prepare(`
      INSERT INTO design_tokens (id, project_id, theme_id, token_path, category, raw_value, alias_of_path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, theme_id, token_path) DO UPDATE SET
        category = excluded.category,
        raw_value = excluded.raw_value,
        alias_of_path = excluded.alias_of_path
    `).run(id, entry.projectId, entry.themeId, entry.tokenPath, entry.category, entry.rawValue, entry.aliasOfPath ?? null);

    return { ...entry, id };
  }

  public async deleteToken(tokenId: string): Promise<void> {
    const db = this.requireProjectDb();
    db.prepare('DELETE FROM design_tokens WHERE id = ?').run(tokenId);
  }

  public async listThemes(projectId: string): Promise<DesignTheme[]> {
    const db = this.requireProjectDb(projectId);
    return this.listThemesSync(db, projectId);
  }

  public async searchIcons(query: string, category?: string): Promise<OfflineIconEntry[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      return searchOfflineIcons('', category);
    }

    const safeTokens = cleanQuery
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    if (safeTokens.length > 0) {
      try {
        const ftsExpr = safeTokens.map((t) => `"${t}"*`).join(' AND ');
        const sql =
          category && category !== 'all'
            ? 'SELECT id, name, category, tags_text, view_box, svg_body FROM icon_catalog_fts5 WHERE icon_catalog_fts5 MATCH ? AND category = ? LIMIT 64'
            : 'SELECT id, name, category, tags_text, view_box, svg_body FROM icon_catalog_fts5 WHERE icon_catalog_fts5 MATCH ? LIMIT 64';
        const rows = this.globalDb
          .prepare(sql)
          .all(...(category && category !== 'all' ? [ftsExpr, category] : [ftsExpr])) as Array<Record<string, any>>;

        if (rows.length > 0) {
          return rows.map((r) => ({
            id: String(r.id),
            name: String(r.name),
            category: String(r.category) as OfflineIconEntry['category'],
            tags: String(r.tags_text).split(' ').filter(Boolean),
            viewBox: String(r.view_box),
            svgBody: String(r.svg_body),
          }));
        }
      } catch {
        // Fallback to in-memory catalog filter
      }
    }
    return searchOfflineIcons(cleanQuery, category);
  }

  // ==========================================================================
  // ASSETS (`studio-asset://` CAS)
  // ==========================================================================

  public async getAssetByHash(
    projectId: string,
    sha256: string,
  ): Promise<{ mimeType: string; data: Uint8Array } | null> {
    const db = this.requireProjectDb(projectId);
    const row = db
      .prepare('SELECT mime_type, blob_data FROM assets WHERE project_id = ? AND sha256 = ?')
      .get(projectId, sha256) as { mime_type: string; blob_data: Uint8Array | null } | undefined;
    if (!row || !row.blob_data) return null;
    return { mimeType: row.mime_type, data: row.blob_data };
  }

  public saveAssetBlobSync(
    projectId: string,
    name: string,
    mimeType: string,
    data: Uint8Array,
  ): { id: string; sha256: string } {
    const db = this.requireProjectDb(projectId);
    const sha256 = sha256Hex(data);
    const existing = db
      .prepare('SELECT id FROM assets WHERE project_id = ? AND sha256 = ?')
      .get(projectId, sha256) as { id: string } | undefined;
    if (existing) return { id: existing.id, sha256 };

    const id = generateNodeId('asset');
    db.prepare(`
      INSERT INTO assets (id, project_id, sha256, name, mime_type, byte_size, blob_data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, sha256, name, mimeType, data.byteLength, data, Date.now());
    return { id, sha256 };
  }

  // ==========================================================================
  // AI PROVIDERS, CHAT HISTORY & UNSLOTH TRAINING PAIRS
  // ==========================================================================

  public async getAiProviderConfigs(): Promise<Record<string, { baseUrl: string; apiKey?: string }>> {
    const rows = this.globalDb.prepare('SELECT id, base_url, api_key FROM ai_providers').all() as Array<{
      id: string;
      base_url: string;
      api_key: string | null;
    }>;
    const out: Record<string, { baseUrl: string; apiKey?: string }> = {};
    for (const r of rows) {
      out[r.id] = { baseUrl: r.base_url, apiKey: r.api_key ?? undefined };
    }
    return out;
  }

  public async saveAiProviderConfig(id: LocalAIProviderKind, baseUrl: string, apiKey?: string): Promise<void> {
    this.globalDb
      .prepare(`
        INSERT INTO ai_providers (id, base_url, api_key, vram_reserve_mb, updated_at)
        VALUES (?, ?, ?, 768, ?)
        ON CONFLICT(id) DO UPDATE SET
          base_url = excluded.base_url,
          api_key = COALESCE(excluded.api_key, ai_providers.api_key),
          updated_at = excluded.updated_at
      `)
      .run(id, baseUrl, apiKey ?? null, Date.now());
  }

  public async listAiThreads(projectId: string): Promise<AgentThreadDTO[]> {
    const db = this.requireProjectDb(projectId);
    const rows = db
      .prepare('SELECT * FROM ai_threads WHERE project_id = ? ORDER BY updated_at DESC LIMIT 30')
      .all(projectId) as Array<Record<string, any>>;

    return rows.map((r) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      title: String(r.title),
      mode: String(r.mode) as AgentThreadDTO['mode'],
      provider: String(r.provider) as LocalAIProviderKind,
      modelName: String(r.model_name),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    }));
  }

  public async getAiThreadMessages(threadId: string): Promise<AgentChatMessageDTO[]> {
    const db = this.requireProjectDb();
    const msgRows = db
      .prepare('SELECT * FROM ai_messages WHERE thread_id = ? ORDER BY created_at ASC')
      .all(threadId) as Array<Record<string, any>>;

    return msgRows.map((m) => {
      const toolRows = db
        .prepare('SELECT * FROM ai_tool_executions WHERE message_id = ?')
        .all(String(m.id)) as Array<Record<string, any>>;

      return {
        id: String(m.id),
        threadId: String(m.thread_id),
        role: String(m.role) as AgentChatMessageDTO['role'],
        contentText: String(m.content_text),
        thinkingText: m.thinking_text ? String(m.thinking_text) : undefined,
        preCheckpointId: m.pre_checkpoint_id ? String(m.pre_checkpoint_id) : null,
        toolCalls: toolRows.map((t) => ({
          id: String(t.id),
          toolName: String(t.tool_name),
          argsJson: String(t.args_json),
          resultSummary: t.result_json ? String(t.result_json) : '',
          status: String(t.status) as any,
          durationMs: Number(t.duration_ms),
        })),
        tokensIn: m.tokens_in !== null ? Number(m.tokens_in) : undefined,
        tokensOut: m.tokens_out !== null ? Number(m.tokens_out) : undefined,
        latencyMs: m.latency_ms !== null ? Number(m.latency_ms) : undefined,
        createdAt: Number(m.created_at),
      };
    });
  }

  public async recordAiTurnMessages(payload: SaveAiTurnPayload): Promise<{
    threadId: string;
    userMessage: AgentChatMessageDTO;
    assistantMessage: AgentChatMessageDTO;
  }> {
    const db = this.requireProjectDb(payload.projectId);
    const now = Date.now();
    const threadId = payload.threadId || generateNodeId('thr');
    const userMsgId = generateNodeId('msg');
    const asstMsgId = generateNodeId('msg');

    this.withTx(db, () => {
      const existingThread = db.prepare('SELECT id FROM ai_threads WHERE id = ?').get(threadId);
      if (!existingThread) {
        db.prepare(`
          INSERT INTO ai_threads (id, project_id, title, mode, provider, model_name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          threadId,
          payload.projectId,
          payload.titleHint.slice(0, 80) || 'Agentic Session',
          payload.mode,
          payload.provider,
          payload.modelName,
          now,
          now + 1,
        );
      } else {
        db.prepare('UPDATE ai_threads SET mode = ?, provider = ?, model_name = ?, updated_at = ? WHERE id = ?').run(
          payload.mode,
          payload.provider,
          payload.modelName,
          now + 1,
          threadId,
        );
      }

      db.prepare(`
        INSERT INTO ai_messages (
          id, thread_id, role, content_text, thinking_text, pre_checkpoint_id,
          tokens_in, tokens_out, latency_ms, created_at
        ) VALUES (?, ?, 'user', ?, NULL, ?, NULL, NULL, NULL, ?)
      `).run(userMsgId, threadId, payload.userPrompt, payload.preCheckpointId ?? null, now);

      db.prepare(`
        INSERT INTO ai_messages (
          id, thread_id, role, content_text, thinking_text, pre_checkpoint_id,
          tokens_in, tokens_out, latency_ms, created_at
        ) VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        asstMsgId,
        threadId,
        payload.assistantReply,
        payload.thinkingText ?? null,
        payload.preCheckpointId ?? null,
        payload.tokensIn ?? null,
        payload.tokensOut ?? null,
        payload.latencyMs ?? null,
        now + 1,
      );

      if (payload.toolCalls && payload.toolCalls.length > 0) {
        const insTool = db.prepare(`
          INSERT INTO ai_tool_executions (id, message_id, tool_name, args_json, result_json, status, duration_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const tc of payload.toolCalls) {
          insTool.run(tc.id, asstMsgId, tc.toolName, tc.argsJson, tc.resultSummary, tc.status, tc.durationMs);
        }
      }
    });

    return {
      threadId,
      userMessage: {
        id: userMsgId,
        threadId,
        role: 'user',
        contentText: payload.userPrompt,
        preCheckpointId: payload.preCheckpointId ?? null,
        createdAt: now,
      },
      assistantMessage: {
        id: asstMsgId,
        threadId,
        role: 'assistant',
        contentText: payload.assistantReply,
        thinkingText: payload.thinkingText,
        preCheckpointId: payload.preCheckpointId ?? null,
        toolCalls: payload.toolCalls ?? [],
        tokensIn: payload.tokensIn,
        tokensOut: payload.tokensOut,
        latencyMs: payload.latencyMs,
        createdAt: now + 1,
      },
    };
  }

  public async recordUnslothPair(input: RecordUnslothPairInput): Promise<UnslothTrainingPairDTO> {
    const db = this.requireProjectDb(input.projectId);
    const id = generateNodeId('pair');
    const now = Date.now();
    const score = input.qualityScore ?? 5;

    db.prepare(`
      INSERT INTO unsloth_dataset_pairs (
        id, project_id, sheet_id, prompt_summary, normalized_ui_ir_json,
        tokens_snapshot_json, target_framework, accepted_code_output, quality_score, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.projectId,
      input.sheetId ?? null,
      input.promptSummary,
      input.normalizedUiIrJson,
      input.tokensSnapshotJson ?? null,
      input.targetFramework,
      input.acceptedCodeOutput,
      score,
      now,
    );

    return {
      id,
      projectId: input.projectId,
      sheetId: input.sheetId ?? null,
      promptSummary: input.promptSummary,
      normalizedUiIrJson: input.normalizedUiIrJson,
      tokensSnapshotJson: input.tokensSnapshotJson,
      targetFramework: input.targetFramework,
      acceptedCodeOutput: input.acceptedCodeOutput,
      qualityScore: score,
      createdAt: now,
    };
  }

  public async listUnslothPairs(projectId: string): Promise<UnslothTrainingPairDTO[]> {
    const db = this.requireProjectDb(projectId);
    const rows = db
      .prepare('SELECT * FROM unsloth_dataset_pairs WHERE project_id = ? ORDER BY created_at DESC LIMIT 500')
      .all(projectId) as Array<Record<string, any>>;

    return rows.map((r) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      sheetId: r.sheet_id ? String(r.sheet_id) : null,
      promptSummary: String(r.prompt_summary),
      normalizedUiIrJson: String(r.normalized_ui_ir_json),
      tokensSnapshotJson: r.tokens_snapshot_json ? String(r.tokens_snapshot_json) : undefined,
      targetFramework: String(r.target_framework) as CodegenTargetId,
      acceptedCodeOutput: String(r.accepted_code_output),
      qualityScore: Number(r.quality_score),
      createdAt: Number(r.created_at),
    }));
  }

  // ==========================================================================
  // MULTI-DIALECT SQL & DATA STUDIO METHODS (v3.0 â€” Powered by SqlStudioEngine)
  // ==========================================================================

  private getSqlConnectionByIdSync(db: DatabaseSync, connectionId?: string | null): SqlConnectionProfile | null {
    if (!connectionId || connectionId === '__local_sqlite__' || connectionId === '__memory_sandbox__') {
      return null;
    }
    const r = db.prepare('SELECT * FROM sql_connections WHERE id = ?').get(connectionId) as
      | Record<string, any>
      | undefined;
    if (!r) return null;
    return {
      id: String(r.id),
      projectId: String(r.project_id),
      name: String(r.name),
      dialect: String(r.dialect) as SqlDialect,
      mode: String(r.mode) as SqlConnectionProfile['mode'],
      sqliteFilePath: r.sqlite_file_path ? String(r.sqlite_file_path) : undefined,
      host: r.host ? String(r.host) : undefined,
      port: r.port !== null && r.port !== undefined ? Number(r.port) : undefined,
      database: r.database_name ? String(r.database_name) : undefined,
      username: r.username ? String(r.username) : undefined,
      ssl: Number(r.ssl) === 1,
      envVarRef: r.env_var_ref ? String(r.env_var_ref) : undefined,
      hasStoredSecret: Boolean(r.encrypted_secret_hex),
      readOnly: Number(r.read_only) === 1,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }

  private getProjectStorageDirSync(projectId: string): string {
    return join(this.projectsDir, `sql-local-${projectId}`);
  }

  public async loadSqlSchema(projectId: string): Promise<SqlDesignDocument> {
    const db = this.requireProjectDb(projectId);
    const row = db
      .prepare('SELECT name, sql_schema_json FROM projects WHERE id = ?')
      .get(projectId) as { name?: string; sql_schema_json?: string | null } | undefined;
    if (row?.sql_schema_json) {
      try {
        const parsed = JSON.parse(String(row.sql_schema_json)) as SqlDesignDocument;
        return {
          ...parsed,
          namedQueries: (parsed.namedQueries ?? []).map((nq) => ({ ...nq, sql: nq.canonicalSql || nq.sql })),
        };
      } catch {
        // fallback below
      }
    }
    const starter = attachBaselinesToDocument(
      createStarterSqlDocument(projectId, row?.name ?? 'Studio Database', 'sqlite'),
    );
    db.prepare('UPDATE projects SET sql_schema_json = ? WHERE id = ?').run(JSON.stringify(starter), projectId);
    return starter;
  }

  public async saveSqlSchema(projectId: string, doc: SqlDesignDocument): Promise<SqlDesignDocument> {
    const db = this.requireProjectDb(projectId);
    const updated: SqlDesignDocument = {
      ...doc,
      projectId,
      namedQueries: (doc.namedQueries ?? []).map((nq) => ({ ...nq, sql: nq.canonicalSql || nq.sql })),
      updatedAt: Date.now(),
    };
    db.prepare('UPDATE projects SET sql_schema_json = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(updated),
      updated.updatedAt,
      projectId,
    );
    // Keep any VFS `.schema.sql.json` entry synchronized if present
    const vfsSchema = db
      .prepare("SELECT id FROM vfs_entries WHERE project_id = ? AND entry_kind = 'sql_schema' LIMIT 1")
      .get(projectId) as { id: string } | undefined;
    if (vfsSchema) {
      await this.writeVfsFile(vfsSchema.id, JSON.stringify(updated, null, 2));
    }
    return updated;
  }

  public async listSqlConnections(projectId: string): Promise<SqlConnectionProfile[]> {
    const db = this.requireProjectDb(projectId);
    const rows = db
      .prepare('SELECT * FROM sql_connections WHERE project_id = ? ORDER BY updated_at DESC')
      .all(projectId) as Array<Record<string, any>>;
    return rows.map((r) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      name: String(r.name),
      dialect: String(r.dialect) as SqlDialect,
      mode: String(r.mode) as SqlConnectionProfile['mode'],
      sqliteFilePath: r.sqlite_file_path ? String(r.sqlite_file_path) : undefined,
      host: r.host ? String(r.host) : undefined,
      port: r.port !== null && r.port !== undefined ? Number(r.port) : undefined,
      database: r.database_name ? String(r.database_name) : undefined,
      username: r.username ? String(r.username) : undefined,
      ssl: Number(r.ssl) === 1,
      envVarRef: r.env_var_ref ? String(r.env_var_ref) : undefined,
      hasStoredSecret: Boolean(r.encrypted_secret_hex),
      readOnly: Number(r.read_only) === 1,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    }));
  }

  public async saveSqlConnection(
    profile: Omit<SqlConnectionProfile, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    encryptedSecretHex?: string | null,
  ): Promise<SqlConnectionProfile> {
    const db = this.requireProjectDb(profile.projectId);
    const now = Date.now();
    const id = profile.id ?? generateNodeId('sqlconn');
    const existing = db
      .prepare('SELECT created_at, encrypted_secret_hex FROM sql_connections WHERE id = ?')
      .get(id) as { created_at?: number; encrypted_secret_hex?: string | null } | undefined;
    const createdAt = existing?.created_at ?? now;
    const nextSecret =
      encryptedSecretHex !== undefined ? encryptedSecretHex : (existing?.encrypted_secret_hex ?? null);

    db.prepare(`
      INSERT INTO sql_connections (
        id, project_id, name, dialect, mode, sqlite_file_path, host, port,
        database_name, username, ssl, env_var_ref, encrypted_secret_hex, read_only, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        dialect = excluded.dialect,
        mode = excluded.mode,
        sqlite_file_path = excluded.sqlite_file_path,
        host = excluded.host,
        port = excluded.port,
        database_name = excluded.database_name,
        username = excluded.username,
        ssl = excluded.ssl,
        env_var_ref = excluded.env_var_ref,
        encrypted_secret_hex = excluded.encrypted_secret_hex,
        read_only = excluded.read_only,
        updated_at = excluded.updated_at
    `).run(
      id,
      profile.projectId,
      profile.name,
      profile.dialect,
      profile.mode,
      profile.sqliteFilePath ?? null,
      profile.host ?? null,
      profile.port ?? null,
      profile.database ?? null,
      profile.username ?? null,
      profile.ssl ? 1 : 0,
      profile.envVarRef ?? null,
      nextSecret,
      profile.readOnly ? 1 : 0,
      createdAt,
      now,
    );

    return {
      ...profile,
      id,
      hasStoredSecret: Boolean(nextSecret),
      createdAt,
      updatedAt: now,
    };
  }

  public async deleteSqlConnection(connectionId: string): Promise<void> {
    const db = this.requireProjectDb();
    db.prepare('DELETE FROM sql_connections WHERE id = ?').run(connectionId);
  }

  public async getSqlConnectionSecretMeta(
    connectionId: string,
  ): Promise<{ encryptedSecretHex: string | null; envVarRef: string | null } | null> {
    const db = this.requireProjectDb();
    const row = db
      .prepare('SELECT encrypted_secret_hex, env_var_ref FROM sql_connections WHERE id = ?')
      .get(connectionId) as { encrypted_secret_hex?: string | null; env_var_ref?: string | null } | undefined;
    if (!row) return null;
    return {
      encryptedSecretHex: row.encrypted_secret_hex ? String(row.encrypted_secret_hex) : null,
      envVarRef: row.env_var_ref ? String(row.env_var_ref) : null,
    };
  }

  public async testSqlConnection(
    connectionId: string,
    decryptedSecret?: string | null,
  ): Promise<{ ok: boolean; message: string; version?: string; latencyMs?: number }> {
    const db = this.requireProjectDb();
    const proj = this.getProjectSummarySync(db, this.activeProjectDbPath!);
    if (connectionId === '__memory_sandbox__') {
      return {
        ok: true,
        message: 'Sandbox SQLite :memory: attiva.',
        version: 'SQLite 3 (:memory:)',
        latencyMs: 1,
      };
    }
    if (connectionId === '__local_sqlite__') {
      const schemaDoc = await this.loadSqlSchema(proj.id);
      const localProfile: SqlConnectionProfile = {
        id: '__local_sqlite__',
        projectId: proj.id,
        name: 'SQLite Locale Progetto',
        dialect: 'sqlite',
        mode: 'local_sqlite',
        sqliteFilePath: schemaDoc.databaseFileRelPath || 'data/app.sqlite',
        createdAt: proj.createdAt,
        updatedAt: Date.now(),
      };
      return this.sqlEngine.testConnection({
        profile: localProfile,
        rootDiskPath: proj.rootDiskPath,
        storageProjectDir: this.getProjectStorageDirSync(proj.id),
      });
    }
    const profile = this.getSqlConnectionByIdSync(db, connectionId);
    if (!profile) {
      return { ok: false, message: `Profilo connessione SQL non trovato: ${connectionId}` };
    }
    return this.sqlEngine.testConnection({
      profile,
      decryptedSecret,
      rootDiskPath: proj.rootDiskPath,
      storageProjectDir: this.getProjectStorageDirSync(proj.id),
    });
  }

  public async introspectSqlConnection(
    connectionId: string,
    decryptedSecret?: string | null,
  ): Promise<SqlDesignDocument> {
    const db = this.requireProjectDb();
    const proj = this.getProjectSummarySync(db, this.activeProjectDbPath!);
    if (connectionId === '__memory_sandbox__') {
      return this.loadSqlSchema(proj.id);
    }
    if (connectionId === '__local_sqlite__') {
      const schemaDoc = await this.loadSqlSchema(proj.id);
      const localProfile: SqlConnectionProfile = {
        id: '__local_sqlite__',
        projectId: proj.id,
        name: `${proj.name} SQLite`,
        dialect: 'sqlite',
        mode: 'local_sqlite',
        sqliteFilePath: schemaDoc.databaseFileRelPath || 'data/app.sqlite',
        createdAt: proj.createdAt,
        updatedAt: Date.now(),
      };
      return this.sqlEngine.introspectConnection({
        profile: localProfile,
        rootDiskPath: proj.rootDiskPath,
        storageProjectDir: this.getProjectStorageDirSync(proj.id),
      });
    }
    const profile = this.getSqlConnectionByIdSync(db, connectionId);
    if (!profile) {
      return this.loadSqlSchema(proj.id);
    }
    return this.sqlEngine.introspectConnection({
      profile,
      decryptedSecret,
      rootDiskPath: proj.rootDiskPath,
      storageProjectDir: this.getProjectStorageDirSync(proj.id),
    });
  }

  public async executeSqlQuery(req: SqlQueryRequest & { decryptedSecret?: string | null }): Promise<SqlQueryResult> {
    const db = this.requireProjectDb(req.projectId);
    const proj = this.getProjectSummarySync(db, this.activeProjectDbPath!);
    const schemaDoc = req.schemaDoc ?? (await this.loadSqlSchema(req.projectId));
    const profile = this.getSqlConnectionByIdSync(db, req.connectionId);

    const result = await this.sqlEngine.executeQuery({
      req,
      profile,
      decryptedSecret: req.decryptedSecret,
      rootDiskPath: proj.rootDiskPath,
      storageProjectDir: this.getProjectStorageDirSync(req.projectId),
      schemaDoc,
    });

    // Record query execution in `sql_query_history` (retaining last 100 entries per project)
    try {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sql_query_history (
          id, project_id, connection_id, dialect, sql_text, duration_ms, row_count, ok, error_text, executed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        generateNodeId('sqlhist'),
        req.projectId,
        req.connectionId ?? null,
        result.dialect,
        req.sql.slice(0, 8000),
        result.durationMs,
        result.rowCount,
        result.ok ? 1 : 0,
        result.error ?? null,
        now,
      );
      db.prepare(`
        DELETE FROM sql_query_history
        WHERE project_id = ? AND id NOT IN (
          SELECT id FROM sql_query_history WHERE project_id = ? ORDER BY executed_at DESC LIMIT 100
        )
      `).run(req.projectId, req.projectId);
    } catch {
      // non-fatal history log error
    }

    return result;
  }

  public async applySqlDataChanges(input: {
    projectId: string;
    connectionId?: string | null;
    sandboxMode?: boolean;
    dialect?: SqlDialect;
    tableName: string;
    schema?: string;
    changes: SqlDataChange[];
    schemaDoc?: SqlDesignDocument;
    decryptedSecret?: string | null;
  }): Promise<{ ok: boolean; appliedCount: number; sqlPreview: string[]; error?: string }> {
    const db = this.requireProjectDb(input.projectId);
    const proj = this.getProjectSummarySync(db, this.activeProjectDbPath!);
    const schemaDoc = input.schemaDoc ?? (await this.loadSqlSchema(input.projectId));
    const profile = this.getSqlConnectionByIdSync(db, input.connectionId);

    const out = await this.sqlEngine.applyDataChanges({
      projectId: input.projectId,
      connectionId: input.connectionId,
      profile,
      decryptedSecret: input.decryptedSecret,
      sandboxMode: input.sandboxMode,
      dialect: input.dialect,
      tableName: input.tableName,
      schema: input.schema,
      changes: input.changes,
      schemaDoc,
      rootDiskPath: proj.rootDiskPath,
      storageProjectDir: this.getProjectStorageDirSync(input.projectId),
    });

    // When mutating the `:memory:` sandbox, also mirror resulting rows into `schemaDoc.seedRows` so project reloads preserve edits
    const isSandboxTarget =
      input.sandboxMode ||
      (!profile && input.connectionId !== '__local_sqlite__') ||
      profile?.mode === 'memory_sandbox';
    if (out.ok && isSandboxTarget) {
      try {
        const refreshed = await this.sqlEngine.executeQuery({
          req: {
            projectId: input.projectId,
            sandboxMode: true,
            sql: `SELECT * FROM "${input.tableName.replace(/"/g, '""')}";`,
            maxRows: Number.POSITIVE_INFINITY,
          },
          schemaDoc,
          rootDiskPath: proj.rootDiskPath,
          storageProjectDir: this.getProjectStorageDirSync(input.projectId),
        });
        if (refreshed.ok) {
          const nextSeeds = [...schemaDoc.seedRows];
          const existingIdx = nextSeeds.findIndex(
            (s) => s.tableName.toLowerCase() === input.tableName.toLowerCase(),
          );
          if (existingIdx >= 0) {
            nextSeeds[existingIdx] = { tableName: input.tableName, rows: refreshed.rows };
          } else {
            nextSeeds.push({ tableName: input.tableName, rows: refreshed.rows });
          }
          await this.saveSqlSchema(input.projectId, { ...schemaDoc, seedRows: nextSeeds });
        }
      } catch {
        // non-fatal seed sync skip
      }
    }

    return out;
  }

  public async resetSqlSandbox(projectId: string, schemaDoc?: SqlDesignDocument): Promise<{ ok: boolean; message: string }> {
    const doc = schemaDoc ?? (await this.loadSqlSchema(projectId));
    return this.sqlEngine.resetSandbox(projectId, doc);
  }

  public async compileSqlMigration(input: {
    projectId: string;
    schemaDoc: SqlDesignDocument;
    connectionId?: string | null;
    decryptedSecret?: string | null;
  }): Promise<SqlMigrationPlan> {
    const db = this.requireProjectDb(input.projectId);
    const proj = this.getProjectSummarySync(db, this.activeProjectDbPath!);
    const profile = this.getSqlConnectionByIdSync(db, input.connectionId);
    return this.sqlEngine.compileMigration({
      projectId: input.projectId,
      schemaDoc: input.schemaDoc,
      connectionId: input.connectionId,
      profile,
      decryptedSecret: input.decryptedSecret,
      rootDiskPath: proj.rootDiskPath,
      storageProjectDir: this.getProjectStorageDirSync(input.projectId),
    });
  }

  public async applySqlMigration(input: {
    projectId: string;
    plan: SqlMigrationPlan;
    connectionId?: string | null;
    sandboxMode?: boolean;
    allowDestructive?: boolean;
    decryptedSecret?: string | null;
  }): Promise<{ ok: boolean; executedStatements: number; error?: string }> {
    const db = this.requireProjectDb(input.projectId);
    const proj = this.getProjectSummarySync(db, this.activeProjectDbPath!);
    const schemaDoc = await this.loadSqlSchema(input.projectId);
    const profile = this.getSqlConnectionByIdSync(db, input.connectionId);

    const res = await this.sqlEngine.applyMigration({
      projectId: input.projectId,
      plan: input.plan,
      schemaDoc,
      connectionId: input.connectionId,
      profile,
      decryptedSecret: input.decryptedSecret,
      sandboxMode: input.sandboxMode,
      allowDestructive: input.allowDestructive,
      rootDiskPath: proj.rootDiskPath,
      storageProjectDir: this.getProjectStorageDirSync(input.projectId),
    });

    if (res.ok) {
      const dropped = new Set(input.plan.changes.filter((change) => change.kind === 'drop_table').map((change) => change.tableId));
      const rebased = attachBaselinesToDocument({
        ...schemaDoc,
        removedTables: schemaDoc.removedTables?.filter((table) => !dropped.has(table.id)),
      });
      await this.saveSqlSchema(input.projectId, rebased);
    }
    return res;
  }

  public async listSqlQueryHistory(projectId: string, limit = 50): Promise<SqlQueryHistoryEntry[]> {
    const db = this.requireProjectDb(projectId);
    const rows = db
      .prepare('SELECT * FROM sql_query_history WHERE project_id = ? ORDER BY executed_at DESC LIMIT ?')
      .all(projectId, limit) as Array<Record<string, any>>;
    return rows.map((r) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      connectionId: r.connection_id ? String(r.connection_id) : null,
      dialect: String(r.dialect) as SqlDialect,
      sql: String(r.sql_text),
      durationMs: Number(r.duration_ms),
      rowCount: Number(r.row_count),
      ok: Number(r.ok) === 1,
      error: r.error_text ? String(r.error_text) : undefined,
      executedAt: Number(r.executed_at),
    }));
  }

  public async extractSqlFromProjectFiles(projectId: string): Promise<ExtractedSqlOperation[]> {
    const db = this.requireProjectDb(projectId);
    const proj = this.getProjectSummarySync(db, this.activeProjectDbPath!);
    const rows = db
      .prepare(
        "SELECT virtual_path, disk_rel_path, content_text FROM vfs_entries WHERE project_id = ? AND entry_kind IN ('source_file', 'script_file', 'sql_file')",
      )
      .all(projectId) as Array<{
      virtual_path: string;
      disk_rel_path: string | null;
      content_text: string | null;
    }>;

    const extracted: ExtractedSqlOperation[] = [];
    for (const r of rows) {
      let text = r.content_text;
      if (proj.rootDiskPath && r.disk_rel_path) {
        const full = join(proj.rootDiskPath, r.disk_rel_path);
        if (existsSync(full) && statSync(full).size <= 512 * 1024) {
          text = readFileSync(full, 'utf8');
        }
      }
      if (!text) continue;
      const ops = extractSqlFromSourceCode(text, r.disk_rel_path || r.virtual_path);
      extracted.push(...ops);
    }
    return extracted;
  }

  // ==========================================================================
  // INTERNAL SYNCHRONOUS HELPERS
  // ==========================================================================

  private upsertRecentProjectSync(
    id: string,
    name: string,
    dbFilePath: string,
    rootDiskPath: string | null,
    primaryTarget: CodegenTargetId,
    stylingPreset: StylingDialect,
    createdAt: number,
    updatedAt: number,
    layoutMode?: 'freeform' | 'auto',
    stackId?: ProjectStackId,
    primaryLanguage?: PrimaryCodeLanguage,
  ): void {
    this.globalDb
      .prepare(`
        INSERT INTO recent_projects (
          id, name, db_file_path, root_disk_path, primary_target, styling_preset, layout_mode, stack_id, primary_language, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          db_file_path = excluded.db_file_path,
          root_disk_path = excluded.root_disk_path,
          primary_target = excluded.primary_target,
          styling_preset = excluded.styling_preset,
          layout_mode = COALESCE(excluded.layout_mode, recent_projects.layout_mode),
          stack_id = COALESCE(excluded.stack_id, recent_projects.stack_id),
          primary_language = COALESCE(excluded.primary_language, recent_projects.primary_language),
          updated_at = excluded.updated_at
      `)
      .run(
        id,
        name,
        dbFilePath,
        rootDiskPath,
        primaryTarget,
        stylingPreset,
        layoutMode ?? null,
        stackId ?? null,
        primaryLanguage ?? null,
        createdAt,
        updatedAt,
      );
  }

  private getProjectSummarySync(db: DatabaseSync, dbFilePath: string): ProjectSummary {
    const r = db.prepare('SELECT * FROM projects LIMIT 1').get() as Record<string, any> | undefined;
    if (!r) throw new Error('Corrupt project database: missing projects row.');
    let layoutMode: 'freeform' | 'auto' | undefined;
    let pythonCompanion: PythonCompanionKind | undefined;
    let settingsStack: ProjectStackId | undefined;
    let settingsLang: PrimaryCodeLanguage | undefined;
    if (r.settings_json) {
      try {
        const parsed = JSON.parse(String(r.settings_json)) as {
          layoutMode?: string;
          stackId?: ProjectStackId;
          primaryLanguage?: PrimaryCodeLanguage;
          pythonCompanion?: PythonCompanionKind;
        };
        if (parsed.layoutMode === 'freeform' || parsed.layoutMode === 'auto') {
          layoutMode = parsed.layoutMode;
        }
        settingsStack = parsed.stackId;
        settingsLang = parsed.primaryLanguage;
        pythonCompanion = parsed.pythonCompanion;
      } catch {
        // ignore invalid settings_json
      }
    }
    return {
      id: String(r.id),
      name: String(r.name),
      dbFilePath,
      rootDiskPath: r.root_disk_path ? String(r.root_disk_path) : null,
      primaryTarget: String(r.primary_target) as CodegenTargetId,
      stylingPreset: String(r.styling_preset) as StylingDialect,
      stackId: (r.stack_id ? (String(r.stack_id) as ProjectStackId) : undefined) ?? settingsStack,
      primaryLanguage:
        (r.primary_language ? (String(r.primary_language) as PrimaryCodeLanguage) : undefined) ?? settingsLang,
      pythonCompanion,
      activeThemeId: r.active_theme_id ? String(r.active_theme_id) : null,
      breakpoints: r.breakpoints_json ? JSON.parse(String(r.breakpoints_json)) : DEFAULT_BREAKPOINTS,
      layoutMode,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }

  private getWorkspaceStateSync(db: DatabaseSync, projectId: string): WorkspaceStateDTO {
    const r = db
      .prepare('SELECT * FROM workspace_state WHERE project_id = ?')
      .get(projectId) as Record<string, any> | undefined;
    if (!r) {
      return {
        projectId,
        openTabsJson: '[]',
        leftTopRatio: 0.45,
        leftActiveMode: 'insert',
        rightPanelMode: 'split',
        rightPanelWidth: 380,
        activeAiProviderId: 'ollama',
        activeAiModelId: 'qwen2.5-coder:7b',
        updatedAt: Date.now(),
      };
    }
    return {
      projectId,
      openTabsJson: String(r.open_tabs_json),
      leftTopRatio: Number(r.left_top_ratio),
      leftActiveMode: String(r.left_active_mode) as WorkspaceStateDTO['leftActiveMode'],
      rightPanelMode: String(r.right_panel_mode) as WorkspaceStateDTO['rightPanelMode'],
      rightPanelWidth: Number(r.right_panel_width),
      activeAiProviderId: String(r.active_ai_provider_id),
      activeAiModelId: String(r.active_ai_model_id),
      updatedAt: Number(r.updated_at),
    };
  }

  private listVfsTreeSync(db: DatabaseSync, projectId: string): VfsNodeDTO[] {
    const rows = db
      .prepare(`
        SELECT v.*, s.id AS linked_sheet_id
        FROM vfs_entries v
        LEFT JOIN sheets s ON s.vfs_entry_id = v.id
        WHERE v.project_id = ?
        ORDER BY v.sort_order ASC, v.name ASC
      `)
      .all(projectId) as Array<Record<string, any>>;

    return rows.map((r) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      parentId: r.parent_id ? String(r.parent_id) : null,
      name: String(r.name),
      virtualPath: String(r.virtual_path),
      diskRelPath: r.disk_rel_path ? String(r.disk_rel_path) : null,
      entryKind: String(r.entry_kind) as VfsEntryKind,
      sheetId: r.linked_sheet_id ? String(r.linked_sheet_id) : null,
      targetFramework: r.target_framework ? (String(r.target_framework) as CodegenTargetId) : null,
      syncMode: String(r.sync_mode) as VfsNodeDTO['syncMode'],
      gitStatus: r.git_status ? (String(r.git_status) as VfsNodeDTO['gitStatus']) : null,
      sortOrder: String(r.sort_order),
      updatedAt: Number(r.updated_at),
    }));
  }

  private listSheetsSync(db: DatabaseSync, projectId: string): SheetSummaryDTO[] {
    const rows = db
      .prepare('SELECT * FROM sheets WHERE project_id = ? ORDER BY updated_at DESC')
      .all(projectId) as Array<Record<string, any>>;

    return rows.map((r) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      vfsEntryId: r.vfs_entry_id ? String(r.vfs_entry_id) : null,
      name: String(r.name),
      sheetKind: String(r.sheet_kind) as SheetSummaryDTO['sheetKind'],
      viewportX: Number(r.viewport_x),
      viewportY: Number(r.viewport_y),
      viewportZoom: Number(r.viewport_zoom),
      updatedAt: Number(r.updated_at),
    }));
  }

  private listThemesSync(db: DatabaseSync, projectId: string): DesignTheme[] {
    const rows = db.prepare('SELECT * FROM themes WHERE project_id = ?').all(projectId) as Array<Record<string, any>>;
    return rows.map((r) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      name: String(r.name),
      isDefault: Number(r.is_default) === 1,
    }));
  }

  private listTokensSync(db: DatabaseSync, projectId: string): DesignTokenEntry[] {
    const rows = db
      .prepare('SELECT * FROM design_tokens WHERE project_id = ? ORDER BY category ASC, token_path ASC')
      .all(projectId) as Array<Record<string, any>>;

    return rows.map((r) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      themeId: r.theme_id ? String(r.theme_id) : null,
      tokenPath: String(r.token_path),
      category: String(r.category) as DesignTokenEntry['category'],
      rawValue: String(r.raw_value),
      aliasOfPath: r.alias_of_path ? String(r.alias_of_path) : null,
    }));
  }

  private buildBootstrapPayloadSync(db: DatabaseSync, dbFilePath: string): ProjectBootstrapPayload {
    const project = this.getProjectSummarySync(db, dbFilePath);
    const workspace = this.getWorkspaceStateSync(db, project.id);
    const vfsTree = this.listVfsTreeSync(db, project.id);
    const sheets = this.listSheetsSync(db, project.id);
    const initialSheet = sheets.length > 0 ? this.loadSheetSync(db, sheets[0].id) : null;
    const themes = this.listThemesSync(db, project.id);
    const tokens = this.listTokensSync(db, project.id);

    return {
      project,
      workspace,
      vfsTree,
      sheets,
      initialSheet,
      themes,
      tokens,
    };
  }

  private loadSheetSync(db: DatabaseSync, sheetId: string): UISheetDocument {
    const sheetRow = db.prepare('SELECT * FROM sheets WHERE id = ?').get(sheetId) as Record<string, any> | undefined;
    if (!sheetRow) {
      throw new Error(`Canvas sheet not found: ${sheetId}`);
    }

    const nodeRows = db
      .prepare('SELECT * FROM scene_nodes WHERE sheet_id = ? ORDER BY sort_order ASC')
      .all(sheetId) as Array<Record<string, any>>;

    const nodes: Record<string, UINode> = {};
    const childrenByParent = new Map<string | null, string[]>();

    for (const r of nodeRows) {
      const id = String(r.id);
      const parentId = r.parent_id ? String(r.parent_id) : null;
      if (!childrenByParent.has(parentId)) {
        childrenByParent.set(parentId, []);
      }
      childrenByParent.get(parentId)!.push(id);

      nodes[id] = {
        id,
        sheetId: String(r.sheet_id),
        parentId,
        childIds: [],
        sortOrder: String(r.sort_order),
        kind: String(r.kind) as UINode['kind'],
        name: String(r.name),
        semanticTag: String(r.semantic_tag) as UINode['semanticTag'],
        visible: Number(r.visible) === 1,
        locked: Number(r.locked) === 1,
        layout: JSON.parse(String(r.layout_json)),
        style: JSON.parse(String(r.style_json)),
        typography: r.typography_json ? JSON.parse(String(r.typography_json)) : undefined,
        content: r.content_json ? JSON.parse(String(r.content_json)) : undefined,
        componentRef: r.component_overrides_json ? JSON.parse(String(r.component_overrides_json)) : undefined,
        controlFlow: r.control_flow_json ? JSON.parse(String(r.control_flow_json)) : undefined,
        stateOverrides: r.state_overrides_json ? JSON.parse(String(r.state_overrides_json)) : undefined,
        responsiveOverrides: r.responsive_overrides_json ? JSON.parse(String(r.responsive_overrides_json)) : undefined,
        dataBindings: r.data_bindings_json ? JSON.parse(String(r.data_bindings_json)) : undefined,
        interactions: r.interactions_json ? JSON.parse(String(r.interactions_json)) : undefined,
        platform: r.platform_ext_json ? JSON.parse(String(r.platform_ext_json)) : undefined,
      };
      if (nodes[id].style.classNames && !nodes[id].classNames) {
        nodes[id].classNames = [...nodes[id].style.classNames];
      }
    }

    for (const [parentId, cids] of childrenByParent.entries()) {
      if (parentId && nodes[parentId]) {
        nodes[parentId].childIds = cids;
      }
    }

    const rootIds = childrenByParent.get(null) ?? [];
    const defaultLayoutModeRaw = sheetRow.default_layout_mode ? String(sheetRow.default_layout_mode) : undefined;
    const defaultLayoutMode =
      defaultLayoutModeRaw === 'freeform' || defaultLayoutModeRaw === 'flex'
        ? defaultLayoutModeRaw
        : undefined;

    return {
      sheetId: String(sheetRow.id),
      projectId: String(sheetRow.project_id),
      name: String(sheetRow.name),
      rootIds,
      nodes,
      customCss: typeof sheetRow.custom_css === 'string' && sheetRow.custom_css.length > 0 ? sheetRow.custom_css : undefined,
      keyframesCss:
        typeof sheetRow.keyframes_css === 'string' && sheetRow.keyframes_css.length > 0
          ? sheetRow.keyframes_css
          : undefined,
      reusableClasses: sheetRow.reusable_classes_json ? JSON.parse(String(sheetRow.reusable_classes_json)) : undefined,
      linkedScripts: sheetRow.linked_scripts_json ? JSON.parse(String(sheetRow.linked_scripts_json)) : undefined,
      automations: sheetRow.automations_json ? JSON.parse(String(sheetRow.automations_json)) : undefined,
      codeOverrides: sheetRow.code_overrides_json ? JSON.parse(String(sheetRow.code_overrides_json)) : undefined,
      defaultLayoutMode,
      stateSchema: sheetRow.state_schema_json ? JSON.parse(String(sheetRow.state_schema_json)) : [],
      propsSchema: sheetRow.props_schema_json ? JSON.parse(String(sheetRow.props_schema_json)) : [],
      ipcSchema: sheetRow.ipc_schema_json ? JSON.parse(String(sheetRow.ipc_schema_json)) : [],
    };
  }

  private persistSheetNodesSync(db: DatabaseSync, sheet: UISheetDocument, now: number): void {
    // Normalize cleared `keyframesCss` ('' from inverse `update_sheet_meta`) to `undefined`, mirroring the loader.
    if (sheet.keyframesCss === '' && !Object.isFrozen(sheet)) {
      delete sheet.keyframesCss;
    }
    db.prepare(`
      UPDATE sheets
      SET name = ?, state_schema_json = ?, props_schema_json = ?, ipc_schema_json = ?,
          custom_css = ?,
          keyframes_css = ?,
          reusable_classes_json = ?,
          linked_scripts_json = ?,
          automations_json = ?,
          code_overrides_json = ?,
          default_layout_mode = COALESCE(?, default_layout_mode),
          updated_at = ?
      WHERE id = ?
    `).run(
      sheet.name,
      JSON.stringify(sheet.stateSchema ?? []),
      JSON.stringify(sheet.propsSchema ?? []),
      JSON.stringify(sheet.ipcSchema ?? []),
      sheet.customCss ?? '',
      sheet.keyframesCss ? sheet.keyframesCss : null,
      sheet.reusableClasses !== undefined ? JSON.stringify(sheet.reusableClasses) : null,
      sheet.linkedScripts !== undefined ? JSON.stringify(sheet.linkedScripts) : null,
      sheet.automations !== undefined ? JSON.stringify(sheet.automations) : null,
      sheet.codeOverrides !== undefined ? JSON.stringify(sheet.codeOverrides) : null,
      sheet.defaultLayoutMode ?? null,
      now,
      sheet.sheetId,
    );

    const existingIdsRows = db
      .prepare('SELECT id FROM scene_nodes WHERE sheet_id = ?')
      .all(sheet.sheetId) as Array<{ id: string }>;

    const targetIdSet = new Set(Object.keys(sheet.nodes));
    const delStmt = db.prepare('DELETE FROM scene_nodes WHERE id = ?');
    for (const r of existingIdsRows) {
      if (!targetIdSet.has(r.id)) {
        delStmt.run(r.id);
      }
    }

    // Traverse top-down so parent_id FK always exists before child insertion
    const ordered: UINode[] = [];
    const visited = new Set<string>();
    const visit = (id: string, parentId: string | null, idx: number) => {
      if (visited.has(id)) return;
      const node = sheet.nodes[id];
      if (!node) return;
      visited.add(id);
      node.parentId = parentId;
      node.sortOrder = fractionalOrderAt(idx);
      ordered.push(node);
      node.childIds.forEach((cid, childIdx) => visit(cid, id, childIdx));
    };

    sheet.rootIds.forEach((rid, idx) => visit(rid, null, idx));
    // Include any unvisited root-level fallback nodes
    Object.values(sheet.nodes).forEach((node, idx) => {
      if (!visited.has(node.id)) {
        visit(node.id, node.parentId && sheet.nodes[node.parentId] ? node.parentId : null, idx + 100);
      }
    });

    const upsertNode = db.prepare(`
      INSERT INTO scene_nodes (
        id, project_id, sheet_id, parent_id, sort_order, kind, name, semantic_tag,
        visible, locked, component_id, layout_json, style_json, typography_json,
        content_json, component_overrides_json, control_flow_json, state_overrides_json,
        responsive_overrides_json, data_bindings_json, interactions_json, platform_ext_json,
        version_seq, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET
        parent_id = excluded.parent_id,
        sort_order = excluded.sort_order,
        kind = excluded.kind,
        name = excluded.name,
        semantic_tag = excluded.semantic_tag,
        visible = excluded.visible,
        locked = excluded.locked,
        layout_json = excluded.layout_json,
        style_json = excluded.style_json,
        typography_json = excluded.typography_json,
        content_json = excluded.content_json,
        component_overrides_json = excluded.component_overrides_json,
        control_flow_json = excluded.control_flow_json,
        state_overrides_json = excluded.state_overrides_json,
        responsive_overrides_json = excluded.responsive_overrides_json,
        data_bindings_json = excluded.data_bindings_json,
        interactions_json = excluded.interactions_json,
        platform_ext_json = excluded.platform_ext_json,
        version_seq = scene_nodes.version_seq + 1,
        updated_at = excluded.updated_at
    `);

    for (const n of ordered) {
      const styleToSave =
        n.classNames !== undefined ? { ...n.style, classNames: n.classNames } : n.style;
      upsertNode.run(
        n.id,
        sheet.projectId,
        sheet.sheetId,
        n.parentId,
        n.sortOrder,
        n.kind,
        n.name,
        n.semanticTag,
        n.visible ? 1 : 0,
        n.locked ? 1 : 0,
        JSON.stringify(n.layout),
        JSON.stringify(styleToSave),
        n.typography ? JSON.stringify(n.typography) : null,
        n.content ? JSON.stringify(n.content) : null,
        n.componentRef ? JSON.stringify(n.componentRef) : null,
        n.controlFlow ? JSON.stringify(n.controlFlow) : null,
        n.stateOverrides ? JSON.stringify(n.stateOverrides) : null,
        n.responsiveOverrides ? JSON.stringify(n.responsiveOverrides) : null,
        n.dataBindings ? JSON.stringify(n.dataBindings) : null,
        n.interactions ? JSON.stringify(n.interactions) : null,
        n.platform ? JSON.stringify(n.platform) : null,
        now,
      );
    }
  }

  private getUndoRedoAvailabilitySync(db: DatabaseSync, sheetId: string): { canUndo: boolean; canRedo: boolean } {
    const undoRow = db
      .prepare('SELECT 1 FROM command_log WHERE sheet_id = ? AND is_undone = 0 LIMIT 1')
      .get(sheetId);
    const redoRow = db
      .prepare('SELECT 1 FROM command_log WHERE sheet_id = ? AND is_undone = 1 LIMIT 1')
      .get(sheetId);
    return { canUndo: Boolean(undoRow), canRedo: Boolean(redoRow) };
  }

  private compressCheckpointSync(
    sheet: UISheetDocument,
    vfsBackups: CompressedCheckpointPayload['vfsBackups'],
  ): Uint8Array {
    const payload: CompressedCheckpointPayload = { sheet, vfsBackups };
    return deflateSync(Buffer.from(JSON.stringify(payload), 'utf8'));
  }

  private seedDemoUnslothPairsSync(
    db: DatabaseSync,
    projectId: string,
    sheetId: string,
    sheet: UISheetDocument,
    tokens: DesignTokenEntry[],
    now: number,
  ): void {
    const insPair = db.prepare(`
      INSERT INTO unsloth_dataset_pairs (
        id, project_id, sheet_id, prompt_summary, normalized_ui_ir_json,
        tokens_snapshot_json, target_framework, accepted_code_output, quality_score, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 5, ?)
    `);

    const compactIrSummary = JSON.stringify({
      sheetName: sheet.name,
      rootIds: sheet.rootIds,
      nodeCount: Object.keys(sheet.nodes).length,
    });
    const tokSnap = JSON.stringify(tokens.slice(0, 10));

    insPair.run(
      `pair_seed_react_${projectId.slice(-4)}`,
      projectId,
      sheetId,
      'Create an Auto-Layout e-commerce analytics dashboard with 3 KPI cards and live search bar in React + Tailwind.',
      compactIrSummary,
      tokSnap,
      'react-tsx',
      `export function HomeDashboardScreen() {\n  return (\n    <main className="flex flex-col gap-6 p-8 bg-slate-50 text-slate-900">\n      <header className="flex items-center justify-between px-5 py-3.5 bg-white border rounded-xl">\n        <h2 className="text-lg font-bold">NovaCommerce Studio</h2>\n      </header>\n    </main>\n  );\n}`,
      now,
    );

    insPair.run(
      `pair_seed_htmx_${projectId.slice(-4)}`,
      projectId,
      sheetId,
      'Generate HTMX 2.x hypermedia live product search wired to #nd_product_results_region.',
      compactIrSummary,
      tokSnap,
      'htmx',
      `<section class="flex flex-col gap-3.5 p-6 bg-white rounded-2xl border">\n  <input type="search" name="q" placeholder="Search SKU..." hx-get="/api/products/search" hx-target="#nd_product_results_region" hx-swap="innerHTML" hx-trigger="keyup changed delay:250ms" />\n  <ul id="nd_product_results_region"></ul>\n</section>`,
      now + 1,
    );
  }
}
