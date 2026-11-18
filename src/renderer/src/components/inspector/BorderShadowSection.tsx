import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { isTokenRef, resolveTokenOrValue, type BorderSideSpec, type StyleShadow } from '@shared/ui-ir';
import { CollapsibleSection, toSafeHexColor, type InspectorSectionProps } from './inspector-shared';

const SHADOW_PRESETS: Array<{ label: string; shadows: StyleShadow[] }> = [
  { label: 'Soft SM', shadows: [{ x: 0, y: 4, blur: 12, spread: -2, color: 'rgba(15, 23, 42, 0.22)' }] },
  {
    label: 'Card MD',
    shadows: [
      { x: 0, y: 12, blur: 28, spread: -4, color: 'rgba(15, 23, 42, 0.34)' },
      { x: 0, y: 1, blur: 0, spread: 0, color: 'rgba(255, 255, 255, 0.08)', inset: true },
    ],
  },
  { label: 'Neon Glow', shadows: [{ x: 0, y: 0, blur: 24, spread: 0, color: 'rgba(59, 130, 246, 0.55)' }] },
  { label: 'Inner Inset', shadows: [{ x: 0, y: 2, blur: 6, spread: 0, color: 'rgba(0, 0, 0, 0.45)', inset: true }] },
];

export const BorderShadowSection: React.FC<InspectorSectionProps> = ({
  tokenMap,
  effectiveStyle,
  applyStylePatch,
}) => {
  const isCornerObj = typeof effectiveStyle.radius === 'object' && !isTokenRef(effectiveStyle.radius);
  const [fourCorners, setFourCorners] = useState<boolean>(isCornerObj);
  const [perSideBorders, setPerSideBorders] = useState<boolean>(Boolean(effectiveStyle.border?.sides));

  const uniformRadius = isCornerObj
    ? (effectiveStyle.radius as { tl: number; tr: number; br: number; bl: number }).tl
    : Number(resolveTokenOrValue(effectiveStyle.radius, tokenMap, 0));

  const corners = isCornerObj
    ? (effectiveStyle.radius as { tl: number; tr: number; br: number; bl: number })
    : { tl: uniformRadius, tr: uniformRadius, br: uniformRadius, bl: uniformRadius };

  const border = effectiveStyle.border ?? { width: 0, style: 'none' as const, color: '#334155' };
  const borderWidthNum =
    typeof border.width === 'object' && !isTokenRef(border.width)
      ? border.width.top
      : Number(resolveTokenOrValue(border.width, tokenMap, 1));
  const borderColorStr = String(resolveTokenOrValue(border.color, tokenMap, '#334155'));

  const outline = effectiveStyle.outline;
  const shadows: StyleShadow[] = effectiveStyle.shadows ?? [];

  const updateShadowAt = (idx: number, patch: Partial<StyleShadow>) => {
    const next = shadows.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    applyStylePatch({ shadows: next }, 'Modifica ombra');
  };

  return (
    <CollapsibleSection title="Bordi, Raggio 4-Angoli & Ombre" testId="inspector-border-shadow-section">
      {/* Border Radius: Uniform vs 4-Corners */}
      <div className="prop-row">
        <span className="prop-label">Raggio (px)</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            type="number"
            min={0}
            className="studio-input"
            data-testid="inspector-border-radius"
            style={{ flex: 1 }}
            value={uniformRadius}
            onChange={(e) => {
              const r = Math.max(0, Number(e.target.value) || 0);
              applyStylePatch(
                { radius: fourCorners ? { tl: r, tr: r, br: r, bl: r } : r },
                'Border radius',
              );
            }}
          />
          <button
            type="button"
            className={`studio-btn sm ${fourCorners ? 'active' : ''}`}
            data-testid="btn-toggle-4corners"
            onClick={() => setFourCorners((v) => !v)}
            title="Modifica i 4 angoli separatamente (TL, TR, BR, BL)"
          >
            ⌜⌝ 4 Angoli
          </button>
        </div>
      </div>

      {fourCorners && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 4, marginBottom: 6 }}>
          {(['tl', 'tr', 'br', 'bl'] as const).map((corner) => (
            <input
              key={corner}
              type="number"
              min={0}
              className="studio-input"
              data-testid={`inspector-radius-${corner}`}
              title={`Raggio angolo ${corner.toUpperCase()}`}
              style={{ padding: '3px 4px', textAlign: 'center', fontSize: 10.5 }}
              value={corners[corner]}
              onChange={(e) => {
                const next = { ...corners, [corner]: Math.max(0, Number(e.target.value) || 0) };
                applyStylePatch({ radius: next }, `Raggio ${corner}`);
              }}
            />
          ))}
        </div>
      )}

      {/* Border Uniform vs Per-Side */}
      <div className="prop-row">
        <span className="prop-label">Bordo</span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <select
            className="studio-select"
            data-testid="inspector-border-style"
            style={{ flex: 1 }}
            value={border.style}
            onChange={(e) => {
              const st = e.target.value as typeof border.style;
              applyStylePatch(
                {
                  border: {
                    ...border,
                    width: st === 'none' ? 0 : borderWidthNum || 1,
                    style: st,
                    color: border.color ?? '#334155',
                  },
                },
                'Stile bordo',
              );
            }}
          >
            <option value="none">Nessuno</option>
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
            <option value="double">Double</option>
          </select>
          {border.style !== 'none' && (
            <>
              <input
                type="number"
                min={0}
                max={24}
                className="studio-input"
                style={{ width: 44, padding: '2px 4px' }}
                value={borderWidthNum}
                onChange={(e) =>
                  applyStylePatch(
                    { border: { ...border, width: Math.max(0, Number(e.target.value) || 0) } },
                    'Spessore bordo',
                  )
                }
              />
              <input
                type="color"
                value={toSafeHexColor(borderColorStr, '#334155')}
                onChange={(e) => applyStylePatch({ border: { ...border, color: e.target.value } }, 'Colore bordo')}
                style={{ width: 22, height: 22, border: 'none', padding: 0, background: 'transparent' }}
              />
            </>
          )}
          <button
            type="button"
            className={`studio-btn sm ${perSideBorders ? 'active' : ''}`}
            style={{ padding: '0 5px' }}
            onClick={() => setPerSideBorders((v) => !v)}
            title="Bordi indipendenti per lato (Top, Right, Bottom, Left)"
          >
            4L
          </button>
        </div>
      </div>

      {perSideBorders && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
          {(['top', 'right', 'bottom', 'left'] as const).map((side) => {
            const sSpec: BorderSideSpec = border.sides?.[side] ?? {
              width: 0,
              style: 'none',
              color: '#334155',
            };
            return (
              <div key={side} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 10, width: 38, color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                  {side}
                </span>
                <select
                  className="studio-select"
                  style={{ width: 72, padding: '2px 4px', fontSize: 10.5 }}
                  value={sSpec.style}
                  onChange={(e) => {
                    const st = e.target.value as BorderSideSpec['style'];
                    applyStylePatch(
                      {
                        border: {
                          ...border,
                          sides: {
                            ...(border.sides ?? {}),
                            [side]: {
                              width: st === 'none' ? 0 : Number(resolveTokenOrValue(sSpec.width, tokenMap, 1)) || 1,
                              style: st,
                              color: sSpec.color,
                            },
                          },
                        },
                      },
                      `Border ${side}`,
                    );
                  }}
                >
                  <option value="none">none</option>
                  <option value="solid">solid</option>
                  <option value="dashed">dashed</option>
                  <option value="dotted">dotted</option>
                </select>
                {sSpec.style !== 'none' && (
                  <>
                    <input
                      type="number"
                      min={1}
                      className="studio-input"
                      style={{ width: 44, padding: '2px 4px', fontSize: 10.5 }}
                      value={Number(resolveTokenOrValue(sSpec.width, tokenMap, 1))}
                      onChange={(e) =>
                        applyStylePatch(
                          {
                            border: {
                              ...border,
                              sides: {
                                ...(border.sides ?? {}),
                                [side]: { ...sSpec, width: Math.max(0, Number(e.target.value) || 1) },
                              },
                            },
                          },
                          `Border ${side} width`,
                        )
                      }
                    />
                    <input
                      type="color"
                      value={toSafeHexColor(String(resolveTokenOrValue(sSpec.color, tokenMap, '#3b82f6')))}
                      onChange={(e) =>
                        applyStylePatch(
                          {
                            border: {
                              ...border,
                              sides: {
                                ...(border.sides ?? {}),
                                [side]: { ...sSpec, color: e.target.value },
                              },
                            },
                          },
                          `Border ${side} color`,
                        )
                      }
                      style={{ width: 20, height: 20, border: 'none', padding: 0, background: 'transparent' }}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Outline / Focus Ring */}
      <div className="prop-row">
        <span className="prop-label">Outline</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <select
            className="studio-select"
            style={{ flex: 1 }}
            value={outline?.style ?? 'none'}
            onChange={(e) => {
              const st = e.target.value as NonNullable<typeof outline>['style'];
              applyStylePatch(
                {
                  outline:
                    st === 'none'
                      ? undefined
                      : { width: outline?.width ?? 2, style: st, color: outline?.color ?? '#3b82f6', offset: outline?.offset ?? 2 },
                },
                'Outline',
              );
            }}
          >
            <option value="none">Nessuno</option>
            <option value="solid">Solid Ring</option>
            <option value="dashed">Dashed Ring</option>
          </select>
          {outline && outline.style !== 'none' && (
            <>
              <input
                type="number"
                className="studio-input"
                style={{ width: 42, padding: '2px 4px' }}
                title="Outline offset (px)"
                value={outline.offset ?? 2}
                onChange={(e) =>
                  applyStylePatch({ outline: { ...outline, offset: Number(e.target.value) || 0 } }, 'Outline offset')
                }
              />
              <input
                type="color"
                value={toSafeHexColor(String(resolveTokenOrValue(outline.color, tokenMap, '#3b82f6')))}
                onChange={(e) =>
                  applyStylePatch({ outline: { ...outline, color: e.target.value } }, 'Outline color')
                }
                style={{ width: 20, height: 20, border: 'none', padding: 0, background: 'transparent' }}
              />
            </>
          )}
        </div>
      </div>

      {/* Box Shadows Multi-Layer Stack (Outer + Inset) */}
      <div
        style={{
          marginTop: 8,
          paddingTop: 7,
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Box Shadows ({shadows.length})
          </span>
          <button
            type="button"
            className="studio-btn sm primary"
            data-testid="btn-add-box-shadow"
            style={{ height: 20, padding: '0 6px', fontSize: 10 }}
            onClick={() =>
              applyStylePatch(
                {
                  shadows: [
                    ...shadows,
                    { x: 0, y: 10, blur: 24, spread: -4, color: 'rgba(15, 23, 42, 0.32)' },
                  ],
                },
                '+ Box Shadow',
              )
            }
          >
            <Plus size={10} />
            <span>+ Ombra</span>
          </button>
        </div>

        {/* Elevation Presets */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {SHADOW_PRESETS.map((pr) => (
            <button
              key={pr.label}
              type="button"
              className="studio-btn sm"
              style={{ height: 19, padding: '0 5px', fontSize: 9.5 }}
              onClick={() => applyStylePatch({ shadows: structuredClone(pr.shadows) }, `Ombra ${pr.label}`)}
            >
              {pr.label}
            </button>
          ))}
        </div>

        {shadows.map((sh, idx) => (
          <div
            key={`sh_${idx}`}
            style={{
              padding: 6,
              borderRadius: 6,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr)) auto', gap: 3, alignItems: 'center' }}>
              <input
                type="number"
                className="studio-input"
                style={{ padding: '2px 4px', fontSize: 10.5 }}
                title="Offset X"
                value={sh.x}
                onChange={(e) => updateShadowAt(idx, { x: Number(e.target.value) || 0 })}
              />
              <input
                type="number"
                className="studio-input"
                style={{ padding: '2px 4px', fontSize: 10.5 }}
                title="Offset Y"
                value={sh.y}
                onChange={(e) => updateShadowAt(idx, { y: Number(e.target.value) || 0 })}
              />
              <input
                type="number"
                min={0}
                className="studio-input"
                style={{ padding: '2px 4px', fontSize: 10.5 }}
                title="Blur (px)"
                value={sh.blur}
                onChange={(e) => updateShadowAt(idx, { blur: Math.max(0, Number(e.target.value) || 0) })}
              />
              <input
                type="number"
                className="studio-input"
                style={{ padding: '2px 4px', fontSize: 10.5 }}
                title="Spread (px)"
                value={sh.spread}
                onChange={(e) => updateShadowAt(idx, { spread: Number(e.target.value) || 0 })}
              />
              <button
                type="button"
                className="row-icon-btn"
                onClick={() => applyStylePatch({ shadows: shadows.filter((_, i) => i !== idx) }, 'Rimuovi ombra')}
              >
                <Trash2 size={10} />
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <input
                type="color"
                value={toSafeHexColor(String(resolveTokenOrValue(sh.color, tokenMap, '#0f172a')), '#0f172a')}
                onChange={(e) => updateShadowAt(idx, { color: e.target.value })}
                style={{ width: 20, height: 20, border: 'none', padding: 0, background: 'transparent' }}
              />
              <input
                className="studio-input"
                style={{ flex: 1, padding: '2px 5px', fontSize: 10.5 }}
                value={String(resolveTokenOrValue(sh.color, tokenMap, 'rgba(15, 23, 42, 0.3)'))}
                onChange={(e) => updateShadowAt(idx, { color: e.target.value })}
              />
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={Boolean(sh.inset)}
                  onChange={(e) => updateShadowAt(idx, { inset: e.target.checked })}
                />
                <span>inset</span>
              </label>
            </div>
          </div>
        ))}
      </div>
    </CollapsibleSection>
  );
};
