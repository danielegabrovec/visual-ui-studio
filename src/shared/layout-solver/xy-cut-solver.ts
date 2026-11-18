import {
  mergeCascadedNodeSpecs,
  registerSheetCssMetaForUIR,
  sanitizeCssClassSlug,
} from '../css-sync-engine';
import type {
  CodegenCompileOptions,
  DesignTheme,
  DesignTokenEntry,
  EventActionBinding,
  GridTrackSpec,
  InteractiveStateKey,
  LayoutSpec,
  NodeId,
  PaddingBox,
  StateOverrideSpec,
  TokenOrValue,
  UINode,
  UIRComponentDecl,
  UIRDesktopWindowSpec,
  UIRInteraction,
  UIRIpcCommandSpec,
  UIRModule,
  UIRNode,
  UIRSemanticKind,
  UIRTokenDictionary,
  UIRTrigger,
  UISheetDocument,
} from '../ui-ir';
import { isTokenRef, resolveTokenOrValue } from '../ui-ir';
import { applyPatchOpsToSheet, generateNodeId, type UIPatchOp } from '../ui-patch';

const TOKEN_SPACING_STEPS = [0, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 64];
const ROW_BAND_EPSILON = 10;
const ALIGN_CENTER_EPSILON = 8;

interface NodeBox {
  id: NodeId;
  node: UINode;
  x: number;
  y: number;
  w: number;
  h: number;
  right: number;
  bottom: number;
  cx: number;
  cy: number;
}

function snapToStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  let best = TOKEN_SPACING_STEPS[0];
  let bestDiff = Math.abs(raw - best);
  for (const step of TOKEN_SPACING_STEPS) {
    const diff = Math.abs(raw - step);
    if (diff < bestDiff) {
      best = step;
      bestDiff = diff;
    }
  }
  return bestDiff <= 4 ? best : Math.round(raw);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function toBox(node: UINode): NodeBox {
  const x = node.layout.frame?.x ?? 0;
  const y = node.layout.frame?.y ?? 0;
  const w = Math.max(1, node.layout.frame?.width ?? 120);
  const h = Math.max(1, node.layout.frame?.height ?? 40);
  return {
    id: node.id,
    node,
    x,
    y,
    w,
    h,
    right: x + w,
    bottom: y + h,
    cx: x + w / 2,
    cy: y + h / 2,
  };
}

function computeIntersectionArea(a: NodeBox, b: NodeBox): number {
  const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
  return ix * iy;
}

function enclosesStrictly(outer: NodeBox, inner: NodeBox): boolean {
  if (outer.id === inner.id) return false;
  const margin = 4;
  const inside =
    inner.x >= outer.x - margin &&
    inner.y >= outer.y - margin &&
    inner.right <= outer.right + margin &&
    inner.bottom <= outer.bottom + margin;
  if (!inside) return false;
  return outer.w * outer.h > inner.w * inner.h * 1.15;
}

/**
 * Groups boxes into horizontal Y-bands (rows) using projection overlap & center proximity.
 */
function clusterIntoHorizontalBands(boxes: NodeBox[]): NodeBox[][] {
  if (boxes.length === 0) return [];
  const sortedByY = [...boxes].sort((a, b) => (Math.abs(a.y - b.y) <= 4 ? a.x - b.x : a.y - b.y));
  const bands: Array<{ top: number; bottom: number; cySum: number; items: NodeBox[] }> = [];

  for (const box of sortedByY) {
    let placed = false;
    for (const band of bands) {
      const bandCy = band.cySum / band.items.length;
      const verticalOverlap = Math.min(band.bottom, box.bottom) - Math.max(band.top, box.y);
      const minHeight = Math.max(1, Math.min(band.bottom - band.top, box.h));
      const overlapsVertically = verticalOverlap / minHeight > 0.35;
      const centersClose = Math.abs(box.cy - bandCy) <= ROW_BAND_EPSILON;

      if (overlapsVertically || centersClose) {
        band.items.push(box);
        band.top = Math.min(band.top, box.y);
        band.bottom = Math.max(band.bottom, box.bottom);
        band.cySum += box.cy;
        placed = true;
        break;
      }
    }
    if (!placed) {
      bands.push({
        top: box.y,
        bottom: box.bottom,
        cySum: box.cy,
        items: [box],
      });
    }
  }

  for (const band of bands) {
    band.items.sort((a, b) => a.x - b.x);
  }
  bands.sort((a, b) => a.top - b.top);
  return bands.map((b) => b.items);
}

/**
 * Checks whether multi-row horizontal bands form a regular 2D Grid.
 */
