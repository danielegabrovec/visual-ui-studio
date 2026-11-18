import React, { useMemo, useState } from 'react';
import { LayoutTemplate, Sparkles, Table2, Workflow, X } from 'lucide-react';
import type { ScriptLanguage } from '@shared/automation-types';
import type { SqlDesignDocument, SqlTableDef } from '@shared/sql-ir';
import { getSqlFormColumns, mapSqlColumnToUiControl, synthesizeCrudUiFromSqlTable } from '@shared/sql-to-ui-bridge';
import { useStudioStore } from '@renderer/state/studio-store';

export interface SqlToUiWizardModalProps {
  sqlDocument: SqlDesignDocument;
  initialTableId?: string | null;
  onClose: () => void;
}

export const SqlToUiWizardModal: React.FC<SqlToUiWizardModalProps> = ({
  sqlDocument,
  initialTableId,
  onClose,
}) => {
  const activeSheetId = useStudioStore((s) => s.activeSheetId);
  const sheetDocuments = useStudioStore((s) => s.sheetDocuments);
  const studioTheme = useStudioStore((s) => s.studioTheme);
  const project = useStudioStore((s) => s.project);
  const generateUiFromSqlTableAction = useStudioStore((s) => s.generateUiFromSqlTableAction);
  const saveSqlSchemaAction = useStudioStore((s) => s.saveSqlSchemaAction);
  const applyLayoutPreset = useStudioStore((s) => s.applyLayoutPreset);

  const defaultScriptLang: ScriptLanguage =
    project?.primaryLanguage === 'python'
      ? 'python'
      : project?.primaryLanguage === 'typescript'
        ? 'typescript'
        : 'javascript';

  const [selectedTableId, setSelectedTableId] = useState<string>(
    initialTableId ?? sqlDocument.tables[0]?.id ?? '',
  );
  const [includeForm, setIncludeForm] = useState(true);
  const [includeDataTable, setIncludeDataTable] = useState(true);
  const [includeSearchBar, setIncludeSearchBar] = useState(true);
  const [includeDeleteControl, setIncludeDeleteControl] = useState(true);
  const [scriptLanguage, setScriptLanguage] = useState<ScriptLanguage>(defaultScriptLang);
  const [openCanvasAfter, setOpenCanvasAfter] = useState(true);
  const [generating, setGenerating] = useState(false);

  const selectedTable: SqlTableDef | undefined = useMemo(
    () =>
      sqlDocument.tables.find((t) => t.id === selectedTableId) ?? sqlDocument.tables[0],
    [sqlDocument.tables, selectedTableId],
  );

  const previewMappings = useMemo(() => {
    if (!selectedTable) return [];
    return getSqlFormColumns(selectedTable)
      .map((col) => mapSqlColumnToUiControl(col, selectedTable, sqlDocument));
  }, [selectedTable, sqlDocument]);

  const handleConfirmGenerate = async () => {
    if (!selectedTable) return;
    setGenerating(true);
    try {
      const activeSheet = sheetDocuments[activeSheetId];
      const synthesized = synthesizeCrudUiFromSqlTable({
        table: selectedTable,
        sqlDocument,
        sheet: activeSheet,
        includeForm,
        includeDataTable,
        includeSearchBar,
        includeDeleteControl,
        scriptLanguage,
        studioTheme,
      });

      // Merge standard CRUD named queries into `sqlDocument.namedQueries` so automations resolve them
      const existingQrys = sqlDocument.namedQueries ?? [];
      const mergedQrys = [...existingQrys];
      for (const nq of synthesized.namedQueries) {
        const idx = mergedQrys.findIndex((q) => q.id === nq.id || q.name === nq.name);
        if (idx >= 0) mergedQrys[idx] = nq;
        else mergedQrys.push(nq);
      }
      await saveSqlSchemaAction({ ...sqlDocument, namedQueries: mergedQrys }, true);

      await generateUiFromSqlTableAction({
        tableName: selectedTable.name,
        ops: synthesized.ops,
        automations: synthesized.automations,
        stateEntries: synthesized.stateEntries,
      });

      if (openCanvasAfter) {
        applyLayoutPreset('canvas');
      }
      onClose();
    } finally {
      setGenerating(false);
    }
  };

  if (!selectedTable) return null;

  return (
    <div
      data-testid="sql-to-ui-modal"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1250,
        background: 'rgba(5, 8, 16, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          width: 680,
          maxWidth: '96vw',
          maxHeight: '90vh',
          overflowY: 'auto',
          borderRadius: 14,
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-strong)',
          boxShadow: 'var(--shadow-lg)',
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={18} style={{ color: 'var(--accent-violet)' }} />
            <h3 style={{ margin: 0, fontSize: 15 }}>
              Tabella SQL → Genera Interfaccia UI CRUD + Automazioni No-Code
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-panel-elevated)',
              borderRadius: 6,
              width: 28,
              height: 28,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <X size={15} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={lblStyle}>
            <span>Tabella SQL Sorgente</span>
            <select
              data-testid="sql-ui-wizard-table-select"
              value={selectedTable.id}
              onChange={(e) => setSelectedTableId(e.target.value)}
              style={selStyle}
            >
              {sqlDocument.tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.columns.length} colonne · {t.foreignKeys.length} FK)
                </option>
              ))}
            </select>
          </label>

          <label style={lblStyle}>
            <span>Linguaggio Funzioni Automazione Generate</span>
            <select
              data-testid="sql-ui-wizard-lang-select"
              value={scriptLanguage}
              onChange={(e) => setScriptLanguage(e.target.value as ScriptLanguage)}
              style={selStyle}
            >
              <option value="javascript">JavaScript (.js)</option>
              <option value="typescript">TypeScript (.ts)</option>
              <option value="python">Python (.py)</option>
            </select>
          </label>
        </div>

        {/* Component Options */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 8,
            padding: 12,
            borderRadius: 10,
            background: 'var(--bg-panel-elevated)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <label style={chkRowStyle}>
            <input
              type="checkbox"
              checked={includeForm}
              onChange={(e) => setIncludeForm(e.target.checked)}
            />
            <LayoutTemplate size={13} style={{ color: 'var(--accent-primary)' }} />
            Form Inserimento / Modifica Tipizzato
          </label>

          <label style={chkRowStyle}>
            <input
              type="checkbox"
              checked={includeDataTable}
              onChange={(e) => setIncludeDataTable(e.target.checked)}
            />
            <Table2 size={13} style={{ color: 'var(--accent-emerald)' }} />
            Tabella Dati con Righe Seed Live
          </label>

          <label style={chkRowStyle}>
            <input
              type="checkbox"
              checked={includeSearchBar}
              onChange={(e) => setIncludeSearchBar(e.target.checked)}
            />
            Barra di Ricerca Rapida + Bottone Aggiorna
          </label>

          <label style={chkRowStyle}>
            <input
              type="checkbox"
              checked={includeDeleteControl}
              onChange={(e) => setIncludeDeleteControl(e.target.checked)}
            />
            Controllo Elimina Record per ID
          </label>
        </div>

        {/* Column -> Control Mapping Preview */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <strong style={{ fontSize: 12 }}>
            Mappatura Automatica Colonne SQL → Controlli UI ({previewMappings.length} campi form)
          </strong>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 6,
            }}
          >
            {previewMappings.map((m) => (
              <div
                key={m.column.id}
                style={{
                  padding: '6px 10px',
                  borderRadius: 8,
                  background: 'var(--bg-panel-elevated)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: 11.5,
                }}
              >
                <div style={{ fontWeight: 600 }}>{m.labelText}</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                  <code>{m.column.nativeType}</code> → <strong>{m.controlType}</strong>
                  {m.options ? ` (${m.options.length} opzioni)` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Generated Automations Summary */}
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 10,
            background: 'var(--accent-soft)',
            border: '1px solid var(--border-focus)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 11.5,
          }}
        >
          <Workflow size={16} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
          <div>
            <strong>Automazioni collegate al Canvas</strong>
            <div>Caricamento dati, inserimento dal form, aggiornamento e rimozione tramite chiave primaria.</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
          <label style={chkRowStyle}>
            <input
              type="checkbox"
              checked={openCanvasAfter}
              onChange={(e) => setOpenCanvasAfter(e.target.checked)}
            />
            Passa subito al Canvas dopo la generazione
          </label>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '7px 14px',
                borderRadius: 7,
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              Annulla
            </button>
            <button
              type="button"
              disabled={generating || (!includeForm && !includeDataTable)}
              data-testid="btn-sql-confirm-generate-ui"
              onClick={() => void handleConfirmGenerate()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 16px',
                borderRadius: 7,
                border: 'none',
                background: 'var(--accent-violet)',
                color: '#fff',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <Sparkles size={14} /> Genera Form + Tabella UI sul Canvas
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const lblStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 11.5,
  color: 'var(--text-secondary)',
};

const selStyle: React.CSSProperties = {
  padding: '6px 9px',
  borderRadius: 6,
  border: '1px solid var(--border-strong)',
  background: 'var(--bg-input)',
  color: 'var(--text-primary)',
  fontSize: 12,
};

const chkRowStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  cursor: 'pointer',
};
