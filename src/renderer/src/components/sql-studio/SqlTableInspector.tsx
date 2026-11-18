import React, { useMemo, useState } from 'react';
import { Code2, Copy, FilePlus2, KeyRound, Link2, ListTree, Plus, Sparkles, Trash2 } from 'lucide-react';
import {
  compileTableDdl,
  DIALECT_TYPE_CHOICES,
  inferCanonicalType,
  mapCanonicalToNativeType,
} from '@shared/sql-dialects';
import type {
  SqlCanonicalType,
  SqlColumnDef,
  SqlDialect,
  SqlForeignKeyDef,
  SqlIndexDef,
  SqlReferentialAction,
  SqlTableDef,
} from '@shared/sql-ir';
import { useStudioStore } from '@renderer/state/studio-store';
import { SqlScriptEditor } from './SqlScriptEditor';

export interface SqlTableInspectorProps {
  table: SqlTableDef;
  allTables: SqlTableDef[];
  dialect: SqlDialect;
  onChangeTable: (updated: SqlTableDef) => void;
  onOpenUiWizard: () => void;
  onSaveScript: (name: string, content: string) => Promise<void>;
}

const CANONICAL_TYPES: SqlCanonicalType[] = [
  'integer',
  'bigint',
  'varchar',
  'text',
  'decimal',
  'float',
  'boolean',
  'uuid',
  'date',
  'datetime',
  'json',
  'blob',
];

const FK_ACTIONS: SqlReferentialAction[] = [
  'NO ACTION',
  'CASCADE',
  'SET NULL',
  'RESTRICT',
  'SET DEFAULT',
];