function detectRegularGridTracks(bands: NodeBox[][]): {
  isGrid: boolean;
  cols: GridTrackSpec[];
  rows: GridTrackSpec[];
  colGap: number;
  rowGap: number;
} | null {
  if (bands.length < 2) return null;
  const colCount = bands[0].length;
  if (colCount < 2) return null;

  // Allow last row to be partial (at least 2 items), all preceding rows must match colCount
  for (let r = 0; r < bands.length; r++) {
    const len = bands[r].length;
    if (r < bands.length - 1 && len !== colCount) return null;
    if (r === bands.length - 1 && (len < 1 || len > colCount)) return null;
  }

  // Verify X alignment across rows
  let alignedChecks = 0;
  let totalChecks = 0;
  const colWidths: number[] = Array.from({ length: colCount }, () => 0);

  for (let c = 0; c < colCount; c++) {
    const xs: number[] = [];
    const ws: number[] = [];
    for (let r = 0; r < bands.length; r++) {
      if (c < bands[r].length) {
        xs.push(bands[r][c].x);
        ws.push(bands[r][c].w);
      }
    }
    colWidths[c] = median(ws);
    if (xs.length >= 2) {
      const base = xs[0];
      for (let i = 1; i < xs.length; i++) {
        totalChecks++;
        if (Math.abs(xs[i] - base) <= 18) alignedChecks++;
      }
    }
  }

  if (totalChecks === 0 || alignedChecks / totalChecks < 0.8) {
    return null;
  }

  const maxW = Math.max(...colWidths);
  const minW = Math.min(...colWidths);
  const uniformWidths = maxW > 0 && (maxW - minW) / maxW <= 0.2;

  const cols: GridTrackSpec[] = uniformWidths
    ? colWidths.map(() => ({ track: 'fr', value: 1 }))
    : colWidths.map((w, idx) =>
        idx === colWidths.length - 1 ? { track: 'fr', value: 1 } : { track: 'px', value: Math.round(w) },
      );

  const rows: GridTrackSpec[] = bands.map(() => ({ track: 'auto' }));

  const hGaps: number[] = [];
  for (const band of bands) {
    for (let i = 1; i < band.length; i++) {
      hGaps.push(Math.max(0, band[i].x - band[i - 1].right));
    }
  }
  const vGaps: number[] = [];
  for (let r = 1; r < bands.length; r++) {
    const prevBottom = Math.max(...bands[r - 1].map((b) => b.bottom));
    const curTop = Math.min(...bands[r].map((b) => b.y));
    vGaps.push(Math.max(0, curTop - prevBottom));
  }

  return {
    isGrid: true,
    cols,
    rows,
    colGap: snapToStep(median(hGaps)),
    rowGap: snapToStep(median(vGaps)),
  };
}

/**
 * Spatial Layout Solver (XY-Cut + Enclosure Recovery + Grid/Flex Inference).
 * Converts Freeform/Absolute geometry into clean Auto-Layout `UIPatchOp[]`.
 */
