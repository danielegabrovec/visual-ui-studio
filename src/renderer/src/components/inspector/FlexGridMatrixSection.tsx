import React from 'react';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { resolveTokenOrValue, type GridTrackSpec, type GridTrackUnit, type LayoutSpec } from '@shared/ui-ir';
import { useStudioStore } from '@renderer/state/studio-store';
import { CollapsibleSection, type InspectorSectionProps } from './inspector-shared';

const MATRIX_COORDS: Array<'start' | 'center' | 'end'> = ['start', 'center', 'end'];

export const FlexGridMatrixSection: React.FC<InspectorSectionProps> = ({
  node,
  sheet,
  tokenMap,
  effectiveLayout,
  applyLayoutPatch,
}) => {
  const solveAutoLayoutOnActive = useStudioStore((s) => s.solveAutoLayoutOnActive);
  const parentNode = node.parentId ? sheet.nodes[node.parentId] : undefined;
  const parentMode = parentNode?.layout.mode;

  const isRowLike =
    (effectiveLayout.direction ?? 'column') === 'row' || effectiveLayout.direction === 'row-reverse';

  const curJustify = effectiveLayout.justify ?? 'start';
  const curAlign = effectiveLayout.align ?? 'stretch';

  const gridCols: GridTrackSpec[] = effectiveLayout.gridCols?.length
    ? effectiveLayout.gridCols
    : [{ track: 'fr', value: 1 }, { track: 'fr', value: 1 }, { track: 'fr', value: 1 }];
  const gridRows: GridTrackSpec[] = effectiveLayout.gridRows ?? [];

  const updateGridTrack = (
    kind: 'cols' | 'rows',
    idx: number,
    patch: Partial<GridTrackSpec>,
  ) => {
    const src = kind === 'cols' ? [...gridCols] : [...gridRows];
    src[idx] = { ...src[idx], ...patch };
    applyLayoutPatch(
      kind === 'cols' ? { mode: 'grid', gridCols: src } : { mode: 'grid', gridRows: src },
      `Grid ${kind} track`,
    );
  };

  const addGridTrack = (kind: 'cols' | 'rows') => {
    const nextTrack: GridTrackSpec = { track: 'fr', value: 1 };
    if (kind === 'cols') {
      applyLayoutPatch({ mode: 'grid', gridCols: [...gridCols, nextTrack] }, '+ Colonna Grid');
    } else {
      applyLayoutPatch({ mode: 'grid', gridRows: [...gridRows, nextTrack] }, '+ Riga Grid');
    }
  };

  const removeGridTrack = (kind: 'cols' | 'rows', idx: number) => {
    if (kind === 'cols') {
      const next = gridCols.filter((_, i) => i !== idx);
      applyLayoutPatch({ gridCols: next.length > 0 ? next : [{ track: 'fr', value: 1 }] }, 'Rimuovi colonna Grid');
    } else {
      applyLayoutPatch({ gridRows: gridRows.filter((_, i) => i !== idx) }, 'Rimuovi riga Grid');
    }
  };

  const flexChild = effectiveLayout.flexChild ?? {};
  const gridChild = effectiveLayout.gridChild ?? {};

  return (
    <CollapsibleSection
      title="Layout Flex 9-Dot & CSS Grid"
      badge={effectiveLayout.mode.toUpperCase()}
      testId="inspector-flex-grid-section"
      rightSlot={
        <button
          type="button"
          className="studio-btn sm violet"
          style={{ height: 20, padding: '0 6px', fontSize: 10 }}
          onClick={() => void solveAutoLayoutOnActive()}
          title="Converte coordinate libere in Flexbox / Grid automatico"
        >
          <Wand2 size={10} />
          <span>Auto</span>
        </button>
      }
    >
      {/* Layout Mode Switcher */}
      <div className="prop-row">
        <span className="prop-label">Layout Mode</span>
        <select
          className="studio-select"
          data-testid="inspector-layout-mode"
          value={effectiveLayout.mode}
          onChange={(e) =>
            applyLayoutPatch({ mode: e.target.value as LayoutSpec['mode'] }, 'Layout mode')
          }
        >
          <option value="freeform">Freeform (Coordinate X, Y)</option>
          <option value="flex">Flexbox (Auto-Layout)</option>
          <option value="grid">CSS Grid (Colonne &amp; Righe)</option>
          <option value="stack">Z-Stack Overlay</option>
        </select>
      </div>

      {/* ==================== FLEXBOX CONTAINER CONTROLS ==================== */}
      {effectiveLayout.mode === 'flex' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          <div className="prop-row">
            <span className="prop-label">Direzione</span>
            <select
              className="studio-select"
              data-testid="inspector-flex-direction"
              value={effectiveLayout.direction ?? 'column'}
              onChange={(e) =>
                applyLayoutPatch({ direction: e.target.value as LayoutSpec['direction'] }, 'Direzione Flex')
              }
            >
              <option value="row">Row → (Orizzontale)</option>
              <option value="column">Column ↓ (Verticale)</option>
              <option value="row-reverse">Row Reverse ←</option>
              <option value="column-reverse">Column Reverse ↑</option>
            </select>
          </div>

          {/* Interactive 9-Dot Alignment Matrix + Distribution Side Controls */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
            <div
              data-testid="flex-9dot-matrix"
              style={{
                width: 74,
                height: 74,
                flexShrink: 0,
                padding: 6,
                borderRadius: 8,
                background: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gridTemplateRows: 'repeat(3, 1fr)',
                gap: 4,
              }}
              title="Matrice 9-Dot Allineamento Flexbox"
            >
              {MATRIX_COORDS.map((rowCoord) =>
                MATRIX_COORDS.map((colCoord) => {
                  const jVal = isRowLike ? colCoord : rowCoord;
                  const aVal = isRowLike ? rowCoord : colCoord;
                  const isCellActive = curJustify === jVal && curAlign === aVal;
                  return (
                    <button
                      key={`${rowCoord}_${colCoord}`}
                      type="button"
                      data-testid={`flex-9dot-${jVal}-${aVal}`}
                      onClick={() =>
                        applyLayoutPatch({ justify: jVal, align: aVal }, `Flex ${jVal} / ${aVal}`)
                      }
                      title={`justify: ${jVal}, align: ${aVal}`}
                      style={{
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                        background: isCellActive ? 'var(--accent-primary)' : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 0,
                      }}
                    >
                      <span
                        style={{
                          width: isCellActive ? 7 : 5,
                          height: isCellActive ? 7 : 5,
                          borderRadius: '50%',
                          background: isCellActive ? '#ffffff' : 'var(--text-muted)',
                        }}
                      />
                    </button>
                  );
                }),
              )}
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 4 }}>
              <select
                className="studio-select"
                data-testid="inspector-flex-justify"
                value={curJustify}
                onChange={(e) =>
                  applyLayoutPatch({ justify: e.target.value as LayoutSpec['justify'] }, 'Justify content')
                }
                style={{ fontSize: 11, padding: '2px 5px' }}
                title="justify-content"
              >
                <option value="start">Justify: Start</option>
                <option value="center">Justify: Center</option>
                <option value="end">Justify: End</option>
                <option value="space-between">Space Between</option>
                <option value="space-around">Space Around</option>
                <option value="space-evenly">Space Evenly</option>
              </select>

              <select
                className="studio-select"
                data-testid="inspector-flex-align"
                value={curAlign}
                onChange={(e) =>
                  applyLayoutPatch({ align: e.target.value as LayoutSpec['align'] }, 'Align items')
                }
                style={{ fontSize: 11, padding: '2px 5px' }}
                title="align-items"
              >
                <option value="stretch">Align: Stretch</option>
                <option value="start">Align: Start</option>
                <option value="center">Align: Center</option>
                <option value="end">Align: End</option>
                <option value="baseline">Align: Baseline</option>
              </select>

              <select
                className="studio-select"
                data-testid="inspector-flex-wrap"
                value={
                  effectiveLayout.wrap === 'wrap-reverse'
                    ? 'wrap-reverse'
                    : effectiveLayout.wrap
                      ? 'wrap'
                      : 'nowrap'
                }
                onChange={(e) => {
                  const val = e.target.value;
                  applyLayoutPatch(
                    { wrap: val === 'wrap-reverse' ? 'wrap-reverse' : val === 'wrap' },
                    'Flex wrap',
                  );
                }}
                style={{ fontSize: 11, padding: '2px 5px' }}
                title="flex-wrap"
              >
                <option value="nowrap">No Wrap</option>
                <option value="wrap">Wrap (A capo)</option>
                <option value="wrap-reverse">Wrap Reverse</option>
              </select>
            </div>
          </div>

          {/* Gap / Row Gap / Col Gap */}
          <div className="prop-row">
            <span className="prop-label">Gap / R / C</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
              <input
                type="number"
                className="studio-input"
                data-testid="inspector-input-gap"
                title="Gap principale (px)"
                placeholder="Gap"
                value={Number(resolveTokenOrValue(effectiveLayout.gap, tokenMap, 0))}
                onChange={(e) =>
                  applyLayoutPatch({ gap: Math.max(0, Number(e.target.value)) }, 'Gap')
                }
              />
              <input
                type="number"
                className="studio-input"
                title="row-gap (px)"
                placeholder="R-Gap"
                value={
                  effectiveLayout.rowGap !== undefined
                    ? Number(resolveTokenOrValue(effectiveLayout.rowGap, tokenMap, 0))
                    : ''
                }
                onChange={(e) =>
                  applyLayoutPatch(
                    { rowGap: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) },
                    'Row Gap',
                  )
                }
              />
              <input
                type="number"
                className="studio-input"
                title="column-gap (px)"
                placeholder="C-Gap"
                value={
                  effectiveLayout.columnGap !== undefined
                    ? Number(resolveTokenOrValue(effectiveLayout.columnGap, tokenMap, 0))
                    : ''
                }
                onChange={(e) =>
                  applyLayoutPatch(
                    { columnGap: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) },
                    'Column Gap',
                  )
                }
              />
            </div>
          </div>
        </div>
      )}

      {/* ==================== CSS GRID TRACK BUILDER ==================== */}
      {effectiveLayout.mode === 'grid' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          {/* Quick Grid Presets */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <button
              type="button"
              className="studio-btn sm"
              onClick={() =>
                applyLayoutPatch(
                  { gridCols: [{ track: 'fr', value: 1 }, { track: 'fr', value: 1 }] },
                  'Grid 2 Colonne',
                )
              }
            >
              2 Col
            </button>
            <button
              type="button"
              className="studio-btn sm"
              onClick={() =>
                applyLayoutPatch(
                  { gridCols: [{ track: 'fr', value: 1 }, { track: 'fr', value: 1 }, { track: 'fr', value: 1 }] },
                  'Grid 3 Colonne',
                )
              }
            >
              3 Col
            </button>
            <button
              type="button"
              className="studio-btn sm"
              onClick={() =>
                applyLayoutPatch(
                  { gridCols: [{ track: 'px', value: 240 }, { track: 'fr', value: 1 }] },
                  'Grid Sidebar + Main',
                )
              }
            >
              Sidebar+1fr
            </button>
            <button
              type="button"
              className="studio-btn sm violet"
              onClick={() =>
                applyLayoutPatch(
                  {
                    gridCols: [
                      { track: 'minmax', min: '220px', max: '1fr' },
                      { track: 'minmax', min: '220px', max: '1fr' },
                    ],
                  },
                  'Grid MinMax Responsive',
                )
              }
            >
              MinMax
            </button>
          </div>

          {/* Columns Track List */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-secondary)' }}>
              Colonne ({gridCols.length})
            </span>
            <button
              type="button"
              className="studio-btn sm primary"
              data-testid="btn-grid-add-col"
              style={{ height: 20, padding: '0 6px', fontSize: 10 }}
              onClick={() => addGridTrack('cols')}
            >
              <Plus size={10} />
              <span>+ Colonna</span>
            </button>
          </div>

          {gridCols.map((col, idx) => (
            <div key={`gcol_${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 22 }}>C{idx + 1}</span>
              <select
                className="studio-select"
                style={{ width: 72, padding: '2px 4px', fontSize: 10.5 }}
                value={col.track}
                onChange={(e) => {
                  const unit = e.target.value as GridTrackUnit;
                  updateGridTrack('cols', idx, {
                    track: unit,
                    value: unit === 'fr' ? 1 : unit === '%' ? 50 : 200,
                    min: unit === 'minmax' ? '200px' : undefined,
                    max: unit === 'minmax' ? '1fr' : undefined,
                  });
                }}
              >
                <option value="fr">fr</option>
                <option value="px">px</option>
                <option value="%">%</option>
                <option value="auto">auto</option>
                <option value="minmax">minmax</option>
              </select>

              {col.track === 'minmax' ? (
                <>
                  <input
                    className="studio-input"
                    style={{ flex: 1, minWidth: 44, padding: '2px 4px', fontSize: 10.5 }}
                    value={col.min ?? '200px'}
                    onChange={(e) => updateGridTrack('cols', idx, { min: e.target.value })}
                    placeholder="min"
                  />
                  <input
                    className="studio-input"
                    style={{ flex: 1, minWidth: 44, padding: '2px 4px', fontSize: 10.5 }}
                    value={col.max ?? '1fr'}
                    onChange={(e) => updateGridTrack('cols', idx, { max: e.target.value })}
                    placeholder="max"
                  />
                </>
              ) : col.track !== 'auto' ? (
                <input
                  type="number"
                  className="studio-input"
                  style={{ flex: 1, padding: '2px 5px', fontSize: 11 }}
                  value={col.value ?? 1}
                  onChange={(e) => updateGridTrack('cols', idx, { value: Math.max(0.1, Number(e.target.value) || 1) })}
                />
              ) : (
                <span style={{ flex: 1, fontSize: 10.5, color: 'var(--text-muted)' }}>auto</span>
              )}

              <button
                type="button"
                className="row-icon-btn"
                onClick={() => removeGridTrack('cols', idx)}
                title="Rimuovi colonna"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}

          {/* Rows Track List */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-secondary)' }}>
              Righe ({gridRows.length || 'auto'})
            </span>
            <button
              type="button"
              className="studio-btn sm"
              data-testid="btn-grid-add-row"
              style={{ height: 20, padding: '0 6px', fontSize: 10 }}
              onClick={() => addGridTrack('rows')}
            >
              <Plus size={10} />
              <span>+ Riga</span>
            </button>
          </div>

          {gridRows.map((row, idx) => (
            <div key={`grow_${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 22 }}>R{idx + 1}</span>
              <select
                className="studio-select"
                style={{ width: 72, padding: '2px 4px', fontSize: 10.5 }}
                value={row.track}
                onChange={(e) =>
                  updateGridTrack('rows', idx, {
                    track: e.target.value as GridTrackUnit,
                    value: e.target.value === 'fr' ? 1 : 120,
                  })
                }
              >
                <option value="fr">fr</option>
                <option value="px">px</option>
                <option value="auto">auto</option>
                <option value="minmax">minmax</option>
              </select>
              {row.track !== 'auto' && row.track !== 'minmax' && (
                <input
                  type="number"
                  className="studio-input"
                  style={{ flex: 1, padding: '2px 5px', fontSize: 11 }}
                  value={row.value ?? 1}
                  onChange={(e) => updateGridTrack('rows', idx, { value: Math.max(0.1, Number(e.target.value) || 1) })}
                />
              )}
              <button
                type="button"
                className="row-icon-btn"
                onClick={() => removeGridTrack('rows', idx)}
                title="Rimuovi riga"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}

          <div className="prop-row">
            <span className="prop-label">Grid Gap</span>
            <input
              type="number"
              className="studio-input"
              value={Number(resolveTokenOrValue(effectiveLayout.gap, tokenMap, 12))}
              onChange={(e) => applyLayoutPatch({ gap: Math.max(0, Number(e.target.value)) }, 'Grid Gap')}
            />
          </div>
        </div>
      )}

      {/* ==================== FLEX / GRID CHILD CONTROLS ==================== */}
      {node.kind !== 'artboard' && (
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
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Proprietà Figlio ({parentMode === 'grid' ? 'Grid Item' : 'Flex & Grid Item'})
          </span>

          <div className="prop-row">
            <span className="prop-label">Grow/Shrink</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
              <input
                type="number"
                className="studio-input"
                data-testid="inspector-flex-grow"
                placeholder="Grow"
                title="flex-grow"
                value={flexChild.grow ?? ''}
                onChange={(e) =>
                  applyLayoutPatch(
                    { flexChild: { ...flexChild, grow: e.target.value === '' ? undefined : Number(e.target.value) } },
                    'Flex Grow',
                  )
                }
              />
              <input
                type="number"
                className="studio-input"
                data-testid="inspector-flex-shrink"
                placeholder="Shrink"
                title="flex-shrink"
                value={flexChild.shrink ?? ''}
                onChange={(e) =>
                  applyLayoutPatch(
                    { flexChild: { ...flexChild, shrink: e.target.value === '' ? undefined : Number(e.target.value) } },
                    'Flex Shrink',
                  )
                }
              />
              <input
                type="number"
                className="studio-input"
                placeholder="Order"
                title="order"
                value={flexChild.order ?? ''}
                onChange={(e) =>
                  applyLayoutPatch(
                    { flexChild: { ...flexChild, order: e.target.value === '' ? undefined : Number(e.target.value) } },
                    'Flex Order',
                  )
                }
              />
            </div>
          </div>

          <div className="prop-row">
            <span className="prop-label">Basis / Self</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <input
                className="studio-input"
                placeholder="Basis (auto/px)"
                title="flex-basis"
                value={
                  flexChild.basis === 'auto'
                    ? 'auto'
                    : flexChild.basis !== undefined
                      ? String(resolveTokenOrValue(flexChild.basis, tokenMap, 0))
                      : ''
                }
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  applyLayoutPatch(
                    {
                      flexChild: {
                        ...flexChild,
                        basis: raw === '' ? undefined : raw === 'auto' ? 'auto' : Number(raw) || 0,
                        basisUnit: 'px',
                      },
                    },
                    'Flex Basis',
                  );
                }}
              />
              <select
                className="studio-select"
                data-testid="inspector-align-self"
                value={flexChild.alignSelf ?? 'auto'}
                onChange={(e) =>
                  applyLayoutPatch(
                    { flexChild: { ...flexChild, alignSelf: e.target.value as typeof flexChild.alignSelf } },
                    'Align Self',
                  )
                }
              >
                <option value="auto">Self: auto</option>
                <option value="start">Self: start</option>
                <option value="center">Self: center</option>
                <option value="end">Self: end</option>
                <option value="stretch">Self: stretch</option>
                <option value="baseline">Self: baseline</option>
              </select>
            </div>
          </div>

          <div className="prop-row">
            <span className="prop-label">Col / Row Span</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <input
                type="number"
                min={1}
                max={12}
                className="studio-input"
                data-testid="inspector-grid-col-span"
                placeholder="Col Span"
                title="grid-column: span N"
                value={gridChild.colSpan ?? ''}
                onChange={(e) =>
                  applyLayoutPatch(
                    {
                      gridChild: {
                        ...gridChild,
                        colSpan: e.target.value === '' ? undefined : Math.max(1, Number(e.target.value)),
                      },
                    },
                    'Grid Col Span',
                  )
                }
              />
              <input
                type="number"
                min={1}
                max={12}
                className="studio-input"
                data-testid="inspector-grid-row-span"
                placeholder="Row Span"
                title="grid-row: span N"
                value={gridChild.rowSpan ?? ''}
                onChange={(e) =>
                  applyLayoutPatch(
                    {
                      gridChild: {
                        ...gridChild,
                        rowSpan: e.target.value === '' ? undefined : Math.max(1, Number(e.target.value)),
                      },
                    },
                    'Grid Row Span',
                  )
                }
              />
            </div>
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
};