export const SqlTableInspector: React.FC<SqlTableInspectorProps> = ({
  table,
  allTables,
  dialect,
  onChangeTable,
  onOpenUiWizard,
  onSaveScript,
}) => {
  const [subTab, setSubTab] = useState<'columns' | 'relations' | 'ddl'>('columns');
  const [ddlDrafts, setDdlDrafts] = useState<Record<string, string>>({});
  const pushToast = useStudioStore((state) => state.pushToast);

  const updateColumn = (colId: string, patch: Partial<SqlColumnDef>) => {
    const nextCols = table.columns.map((c) => {
      if (c.id !== colId) return c;
      const merged = { ...c, ...patch };
      if (merged.primaryKey) merged.nullable = false;
      return merged;
    });
    onChangeTable({ ...table, columns: nextCols });
  };

  const handleAddColumn = () => {
    const idx = table.columns.length + 1;
    const nativeType = mapCanonicalToNativeType('varchar', dialect, { length: 120 });
    const newCol: SqlColumnDef = {
      id: `col_${Date.now().toString(36)}_${idx}`,
      name: `campo_${idx}`,
      canonicalType: 'varchar',
      nativeType,
      length: 120,
      nullable: true,
      primaryKey: false,
      unique: false,
      autoIncrement: false,
    };
    onChangeTable({ ...table, columns: [...table.columns, newCol] });
  };

  const handleRemoveColumn = (colId: string) => {
    if (table.columns.length <= 1) return;
    onChangeTable({
      ...table,
      columns: table.columns.filter((c) => c.id !== colId),
    });
  };

  const handleAddForeignKey = () => {
    const otherTable = allTables.find((t) => t.id !== table.id) ?? allTables[0];
    const srcCol =
      table.columns.find((c) => !c.primaryKey)?.name ?? table.columns[0]?.name ?? 'id';
    const dstCol =
      otherTable?.columns.find((c) => c.primaryKey)?.name ?? otherTable?.columns[0]?.name ?? 'id';
    const newFk: SqlForeignKeyDef = {
      id: `fk_${Date.now().toString(36)}`,
      name: `fk_${table.name}_${srcCol}`,
      columns: [srcCol],
      referencedSchema: otherTable?.schema,
      referencedTable: otherTable?.name ?? '',
      referencedColumns: [dstCol],
      onDelete: 'CASCADE',
      onUpdate: 'NO ACTION',
    };
    onChangeTable({ ...table, foreignKeys: [...table.foreignKeys, newFk] });
  };

  const handleAddIndex = () => {
    const targetCol = table.columns.find((c) => !c.primaryKey)?.name ?? table.columns[0]?.name ?? 'id';
    const newIdx: SqlIndexDef = {
      id: `idx_${Date.now().toString(36)}`,
      name: `idx_${table.name}_${targetCol}_${table.indexes.length + 1}`,
      columns: [targetCol],
      unique: false,
    };
    onChangeTable({ ...table, indexes: [...table.indexes, newIdx] });
  };

  const liveDdlResult = useMemo(() => {
    try {
      return { ok: true, sql: compileTableDdl(dialect, table) };
    } catch (err) {
      return { ok: false, sql: `-- Avviso validazione: ${err instanceof Error ? err.message : String(err)}` };
    }
  }, [dialect, table]);
  const ddlDraftKey = JSON.stringify([table.id, dialect]);
  const ddlText = ddlDrafts[ddlDraftKey] ?? liveDdlResult.sql;
  const saveTableDdl = () => onSaveScript(`schema_${table.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${dialect}.sql`, ddlText);
  const copyTableDdl = async () => {
    try {
      await navigator.clipboard.writeText(ddlText);
      pushToast('success', 'DDL della tabella copiato.');
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error));
    }
  };

  const supportsSchema = dialect === 'postgresql' || dialect === 'sqlserver';

  return (
    <aside
      data-testid="sql-table-inspector"
      style={{
        width: 410,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid var(--border-subtle)',
        background: 'var(--bg-panel)',
        minHeight: 0,
      }}
    >
      {/* Inspector Header */}
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 12.5 }}>
            Ispettore Tabella: <code style={{ color: 'var(--accent-primary)' }}>{table.name}</code>
          </span>
          <button
            type="button"
            data-testid="btn-sql-inspector-generate-ui"
            onClick={onOpenUiWizard}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              borderRadius: 6,
              border: '1px solid var(--accent-violet)',
              background: 'var(--accent-violet-soft)',
              color: 'var(--text-primary)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Sparkles size={11} /> Genera UI
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: supportsSchema ? '110px 1fr' : '1fr', gap: 6 }}>
          {supportsSchema && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11 }}>
              <span style={{ color: 'var(--text-muted)' }}>Schema</span>
              <input
                data-testid="sql-inspector-table-schema"
                value={table.schema ?? (dialect === 'sqlserver' ? 'dbo' : 'public')}
                onChange={(e) => onChangeTable({ ...table, schema: e.target.value })}
                style={inpStyle}
              />
            </label>
          )}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11 }}>
            <span style={{ color: 'var(--text-muted)' }}>Nome Tabella</span>
            <input
              data-testid="sql-inspector-table-name"
              value={table.name}
              onChange={(e) => onChangeTable({ ...table, name: e.target.value })}
              style={inpStyle}
            />
          </label>
        </div>

        {/* Inspector Sub-tabs */}
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            onClick={() => setSubTab('columns')}
            style={subTabBtnStyle(subTab === 'columns')}
          >
            <KeyRound size={11} /> Colonne ({table.columns.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('relations')}
            style={subTabBtnStyle(subTab === 'relations')}
          >
            <Link2 size={11} /> FK & Indici ({table.foreignKeys.length + table.indexes.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('ddl')}
            style={subTabBtnStyle(subTab === 'ddl')}
          >
            <Code2 size={11} /> DDL ({dialect})
          </button>
        </div>
      </div>

      {/* Scrollable Inspector Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {subTab === 'columns' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                Campi, tipi nativi ({dialect}), PK / Identity e vincoli CHECK
              </span>
              <button
                type="button"
                data-testid="btn-sql-add-column"
                onClick={handleAddColumn}
                style={smallActionBtnStyle}
              >
                <Plus size={12} /> Colonna
              </button>
            </div>

            <datalist id={`sql-native-types-${dialect}`}>
              {DIALECT_TYPE_CHOICES[dialect].map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>

            {table.columns.map((col, idx) => (
              <div
                key={col.id}
                data-testid={`sql-col-editor-${idx}`}
                style={{
                  padding: 8,
                  borderRadius: 8,
                  background: 'var(--bg-panel-elevated)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 94px 112px 22px', gap: 5, alignItems: 'center' }}>
                  <input
                    aria-label="Nome colonna"
                    value={col.name}
                    onChange={(e) => updateColumn(col.id, { name: e.target.value })}
                    placeholder="nome_colonna"
                    style={inpStyle}
                  />
                  <select
                    aria-label="Tipo canonico"
                    value={col.canonicalType}
                    onChange={(e) => {
                      const nextCanonical = e.target.value as SqlCanonicalType;
                      updateColumn(col.id, {
                        canonicalType: nextCanonical,
                        nativeType: mapCanonicalToNativeType(nextCanonical, dialect, {
                          length: col.length,
                          precision: col.precision,
                          scale: col.scale,
                          autoIncrement: col.autoIncrement,
                        }),
                      });
                    }}
                    style={inpStyle}
                  >
                    {CANONICAL_TYPES.map((ct) => (
                      <option key={ct} value={ct}>
                        {ct}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Tipo nativo dialetto"
                    list={`sql-native-types-${dialect}`}
                    value={col.nativeType}
                    onChange={(e) =>
                      updateColumn(col.id, {
                        nativeType: e.target.value,
                        canonicalType: inferCanonicalType(e.target.value),
                      })
                    }
                    style={{
                      ...inpStyle,
                      fontFamily: "'JetBrains Mono', Consolas, monospace",
                      fontSize: 11,
                    }}
                  />
                  <button
                    type="button"
                    title="Rimuovi colonna"
                    disabled={table.columns.length <= 1}
                    onClick={() => handleRemoveColumn(col.id)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text-muted)',
                      cursor: table.columns.length <= 1 ? 'not-allowed' : 'pointer',
                      padding: 2,
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                {/* Flags row */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 11 }}>
                  <label style={chkLabelStyle}>
                    <input
                      type="checkbox"
                      checked={col.primaryKey}
                      onChange={(e) =>
                        updateColumn(col.id, {
                          primaryKey: e.target.checked,
                          nullable: e.target.checked ? false : col.nullable,
                          autoIncrement: e.target.checked ? col.autoIncrement : false,
                        })
                      }
                    />
                    PK
                  </label>
                  <label style={chkLabelStyle}>
                    <input
                      type="checkbox"
                      checked={col.autoIncrement}
                      disabled={!col.primaryKey || (col.canonicalType !== 'integer' && col.canonicalType !== 'bigint')}
                      onChange={(e) => updateColumn(col.id, { autoIncrement: e.target.checked })}
                    />
                    AutoInc / Identity
                  </label>
                  <label style={chkLabelStyle}>
                    <input
                      type="checkbox"
                      checked={!col.nullable}
                      disabled={col.primaryKey}
                      onChange={(e) => updateColumn(col.id, { nullable: !e.target.checked })}
                    />
                    NOT NULL
                  </label>
                  <label style={chkLabelStyle}>
                    <input
                      type="checkbox"
                      checked={col.unique}
                      onChange={(e) => updateColumn(col.id, { unique: e.target.checked })}
                    />
                    UNIQUE
                  </label>
                </div>

                {/* Default & Check */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                  <input
                    value={col.defaultValue ?? ''}
                    onChange={(e) =>
                      updateColumn(col.id, { defaultValue: e.target.value || undefined })
                    }
                    placeholder="DEFAULT (es. 0, 'attivo')"
                    style={{ ...inpStyle, fontSize: 11 }}
                  />
                  <input
                    value={col.checkExpr ?? ''}
                    onChange={(e) =>
                      updateColumn(col.id, { checkExpr: e.target.value || undefined })
                    }
                    placeholder="CHECK (es. price >= 0)"
                    style={{ ...inpStyle, fontSize: 11 }}
                  />
                </div>
              </div>
            ))}
          </>
        )}

        {subTab === 'relations' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: 11.5 }}>Chiavi Esterne (FOREIGN KEY)</strong>
              <button
                type="button"
                data-testid="btn-sql-add-fk"
                onClick={handleAddForeignKey}
                style={smallActionBtnStyle}
              >
                <Plus size={12} /> Relazione FK
              </button>
            </div>

            {table.foreignKeys.length === 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', padding: '6px 0' }}>
                Nessuna chiave esterna definita su questa tabella.
              </div>
            )}

            {table.foreignKeys.map((fk) => {
              const targetTbl = allTables.find((t) => t.name === fk.referencedTable);
              return (
                <div
                  key={fk.id}
                  style={{
                    padding: 8,
                    borderRadius: 8,
                    background: 'var(--bg-panel-elevated)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 22px', gap: 5, alignItems: 'center' }}>
                    <select
                      value={fk.columns[0] ?? ''}
                      onChange={(e) =>
                        onChangeTable({
                          ...table,
                          foreignKeys: table.foreignKeys.map((item) =>
                            item.id === fk.id ? { ...item, columns: [e.target.value] } : item,
                          ),
                        })
                      }
                      style={inpStyle}
                    >
                      {table.columns.map((c) => (
                        <option key={c.id} value={c.name}>
                          {table.name}.{c.name}
                        </option>
                      ))}
                    </select>

                    <select
                      value={fk.referencedTable}
                      onChange={(e) => {
                        const nextRef = allTables.find((t) => t.name === e.target.value);
                        const nextPk =
                          nextRef?.columns.find((c) => c.primaryKey)?.name ??
                          nextRef?.columns[0]?.name ??
                          'id';
                        onChangeTable({
                          ...table,
                          foreignKeys: table.foreignKeys.map((item) =>
                            item.id === fk.id
                              ? {
                                  ...item,
                                  referencedTable: e.target.value,
                                  referencedSchema: nextRef?.schema,
                                  referencedColumns: [nextPk],
                                }
                              : item,
                          ),
                        });
                      }}
                      style={inpStyle}
                    >
                      {allTables.map((t) => (
                        <option key={t.id} value={t.name}>
                          → {t.name}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={() =>
                        onChangeTable({
                          ...table,
                          foreignKeys: table.foreignKeys.filter((item) => item.id !== fk.id),
                        })
                      }
                      style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                    <select
                      value={fk.referencedColumns[0] ?? 'id'}
                      onChange={(e) =>
                        onChangeTable({
                          ...table,
                          foreignKeys: table.foreignKeys.map((item) =>
                            item.id === fk.id ? { ...item, referencedColumns: [e.target.value] } : item,
                          ),
                        })
                      }
                      style={inpStyle}
                    >
                      {(targetTbl?.columns ?? [{ id: 'id', name: 'id' }]).map((c) => (
                        <option key={c.id} value={c.name}>
                          Colonna: {c.name}
                        </option>
                      ))}
                    </select>

                    <select
                      value={fk.onDelete ?? 'NO ACTION'}
                      onChange={(e) =>
                        onChangeTable({
                          ...table,
                          foreignKeys: table.foreignKeys.map((item) =>
                            item.id === fk.id
                              ? { ...item, onDelete: e.target.value as SqlReferentialAction }
                              : item,
                          ),
                        })
                      }
                      style={inpStyle}
                    >
                      {FK_ACTIONS.map((act) => (
                        <option key={act} value={act}>
                          ON DELETE {act}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 8,
                paddingTop: 8,
                borderTop: '1px solid var(--border-subtle)',
              }}
            >
              <strong style={{ fontSize: 11.5 }}>
                <ListTree size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                Indici ({table.indexes.length})
              </strong>
              <button
                type="button"
                data-testid="btn-sql-add-index"
                onClick={handleAddIndex}
                style={smallActionBtnStyle}
              >
                <Plus size={12} /> Indice
              </button>
            </div>

            {table.indexes.map((idx) => (
              <div
                key={idx.id}
                style={{
                  padding: 8,
                  borderRadius: 8,
                  background: 'var(--bg-panel-elevated)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 22px', gap: 6, alignItems: 'center' }}>
                  <input
                    value={idx.name}
                    onChange={(e) =>
                      onChangeTable({
                        ...table,
                        indexes: table.indexes.map((it) =>
                          it.id === idx.id ? { ...it, name: e.target.value } : it,
                        ),
                      })
                    }
                    style={inpStyle}
                  />
                  <label style={chkLabelStyle}>
                    <input
                      type="checkbox"
                      checked={idx.unique}
                      onChange={(e) =>
                        onChangeTable({
                          ...table,
                          indexes: table.indexes.map((it) =>
                            it.id === idx.id ? { ...it, unique: e.target.checked } : it,
                          ),
                        })
                      }
                    />
                    UNIQUE
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      onChangeTable({
                        ...table,
                        indexes: table.indexes.filter((it) => it.id !== idx.id),
                      })
                    }
                    style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <input
                  value={idx.columns.join(', ')}
                  onChange={(e) =>
                    onChangeTable({
                      ...table,
                      indexes: table.indexes.map((it) =>
                        it.id === idx.id
                          ? {
                              ...it,
                              columns: e.target.value
                                .split(',')
                                .map((s) => s.trim())
                                .filter(Boolean),
                            }
                          : it,
                      ),
                    })
                  }
                  placeholder="Colonne separate da virgola (es. customer_id, created_at)"
                  style={{ ...inpStyle, fontSize: 11 }}
                />
              </div>
            ))}
          </>
        )}

        {subTab === 'ddl' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: liveDdlResult.ok ? 'var(--text-muted)' : 'var(--accent-amber)' }}>
                {liveDdlResult.ok ? `DDL · ${dialect.toUpperCase()}` : 'Correggi i campi del modello per rigenerare il DDL.'}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => void copyTableDdl()} style={{ ...inpStyle, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Copy size={12} /> Copia
                </button>
                <button type="button" onClick={() => void saveTableDdl()} style={{ ...inpStyle, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <FilePlus2 size={12} /> Salva .sql
                </button>
              </div>
            </div>
            <SqlScriptEditor label="DDL della tabella da esportare" testId="sql-inspector-ddl-preview" value={ddlText} rows={14}
              onChange={(text) => setDdlDrafts((previous) => ({ ...previous, [ddlDraftKey]: text }))}
              onSave={() => void saveTableDdl()} />
          </div>
        )}
      </div>
    </aside>
  );
};

const inpStyle: React.CSSProperties = {
  width: '100%',
  padding: '4px 7px',
  borderRadius: 5,
  border: '1px solid var(--border-strong)',
  background: 'var(--bg-input)',
  color: 'var(--text-primary)',
  fontSize: 11.5,
};

const chkLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  cursor: 'pointer',
  color: 'var(--text-secondary)',
};

const smallActionBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 8px',
  borderRadius: 5,
  border: '1px solid var(--border-strong)',
  background: 'var(--bg-panel-elevated)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};

function subTabBtnStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: '5px 6px',
    borderRadius: 6,
    border: active ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
    background: active ? 'var(--accent-soft)' : 'var(--bg-panel-elevated)',
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
    fontSize: 11,
    fontWeight: active ? 600 : 500,
    cursor: 'pointer',
  };
}