export function solveFreeformToAutoLayout(
  sheet: UISheetDocument,
  rootNodeId?: NodeId,
): { ops: UIPatchOp[]; summary: string } {
  const targetRootId = rootNodeId ?? sheet.rootIds[0];
  if (!targetRootId || !sheet.nodes[targetRootId]) {
    return { ops: [], summary: 'No valid root node found to solve.' };
  }

  let workingSheet = structuredClone(sheet);
  const accumulatedOps: UIPatchOp[] = [];
  let rowCount = 0;
  let colCount = 0;
  let gridCount = 0;
  let wrappedRows = 0;
  let enclosedCount = 0;

  const applyAndRecord = (newOps: UIPatchOp[]) => {
    if (newOps.length === 0) return;
    accumulatedOps.push(...newOps);
    workingSheet = applyPatchOpsToSheet(workingSheet, newOps).nextSheet;
  };

  const solveContainer = (containerId: NodeId) => {
    const container = workingSheet.nodes[containerId];
    if (!container || !container.visible) return;

    const visibleChildren = container.childIds
      .map((cid) => workingSheet.nodes[cid])
      .filter((n): n is UINode => Boolean(n && n.visible));

    if (visibleChildren.length === 0) return;

    const needsSolving =
      container.layout.mode === 'freeform' ||
      visibleChildren.some((c) => c.layout.positioning === 'absolute');

    if (needsSolving && visibleChildren.length >= 2) {
      // Pass 1: Enclosure recovery (e.g., Text/Icon placed visually inside a sibling Card/Button container)
      const boxes = visibleChildren.map(toBox);
      const enclosureMoves: UIPatchOp[] = [];
      const movedIds = new Set<NodeId>();

      for (const inner of boxes) {
        if (movedIds.has(inner.id)) continue;
        const candidateContainers = boxes
          .filter(
            (outer) =>
              !movedIds.has(outer.id) &&
              (outer.node.kind === 'container' || outer.node.kind === 'artboard') &&
              enclosesStrictly(outer, inner),
          )
          .sort((a, b) => a.w * a.h - b.w * b.h);

        if (candidateContainers.length > 0) {
          const host = candidateContainers[0];
          const relX = Math.max(0, inner.x - host.x);
          const relY = Math.max(0, inner.y - host.y);
          enclosureMoves.push(
            {
              op: 'move_node',
              id: inner.id,
              newParentId: host.id,
              index: host.node.childIds.length,
            },
            {
              op: 'update_node',
              id: inner.id,
              layout: {
                frame: { ...inner.node.layout.frame, x: relX, y: relY },
              },
            },
          );
          movedIds.add(inner.id);
          enclosedCount++;
        }
      }
      if (enclosureMoves.length > 0) {
        applyAndRecord(enclosureMoves);
      }
    }

    // Refresh container after any enclosure re-parenting
    const refreshed = workingSheet.nodes[containerId];
    if (!refreshed) return;

    const flowCandidates = refreshed.childIds
      .map((cid) => workingSheet.nodes[cid])
      .filter((n): n is UINode => Boolean(n && n.visible));

    const containerNeedsLayout =
      refreshed.layout.mode === 'freeform' ||
      flowCandidates.some((c) => c.layout.positioning === 'absolute');

    if (containerNeedsLayout && flowCandidates.length >= 1) {
      const boxes = flowCandidates.map(toBox);

      // Separate true overlapping floating overlays from structural flow items
      const floatingIds = new Set<NodeId>();
      if (boxes.length >= 2) {
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const area = computeIntersectionArea(boxes[i], boxes[j]);
            const smaller = Math.min(boxes[i].w * boxes[i].h, boxes[j].w * boxes[j].h);
            if (smaller > 0 && area / smaller > 0.45) {
              // Mark smaller top-most item as intentional floating badge/overlay
              const smallerBox = boxes[i].w * boxes[i].h <= boxes[j].w * boxes[j].h ? boxes[i] : boxes[j];
              floatingIds.add(smallerBox.id);
            }
          }
        }
      }

      const structuralBoxes = boxes.filter((b) => !floatingIds.has(b.id));
      const parentW = Math.max(1, refreshed.layout.frame.width);

      if (structuralBoxes.length === 1) {
        const only = structuralBoxes[0];
        const padLeft = snapToStep(Math.max(0, only.x));
        const padTop = snapToStep(Math.max(0, only.y));
        applyAndRecord([
          {
            op: 'convert_auto_layout',
            id: containerId,
            direction: 'column',
            gap: 12,
            padding: snapToStep(median([padLeft, padTop])) || 16,
            justify: 'start',
            align: only.w >= parentW * 0.8 ? 'stretch' : 'start',
          },
        ]);
        colCount++;
      } else if (structuralBoxes.length >= 2) {
        const bands = clusterIntoHorizontalBands(structuralBoxes);
        const gridResult = detectRegularGridTracks(bands);

        const minX = Math.min(...structuralBoxes.map((b) => b.x));
        const minY = Math.min(...structuralBoxes.map((b) => b.y));
        const maxRight = Math.max(...structuralBoxes.map((b) => b.right));
        const inferredPad = snapToStep(
          median([Math.max(0, minX), Math.max(0, minY), Math.max(0, parentW - maxRight)]),
        );

        if (gridResult) {
          // Reorder children in row-major order and convert to 2D Grid
          const orderedIds = bands.flatMap((b) => b.map((item) => item.id));
          const reorderOps: UIPatchOp[] = [];
          orderedIds.forEach((id, idx) => {
            reorderOps.push({ op: 'move_node', id, newParentId: containerId, index: idx });
          });
          applyAndRecord([
            ...reorderOps,
            {
              op: 'convert_auto_layout',
              id: containerId,
              direction: 'grid',
              gap: snapToStep((gridResult.colGap + gridResult.rowGap) / 2) || 16,
              padding: inferredPad,
              gridCols: gridResult.cols,
              gridRows: gridResult.rows,
            },
          ]);
          gridCount++;
        } else if (bands.length === 1) {
          // Single horizontal row
          const rowItems = bands[0];
          const gaps: number[] = [];
          for (let i = 1; i < rowItems.length; i++) {
            gaps.push(Math.max(0, rowItems[i].x - rowItems[i - 1].right));
          }
          const medGap = snapToStep(median(gaps));
          const cyDiffs = rowItems.map((b) => Math.abs(b.cy - rowItems[0].cy));
          const align: LayoutSpec['align'] = Math.max(...cyDiffs) <= ALIGN_CENTER_EPSILON ? 'center' : 'start';

          let justify: LayoutSpec['justify'] = 'start';
          if (
            rowItems.length === 2 &&
            rowItems[0].x <= parentW * 0.12 &&
            parentW - rowItems[1].right <= parentW * 0.12 &&
            gaps[0] > parentW * 0.22
          ) {
            justify = 'space-between';
          }

          const reorderOps: UIPatchOp[] = rowItems.map((item, idx) => ({
            op: 'move_node',
            id: item.id,
            newParentId: containerId,
            index: idx,
          }));

          applyAndRecord([
            ...reorderOps,
            {
              op: 'convert_auto_layout',
              id: containerId,
              direction: 'row',
              gap: justify === 'space-between' ? 16 : medGap,
              padding: inferredPad,
              justify,
              align,
            },
          ]);
          rowCount++;
        } else {
          // Multi-band vertical Column (with optional horizontal sub-row wrapping!)
          const orderedTopLevelIds: NodeId[] = [];
          const wrapOps: UIPatchOp[] = [];

          for (let r = 0; r < bands.length; r++) {
            const band = bands[r];
            if (band.length >= 2) {
              const wrapperId = generateNodeId('row_grp');
              const hGaps: number[] = [];
              for (let i = 1; i < band.length; i++) {
                hGaps.push(Math.max(0, band[i].x - band[i - 1].right));
              }
              wrapOps.push({
                op: 'wrap_container',
                targetNodeIds: band.map((b) => b.id),
                wrapperId,
                wrapperName: `AutoRow_${r + 1}`,
                direction: 'row',
                gap: snapToStep(median(hGaps)) || 12,
                padding: 0,
              });
              orderedTopLevelIds.push(wrapperId);
              wrappedRows++;
            } else {
              orderedTopLevelIds.push(band[0].id);
            }
          }

          if (wrapOps.length > 0) {
            applyAndRecord(wrapOps);
          }

          const vGaps: number[] = [];
          for (let r = 1; r < bands.length; r++) {
            const prevBottom = Math.max(...bands[r - 1].map((b) => b.bottom));
            const curTop = Math.min(...bands[r].map((b) => b.y));
            vGaps.push(Math.max(0, curTop - prevBottom));
          }
          const medVGap = snapToStep(median(vGaps));
          const allStretch = structuralBoxes.every((b) => b.w >= (parentW - inferredPad * 2) * 0.78);

          const reorderOps: UIPatchOp[] = orderedTopLevelIds.map((id, idx) => ({
            op: 'move_node',
            id,
            newParentId: containerId,
            index: idx,
          }));

          applyAndRecord([
            ...reorderOps,
            {
              op: 'convert_auto_layout',
              id: containerId,
              direction: 'column',
              gap: medVGap || 16,
              padding: inferredPad,
              justify: 'start',
              align: allStretch ? 'stretch' : 'start',
            },
            ...structuralBoxes
              .filter((b) => b.w >= (parentW - inferredPad * 2) * 0.78)
              .map(
                (b): UIPatchOp => ({
                  op: 'update_node',
                  id: b.id,
                  layout: { width: { mode: 'fill' }, positioning: 'flow' },
                }),
              ),
          ]);
          colCount++;
        }
      }
    }

    // Recurse into children
    const finalContainer = workingSheet.nodes[containerId];
    if (finalContainer) {
      for (const cid of [...finalContainer.childIds]) {
        solveContainer(cid);
      }
    }
  };

  solveContainer(targetRootId);

  if (accumulatedOps.length === 0) {
    return {
      ops: [],
      summary: 'Layout is already structured in Auto-Layout (Flex/Grid); zero freeform changes needed.',
    };
  }

  const parts: string[] = [];
  if (colCount > 0) parts.push(`${colCount} Column${colCount > 1 ? 's' : ''}`);
  if (rowCount > 0) parts.push(`${rowCount} Row${rowCount > 1 ? 's' : ''}`);
  if (gridCount > 0) parts.push(`${gridCount} Grid${gridCount > 1 ? 's' : ''}`);
  if (wrappedRows > 0) parts.push(`${wrappedRows} Wrapped Sub-Row${wrappedRows > 1 ? 's' : ''}`);
  if (enclosedCount > 0) parts.push(`${enclosedCount} Enclosed Child${enclosedCount > 1 ? 'ren' : ''}`);

  return {
    ops: accumulatedOps,
    summary: `Solved freeform geometry into structured Auto-Layout: ${parts.join(', ')} (${accumulatedOps.length} patch ops).`,
  };
}

