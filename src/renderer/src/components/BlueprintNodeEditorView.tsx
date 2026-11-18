import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  Crosshair,
  FilePlus2,
  Play,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  BLUEPRINT_CATEGORY_THEME,
  BLUEPRINT_NODE_CATALOG,
  BLUEPRINT_PIN_COLORS,
  canConnectBlueprintPins,
  compileBlueprintToTs,
  computeBezierWirePath,
  createBlueprintNode,
  createStarterBlueprintGraph,
  simulateBlueprintExecution,
  type BlueprintCategory,
  type BlueprintGraphDocument,
  type BlueprintNode,
  type BlueprintNodeKind,
  type BlueprintPin,
  type BlueprintPinDataType,
  type BlueprintSimStep,
  type BlueprintVariable,
  type BlueprintWire,
} from '@shared/blueprint-ir';
import { useStudioStore } from '@renderer/state/studio-store';
import { GeneratedSourceTextarea, useGeneratedSourceEditor } from './GeneratedSourceEditor';

export interface BlueprintNodeEditorViewProps {
  vfsEntryId?: string;
  blueprintId?: string;
  sheetId?: string;
}

const CARD_WIDTH = 284;
const HEADER_H = 42;
const CONFIG_H = 34;
const BODY_PAD_TOP = 8;
const PIN_ROW_H = 30;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.8;

const CATEGORY_ORDER: BlueprintCategory[] = ['event', 'flow', 'ui_action', 'math_logic', 'async_3d'];

const CATEGORY_DOT: Record<BlueprintCategory, string> = {
  event: '🔴',
  flow: '⚪',
  ui_action: '🔵',
  math_logic: '🟢',
  async_3d: '🟣',
};

function nodeHasConfigBar(kind: BlueprintNodeKind): boolean {
  return (
    kind === 'event_ui_click' ||
    kind === 'event_input_change' ||
    kind === 'event_key_press' ||
    kind === 'event_3d_click' ||
    kind === 'ui_set_text' ||
    kind === 'ui_get_input' ||
    kind === 'ui_set_style' ||
    kind === 'ui_set_visibility' ||
    kind === 'data_get_var' ||
    kind === 'data_set_var' ||
    kind === 'math_op' ||
    kind === 'logic_compare' ||
    kind === 'three_transform' ||
    kind === 'custom_ts_expr'
  );
}

function getPinWorldPosition(node: BlueprintNode, pinId: string): { x: number; y: number } | null {
  const hasCfg = nodeHasConfigBar(node.kind);
  const topBase = node.y + 1 + HEADER_H + (hasCfg ? CONFIG_H : 0) + BODY_PAD_TOP;

  const inIdx = node.inputs.findIndex((p) => p.id === pinId);
  if (inIdx >= 0) {
    return {
      x: node.x + 16,
      y: topBase + inIdx * PIN_ROW_H + PIN_ROW_H / 2,
    };
  }

  const outIdx = node.outputs.findIndex((p) => p.id === pinId);
  if (outIdx >= 0) {
    return {
      x: node.x + CARD_WIDTH - 16,
      y: topBase + outIdx * PIN_ROW_H + PIN_ROW_H / 2,
    };
  }

  return null;
}

function estimateCardHeight(node: BlueprintNode): number {
  const rows = Math.max(node.inputs.length, node.outputs.length, 1);
  return HEADER_H + (nodeHasConfigBar(node.kind) ? CONFIG_H : 0) + BODY_PAD_TOP * 2 + rows * PIN_ROW_H + 4;
}

interface WireDragState {
  anchorNodeId: string;
  anchorPin: BlueprintPin;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  snappedTarget: { nodeId: string; pin: BlueprintPin; x: number; y: number } | null;
}

interface PaletteMenuState {
  open: boolean;
  screenX: number;
  screenY: number;
  spawnWorldX: number;
  spawnWorldY: number;
}

const PinGlyph: React.FC<{ dataType: BlueprintPinDataType; connected: boolean; highlighted?: boolean }> = ({
  dataType,
  connected,
  highlighted,
}) => {
  const color = BLUEPRINT_PIN_COLORS[dataType] ?? '#f8fafc';
  if (dataType === 'exec') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" style={{ flexShrink: 0, overflow: 'visible' }}>
        <polygon
          points="2,2 8,2 12.5,7 8,12 2,12"
          fill={connected ? '#ffffff' : 'rgba(15, 23, 42, 0.85)'}
          stroke={highlighted ? '#fde047' : '#f8fafc'}
          strokeWidth={highlighted ? 2 : 1.5}
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" style={{ flexShrink: 0, overflow: 'visible' }}>
      <circle
        cx="6.5"
        cy="7"
        r="4.5"
        fill={connected ? color : '#0b101b'}
        stroke={highlighted ? '#fde047' : color}
        strokeWidth={highlighted ? 2.2 : 1.8}
      />
      <polygon points="11.5,5 13.8,7 11.5,9" fill={color} opacity={0.88} />
    </svg>
  );
};

