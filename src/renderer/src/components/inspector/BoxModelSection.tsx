import React, { useState } from 'react';
import { AlignHorizontalSpaceAround, Lock, Unlock } from 'lucide-react';
import { isTokenRef, resolveTokenOrValue, type MarginBox, type MarginSideValue, type PaddingBox } from '@shared/ui-ir';
import { useStudioStore } from '@renderer/state/studio-store';
import { CollapsibleSection, type InspectorSectionProps } from './inspector-shared';

export const BoxModelSection: React.FC<InspectorSectionProps> = ({
  tokens,
  tokenMap,
  effectiveLayout,
  effectiveStyle,
  applyLayoutPatch,
}) => {
  const [lockedSides, setLockedSides] = useState(false);
  const setHoveredBoxModelOverlay = useStudioStore((s) => s.setHoveredBoxModelOverlay);

  const spaceTokens = tokens.filter((t) => t.themeId === null && t.category === 'spacing');

  const margin: MarginBox = effectiveLayout.margin ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const padding: PaddingBox = effectiveLayout.padding ?? { top: 0, right: 0, bottom: 0, left: 0 };

  const formatMarginVal = (v: MarginSideValue): string => {
    if (v === 'auto') return 'auto';
    return String(resolveTokenOrValue(v, tokenMap, 0));
  };

  const parseMarginInput = (raw: string): MarginSideValue => {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === 'auto' || trimmed === 'a') return 'auto';
    const num = Number(trimmed);
    return Number.isFinite(num) ? Math.round(num) : 0;
  };

  const updateMarginSide = (side: keyof MarginBox, raw: string) => {
    const val = parseMarginInput(raw);
    const next: MarginBox = lockedSides
      ? { top: val, right: val, bottom: val, left: val }
      : { ...margin, [side]: val };
    applyLayoutPatch({ margin: next }, `Margin ${side}`);
  };

  const updatePaddingSide = (side: keyof PaddingBox, raw: string) => {
    const num = Math.max(0, Math.round(Number(raw) || 0));
    const next: PaddingBox = lockedSides
      ? { top: num, right: num, bottom: num, left: num }
      : { ...padding, [side]: num };
    applyLayoutPatch({ padding: next }, `Padding ${side}`);
  };

  const isHorizontalAuto = margin.left === 'auto' && margin.right === 'auto';

  const handleToggleAutoCenter = () => {
    const next: MarginBox = isHorizontalAuto
      ? { ...margin, left: 0, right: 0 }
      : { ...margin, left: 'auto', right: 'auto' };
    applyLayoutPatch({ margin: next }, 'Margin 0 auto');
  };

  const borderSummary = (() => {
    if (!effectiveStyle.border || effectiveStyle.border.style === 'none') return '0px';
    if (typeof effectiveStyle.border.width === 'object' && !isTokenRef(effectiveStyle.border.width)) {
      return `${effectiveStyle.border.width.top}px`;
    }
    return `${resolveTokenOrValue(effectiveStyle.border.width, tokenMap, 1)}px`;
  })();

  const miniInputStyle: React.CSSProperties = {
    width: 42,
    height: 20,
    padding: '0 3px',
    textAlign: 'center',
    fontSize: 10.5,
    borderRadius: 4,
    border: '1px solid var(--border-subtle)',
    background: 'var(--bg-input)',
    color: 'var(--text-primary)',
    fontFamily: "'JetBrains Mono', Consolas, monospace",
  };

  return (
    <CollapsibleSection
      title="Box Model (Margin & Padding)"
      testId="inspector-box-model-section"
      rightSlot={
        <div style={{ display: 'flex', gap: 3 }}>
          <button
            type="button"
            data-testid="btn-boxmodel-margin-auto"
            className={`studio-btn sm ${isHorizontalAuto ? 'active' : ''}`}
            style={{ height: 20, padding: '0 5px', fontSize: 10 }}
            onClick={handleToggleAutoCenter}
            title="Imposta margin-left: auto; margin-right: auto; per centrare l'elemento"
          >
            <AlignHorizontalSpaceAround size={10} />
            <span>auto</span>
          </button>
          <button
            type="button"
            data-testid="btn-boxmodel-lock"
            className={`studio-btn sm ${lockedSides ? 'active' : ''}`}
            style={{ height: 20, padding: '0 5px' }}
            onClick={() => setLockedSides((v) => !v)}
            title={lockedSides ? 'Lati collegati (uniforme)' : '4 lati indipendenti'}
          >
            {lockedSides ? <Lock size={10} /> : <Unlock size={10} />}
          </button>
        </div>
      }
    >
      {/* Concentric Webflow / DevTools Box Model Diagram */}
      <div
        onMouseLeave={() => setHoveredBoxModelOverlay(null)}
        style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
      >
        {/* OUTER MARGIN BOX (Amber/Orange) */}
        <div
          onMouseEnter={() => setHoveredBoxModelOverlay('margin')}
          style={{
            border: '1px dashed rgba(245, 158, 11, 0.55)',
            background: 'rgba(245, 158, 11, 0.08)',
            borderRadius: 8,
            padding: '5px 6px',
            position: 'relative',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 3,
              left: 6,
              fontSize: 9,
              fontWeight: 700,
              color: 'var(--accent-amber)',
              letterSpacing: '0.04em',
            }}
          >
            MARGIN
          </span>

          {/* Margin Top */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
            <input
              data-testid="boxmodel-margin-top"
              style={miniInputStyle}
              value={formatMarginVal(margin.top)}
              onChange={(e) => updateMarginSide('top', e.target.value)}
              title="margin-top (numero px o 'auto')"
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
            {/* Margin Left */}
            <input
              data-testid="boxmodel-margin-left"
              style={miniInputStyle}
              value={formatMarginVal(margin.left)}
              onChange={(e) => updateMarginSide('left', e.target.value)}
              title="margin-left (numero px o 'auto')"
            />

            {/* INNER PADDING BOX (Emerald Green) */}
            <div
              onMouseEnter={(e) => {
                e.stopPropagation();
                setHoveredBoxModelOverlay('padding');
              }}
              style={{
                flex: 1,
                border: '1px solid rgba(16, 185, 129, 0.55)',
                background: 'rgba(16, 185, 129, 0.09)',
                borderRadius: 6,
                padding: '5px 6px',
                position: 'relative',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  left: 5,
                  fontSize: 8.5,
                  fontWeight: 700,
                  color: 'var(--accent-emerald)',
                }}
              >
                PADDING
              </span>
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  right: 5,
                  fontSize: 8.5,
                  color: 'var(--text-muted)',
                }}
                title="Spessore bordo attivo"
              >
                B:{borderSummary}
              </span>

              {/* Padding Top */}
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
                <input
                  type="number"
                  data-testid="boxmodel-padding-top"
                  style={miniInputStyle}
                  value={Number(resolveTokenOrValue(padding.top, tokenMap, 0))}
                  onChange={(e) => updatePaddingSide('top', e.target.value)}
                  title="padding-top (px)"
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                {/* Padding Left */}
                <input
                  type="number"
                  data-testid="boxmodel-padding-left"
                  style={miniInputStyle}
                  value={Number(resolveTokenOrValue(padding.left, tokenMap, 0))}
                  onChange={(e) => updatePaddingSide('left', e.target.value)}
                  title="padding-left (px)"
                />

                {/* Center Content Readout */}
                <div
                  style={{
                    flex: 1,
                    minWidth: 52,
                    height: 22,
                    borderRadius: 4,
                    background: 'var(--bg-panel-elevated)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 9.5,
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    fontFamily: "'JetBrains Mono', Consolas, monospace",
                  }}
                >
                  {Math.round(effectiveLayout.frame.width)}×{Math.round(effectiveLayout.frame.height)}
                </div>

                {/* Padding Right */}
                <input
                  type="number"
                  data-testid="boxmodel-padding-right"
                  style={miniInputStyle}
                  value={Number(resolveTokenOrValue(padding.right, tokenMap, 0))}
                  onChange={(e) => updatePaddingSide('right', e.target.value)}
                  title="padding-right (px)"
                />
              </div>

              {/* Padding Bottom */}
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
                <input
                  type="number"
                  data-testid="boxmodel-padding-bottom"
                  style={miniInputStyle}
                  value={Number(resolveTokenOrValue(padding.bottom, tokenMap, 0))}
                  onChange={(e) => updatePaddingSide('bottom', e.target.value)}
                  title="padding-bottom (px)"
                />
              </div>
            </div>

            {/* Margin Right */}
            <input
              data-testid="boxmodel-margin-right"
              style={miniInputStyle}
              value={formatMarginVal(margin.right)}
              onChange={(e) => updateMarginSide('right', e.target.value)}
              title="margin-right (numero px o 'auto')"
            />
          </div>

          {/* Margin Bottom */}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
            <input
              data-testid="boxmodel-margin-bottom"
              style={miniInputStyle}
              value={formatMarginVal(margin.bottom)}
              onChange={(e) => updatePaddingOrMarginBottom(margin, lockedSides, applyLayoutPatch, e.target.value, parseMarginInput)}
              title="margin-bottom (numero px o 'auto')"
            />
          </div>
        </div>

        {/* Quick Spacing Token Preset */}
        {spaceTokens.length > 0 && (
          <div className="prop-row" style={{ marginTop: 2 }}>
            <span className="prop-label">Token Padding</span>
            <select
              className="studio-select"
              value={isTokenRef(padding.top) ? padding.top.$token : ''}
              onChange={(e) => {
                if (!e.target.value) return;
                const tok = { $token: e.target.value };
                applyLayoutPatch({ padding: { top: tok, right: tok, bottom: tok, left: tok } }, 'Bind token padding');
              }}
            >
              <option value="">Valori custom (px)</option>
              {spaceTokens.map((st) => (
                <option key={st.id} value={st.tokenPath}>
                  ${st.tokenPath} ({st.rawValue}px)
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
};

function updatePaddingOrMarginBottom(
  margin: MarginBox,
  lockedSides: boolean,
  applyLayoutPatch: (patch: Partial<import('@shared/ui-ir').LayoutSpec>, label: string) => void,
  raw: string,
  parseMarginInput: (r: string) => MarginSideValue,
) {
  const val = parseMarginInput(raw);
  const next: MarginBox = lockedSides
    ? { top: val, right: val, bottom: val, left: val }
    : { ...margin, bottom: val };
  applyLayoutPatch({ margin: next }, 'Margin bottom');
}