// ============================================================================
// LEVEL-1 `UISheetDocument` -> LEVEL-2 `UIRModule` COMPILER NORMALIZER
// ============================================================================

export function buildUIRTokenDictionary(
  tokens: DesignTokenEntry[],
  themes: DesignTheme[],
): UIRTokenDictionary {
  const darkTheme = themes.find((t) => t.name.toLowerCase().includes('dark'));
  const dict: UIRTokenDictionary = {
    colors: {},
    spacing: {},
    radii: {},
    typography: {},
    shadows: {},
    flatMap: {},
  };

  for (const tok of tokens) {
    if (tok.themeId !== null) continue;
    const numVal = Number(tok.rawValue);
    if (tok.category === 'color') {
      dict.colors[tok.tokenPath] = { light: tok.rawValue };
      dict.flatMap[tok.tokenPath] = tok.rawValue;
    } else if (tok.category === 'spacing') {
      const parsed = Number.isNaN(numVal) ? 0 : numVal;
      dict.spacing[tok.tokenPath] = parsed;
      dict.flatMap[tok.tokenPath] = parsed;
    } else if (tok.category === 'radius') {
      const parsed = Number.isNaN(numVal) ? 0 : numVal;
      dict.radii[tok.tokenPath] = parsed;
      dict.flatMap[tok.tokenPath] = parsed;
    } else if (tok.category === 'shadow') {
      dict.shadows[tok.tokenPath] = tok.rawValue;
      dict.flatMap[tok.tokenPath] = tok.rawValue;
    } else {
      dict.typography[tok.tokenPath] = Number.isNaN(numVal) ? tok.rawValue : numVal;
      dict.flatMap[tok.tokenPath] = Number.isNaN(numVal) ? tok.rawValue : numVal;
    }
  }

  if (darkTheme) {
    for (const tok of tokens) {
      if (tok.themeId === darkTheme.id && tok.category === 'color') {
        if (!dict.colors[tok.tokenPath]) {
          dict.colors[tok.tokenPath] = { light: tok.rawValue, dark: tok.rawValue };
        } else {
          dict.colors[tok.tokenPath].dark = tok.rawValue;
        }
      }
    }
  }

  return dict;
}

