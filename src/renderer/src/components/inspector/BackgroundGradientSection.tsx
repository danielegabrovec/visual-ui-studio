import React from 'react';
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { formatFillCssLayer } from '@shared/css-sync-engine';
import { isTokenRef, resolveTokenOrValue, type StyleFill, type StyleSpec } from '@shared/ui-ir';
import { CollapsibleSection, toSafeHexColor, type InspectorSectionProps } from './inspector-shared';

const GRADIENT_PRESETS: Array<{ label: string; angle: number; stops: Array<{ pos: number; color: string }> }> = [
  { label: 'Brand', angle: 135, stops: [{ pos: 0, color: '#2563eb' }, { pos: 1, color: '#8b5cf6' }] },
  { label: 'Emerald', angle: 135, stops: [{ pos: 0, color: '#059669' }, { pos: 1, color: '#0ea5e9' }] },
  { label: 'Sunset', angle: 120, stops: [{ pos: 0, color: '#f97316' }, { pos: 0.5, color: '#ec4899' }, { pos: 1, color: '#8b5cf6' }] },
  { label: 'Dark Glass', angle: 180, stops: [{ pos: 0, color: 'rgba(30,41,59,0.85)' }, { pos: 1, color: 'rgba(15,23,42,0.95)' }] },
];

