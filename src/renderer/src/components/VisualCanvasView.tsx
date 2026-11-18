import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignJustify,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowUpToLine,
  Box,
  Circle,
  Columns3,
  Copy,
  Frame,
  Grid3x3,
  Hand,
  LayoutGrid,
  Maximize2,
  Minus,
  MousePointer2,
  Move,
  Pin,
  PinOff,
  Plus,
  Ruler,
  Sparkles,
  Square,
  Trash2,
  Type,
  Wand2,
} from 'lucide-react';
import {
  compileNodeToReactStyle,
  compileSheetKeyframesCss,
  sanitizeCssClassSlug,
} from '@shared/css-sync-engine';
import { DEFAULT_BREAKPOINTS, buildTokenLookupMap } from '@shared/default-tokens';
import { OFFLINE_ICON_CATALOG } from '@shared/icon-catalog';
import {
  resolveTokenOrValue,
  type NodeId,
  type UINode,
} from '@shared/ui-ir';
import { generateNodeId, type UIPatchOp } from '@shared/ui-patch';
import { PALETTE_ELEMENT_PRESETS } from '@renderer/utils/palette-catalog';
import { useStudioStore, type CanvasDrawingTool } from '@renderer/state/studio-store';
import { CanvasContextMenu } from './CanvasContextMenu';
import { ThreeEmbeddedPreview } from './ThreeEmbeddedPreview';

type ResizeDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const RESIZE_HANDLES: ResizeDir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const RULER_SIZE = 20;

interface DrawingToolDef {
  id: CanvasDrawingTool;
  label: string;
  shortcut?: string;
  title: string;
}

const DRAWING_TOOLS: DrawingToolDef[] = [
  { id: 'select', label: '↖ Seleziona (V)', shortcut: 'v', title: 'Strumento Selezione e Spostamento Libero (V)' },
  { id: 'pan', label: '✋ Pan (H)', shortcut: 'h', title: 'Trascina la tela infinita (H o tasto centrale)' },
  { id: 'frame', label: '▢ Frame (F)', shortcut: 'f', title: 'Disegna un Contenitore / Frame sul Canvas (F)' },
  { id: 'rect', label: '▭ Rettangolo (R)', shortcut: 'r', title: 'Disegna un Rettangolo alle coordinate trascinate (R)' },
  { id: 'circle', label: '◯ Cerchio (O)', shortcut: 'o', title: 'Disegna un Cerchio / Indicatore (O)' },
  { id: 'text', label: 'T Testo (T)', shortcut: 't', title: 'Disegna un blocco di Testo tipografico (T)' },
  { id: 'button', label: '▣ Bottone (B)', shortcut: 'b', title: 'Disegna un Bottone interattivo (B)' },
  { id: 'input', label: '⌨ Input', title: 'Disegna un Campo Input di testo' },
  { id: 'three_viewport', label: '🧊 Vista 3D', title: 'Disegna un Viewport WebGL Three.js 3D' },
];