function classifySemanticKind(node: UINode): UIRSemanticKind {
  if (node.kind === 'component_instance') return 'ComponentInstance';
  if (node.kind === 'slot') return 'Slot';
  if (node.kind === 'vector') return 'Icon';
  if (node.kind === 'media') return 'Image';
  if (node.kind === 'collection') return 'List';

  if (node.kind === 'control') {
    switch (node.content?.controlType) {
      case 'button':
        return 'Button';
      case 'icon-button':
        return 'IconButton';
      case 'text-input':
      case 'password':
        return 'TextInput';
      case 'textarea':
        return 'TextArea';
      case 'select':
        return 'Select';
      case 'checkbox':
        return 'Checkbox';
      case 'switch':
        return 'Switch';
      case 'slider':
        return 'Slider';
      case 'badge':
        return 'Badge';
      case 'divider':
        return 'Divider';
      case 'tabs':
        return 'Tabs';
      case 'table':
        return 'Table';
      case 'three-viewport':
        return 'ThreeViewport';
      default:
        break;
    }
  }

  if (node.kind === 'text') {
    if (node.semanticTag === 'h1' || node.semanticTag === 'h2' || node.semanticTag === 'h3' || node.semanticTag === 'h4') {
      return 'Heading';
    }
    const fontSize = typeof node.typography?.fontSize === 'number' ? node.typography.fontSize : 15;
    if (fontSize >= 20) return 'Heading';
    return 'Text';
  }

  switch (node.semanticTag) {
    case 'header':
      return 'Header';
    case 'footer':
      return 'Footer';
    case 'nav':
      return 'Nav';
    case 'form':
      return 'Form';
    case 'dialog':
      return 'Modal';
    case 'table':
      return 'Table';
    case 'ul':
      return 'List';
    case 'button':
      return 'Button';
    case 'input':
      return 'TextInput';
    case 'textarea':
      return 'TextArea';
    case 'select':
      return 'Select';
    case 'article':
      return 'Card';
    default:
      break;
  }

  if (node.layout.overflow === 'scroll' || node.layout.overflow === 'auto') {
    if (node.kind !== 'artboard') return 'ScrollArea';
  }

  const hasCardAppearance =
    node.kind === 'container' &&
    Boolean((node.style.fills && node.style.fills.length > 0) || node.style.border || node.style.shadows?.length);
  if (hasCardAppearance) return 'Card';

  return 'Box';
}

function mapTrigger(trigger: EventActionBinding['trigger']): UIRTrigger {
  switch (trigger) {
    case 'onClick':
      return 'click';
    case 'onDoubleClick':
      return 'dblclick';
    case 'onSubmit':
      return 'submit';
    case 'onChange':
      return 'change';
    case 'onInput':
      return 'input';
    case 'onMount':
      return 'mount';
    case 'onHover':
      return 'hover';
    case 'onMouseLeave':
      return 'mouseleave';
    case 'onFocus':
      return 'focus';
    case 'onBlur':
      return 'blur';
    case 'onKeyDown':
      return 'keydown';
    case 'onInterval':
      return 'interval';
  }
}

function normalizeInteractions(node: UINode): UIRInteraction[] {
  const result: UIRInteraction[] = [];

  if (node.interactions) {
    for (const binding of node.interactions) {
      const trig = mapTrigger(binding.trigger);
      const act = binding.action;
      switch (act.kind) {
        case 'set_state':
          result.push({
            type: 'STATE_MUTATION',
            trigger: trig,
            targetState: act.stateKey,
            expr: act.expression,
          });
          break;
        case 'navigate':
        case 'open_modal':
          result.push({
            type: 'NAVIGATION',
            trigger: trig,
            routeOrSheetId: act.kind === 'navigate' ? act.targetSheetOrRoute : `#${act.modalNodeId}`,
          });
          break;
        case 'call_handler':
          result.push({
            type: 'STATE_MUTATION',
            trigger: trig,
            targetState: act.handlerName,
            expr: `${act.handlerName}(${(act.args ?? []).join(', ')})`,
          });
          break;
        case 'call_script_fn':
          result.push({
            type: 'SCRIPT_CALL',
            trigger: trig,
            fnName: act.fnName,
            vfsEntryId: act.vfsEntryId,
            moduleRelPath: act.moduleRelPath,
            args: act.args,
            passEvent: act.passEvent,
            debounceMs: act.debounceMs,
            keyFilter: act.keyFilter,
            intervalMs: act.intervalMs,
            automationId: act.automationId,
          });
          break;
        case 'trigger_blueprint':
          result.push({
            type: 'BLUEPRINT_EVENT',
            trigger: trig,
            blueprintId: act.blueprintId,
            eventName: act.eventName,
          });
          break;
        case 'mvvm_command':
          result.push({
            type: 'MVVM_COMMAND',
            trigger: trig,
            commandName: act.commandName,
            parameterExpr: act.parameterExpr,
          });
          break;
        case 'ipc_invoke':
          result.push({
            type: 'NATIVE_IPC_CALL',
            trigger: trig,
            commandName: act.channel,
            argsPayload: act.payloadExpr ? { payload: act.payloadExpr } : {},
            resultStateTarget: act.resultStateKey,
          });
          break;
        case 'http_fetch':
          result.push({
            type: 'HYPERMEDIA_HTMX',
            method: act.method,
            endpoint: act.url,
            swap: 'innerHTML',
          });
          break;
      }
    }
  }

  if (node.platform?.htmx) {
    const h = node.platform.htmx;
    const methodMap: Record<typeof h.method, 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'> = {
      'hx-get': 'GET',
      'hx-post': 'POST',
      'hx-put': 'PUT',
      'hx-patch': 'PATCH',
      'hx-delete': 'DELETE',
    };
    result.push({
      type: 'HYPERMEDIA_HTMX',
      method: methodMap[h.method],
      endpoint: h.endpoint,
      triggerSpec: h.hxTrigger,
      targetCanvasNodeId: h.targetNodeId,
      targetSelectorFallback: h.targetSelectorFallback,
      swap: h.hxSwap ?? 'innerHTML',
      indicatorCanvasNodeId: h.indicatorNodeId,
      confirmPrompt: h.confirmPrompt,
      pushUrl: h.pushUrl,
      oobSwapNodes: h.oobNodeIds,
    });
  }

  if (node.platform?.mvvm?.command) {
    const cmdPath = node.platform.mvvm.command.path;
    const alreadyAdded = result.some((r) => r.type === 'MVVM_COMMAND' && r.commandName === cmdPath);
    if (!alreadyAdded) {
      result.push({
        type: 'MVVM_COMMAND',
        trigger: 'click',
        commandName: cmdPath,
        parameterExpr: node.platform.mvvm.command.parameterExpr,
      });
    }
  }

  return result;
}

