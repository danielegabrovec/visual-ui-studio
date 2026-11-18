import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Crosshair,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import {
  auditSheetAccessibilityAndLayout,
  type AuditCategory,
  type AuditIssue,
} from '@shared/a11y-auditor';
import { useStudioStore } from '@renderer/state/studio-store';

const CATEGORY_LABELS: Record<'all' | AuditCategory, string> = {
  all: 'Tutte',
  contrast: 'Contrasto WCAG',
  'touch-target': 'Touch Target',
  'missing-label': 'Etichette ARIA',
  'freeform-overlap': 'Sovrapposizioni',
  'responsive-overflow': 'Overflow Viewport',
};

export const A11yAuditModal: React.FC = () => {
  const isOpen = useStudioStore((s) => s.isA11yModalOpen);
  const project = useStudioStore((s) => s.project);
  const activeSheetId = useStudioStore((s) => s.activeSheetId);
  const sheetDocuments = useStudioStore((s) => s.sheetDocuments);
  const tokens = useStudioStore((s) => s.tokens);
  const selectedNodeIds = useStudioStore((s) => s.selectedNodeIds);

  const setA11yModalOpen = useStudioStore((s) => s.setA11yModalOpen);
  const selectNode = useStudioStore((s) => s.selectNode);
  const commitOps = useStudioStore((s) => s.commitOps);
  const pushToast = useStudioStore((s) => s.pushToast);

  const [activeCategory, setActiveCategory] = useState<'all' | AuditCategory>('all');

  const sheet = sheetDocuments[activeSheetId];

  const report = useMemo(() => {
    if (!sheet) {
      return {
        score: 100,
        issues: [] as AuditIssue[],
        autoFixPatches: [],
        countsByCategory: {
          contrast: 0,
          'touch-target': 0,
          'missing-label': 0,
          'freeform-overlap': 0,
          'responsive-overflow': 0,
        },
      };
    }
    return auditSheetAccessibilityAndLayout(sheet, tokens, project?.activeThemeId ?? null);
  }, [sheet, tokens, project?.activeThemeId]);

  if (!isOpen) return null;

  const filteredIssues =
    activeCategory === 'all'
      ? report.issues
      : report.issues.filter((i) => i.category === activeCategory);

  const scoreColor =
    report.score >= 90
      ? 'var(--accent-emerald)'
      : report.score >= 70
        ? 'var(--accent-amber)'
        : 'var(--accent-danger)';

  const handleApplyAutoFix = async () => {
    if (report.autoFixPatches.length === 0) return;
    const count = report.autoFixPatches.length;
    await commitOps(report.autoFixPatches, 'Auto-Fix Accessibilità WCAG 2.2 & Layout', 'layout_solver');
    pushToast(
      'success',
      `Applicati ${count} fix automatici WCAG 2.2 & Layout sul foglio attivo!`,
    );
  };

  return (
    <div className="modal-backdrop" onClick={() => setA11yModalOpen(false)}>
      <div
        className="modal-card"
        data-testid="a11y-audit-modal"
        style={{ width: 'min(820px, 94vw)' }}
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
            <ShieldCheck size={16} color="var(--accent-emerald)" />
            <strong style={{ fontSize: 14 }}>
              🛡️ Audit Accessibilità WCAG 2.2 &amp; Responsive Layout ({sheet?.name ?? 'Foglio'})
            </strong>
          </div>
          <button
            type="button"
            className="studio-btn sm"
            data-testid="btn-close-a11y-audit"
            onClick={() => setA11yModalOpen(false)}
          >
            <X size={13} />
          </button>
        </div>

        {/* Summary Score & 1-Click Auto-Fix Banner */}
        <div
          style={{
            padding: '14px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-panel-elevated)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              data-testid="a11y-health-score"
              style={{
                width: 58,
                height: 58,
                borderRadius: '50%',
                border: `3px solid ${scoreColor}`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--bg-panel)',
                flexShrink: 0,
              }}
            >
              <strong style={{ fontSize: 18, lineHeight: 1, color: scoreColor }}>{report.score}</strong>
              <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>/ 100</span>
            </div>

            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                {report.issues.length === 0
                  ? 'Conformità WCAG 2.2 AA & Layout Ottimale!'
                  : `${report.issues.length} rilievi rilevati sul foglio "${sheet?.name ?? ''}"`}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                Controllo deterministico su contrasto luminanza sRGB, touch target (&ge; 36px), ARIA label, collisioni Freeform e overflow Artboard.
              </div>
            </div>
          </div>

          <button
            type="button"
            className="studio-btn primary"
            data-testid="btn-apply-a11y-autofix"
            disabled={report.autoFixPatches.length === 0}
            onClick={() => void handleApplyAutoFix()}
            style={{ height: 32, padding: '0 14px' }}
          >
            <Sparkles size={14} />
            <span>
              {report.autoFixPatches.length > 0
                ? `✨ Applica Fix Automatici (${report.autoFixPatches.length})`
                : '✨ Applica Fix Automatici (0)'}
            </span>
          </button>
        </div>

        {/* Category Filter Tabs */}
        <div
          style={{
            padding: '8px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
            background: 'var(--bg-panel)',
          }}
        >
          {(Object.keys(CATEGORY_LABELS) as Array<'all' | AuditCategory>).map((cat) => {
            const count =
              cat === 'all' ? report.issues.length : report.countsByCategory[cat] ?? 0;
            const isAct = activeCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                className={`studio-btn sm ${isAct ? 'active' : ''}`}
                data-testid={`a11y-filter-${cat}`}
                onClick={() => setActiveCategory(cat)}
              >
                <span>{CATEGORY_LABELS[cat]}</span>
                <span className={`badge ${count > 0 ? 'amber' : 'green'}`}>{count}</span>
              </button>
            );
          })}
        </div>

        {/* Findings List */}
        <div
          data-testid="a11y-issues-list"
          style={{
            padding: 16,
            overflowY: 'auto',
            maxHeight: '52vh',
            display: 'flex',
            flexDirection: 'column',
            gap: 9,
          }}
        >
          {filteredIssues.length === 0 ? (
            <div
              style={{
                padding: '28px 16px',
                textAlign: 'center',
                borderRadius: 10,
                border: '1px dashed var(--border-strong)',
                background: 'var(--bg-panel-elevated)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <CheckCircle2 size={28} color="var(--accent-emerald)" />
              <strong style={{ fontSize: 13.5 }}>Nessun problema trovato in questa categoria!</strong>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Tutti i controlli e i testi rispettano le soglie WCAG 2.2 AA e i vincoli di layout responsivo.
              </span>
            </div>
          ) : (
            filteredIssues.map((issue) => {
              const isNodeSelected = selectedNodeIds.includes(issue.nodeId);
              return (
                <div
                  key={issue.id}
                  data-testid={`a11y-issue-${issue.category}`}
                  onClick={() => selectNode(issue.nodeId)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 9,
                    border: `1px solid ${isNodeSelected ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                    background: 'var(--bg-panel-elevated)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <AlertTriangle
                        size={13}
                        color={issue.severity === 'error' ? 'var(--accent-danger)' : 'var(--accent-amber)'}
                      />
                      <strong style={{ fontSize: 12.5 }}>{issue.title}</strong>
                      <span className={`badge ${issue.severity === 'error' ? 'amber' : 'blue'}`}>
                        {issue.wcagRule}
                      </span>
                      <span className="badge violet">Nodo: {issue.nodeName}</span>
                    </div>

                    <button
                      type="button"
                      className="studio-btn sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        selectNode(issue.nodeId);
                        setA11yModalOpen(false);
                      }}
                      title="Seleziona nodo sul Canvas e chiudi finestra"
                    >
                      <Crosshair size={11} />
                      <span>Seleziona nel Canvas</span>
                    </button>
                  </div>

                  <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>{issue.message}</div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-secondary)' }}>
                    {issue.measuredValue && (
                      <span>
                        Rilevato: <code>{issue.measuredValue}</code>
                      </span>
                    )}
                    {issue.expectedValue && (
                      <span>
                        Atteso: <code>{issue.expectedValue}</code>
                      </span>
                    )}
                    <span style={{ color: 'var(--accent-emerald)' }}>💡 {issue.suggestion}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
