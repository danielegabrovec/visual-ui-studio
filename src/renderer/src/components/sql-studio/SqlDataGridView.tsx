import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ClipboardPaste,
  Code2,
  Copy,
  FilePlus2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
} from 'lucide-react';
import { compileDmlStatements, qualifyTableName, quoteIdentifier } from '@shared/sql-dialects';
import {
  applyPastePlanToStagedChanges,
  buildClipboardPastePlan,
  canMutateGridRow,
  formatCellForDisplay,
  formatCellForInput,
  materializeGridRows,
  navigateGridCell,
  parseGridCellInput,
  serializeDelimitedClipboard,
  stageCellEdit,
  stageDeleteOrRestoreRow,
  stageNewBlankRow,
  type GridCellCoords,
} from '@shared/sql-grid-model';
import type {
  SqlDataChange,
  SqlDataRow,
  SqlDesignDocument,
  SqlDialect,
  SqlTableDef,
} from '@shared/sql-ir';
import { getStudioApi } from '@renderer/api/studio-client';
import { useStudioStore } from '@renderer/state/studio-store';
import { SqlScriptEditor } from './SqlScriptEditor';

export interface SqlDataGridViewProps {
  sqlDocument: SqlDesignDocument;
  dialect: SqlDialect;
  connectionId: string | null;
  selectedTableId: string | null;
  onSelectTable: (tableId: string) => void;
  onReloadSchema?: () => void;
  onSaveScript: (name: string, content: string) => Promise<void>;
}