function formatGridTracks(tracks?: GridTrackSpec[]): string[] {
  if (!tracks || tracks.length === 0) return ['1fr'];
  return tracks.map((t) => {
    if (t.track === 'auto') return 'auto';
    if (t.track === 'minmax') return `minmax(${t.min ?? '180px'}, ${t.max ?? '1fr'})`;
    if (t.track === '%') return `${t.value ?? 50}%`;
    if (t.track === 'fr') return `${t.value ?? 1}fr`;
    return `${t.value ?? 120}px`;
  });
}

function resolveAxisBound(
  val: TokenOrValue<number> | undefined,
  flatTokens: Record<string, string | number>,
): number | undefined {
  if (val === undefined) return undefined;
  const resolved = resolveTokenOrValue(val, flatTokens, 0);
  return typeof resolved === 'number' ? resolved : Number(resolved) || undefined;
}

function isInteractiveControlKind(kind: UIRSemanticKind): boolean {
  return (
    kind === 'Button' ||
    kind === 'IconButton' ||
    kind === 'TextInput' ||
    kind === 'TextArea' ||
    kind === 'Select' ||
    kind === 'Checkbox' ||
    kind === 'Switch' ||
    kind === 'Slider'
  );
}

export function sanitizePascalComponentName(raw: string): string {
  const cleaned = raw
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  if (!cleaned) return 'GeneratedScreen';
  return /^[0-9]/.test(cleaned) ? `Screen${cleaned}` : cleaned;
}

