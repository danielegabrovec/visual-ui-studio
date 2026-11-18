import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Copy,
  FilePlus2,
  GitCompare,
  Play,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import { compileSchemaDdl } from '@shared/sql-dialects';
import { SQL_DIALECT_CATALOG, type SqlDesignDocument, type SqlDialect, type SqlMigrationPlan } from '@shared/sql-ir';
import { getStudioApi } from '@renderer/api/studio-client';
import { useStudioStore } from '@renderer/state/studio-store';
import { SqlScriptEditor } from './SqlScriptEditor';

export interface SqlMigrationPanelProps {
  sqlDocument: SqlDesignDocument;
  dialect: SqlDialect;
  connectionId: string | null;
  drafts: Record<string, string>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onSaveScript: (name: string, content: string) => Promise<void>;
}

export const SqlMigrationPanel: React.FC<SqlMigrationPanelProps> = ({
  sqlDocument,
  dialect,
  connectionId,
  drafts,
  setDrafts,
  onSaveScript,
}) => {
  const project = useStudioStore((s) => s.project);
  const loadSqlSchemaAction = useStudioStore((s) => s.loadSqlSchemaAction);
  const pushToast = useStudioStore((s) => s.pushToast);
  const appendConsoleEntry = useStudioStore((s) => s.appendConsoleEntry);

  const [exportDialect, setExportDialect] = useState<SqlDialect>(dialect);
  const [includeSeeds, setIncludeSeeds] = useState(true);
  const [allowDestructive, setAllowDestructive] = useState(false);
  const [applying, setApplying] = useState(false);
  const [planRevision, setPlanRevision] = useState(0);
  const [resolvedPlan, setResolvedPlan] = useState<{
    document: SqlDesignDocument;
    connectionId: string | null;
    plan?: SqlMigrationPlan;
    error?: string;
  }>();

  const isSandbox = !connectionId || connectionId === '__memory_sandbox__';
  const projectId = project?.id;

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    setAllowDestructive(false);
    void getStudioApi().sql.compileMigration({ projectId, schemaDoc: sqlDocument, connectionId }).then(
      (plan) => {
        if (active) setResolvedPlan({ document: sqlDocument, connectionId, plan });
      },
      (error: unknown) => {
        if (active) setResolvedPlan({ document: sqlDocument, connectionId, error: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => { active = false; };
  }, [projectId, sqlDocument, connectionId, planRevision]);

  const currentPlan = resolvedPlan?.document === sqlDocument && resolvedPlan.connectionId === connectionId
    ? resolvedPlan
    : undefined;
  const migrationPlan = currentPlan?.plan;
  const canApply = Boolean(migrationPlan?.changes.length && !migrationPlan.blockers.length &&
    (!migrationPlan.hasDestructiveChanges || allowDestructive) && !applying);

  const fullExportDdl = useMemo(() => {
    try {
      return compileSchemaDdl(sqlDocument, {
        dialect: exportDialect,
        ifNotExists: true,
        includeSeeds,
      });
    } catch (err) {
      return `-- Errore generazione DDL (${exportDialect}): ${err instanceof Error ? err.message : String(err)}`;
    }
  }, [sqlDocument, exportDialect, includeSeeds]);
  const exportKey = JSON.stringify([sqlDocument.projectId, 'ddl', exportDialect, includeSeeds]);
  const ddlScript = drafts[exportKey] ?? fullExportDdl;
  const migrationKey = JSON.stringify([sqlDocument.projectId, 'migration', connectionId, migrationPlan?.fullSql]);
  const migrationScript = drafts[migrationKey] ?? migrationPlan?.fullSql ?? '';

  const changeDraft = (key: string, code: string, generated: string) => {
    setDrafts((current) => {
      if (code !== generated) return { ...current, [key]: code };
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const copyScript = async (script: string) => {
    try {
      await navigator.clipboard.writeText(script);
      pushToast('success', 'Script SQL copiato.');
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error));
    }
  };

  const handleApplyMigration = async () => {
    if (!project || !migrationPlan || !canApply) return;
    setApplying(true);
    try {
      const res = await getStudioApi().sql.applyMigration({
        projectId: project.id,
        plan: migrationPlan,
        connectionId: isSandbox ? null : connectionId,
        sandboxMode: isSandbox,
        allowDestructive,
      });
      if (!res.ok) {
        pushToast('error', res.error ?? 'Errore durante l\'applicazione della migrazione.');
        return;
      }
      await loadSqlSchemaAction(project.id);
      appendConsoleEntry({
        kind: 'sql',
        source: `Migrazione (${migrationPlan.dialect})`,
        message: `✓ Migrazione applicata (${res.executedStatements} statement SQL eseguiti)`,
      });
      pushToast('success', `Migrazione applicata con successo (${res.executedStatements} statement)!`);
      setAllowDestructive(false);
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div
      data-testid="sql-migration-panel"
      style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '1.15fr 1fr',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* Left Pane: Safe Schema Diff & Transactional Migration Plan */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--border-subtle)',
          minHeight: 0,
        }}
      >
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--bg-panel)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <GitCompare size={15} style={{ color: 'var(--accent-primary)' }} />
            <div>
              <strong style={{ fontSize: 12.5 }}>
                Diff Baseline vs Schema Progettato{migrationPlan ? ` (${migrationPlan.dialect.toUpperCase()})` : ''}
              </strong>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {migrationPlan ? `${migrationPlan.changes.length} operazioni pianificate` : 'Verifica dello schema del database'}
                {Boolean(migrationPlan?.rebuildSqliteTables.length) && migrationPlan
                  ? ` · Ricostruzione sicura SQLite su: ${migrationPlan.rebuildSqliteTables.join(', ')}`
                  : ''}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              type="button"
              aria-label="Ricalcola piano di migrazione"
              title="Ricalcola piano di migrazione"
              disabled={applying}
              data-testid="btn-sql-refresh-migration"
              style={smallBtnStyle}
              onClick={() => {
                setResolvedPlan(undefined);
                setAllowDestructive(false);
                setPlanRevision((revision) => revision + 1);
              }}
            >
              <RotateCcw size={12} /> Ricalcola
            </button>
            <button
              type="button"
              disabled={!canApply}
              data-testid="btn-sql-apply-migration"
              onClick={() => void handleApplyMigration()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 6,
                border: 'none',
                background: canApply ? 'var(--accent-emerald)' : 'var(--bg-panel-elevated)',
                color: canApply ? '#fff' : 'var(--text-muted)',
                fontWeight: 700,
                cursor: canApply ? 'pointer' : 'not-allowed',
              }}
            >
              <Play size={13} /> Applica piano al DB
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {currentPlan?.error && <div role="alert">{currentPlan.error}</div>}
          {!currentPlan && <div role="status">Caricamento piano di migrazione…</div>}
          {/* Blockers */}
          {migrationPlan?.blockers.map((b, i) => (
            <div
              key={i}
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                background: 'var(--accent-danger-soft)',
                color: 'var(--accent-danger)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
              }}
            >
              <AlertOctagon size={15} style={{ flexShrink: 0 }} />
              <span>{b}</span>
            </div>
          ))}

          {/* Warnings */}
          {migrationPlan?.warnings.map((w, i) => (
            <div
              key={i}
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                background: 'var(--accent-amber-soft)',
                color: 'var(--accent-amber)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 11.5,
              }}
            >
              <AlertTriangle size={14} style={{ flexShrink: 0 }} />
              <span>{w}</span>
            </div>
          ))}

          {/* Destructive Confirmation Gate */}
          {migrationPlan?.hasDestructiveChanges && (
            <label
              style={{
                padding: '9px 12px',
                borderRadius: 8,
                background: 'var(--accent-danger-soft)',
                border: '1px solid var(--accent-danger)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                data-testid="chk-sql-allow-destructive"
                checked={allowDestructive}
                onChange={(e) => setAllowDestructive(e.target.checked)}
              />
              <ShieldAlert size={15} style={{ color: 'var(--accent-danger)', flexShrink: 0 }} />
              <span>
                Confermo le modifiche distruttive o le ricostruzioni di tabella evidenziate in rosso.
              </span>
            </label>
          )}

          {/* Planned Changes List */}
          {migrationPlan?.changes.length === 0 && migrationPlan.blockers.length === 0 ? (
            <div
              style={{
                padding: 16,
                borderRadius: 10,
                background: 'var(--bg-panel-elevated)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: 'var(--accent-emerald)',
              }}
            >
              <CheckCircle2 size={16} />
              <span>
                Le tabelle del progetto sono allineate al database.
              </span>
            </div>
          ) : (
            migrationPlan?.changes.map((chg) => (
              <div
                key={chg.id}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: 'var(--bg-panel-elevated)',
                  border: `1px solid ${chg.destructive ? 'var(--accent-danger)' : 'var(--border-subtle)'}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: 12 }}>{chg.label}</strong>
                  <span
                    style={{
                      fontSize: 10,
                      padding: '2px 6px',
                      borderRadius: 999,
                      background: chg.destructive
                        ? 'var(--accent-danger-soft)'
                        : 'var(--accent-emerald-soft)',
                      color: chg.destructive ? 'var(--accent-danger)' : 'var(--accent-emerald)',
                      fontWeight: 700,
                    }}
                  >
                    {chg.destructive ? 'DISTRUTTIVA / REBUILD' : 'SICURA'}
                  </span>
                </div>
              </div>
            ))
          )}

          {/* Full Transactional Migration Script */}
          {migrationPlan && <div style={{ marginTop: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <strong style={{ fontSize: 11.5 }}>Script di migrazione da esportare ({migrationPlan.dialect})</strong>
              <div style={{ display: 'flex', gap: 6 }}>
                {migrationScript !== migrationPlan.fullSql && (
                  <button type="button" aria-label="Ripristina script di migrazione generato" title="Ripristina script di migrazione generato" onClick={() => changeDraft(migrationKey, migrationPlan.fullSql, migrationPlan.fullSql)} style={smallBtnStyle}>
                    <RotateCcw size={12} />
                  </button>
                )}
                <button type="button" onClick={() => void copyScript(migrationScript)} style={smallBtnStyle}>
                  <Copy size={12} /> Copia
                </button>
                <button
                  type="button"
                  data-testid="btn-sql-save-migration-sql"
                  onClick={() => void onSaveScript(`migration_${migrationPlan.dialect}.sql`, migrationScript)}
                  style={smallBtnStyle}
                >
                  <FilePlus2 size={12} /> Salva .sql
                </button>
              </div>
            </div>
            <SqlScriptEditor label="Script di migrazione da esportare" testId="sql-migration-full-sql" value={migrationScript}
              rows={12} onChange={(value) => changeDraft(migrationKey, value, migrationPlan.fullSql)}
              onSave={() => void onSaveScript(`migration_${migrationPlan.dialect}.sql`, migrationScript)} />
          </div>}
        </div>
      </div>

      {/* Right Pane: 5-Dialect Complete DDL Exporter */}
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg-panel)' }}>
        <div
          style={{
            padding: '10px 14px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <strong style={{ fontSize: 12.5 }}>Esporta DDL Completo (5 Dialetti SQL):</strong>
            <select
              data-testid="sql-export-ddl-dialect"
              value={exportDialect}
              onChange={(e) => setExportDialect(e.target.value as SqlDialect)}
              style={{
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid var(--border-strong)',
                background: 'var(--bg-input)',
                fontSize: 12,
              }}
            >
              {SQL_DIALECT_CATALOG.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.shortLabel} ({d.quoteExample})
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeSeeds}
                onChange={(e) => setIncludeSeeds(e.target.checked)}
              />
              Includi INSERT Seed
            </label>

            {ddlScript !== fullExportDdl && (
              <button type="button" aria-label="Ripristina DDL generato" title="Ripristina DDL generato" onClick={() => changeDraft(exportKey, fullExportDdl, fullExportDdl)} style={smallBtnStyle}>
                <RotateCcw size={12} />
              </button>
            )}
            <button type="button" onClick={() => void copyScript(ddlScript)} style={smallBtnStyle}>
              <Copy size={12} /> Copia
            </button>

            <button
              type="button"
              data-testid="btn-sql-save-schema-sql"
              onClick={() => void onSaveScript(`schema_${exportDialect}.sql`, ddlScript)}
              style={smallBtnStyle}
            >
              <FilePlus2 size={12} /> Salva schema.sql
            </button>
          </div>
        </div>

        <SqlScriptEditor label="DDL da esportare" testId="sql-export-ddl-preview" value={ddlScript}
          onChange={(value) => changeDraft(exportKey, value, fullExportDdl)}
          onSave={() => void onSaveScript(`schema_${exportDialect}.sql`, ddlScript)}
          style={{ flex: 1, padding: 14, border: 0, borderRadius: 0, resize: 'none' }} />
      </div>
    </div>
  );
};

const smallBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '4px 9px',
  borderRadius: 6,
  border: '1px solid var(--border-strong)',
  background: 'var(--bg-panel-elevated)',
  fontSize: 11.5,
  cursor: 'pointer',
};