export const SqlDataGridView: React.FC<SqlDataGridViewProps> = ({
  sqlDocument,
  dialect,
  connectionId,
  selectedTableId,
  onSelectTable,
  onReloadSchema,
  onSaveScript,
}) => {
  const project = useStudioStore((s) => s.project);
  const pushToast = useStudioStore((s) => s.pushToast);
  const appendConsoleEntry = useStudioStore((s) => s.appendConsoleEntry);
  const isReadOnly = useStudioStore((s) => s.sqlConnections.some((connection) => connection.id === connectionId && connection.readOnly));

  const activeTable: SqlTableDef | undefined = useMemo(
    () =>
      sqlDocument.tables.find((t) => t.id === selectedTableId) ?? sqlDocument.tables[0],
    [sqlDocument.tables, selectedTableId],
  );

  const [baseRows, setBaseRows] = useState<SqlDataRow[]>([]);
  const [stagedChanges, setStagedChanges] = useState<SqlDataChange[]>([]);
  const [searchFilter, setSearchFilter] = useState('');
  const [activeCell, setActiveCell] = useState<GridCellCoords>({ row: 0, column: 0 });
  const [editingCell, setEditingCell] = useState<GridCellCoords | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [showDmlPreview, setShowDmlPreview] = useState(false);
  const [dmlDraft, setDmlDraft] = useState<{ generated: string; text: string }>();
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [loading, setLoading] = useState(false);
  const [rowsAvailable, setRowsAvailable] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const loadSequence = useRef(0);
  const canEdit = rowsAvailable && !isReadOnly && !loading;

  const isSandbox = !connectionId || connectionId === '__memory_sandbox__';

  const loadTableRows = useCallback(async () => {
    if (!project || !activeTable) return;
    const requestId = ++loadSequence.current;
    setLoading(true);
    setRowsAvailable(false);
    setErrorBanner(null);
    try {
      const effectiveQueryDialect: SqlDialect = isSandbox ? 'sqlite' : dialect;
      const qTbl = qualifyTableName(effectiveQueryDialect, activeTable.name, activeTable.schema);
      const pkCol = activeTable.columns.find((c) => c.primaryKey);
      const orderSql = pkCol
        ? ` ORDER BY ${quoteIdentifier(pkCol.name, effectiveQueryDialect)} ASC`
        : '';
      const selectSql =
        effectiveQueryDialect === 'sqlserver'
          ? `SELECT TOP (500) * FROM ${qTbl}${orderSql};`
          : `SELECT * FROM ${qTbl}${orderSql} LIMIT 500;`;

      const res = await getStudioApi().sql.executeQuery({
        projectId: project.id,
        connectionId: isSandbox ? null : connectionId,
        sandboxMode: isSandbox,
        dialect: effectiveQueryDialect,
        sql: selectSql,
        schemaDoc: sqlDocument,
      });

      if (requestId !== loadSequence.current) return;
      setStagedChanges([]);
      setEditingCell(null);
      if (res.ok) {
        setBaseRows(res.rows);
        setRowsAvailable(true);
      } else {
        setBaseRows([]);
        setErrorBanner(res.error ?? 'Impossibile leggere la tabella nel database attivo.');
      }
    } catch (err) {
      if (requestId !== loadSequence.current) return;
      setBaseRows([]);
      setStagedChanges([]);
      setEditingCell(null);
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      if (requestId === loadSequence.current) setLoading(false);
    }
  }, [project, activeTable, isSandbox, dialect, connectionId, sqlDocument]);

  useEffect(() => {
    void loadTableRows();
    return () => { loadSequence.current++; };
  }, [loadTableRows]);

  const columns = activeTable?.columns ?? [];
  const allColNames = useMemo(() => columns.map((c) => c.name), [columns]);
  const pkColNames = useMemo(
    () => columns.filter((c) => c.primaryKey).map((c) => c.name),
    [columns],
  );

  const materializedRows = useMemo(
    () => materializeGridRows(baseRows, stagedChanges, pkColNames, allColNames),
    [baseRows, stagedChanges, pkColNames, allColNames],
  );

  const visibleRows = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    if (!q) return materializedRows;
    return materializedRows.filter((row) =>
      allColNames.some((col) => String(row.values[col] ?? '').toLowerCase().includes(q)),
    );
  }, [materializedRows, searchFilter, allColNames]);

  const dmlStatements = useMemo(() => {
    if (!activeTable || stagedChanges.length === 0) return [];
    try {
      return compileDmlStatements(dialect, activeTable.name, stagedChanges, {
        schema: activeTable.schema,
        tableDef: activeTable,
      });
    } catch {
      return [];
    }
  }, [activeTable, dialect, stagedChanges]);
  const generatedDml = dmlStatements.map((statement) => statement.previewSql).join('\n');
  const dmlText = dmlDraft?.generated === generatedDml ? dmlDraft.text : generatedDml;
  const saveGridDml = () => onSaveScript(`dml_${activeTable?.name.replace(/[^a-zA-Z0-9_-]/g, '_') ?? 'tabella'}_${dialect}.sql`, dmlText);
  const copyGridDml = async () => {
    try {
      await navigator.clipboard.writeText(dmlText);
      pushToast('success', 'Script DML copiato.');
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error));
    }
  };

  const startEditingCell = (rowIdx: number, colIdx: number) => {
    const row = materializedRows[rowIdx];
    const col = columns[colIdx];
    if (!canEdit || !row || !col || row.status === 'deleted' || !canMutateGridRow(row, pkColNames)) return;
    setActiveCell({ row: rowIdx, column: colIdx });
    setEditingCell({ row: rowIdx, column: colIdx });
    setEditDraft(formatCellForInput(row.values[col.name]));
    setErrorBanner(null);
  };

  const commitEditingCell = () => {
    if (!editingCell) return;
    const col = columns[editingCell.column];
    if (!col) {
      setEditingCell(null);
      return;
    }
    try {
      const parsed = parseGridCellInput(editDraft, col, {
        allowNullLiteral: true,
        isUnquotedBackslashN: editDraft === '\\N',
      });
      const next = stageCellEdit(
        baseRows,
        stagedChanges,
        editingCell.row,
        col.name,
        parsed,
        pkColNames,
        allColNames,
      );
      setStagedChanges(next);
      setEditingCell(null);
      setErrorBanner(null);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAddRow = () => {
    const next = stageNewBlankRow(stagedChanges, columns);
    setStagedChanges(next);
    const newRowIdx = baseRows.length + next.filter((c) => c.kind === 'insert').length - 1;
    const firstEditableCol = Math.max(
      0,
      columns.findIndex((c) => !c.autoIncrement),
    );
    setActiveCell({ row: newRowIdx, column: firstEditableCol });
  };

  const handleApplyPasteText = (rawClipboard: string) => {
    if (!rawClipboard.trim()) return;
    try {
      const plan = buildClipboardPastePlan(
        baseRows,
        stagedChanges,
        columns,
        activeCell,
        rawClipboard,
        pkColNames,
      );
      if (plan.issues.length > 0) {
        setErrorBanner(`Errore incolla (riga ${plan.issues[0].row}): ${plan.issues[0].message}`);
        return;
      }
      const next = applyPastePlanToStagedChanges(
        baseRows,
        stagedChanges,
        plan,
        pkColNames,
        allColNames,
      );
      setStagedChanges(next);
      setShowPasteBox(false);
      setPasteText('');
      setErrorBanner(null);
      pushToast(
        'info',
        `Preparate ${plan.mutations.length} celle modificate e ${plan.appendedRows.length} nuove righe da TSV/CSV.`,
      );
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCopyTsv = async () => {
    const tsv = serializeDelimitedClipboard(
      allColNames,
      visibleRows.map((r) => r.values),
      '\t',
      true,
    );
    try {
      await navigator.clipboard.writeText(tsv);
      pushToast('success', `Copiate ${visibleRows.length} righe in formato TSV negli appunti.`);
    } catch {
      pushToast('info', 'TSV generato.');
    }
  };

  const handleCommitStagedChanges = async () => {
    if (!project || !activeTable || !canEdit || stagedChanges.length === 0) return;
    setLoading(true);
    setErrorBanner(null);
    try {
      const res = await getStudioApi().sql.applyDataChanges({
        projectId: project.id,
        connectionId: isSandbox ? null : connectionId,
        sandboxMode: isSandbox,
        dialect,
        tableName: activeTable.name,
        schema: activeTable.schema,
        changes: stagedChanges,
        schemaDoc: sqlDocument,
      });

      if (!res.ok) {
        setErrorBanner(res.error ?? 'Errore durante il commit transazionale delle modifiche.');
        return;
      }

      appendConsoleEntry({
        kind: 'sql',
        source: `Grid (${activeTable.name})`,
        message: `✓ Applicate ${res.appliedCount} modifiche su "${activeTable.name}" (${dialect})`,
      });
      pushToast(
        'success',
        `Applicate ${res.appliedCount} modifiche su "${activeTable.name}"!`,
      );
      onReloadSchema?.();
      await loadTableRows();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGridKeyDown = (e: React.KeyboardEvent) => {
    if (editingCell) return;
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      startEditingCell(activeCell.row, activeCell.column);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const col = columns[activeCell.column];
      const row = materializedRows[activeCell.row];
      if (canEdit && col?.nullable && row && row.status !== 'deleted' && canMutateGridRow(row, pkColNames)) {
        e.preventDefault();
        setStagedChanges((prev) =>
          stageCellEdit(baseRows, prev, activeCell.row, col.name, null, pkColNames, allColNames),
        );
      }
      return;
    }
    const nav = navigateGridCell(
      activeCell,
      e.key,
      materializedRows.length,
      columns.length,
      e.shiftKey,
      e.ctrlKey || e.metaKey,
    );
    if (nav) {
      e.preventDefault();
      setActiveCell(nav);
    }
  };

  if (!activeTable) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)' }}>
        Crea o importa almeno una tabella nel Designer ER per esplorare il Foglio Dati.
      </div>
    );
  }

  return (
    <div
      data-testid="sql-data-grid-view"
      tabIndex={0}
      onKeyDown={handleGridKeyDown}
      onPaste={(e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        const text = e.clipboardData?.getData('text/plain');
        if (text) {
          e.preventDefault();
          handleApplyPasteText(text);
        }
      }}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        outline: 'none',
      }}
    >
      {/* Grid Action Toolbar */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            data-testid="sql-grid-table-select"
            value={activeTable.id}
            onChange={(e) => onSelectTable(e.target.value)}
            style={toolbarSelectStyle}
          >
            {sqlDocument.tables.map((t) => (
              <option key={t.id} value={t.id}>
                Tabella: {t.name}
              </option>
            ))}
          </select>

          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search
              size={12}
              style={{ position: 'absolute', left: 8, color: 'var(--text-muted)', pointerEvents: 'none' }}
            />
            <input
              data-testid="sql-grid-search-input"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Filtra righe..."
              style={{ ...toolbarSelectStyle, paddingLeft: 24, width: 170 }}
            />
          </div>

          <button
            type="button"
            data-testid="btn-sql-grid-add-row"
            disabled={!canEdit}
            onClick={handleAddRow}
            style={{
              ...toolbarBtnStyle,
              borderColor: 'var(--accent-emerald)',
              background: 'var(--accent-emerald-soft)',
              fontWeight: 600,
            }}
          >
            <Plus size={13} /> Nuova Riga
          </button>

          <button
            type="button"
            data-testid="btn-sql-grid-paste-open"
            disabled={!canEdit}
            onClick={() => setShowPasteBox((v) => !v)}
            style={toolbarBtnStyle}
          >
            <ClipboardPaste size={13} /> Incolla TSV/CSV
          </button>

          <button type="button" onClick={() => void handleCopyTsv()} style={toolbarBtnStyle}>
            <Copy size={13} /> Copia TSV
          </button>

          <button
            type="button"
            data-testid="btn-sql-grid-reload"
            onClick={() => void loadTableRows()}
            style={toolbarBtnStyle}
          >
            <RefreshCw size={12} /> Ricarica
          </button>
        </div>

        {/* Staged Changes Commit Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {stagedChanges.length > 0 && (
            <>
              <span
                data-testid="sql-grid-staged-badge"
                style={{
                  padding: '3px 8px',
                  borderRadius: 999,
                  background: 'var(--accent-amber-soft)',
                  color: 'var(--accent-amber)',
                  fontWeight: 700,
                  fontSize: 11,
                }}
              >
                {stagedChanges.length} modifiche in coda
              </span>

              <button
                type="button"
                data-testid="btn-sql-grid-preview-dml"
                onClick={() => setShowDmlPreview((v) => !v)}
                style={toolbarBtnStyle}
              >
                <Code2 size={13} /> Anteprima SQL DML
              </button>

              <button
                type="button"
                data-testid="btn-sql-grid-discard"
                onClick={() => {
                  setStagedChanges([]);
                  setEditingCell(null);
                  setErrorBanner(null);
                }}
                style={toolbarBtnStyle}
              >
                <RotateCcw size={12} /> Scarta
              </button>
            </>
          )}

          <button
            type="button"
            disabled={stagedChanges.length === 0 || !canEdit}
            data-testid="btn-sql-grid-apply"
            onClick={() => void handleCommitStagedChanges()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 12px',
              borderRadius: 6,
              border: 'none',
              background:
                stagedChanges.length > 0 ? 'var(--accent-emerald)' : 'var(--bg-panel-elevated)',
              color: stagedChanges.length > 0 ? '#fff' : 'var(--text-muted)',
              fontWeight: 700,
              cursor: stagedChanges.length > 0 ? 'pointer' : 'not-allowed',
            }}
          >
            <Check size={13} /> Applica Modifiche ({stagedChanges.length})
          </button>
        </div>
      </div>

      {rowsAvailable && !pkColNames.length && (
        <div role="status" style={{ padding: '6px 12px', color: 'var(--text-muted)', fontSize: 11.5 }}>
          Aggiungi una chiave primaria per modificare o eliminare le righe esistenti dalla griglia.
        </div>
      )}

      {/* Optional TSV/CSV Paste Drawer */}
      {showPasteBox && canEdit && (
        <div
          style={{
            padding: 10,
            background: 'var(--bg-panel-elevated)',
            borderBottom: '1px solid var(--border-strong)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
            Incolla righe copiate da Excel, Google Sheets o CSV (usa <code>\N</code> per NULL esplicito; intestazione colonne rilevata automaticamente):
          </span>
          <textarea
            data-testid="sql-grid-paste-textarea"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={3}
            placeholder={`full_name\temail\ttier\nElena Rossi\telena@studio.it\tpro`}
            style={{
              width: '100%',
              background: 'var(--code-bg)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 6,
              padding: 7,
              fontFamily: "'JetBrains Mono', Consolas, monospace",
              fontSize: 11.5,
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={() => setShowPasteBox(false)} style={toolbarBtnStyle}>
              Annulla
            </button>
            <button
              type="button"
              data-testid="btn-sql-grid-confirm-paste"
              onClick={() => handleApplyPasteText(pasteText)}
              style={{
                ...toolbarBtnStyle,
                background: 'var(--accent-primary)',
                color: '#fff',
                border: 'none',
                fontWeight: 600,
              }}
            >
              Prepara Celle nello Stage
            </button>
          </div>
        </div>
      )}

      {/* Optional Generated DML Preview */}
      {showDmlPreview && dmlStatements.length > 0 && (
        <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border-strong)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11 }}>Script delle operazioni in coda da esportare</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" onClick={() => void copyGridDml()} style={toolbarBtnStyle}>
                <Copy size={12} /> Copia SQL
              </button>
              <button type="button" onClick={() => void saveGridDml()} style={toolbarBtnStyle}>
                <FilePlus2 size={12} /> Salva .sql
              </button>
            </div>
          </div>
          <SqlScriptEditor label="DML da esportare" testId="sql-grid-dml-preview" value={dmlText} rows={4}
            onChange={(text) => setDmlDraft({ generated: generatedDml, text })}
            onSave={() => void saveGridDml()} />
        </div>
      )}

      {errorBanner && (
        <div
          style={{
            padding: '6px 12px',
            background: 'var(--accent-danger-soft)',
            color: 'var(--accent-danger)',
            fontSize: 11.5,
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          {errorBanner}
        </div>
      )}

      {/* Spreadsheet Data Table */}
      <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg-app)' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 12,
            tableLayout: 'fixed',
          }}
        >
          <thead>
            <tr style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg-panel-elevated)' }}>
              <th style={{ ...thStyle, width: 62, textAlign: 'center' }}># / Stato</th>
              {columns.map((col) => (
                <th key={col.id} style={thStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                    <span style={{ fontWeight: 700 }}>
                      {col.primaryKey ? '🔑 ' : ''}
                      {col.name}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>
                      {col.nativeType}
                    </span>
                  </div>
                </th>
              ))}
              <th style={{ ...thStyle, width: 54, textAlign: 'center' }}>Azioni</th>
            </tr>
          </thead>

          <tbody>
            {visibleRows.map((row) => {
              const rowIdx = row.sourceIndex;
              const rowBg =
                row.status === 'inserted'
                  ? 'rgba(16, 185, 129, 0.13)'
                  : row.status === 'updated'
                    ? 'rgba(245, 158, 11, 0.11)'
                    : row.status === 'deleted'
                      ? 'rgba(239, 68, 68, 0.14)'
                      : 'transparent';

              return (
                <tr
                  key={row.rowKeyId}
                  data-testid={`sql-grid-row-${rowIdx}`}
                  style={{
                    background: rowBg,
                    textDecoration: row.status === 'deleted' ? 'line-through' : 'none',
                    opacity: row.status === 'deleted' ? 0.68 : 1,
                  }}
                >
                  <td
                    style={{
                      ...tdStyle,
                      textAlign: 'center',
                      fontSize: 10.5,
                      color: 'var(--text-muted)',
                    }}
                  >
                    {row.status === 'inserted' ? (
                      <span style={{ color: 'var(--accent-emerald)', fontWeight: 700 }}>+NUOVA</span>
                    ) : row.status === 'updated' ? (
                      <span style={{ color: 'var(--accent-amber)', fontWeight: 700 }}>MOD</span>
                    ) : row.status === 'deleted' ? (
                      <span style={{ color: 'var(--accent-danger)', fontWeight: 700 }}>ELIM</span>
                    ) : (
                      rowIdx + 1
                    )}
                  </td>

                  {columns.map((col, colIdx) => {
                    const isFocused =
                      activeCell.row === rowIdx && activeCell.column === colIdx;
                    const isEditing =
                      editingCell?.row === rowIdx && editingCell?.column === colIdx;
                    const rawVal = row.values[col.name];
                    const isCellChanged = row.changedColumns.has(col.name);
                    const isNull = rawVal === null || rawVal === undefined;

                    return (
                      <td
                        key={col.id}
                        data-testid={`sql-grid-cell-${rowIdx}-${col.name}`}
                        onClick={() => setActiveCell({ row: rowIdx, column: colIdx })}
                        onDoubleClick={() => startEditingCell(rowIdx, colIdx)}
                        style={{
                          ...tdStyle,
                          outline: isFocused ? '2px solid var(--accent-primary)' : 'none',
                          outlineOffset: -2,
                          background: isCellChanged ? 'rgba(245, 158, 11, 0.18)' : undefined,
                          cursor: row.status === 'deleted' ? 'not-allowed' : 'cell',
                        }}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            data-testid={`sql-grid-input-${rowIdx}-${col.name}`}
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            onBlur={commitEditingCell}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitEditingCell();
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                setEditingCell(null);
                              }
                            }}
                            style={{
                              width: '100%',
                              border: 'none',
                              outline: 'none',
                              background: 'var(--bg-input)',
                              color: 'var(--text-primary)',
                              padding: '2px 4px',
                              fontSize: 12,
                            }}
                          />
                        ) : col.canonicalType === 'boolean' && row.status !== 'deleted' ? (
                          <input
                            type="checkbox"
                            checked={Boolean(rawVal === true || rawVal === 1 || rawVal === '1')}
                            onChange={(e) => {
                              const next = stageCellEdit(
                                baseRows,
                                stagedChanges,
                                rowIdx,
                                col.name,
                                dialect === 'sqlite' ? (e.target.checked ? 1 : 0) : e.target.checked,
                                pkColNames,
                                allColNames,
                              );
                              setStagedChanges(next);
                            }}
                          />
                        ) : isNull ? (
                          <span
                            onClick={() => startEditingCell(rowIdx, colIdx)}
                            style={{
                              fontSize: 10.5,
                              fontStyle: 'italic',
                              color: 'var(--text-muted)',
                              padding: '1px 5px',
                              borderRadius: 4,
                              background: 'var(--bg-panel-elevated)',
                            }}
                          >
                            {col.autoIncrement && row.status === 'inserted' ? '(auto)' : 'NULL'}
                          </span>
                        ) : (
                          <span
                            onClick={() => {
                              if (isFocused) startEditingCell(rowIdx, colIdx);
                            }}
                            style={{
                              display: 'block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {formatCellForDisplay(rawVal)}
                          </span>
                        )}
                      </td>
                    );
                  })}

                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <button
                      type="button"
                      data-testid={`btn-sql-grid-delete-row-${rowIdx}`}
                      disabled={!canEdit || !canMutateGridRow(row, pkColNames)}
                      title={row.status === 'deleted' ? 'Ripristina riga' : 'Elimina riga'}
                      onClick={() =>
                        setStagedChanges((prev) =>
                          stageDeleteOrRestoreRow(baseRows, prev, rowIdx, pkColNames, allColNames),
                        )
                      }
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color:
                          row.status === 'deleted'
                            ? 'var(--accent-emerald)'
                            : 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: 2,
                      }}
                    >
                      {row.status === 'deleted' ? <Undo2 size={13} /> : <Trash2 size={13} />}
                    </button>
                  </td>
                </tr>
              );
            })}

            {visibleRows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + 2}
                  style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}
                >
                  Nessuna riga presente. Clicca &ldquo;+ Nuova Riga&rdquo; o incolla dati TSV/CSV da Excel.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer Status Bar */}
      <div
        style={{
          padding: '5px 12px',
          background: 'var(--bg-panel)',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
          color: 'var(--text-secondary)',
        }}
      >
        <span>
          {visibleRows.length} righe visualizzate · Doppio clic o Invio per modificare una cella ·{' '}
          <code>NULL</code> o <code>\N</code> per valore nullo
        </span>
        <span>
          Destinazione:{' '}
          <strong>{isSandbox ? 'Sandbox :memory: (Sicura)' : `Connessione ${dialect.toUpperCase()}`}</strong>
        </span>
      </div>
    </div>
  );
};

const toolbarSelectStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 6,
  border: '1px solid var(--border-strong)',
  background: 'var(--bg-input)',
  color: 'var(--text-primary)',
  fontSize: 12,
};

const toolbarBtnStyle: React.CSSProperties = {
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

const thStyle: React.CSSProperties = {
  padding: '7px 10px',
  borderBottom: '1px solid var(--border-strong)',
  borderRight: '1px solid var(--border-subtle)',
  textAlign: 'left',
  fontSize: 11.5,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
};

const tdStyle: React.CSSProperties = {
  padding: '5px 10px',
  borderBottom: '1px solid var(--border-subtle)',
  borderRight: '1px solid var(--border-subtle)',
  height: 31,
  overflow: 'hidden',
};
