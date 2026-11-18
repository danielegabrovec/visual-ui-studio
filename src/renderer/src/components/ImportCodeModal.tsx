import React, { useMemo, useState } from 'react';
import { Code2, FileUp, Layers, Sparkles, X } from 'lucide-react';
import {
  importMarkupToPatchOps,
  previewMarkupImport,
  type MarkupImportFormat,
} from '@shared/markup-importer';
import type { NodeId } from '@shared/ui-ir';
import { useStudioStore } from '@renderer/state/studio-store';

interface SamplePreset {
  id: string;
  testId: string;
  label: string;
  format: MarkupImportFormat;
  markup: string;
}

const SAMPLE_IMPORT_PRESETS: SamplePreset[] = [
  {
    id: 'tailwind-card',
    testId: 'preset-import-tailwind-card',
    label: 'Card Tailwind',
    format: 'html',
    markup: `<section class="flex flex-col gap-4 p-6 bg-slate-900 rounded-2xl border border-slate-700 shadow-lg">
  <div class="flex flex-row justify-between items-center gap-3">
    <span class="px-3 py-1 rounded-full bg-blue-600 text-white text-xs font-semibold">PRO ENTERPRISE</span>
    <span class="text-emerald-400 text-sm font-bold">€49 / mese</span>
  </div>
  <h2 class="text-xl font-bold text-slate-50">Piano Architettura Multi-Target</h2>
  <p class="text-sm text-slate-300">Compilazione istantanea verso 26 framework Web, Desktop, Mobile ed Embedded.</p>
  <button class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold">Attiva Piano Pro</button>
</section>`,
  },
  {
    id: 'htmx-search',
    testId: 'preset-import-htmx-form',
    label: 'Form Ricerca HTMX',
    format: 'html',
    markup: `<div class="flex flex-col gap-4 p-5 bg-slate-900 rounded-xl border border-slate-700">
  <h3 class="text-base font-bold text-slate-100">Ricerca Catalogo Live (HTMX)</h3>
  <form hx-post="/api/catalog/search" hx-target="#htmx-live-results" hx-swap="innerHTML" class="flex flex-row gap-3 items-center">
    <input type="text" name="query" placeholder="Cerca SKU, GPU o modulo..." aria-label="Termini di ricerca" class="px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100" />
    <button type="submit" class="px-4 py-2 bg-violet-600 text-white rounded-lg font-semibold">Cerca Ora</button>
  </form>
  <div id="htmx-live-results" class="flex flex-col gap-2 p-3 bg-slate-950 rounded-lg border border-slate-800">
    <span class="text-xs text-slate-400">I risultati hypermedia verranno iniettati qui...</span>
  </div>
</div>`,
  },
  {
    id: 'svg-badge',
    testId: 'preset-import-svg-badge',
    label: 'Icona/Badge SVG',
    format: 'svg',
    markup: `<svg width="180" height="52" viewBox="0 0 180 52" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Badge Stato Sistema Attivo">
  <rect x="2" y="2" width="176" height="48" rx="12" fill="#0F172A" stroke="#3B82F6" stroke-width="2" />
  <circle cx="26" cy="26" r="8" fill="#10B981" />
  <path d="M22.5 26L25 28.5L30 23.5" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  <text x="44" y="30" fill="#F8FAFC" font-family="Inter, sans-serif" font-size="13" font-weight="700">SQLite WAL Ready</text>
</svg>`,
  },
];

