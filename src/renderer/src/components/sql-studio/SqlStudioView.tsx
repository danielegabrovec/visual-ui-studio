import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Code2,
  Database,
  GitCompare,
  Network,
  Plus,
  RotateCcw,
  Sparkles,
  TableProperties,
  Zap,
} from 'lucide-react';
import { remapDocumentToDialect } from '@shared/sql-dialects';
import {
  createStarterSqlDocument,
  SQL_DIALECT_CATALOG,
  type SqlDesignDocument,
  type SqlDialect,
} from '@shared/sql-ir';
import { attachBaselinesToDocument } from '@shared/sql-migration';
import { getStudioApi } from '@renderer/api/studio-client';
import { useStudioStore } from '@renderer/state/studio-store';
import { SqlCodegenPanel, type MaterializedSqlFiles } from './SqlCodegenPanel';
import { SqlConnectionModal } from './SqlConnectionModal';
import { SqlDataGridView } from './SqlDataGridView';
import { SqlErCanvas } from './SqlErCanvas';
import { SqlMigrationPanel } from './SqlMigrationPanel';
import { SqlQueryLabView } from './SqlQueryLabView';
import { SqlTableInspector } from './SqlTableInspector';
import { SqlToUiWizardModal } from './SqlToUiWizardModal';

export type SqlStudioSubView = 'er' | 'grid' | 'query' | 'migration' | 'codegen';

export interface SqlStudioViewProps {
  sheetId?: string;
  vfsEntryId?: string;
  initialSubView?: string;
}

