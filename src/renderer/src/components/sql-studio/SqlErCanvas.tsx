import React, { useMemo, useRef, useState } from 'react';
import {
  Crosshair,
  FileUp,
  KeyRound,
  Link2,
  Plus,
  Table2,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { defaultSchemaForDialect, equalSqlIdentifiers, mapCanonicalToNativeType } from '@shared/sql-dialects';
import { mergeImportedTablesIntoDocument } from '@shared/sql-import';
import type { SqlDesignDocument, SqlDialect, SqlTableDef } from '@shared/sql-ir';

export interface SqlErCanvasProps {
  document: SqlDesignDocument;
  dialect: SqlDialect;
  selectedTableId: string | null;
  onSelectTable: (tableId: string) => void;
  onUpdateDocument: (next: SqlDesignDocument, silent?: boolean) => void;
}

const CARD_W = 290;
const CARD_HEADER_H = 38;
const COL_ROW_H = 26;

interface ErWire {
  id: string;
  label: string;
  path: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const SqlErCanvas: React.FC<SqlErCanvasProps> = ({
  document: sqlDoc,
  dialect,
  selectedTableId,
  onSelectTable,
  onUpdateDocument,
}) => {
  const [pan, setPan] = useState({ x: 24, y: 20 });
  const [zoom, setZoom] = useState(0.95);
  const [isImportModalOpen, setImportModalOpen] = useState(false);
  const [importSqlText, setImportSqlText] = useState('');
  const [replaceOnImport, setReplaceOnImport] = useState(false);
  const [importFeedback, setImportFeedback] = useState<string | null>(null);

  const dragStateRef = useRef<{
    mode: 'pan' | 'card';
    tableId?: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const handlePointerDownStage = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-er-card="true"]')) return;
    dragStateRef.current = {
      mode: 'pan',
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: pan.x,
      origY: pan.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMoveStage = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;

    if (drag.mode === 'pan') {
      setPan({ x: drag.origX + dx, y: drag.origY + dy });
    } else if (drag.mode === 'card' && drag.tableId) {
      const nextX = Math.max(16, Math.round((drag.origX + dx / zoom) / 8) * 8);
      const nextY = Math.max(16, Math.round((drag.origY + dy / zoom) / 8) * 8);
      onUpdateDocument(
        {
          ...sqlDoc,
          tables: sqlDoc.tables.map((t) =>
            t.id === drag.tableId ? { ...t, position: { x: nextX, y: nextY } } : t,
          ),
        },
        true,
      );
    }
  };

  const handlePointerUpStage = () => {
    dragStateRef.current = null;
  };

  const handleStartCardDrag = (e: React.PointerEvent, tbl: SqlTableDef) => {
    e.stopPropagation();
    onSelectTable(tbl.id);
    dragStateRef.current = {
      mode: 'card',
      tableId: tbl.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: tbl.position.x,
      origY: tbl.position.y,
    };
  };

  const handleAddNewTable = () => {
    const idx = sqlDoc.tables.length + 1;
    let candidateName = idx === 1 ? 'items' : `table_${idx}`;
    while (sqlDoc.tables.some((t) => equalSqlIdentifiers(dialect, t.name, candidateName))) {
      candidateName = `table_${idx}_${Math.random().toString(36).slice(2, 4)}`;
    }
    const idNative = mapCanonicalToNativeType('integer', dialect, { autoIncrement: true });
    const nameNative = mapCanonicalToNativeType('varchar', dialect, { length: 160 });
    const createdNative = mapCanonicalToNativeType('datetime', dialect);

    const newTbl: SqlTableDef = {
      id: `tbl_${Date.now().toString(36)}_${idx}`,
      schema: defaultSchemaForDialect(dialect),
      name: candidateName,
      position: {
        x: 64 + ((idx - 1) % 3) * 340,
        y: 64 + Math.floor((idx - 1) / 3) * 260,
      },
      columns: [
        {
          id: `col_${Date.now().toString(36)}_id`,
          name: 'id',
          canonicalType: 'integer',
          nativeType: idNative,
          nullable: false,
          primaryKey: true,
          unique: true,
          autoIncrement: true,
        },
        {
          id: `col_${Date.now().toString(36)}_title`,
          name: 'title',
          canonicalType: 'varchar',
          nativeType: nameNative,
          length: 160,
          nullable: false,
          primaryKey: false,
          unique: false,
          autoIncrement: false,
        },
        {
          id: `col_${Date.now().toString(36)}_created`,
          name: 'created_at',
          canonicalType: 'datetime',
          nativeType: createdNative,
          nullable: false,
          primaryKey: false,
          unique: false,
          autoIncrement: false,
          defaultValue: dialect === 'sqlserver' ? 'SYSUTCDATETIME()' : 'CURRENT_TIMESTAMP',
        },
      ],
      foreignKeys: [],
      indexes: [],
      checks: [],
    };

    const nextDoc: SqlDesignDocument = {
      ...sqlDoc,
      tables: [...sqlDoc.tables, newTbl],
      updatedAt: Date.now(),
    };
    onUpdateDocument(nextDoc);
    onSelectTable(newTbl.id);
  };

  const handleDeleteTable = (e: React.MouseEvent, tableId: string) => {
    e.stopPropagation();
    const removed = sqlDoc.tables.find((table) => table.id === tableId);
    if (!removed) return;
    const nextTables = sqlDoc.tables.filter((t) => t.id !== tableId);
    const previous = removed.baselineSnapshot;
    onUpdateDocument({
      ...sqlDoc,
      tables: nextTables,
      removedTables: previous
        ? [...(sqlDoc.removedTables ?? []), { id: removed.id, name: previous.name, schema: previous.schema }]
        : sqlDoc.removedTables,
      updatedAt: Date.now(),
    });
    if (selectedTableId === tableId && nextTables[0]) {
      onSelectTable(nextTables[0].id);
    }
  };

  const handleConfirmDdlImport = () => {
    if (!importSqlText.trim()) return;
    const merged = mergeImportedTablesIntoDocument(sqlDoc, importSqlText, {
      replaceExisting: replaceOnImport,
      overrideDialect: dialect,
    });
    if (merged.importedCount > 0) {
      onUpdateDocument(merged.document);
      if (merged.document.tables[0]) {
        onSelectTable(merged.document.tables[merged.document.tables.length - 1].id);
      }
      setImportFeedback(
        `Importate ${merged.importedCount} tabelle (${merged.document.dialect})${
          merged.issues.length > 0 ? ` · ${merged.issues.length} avvisi` : ''
        }.`,
      );
      if (merged.issues.length === 0) {
        setImportModalOpen(false);
        setImportSqlText('');
      }
    } else {
      setImportFeedback(
        merged.issues[0]?.message ?? 'Nessuna istruzione CREATE TABLE trovata nello script.',
      );
    }
  };

  const wires = useMemo<ErWire[]>(() => {
    const out: ErWire[] = [];
    for (const srcTbl of sqlDoc.tables) {
      for (const fk of srcTbl.foreignKeys) {
        const dstTbl = sqlDoc.tables.find((t) =>
          equalSqlIdentifiers(dialect, t.name, fk.referencedTable),
        );
        if (!dstTbl) continue;

        const srcColIdx = Math.max(
          0,
          srcTbl.columns.findIndex((c) => equalSqlIdentifiers(dialect, c.name, fk.columns[0] ?? '')),
        );
        const dstColIdx = Math.max(
          0,
          dstTbl.columns.findIndex((c) =>
            equalSqlIdentifiers(dialect, c.name, fk.referencedColumns[0] ?? 'id'),
          ),
        );

        const srcCenterX = srcTbl.position.x + CARD_W / 2;
        const dstCenterX = dstTbl.position.x + CARD_W / 2;
        const srcRightSide = srcCenterX <= dstCenterX;

        const x1 = srcRightSide ? srcTbl.position.x + CARD_W : srcTbl.position.x;
        const y1 = srcTbl.position.y + CARD_HEADER_H + 8 + srcColIdx * COL_ROW_H + COL_ROW_H / 2;
        const x2 = srcRightSide ? dstTbl.position.x : dstTbl.position.x + CARD_W;
        const y2 = dstTbl.position.y + CARD_HEADER_H + 8 + dstColIdx * COL_ROW_H + COL_ROW_H / 2;

        const ctrlOffset = Math.max(54, Math.abs(x2 - x1) * 0.45);
        const cx1 = srcRightSide ? x1 + ctrlOffset : x1 - ctrlOffset;
        const cx2 = srcRightSide ? x2 - ctrlOffset : x2 + ctrlOffset;

        out.push({
          id: `${srcTbl.id}_${fk.id}`,
          label: `${srcTbl.name}.${fk.columns.join(',')} → ${dstTbl.name}.${fk.referencedColumns.join(',')}`,
          path: `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`,
          x1,
          y1,
          x2,
          y2,
        });
      }
    }
    return out;
  }, [sqlDoc.tables, dialect]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, position: 'relative' }}>
      {/* Sub-toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '6px 12px',
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            data-testid="btn-sql-add-table"
            onClick={handleAddNewTable}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 10px',
              borderRadius: 6,
              border: '1px solid var(--accent-primary)',
              background: 'var(--accent-soft)',
              color: 'var(--text-primary)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Plus size={13} /> Nuova Tabella
          </button>

          <button
            type="button"
            data-testid="btn-sql-open-import-ddl"
            onClick={() => {
              setImportFeedback(null);
              setImportModalOpen((v) => !v);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 10px',
              borderRadius: 6,
              border: '1px solid var(--border-strong)',
              background: 'var(--bg-panel-elevated)',
              cursor: 'pointer',
            }}
          >
            <FileUp size={13} /> Importa .sql DDL
          </button>

          <span style={{ fontSize: 11.5, color: 'var(--text-muted)', marginLeft: 6 }}>
            {sqlDoc.tables.length} tabelle · {wires.length} relazioni FK
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            title="Riduci Zoom"
            onClick={() => setZoom((z) => Math.max(0.45, Number((z - 0.1).toFixed(2))))}
            style={iconBtnStyle}
          >
            <ZoomOut size={13} />
          </button>
          <span style={{ minWidth: 44, textAlign: 'center', fontSize: 11, color: 'var(--text-secondary)' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            title="Aumenta Zoom"
            onClick={() => setZoom((z) => Math.min(1.6, Number((z + 0.1).toFixed(2))))}
            style={iconBtnStyle}
          >
            <ZoomIn size={13} />
          </button>
          <button
            type="button"
            title="Ripristina Vista"
            onClick={() => {
              setPan({ x: 24, y: 20 });
              setZoom(0.95);
            }}
            style={iconBtnStyle}
          >
            <Crosshair size={13} />
          </button>
        </div>
      </div>

      {/* Inline DDL Importer Drawer */}
      {isImportModalOpen && (
        <div
          data-testid="sql-import-ddl-panel"
          style={{
            padding: 12,
            background: 'var(--bg-panel-elevated)',
            borderBottom: '1px solid var(--border-strong)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <strong style={{ fontSize: 12 }}>
              Importa definizioni SQL DDL (CREATE TABLE / INDEX / ALTER TABLE · SQLite, Postgres, MySQL, MariaDB, T-SQL)
            </strong>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
              <input
                type="checkbox"
                checked={replaceOnImport}
                onChange={(e) => setReplaceOnImport(e.target.checked)}
              />
              Sostituisci tabelle esistenti
            </label>
          </div>
          <textarea
            data-testid="sql-import-ddl-textarea"
            value={importSqlText}
            onChange={(e) => setImportSqlText(e.target.value)}
            placeholder={`CREATE TABLE products (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  sku VARCHAR(64) NOT NULL UNIQUE,\n  price DECIMAL(10,2) NOT NULL DEFAULT 0.00\n);`}
            rows={5}
            style={{
              width: '100%',
              background: 'var(--code-bg)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 6,
              padding: 8,
              fontFamily: "'JetBrains Mono', Consolas, monospace",
              fontSize: 12,
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11.5, color: 'var(--accent-amber)' }}>{importFeedback ?? ''}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                style={{
                  padding: '5px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle)',
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              >
                Chiudi
              </button>
              <button
                type="button"
                data-testid="btn-sql-confirm-import-ddl"
                onClick={handleConfirmDdlImport}
                style={{
                  padding: '5px 12px',
                  borderRadius: 6,
                  border: 'none',
                  background: 'var(--accent-primary)',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Analizza e Importa nel Diagramma ER
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interactive ER Canvas Stage */}
      <div
        onPointerDown={handlePointerDownStage}
        onPointerMove={handlePointerMoveStage}
        onPointerUp={handlePointerUpStage}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          background: 'var(--bg-stage)',
          backgroundImage: 'radial-gradient(var(--stage-dot) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
          cursor: 'grab',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 3200,
            height: 2200,
            transformOrigin: '0 0',
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          {/* SVG Relationship Wires */}
          <svg
            width={3200}
            height={2200}
            style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', overflow: 'visible' }}
          >
            {wires.map((w) => (
              <g key={w.id}>
                <path
                  d={w.path}
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  strokeDasharray="none"
                  opacity={0.85}
                />
                {/* Crow's foot / FK origin dot */}
                <circle cx={w.x1} cy={w.y1} r={4} fill="#f59e0b" />
                {/* Referenced PK target diamond */}
                <circle cx={w.x2} cy={w.y2} r={4.5} fill="#10b981" />
                <title>{w.label}</title>
              </g>
            ))}
          </svg>

          {/* Draggable Table Cards */}
          {sqlDoc.tables.map((tbl) => {
            const isSelected = tbl.id === selectedTableId;
            const fkColSet = new Set(
              tbl.foreignKeys.flatMap((fk) => fk.columns.map((c) => c.toLowerCase())),
            );
            return (
              <div
                key={tbl.id}
                data-er-card="true"
                data-testid={`sql-er-card-${tbl.name}`}
                onClick={() => onSelectTable(tbl.id)}
                style={{
                  position: 'absolute',
                  left: tbl.position.x,
                  top: tbl.position.y,
                  width: CARD_W,
                  borderRadius: 10,
                  background: 'var(--bg-panel)',
                  border: isSelected
                    ? '2px solid var(--accent-primary)'
                    : '1px solid var(--border-strong)',
                  boxShadow: isSelected
                    ? '0 0 0 3px var(--accent-soft), var(--shadow-lg)'
                    : 'var(--shadow-md)',
                  overflow: 'hidden',
                  userSelect: 'none',
                }}
              >
                {/* Header */}
                <div
                  onPointerDown={(e) => handleStartCardDrag(e, tbl)}
                  style={{
                    height: CARD_HEADER_H,
                    padding: '0 10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: isSelected ? 'var(--accent-soft)' : 'var(--bg-panel-elevated)',
                    borderBottom: '1px solid var(--border-subtle)',
                    cursor: 'move',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <Table2 size={13} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: 12.5,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {tbl.schema ? `${tbl.schema}.` : ''}
                      {tbl.name}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                      {tbl.columns.length} col
                    </span>
                    {sqlDoc.tables.length > 1 && (
                      <button
                        type="button"
                        title={`Elimina tabella ${tbl.name}`}
                        onClick={(e) => handleDeleteTable(e, tbl.id)}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: 'var(--text-muted)',
                          padding: 2,
                          cursor: 'pointer',
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Columns List */}
                <div style={{ padding: '6px 0' }}>
                  {tbl.columns.map((col) => {
                    const isFk = fkColSet.has(col.name.toLowerCase());
                    return (
                      <div
                        key={col.id}
                        style={{
                          height: COL_ROW_H,
                          padding: '0 10px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 6,
                          fontSize: 11.5,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                          {col.primaryKey ? (
                            <KeyRound size={11} style={{ color: '#f59e0b', flexShrink: 0 }} />
                          ) : isFk ? (
                            <Link2 size={11} style={{ color: '#60a5fa', flexShrink: 0 }} />
                          ) : (
                            <span style={{ width: 11, display: 'inline-block' }} />
                          )}
                          <span
                            style={{
                              fontWeight: col.primaryKey ? 600 : 400,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {col.name}
                          </span>
                          {!col.nullable && !col.primaryKey && (
                            <span style={{ color: 'var(--accent-danger)', fontSize: 10 }}>*</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                          {col.autoIncrement && (
                            <span
                              style={{
                                fontSize: 9.5,
                                padding: '0 4px',
                                borderRadius: 4,
                                background: 'var(--accent-violet-soft)',
                                color: 'var(--accent-violet)',
                              }}
                            >
                              AI
                            </span>
                          )}
                          {col.unique && !col.primaryKey && (
                            <span
                              style={{
                                fontSize: 9.5,
                                padding: '0 4px',
                                borderRadius: 4,
                                background: 'var(--accent-emerald-soft)',
                                color: 'var(--accent-emerald)',
                              }}
                            >
                              UQ
                            </span>
                          )}
                          <span
                            style={{
                              fontSize: 10.5,
                              fontFamily: "'JetBrains Mono', Consolas, monospace",
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {col.nativeType}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const iconBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  borderRadius: 5,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-panel-elevated)',
  cursor: 'pointer',
};