export const VisualCanvasView: React.FC<{ sheetId: string }> = ({ sheetId }) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const subtoolbarRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const project = useStudioStore((s) => s.project);
  const sheet = useStudioStore((s) => s.sheetDocuments[sheetId]);
  const tokens = useStudioStore((s) => s.tokens);
  const activeBreakpointId = useStudioStore((s) => s.activeBreakpointId);
  const selectedNodeIds = useStudioStore((s) => s.selectedNodeIds);
  const hoveredNodeId = useStudioStore((s) => s.hoveredNodeId);
  const codeSelectPulseNodeId = useStudioStore((s) => s.codeSelectPulseNodeId);
  const snapToGrid8px = useStudioStore((s) => s.snapToGrid8px);
  const canvasPlacementMode = useStudioStore((s) => s.canvasPlacementMode);
  const activeDrawingTool = useStudioStore((s) => s.activeDrawingTool);
  const showRulers = useStudioStore((s) => s.showRulers);
  const cursorCanvasPos = useStudioStore((s) => s.cursorCanvasPos);
  const activeThreeSceneId = useStudioStore((s) => s.activeThreeSceneId);
  const simulatedCanvasState = useStudioStore((s) => s.simulatedCanvasState);
  const hoveredBoxModelOverlay = useStudioStore((s) => s.hoveredBoxModelOverlay);
  const viewport = useStudioStore((s) => s.viewports[sheetId]) ?? { x: 24, y: 20, zoom: 0.78 };

  const selectNode = useStudioStore((s) => s.selectNode);
  const setHoveredNode = useStudioStore((s) => s.setHoveredNode);
  const setViewport = useStudioStore((s) => s.setViewport);
  const toggleSnapToGrid8px = useStudioStore((s) => s.toggleSnapToGrid8px);
  const setCanvasPlacementMode = useStudioStore((s) => s.setCanvasPlacementMode);
  const setActiveDrawingTool = useStudioStore((s) => s.setActiveDrawingTool);
  const setShowRulers = useStudioStore((s) => s.setShowRulers);
  const setCursorCanvasPos = useStudioStore((s) => s.setCursorCanvasPos);
  const setSimulatedCanvasState = useStudioStore((s) => s.setSimulatedCanvasState);
  const commitOps = useStudioStore((s) => s.commitOps);
  const insertPaletteElement = useStudioStore((s) => s.insertPaletteElement);
  const duplicateSelectedNode = useStudioStore((s) => s.duplicateSelectedNode);
  const deleteSelectedNode = useStudioStore((s) => s.deleteSelectedNode);
  const solveAutoLayoutOnActive = useStudioStore((s) => s.solveAutoLayoutOnActive);
  const askAiAboutSelection = useStudioStore((s) => s.askAiAboutSelection);
  const alignSelectedNodes = useStudioStore((s) => s.alignSelectedNodes);
  const adjustSelectedZIndex = useStudioStore((s) => s.adjustSelectedZIndex);
  const toggleNodeFreeformDetach = useStudioStore((s) => s.toggleNodeFreeformDetach);
  const ensureActiveThreeScene = useStudioStore((s) => s.ensureActiveThreeScene);
  const openSplitMode = useStudioStore((s) => s.openSplitMode);

  const [isPanning, setIsPanning] = useState(false);
  const [inlineEditNodeId, setInlineEditNodeId] = useState<NodeId | null>(null);
  const [inlineEditText, setInlineEditText] = useState('');
  const [floatingTopPx, setFloatingTopPx] = useState<number>(64);
  const [isAltPressed, setIsAltPressed] = useState<boolean>(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    canvasX: number;
    canvasY: number;
    targetNodeId: NodeId | null;
  } | null>(null);
  const [equalGapPills, setEqualGapPills] = useState<
    Array<{ x: number; y: number; label: string }>
  >([]);

  // Live transient drag/resize frame override before pointerup commit
  const [transientFrame, setTransientFrame] = useState<{
    nodeId: NodeId;
    x: number;
    y: number;
    width: number;
    height: number;
    dx: number;
    dy: number;
    wasFlow: boolean;
    mode: 'move' | 'resize';
  } | null>(null);

  // Live ghost drop preview during HTML5 palette drag-over
  const [dropPreview, setDropPreview] = useState<{
    targetId: NodeId | null;
    targetName: string;
    x: number;
    y: number;
    planeX: number;
    planeY: number;
    width: number;
    height: number;
  } | null>(null);

  // Live marquee preview when drawing a new shape/control directly on Canvas
  const [drawingDraft, setDrawingDraft] = useState<{
    tool: CanvasDrawingTool;
    parentId: NodeId | null;
    x: number;
    y: number;
    planeX: number;
    planeY: number;
    width: number;
    height: number;
  } | null>(null);

  const [draggedPresetId, setDraggedPresetId] = useState<string | null>(null);
  const [snapGuides, setSnapGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });

  // Listen globally for dragstart/dragend so we know the exact preset dimensions during dragover
  useEffect(() => {
    const onGlobalDragStart = (ev: DragEvent) => {
      const pid = ev.dataTransfer?.getData('application/x-studio-palette-id');
      if (pid) setDraggedPresetId(pid);
    };
    const onGlobalDragEnd = () => {
      setDraggedPresetId(null);
      setDropPreview(null);
    };
    window.addEventListener('dragstart', onGlobalDragStart);
    window.addEventListener('dragend', onGlobalDragEnd);
    return () => {
      window.removeEventListener('dragstart', onGlobalDragStart);
      window.removeEventListener('dragend', onGlobalDragEnd);
    };
  }, []);

  // Single-key Figma tool shortcuts (V, H, F, R, O, T, B, Escape) + Alt measurement key tracking
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Alt') setIsAltPressed(true);
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.tagName === 'SELECT' ||
          active.isContentEditable)
      ) {
        return;
      }
      const key = ev.key.toLowerCase();
      if (key === 'escape') {
        setActiveDrawingTool('select');
        setDrawingDraft(null);
        setContextMenu(null);
        return;
      }
      const match = DRAWING_TOOLS.find((t) => t.shortcut === key);
      if (match) {
        ev.preventDefault();
        setActiveDrawingTool(match.id);
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === 'Alt') setIsAltPressed(false);
    };
    const onBlur = () => setIsAltPressed(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [setActiveDrawingTool]);

  const tokenMap = useMemo(
    () => buildTokenLookupMap(tokens, project?.activeThemeId ?? null),
    [tokens, project?.activeThemeId],
  );

  const injectedSheetCss = useMemo(() => sheet ? compileSheetKeyframesCss(sheet) : '', [sheet]);
  const canvasTokenStyles = useMemo(() => Object.fromEntries(Object.entries(tokenMap).map(([path, value]) => [
    `--${path.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`,
    typeof value === 'number' && (path.startsWith('space.') || path.startsWith('radius.')) ? `${value}px` : String(value),
  ])), [tokenMap]);

  const activeBp = useMemo(() => {
    const list = project?.breakpoints?.length ? project.breakpoints : DEFAULT_BREAKPOINTS;
    return list.find((b) => b.id === activeBreakpointId) ?? list[0];
  }, [project?.breakpoints, activeBreakpointId]);

  const selectedNode = sheet && selectedNodeIds[0] ? sheet.nodes[selectedNodeIds[0]] : undefined;
  const rootArtboard = sheet && sheet.rootIds[0] ? sheet.nodes[sheet.rootIds[0]] : undefined;

  // Compute ruler ticks unconditionally above any early return (Rules of Hooks)
  const artOriginX = rootArtboard?.layout.frame.x ?? 0;
  const artOriginY = rootArtboard?.layout.frame.y ?? 0;
  const rulerStep = viewport.zoom < 0.55 ? 200 : viewport.zoom > 1.6 ? 50 : 100;
  const rulerTicks = useMemo(() => {
    const hTicks: Array<{ val: number; px: number }> = [];
    const vTicks: Array<{ val: number; px: number }> = [];
    for (let v = -400; v <= 2600; v += rulerStep) {
      hTicks.push({ val: v, px: Math.round(viewport.x + (artOriginX + v) * viewport.zoom) });
    }
    for (let v = -200; v <= 2000; v += rulerStep) {
      vTicks.push({ val: v, px: Math.round(viewport.y + (artOriginY + v) * viewport.zoom) });
    }
    return { hTicks, vTicks };
  }, [viewport.x, viewport.y, viewport.zoom, artOriginX, artOriginY, rulerStep]);

  // Dynamically clamp FloatingContextToolbar so `top >= 54px` AND never overlaps subtoolbar or top ruler
  useLayoutEffect(() => {
    if (!selectedNode || !wrapperRef.current) return;
    const wrapperRect = wrapperRef.current.getBoundingClientRect();
    const subHeight = subtoolbarRef.current?.getBoundingClientRect().height ?? 42;
    const rulerExtra = showRulers ? RULER_SIZE : 0;
    const minSafeTop = Math.max(54, Math.ceil(subHeight + rulerExtra + 10));
    const toolbarH = 38;
    const maxSafeTop = Math.max(minSafeTop, Math.floor(wrapperRect.height - toolbarH - 12));

    const nodeEl = wrapperRef.current.querySelector(
      `[data-canvas-node-id="${selectedNode.id}"]`,
    ) as HTMLElement | null;

    if (!nodeEl) {
      setFloatingTopPx(minSafeTop);
      return;
    }

    const nodeRect = nodeEl.getBoundingClientRect();
    const relTop = nodeRect.top - wrapperRect.top;
    const relBottom = nodeRect.bottom - wrapperRect.top;

    const desiredAbove = Math.round(relTop - toolbarH - 10);
    if (desiredAbove >= minSafeTop && desiredAbove <= maxSafeTop) {
      setFloatingTopPx(desiredAbove);
      return;
    }

    const desiredBelow = Math.round(relBottom + 10);
    if (desiredBelow >= minSafeTop && desiredBelow <= maxSafeTop) {
      setFloatingTopPx(desiredBelow);
      return;
    }

    setFloatingTopPx(maxSafeTop);
  }, [
    selectedNode?.id,
    selectedNodeIds.length,
    viewport.x,
    viewport.y,
    viewport.zoom,
    activeBreakpointId,
    transientFrame,
    showRulers,
    sheet,
  ]);

  if (!sheet) {
    return (
      <div style={{ padding: 24, color: 'var(--text-secondary)' }}>
        Caricamento foglio Canvas...
      </div>
    );
  }

  const snapVal = (v: number): number => (snapToGrid8px ? Math.round(v / 8) * 8 : Math.round(v));

  /**
   * Measure a node's exact visual frame `(x, y, width, height)` inside its parent's padding box
   * so detaching a `flow` child from Flex/Grid into `positioning: 'absolute'` has 0px shift.
   */
  const measureNodeRelativeFrame = (node: UINode, nodeEl: HTMLElement | null) => {
    const fallback = {
      x: node.layout.frame.x,
      y: node.layout.frame.y,
      width: node.kind === 'artboard' && activeBp ? activeBp.width : node.layout.frame.width || 180,
      height: node.layout.frame.height || 44,
    };
    if (!nodeEl || node.kind === 'artboard') return fallback;

    const nodeRect = nodeEl.getBoundingClientRect();
    const parentEl =
      node.parentId && wrapperRef.current
        ? (wrapperRef.current.querySelector(`[data-canvas-node-id="${node.parentId}"]`) as HTMLElement | null)
        : null;

    if (parentEl && nodeRect.width > 0 && nodeRect.height > 0) {
      const parentRect = parentEl.getBoundingClientRect();
      const borderLeft = parentEl.clientLeft || 0;
      const borderTop = parentEl.clientTop || 0;
      return {
        x: Math.round((nodeRect.left - parentRect.left) / viewport.zoom - borderLeft),
        y: Math.round((nodeRect.top - parentRect.top) / viewport.zoom - borderTop),
        width: Math.max(24, Math.round(nodeRect.width / viewport.zoom)),
        height: Math.max(20, Math.round(nodeRect.height / viewport.zoom)),
      };
    }

    if (nodeEl.offsetWidth > 0 || nodeEl.offsetHeight > 0) {
      return {
        x: Math.round(nodeEl.offsetLeft),
        y: Math.round(nodeEl.offsetTop),
        width: Math.max(24, Math.round(nodeEl.offsetWidth)),
        height: Math.max(20, Math.round(nodeEl.offsetHeight)),
      };
    }

    return fallback;
  };

  /**
   * Resolve target container (Artboard or inner Container) and exact world/local `(dropX, dropY)`
   * for both Palette Drag-and-Drop and Direct Canvas Drawing tools.
   */
  const resolveContainerAndCoords = (clientX: number, clientY: number, rawTarget: EventTarget | null) => {
    const stageEl = stageRef.current;
    const stageRect = stageEl?.getBoundingClientRect();
    const planeX = stageRect ? (clientX - stageRect.left - viewport.x) / viewport.zoom : 64;
    const planeY = stageRect ? (clientY - stageRect.top - viewport.y) / viewport.zoom : 64;

    let candidateId: NodeId | null = null;
    if (rawTarget instanceof HTMLElement) {
      const closestWrapper = rawTarget.closest('[data-canvas-node-id]') as HTMLElement | null;
      let curId = closestWrapper?.getAttribute('data-canvas-node-id') ?? null;
      while (curId && sheet.nodes[curId]) {
        const cand = sheet.nodes[curId];
        if (
          !cand.locked &&
          (cand.kind === 'artboard' || cand.kind === 'container' || cand.kind === 'collection')
        ) {
          candidateId = cand.id;
          break;
        }
        curId = cand.parentId;
      }
    }

    const targetId = candidateId ?? sheet.rootIds[0] ?? null;
    const targetNode = targetId ? sheet.nodes[targetId] : undefined;
    const targetEl =
      targetId && wrapperRef.current
        ? (wrapperRef.current.querySelector(`[data-canvas-node-id="${targetId}"]`) as HTMLElement | null)
        : null;

    if (targetEl) {
      const rect = targetEl.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const borderLeft = targetEl.clientLeft || 0;
        const borderTop = targetEl.clientTop || 0;
        const localX = snapVal((clientX - rect.left) / viewport.zoom - borderLeft);
        const localY = snapVal((clientY - rect.top) / viewport.zoom - borderTop);
        const snappedPlaneX = stageRect
          ? (rect.left - stageRect.left - viewport.x) / viewport.zoom + borderLeft + localX
          : planeX;
        const snappedPlaneY = stageRect
          ? (rect.top - stageRect.top - viewport.y) / viewport.zoom + borderTop + localY
          : planeY;
        return {
          targetId,
          targetName: targetNode?.name ?? 'Artboard',
          x: localX,
          y: localY,
          planeX: Math.round(snappedPlaneX),
          planeY: Math.round(snappedPlaneY),
        };
      }
    }

    // Fallback when DOM rects are 0 (e.g., headless synthetic tests)
    const artX = rootArtboard?.layout.frame.x ?? 0;
    const artY = rootArtboard?.layout.frame.y ?? 0;
    const relX = snapVal(planeX - artX);
    const relY = snapVal(planeY - artY);
    return {
      targetId,
      targetName: targetNode?.name ?? 'Artboard',
      x: relX,
      y: relY,
      planeX: Math.round(artX + relX),
      planeY: Math.round(artY + relY),
    };
  };

  const commitDrawnElement = async (
    tool: CanvasDrawingTool,
    parentId: NodeId | null,
    x: number,
    y: number,
    draggedW: number,
    draggedH: number,
    wasClickOnly: boolean,
  ) => {
    const defaultsByTool: Record<string, { w: number; h: number }> = {
      frame: { w: 320, h: 200 },
      rect: { w: 180, h: 104 },
      circle: { w: 96, h: 96 },
      text: { w: 220, h: 40 },
      button: { w: 168, h: 42 },
      input: { w: 260, h: 42 },
      three_viewport: { w: 440, h: 280 },
    };
    const def = defaultsByTool[tool] ?? { w: 180, h: 80 };
    const width = wasClickOnly ? def.w : Math.max(24, snapVal(draggedW));
    const height = wasClickOnly ? def.h : Math.max(24, snapVal(draggedH));
    const newId = generateNodeId(tool === 'three_viewport' ? 'three_vp' : 'draw');

    let nodeSpec: Partial<UINode> & Pick<UINode, 'kind' | 'name'>;

    if (tool === 'frame') {
      nodeSpec = {
        id: newId,
        kind: 'container',
        name: 'FrameContainer',
        semanticTag: 'div',
        layout: {
          mode: canvasPlacementMode === 'freeform' ? 'freeform' : 'flex',
          positioning: 'absolute',
          direction: 'column',
          gap: 12,
          frame: { x, y, width, height },
          width: { mode: 'fixed', value: width },
          height: { mode: 'fixed', value: height },
          padding: { top: 16, right: 16, bottom: 16, left: 16 },
        },
        style: {
          fills: [{ type: 'solid', color: '#162033cc' }],
          border: { width: 1, style: 'solid', color: '#334155' },
          radius: 12,
        },
      };
    } else if (tool === 'rect') {
      nodeSpec = {
        id: newId,
        kind: 'vector',
        name: 'RectangleShape',
        semanticTag: 'div',
        layout: {
          mode: 'freeform',
          positioning: 'absolute',
          frame: { x, y, width, height },
          width: { mode: 'fixed', value: width },
          height: { mode: 'fixed', value: height },
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        style: {
          fills: [{ type: 'solid', color: '#3b82f633' }],
          border: { width: 2, style: 'solid', color: '#3b82f6' },
          radius: 10,
        },
      };
    } else if (tool === 'circle') {
      nodeSpec = {
        id: newId,
        kind: 'vector',
        name: 'CircleShape',
        semanticTag: 'div',
        layout: {
          mode: 'freeform',
          positioning: 'absolute',
          frame: { x, y, width, height },
          width: { mode: 'fixed', value: width },
          height: { mode: 'fixed', value: height },
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        style: {
          fills: [{ type: 'solid', color: '#8b5cf644' }],
          border: { width: 2, style: 'solid', color: '#8b5cf6' },
          radius: 9999,
        },
      };
    } else if (tool === 'text') {
      nodeSpec = {
        id: newId,
        kind: 'text',
        name: 'TextLabel',
        semanticTag: 'p',
        layout: {
          mode: 'freeform',
          positioning: 'absolute',
          frame: { x, y, width, height },
          width: { mode: 'fixed', value: width },
          height: { mode: 'hug', value: height },
          padding: { top: 4, right: 6, bottom: 4, left: 6 },
        },
        typography: {
          fontFamily: { $token: 'font.sans' },
          fontSize: 18,
          fontWeight: 600,
          color: { $token: 'color.text.primary' },
        },
        content: { text: 'Testo Personalizzato' },
      };
    } else if (tool === 'button') {
      nodeSpec = {
        id: newId,
        kind: 'control',
        name: 'ActionButton',
        semanticTag: 'button',
        layout: {
          mode: 'freeform',
          positioning: 'absolute',
          frame: { x, y, width, height },
          width: { mode: 'fixed', value: width },
          height: { mode: 'fixed', value: height },
          padding: { top: 8, right: 14, bottom: 8, left: 14 },
        },
        style: {
          fills: [{ type: 'solid', color: '#2563eb' }],
          radius: 8,
        },
        typography: {
          fontFamily: { $token: 'font.sans' },
          fontSize: 14,
          fontWeight: 600,
          textAlign: 'center',
          color: '#ffffff',
        },
        content: { controlType: 'button', text: 'Nuovo Bottone' },
      };
    } else if (tool === 'input') {
      nodeSpec = {
        id: newId,
        kind: 'control',
        name: 'TextInput',
        semanticTag: 'input',
        layout: {
          mode: 'freeform',
          positioning: 'absolute',
          frame: { x, y, width, height },
          width: { mode: 'fixed', value: width },
          height: { mode: 'fixed', value: height },
          padding: { top: 8, right: 12, bottom: 8, left: 12 },
        },
        style: {
          fills: [{ type: 'solid', color: '#0b101b' }],
          border: { width: 1, style: 'solid', color: '#475569' },
          radius: 8,
        },
        content: { controlType: 'text-input', placeholder: 'Digita qui...' },
      };
    } else {
      const ensured = await ensureActiveThreeScene();
      nodeSpec = {
        id: newId,
        kind: 'control',
        name: 'Three3DViewport',
        semanticTag: 'div',
        layout: {
          mode: 'freeform',
          positioning: 'absolute',
          frame: { x, y, width, height },
          width: { mode: 'fixed', value: width },
          height: { mode: 'fixed', value: height },
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        style: {
          fills: [{ type: 'solid', color: '#0b1120' }],
          border: { width: 1, style: 'solid', color: '#3b82f6' },
          radius: 14,
          zIndex: 4,
        },
        content: {
          controlType: 'three-viewport',
          text: `Scena 3D: ${ensured.scene.name}`,
          threeSceneId: activeThreeSceneId ?? ensured.scene.id,
        },
      };
    }

    await commitOps([{ op: 'insert_node', parentId, node: nodeSpec }], `Disegna ${nodeSpec.name}`);
    selectNode(newId, false);
    setActiveDrawingTool('select');
  };

  const startPanInteraction = (startClientX: number, startClientY: number) => {
    const origX = viewport.x;
    const origY = viewport.y;
    setIsPanning(true);

    const onMove = (ev: PointerEvent) => {
      setViewport(sheetId, {
        x: origX + (ev.clientX - startClientX),
        y: origY + (ev.clientY - startClientY),
        zoom: viewport.zoom,
      });
    };
    const onUp = (ev: PointerEvent) => {
      setIsPanning(false);
      setViewport(
        sheetId,
        {
          x: origX + (ev.clientX - startClientX),
          y: origY + (ev.clientY - startClientY),
          zoom: viewport.zoom,
        },
        true,
      );
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startDrawingInteraction = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const tool = activeDrawingTool;
    const startInfo = resolveContainerAndCoords(e.clientX, e.clientY, e.target);
    const startClientX = e.clientX;
    const startClientY = e.clientY;

    let latest = {
      tool,
      parentId: startInfo.targetId,
      x: startInfo.x,
      y: startInfo.y,
      planeX: startInfo.planeX,
      planeY: startInfo.planeY,
      width: 16,
      height: 16,
    };
    let draggedEnough = false;
    setDrawingDraft(latest);

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startClientX) / viewport.zoom;
      const dy = (ev.clientY - startClientY) / viewport.zoom;
      if (Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY) >= 8) {
        draggedEnough = true;
      }
      const rx = dx >= 0 ? startInfo.x : snapVal(startInfo.x + dx);
      const ry = dy >= 0 ? startInfo.y : snapVal(startInfo.y + dy);
      const px = dx >= 0 ? startInfo.planeX : Math.round(startInfo.planeX + dx);
      const py = dy >= 0 ? startInfo.planeY : Math.round(startInfo.planeY + dy);
      const rw = Math.max(16, snapVal(Math.abs(dx)));
      const rh = Math.max(16, snapVal(Math.abs(dy)));

      latest = {
        tool,
        parentId: startInfo.targetId,
        x: rx,
        y: ry,
        planeX: px,
        planeY: py,
        width: rw,
        height: rh,
      };
      setDrawingDraft(latest);
      setCursorCanvasPos({ x: rx, y: ry });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDrawingDraft(null);
      void commitDrawnElement(
        tool,
        latest.parentId,
        latest.x,
        latest.y,
        latest.width,
        latest.height,
        !draggedEnough,
      );
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Pan stage via middle mouse, Pan tool, or background drag; or draw with active drawing tool
  const handleStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 1 || activeDrawingTool === 'pan') {
      e.preventDefault();
      startPanInteraction(e.clientX, e.clientY);
      return;
    }

    if (activeDrawingTool !== 'select' && e.button === 0) {
      startDrawingInteraction(e);
      return;
    }

    if (e.target !== stageRef.current) return;
    if (e.button === 0 && !e.shiftKey) selectNode(null);
    startPanInteraction(e.clientX, e.clientY);
  };

  const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const stageEl = stageRef.current;
    if (!stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    const worldX = (e.clientX - rect.left - viewport.x) / viewport.zoom;
    const worldY = (e.clientY - rect.top - viewport.y) / viewport.zoom;
    const artX = rootArtboard?.layout.frame.x ?? 0;
    const artY = rootArtboard?.layout.frame.y ?? 0;
    setCursorCanvasPos({
      x: Math.round(worldX - artX),
      y: Math.round(worldY - artY),
    });
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 0.92;
      setViewport(sheetId, { ...viewport, zoom: viewport.zoom * factor }, true);
    } else {
      setViewport(sheetId, {
        x: viewport.x - e.deltaX * 0.6,
        y: viewport.y - e.deltaY * 0.6,
        zoom: viewport.zoom,
      });
    }
  };

  /**
   * Universal 60fps Drag-to-Move for ANY non-locked element on the Canvas!
   * If currently `positioning: 'flow'` inside a `flex`/`grid` parent, measures its exact
   * visual `(startX, startY, width, height)` relative to the parent's content box, renders
   * a smooth `translate3d` preview past the 3px threshold, and commits `positioning: 'absolute'`
   * with the exact new `(x, y, width, height)` on `pointerup`.
   */
  const startNodeMoveDrag = (e: React.PointerEvent, node: UINode, parentMode: string) => {
    if (e.button === 1 || activeDrawingTool === 'pan') {
      e.preventDefault();
      e.stopPropagation();
      startPanInteraction(e.clientX, e.clientY);
      return;
    }

    if (activeDrawingTool !== 'select' && e.button === 0) {
      startDrawingInteraction(e);
      return;
    }

    if (e.button !== 0 || inlineEditNodeId === node.id) return;
    e.stopPropagation();

    if (e.shiftKey) {
      selectNode(node.id, true);
      return;
    }

    if (!selectedNodeIds.includes(node.id)) {
      selectNode(node.id, false);
    }

    if (node.locked) return;

    const nodeEl = e.currentTarget as HTMLElement;
    const isAlreadyAbsolute =
      node.kind === 'artboard' ||
      parentMode === 'freeform' ||
      node.layout.positioning === 'absolute';

    const measured = measureNodeRelativeFrame(node, nodeEl);
    const origFrame = isAlreadyAbsolute
      ? {
          x: node.layout.frame.x,
          y: node.layout.frame.y,
          width: node.layout.frame.width || measured.width,
          height: node.layout.frame.height || measured.height,
        }
      : measured;

    const siblingFrames = (node.parentId ? sheet.nodes[node.parentId]?.childIds ?? [] : sheet.rootIds)
      .filter((id) => id !== node.id)
      .map((id) => {
        const sib = sheet.nodes[id];
        if (!sib) return null;
        const sibEl = wrapperRef.current?.querySelector(`[data-canvas-node-id="${id}"]`) as HTMLElement | null;
        if (sib.layout.positioning === 'absolute' || parentMode === 'freeform' || sib.kind === 'artboard') {
          return sib.layout.frame;
        }
        return measureNodeRelativeFrame(sib, sibEl);
      })
      .filter((f): f is { x: number; y: number; width: number; height: number } => Boolean(f));

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const parentFrameOffset =
      node.kind === 'artboard'
        ? { x: 0, y: 0 }
        : { x: rootArtboard?.layout.frame.x ?? 0, y: rootArtboard?.layout.frame.y ?? 0 };

    let moved = false;
    let latest = { ...origFrame };

    const onMove = (ev: PointerEvent) => {
      const screenDist = Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY);
      if (screenDist < 3 && !moved) return;
      moved = true;

      const dx = (ev.clientX - startClientX) / viewport.zoom;
      const dy = (ev.clientY - startClientY) / viewport.zoom;

      let nextX = snapVal(origFrame.x + dx);
      let nextY = snapVal(origFrame.y + dy);
      const vGuides: number[] = [];
      const hGuides: number[] = [];
      const gapPills: Array<{ x: number; y: number; label: string }> = [];

      // Magnetic 6px snap to siblings on all 6 axes (left, centerX, right, top, centerY, bottom)
      for (const sf of siblingFrames) {
        if (Math.abs(nextX - sf.x) <= 6) {
          nextX = sf.x;
          vGuides.push(parentFrameOffset.x + sf.x);
        } else if (Math.abs(nextX + origFrame.width - (sf.x + sf.width)) <= 6) {
          nextX = sf.x + sf.width - origFrame.width;
          vGuides.push(parentFrameOffset.x + sf.x + sf.width);
        } else if (Math.abs(nextX + origFrame.width / 2 - (sf.x + sf.width / 2)) <= 6) {
          nextX = Math.round(sf.x + sf.width / 2 - origFrame.width / 2);
          vGuides.push(parentFrameOffset.x + sf.x + sf.width / 2);
        }

        if (Math.abs(nextY - sf.y) <= 6) {
          nextY = sf.y;
          hGuides.push(parentFrameOffset.y + sf.y);
        } else if (Math.abs(nextY + origFrame.height - (sf.y + sf.height)) <= 6) {
          nextY = sf.y + sf.height - origFrame.height;
          hGuides.push(parentFrameOffset.y + sf.y + sf.height);
        } else if (Math.abs(nextY + origFrame.height / 2 - (sf.y + sf.height / 2)) <= 6) {
          nextY = Math.round(sf.y + sf.height / 2 - origFrame.height / 2);
          hGuides.push(parentFrameOffset.y + sf.y + sf.height / 2);
        }
      }

      // Equal-Spacing Magnetic Snap against collinear sibling pairs
      if (siblingFrames.length >= 2) {
        const sortedH = [...siblingFrames].sort((a, b) => a.x - b.x);
        for (let i = 0; i < sortedH.length - 1; i++) {
          const a = sortedH[i];
          const b = sortedH[i + 1];
          const pairGap = b.x - (a.x + a.width);
          if (pairGap >= 4 && pairGap <= 160) {
            const snapRightTarget = b.x + b.width + pairGap;
            if (Math.abs(nextX - snapRightTarget) <= 6) {
              nextX = snapRightTarget;
              const midY = parentFrameOffset.y + b.y + b.height / 2;
              gapPills.push(
                { x: parentFrameOffset.x + a.x + a.width + pairGap / 2, y: midY, label: `${Math.round(pairGap)}px` },
                { x: parentFrameOffset.x + b.x + b.width + pairGap / 2, y: midY, label: `${Math.round(pairGap)}px` },
              );
              break;
            }
          }
        }

        const sortedV = [...siblingFrames].sort((a, b) => a.y - b.y);
        for (let i = 0; i < sortedV.length - 1; i++) {
          const a = sortedV[i];
          const b = sortedV[i + 1];
          const pairGap = b.y - (a.y + a.height);
          if (pairGap >= 4 && pairGap <= 160) {
            const snapBottomTarget = b.y + b.height + pairGap;
            if (Math.abs(nextY - snapBottomTarget) <= 6) {
              nextY = snapBottomTarget;
              const midX = parentFrameOffset.x + b.x + b.width / 2;
              gapPills.push(
                { x: midX, y: parentFrameOffset.y + a.y + a.height + pairGap / 2, label: `${Math.round(pairGap)}px` },
                { x: midX, y: parentFrameOffset.y + b.y + b.height + pairGap / 2, label: `${Math.round(pairGap)}px` },
              );
              break;
            }
          }
        }
      }

      latest = { ...origFrame, x: nextX, y: nextY };
      setSnapGuides({ v: vGuides, h: hGuides });
      setEqualGapPills(gapPills);
      setCursorCanvasPos({ x: nextX, y: nextY });
      setTransientFrame({
        nodeId: node.id,
        ...latest,
        dx: nextX - origFrame.x,
        dy: nextY - origFrame.y,
        wasFlow: !isAlreadyAbsolute,
        mode: 'move',
      });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setSnapGuides({ v: [], h: [] });
      setEqualGapPills([]);
      setTransientFrame(null);
      if (moved) {
        const shouldBecomeAbsolute = node.kind !== 'artboard';
        void commitOps(
          [
            {
              op: 'update_node',
              id: node.id,
              layout: {
                ...(shouldBecomeAbsolute ? { positioning: 'absolute' as const } : {}),
                frame: latest,
                ...(!isAlreadyAbsolute
                  ? {
                      width: { mode: 'fixed' as const, value: latest.width },
                      height:
                        node.layout.height.mode === 'fill'
                          ? { mode: 'fixed' as const, value: latest.height }
                          : node.layout.height,
                    }
                  : {}),
              },
            },
          ],
          `Sposta ${node.name} a (${latest.x}, ${latest.y})`,
        );
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // 8-handle resize interaction (works for both absolute and flow elements)
  const startResizeDrag = (e: React.PointerEvent, node: UINode, dir: ResizeDir, parentMode: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (node.locked) return;

    const nodeEl = wrapperRef.current?.querySelector(`[data-canvas-node-id="${node.id}"]`) as HTMLElement | null;
    const isAlreadyAbsolute =
      node.kind === 'artboard' ||
      parentMode === 'freeform' ||
      node.layout.positioning === 'absolute';
    const measured = measureNodeRelativeFrame(node, nodeEl);
    const orig = isAlreadyAbsolute
      ? {
          x: node.layout.frame.x,
          y: node.layout.frame.y,
          width: node.kind === 'artboard' && activeBp ? activeBp.width : node.layout.frame.width || measured.width,
          height: node.layout.frame.height || measured.height,
        }
      : measured;

    const startX = e.clientX;
    const startY = e.clientY;
    let latest = { ...orig };

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / viewport.zoom;
      const dy = (ev.clientY - startY) / viewport.zoom;
      let { x, y, width, height } = orig;

      if (dir.includes('e')) width = Math.max(24, snapVal(orig.width + dx));
      if (dir.includes('s')) height = Math.max(20, snapVal(orig.height + dy));
      if (dir.includes('w')) {
        const nw = Math.max(24, snapVal(orig.width - dx));
        x = orig.x + (orig.width - nw);
        width = nw;
      }
      if (dir.includes('n')) {
        const nh = Math.max(20, snapVal(orig.height - dy));
        y = orig.y + (orig.height - nh);
        height = nh;
      }

      latest = { x, y, width, height };
      setTransientFrame({
        nodeId: node.id,
        ...latest,
        dx: x - orig.x,
        dy: y - orig.y,
        wasFlow: !isAlreadyAbsolute,
        mode: 'resize',
      });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setTransientFrame(null);
      const movedOrigin = latest.x !== orig.x || latest.y !== orig.y;
      void commitOps(
        [
          {
            op: 'update_node',
            id: node.id,
            layout: {
              ...(movedOrigin && node.kind !== 'artboard' ? { positioning: 'absolute' as const } : {}),
              frame: latest,
              width: { mode: 'fixed', value: latest.width },
              height: { mode: 'fixed', value: latest.height },
            },
          },
        ],
        `Ridimensiona ${node.name} (${latest.width}×${latest.height})`,
      );
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Detach or re-attach single selected node without jumping to (0,0)
  const handleToggleSelectedDetach = () => {
    if (!selectedNode || selectedNode.kind === 'artboard') return;
    if (selectedNode.layout.positioning === 'absolute') {
      void toggleNodeFreeformDetach(selectedNode.id);
      return;
    }
    const nodeEl = wrapperRef.current?.querySelector(
      `[data-canvas-node-id="${selectedNode.id}"]`,
    ) as HTMLElement | null;
    const measured = measureNodeRelativeFrame(selectedNode, nodeEl);
    void commitOps(
      [
        {
          op: 'update_node',
          id: selectedNode.id,
          layout: {
            positioning: 'absolute',
            frame: measured,
            width: { mode: 'fixed', value: measured.width },
          },
        },
      ],
      `Sgancia ${selectedNode.name} in coordinate libere (${measured.x}, ${measured.y})`,
    );
  };

  // Alignment handler: works for both multi-selection AND single node (aligns inside parent container)
  const handleAlignSelection = (alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    const nonArtboardIds = selectedNodeIds.filter(
      (id) => sheet.nodes[id] && !sheet.nodes[id].locked && sheet.nodes[id].kind !== 'artboard',
    );
    if (nonArtboardIds.length === 0) return;

    if (nonArtboardIds.length >= 2) {
      void alignSelectedNodes(alignment);
      return;
    }

    const single = sheet.nodes[nonArtboardIds[0]];
    const nodeEl = wrapperRef.current?.querySelector(`[data-canvas-node-id="${single.id}"]`) as HTMLElement | null;
    const curFrame =
      single.layout.positioning === 'absolute' ? single.layout.frame : measureNodeRelativeFrame(single, nodeEl);
    const parentNode = single.parentId ? sheet.nodes[single.parentId] : rootArtboard;
    const parentW =
      parentNode?.kind === 'artboard' && activeBp
        ? activeBp.width
        : parentNode?.layout.frame.width ?? 1280;
    const parentH =
      parentNode?.kind === 'artboard' && activeBp
        ? activeBp.height
        : parentNode?.layout.frame.height ?? 840;

    let { x, y } = curFrame;
    const { width, height } = curFrame;
    if (alignment === 'left') x = 16;
    else if (alignment === 'center') x = Math.round((parentW - width) / 2);
    else if (alignment === 'right') x = Math.max(0, parentW - width - 16);
    else if (alignment === 'top') y = 16;
    else if (alignment === 'middle') y = Math.round((parentH - height) / 2);
    else if (alignment === 'bottom') y = Math.max(0, parentH - height - 16);

    const ops: UIPatchOp[] = [
      {
        op: 'update_node',
        id: single.id,
        layout: {
          positioning: 'absolute',
          frame: { ...curFrame, x, y },
          width: { mode: 'fixed', value: width },
        },
      },
    ];
    void commitOps(ops, `Allinea ${single.name} (${alignment})`);
  };

  const handlePaletteDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const info = resolveContainerAndCoords(e.clientX, e.clientY, e.target);
    const preset = draggedPresetId ? PALETTE_ELEMENT_PRESETS.find((p) => p.id === draggedPresetId) : undefined;
    setHoveredNode(info.targetId);
    setCursorCanvasPos({ x: info.x, y: info.y });
    setDropPreview({
      targetId: info.targetId,
      targetName: info.targetName,
      x: info.x,
      y: info.y,
      planeX: info.planeX,
      planeY: info.planeY,
      width: preset?.defaultWidth ?? 220,
      height: preset?.defaultHeight ?? 52,
    });
  };

  const handlePaletteDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const presetId =
      e.dataTransfer.getData('application/x-studio-palette-id') ||
      e.dataTransfer.getData('text/plain') ||
      draggedPresetId;
    const info = resolveContainerAndCoords(e.clientX, e.clientY, e.target);
    setDropPreview(null);
    setDraggedPresetId(null);
    if (presetId) {
      void insertPaletteElement(presetId, { x: info.x, y: info.y }, info.targetId);
    }
  };

  const computeNodeStyle = (node: UINode, parentMode: string): React.CSSProperties => {
    const tf = transientFrame?.nodeId === node.id ? transientFrame : null;
    const isArtboard = node.kind === 'artboard';
    const artboardWidth = isArtboard && activeBp ? activeBp.width : node.layout.frame.width;

    // Apply live simulated pseudo-state on selected node (or nodes carrying overrides)
    const stateForNode =
      simulatedCanvasState !== 'base' &&
      (selectedNodeIds.includes(node.id) || Boolean(node.stateOverrides?.[simulatedCanvasState]))
        ? simulatedCanvasState
        : 'base';

    const baseCompiled = compileNodeToReactStyle(node, {
      tokenMap,
      parentMode,
      reusableClasses: sheet.reusableClasses,
      activeState: stateForNode,
      artboardWidthOverride: isArtboard ? artboardWidth : undefined,
    }) as React.CSSProperties;

    const css: React.CSSProperties = { ...baseCompiled };

    if (tf) {
      if (isArtboard) {
        css.left = tf.x;
        css.top = tf.y;
        css.width = tf.mode === 'resize' ? tf.width : artboardWidth;
        css.minHeight = tf.height;
      } else if (parentMode === 'freeform' || node.layout.positioning === 'absolute') {
        css.left = tf.x;
        css.top = tf.y;
        css.width = tf.width;
        css.minHeight = tf.height;
      } else {
        css.width = tf.width;
        css.minHeight = tf.height;
        css.transform = `translate3d(${tf.dx}px, ${tf.dy}px, 0)`;
        css.zIndex = 60;
        css.willChange = 'transform';
      }
    }

    if (codeSelectPulseNodeId === node.id) {
      css.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.85), 0 0 24px rgba(59, 130, 246, 0.55)';
    }

    return css;
  };

  const renderSceneNode = (nodeId: NodeId, parentMode: string): React.ReactNode => {
    const node = sheet.nodes[nodeId];
    if (!node || !node.visible) return null;

    const isSelected = selectedNodeIds.includes(node.id);
    const isHovered = hoveredNodeId === node.id;
    const isCodePulsing = codeSelectPulseNodeId === node.id;
    const isBeingDragged = transientFrame?.nodeId === node.id;
    const style = computeNodeStyle(node, parentMode);
    const iconEntry = node.content?.iconName
      ? OFFLINE_ICON_CATALOG.find((ic) => ic.id === node.content?.iconName)
      : undefined;

    const renderInnerControl = () => {
      if (inlineEditNodeId === node.id) {
        return (
          <input
            className="studio-input"
            autoFocus
            value={inlineEditText}
            style={{ width: '100%', minWidth: 120 }}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setInlineEditText(e.target.value)}
            onBlur={() => {
              void commitOps(
                [{ op: 'update_node', id: node.id, content: { ...node.content, text: inlineEditText } }],
                'Modifica testo',
              );
              setInlineEditNodeId(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void commitOps(
                  [{ op: 'update_node', id: node.id, content: { ...node.content, text: inlineEditText } }],
                  'Modifica testo',
                );
                setInlineEditNodeId(null);
              } else if (e.key === 'Escape') {
                setInlineEditNodeId(null);
              }
            }}
          />
        );
      }

      const ctrl = node.content?.controlType;
      if (node.kind === 'control') {
        if (ctrl === 'three-viewport') {
          const effW = isBeingDragged ? transientFrame.width : node.layout.frame.width || 460;
          const effH = isBeingDragged ? transientFrame.height : node.layout.frame.height || 300;
          return (
            <div
              style={{
                width: '100%',
                height: effH,
                minHeight: 140,
                position: 'relative',
                overflow: 'hidden',
                borderRadius: 'inherit',
              }}
            >
              <ThreeEmbeddedPreview
                sceneId={node.content?.threeSceneId}
                nodeName={node.name}
                width={effW}
                height={effH}
              />
              {isSelected && (
                <button
                  type="button"
                  className="studio-btn sm primary"
                  style={{ position: 'absolute', top: 8, right: 8, zIndex: 15 }}
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    openSplitMode('three-studio');
                  }}
                >
                  <Box size={11} />
                  <span>Apri Studio 3D</span>
                </button>
              )}
            </div>
          );
        }

        if (ctrl === 'text-input' || ctrl === 'password') {
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', opacity: 0.88 }}>
              {iconEntry && (
                <svg
                  width="14"
                  height="14"
                  viewBox={iconEntry.viewBox}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  dangerouslySetInnerHTML={{ __html: iconEntry.svgBody }}
                />
              )}
              <span style={{ opacity: node.content?.value ? 1 : 0.6 }}>
                {node.content?.value || node.content?.placeholder || 'Input...'}
              </span>
            </div>
          );
        }
        if (ctrl === 'textarea') {
          return <div style={{ opacity: 0.65 }}>{node.content?.placeholder || 'Textarea...'}</div>;
        }
        if (ctrl === 'select') {
          return (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <span>{node.content?.value || node.content?.options?.[0] || 'Select'}</span>
              <span style={{ fontSize: 10 }}>▼</span>
            </div>
          );
        }
        if (ctrl === 'checkbox' || ctrl === 'switch') {
          return (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: ctrl === 'switch' ? 28 : 15,
                  height: 15,
                  borderRadius: ctrl === 'switch' ? 999 : 4,
                  background: node.content?.checked ? 'var(--accent-primary)' : '#475569',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: node.content?.checked ? 'flex-end' : 'flex-start',
                  padding: 2,
                  color: '#fff',
                  fontSize: 10,
                }}
              >
                {ctrl === 'switch' ? (
                  <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#fff' }} />
                ) : node.content?.checked ? (
                  '✓'
                ) : (
                  ''
                )}
              </span>
              <span>{node.content?.text ?? node.name}</span>
            </div>
          );
        }
        if (ctrl === 'table') {
          const cols = node.content?.tableColumns ?? ['ID', 'Name'];
          const rows = node.content?.tableRows ?? [];
          return (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th
                      key={c}
                      style={{
                        textAlign: 'left',
                        padding: '8px 12px',
                        borderBottom: '1px solid rgba(148,163,184,0.25)',
                      }}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, rIdx) => (
                  <tr key={rIdx}>
                    {r.map((cell, cIdx) => (
                      <td
                        key={cIdx}
                        style={{ padding: '7px 12px', borderBottom: '1px solid rgba(148,163,184,0.12)' }}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }
        if (ctrl === 'divider') {
          return null;
        }
        return (
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%' }}>
            {iconEntry && (
              <svg
                width="14"
                height="14"
                viewBox={iconEntry.viewBox}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                dangerouslySetInnerHTML={{ __html: iconEntry.svgBody }}
              />
            )}
            <span>{node.content?.text ?? node.name}</span>
          </div>
        );
      }

      if (node.kind === 'media' && node.content?.imageUrl) {
        return (
          <img
            src={node.content.imageUrl}
            alt={node.content.text ?? node.name}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              display: 'block',
              pointerEvents: 'none',
            }}
          />
        );
      }

      if (node.kind === 'vector' && iconEntry) {
        return (
          <svg
            width="100%"
            height="100%"
            viewBox={iconEntry.viewBox}
            fill="none"
            stroke="var(--accent-primary)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            dangerouslySetInnerHTML={{ __html: iconEntry.svgBody }}
          />
        );
      }

      return (
        <>
          {node.content?.text && <span>{node.content.text}</span>}
          {node.childIds.map((cid) => renderSceneNode(cid, node.layout.mode))}
        </>
      );
    };

    const nodeExtraClasses = (node.classNames ?? node.style.classNames ?? [])
      .map(sanitizeCssClassSlug)
      .filter(Boolean)
      .join(' ');

    return (
      <div
        key={node.id}
        data-testid={`canvas-node-${node.id}`}
        data-canvas-node-id={node.id}
        className={`canvas-node-wrapper ${nodeExtraClasses} ${isSelected ? 'is-selected' : ''} ${isHovered ? 'is-hovered' : ''}`}
        style={style}
        onPointerDown={(e) => startNodeMoveDrag(e, node, parentMode)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!selectedNodeIds.includes(node.id)) {
            selectNode(node.id, false);
          }
          const coords = resolveContainerAndCoords(e.clientX, e.clientY, e.target);
          setContextMenu({
            x: e.clientX,
            y: e.clientY,
            canvasX: coords.x,
            canvasY: coords.y,
            targetNodeId: node.id,
          });
        }}
        onPointerEnter={(e) => {
          e.stopPropagation();
          if (e.altKey) setIsAltPressed(true);
          setHoveredNode(node.id);
        }}
        onPointerLeave={() => {
          if (hoveredNodeId === node.id) setHoveredNode(null);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (node.kind === 'text' || (node.kind === 'control' && node.content?.text !== undefined)) {
            setInlineEditNodeId(node.id);
            setInlineEditText(node.content?.text ?? '');
          }
        }}
        onDragOver={handlePaletteDragOver}
        onDrop={handlePaletteDrop}
      >
        {/* Box Model Margin / Padding Hover Highlight Band */}
        {isSelected && hoveredBoxModelOverlay && (
          <div
            data-testid={`canvas-boxmodel-overlay-${hoveredBoxModelOverlay}`}
            style={{
              position: 'absolute',
              inset: hoveredBoxModelOverlay === 'margin' ? -8 : 0,
              border:
                hoveredBoxModelOverlay === 'margin'
                  ? '6px solid rgba(245, 158, 11, 0.35)'
                  : '6px solid rgba(16, 185, 129, 0.35)',
              borderRadius: 'inherit',
              pointerEvents: 'none',
              zIndex: 42,
            }}
          />
        )}

        {isSelected && (
          <div className="node-label-pill">
            {node.name}
            {simulatedCanvasState !== 'base' ? ` • :${simulatedCanvasState}` : ''}{' '}
            {isBeingDragged
              ? `• X:${transientFrame.x} Y:${transientFrame.y} (${transientFrame.width}×${transientFrame.height})`
              : node.layout.positioning === 'absolute' && node.kind !== 'artboard'
                ? `• (${node.layout.frame.x}, ${node.layout.frame.y})`
                : node.layout.mode === 'flex'
                  ? `• Flex ${node.layout.direction === 'row' ? '→' : '↓'}`
                  : node.layout.mode === 'grid'
                    ? '• Grid'
                    : ''}
            {node.platform?.htmx ? ` • ${node.platform.htmx.method}` : ''}
          </div>
        )}

        {isCodePulsing && (
          <div
            data-testid="canvas-code-pulse-badge"
            style={{
              position: 'absolute',
              top: -22,
              right: -2,
              padding: '2px 7px',
              borderRadius: 999,
              background: 'var(--accent-emerald)',
              color: '#ffffff',
              fontSize: 10,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              zIndex: 45,
              boxShadow: '0 4px 12px rgba(16, 185, 129, 0.45)',
            }}
          >
            🔗 Selezionato dal Codice
          </div>
        )}

        {renderInnerControl()}

        {isSelected &&
          !node.locked &&
          RESIZE_HANDLES.map((dir) => (
            <div
              key={dir}
              className={`resize-handle ${dir}`}
              onPointerDown={(e) => startResizeDrag(e, node, dir, parentMode)}
            />
          ))}
      </div>
    );
  };

  // Resolve current fill hex for floating toolbar
  const selectedFillHex = (() => {
    const f = selectedNode?.style.fills?.[0];
    if (f?.type === 'solid') {
      const val = String(resolveTokenOrValue(f.color, tokenMap, '#2563eb'));
      return val.startsWith('#') ? val.slice(0, 7) : '#2563eb';
    }
    return '#2563eb';
  })();

  const stageCursor =
    isPanning || activeDrawingTool === 'pan'
      ? isPanning
        ? 'grabbing'
        : 'grab'
      : activeDrawingTool !== 'select'
        ? 'crosshair'
        : 'default';

  const toolIcon = (id: CanvasDrawingTool) => {
    switch (id) {
      case 'select':
        return <MousePointer2 size={12} />;
      case 'pan':
        return <Hand size={12} />;
      case 'frame':
        return <Frame size={12} />;
      case 'rect':
        return <Square size={12} />;
      case 'circle':
        return <Circle size={12} />;
      case 'text':
        return <Type size={12} />;
      case 'button':
        return <LayoutGrid size={12} />;
      case 'input':
        return <Columns3 size={12} />;
      case 'three_viewport':
        return <Box size={12} />;
    }
  };

  return (
    <div ref={wrapperRef} className="canvas-sheet-wrapper" data-testid="visual-canvas-sheet">
      {/* Top Canvas Action & Drawing Tool Ribbon */}
      <div ref={subtoolbarRef} className="canvas-subtoolbar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 5 }}>
        {/* Row 1: Placement Mode, Auto-Layout Solver, Grid Snap, Rulers & Zoom */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
            <span className="badge blue">{sheet.name}</span>
            <span className="badge">
              {activeBp.width}×{activeBp.height}
            </span>

            {/* 1-Click Freeform (X,Y) vs Auto-Layout Mode Switch */}
            <button
              type="button"
              className={`studio-btn sm ${canvasPlacementMode === 'freeform' ? 'primary' : 'active'}`}
              data-testid="btn-toggle-placement-mode"
              onClick={() => setCanvasPlacementMode(canvasPlacementMode === 'freeform' ? 'auto' : 'freeform')}
              title="Commuta tra Posizionamento Libero a coordinate (X, Y) e Flusso Auto-Layout (Flex/Grid)"
            >
              {canvasPlacementMode === 'freeform' ? (
                <>
                  <Move size={12} />
                  <span>✥ Posizionamento Libero (X, Y)</span>
                </>
              ) : (
                <>
                  <LayoutGrid size={12} />
                  <span>⊞ Auto-Layout Flusso</span>
                </>
              )}
            </button>

            <button
              type="button"
              className="studio-btn sm violet"
              data-testid="btn-convert-autolayout"
              onClick={() => void solveAutoLayoutOnActive()}
              title="Converte posizioni libere (x,y) in Flexbox / CSS Grid pulito tramite Spatial Solver"
            >
              <Wand2 size={12} />
              <span>Auto-Layout</span>
            </button>

            <button
              type="button"
              className={`studio-btn sm ${snapToGrid8px ? 'active' : ''}`}
              data-testid="btn-toggle-grid-snap"
              aria-pressed={snapToGrid8px}
              onClick={toggleSnapToGrid8px}
              title="Aggancia spostamenti e ridimensionamenti alla griglia 8px (Shift+Frecce = 8px, Frecce = 1px)"
            >
              <Grid3x3 size={12} />
              <span>Snap Griglia 8px</span>
            </button>

            <button
              type="button"
              className={`studio-btn sm ${showRulers ? 'active' : ''}`}
              data-testid="btn-toggle-rulers"
              aria-pressed={showRulers}
              onClick={() => setShowRulers(!showRulers)}
              title="Mostra / Nascondi Righelli in pixel (Top & Left)"
            >
              <Ruler size={12} />
              <span>Righelli</span>
            </button>

            {cursorCanvasPos && (
              <span
                className="badge"
                data-testid="canvas-cursor-coords"
                style={{ fontFamily: "'JetBrains Mono', Consolas, monospace" }}
              >
                X: {cursorCanvasPos.x}px · Y: {cursorCanvasPos.y}px
              </span>
            )}

            {simulatedCanvasState !== 'base' && (
              <button
                type="button"
                className="studio-btn sm violet"
                data-testid="canvas-simulated-state-badge"
                onClick={() => setSimulatedCanvasState('base')}
                title="Clicca per tornare allo stato Base"
              >
                <span>👁 Stato :{simulatedCanvasState}</span>
              </button>
            )}
          </div>

          {/* Zoom Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            <div className="segmented-group">
              <button
                type="button"
                className="segmented-item"
                onClick={() => setViewport(sheetId, { ...viewport, zoom: viewport.zoom - 0.1 }, true)}
                title="Zoom Out"
              >
                <Minus size={12} />
              </button>
              <button
                type="button"
                className="segmented-item"
                onClick={() => setViewport(sheetId, { x: 24, y: 20, zoom: 1 }, true)}
                title="Reset 100% (Trascina lo sfondo per Pan)"
              >
                {Math.round(viewport.zoom * 100)}%
              </button>
              <button
                type="button"
                className="segmented-item"
                onClick={() => setViewport(sheetId, { ...viewport, zoom: viewport.zoom + 0.1 }, true)}
                title="Zoom In"
              >
                <Plus size={12} />
              </button>
              <button
                type="button"
                className="segmented-item"
                onClick={() => setViewport(sheetId, { x: 24, y: 20, zoom: 0.76 }, true)}
                title="Adatta Artboard"
              >
                <Maximize2 size={11} />
                <span>Fit</span>
              </button>
            </div>
          </div>
        </div>

        {/* Row 2: Direct Figma-Style Canvas Drawing Tool Strip */}
        <div
          data-testid="canvas-tool-strip"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            flexWrap: 'wrap',
            paddingTop: 3,
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          {DRAWING_TOOLS.map((tool) => {
            const isAct = activeDrawingTool === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                data-testid={`tool-btn-${tool.id}`}
                aria-pressed={isAct}
                className={`studio-btn sm ${isAct ? 'active' : 'ghost'}`}
                onClick={() => setActiveDrawingTool(tool.id)}
                title={tool.title}
                style={{ height: 22, padding: '0 7px', fontSize: 10.5 }}
              >
                {toolIcon(tool.id)}
                <span>{tool.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Canva-Style Clamped Floating Contextual Toolbar */}
      {selectedNode && (
        <div
          className="floating-context-toolbar"
          data-testid="floating-context-toolbar"
          style={{ top: Math.max(54, floatingTopPx) }}
        >
          {selectedNodeIds.length > 1 ? (
            <span className="badge violet" data-testid="multi-select-count-badge">
              {selectedNodeIds.length} selezionati
            </span>
          ) : (
            <span className="badge blue" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {selectedNode.name}
            </span>
          )}

          {/* 1-Click Detach Freeform (X,Y) / Re-attach to Flow */}
          {selectedNodeIds.length === 1 && selectedNode.kind !== 'artboard' && (
            <button
              type="button"
              className={`studio-btn sm ${selectedNode.layout.positioning === 'absolute' ? 'active' : ''}`}
              data-testid="btn-toggle-node-detach"
              onClick={handleToggleSelectedDetach}
              title={
                selectedNode.layout.positioning === 'absolute'
                  ? 'Riaggancia questo elemento al flusso Flex/Grid del genitore'
                  : 'Sgancia questo elemento in coordinate assolute libere (X, Y)'
              }
            >
              {selectedNode.layout.positioning === 'absolute' ? (
                <>
                  <PinOff size={11} />
                  <span>Rimettilo nel Flusso</span>
                </>
              ) : (
                <>
                  <Pin size={11} />
                  <span>📌 Sgancia Libero (X,Y)</span>
                </>
              )}
            </button>
          )}

          {/* Alignment & Z-Index Bar */}
          {(selectedNodeIds.length > 1 || selectedNode.kind !== 'artboard') && (
            <div className="segmented-group" data-testid="canvas-alignment-bar">
              <button
                type="button"
                className="segmented-item"
                data-testid="btn-align-left"
                onClick={() => handleAlignSelection('left')}
                title="Allinea a Sinistra"
              >
                <AlignStartVertical size={12} />
              </button>
              <button
                type="button"
                className="segmented-item"
                data-testid="btn-align-center"
                onClick={() => handleAlignSelection('center')}
                title="Allinea al Centro Orizzontale"
              >
                <AlignCenterVertical size={12} />
              </button>
              <button
                type="button"
                className="segmented-item"
                data-testid="btn-align-right"
                onClick={() => handleAlignSelection('right')}
                title="Allinea a Destra"
              >
                <AlignEndVertical size={12} />
              </button>
              <button
                type="button"
                className="segmented-item"
                data-testid="btn-align-top"
                onClick={() => handleAlignSelection('top')}
                title="Allinea in Alto"
              >
                <AlignStartHorizontal size={12} />
              </button>
              <button
                type="button"
                className="segmented-item"
                data-testid="btn-align-middle"
                onClick={() => handleAlignSelection('middle')}
                title="Allinea al Centro Verticale"
              >
                <AlignCenterHorizontal size={12} />
              </button>
              <button
                type="button"
                className="segmented-item"
                data-testid="btn-align-bottom"
                onClick={() => handleAlignSelection('bottom')}
                title="Allinea in Basso"
              >
                <AlignEndHorizontal size={12} />
              </button>
              <button
                type="button"
                className="segmented-item"
                data-testid="btn-zindex-front"
                onClick={() => void adjustSelectedZIndex(1)}
                title="Porta Avanti (+zIndex)"
              >
                <ArrowUpToLine size={12} />
              </button>
              <button
                type="button"
                className="segmented-item"
                data-testid="btn-zindex-back"
                onClick={() => void adjustSelectedZIndex(-1)}
                title="Porta Dietro (-zIndex)"
              >
                <ArrowDownToLine size={12} />
              </button>
            </div>
          )}

          {/* Quick Fill Color */}
          {selectedNodeIds.length === 1 && (
            <label
              title="Colore sfondo rapido"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, flexShrink: 0 }}
            >
              <input
                type="color"
                value={selectedFillHex}
                onChange={(e) =>
                  void commitOps(
                    [
                      {
                        op: 'update_node',
                        id: selectedNode.id,
                        style: { fills: [{ type: 'solid', color: e.target.value }] },
                      },
                    ],
                    'Colore riempimento',
                  )
                }
                style={{ width: 20, height: 20, border: 'none', padding: 0, background: 'transparent', cursor: 'pointer' }}
              />
            </label>
          )}

          {/* Quick Inline Text Edit */}
          {selectedNodeIds.length === 1 &&
            (selectedNode.kind === 'text' || selectedNode.content?.text !== undefined) && (
              <input
                className="studio-input"
                style={{ width: 124, height: 23, fontSize: 11 }}
                value={selectedNode.content?.text ?? ''}
                placeholder="Testo nodo..."
                onChange={(e) =>
                  void commitOps(
                    [{ op: 'update_node', id: selectedNode.id, content: { ...selectedNode.content, text: e.target.value } }],
                    'Testo rapido',
                  )
                }
              />
            )}

          {/* Flex Row / Col Toggle */}
          {selectedNodeIds.length === 1 &&
            (selectedNode.kind === 'container' || selectedNode.kind === 'artboard' || selectedNode.kind === 'collection') && (
              <>
                <div className="segmented-group">
                  <button
                    type="button"
                    className={`segmented-item ${selectedNode.layout.mode === 'flex' && selectedNode.layout.direction === 'row' ? 'active' : ''}`}
                    onClick={() =>
                      void commitOps(
                        [{ op: 'update_node', id: selectedNode.id, layout: { mode: 'flex', direction: 'row' } }],
                        'Flex Row',
                      )
                    }
                    title="Auto-Layout Riga (Row)"
                  >
                    <Columns3 size={12} />
                    <span>Row</span>
                  </button>
                  <button
                    type="button"
                    className={`segmented-item ${selectedNode.layout.mode === 'flex' && selectedNode.layout.direction === 'column' ? 'active' : ''}`}
                    onClick={() =>
                      void commitOps(
                        [{ op: 'update_node', id: selectedNode.id, layout: { mode: 'flex', direction: 'column' } }],
                        'Flex Col',
                      )
                    }
                    title="Auto-Layout Colonna (Column)"
                  >
                    <AlignJustify size={12} />
                    <span>Col</span>
                  </button>
                </div>

                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, color: 'var(--text-secondary)' }}>
                  Gap
                  <input
                    type="number"
                    className="studio-input"
                    style={{ width: 42, height: 22, padding: '0 4px' }}
                    value={Number(resolveTokenOrValue(selectedNode.layout.gap, tokenMap, 12))}
                    onChange={(e) =>
                      void commitOps(
                        [{ op: 'update_node', id: selectedNode.id, layout: { gap: Math.max(0, Number(e.target.value)) } }],
                        'Modifica Gap',
                      )
                    }
                  />
                </label>

                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, color: 'var(--text-secondary)' }}>
                  Pad
                  <input
                    type="number"
                    className="studio-input"
                    style={{ width: 42, height: 22, padding: '0 4px' }}
                    value={Number(resolveTokenOrValue(selectedNode.layout.padding.top, tokenMap, 16))}
                    onChange={(e) => {
                      const p = Math.max(0, Number(e.target.value));
                      void commitOps(
                        [{ op: 'update_node', id: selectedNode.id, layout: { padding: { top: p, right: p, bottom: p, left: p } } }],
                        'Modifica Padding',
                      );
                    }}
                  />
                </label>
              </>
            )}

          <button
            type="button"
            className="studio-btn sm"
            onClick={() => void duplicateSelectedNode()}
            title="Duplica selezione (Ctrl+D)"
          >
            <Copy size={12} />
          </button>

          {(selectedNodeIds.length > 1 || selectedNode.kind !== 'artboard') && (
            <button
              type="button"
              className="studio-btn sm danger"
              onClick={() => void deleteSelectedNode()}
              title="Elimina selezione (Del)"
            >
              <Trash2 size={12} />
            </button>
          )}

          <button
            type="button"
            className="studio-btn sm violet"
            data-testid="btn-hud-ask-ai"
            onClick={askAiAboutSelection}
            title="Apri Co-Pilot Chirurgico sul nodo selezionato"
          >
            <Sparkles size={12} />
            <span>✨ Chiedi all&apos;AI</span>
          </button>
        </div>
      )}

      {/* Stage Area + Optional Pixel Rulers */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {showRulers && (
          <div
            data-testid="canvas-ruler-top"
            style={{
              height: RULER_SIZE,
              minHeight: RULER_SIZE,
              display: 'flex',
              background: 'var(--bg-header)',
              borderBottom: '1px solid var(--border-subtle)',
              fontSize: 9,
              color: 'var(--text-muted)',
              fontFamily: "'JetBrains Mono', Consolas, monospace",
              overflow: 'hidden',
              userSelect: 'none',
              zIndex: 12,
            }}
          >
            <div
              style={{
                width: RULER_SIZE,
                minWidth: RULER_SIZE,
                borderRight: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 8.5,
                fontWeight: 700,
              }}
            >
              px
            </div>
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              {rulerTicks.hTicks.map((tk) => (
                <div
                  key={`ht_${tk.val}`}
                  style={{
                    position: 'absolute',
                    left: tk.px,
                    top: 0,
                    bottom: 0,
                    borderLeft: '1px solid var(--border-strong)',
                    paddingLeft: 3,
                    paddingTop: 2,
                    pointerEvents: 'none',
                  }}
                >
                  {tk.val}
                </div>
              ))}
              {cursorCanvasPos && (
                <div
                  style={{
                    position: 'absolute',
                    left: Math.round(viewport.x + (artOriginX + cursorCanvasPos.x) * viewport.zoom),
                    top: 0,
                    bottom: 0,
                    width: 1.5,
                    background: 'var(--accent-primary)',
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row', position: 'relative' }}>
          {showRulers && (
            <div
              data-testid="canvas-ruler-left"
              style={{
                width: RULER_SIZE,
                minWidth: RULER_SIZE,
                background: 'var(--bg-header)',
                borderRight: '1px solid var(--border-subtle)',
                position: 'relative',
                overflow: 'hidden',
                fontSize: 9,
                color: 'var(--text-muted)',
                fontFamily: "'JetBrains Mono', Consolas, monospace",
                userSelect: 'none',
                zIndex: 12,
              }}
            >
              {rulerTicks.vTicks.map((tk) => (
                <div
                  key={`vt_${tk.val}`}
                  style={{
                    position: 'absolute',
                    top: tk.px,
                    left: 0,
                    right: 0,
                    borderTop: '1px solid var(--border-strong)',
                    paddingTop: 1,
                    paddingLeft: 2,
                    fontSize: 8,
                    pointerEvents: 'none',
                  }}
                >
                  {tk.val}
                </div>
              ))}
              {cursorCanvasPos && (
                <div
                  style={{
                    position: 'absolute',
                    top: Math.round(viewport.y + (artOriginY + cursorCanvasPos.y) * viewport.zoom),
                    left: 0,
                    right: 0,
                    height: 1.5,
                    background: 'var(--accent-primary)',
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
          )}

          {/* Infinite Pan/Zoom Stage */}
          <div
            ref={stageRef}
            data-testid="canvas-infinite-stage"
            className={`canvas-infinite-stage ${isPanning ? 'panning' : ''} ${snapToGrid8px ? 'grid-snap-on' : ''}`}
            style={{ cursor: stageCursor }}
            onPointerDown={handleStagePointerDown}
            onPointerMove={(e) => {
              if (e.altKey !== isAltPressed) setIsAltPressed(e.altKey);
              handleStagePointerMove(e);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              const coords = resolveContainerAndCoords(e.clientX, e.clientY, e.target);
              setContextMenu({
                x: e.clientX,
                y: e.clientY,
                canvasX: coords.x,
                canvasY: coords.y,
                targetNodeId: selectedNodeIds[0] ?? null,
              });
            }}
            onPointerLeave={() => setCursorCanvasPos(null)}
            onWheel={handleWheel}
            onDragOver={handlePaletteDragOver}
            onDragLeave={(e) => {
              if (e.currentTarget === e.target) {
                setDropPreview(null);
              }
            }}
            onDrop={handlePaletteDrop}
          >
            <div
              className="canvas-transform-plane"
              style={{
                ...canvasTokenStyles,
                transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
              }}
            >
              {injectedSheetCss && <style data-testid="canvas-sheet-styles">{injectedSheetCss}</style>}

              {/* Magnetic Alignment Guides */}
              {snapGuides.v.map((xPos, idx) => (
                <div key={`vg_${idx}`} className="alignment-guide-v" style={{ left: xPos }} />
              ))}
              {snapGuides.h.map((yPos, idx) => (
                <div key={`hg_${idx}`} className="alignment-guide-h" style={{ top: yPos }} />
              ))}

              {/* Equal-Spacing Gap Snap Pills */}
              {equalGapPills.map((gp, idx) => (
                <div
                  key={`egap_${idx}`}
                  data-testid="canvas-equal-gap-pill"
                  style={{
                    position: 'absolute',
                    left: gp.x,
                    top: gp.y,
                    transform: 'translate(-50%, -50%)',
                    padding: '1px 6px',
                    borderRadius: 999,
                    background: '#ec4899',
                    color: '#ffffff',
                    fontSize: 9.5,
                    fontWeight: 700,
                    pointerEvents: 'none',
                    zIndex: 85,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {gp.label}
                </div>
              ))}

              {/* Alt-Hover Pixel Distance Measurement Pills */}
              {isAltPressed &&
                selectedNode &&
                hoveredNodeId &&
                hoveredNodeId !== selectedNode.id &&
                sheet.nodes[hoveredNodeId] &&
                (() => {
                  const target = sheet.nodes[hoveredNodeId];
                  const sx = artOriginX + selectedNode.layout.frame.x;
                  const sy = artOriginY + selectedNode.layout.frame.y;
                  const sw = selectedNode.layout.frame.width;
                  const sh = selectedNode.layout.frame.height;
                  const tx = artOriginX + target.layout.frame.x;
                  const ty = artOriginY + target.layout.frame.y;
                  const tw = target.layout.frame.width;
                  const th = target.layout.frame.height;

                  const hDist =
                    tx >= sx + sw ? tx - (sx + sw) : sx >= tx + tw ? sx - (tx + tw) : Math.abs(tx - sx);
                  const vDist =
                    ty >= sy + sh ? ty - (sy + sh) : sy >= ty + th ? sy - (ty + th) : Math.abs(ty - sy);

                  return (
                    <div
                      data-testid="canvas-alt-distance-overlay"
                      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 88 }}
                    >
                      {hDist > 0 && (
                        <div
                          style={{
                            position: 'absolute',
                            left: Math.min(sx + sw, tx + tw) + hDist / 2,
                            top: sy + sh / 2,
                            transform: 'translate(-50%, -50%)',
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: '#db2777',
                            color: '#ffffff',
                            fontSize: 9.5,
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          ↔ {Math.round(hDist)}px
                        </div>
                      )}
                      {vDist > 0 && (
                        <div
                          style={{
                            position: 'absolute',
                            left: sx + sw / 2,
                            top: Math.min(sy + sh, ty + th) + vDist / 2,
                            transform: 'translate(-50%, -50%)',
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: '#db2777',
                            color: '#ffffff',
                            fontSize: 9.5,
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          ↕ {Math.round(vDist)}px
                        </div>
                      )}
                    </div>
                  );
                })()}

              {sheet.rootIds.map((rid) => renderSceneNode(rid, 'freeform'))}

              {/* Live Ghost Drop Preview Rectangle + (X, Y) Coordinate Tooltip */}
              {dropPreview && (
                <div
                  data-testid="canvas-drop-ghost-preview"
                  style={{
                    position: 'absolute',
                    left: dropPreview.planeX,
                    top: dropPreview.planeY,
                    width: dropPreview.width,
                    height: dropPreview.height,
                    border: '2px dashed var(--accent-primary)',
                    borderRadius: 10,
                    background: 'rgba(59, 130, 246, 0.14)',
                    pointerEvents: 'none',
                    zIndex: 90,
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: -24,
                      left: 0,
                      padding: '2px 8px',
                      borderRadius: 6,
                      background: 'var(--accent-primary)',
                      color: '#ffffff',
                      fontSize: 10.5,
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                      boxShadow: '0 4px 12px rgba(37, 99, 235, 0.4)',
                    }}
                  >
                    ✥ Drop in {dropPreview.targetName} @ ({dropPreview.x}, {dropPreview.y})
                  </div>
                </div>
              )}

              {/* Live Direct-Canvas Drawing Marquee */}
              {drawingDraft && (
                <div
                  data-testid="canvas-drawing-marquee"
                  style={{
                    position: 'absolute',
                    left: drawingDraft.planeX,
                    top: drawingDraft.planeY,
                    width: drawingDraft.width,
                    height: drawingDraft.height,
                    border: '2px solid var(--accent-violet)',
                    borderRadius: drawingDraft.tool === 'circle' ? 9999 : 8,
                    background: 'rgba(139, 92, 246, 0.16)',
                    pointerEvents: 'none',
                    zIndex: 95,
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: -23,
                      left: 0,
                      padding: '2px 7px',
                      borderRadius: 5,
                      background: 'var(--accent-violet)',
                      color: '#ffffff',
                      fontSize: 10,
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    ({drawingDraft.x}, {drawingDraft.y}) • {drawingDraft.width}×{drawingDraft.height}px
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Viewport-Clamped Right-Click Context Menu */}
      {contextMenu && (
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          canvasX={contextMenu.canvasX}
          canvasY={contextMenu.canvasY}
          targetNodeId={contextMenu.targetNodeId}
          onToggleDetach={handleToggleSelectedDetach}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};