export const SqlStudioView: React.FC<SqlStudioViewProps> = ({ initialSubView }) => {
  const project = useStudioStore((s) => s.project);
  const sqlDocument = useStudioStore((s) => s.sqlDocument);
  const activeSqlDialect = useStudioStore((s) => s.activeSqlDialect);
  const sqlConnections = useStudioStore((s) => s.sqlConnections);
  const activeSqlConnectionId = useStudioStore((s) => s.activeSqlConnectionId);

  const loadSqlSchemaAction = useStudioStore((s) => s.loadSqlSchemaAction);
  const saveSqlSchemaAction = useStudioStore((s) => s.saveSqlSchemaAction);
  const setActiveSqlConnectionId = useStudioStore((s) => s.setActiveSqlConnectionId);
  const pushToast = useStudioStore((s) => s.pushToast);
  const saveSourceFileContent = useStudioStore((s) => s.saveSourceFileContent);

  const [subView, setSubView] = useState<SqlStudioSubView>(() => {
    if (
      initialSubView === 'er' ||
      initialSubView === 'grid' ||
      initialSubView === 'query' ||
      initialSubView === 'migration' ||
      initialSubView === 'codegen'
    ) {
      return initialSubView;
    }
    return 'er';
  });

  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [codegenDrafts, setCodegenDrafts] = useState<Record<string, string>>({});
  const materializedSqlFiles = useRef<MaterializedSqlFiles>(new Map());
  const savedExports = useRef(new Map<string, { id: string; name: string; content: string }>());
  const pendingExports = useRef(new Set<string>());
  const [migrationDrafts, setMigrationDrafts] = useState<Record<string, string>>({});
  const [isConnectionModalOpen, setConnectionModalOpen] = useState(false);
  const [isUiWizardOpen, setUiWizardOpen] = useState(false);

  useEffect(() => {
    if (project && !sqlDocument) {
      void loadSqlSchemaAction(project.id);
    }
  }, [project, sqlDocument, loadSqlSchemaAction]);

  const effectiveDoc: SqlDesignDocument = useMemo(() => {
    if (sqlDocument) return sqlDocument;
    return attachBaselinesToDocument(
      createStarterSqlDocument(project?.id ?? 'proj_local', project?.name ?? 'Studio DB', activeSqlDialect),
    );
  }, [sqlDocument, project?.id, project?.name, activeSqlDialect]);

  const selectedTable = useMemo(() => {
    if (selectedTableId) {
      const found = effectiveDoc.tables.find((t) => t.id === selectedTableId);
      if (found) return found;
    }
    return effectiveDoc.tables[0] ?? null;
  }, [effectiveDoc.tables, selectedTableId]);

  const queryDialect = activeSqlConnectionId === '__local_sqlite__'
    ? 'sqlite'
    : sqlConnections.find((connection) => connection.id === activeSqlConnectionId)?.dialect ?? activeSqlDialect;

  const handleDialectSwitch = async (nextDialect: SqlDialect) => {
    try {
      const remapped = remapDocumentToDialect(effectiveDoc, nextDialect);
      await saveSqlSchemaAction(remapped, true);
      pushToast('info', `Dialetto SQL impostato su ${nextDialect.toUpperCase()}.`);
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error));
    }
  };

  const handleUpdateDocument = (nextDoc: SqlDesignDocument, silent = true) => {
    void saveSqlSchemaAction(nextDoc, silent).catch((error: unknown) => {
      pushToast('error', error instanceof Error ? error.message : String(error));
    });
  };

  const handleResetSandbox = async () => {
    if (!project) return;
    const res = await getStudioApi().sql.resetSandbox(project.id, effectiveDoc);
    pushToast(res.ok ? 'success' : 'warn', res.message);
  };

  const saveSqlExport = async (name: string, content: string) => {
    if (!project) return;
    const key = JSON.stringify([project.id, name]);
    if (pendingExports.current.has(key)) return;
    pendingExports.current.add(key);
    try {
      const existing = savedExports.current.get(key);
      if (existing) {
        await saveSourceFileContent(existing.id, content, true, existing.content);
        savedExports.current.set(key, { ...existing, content });
        pushToast('success', `File "${existing.name}" salvato.`);
        return;
      }
      const { vfs } = getStudioApi();
      const { entry } = await vfs.createEntry({
        projectId: project.id,
        parentId: null,
        name,
        entryKind: 'sql_file',
        initialContent: content,
      });
      savedExports.current.set(key, { id: entry.id, name: entry.name, content });
      const vfsTree = await vfs.listTree(project.id);
      useStudioStore.setState((state) => state.project?.id === project.id
        ? { vfsTree, sourceFiles: { ...state.sourceFiles, [entry.id]: content } }
        : {});
      pushToast('success', `File "${entry.name}" salvato.`);
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      pendingExports.current.delete(key);
    }
  };

  return (
    <div
      data-testid="sql-studio-view"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        background: 'var(--bg-app)',
      }}
    >
      {/* Top Connection, 5-Dialect & Bridge Header Bar */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
          padding: '8px 12px',
          background: 'var(--bg-header)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13 }}>
            <Database size={15} style={{ color: 'var(--accent-primary)' }} />
            <span>SQL &amp; Data Studio</span>
          </div>

          {/* 5-Dialect Selector */}
          <select
            aria-label="Dialetto SQL"
            data-testid="sql-dialect-select"
            value={activeSqlDialect}
            onChange={(e) => void handleDialectSwitch(e.target.value as SqlDialect)}
            style={headerSelectStyle}
          >
            {SQL_DIALECT_CATALOG.map((d) => (
              <option key={d.id} value={d.id}>
                Dialetto: {d.shortLabel} ({d.quoteExample})
              </option>
            ))}
          </select>

          {/* Execution Target / Connection Selector */}
          <select
            aria-label="Connessione Database"
            data-testid="sql-connection-select"
            value={activeSqlConnectionId ?? '__memory_sandbox__'}
            onChange={(e) => {
              const val = e.target.value;
              setActiveSqlConnectionId(val === '__memory_sandbox__' ? null : val);
            }}
            style={headerSelectStyle}
          >
            <option value="__memory_sandbox__">⚡ Query Rapide (:memory: Sandbox)</option>
            <option value="__local_sqlite__">
              🗄️ SQLite Locale ({effectiveDoc.databaseFileRelPath || 'data/app.sqlite'})
            </option>
            {sqlConnections.map((conn) => (
              <option key={conn.id} value={conn.id}>
                🔌 {conn.name} ({conn.dialect})
              </option>
            ))}
          </select>

          {(!activeSqlConnectionId || activeSqlConnectionId === '__memory_sandbox__') && (
            <button
              type="button"
              title="Ripristina Sandbox :memory: allo stato iniziale"
              data-testid="btn-sql-reset-sandbox"
              onClick={() => void handleResetSandbox()}
              style={headerBtnStyle}
            >
              <RotateCcw size={12} /> Ripristina :memory:
            </button>
          )}

          <button
            type="button"
            data-testid="btn-sql-new-connection"
            onClick={() => setConnectionModalOpen(true)}
            style={headerBtnStyle}
          >
            <Plus size={12} /> Connessione DB
          </button>
        </div>

        {/* Right Primary Bridge CTA: Tabella SQL -> Genera Form + Tabella UI sul Canvas */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            data-testid="btn-sql-generate-ui"
            onClick={() => setUiWizardOpen(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 7,
              border: '1px solid var(--accent-violet)',
              background: 'var(--accent-violet)',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            <Sparkles size={13} /> Genera Form + Tabella UI sul Canvas
          </button>
        </div>
      </header>

      {/* 5 Sub-View Navigation Strip */}
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '5px 12px',
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border-subtle)',
          overflowX: 'auto',
        }}
      >
        <button
          type="button"
          data-testid="sql-tab-er"
          onClick={() => setSubView('er')}
          style={navTabStyle(subView === 'er')}
        >
          <Network size={13} /> Designer ER &amp; Tabelle ({effectiveDoc.tables.length})
        </button>

        <button
          type="button"
          data-testid="sql-tab-grid"
          onClick={() => setSubView('grid')}
          style={navTabStyle(subView === 'grid')}
        >
          <TableProperties size={13} /> Foglio Dati (Stile Excel)
        </button>

        <button
          type="button"
          data-testid="sql-tab-query"
          onClick={() => setSubView('query')}
          style={navTabStyle(subView === 'query')}
        >
          <Zap size={13} /> Query Rapide &amp; SQL Lab ({effectiveDoc.namedQueries.length})
        </button>

        <button
          type="button"
          data-testid="sql-tab-migration"
          onClick={() => setSubView('migration')}
          style={navTabStyle(subView === 'migration')}
        >
          <GitCompare size={13} /> Migrazioni &amp; Diff DDL
        </button>

        <button
          type="button"
          data-testid="sql-tab-codegen"
          onClick={() => setSubView('codegen')}
          style={navTabStyle(subView === 'codegen')}
        >
          <Code2 size={13} /> Codice DB (JS / TS / Python / Rust-Tauri)
        </button>
      </nav>

      {/* Active Sub-View Workspace */}
      <div style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }}>
        {subView === 'er' && (
          <>
            <SqlErCanvas
              document={effectiveDoc}
              dialect={activeSqlDialect}
              selectedTableId={selectedTable?.id ?? null}
              onSelectTable={setSelectedTableId}
              onUpdateDocument={handleUpdateDocument}
            />
            {selectedTable && (
              <SqlTableInspector
                table={selectedTable}
                allTables={effectiveDoc.tables}
                dialect={activeSqlDialect}
                onChangeTable={(updated) => {
                  handleUpdateDocument({
                    ...effectiveDoc,
                    tables: effectiveDoc.tables.map((t) => (t.id === updated.id ? updated : t)),
                    updatedAt: Date.now(),
                  });
                }}
                onOpenUiWizard={() => setUiWizardOpen(true)}
                onSaveScript={saveSqlExport}
              />
            )}
          </>
        )}

        {subView === 'grid' && (
          <SqlDataGridView
            sqlDocument={effectiveDoc}
            dialect={queryDialect}
            connectionId={activeSqlConnectionId}
            selectedTableId={selectedTable?.id ?? null}
            onSelectTable={setSelectedTableId}
            onReloadSchema={() => void loadSqlSchemaAction(project?.id)}
            onSaveScript={saveSqlExport}
          />
        )}

        {subView === 'query' && (
          <SqlQueryLabView
            sqlDocument={effectiveDoc}
            dialect={queryDialect}
            connectionId={activeSqlConnectionId}
            onUpdateDocument={(next) => handleUpdateDocument(next, false)}
          />
        )}

        {subView === 'migration' && (
          <SqlMigrationPanel
            sqlDocument={effectiveDoc}
            dialect={activeSqlDialect}
            connectionId={activeSqlConnectionId}
            drafts={migrationDrafts}
            setDrafts={setMigrationDrafts}
            onSaveScript={saveSqlExport}
          />
        )}

        {subView === 'codegen' && (
          <SqlCodegenPanel sqlDocument={effectiveDoc} dialect={activeSqlDialect} drafts={codegenDrafts} setDrafts={setCodegenDrafts}
            materializedFiles={materializedSqlFiles.current} />
        )}
      </div>

      {/* Modals */}
      {isConnectionModalOpen && project && (
        <SqlConnectionModal
          projectId={project.id}
          connections={sqlConnections}
          onClose={() => setConnectionModalOpen(false)}
          onConnectionsUpdated={(list, activeId) => {
            useStudioStore.setState({
              sqlConnections: list,
              activeSqlConnectionId: activeId !== undefined ? activeId : activeSqlConnectionId,
            });
          }}
          onIntrospectedSchema={() => {
            void loadSqlSchemaAction(project.id);
            setConnectionModalOpen(false);
          }}
        />
      )}

      {isUiWizardOpen && (
        <SqlToUiWizardModal
          sqlDocument={effectiveDoc}
          initialTableId={selectedTable?.id ?? null}
          onClose={() => setUiWizardOpen(false)}
        />
      )}
    </div>
  );
};

const headerSelectStyle: React.CSSProperties = {
  padding: '5px 9px',
  borderRadius: 6,
  border: '1px solid var(--border-strong)',
  background: 'var(--bg-input)',
  color: 'var(--text-primary)',
  fontSize: 12,
};

const headerBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '5px 10px',
  borderRadius: 6,
  border: '1px solid var(--border-strong)',
  background: 'var(--bg-panel-elevated)',
  fontSize: 11.5,
  fontWeight: 600,
  cursor: 'pointer',
};

function navTabStyle(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    borderRadius: 6,
    border: active ? '1px solid var(--accent-primary)' : '1px solid transparent',
    background: active ? 'var(--accent-soft)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
    fontWeight: active ? 700 : 500,
    fontSize: 12,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  };
}
