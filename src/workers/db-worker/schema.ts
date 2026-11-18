import type { DatabaseSync } from 'node:sqlite';
import { OFFLINE_ICON_CATALOG } from '../../shared/icon-catalog';

export function configureSqlitePragmas(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA temp_store = MEMORY;
    PRAGMA cache_size = -32000;
  `);
}

export function migrateGlobalDb(db: DatabaseSync): void {
  configureSqlitePragmas(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS recent_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      db_file_path TEXT NOT NULL UNIQUE,
      root_disk_path TEXT,
      primary_target TEXT NOT NULL DEFAULT 'react-tsx',
      styling_preset TEXT NOT NULL DEFAULT 'tailwind',
      layout_mode TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_recent_projects_updated ON recent_projects(updated_at DESC);

    CREATE TABLE IF NOT EXISTS ai_providers (
      id TEXT PRIMARY KEY,
      base_url TEXT NOT NULL,
      api_key TEXT,
      vram_reserve_mb INTEGER NOT NULL DEFAULT 768,
      updated_at INTEGER NOT NULL
    );
  `);

  const recentCols = new Set(
    (db.prepare('PRAGMA table_info(recent_projects)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!recentCols.has('layout_mode')) {
    db.exec('ALTER TABLE recent_projects ADD COLUMN layout_mode TEXT');
  }
  if (!recentCols.has('stack_id')) {
    db.exec('ALTER TABLE recent_projects ADD COLUMN stack_id TEXT');
  }
  if (!recentCols.has('primary_language')) {
    db.exec('ALTER TABLE recent_projects ADD COLUMN primary_language TEXT');
  }

  // Seed default AI provider configs
  const now = Date.now();
  const upsertProvider = db.prepare(`
    INSERT INTO ai_providers (id, base_url, api_key, vram_reserve_mb, updated_at)
    VALUES (?, ?, ?, 768, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  upsertProvider.run('ollama', 'http://127.0.0.1:11434', null, now);
  upsertProvider.run('lmstudio', 'http://127.0.0.1:1234/v1', null, now);
  upsertProvider.run('openai_compat', 'http://127.0.0.1:8080/v1', null, now);

  // Offline SVG Icon Catalog via SQLite FTS5 (with standard table mirror)
  db.exec(`
    CREATE TABLE IF NOT EXISTS icon_catalog (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      tags_text TEXT NOT NULL,
      view_box TEXT NOT NULL,
      svg_body TEXT NOT NULL
    );
  `);

  let hasFts5 = false;
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS icon_catalog_fts5 USING fts5(
        id UNINDEXED,
        name,
        category,
        tags_text,
        view_box UNINDEXED,
        svg_body UNINDEXED
      );
    `);
    hasFts5 = true;
  } catch {
    hasFts5 = false;
  }

  const existingCountRow = db.prepare('SELECT COUNT(*) as cnt FROM icon_catalog').get() as { cnt: number | bigint };
  if (Number(existingCountRow?.cnt ?? 0) < OFFLINE_ICON_CATALOG.length) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('DELETE FROM icon_catalog');
      if (hasFts5) {
        db.exec('DELETE FROM icon_catalog_fts5');
      }
      const insBase = db.prepare(
        'INSERT INTO icon_catalog (id, name, category, tags_text, view_box, svg_body) VALUES (?, ?, ?, ?, ?, ?)',
      );
      const insFts = hasFts5
        ? db.prepare(
            'INSERT INTO icon_catalog_fts5 (id, name, category, tags_text, view_box, svg_body) VALUES (?, ?, ?, ?, ?, ?)',
          )
        : null;

      for (const icon of OFFLINE_ICON_CATALOG) {
        const tagsStr = icon.tags.join(' ');
        insBase.run(icon.id, icon.name, icon.category, tagsStr, icon.viewBox, icon.svgBody);
        insFts?.run(icon.id, icon.name, icon.category, tagsStr, icon.viewBox, icon.svgBody);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

export function migrateProjectDb(db: DatabaseSync): void {
  configureSqlitePragmas(db);

  db.exec(`
    -- 1. PROJECTS & WORKSPACE SHELL STATE
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_disk_path TEXT,
      primary_target TEXT NOT NULL DEFAULT 'react-tsx',
      styling_preset TEXT NOT NULL DEFAULT 'tailwind',
      active_theme_id TEXT,
      breakpoints_json TEXT NOT NULL,
      settings_json TEXT NOT NULL DEFAULT '{}',
      schema_version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_state (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      open_tabs_json TEXT NOT NULL DEFAULT '[]',
      left_top_ratio REAL NOT NULL DEFAULT 0.45,
      left_active_mode TEXT NOT NULL DEFAULT 'insert',
      right_panel_mode TEXT NOT NULL DEFAULT 'split',
      right_panel_width INTEGER NOT NULL DEFAULT 380,
      active_ai_provider_id TEXT NOT NULL DEFAULT 'ollama',
      active_ai_model_id TEXT NOT NULL DEFAULT 'qwen2.5-coder:7b',
      updated_at INTEGER NOT NULL
    );

    -- 2. VIRTUAL & DISK-MAPPED FILE SYSTEM
    CREATE TABLE IF NOT EXISTS vfs_entries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES vfs_entries(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      virtual_path TEXT NOT NULL,
      disk_rel_path TEXT,
      entry_kind TEXT NOT NULL,
      target_framework TEXT,
      sync_mode TEXT NOT NULL DEFAULT 'virtual_only',
      content_text TEXT,
      content_sha256 TEXT,
      last_disk_mtime INTEGER,
      git_status TEXT,
      sort_order TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(project_id, virtual_path)
    );
    CREATE INDEX IF NOT EXISTS idx_vfs_tree ON vfs_entries(project_id, parent_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_vfs_disk_path ON vfs_entries(project_id, disk_rel_path);

    -- 3. SHEETS / ARTBOARDS & REUSABLE MASTER COMPONENTS
    CREATE TABLE IF NOT EXISTS sheets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      vfs_entry_id TEXT UNIQUE REFERENCES vfs_entries(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sheet_kind TEXT NOT NULL DEFAULT 'visual_canvas',
      viewport_x REAL NOT NULL DEFAULT 0,
      viewport_y REAL NOT NULL DEFAULT 0,
      viewport_zoom REAL NOT NULL DEFAULT 1.0,
      state_schema_json TEXT NOT NULL DEFAULT '[]',
      props_schema_json TEXT NOT NULL DEFAULT '[]',
      ipc_schema_json TEXT NOT NULL DEFAULT '[]',
      custom_css TEXT,
      default_layout_mode TEXT,
      preview_png BLOB,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS components (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      master_sheet_id TEXT NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
      root_node_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'custom',
      description TEXT,
      props_schema_json TEXT NOT NULL DEFAULT '[]',
      variants_matrix_json TEXT NOT NULL DEFAULT '{}',
      slots_json TEXT NOT NULL DEFAULT '["children"]',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scene_nodes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      sheet_id TEXT NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES scene_nodes(id) ON DELETE CASCADE,
      sort_order TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      semantic_tag TEXT NOT NULL DEFAULT 'div',
      visible INTEGER NOT NULL DEFAULT 1,
      locked INTEGER NOT NULL DEFAULT 0,
      component_id TEXT REFERENCES components(id) ON DELETE SET NULL,
      layout_json TEXT NOT NULL,
      style_json TEXT NOT NULL,
      typography_json TEXT,
      content_json TEXT,
      component_overrides_json TEXT,
      control_flow_json TEXT,
      state_overrides_json TEXT,
      responsive_overrides_json TEXT,
      data_bindings_json TEXT,
      interactions_json TEXT,
      platform_ext_json TEXT,
      version_seq INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_nodes_sheet_hierarchy ON scene_nodes(sheet_id, parent_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_nodes_component_ref ON scene_nodes(project_id, component_id);

    -- 4. THEMES & DESIGN TOKENS
    CREATE TABLE IF NOT EXISTS themes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS design_tokens (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      theme_id TEXT REFERENCES themes(id) ON DELETE CASCADE,
      token_path TEXT NOT NULL,
      category TEXT NOT NULL,
      raw_value TEXT NOT NULL,
      alias_of_path TEXT,
      UNIQUE(project_id, theme_id, token_path)
    );
    CREATE INDEX IF NOT EXISTS idx_tokens_lookup ON design_tokens(project_id, token_path);

    -- 5. UNDO/REDO COMMAND LOG & PRE-AI ATOMIC CHECKPOINTS
    CREATE TABLE IF NOT EXISTS history_checkpoints (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      sheet_id TEXT REFERENCES sheets(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      label TEXT NOT NULL,
      ai_run_id TEXT,
      command_seq_at INTEGER NOT NULL,
      compressed_snapshot BLOB NOT NULL,
      touched_files_backup_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_checkpoints_sheet ON history_checkpoints(sheet_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_checkpoints_ai_run ON history_checkpoints(ai_run_id);

    CREATE TABLE IF NOT EXISTS command_log (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      sheet_id TEXT NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
      actor TEXT NOT NULL,
      ai_run_id TEXT,
      label TEXT NOT NULL,
      forward_ops_json TEXT NOT NULL,
      inverse_ops_json TEXT NOT NULL,
      is_undone INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cmd_sheet_undo ON command_log(sheet_id, is_undone, seq DESC);

    -- 6. CONTENT-ADDRESSED ASSETS & CODEGEN SYNC MAPPINGS
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      sha256 TEXT NOT NULL,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      blob_data BLOB,
      tags_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      UNIQUE(project_id, sha256)
    );

    CREATE TABLE IF NOT EXISTS codegen_sync_mappings (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      sheet_id TEXT NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL,
      relative_repo_path TEXT NOT NULL,
      last_exported_sha256 TEXT,
      updated_at INTEGER NOT NULL,
      UNIQUE(project_id, sheet_id, target_id, relative_repo_path)
    );

    -- 7. AGENTIC CODING THREADS, MESSAGES, TOOL CALLS & UNSLOTH TRAINING PAIRS
    CREATE TABLE IF NOT EXISTS ai_threads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'surgical',
      provider TEXT NOT NULL,
      model_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content_text TEXT NOT NULL,
      thinking_text TEXT,
      context_refs_json TEXT,
      pre_checkpoint_id TEXT REFERENCES history_checkpoints(id) ON DELETE SET NULL,
      tokens_in INTEGER,
      tokens_out INTEGER,
      latency_ms INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_msg_thread ON ai_messages(thread_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS ai_tool_executions (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      args_json TEXT NOT NULL,
      result_json TEXT,
      status TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS unsloth_dataset_pairs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      sheet_id TEXT,
      vision_asset_id TEXT,
      prompt_summary TEXT NOT NULL,
      normalized_ui_ir_json TEXT NOT NULL,
      tokens_snapshot_json TEXT,
      target_framework TEXT NOT NULL,
      accepted_code_output TEXT NOT NULL,
      quality_score INTEGER NOT NULL DEFAULT 5,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_unsloth_project ON unsloth_dataset_pairs(project_id, created_at DESC);
  `);

  // Idempotent v2.0 + v3.0 schema upgrade for existing .uistudio project files
  const projectCols = new Set(
    (db.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!projectCols.has('stack_id')) {
    db.exec('ALTER TABLE projects ADD COLUMN stack_id TEXT');
  }
  if (!projectCols.has('primary_language')) {
    db.exec('ALTER TABLE projects ADD COLUMN primary_language TEXT');
  }
  if (!projectCols.has('sql_schema_json')) {
    db.exec('ALTER TABLE projects ADD COLUMN sql_schema_json TEXT');
  }

  const sheetCols = new Set(
    (db.prepare('PRAGMA table_info(sheets)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!sheetCols.has('custom_css')) {
    db.exec('ALTER TABLE sheets ADD COLUMN custom_css TEXT');
  }
  if (!sheetCols.has('default_layout_mode')) {
    db.exec('ALTER TABLE sheets ADD COLUMN default_layout_mode TEXT');
  }
  if (!sheetCols.has('reusable_classes_json')) {
    db.exec('ALTER TABLE sheets ADD COLUMN reusable_classes_json TEXT');
  }
  if (!sheetCols.has('keyframes_css')) {
    db.exec('ALTER TABLE sheets ADD COLUMN keyframes_css TEXT');
  }
  if (!sheetCols.has('linked_scripts_json')) {
    db.exec('ALTER TABLE sheets ADD COLUMN linked_scripts_json TEXT');
  }
  if (!sheetCols.has('automations_json')) {
    db.exec('ALTER TABLE sheets ADD COLUMN automations_json TEXT');
  }
  if (!sheetCols.has('code_overrides_json')) {
    db.exec('ALTER TABLE sheets ADD COLUMN code_overrides_json TEXT');
  }

  // 8. MULTI-DIALECT SQL CONNECTIONS & QUERY HISTORY (v3.0)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sql_connections (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      dialect TEXT NOT NULL DEFAULT 'sqlite',
      mode TEXT NOT NULL DEFAULT 'local_sqlite',
      sqlite_file_path TEXT,
      host TEXT,
      port INTEGER,
      database_name TEXT,
      username TEXT,
      ssl INTEGER NOT NULL DEFAULT 0,
      env_var_ref TEXT,
      encrypted_secret_hex TEXT,
      read_only INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sql_connections_project ON sql_connections(project_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS sql_query_history (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      connection_id TEXT,
      dialect TEXT NOT NULL DEFAULT 'sqlite',
      sql_text TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      row_count INTEGER NOT NULL DEFAULT 0,
      ok INTEGER NOT NULL DEFAULT 1,
      error_text TEXT,
      executed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sql_history_project ON sql_query_history(project_id, executed_at DESC);
  `);
}