export const BlueprintNodeEditorView: React.FC<BlueprintNodeEditorViewProps> = ({
  vfsEntryId,
  blueprintId,
  sheetId,
}) => {
  const project = useStudioStore((s) => s.project);
  const blueprintGraphs = useStudioStore((s) => s.blueprintGraphs);
  const activeBlueprintId = useStudioStore((s) => s.activeBlueprintId);
  const activeSheetId = useStudioStore((s) => s.activeSheetId);
  const sheetDocuments = useStudioStore((s) => s.sheetDocuments);
  const threeScenes = useStudioStore((s) => s.threeScenes);
  const activeThreeSceneId = useStudioStore((s) => s.activeThreeSceneId);
  const vfsTree = useStudioStore((s) => s.vfsTree);

  const ensureActiveBlueprintGraph = useStudioStore((s) => s.ensureActiveBlueprintGraph);
  const saveBlueprintGraph = useStudioStore((s) => s.saveBlueprintGraph);
  const createVfsEntry = useStudioStore((s) => s.createVfsEntry);
  const appendConsoleEntry = useStudioStore((s) => s.appendConsoleEntry);
  const setBottomConsoleOpen = useStudioStore((s) => s.setBottomConsoleOpen);
  const pushToast = useStudioStore((s) => s.pushToast);

  const resolvedBpId = blueprintId ?? activeBlueprintId ?? Object.keys(blueprintGraphs)[0] ?? '';
  const storeGraph = blueprintGraphs[resolvedBpId];
  const targetSheetId = sheetId || activeSheetId;
  const sheet = sheetDocuments[targetSheetId];

  const [localGraph, setLocalGraph] = useState<BlueprintGraphDocument>(() => {
    if (storeGraph) return storeGraph;
    return createStarterBlueprintGraph(project?.id ?? 'proj_local', targetSheetId);
  });
  const localGraphRef = useRef(localGraph);
  const latestPendingGraphRef = useRef<BlueprintGraphDocument | null>(null);
  const queuedWriteRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingWriteRef = useRef<{ graph: BlueprintGraphDocument; entryId?: string } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const simIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simCleanupRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reviseLocalGraph = useCallback((updater: (graph: BlueprintGraphDocument) => BlueprintGraphDocument) => {
    const next = updater(localGraphRef.current);
    localGraphRef.current = next;
    setLocalGraph(next);
    return next;
  }, []);

  useEffect(() => {
    if (storeGraph) {
      if (latestPendingGraphRef.current?.id !== storeGraph.id) reviseLocalGraph(() => storeGraph);
      return;
    }
    let current = true;
    void ensureActiveBlueprintGraph().then(({ graph }) => {
      if (current && latestPendingGraphRef.current?.id !== graph.id) reviseLocalGraph(() => graph);
    }).catch((error) => {
      if (current) pushToast('error', error instanceof Error ? error.message : 'Impossibile caricare il grafo Blueprint.');
    });
    return () => { current = false; };
  }, [storeGraph, ensureActiveBlueprintGraph, pushToast, reviseLocalGraph]);

  const [isNarrowLayout, setIsNarrowLayout] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredWireId, setHoveredWireId] = useState<string | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [showCodeDrawer, setShowCodeDrawer] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const [paletteMenu, setPaletteMenu] = useState<PaletteMenuState>({
    open: false,
    screenX: 120,
    screenY: 96,
    spawnWorldX: 260,
    spawnWorldY: 180,
  });
  const [paletteSearch, setPaletteSearch] = useState('');
  const [paletteCategoryFilter, setPaletteCategoryFilter] = useState<BlueprintCategory | 'all'>('all');

  const [wireDrag, setWireDrag] = useState<WireDragState | null>(null);
  const [armedPin, setArmedPin] = useState<{ nodeId: string; pin: BlueprintPin } | null>(null);

  // Variable quick-creator popover
  const [showNewVarForm, setShowNewVarForm] = useState(false);
  const [newVarName, setNewVarName] = useState('score');
  const [newVarType, setNewVarType] = useState<'number' | 'string' | 'boolean'>('number');
  const [newBpModalOpen, setNewBpModalOpen] = useState(false);
  const [newBpName, setNewBpName] = useState('CheckoutFlow');

  // Step-by-step live simulator state
  const [isSimulating, setIsSimulating] = useState(false);
  const [activeSimNodeId, setActiveSimNodeId] = useState<string | null>(null);
  const [activeSimWireIds, setActiveSimWireIds] = useState<string[]>([]);
  const [visitedSimWireIds, setVisitedSimWireIds] = useState<string[]>([]);
  const [simVars, setSimVars] = useState<Record<string, unknown>>({});
  const [simBaselineVars, setSimBaselineVars] = useState<Record<string, string | number | boolean>>({});
  const [simLastStep, setSimLastStep] = useState<BlueprintSimStep | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setIsNarrowLayout(w < 720);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (simIntervalRef.current) clearInterval(simIntervalRef.current);
      if (simCleanupRef.current) clearTimeout(simCleanupRef.current);
    };
  }, []);

  const flushPendingGraph = useCallback(() => {
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = null;
    const pending = pendingWriteRef.current;
    pendingWriteRef.current = null;
    if (!pending) return Promise.resolve(false);

    const saveResult = queuedWriteRef.current.then(async () => {
      const activeProject = useStudioStore.getState().project?.id;
      if (activeProject && pending.graph.projectId !== activeProject) return false;
      await saveBlueprintGraph(pending.graph, pending.entryId);
      if (latestPendingGraphRef.current === pending.graph) latestPendingGraphRef.current = null;
      return true;
    }).catch((error) => {
      pushToast('error', error instanceof Error ? error.message : 'Impossibile salvare il grafo Blueprint.');
      return false;
    });
    queuedWriteRef.current = saveResult;
    return saveResult;
  }, [saveBlueprintGraph, pushToast]);

  useEffect(() => () => { void flushPendingGraph(); }, [flushPendingGraph, resolvedBpId, vfsEntryId]);

  const scheduleGraphWrite = useCallback((graph: BlueprintGraphDocument, immediately: boolean) => {
    latestPendingGraphRef.current = graph;
    pendingWriteRef.current = { graph, entryId: vfsEntryId };
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    if (immediately) return flushPendingGraph();
    saveDebounceRef.current = setTimeout(() => { void flushPendingGraph(); }, 260);
  }, [flushPendingGraph, vfsEntryId]);

  const commitGraphUpdate = useCallback(
    (updater: (prev: BlueprintGraphDocument) => BlueprintGraphDocument, immediatePersist = false) => {
      const next = reviseLocalGraph((previous) => ({ ...updater(previous), updatedAt: Date.now() }));
      return scheduleGraphWrite(next, immediatePersist);
    },
    [reviseLocalGraph, scheduleGraphWrite],
  );

  // Canvas UI Nodes available for Blueprint dropdowns
  const sheetUiNodes = useMemo(() => {
    if (!sheet) return [];
    return Object.values(sheet.nodes).filter((n) => n.kind !== 'artboard');
  }, [sheet]);

  // Active 3D scene mesh names for 3D Blueprint nodes
  const sceneMeshNames = useMemo(() => {
    const sc = activeThreeSceneId ? threeScenes[activeThreeSceneId] : Object.values(threeScenes)[0];
    const names = (sc?.objects ?? []).filter((o) => o.nodeType === 'mesh').map((o) => o.name);
    return names.length > 0 ? names : ['HeroMesh', 'OrbitalRing', 'Pedestal'];
  }, [threeScenes, activeThreeSceneId]);

  // Available Blueprint VFS files
  const blueprintVfsFiles = useMemo(
    () => vfsTree.filter((n) => n.entryKind === 'blueprint_graph' || n.name.endsWith('.blueprint.json')),
    [vfsTree],
  );

  // Compiled TypeScript + SourceMap
  const compiledTs = useMemo(() => compileBlueprintToTs(localGraph), [localGraph]);
  const manualFileName = `blueprint-${localGraph.id.replace(/[^a-zA-Z0-9_-]/g, '-')}.ts`;
  const editableSource = useGeneratedSourceEditor({
    fileName: manualFileName, generated: compiledTs.code, folders: ['generated'], entryKind: 'script_file',
  });

  const highlightedCodeLines = useMemo(() => {
    if (!selectedNodeId) return new Set<number>();
    const set = new Set<number>();
    for (const span of compiledTs.sourceMap) {
      if (span.canvasNodeId === selectedNodeId) {
        for (let ln = span.startLine; ln <= span.endLine; ln++) {
          set.add(ln);
        }
      }
    }
    return set;
  }, [compiledTs.sourceMap, selectedNodeId]);

  const connectedPinIds = useMemo(() => {
    const ids = new Set<string>();
    for (const w of localGraph.wires) {
      ids.add(w.fromPinId);
      ids.add(w.toPinId);
    }
    return ids;
  }, [localGraph.wires]);

  // Keyboard shortcuts (Space pan + Delete selected node + Escape cancel wire/menu)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const inInput = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (e.code === 'Space' && !inInput) {
        setSpacePressed(true);
      }
      if (e.key === 'Escape') {
        setPaletteMenu((m) => ({ ...m, open: false }));
        setWireDrag(null);
        setArmedPin(null);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !inInput && selectedNodeId) {
        e.preventDefault();
        commitGraphUpdate((g) => ({
          ...g,
          nodes: g.nodes.filter((n) => n.id !== selectedNodeId),
          wires: g.wires.filter((w) => w.fromNodeId !== selectedNodeId && w.toNodeId !== selectedNodeId),
        }));
        setSelectedNodeId(null);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePressed(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [selectedNodeId, commitGraphUpdate]);

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = stageRef.current?.getBoundingClientRect();
      const ox = rect ? clientX - rect.left : clientX;
      const oy = rect ? clientY - rect.top : clientY;
      const { x, y, zoom } = localGraph.viewport;
      return {
        x: (ox - x) / zoom,
        y: (oy - y) / zoom,
      };
    },
    [localGraph.viewport],
  );

  // Connect two pins safely respecting Unreal single-input / single-exec-out semantics
  const connectPins = useCallback(
    (firstNodeId: string, firstPin: BlueprintPin, secondNodeId: string, secondPin: BlueprintPin) => {
      const nodeMap = new Map(localGraph.nodes.map((n) => [n.id, n]));
      const fromEntry =
        firstPin.direction === 'out'
          ? { node: nodeMap.get(firstNodeId), pin: firstPin }
          : { node: nodeMap.get(secondNodeId), pin: secondPin };
      const toEntry =
        firstPin.direction === 'in'
          ? { node: nodeMap.get(firstNodeId), pin: firstPin }
          : { node: nodeMap.get(secondNodeId), pin: secondPin };

      if (!fromEntry.node || !toEntry.node) return false;
      if (!canConnectBlueprintPins(fromEntry.node, fromEntry.pin, toEntry.node, toEntry.pin)) {
        pushToast('warn', `Pin incompatibili (${fromEntry.pin.dataType} -> ${toEntry.pin.dataType})`);
        return false;
      }

      const isExec = fromEntry.pin.dataType === 'exec';
      const newWire: BlueprintWire = {
        id: `bpw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        fromNodeId: fromEntry.node.id,
        fromPinId: fromEntry.pin.id,
        toNodeId: toEntry.node.id,
        toPinId: toEntry.pin.id,
        isExec,
      };

      commitGraphUpdate(
        (g) => {
          const filtered = g.wires.filter((w) => {
            if (w.fromPinId === newWire.fromPinId && w.toPinId === newWire.toPinId) return false;
            // Data inputs accept single incoming wire
            if (!isExec && w.toPinId === newWire.toPinId) return false;
            // Exec outputs drive single outgoing flow
            if (isExec && w.fromPinId === newWire.fromPinId) return false;
            return true;
          });
          return { ...g, wires: [...filtered, newWire] };
        },
        true,
      );
      return true;
    },
    [localGraph.nodes, commitGraphUpdate, pushToast],
  );

  // Global pointer tracking for active Bezier wire drag
  useEffect(() => {
    if (!wireDrag) return;

    const findCompatibleTargetAtWorld = (wx: number, wy: number) => {
      const anchorNode = localGraph.nodes.find((n) => n.id === wireDrag.anchorNodeId);
      if (!anchorNode) return null;
      let best: { nodeId: string; pin: BlueprintPin; x: number; y: number; dist: number } | null = null;

      for (const candidateNode of localGraph.nodes) {
        if (candidateNode.id === anchorNode.id) continue;
        const candidatePins =
          wireDrag.anchorPin.direction === 'out' ? candidateNode.inputs : candidateNode.outputs;
        for (const cPin of candidatePins) {
          const ok =
            wireDrag.anchorPin.direction === 'out'
              ? canConnectBlueprintPins(anchorNode, wireDrag.anchorPin, candidateNode, cPin)
              : canConnectBlueprintPins(candidateNode, cPin, anchorNode, wireDrag.anchorPin);
          if (!ok) continue;
          const pos = getPinWorldPosition(candidateNode, cPin.id);
          if (!pos) continue;
          const dist = Math.hypot(wx - pos.x, wy - pos.y);
          if (dist <= 28 && (!best || dist < best.dist)) {
            best = { nodeId: candidateNode.id, pin: cPin, x: pos.x, y: pos.y, dist };
          }
        }
      }
      return best ? { nodeId: best.nodeId, pin: best.pin, x: best.x, y: best.y } : null;
    };

    const onMove = (ev: PointerEvent) => {
      const w = screenToWorld(ev.clientX, ev.clientY);
      const snapped = findCompatibleTargetAtWorld(w.x, w.y);
      setWireDrag((prev) =>
        prev
          ? {
              ...prev,
              currentX: snapped ? snapped.x : w.x,
              currentY: snapped ? snapped.y : w.y,
              snappedTarget: snapped,
            }
          : null,
      );
    };

    const onUp = (ev: PointerEvent) => {
      const w = screenToWorld(ev.clientX, ev.clientY);
      let target = findCompatibleTargetAtWorld(w.x, w.y);

      if (!target) {
        const hitEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-bp-pin-id]') as HTMLElement | null;
        if (hitEl) {
          const tNodeId = hitEl.getAttribute('data-bp-node-id') || '';
          const tPinId = hitEl.getAttribute('data-bp-pin-id') || '';
          const tNode = localGraph.nodes.find((n) => n.id === tNodeId);
          const tPin = [...(tNode?.inputs ?? []), ...(tNode?.outputs ?? [])].find((p) => p.id === tPinId);
          const pos = tNode && tPin ? getPinWorldPosition(tNode, tPin.id) : null;
          if (tNode && tPin && pos && tNode.id !== wireDrag.anchorNodeId) {
            target = { nodeId: tNode.id, pin: tPin, x: pos.x, y: pos.y };
          }
        }
      }

      const dragDistance = Math.hypot(w.x - wireDrag.startX, w.y - wireDrag.startY);
      if (target) {
        connectPins(wireDrag.anchorNodeId, wireDrag.anchorPin, target.nodeId, target.pin);
        setArmedPin(null);
      } else if (dragDistance < 8) {
        // User clicked a pin: arm it so clicking a second pin also connects cleanly
        setArmedPin({ nodeId: wireDrag.anchorNodeId, pin: wireDrag.anchorPin });
      }
      setWireDrag(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [wireDrag, localGraph.nodes, screenToWorld, connectPins]);

  // Pan viewport on middle-drag, Space+drag, or empty stage left-drag
  const handleStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const isDirectStage = e.target === e.currentTarget || (e.target as HTMLElement).dataset.bpStageLayer === 'true';
    if (paletteMenu.open) {
      setPaletteMenu((m) => ({ ...m, open: false }));
    }
    if (isDirectStage && e.button === 0) {
      setSelectedNodeId(null);
      setArmedPin(null);
    }

    const shouldPan = e.button === 1 || (e.button === 0 && (spacePressed || isDirectStage));
    if (!shouldPan) return;

    e.preventDefault();
    setIsPanning(true);
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startVpX = localGraph.viewport.x;
    const startVpY = localGraph.viewport.y;

    const onMove = (mv: PointerEvent) => {
      const dx = mv.clientX - startClientX;
      const dy = mv.clientY - startClientY;
      reviseLocalGraph((prev) => ({
        ...prev,
        viewport: {
          ...prev.viewport,
          x: Math.round(startVpX + dx),
          y: Math.round(startVpY + dy),
        },
      }));
    };

    const onUp = () => {
      setIsPanning(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (localGraphRef.current.viewport.x !== startVpX || localGraphRef.current.viewport.y !== startVpY) {
        void commitGraphUpdate((graph) => graph);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Wheel Zoom (40% - 180%) anchored around cursor
  const handleStageWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect();
    const cx = rect ? e.clientX - rect.left : 400;
    const cy = rect ? e.clientY - rect.top : 300;

    commitGraphUpdate((prev) => {
      const oldZoom = prev.viewport.zoom;
      const factor = e.deltaY < 0 ? 1.09 : 0.92;
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number((oldZoom * factor).toFixed(3))));
      const worldX = (cx - prev.viewport.x) / oldZoom;
      const worldY = (cy - prev.viewport.y) / oldZoom;
      return {
        ...prev,
        viewport: {
          x: Math.round(cx - worldX * nextZoom),
          y: Math.round(cy - worldY * nextZoom),
          zoom: nextZoom,
        },
      };
    });
  };

  const setZoomStep = (delta: number) => {
    commitGraphUpdate((prev) => {
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number((prev.viewport.zoom + delta).toFixed(2))));
      return { ...prev, viewport: { ...prev.viewport, zoom: nextZoom } };
    });
  };

  const handleFitView = () => {
    if (localGraph.nodes.length === 0) {
      commitGraphUpdate((prev) => ({ ...prev, viewport: { x: 40, y: 40, zoom: 1 } }));
      return;
    }
    const rect = stageRef.current?.getBoundingClientRect();
    const viewW = rect?.width || 920;
    const viewH = rect?.height || 560;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of localGraph.nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + CARD_WIDTH);
      maxY = Math.max(maxY, n.y + estimateCardHeight(n));
    }

    const contentW = Math.max(320, maxX - minX + 96);
    const contentH = Math.max(240, maxY - minY + 96);
    const zoom = Math.max(MIN_ZOOM, Math.min(1.15, Math.min(viewW / contentW, viewH / contentH)));
    const x = Math.round((viewW - (maxX - minX) * zoom) / 2 - minX * zoom);
    const y = Math.round((viewH - (maxY - minY) * zoom) / 2 - minY * zoom);

    commitGraphUpdate((prev) => ({
      ...prev,
      viewport: { x, y, zoom: Number(zoom.toFixed(2)) },
    }));
  };

  // Drag individual Blueprint Card
  const handleCardHeaderPointerDown = (e: React.PointerEvent, node: BlueprintNode) => {
    if (e.button !== 0 || spacePressed) return;
    e.stopPropagation();
    setSelectedNodeId(node.id);
    setPaletteMenu((m) => ({ ...m, open: false }));

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const origX = node.x;
    const origY = node.y;
    const zoom = localGraph.viewport.zoom;
    let moved = false;

    const onMove = (mv: PointerEvent) => {
      const dx = (mv.clientX - startClientX) / zoom;
      const dy = (mv.clientY - startClientY) / zoom;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true;
      const snappedX = Math.round((origX + dx) / 4) * 4;
      const snappedY = Math.round((origY + dy) / 4) * 4;
      reviseLocalGraph((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => (n.id === node.id ? { ...n, x: snappedX, y: snappedY } : n)),
      }));
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved) {
        commitGraphUpdate((prev) => prev, false);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Start Wire Drag or Complete Armed Pin Connection
  const handlePinPointerDown = (e: React.PointerEvent, node: BlueprintNode, pin: BlueprintPin) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    if (armedPin && armedPin.nodeId !== node.id && armedPin.pin.direction !== pin.direction) {
      connectPins(armedPin.nodeId, armedPin.pin, node.id, pin);
      setArmedPin(null);
      return;
    }

    const pos = getPinWorldPosition(node, pin.id);
    if (!pos) return;
    setWireDrag({
      anchorNodeId: node.id,
      anchorPin: pin,
      startX: pos.x,
      startY: pos.y,
      currentX: pos.x,
      currentY: pos.y,
      snappedTarget: null,
    });
  };

  const handleDisconnectPin = (e: React.MouseEvent, pinId: string) => {
    e.preventDefault();
    e.stopPropagation();
    commitGraphUpdate(
      (g) => ({
        ...g,
        wires: g.wires.filter((w) => w.fromPinId !== pinId && w.toPinId !== pinId),
      }),
      true,
    );
  };

  const handleDisconnectWire = (wireId: string) => {
    commitGraphUpdate(
      (g) => ({
        ...g,
        wires: g.wires.filter((w) => w.id !== wireId),
      }),
      true,
    );
  };

  const updatePinDefaultValue = (nodeId: string, pinId: string, nextVal: string | number | boolean) => {
    commitGraphUpdate((g) => ({
      ...g,
      nodes: g.nodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              inputs: n.inputs.map((p) => (p.id === pinId ? { ...p, defaultValue: nextVal } : p)),
            }
          : n,
      ),
    }));
  };

  const updateNodeConfig = (
    nodeId: string,
    patch: Partial<Pick<BlueprintNode, 'targetUiNodeId'>> & { configPatch?: Record<string, string | number | boolean> },
  ) => {
    commitGraphUpdate((g) => ({
      ...g,
      nodes: g.nodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              ...(patch.targetUiNodeId !== undefined ? { targetUiNodeId: patch.targetUiNodeId } : {}),
              config: { ...(n.config ?? {}), ...(patch.configPatch ?? {}) },
            }
          : n,
      ),
    }));
  };

  const handleOpenStageContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect();
    const relX = rect ? Math.min(e.clientX - rect.left, rect.width - 310) : 140;
    const relY = rect ? Math.min(e.clientY - rect.top, Math.max(20, rect.height - 380)) : 80;
    const world = screenToWorld(e.clientX, e.clientY);
    setPaletteSearch('');
    setPaletteMenu({
      open: true,
      screenX: Math.max(12, relX),
      screenY: Math.max(12, relY),
      spawnWorldX: Math.round(world.x),
      spawnWorldY: Math.round(world.y),
    });
  };

  const handleToggleToolbarPalette = () => {
    if (paletteMenu.open) {
      setPaletteMenu((m) => ({ ...m, open: false }));
      return;
    }
    const rect = stageRef.current?.getBoundingClientRect();
    const centerWorld = screenToWorld(
      (rect?.left ?? 200) + (rect?.width ?? 700) * 0.42,
      (rect?.top ?? 120) + (rect?.height ?? 500) * 0.36,
    );
    setPaletteSearch('');
    setPaletteMenu({
      open: true,
      screenX: 16,
      screenY: 12,
      spawnWorldX: Math.round(centerWorld.x + (localGraph.nodes.length % 4) * 26),
      spawnWorldY: Math.round(centerWorld.y + (localGraph.nodes.length % 4) * 22),
    });
  };

  const handleSpawnNode = (kind: BlueprintNodeKind) => {
    const firstUiNode = sheetUiNodes[0];
    const overrides: Parameters<typeof createBlueprintNode>[2] = {};
    if (
      firstUiNode &&
      (kind === 'event_ui_click' ||
        kind === 'event_input_change' ||
        kind === 'ui_set_text' ||
        kind === 'ui_get_input' ||
        kind === 'ui_set_style' ||
        kind === 'ui_set_visibility')
    ) {
      overrides.targetUiNodeId = firstUiNode.id;
      overrides.config =
        kind === 'event_ui_click' || kind === 'event_input_change'
          ? { elementName: firstUiNode.name }
          : { targetName: firstUiNode.name };
    } else if ((kind === 'data_get_var' || kind === 'data_set_var') && localGraph.variables[0]) {
      overrides.config = { varName: localGraph.variables[0].name };
    }

    const created = createBlueprintNode(
      kind,
      { x: paletteMenu.spawnWorldX, y: paletteMenu.spawnWorldY },
      overrides,
    );

    commitGraphUpdate((g) => ({ ...g, nodes: [...g.nodes, created] }), true);
    setSelectedNodeId(created.id);
    setPaletteMenu((m) => ({ ...m, open: false }));
  };

  const handleAddVariable = () => {
    const clean = newVarName.trim().replace(/[^a-zA-Z0-9_]/g, '') || `var_${localGraph.variables.length + 1}`;
    if (localGraph.variables.some((v) => v.name === clean)) {
      pushToast('warn', `La variabile "${clean}" esiste già.`);
      return;
    }
    const initVal = newVarType === 'number' ? 0 : newVarType === 'boolean' ? false : '';
    const v: BlueprintVariable = {
      id: `var_${Date.now().toString(36)}`,
      name: clean,
      type: newVarType,
      initialValue: initVal,
    };
    commitGraphUpdate((g) => ({ ...g, variables: [...g.variables, v] }), true);
    setShowNewVarForm(false);
    setNewVarName('counter');
  };

  // Step-by-step live Blueprint Simulation with animated golden pulses & synced variable state
  const handleRunSimulation = async () => {
    if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    if (simCleanupRef.current) clearTimeout(simCleanupRef.current);

    const { steps, finalVars } = simulateBlueprintExecution(localGraph);

    // Capture original baseline values before first mutation so user can 1-click Reset if desired
    setSimBaselineVars((prev) => {
      const next = { ...prev };
      for (const v of localGraph.variables) {
        if (next[v.name] === undefined) {
          next[v.name] = v.initialValue;
        }
      }
      return next;
    });

    // Sync simulated finalVars directly into localGraph.variables so inputs, compiled TS & VFS stay 100% consistent
    const syncedVariables = localGraph.variables.map((v) => {
      const updated = finalVars[v.name];
      if (updated === undefined) return v;
      const coerced: string | number | boolean =
        v.type === 'number'
          ? Number(updated)
          : v.type === 'boolean'
            ? Boolean(updated)
            : String(updated);
      return { ...v, initialValue: coerced };
    });

    const syncedGraph: BlueprintGraphDocument = {
      ...localGraph,
      variables: syncedVariables,
      updatedAt: Date.now(),
    };
    reviseLocalGraph(() => syncedGraph);
    setSimVars(finalVars);
    await scheduleGraphWrite(syncedGraph, true);
    setBottomConsoleOpen(true);

    if (steps.length === 0) {
      appendConsoleEntry({
        kind: 'warn',
        source: `Blueprint (${localGraph.name})`,
        message: 'Nessun nodo Evento rosso collegato per avviare il flusso.',
      });
      pushToast('warn', 'Aggiungi un nodo Evento rosso per simulare il flusso!');
      return;
    }

    setIsSimulating(true);
    setVisitedSimWireIds([]);

    const activateStep = (step: BlueprintSimStep) => {
      setActiveSimNodeId(step.nodeId);
      setActiveSimWireIds(step.wireIds);
      setVisitedSimWireIds((prev) => Array.from(new Set([...prev, ...step.wireIds])));
      setSimLastStep(step);
      appendConsoleEntry({
        kind: 'blueprint',
        source: `Blueprint • ${localGraph.name}`,
        message: `⚡ ${step.log}`,
        nodeId: step.uiMutation?.targetNodeId,
      });
    };

    // Immediate step 0 for instant visual + E2E responsiveness
    let idx = 0;
    activateStep(steps[0]);

    if (steps.length === 1) {
      simCleanupRef.current = setTimeout(() => {
        setIsSimulating(false);
        setActiveSimNodeId(null);
        setActiveSimWireIds([]);
      }, 900);
      return;
    }

    simIntervalRef.current = setInterval(() => {
      idx += 1;
      if (idx < steps.length) {
        activateStep(steps[idx]);
      } else {
        if (simIntervalRef.current) clearInterval(simIntervalRef.current);
        simIntervalRef.current = null;
        appendConsoleEntry({
          kind: 'blueprint',
          source: `Blueprint • ${localGraph.name}`,
          message: `✅ Simulazione completata (${steps.length} nodi) — Stato finale: ${JSON.stringify(finalVars)}`,
        });
        simCleanupRef.current = setTimeout(() => {
          setIsSimulating(false);
          setActiveSimNodeId(null);
          setActiveSimWireIds([]);
        }, 900);
      }
    }, 270);
  };

  const handleResetSimulatedVars = () => {
    if (Object.keys(simBaselineVars).length === 0) return;
    commitGraphUpdate(
      (g) => ({
        ...g,
        variables: g.variables.map((v) =>
          simBaselineVars[v.name] !== undefined ? { ...v, initialValue: simBaselineVars[v.name] } : v,
        ),
      }),
      true,
    );
    setSimVars({});
    setSimBaselineVars({});
    setSimLastStep(null);
    pushToast('info', 'Variabili Blueprint ripristinate ai valori iniziali.');
  };

  const handleCopyTsCode = async () => {
    try {
      await navigator.clipboard.writeText(editableSource.manual ? editableSource.displayed : compiledTs.code);
      setCopiedCode(true);
      pushToast('success', 'Codice TypeScript Blueprint copiato negli appunti!');
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      pushToast('info', 'Codice pronto nel pannello TypeScript.');
    }
  };

  const filteredCatalog = useMemo(() => {
    const q = paletteSearch.trim().toLowerCase();
    return BLUEPRINT_NODE_CATALOG.filter((tpl) => {
      if (paletteCategoryFilter !== 'all' && tpl.category !== paletteCategoryFilter) return false;
      if (!q) return true;
      return (
        tpl.title.toLowerCase().includes(q) ||
        tpl.subtitle.toLowerCase().includes(q) ||
        tpl.kind.toLowerCase().includes(q)
      );
    });
  }, [paletteSearch, paletteCategoryFilter]);

  const nodeMap = useMemo(() => new Map(localGraph.nodes.map((n) => [n.id, n])), [localGraph.nodes]);

  const { x: vpX, y: vpY, zoom: vpZoom } = localGraph.viewport;
  const minorGrid = Math.max(8, 20 * vpZoom);
  const majorGrid = Math.max(40, 100 * vpZoom);

  const renderNodeConfigControl = (node: BlueprintNode) => {
    const kind = node.kind;
    const cfg = node.config ?? {};

    if (kind === 'event_ui_click' || kind === 'event_input_change') {
      const currentName = String(cfg.elementName ?? '');
      return (
        <select
          className="bp-card-select"
          value={node.targetUiNodeId || currentName}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const val = e.target.value;
            const matched = sheetUiNodes.find((u) => u.id === val || u.name === val);
            if (matched) {
              updateNodeConfig(node.id, {
                targetUiNodeId: matched.id,
                configPatch: { elementName: matched.name },
              });
            } else {
              updateNodeConfig(node.id, { targetUiNodeId: '', configPatch: { elementName: val } });
            }
          }}
        >
          {currentName && !sheetUiNodes.some((u) => u.id === node.targetUiNodeId || u.name === currentName) && (
            <option value={currentName}>🎯 {currentName}</option>
          )}
          {sheetUiNodes.map((u) => (
            <option key={u.id} value={u.id}>
              ⚡ {u.name} ({u.content?.controlType ?? u.kind})
            </option>
          ))}
          {sheetUiNodes.length === 0 && <option value="CreateOrderButton">⚡ CreateOrderButton</option>}
        </select>
      );
    }

    if (
      kind === 'ui_set_text' ||
      kind === 'ui_get_input' ||
      kind === 'ui_set_style' ||
      kind === 'ui_set_visibility'
    ) {
      const currentTarget = String(cfg.targetName ?? '');
      return (
        <select
          className="bp-card-select"
          value={node.targetUiNodeId || currentTarget}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const val = e.target.value;
            const matched = sheetUiNodes.find((u) => u.id === val || u.name === val);
            if (matched) {
              updateNodeConfig(node.id, {
                targetUiNodeId: matched.id,
                configPatch: { targetName: matched.name },
              });
            } else {
              updateNodeConfig(node.id, { targetUiNodeId: '', configPatch: { targetName: val } });
            }
          }}
        >
          {currentTarget && !sheetUiNodes.some((u) => u.id === node.targetUiNodeId || u.name === currentTarget) && (
            <option value={currentTarget}>🎯 {currentTarget}</option>
          )}
          {sheetUiNodes.map((u) => (
            <option key={u.id} value={u.id}>
              🧩 {u.name} ({u.kind})
            </option>
          ))}
          {sheetUiNodes.length === 0 && <option value="OrdersValue">🧩 OrdersValue</option>}
        </select>
      );
    }

    if (kind === 'data_get_var' || kind === 'data_set_var') {
      const currentVar = String(cfg.varName ?? 'orderCount');
      return (
        <select
          className="bp-card-select"
          value={currentVar}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => updateNodeConfig(node.id, { configPatch: { varName: e.target.value } })}
        >
          {!localGraph.variables.some((v) => v.name === currentVar) && (
            <option value={currentVar}>📦 {currentVar}</option>
          )}
          {localGraph.variables.map((v) => (
            <option key={v.id} value={v.name}>
              📦 {v.name} ({v.type})
            </option>
          ))}
        </select>
      );
    }

    if (kind === 'math_op') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
          <span style={{ fontSize: 10.5, color: '#94a3b8' }}>Operatore:</span>
          <select
            className="bp-card-select"
            value={String(cfg.op ?? '+')}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => updateNodeConfig(node.id, { configPatch: { op: e.target.value } })}
          >
            <option value="+">+ (Addizione)</option>
            <option value="-">- (Sottrazione)</option>
            <option value="×">× (Moltiplicazione)</option>
            <option value="÷">÷ (Divisione)</option>
          </select>
        </div>
      );
    }

    if (kind === 'logic_compare') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
          <span style={{ fontSize: 10.5, color: '#94a3b8' }}>Confronto:</span>
          <select
            className="bp-card-select"
            value={String(cfg.op ?? '>')}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => updateNodeConfig(node.id, { configPatch: { op: e.target.value } })}
          >
            <option value="==">== (Uguale)</option>
            <option value="!=">!= (Diverso)</option>
            <option value=">">&gt; (Maggiore)</option>
            <option value="<">&lt; (Minore)</option>
          </select>
        </div>
      );
    }

    if (kind === 'event_key_press') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
          <span style={{ fontSize: 10.5, color: '#94a3b8' }}>Tasto:</span>
          <select
            className="bp-card-select"
            value={String(cfg.key ?? 'Enter')}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => updateNodeConfig(node.id, { configPatch: { key: e.target.value } })}
          >
            <option value="Enter">Enter</option>
            <option value="Escape">Escape</option>
            <option value="Space">Space</option>
            <option value="ArrowUp">ArrowUp</option>
            <option value="ArrowDown">ArrowDown</option>
          </select>
        </div>
      );
    }

    if (kind === 'event_3d_click' || kind === 'three_transform') {
      const curMesh = String(cfg.meshName ?? sceneMeshNames[0] ?? 'HeroMesh');
      return (
        <select
          className="bp-card-select"
          value={curMesh}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => updateNodeConfig(node.id, { configPatch: { meshName: e.target.value } })}
        >
          {!sceneMeshNames.includes(curMesh) && <option value={curMesh}>🧊 {curMesh}</option>}
          {sceneMeshNames.map((m) => (
            <option key={m} value={m}>
              🧊 Mesh 3D: {m}
            </option>
          ))}
        </select>
      );
    }

    if (kind === 'custom_ts_expr') {
      return (
        <input
          type="text"
          className="bp-inline-input"
          style={{ width: '100%', fontFamily: "'JetBrains Mono', monospace" }}
          value={String(cfg.expression ?? '')}
          placeholder="Espressione TS/JS..."
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => updateNodeConfig(node.id, { configPatch: { expression: e.target.value } })}
        />
      );
    }

    return null;
  };

  return (
    <div
      ref={rootRef}
      data-testid="blueprint-editor-view"
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#0b101b',
        color: '#f8fafc',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes bpPulseDash {
          from { stroke-dashoffset: 36; }
          to { stroke-dashoffset: 0; }
        }
        @keyframes bpSimCardGlow {
          0%, 100% { box-shadow: 0 0 0 2px #facc15, 0 0 28px rgba(250, 204, 21, 0.55), 0 14px 32px rgba(0,0,0,0.65); }
          50% { box-shadow: 0 0 0 3px #fef08a, 0 0 38px rgba(250, 204, 21, 0.8), 0 14px 32px rgba(0,0,0,0.65); }
        }
        .bp-card-select {
          width: 100%;
          height: 22px;
          border-radius: 5px;
          background: rgba(9, 13, 22, 0.92);
          border: 1px solid rgba(148, 163, 184, 0.28);
          color: #e2e8f0;
          font-size: 11px;
          padding: 0 6px;
          outline: none;
        }
        .bp-card-select:focus {
          border-color: #3b82f6;
        }
        .bp-inline-input {
          height: 20px;
          border-radius: 4px;
          background: rgba(9, 13, 22, 0.95);
          border: 1px solid rgba(148, 163, 184, 0.32);
          color: #f8fafc;
          font-size: 10.5px;
          padding: 0 5px;
          outline: none;
        }
        .bp-inline-input:focus {
          border-color: #60a5fa;
        }
        .bp-pin-btn {
          width: 18px;
          height: 18px;
          padding: 0;
          border: none;
          background: transparent;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: crosshair;
          border-radius: 4px;
          transition: transform 0.1s ease, background 0.1s ease;
        }
        .bp-pin-btn:hover {
          transform: scale(1.22);
          background: rgba(255, 255, 255, 0.08);
        }
        .bp-palette-item:hover {
          background: rgba(59, 130, 246, 0.18) !important;
          border-color: rgba(96, 165, 250, 0.45) !important;
        }
      `}</style>

      {/* Top Unreal Blueprint Toolbar */}
      <div
        className="canvas-subtoolbar"
        style={{
          background: '#0d1322',
          borderBottom: '1px solid #1e293b',
          gap: 6,
          flexWrap: 'wrap',
          zIndex: 25,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Workflow size={14} color="#f59e0b" />
          <span style={{ fontWeight: 700, fontSize: 12, letterSpacing: '-0.01em' }}>
            Blueprint Graph: {localGraph.name}
          </span>

          {blueprintVfsFiles.length > 1 && (
            <select
              className="studio-select"
              style={{ height: 24, fontSize: 11, padding: '0 6px' }}
              value={vfsEntryId ?? ''}
              onChange={(e) => {
                const found = blueprintVfsFiles.find((f) => f.id === e.target.value);
                if (found) void useStudioStore.getState().openVfsNode(found);
              }}
            >
              {blueprintVfsFiles.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            className="studio-btn sm primary"
            data-testid="btn-add-blueprint-node"
            onClick={handleToggleToolbarPalette}
          >
            <Plus size={12} />
            <span>+ Aggiungi Card Blueprint</span>
          </button>

          <button
            type="button"
            className="studio-btn sm"
            style={{
              background: isSimulating ? 'rgba(245, 158, 11, 0.24)' : 'rgba(16, 185, 129, 0.18)',
              borderColor: isSimulating ? '#f59e0b' : 'rgba(16, 185, 129, 0.5)',
              color: isSimulating ? '#fde047' : '#34d399',
              fontWeight: 700,
            }}
            data-testid="btn-run-blueprint-sim"
            onClick={() => void handleRunSimulation()}
          >
            <Play size={12} />
            <span>{isSimulating ? '⚡ Flusso in Esecuzione...' : '▶ Simula Flusso Blueprint'}</span>
          </button>

          <button
            type="button"
            className={`studio-btn sm ${showCodeDrawer ? 'active' : 'violet'}`}
            data-testid="btn-toggle-blueprint-code"
            onClick={() => setShowCodeDrawer((v) => !v)}
          >
            <Code2 size={12} />
            <span>📜 Codice TS Generato</span>
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <button
            type="button"
            className="studio-btn sm ghost"
            title="Zoom Out"
            onClick={() => setZoomStep(-0.12)}
          >
            <ZoomOut size={12} />
          </button>
          <span
            style={{
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              color: '#94a3b8',
              minWidth: 42,
              textAlign: 'center',
            }}
          >
            {Math.round(vpZoom * 100)}%
          </span>
          <button
            type="button"
            className="studio-btn sm ghost"
            title="Zoom In"
            onClick={() => setZoomStep(0.12)}
          >
            <ZoomIn size={12} />
          </button>
          <button
            type="button"
            className="studio-btn sm ghost"
            data-testid="btn-fit-blueprint-view"
            title="Adatta vista a tutte le card Blueprint"
            onClick={handleFitView}
          >
            <Crosshair size={12} />
            <span>Fit View</span>
          </button>

          <button
            type="button"
            className="studio-btn sm ghost"
            title="Nuovo grafo .blueprint.json"
            onClick={() => setNewBpModalOpen((v) => !v)}
          >
            <FilePlus2 size={12} />
          </button>

          <button
            type="button"
            className="studio-btn sm"
            data-testid="btn-save-blueprint"
            onClick={() => {
              void Promise.resolve(scheduleGraphWrite(localGraphRef.current, true)).then((saved) => {
                if (saved) pushToast('success', `Blueprint "${localGraph.name}" e TypeScript salvati.`);
              });
            }}
          >
            <Save size={12} />
            <span>Salva</span>
          </button>
        </div>
      </div>

      {/* Variables & Simulation Reactive State Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '4px 10px',
          background: '#090e19',
          borderBottom: '1px solid #1e293b',
          fontSize: 11,
          flexWrap: 'wrap',
          zIndex: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ color: '#64748b', fontWeight: 700, fontSize: 10, textTransform: 'uppercase' }}>
            Variabili Stato:
          </span>
          {localGraph.variables.map((v) => {
            const baseline = simBaselineVars[v.name];
            const wasMutatedBySim = baseline !== undefined && baseline !== v.initialValue;
            return (
              <div
                key={v.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '1px 7px',
                  borderRadius: 999,
                  background: wasMutatedBySim ? 'rgba(250, 204, 21, 0.14)' : 'rgba(16, 185, 129, 0.13)',
                  border: `1px solid ${wasMutatedBySim ? 'rgba(250, 204, 21, 0.5)' : 'rgba(16, 185, 129, 0.35)'}`,
                  color: wasMutatedBySim ? '#fde047' : '#6ee7b7',
                }}
              >
                <span style={{ fontWeight: 600 }}>{v.name}</span>
                <span style={{ color: '#94a3b8' }}>=</span>
                <input
                  type={v.type === 'number' ? 'number' : 'text'}
                  data-testid={`bp-var-input-${v.name}`}
                  className="bp-inline-input"
                  style={{
                    width: 62,
                    height: 18,
                    fontSize: 10.5,
                    fontWeight: wasMutatedBySim ? 700 : 500,
                    borderColor: wasMutatedBySim ? 'rgba(250, 204, 21, 0.55)' : undefined,
                  }}
                  value={String(v.initialValue)}
                  onChange={(e) => {
                    const parsed =
                      v.type === 'number'
                        ? Number(e.target.value || 0)
                        : v.type === 'boolean'
                          ? e.target.value === 'true'
                          : e.target.value;
                    setSimVars((prev) => ({ ...prev, [v.name]: parsed }));
                    setSimBaselineVars((prev) => {
                      const copy = { ...prev };
                      delete copy[v.name];
                      return copy;
                    });
                    commitGraphUpdate((g) => ({
                      ...g,
                      variables: g.variables.map((item) =>
                        item.id === v.id ? { ...item, initialValue: parsed } : item,
                      ),
                    }));
                  }}
                />
                {wasMutatedBySim && (
                  <span
                    style={{ color: '#fde047', fontWeight: 700, fontSize: 10 }}
                    title={`Aggiornato dalla simulazione (da ${String(baseline)} a ${String(v.initialValue)})`}
                  >
                    ⚡ da {String(baseline)}
                  </span>
                )}
              </div>
            );
          })}

          {Object.keys(simBaselineVars).length > 0 && (
            <button
              type="button"
              className="studio-btn sm ghost"
              data-testid="btn-reset-blueprint-vars"
              style={{ height: 20, padding: '0 6px', fontSize: 10, color: '#fde047' }}
              title="Ripristina i valori iniziali pre-simulazione"
              onClick={handleResetSimulatedVars}
            >
              ↺ Reset ({Object.values(simBaselineVars)[0] !== undefined ? String(Object.values(simBaselineVars)[0]) : ''})
            </button>
          )}

          {!showNewVarForm ? (
            <button
              type="button"
              className="studio-btn sm ghost"
              style={{ height: 20, padding: '0 6px', fontSize: 10.5 }}
              onClick={() => setShowNewVarForm(true)}
            >
              <Plus size={11} /> Variabile
            </button>
          ) : (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input
                type="text"
                className="bp-inline-input"
                style={{ width: 88 }}
                value={newVarName}
                placeholder="nomeVar"
                onChange={(e) => setNewVarName(e.target.value)}
              />
              <select
                className="bp-card-select"
                style={{ width: 78, height: 20 }}
                value={newVarType}
                onChange={(e) => setNewVarType(e.target.value as 'number' | 'string' | 'boolean')}
              >
                <option value="number">number</option>
                <option value="string">string</option>
                <option value="boolean">boolean</option>
              </select>
              <button type="button" className="studio-btn sm primary" style={{ height: 20 }} onClick={handleAddVariable}>
                OK
              </button>
              <button
                type="button"
                className="studio-btn sm ghost"
                style={{ height: 20 }}
                onClick={() => setShowNewVarForm(false)}
              >
                ×
              </button>
            </div>
          )}

          {newBpModalOpen && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
              <input
                type="text"
                className="bp-inline-input"
                style={{ width: 120 }}
                value={newBpName}
                placeholder="Nome Blueprint..."
                onChange={(e) => setNewBpName(e.target.value)}
              />
              <button
                type="button"
                className="studio-btn sm primary"
                style={{ height: 20 }}
                onClick={() => {
                  void createVfsEntry(newBpName, 'blueprint_graph');
                  setNewBpModalOpen(false);
                }}
              >
                Crea .blueprint
              </button>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#94a3b8', fontSize: 10.5 }}>
          <span>
            {localGraph.nodes.length} card • {localGraph.wires.length} cavi Bezier
          </span>
          <span>Click destro: Nuova Card • Click cavo: Scollega</span>
        </div>
      </div>

      {/* Main Split Body: Infinite Blueprint Stage + Optional Live TypeScript Split Drawer */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: isNarrowLayout ? 'column' : 'row',
          position: 'relative',
        }}
      >
        {/* Infinite Gridded Unreal Viewport */}
        <div
          ref={stageRef}
          data-testid="blueprint-viewport"
          onPointerDown={handleStagePointerDown}
          onWheel={handleStageWheel}
          onContextMenu={handleOpenStageContextMenu}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            position: 'relative',
            overflow: 'hidden',
            cursor: isPanning || spacePressed ? 'grabbing' : 'default',
            backgroundColor: '#0b101b',
            backgroundImage: `
              linear-gradient(to right, rgba(148, 163, 184, 0.13) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(148, 163, 184, 0.13) 1px, transparent 1px),
              linear-gradient(to right, rgba(148, 163, 184, 0.05) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(148, 163, 184, 0.05) 1px, transparent 1px)
            `,
            backgroundSize: `${majorGrid}px ${majorGrid}px, ${majorGrid}px ${majorGrid}px, ${minorGrid}px ${minorGrid}px, ${minorGrid}px ${minorGrid}px`,
            backgroundPosition: `${vpX}px ${vpY}px, ${vpX}px ${vpY}px, ${vpX}px ${vpY}px, ${vpX}px ${vpY}px`,
          }}
        >
          {/* World Transform Container */}
          <div
            data-bp-stage-layer="true"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: '100%',
              height: '100%',
              transform: `translate(${vpX}px, ${vpY}px) scale(${vpZoom})`,
              transformOrigin: '0 0',
            }}
          >
            {/* Cubic Bezier SVG Wire Layer */}
            <svg
              width={4000}
              height={4000}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                overflow: 'visible',
                pointerEvents: 'none',
                zIndex: 4,
              }}
            >
              <defs>
                <filter id="bpWireGlow" x="-25%" y="-25%" width="150%" height="150%">
                  <feGaussianBlur stdDeviation="3.2" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <filter id="bpGoldenPulseGlow" x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur stdDeviation="5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {localGraph.wires.map((wire) => {
                const fromNode = nodeMap.get(wire.fromNodeId);
                const toNode = nodeMap.get(wire.toNodeId);
                if (!fromNode || !toNode) return null;
                const p1 = getPinWorldPosition(fromNode, wire.fromPinId);
                const p2 = getPinWorldPosition(toNode, wire.toPinId);
                if (!p1 || !p2) return null;

                const fromPin = fromNode.outputs.find((p) => p.id === wire.fromPinId);
                const baseColor = BLUEPRINT_PIN_COLORS[fromPin?.dataType ?? (wire.isExec ? 'exec' : 'any')];
                const d = computeBezierWirePath(p1.x, p1.y, p2.x, p2.y);

                const isActivePulse = activeSimWireIds.includes(wire.id);
                const isVisitedPulse = visitedSimWireIds.includes(wire.id);
                const isHovered = hoveredWireId === wire.id;

                return (
                  <g key={wire.id}>
                    {/* Wide invisible hit target to disconnect on click */}
                    <path
                      d={d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={15}
                      style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                      onMouseEnter={() => setHoveredWireId(wire.id)}
                      onMouseLeave={() => setHoveredWireId((cur) => (cur === wire.id ? null : cur))}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDisconnectWire(wire.id);
                      }}
                    >
                      <title>Clicca per scollegare questo cavo Blueprint</title>
                    </path>

                    {/* Soft ambient under-glow */}
                    <path
                      d={d}
                      fill="none"
                      stroke={isActivePulse ? '#facc15' : isHovered ? '#ef4444' : baseColor}
                      strokeWidth={isActivePulse ? 7.5 : wire.isExec ? 5.2 : 4.2}
                      strokeOpacity={isActivePulse ? 0.45 : isHovered ? 0.5 : 0.2}
                      strokeLinecap="round"
                    />

                    {/* Main crisp Unreal Bezier wire */}
                    <path
                      data-testid={`blueprint-wire-${wire.id}`}
                      d={d}
                      fill="none"
                      stroke={
                        isHovered
                          ? '#f87171'
                          : isActivePulse
                            ? '#fef08a'
                            : isVisitedPulse && isSimulating
                              ? '#fbbf24'
                              : baseColor
                      }
                      strokeWidth={isActivePulse ? 3.8 : wire.isExec ? 2.9 : 2.3}
                      strokeLinecap="round"
                      filter={isActivePulse ? 'url(#bpGoldenPulseGlow)' : 'url(#bpWireGlow)'}
                    />

                    {/* Animated golden energy flow pulse when simulating */}
                    {isActivePulse && (
                      <>
                        <path
                          d={d}
                          fill="none"
                          stroke="#ffffff"
                          strokeWidth={2.4}
                          strokeDasharray="10 8"
                          style={{ animation: 'bpPulseDash 0.35s linear infinite' }}
                        />
                        <circle r="5.5" fill="#fde047" filter="url(#bpGoldenPulseGlow)">
                          <animateMotion dur="0.27s" repeatCount="indefinite" path={d} />
                        </circle>
                      </>
                    )}
                  </g>
                );
              })}

              {/* Live In-Progress Dragged Bezier Wire */}
              {wireDrag && (
                <path
                  d={
                    wireDrag.anchorPin.direction === 'out'
                      ? computeBezierWirePath(
                          wireDrag.startX,
                          wireDrag.startY,
                          wireDrag.currentX,
                          wireDrag.currentY,
                        )
                      : computeBezierWirePath(
                          wireDrag.currentX,
                          wireDrag.currentY,
                          wireDrag.startX,
                          wireDrag.startY,
                        )
                  }
                  fill="none"
                  stroke={wireDrag.snappedTarget ? '#fde047' : BLUEPRINT_PIN_COLORS[wireDrag.anchorPin.dataType]}
                  strokeWidth={3}
                  strokeDasharray={wireDrag.snappedTarget ? undefined : '7 5'}
                  filter="url(#bpWireGlow)"
                />
              )}
            </svg>

            {/* Draggable Unreal Blueprint Cards */}
            {localGraph.nodes.map((node) => {
              const catTheme = BLUEPRINT_CATEGORY_THEME[node.category] ?? BLUEPRINT_CATEGORY_THEME.flow;
              const isSelected = selectedNodeId === node.id;
              const isSimActive = activeSimNodeId === node.id;
              const hasCfg = nodeHasConfigBar(node.kind);
              const rowCount = Math.max(node.inputs.length, node.outputs.length, 1);

              return (
                <div
                  key={node.id}
                  data-testid={`blueprint-node-${node.id}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSelectedNodeId(node.id);
                  }}
                  style={{
                    position: 'absolute',
                    left: node.x,
                    top: node.y,
                    width: CARD_WIDTH,
                    borderRadius: 10,
                    background: 'rgba(17, 24, 39, 0.94)',
                    backdropFilter: 'blur(8px)',
                    border: isSimActive
                      ? '1px solid #fde047'
                      : isSelected
                        ? '1px solid #60a5fa'
                        : '1px solid rgba(148, 163, 184, 0.26)',
                    boxShadow: isSimActive
                      ? undefined
                      : isSelected
                        ? '0 0 0 2px rgba(59, 130, 246, 0.45), 0 14px 30px rgba(0, 0, 0, 0.6)'
                        : '0 10px 26px rgba(0, 0, 0, 0.52)',
                    animation: isSimActive ? 'bpSimCardGlow 0.55s ease-in-out infinite' : undefined,
                    zIndex: isSimActive ? 14 : isSelected ? 12 : 8,
                    overflow: 'hidden',
                    userSelect: 'none',
                  }}
                >
                  {/* Glossy Unreal Header */}
                  <div
                    onPointerDown={(e) => handleCardHeaderPointerDown(e, node)}
                    style={{
                      height: HEADER_H,
                      padding: '0 10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
                      cursor: 'grab',
                      background: `linear-gradient(135deg, ${catTheme.gradient[0]} 0%, ${catTheme.gradient[1]} 100%)`,
                      boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.32)',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.14)',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: '#ffffff',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          textShadow: '0 1px 2px rgba(0,0,0,0.45)',
                        }}
                      >
                        {CATEGORY_DOT[node.category]} {node.title}
                      </div>
                      {node.subtitle && (
                        <div
                          style={{
                            fontSize: 9.5,
                            color: 'rgba(255,255,255,0.82)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {node.subtitle}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      title="Elimina Card Blueprint"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        commitGraphUpdate(
                          (g) => ({
                            ...g,
                            nodes: g.nodes.filter((n) => n.id !== node.id),
                            wires: g.wires.filter((w) => w.fromNodeId !== node.id && w.toNodeId !== node.id),
                          }),
                          true,
                        );
                        if (selectedNodeId === node.id) setSelectedNodeId(null);
                      }}
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 4,
                        border: 'none',
                        background: 'rgba(0,0,0,0.22)',
                        color: '#ffffff',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      <X size={11} />
                    </button>
                  </div>

                  {/* Fixed-Height Config Row (Target UI Element / Variable / Operator) */}
                  {hasCfg && (
                    <div
                      style={{
                        height: CONFIG_H,
                        padding: '0 9px',
                        display: 'flex',
                        alignItems: 'center',
                        background: 'rgba(11, 16, 27, 0.72)',
                        borderBottom: '1px solid rgba(148, 163, 184, 0.14)',
                      }}
                    >
                      {renderNodeConfigControl(node)}
                    </div>
                  )}

                  {/* Fixed-Row-Height Pin Matrix (Guarantees Sub-Pixel Bezier Alignment) */}
                  <div style={{ paddingTop: BODY_PAD_TOP, paddingBottom: BODY_PAD_TOP }}>
                    {Array.from({ length: rowCount }).map((_, rowIdx) => {
                      const inPin = node.inputs[rowIdx];
                      const outPin = node.outputs[rowIdx];
                      const inConnected = inPin ? connectedPinIds.has(inPin.id) : false;
                      const outConnected = outPin ? connectedPinIds.has(outPin.id) : false;
                      const inHighlighted =
                        (inPin && wireDrag?.snappedTarget?.pin.id === inPin.id) ||
                        (inPin && armedPin?.pin.id === inPin.id);
                      const outHighlighted =
                        (outPin && wireDrag?.snappedTarget?.pin.id === outPin.id) ||
                        (outPin && armedPin?.pin.id === outPin.id);

                      return (
                        <div
                          key={rowIdx}
                          style={{
                            height: PIN_ROW_H,
                            minHeight: PIN_ROW_H,
                            maxHeight: PIN_ROW_H,
                            padding: '0 6px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 6,
                          }}
                        >
                          {/* Left Input Pin + Inline Default Value Editor */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: 1 }}>
                            {inPin && (
                              <>
                                <button
                                  type="button"
                                  className="bp-pin-btn"
                                  data-testid={`blueprint-pin-${inPin.id}`}
                                  data-bp-node-id={node.id}
                                  data-bp-pin-id={inPin.id}
                                  data-bp-pin-dir="in"
                                  title={`${inPin.label} (${inPin.dataType}) — Trascina per collegare, click destro per scollegare`}
                                  onPointerDown={(e) => handlePinPointerDown(e, node, inPin)}
                                  onContextMenu={(e) => handleDisconnectPin(e, inPin.id)}
                                >
                                  <PinGlyph
                                    dataType={inPin.dataType}
                                    connected={inConnected}
                                    highlighted={Boolean(inHighlighted)}
                                  />
                                </button>
                                <span
                                  style={{
                                    fontSize: 11,
                                    color: '#cbd5e1',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {inPin.label}
                                </span>

                                {!inConnected && inPin.dataType !== 'exec' && (
                                  <>
                                    {inPin.dataType === 'boolean' ? (
                                      <input
                                        type="checkbox"
                                        checked={Boolean(inPin.defaultValue)}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onChange={(e) => updatePinDefaultValue(node.id, inPin.id, e.target.checked)}
                                        style={{ accentColor: '#ef4444', cursor: 'pointer' }}
                                      />
                                    ) : inPin.dataType === 'number' ? (
                                      <input
                                        type="number"
                                        className="bp-inline-input"
                                        style={{ width: 56 }}
                                        value={Number(inPin.defaultValue ?? 0)}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onChange={(e) =>
                                          updatePinDefaultValue(node.id, inPin.id, Number(e.target.value || 0))
                                        }
                                      />
                                    ) : (
                                      <input
                                        type="text"
                                        className="bp-inline-input"
                                        style={{ width: 84, minWidth: 44 }}
                                        value={String(inPin.defaultValue ?? '')}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onChange={(e) => updatePinDefaultValue(node.id, inPin.id, e.target.value)}
                                      />
                                    )}
                                  </>
                                )}
                              </>
                            )}
                          </div>

                          {/* Right Output Pin */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                            {outPin && (
                              <>
                                <span
                                  style={{
                                    fontSize: 11,
                                    color: '#e2e8f0',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {outPin.label}
                                </span>
                                <button
                                  type="button"
                                  className="bp-pin-btn"
                                  data-testid={`blueprint-pin-${outPin.id}`}
                                  data-bp-node-id={node.id}
                                  data-bp-pin-id={outPin.id}
                                  data-bp-pin-dir="out"
                                  title={`${outPin.label} (${outPin.dataType}) — Trascina verso un pin di input`}
                                  onPointerDown={(e) => handlePinPointerDown(e, node, outPin)}
                                  onContextMenu={(e) => handleDisconnectPin(e, outPin.id)}
                                >
                                  <PinGlyph
                                    dataType={outPin.dataType}
                                    connected={outConnected}
                                    highlighted={Boolean(outHighlighted)}
                                  />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Unreal Context / Add Card Palette Popover */}
          {paletteMenu.open && (
            <div
              data-testid="blueprint-node-palette"
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                left: paletteMenu.screenX,
                top: paletteMenu.screenY,
                width: 318,
                maxHeight: 410,
                borderRadius: 10,
                background: 'rgba(13, 19, 33, 0.98)',
                border: '1px solid #334155',
                boxShadow: '0 18px 42px rgba(0, 0, 0, 0.72)',
                display: 'flex',
                flexDirection: 'column',
                zIndex: 40,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  padding: '8px 10px',
                  borderBottom: '1px solid #1e293b',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Search size={13} color="#94a3b8" />
                <input
                  type="text"
                  autoFocus
                  placeholder="Cerca azione o evento Blueprint..."
                  value={paletteSearch}
                  onChange={(e) => setPaletteSearch(e.target.value)}
                  style={{
                    flex: 1,
                    border: 'none',
                    background: 'transparent',
                    color: '#f8fafc',
                    fontSize: 12,
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  className="studio-btn sm ghost"
                  style={{ height: 20, padding: '0 4px' }}
                  onClick={() => setPaletteMenu((m) => ({ ...m, open: false }))}
                >
                  <X size={12} />
                </button>
              </div>

              {/* Category Filter Chips */}
              <div
                style={{
                  display: 'flex',
                  gap: 4,
                  padding: '6px 8px',
                  borderBottom: '1px solid #1e293b',
                  flexWrap: 'wrap',
                }}
              >
                <button
                  type="button"
                  className={`studio-btn sm ${paletteCategoryFilter === 'all' ? 'active' : 'ghost'}`}
                  style={{ height: 20, fontSize: 10, padding: '0 6px' }}
                  onClick={() => setPaletteCategoryFilter('all')}
                >
                  Tutte ({BLUEPRINT_NODE_CATALOG.length})
                </button>
                {CATEGORY_ORDER.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={`studio-btn sm ${paletteCategoryFilter === cat ? 'active' : 'ghost'}`}
                    style={{ height: 20, fontSize: 10, padding: '0 6px' }}
                    onClick={() => setPaletteCategoryFilter(cat)}
                  >
                    {CATEGORY_DOT[cat]} {BLUEPRINT_CATEGORY_THEME[cat].label}
                  </button>
                ))}
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
                {CATEGORY_ORDER.map((cat) => {
                  const items = filteredCatalog.filter((t) => t.category === cat);
                  if (items.length === 0) return null;
                  return (
                    <div key={cat} style={{ marginBottom: 8 }}>
                      <div
                        style={{
                          padding: '3px 6px',
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          color: BLUEPRINT_CATEGORY_THEME[cat].accent,
                        }}
                      >
                        {CATEGORY_DOT[cat]} {BLUEPRINT_CATEGORY_THEME[cat].label}
                      </div>
                      {items.map((tpl) => (
                        <button
                          key={tpl.kind}
                          type="button"
                          className="bp-palette-item"
                          data-testid={`btn-spawn-bp-${tpl.kind}`}
                          onClick={() => handleSpawnNode(tpl.kind)}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            padding: '6px 8px',
                            marginBottom: 3,
                            borderRadius: 6,
                            border: '1px solid transparent',
                            background: 'rgba(30, 41, 59, 0.35)',
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 1,
                          }}
                        >
                          <span style={{ fontSize: 11.5, fontWeight: 600, color: '#f1f5f9' }}>{tpl.title}</span>
                          <span style={{ fontSize: 10, color: '#94a3b8' }}>{tpl.subtitle}</span>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Simulation HUD Banner */}
          {simLastStep && (
            <div
              style={{
                position: 'absolute',
                left: 14,
                bottom: 14,
                padding: '7px 12px',
                borderRadius: 8,
                background: 'rgba(15, 23, 42, 0.92)',
                border: `1px solid ${isSimulating ? '#facc15' : 'rgba(59, 130, 246, 0.45)'}`,
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 11.5,
                zIndex: 25,
              }}
            >
              <Sparkles size={13} color="#fde047" />
              <span style={{ color: '#fde047', fontWeight: 700 }}>
                {isSimulating ? 'Simulazione Step:' : 'Ultimo Flusso:'}
              </span>
              <span style={{ color: '#f8fafc', fontFamily: "'JetBrains Mono', monospace" }}>{simLastStep.log}</span>
              <button
                type="button"
                className="studio-btn sm ghost"
                style={{ height: 18, padding: '0 4px' }}
                onClick={() => setSimLastStep(null)}
              >
                <X size={11} />
              </button>
            </div>
          )}

          {/* Classic Unreal Engine Corner Watermark */}
          <div
            style={{
              position: 'absolute',
              right: 16,
              bottom: 12,
              fontSize: 15,
              fontWeight: 800,
              letterSpacing: '0.08em',
              color: 'rgba(148, 163, 184, 0.16)',
              pointerEvents: 'none',
              textTransform: 'uppercase',
            }}
          >
            BLUEPRINT • {localGraph.name}
          </div>
        </div>

        {/* Live Compiled TypeScript Split Drawer */}
        {showCodeDrawer && (
          <aside
            data-testid="blueprint-code-drawer"
            style={{
              width: isNarrowLayout ? '100%' : 380,
              minWidth: isNarrowLayout ? 0 : 280,
              maxWidth: isNarrowLayout ? '100%' : '46%',
              height: isNarrowLayout ? 210 : undefined,
              borderLeft: isNarrowLayout ? 'none' : '1px solid #1e293b',
              borderTop: isNarrowLayout ? '1px solid #1e293b' : 'none',
              background: '#090d16',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              zIndex: 22,
            }}
          >
            <div
              style={{
                padding: '7px 10px',
                borderBottom: '1px solid #1e293b',
                background: '#0d1320',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <Code2 size={13} color="#8b5cf6" />
                <span style={{ fontWeight: 700, fontSize: 11.5 }}>
                  {editableSource.manual ? `generated/${manualFileName}` : 'Blueprint TypeScript'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="studio-btn sm"
                  data-testid="btn-edit-blueprint-code"
                  disabled={editableSource.busy}
                  onClick={() => editableSource.manual ? editableSource.setManual(false) : void editableSource.open()}
                >
                  {editableSource.manual ? 'Vista grafo' : 'Modifica TS'}
                </button>
                {editableSource.manual && <button
                  type="button"
                  className="studio-btn sm primary"
                  data-testid="btn-save-blueprint-code"
                  disabled={!editableSource.canSave || editableSource.busy}
                  onClick={() => void editableSource.save()}
                ><Save size={11} /> Salva TS</button>}
                <button type="button" className="studio-btn sm" onClick={() => void handleCopyTsCode()}>
                  {copiedCode ? <Check size={11} color="#10b981" /> : <Copy size={11} />}
                  <span>{copiedCode ? 'Copiato' : 'Copia TS'}</span>
                </button>
                <button
                  type="button"
                  className="studio-btn sm ghost"
                  onClick={() => setShowCodeDrawer(false)}
                  title="Chiudi codice generato"
                >
                  <X size={12} />
                </button>
              </div>
            </div>

            {editableSource.manual && <div style={{ padding: '4px 10px', color: 'var(--text-secondary)', fontSize: 11 }}>
              Il file TS è modificabile e il simulatore continua a usare il grafo visuale.
            </div>}

            {!editableSource.manual && selectedNodeId && (
              <div
                style={{
                  padding: '4px 10px',
                  fontSize: 10.5,
                  background: 'rgba(59, 130, 246, 0.12)',
                  borderBottom: '1px solid rgba(59, 130, 246, 0.25)',
                  color: '#93c5fd',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span>Card evidenziata: {nodeMap.get(selectedNodeId)?.title ?? selectedNodeId}</span>
                <button
                  type="button"
                  className="studio-btn sm danger"
                  style={{ height: 18, padding: '0 6px', fontSize: 10 }}
                  onClick={() => {
                    commitGraphUpdate(
                      (g) => ({
                        ...g,
                        nodes: g.nodes.filter((n) => n.id !== selectedNodeId),
                        wires: g.wires.filter(
                          (w) => w.fromNodeId !== selectedNodeId && w.toNodeId !== selectedNodeId,
                        ),
                      }),
                      true,
                    );
                    setSelectedNodeId(null);
                  }}
                >
                  <Trash2 size={10} /> Elimina Card
                </button>
              </div>
            )}

            {editableSource.manual ? <GeneratedSourceTextarea
              label="Sorgente TypeScript Blueprint"
              testId="blueprint-code-editor"
              value={editableSource.displayed}
              saving={editableSource.busy}
              onChange={editableSource.update}
              onSave={() => void editableSource.save()}
            /> : <div
              className="selectable-text"
              style={{
                flex: 1,
                overflow: 'auto',
                padding: '8px 0',
                fontFamily: "'JetBrains Mono', Consolas, monospace",
                fontSize: 11.5,
                lineHeight: 1.58,
              }}
            >
              {compiledTs.code.split('\n').map((line, idx) => {
                const lineNo = idx + 1;
                const isHi = highlightedCodeLines.has(lineNo);
                const matchingSpan = compiledTs.sourceMap.find(
                  (sp) => lineNo >= sp.startLine && lineNo <= sp.endLine,
                );
                return (
                  <div
                    key={lineNo}
                    onClick={() => {
                      if (matchingSpan) setSelectedNodeId(matchingSpan.canvasNodeId);
                    }}
                    style={{
                      display: 'flex',
                      padding: '0 10px',
                      cursor: matchingSpan ? 'pointer' : 'text',
                      background: isHi ? 'rgba(59, 130, 246, 0.22)' : 'transparent',
                      borderLeft: isHi ? '3px solid #60a5fa' : '3px solid transparent',
                    }}
                  >
                    <span
                      style={{
                        width: 30,
                        flexShrink: 0,
                        color: '#475569',
                        textAlign: 'right',
                        paddingRight: 10,
                        userSelect: 'none',
                      }}
                    >
                      {lineNo}
                    </span>
                    <span
                      style={{
                        whiteSpace: 'pre',
                        color: line.trim().startsWith('//')
                          ? '#64748b'
                          : line.includes('export async function')
                            ? '#c084fc'
                            : '#e2e8f0',
                      }}
                    >
                      {line || ' '}
                    </span>
                  </div>
                );
              })}
            </div>}
          </aside>
        )}
      </div>
    </div>
  );
};
