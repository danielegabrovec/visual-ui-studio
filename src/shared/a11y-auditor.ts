import { buildTokenLookupMap } from './default-tokens';
import {
  resolveTokenOrValue,
  type DesignTokenEntry,
  type LayoutSpec,
  type NodeContentSpec,
  type NodeId,
  type PlatformExtensions,
  type StyleSpec,
  type TypographySpec,
  type UINode,
  type UISheetDocument,
} from './ui-ir';
import type { UIPatchOp } from './ui-patch';

export type AuditCategory =
  | 'contrast'
  | 'touch-target'
  | 'missing-label'
  | 'freeform-overlap'
  | 'responsive-overflow';

export type AuditSeverity = 'error' | 'warning' | 'info';

export interface AuditIssue {
  id: string;
  nodeId: NodeId;
  nodeName: string;
  category: AuditCategory;
  severity: AuditSeverity;
  wcagRule: string;
  title: string;
  message: string;
  suggestion: string;
  measuredValue?: string;
  expectedValue?: string;
  autoFixable: boolean;
}

export interface AuditReport {
  score: number;
  issues: AuditIssue[];
  autoFixPatches: UIPatchOp[];
  countsByCategory: Record<AuditCategory, number>;
}

export interface RgbColor {
  r: number; // 0..255
  g: number; // 0..255
  b: number; // 0..255
  a: number; // 0..1
}

const NAMED_CSS_COLORS: Record<string, RgbColor> = {
  white: { r: 255, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  red: { r: 239, g: 68, b: 68, a: 1 },
  green: { r: 34, g: 197, b: 94, a: 1 },
  blue: { r: 59, g: 130, b: 246, a: 1 },
  gray: { r: 107, g: 114, b: 128, a: 1 },
  grey: { r: 107, g: 114, b: 128, a: 1 },
  yellow: { r: 234, g: 179, b: 8, a: 1 },
  orange: { r: 249, g: 115, b: 22, a: 1 },
  purple: { r: 168, g: 85, b: 247, a: 1 },
};

const INTERACTIVE_CONTROL_TYPES = new Set([
  'button',
  'icon-button',
  'text-input',
  'password',
  'textarea',
  'select',
  'checkbox',
  'switch',
]);

const INTERACTIVE_SEMANTIC_TAGS = new Set(['button', 'input', 'select', 'textarea']);

export function parseCssColorToRgb(raw: string | undefined | null): RgbColor | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;

  if (trimmed in NAMED_CSS_COLORS) {
    return { ...NAMED_CSS_COLORS[trimmed] };
  }

  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
      if ([r, g, b, a].some(Number.isNaN)) return null;
      return { r, g, b, a };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      if ([r, g, b, a].some(Number.isNaN)) return null;
      return { r, g, b, a };
    }
    return null;
  }

  const rgbMatch = trimmed.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d*(?:\.\d+)?%?))?\s*\)$/,
  );
  if (rgbMatch) {
    const r = Math.max(0, Math.min(255, Math.round(Number(rgbMatch[1]))));
    const g = Math.max(0, Math.min(255, Math.round(Number(rgbMatch[2]))));
    const b = Math.max(0, Math.min(255, Math.round(Number(rgbMatch[3]))));
    let a = 1;
    if (rgbMatch[4] !== undefined && rgbMatch[4] !== '') {
      const rawA = rgbMatch[4];
      a = rawA.endsWith('%') ? Number(rawA.slice(0, -1)) / 100 : Number(rawA);
      a = Math.max(0, Math.min(1, a));
    }
    return { r, g, b, a };
  }

  return null;
}

