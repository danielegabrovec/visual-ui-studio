import {
  compileKeyframesCss,
  compileReusableClassesCss,
  compileStateOverrideToCssDeclarations,
  formatAnimationCss,
  formatBackdropFilterCss,
  formatBoxShadowsCss,
  formatFillCssLayer,
  formatFilterCss,
  formatTransform2DCss,
  formatTransitionsCss,
  lookupSheetCssMetaForUIR,
  sanitizeCssClassSlug,
} from '@shared/css-sync-engine';
import { OFFLINE_ICON_CATALOG } from '@shared/icon-catalog';
import {
  isTokenRef,
  resolveTokenOrValue,
  type BoundOrLiteral,
  type CodeSourceMapSpan,
  type InteractiveStateKey,
  type MarginBox,
  type PaddingBox,
  type ReusableCssClass,
  type StateOverrideSpec,
  type StyleFill,
  type TokenOrValue,
  type Transform2DSpec,
  type UIRNode,
  type UIRTokenDictionary,
} from '@shared/ui-ir';

export function toWords(raw: string): string[] {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function toPascalCase(raw: string, fallback = 'Element'): string {
  const words = toWords(raw);
  if (words.length === 0) return fallback;
  const joined = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  return /^[0-9]/.test(joined) ? `Ui${joined}` : joined;
}

export function toCamelCase(raw: string, fallback = 'element'): string {
  const pascal = toPascalCase(raw, fallback);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function toKebabCase(raw: string, fallback = 'element'): string {
  const words = toWords(raw);
  if (words.length === 0) return fallback;
  const joined = words.map((w) => w.toLowerCase()).join('-');
  return /^[0-9]/.test(joined) ? `ui-${joined}` : joined;
}

export function toSnakeCase(raw: string, fallback = 'element'): string {
  const words = toWords(raw);
  if (words.length === 0) return fallback;
  const joined = words.map((w) => w.toLowerCase()).join('_');
  return /^[0-9]/.test(joined) ? `ui_${joined}` : joined;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeXmlAttr(str: string): string {
  return escapeHtml(str).replace(/'/g, '&apos;');
}

export function escapeDoubleQuoted(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export function escapeSingleQuoted(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

export function isBoundValue<T>(val: BoundOrLiteral<T> | undefined): val is { $bind: string; fallback?: T } {
  return typeof val === 'object' && val !== null && '$bind' in val;
}

export function getLiteralText(node: UIRNode, fallback = ''): string {
  const t = node.content?.text;
  if (t === undefined) return fallback;
  if (isBoundValue(t)) return t.fallback ?? fallback;
  return t;
}

export function getDomId(node: UIRNode, domIdMap?: ReadonlyMap<string, string>): string {
  if (domIdMap) {
    const mapped = domIdMap.get(node.canvasNodeId);
    if (mapped) return mapped;
  }
  return toKebabCase(node.name || node.canvasNodeId, 'el');
}

export function buildUniqueNameMap(
  root: UIRNode,
  format: 'kebab' | 'camel' | 'snake' | 'pascal' = 'kebab',
  fallback = 'el',
): Map<string, string> {
  const map = new Map<string, string>();
  const used = new Set<string>();

  const formatBase = (raw: string): string => {
    switch (format) {
      case 'camel':
        return toCamelCase(raw, fallback);
      case 'snake':
        return toSnakeCase(raw, fallback);
      case 'pascal':
        return toPascalCase(raw, fallback);
      case 'kebab':
      default:
        return toKebabCase(raw, fallback);
    }
  };

  const withSuffix = (base: string, n: number): string => {
    switch (format) {
      case 'camel':
      case 'pascal':
        return `${base}${n}`;
      case 'snake':
        return `${base}_${n}`;
      case 'kebab':
      default:
        return `${base}-${n}`;
    }
  };

  const walk = (n: UIRNode) => {
    if (!map.has(n.canvasNodeId)) {
      const base = formatBase(n.name || n.kind);
      let candidate = base;
      let counter = 2;
      while (used.has(candidate)) {
        candidate = withSuffix(base, counter);
        counter++;
      }
      used.add(candidate);
      map.set(n.canvasNodeId, candidate);
    }
    for (const child of n.children) {
      walk(child);
    }
  };

  walk(root);
  return map;
}

export function buildCssClassMap(root: UIRNode): Map<string, string> {
  return buildUniqueNameMap(root, 'kebab', 'el');
}

export function tokenPathToCssVar(tokenPath: string): string {
  return `--${tokenPath.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`;
}

export function resolveNum(
  val: TokenOrValue<number> | undefined,
  tokens: UIRTokenDictionary,
  fallback = 0,
): number {
  const res = resolveTokenOrValue(val, tokens.flatMap, fallback);
  const num = typeof res === 'number' ? res : Number(res);
  return Number.isFinite(num) ? num : fallback;
}

export function resolveColorHex(
  val: TokenOrValue<string> | undefined,
  tokens: UIRTokenDictionary,
  fallback = 'transparent',
): string {
  if (!val) return fallback;
  const res = resolveTokenOrValue(val, tokens.flatMap, fallback);
  return String(res || fallback);
}

export function resolveDarkColorHex(
  val: TokenOrValue<string> | undefined,
  tokens: UIRTokenDictionary,
  fallbackLight?: string,
): string {
  if (!val) return fallbackLight ?? 'transparent';
  if (isTokenRef(val)) {
    const entry = tokens.colors[val.$token];
    if (entry?.dark) return entry.dark;
    if (entry?.light) return entry.light;
  }
  return typeof val === 'string' ? val : fallbackLight ?? 'transparent';
}

export function getPrimarySolidFill(node: UIRNode): TokenOrValue<string> | undefined {
  const enabledFills = (node.style.base.fills ?? []).filter((f) => f.enabled !== false);
  const solid = enabledFills.find((f) => f.type === 'solid');
  if (solid && solid.type === 'solid') return solid.color;
  const grad = enabledFills.find(
    (f) => f.type === 'linear-gradient' || f.type === 'radial-gradient' || f.type === 'conic-gradient',
  );
  if (grad && 'stops' in grad && grad.stops.length > 0) {
    return grad.stops[0].color;
  }
  return undefined;
}

export function resolvePrimaryGradientOrSolid(
  node: UIRNode,
  tokens: UIRTokenDictionary,
):
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; type: 'linear-gradient' | 'radial-gradient' | 'conic-gradient'; angle: number; stops: Array<{ pos: number; color: string }> }
  | null {
  const enabled = (node.style.base.fills ?? []).filter((f) => f.enabled !== false);
  const first = enabled[0];
  if (!first) return null;
  if (first.type === 'solid') {
    return { kind: 'solid', color: resolveColorHex(first.color, tokens, 'transparent') };
  }
  if (first.type === 'linear-gradient' || first.type === 'radial-gradient' || first.type === 'conic-gradient') {
    return {
      kind: 'gradient',
      type: first.type,
      angle: 'angle' in first ? (first.angle ?? 135) : 0,
      stops: first.stops.map((s) => ({
        pos: s.pos,
        color: resolveColorHex(s.color, tokens, '#3b82f6'),
      })),
    };
  }
  return null;
}

export function resolvePaddingNums(
  pad: PaddingBox | undefined,
  tokens: UIRTokenDictionary,
): { top: number; right: number; bottom: number; left: number } {
  if (!pad) return { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    top: resolveNum(pad.top, tokens, 0),
    right: resolveNum(pad.right, tokens, 0),
    bottom: resolveNum(pad.bottom, tokens, 0),
    left: resolveNum(pad.left, tokens, 0),
  };
}

export function resolveMarginNums(
  margin: MarginBox | undefined,
  tokens: UIRTokenDictionary,
): {
  top: number | 'auto';
  right: number | 'auto';
  bottom: number | 'auto';
  left: number | 'auto';
} {
  if (!margin) return { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    top: margin.top === 'auto' ? 'auto' : resolveNum(margin.top, tokens, 0),
    right: margin.right === 'auto' ? 'auto' : resolveNum(margin.right, tokens, 0),
    bottom: margin.bottom === 'auto' ? 'auto' : resolveNum(margin.bottom, tokens, 0),
    left: margin.left === 'auto' ? 'auto' : resolveNum(margin.left, tokens, 0),
  };
}

export function resolveRadiusNum(node: UIRNode, tokens: UIRTokenDictionary): number {
  const r = node.style.base.radius;
  if (r === undefined) return 0;
  if (typeof r === 'object' && !isTokenRef(r)) {
    return Math.round((r.tl + r.tr + r.br + r.bl) / 4);
  }
  return resolveNum(r, tokens, 0);
}

export function resolveCornerRadii(
  node: UIRNode,
  tokens: UIRTokenDictionary,
): { tl: number; tr: number; br: number; bl: number; uniform: boolean } {
  const r = node.style.base.radius;
  if (r === undefined) return { tl: 0, tr: 0, br: 0, bl: 0, uniform: true };
  if (typeof r === 'object' && !isTokenRef(r)) {
    const uniform = r.tl === r.tr && r.tr === r.br && r.br === r.bl;
    return { tl: r.tl, tr: r.tr, br: r.br, bl: r.bl, uniform };
  }
  const n = resolveNum(r, tokens, 0);
  return { tl: n, tr: n, br: n, bl: n, uniform: true };
}

export function resolveTransform2D(node: UIRNode): Transform2DSpec | null {
  return node.style.base.transform ?? null;
}

export function lookupOfflineIconSvg(iconName: string | undefined, size = 16): string | null {
  if (!iconName) return null;
  const normalized = iconName.toLowerCase().trim();
  const found =
    OFFLINE_ICON_CATALOG.find((ic) => ic.id === normalized) ??
    OFFLINE_ICON_CATALOG.find((ic) => ic.id.includes(normalized) || ic.tags.includes(normalized));
  if (!found) return null;
  return `<svg width="${size}" height="${size}" viewBox="${found.viewBox}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${found.svgBody}</svg>`;
}

// ============================================================================
// TAILWIND CSS v4 CLASS GENERATOR (FULL 78-PROPERTY + PSEUDO-STATES + CLASSES)
// ============================================================================

const HEX_TO_TW_BG: Record<string, string> = {
  '#ffffff': 'bg-white',
  '#000000': 'bg-black',
  '#f8fafc': 'bg-slate-50 dark:bg-slate-950',
  '#f1f5f9': 'bg-slate-100 dark:bg-slate-800',
  '#111827': 'bg-gray-900',
  '#1e293b': 'bg-slate-800',
  '#0b1120': 'bg-slate-950',
  '#3b82f6': 'bg-blue-500',
  '#2563eb': 'bg-blue-600',
  '#8b5cf6': 'bg-violet-500',
  '#10b981': 'bg-emerald-500',
  '#f59e0b': 'bg-amber-500',
  '#ef4444': 'bg-red-500',
};

const HEX_TO_TW_TEXT: Record<string, string> = {
  '#ffffff': 'text-white',
  '#0f172a': 'text-slate-900 dark:text-slate-50',
  '#475569': 'text-slate-600 dark:text-slate-400',
  '#94a3b8': 'text-slate-400',
  '#f8fafc': 'text-slate-50',
  '#3b82f6': 'text-blue-500',
  '#2563eb': 'text-blue-600',
  '#8b5cf6': 'text-violet-500',
  '#10b981': 'text-emerald-500',
  '#f59e0b': 'text-amber-500',
  '#ef4444': 'text-red-500',
};

const HEX_TO_TW_BORDER: Record<string, string> = {
  '#e2e8f0': 'border-slate-200 dark:border-slate-700',
  '#334155': 'border-slate-700',
  '#3b82f6': 'border-blue-500',
};

function twEscapeArbitrary(raw: string): string {
  return raw.trim().replace(/\s+/g, '_');
}

function pxToTwScale(px: number, prefix: string): string {
  if (px === 0) return '';
  if (px < 0) {
    return `-${pxToTwScale(Math.abs(px), prefix)}`;
  }
  const scaleMap: Record<number, string> = {
    2: '0.5',
    4: '1',
    6: '1.5',
    8: '2',
    10: '2.5',
    12: '3',
    14: '3.5',
    16: '4',
    20: '5',
    24: '6',
    28: '7',
    32: '8',
    36: '9',
    40: '10',
    48: '12',
    64: '16',
  };
  const step = scaleMap[Math.round(px)];
  return step ? `${prefix}-${step}` : `${prefix}-[${Math.round(px)}px]`;
}

export function isAbsolutePositionedNode(node: UIRNode, isRoot = false): boolean {
  if (isRoot) return false;
  return (
    node.layout.positioning === 'absolute' ||
    node.layout.positioning === 'fixed' ||
    node.layout.mode === 'FLOATING'
  );
}

export function isFreeformHostContainer(node: UIRNode): boolean {
  return (
    node.layout.mode === 'FREEFORM' ||
    node.children.some((c) => isAbsolutePositionedNode(c, false))
  );
}

export function getAbsoluteFrameMetrics(node: UIRNode): {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex?: number;
} {
  return {
    x: Math.round(node.layout.pins?.left ?? node.layout.frame.x),
    y: Math.round(node.layout.pins?.top ?? node.layout.frame.y),
    width: Math.max(1, Math.round(node.layout.width.value ?? node.layout.frame.width ?? 120)),
    height: Math.max(1, Math.round(node.layout.height.value ?? node.layout.frame.height ?? 40)),
    zIndex: node.layout.zIndex ?? node.style.base.zIndex,
  };
}

function emitTwFillClasses(fills: StyleFill[] | undefined, tokens: UIRTokenDictionary): string[] {
  const out: string[] = [];
  const enabled = (fills ?? []).filter((f) => f.enabled !== false);
  if (enabled.length === 0) return out;

  if (enabled.length === 1 && enabled[0].type === 'solid') {
    const hex = resolveColorHex(enabled[0].color, tokens, '').toLowerCase();
    if (HEX_TO_TW_BG[hex]) out.push(HEX_TO_TW_BG[hex]);
    else if (hex && hex !== 'transparent') out.push(`bg-[${twEscapeArbitrary(hex)}]`);
    return out;
  }

  const layers = enabled
    .map((f, idx) => formatFillCssLayer(f, tokens.flatMap, false, idx === enabled.length - 1))
    .filter((x): x is string => Boolean(x));
  if (layers.length > 0) {
    out.push(`bg-[${twEscapeArbitrary(layers.join(','))}]`);
  }
  return out;
}

function emitTwPseudoStateClasses(
  pseudo: InteractiveStateKey,
  ov: StateOverrideSpec | undefined,
  tokens: UIRTokenDictionary,
): string[] {
  if (!ov) return [];
  const out: string[] = [];
  const pfx = `${pseudo}:`;

  if (ov.style) {
    for (const fc of emitTwFillClasses(ov.style.fills, tokens)) {
      for (const sub of fc.split(/\s+/)) {
        if (sub && !sub.startsWith('dark:')) out.push(`${pfx}${sub}`);
      }
    }
    if (ov.style.opacity !== undefined) {
      out.push(`${pfx}opacity-[${ov.style.opacity}]`);
    }
    if (ov.style.border && ov.style.border.style !== 'none') {
      const bHex = resolveColorHex(ov.style.border.color, tokens, '#3b82f6').toLowerCase();
      out.push(`${pfx}border-[${twEscapeArbitrary(bHex)}]`);
    }
    if (ov.style.radius !== undefined && typeof ov.style.radius === 'number') {
      out.push(`${pfx}rounded-[${ov.style.radius}px]`);
    }
    if (ov.style.shadows && ov.style.shadows.length > 0) {
      const sh = formatBoxShadowsCss(ov.style.shadows, tokens.flatMap, false);
      if (sh) out.push(`${pfx}shadow-[${twEscapeArbitrary(sh)}]`);
    }
    if (ov.style.transform) {
      const tf = ov.style.transform;
      if (tf.translateX) out.push(`${pfx}translate-x-[${tf.translateX}${tf.translateXUnit ?? 'px'}]`);
      if (tf.translateY) out.push(`${pfx}translate-y-[${tf.translateY}${tf.translateYUnit ?? 'px'}]`);
      if (tf.scaleX !== undefined && tf.scaleX !== 1) out.push(`${pfx}scale-[${tf.scaleX}]`);
      if (tf.rotate) out.push(`${pfx}rotate-[${tf.rotate}deg]`);
    }
  }
  if (ov.typography?.color) {
    const tHex = resolveColorHex(ov.typography.color, tokens, '').toLowerCase();
    if (tHex) out.push(`${pfx}text-[${twEscapeArbitrary(tHex)}]`);
  }
  return out;
}

export function buildTailwindClasses(node: UIRNode, tokens: UIRTokenDictionary, isRoot = false): string {
  const cls: string[] = [];

  // Attached Reusable CSS Classes
  const attachedClasses = node.classNames ?? node.style.base.classNames ?? [];
  for (const rc of attachedClasses) {
    const clean = sanitizeCssClassSlug(rc);
    if (clean) cls.push(clean);
  }

  const isAbs = isAbsolutePositionedNode(node, isRoot);
  const isFreeHost = isFreeformHostContainer(node);
  const absMetrics = getAbsoluteFrameMetrics(node);

  // Positioning & Layout mode
  const hasLayoutChildren = node.children.length > 0 || node.kind === 'Card' || node.kind === 'Box' || isRoot;
  const dirClass =
    node.layout.direction === 'row-reverse'
      ? 'flex-row-reverse'
      : node.layout.direction === 'column-reverse'
        ? 'flex-col-reverse'
        : node.layout.mode === 'COLUMN' && node.kind !== 'Button'
          ? 'flex-col'
          : 'flex-row';

  if (isAbs) {
    cls.push(
      node.layout.positioning === 'fixed' ? 'fixed' : 'absolute',
      `left-[${absMetrics.x}px]`,
      `top-[${absMetrics.y}px]`,
    );
    if (node.layout.pins?.right !== undefined) cls.push(`right-[${node.layout.pins.right}px]`);
    if (node.layout.pins?.bottom !== undefined) cls.push(`bottom-[${node.layout.pins.bottom}px]`);
    if (!isFreeHost && (node.kind === 'Button' || node.kind === 'IconButton')) {
      cls.push('inline-flex', 'flex-row');
    } else if (!isFreeHost && node.children.length > 0) {
      if (node.layout.mode === 'GRID') {
        cls.push('grid');
        const cols = node.layout.gridTracks?.columns ?? ['1fr'];
        cls.push(`grid-cols-[${twEscapeArbitrary(cols.join(' '))}]`);
      } else {
        cls.push('flex', dirClass);
        if (node.layout.wrap === 'wrap-reverse') cls.push('flex-wrap-reverse');
        else if (node.layout.wrap) cls.push('flex-wrap');
      }
    }
  } else if (node.layout.positioning === 'sticky') {
    cls.push('sticky', `top-[${node.layout.pins?.top ?? Math.round(node.layout.frame.y)}px]`);
    if (hasLayoutChildren) cls.push('flex', dirClass);
  } else if (isFreeHost) {
    cls.push('relative');
  } else if (node.layout.mode === 'GRID') {
    cls.push('grid');
    const cols = node.layout.gridTracks?.columns ?? ['1fr'];
    const allOneFr = cols.every((c) => c === '1fr');
    if (allOneFr && cols.length >= 1 && cols.length <= 6) {
      cls.push(`grid-cols-1 md:grid-cols-${cols.length}`);
    } else {
      cls.push(`grid-cols-[${twEscapeArbitrary(cols.join(' '))}]`);
    }
    if (node.layout.gridTracks?.rows && node.layout.gridTracks.rows.length > 0) {
      const rows = node.layout.gridTracks.rows;
      if (!(rows.length === 1 && rows[0] === '1fr')) {
        cls.push(`grid-rows-[${twEscapeArbitrary(rows.join(' '))}]`);
      }
    }
    if (node.layout.justifyItems) cls.push(`justify-items-${node.layout.justifyItems}`);
  } else if (node.layout.mode === 'STACK') {
    cls.push('relative');
  } else if (hasLayoutChildren || node.kind === 'Button' || node.kind === 'IconButton') {
    cls.push(node.kind === 'Button' || node.kind === 'IconButton' ? 'inline-flex' : 'flex');
    cls.push(dirClass);
    if (node.layout.wrap === 'wrap-reverse') cls.push('flex-wrap-reverse');
    else if (node.layout.wrap) cls.push('flex-wrap');
  }

  if (absMetrics.zIndex !== undefined) {
    cls.push(`z-[${absMetrics.zIndex}]`);
  }
  if (node.layout.boxSizing === 'content-box') {
    cls.push('box-content');
  }

  // Align & Justify
  if (cls.includes('flex') || cls.includes('inline-flex') || cls.includes('grid')) {
    const alignMap: Record<string, string> = {
      start: 'items-start',
      center: 'items-center',
      end: 'items-end',
      stretch: 'items-stretch',
      baseline: 'items-baseline',
    };
    const justifyMap: Record<string, string> = {
      start: 'justify-start',
      center: 'justify-center',
      end: 'justify-end',
      'space-between': 'justify-between',
      'space-around': 'justify-around',
      'space-evenly': 'justify-evenly',
    };
    const al = node.kind === 'Button' ? 'center' : node.layout.alignItems;
    const ju = node.kind === 'Button' ? 'center' : node.layout.justifyContent;
    if (al && alignMap[al] && al !== 'stretch') cls.push(alignMap[al]);
    if (ju && justifyMap[ju] && ju !== 'start') cls.push(justifyMap[ju]);
  }

  // Flex Child & Grid Child
  if (node.layout.flexChild) {
    const fc = node.layout.flexChild;
    if (fc.grow === 1) cls.push('grow');
    else if (fc.grow === 0) cls.push('grow-0');
    else if (fc.grow !== undefined) cls.push(`grow-[${fc.grow}]`);

    if (fc.shrink === 0) cls.push('shrink-0');
    else if (fc.shrink !== undefined && fc.shrink !== 1) cls.push(`shrink-[${fc.shrink}]`);

    if (fc.basis === 'auto') cls.push('basis-auto');
    else if (fc.basis !== undefined) {
      const bVal = resolveNum(fc.basis, tokens, 0);
      cls.push(`basis-[${bVal}${fc.basisUnit ?? 'px'}]`);
    }

    if (fc.alignSelf && fc.alignSelf !== 'auto') cls.push(`self-${fc.alignSelf}`);
    if (fc.order !== undefined) cls.push(`order-[${fc.order}]`);
  }

  if (node.layout.gridChild) {
    const gc = node.layout.gridChild;
    if (gc.colSpan && gc.colSpan > 1) cls.push(`col-span-${gc.colSpan}`);
    if (gc.rowSpan && gc.rowSpan > 1) cls.push(`row-span-${gc.rowSpan}`);
    if (gc.colStart) cls.push(`col-start-${gc.colStart}`);
    if (gc.rowStart) cls.push(`row-start-${gc.rowStart}`);
    if (gc.justifySelf && gc.justifySelf !== 'auto') cls.push(`justify-self-${gc.justifySelf}`);
    if (gc.alignSelf && gc.alignSelf !== 'auto') cls.push(`self-${gc.alignSelf}`);
  }

  // Gap / Row-Gap / Col-Gap
  const gapPx = resolveNum(node.layout.gap, tokens, 0);
  const rowGapPx = node.layout.rowGap !== undefined ? resolveNum(node.layout.rowGap, tokens, 0) : undefined;
  const colGapPx = node.layout.columnGap !== undefined ? resolveNum(node.layout.columnGap, tokens, 0) : undefined;
  if (!isFreeHost && (node.children.length > 0 || node.kind === 'Button' || node.layout.mode === 'GRID')) {
    if (gapPx > 0) cls.push(pxToTwScale(gapPx, 'gap'));
    if (rowGapPx !== undefined && rowGapPx > 0) cls.push(pxToTwScale(rowGapPx, 'gap-y'));
    if (colGapPx !== undefined && colGapPx > 0) cls.push(pxToTwScale(colGapPx, 'gap-x'));
  } else if (node.kind === 'Button' && node.content?.iconName) {
    cls.push('gap-2');
  }

  // Width / Height / Min / Max / Units
  if (isRoot) {
    cls.push('w-full');
    if (isFreeHost) {
      cls.push(`min-h-[${Math.max(400, Math.round(node.layout.frame.height))}px]`);
    } else {
      cls.push('min-h-screen');
    }
  } else if (isAbs) {
    const wUnit = node.layout.width.unit ?? 'px';
    const hUnit = node.layout.height.unit ?? 'px';
    cls.push(
      wUnit === 'px' ? `w-[${absMetrics.width}px]` : `w-[${node.layout.width.value ?? absMetrics.width}${wUnit}]`,
      hUnit === 'px' ? `h-[${absMetrics.height}px]` : `h-[${node.layout.height.value ?? absMetrics.height}${hUnit}]`,
    );
  } else {
    const w = node.layout.width;
    if (w.mode === 'FILL') {
      cls.push('w-full', 'flex-1');
    } else if (w.mode === 'AUTO' || w.unit === 'auto') {
      cls.push('w-auto');
    } else if (w.mode === 'PERCENTAGE' && w.value !== undefined) {
      cls.push(`w-[${w.value}%]`);
    } else if ((w.mode === 'VIEWPORT' || w.mode === 'REM') && w.value !== undefined) {
      cls.push(`w-[${w.value}${w.unit ?? (w.mode === 'VIEWPORT' ? 'vw' : 'rem')}]`);
    } else if (w.mode === 'FIXED' && w.value && node.kind !== 'Text' && node.kind !== 'Heading') {
      const u = w.unit ?? 'px';
      cls.push(`w-[${u === 'px' ? Math.round(w.value) : w.value}${u}]`);
    }

    const h = node.layout.height;
    if (h.mode === 'FILL') {
      cls.push('h-full');
    } else if (h.mode === 'AUTO' || h.unit === 'auto') {
      cls.push('h-auto');
    } else if (h.mode === 'PERCENTAGE' && h.value !== undefined) {
      cls.push(`h-[${h.value}%]`);
    } else if ((h.mode === 'VIEWPORT' || h.mode === 'REM') && h.value !== undefined) {
      cls.push(`h-[${h.value}${h.unit ?? (h.mode === 'VIEWPORT' ? 'vh' : 'rem')}]`);
    } else if (h.mode === 'FIXED' && h.value && (isControlLike(node) || (h.unit && h.unit !== 'px'))) {
      const u = h.unit ?? 'px';
      if (u === 'px') {
        const hScale = pxToTwScale(h.value, 'h');
        if (hScale) cls.push(hScale);
      } else {
        cls.push(`h-[${h.value}${u}]`);
      }
    } else if (isFreeHost && node.layout.frame.height > 0) {
      cls.push(`min-h-[${Math.round(node.layout.frame.height)}px]`);
    }
  }

  if (node.layout.width.min !== undefined) {
    cls.push(`min-w-[${node.layout.width.min}${node.layout.width.minUnit ?? 'px'}]`);
  }
  if (node.layout.width.max !== undefined) {
    cls.push(`max-w-[${node.layout.width.max}${node.layout.width.maxUnit ?? 'px'}]`);
  }
  if (node.layout.height.min !== undefined) {
    cls.push(`min-h-[${node.layout.height.min}${node.layout.height.minUnit ?? 'px'}]`);
  }
  if (node.layout.height.max !== undefined) {
    cls.push(`max-h-[${node.layout.height.max}${node.layout.height.maxUnit ?? 'px'}]`);
  }
  if (node.layout.aspectRatio) {
    const ar = node.layout.aspectRatio.replace(/\s+/g, '');
    if (ar === '1/1') cls.push('aspect-square');
    else if (ar === '16/9') cls.push('aspect-video');
    else cls.push(`aspect-[${ar}]`);
  }

  // Margin (including `auto`)
  if (node.layout.margin) {
    const m = resolveMarginNums(node.layout.margin, tokens);
    if (m.top === 'auto' && m.right === 'auto' && m.bottom === 'auto' && m.left === 'auto') {
      cls.push('m-auto');
    } else {
      if (m.left === 'auto' && m.right === 'auto') {
        cls.push('mx-auto');
      } else {
        if (m.left === 'auto') cls.push('ml-auto');
        else if (m.left !== 0) cls.push(pxToTwScale(m.left, 'ml'));
        if (m.right === 'auto') cls.push('mr-auto');
        else if (m.right !== 0) cls.push(pxToTwScale(m.right, 'mr'));
      }
      if (m.top === 'auto') cls.push('mt-auto');
      else if (m.top !== 0) cls.push(pxToTwScale(m.top, 'mt'));
      if (m.bottom === 'auto') cls.push('mb-auto');
      else if (m.bottom !== 0) cls.push(pxToTwScale(m.bottom, 'mb'));
    }
  }

  // Padding
  const pad = resolvePaddingNums(node.layout.padding, tokens);
  if (pad.top > 0 || pad.right > 0 || pad.bottom > 0 || pad.left > 0) {
    if (pad.top === pad.bottom && pad.left === pad.right) {
      if (pad.top === pad.left) {
        const p = pxToTwScale(pad.top, 'p');
        if (p) cls.push(p);
      } else {
        const py = pxToTwScale(pad.top, 'py');
        const px = pxToTwScale(pad.left, 'px');
        if (px) cls.push(px);
        if (py) cls.push(py);
      }
    } else {
      if (pad.top) cls.push(pxToTwScale(pad.top, 'pt'));
      if (pad.right) cls.push(pxToTwScale(pad.right, 'pr'));
      if (pad.bottom) cls.push(pxToTwScale(pad.bottom, 'pb'));
      if (pad.left) cls.push(pxToTwScale(pad.left, 'pl'));
    }
  }

  // Overflow & Object-Fit
  if (node.layout.overflow && node.layout.overflow !== 'visible') {
    cls.push(`overflow-${node.layout.overflow}`);
  }
  if (node.layout.overflowX && node.layout.overflowX !== 'visible') {
    cls.push(`overflow-x-${node.layout.overflowX}`);
  }
  if (node.layout.overflowY && node.layout.overflowY !== 'visible') {
    cls.push(`overflow-y-${node.layout.overflowY}`);
  }
  if (node.layout.objectFit) {
    cls.push(`object-${node.layout.objectFit}`);
  }

  // Background fills & Gradients
  cls.push(...emitTwFillClasses(node.style.base.fills, tokens));

  // Border & Outline
  const b = node.style.base.border;
  if (b) {
    if (b.sides && Object.keys(b.sides).length > 0) {
      const sidePrefix: Record<'top' | 'right' | 'bottom' | 'left', string> = {
        top: 'border-t',
        right: 'border-r',
        bottom: 'border-b',
        left: 'border-l',
      };
      for (const side of ['top', 'right', 'bottom', 'left'] as const) {
        const s = b.sides[side];
        if (!s || s.style === 'none') continue;
        const w = resolveNum(s.width, tokens, 1);
        cls.push(w === 1 ? sidePrefix[side] : `${sidePrefix[side]}-[${w}px]`);
        if (s.style !== 'solid') cls.push(`border-${s.style}`);
        const cHex = resolveColorHex(s.color, tokens, '#334155').toLowerCase();
        cls.push(HEX_TO_TW_BORDER[cHex] ?? `border-[${twEscapeArbitrary(cHex)}]`);
      }
    } else if (b.style !== 'none') {
      const bHex = resolveColorHex(b.color, tokens, '#e2e8f0').toLowerCase();
      const bWidth = typeof b.width === 'number' ? b.width : 1;
      cls.push(bWidth === 1 ? 'border' : `border-[${bWidth}px]`);
      if (b.style !== 'solid') cls.push(`border-${b.style}`);
      cls.push(HEX_TO_TW_BORDER[bHex] ?? `border-[${twEscapeArbitrary(bHex)}]`);
    }
  }

  const outl = node.style.base.outline;
  if (outl && outl.style !== 'none' && outl.width > 0) {
    cls.push('outline', `outline-[${outl.width}px]`);
    if (outl.style !== 'solid') cls.push(`outline-${outl.style}`);
    const oHex = resolveColorHex(outl.color, tokens, '#3b82f6');
    cls.push(`outline-[${twEscapeArbitrary(oHex)}]`);
    if (outl.offset !== undefined) cls.push(`outline-offset-[${outl.offset}px]`);
  }

  // Radius (uniform or 4-corner)
  const corners = resolveCornerRadii(node, tokens);
  if (corners.uniform) {
    const rad = corners.tl;
    if (rad >= 999) cls.push('rounded-full');
    else if (rad === 16) cls.push('rounded-2xl');
    else if (rad === 12) cls.push('rounded-xl');
    else if (rad === 8) cls.push('rounded-lg');
    else if (rad === 4) cls.push('rounded-md');
    else if (rad > 0) cls.push(`rounded-[${rad}px]`);
  } else {
    if (corners.tl > 0) cls.push(`rounded-tl-[${corners.tl}px]`);
    if (corners.tr > 0) cls.push(`rounded-tr-[${corners.tr}px]`);
    if (corners.br > 0) cls.push(`rounded-br-[${corners.br}px]`);
    if (corners.bl > 0) cls.push(`rounded-bl-[${corners.bl}px]`);
  }

  // Shadows (outer + inset multi-shadows)
  if (node.style.base.shadows && node.style.base.shadows.length > 0) {
    const shStr = formatBoxShadowsCss(node.style.base.shadows, tokens.flatMap, false);
    if (shStr) cls.push(`shadow-[${twEscapeArbitrary(shStr)}]`);
  }

  // Opacity & Blend
  if (node.style.base.opacity !== undefined && node.style.base.opacity < 1) {
    cls.push(`opacity-[${node.style.base.opacity}]`);
  }
  if (node.style.base.mixBlendMode && node.style.base.mixBlendMode !== 'normal') {
    cls.push(`mix-blend-${node.style.base.mixBlendMode}`);
  }

  // Filters & Backdrop
  const flt = node.style.base.filters;
  if (flt) {
    if (flt.blur && flt.blur > 0) cls.push(`blur-[${flt.blur}px]`);
    if (flt.brightness !== undefined && flt.brightness !== 100) cls.push(`brightness-[${flt.brightness}%]`);
    if (flt.contrast !== undefined && flt.contrast !== 100) cls.push(`contrast-[${flt.contrast}%]`);
    if (flt.saturate !== undefined && flt.saturate !== 100) cls.push(`saturate-[${flt.saturate}%]`);
    if (flt.grayscale && flt.grayscale > 0) cls.push(`grayscale-[${flt.grayscale}%]`);
    if (flt.hueRotate) cls.push(`hue-rotate-[${flt.hueRotate}deg]`);
    if (flt.invert && flt.invert > 0) cls.push(`invert-[${flt.invert}%]`);
  }
  const bBlur = node.style.base.backdropBlur ?? flt?.backdropBlur;
  if (bBlur && bBlur > 0) {
    cls.push(`backdrop-blur-[${bBlur}px]`);
  }

  // 2D Transform
  const tf = node.style.base.transform;
  if (tf) {
    if (tf.translateX) cls.push(`translate-x-[${tf.translateX}${tf.translateXUnit ?? 'px'}]`);
    if (tf.translateY) cls.push(`translate-y-[${tf.translateY}${tf.translateYUnit ?? 'px'}]`);
    if (tf.scaleX !== undefined && tf.scaleY !== undefined && (tf.scaleX !== 1 || tf.scaleY !== 1)) {
      if (tf.scaleX === tf.scaleY) cls.push(`scale-[${tf.scaleX}]`);
      else cls.push(`scale-x-[${tf.scaleX}]`, `scale-y-[${tf.scaleY}]`);
    } else {
      if (tf.scaleX !== undefined && tf.scaleX !== 1) cls.push(`scale-x-[${tf.scaleX}]`);
      if (tf.scaleY !== undefined && tf.scaleY !== 1) cls.push(`scale-y-[${tf.scaleY}]`);
    }
    if (tf.rotate) cls.push(`rotate-[${tf.rotate}deg]`);
    if (tf.skewX) cls.push(`skew-x-[${tf.skewX}deg]`);
    if (tf.skewY) cls.push(`skew-y-[${tf.skewY}deg]`);
    if (tf.origin) cls.push(`origin-[${twEscapeArbitrary(tf.origin)}]`);
  }

  // Transitions & Animations
  const trs = node.style.base.transitions;
  if (trs && trs.length > 0) {
    const props = trs.map((t) => t.property || 'all').join(',');
    cls.push(`transition-[${twEscapeArbitrary(props)}]`, `duration-[${trs[0].durationMs ?? 200}ms]`);
    if (trs[0].delayMs) cls.push(`delay-[${trs[0].delayMs}ms]`);
  }
  const anim = node.style.base.animation;
  if (anim && anim.name && anim.name !== 'none') {
    if (anim.name === 'pulse' || anim.name === 'spin' || anim.name === 'bounce') {
      cls.push(`animate-${anim.name}`);
    } else {
      const animStr = formatAnimationCss(anim);
      if (animStr) cls.push(`animate-[${twEscapeArbitrary(animStr)}]`);
    }
  }

  // Pro Typography
  const typo = node.style.typography;
  if (typo) {
    const fs = resolveNum(typo.fontSize, tokens, 15);
    const fsUnit = typo.fontSizeUnit ?? 'px';
    if (fsUnit !== 'px') {
      cls.push(`text-[${fs}${fsUnit}]`);
    } else if (fs >= 28) cls.push('text-3xl');
    else if (fs >= 24) cls.push('text-2xl');
    else if (fs >= 20) cls.push('text-xl');
    else if (fs >= 17) cls.push('text-lg');
    else if (fs <= 13) cls.push('text-xs');
    else if (fs === 14) cls.push('text-sm');
    else cls.push('text-base');

    const fw = Number(resolveTokenOrValue(typo.fontWeight, tokens.flatMap, 400));
    if (fw >= 800) cls.push('font-extrabold');
    else if (fw >= 700) cls.push('font-bold');
    else if (fw >= 600) cls.push('font-semibold');
    else if (fw >= 500) cls.push('font-medium');
    else if (fw <= 300) cls.push('font-light');

    if (typo.fontStyle === 'italic') cls.push('italic');

    const tHex = resolveColorHex(typo.color, tokens, '').toLowerCase();
    if (HEX_TO_TW_TEXT[tHex]) {
      cls.push(HEX_TO_TW_TEXT[tHex]);
    } else if (tHex) {
      cls.push(`text-[${twEscapeArbitrary(tHex)}]`);
    }

    if (typo.textAlign === 'center') cls.push('text-center');
    else if (typo.textAlign === 'right') cls.push('text-right');
    else if (typo.textAlign === 'justify') cls.push('text-justify');

    if (typo.lineHeight !== undefined && typo.lineHeight !== 'normal') {
      const lh = resolveTokenOrValue(typo.lineHeight, tokens.flatMap, 1.4);
      const lhU = !typo.lineHeightUnit || typo.lineHeightUnit === 'unitless' ? '' : typo.lineHeightUnit;
      cls.push(`leading-[${lh}${lhU}]`);
    }
    if (typo.letterSpacing !== undefined && typo.letterSpacing !== 0) {
      const ls = resolveNum(typo.letterSpacing, tokens, 0);
      cls.push(`tracking-[${ls}${typo.letterSpacingUnit ?? 'px'}]`);
    }
    if (typo.textTransform && typo.textTransform !== 'none') cls.push(typo.textTransform);
    if (typo.textDecoration === 'underline') cls.push('underline');
    else if (typo.textDecoration === 'line-through') cls.push('line-through');

    if (typo.lineClamp && typo.lineClamp > 0) {
      cls.push(`line-clamp-${typo.lineClamp}`);
    } else if (typo.textOverflow === 'ellipsis' && typo.whiteSpace === 'nowrap') {
      cls.push('truncate');
    } else if (typo.whiteSpace && typo.whiteSpace !== 'normal') {
      cls.push(`whitespace-${typo.whiteSpace}`);
    }
  }

  // Cursor & Pointer Events
  if (node.style.base.cursor && node.style.base.cursor !== 'auto') {
    cls.push(`cursor-${node.style.base.cursor}`);
  } else if (node.kind === 'Button' || node.kind === 'IconButton') {
    cls.push('cursor-pointer');
  }
  if (node.style.base.pointerEvents === 'none') {
    cls.push('pointer-events-none');
  }
  if (node.style.base.userSelect && node.style.base.userSelect !== 'auto') {
    cls.push(`select-${node.style.base.userSelect}`);
  }

  if (node.kind === 'Button' || node.kind === 'IconButton') {
    if (!trs?.length) cls.push('transition-colors');
    if (!node.style.states?.hover) cls.push('hover:opacity-90');
  }
  if (node.kind === 'TextInput' || node.kind === 'TextArea' || node.kind === 'Select') {
    if (!outl) cls.push('outline-none', 'focus:ring-2', 'focus:ring-blue-500/40');
  }

  // Pseudo-state variants (:hover, :active, :focus, :focus-visible, :disabled)
  for (const sk of ['hover', 'active', 'focus', 'focus-visible', 'disabled'] as const) {
    cls.push(...emitTwPseudoStateClasses(sk, node.style.states?.[sk], tokens));
  }

  return cls.filter(Boolean).join(' ');
}

function isControlLike(node: UIRNode): boolean {
  return (
    node.kind === 'Button' ||
    node.kind === 'IconButton' ||
    node.kind === 'TextInput' ||
    node.kind === 'Select' ||
    node.kind === 'ThreeViewport'
  );
}

// ============================================================================
// VANILLA CSS3 & CSS MODULES GENERATOR (WITH --TOKENS + KEYFRAMES + REUSABLE CLASSES)
// ============================================================================

function getOwnSelectorClassName(
  node: UIRNode,
  camelForModules = false,
  classMap?: ReadonlyMap<string, string>,
): string {
  const base = classMap?.get(node.canvasNodeId) ?? toKebabCase(node.name || node.kind, 'el');
  return camelForModules ? toCamelCase(base) : base;
}

export function getNodeCssClassNamesList(
  node: UIRNode,
  camelForModules = false,
  classMap?: ReadonlyMap<string, string>,
): string[] {
  const own = getOwnSelectorClassName(node, camelForModules, classMap);
  const reusable = (node.classNames ?? node.style.base.classNames ?? [])
    .map((rc) => (camelForModules ? toCamelCase(rc) : sanitizeCssClassSlug(rc)))
    .filter(Boolean);
  return Array.from(new Set([...reusable, own]));
}

export function getNodeCssClassName(
  node: UIRNode,
  camelForModules = false,
  classMap?: ReadonlyMap<string, string>,
): string {
  if (camelForModules) {
    // CSS Modules syntax `styles.<ident>` expects a single valid JS identifier
    return getOwnSelectorClassName(node, true, classMap);
  }
  return getNodeCssClassNamesList(node, false, classMap).join(' ');
}

function cssColorExpr(val: TokenOrValue<string> | undefined, tokens: UIRTokenDictionary): string | null {
  if (!val) return null;
  if (isTokenRef(val)) {
    return `var(${tokenPathToCssVar(val.$token)}, ${resolveColorHex(val, tokens, '#000000')})`;
  }
  return val;
}

function cssPxExpr(val: TokenOrValue<number> | undefined, tokens: UIRTokenDictionary, unit = 'px'): string {
  if (val === undefined) return `0${unit}`;
  if (isTokenRef(val)) {
    return `var(${tokenPathToCssVar(val.$token)}, ${resolveNum(val, tokens, 0)}${unit})`;
  }
  return `${unit === 'px' ? Math.round(val) : val}${unit}`;
}

export function buildTokenCssVariablesBlock(tokens: UIRTokenDictionary): string {
  const lines: string[] = [':root {'];
  for (const [path, c] of Object.entries(tokens.colors)) {
    lines.push(`  ${tokenPathToCssVar(path)}: ${c.light};`);
  }
  for (const [path, sp] of Object.entries(tokens.spacing)) {
    lines.push(`  ${tokenPathToCssVar(path)}: ${sp}px;`);
  }
  for (const [path, rd] of Object.entries(tokens.radii)) {
    lines.push(`  ${tokenPathToCssVar(path)}: ${rd}px;`);
  }
  for (const [path, ty] of Object.entries(tokens.typography)) {
    lines.push(`  ${tokenPathToCssVar(path)}: ${ty};`);
  }
  for (const [path, sh] of Object.entries(tokens.shadows)) {
    lines.push(`  ${tokenPathToCssVar(path)}: ${sh};`);
  }
  lines.push('}');

  const darkOverrides = Object.entries(tokens.colors).filter(([, c]) => Boolean(c.dark));
  if (darkOverrides.length > 0) {
    lines.push('');
    lines.push('[data-theme="dark"], .dark {');
    for (const [path, c] of darkOverrides) {
      lines.push(`  ${tokenPathToCssVar(path)}: ${c.dark};`);
    }
    lines.push('}');
  }

  lines.push('');
  lines.push('*, *::before, *::after { box-sizing: border-box; margin: 0; }');
  return lines.join('\n');
}

export function buildNodeCssRuleBody(node: UIRNode, tokens: UIRTokenDictionary, isRoot = false): string[] {
  const props: string[] = [];
  const isAbs = isAbsolutePositionedNode(node, isRoot);
  const isFreeHost = isFreeformHostContainer(node);
  const absMetrics = getAbsoluteFrameMetrics(node);

  const flexDir =
    node.layout.direction ??
    (node.layout.mode === 'COLUMN' && node.kind !== 'Button' ? 'column' : 'row');

  if (isAbs) {
    props.push(`position: ${node.layout.positioning === 'fixed' ? 'fixed' : 'absolute'};`);
    props.push(`left: ${absMetrics.x}px;`);
    props.push(`top: ${absMetrics.y}px;`);
    if (node.layout.pins?.right !== undefined) props.push(`right: ${node.layout.pins.right}px;`);
    if (node.layout.pins?.bottom !== undefined) props.push(`bottom: ${node.layout.pins.bottom}px;`);
    const wUnit = node.layout.width.unit ?? 'px';
    const hUnit = node.layout.height.unit ?? 'px';
    if (node.layout.pins?.right === undefined) {
      props.push(`width: ${wUnit === 'px' ? absMetrics.width : (node.layout.width.value ?? absMetrics.width)}${wUnit};`);
    }
    if (node.layout.pins?.bottom === undefined) {
      props.push(`height: ${hUnit === 'px' ? absMetrics.height : (node.layout.height.value ?? absMetrics.height)}${hUnit};`);
    }
    if (absMetrics.zIndex !== undefined) {
      props.push(`z-index: ${absMetrics.zIndex};`);
    }
    if (node.kind === 'Button' || node.kind === 'IconButton') {
      props.push('display: inline-flex;');
      props.push('align-items: center;');
      props.push('justify-content: center;');
    } else if (!isFreeHost && node.children.length > 0) {
      if (node.layout.mode === 'GRID') {
        props.push('display: grid;');
        const cols = node.layout.gridTracks?.columns ?? ['1fr'];
        props.push(`grid-template-columns: ${cols.join(' ')};`);
        if (node.layout.gridTracks?.rows?.length) {
          props.push(`grid-template-rows: ${node.layout.gridTracks.rows.join(' ')};`);
        }
      } else {
        props.push('display: flex;');
        props.push(`flex-direction: ${flexDir};`);
        if (node.layout.wrap === 'wrap-reverse') props.push('flex-wrap: wrap-reverse;');
        else if (node.layout.wrap) props.push('flex-wrap: wrap;');
      }
    }
  } else if (node.layout.positioning === 'sticky') {
    props.push('position: sticky;');
    props.push(`top: ${node.layout.pins?.top ?? Math.round(node.layout.frame.y)}px;`);
    if (absMetrics.zIndex !== undefined) props.push(`z-index: ${absMetrics.zIndex};`);
    if (node.children.length > 0) {
      props.push('display: flex;');
      props.push(`flex-direction: ${flexDir};`);
    }
  } else if (isFreeHost) {
    props.push('position: relative;');
    if (absMetrics.zIndex !== undefined) {
      props.push(`z-index: ${absMetrics.zIndex};`);
    }
  } else if (node.layout.mode === 'GRID') {
    props.push('display: grid;');
    const cols = node.layout.gridTracks?.columns ?? ['1fr'];
    props.push(`grid-template-columns: ${cols.join(' ')};`);
    if (node.layout.gridTracks?.rows?.length && !(node.layout.gridTracks.rows.length === 1 && node.layout.gridTracks.rows[0] === '1fr')) {
      props.push(`grid-template-rows: ${node.layout.gridTracks.rows.join(' ')};`);
    }
    if (node.layout.justifyItems) props.push(`justify-items: ${node.layout.justifyItems};`);
    if (node.layout.alignItems) {
      const a = node.layout.alignItems === 'start' ? 'flex-start' : node.layout.alignItems === 'end' ? 'flex-end' : node.layout.alignItems;
      props.push(`align-items: ${a};`);
    }
    if (absMetrics.zIndex !== undefined) props.push(`z-index: ${absMetrics.zIndex};`);
  } else if (node.layout.mode === 'STACK') {
    props.push('position: relative;');
    if (absMetrics.zIndex !== undefined) props.push(`z-index: ${absMetrics.zIndex};`);
  } else if (node.children.length > 0 || node.kind === 'Button' || node.kind === 'Card' || isRoot) {
    props.push(node.kind === 'Button' ? 'display: inline-flex;' : 'display: flex;');
    props.push(`flex-direction: ${flexDir};`);
    if (node.layout.wrap === 'wrap-reverse') props.push('flex-wrap: wrap-reverse;');
    else if (node.layout.wrap) props.push('flex-wrap: wrap;');
    if (node.layout.alignItems) {
      const a = node.layout.alignItems === 'start' ? 'flex-start' : node.layout.alignItems === 'end' ? 'flex-end' : node.layout.alignItems;
      props.push(`align-items: ${node.kind === 'Button' ? 'center' : a};`);
    } else if (node.kind === 'Button') {
      props.push('align-items: center;');
    }
    if (node.layout.justifyContent) {
      const j = node.layout.justifyContent === 'start' ? 'flex-start' : node.layout.justifyContent === 'end' ? 'flex-end' : node.layout.justifyContent;
      props.push(`justify-content: ${node.kind === 'Button' ? 'center' : j};`);
    }
    if (node.layout.alignContent) {
      const ac = node.layout.alignContent === 'start' ? 'flex-start' : node.layout.alignContent === 'end' ? 'flex-end' : node.layout.alignContent;
      props.push(`align-content: ${ac};`);
    }
    if (absMetrics.zIndex !== undefined) props.push(`z-index: ${absMetrics.zIndex};`);
  } else if (absMetrics.zIndex !== undefined) {
    props.push(`z-index: ${absMetrics.zIndex};`);
  }

  if (node.layout.boxSizing === 'content-box') {
    props.push('box-sizing: content-box;');
  }

  // Flex Child & Grid Child
  if (node.layout.flexChild) {
    const fc = node.layout.flexChild;
    if (fc.grow !== undefined) props.push(`flex-grow: ${fc.grow};`);
    if (fc.shrink !== undefined) props.push(`flex-shrink: ${fc.shrink};`);
    if (fc.basis !== undefined) {
      props.push(
        fc.basis === 'auto'
          ? 'flex-basis: auto;'
          : `flex-basis: ${cssPxExpr(fc.basis, tokens, fc.basisUnit ?? 'px')};`,
      );
    }
    if (fc.alignSelf && fc.alignSelf !== 'auto') {
      const asVal = fc.alignSelf === 'start' ? 'flex-start' : fc.alignSelf === 'end' ? 'flex-end' : fc.alignSelf;
      props.push(`align-self: ${asVal};`);
    }
    if (fc.order !== undefined) props.push(`order: ${fc.order};`);
  }

  if (node.layout.gridChild) {
    const gc = node.layout.gridChild;
    if (gc.colStart && gc.colSpan && gc.colSpan > 1) props.push(`grid-column: ${gc.colStart} / span ${gc.colSpan};`);
    else if (gc.colSpan && gc.colSpan > 1) props.push(`grid-column: span ${gc.colSpan};`);
    else if (gc.colStart) props.push(`grid-column-start: ${gc.colStart};`);

    if (gc.rowStart && gc.rowSpan && gc.rowSpan > 1) props.push(`grid-row: ${gc.rowStart} / span ${gc.rowSpan};`);
    else if (gc.rowSpan && gc.rowSpan > 1) props.push(`grid-row: span ${gc.rowSpan};`);
    else if (gc.rowStart) props.push(`grid-row-start: ${gc.rowStart};`);

    if (gc.justifySelf && gc.justifySelf !== 'auto') props.push(`justify-self: ${gc.justifySelf};`);
    if (gc.alignSelf && gc.alignSelf !== 'auto') props.push(`align-self: ${gc.alignSelf};`);
  }

  // Gap / Row-Gap / Col-Gap
  const gapNum = resolveNum(node.layout.gap, tokens, 0);
  if (!isFreeHost && (node.children.length > 0 || node.layout.mode === 'GRID')) {
    if (gapNum > 0) props.push(`gap: ${cssPxExpr(node.layout.gap, tokens)};`);
    if (node.layout.rowGap !== undefined) props.push(`row-gap: ${cssPxExpr(node.layout.rowGap, tokens)};`);
    if (node.layout.columnGap !== undefined) props.push(`column-gap: ${cssPxExpr(node.layout.columnGap, tokens)};`);
  } else if (node.kind === 'Button' && node.content?.iconName) {
    props.push('gap: 8px;');
  }

  // Sizing & Constraints
  if (!isAbs) {
    if (isRoot) {
      props.push('width: 100%;');
      if (isFreeHost) {
        props.push(`min-height: ${Math.max(400, Math.round(node.layout.frame.height))}px;`);
      } else {
        props.push('min-height: 100vh;');
      }
    } else {
      const w = node.layout.width;
      if (w.mode === 'FILL') {
        props.push('width: 100%;');
        if (!node.layout.flexChild) props.push('flex: 1 1 0%;');
      } else if (w.mode === 'AUTO' || w.unit === 'auto') {
        props.push('width: auto;');
      } else if (w.mode === 'PERCENTAGE' && w.value !== undefined) {
        props.push(`width: ${w.value}%;`);
      } else if ((w.mode === 'VIEWPORT' || w.mode === 'REM') && w.value !== undefined) {
        props.push(`width: ${w.value}${w.unit ?? (w.mode === 'VIEWPORT' ? 'vw' : 'rem')};`);
      } else if (w.mode === 'FIXED' && w.value && node.kind !== 'Text' && node.kind !== 'Heading') {
        const u = w.unit ?? 'px';
        props.push(`width: ${u === 'px' ? Math.round(w.value) : w.value}${u};`);
      }

      const h = node.layout.height;
      if (h.mode === 'FILL') {
        props.push('height: 100%;');
      } else if (h.mode === 'AUTO' || h.unit === 'auto') {
        props.push('height: auto;');
      } else if (h.mode === 'PERCENTAGE' && h.value !== undefined) {
        props.push(`height: ${h.value}%;`);
      } else if ((h.mode === 'VIEWPORT' || h.mode === 'REM') && h.value !== undefined) {
        props.push(`height: ${h.value}${h.unit ?? (h.mode === 'VIEWPORT' ? 'vh' : 'rem')};`);
      } else if (h.mode === 'FIXED' && h.value && (isControlLike(node) || (h.unit && h.unit !== 'px'))) {
        const u = h.unit ?? 'px';
        props.push(`height: ${u === 'px' ? Math.round(h.value) : h.value}${u};`);
      } else if (isFreeHost && node.layout.frame.height > 0) {
        props.push(`min-height: ${Math.round(node.layout.frame.height)}px;`);
      }
    }
  }

  if (node.layout.width.min !== undefined) {
    props.push(`min-width: ${node.layout.width.min}${node.layout.width.minUnit ?? 'px'};`);
  }
  if (node.layout.width.max !== undefined) {
    props.push(`max-width: ${node.layout.width.max}${node.layout.width.maxUnit ?? 'px'};`);
  }
  if (node.layout.height.min !== undefined) {
    props.push(`min-height: ${node.layout.height.min}${node.layout.height.minUnit ?? 'px'};`);
  }
  if (node.layout.height.max !== undefined) {
    props.push(`max-height: ${node.layout.height.max}${node.layout.height.maxUnit ?? 'px'};`);
  }
  if (node.layout.aspectRatio) {
    props.push(`aspect-ratio: ${node.layout.aspectRatio};`);
  }

  // Margin
  if (node.layout.margin) {
    const m = resolveMarginNums(node.layout.margin, tokens);
    if (m.top !== 0 || m.right !== 0 || m.bottom !== 0 || m.left !== 0) {
      const fmt = (v: number | 'auto', raw: MarginBox['top']) =>
        v === 'auto' ? 'auto' : cssPxExpr(raw as TokenOrValue<number>, tokens);
      const mt = fmt(m.top, node.layout.margin.top);
      const mr = fmt(m.right, node.layout.margin.right);
      const mb = fmt(m.bottom, node.layout.margin.bottom);
      const ml = fmt(m.left, node.layout.margin.left);
      if (mt === mr && mr === mb && mb === ml) props.push(`margin: ${mt};`);
      else if (mt === mb && mr === ml) props.push(`margin: ${mt} ${mr};`);
      else props.push(`margin: ${mt} ${mr} ${mb} ${ml};`);
    }
  }

  // Padding
  const pad = resolvePaddingNums(node.layout.padding, tokens);
  if (pad.top > 0 || pad.right > 0 || pad.bottom > 0 || pad.left > 0) {
    const p = node.layout.padding!;
    props.push(
      `padding: ${cssPxExpr(p.top, tokens)} ${cssPxExpr(p.right, tokens)} ${cssPxExpr(p.bottom, tokens)} ${cssPxExpr(p.left, tokens)};`,
    );
  }

  // Overflow & Object-Fit
  if (node.layout.overflow && node.layout.overflow !== 'visible') {
    props.push(`overflow: ${node.layout.overflow};`);
  }
  if (node.layout.overflowX && node.layout.overflowX !== 'visible') {
    props.push(`overflow-x: ${node.layout.overflowX};`);
  }
  if (node.layout.overflowY && node.layout.overflowY !== 'visible') {
    props.push(`overflow-y: ${node.layout.overflowY};`);
  }
  if (node.layout.objectFit) {
    props.push(`object-fit: ${node.layout.objectFit};`);
  }

  // Fills & Multi-Stop Gradients
  const enabledFills = (node.style.base.fills ?? []).filter((f) => f.enabled !== false);
  if (enabledFills.length > 0) {
    const layers = enabledFills
      .map((f, idx) => formatFillCssLayer(f, tokens.flatMap, true, idx === enabledFills.length - 1))
      .filter((x): x is string => Boolean(x));
    if (layers.length > 0) props.push(`background: ${layers.join(', ')};`);
  }

  // Borders & Outline
  const b = node.style.base.border;
  if (b?.sides && Object.keys(b.sides).length > 0) {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const s = b.sides[side];
      if (!s) continue;
      if (s.style === 'none') props.push(`border-${side}: none;`);
      else {
        const sc = cssColorExpr(s.color, tokens) ?? '#334155';
        props.push(`border-${side}: ${cssPxExpr(s.width, tokens)} ${s.style} ${sc};`);
      }
    }
  } else if (b && b.style !== 'none') {
    const bColor = cssColorExpr(b.color, tokens) ?? '#e2e8f0';
    if (typeof b.width === 'object' && !isTokenRef(b.width)) {
      props.push(`border-style: ${b.style};`);
      props.push(`border-color: ${bColor};`);
      props.push(`border-width: ${b.width.top}px ${b.width.right}px ${b.width.bottom}px ${b.width.left}px;`);
    } else {
      props.push(`border: ${cssPxExpr(b.width, tokens)} ${b.style} ${bColor};`);
    }
  } else if (node.kind === 'Button') {
    props.push('border: none;');
  }

  if (node.style.base.outline && node.style.base.outline.style !== 'none' && node.style.base.outline.width > 0) {
    const oc = cssColorExpr(node.style.base.outline.color, tokens) ?? '#3b82f6';
    props.push(`outline: ${node.style.base.outline.width}px ${node.style.base.outline.style} ${oc};`);
    if (node.style.base.outline.offset !== undefined) {
      props.push(`outline-offset: ${node.style.base.outline.offset}px;`);
    }
  }

  // Radius
  if (node.style.base.radius !== undefined) {
    if (typeof node.style.base.radius === 'object' && !isTokenRef(node.style.base.radius)) {
      const r = node.style.base.radius;
      props.push(`border-radius: ${r.tl}px ${r.tr}px ${r.br}px ${r.bl}px;`);
    } else {
      props.push(`border-radius: ${cssPxExpr(node.style.base.radius, tokens)};`);
    }
  }

  // Opacity, Blend, Shadows, Filters, Transforms, Transitions, Animations
  if (node.style.base.opacity !== undefined && node.style.base.opacity < 1) {
    props.push(`opacity: ${node.style.base.opacity};`);
  }
  if (node.style.base.mixBlendMode && node.style.base.mixBlendMode !== 'normal') {
    props.push(`mix-blend-mode: ${node.style.base.mixBlendMode};`);
  }
  const shCss = formatBoxShadowsCss(node.style.base.shadows, tokens.flatMap, true);
  if (shCss) props.push(`box-shadow: ${shCss};`);

  const fltCss = formatFilterCss(node.style.base.filters);
  if (fltCss) props.push(`filter: ${fltCss};`);

  const bfCss = formatBackdropFilterCss(node.style.base.backdropBlur, node.style.base.filters);
  if (bfCss) props.push(`backdrop-filter: ${bfCss};`);

  const tfCss = formatTransform2DCss(node.style.base.transform);
  if (tfCss) props.push(`transform: ${tfCss};`);
  if (node.style.base.transform?.origin) {
    props.push(`transform-origin: ${node.style.base.transform.origin};`);
  }

  const trCss = formatTransitionsCss(node.style.base.transitions);
  if (trCss) props.push(`transition: ${trCss};`);

  const animCss = formatAnimationCss(node.style.base.animation);
  if (animCss) props.push(`animation: ${animCss};`);

  // Pro Typography
  const typo = node.style.typography;
  if (typo) {
    if (typo.fontFamily) {
      const ff = isTokenRef(typo.fontFamily)
        ? `var(${tokenPathToCssVar(typo.fontFamily.$token)}, system-ui, sans-serif)`
        : typo.fontFamily;
      props.push(`font-family: ${ff};`);
    }
    const fsUnit = typo.fontSizeUnit ?? 'px';
    props.push(`font-size: ${resolveNum(typo.fontSize, tokens, 15)}${fsUnit};`);
    props.push(`font-weight: ${resolveTokenOrValue(typo.fontWeight, tokens.flatMap, 400)};`);
    if (typo.fontStyle && typo.fontStyle !== 'normal') props.push(`font-style: ${typo.fontStyle};`);
    const tc = cssColorExpr(typo.color, tokens);
    if (tc) props.push(`color: ${tc};`);
    if (typo.lineHeight !== undefined) {
      const lhU =
        typo.lineHeight === 'normal' || !typo.lineHeightUnit || typo.lineHeightUnit === 'unitless'
          ? ''
          : typo.lineHeightUnit;
      props.push(`line-height: ${resolveTokenOrValue(typo.lineHeight, tokens.flatMap, 1.4)}${lhU};`);
    }
    if (typo.letterSpacing !== undefined && typo.letterSpacing !== 0) {
      props.push(`letter-spacing: ${resolveNum(typo.letterSpacing, tokens, 0)}${typo.letterSpacingUnit ?? 'px'};`);
    }
    if (typo.textAlign) props.push(`text-align: ${typo.textAlign};`);
    if (typo.textTransform && typo.textTransform !== 'none') props.push(`text-transform: ${typo.textTransform};`);
    if (typo.textDecoration && typo.textDecoration !== 'none') props.push(`text-decoration: ${typo.textDecoration};`);
    if (typo.whiteSpace && typo.whiteSpace !== 'normal') props.push(`white-space: ${typo.whiteSpace};`);
    if (typo.textOverflow && typo.textOverflow !== 'clip') props.push(`text-overflow: ${typo.textOverflow};`);
    if (typo.lineClamp && typo.lineClamp > 0) {
      props.push('display: -webkit-box;');
      props.push('-webkit-box-orient: vertical;');
      props.push(`-webkit-line-clamp: ${typo.lineClamp};`);
      props.push('overflow: hidden;');
    }
    if (typo.textShadow) {
      const tsc = cssColorExpr(typo.textShadow.color, tokens) ?? 'rgba(0,0,0,0.35)';
      props.push(`text-shadow: ${typo.textShadow.x}px ${typo.textShadow.y}px ${typo.textShadow.blur}px ${tsc};`);
    }
  }

  if (node.dragRegion === 'drag') {
    props.push('-webkit-app-region: drag;');
  } else if (node.dragRegion === 'no-drag') {
    props.push('-webkit-app-region: no-drag;');
  }

  if (node.style.base.cursor && node.style.base.cursor !== 'auto') {
    props.push(`cursor: ${node.style.base.cursor};`);
  } else if (node.kind === 'Button' || node.kind === 'IconButton') {
    props.push('cursor: pointer;');
  }
  if (node.style.base.pointerEvents && node.style.base.pointerEvents !== 'auto') {
    props.push(`pointer-events: ${node.style.base.pointerEvents};`);
  }
  if (node.style.base.userSelect && node.style.base.userSelect !== 'auto') {
    props.push(`user-select: ${node.style.base.userSelect};`);
  }
  if (node.kind === 'List') {
    props.push('list-style: none;');
  }

  if (node.style.base.customCss?.trim()) {
    for (const rawLine of node.style.base.customCss.split(/\r?\n|;/)) {
      const cleaned = rawLine.trim();
      if (cleaned && cleaned.includes(':')) {
        props.push(cleaned.endsWith(';') ? cleaned : `${cleaned};`);
      }
    }
  }

  return props;
}

function buildPseudoStateBody(
  override: StateOverrideSpec | undefined,
  tokens: UIRTokenDictionary,
): string[] {
  if (!override) return [];
  return compileStateOverrideToCssDeclarations(override, {
    tokenMap: tokens.flatMap,
    emitTokenVars: true,
  });
}

export function buildStylesheetWithSourceMap(
  root: UIRNode,
  tokens: UIRTokenDictionary,
  options?: {
    cssModules?: boolean;
    includeTokensRoot?: boolean;
    classMap?: ReadonlyMap<string, string>;
    customCss?: string;
    reusableClasses?: ReusableCssClass[];
    keyframesCss?: string;
  },
): { code: string; sourceMap: CodeSourceMapSpan[] } {
  const lines: string[] = [];
  const sourceMap: CodeSourceMapSpan[] = [];
  const bridgedMeta = lookupSheetCssMetaForUIR(tokens, root);
  const reusableClasses = options?.reusableClasses ?? bridgedMeta?.reusableClasses;
  const keyframesCss = options?.keyframesCss ?? bridgedMeta?.keyframesCss;

  if (options?.includeTokensRoot !== false) {
    lines.push(...buildTokenCssVariablesBlock(tokens).split('\n'));
  }

  // Collect animation names used in the UIR tree or reusable classes
  const usedAnims = new Set<string>();
  const collectAnims = (n: UIRNode) => {
    if (n.style.base.animation?.name && n.style.base.animation.name !== 'none') {
      usedAnims.add(n.style.base.animation.name);
    }
    for (const ov of Object.values(n.style.states ?? {})) {
      if (ov?.style?.animation?.name && ov.style.animation.name !== 'none') {
        usedAnims.add(ov.style.animation.name);
      }
    }
    for (const c of n.children) collectAnims(c);
  };
  collectAnims(root);
  for (const rc of reusableClasses ?? []) {
    if (rc.style?.animation?.name && rc.style.animation.name !== 'none') {
      usedAnims.add(rc.style.animation.name);
    }
  }

  const compiledKf = compileKeyframesCss(usedAnims, keyframesCss);
  if (compiledKf) {
    if (lines.length > 0) lines.push('');
    lines.push(...compiledKf.split('\n'));
  }

  if (!options?.cssModules && reusableClasses && reusableClasses.length > 0) {
    const rcCss = compileReusableClassesCss(reusableClasses, tokens.flatMap);
    if (rcCss) {
      if (lines.length > 0) lines.push('');
      lines.push(...rcCss.split('\n'));
    }
  }

  const resolvedMap = options?.classMap ?? buildCssClassMap(root);
  const visited = new Set<string>();
  const walk = (n: UIRNode, isRoot: boolean) => {
    const cls = getOwnSelectorClassName(n, Boolean(options?.cssModules), resolvedMap);
    if (!visited.has(cls)) {
      visited.add(cls);
      const body = buildNodeCssRuleBody(n, tokens, isRoot);
      if (body.length > 0) {
        if (lines.length > 0) lines.push('');
        const startLine = lines.length + 1;
        lines.push(`.${cls} {`);
        for (const b of body) {
          lines.push(`  ${b}`);
        }
        lines.push('}');

        for (const pseudo of ['hover', 'active', 'focus', 'focus-visible', 'disabled'] as const) {
          const pseudoProps = buildPseudoStateBody(n.style.states?.[pseudo], tokens);
          if (pseudoProps.length > 0) {
            lines.push(`.${cls}:${pseudo} {`);
            for (const pp of pseudoProps) {
              lines.push(`  ${pp}`);
            }
            lines.push('}');
          }
        }

        const endLine = lines.length;
        sourceMap.push({
          canvasNodeId: n.canvasNodeId,
          startLine,
          startCol: 1,
          endLine,
          endCol: (lines[endLine - 1]?.length ?? 1) + 1,
        });
      }
    }
    for (const child of n.children) {
      walk(child, false);
    }
  };
  walk(root, true);

  if (options?.customCss?.trim()) {
    if (lines.length > 0) lines.push('');
    lines.push(...options.customCss.trim().split('\n'));
  }

  return {
    code: lines.join('\n') + '\n',
    sourceMap,
  };
}

export function buildStylesheetForTree(
  root: UIRNode,
  tokens: UIRTokenDictionary,
  options?: {
    cssModules?: boolean;
    includeTokensRoot?: boolean;
    classMap?: ReadonlyMap<string, string>;
    customCss?: string;
    reusableClasses?: ReusableCssClass[];
    keyframesCss?: string;
  },
): string {
  return buildStylesheetWithSourceMap(root, tokens, options).code;
}