export const BackgroundGradientSection: React.FC<InspectorSectionProps> = ({
  tokens,
  tokenMap,
  effectiveStyle,
  applyStylePatch,
}) => {
  const colorTokens = tokens.filter((t) => t.themeId === null && t.category === 'color');
  const fills: StyleFill[] = effectiveStyle.fills ?? [];

  const updateFillAt = (idx: number, nextFill: StyleFill, label = 'Modifica sfondo') => {
    const next = fills.map((f, i) => (i === idx ? nextFill : f));
    applyStylePatch({ fills: next }, label);
  };

  const addFillLayer = () => {
    const newLayer: StyleFill =
      fills.length === 0
        ? { type: 'solid', color: '#2563eb', enabled: true }
        : {
            type: 'linear-gradient',
            angle: 135,
            stops: [
              { pos: 0, color: '#2563eb' },
              { pos: 1, color: '#8b5cf6' },
            ],
            enabled: true,
          };
    applyStylePatch({ fills: [newLayer, ...fills] }, '+ Livello Sfondo');
  };

  const switchFillType = (idx: number, nextType: StyleFill['type']) => {
    if (nextType === 'solid') {
      updateFillAt(idx, { type: 'solid', color: '#2563eb', enabled: true }, 'Sfondo solido');
    } else if (nextType === 'linear-gradient') {
      updateFillAt(
        idx,
        {
          type: 'linear-gradient',
          angle: 135,
          stops: [
            { pos: 0, color: '#2563eb' },
            { pos: 1, color: '#8b5cf6' },
          ],
          enabled: true,
        },
        'Gradiente lineare',
      );
    } else if (nextType === 'radial-gradient') {
      updateFillAt(
        idx,
        {
          type: 'radial-gradient',
          shape: 'circle',
          centerX: 50,
          centerY: 50,
          stops: [
            { pos: 0, color: '#3b82f6' },
            { pos: 1, color: '#0f172a' },
          ],
          enabled: true,
        },
        'Gradiente radiale',
      );
    } else if (nextType === 'conic-gradient') {
      updateFillAt(
        idx,
        {
          type: 'conic-gradient',
          angle: 0,
          centerX: 50,
          centerY: 50,
          stops: [
            { pos: 0, color: '#3b82f6' },
            { pos: 0.5, color: '#8b5cf6' },
            { pos: 1, color: '#3b82f6' },
          ],
          enabled: true,
        },
        'Gradiente conico',
      );
    } else {
      updateFillAt(
        idx,
        {
          type: 'image',
          imageUrl: 'https://placehold.co/800x480/1e293b/94a3b8?text=Cover+Asset',
          fit: 'cover',
          position: 'center',
          repeat: 'no-repeat',
          enabled: true,
        },
        'Sfondo immagine',
      );
    }
  };

  return (
    <CollapsibleSection
      title="Sfondi & Gradienti Multi-Stop"
      badge={String(fills.length)}
      testId="inspector-background-gradient-section"
      rightSlot={
        <button
          type="button"
          className="studio-btn sm primary"
          data-testid="btn-add-fill-layer"
          style={{ height: 20, padding: '0 6px', fontSize: 10 }}
          onClick={addFillLayer}
        >
          <Plus size={10} />
          <span>+ Sfondo</span>
        </button>
      }
    >
      {/* Opacity & Blend Mode */}
      <div className="prop-row">
        <span className="prop-label">Opacità/Blend</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <input
            type="range"
            min="0.05"
            max="1"
            step="0.05"
            style={{ flex: 1 }}
            value={effectiveStyle.opacity ?? 1}
            onChange={(e) => applyStylePatch({ opacity: Number(e.target.value) }, 'Opacità')}
          />
          <span style={{ fontSize: 10.5, width: 30, textAlign: 'right' }}>
            {Math.round((effectiveStyle.opacity ?? 1) * 100)}%
          </span>
          <select
            className="studio-select"
            style={{ width: 84, padding: '2px 4px', fontSize: 10.5 }}
            value={effectiveStyle.mixBlendMode ?? 'normal'}
            onChange={(e) =>
              applyStylePatch({ mixBlendMode: e.target.value as StyleSpec['mixBlendMode'] }, 'Mix Blend Mode')
            }
          >
            <option value="normal">Normal</option>
            <option value="multiply">Multiply</option>
            <option value="screen">Screen</option>
            <option value="overlay">Overlay</option>
            <option value="color-dodge">Dodge</option>
            <option value="difference">Diff</option>
          </select>
        </div>
      </div>

      {fills.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 0' }}>
          Nessuno sfondo attivo (trasparente). Clicca <strong>+ Sfondo</strong> per aggiungere colore o gradiente.
        </div>
      )}

      {fills.map((fill, idx) => {
        const previewCss = formatFillCssLayer(fill, tokenMap, false, true) ?? 'transparent';
        const isGrad =
          fill.type === 'linear-gradient' || fill.type === 'radial-gradient' || fill.type === 'conic-gradient';

        return (
          <div
            key={`fill_${idx}`}
            style={{
              marginTop: 6,
              padding: 7,
              borderRadius: 7,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {/* Layer Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  background: previewCss,
                  border: '1px solid var(--border-strong)',
                  flexShrink: 0,
                }}
              />
              <select
                className="studio-select"
                data-testid={`inspector-fill-type-${idx}`}
                style={{ flex: 1, padding: '2px 5px', fontSize: 11 }}
                value={fill.type}
                onChange={(e) => switchFillType(idx, e.target.value as StyleFill['type'])}
              >
                <option value="solid">Colore Solido</option>
                <option value="linear-gradient">Gradiente Lineare</option>
                <option value="radial-gradient">Gradiente Radiale</option>
                <option value="conic-gradient">Gradiente Conico</option>
                <option value="image">Immagine URL / Asset</option>
              </select>
              <button
                type="button"
                className="row-icon-btn"
                onClick={() => updateFillAt(idx, { ...fill, enabled: fill.enabled === false })}
                title={fill.enabled === false ? 'Mostra livello' : 'Nascondi livello'}
              >
                {fill.enabled === false ? <EyeOff size={11} /> : <Eye size={11} />}
              </button>
              <button
                type="button"
                className="row-icon-btn"
                onClick={() =>
                  applyStylePatch({ fills: fills.filter((_, i) => i !== idx) }, 'Rimuovi livello sfondo')
                }
                title="Elimina livello sfondo"
              >
                <Trash2 size={11} />
              </button>
            </div>

            {/* Solid Editor */}
            {fill.type === 'solid' && (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="color"
                  value={toSafeHexColor(String(resolveTokenOrValue(fill.color, tokenMap, '#2563eb')))}
                  onChange={(e) => updateFillAt(idx, { ...fill, color: e.target.value }, 'Colore sfondo')}
                  style={{ width: 24, height: 24, border: 'none', padding: 0, background: 'transparent', cursor: 'pointer' }}
                />
                <input
                  className="studio-input"
                  style={{ width: 84, fontSize: 11 }}
                  value={String(resolveTokenOrValue(fill.color, tokenMap, '#2563eb'))}
                  onChange={(e) => updateFillAt(idx, { ...fill, color: e.target.value }, 'Colore sfondo')}
                />
                <select
                  className="studio-select"
                  style={{ flex: 1, fontSize: 10.5, padding: '2px 4px' }}
                  value={isTokenRef(fill.color) ? fill.color.$token : ''}
                  onChange={(e) => {
                    if (e.target.value) {
                      updateFillAt(idx, { ...fill, color: { $token: e.target.value } }, 'Bind token sfondo');
                    }
                  }}
                >
                  <option value="">Token...</option>
                  {colorTokens.map((ct) => (
                    <option key={ct.id} value={ct.tokenPath}>
                      ${ct.tokenPath}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Linear / Radial / Conic Multi-Stop Gradient Editor */}
            {isGrad && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {/* Live Gradient Preview Bar */}
                <div
                  style={{
                    height: 18,
                    borderRadius: 5,
                    background: previewCss,
                    border: '1px solid var(--border-strong)',
                  }}
                />

                {/* Angle Dial + Presets */}
                {(fill.type === 'linear-gradient' || fill.type === 'conic-gradient') && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {/* Interactive SVG Angle Dial */}
                    <button
                      type="button"
                      onClick={() => {
                        const nextAngle = ((fill.angle ?? 0) + 45) % 360;
                        updateFillAt(idx, { ...fill, angle: nextAngle }, 'Angolo gradiente');
                      }}
                      title="Clicca per ruotare di +45°"
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: '50%',
                        border: '1px solid var(--border-strong)',
                        background: 'var(--bg-input)',
                        cursor: 'pointer',
                        position: 'relative',
                        padding: 0,
                        flexShrink: 0,
                      }}
                    >
                      <span
                        style={{
                          position: 'absolute',
                          left: '50%',
                          top: '50%',
                          width: 10,
                          height: 2,
                          background: 'var(--accent-primary)',
                          transformOrigin: '0 50%',
                          transform: `rotate(${(fill.angle ?? 135) - 90}deg)`,
                        }}
                      />
                    </button>
                    <input
                      type="number"
                      className="studio-input"
                      data-testid={`inspector-gradient-angle-${idx}`}
                      style={{ width: 58, padding: '2px 5px', fontSize: 11 }}
                      value={fill.angle ?? 135}
                      onChange={(e) =>
                        updateFillAt(idx, { ...fill, angle: Number(e.target.value) || 0 }, 'Angolo gradiente')
                      }
                    />
                    <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>deg</span>

                    <div style={{ display: 'flex', gap: 3, marginLeft: 'auto' }}>
                      {GRADIENT_PRESETS.slice(0, 3).map((pr) => (
                        <button
                          key={pr.label}
                          type="button"
                          className="studio-btn sm"
                          style={{ height: 19, padding: '0 5px', fontSize: 9.5 }}
                          onClick={() =>
                            updateFillAt(
                              idx,
                              { type: 'linear-gradient', angle: pr.angle, stops: pr.stops, enabled: true },
                              `Preset ${pr.label}`,
                            )
                          }
                        >
                          {pr.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Stops List */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)' }}>
                    Color Stops ({fill.stops.length})
                  </span>
                  <button
                    type="button"
                    className="studio-btn sm"
                    style={{ height: 19, padding: '0 5px', fontSize: 10 }}
                    onClick={() => {
                      const nextStops = [...fill.stops, { pos: 1, color: '#10b981' }];
                      updateFillAt(idx, { ...fill, stops: nextStops }, '+ Stop gradiente');
                    }}
                  >
                    + Stop
                  </button>
                </div>

                {fill.stops.map((st, sIdx) => (
                  <div key={`stop_${sIdx}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                      type="color"
                      value={toSafeHexColor(String(resolveTokenOrValue(st.color, tokenMap, '#3b82f6')))}
                      onChange={(e) => {
                        const nextStops = fill.stops.map((item, k) =>
                          k === sIdx ? { ...item, color: e.target.value } : item,
                        );
                        updateFillAt(idx, { ...fill, stops: nextStops }, 'Colore stop gradiente');
                      }}
                      style={{ width: 22, height: 22, border: 'none', padding: 0, background: 'transparent' }}
                    />
                    <input
                      className="studio-input"
                      style={{ flex: 1, padding: '2px 5px', fontSize: 10.5 }}
                      value={String(resolveTokenOrValue(st.color, tokenMap, '#3b82f6'))}
                      onChange={(e) => {
                        const nextStops = fill.stops.map((item, k) =>
                          k === sIdx ? { ...item, color: e.target.value } : item,
                        );
                        updateFillAt(idx, { ...fill, stops: nextStops }, 'Colore stop');
                      }}
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className="studio-input"
                      style={{ width: 46, padding: '2px 4px', fontSize: 10.5 }}
                      value={Math.round(st.pos * 100)}
                      onChange={(e) => {
                        const pct = Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100;
                        const nextStops = fill.stops.map((item, k) =>
                          k === sIdx ? { ...item, pos: pct } : item,
                        );
                        updateFillAt(idx, { ...fill, stops: nextStops }, 'Posizione stop');
                      }}
                    />
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>%</span>
                    {fill.stops.length > 2 && (
                      <button
                        type="button"
                        className="row-icon-btn"
                        onClick={() => {
                          const nextStops = fill.stops.filter((_, k) => k !== sIdx);
                          updateFillAt(idx, { ...fill, stops: nextStops }, 'Rimuovi stop');
                        }}
                      >
                        <Trash2 size={10} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Image Fill Editor */}
            {fill.type === 'image' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <input
                  className="studio-input"
                  placeholder="https://... o percorso asset"
                  value={fill.imageUrl ?? ''}
                  onChange={(e) => updateFillAt(idx, { ...fill, imageUrl: e.target.value }, 'URL sfondo')}
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                  <select
                    className="studio-select"
                    value={fill.fit}
                    onChange={(e) =>
                      updateFillAt(idx, { ...fill, fit: e.target.value as typeof fill.fit }, 'Background fit')
                    }
                  >
                    <option value="cover">cover</option>
                    <option value="contain">contain</option>
                    <option value="fill">fill</option>
                  </select>
                  <select
                    className="studio-select"
                    value={fill.repeat ?? 'no-repeat'}
                    onChange={(e) =>
                      updateFillAt(idx, { ...fill, repeat: e.target.value as typeof fill.repeat }, 'Background repeat')
                    }
                  >
                    <option value="no-repeat">no-repeat</option>
                    <option value="repeat">repeat</option>
                    <option value="repeat-x">repeat-x</option>
                    <option value="repeat-y">repeat-y</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </CollapsibleSection>
  );
};
