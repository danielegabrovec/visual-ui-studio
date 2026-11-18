import React from 'react';
import { isTokenRef, resolveTokenOrValue, type TypographySpec } from '@shared/ui-ir';
import { useStudioStore } from '@renderer/state/studio-store';
import { CollapsibleSection, toSafeHexColor, type InspectorSectionProps } from './inspector-shared';

const FONT_FAMILIES = [
  { label: 'Token $font.sans', value: '$token:font.sans' },
  { label: 'Inter / Modern UI', value: "'Inter', system-ui, sans-serif" },
  { label: 'Plus Jakarta Sans', value: "'Plus Jakarta Sans', sans-serif" },
  { label: 'JetBrains Mono (Code)', value: "'JetBrains Mono', Consolas, monospace" },
  { label: 'Georgia Editorial Serif', value: 'Georgia, Cambria, serif' },
  { label: 'System Native UI', value: 'system-ui, -apple-system, sans-serif' },
];

export const TypographyProSection: React.FC<InspectorSectionProps> = ({
  node,
  tokens,
  tokenMap,
  effectiveTypography,
  applyTypographyPatch,
}) => {
  const commitOps = useStudioStore((s) => s.commitOps);
  const colorTokens = tokens.filter((t) => t.themeId === null && t.category === 'color');

  const typo: Partial<TypographySpec> = effectiveTypography ?? {
    fontFamily: { $token: 'font.sans' },
    fontSize: 15,
    fontWeight: 400,
    color: { $token: 'color.text.primary' },
  };

  const resolvedColorStr = String(resolveTokenOrValue(typo.color, tokenMap, '#f8fafc'));
  const currentTextHex = toSafeHexColor(resolvedColorStr, '#f8fafc');
  const fontSizeVal = Number(resolveTokenOrValue(typo.fontSize, tokenMap, 15));
  const fontWeightVal = String(resolveTokenOrValue(typo.fontWeight, tokenMap, 400));
  const lineHeightVal =
    typo.lineHeight === 'normal' ? '' : Number(resolveTokenOrValue(typo.lineHeight as any, tokenMap, 1.4));
  const letterSpacingVal = Number(resolveTokenOrValue(typo.letterSpacing, tokenMap, 0));

  const currentFontSelect = isTokenRef(typo.fontFamily)
    ? `$token:${typo.fontFamily.$token}`
    : String(typo.fontFamily ?? "'Inter', system-ui, sans-serif");

  return (
    <CollapsibleSection title="Tipografia Pro & Contenuto" testId="inspector-typography-pro-section">
      {/* Content Text & Placeholder */}
      <div className="prop-row">
        <span className="prop-label">Testo</span>
        <input
          className="studio-input"
          data-testid="inspector-content-text"
          value={node.content?.text ?? ''}
          onChange={(e) =>
            void commitOps(
              [{ op: 'update_node', id: node.id, content: { ...node.content, text: e.target.value } }],
              'Contenuto testo',
            )
          }
        />
      </div>

      {node.kind === 'control' && (
        <div className="prop-row">
          <span className="prop-label">Placeholder</span>
          <input
            className="studio-input"
            value={node.content?.placeholder ?? ''}
            onChange={(e) =>
              void commitOps(
                [{ op: 'update_node', id: node.id, content: { ...node.content, placeholder: e.target.value } }],
                'Placeholder',
              )
            }
          />
        </div>
      )}

      {/* Font Family */}
      <div className="prop-row">
        <span className="prop-label">Font Family</span>
        <select
          className="studio-select"
          data-testid="inspector-font-family"
          value={currentFontSelect}
          onChange={(e) => {
            const val = e.target.value;
            if (val.startsWith('$token:')) {
              applyTypographyPatch({ fontFamily: { $token: val.slice(7) } }, 'Font family token');
            } else {
              applyTypographyPatch({ fontFamily: val }, 'Font family');
            }
          }}
        >
          {FONT_FAMILIES.map((ff) => (
            <option key={ff.value} value={ff.value}>
              {ff.label}
            </option>
          ))}
        </select>
      </div>

      {/* Font Size + Unit & Weight + Italic */}
      <div className="prop-row">
        <span className="prop-label">Size / Peso</span>
        <div style={{ display: 'flex', gap: 3 }}>
          <input
            type="number"
            className="studio-input"
            data-testid="inspector-font-size"
            style={{ width: 52, padding: '3px 4px' }}
            value={fontSizeVal}
            onChange={(e) => applyTypographyPatch({ fontSize: Math.max(1, Number(e.target.value) || 14) }, 'Font size')}
          />
          <select
            className="studio-select"
            style={{ width: 48, padding: '2px 3px', fontSize: 10.5 }}
            value={typo.fontSizeUnit ?? 'px'}
            onChange={(e) =>
              applyTypographyPatch({ fontSizeUnit: e.target.value as TypographySpec['fontSizeUnit'] }, 'Font size unit')
            }
          >
            <option value="px">px</option>
            <option value="rem">rem</option>
            <option value="em">em</option>
            <option value="vw">vw</option>
          </select>
          <select
            className="studio-select"
            data-testid="inspector-font-weight"
            style={{ flex: 1, padding: '2px 4px', fontSize: 11 }}
            value={fontWeightVal}
            onChange={(e) => applyTypographyPatch({ fontWeight: Number(e.target.value) }, 'Font weight')}
          >
            <option value="300">300 Light</option>
            <option value="400">400 Regular</option>
            <option value="500">500 Medium</option>
            <option value="600">600 Semi</option>
            <option value="700">700 Bold</option>
            <option value="800">800 Extra</option>
            <option value="900">900 Black</option>
          </select>
          <button
            type="button"
            data-testid="btn-typo-italic"
            className={`studio-btn sm ${typo.fontStyle === 'italic' ? 'active' : ''}`}
            style={{ width: 24, padding: 0, fontStyle: 'italic', fontWeight: 700 }}
            onClick={() =>
              applyTypographyPatch({ fontStyle: typo.fontStyle === 'italic' ? 'normal' : 'italic' }, 'Font italic')
            }
            title="Corsivo (Italic)"
          >
            I
          </button>
        </div>
      </div>

      {/* Text Color + Token */}
      <div className="prop-row">
        <span className="prop-label">Colore Testo</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="color"
            value={currentTextHex}
            onChange={(e) => applyTypographyPatch({ color: e.target.value }, 'Colore testo')}
            style={{ width: 24, height: 24, border: 'none', padding: 0, background: 'transparent', cursor: 'pointer' }}
          />
          <input
            className="studio-input"
            style={{ width: 78, fontSize: 11 }}
            value={resolvedColorStr}
            onChange={(e) => applyTypographyPatch({ color: e.target.value }, 'Colore testo')}
          />
          <select
            className="studio-select"
            style={{ flex: 1, fontSize: 10.5, padding: '2px 4px' }}
            value={isTokenRef(typo.color) ? typo.color.$token : ''}
            onChange={(e) => {
              if (e.target.value) {
                applyTypographyPatch({ color: { $token: e.target.value } }, 'Token colore testo');
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
      </div>

      {/* Line-Height & Letter-Spacing */}
      <div className="prop-row">
        <span className="prop-label">Line / Track</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <input
            type="number"
            step="0.1"
            className="studio-input"
            placeholder="Line H (1.4)"
            title="line-height"
            value={lineHeightVal}
            onChange={(e) =>
              applyTypographyPatch(
                { lineHeight: e.target.value === '' ? 'normal' : Number(e.target.value) },
                'Line Height',
              )
            }
          />
          <input
            type="number"
            step="0.5"
            className="studio-input"
            placeholder="Letter (px)"
            title="letter-spacing (px)"
            value={letterSpacingVal}
            onChange={(e) =>
              applyTypographyPatch({ letterSpacing: Number(e.target.value) || 0, letterSpacingUnit: 'px' }, 'Letter Spacing')
            }
          />
        </div>
      </div>

      {/* Align & Transform */}
      <div className="prop-row">
        <span className="prop-label">Allinea/Case</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <select
            className="studio-select"
            value={typo.textAlign ?? 'left'}
            onChange={(e) =>
              applyTypographyPatch({ textAlign: e.target.value as TypographySpec['textAlign'] }, 'Text Align')
            }
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
            <option value="justify">Justify</option>
          </select>
          <select
            className="studio-select"
            data-testid="inspector-text-transform"
            value={typo.textTransform ?? 'none'}
            onChange={(e) =>
              applyTypographyPatch(
                { textTransform: e.target.value as TypographySpec['textTransform'] },
                'Text Transform',
              )
            }
          >
            <option value="none">Case: Normale</option>
            <option value="uppercase">UPPERCASE</option>
            <option value="lowercase">lowercase</option>
            <option value="capitalize">Capitalize</option>
          </select>
        </div>
      </div>

      {/* Decoration, Truncate / Ellipsis & Line-Clamp */}
      <div className="prop-row">
        <span className="prop-label">Wrap / Clamp</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 56px', gap: 4 }}>
          <select
            className="studio-select"
            value={typo.textDecoration ?? 'none'}
            onChange={(e) =>
              applyTypographyPatch(
                { textDecoration: e.target.value as TypographySpec['textDecoration'] },
                'Text Decoration',
              )
            }
          >
            <option value="none">No Line</option>
            <option value="underline">Underline</option>
            <option value="line-through">Strike</option>
          </select>
          <select
            className="studio-select"
            data-testid="inspector-text-overflow"
            value={typo.textOverflow === 'ellipsis' ? 'ellipsis' : typo.whiteSpace ?? 'normal'}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'ellipsis') {
                applyTypographyPatch({ whiteSpace: 'nowrap', textOverflow: 'ellipsis' }, 'Ellipsis Truncate');
              } else {
                applyTypographyPatch(
                  { whiteSpace: v as TypographySpec['whiteSpace'], textOverflow: 'clip' },
                  'White Space',
                );
              }
            }}
          >
            <option value="normal">Wrap</option>
            <option value="nowrap">Nowrap</option>
            <option value="ellipsis">Ellipsis (…)</option>
            <option value="pre-wrap">Pre-Wrap</option>
          </select>
          <input
            type="number"
            min={0}
            max={12}
            className="studio-input"
            placeholder="Clamp"
            title="-webkit-line-clamp (righe max)"
            value={typo.lineClamp ?? ''}
            onChange={(e) =>
              applyTypographyPatch(
                { lineClamp: e.target.value === '' || Number(e.target.value) <= 0 ? undefined : Number(e.target.value) },
                'Line Clamp',
              )
            }
          />
        </div>
      </div>

      {/* Text Shadow */}
      <div className="prop-row">
        <span className="prop-label">Text Shadow</span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button
            type="button"
            className={`studio-btn sm ${typo.textShadow ? 'active' : ''}`}
            onClick={() =>
              applyTypographyPatch(
                {
                  textShadow: typo.textShadow
                    ? undefined
                    : { x: 0, y: 2, blur: 8, color: 'rgba(0, 0, 0, 0.45)' },
                },
                'Toggle Text Shadow',
              )
            }
          >
            {typo.textShadow ? 'Attiva' : '+ Ombra Testo'}
          </button>
          {typo.textShadow && (
            <>
              <input
                type="number"
                className="studio-input"
                style={{ width: 42, padding: '2px 4px' }}
                value={typo.textShadow.blur}
                title="Blur ombra testo (px)"
                onChange={(e) =>
                  applyTypographyPatch(
                    { textShadow: { ...typo.textShadow!, blur: Math.max(0, Number(e.target.value) || 0) } },
                    'Text Shadow Blur',
                  )
                }
              />
              <input
                type="color"
                value={toSafeHexColor(String(resolveTokenOrValue(typo.textShadow.color, tokenMap, '#000000')), '#000000')}
                onChange={(e) =>
                  applyTypographyPatch(
                    { textShadow: { ...typo.textShadow!, color: e.target.value } },
                    'Text Shadow Color',
                  )
                }
                style={{ width: 22, height: 22, border: 'none', padding: 0, background: 'transparent' }}
              />
            </>
          )}
        </div>
      </div>
    </CollapsibleSection>
  );
};