export function normalizeSheetToUIRModule(
  sheet: UISheetDocument,
  tokens: DesignTokenEntry[],
  themes: DesignTheme[],
  options?: Pick<CodegenCompileOptions, 'autoSolveFreeform' | 'componentNameOverride'>,
): UIRModule {
  let activeSheet = sheet;
  if (options?.autoSolveFreeform === true) {
    const solved = solveFreeformToAutoLayout(sheet);
    if (solved.ops.length > 0) {
      activeSheet = applyPatchOpsToSheet(sheet, solved.ops).nextSheet;
    }
  }

  const tokenDict = buildUIRTokenDictionary(tokens, themes);
  const discoveredIpc = new Map<string, UIRIpcCommandSpec>();
  for (const spec of activeSheet.ipcSchema ?? []) {
    discoveredIpc.set(spec.name, spec);
  }

  const convertNode = (nodeId: NodeId, insideDragHeader: boolean, parentRawMode?: LayoutSpec['mode']): UIRNode | null => {
    const node = activeSheet.nodes[nodeId];
    if (!node || !node.visible) return null;

    // Pre-merge attached ReusableCssClass properties as resolved base defaults for non-CSS native targets
    // while preserving `classNames` for Web/CSS targets!
    const rawClassNames = node.classNames ?? node.style.classNames ?? [];
    const resolvedClassNames = Array.from(
      new Set(rawClassNames.map(sanitizeCssClassSlug).filter(Boolean)),
    );
    const cascaded = mergeCascadedNodeSpecs(node, activeSheet.reusableClasses, 'base');
    const effLayout = cascaded.layout;
    const effStyle = {
      ...cascaded.style,
      ...(resolvedClassNames.length > 0 ? { classNames: resolvedClassNames } : {}),
    };
    const effTypo = cascaded.typography;

    // Merge reusable class stateOverrides underneath node.stateOverrides
    let mergedStates: Partial<Record<InteractiveStateKey, StateOverrideSpec>> | undefined = node.stateOverrides
      ? structuredClone(node.stateOverrides)
      : undefined;
    if (resolvedClassNames.length > 0 && activeSheet.reusableClasses?.length) {
      const rcByName = new Map(activeSheet.reusableClasses.map((rc) => [sanitizeCssClassSlug(rc.name), rc]));
      for (const cn of resolvedClassNames) {
        const rc = rcByName.get(cn);
        const rcStates = rc?.stateOverrides ?? rc?.states;
        if (!rcStates) continue;
        if (!mergedStates) mergedStates = {};
        for (const [sk, ov] of Object.entries(rcStates) as Array<[InteractiveStateKey, StateOverrideSpec | undefined]>) {
          if (!ov) continue;
          const curNodeOv = mergedStates[sk];
          mergedStates[sk] = {
            layout: { ...(ov.layout ?? {}), ...(curNodeOv?.layout ?? {}) },
            style: { ...(ov.style ?? {}), ...(curNodeOv?.style ?? {}) },
            typography: ov.typography || curNodeOv?.typography
              ? ({ ...(ov.typography ?? {}), ...(curNodeOv?.typography ?? {}) } as StateOverrideSpec['typography'])
              : undefined,
          };
        }
      }
    }

    const kind = classifySemanticKind(node);
    const rawDrag = node.platform?.desktopWindow?.dragRegion;
    let dragRegion: 'drag' | 'no-drag' | undefined;
    if (rawDrag === true || rawDrag === 'drag') {
      dragRegion = 'drag';
    } else if (rawDrag === 'no-drag') {
      dragRegion = 'no-drag';
    } else if (insideDragHeader && isInteractiveControlKind(kind)) {
      // Automatically ensure controls inside frameless drag headers remain clickable!
      dragRegion = 'no-drag';
    }

    const nextDragContext = dragRegion === 'drag' ? true : dragRegion === 'no-drag' ? false : insideDragHeader;

    const children: UIRNode[] = [];
    for (const cid of node.childIds) {
      const converted = convertNode(cid, nextDragContext, effLayout.mode);
      if (converted) children.push(converted);
    }

    const isChildFloating =
      effLayout.positioning === 'absolute' ||
      effLayout.positioning === 'fixed' ||
      (parentRawMode === 'freeform' && node.kind !== 'artboard');

    let layoutMode: UIRNode['layout']['mode'] = 'COLUMN';
    if (effLayout.mode === 'freeform' && children.length > 0) {
      layoutMode = 'FREEFORM';
    } else if (isChildFloating) {
      layoutMode = 'FLOATING';
    } else if (effLayout.mode === 'grid') {
      layoutMode = 'GRID';
    } else if (effLayout.mode === 'stack') {
      layoutMode = 'STACK';
    } else if (effLayout.mode === 'flex') {
      layoutMode = effLayout.direction === 'row' || effLayout.direction === 'row-reverse' ? 'ROW' : 'COLUMN';
    } else {
      layoutMode =
        children.length > 1 && (effLayout.direction === 'row' || effLayout.direction === 'row-reverse')
          ? 'ROW'
          : 'COLUMN';
    }

    const mapSizeMode = (
      m: LayoutSpec['width']['mode'],
    ): 'FIXED' | 'HUG' | 'FILL' | 'PERCENTAGE' | 'VIEWPORT' | 'REM' | 'AUTO' => {
      switch (m) {
        case 'fixed':
          return 'FIXED';
        case 'fill':
          return 'FILL';
        case 'percentage':
          return 'PERCENTAGE';
        case 'viewport':
          return 'VIEWPORT';
        case 'rem':
          return 'REM';
        case 'auto':
          return 'AUTO';
        default:
          return 'HUG';
      }
    };

    const padding: PaddingBox = effLayout.padding ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const interactions = normalizeInteractions(node);

    for (const inter of interactions) {
      if (inter.type === 'NATIVE_IPC_CALL' && !discoveredIpc.has(inter.commandName)) {
        discoveredIpc.set(inter.commandName, {
          name: inter.commandName,
          args: Object.keys(inter.argsPayload).map((k) => ({ name: k, type: 'string' })),
          returnType: 'string',
        });
      }
    }

    // Bindings on text
    let boundText: UIRNode['content'] extends undefined ? never : NonNullable<UIRNode['content']>['text'] =
      node.content?.text;
    if (node.dataBindings?.text) {
      boundText = {
        $bind: node.dataBindings.text.propOrState,
        fallback: node.content?.text ?? String(node.dataBindings.text.fallback ?? ''),
      };
    }

    const ownClientInteractive =
      isInteractiveControlKind(kind) &&
      (interactions.some((i) => i.type === 'STATE_MUTATION' || i.type === 'NATIVE_IPC_CALL') ||
        kind === 'Switch' ||
        kind === 'Slider');

    const anyChildClientInteractive = children.some((c) => Boolean(c.clientInteractive));

    return {
      id: `uir_${node.id}`,
      canvasNodeId: node.id,
      name: node.name,
      kind,
      semanticTag: node.semanticTag,
      ...(resolvedClassNames.length > 0 ? { classNames: resolvedClassNames } : {}),
      dragRegion,
      clientInteractive: ownClientInteractive || anyChildClientInteractive,
      layout: {
        mode: layoutMode,
        direction: effLayout.direction,
        positioning: isChildFloating
          ? effLayout.positioning === 'fixed'
            ? 'fixed'
            : 'absolute'
          : effLayout.positioning,
        pins: effLayout.pins,
        zIndex: effStyle.zIndex,
        frame: {
          x: effLayout.frame.x,
          y: effLayout.frame.y,
          width: effLayout.frame.width,
          height: effLayout.frame.height,
          rotation: effLayout.frame.rotation,
        },
        width: {
          mode: mapSizeMode(effLayout.width.mode),
          value: resolveAxisBound(effLayout.width.value, tokenDict.flatMap) ?? effLayout.frame.width,
          unit: effLayout.width.unit,
          min: resolveAxisBound(effLayout.width.min, tokenDict.flatMap),
          minUnit: effLayout.width.minUnit,
          max: resolveAxisBound(effLayout.width.max, tokenDict.flatMap),
          maxUnit: effLayout.width.maxUnit,
        },
        height: {
          mode: mapSizeMode(effLayout.height.mode),
          value: resolveAxisBound(effLayout.height.value, tokenDict.flatMap) ?? effLayout.frame.height,
          unit: effLayout.height.unit,
          min: resolveAxisBound(effLayout.height.min, tokenDict.flatMap),
          minUnit: effLayout.height.minUnit,
          max: resolveAxisBound(effLayout.height.max, tokenDict.flatMap),
          maxUnit: effLayout.height.maxUnit,
        },
        aspectRatio: effLayout.aspectRatio,
        boxSizing: effLayout.boxSizing,
        gap: effLayout.gap,
        rowGap: effLayout.rowGap,
        columnGap: effLayout.columnGap,
        padding,
        margin: effLayout.margin,
        alignItems: effLayout.align,
        justifyContent: effLayout.justify,
        alignContent: effLayout.alignContent,
        justifyItems: effLayout.justifyItems,
        placeItems: effLayout.placeItems,
        flexChild: effLayout.flexChild,
        gridTracks:
          layoutMode === 'GRID'
            ? {
                columns: formatGridTracks(effLayout.gridCols),
                rows: formatGridTracks(effLayout.gridRows),
              }
            : undefined,
        gridChild: effLayout.gridChild,
        wrap: effLayout.wrap,
        overflow: effLayout.overflow,
        overflowX: effLayout.overflowX,
        overflowY: effLayout.overflowY,
        objectFit: effLayout.objectFit,
      },
      style: {
        base: effStyle,
        typography: effTypo,
        states: mergedStates,
        responsive: node.responsiveOverrides,
      },
      content: node.content
        ? {
            text: boundText,
            placeholder: node.content.placeholder,
            value: node.content.value,
            options: node.content.options,
            checked: node.content.checked,
            controlType: node.content.controlType,
            assetId: node.content.assetId,
            imageUrl: node.content.imageUrl,
            iconName: node.content.iconName,
            svgPath: node.content.svgPath,
            tableColumns: node.content.tableColumns,
            tableRows: node.content.tableRows,
            threeSceneId: node.content.threeSceneId,
            blueprintId: node.content.blueprintId,
          }
        : boundText !== undefined
          ? { text: boundText }
          : undefined,
      a11y: {
        role: node.platform?.a11y?.role,
        ariaLabel: node.platform?.a11y?.ariaLabel,
        htmlTag: node.semanticTag,
        tabIndex: node.platform?.a11y?.tabIndex,
      },
      mvvm: node.platform?.mvvm,
      controlFlow: node.controlFlow
        ? {
            conditional: node.controlFlow.conditionalExpr,
            repeat: node.controlFlow.repeat,
          }
        : undefined,
      interactions,
      children,
    };
  };

  const primaryRootId = activeSheet.rootIds[0];
  const primaryRawRoot = primaryRootId ? activeSheet.nodes[primaryRootId] : undefined;
  const convertedRoot: UIRNode =
    (primaryRootId ? convertNode(primaryRootId, false) : null) ?? {
      id: 'uir_empty_root',
      canvasNodeId: primaryRootId ?? 'empty_root',
      name: activeSheet.name || 'EmptyScreen',
      kind: 'Box',
      semanticTag: 'main',
      layout: {
        mode: 'COLUMN',
        frame: { x: 0, y: 0, width: 1280, height: 800 },
        width: { mode: 'FIXED', value: 1280 },
        height: { mode: 'FIXED', value: 800 },
        gap: 16,
        padding: { top: 24, right: 24, bottom: 24, left: 24 },
      },
      style: { base: {} },
      interactions: [],
      children: [],
    };

  const sheetCssMeta = {
    reusableClasses: activeSheet.reusableClasses,
    keyframesCss: activeSheet.keyframesCss,
  };
  registerSheetCssMetaForUIR(tokenDict, sheetCssMeta);
  registerSheetCssMetaForUIR(convertedRoot, sheetCssMeta);

  const compName = sanitizePascalComponentName(
    options?.componentNameOverride || activeSheet.name || primaryRawRoot?.name || 'AppScreen',
  );

  const dw = primaryRawRoot?.platform?.desktopWindow;
  const windowChrome: UIRDesktopWindowSpec = {
    title: activeSheet.name || compName,
    width: primaryRawRoot?.layout.frame.width ?? 1120,
    height: primaryRawRoot?.layout.frame.height ?? 820,
    minWidth: dw?.minWidth ?? 640,
    minHeight: dw?.minHeight ?? 480,
    frameless: Boolean(dw?.frameless),
    transparent: Boolean(dw?.transparent),
    backdrop: dw?.backdrop ?? 'none',
    titlebarStyle: dw?.titlebarStyle ?? 'native',
    resizable: dw?.resizable ?? true,
    alwaysOnTop: dw?.alwaysOnTop ?? false,
  };

  const entryComp: UIRComponentDecl = {
    id: `comp_${activeSheet.sheetId}`,
    name: compName,
    sourceCanvasNodeId: convertedRoot.canvasNodeId,
    props: activeSheet.propsSchema ?? [],
    stateVars: activeSheet.stateSchema ?? [],
    ipcCommands: Array.from(discoveredIpc.values()),
    root: convertedRoot,
  };

  return {
    id: `mod_${activeSheet.sheetId}`,
    name: compName,
    projectId: activeSheet.projectId,
    sheetId: activeSheet.sheetId,
    tokens: tokenDict,
    windowChrome,
    customCss: activeSheet.customCss,
    keyframesCss: activeSheet.keyframesCss,
    reusableClasses: activeSheet.reusableClasses,
    components: [entryComp],
    entryComponentId: entryComp.id,
  };
}

export function findUIRNodeByCanvasId(root: UIRNode, canvasNodeId: NodeId): UIRNode | null {
  if (root.canvasNodeId === canvasNodeId) return root;
  for (const child of root.children) {
    const found = findUIRNodeByCanvasId(child, canvasNodeId);
    if (found) return found;
  }
  return null;
}

export { isTokenRef };