export const ImportCodeModal: React.FC = () => {
  const isOpen = useStudioStore((s) => s.isImportCodeModalOpen);
  const activeSheetId = useStudioStore((s) => s.activeSheetId);
  const sheetDocuments = useStudioStore((s) => s.sheetDocuments);
  const selectedNodeIds = useStudioStore((s) => s.selectedNodeIds);

  const setImportCodeModalOpen = useStudioStore((s) => s.setImportCodeModalOpen);
  const commitOps = useStudioStore((s) => s.commitOps);
  const selectNode = useStudioStore((s) => s.selectNode);
  const pushToast = useStudioStore((s) => s.pushToast);

  const [markup, setMarkup] = useState<string>(SAMPLE_IMPORT_PRESETS[0].markup);
  const [format, setFormat] = useState<MarkupImportFormat>('auto');
  const [targetParentOverride, setTargetParentOverride] = useState<string>('__auto__');

  const sheet = sheetDocuments[activeSheetId];

  const containerCandidates = useMemo(() => {
    if (!sheet) return [];
    return Object.values(sheet.nodes).filter(
      (n) => n.kind === 'artboard' || n.kind === 'container' || n.kind === 'collection',
    );
  }, [sheet]);

  const resolvedParentId: NodeId | null = useMemo(() => {
    if (!sheet) return null;
    if (targetParentOverride !== '__auto__' && sheet.nodes[targetParentOverride]) {
      return targetParentOverride;
    }
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
  }, [sheet, targetParentOverride, selectedNodeIds]);

  const preview = useMemo(() => {
    if (!sheet || !markup.trim()) {
      return {
        detectedFormat: 'html' as const,
        ops: [],
        nodeCount: 0,
        rootNodeIds: [] as NodeId[],
        warnings: markup.trim() ? [] : ['Incolla un frammento HTML, Tailwind, HTMX, React JSX o SVG.'],
      };
    }
    return previewMarkupImport(sheet, resolvedParentId, markup, format);
  }, [sheet, resolvedParentId, markup, format]);

  if (!isOpen) return null;

  const handleConfirmImport = async () => {
    if (!sheet || !markup.trim()) return;
    const ops = importMarkupToPatchOps(sheet, resolvedParentId, markup, format);
    if (ops.length === 0) {
      pushToast('warn', 'Nessun nodo valido trovato nel codice incollato.');
      return;
    }

    await commitOps(ops, `Importa Codice (${preview.detectedFormat.toUpperCase()})`, 'code_sync');
    const firstRoot = ops[0]?.op === 'insert_node' ? ops[0].node.id : preview.rootNodeIds[0];
    if (firstRoot) {
      selectNode(firstRoot);
    }
    setImportCodeModalOpen(false);
    pushToast(
      'success',
      `Importati ${ops.length} nodi modificabili sul Canvas (Annulla disponibile con Ctrl+Z)!`,
    );
  };

  return (
    <div className="modal-backdrop" onClick={() => setImportCodeModalOpen(false)}>
      <div
        className="modal-card"
        data-testid="import-code-modal"
        style={{ width: 'min(780px, 94vw)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-header)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileUp size={16} color="var(--accent-primary)" />
            <strong style={{ fontSize: 14 }}>📥 Importa Codice nel Canvas (Code-to-Canvas Reverse Importer)</strong>
          </div>
          <button
            type="button"
            className="studio-btn sm"
            data-testid="btn-close-import-code"
            onClick={() => setImportCodeModalOpen(false)}
          >
            <X size={13} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
          {/* Quick Presets + Format Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
                Preset rapidi:
              </span>
              {SAMPLE_IMPORT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="studio-btn sm violet"
                  data-testid={preset.testId}
                  onClick={() => {
                    setFormat('auto');
                    setMarkup(preset.markup);
                  }}
                >
                  <Sparkles size={11} />
                  <span>{preset.label}</span>
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Formato:</span>
                <select
                  className="studio-select"
                  data-testid="import-format-select"
                  value={format}
                  onChange={(e) => setFormat(e.target.value as MarkupImportFormat)}
                  style={{ height: 26 }}
                >
                  <option value="auto">Auto-Detect ({preview.detectedFormat.toUpperCase()})</option>
                  <option value="html">HTML / Tailwind / HTMX</option>
                  <option value="jsx">React JSX / TSX</option>
                  <option value="svg">SVG Vettoriale</option>
                </select>
              </label>

              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Destinazione:</span>
                <select
                  className="studio-select"
                  data-testid="import-parent-select"
                  value={targetParentOverride}
                  onChange={(e) => setTargetParentOverride(e.target.value)}
                  style={{ height: 26, maxWidth: 180 }}
                >
                  <option value="__auto__">
                    Automatica ({resolvedParentId && sheet?.nodes[resolvedParentId]?.name ? sheet.nodes[resolvedParentId].name : 'Artboard'})
                  </option>
                  {containerCandidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.kind})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {/* Code Input Textarea */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Code2 size={13} />
              Incolla HTML5, classi Tailwind CSS, attributi HTMX (<code>hx-get</code> / <code>hx-post</code> / <code>hx-target</code>), React JSX o <code>&lt;svg&gt;</code>:
            </span>
            <textarea
              className="studio-textarea"
              data-testid="import-code-textarea"
              value={markup}
              onChange={(e) => setMarkup(e.target.value)}
              rows={11}
              spellCheck={false}
              placeholder="<div class=&quot;flex flex-col gap-4 p-6 bg-slate-900 rounded-xl&quot;>...</div>"
              style={{
                fontFamily: "'JetBrains Mono', Consolas, monospace",
                fontSize: 12,
                lineHeight: 1.5,
                resize: 'vertical',
              }}
            />
          </label>

          {/* Live AST Preview Summary */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 8,
              padding: '9px 12px',
              borderRadius: 8,
              background: 'var(--bg-panel-elevated)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Layers size={14} color="var(--accent-primary)" />
              <strong data-testid="import-preview-node-count" style={{ fontSize: 12.5 }}>
                {preview.nodeCount} nodi UI-IR pronti per l&apos;inserimento
              </strong>
              <span className="badge blue">Formato rilevato: {preview.detectedFormat.toUpperCase()}</span>
              <span className="badge green">Auto-Layout &amp; Stili estratti</span>
            </div>

            {preview.warnings.length > 0 && (
              <span style={{ fontSize: 11, color: 'var(--accent-amber)' }}>
                ⚠️ {preview.warnings[0]}
              </span>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              className="studio-btn"
              onClick={() => setImportCodeModalOpen(false)}
            >
              Annulla
            </button>
            <button
              type="button"
              className="studio-btn primary"
              data-testid="btn-confirm-import-code"
              disabled={preview.nodeCount === 0}
              onClick={() => void handleConfirmImport()}
            >
              <FileUp size={13} />
              <span>Inserisci {preview.nodeCount} Nodi nel Canvas</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
