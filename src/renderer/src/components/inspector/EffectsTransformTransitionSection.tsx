import React from 'react';
import { Check, Palette, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type {
  CssAnimationSpec,
  CssTransitionSpec,
  FilterSpec,
  InteractiveStateKey,
  StyleSpec,
  Transform2DSpec,
} from '@shared/ui-ir';
import { useStudioStore } from '@renderer/state/studio-store';
import { CollapsibleSection, type InspectorSectionProps } from './inspector-shared';

export interface EffectsTransformTransitionProps extends InspectorSectionProps {
  inlineCssDraft: string;
  onChangeInlineCssDraft: (val: string) => void;
  onApplyInlineCssDraft: (val: string) => void;
  onChangeActiveState: (st: 'base' | InteractiveStateKey) => void;
}

export const EffectsTransformTransitionSection: React.FC<EffectsTransformTransitionProps> = ({
  activeState,
  effectiveStyle,
  applyStylePatch,
  inlineCssDraft,
  onChangeInlineCssDraft,
  onApplyInlineCssDraft,
  onChangeActiveState,
}) => {
  const openSplitMode = useStudioStore((s) => s.openSplitMode);

  const filters: FilterSpec = effectiveStyle.filters ?? {};
  const backdropBlur = effectiveStyle.backdropBlur ?? filters.backdropBlur ?? 0;
  const tf: Transform2DSpec = effectiveStyle.transform ?? {};
  const transitions: CssTransitionSpec[] = effectiveStyle.transitions ?? [];
  const anim: CssAnimationSpec = effectiveStyle.animation ?? { name: 'none', durationMs: 400 };

  const updateFilter = (patch: Partial<FilterSpec>, label = 'Filtro CSS') => {
    const next = { ...filters, ...patch };
    applyStylePatch(
      {
        filters: next,
        ...(patch.backdropBlur !== undefined ? { backdropBlur: patch.backdropBlur } : {}),
      },
      label,
    );
  };

  const updateTransform = (patch: Partial<Transform2DSpec>, label = 'Transform 2D') => {
    applyStylePatch({ transform: { ...tf, ...patch } }, label);
  };

  return (
    <>
      <CollapsibleSection
        title="Effetti, Filtri, Transform 2D & Animazioni"
        testId="inspector-effects-transform-section"
        rightSlot={
          <button
            type="button"
            className="studio-btn sm ghost"
            style={{ height: 20, padding: '0 5px', fontSize: 10 }}
            onClick={() =>
              applyStylePatch(
                { backdropBlur: 0, filters: undefined, transform: undefined, animation: undefined },
                'Reset effetti & transform',
              )
            }
            title="Azzera filtri e transform"
          >
            <RotateCcw size={10} />
          </button>
        }
      >
        {/* Backdrop Blur & CSS Filters */}
        <div className="prop-row">
          <span className="prop-label">Backdrop / Blur</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            <input
              type="number"
              min={0}
              max={64}
              className="studio-input"
              data-testid="inspector-backdrop-blur"
              placeholder="Backdrop px"
              title="backdrop-filter: blur(px)"
              value={backdropBlur || ''}
              onChange={(e) => {
                const b = Math.max(0, Number(e.target.value) || 0);
                updateFilter({ backdropBlur: b }, 'Backdrop Blur');
              }}
            />
            <input
              type="number"
              min={0}
              max={64}
              className="studio-input"
              placeholder="Blur px"
              title="filter: blur(px)"
              value={filters.blur ?? ''}
              onChange={(e) => updateFilter({ blur: Math.max(0, Number(e.target.value) || 0) }, 'Blur')}
            />
          </div>
        </div>

        <div className="prop-row">
          <span className="prop-label">Bright/Contr</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
            <input
              type="number"
              min={0}
              max={250}
              className="studio-input"
              placeholder="Bright %"
              title="brightness(%)"
              value={filters.brightness ?? 100}
              onChange={(e) => updateFilter({ brightness: Number(e.target.value) || 100 }, 'Brightness')}
            />
            <input
              type="number"
              min={0}
              max={250}
              className="studio-input"
              placeholder="Contr %"
              title="contrast(%)"
              value={filters.contrast ?? 100}
              onChange={(e) => updateFilter({ contrast: Number(e.target.value) || 100 }, 'Contrast')}
            />
            <input
              type="number"
              min={0}
              max={100}
              className="studio-input"
              placeholder="Gray %"
              title="grayscale(%)"
              value={filters.grayscale ?? 0}
              onChange={(e) => updateFilter({ grayscale: Math.max(0, Number(e.target.value) || 0) }, 'Grayscale')}
            />
          </div>
        </div>

        {/* 2D Transform */}
        <div
          style={{
            marginTop: 6,
            paddingTop: 6,
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Transform 2D (Translate · Scale · Rotate · Skew)
          </span>

          <div className="prop-row">
            <span className="prop-label">Move X / Y</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <input
                type="number"
                className="studio-input"
                data-testid="inspector-transform-tx"
                placeholder="X px"
                value={tf.translateX ?? 0}
                onChange={(e) => updateTransform({ translateX: Number(e.target.value) || 0, translateXUnit: 'px' })}
              />
              <input
                type="number"
                className="studio-input"
                data-testid="inspector-transform-ty"
                placeholder="Y px"
                value={tf.translateY ?? 0}
                onChange={(e) => updateTransform({ translateY: Number(e.target.value) || 0, translateYUnit: 'px' })}
              />
            </div>
          </div>

          <div className="prop-row">
            <span className="prop-label">Scale / Rot °</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
              <input
                type="number"
                step="0.05"
                className="studio-input"
                data-testid="inspector-transform-scale"
                title="Scale X/Y (1 = 100%)"
                value={tf.scaleX ?? 1}
                onChange={(e) => {
                  const s = Number(e.target.value) || 1;
                  updateTransform({ scaleX: s, scaleY: s }, 'Scale');
                }}
              />
              <input
                type="number"
                className="studio-input"
                data-testid="inspector-transform-rotate"
                title="Rotate (deg)"
                value={tf.rotate ?? 0}
                onChange={(e) => updateTransform({ rotate: Number(e.target.value) || 0 }, 'Rotate')}
              />
              <input
                type="number"
                className="studio-input"
                title="Skew X (deg)"
                value={tf.skewX ?? 0}
                onChange={(e) => updateTransform({ skewX: Number(e.target.value) || 0 }, 'Skew X')}
              />
            </div>
          </div>
        </div>

        {/* Transitions & @keyframes Animation */}
        <div
          style={{
            marginTop: 6,
            paddingTop: 6,
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Transizioni ({transitions.length}) &amp; @keyframes
            </span>
            <button
              type="button"
              className="studio-btn sm"
              data-testid="btn-add-transition"
              style={{ height: 19, padding: '0 6px', fontSize: 10 }}
              onClick={() =>
                applyStylePatch(
                  {
                    transitions: [
                      ...transitions,
                      { property: 'all', durationMs: 200, timing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
                    ],
                  },
                  '+ Transizione CSS',
                )
              }
            >
              <Plus size={10} />
              <span>+ Transizione</span>
            </button>
          </div>

          {transitions.map((tr, idx) => (
            <div key={`tr_${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <select
                className="studio-select"
                style={{ width: 82, padding: '2px 4px', fontSize: 10.5 }}
                value={tr.property}
                onChange={(e) => {
                  const next = transitions.map((item, k) => (k === idx ? { ...item, property: e.target.value } : item));
                  applyStylePatch({ transitions: next }, 'Transition property');
                }}
              >
                <option value="all">all</option>
                <option value="transform">transform</option>
                <option value="opacity">opacity</option>
                <option value="background">background</option>
                <option value="box-shadow">box-shadow</option>
              </select>
              <input
                type="number"
                min={0}
                step={20}
                className="studio-input"
                style={{ width: 52, padding: '2px 4px', fontSize: 10.5 }}
                title="Durata (ms)"
                value={tr.durationMs}
                onChange={(e) => {
                  const next = transitions.map((item, k) =>
                    k === idx ? { ...item, durationMs: Math.max(0, Number(e.target.value) || 0) } : item,
                  );
                  applyStylePatch({ transitions: next }, 'Transition duration');
                }}
              />
              <select
                className="studio-select"
                style={{ flex: 1, padding: '2px 4px', fontSize: 10.5 }}
                value={tr.timing}
                onChange={(e) => {
                  const next = transitions.map((item, k) => (k === idx ? { ...item, timing: e.target.value } : item));
                  applyStylePatch({ transitions: next }, 'Transition timing');
                }}
              >
                <option value="ease">ease</option>
                <option value="ease-out">ease-out</option>
                <option value="ease-in-out">ease-in-out</option>
                <option value="linear">linear</option>
                <option value="cubic-bezier(0.16, 1, 0.3, 1)">spring</option>
              </select>
              <button
                type="button"
                className="row-icon-btn"
                onClick={() =>
                  applyStylePatch({ transitions: transitions.filter((_, k) => k !== idx) }, 'Rimuovi transizione')
                }
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}

          {/* @keyframes Animation Picker */}
          <div className="prop-row">
            <span className="prop-label">Animazione</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <select
                className="studio-select"
                data-testid="inspector-animation-name"
                style={{ flex: 1 }}
                value={anim.name}
                onChange={(e) => {
                  const name = e.target.value;
                  applyStylePatch(
                    {
                      animation:
                        name === 'none'
                          ? undefined
                          : {
                              name,
                              durationMs: anim.durationMs || 500,
                              timing: anim.timing || 'ease',
                              iterationCount: name === 'pulse' || name === 'spin' || name === 'bounce' ? 'infinite' : 1,
                              fillMode: 'both',
                            },
                    },
                    `Animazione ${name}`,
                  );
                }}
              >
                <option value="none">Nessuna</option>
                <option value="fade-in">fade-in</option>
                <option value="slide-up">slide-up</option>
                <option value="slide-down">slide-down</option>
                <option value="scale-in">scale-in</option>
                <option value="pulse">pulse (loop)</option>
                <option value="spin">spin (loop)</option>
                <option value="bounce">bounce (loop)</option>
              </select>
              {anim.name !== 'none' && (
                <input
                  type="number"
                  step={50}
                  className="studio-input"
                  style={{ width: 58, padding: '2px 4px', fontSize: 10.5 }}
                  title="Durata animazione (ms)"
                  value={anim.durationMs}
                  onChange={(e) =>
                    applyStylePatch(
                      { animation: { ...anim, durationMs: Math.max(50, Number(e.target.value) || 400) } },
                      'Durata animazione',
                    )
                  }
                />
              )}
            </div>
          </div>

          {/* Cursor & Pointer Events */}
          <div className="prop-row">
            <span className="prop-label">Cursor / Ptr</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <select
                className="studio-select"
                data-testid="inspector-cursor"
                value={effectiveStyle.cursor ?? 'auto'}
                onChange={(e) =>
                  applyStylePatch({ cursor: e.target.value as StyleSpec['cursor'] }, 'Cursor')
                }
              >
                <option value="auto">cursor: auto</option>
                <option value="pointer">pointer</option>
                <option value="default">default</option>
                <option value="grab">grab</option>
                <option value="text">text</option>
                <option value="move">move</option>
                <option value="not-allowed">not-allowed</option>
              </select>
              <select
                className="studio-select"
                value={effectiveStyle.pointerEvents ?? 'auto'}
                onChange={(e) =>
                  applyStylePatch({ pointerEvents: e.target.value as StyleSpec['pointerEvents'] }, 'Pointer Events')
                }
              >
                <option value="auto">events: auto</option>
                <option value="none">events: none</option>
              </select>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* Quick CSS Inline / :hover Raw Editor (Preserving all v2.1 testids) */}
      <div className="prop-group" data-testid="inspector-css-section">
        <div className="prop-group-title">
          <span>💅 CSS Inline / Stato (:hover)</span>
          <button
            type="button"
            className="studio-btn sm violet"
            data-testid="btn-inspector-open-css-split"
            onClick={() => openSplitMode('split-css')}
            title="Apri l'Editor CSS Completo affiancato al Canvas"
          >
            <Palette size={11} />
            <span>Editor CSS</span>
          </button>
        </div>

        <div
          className="segmented-group"
          style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 6 }}
        >
          {(['base', 'hover', 'active', 'focus'] as const).map((st) => (
            <button
              key={st}
              type="button"
              className={`segmented-item ${activeState === st ? 'active' : ''}`}
              data-testid={`inspector-css-state-${st}`}
              onClick={() => onChangeActiveState(st)}
            >
              {st === 'base' ? 'Base' : `:${st}`}
            </button>
          ))}
        </div>

        <textarea
          className="studio-textarea"
          data-testid="inspector-custom-css"
          rows={4}
          spellCheck={false}
          placeholder={
            activeState === 'base'
              ? 'es. box-shadow: 0 12px 28px rgba(0,0,0,0.3);\ntransform: translateY(-1px);'
              : `Regole per :${activeState}, es.\nbackground: #1d4ed8;\ntransform: scale(1.02);`
          }
          value={inlineCssDraft}
          onChange={(e) => onChangeInlineCssDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              onApplyInlineCssDraft(inlineCssDraft);
            }
          }}
          style={{
            width: '100%',
            fontFamily: "'JetBrains Mono', Consolas, monospace",
            fontSize: 11,
            lineHeight: 1.45,
            marginBottom: 6,
          }}
        />

        <button
          type="button"
          className="studio-btn sm primary"
          data-testid="btn-inspector-apply-css"
          style={{ width: '100%' }}
          onClick={() => onApplyInlineCssDraft(inlineCssDraft)}
        >
          <Check size={11} />
          <span>Applica CSS ({activeState === 'base' ? 'Base' : `:${activeState}`})</span>
        </button>
      </div>
    </>
  );
};
