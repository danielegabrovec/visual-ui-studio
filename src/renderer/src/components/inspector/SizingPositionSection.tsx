import React from 'react';
import { resolveTokenOrValue, type AxisDimensionSpec, type CssUnit, type LayoutSpec } from '@shared/ui-ir';
import { useStudioStore } from '@renderer/state/studio-store';
import { CollapsibleSection, type InspectorSectionProps } from './inspector-shared';

const CSS_UNITS: CssUnit[] = ['px', '%', 'vw', 'vh', 'rem', 'auto', 'fr'];

function unitToMode(unit: CssUnit): AxisDimensionSpec['mode'] {
  if (unit === 'auto') return 'auto';
  if (unit === '%') return 'percentage';
  if (unit === 'vw' || unit === 'vh') return 'viewport';
  if (unit === 'rem' || unit === 'em') return 'rem';
  return 'fixed';
}

export const SizingPositionSection: React.FC<InspectorSectionProps> = ({
  node,
  tokenMap,
  effectiveLayout,
  effectiveStyle,
  applyLayoutPatch,
  applyStylePatch,
}) => {
  const toggleNodeFreeformDetach = useStudioStore((s) => s.toggleNodeFreeformDetach);
  const adjustSelectedZIndex = useStudioStore((s) => s.adjustSelectedZIndex);

  const wSpec = effectiveLayout.width;
  const hSpec = effectiveLayout.height;
  const wUnit: CssUnit =
    wSpec.unit ??
    (wSpec.mode === 'percentage'
      ? '%'
      : wSpec.mode === 'viewport'
        ? 'vw'
        : wSpec.mode === 'rem'
          ? 'rem'
          : wSpec.mode === 'auto'
            ? 'auto'
            : 'px');
  const hUnit: CssUnit =
    hSpec.unit ??
    (hSpec.mode === 'percentage'
      ? '%'
      : hSpec.mode === 'viewport'
        ? 'vh'
        : hSpec.mode === 'rem'
          ? 'rem'
          : hSpec.mode === 'auto'
            ? 'auto'
            : 'px');

  const wVal = Number(resolveTokenOrValue(wSpec.value, tokenMap, effectiveLayout.frame.width));
  const hVal = Number(resolveTokenOrValue(hSpec.value, tokenMap, effectiveLayout.frame.height));

  const isPinnedMode =
    effectiveLayout.positioning === 'absolute' ||
    effectiveLayout.positioning === 'fixed' ||
    effectiveLayout.positioning === 'sticky';

  const pins = effectiveLayout.pins ?? {};

  return (
    <CollapsibleSection title="Dimensioni, Unità, Posizione & Overflow" testId="inspector-sizing-position-section">
      {/* Position Mode + Freeform Detach */}
      <div className="prop-row">
        <span className="prop-label">Posizione</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <select
            className="studio-select"
            data-testid="inspector-select-positioning"
            style={{ flex: 1 }}
            value={effectiveLayout.positioning}
            onChange={(e) =>
              applyLayoutPatch({ positioning: e.target.value as LayoutSpec['positioning'] }, 'Positioning')
            }
          >
            <option value="flow">Flow (Relativo)</option>
            <option value="absolute">Absolute (X, Y / Pin)</option>
            <option value="sticky">Sticky</option>
            <option value="fixed">Fixed (Viewport)</option>
          </select>
          {node.kind !== 'artboard' && (
            <button
              type="button"
              className={`studio-btn sm ${effectiveLayout.positioning === 'absolute' ? 'active' : ''}`}
              onClick={() => void toggleNodeFreeformDetach(node.id)}
              title="Commuta tra coordinate libere (X, Y) e flusso automatico"
            >
              {effectiveLayout.positioning === 'absolute' ? 'Flusso' : 'Sgancia'}
            </button>
          )}
        </div>
      </div>

      {/* Coord X / Y */}
      <div className="prop-row">
        <span className="prop-label">Coord X / Y</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <input
            type="number"
            className="studio-input"
            data-testid="inspector-input-x"
            title="Coordinata X"
            value={effectiveLayout.frame.x}
            onChange={(e) => {
              const nextX = Number(e.target.value);
              if (!Number.isFinite(nextX)) return;
              applyLayoutPatch(
                {
                  ...(node.kind !== 'artboard' ? { positioning: 'absolute' as const } : {}),
                  frame: { ...effectiveLayout.frame, x: Math.round(nextX) },
                  ...(node.kind !== 'artboard' && effectiveLayout.width.mode === 'fill'
                    ? { width: { mode: 'fixed' as const, value: Math.max(120, effectiveLayout.frame.width) } }
                    : {}),
                },
                'Coord X',
              );
            }}
          />
          <input
            type="number"
            className="studio-input"
            data-testid="inspector-input-y"
            title="Coordinata Y"
            value={effectiveLayout.frame.y}
            onChange={(e) => {
              const nextY = Number(e.target.value);
              if (!Number.isFinite(nextY)) return;
              applyLayoutPatch(
                {
                  ...(node.kind !== 'artboard' ? { positioning: 'absolute' as const } : {}),
                  frame: { ...effectiveLayout.frame, y: Math.round(nextY) },
                  ...(node.kind !== 'artboard' && effectiveLayout.width.mode === 'fill'
                    ? { width: { mode: 'fixed' as const, value: Math.max(120, effectiveLayout.frame.width) } }
                    : {}),
                },
                'Coord Y',
              );
            }}
          />
        </div>
      </div>

      {/* 4-Edge Pins when Absolute / Sticky / Fixed */}
      {isPinnedMode && (
        <div className="prop-row">
          <span className="prop-label">Pin T/R/B/L</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 3 }}>
            {(['top', 'right', 'bottom', 'left'] as const).map((edge) => (
              <input
                key={edge}
                type="number"
                className="studio-input"
                data-testid={`inspector-pin-${edge}`}
                placeholder={edge[0].toUpperCase()}
                title={`Pin ${edge} (px)`}
                style={{ padding: '3px 4px', fontSize: 10.5, textAlign: 'center' }}
                value={pins[edge] ?? ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  const nextPins = { ...pins };
                  if (raw === '') delete nextPins[edge];
                  else nextPins[edge] = Math.round(Number(raw) || 0);
                  applyLayoutPatch({ pins: nextPins }, `Pin ${edge}`);
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Width (W) + Mode + Unit */}
      <div className="prop-row">
        <span className="prop-label">Larghezza (W)</span>
        <div style={{ display: 'flex', gap: 3 }}>
          <select
            className="studio-select"
            style={{ width: 66, padding: '2px 4px', fontSize: 11 }}
            value={wSpec.mode}
            onChange={(e) => {
              const m = e.target.value as AxisDimensionSpec['mode'];
              const nextU: CssUnit =
                m === 'percentage' ? '%' : m === 'viewport' ? 'vw' : m === 'rem' ? 'rem' : m === 'auto' ? 'auto' : 'px';
              applyLayoutPatch(
                { width: { ...wSpec, mode: m, unit: nextU, value: wVal || effectiveLayout.frame.width } },
                'Width mode',
              );
            }}
          >
            <option value="fixed">Fixed</option>
            <option value="hug">Hug</option>
            <option value="fill">Fill</option>
            <option value="percentage">%</option>
            <option value="viewport">vw/vh</option>
            <option value="rem">rem</option>
            <option value="auto">auto</option>
          </select>
          <input
            type="number"
            className="studio-input"
            data-testid="inspector-input-w"
            style={{ flex: 1, minWidth: 46, padding: '3px 5px' }}
            disabled={wSpec.mode === 'hug' || wSpec.mode === 'fill' || wUnit === 'auto'}
            value={wUnit === 'px' ? effectiveLayout.frame.width : wVal}
            onChange={(e) => {
              const num = Math.max(1, Number(e.target.value) || 1);
              applyLayoutPatch(
                {
                  ...(wUnit === 'px' ? { frame: { ...effectiveLayout.frame, width: Math.round(num) } } : {}),
                  width: {
                    ...wSpec,
                    mode: wSpec.mode === 'hug' || wSpec.mode === 'fill' ? 'fixed' : wSpec.mode,
                    value: wUnit === 'px' ? Math.round(num) : num,
                    unit: wUnit,
                  },
                },
                'Larghezza',
              );
            }}
          />
          <select
            className="studio-select"
            data-testid="inspector-unit-w"
            style={{ width: 50, padding: '2px 3px', fontSize: 10.5 }}
            value={wUnit}
            onChange={(e) => {
              const u = e.target.value as CssUnit;
              applyLayoutPatch(
                { width: { ...wSpec, mode: unitToMode(u), unit: u, value: wVal || 100 } },
                'Unità larghezza',
              );
            }}
          >
            {CSS_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Height (H) + Mode + Unit */}
      <div className="prop-row">
        <span className="prop-label">Altezza (H)</span>
        <div style={{ display: 'flex', gap: 3 }}>
          <select
            className="studio-select"
            style={{ width: 66, padding: '2px 4px', fontSize: 11 }}
            value={hSpec.mode}
            onChange={(e) => {
              const m = e.target.value as AxisDimensionSpec['mode'];
              const nextU: CssUnit =
                m === 'percentage' ? '%' : m === 'viewport' ? 'vh' : m === 'rem' ? 'rem' : m === 'auto' ? 'auto' : 'px';
              applyLayoutPatch(
                { height: { ...hSpec, mode: m, unit: nextU, value: hVal || effectiveLayout.frame.height } },
                'Height mode',
              );
            }}
          >
            <option value="fixed">Fixed</option>
            <option value="hug">Hug</option>
            <option value="fill">Fill</option>
            <option value="percentage">%</option>
            <option value="viewport">vh/vw</option>
            <option value="rem">rem</option>
            <option value="auto">auto</option>
          </select>
          <input
            type="number"
            className="studio-input"
            data-testid="inspector-input-h"
            style={{ flex: 1, minWidth: 46, padding: '3px 5px' }}
            disabled={hSpec.mode === 'hug' || hSpec.mode === 'fill' || hUnit === 'auto'}
            value={hUnit === 'px' ? effectiveLayout.frame.height : hVal}
            onChange={(e) => {
              const num = Math.max(1, Number(e.target.value) || 1);
              applyLayoutPatch(
                {
                  ...(hUnit === 'px' ? { frame: { ...effectiveLayout.frame, height: Math.round(num) } } : {}),
                  height: {
                    ...hSpec,
                    mode: hSpec.mode === 'hug' || hSpec.mode === 'fill' ? 'fixed' : hSpec.mode,
                    value: hUnit === 'px' ? Math.round(num) : num,
                    unit: hUnit,
                  },
                },
                'Altezza',
              );
            }}
          />
          <select
            className="studio-select"
            data-testid="inspector-unit-h"
            style={{ width: 50, padding: '2px 3px', fontSize: 10.5 }}
            value={hUnit}
            onChange={(e) => {
              const u = e.target.value as CssUnit;
              applyLayoutPatch(
                { height: { ...hSpec, mode: unitToMode(u), unit: u, value: hVal || 48 } },
                'Unità altezza',
              );
            }}
          >
            {CSS_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Min / Max W & H Bounds */}
      <div className="prop-row">
        <span className="prop-label">Min / Max W</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <input
            type="number"
            className="studio-input"
            data-testid="inspector-min-w"
            placeholder="Min W"
            value={wSpec.min !== undefined ? Number(resolveTokenOrValue(wSpec.min, tokenMap, 0)) : ''}
            onChange={(e) => {
              const raw = e.target.value;
              applyLayoutPatch(
                { width: { ...wSpec, min: raw === '' ? undefined : Math.max(0, Number(raw)), minUnit: wSpec.minUnit ?? 'px' } },
                'Min Width',
              );
            }}
          />
          <input
            type="number"
            className="studio-input"
            data-testid="inspector-max-w"
            placeholder="Max W"
            value={wSpec.max !== undefined ? Number(resolveTokenOrValue(wSpec.max, tokenMap, 0)) : ''}
            onChange={(e) => {
              const raw = e.target.value;
              applyLayoutPatch(
                { width: { ...wSpec, max: raw === '' ? undefined : Math.max(0, Number(raw)), maxUnit: wSpec.maxUnit ?? 'px' } },
                'Max Width',
              );
            }}
          />
        </div>
      </div>

      <div className="prop-row">
        <span className="prop-label">Min / Max H</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <input
            type="number"
            className="studio-input"
            data-testid="inspector-min-h"
            placeholder="Min H"
            value={hSpec.min !== undefined ? Number(resolveTokenOrValue(hSpec.min, tokenMap, 0)) : ''}
            onChange={(e) => {
              const raw = e.target.value;
              applyLayoutPatch(
                { height: { ...hSpec, min: raw === '' ? undefined : Math.max(0, Number(raw)), minUnit: hSpec.minUnit ?? 'px' } },
                'Min Height',
              );
            }}
          />
          <input
            type="number"
            className="studio-input"
            data-testid="inspector-max-h"
            placeholder="Max H"
            value={hSpec.max !== undefined ? Number(resolveTokenOrValue(hSpec.max, tokenMap, 0)) : ''}
            onChange={(e) => {
              const raw = e.target.value;
              applyLayoutPatch(
                { height: { ...hSpec, max: raw === '' ? undefined : Math.max(0, Number(raw)), maxUnit: hSpec.maxUnit ?? 'px' } },
                'Max Height',
              );
            }}
          />
        </div>
      </div>

      {/* Overflow X / Y */}
      <div className="prop-row">
        <span className="prop-label">Overflow X / Y</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <select
            className="studio-select"
            data-testid="inspector-overflow-x"
            value={effectiveLayout.overflowX ?? effectiveLayout.overflow ?? 'visible'}
            onChange={(e) =>
              applyLayoutPatch({ overflowX: e.target.value as LayoutSpec['overflowX'] }, 'Overflow X')
            }
          >
            <option value="visible">X: visible</option>
            <option value="hidden">X: hidden</option>
            <option value="auto">X: auto</option>
            <option value="scroll">X: scroll</option>
          </select>
          <select
            className="studio-select"
            data-testid="inspector-overflow-y"
            value={effectiveLayout.overflowY ?? effectiveLayout.overflow ?? 'visible'}
            onChange={(e) =>
              applyLayoutPatch({ overflowY: e.target.value as LayoutSpec['overflowY'] }, 'Overflow Y')
            }
          >
            <option value="visible">Y: visible</option>
            <option value="hidden">Y: hidden</option>
            <option value="auto">Y: auto</option>
            <option value="scroll">Y: scroll</option>
          </select>
        </div>
      </div>

      {/* Aspect Ratio & Z-Index */}
      <div className="prop-row">
        <span className="prop-label">Aspect Ratio</span>
        <select
          className="studio-select"
          data-testid="inspector-aspect-ratio"
          value={effectiveLayout.aspectRatio ?? ''}
          onChange={(e) =>
            applyLayoutPatch({ aspectRatio: e.target.value || undefined }, 'Aspect Ratio')
          }
        >
          <option value="">Auto</option>
          <option value="1 / 1">1 / 1 (Quadrato)</option>
          <option value="16 / 9">16 / 9 (Video)</option>
          <option value="4 / 3">4 / 3</option>
          <option value="3 / 2">3 / 2</option>
          <option value="21 / 9">21 / 9 (Ultrawide)</option>
        </select>
      </div>

      <div className="prop-row">
        <span className="prop-label">Z-Index</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            type="number"
            className="studio-input"
            data-testid="inspector-input-zindex"
            style={{ flex: 1 }}
            value={effectiveStyle.zIndex ?? 1}
            onChange={(e) => {
              const z = Math.round(Number(e.target.value) || 0);
              applyStylePatch({ zIndex: z }, 'Z-Index');
            }}
          />
          <button
            type="button"
            className="studio-btn sm"
            onClick={() => void adjustSelectedZIndex(-1)}
            title="Porta dietro (-1)"
          >
            -1
          </button>
          <button
            type="button"
            className="studio-btn sm"
            onClick={() => void adjustSelectedZIndex(1)}
            title="Porta avanti (+1)"
          >
            +1
          </button>
        </div>
      </div>
    </CollapsibleSection>
  );
};
