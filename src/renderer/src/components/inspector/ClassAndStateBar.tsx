import React, { useState } from 'react';
import { Eye, Pencil, Plus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react';
import { sanitizeCssClassSlug } from '@shared/css-sync-engine';
import type { InteractiveStateKey, ReusableCssClass, UINode, UISheetDocument } from '@shared/ui-ir';
import { useStudioStore } from '@renderer/state/studio-store';

export interface ClassAndStateBarProps {
  node: UINode;
  sheet: UISheetDocument;
  activeState: 'base' | InteractiveStateKey;
  onChangeState: (state: 'base' | InteractiveStateKey) => void;
  editingClassName: string | null;
  onChangeEditingClassName: (className: string | null) => void;
  onResetCurrentState: () => void;
}

const STATE_PILLS: Array<{ key: 'base' | InteractiveStateKey; label: string }> = [
  { key: 'base', label: 'Base' },
  { key: 'hover', label: ':hover' },
  { key: 'active', label: ':active' },
  { key: 'focus', label: ':focus' },
  { key: 'disabled', label: ':disabled' },
];

export const ClassAndStateBar: React.FC<ClassAndStateBarProps> = ({
  node,
  sheet,
  activeState,
  onChangeState,
  editingClassName,
  onChangeEditingClassName,
  onResetCurrentState,
}) => {
  const [newClassDraft, setNewClassDraft] = useState('');

  const simulatedCanvasState = useStudioStore((s) => s.simulatedCanvasState);
  const setSimulatedCanvasState = useStudioStore((s) => s.setSimulatedCanvasState);
  const upsertReusableCssClass = useStudioStore((s) => s.upsertReusableCssClass);
  const deleteReusableCssClass = useStudioStore((s) => s.deleteReusableCssClass);
  const toggleNodeCssClass = useStudioStore((s) => s.toggleNodeCssClass);
  const openSplitMode = useStudioStore((s) => s.openSplitMode);
  const pushToast = useStudioStore((s) => s.pushToast);

  const reusableClasses = sheet.reusableClasses ?? [];
  const attachedClasses = node.classNames ?? node.style.classNames ?? [];

  const handleSelectState = (next: 'base' | InteractiveStateKey) => {
    onChangeState(next);
    setSimulatedCanvasState(next);
  };

  const handleCreateOrAttachClass = async (rawInput?: string) => {
    const slug = sanitizeCssClassSlug(rawInput ?? newClassDraft);
    if (!slug) return;
    const exists = reusableClasses.find((c) => sanitizeCssClassSlug(c.name) === slug);
    if (!exists) {
      const created: ReusableCssClass = {
        id: `rc_${slug}_${Date.now().toString(36)}`,
        name: slug,
        style: structuredClone(node.style),
        typography: node.typography ? structuredClone(node.typography) : undefined,
        stateOverrides: node.stateOverrides ? structuredClone(node.stateOverrides) : undefined,
        states: node.stateOverrides ? structuredClone(node.stateOverrides) : undefined,
      };
      delete created.style?.classNames;
      await upsertReusableCssClass(created);
      pushToast('success', `Classe CSS .${slug} creata dallo stile di "${node.name}"!`);
    }
    if (!attachedClasses.includes(slug)) {
      await toggleNodeCssClass(node.id, slug);
    }
    setNewClassDraft('');
  };

  const hasOverrideOnState = (sk: InteractiveStateKey): boolean => {
    if (editingClassName) {
      const rc = reusableClasses.find((c) => sanitizeCssClassSlug(c.name) === editingClassName);
      return Boolean(rc?.stateOverrides?.[sk] ?? rc?.states?.[sk]);
    }
    return Boolean(node.stateOverrides?.[sk]);
  };

  return (
    <div
      data-testid="inspector-class-state-bar"
      style={{
        padding: '7px 10px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-panel)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {/* Reusable CSS Classes Row */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Classi CSS Riutilizzabili ({attachedClasses.length})
          </span>
          <button
            type="button"
            className="studio-btn sm ghost"
            style={{ height: 19, padding: '0 5px', fontSize: 10 }}
            onClick={() => openSplitMode('split-css')}
            title="Apri Foglio CSS Live"
          >
            <Sparkles size={10} color="var(--accent-violet)" />
            <span>Foglio CSS</span>
          </button>
        </div>

        {/* Attached Class Chips */}
        {attachedClasses.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {attachedClasses.map((cn) => {
              const isEditingThis = editingClassName === cn;
              return (
                <span
                  key={cn}
                  data-testid={`inspector-class-chip-${cn}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 6px',
                    borderRadius: 5,
                    fontSize: 10.5,
                    fontWeight: 600,
                    background: isEditingThis ? 'var(--accent-violet)' : 'var(--accent-violet-soft)',
                    color: isEditingThis ? '#ffffff' : 'var(--accent-violet)',
                    border: '1px solid rgba(139, 92, 246, 0.35)',
                  }}
                >
                  <span>.{cn}</span>
                  <button
                    type="button"
                    onClick={() => onChangeEditingClassName(isEditingThis ? null : cn)}
                    title={
                      isEditingThis
                        ? 'Torna a modificare il singolo elemento'
                        : `Modifica la classe condivisa .${cn} (aggiorna tutti gli elementi collegati)`
                    }
                    style={{
                      border: 'none',
                      background: 'transparent',
                      padding: 0,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      color: 'inherit',
                    }}
                  >
                    <Pencil size={10} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (isEditingThis) onChangeEditingClassName(null);
                      void toggleNodeCssClass(node.id, cn);
                    }}
                    title={`Rimuovi .${cn} da questo elemento`}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      padding: 0,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      color: 'inherit',
                    }}
                  >
                    <X size={10} />
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {/* Add / Attach Class Input */}
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            className="studio-input"
            data-testid="inspector-class-input"
            list="reusable-css-classes-datalist"
            placeholder="es. btn-brand, glass-card..."
            value={newClassDraft}
            onChange={(e) => setNewClassDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleCreateOrAttachClass();
              }
            }}
            style={{ flex: 1, height: 23, fontSize: 11 }}
          />
          <datalist id="reusable-css-classes-datalist">
            {reusableClasses.map((rc) => (
              <option key={rc.id} value={rc.name} />
            ))}
          </datalist>
          <button
            type="button"
            className="studio-btn sm violet"
            data-testid="btn-inspector-add-class"
            onClick={() => void handleCreateOrAttachClass()}
            title="Crea o assegna classe CSS riutilizzabile"
          >
            <Plus size={11} />
            <span>.Classe</span>
          </button>
        </div>

        {/* Available Unattached Sheet Classes Quick Strip */}
        {reusableClasses.some((rc) => !attachedClasses.includes(rc.name)) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>Disponibili:</span>
            {reusableClasses
              .filter((rc) => !attachedClasses.includes(rc.name))
              .map((rc) => (
                <span key={rc.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                  <button
                    type="button"
                    className="studio-btn sm"
                    style={{ height: 19, padding: '0 5px', fontSize: 10 }}
                    onClick={() => void toggleNodeCssClass(node.id, rc.name)}
                    title={`Applica .${rc.name}`}
                  >
                    +.{rc.name}
                  </button>
                  <button
                    type="button"
                    className="row-icon-btn"
                    title={`Elimina classe .${rc.name} dal foglio`}
                    onClick={() => void deleteReusableCssClass(rc.id)}
                  >
                    <Trash2 size={10} />
                  </button>
                </span>
              ))}
          </div>
        )}

        {editingClassName && (
          <div
            style={{
              padding: '3px 7px',
              borderRadius: 5,
              background: 'var(--accent-violet-soft)',
              color: 'var(--accent-violet)',
              fontSize: 10.5,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>✏️ Modifica condivisa attiva su .{editingClassName}</span>
            <button
              type="button"
              className="studio-btn sm ghost"
              style={{ height: 18, padding: '0 5px', fontSize: 10 }}
              onClick={() => onChangeEditingClassName(null)}
            >
              Fine
            </button>
          </div>
        )}
      </div>

      {/* Live Pseudo-State Simulator Bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <div
          className="segmented-group"
          style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}
        >
          {STATE_PILLS.map((pill) => {
            const isAct = activeState === pill.key;
            const hasOv = pill.key !== 'base' && hasOverrideOnState(pill.key);
            return (
              <button
                key={pill.key}
                type="button"
                data-testid={`inspector-state-pill-${pill.key}`}
                className={`segmented-item ${isAct ? 'active' : ''}`}
                onClick={() => handleSelectState(pill.key)}
                style={{ fontSize: 10, padding: '0 3px', position: 'relative' }}
                title={
                  pill.key === 'base'
                    ? 'Stato Base normale'
                    : `Modifica e simula live lo stato ${pill.label} sul Canvas`
                }
              >
                <span>{pill.label}</span>
                {hasOv && (
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: 'var(--accent-violet)',
                      flexShrink: 0,
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {activeState !== 'base' && (
          <>
            <button
              type="button"
              data-testid="btn-toggle-simulate-state"
              className={`studio-btn sm ${simulatedCanvasState === activeState ? 'active' : ''}`}
              style={{ height: 23, padding: '0 5px' }}
              onClick={() => setSimulatedCanvasState(simulatedCanvasState === activeState ? 'base' : activeState)}
              title="Simula lo stato pseudo-CSS direttamente sul Canvas"
            >
              <Eye size={11} />
            </button>
            <button
              type="button"
              data-testid="btn-reset-state-override"
              className="studio-btn sm danger"
              style={{ height: 23, padding: '0 5px' }}
              onClick={onResetCurrentState}
              title={`Azzera override per :${activeState}`}
            >
              <RotateCcw size={11} />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
