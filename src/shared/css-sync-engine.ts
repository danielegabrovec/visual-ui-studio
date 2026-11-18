import { buildTokenLookupMap } from './default-tokens';
import {
  isTokenRef,
  resolveTokenOrValue,
  type AxisDimensionSpec,
  type BorderSideSpec,
  type CodeDiagnostic,
  type CodeSourceMapSpan,
  type CssAnimationSpec,
  type CssTransitionSpec,
  type CssUnit,
  type DesignTokenEntry,
  type FilterSpec,
  type GridTrackSpec,
  type InteractiveStateKey,
  type LayoutSpec,
  type MarginBox,
  type MarginSideValue,
  type NodeId,
  type ReusableCssClass,
  type StateOverrideSpec,
  type StyleFill,
  type StyleShadow,
  type StyleSpec,
  type Transform2DSpec,
  type TypographySpec,
  type UINode,
  type UISheetDocument,
} from './ui-ir';
import type { UIPatchOp } from './ui-patch';

export interface CssCompileOptions {
  selectedNodeId?: NodeId | null;
  scope?: 'sheet' | 'selected';
  activeState?: 'base' | InteractiveStateKey;
}

export interface CssCompileResult {
  css: string;
  sourceMap: CodeSourceMapSpan[];
  selectorToNodeId: Record<string, NodeId>;
  nodeIdToSelector: Record<NodeId, string>;
}

export interface CssQuickSnippet {
  id: string;
  label: string;
  description: string;
  declarations: string;
}

export interface CssDeclarationContext {
  tokenMap: Record<string, string | number>;
  parentMode?: LayoutSpec['mode'];
  emitTokenVars?: boolean;
  isRoot?: boolean;
}

export interface SheetCssMetaBridge {
  reusableClasses?: ReusableCssClass[];
  keyframesCss?: string;
}

const uirSheetCssMetaRegistry = new WeakMap<object, SheetCssMetaBridge>();

export function registerSheetCssMetaForUIR(target: object, meta: SheetCssMetaBridge): void {
  uirSheetCssMetaRegistry.set(target, meta);
}

export function lookupSheetCssMetaForUIR(...candidates: Array<object | undefined | null>): SheetCssMetaBridge | undefined {
  for (const cand of candidates) {
    if (cand && typeof cand === 'object') {
      const found = uirSheetCssMetaRegistry.get(cand);
      if (found) return found;
    }
  }
  return undefined;
}

export const KEYFRAMES_PRESET_MAP: Record<string, string> = {
  'fade-in': `@keyframes fade-in {\n  0% { opacity: 0; }\n  100% { opacity: 1; }\n}`,
  'slide-up': `@keyframes slide-up {\n  0% { opacity: 0; transform: translateY(16px); }\n  100% { opacity: 1; transform: translateY(0); }\n}`,
  'slide-down': `@keyframes slide-down {\n  0% { opacity: 0; transform: translateY(-16px); }\n  100% { opacity: 1; transform: translateY(0); }\n}`,
  'scale-in': `@keyframes scale-in {\n  0% { opacity: 0; transform: scale(0.92); }\n  100% { opacity: 1; transform: scale(1); }\n}`,
  pulse: `@keyframes pulse {\n  0%, 100% { opacity: 1; }\n  50% { opacity: 0.55; }\n}`,
  spin: `@keyframes spin {\n  0% { transform: rotate(0deg); }\n  100% { transform: rotate(360deg); }\n}`,
  bounce: `@keyframes bounce {\n  0%, 100% { transform: translateY(0); }\n  50% { transform: translateY(-10px); }\n}`,
};

export const CSS_QUICK_SNIPPETS: CssQuickSnippet[] = [
  {
    id: 'glassmorphism',
    label: 'Glassmorphism',
    description: 'Sfondo traslucido con blur e bordo luminoso',
    declarations:
      'background: rgba(30, 41, 59, 0.68);\n  backdrop-filter: blur(14px);\n  border: 1px solid rgba(148, 163, 184, 0.28);\n  border-radius: 16px;',
  },
  {
    id: 'soft-shadow',
    label: 'Ombra Soft',
    description: 'Elevazione morbida multi-livello per card e modali',
    declarations:
      'box-shadow: 0 14px 32px rgba(15, 23, 42, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.08);\n  border-radius: 12px;',
  },
  {
    id: 'brand-gradient',
    label: 'Gradiente Brand',
    description: 'Gradiente lineare blu-viola ad alto contrasto',
    declarations: 'background: linear-gradient(135deg, #2563eb 0%, #8b5cf6 100%);\n  color: #ffffff;\n  border-radius: 10px;',
  },
  {
    id: 'center-flex',
    label: 'Centra Flex',
    description: 'Allineamento centrato sia orizzontale che verticale',
    declarations: 'display: flex;\n  flex-direction: row;\n  justify-content: center;\n  align-items: center;\n  gap: 12px;',
  },
  {
    id: 'grid-autofit',
    label: 'Grid Auto-Fit',
    description: 'Griglia responsiva con colonne minmax(220px, 1fr)',
    declarations: 'display: grid;\n  grid-template-columns: minmax(220px, 1fr) minmax(220px, 1fr);\n  gap: 16px;',
  },
  {
    id: 'hover-lift',
    label: 'Animazione Hover',
    description: 'Transizione fluida con effetto luminoso su :hover',
    declarations: 'transition: transform 180ms ease, box-shadow 180ms ease;\n  cursor: pointer;',
  },
  {
    id: 'card-hover-scale',
    label: 'Scale & Glow',
    description: 'Leggero ingrandimento 2D con bagliore neon',
    declarations:
      'transform: scale(1.02);\n  box-shadow: 0 0 24px rgba(59, 130, 246, 0.45);\n  transition: transform 200ms ease, box-shadow 200ms ease;',
  },
  {
    id: 'sticky-blur-nav',
    label: 'Navbar Sticky Blur',
    description: 'Header fisso in alto con sfocatura vetro',
    declarations:
      'position: sticky;\n  top: 0px;\n  z-index: 40;\n  backdrop-filter: blur(16px);\n  background: rgba(15, 23, 42, 0.78);',
  },
];

/**
 * Canonical 78+ CSS properties supported bidirectionally across Design <-> CSS <-> Codegen.
 */
export const SUPPORTED_CSS_PROPERTIES: readonly string[] = [
  // Positioning & Z (6)
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
  // Box Model (12)
  'display',
  'box-sizing',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  // Sizing, Aspect & Overflow (11)
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'aspect-ratio',
  'overflow',
  'overflow-x',
  'overflow-y',
  'object-fit',
  // Flexbox Container & Child (16)
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'align-items',
  'align-content',
  'justify-items',
  'place-items',
  'gap',
  'row-gap',
  'column-gap',
  'flex',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'align-self',
  'order',
  // CSS Grid Container & Child (7)
  'grid-template-columns',
  'grid-template-rows',
  'grid-column',
  'grid-row',
  'grid-column-start',
  'grid-row-start',
  'justify-self',
  // Backgrounds & Gradients (6)
  'background',
  'background-color',
  'background-image',
  'background-size',
  'background-position',
  'background-repeat',
  // Borders, Radii & Outline (18)
  'border',
  'border-width',
  'border-style',
  'border-color',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'outline',
  'outline-width',
  'outline-style',
  'outline-color',
  'outline-offset',
  // Shadows, Opacity, Blending & Filters (6)
  'box-shadow',
  'opacity',
  'mix-blend-mode',
  'filter',
  'backdrop-filter',
  '-webkit-backdrop-filter',
  // 2D Transforms, Transitions & Animations (4)
  'transform',
  'rotate',
  'transform-origin',
  'transition',
  'animation',
  // Pro Typography (15)
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'text-decoration',
  'white-space',
  'text-overflow',
  '-webkit-line-clamp',
  'line-clamp',
  'text-shadow',
  // Interactivity (3)
  'cursor',
  'pointer-events',
  'user-select',
];

const KNOWN_MAPPED_PROPS = new Set<string>(SUPPORTED_CSS_PROPERTIES);

const ALL_PSEUDO_STATES: readonly InteractiveStateKey[] = [
  'hover',
  'active',
  'focus',
  'focus-visible',
  'disabled',
];

// ============================================================================
// PARENTHESIS-AWARE CSS TOKENIZERS
// ============================================================================