export function rgbToHex(rgb: Pick<RgbColor, 'r' | 'g' | 'b'>): string {
  const to2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${to2(rgb.r)}${to2(rgb.g)}${to2(rgb.b)}`;
}

function compositeOver(fg: RgbColor, bg: RgbColor): RgbColor {
  const alpha = Math.max(0, Math.min(1, fg.a));
  if (alpha >= 0.999) return { r: fg.r, g: fg.g, b: fg.b, a: 1 };
  if (alpha <= 0.001) return { ...bg };
  return {
    r: Math.round(fg.r * alpha + bg.r * (1 - alpha)),
    g: Math.round(fg.g * alpha + bg.g * (1 - alpha)),
    b: Math.round(fg.b * alpha + bg.b * (1 - alpha)),
    a: 1,
  };
}

/**
 * Exact WCAG 2.2 relative luminance `L` in `[0, 1]` using sRGB IEC 61966-2-1 linearization.
 */
export function computeRelativeLuminance(rgb: Pick<RgbColor, 'r' | 'g' | 'b'>): number {
  const linearize = (channel8Bit: number): number => {
    const c = Math.max(0, Math.min(255, channel8Bit)) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const rLin = linearize(rgb.r);
  const gLin = linearize(rgb.g);
  const bLin = linearize(rgb.b);
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

export function computeContrastFromRgb(
  fg: Pick<RgbColor, 'r' | 'g' | 'b'>,
  bg: Pick<RgbColor, 'r' | 'g' | 'b'>,
): number {
  const l1 = computeRelativeLuminance(fg);
  const l2 = computeRelativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function computeWcagContrastRatio(fgColor: string, bgColor: string): number {
  const fg = parseCssColorToRgb(fgColor);
  const bg = parseCssColorToRgb(bgColor);
  if (!fg || !bg) return 21;
  const effectiveFg = fg.a < 1 ? compositeOver(fg, bg) : fg;
  return computeContrastFromRgb(effectiveFg, bg);
}

function resolveEffectiveBackgroundRgb(
  node: UINode,
  sheet: UISheetDocument,
  tokenMap: Record<string, string | number>,
): RgbColor {
  const canvasFallbackStr = String(tokenMap['color.bg.canvas'] ?? '#f8fafc');
  let baseBg: RgbColor = parseCssColorToRgb(canvasFallbackStr) ?? { r: 248, g: 250, b: 252, a: 1 };

  // Collect ancestor chain from root down to `node` so semi-transparent layers composite accurately
  const chain: UINode[] = [];
  let cur: UINode | undefined = node;
  const visited = new Set<NodeId>();
  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    chain.unshift(cur);
    cur = cur.parentId ? sheet.nodes[cur.parentId] : undefined;
  }

  for (const layer of chain) {
    const fills = layer.style.fills;
    if (!fills || fills.length === 0) continue;
    for (const fill of fills) {
      if (fill.type === 'solid') {
        const rawCol = resolveTokenOrValue(fill.color, tokenMap, '');
        const parsed = parseCssColorToRgb(rawCol);
        if (parsed && parsed.a > 0) {
          const nodeOpacity = layer.style.opacity ?? 1;
          baseBg = compositeOver({ ...parsed, a: parsed.a * nodeOpacity }, baseBg);
        }
      } else if (fill.type === 'linear-gradient' && fill.stops.length > 0) {
        const firstCol = resolveTokenOrValue(fill.stops[0].color, tokenMap, '');
        const parsed = parseCssColorToRgb(firstCol);
        if (parsed && parsed.a > 0) {
          baseBg = compositeOver(parsed, baseBg);
        }
      }
    }
  }

  return baseBg;
}

function suggestAccessibleForegroundHex(fg: RgbColor, bg: RgbColor, requiredRatio: number): string {
  const targetRatio = Math.max(requiredRatio + 0.4, 4.6);
  const bgLum = computeRelativeLuminance(bg);
  const darken = bgLum > 0.179;
  const pole: RgbColor = darken ? { r: 15, g: 23, b: 42, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };

  for (let step = 1; step <= 20; step++) {
    const t = step / 20;
    const candidate: RgbColor = {
      r: Math.round(fg.r + (pole.r - fg.r) * t),
      g: Math.round(fg.g + (pole.g - fg.g) * t),
      b: Math.round(fg.b + (pole.b - fg.b) * t),
      a: 1,
    };
    if (computeContrastFromRgb(candidate, bg) >= targetRatio) {
      return rgbToHex(candidate);
    }
  }

  return darken ? '#0f172a' : '#ffffff';
}

function isLargeWcagText(fontSize: number, fontWeight: number | string | undefined): boolean {
  if (fontSize >= 24) return true;
  const numericWeight =
    typeof fontWeight === 'number'
      ? fontWeight
      : fontWeight === 'bold' || fontWeight === 'extrabold' || fontWeight === 'black'
        ? 700
        : Number(fontWeight) || 400;
  return fontSize >= 18.5 && numericWeight >= 700;
}

function isInteractiveControlNode(node: UINode): boolean {
  if (!node.visible) return false;
  if (node.kind === 'control') {
    const ct = node.content?.controlType;
    if (!ct) return true;
    return INTERACTIVE_CONTROL_TYPES.has(ct);
  }
  return INTERACTIVE_SEMANTIC_TAGS.has(node.semanticTag);
}

function humanizeIdentifier(raw: string): string {
  const cleaned = raw
    .replace(/^(nd_|imp_|art_|btn_|inp_)/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'Interactive Control';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function findEnclosingArtboard(node: UINode, sheet: UISheetDocument): UINode | undefined {
  let cur: UINode | undefined = node.parentId ? sheet.nodes[node.parentId] : undefined;
  const seen = new Set<NodeId>();
  let topMost: UINode | undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    topMost = cur;
    if (cur.kind === 'artboard') return cur;
    cur = cur.parentId ? sheet.nodes[cur.parentId] : undefined;
  }
  return topMost?.kind === 'artboard' ? topMost : sheet.rootIds[0] ? sheet.nodes[sheet.rootIds[0]] : undefined;
}

export function computeBoxIoU(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const ax2 = a.x + Math.max(0, a.width);
  const ay2 = a.y + Math.max(0, a.height);
  const bx2 = b.x + Math.max(0, b.width);
  const by2 = b.y + Math.max(0, b.height);

  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const intersection = ix * iy;
  if (intersection <= 0) return 0;

  const areaA = Math.max(0, a.width) * Math.max(0, a.height);
  const areaB = Math.max(0, b.width) * Math.max(0, b.height);
  const union = areaA + areaB - intersection;
  return union > 0 ? intersection / union : 0;
}

interface PendingNodeUpdate {
  layout?: Partial<LayoutSpec>;
  style?: Partial<StyleSpec>;
  typography?: Partial<TypographySpec>;
  content?: Partial<NodeContentSpec>;
  platform?: Partial<PlatformExtensions>;
}

/**
 * Deterministic WCAG 2.2 Accessibility & Responsive Layout Auditor.
 * Checks:
 * 1. Text-vs-background contrast ratio (`< 4.5:1` normal text, `< 3.0:1` large text)
 * 2. Interactive controls smaller than `36px` height or missing accessible text/`ariaLabel`
 * 3. Overlapping siblings inside `freeform` containers (`IoU > 0.2`)
 * 4. Nodes exceeding artboard width (responsive horizontal overflow risk)
 */
export function auditSheetAccessibilityAndLayout(
  sheet: UISheetDocument,
  tokens: DesignTokenEntry[],
  activeThemeId?: string | null,
): AuditReport {
  const tokenMap = buildTokenLookupMap(tokens, activeThemeId ?? null);
  const issues: AuditIssue[] = [];
  const countsByCategory: Record<AuditCategory, number> = {
    contrast: 0,
    'touch-target': 0,
    'missing-label': 0,
    'freeform-overlap': 0,
    'responsive-overflow': 0,
  };

  const nodeUpdates = new Map<NodeId, PendingNodeUpdate>();
  const structuralOps: UIPatchOp[] = [];
  let issueSeq = 0;

  const ensureUpdate = (nodeId: NodeId): PendingNodeUpdate => {
    let entry = nodeUpdates.get(nodeId);
    if (!entry) {
      entry = {};
      nodeUpdates.set(nodeId, entry);
    }
    return entry;
  };

  const pushIssue = (issue: Omit<AuditIssue, 'id'>) => {
    countsByCategory[issue.category]++;
    issues.push({
      id: `audit_${++issueSeq}_${issue.category}_${issue.nodeId}`,
      ...issue,
    });
  };

  // Traverse nodes in deterministic tree order starting from sheet.rootIds
  const orderedNodes: UINode[] = [];
  const visitedIds = new Set<NodeId>();
  const collectVisibleTree = (id: NodeId) => {
    if (visitedIds.has(id)) return;
    const n = sheet.nodes[id];
    if (!n || !n.visible) return;
    visitedIds.add(id);
    orderedNodes.push(n);
    for (const cid of n.childIds) {
      collectVisibleTree(cid);
    }
  };
  for (const rid of sheet.rootIds) {
    collectVisibleTree(rid);
  }
  // Also check any visible orphan nodes present in `sheet.nodes`
  for (const n of Object.values(sheet.nodes)) {
    if (n.visible && !visitedIds.has(n.id)) {
      orderedNodes.push(n);
    }
  }

  for (const node of orderedNodes) {
    // ------------------------------------------------------------------------
    // CHECK 1: WCAG 2.2 Text-vs-Background Contrast Ratio
    // ------------------------------------------------------------------------
    const hasVisibleText =
      node.kind === 'text' ||
      (node.kind === 'control' &&
        Boolean(node.content?.text?.trim()) &&
        node.content?.controlType !== 'divider' &&
        node.content?.controlType !== 'slider' &&
        node.content?.controlType !== 'checkbox' &&
        node.content?.controlType !== 'switch');

    if (hasVisibleText) {
      const fgRaw = resolveTokenOrValue(
        node.typography?.color,
        tokenMap,
        String(tokenMap['color.text.primary'] ?? '#0f172a'),
      );
      const fgParsed = parseCssColorToRgb(fgRaw) ?? { r: 15, g: 23, b: 42, a: 1 };
      const bgRgb = resolveEffectiveBackgroundRgb(node, sheet, tokenMap);
      const compositedFg = compositeOver(fgParsed, bgRgb);
      const ratio = computeContrastFromRgb(compositedFg, bgRgb);

      const fontSize = Number(resolveTokenOrValue(node.typography?.fontSize, tokenMap, 15)) || 15;
      const fontWeight = resolveTokenOrValue(node.typography?.fontWeight, tokenMap, 400);
      const large = isLargeWcagText(fontSize, fontWeight);
      const minRequired = large ? 3.0 : 4.5;

      if (ratio < minRequired - 1e-6) {
        const fixedColorHex = suggestAccessibleForegroundHex(compositedFg, bgRgb, minRequired);
        const upd = ensureUpdate(node.id);
        upd.typography = {
          fontFamily: node.typography?.fontFamily ?? { $token: 'font.sans' },
          fontSize: node.typography?.fontSize ?? fontSize,
          fontWeight: node.typography?.fontWeight ?? fontWeight,
          ...(node.typography ?? {}),
          ...(upd.typography ?? {}),
          color: fixedColorHex,
        };

        pushIssue({
          nodeId: node.id,
          nodeName: node.name,
          category: 'contrast',
          severity: ratio < 3.0 ? 'error' : 'warning',
          wcagRule: 'WCAG 1.4.3 Contrast (Minimum) AA',
          title: 'Contrasto testo insufficiente',
          message: `"${node.name}" ha un rapporto di contrasto ${ratio.toFixed(2)}:1 (minimo richiesto ${minRequired.toFixed(1)}:1 per testo ${large ? 'grande' : 'normale'}).`,
          suggestion: `Imposta il colore del testo su ${fixedColorHex} per superare la soglia WCAG AA.`,
          measuredValue: `${ratio.toFixed(2)}:1`,
          expectedValue: `>= ${minRequired.toFixed(1)}:1`,
          autoFixable: true,
        });
      }
    }

    // ------------------------------------------------------------------------
    // CHECK 2: Interactive Controls (< 36px height OR missing label/ariaLabel)
    // ------------------------------------------------------------------------
    if (isInteractiveControlNode(node)) {
      const fixedHeightVal =
        node.layout.height.mode === 'fixed'
          ? Number(resolveTokenOrValue(node.layout.height.value, tokenMap, node.layout.frame.height))
          : node.layout.frame.height;
      const effectiveHeight = Math.min(
        node.layout.frame.height,
        Number.isFinite(fixedHeightVal) && fixedHeightVal > 0 ? fixedHeightVal : node.layout.frame.height,
      );

      if (effectiveHeight < 36) {
        const upd = ensureUpdate(node.id);
        const curFrame = upd.layout?.frame ?? node.layout.frame;
        const nextW = Math.max(40, curFrame.width);
        const nextH = Math.max(40, curFrame.height);
        const curWidthSpec = upd.layout?.width ?? node.layout.width;

        upd.layout = {
          ...(upd.layout ?? {}),
          frame: {
            ...curFrame,
            width: nextW,
            height: nextH,
          },
          width:
            curWidthSpec.mode === 'fixed' &&
            typeof curWidthSpec.value === 'number' &&
            curWidthSpec.value < 40
              ? { ...curWidthSpec, value: 40 }
              : curWidthSpec,
          height: {
            mode: 'fixed',
            value: 40,
          },
        };

        pushIssue({
          nodeId: node.id,
          nodeName: node.name,
          category: 'touch-target',
          severity: effectiveHeight < 28 ? 'error' : 'warning',
          wcagRule: 'WCAG 2.5.8 Target Size (Minimum) AA',
          title: 'Area interattiva troppo piccola (< 36px)',
          message: `Il controllo "${node.name}" ha altezza ${Math.round(effectiveHeight)}px, sotto il minimo consigliato di 36px.`,
          suggestion: `Ingrandisci l'altezza del controllo a 40px per un tocco/click ergonomico.`,
          measuredValue: `${Math.round(effectiveHeight)}px`,
          expectedValue: '>= 36px (Auto-Fix: 40px)',
          autoFixable: true,
        });
      }

      const hasAccessibleText = Boolean(node.content?.text?.trim());
      const hasAriaLabel = Boolean(node.platform?.a11y?.ariaLabel?.trim());

      if (!hasAccessibleText && !hasAriaLabel) {
        const inferredLabel = humanizeIdentifier(
          node.content?.placeholder || node.content?.iconName || node.name || node.semanticTag,
        );
        const upd = ensureUpdate(node.id);
        upd.platform = {
          ...(node.platform ?? {}),
          ...(upd.platform ?? {}),
          a11y: {
            ...(node.platform?.a11y ?? {}),
            ...(upd.platform?.a11y ?? {}),
            ariaLabel: inferredLabel,
          },
        };
        if (node.content?.controlType === 'button' && !node.content.text) {
          upd.content = {
            ...(node.content ?? {}),
            ...(upd.content ?? {}),
            text: inferredLabel,
          };
        }

        pushIssue({
          nodeId: node.id,
          nodeName: node.name,
          category: 'missing-label',
          severity: 'error',
          wcagRule: 'WCAG 4.1.2 Name, Role, Value (A)',
          title: 'Controllo privo di etichetta accessibile (aria-label)',
          message: `Il controllo interattivo "${node.name}" non espone testo visibile né attributo ariaLabel per gli screen reader.`,
          suggestion: `Aggiungi ariaLabel="${inferredLabel}".`,
          measuredValue: 'Mancante',
          expectedValue: `ariaLabel="${inferredLabel}"`,
          autoFixable: true,
        });
      }
    }

    // ------------------------------------------------------------------------
    // CHECK 3: Overlapping Siblings Inside Freeform Containers (IoU > 0.2)
    // ------------------------------------------------------------------------
    const visibleChildren = node.childIds
      .map((cid) => sheet.nodes[cid])
      .filter((c): c is UINode => Boolean(c && c.visible));

    const isFreeformContainer =
      (node.kind === 'container' || node.kind === 'artboard') &&
      visibleChildren.length >= 2 &&
      (node.layout.mode === 'freeform' || visibleChildren.some((c) => c.layout.positioning === 'absolute'));

    if (isFreeformContainer) {
      let maxIoU = 0;
      let pairNames: [string, string] | null = null;

      for (let i = 0; i < visibleChildren.length; i++) {
        for (let j = i + 1; j < visibleChildren.length; j++) {
          const iou = computeBoxIoU(visibleChildren[i].layout.frame, visibleChildren[j].layout.frame);
          if (iou > 0.2 && iou > maxIoU) {
            maxIoU = iou;
            pairNames = [visibleChildren[i].name, visibleChildren[j].name];
          }
        }
      }

      if (pairNames && maxIoU > 0.2) {
        const xs = visibleChildren.map((c) => c.layout.frame.x);
        const ys = visibleChildren.map((c) => c.layout.frame.y);
        const spreadX = Math.max(...xs) - Math.min(...xs);
        const spreadY = Math.max(...ys) - Math.min(...ys);
        const inferredDirection: 'row' | 'column' = spreadX > spreadY ? 'row' : 'column';

        structuralOps.push({
          op: 'convert_auto_layout',
          id: node.id,
          direction: inferredDirection,
          gap: 12,
          padding: 16,
          justify: 'start',
          align: 'stretch',
        });

        pushIssue({
          nodeId: node.id,
          nodeName: node.name,
          category: 'freeform-overlap',
          severity: 'warning',
          wcagRule: 'WCAG 1.4.10 Reflow / Auto-Layout',
          title: 'Sovrapposizione elementi in contenitore Freeform',
          message: `In "${node.name}" i figli "${pairNames[0]}" e "${pairNames[1]}" si sovrappongono (IoU ${(maxIoU * 100).toFixed(0)}% > 20%).`,
          suggestion: `Converti "${node.name}" in Auto-Layout (${inferredDirection === 'row' ? 'Riga Flex' : 'Colonna Flex'}) per evitare collisioni.`,
          measuredValue: `IoU ${maxIoU.toFixed(2)}`,
          expectedValue: 'IoU <= 0.20 (Auto-Layout)',
          autoFixable: true,
        });
      }
    }

    // ------------------------------------------------------------------------
    // CHECK 4: Nodes Exceeding Artboard Width (Responsive Overflow Risk)
    // ------------------------------------------------------------------------
    if (node.kind !== 'artboard') {
      const artboard = findEnclosingArtboard(node, sheet);
      if (artboard && artboard.id !== node.id) {
        const artboardWidth = Math.max(1, artboard.layout.frame.width);
        const parent = node.parentId ? sheet.nodes[node.parentId] : undefined;
        const isFreeformOrAbs =
          parent?.layout.mode === 'freeform' || node.layout.positioning === 'absolute';

        const resolvedFixedW =
          node.layout.width.mode === 'fixed'
            ? Number(resolveTokenOrValue(node.layout.width.value, tokenMap, node.layout.frame.width))
            : 0;

        const rightEdge = isFreeformOrAbs
          ? Math.max(0, node.layout.frame.x) + node.layout.frame.width
          : node.layout.frame.width;

        const measuredOverflowEdge = Math.max(rightEdge, resolvedFixedW);

        if (measuredOverflowEdge > artboardWidth) {
          const safeInnerWidth = Math.max(80, artboardWidth - 32);
          const upd = ensureUpdate(node.id);
          const baseFrame = upd.layout?.frame ?? node.layout.frame;
          const clampedW = Math.min(baseFrame.width, safeInnerWidth);
          const clampedX = isFreeformOrAbs
            ? Math.max(0, Math.min(baseFrame.x, artboardWidth - clampedW))
            : 0;

          upd.layout = {
            ...(upd.layout ?? {}),
            frame: {
              ...baseFrame,
              x: clampedX,
              width: clampedW,
            },
            width: isFreeformOrAbs
              ? { mode: 'fixed', value: clampedW }
              : { mode: 'fill', value: clampedW },
          };

          pushIssue({
            nodeId: node.id,
            nodeName: node.name,
            category: 'responsive-overflow',
            severity: measuredOverflowEdge > artboardWidth * 1.15 ? 'error' : 'warning',
            wcagRule: 'WCAG 1.4.10 Reflow (AA)',
            title: 'Overflow orizzontale oltre la larghezza Artboard',
            message: `"${node.name}" raggiunge ${Math.round(measuredOverflowEdge)}px, superando la larghezza dell'Artboard "${artboard.name}" (${Math.round(artboardWidth)}px).`,
            suggestion: `Ridimensiona a larghezza fluida (fill / max ${safeInnerWidth}px) entro i margini dell'Artboard.`,
            measuredValue: `${Math.round(measuredOverflowEdge)}px`,
            expectedValue: `<= ${Math.round(artboardWidth)}px`,
            autoFixable: true,
          });
        }
      }
    }
  }

  // Build coalesced atomic UIPatchOp[] batch
  const autoFixPatches: UIPatchOp[] = [];
  for (const [nodeId, upd] of nodeUpdates.entries()) {
    autoFixPatches.push({
      op: 'update_node',
      id: nodeId,
      ...(upd.layout ? { layout: upd.layout } : {}),
      ...(upd.style ? { style: upd.style } : {}),
      ...(upd.typography ? { typography: upd.typography } : {}),
      ...(upd.content ? { content: upd.content } : {}),
      ...(upd.platform ? { platform: upd.platform } : {}),
    });
  }
  autoFixPatches.push(...structuralOps);

  // Compute deterministic 0..100 health score
  let penalty = 0;
  for (const issue of issues) {
    if (issue.severity === 'error') penalty += 12;
    else if (issue.severity === 'warning') penalty += 8;
    else penalty += 3;
  }
  const score = Math.max(0, Math.min(100, 100 - penalty));

  return {
    score,
    issues,
    autoFixPatches,
    countsByCategory,
  };
}
