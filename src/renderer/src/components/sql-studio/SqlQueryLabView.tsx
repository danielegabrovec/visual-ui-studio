import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  BookOpen,
  FileSearch,
  History,
  Play,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  ExtractedSqlOperation,
  SqlDesignDocument,
  SqlDialect,
  SqlNamedQueryDef,
  SqlOperationFilterSpec,
  SqlOperationGraphDraft,
  SqlQueryHistoryEntry,
  SqlQueryResult,
} from '@shared/sql-ir';
import { explainSqlInItalian, getSqlCompletions, type SqlCompletionItem } from '@shared/sql-language';
import {
  buildNamedQueryFromOperationGraph,
  buildVisualQueryStageCards,
  compileOperationGraphToSql,
  createDefaultOperationGraph,
  parseSqlToOperationGraph,
} from '@shared/sql-operation-graph';
import { getStudioApi } from '@renderer/api/studio-client';
import { useStudioStore } from '@renderer/state/studio-store';

export interface SqlQueryLabViewProps {
  sqlDocument: SqlDesignDocument;
  dialect: SqlDialect;
  connectionId: string | null;
  onUpdateDocument: (next: SqlDesignDocument, silent?: boolean) => void;
}

export const SqlQueryLabView: React.FC<SqlQueryLabViewProps> = ({
  sqlDocument,
  dialect,
  connectionId,
  onUpdateDocument,
}) => {
  const project = useStudioStore((s) => s.project);
  const executeSqlQueryAction = useStudioStore((s) => s.executeSqlQueryAction);
  const pushToast = useStudioStore((s) => s.pushToast);

  const firstQuery = sqlDocument.namedQueries[0];
  const [graph, setGraph] = useState<SqlOperationGraphDraft>(
    () =>
      firstQuery?.operationGraph
        ? structuredClone(firstQuery.operationGraph)
        : createDefaultOperationGraph(sqlDocument.tables[0]),
  );
  const [sqlText, setSqlText] = useState<string>(
    () => firstQuery?.canonicalSql ?? 'SELECT * FROM customers ORDER BY id DESC LIMIT 50;',
  );
  const [queryNameInput, setQueryNameInput] = useState<string>(
    () => firstQuery?.name ?? 'listActiveCustomers',
  );
  const [showVisualComposer, setShowVisualComposer] = useState(true);
  const [sqlMatchesGraph, setSqlMatchesGraph] = useState(!firstQuery || Boolean(firstQuery.operationGraph));
  const [showExplanation, setShowExplanation] = useState(true);
  const [result, setResult] = useState<SqlQueryResult | null>(null);
  const [running, setRunning] = useState(false);

  const [completions, setCompletions] = useState<SqlCompletionItem[]>([]);
  const [showCompletions, setShowCompletions] = useState(false);
  const [historyList, setHistoryList] = useState<SqlQueryHistoryEntry[]>([]);
  const [extractedOps, setExtractedOps] = useState<ExtractedSqlOperation[] | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  const isSandbox = !connectionId || connectionId === '__memory_sandbox__';

  useEffect(() => {
    if (!project) return;
    void getStudioApi()
      .sql.listQueryHistory(project.id, 25)
      .then(setHistoryList)
      .catch(() => {});
  }, [project, result]);

  const sourceTableDef = useMemo(
    () =>
      sqlDocument.tables.find(
        (t) => t.name.toLowerCase() === graph.sourceTable.toLowerCase(),
      ) ?? sqlDocument.tables[0],
    [sqlDocument.tables, graph.sourceTable],
  );

  const stageCards = useMemo(() => buildVisualQueryStageCards(graph), [graph]);

  const explanation = useMemo(
    () => explainSqlInItalian(sqlText, dialect, sqlDocument),
    [sqlText, dialect, sqlDocument],
  );

  const syncGraphToSql = (nextGraph: SqlOperationGraphDraft) => {
    setGraph(nextGraph);
    try {
      const compiled = compileOperationGraphToSql(nextGraph, sqlDocument, dialect);
      setSqlText(compiled.previewSqlWithSamples);
      setSqlMatchesGraph(true);
    } catch {
      // keep manual SQL if incomplete draft
    }
  };

  // Re-compile graph preview when dialect switches if visual composer is active
  useEffect(() => {
    if (!showVisualComposer || !sqlMatchesGraph) return;
    try {
      const compiled = compileOperationGraphToSql(graph, sqlDocument, dialect);
      setSqlText(compiled.previewSqlWithSamples);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialect]);

  const editSqlText = (value: string) => {
    setSqlText(value);
    setSqlMatchesGraph(false);
  };

  const handleReverseImportSqlIntoGraph = () => {
    const parsed = parseSqlToOperationGraph(sqlText, sqlDocument, dialect);
    if (parsed.graph) {
      setGraph(parsed.graph);
      setShowVisualComposer(true);
      pushToast('success', 'Query SQL importata nel Grafo Visuale Query Rapide!');
    } else {
      pushToast('warn', parsed.error ?? 'Impossibile convertire la query nel grafo visuale.');
    }
  };

  const handleRunQuery = async () => {
    if (!sqlText.trim()) return;
    setRunning(true);
    try {
      const res = await executeSqlQueryAction({
        sql: sqlText,
        dialect,
        connectionId: isSandbox ? null : connectionId,
        sandboxMode: isSandbox,
        schemaDoc: sqlDocument,
      });
      if (res) setResult(res);
    } finally {
      setRunning(false);
    }
  };

  const handleSaveNamedQuery = () => {
    const cleanName = queryNameInput.trim().replace(/[^a-zA-Z0-9_]/g, '') || 'customQuery';
    let savedDef: SqlNamedQueryDef;
    try {
      if (sqlMatchesGraph) {
        savedDef = buildNamedQueryFromOperationGraph(cleanName, graph, sqlDocument);
        savedDef.canonicalSql = sqlText.trim();
      } else {
        savedDef = {
          id: `qry_${cleanName}`,
          name: cleanName,
          description: explanation.summary,
          kind: /^\s*INSERT\b/i.test(sqlText)
            ? 'insert'
            : /^\s*UPDATE\b/i.test(sqlText)
              ? 'update'
              : /^\s*DELETE\b/i.test(sqlText)
                ? 'delete'
                : 'select',
          targetTable: explanation.tables[0] ?? graph.sourceTable,
          canonicalSql: sqlText.trim(),
          sql: sqlText.trim(),
          parameters: explanation.parameters.map((p) => ({
            name: p.replace(/^[$:@?]/, '') || 'p1',
            type: 'varchar',
            required: true,
          })),
        };
      }
    } catch {
      savedDef = {
        id: `qry_${cleanName}`,
        name: cleanName,
        canonicalSql: sqlText.trim(),
        sql: sqlText.trim(),
        kind: 'custom',
        parameters: [],
      };
    }

    const existing = sqlDocument.namedQueries ?? [];
    const idx = existing.findIndex((q) => q.name === savedDef.name);
    const nextList =
      idx >= 0 ? existing.map((q, i) => (i === idx ? { ...savedDef, id: q.id } : q)) : [...existing, savedDef];

    onUpdateDocument({
      ...sqlDocument,
      namedQueries: nextList,
      updatedAt: Date.now(),
    });
    pushToast(
      'success',
      `Query "${savedDef.name}" salvata per Automazioni No-Code & Codegen!`,
    );
  };

  const handleTriggerAutocomplete = (nextValue: string, cursor: number, explicit = false) => {
    const items = getSqlCompletions({
      sql: nextValue,
      cursorOffset: cursor,
      dialect,
      schema: sqlDocument,
    });
    setCompletions(items.slice(0, 12));
    const charBefore = nextValue[cursor - 1] ?? '';
    setShowCompletions(explicit || (items.length > 0 && /[a-zA-Z_.]/.test(charBefore)));
  };

  const applyCompletion = (item: SqlCompletionItem) => {
    const next =
      sqlText.slice(0, item.replacementStart) +
      item.insertText +
      sqlText.slice(item.replacementEnd);
    editSqlText(next);
    setShowCompletions(false);
    setTimeout(() => {
      editorRef.current?.focus();
    }, 0);
  };

  const handleExtractFromSources = async () => {
    if (!project) return;
    const ops = await getStudioApi().sql.extractSqlFromProjectFiles(project.id);
    setExtractedOps(ops);
    pushToast(
      'info',
      ops.length > 0
        ? `Estratte ${ops.length} query SQL dai file sorgente del progetto.`
        : 'Nessuna query SQL trovata nei file sorgente (.js/.ts/.py/.rs).',
    );
  };

  return (
    <div
      data-testid="sql-query-lab-view"
      style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }}
    >
      {/* Left Sidebar: Saved Queries + History + Source Extractor */}
      <aside
        style={{
          width: 268,
          flexShrink: 0,
          borderRight: '1px solid var(--border-subtle)',
          background: 'var(--bg-panel)',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          padding: 10,
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>
            Query Nominate ({sqlDocument.namedQueries.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {sqlDocument.namedQueries.map((nq) => (
              <div
                key={nq.id}
                data-testid={`sql-saved-query-${nq.name}`}
                onClick={() => {
                  setQueryNameInput(nq.name);
                  setSqlText(nq.sqlByDialect?.[dialect] ?? nq.canonicalSql);
                  if (nq.operationGraph) {
                    setGraph(structuredClone(nq.operationGraph));
                  }
                  setSqlMatchesGraph(Boolean(nq.operationGraph));
                }}
                style={{
                  padding: '6px 8px',
                  borderRadius: 7,
                  background: 'var(--bg-panel-elevated)',
                  border: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 4,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 11.5,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {nq.name}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {nq.kind.toUpperCase()} {nq.targetTable ? `· ${nq.targetTable}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdateDocument({
                      ...sqlDocument,
                      namedQueries: sqlDocument.namedQueries.filter((q) => q.id !== nq.id),
                    });
                  }}
                  style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Static SQL Extractor */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
          <button
            type="button"
            data-testid="btn-sql-extract-from-sources"
            onClick={() => void handleExtractFromSources()}
            style={{
              width: '100%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid var(--border-strong)',
              background: 'var(--bg-panel-elevated)',
              fontSize: 11.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <FileSearch size={13} /> Estrai SQL da .js/.ts/.py/.rs
          </button>

          {extractedOps && extractedOps.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
              {extractedOps.slice(0, 6).map((op, i) => (
                <div
                  key={`${op.filePath}_${op.line}_${i}`}
                  onClick={() => editSqlText(op.sql)}
                  style={{
                    padding: '5px 7px',
                    borderRadius: 6,
                    background: 'var(--bg-panel-elevated)',
                    fontSize: 10.5,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {op.filePath.split('/').pop()}:{op.line} ({op.kind})
                  </div>
                  <div style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {op.sql}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Execution History */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 700, fontSize: 11.5, marginBottom: 6 }}>
            <History size={12} /> Cronologia ({historyList.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {historyList.slice(0, 8).map((h) => (
              <div
                key={h.id}
                onClick={() => editSqlText(h.sql)}
                style={{
                  padding: '5px 7px',
                  borderRadius: 6,
                  background: 'var(--bg-panel-elevated)',
                  fontSize: 10.5,
                  cursor: 'pointer',
                  borderLeft: `2px solid ${h.ok ? 'var(--accent-emerald)' : 'var(--accent-danger)'}`,
                }}
              >
                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {h.sql}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 9.5 }}>
                  {h.dialect} · {h.rowCount} righe · {h.durationMs}ms
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Main Query Lab Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflowY: 'auto' }}>
        {/* Action Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
            padding: '7px 12px',
            background: 'var(--bg-panel)',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              onClick={() => setShowVisualComposer((v) => !v)}
              style={{
                ...labBtnStyle,
                borderColor: showVisualComposer ? 'var(--accent-primary)' : 'var(--border-strong)',
                background: showVisualComposer ? 'var(--accent-soft)' : 'var(--bg-panel-elevated)',
              }}
            >
              <Sparkles size={13} /> Grafo Query Rapide
            </button>

            <button
              type="button"
              data-testid="btn-sql-import-into-graph"
              onClick={handleReverseImportSqlIntoGraph}
              style={labBtnStyle}
            >
              <ArrowLeftRight size={13} /> SQL → Grafo Visuale
            </button>

            <button
              type="button"
              onClick={() => setShowExplanation((v) => !v)}
              style={labBtnStyle}
            >
              <BookOpen size={13} /> Spiegazione Italiana
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              data-testid="sql-named-query-input"
              value={queryNameInput}
              onChange={(e) => setQueryNameInput(e.target.value)}
              placeholder="nomeQuery..."
              style={{
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid var(--border-strong)',
                background: 'var(--bg-input)',
                width: 165,
                fontSize: 12,
              }}
            />
            <button
              type="button"
              data-testid="btn-sql-save-named-query"
              onClick={handleSaveNamedQuery}
              style={{
                ...labBtnStyle,
                borderColor: 'var(--accent-violet)',
                background: 'var(--accent-violet-soft)',
                fontWeight: 600,
              }}
            >
              <Save size={13} /> Salva come Query Nominata per Automazioni
            </button>

            <button
              type="button"
              disabled={running}
              data-testid="btn-sql-run-query"
              onClick={() => void handleRunQuery()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '5px 14px',
                borderRadius: 6,
                border: 'none',
                background: 'var(--accent-emerald)',
                color: '#fff',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <Play size={13} /> Esegui Query (Ctrl+Invio)
            </button>
          </div>
        </div>

        {/* Visual Operation Graph Composer (`Source -> Join -> Filter -> Group -> Order -> Limit -> Read/Write`) */}
        {showVisualComposer && (
          <div
            data-testid="sql-visual-operation-graph"
            style={{
              padding: 12,
              background: 'var(--bg-panel-elevated)',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {/* Visual Pipeline Stage Strip */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
              {stageCards.map((card, idx) => (
                <React.Fragment key={card.id}>
                  <div
                    style={{
                      minWidth: 146,
                      padding: '6px 9px',
                      borderRadius: 8,
                      background: card.active ? 'var(--accent-soft)' : 'var(--bg-panel)',
                      border: card.active
                        ? '1px solid var(--accent-primary)'
                        : '1px solid var(--border-subtle)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }}>
                      <strong>{card.title}</strong>
                      <code style={{ color: 'var(--accent-primary)' }}>{card.badge}</code>
                    </div>
                    <div
                      style={{
                        fontSize: 10.5,
                        color: 'var(--text-secondary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {card.subtitle}
                    </div>
                  </div>
                  {idx < stageCards.length - 1 && (
                    <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>→</span>
                  )}
                </React.Fragment>
              ))}
            </div>

            {/* Interactive Controls for Source, Operation, Join, Where, Aggregate, Order & Limit */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 8 }}>
              <label style={graphLblStyle}>
                <span>Operazione</span>
                <select
                  value={graph.kind}
                  onChange={(e) =>
                    syncGraphToSql({
                      ...graph,
                      kind: e.target.value as SqlOperationGraphDraft['kind'],
                    })
                  }
                  style={graphFieldStyle}
                >
                  <option value="select">SELECT (Lettura)</option>
                  <option value="insert">INSERT (Nuovo Record)</option>
                  <option value="update">UPDATE (Modifica)</option>
                  <option value="delete">DELETE (Elimina)</option>
                </select>
              </label>

              <label style={graphLblStyle}>
                <span>Tabella Sorgente</span>
                <select
                  data-testid="sql-graph-source-table"
                  value={graph.sourceTable}
                  onChange={(e) => {
                    const nextTbl = sqlDocument.tables.find((t) => t.name === e.target.value);
                    syncGraphToSql({
                      ...graph,
                      sourceTable: e.target.value,
                      selectedColumns: nextTbl ? nextTbl.columns.map((c) => c.name) : [],
                      joins: [],
                      filters: [],
                      orderBy: nextTbl?.columns[0]
                        ? [{ column: nextTbl.columns[0].name, direction: 'DESC' }]
                        : [],
                    });
                  }}
                  style={graphFieldStyle}
                >
                  {sqlDocument.tables.map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>

              {graph.kind === 'select' && (
                <>
                  <label style={graphLblStyle}>
                    <span>Ordina Per (ORDER BY)</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <select
                        value={graph.orderBy[0]?.column ?? ''}
                        onChange={(e) =>
                          syncGraphToSql({
                            ...graph,
                            orderBy: e.target.value
                              ? [{ column: e.target.value, direction: graph.orderBy[0]?.direction ?? 'DESC' }]
                              : [],
                          })
                        }
                        style={{ ...graphFieldStyle, flex: 1 }}
                      >
                        <option value="">(Nessun ordine)</option>
                        {(sourceTableDef?.columns ?? []).map((c) => (
                          <option key={c.id} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <select
                        value={graph.orderBy[0]?.direction ?? 'DESC'}
                        onChange={(e) =>
                          syncGraphToSql({
                            ...graph,
                            orderBy: graph.orderBy[0]
                              ? [{ column: graph.orderBy[0].column, direction: e.target.value as 'ASC' | 'DESC' }]
                              : [],
                          })
                        }
                        style={{ ...graphFieldStyle, width: 72 }}
                      >
                        <option value="DESC">DESC</option>
                        <option value="ASC">ASC</option>
                      </select>
                    </div>
                  </label>

                  <label style={graphLblStyle}>
                    <span>Limite / Offset ({dialect === 'sqlserver' ? 'TOP / FETCH' : 'LIMIT'})</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input
                        type="number"
                        min={1}
                        max={10000}
                        value={graph.limit ?? 100}
                        onChange={(e) =>
                          syncGraphToSql({
                            ...graph,
                            limit: e.target.value ? Number(e.target.value) : undefined,
                          })
                        }
                        style={{ ...graphFieldStyle, width: '55%' }}
                      />
                      <input
                        type="number"
                        min={0}
                        value={graph.offset ?? 0}
                        onChange={(e) =>
                          syncGraphToSql({
                            ...graph,
                            offset: Number(e.target.value || 0),
                          })
                        }
                        placeholder="Offset"
                        style={{ ...graphFieldStyle, width: '45%' }}
                      />
                    </div>
                  </label>
                </>
              )}
            </div>

            {/* Dynamic Filters & Joins Row */}
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                data-testid="btn-sql-graph-add-filter"
                onClick={() => {
                  const defaultCol = sourceTableDef?.columns[0]?.name ?? 'id';
                  syncGraphToSql({
                    ...graph,
                    filters: [
                      ...graph.filters,
                      {
                        id: `flt_${Date.now().toString(36)}`,
                        column: defaultCol,
                        operator: '=',
                        value: '1',
                      },
                    ],
                  });
                }}
                style={labBtnStyle}
              >
                <Plus size={12} /> Condizione WHERE
              </button>

              {graph.kind === 'select' && sqlDocument.tables.length > 1 && (
                <button
                  type="button"
                  data-testid="btn-sql-graph-add-join"
                  onClick={() => {
                    const fk = sourceTableDef?.foreignKeys[0];
                    const otherTbl =
                      sqlDocument.tables.find((t) => t.name === fk?.referencedTable) ??
                      sqlDocument.tables.find((t) => t.name !== graph.sourceTable)!;
                    syncGraphToSql({
                      ...graph,
                      joins: [
                        ...graph.joins,
                        {
                          id: `join_${Date.now().toString(36)}`,
                          joinType: 'INNER',
                          table: otherTbl.name,
                          alias: otherTbl.name.charAt(0),
                          leftColumn: fk?.columns[0] ?? 'id',
                          rightColumn: fk?.referencedColumns[0] ?? 'id',
                        },
                      ],
                    });
                  }}
                  style={labBtnStyle}
                >
                  <Plus size={12} /> Relazione JOIN
                </button>
              )}

              {graph.filters.map((f) => (
                <div
                  key={f.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 6px',
                    borderRadius: 6,
                    background: 'var(--bg-panel)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <select
                    value={f.column}
                    onChange={(e) =>
                      syncGraphToSql({
                        ...graph,
                        filters: graph.filters.map((it) =>
                          it.id === f.id ? { ...it, column: e.target.value } : it,
                        ),
                      })
                    }
                    style={miniFieldStyle}
                  >
                    {(sourceTableDef?.columns ?? []).map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>

                  <select
                    value={f.operator}
                    onChange={(e) =>
                      syncGraphToSql({
                        ...graph,
                        filters: graph.filters.map((it) =>
                          it.id === f.id
                            ? { ...it, operator: e.target.value as SqlOperationFilterSpec['operator'] }
                            : it,
                        ),
                      })
                    }
                    style={miniFieldStyle}
                  >
                    {(['=', '!=', '>', '>=', '<', '<=', 'LIKE', 'IN', 'IS NULL', 'IS NOT NULL'] as const).map(
                      (op) => (
                        <option key={op} value={op}>
                          {op}
                        </option>
                      ),
                    )}
                  </select>

                  {!f.operator.includes('NULL') && (
                    <input
                      value={f.value ?? ''}
                      onChange={(e) =>
                        syncGraphToSql({
                          ...graph,
                          filters: graph.filters.map((it) =>
                            it.id === f.id ? { ...it, value: e.target.value } : it,
                          ),
                        })
                      }
                      style={{ ...miniFieldStyle, width: 90 }}
                    />
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      syncGraphToSql({
                        ...graph,
                        filters: graph.filters.filter((it) => it.id !== f.id),
                      })
                    }
                    style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SQL Editor + Italian Query Explanation Split */}
        <div style={{ display: 'grid', gridTemplateColumns: showExplanation ? '1.45fr 1fr' : '1fr', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
            <textarea
              ref={editorRef}
              data-testid="sql-query-editor"
              value={sqlText}
              onChange={(e) => {
                const val = e.target.value;
                editSqlText(val);
                handleTriggerAutocomplete(val, e.target.selectionStart ?? val.length);
              }}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void handleRunQuery();
                } else if (e.ctrlKey && e.key === ' ') {
                  e.preventDefault();
                  handleTriggerAutocomplete(sqlText, e.currentTarget.selectionStart ?? sqlText.length, true);
                } else if (e.key === 'Escape') {
                  setShowCompletions(false);
                }
              }}
              rows={7}
              spellCheck={false}
              style={{
                width: '100%',
                border: 'none',
                outline: 'none',
                padding: 12,
                background: 'var(--code-bg)',
                color: 'var(--text-primary)',
                fontFamily: "'JetBrains Mono', Consolas, monospace",
                fontSize: 12.5,
                lineHeight: 1.5,
                resize: 'vertical',
              }}
            />

            {/* Schema & Alias Autocomplete Popup */}
            {showCompletions && completions.length > 0 && (
              <div
                data-testid="sql-autocomplete-popup"
                style={{
                  position: 'absolute',
                  left: 14,
                  bottom: 8,
                  zIndex: 30,
                  width: 340,
                  maxHeight: 180,
                  overflowY: 'auto',
                  borderRadius: 8,
                  background: 'var(--bg-panel-elevated)',
                  border: '1px solid var(--border-strong)',
                  boxShadow: 'var(--shadow-lg)',
                }}
              >
                {completions.map((item) => (
                  <div
                    key={`${item.kind}_${item.label}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyCompletion(item);
                    }}
                    style={{
                      padding: '5px 9px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 11.5,
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}
                  >
                    <strong>{item.label}</strong>
                    <span style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>{item.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {showExplanation && (
            <div
              data-testid="sql-italian-explanation"
              style={{
                padding: 12,
                background: 'var(--bg-panel)',
                borderLeft: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxHeight: 200,
                overflowY: 'auto',
              }}
            >
              <strong style={{ fontSize: 11.5 }}>Spiegazione Query in Italiano ({dialect})</strong>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{explanation.summary}</div>

              {explanation.warnings.map((w, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '4px 8px',
                    borderRadius: 6,
                    background: 'var(--accent-amber-soft)',
                    color: 'var(--accent-amber)',
                    fontSize: 11,
                  }}
                >
                  <AlertTriangle size={12} /> {w}
                </div>
              ))}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {explanation.steps.map((st, idx) => (
                  <div key={idx} style={{ fontSize: 11 }}>
                    <code style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>{st.clause}</code> —{' '}
                    <strong>{st.title}:</strong>{' '}
                    <span style={{ color: 'var(--text-secondary)' }}>{st.explanation}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Execution Results Pane */}
        <div
          data-testid="sql-query-results"
          style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 180, background: 'var(--bg-app)' }}
        >
          {!result ? (
            <div style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
              Premi <strong>Esegui Query</strong> per interrogare{' '}
              {isSandbox ? 'la Sandbox locale :memory: (pre-popolata con le tabelle del progetto)' : `il database ${dialect}`}.
            </div>
          ) : !result.ok ? (
            <div style={{ padding: 16, color: 'var(--accent-danger)' }}>
              <strong>Errore SQL ({result.dialect}):</strong> {result.error}
              {result.explanation && (
                <div style={{ marginTop: 6, color: 'var(--accent-amber)', fontSize: 12 }}>
                  Suggerimento: {result.explanation}
                </div>
              )}
            </div>
          ) : (
            <>
              <div
                style={{
                  padding: '6px 12px',
                  background: 'var(--bg-panel)',
                  borderBottom: '1px solid var(--border-subtle)',
                  fontSize: 11.5,
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>
                  ✓ {result.rowCount} righe restituite
                  {result.affectedRows !== undefined ? ` · ${result.affectedRows} righe modificate` : ''} in{' '}
                  <strong>{result.durationMs}ms</strong>
                </span>
                <span>Dialetto: {result.dialect.toUpperCase()}</span>
              </div>

              {result.columns.length > 0 && (
                <div style={{ flex: 1, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-panel-elevated)', position: 'sticky', top: 0 }}>
                        {result.columns.map((c) => (
                          <th
                            key={c.name}
                            style={{
                              padding: '6px 10px',
                              textAlign: 'left',
                              borderBottom: '1px solid var(--border-strong)',
                              borderRight: '1px solid var(--border-subtle)',
                            }}
                          >
                            {c.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((r, rIdx) => (
                        <tr key={rIdx}>
                          {result.columns.map((c) => (
                            <td
                              key={c.name}
                              style={{
                                padding: '5px 10px',
                                borderBottom: '1px solid var(--border-subtle)',
                                borderRight: '1px solid var(--border-subtle)',
                              }}
                            >
                              {r[c.name] === null || r[c.name] === undefined ? (
                                <em style={{ color: 'var(--text-muted)' }}>NULL</em>
                              ) : (
                                String(r[c.name])
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const labBtnStyle: React.CSSProperties = {
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

const graphLblStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  fontSize: 11,
  color: 'var(--text-secondary)',
};

const graphFieldStyle: React.CSSProperties = {
  padding: '4px 7px',
  borderRadius: 5,
  border: '1px solid var(--border-strong)',
  background: 'var(--bg-input)',
  color: 'var(--text-primary)',
  fontSize: 11.5,
};

const miniFieldStyle: React.CSSProperties = {
  padding: '2px 5px',
  borderRadius: 4,
  border: '1px solid var(--border-strong)',
  background: 'var(--bg-input)',
  color: 'var(--text-primary)',
  fontSize: 11,
};