export function splitTopLevelCommas(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = '';

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      cur += ch;
      if (ch === quote && input[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === '(') {
      depth++;
      cur += ch;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
      cur += ch;
    } else if (ch === ',' && depth === 0) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

export function splitTopLevelSpaces(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = '';

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      cur += ch;
      if (ch === quote && input[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === '(') {
      depth++;
      cur += ch;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
      cur += ch;
    } else if (/\s/.test(ch) && depth === 0) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function splitCssDeclarationList(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = '';

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      cur += ch;
      if (ch === quote && body[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === '(') {
      depth++;
      cur += ch;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
      cur += ch;
    } else if (ch === ';' && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function slugifyNodeName(raw: string): string {
  const slug = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return slug || 'element';
}

export function sanitizeCssClassSlug(raw: string): string {
  return raw.trim().replace(/^\.+/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

export function buildSheetSelectorMaps(sheet: UISheetDocument): {
  selectorToNodeId: Record<string, NodeId>;
  nodeIdToSelector: Record<NodeId, string>;
} {
  const selectorToNodeId: Record<string, NodeId> = {};
  const nodeIdToSelector: Record<NodeId, string> = {};
  const usedCounts = new Map<string, number>();
  const reservedReusable = new Set((sheet.reusableClasses ?? []).map((rc) => `.${sanitizeCssClassSlug(rc.name)}`));

  const registerNode = (nodeId: NodeId) => {
    const node = sheet.nodes[nodeId];
    if (!node || nodeIdToSelector[nodeId]) return;
    const base = slugifyNodeName(node.name || node.kind);
    let prev = usedCounts.get(base) ?? 0;
    let className = prev === 0 ? `.${base}` : `.${base}-${prev + 1}`;
    while (reservedReusable.has(className) || selectorToNodeId[className]) {
      prev++;
      className = `.${base}-${prev + 1}`;
    }
    usedCounts.set(base, prev + 1);
    nodeIdToSelector[nodeId] = className;
    selectorToNodeId[className] = nodeId;
    selectorToNodeId[`#${node.id}`] = nodeId;
    for (const cid of node.childIds) {
      registerNode(cid);
    }
  };

  for (const rid of sheet.rootIds) {
    registerNode(rid);
  }
  for (const nid of Object.keys(sheet.nodes)) {
    registerNode(nid);
  }

  return { selectorToNodeId, nodeIdToSelector };
}

// ============================================================================
// CANONICAL FORWARD COMPILER (IR -> CSS DECLARATIONS & REACT INLINE STYLES)
// ============================================================================

function formatTokenOrLiteral(
  val: unknown,
  tokenMap: Record<string, string | number>,
  fallback: string | number,
  unit = '',
  emitTokenVars = true,
): string {
  if (val === undefined || val === null) return `${fallback}${unit}`;
  if (isTokenRef(val as any)) {
    const tokPath = (val as { $token: string }).$token;
    const varName = `--${tokPath.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`;
    const resolved = tokenMap[tokPath];
    if (!emitTokenVars) {
      if (resolved !== undefined) {
        return typeof resolved === 'number' ? `${resolved}${unit}` : String(resolved);
      }
      return `${fallback}${unit}`;
    }
    if (resolved !== undefined) {
      const lit = typeof resolved === 'number' ? `${resolved}${unit}` : String(resolved);
      return `var(${varName}, ${lit})`;
    }
    return `var(${varName})`;
  }
  return typeof val === 'number' ? `${val}${unit}` : String(val);
}

function formatMarginSide(
  side: MarginSideValue | undefined,
  tokenMap: Record<string, string | number>,
  emitTokenVars = true,
): string {
  if (side === 'auto') return 'auto';
  if (side === undefined || side === null) return '0px';
  return formatTokenOrLiteral(side, tokenMap, 0, 'px', emitTokenVars);
}

export function formatGridTrackCss(t: GridTrackSpec): string {
  if (t.track === 'auto') return 'auto';
  if (t.track === 'minmax') return `minmax(${t.min ?? '180px'}, ${t.max ?? '1fr'})`;
  if (t.track === '%') return `${t.value ?? 50}%`;
  if (t.track === 'fr') return `${t.value ?? 1}fr`;
  return `${t.value ?? 120}px`;
}

export function formatFillCssLayer(
  fill: StyleFill,
  tokenMap: Record<string, string | number>,
  emitTokenVars = true,
  isBottomLayer = true,
): string | null {
  if (fill.enabled === false) return null;
  if (fill.type === 'solid') {
    const c = formatTokenOrLiteral(fill.color, tokenMap, 'transparent', '', emitTokenVars);
    return isBottomLayer ? c : `linear-gradient(${c}, ${c})`;
  }
  if (fill.type === 'linear-gradient') {
    const stops = fill.stops
      .map((s) => {
        const pct = s.pos <= 1 && s.pos >= 0 ? Math.round(s.pos * 100) : Math.round(s.pos);
        return `${formatTokenOrLiteral(s.color, tokenMap, '#3b82f6', '', emitTokenVars)} ${pct}%`;
      })
      .join(', ');
    return `linear-gradient(${fill.angle ?? 135}deg, ${stops})`;
  }
  if (fill.type === 'radial-gradient') {
    const shape = fill.shape ?? 'circle';
    const cx = fill.centerX ?? 50;
    const cy = fill.centerY ?? 50;
    const stops = fill.stops
      .map((s) => {
        const pct = s.pos <= 1 && s.pos >= 0 ? Math.round(s.pos * 100) : Math.round(s.pos);
        return `${formatTokenOrLiteral(s.color, tokenMap, '#3b82f6', '', emitTokenVars)} ${pct}%`;
      })
      .join(', ');
    return `radial-gradient(${shape} at ${cx}% ${cy}%, ${stops})`;
  }
  if (fill.type === 'conic-gradient') {
    const angle = fill.angle ?? 0;
    const cx = fill.centerX ?? 50;
    const cy = fill.centerY ?? 50;
    const stops = fill.stops
      .map((s) => {
        const pct = s.pos <= 1 && s.pos >= 0 ? Math.round(s.pos * 100) : Math.round(s.pos);
        return `${formatTokenOrLiteral(s.color, tokenMap, '#3b82f6', '', emitTokenVars)} ${pct}%`;
      })
      .join(', ');
    return `conic-gradient(from ${angle}deg at ${cx}% ${cy}%, ${stops})`;
  }
  if (fill.type === 'image') {
    const url = fill.imageUrl || 'https://placehold.co/600x360';
    const pos = fill.position || 'center';
    const fit = fill.fit === 'custom' ? 'auto' : fill.fit || 'cover';
    const rep = fill.repeat || 'no-repeat';
    return `url("${url}") ${pos} / ${fit} ${rep}`;
  }
  return null;
}

export function formatBoxShadowsCss(
  shadows: StyleShadow[] | undefined,
  tokenMap: Record<string, string | number>,
  emitTokenVars = true,
): string | null {
  if (!shadows || shadows.length === 0) return null;
  return shadows
    .map((s) => {
      const col = formatTokenOrLiteral(s.color, tokenMap, 'rgba(0,0,0,0.2)', '', emitTokenVars);
      return `${s.inset ? 'inset ' : ''}${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${col}`;
    })
    .join(', ');
}

export function formatFilterCss(filters: FilterSpec | undefined): string | null {
  if (!filters) return null;
  const fns: string[] = [];
  if (filters.blur && filters.blur > 0) fns.push(`blur(${filters.blur}px)`);
  if (filters.brightness !== undefined && filters.brightness !== 100) fns.push(`brightness(${filters.brightness}%)`);
  if (filters.contrast !== undefined && filters.contrast !== 100) fns.push(`contrast(${filters.contrast}%)`);
  if (filters.saturate !== undefined && filters.saturate !== 100) fns.push(`saturate(${filters.saturate}%)`);
  if (filters.grayscale && filters.grayscale > 0) fns.push(`grayscale(${filters.grayscale}%)`);
  if (filters.hueRotate && filters.hueRotate !== 0) fns.push(`hue-rotate(${filters.hueRotate}deg)`);
  if (filters.invert && filters.invert > 0) fns.push(`invert(${filters.invert}%)`);
  return fns.length > 0 ? fns.join(' ') : null;
}

export function formatBackdropFilterCss(backdropBlur?: number, filters?: FilterSpec): string | null {
  const fns: string[] = [];
  const blurPx = backdropBlur ?? filters?.backdropBlur;
  if (blurPx && blurPx > 0) fns.push(`blur(${blurPx}px)`);
  if (filters?.backdropSaturate !== undefined && filters.backdropSaturate !== 100) {
    fns.push(`saturate(${filters.backdropSaturate}%)`);
  }
  if (filters?.backdropBrightness !== undefined && filters.backdropBrightness !== 100) {
    fns.push(`brightness(${filters.backdropBrightness}%)`);
  }
  return fns.length > 0 ? fns.join(' ') : null;
}

export function formatTransform2DCss(t: Transform2DSpec | undefined): string | null {
  if (!t) return null;
  const fns: string[] = [];
  if (t.translateX) fns.push(`translateX(${t.translateX}${t.translateXUnit ?? 'px'})`);
  if (t.translateY) fns.push(`translateY(${t.translateY}${t.translateYUnit ?? 'px'})`);
  if (t.rotate) fns.push(`rotate(${t.rotate}deg)`);
  if (t.scaleX !== undefined && t.scaleY !== undefined && (t.scaleX !== 1 || t.scaleY !== 1)) {
    if (t.scaleX === t.scaleY) fns.push(`scale(${t.scaleX})`);
    else fns.push(`scale(${t.scaleX}, ${t.scaleY})`);
  } else {
    if (t.scaleX !== undefined && t.scaleX !== 1) fns.push(`scaleX(${t.scaleX})`);
    if (t.scaleY !== undefined && t.scaleY !== 1) fns.push(`scaleY(${t.scaleY})`);
  }
  if (t.skewX) fns.push(`skewX(${t.skewX}deg)`);
  if (t.skewY) fns.push(`skewY(${t.skewY}deg)`);
  return fns.length > 0 ? fns.join(' ') : null;
}

export function formatTransitionsCss(transitions: CssTransitionSpec[] | undefined): string | null {
  if (!transitions || transitions.length === 0) return null;
  return transitions
    .map((tr) => {
      const prop = tr.property || 'all';
      const dur = `${tr.durationMs ?? 200}ms`;
      const tim = tr.timing || 'ease';
      const del = tr.delayMs ? ` ${tr.delayMs}ms` : '';
      return `${prop} ${dur} ${tim}${del}`;
    })
    .join(', ');
}

export function formatAnimationCss(anim: CssAnimationSpec | undefined): string | null {
  if (!anim || !anim.name || anim.name === 'none') return null;
  const dur = `${anim.durationMs ?? 400}ms`;
  const tim = anim.timing || 'ease';
  const del = `${anim.delayMs ?? 0}ms`;
  const iter = anim.iterationCount !== undefined ? String(anim.iterationCount) : '1';
  const dir = anim.direction || 'normal';
  const fill = anim.fillMode || 'both';
  return `${anim.name} ${dur} ${tim} ${del} ${iter} ${dir} ${fill}`;
}

function emitSharedStyleAndTypoDeclarations(
  style: Partial<StyleSpec> | undefined,
  typography: Partial<TypographySpec> | undefined,
  tokenMap: Record<string, string | number>,
  emitTokenVars = true,
): string[] {
  const decls: string[] = [];

  if (style) {
    if (style.zIndex !== undefined) {
      decls.push(`z-index: ${style.zIndex};`);
    }

    const enabledFills = (style.fills ?? []).filter((f) => f.enabled !== false);
    if (enabledFills.length > 0) {
      const layers = enabledFills
        .map((f, idx) => formatFillCssLayer(f, tokenMap, emitTokenVars, idx === enabledFills.length - 1))
        .filter((x): x is string => Boolean(x));
      if (layers.length > 0) {
        decls.push(`background: ${layers.join(', ')};`);
      }
    }

    if (style.border) {
      const sides = style.border.sides;
      if (sides && Object.keys(sides).length > 0) {
        for (const side of ['top', 'right', 'bottom', 'left'] as const) {
          const spec = sides[side];
          if (!spec) continue;
          if (spec.style === 'none') {
            decls.push(`border-${side}: none;`);
          } else {
            const w = formatTokenOrLiteral(spec.width, tokenMap, 1, 'px', emitTokenVars);
            const c = formatTokenOrLiteral(spec.color, tokenMap, '#334155', '', emitTokenVars);
            decls.push(`border-${side}: ${w} ${spec.style} ${c};`);
          }
        }
      } else if (style.border.style === 'none') {
        if (style.border.width === 0) decls.push(`border: none;`);
      } else if (style.border.style) {
        const bc = formatTokenOrLiteral(style.border.color, tokenMap, '#334155', '', emitTokenVars);
        if (typeof style.border.width === 'object' && !isTokenRef(style.border.width)) {
          const bw = style.border.width;
          if (bw.top === bw.right && bw.right === bw.bottom && bw.bottom === bw.left) {
            decls.push(`border: ${bw.top}px ${style.border.style} ${bc};`);
          } else {
            decls.push(`border-style: ${style.border.style};`);
            decls.push(`border-color: ${bc};`);
            decls.push(`border-width: ${bw.top}px ${bw.right}px ${bw.bottom}px ${bw.left}px;`);
          }
        } else {
          const bw = formatTokenOrLiteral(style.border.width, tokenMap, 1, 'px', emitTokenVars);
          decls.push(`border: ${bw} ${style.border.style} ${bc};`);
        }
      }
    }

    if (style.outline && style.outline.style !== 'none' && style.outline.width > 0) {
      const oc = formatTokenOrLiteral(style.outline.color, tokenMap, '#3b82f6', '', emitTokenVars);
      decls.push(`outline: ${style.outline.width}px ${style.outline.style} ${oc};`);
      if (style.outline.offset !== undefined) {
        decls.push(`outline-offset: ${style.outline.offset}px;`);
      }
    }

    if (style.radius !== undefined) {
      if (typeof style.radius === 'object' && !isTokenRef(style.radius)) {
        decls.push(
          `border-radius: ${style.radius.tl}px ${style.radius.tr}px ${style.radius.br}px ${style.radius.bl}px;`,
        );
      } else {
        const resolvedNum = resolveTokenOrValue(style.radius, tokenMap, 0);
        if (Number(resolvedNum) > 0 || isTokenRef(style.radius)) {
          decls.push(`border-radius: ${formatTokenOrLiteral(style.radius, tokenMap, 0, 'px', emitTokenVars)};`);
        }
      }
    }

    if (style.opacity !== undefined && style.opacity < 1) {
      decls.push(`opacity: ${style.opacity};`);
    }

    if (style.mixBlendMode && style.mixBlendMode !== 'normal') {
      decls.push(`mix-blend-mode: ${style.mixBlendMode};`);
    }

    const filterStr = formatFilterCss(style.filters);
    if (filterStr) {
      decls.push(`filter: ${filterStr};`);
    }

    const backdropStr = formatBackdropFilterCss(style.backdropBlur, style.filters);
    if (backdropStr) {
      decls.push(`backdrop-filter: ${backdropStr};`);
    }

    const boxShad = formatBoxShadowsCss(style.shadows, tokenMap, emitTokenVars);
    if (boxShad) {
      decls.push(`box-shadow: ${boxShad};`);
    }

    const tfStr = formatTransform2DCss(style.transform);
    if (tfStr) {
      decls.push(`transform: ${tfStr};`);
    }
    if (style.transform?.origin) {
      decls.push(`transform-origin: ${style.transform.origin};`);
    }

    const trStr = formatTransitionsCss(style.transitions);
    if (trStr) {
      decls.push(`transition: ${trStr};`);
    }

    const animStr = formatAnimationCss(style.animation);
    if (animStr) {
      decls.push(`animation: ${animStr};`);
    }

    if (style.cursor && style.cursor !== 'auto') {
      decls.push(`cursor: ${style.cursor};`);
    }
    if (style.pointerEvents && style.pointerEvents !== 'auto') {
      decls.push(`pointer-events: ${style.pointerEvents};`);
    }
    if (style.userSelect && style.userSelect !== 'auto') {
      decls.push(`user-select: ${style.userSelect};`);
    }
  }

  if (typography) {
    if (typography.color !== undefined) {
      decls.push(`color: ${formatTokenOrLiteral(typography.color, tokenMap, '#f8fafc', '', emitTokenVars)};`);
    }
    if (typography.fontFamily !== undefined) {
      decls.push(
        `font-family: ${formatTokenOrLiteral(typography.fontFamily, tokenMap, 'Inter, system-ui, sans-serif', '', emitTokenVars)};`,
      );
    }
    if (typography.fontSize !== undefined) {
      const fUnit = typography.fontSizeUnit ?? 'px';
      decls.push(`font-size: ${formatTokenOrLiteral(typography.fontSize, tokenMap, 14, fUnit, emitTokenVars)};`);
    }
    if (typography.fontWeight !== undefined) {
      decls.push(`font-weight: ${formatTokenOrLiteral(typography.fontWeight, tokenMap, 400, '', emitTokenVars)};`);
    }
    if (typography.fontStyle && typography.fontStyle !== 'normal') {
      decls.push(`font-style: ${typography.fontStyle};`);
    }
    if (typography.textAlign) {
      decls.push(`text-align: ${typography.textAlign};`);
    }
    if (typography.lineHeight !== undefined) {
      const lhUnit =
        typography.lineHeight === 'normal' || !typography.lineHeightUnit || typography.lineHeightUnit === 'unitless'
          ? ''
          : typography.lineHeightUnit;
      decls.push(`line-height: ${formatTokenOrLiteral(typography.lineHeight, tokenMap, 1.4, lhUnit, emitTokenVars)};`);
    }
    if (typography.letterSpacing !== undefined && typography.letterSpacing !== 0) {
      const lsUnit = typography.letterSpacingUnit ?? 'px';
      decls.push(
        `letter-spacing: ${formatTokenOrLiteral(typography.letterSpacing, tokenMap, 0, lsUnit, emitTokenVars)};`,
      );
    }
    if (typography.textTransform && typography.textTransform !== 'none') {
      decls.push(`text-transform: ${typography.textTransform};`);
    }
    if (typography.textDecoration && typography.textDecoration !== 'none') {
      decls.push(`text-decoration: ${typography.textDecoration};`);
    }
    if (typography.whiteSpace && typography.whiteSpace !== 'normal') {
      decls.push(`white-space: ${typography.whiteSpace};`);
    }
    if (typography.textOverflow && typography.textOverflow !== 'clip') {
      decls.push(`text-overflow: ${typography.textOverflow};`);
    }
    if (typography.lineClamp && typography.lineClamp > 0) {
      decls.push(`-webkit-line-clamp: ${typography.lineClamp};`);
    }
    if (typography.textShadow) {
      const ts = typography.textShadow;
      const tc = formatTokenOrLiteral(ts.color, tokenMap, 'rgba(0,0,0,0.35)', '', emitTokenVars);
      decls.push(`text-shadow: ${ts.x}px ${ts.y}px ${ts.blur}px ${tc};`);
    }
  }

  if (style?.customCss?.trim()) {
    for (const declaration of splitCssDeclarationList(style.customCss)) {
      const trimmed = declaration.trim();
      if (trimmed) decls.push(`${trimmed};`);
    }
  }

  return decls;
}

function emitPartialLayoutDeclarations(
  layout: Partial<LayoutSpec>,
  tokenMap: Record<string, string | number>,
  emitTokenVars = true,
  opts: { isArtboard?: boolean; parentMode?: LayoutSpec['mode'] } = {},
): string[] {
  const decls: string[] = [];
  const isFloating =
    !opts.isArtboard &&
    (layout.positioning === 'absolute' ||
      layout.positioning === 'fixed' ||
      (opts.parentMode === 'freeform' && layout.positioning !== 'flow' && layout.positioning !== 'sticky'));

  if (isFloating) {
    decls.push(`position: ${layout.positioning === 'fixed' ? 'fixed' : 'absolute'};`);
    const leftVal = layout.pins?.left ?? (layout.pins?.right === undefined ? layout.frame?.x : undefined);
    const topVal = layout.pins?.top ?? (layout.pins?.bottom === undefined ? layout.frame?.y : undefined);
    if (leftVal !== undefined) decls.push(`left: ${leftVal}px;`);
    if (topVal !== undefined) decls.push(`top: ${topVal}px;`);
    if (layout.pins?.right !== undefined) decls.push(`right: ${layout.pins.right}px;`);
    if (layout.pins?.bottom !== undefined) decls.push(`bottom: ${layout.pins.bottom}px;`);
  } else if (layout.positioning === 'sticky') {
    decls.push(`position: sticky;`);
    const topPin = layout.pins?.top ?? (layout.frame ? Math.round(layout.frame.y) : 0);
    decls.push(`top: ${topPin}px;`);
    if (layout.pins?.left !== undefined) decls.push(`left: ${layout.pins.left}px;`);
    if (layout.pins?.right !== undefined) decls.push(`right: ${layout.pins.right}px;`);
    if (layout.pins?.bottom !== undefined) decls.push(`bottom: ${layout.pins.bottom}px;`);
  } else if (layout.mode === 'freeform') {
    decls.push(`position: relative;`);
  }

  if (layout.boxSizing) {
    decls.push(`box-sizing: ${layout.boxSizing};`);
  }

  // Container layout mode
  const jMap: Record<string, string> = {
    start: 'flex-start',
    center: 'center',
    end: 'flex-end',
    'space-between': 'space-between',
    'space-around': 'space-around',
    'space-evenly': 'space-evenly',
  };
  const aMap: Record<string, string> = {
    start: 'flex-start',
    center: 'center',
    end: 'flex-end',
    stretch: 'stretch',
    baseline: 'baseline',
  };

  if (layout.mode === 'flex') {
    decls.push(`display: flex;`);
    decls.push(`flex-direction: ${layout.direction ?? 'column'};`);
    if (layout.wrap === true || layout.wrap === 'wrap') decls.push(`flex-wrap: wrap;`);
    else if (layout.wrap === 'wrap-reverse') decls.push(`flex-wrap: wrap-reverse;`);
    if (layout.justify) decls.push(`justify-content: ${jMap[layout.justify] ?? 'flex-start'};`);
    if (layout.align) decls.push(`align-items: ${aMap[layout.align] ?? 'stretch'};`);
    if (layout.alignContent) decls.push(`align-content: ${jMap[layout.alignContent] ?? layout.alignContent};`);
    if (layout.placeItems) decls.push(`place-items: ${layout.placeItems};`);
    if (layout.gap !== undefined) {
      decls.push(`gap: ${formatTokenOrLiteral(layout.gap, tokenMap, 0, 'px', emitTokenVars)};`);
    }
    if (layout.rowGap !== undefined) {
      decls.push(`row-gap: ${formatTokenOrLiteral(layout.rowGap, tokenMap, 0, 'px', emitTokenVars)};`);
    }
    if (layout.columnGap !== undefined) {
      decls.push(`column-gap: ${formatTokenOrLiteral(layout.columnGap, tokenMap, 0, 'px', emitTokenVars)};`);
    }
  } else if (layout.mode === 'grid') {
    decls.push(`display: grid;`);
    const cols =
      layout.gridCols && layout.gridCols.length > 0
        ? layout.gridCols.map(formatGridTrackCss).join(' ')
        : 'repeat(3, 1fr)';
    decls.push(`grid-template-columns: ${cols};`);
    if (layout.gridRows && layout.gridRows.length > 0) {
      decls.push(`grid-template-rows: ${layout.gridRows.map(formatGridTrackCss).join(' ')};`);
    }
    if (layout.justifyItems) decls.push(`justify-items: ${layout.justifyItems};`);
    if (layout.align) decls.push(`align-items: ${aMap[layout.align] ?? layout.align};`);
    if (layout.placeItems) decls.push(`place-items: ${layout.placeItems};`);
    if (layout.gap !== undefined) {
      decls.push(`gap: ${formatTokenOrLiteral(layout.gap, tokenMap, 12, 'px', emitTokenVars)};`);
    }
    if (layout.rowGap !== undefined) {
      decls.push(`row-gap: ${formatTokenOrLiteral(layout.rowGap, tokenMap, 0, 'px', emitTokenVars)};`);
    }
    if (layout.columnGap !== undefined) {
      decls.push(`column-gap: ${formatTokenOrLiteral(layout.columnGap, tokenMap, 0, 'px', emitTokenVars)};`);
    }
  }

  // Flex Child
  if (layout.flexChild) {
    const fc = layout.flexChild;
    if (fc.grow !== undefined) decls.push(`flex-grow: ${fc.grow};`);
    if (fc.shrink !== undefined) decls.push(`flex-shrink: ${fc.shrink};`);
    if (fc.basis !== undefined) {
      if (fc.basis === 'auto') {
        decls.push(`flex-basis: auto;`);
      } else {
        const bUnit = fc.basisUnit ?? 'px';
        decls.push(`flex-basis: ${formatTokenOrLiteral(fc.basis, tokenMap, 0, bUnit, emitTokenVars)};`);
      }
    }
    if (fc.alignSelf && fc.alignSelf !== 'auto') {
      decls.push(`align-self: ${aMap[fc.alignSelf] ?? fc.alignSelf};`);
    }
    if (fc.order !== undefined) decls.push(`order: ${fc.order};`);
  }

  // Grid Child
  if (layout.gridChild) {
    const gc = layout.gridChild;
    if (gc.colStart !== undefined && gc.colSpan !== undefined && gc.colSpan > 1) {
      decls.push(`grid-column: ${gc.colStart} / span ${gc.colSpan};`);
    } else if (gc.colSpan !== undefined && gc.colSpan > 1) {
      decls.push(`grid-column: span ${gc.colSpan};`);
    } else if (gc.colStart !== undefined) {
      decls.push(`grid-column-start: ${gc.colStart};`);
    }

    if (gc.rowStart !== undefined && gc.rowSpan !== undefined && gc.rowSpan > 1) {
      decls.push(`grid-row: ${gc.rowStart} / span ${gc.rowSpan};`);
    } else if (gc.rowSpan !== undefined && gc.rowSpan > 1) {
      decls.push(`grid-row: span ${gc.rowSpan};`);
    } else if (gc.rowStart !== undefined) {
      decls.push(`grid-row-start: ${gc.rowStart};`);
    }

    if (gc.alignSelf && gc.alignSelf !== 'auto') {
      decls.push(`align-self: ${gc.alignSelf};`);
    }
    if (gc.justifySelf && gc.justifySelf !== 'auto') {
      decls.push(`justify-self: ${gc.justifySelf};`);
    }
  }

  // Sizing & Constraints
  if (layout.width) {
    const wSpec = layout.width;
    const fallbackW = layout.frame?.width ?? 160;
    if (wSpec.mode === 'fill') {
      decls.push(`width: 100%;`);
    } else if (wSpec.mode === 'auto' || wSpec.unit === 'auto') {
      decls.push(`width: auto;`);
    } else if (wSpec.mode === 'percentage') {
      decls.push(`width: ${formatTokenOrLiteral(wSpec.value ?? 100, tokenMap, 100, '%', emitTokenVars)};`);
    } else if (wSpec.mode === 'viewport') {
      const u = wSpec.unit ?? 'vw';
      decls.push(`width: ${formatTokenOrLiteral(wSpec.value ?? 100, tokenMap, 100, u, emitTokenVars)};`);
    } else if (wSpec.mode === 'rem') {
      const u = wSpec.unit ?? 'rem';
      decls.push(`width: ${formatTokenOrLiteral(wSpec.value ?? 16, tokenMap, 16, u, emitTokenVars)};`);
    } else if (wSpec.mode === 'fixed' || isFloating) {
      const u = wSpec.unit ?? 'px';
      const wVal = wSpec.value ?? fallbackW;
      decls.push(`width: ${formatTokenOrLiteral(wVal, tokenMap, fallbackW, u, emitTokenVars)};`);
    }
    if (wSpec.min !== undefined) {
      const mu = wSpec.minUnit ?? 'px';
      decls.push(`min-width: ${formatTokenOrLiteral(wSpec.min, tokenMap, 0, mu, emitTokenVars)};`);
    }
    if (wSpec.max !== undefined) {
      const xu = wSpec.maxUnit ?? 'px';
      decls.push(`max-width: ${formatTokenOrLiteral(wSpec.max, tokenMap, 0, xu, emitTokenVars)};`);
    }
  }

  if (layout.height) {
    const hSpec = layout.height;
    const fallbackH = layout.frame?.height ?? 44;
    if (opts.isArtboard) {
      const h = hSpec.mode === 'hug' ? fallbackH : resolveTokenOrValue(hSpec.value, tokenMap, fallbackH);
      decls.push(`min-height: ${Math.round(Number(h) || fallbackH)}px;`);
    } else if (hSpec.mode === 'fill') {
      decls.push(`height: 100%;`);
    } else if (hSpec.mode === 'auto' || hSpec.unit === 'auto') {
      decls.push(`height: auto;`);
    } else if (hSpec.mode === 'percentage') {
      decls.push(`height: ${formatTokenOrLiteral(hSpec.value ?? 100, tokenMap, 100, '%', emitTokenVars)};`);
    } else if (hSpec.mode === 'viewport') {
      const u = hSpec.unit ?? 'vh';
      decls.push(`height: ${formatTokenOrLiteral(hSpec.value ?? 100, tokenMap, 100, u, emitTokenVars)};`);
    } else if (hSpec.mode === 'rem') {
      const u = hSpec.unit ?? 'rem';
      decls.push(`height: ${formatTokenOrLiteral(hSpec.value ?? 4, tokenMap, 4, u, emitTokenVars)};`);
    } else if (hSpec.mode === 'fixed') {
      const u = hSpec.unit ?? 'px';
      if (u !== 'px') {
        decls.push(`height: ${formatTokenOrLiteral(hSpec.value ?? fallbackH, tokenMap, fallbackH, u, emitTokenVars)};`);
      } else {
        const h = resolveTokenOrValue(hSpec.value, tokenMap, fallbackH);
        decls.push(`height: ${Math.round(Number(h) || fallbackH)}px;`);
      }
    }
    if (hSpec.min !== undefined) {
      const mu = hSpec.minUnit ?? 'px';
      decls.push(`min-height: ${formatTokenOrLiteral(hSpec.min, tokenMap, 0, mu, emitTokenVars)};`);
    }
    if (hSpec.max !== undefined) {
      const xu = hSpec.maxUnit ?? 'px';
      decls.push(`max-height: ${formatTokenOrLiteral(hSpec.max, tokenMap, 0, xu, emitTokenVars)};`);
    }
  }

  if (layout.aspectRatio) {
    decls.push(`aspect-ratio: ${layout.aspectRatio};`);
  }

  // Margin
  if (layout.margin) {
    const m = layout.margin;
    const hasAnyMargin =
      m.top === 'auto' ||
      m.right === 'auto' ||
      m.bottom === 'auto' ||
      m.left === 'auto' ||
      Boolean(resolveTokenOrValue(m.top as any, tokenMap, 0)) ||
      Boolean(resolveTokenOrValue(m.right as any, tokenMap, 0)) ||
      Boolean(resolveTokenOrValue(m.bottom as any, tokenMap, 0)) ||
      Boolean(resolveTokenOrValue(m.left as any, tokenMap, 0));
    if (hasAnyMargin) {
      const mt = formatMarginSide(m.top, tokenMap, emitTokenVars);
      const mr = formatMarginSide(m.right, tokenMap, emitTokenVars);
      const mb = formatMarginSide(m.bottom, tokenMap, emitTokenVars);
      const ml = formatMarginSide(m.left, tokenMap, emitTokenVars);
      if (mt === mr && mr === mb && mb === ml) {
        decls.push(`margin: ${mt};`);
      } else if (mt === mb && mr === ml) {
        decls.push(`margin: ${mt} ${mr};`);
      } else {
        decls.push(`margin: ${mt} ${mr} ${mb} ${ml};`);
      }
    }
  }

  // Padding
  if (layout.padding) {
    const pt = resolveTokenOrValue(layout.padding.top, tokenMap, 0);
    const pr = resolveTokenOrValue(layout.padding.right, tokenMap, 0);
    const pb = resolveTokenOrValue(layout.padding.bottom, tokenMap, 0);
    const pl = resolveTokenOrValue(layout.padding.left, tokenMap, 0);
    if (pt || pr || pb || pl) {
      const ft = formatTokenOrLiteral(layout.padding.top, tokenMap, 0, 'px', emitTokenVars);
      const fr = formatTokenOrLiteral(layout.padding.right, tokenMap, 0, 'px', emitTokenVars);
      const fb = formatTokenOrLiteral(layout.padding.bottom, tokenMap, 0, 'px', emitTokenVars);
      const fl = formatTokenOrLiteral(layout.padding.left, tokenMap, 0, 'px', emitTokenVars);
      if (ft === fr && fr === fb && fb === fl) {
        decls.push(`padding: ${ft};`);
      } else {
        decls.push(`padding: ${ft} ${fr} ${fb} ${fl};`);
      }
    }
  }

  // Overflow & Object-Fit
  if (layout.overflow && layout.overflow !== 'visible') {
    decls.push(`overflow: ${layout.overflow};`);
  }
  if (layout.overflowX && layout.overflowX !== 'visible') {
    decls.push(`overflow-x: ${layout.overflowX};`);
  }
  if (layout.overflowY && layout.overflowY !== 'visible') {
    decls.push(`overflow-y: ${layout.overflowY};`);
  }
  if (layout.objectFit) {
    decls.push(`object-fit: ${layout.objectFit};`);
  }

  return decls;
}

export function compileNodeToCssDeclarations(
  node: Pick<UINode, 'kind' | 'layout' | 'style' | 'typography'>,
  ctx: CssDeclarationContext,
): string[] {
  const emitVars = ctx.emitTokenVars !== false;
  const layoutDecls = emitPartialLayoutDeclarations(node.layout, ctx.tokenMap, emitVars, {
    isArtboard: node.kind === 'artboard',
    parentMode: ctx.parentMode,
  });
  const styleAndTypo = emitSharedStyleAndTypoDeclarations(node.style, node.typography, ctx.tokenMap, emitVars);
  if (node.layout.frame.rotation) layoutDecls.push(`rotate: ${node.layout.frame.rotation}deg;`);
  return [...layoutDecls, ...styleAndTypo];
}

export function compileStateOverrideToCssDeclarations(
  override: StateOverrideSpec,
  ctx: CssDeclarationContext,
): string[] {
  const emitVars = ctx.emitTokenVars !== false;
  const layoutDecls = override.layout
    ? emitPartialLayoutDeclarations(override.layout, ctx.tokenMap, emitVars)
    : [];
  const styleAndTypo = emitSharedStyleAndTypoDeclarations(override.style, override.typography, ctx.tokenMap, emitVars);
  return [...layoutDecls, ...styleAndTypo];
}

export function compileKeyframesCss(usedAnimationNames?: Iterable<string>, customKeyframesCss?: string): string {
  const blocks: string[] = [];
  const emitted = new Set<string>();

  if (usedAnimationNames) {
    for (const rawName of usedAnimationNames) {
      const clean = rawName.trim();
      if (!clean || clean === 'none' || emitted.has(clean)) continue;
      if (KEYFRAMES_PRESET_MAP[clean]) {
        blocks.push(KEYFRAMES_PRESET_MAP[clean]);
        emitted.add(clean);
      } else if (clean.startsWith('studio-') && KEYFRAMES_PRESET_MAP[clean.slice(7)]) {
        blocks.push(KEYFRAMES_PRESET_MAP[clean.slice(7)].replace(`@keyframes ${clean.slice(7)}`, `@keyframes ${clean}`));
        emitted.add(clean);
      }
    }
  }

  if (customKeyframesCss?.trim()) {
    blocks.push(customKeyframesCss.trim());
  }

  return blocks.join('\n\n');
}

export function compileSheetKeyframesCss(sheet: UISheetDocument): string {
  const usedNames = new Set<string>();
  for (const entry of [...Object.values(sheet.nodes), ...(sheet.reusableClasses ?? [])]) {
    if (entry.style?.animation?.name) usedNames.add(entry.style.animation.name);
    const stateOverrides = entry.stateOverrides ?? ('states' in entry ? entry.states : undefined);
    for (const override of Object.values(stateOverrides ?? {})) {
      if (override?.style?.animation?.name) usedNames.add(override.style.animation.name);
    }
  }
  return compileKeyframesCss(usedNames, sheet.keyframesCss);
}

export function compileReusableClassesCss(
  reusableClasses: ReusableCssClass[] | undefined,
  tokenMap: Record<string, string | number>,
  options: {
    emitTokenVars?: boolean;
    scope?: 'base' | 'states';
    stateSelector?: (selector: string, state: InteractiveStateKey) => string;
  } = {},
): string {
  if (!reusableClasses || reusableClasses.length === 0) return '';
  const lines: string[] = [];
  const ctx = { tokenMap, emitTokenVars: options.emitTokenVars };

  for (const rc of reusableClasses) {
    const slug = sanitizeCssClassSlug(rc.name);
    if (!slug) continue;
    if (options.scope !== 'states') {
      lines.push(`/* @reusable-class ${slug} */`);
      lines.push(`.${slug} {`);
      const baseDecls = compileStateOverrideToCssDeclarations(
        { layout: rc.layout, style: rc.style, typography: rc.typography },
        ctx,
      );
      for (const d of baseDecls) {
        lines.push(`  ${d}`);
      }
      lines.push(`}`);
    }

    const stateMap = rc.stateOverrides ?? rc.states ?? {};
    for (const sk of options.scope === 'base' ? [] : ALL_PSEUDO_STATES) {
      const ov = stateMap[sk];
      if (!ov) continue;
      const sDecls = compileStateOverrideToCssDeclarations(ov, ctx);
      if (sDecls.length > 0) {
        const selector = options.stateSelector?.(`.${slug}`, sk) ?? `.${slug}:${sk}`;
        lines.push(`${selector} {`);
        for (const sd of sDecls) {
          lines.push(`  ${sd}`);
        }
        lines.push(`}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/**
 * Resolves the effective cascaded `(layout, style, typography)` for a UINode by merging:
 *   1. Attached `ReusableCssClass`es (base)
 *   2. `node.layout` / `node.style` / `node.typography`
 *   3. If `activeState !== 'base'`: attached `ReusableCssClass` stateOverrides[activeState] + `node.stateOverrides[activeState]`
 */
export function mergeCascadedNodeSpecs(
  node: UINode,
  reusableClasses: ReusableCssClass[] | undefined,
  activeState: 'base' | InteractiveStateKey = 'base',
): { layout: LayoutSpec; style: StyleSpec; typography?: TypographySpec } {
  const attachedNames = node.classNames ?? node.style.classNames ?? [];
  const classMap = new Map<string, ReusableCssClass>();
  for (const rc of reusableClasses ?? []) {
    classMap.set(sanitizeCssClassSlug(rc.name), rc);
  }

  let layout: LayoutSpec = structuredClone(node.layout);
  let style: StyleSpec = {};
  let typography: TypographySpec | undefined = undefined;

  // 1. Apply reusable classes as base defaults (node explicit properties win!)
  for (const rawName of attachedNames) {
    const rc = classMap.get(sanitizeCssClassSlug(rawName));
    if (!rc) continue;
    if (rc.style) {
      style = { ...style, ...structuredClone(rc.style) };
    }
    if (rc.typography) {
      typography = {
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: 15,
        fontWeight: 400,
        color: '#f8fafc',
        ...(typography ?? {}),
        ...structuredClone(rc.typography),
      };
    }
    if (rc.layout) {
      layout = {
        ...structuredClone(rc.layout),
        ...layout,
        padding: layout.padding ?? rc.layout.padding ?? { top: 0, right: 0, bottom: 0, left: 0 },
        margin: layout.margin ?? (rc.layout.margin ? structuredClone(rc.layout.margin) : undefined),
      } as LayoutSpec;
    }
  }

  // 2. Merge node's own style & typography (only explicit non-default node properties override reusable classes!)
  const nodeHasFills = Boolean(node.style.fills && node.style.fills.length > 0);
  const nodeHasRadius =
    node.style.radius !== undefined &&
    (typeof node.style.radius === 'object' || Number(node.style.radius) > 0);
  const nodeHasOpacity = node.style.opacity !== undefined && node.style.opacity !== 1;
  style = {
    ...style,
    ...structuredClone(node.style),
    fills: nodeHasFills ? structuredClone(node.style.fills) : style.fills,
    radius: nodeHasRadius ? structuredClone(node.style.radius) : (style.radius ?? node.style.radius),
    opacity: nodeHasOpacity ? node.style.opacity : (style.opacity ?? node.style.opacity),
  };

  if (node.typography) {
    typography = {
      ...(typography ?? {}),
      ...structuredClone(node.typography),
    } as TypographySpec;
  }

  // 3. Apply active interactive pseudo-state override (`:hover`, `:active`, `:focus`, `:disabled`)
  if (activeState && activeState !== 'base') {
    for (const rawName of attachedNames) {
      const rc = classMap.get(sanitizeCssClassSlug(rawName));
      const rcOv = rc?.stateOverrides?.[activeState] ?? rc?.states?.[activeState];
      if (rcOv?.layout) layout = { ...layout, ...structuredClone(rcOv.layout) };
      if (rcOv?.style) style = { ...style, ...structuredClone(rcOv.style) };
      if (rcOv?.typography) {
        typography = {
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 15,
          fontWeight: 400,
          color: '#f8fafc',
          ...(typography ?? {}),
          ...structuredClone(rcOv.typography),
        };
      }
    }

    const nodeOv = node.stateOverrides?.[activeState];
    if (nodeOv?.layout) layout = { ...layout, ...structuredClone(nodeOv.layout) };
    if (nodeOv?.style) style = { ...style, ...structuredClone(nodeOv.style) };
    if (nodeOv?.typography) {
      typography = {
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: 15,
        fontWeight: 400,
        color: '#f8fafc',
        ...(typography ?? {}),
        ...structuredClone(nodeOv.typography),
      };
    }
  }

  return { layout, style, typography };
}

function cssDeclsToReactStyleObject(decls: string[]): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const raw of decls) {
    const trimmed = raw.trim().replace(/;$/, '');
    const colon = trimmed.indexOf(':');
    if (colon <= 0) continue;
    const prop = trimmed.slice(0, colon).trim();
    const val = trimmed.slice(colon + 1).trim();
    if (!prop || !val) continue;
    if (prop.startsWith('--')) {
      out[prop] = val;
    } else {
      const camel = prop
        .replace(/^-webkit-/, 'Webkit-')
        .replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
      out[camel] = val;
    }
  }
  return out;
}

export function compileNodeToReactStyle(
  node: UINode,
  ctx: {
    tokenMap: Record<string, string | number>;
    parentMode?: string;
    reusableClasses?: ReusableCssClass[];
    activeState?: 'base' | InteractiveStateKey;
    artboardWidthOverride?: number;
  },
): Record<string, string | number | undefined> {
  const merged = mergeCascadedNodeSpecs(node, ctx.reusableClasses, ctx.activeState ?? 'base');
  const isCanvasFloating = node.kind !== 'artboard' && (
    merged.layout.positioning === 'absolute' ||
    (ctx.parentMode === 'freeform' && merged.layout.positioning === 'flow')
  );
  const canvasLayout = isCanvasFloating
    ? { ...merged.layout, positioning: 'absolute' as const }
    : merged.layout;
  const decls = compileNodeToCssDeclarations(
    {
      kind: node.kind,
      layout: canvasLayout,
      style: merged.style,
      typography: merged.typography,
    },
    {
      tokenMap: ctx.tokenMap,
      parentMode: (ctx.parentMode as LayoutSpec['mode']) ?? undefined,
      emitTokenVars: false,
    },
  );
  const styleObj: Record<string, string | number | undefined> = {
    boxSizing: merged.layout.boxSizing ?? 'border-box',
    ...cssDeclsToReactStyleObject(decls),
  };

  if (node.kind === 'artboard') {
    styleObj.position = 'absolute';
    styleObj.left = merged.layout.frame.x;
    styleObj.top = merged.layout.frame.y;
    styleObj.width = ctx.artboardWidthOverride ?? merged.layout.frame.width;
    styleObj.minHeight = merged.layout.frame.height;
    if (!merged.style.shadows?.length) {
      styleObj.boxShadow = '0 22px 50px rgba(0, 0, 0, 0.38)';
    }
  } else if (isCanvasFloating) {
    if (merged.layout.width.mode === 'fill') styleObj.width = merged.layout.frame.width;
    if (merged.layout.height.mode === 'hug') styleObj.minHeight ??= merged.layout.frame.height;
  } else if (merged.layout.width.mode === 'fill' && ctx.parentMode === 'flex' && !merged.layout.flexChild) {
    styleObj.flex = '1 1 0%';
  }

  if (merged.typography?.lineClamp && merged.typography.lineClamp > 0) {
    styleObj.display = '-webkit-box';
    styleObj.WebkitBoxOrient = 'vertical';
    styleObj.overflow = 'hidden';
  }

  return styleObj;
}

// ============================================================================
// FULL SHEET -> CSS COMPILER WITH SOURCEMAPS
// ============================================================================

export function compileSheetToCss(
  sheet: UISheetDocument,
  tokens: DesignTokenEntry[],
  activeThemeId?: string | null,
  opts: CssCompileOptions = {},
): CssCompileResult {
  const tokenMap = buildTokenLookupMap(tokens, activeThemeId ?? null);
  const { selectorToNodeId, nodeIdToSelector } = buildSheetSelectorMaps(sheet);
  const lines: string[] = [];
  const sourceMap: CodeSourceMapSpan[] = [];
  const scope = opts.scope ?? 'sheet';

  if (scope === 'sheet') {
    lines.push(`/* Foglio Stili Live — ${sheet.name} (Sincronizzazione Bidirezionale CSS <-> Design) */`);
    lines.push(`:root {`);
    for (const [path, val] of Object.entries(tokenMap)) {
      const varName = `--${path.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`;
      const formatted =
        typeof val === 'number' && (path.startsWith('space.') || path.startsWith('radius.')) ? `${val}px` : String(val);
      lines.push(`  ${varName}: ${formatted};`);
    }
    lines.push(`}`);
    lines.push(``);

    const kfCss = compileSheetKeyframesCss(sheet);
    if (kfCss) {
      lines.push(`/* @keyframes Animations */`);
      lines.push(...kfCss.split('\n'));
      lines.push(``);
    }

    const reusableCss = compileReusableClassesCss(sheet.reusableClasses, tokenMap);
    if (reusableCss) {
      lines.push(`/* Classi CSS Riutilizzabili */`);
      lines.push(...reusableCss.split('\n'));
      lines.push(``);
    }
  }

  const emitNodeBlock = (nodeId: NodeId, parentMode?: LayoutSpec['mode']) => {
    const node = sheet.nodes[nodeId];
    if (!node || !node.visible) return;

    const sel = nodeIdToSelector[nodeId] ?? `#${nodeId}`;
    const startLine = lines.length + 1;
    lines.push(`/* @node ${node.id} (${node.name}) */`);
    lines.push(`${sel} {`);
    const decls = compileNodeToCssDeclarations(node, { tokenMap, parentMode, emitTokenVars: true });
    for (const d of decls) {
      lines.push(`  ${d}`);
    }
    lines.push(`}`);

    for (const sk of ALL_PSEUDO_STATES) {
      const ov = node.stateOverrides?.[sk];
      const wantsPlaceholder =
        scope === 'selected' && opts.selectedNodeId === node.id && opts.activeState === sk && !ov;
      if (ov || wantsPlaceholder) {
        lines.push(`${sel}:${sk} {`);
        const sDecls = ov
          ? compileStateOverrideToCssDeclarations(ov, { tokenMap, emitTokenVars: true })
          : [`/* Aggiungi regole :${sk} qui */`];
        for (const sd of sDecls) {
          lines.push(`  ${sd}`);
        }
        lines.push(`}`);
      }
    }

    const endLine = lines.length;
    sourceMap.push({
      canvasNodeId: node.id,
      startLine,
      startCol: 1,
      endLine,
      endCol: (lines[endLine - 1]?.length ?? 1) + 1,
    });
    lines.push(``);

    if (scope === 'sheet') {
      for (const cid of node.childIds) {
        emitNodeBlock(cid, node.layout.mode);
      }
    }
  };

  if (scope === 'selected' && opts.selectedNodeId && sheet.nodes[opts.selectedNodeId]) {
    const target = sheet.nodes[opts.selectedNodeId];
    const parentMode = target.parentId ? sheet.nodes[target.parentId]?.layout.mode : undefined;
    emitNodeBlock(target.id, parentMode);
  } else {
    for (const rid of sheet.rootIds) {
      emitNodeBlock(rid, 'freeform');
    }
  }

  if (scope === 'sheet' && sheet.customCss?.trim()) {
    lines.push(`/* Custom Sheet CSS */`);
    lines.push(sheet.customCss.trim());
    lines.push(``);
  }

  return {
    css: lines.join('\n').trimEnd() + '\n',
    sourceMap,
    selectorToNodeId,
    nodeIdToSelector,
  };
}

// ============================================================================
// REVERSE CSS PARSER (78-PROP CSS -> UIPatchOp[])
// ============================================================================

function parseNumericWithUnit(raw: string): { num: number; unit: CssUnit } | null {
  const trimmed = raw.trim();
  const varMatch = trimmed.match(/^var\([^,]+,\s*(-?\d+(?:\.\d+)?)(px|%|vw|vh|rem|em|fr)?\s*\)$/i);
  if (varMatch) {
    return { num: Number(varMatch[1]), unit: ((varMatch[2] || 'px').toLowerCase() as CssUnit) };
  }
  const m = trimmed.match(/^(-?\d+(?:\.\d+)?)(px|%|vw|vh|rem|em|fr)?$/i);
  if (!m) return null;
  return { num: Number(m[1]), unit: ((m[2] || 'px').toLowerCase() as CssUnit) };
}

function parsePx(raw: string): number | undefined {
  const parsed = parseNumericWithUnit(raw);
  if (!parsed) return undefined;
  return Math.round(parsed.num);
}

function parseMarginToken(tok: string): MarginSideValue {
  if (tok.trim().toLowerCase() === 'auto') return 'auto';
  return parsePx(tok) ?? 0;
}

function parseDurationMs(tok: string): number | undefined {
  const m = tok.trim().match(/^(\d+(?:\.\d+)?)(ms|s)$/i);
  if (!m) return undefined;
  const val = Number(m[1]);
  return m[2].toLowerCase() === 's' ? Math.round(val * 1000) : Math.round(val);
}

function parseAxisDimension(
  val: string,
  existingAxis: AxisDimensionSpec | undefined,
  onPxFrameUpdate?: (px: number) => void,
): AxisDimensionSpec | null {
  const v = val.trim();
  const base = existingAxis ? { ...existingAxis } : { mode: 'fixed' as const };
  if (v === '100%') {
    return { ...base, mode: 'fill', value: 100, unit: '%' };
  }
  if (v === 'fit-content' || v === 'max-content' || v === 'min-content') {
    return { ...base, mode: 'hug' };
  }
  if (v === 'auto') {
    return { ...base, mode: 'auto', unit: 'auto' };
  }
  const parsed = parseNumericWithUnit(v);
  if (!parsed || parsed.num < 0) return null;
  if (parsed.unit === '%') {
    return { ...base, mode: 'percentage', value: parsed.num, unit: '%' };
  }
  if (parsed.unit === 'vw' || parsed.unit === 'vh') {
    return { ...base, mode: 'viewport', value: parsed.num, unit: parsed.unit };
  }
  if (parsed.unit === 'rem' || parsed.unit === 'em') {
    return { ...base, mode: 'rem', value: parsed.num, unit: parsed.unit };
  }
  const px = Math.round(parsed.num);
  if (px > 0 && onPxFrameUpdate) onPxFrameUpdate(px);
  return { ...base, mode: 'fixed', value: px, unit: parsed.unit };
}

function parseGridTracksValue(val: string): GridTrackSpec[] {
  const out: GridTrackSpec[] = [];
  const trimmed = val.trim();

  // Expand repeat(N, <track>) or repeat(auto-fit/auto-fill, minmax(...))
  const expandedTokens: string[] = [];
  for (const tok of splitTopLevelSpaces(trimmed)) {
    const rep = tok.match(/^repeat\(\s*(\d+|auto-fit|auto-fill)\s*,\s*(.+)\)$/i);
    if (rep) {
      const countOrMode = rep[1].toLowerCase();
      const inner = rep[2].trim();
      if (countOrMode === 'auto-fit' || countOrMode === 'auto-fill') {
        // Represent auto-fit minmax as 2 flexible minmax tracks in authoring IR
        expandedTokens.push(inner, inner);
      } else {
        const count = Math.min(12, Math.max(1, Number(countOrMode)));
        for (let i = 0; i < count; i++) expandedTokens.push(inner);
      }
    } else {
      expandedTokens.push(tok);
    }
  }

  for (const tok of expandedTokens) {
    const mm = tok.match(/^minmax\(\s*([^,]+)\s*,\s*([^)]+)\s*\)$/i);
    if (mm) {
      out.push({ track: 'minmax', min: mm[1].trim(), max: mm[2].trim() });
      continue;
    }
    if (tok.toLowerCase() === 'auto') {
      out.push({ track: 'auto' });
      continue;
    }
    const parsed = parseNumericWithUnit(tok);
    if (parsed) {
      if (parsed.unit === 'fr') out.push({ track: 'fr', value: parsed.num });
      else if (parsed.unit === '%') out.push({ track: '%', value: parsed.num });
      else out.push({ track: 'px', value: Math.round(parsed.num) });
    }
  }

  return out;
}

function parseGradientStops(stopTokens: string[]): Array<{ pos: number; color: string }> {
  return stopTokens.map((rawStop, idx) => {
    const tokens = splitTopLevelSpaces(rawStop);
    let color = tokens[0] ?? '#3b82f6';
    let pos = idx / Math.max(1, stopTokens.length - 1);
    if (tokens.length >= 2) {
      const last = tokens[tokens.length - 1];
      if (last.endsWith('%')) {
        const pct = Number(last.slice(0, -1));
        if (Number.isFinite(pct)) {
          pos = Math.max(0, Math.min(1, pct / 100));
          color = tokens.slice(0, -1).join(' ');
        }
      }
    }
    return { pos: Number(pos.toFixed(4)), color };
  });
}

function parseSingleFillLayer(layerStr: string): StyleFill | null {
  const s = layerStr.trim();
  if (!s || s === 'none') return null;

  // linear-gradient(...)
  const linMatch = s.match(/^linear-gradient\(([\s\S]+)\)$/i);
  if (linMatch) {
    const args = splitTopLevelCommas(linMatch[1]);
    if (args.length === 2 && args[0] === args[1] && !args[0].includes('deg')) {
      return { type: 'solid', color: args[0] };
    }
    let angle = 135;
    let stopArgs = args;
    const degMatch = args[0]?.match(/^(-?\d+(?:\.\d+)?)deg$/i);
    if (degMatch) {
      angle = Number(degMatch[1]);
      stopArgs = args.slice(1);
    } else if (/^to\s+/i.test(args[0] ?? '')) {
      const dir = args[0].toLowerCase();
      if (dir.includes('right') && dir.includes('bottom')) angle = 135;
      else if (dir.includes('right')) angle = 90;
      else if (dir.includes('bottom')) angle = 180;
      else if (dir.includes('top')) angle = 0;
      else if (dir.includes('left')) angle = 270;
      stopArgs = args.slice(1);
    }
    return {
      type: 'linear-gradient',
      angle,
      stops: parseGradientStops(stopArgs),
    };
  }

  // radial-gradient(...)
  const radMatch = s.match(/^radial-gradient\(([\s\S]+)\)$/i);
  if (radMatch) {
    const args = splitTopLevelCommas(radMatch[1]);
    let shape: 'circle' | 'ellipse' = 'circle';
    let centerX = 50;
    let centerY = 50;
    let stopArgs = args;
    const header = args[0] ?? '';
    if (/^(circle|ellipse)/i.test(header) || /\bat\b/i.test(header)) {
      if (/ellipse/i.test(header)) shape = 'ellipse';
      const atMatch = header.match(/at\s+(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/i);
      if (atMatch) {
        centerX = Number(atMatch[1]);
        centerY = Number(atMatch[2]);
      }
      stopArgs = args.slice(1);
    }
    return {
      type: 'radial-gradient',
      shape,
      centerX,
      centerY,
      stops: parseGradientStops(stopArgs),
    };
  }

  // conic-gradient(...)
  const conicMatch = s.match(/^conic-gradient\(([\s\S]+)\)$/i);
  if (conicMatch) {
    const args = splitTopLevelCommas(conicMatch[1]);
    let angle = 0;
    let centerX = 50;
    let centerY = 50;
    let stopArgs = args;
    const header = args[0] ?? '';
    if (/^from\s+/i.test(header) || /\bat\b/i.test(header)) {
      const fromMatch = header.match(/from\s+(-?\d+(?:\.\d+)?)deg/i);
      if (fromMatch) angle = Number(fromMatch[1]);
      const atMatch = header.match(/at\s+(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/i);
      if (atMatch) {
        centerX = Number(atMatch[1]);
        centerY = Number(atMatch[2]);
      }
      stopArgs = args.slice(1);
    }
    return {
      type: 'conic-gradient',
      angle,
      centerX,
      centerY,
      stops: parseGradientStops(stopArgs),
    };
  }

  // url(...) image layer
  const urlMatch = s.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)(.*)$/i);
  if (urlMatch) {
    const imageUrl = urlMatch[1].trim();
    const rest = urlMatch[2].trim();
    let fit: 'cover' | 'contain' | 'fill' | 'custom' = 'cover';
    if (/\bcontain\b/i.test(rest)) fit = 'contain';
    else if (/\bfill\b/i.test(rest)) fit = 'fill';
    let repeat: 'no-repeat' | 'repeat' | 'repeat-x' | 'repeat-y' = 'no-repeat';
    if (/\brepeat-x\b/i.test(rest)) repeat = 'repeat-x';
    else if (/\brepeat-y\b/i.test(rest)) repeat = 'repeat-y';
    else if (/(^|\s)repeat(\s|$)/i.test(rest)) repeat = 'repeat';
    return {
      type: 'image',
      imageUrl,
      fit,
      position: 'center',
      repeat,
    };
  }

  return { type: 'solid', color: s };
}

function parseSingleShadow(raw: string): StyleShadow | null {
  const tokens = splitTopLevelSpaces(raw.trim());
  if (tokens.length < 3) return null;
  let inset = false;
  const filtered: string[] = [];
  for (const t of tokens) {
    if (t.toLowerCase() === 'inset') inset = true;
    else filtered.push(t);
  }
  if (filtered.length < 2) return null;

  // Color may be first or last token
  const firstIsLen = parsePx(filtered[0]) !== undefined;
  let lenTokens: string[];
  let color: string;
  if (firstIsLen) {
    const numericPrefix: string[] = [];
    let idx = 0;
    while (idx < filtered.length && parsePx(filtered[idx]) !== undefined && numericPrefix.length < 4) {
      numericPrefix.push(filtered[idx]);
      idx++;
    }
    lenTokens = numericPrefix;
    color = filtered.slice(idx).join(' ') || 'rgba(0, 0, 0, 0.25)';
  } else {
    color = filtered[0];
    lenTokens = filtered.slice(1);
  }

  const x = parsePx(lenTokens[0] ?? '0') ?? 0;
  const y = parsePx(lenTokens[1] ?? '0') ?? 0;
  const blur = Math.max(0, parsePx(lenTokens[2] ?? '0') ?? 0);
  const spread = parsePx(lenTokens[3] ?? '0') ?? 0;

  return { x, y, blur, spread, color, ...(inset ? { inset: true } : {}) };
}

function parseBorderShorthand(val: string): BorderSideSpec | null {
  const v = val.trim();
  if (v === 'none' || v === '0') {
    return { width: 0, style: 'none', color: 'transparent' };
  }
  const tokens = splitTopLevelSpaces(v);
  let width = 1;
  let style: BorderSideSpec['style'] = 'solid';
  const colorParts: string[] = [];

  for (const tok of tokens) {
    const low = tok.toLowerCase();
    if (low === 'solid' || low === 'dashed' || low === 'dotted' || low === 'double' || low === 'none') {
      style = low;
    } else {
      const px = parsePx(tok);
      if (px !== undefined && tok.toLowerCase().endsWith('px')) {
        width = Math.max(0, px);
      } else {
        colorParts.push(tok);
      }
    }
  }
  return {
    width,
    style,
    color: colorParts.join(' ') || '#334155',
  };
}

function mapDeclarationsToNodeUpdate(
  decls: Array<{ prop: string; val: string }>,
  existing?: Partial<Pick<UINode, 'kind' | 'layout' | 'style' | 'typography'>>,
): {
  layout: Partial<LayoutSpec>;
  style: Partial<StyleSpec>;
  typography: Partial<TypographySpec>;
  hasLayout: boolean;
  hasStyle: boolean;
  hasTypo: boolean;
} {
  const layout: Partial<LayoutSpec> = {};
  const frame = existing?.layout?.frame
    ? { ...existing.layout.frame }
    : { x: 0, y: 0, width: 160, height: 44 };
  const padding = existing?.layout?.padding
    ? { ...existing.layout.padding }
    : { top: 0, right: 0, bottom: 0, left: 0 };
  const margin: MarginBox = existing?.layout?.margin
    ? { ...existing.layout.margin }
    : { top: 0, right: 0, bottom: 0, left: 0 };
  const pins = existing?.layout?.pins ? { ...existing.layout.pins } : {};

  let frameChanged = false;
  let padChanged = false;
  let marginChanged = false;
  let pinsChanged = false;

  const style: Partial<StyleSpec> = {};
  const typography: Partial<TypographySpec> = {};
  const customLines: string[] = [];

  let hasLayout = false;
  let hasStyle = false;
  let hasTypo = false;

  const ensureRadiusObj = () => {
    const cur = style.radius ?? existing?.style?.radius ?? 0;
    if (typeof cur === 'object' && !isTokenRef(cur)) return { ...cur };
    const n = typeof cur === 'number' ? cur : 0;
    return { tl: n, tr: n, br: n, bl: n };
  };

  for (const { prop, val } of decls) {
    const p = prop.toLowerCase();
    const v = val.trim();

    if (p === 'position') {
      if (v === 'absolute' || v === 'fixed' || v === 'sticky') {
        layout.positioning = v;
        hasLayout = true;
      } else if (v === 'relative' || v === 'static') {
        layout.positioning = 'flow';
        hasLayout = true;
      }
    } else if (p === 'left') {
      const n = parsePx(v);
      if (n !== undefined) {
        frame.x = n;
        pins.left = n;
        if (existing?.kind !== 'artboard' && !layout.positioning) layout.positioning = 'absolute';
        frameChanged = true;
        pinsChanged = true;
        hasLayout = true;
      }
    } else if (p === 'top') {
      const n = parsePx(v);
      if (n !== undefined) {
        frame.y = n;
        pins.top = n;
        if (existing?.kind !== 'artboard' && !layout.positioning && existing?.layout?.positioning !== 'sticky') {
          layout.positioning = 'absolute';
        }
        frameChanged = true;
        pinsChanged = true;
        hasLayout = true;
      }
    } else if (p === 'right') {
      const n = parsePx(v);
      if (n !== undefined) {
        pins.right = n;
        pinsChanged = true;
        hasLayout = true;
      }
    } else if (p === 'bottom') {
      const n = parsePx(v);
      if (n !== undefined) {
        pins.bottom = n;
        pinsChanged = true;
        hasLayout = true;
      }
    } else if (p === 'z-index') {
      const n = Number(v);
      if (Number.isFinite(n)) {
        style.zIndex = Math.round(n);
        hasStyle = true;
      }
    } else if (p === 'box-sizing') {
      if (v === 'border-box' || v === 'content-box') {
        layout.boxSizing = v;
        hasLayout = true;
      }
    } else if (p === 'display') {
      if (v === 'flex' || v === 'inline-flex') {
        layout.mode = 'flex';
        hasLayout = true;
      } else if (v === 'grid' || v === 'inline-grid') {
        layout.mode = 'grid';
        hasLayout = true;
      } else if (v === 'block') {
        layout.mode = 'freeform';
        hasLayout = true;
      }
    } else if (p === 'flex-direction') {
      if (v === 'row' || v === 'column' || v === 'row-reverse' || v === 'column-reverse') {
        layout.mode = 'flex';
        layout.direction = v;
        hasLayout = true;
      }
    } else if (p === 'flex-wrap') {
      if (v === 'wrap-reverse') layout.wrap = 'wrap-reverse';
      else if (v === 'wrap') layout.wrap = true;
      else layout.wrap = false;
      hasLayout = true;
    } else if (p === 'justify-content') {
      const map: Record<string, LayoutSpec['justify']> = {
        'flex-start': 'start',
        start: 'start',
        center: 'center',
        'flex-end': 'end',
        end: 'end',
        'space-between': 'space-between',
        'space-around': 'space-around',
        'space-evenly': 'space-evenly',
      };
      if (map[v]) {
        layout.justify = map[v];
        hasLayout = true;
      }
    } else if (p === 'align-items') {
      const map: Record<string, LayoutSpec['align']> = {
        'flex-start': 'start',
        start: 'start',
        center: 'center',
        'flex-end': 'end',
        end: 'end',
        stretch: 'stretch',
        baseline: 'baseline',
      };
      if (map[v]) {
        layout.align = map[v];
        hasLayout = true;
      }
    } else if (p === 'align-content') {
      const map: Record<string, LayoutSpec['alignContent']> = {
        'flex-start': 'start',
        start: 'start',
        center: 'center',
        'flex-end': 'end',
        end: 'end',
        'space-between': 'space-between',
        'space-around': 'space-around',
        stretch: 'stretch',
      };
      if (map[v]) {
        layout.alignContent = map[v];
        hasLayout = true;
      }
    } else if (p === 'justify-items') {
      if (v === 'start' || v === 'center' || v === 'end' || v === 'stretch') {
        layout.justifyItems = v;
        hasLayout = true;
      }
    } else if (p === 'place-items') {
      layout.placeItems = v;
      hasLayout = true;
    } else if (p === 'gap') {
      const parts = splitTopLevelSpaces(v);
      if (parts.length === 2) {
        const rg = parsePx(parts[0]);
        const cg = parsePx(parts[1]);
        if (rg !== undefined) layout.rowGap = Math.max(0, rg);
        if (cg !== undefined) layout.columnGap = Math.max(0, cg);
        if (rg !== undefined && rg === cg) layout.gap = Math.max(0, rg);
        hasLayout = true;
      } else {
        const n = parsePx(v);
        if (n !== undefined) {
          layout.gap = Math.max(0, n);
          hasLayout = true;
        }
      }
    } else if (p === 'row-gap') {
      const n = parsePx(v);
      if (n !== undefined) {
        layout.rowGap = Math.max(0, n);
        hasLayout = true;
      }
    } else if (p === 'column-gap') {
      const n = parsePx(v);
      if (n !== undefined) {
        layout.columnGap = Math.max(0, n);
        hasLayout = true;
      }
    } else if (p === 'flex') {
      const fc = { ...(existing?.layout?.flexChild ?? {}), ...(layout.flexChild ?? {}) };
      if (v === 'none') {
        fc.grow = 0;
        fc.shrink = 0;
        fc.basis = 'auto';
      } else if (v === 'auto') {
        fc.grow = 1;
        fc.shrink = 1;
        fc.basis = 'auto';
      } else {
        const toks = splitTopLevelSpaces(v);
        if (toks[0] !== undefined && Number.isFinite(Number(toks[0]))) fc.grow = Number(toks[0]);
        if (toks[1] !== undefined && Number.isFinite(Number(toks[1]))) fc.shrink = Number(toks[1]);
        if (toks[2] !== undefined) {
          if (toks[2] === 'auto') fc.basis = 'auto';
          else {
            const b = parseNumericWithUnit(toks[2]);
            if (b) {
              fc.basis = b.num;
              fc.basisUnit = b.unit;
            }
          }
        }
      }
      layout.flexChild = fc;
      hasLayout = true;
    } else if (p === 'flex-grow') {
      const n = Number(v);
      if (Number.isFinite(n)) {
        layout.flexChild = { ...(existing?.layout?.flexChild ?? {}), ...(layout.flexChild ?? {}), grow: n };
        hasLayout = true;
      }
    } else if (p === 'flex-shrink') {
      const n = Number(v);
      if (Number.isFinite(n)) {
        layout.flexChild = { ...(existing?.layout?.flexChild ?? {}), ...(layout.flexChild ?? {}), shrink: n };
        hasLayout = true;
      }
    } else if (p === 'flex-basis') {
      const fc = { ...(existing?.layout?.flexChild ?? {}), ...(layout.flexChild ?? {}) };
      if (v === 'auto') {
        fc.basis = 'auto';
      } else {
        const b = parseNumericWithUnit(v);
        if (b) {
          fc.basis = b.num;
          fc.basisUnit = b.unit;
        }
      }
      layout.flexChild = fc;
      hasLayout = true;
    } else if (p === 'align-self') {
      const map: Record<string, NonNullable<LayoutSpec['flexChild']>['alignSelf']> = {
        auto: 'auto',
        'flex-start': 'start',
        start: 'start',
        center: 'center',
        'flex-end': 'end',
        end: 'end',
        stretch: 'stretch',
        baseline: 'baseline',
      };
      if (map[v]) {
        layout.flexChild = { ...(existing?.layout?.flexChild ?? {}), ...(layout.flexChild ?? {}), alignSelf: map[v] };
        hasLayout = true;
      }
    } else if (p === 'order') {
      const n = Number(v);
      if (Number.isFinite(n)) {
        layout.flexChild = { ...(existing?.layout?.flexChild ?? {}), ...(layout.flexChild ?? {}), order: Math.round(n) };
        hasLayout = true;
      }
    } else if (p === 'grid-template-columns') {
      const tracks = parseGridTracksValue(v);
      if (tracks.length > 0) {
        layout.mode = 'grid';
        layout.gridCols = tracks;
        hasLayout = true;
      }
    } else if (p === 'grid-template-rows') {
      const tracks = parseGridTracksValue(v);
      if (tracks.length > 0) {
        layout.gridRows = tracks;
        hasLayout = true;
      }
    } else if (p === 'grid-column') {
      const gc = { ...(existing?.layout?.gridChild ?? {}), ...(layout.gridChild ?? {}) };
      const startSpan = v.match(/^(\d+)\s*\/\s*span\s+(\d+)$/i);
      const spanOnly = v.match(/^span\s+(\d+)$/i);
      const startEnd = v.match(/^(\d+)\s*\/\s*(\d+)$/);
      if (startSpan) {
        gc.colStart = Number(startSpan[1]);
        gc.colSpan = Number(startSpan[2]);
      } else if (spanOnly) {
        gc.colSpan = Number(spanOnly[1]);
      } else if (startEnd) {
        gc.colStart = Number(startEnd[1]);
        gc.colSpan = Math.max(1, Number(startEnd[2]) - Number(startEnd[1]));
      }
      layout.gridChild = gc;
      hasLayout = true;
    } else if (p === 'grid-row') {
      const gc = { ...(existing?.layout?.gridChild ?? {}), ...(layout.gridChild ?? {}) };
      const startSpan = v.match(/^(\d+)\s*\/\s*span\s+(\d+)$/i);
      const spanOnly = v.match(/^span\s+(\d+)$/i);
      const startEnd = v.match(/^(\d+)\s*\/\s*(\d+)$/);
      if (startSpan) {
        gc.rowStart = Number(startSpan[1]);
        gc.rowSpan = Number(startSpan[2]);
      } else if (spanOnly) {
        gc.rowSpan = Number(spanOnly[1]);
      } else if (startEnd) {
        gc.rowStart = Number(startEnd[1]);
        gc.rowSpan = Math.max(1, Number(startEnd[2]) - Number(startEnd[1]));
      }
      layout.gridChild = gc;
      hasLayout = true;
    } else if (p === 'grid-column-start') {
      const n = Number(v);
      if (Number.isFinite(n)) {
        layout.gridChild = { ...(existing?.layout?.gridChild ?? {}), ...(layout.gridChild ?? {}), colStart: n };
        hasLayout = true;
      }
    } else if (p === 'grid-row-start') {
      const n = Number(v);
      if (Number.isFinite(n)) {
        layout.gridChild = { ...(existing?.layout?.gridChild ?? {}), ...(layout.gridChild ?? {}), rowStart: n };
        hasLayout = true;
      }
    } else if (p === 'justify-self') {
      if (v === 'auto' || v === 'start' || v === 'center' || v === 'end' || v === 'stretch') {
        layout.gridChild = { ...(existing?.layout?.gridChild ?? {}), ...(layout.gridChild ?? {}), justifySelf: v };
        hasLayout = true;
      }
    } else if (p === 'width') {
      const axis = parseAxisDimension(v, layout.width ?? existing?.layout?.width, (px) => {
        frame.width = px;
        frameChanged = true;
      });
      if (axis) {
        layout.width = axis;
        hasLayout = true;
      }
    } else if (p === 'min-width') {
      const parsed = parseNumericWithUnit(v);
      if (parsed) {
        const baseW = layout.width ?? existing?.layout?.width ?? { mode: 'fixed' as const };
        layout.width = { ...baseW, min: parsed.num, minUnit: parsed.unit };
        hasLayout = true;
      }
    } else if (p === 'max-width') {
      const parsed = parseNumericWithUnit(v);
      if (parsed) {
        const baseW = layout.width ?? existing?.layout?.width ?? { mode: 'fixed' as const };
        layout.width = { ...baseW, max: parsed.num, maxUnit: parsed.unit };
        hasLayout = true;
      }
    } else if (p === 'height') {
      const axis = parseAxisDimension(v, layout.height ?? existing?.layout?.height, (px) => {
        frame.height = px;
        frameChanged = true;
      });
      if (axis) {
        layout.height = axis;
        hasLayout = true;
      }
    } else if (p === 'min-height') {
      const parsed = parseNumericWithUnit(v);
      if (parsed) {
        const baseH = layout.height ?? existing?.layout?.height ?? { mode: 'fixed' as const };
        if (existing?.kind === 'artboard' && parsed.unit === 'px') {
          frame.height = Math.round(parsed.num);
          frameChanged = true;
          layout.height = { ...baseH, mode: 'fixed', value: Math.round(parsed.num), min: parsed.num, minUnit: parsed.unit };
        } else {
          layout.height = { ...baseH, min: parsed.num, minUnit: parsed.unit };
        }
        hasLayout = true;
      }
    } else if (p === 'max-height') {
      const parsed = parseNumericWithUnit(v);
      if (parsed) {
        const baseH = layout.height ?? existing?.layout?.height ?? { mode: 'fixed' as const };
        layout.height = { ...baseH, max: parsed.num, maxUnit: parsed.unit };
        hasLayout = true;
      }
    } else if (p === 'aspect-ratio') {
      layout.aspectRatio = v === 'auto' ? undefined : v;
      hasLayout = true;
    } else if (p === 'margin') {
      const toks = splitTopLevelSpaces(v).map(parseMarginToken);
      if (toks.length === 1) {
        margin.top = margin.right = margin.bottom = margin.left = toks[0];
      } else if (toks.length === 2) {
        margin.top = margin.bottom = toks[0];
        margin.right = margin.left = toks[1];
      } else if (toks.length === 3) {
        margin.top = toks[0];
        margin.right = margin.left = toks[1];
        margin.bottom = toks[2];
      } else if (toks.length >= 4) {
        margin.top = toks[0];
        margin.right = toks[1];
        margin.bottom = toks[2];
        margin.left = toks[3];
      }
      marginChanged = true;
      hasLayout = true;
    } else if (p === 'margin-top' || p === 'margin-right' || p === 'margin-bottom' || p === 'margin-left') {
      const side = p.replace('margin-', '') as keyof MarginBox;
      margin[side] = parseMarginToken(v);
      marginChanged = true;
      hasLayout = true;
    } else if (p === 'padding') {
      const parts = splitTopLevelSpaces(v).map((tok) => parsePx(tok) ?? 0);
      if (parts.length === 1) {
        padding.top = padding.right = padding.bottom = padding.left = parts[0];
      } else if (parts.length === 2) {
        padding.top = padding.bottom = parts[0];
        padding.right = padding.left = parts[1];
      } else if (parts.length === 3) {
        padding.top = parts[0];
        padding.right = padding.left = parts[1];
        padding.bottom = parts[2];
      } else if (parts.length >= 4) {
        padding.top = parts[0];
        padding.right = parts[1];
        padding.bottom = parts[2];
        padding.left = parts[3];
      }
      padChanged = true;
      hasLayout = true;
    } else if (p === 'padding-top' || p === 'padding-right' || p === 'padding-bottom' || p === 'padding-left') {
      const n = parsePx(v);
      if (n !== undefined) {
        const side = p.replace('padding-', '') as keyof typeof padding;
        padding[side] = n;
        padChanged = true;
        hasLayout = true;
      }
    } else if (p === 'overflow') {
      if (v === 'visible' || v === 'hidden' || v === 'scroll' || v === 'auto') {
        layout.overflow = v;
        hasLayout = true;
      }
    } else if (p === 'overflow-x') {
      if (v === 'visible' || v === 'hidden' || v === 'scroll' || v === 'auto') {
        layout.overflowX = v;
        hasLayout = true;
      }
    } else if (p === 'overflow-y') {
      if (v === 'visible' || v === 'hidden' || v === 'scroll' || v === 'auto') {
        layout.overflowY = v;
        hasLayout = true;
      }
    } else if (p === 'object-fit') {
      if (v === 'cover' || v === 'contain' || v === 'fill' || v === 'none' || v === 'scale-down') {
        layout.objectFit = v;
        hasLayout = true;
      }
    } else if (p === 'background' || p === 'background-color' || p === 'background-image') {
      const layers = splitTopLevelCommas(v)
        .map(parseSingleFillLayer)
        .filter((f): f is StyleFill => Boolean(f));
      if (layers.length > 0) {
        style.fills = layers;
        hasStyle = true;
      }
    } else if (p === 'background-size' || p === 'background-position' || p === 'background-repeat') {
      const curFills = style.fills ?? (existing?.style?.fills ? structuredClone(existing.style.fills) : []);
      const imgFill = curFills.find((f) => f.type === 'image');
      if (imgFill && imgFill.type === 'image') {
        if (p === 'background-size') {
          imgFill.fit = v === 'contain' ? 'contain' : v === '100% 100%' || v === 'fill' ? 'fill' : 'cover';
        } else if (p === 'background-position') {
          imgFill.position = v;
        } else if (p === 'background-repeat') {
          if (v === 'no-repeat' || v === 'repeat' || v === 'repeat-x' || v === 'repeat-y') {
            imgFill.repeat = v;
          }
        }
        style.fills = curFills;
        hasStyle = true;
      }
    } else if (p === 'border') {
      const parsed = parseBorderShorthand(v);
      if (parsed) {
        style.border = { width: parsed.width, style: parsed.style, color: parsed.color };
        hasStyle = true;
      }
    } else if (p === 'border-width') {
      const parts = splitTopLevelSpaces(v).map((t) => parsePx(t) ?? 0);
      const baseB = style.border ?? existing?.style?.border ?? { width: 1, style: 'solid' as const, color: '#334155' };
      if (parts.length === 1) {
        style.border = { ...baseB, width: parts[0] };
      } else if (parts.length >= 4) {
        style.border = { ...baseB, width: { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] } };
      }
      hasStyle = true;
    } else if (p === 'border-style') {
      if (v === 'solid' || v === 'dashed' || v === 'dotted' || v === 'double' || v === 'none') {
        const baseB = style.border ?? existing?.style?.border ?? { width: 1, style: v, color: '#334155' };
        style.border = { ...baseB, style: v };
        hasStyle = true;
      }
    } else if (p === 'border-color') {
      const baseB = style.border ?? existing?.style?.border ?? { width: 1, style: 'solid' as const, color: v };
      style.border = {
        ...baseB,
        style: baseB.style !== 'none' ? baseB.style : 'solid',
        color: v,
      };
      hasStyle = true;
    } else if (p === 'border-top' || p === 'border-right' || p === 'border-bottom' || p === 'border-left') {
      const side = p.replace('border-', '') as 'top' | 'right' | 'bottom' | 'left';
      const parsed = parseBorderShorthand(v);
      if (parsed) {
        const baseB = style.border ?? existing?.style?.border ?? { width: 1, style: 'solid' as const, color: '#334155' };
        style.border = {
          ...baseB,
          sides: {
            ...(baseB.sides ?? {}),
            [side]: parsed,
          },
        };
        hasStyle = true;
      }
    } else if (p === 'border-radius') {
      const parts = splitTopLevelSpaces(v).map((tok) => parsePx(tok));
      if (parts.length === 1 && parts[0] !== undefined) {
        style.radius = Math.max(0, parts[0]);
        hasStyle = true;
      } else if (parts.length === 2 && parts[0] !== undefined && parts[1] !== undefined) {
        style.radius = { tl: parts[0], tr: parts[1], br: parts[0], bl: parts[1] };
        hasStyle = true;
      } else if (parts.length === 4 && parts.every((x) => x !== undefined)) {
        style.radius = { tl: parts[0]!, tr: parts[1]!, br: parts[2]!, bl: parts[3]! };
        hasStyle = true;
      }
    } else if (
      p === 'border-top-left-radius' ||
      p === 'border-top-right-radius' ||
      p === 'border-bottom-right-radius' ||
      p === 'border-bottom-left-radius'
    ) {
      const px = parsePx(v);
      if (px !== undefined) {
        const rObj = ensureRadiusObj();
        if (p === 'border-top-left-radius') rObj.tl = px;
        else if (p === 'border-top-right-radius') rObj.tr = px;
        else if (p === 'border-bottom-right-radius') rObj.br = px;
        else rObj.bl = px;
        style.radius = rObj;
        hasStyle = true;
      }
    } else if (p === 'outline') {
      const parsed = parseBorderShorthand(v);
      if (parsed) {
        style.outline = {
          ...(existing?.style?.outline ?? {}),
          ...(style.outline ?? {}),
          width: typeof parsed.width === 'number' ? parsed.width : 2,
          style: parsed.style,
          color: parsed.color,
        };
        hasStyle = true;
      }
    } else if (p === 'outline-width') {
      const px = parsePx(v);
      if (px !== undefined) {
        style.outline = {
          style: 'solid',
          color: '#3b82f6',
          ...(existing?.style?.outline ?? {}),
          ...(style.outline ?? {}),
          width: px,
        };
        hasStyle = true;
      }
    } else if (p === 'outline-style') {
      if (v === 'solid' || v === 'dashed' || v === 'dotted' || v === 'double' || v === 'none') {
        style.outline = {
          width: 2,
          color: '#3b82f6',
          ...(existing?.style?.outline ?? {}),
          ...(style.outline ?? {}),
          style: v,
        };
        hasStyle = true;
      }
    } else if (p === 'outline-color') {
      style.outline = {
        width: 2,
        style: 'solid',
        ...(existing?.style?.outline ?? {}),
        ...(style.outline ?? {}),
        color: v,
      };
      hasStyle = true;
    } else if (p === 'outline-offset') {
      const px = parsePx(v);
      if (px !== undefined) {
        style.outline = {
          width: 2,
          style: 'solid',
          color: '#3b82f6',
          ...(existing?.style?.outline ?? {}),
          ...(style.outline ?? {}),
          offset: px,
        };
        hasStyle = true;
      }
    } else if (p === 'opacity') {
      const n = Number(v);
      if (Number.isFinite(n)) {
        style.opacity = Math.max(0, Math.min(1, n));
        hasStyle = true;
      }
    } else if (p === 'mix-blend-mode') {
      style.mixBlendMode = v as StyleSpec['mixBlendMode'];
      hasStyle = true;
    } else if (p === 'filter') {
      const nextFilters: FilterSpec = { ...(existing?.style?.filters ?? {}), ...(style.filters ?? {}) };
      const fnRegex = /([a-zA-Z-]+)\(([^)]+)\)/g;
      let fm: RegExpExecArray | null;
      while ((fm = fnRegex.exec(v)) !== null) {
        const fn = fm[1].toLowerCase();
        const arg = fm[2].trim();
        const num = parseFloat(arg);
        if (!Number.isFinite(num)) continue;
        if (fn === 'blur') nextFilters.blur = num;
        else if (fn === 'brightness') nextFilters.brightness = arg.endsWith('%') ? num : Math.round(num * 100);
        else if (fn === 'contrast') nextFilters.contrast = arg.endsWith('%') ? num : Math.round(num * 100);
        else if (fn === 'saturate') nextFilters.saturate = arg.endsWith('%') ? num : Math.round(num * 100);
        else if (fn === 'grayscale') nextFilters.grayscale = arg.endsWith('%') ? num : Math.round(num * 100);
        else if (fn === 'hue-rotate') nextFilters.hueRotate = num;
        else if (fn === 'invert') nextFilters.invert = arg.endsWith('%') ? num : Math.round(num * 100);
      }
      style.filters = nextFilters;
      hasStyle = true;
    } else if (p === 'backdrop-filter' || p === '-webkit-backdrop-filter') {
      const nextFilters: FilterSpec = { ...(existing?.style?.filters ?? {}), ...(style.filters ?? {}) };
      const bm = v.match(/blur\((\d+(?:\.\d+)?)px\)/i);
      if (bm) {
        const bVal = Math.round(Number(bm[1]));
        style.backdropBlur = bVal;
        nextFilters.backdropBlur = bVal;
      }
      const sm = v.match(/saturate\((\d+(?:\.\d+)?)%?\)/i);
      if (sm) nextFilters.backdropSaturate = Number(sm[1]);
      const brm = v.match(/brightness\((\d+(?:\.\d+)?)%?\)/i);
      if (brm) nextFilters.backdropBrightness = Number(brm[1]);
      style.filters = nextFilters;
      hasStyle = true;
    } else if (p === 'box-shadow') {
      if (v === 'none') {
        style.shadows = [];
        hasStyle = true;
      } else {
        const shadows = splitTopLevelCommas(v)
          .map(parseSingleShadow)
          .filter((s): s is StyleShadow => Boolean(s));
        if (shadows.length > 0) {
          style.shadows = shadows;
          hasStyle = true;
        }
      }
    } else if (p === 'rotate' && (v === 'none' || /^-?\d+(?:\.\d+)?deg$/.test(v))) {
      frame.rotation = v === 'none' ? 0 : Number.parseFloat(v);
      frameChanged = true;
      hasLayout = true;
    } else if (p === 'transform') {
      const tf: Transform2DSpec = { ...(existing?.style?.transform ?? {}), ...(style.transform ?? {}) };
      const fnRegex = /([a-zA-Z0-9]+)\(([^)]+)\)/g;
      let tm: RegExpExecArray | null;
      while ((tm = fnRegex.exec(v)) !== null) {
        const fn = tm[1];
        const args = tm[2].split(',').map((a) => a.trim());
        if (fn === 'translate') {
          const x = parseNumericWithUnit(args[0] ?? '0');
          const y = parseNumericWithUnit(args[1] ?? '0');
          if (x) {
            tf.translateX = x.num;
            tf.translateXUnit = x.unit === '%' ? '%' : 'px';
          }
          if (y) {
            tf.translateY = y.num;
            tf.translateYUnit = y.unit === '%' ? '%' : 'px';
          }
        } else if (fn === 'translateX') {
          const x = parseNumericWithUnit(args[0] ?? '0');
          if (x) {
            tf.translateX = x.num;
            tf.translateXUnit = x.unit === '%' ? '%' : 'px';
          }
        } else if (fn === 'translateY') {
          const y = parseNumericWithUnit(args[0] ?? '0');
          if (y) {
            tf.translateY = y.num;
            tf.translateYUnit = y.unit === '%' ? '%' : 'px';
          }
        } else if (fn === 'scale') {
          const sx = Number(args[0]);
          const sy = args[1] !== undefined ? Number(args[1]) : sx;
          if (Number.isFinite(sx)) tf.scaleX = sx;
          if (Number.isFinite(sy)) tf.scaleY = sy;
        } else if (fn === 'scaleX') {
          const sx = Number(args[0]);
          if (Number.isFinite(sx)) tf.scaleX = sx;
        } else if (fn === 'scaleY') {
          const sy = Number(args[0]);
          if (Number.isFinite(sy)) tf.scaleY = sy;
        } else if (fn === 'rotate') {
          const r = parseFloat(args[0] ?? '0');
          if (Number.isFinite(r)) tf.rotate = r;
        } else if (fn === 'skew') {
          const ax = parseFloat(args[0] ?? '0');
          const ay = args[1] !== undefined ? parseFloat(args[1]) : 0;
          if (Number.isFinite(ax)) tf.skewX = ax;
          if (Number.isFinite(ay)) tf.skewY = ay;
        } else if (fn === 'skewX') {
          const ax = parseFloat(args[0] ?? '0');
          if (Number.isFinite(ax)) tf.skewX = ax;
        } else if (fn === 'skewY') {
          const ay = parseFloat(args[0] ?? '0');
          if (Number.isFinite(ay)) tf.skewY = ay;
        }
      }
      style.transform = tf;
      hasStyle = true;
    } else if (p === 'transform-origin') {
      style.transform = { ...(existing?.style?.transform ?? {}), ...(style.transform ?? {}), origin: v };
      hasStyle = true;
    } else if (p === 'transition') {
      if (v === 'none') {
        style.transitions = [];
      } else {
        const items: CssTransitionSpec[] = [];
        for (const seg of splitTopLevelCommas(v)) {
          const toks = splitTopLevelSpaces(seg);
          if (toks.length === 0) continue;
          let property = 'all';
          let durationMs = 200;
          let timing = 'ease';
          let delayMs: number | undefined;
          let seenDuration = false;

          for (const t of toks) {
            const dur = parseDurationMs(t);
            if (dur !== undefined) {
              if (!seenDuration) {
                durationMs = dur;
                seenDuration = true;
              } else {
                delayMs = dur;
              }
            } else if (/^(ease|linear|ease-in|ease-out|ease-in-out|cubic-bezier\(|steps\()/i.test(t)) {
              timing = t;
            } else {
              property = t;
            }
          }
          items.push({ property, durationMs, timing, ...(delayMs ? { delayMs } : {}) });
        }
        style.transitions = items;
      }
      hasStyle = true;
    } else if (p === 'animation') {
      if (v === 'none') {
        style.animation = { name: 'none', durationMs: 0 };
      } else {
        const toks = splitTopLevelSpaces(v);
        let name = 'fade-in';
        let durationMs = 400;
        let timing = 'ease';
        let delayMs = 0;
        let iterationCount: number | 'infinite' = 1;
        let direction: CssAnimationSpec['direction'] = 'normal';
        let fillMode: CssAnimationSpec['fillMode'] = 'both';
        let seenDur = false;

        for (const t of toks) {
          const dur = parseDurationMs(t);
          if (dur !== undefined) {
            if (!seenDur) {
              durationMs = dur;
              seenDur = true;
            } else {
              delayMs = dur;
            }
          } else if (/^(ease|linear|ease-in|ease-out|ease-in-out|cubic-bezier\()/i.test(t)) {
            timing = t;
          } else if (t === 'infinite' || /^\d+$/.test(t)) {
            iterationCount = t === 'infinite' ? 'infinite' : Number(t);
          } else if (t === 'normal' || t === 'reverse' || t === 'alternate' || t === 'alternate-reverse') {
            direction = t;
          } else if (t === 'forwards' || t === 'backwards' || t === 'both') {
            fillMode = t;
          } else {
            name = t;
          }
        }
        style.animation = { name, durationMs, timing, delayMs, iterationCount, direction, fillMode };
      }
      hasStyle = true;
    } else if (p === 'cursor') {
      style.cursor = v as StyleSpec['cursor'];
      hasStyle = true;
    } else if (p === 'pointer-events') {
      if (v === 'auto' || v === 'none') {
        style.pointerEvents = v;
        hasStyle = true;
      }
    } else if (p === 'user-select') {
      if (v === 'auto' || v === 'none' || v === 'text') {
        style.userSelect = v;
        hasStyle = true;
      }
    } else if (p === 'color') {
      typography.color = v;
      hasTypo = true;
    } else if (p === 'font-family') {
      typography.fontFamily = v;
      hasTypo = true;
    } else if (p === 'font-size') {
      const parsed = parseNumericWithUnit(v);
      if (parsed && parsed.num > 0) {
        typography.fontSize = parsed.num;
        if (parsed.unit === 'rem' || parsed.unit === 'em' || parsed.unit === 'vw' || parsed.unit === 'px') {
          typography.fontSizeUnit = parsed.unit;
        }
        hasTypo = true;
      }
    } else if (p === 'font-weight') {
      const n = Number(v);
      typography.fontWeight = Number.isFinite(n) ? n : v;
      hasTypo = true;
    } else if (p === 'font-style') {
      if (v === 'normal' || v === 'italic') {
        typography.fontStyle = v;
        hasTypo = true;
      }
    } else if (p === 'text-align') {
      if (v === 'left' || v === 'center' || v === 'right' || v === 'justify') {
        typography.textAlign = v;
        hasTypo = true;
      }
    } else if (p === 'line-height') {
      if (v === 'normal') {
        typography.lineHeight = 'normal';
      } else {
        const parsed = parseNumericWithUnit(v);
        if (parsed) {
          typography.lineHeight = parsed.num;
          typography.lineHeightUnit = v.endsWith('px') ? 'px' : v.endsWith('%') ? '%' : 'unitless';
        }
      }
      hasTypo = true;
    } else if (p === 'letter-spacing') {
      const parsed = parseNumericWithUnit(v);
      if (parsed) {
        typography.letterSpacing = parsed.num;
        typography.letterSpacingUnit = parsed.unit === 'em' ? 'em' : 'px';
        hasTypo = true;
      }
    } else if (p === 'text-transform') {
      if (v === 'none' || v === 'uppercase' || v === 'lowercase' || v === 'capitalize') {
        typography.textTransform = v;
        hasTypo = true;
      }
    } else if (p === 'text-decoration') {
      if (v === 'none' || v === 'underline' || v === 'line-through') {
        typography.textDecoration = v;
        hasTypo = true;
      }
    } else if (p === 'white-space') {
      if (v === 'normal' || v === 'nowrap' || v === 'pre-wrap') {
        typography.whiteSpace = v;
        hasTypo = true;
      }
    } else if (p === 'text-overflow') {
      if (v === 'clip' || v === 'ellipsis') {
        typography.textOverflow = v;
        hasTypo = true;
      }
    } else if (p === '-webkit-line-clamp' || p === 'line-clamp') {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) {
        typography.lineClamp = Math.round(n);
        hasTypo = true;
      }
    } else if (p === 'text-shadow') {
      const sh = parseSingleShadow(v);
      if (sh) {
        typography.textShadow = { x: sh.x, y: sh.y, blur: sh.blur, color: sh.color };
        hasTypo = true;
      }
    } else if (!KNOWN_MAPPED_PROPS.has(p)) {
      customLines.push(`${p}: ${v};`);
    }
  }

  if (frameChanged) layout.frame = frame;
  if (padChanged) layout.padding = padding;
  if (marginChanged) layout.margin = margin;
  if (pinsChanged) layout.pins = pins;

  if (customLines.length > 0) {
    style.customCss = customLines.join('\n');
    hasStyle = true;
  } else if (existing?.style?.customCss) {
    style.customCss = '';
    hasStyle = true;
  }

  return { layout, style, typography, hasLayout, hasStyle, hasTypo };
}

interface ScannedCssBlock {
  hintedNodeId?: string;
  hintedReusableClass?: string;
  selector: string;
  body: string;
  rawBlock: string;
}

function extractTopLevelCssBlocks(cssText: string, diagnostics: CodeDiagnostic[]): ScannedCssBlock[] {
  const blocks: ScannedCssBlock[] = [];
  let i = 0;
  const len = cssText.length;
  let pendingNodeId: string | undefined;
  let pendingReusableClass: string | undefined;

  while (i < len) {
    while (i < len && /\s/.test(cssText[i])) i++;
    if (i >= len) break;

    if (cssText[i] === '/' && cssText[i + 1] === '*') {
      const endComment = cssText.indexOf('*/', i + 2);
      if (endComment === -1) {
        diagnostics.push({ severity: 'error', message: 'Chiudi il commento CSS con */.' });
        break;
      }
      const commentBody = cssText.slice(i + 2, endComment).trim();
      const nodeMatch = commentBody.match(/^@node\s+([a-zA-Z0-9_-]+)/);
      const rcMatch = commentBody.match(/^@reusable-class\s+([a-zA-Z0-9_-]+)/);
      if (nodeMatch) pendingNodeId = nodeMatch[1];
      if (rcMatch) pendingReusableClass = rcMatch[1];
      i = endComment + 2;
      continue;
    }

    const openBrace = cssText.indexOf('{', i);
    if (openBrace === -1) break;
    const rawSelector = cssText.slice(i, openBrace).replace(/\/\*[\s\S]*?\*\//g, '').trim();

    let depth = 1;
    let j = openBrace + 1;
    let quote: string | null = null;
    while (j < len && depth > 0) {
      const ch = cssText[j];
      if (quote) {
        if (ch === '\\') {
          j += 2;
          continue;
        }
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '/' && cssText[j + 1] === '*') {
        const endC = cssText.indexOf('*/', j + 2);
        if (endC === -1) {
          j = len;
          break;
        }
        j = endC + 1;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
      }
      j++;
    }

    if (depth !== 0) {
      diagnostics.push({
        severity: 'error', canvasNodeId: pendingNodeId,
        message: `Completa la regola CSS ${rawSelector || '(senza selettore)'} prima di applicarla.`,
      });
      break;
    }

    const bodyWithComments = cssText.slice(openBrace + 1, Math.max(openBrace + 1, j - 1));
    const body = bodyWithComments.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const rawBlock = cssText.slice(i, j).trim();

    if (rawSelector) {
      blocks.push({
        hintedNodeId: pendingNodeId,
        hintedReusableClass: pendingReusableClass,
        selector: rawSelector,
        body,
        rawBlock,
      });
    }

    pendingNodeId = undefined;
    pendingReusableClass = undefined;
    i = j;
  }

  return blocks;
}

function parseDeclarationPairs(
  body: string,
  diagnostics: CodeDiagnostic[],
  canvasNodeId?: NodeId,
): Array<{ prop: string; val: string }> {
  const decls: Array<{ prop: string; val: string }> = [];
  for (const rawDecl of splitCssDeclarationList(body)) {
    const trimmed = rawDecl.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx <= 0) {
      diagnostics.push({
        severity: 'warn',
        canvasNodeId,
        message: `Dichiarazione CSS non valida ignorata: "${trimmed}"`,
      });
      continue;
    }
    const prop = trimmed.slice(0, colonIdx).trim();
    const val = trimmed.slice(colonIdx + 1).trim();
    if (prop && val) decls.push({ prop, val });
  }
  return decls;
}

export function parseCssEditsToPatchOps(
  cssText: string,
  sheet: UISheetDocument,
  fallbackNodeId?: NodeId | null,
): {
  ops: UIPatchOp[];
  diagnostics: CodeDiagnostic[];
  matchedNodeIds: NodeId[];
} {
  const diagnostics: CodeDiagnostic[] = [];
  const ops: UIPatchOp[] = [];
  const matchedNodeIds: NodeId[] = [];
  const { selectorToNodeId } = buildSheetSelectorMaps(sheet);

  let normalizedCss = cssText;
  if (!cssText.includes('{') && fallbackNodeId && sheet.nodes[fallbackNodeId]) {
    normalizedCss = `#${fallbackNodeId} {\n${cssText}\n}`;
  }

  const blocks = extractTopLevelCssBlocks(normalizedCss, diagnostics);
  if (diagnostics.some((item) => item.severity === 'error')) return { ops, diagnostics, matchedNodeIds };

  const pendingByNode = new Map<
    NodeId,
    {
      layout?: Partial<LayoutSpec>;
      style?: Partial<StyleSpec>;
      typography?: Partial<TypographySpec>;
      stateOverrides?: UINode['stateOverrides'];
    }
  >();

  const reusableMap = new Map<string, ReusableCssClass>();
  for (const rc of sheet.reusableClasses ?? []) {
    reusableMap.set(sanitizeCssClassSlug(rc.name), structuredClone(rc));
  }
  let reusableClassesMutated = false;

  const customKeyframesBlocks: string[] = [];
  const customSheetBlocks: string[] = [];

  for (const block of blocks) {
    const rawSelector = block.selector;
    if (rawSelector === ':root') continue;

    // Handle @keyframes blocks
    if (/^@keyframes\s+/i.test(rawSelector)) {
      const kfNameMatch = rawSelector.match(/^@keyframes\s+([a-zA-Z0-9_-]+)/i);
      const kfName = kfNameMatch?.[1] ?? '';
      // Skip built-in unmodified presets; store custom @keyframes in sheet.keyframesCss
      if (!KEYFRAMES_PRESET_MAP[kfName]) {
        customKeyframesBlocks.push(block.rawBlock);
      }
      continue;
    }

    const pseudoMatch = rawSelector.match(/^(.+?):(hover|active|focus-visible|focus|disabled|checked|loading|dark)$/i);
    const baseSel = (pseudoMatch ? pseudoMatch[1] : rawSelector).trim();
    const pseudoState = pseudoMatch ? (pseudoMatch[2].toLowerCase() as InteractiveStateKey) : null;

    // 1. Check if selector targets a ReusableCssClass (`/* @reusable-class slug */` or existing `.slug`)
    const cleanClassCandidate = baseSel.startsWith('.') ? sanitizeCssClassSlug(baseSel) : '';
    const isReusableBlock =
      Boolean(block.hintedReusableClass) || (cleanClassCandidate && reusableMap.has(cleanClassCandidate));

    if (isReusableBlock && !block.hintedNodeId) {
      const slug = sanitizeCssClassSlug(block.hintedReusableClass || cleanClassCandidate);
      const decls = parseDeclarationPairs(block.body, diagnostics);
      if (decls.length > 0 && slug) {
        const existingRc: ReusableCssClass = reusableMap.get(slug) ?? {
          id: `rc_${slug}`,
          name: slug,
        };
        const mapped = mapDeclarationsToNodeUpdate(decls, {
          layout: existingRc.layout as LayoutSpec | undefined,
          style: existingRc.style as StyleSpec | undefined,
          typography: existingRc.typography as TypographySpec | undefined,
        });
        if (pseudoState) {
          const nextStates = { ...(existingRc.stateOverrides ?? existingRc.states ?? {}) };
          nextStates[pseudoState] = {
            ...(nextStates[pseudoState] ?? {}),
            ...(mapped.hasLayout ? { layout: mapped.layout } : {}),
            ...(mapped.hasStyle ? { style: mapped.style } : {}),
            ...(mapped.hasTypo ? { typography: mapped.typography } : {}),
          };
          existingRc.stateOverrides = nextStates;
          existingRc.states = nextStates;
        } else {
          if (mapped.hasLayout) existingRc.layout = { ...(existingRc.layout ?? {}), ...mapped.layout };
          if (mapped.hasStyle) existingRc.style = { ...(existingRc.style ?? {}), ...mapped.style };
          if (mapped.hasTypo) existingRc.typography = { ...(existingRc.typography ?? {}), ...mapped.typography };
        }
        reusableMap.set(slug, existingRc);
        reusableClassesMutated = true;
      }
      continue;
    }

    // 2. Match Canvas UINode
    let targetNodeId: NodeId | undefined =
      (block.hintedNodeId && sheet.nodes[block.hintedNodeId] ? block.hintedNodeId : undefined) ??
      selectorToNodeId[baseSel] ??
      (baseSel.startsWith('#') && sheet.nodes[baseSel.slice(1)] ? baseSel.slice(1) : undefined);

    if (!targetNodeId && fallbackNodeId && sheet.nodes[fallbackNodeId] && !pseudoMatch) {
      targetNodeId = fallbackNodeId;
    }

    if (!targetNodeId || !sheet.nodes[targetNodeId]) {
      customSheetBlocks.push(`${rawSelector} {\n  ${block.body}\n}`);
      continue;
    }

    const decls = parseDeclarationPairs(block.body, diagnostics, targetNodeId);
    if (decls.length === 0) continue;

    const node = sheet.nodes[targetNodeId];
    const entry = pendingByNode.get(targetNodeId) ?? {};

    if (pseudoState) {
      const existingOv = entry.stateOverrides?.[pseudoState] ?? node.stateOverrides?.[pseudoState];
      const mapped = mapDeclarationsToNodeUpdate(decls, {
        kind: node.kind,
        layout: existingOv?.layout as LayoutSpec | undefined,
        style: existingOv?.style as StyleSpec | undefined,
        typography: existingOv?.typography as TypographySpec | undefined,
      });
      entry.stateOverrides = {
        ...(node.stateOverrides ?? {}),
        ...(entry.stateOverrides ?? {}),
        [pseudoState]: {
          ...(existingOv ?? {}),
          ...(mapped.hasLayout ? { layout: { ...(existingOv?.layout ?? {}), ...mapped.layout } } : {}),
          ...(mapped.hasStyle ? { style: { ...(existingOv?.style ?? {}), ...mapped.style } } : {}),
          ...(mapped.hasTypo ? { typography: { ...(existingOv?.typography ?? {}), ...mapped.typography } } : {}),
        },
      };
    } else {
      const mapped = mapDeclarationsToNodeUpdate(decls, node);
      if (mapped.hasLayout) entry.layout = { ...(entry.layout ?? {}), ...mapped.layout };
      if (mapped.hasStyle) entry.style = { ...(entry.style ?? {}), ...mapped.style };
      if (mapped.hasTypo) entry.typography = { ...(entry.typography ?? {}), ...mapped.typography };
    }

    pendingByNode.set(targetNodeId, entry);
    if (!matchedNodeIds.includes(targetNodeId)) matchedNodeIds.push(targetNodeId);
  }

  for (const [nodeId, upd] of pendingByNode.entries()) {
    ops.push({
      op: 'update_node',
      id: nodeId,
      ...(upd.layout ? { layout: upd.layout } : {}),
      ...(upd.style ? { style: upd.style } : {}),
      ...(upd.typography ? { typography: upd.typography } : {}),
      ...(upd.stateOverrides ? { stateOverrides: upd.stateOverrides } : {}),
    });
  }

  if (reusableClassesMutated || customKeyframesBlocks.length > 0 || customSheetBlocks.length > 0) {
    ops.push({
      op: 'update_sheet_meta',
      ...(reusableClassesMutated ? { reusableClasses: Array.from(reusableMap.values()) } : {}),
      ...(customKeyframesBlocks.length > 0 ? { keyframesCss: customKeyframesBlocks.join('\n\n') } : {}),
      ...(customSheetBlocks.length > 0 ? { customCss: customSheetBlocks.join('\n\n') } : {}),
    });
  }

  return { ops, diagnostics, matchedNodeIds };
}
