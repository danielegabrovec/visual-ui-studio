import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  Box,
  Check,
  Code2,
  Columns2,
  Copy,
  Eye,
  EyeOff,
  Grid3x3,
  Layers,
  Lightbulb,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Rows2,
  Save,
  Sparkles,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import {
  compileThreeSceneToCode,
  createDefaultMaterial,
  createThreeLightObject,
  createThreeMeshObject,
  createThreeSceneFromPreset,
  THREE_SCENE_PRESETS,
  type ThreeAnimationKind,
  type ThreeCodeExportFormat,
  type ThreeGeometryKind,
  type ThreeLightKind,
  type ThreeMaterialKind,
  type ThreeMaterialSpec,
  type ThreeObjectNode,
  type ThreePresetId,
  type ThreeSceneDocument,
  type Vec3Tuple,
} from '@shared/three-ir';
import { useStudioStore } from '@renderer/state/studio-store';
import { GeneratedSourceTextarea, useGeneratedSourceEditor } from './GeneratedSourceEditor';
import {
  applyCameraRigToPerspective,
  canCreateWebGLRenderer,
  createCameraRigFromSpec,
  createManagedThreeScene,
  disposeManagedThreeScene,
  orbitCameraRig,
  panCameraRig,
  raycastThreeSceneObject,
  renderSoftwareFallback3D,
  stepThreeSceneAnimations,
  syncSceneDocumentToThree,
  zoomCameraRig,
  type ManagedThreeSceneState,
  type SphericalCameraRig,
} from './ThreeEmbeddedPreview';

export interface ThreeSceneStudioViewProps {
  vfsEntryId?: string;
  sceneId?: string;
  sheetId?: string;
}

const ADD_MESH_BUTTONS: Array<{ geometry: ThreeGeometryKind; label: string; color: string }> = [
  { geometry: 'box', label: '+ Cubo', color: '#3b82f6' },
  { geometry: 'sphere', label: '+ Sfera', color: '#06b6d4' },
  { geometry: 'cylinder', label: '+ Cilindro', color: '#8b5cf6' },
  { geometry: 'cone', label: '+ Cono', color: '#f59e0b' },
  { geometry: 'torus', label: '+ Torus', color: '#ec4899' },
  { geometry: 'torusKnot', label: '+ TorusKnot', color: '#6366f1' },
  { geometry: 'plane', label: '+ Piano', color: '#475569' },
  { geometry: 'icosahedron', label: '+ Icosaedro', color: '#10b981' },
  { geometry: 'particles', label: '+ Particelle Stelle', color: '#e0f2fe' },
];

const ADD_LIGHT_BUTTONS: Array<{ lightKind: ThreeLightKind; label: string }> = [
  { lightKind: 'directional', label: '+ Luce Direzionale' },
  { lightKind: 'point', label: '+ Luce Point' },
  { lightKind: 'spot', label: '+ Luce Spot' },
];

interface Vec3ControlGroupProps {
  title: string;
  value: Vec3Tuple;
  min: number;
  max: number;
  step: number;
  unit?: string;
  testIdPrefix: string;
  onChange: (next: Vec3Tuple) => void;
}

const Vec3ControlGroup: React.FC<Vec3ControlGroupProps> = ({
  title,
  value,
  min,
  max,
  step,
  unit = '',
  testIdPrefix,
  onChange,
}) => {
  const axes: Array<{ key: keyof Vec3Tuple; label: string; accent: string }> = [
    { key: 'x', label: 'X', accent: '#ef4444' },
    { key: 'y', label: 'Y', accent: '#22c55e' },
    { key: 'z', label: 'Z', accent: '#3b82f6' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-secondary)' }}>
        {title}
      </span>
      {axes.map((ax) => {
        const numVal = Number.isFinite(value[ax.key]) ? value[ax.key] : 0;
        return (
          <div
            key={ax.key}
            style={{
              display: 'grid',
              gridTemplateColumns: '16px minmax(0, 1fr) 58px',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                color: ax.accent,
                textAlign: 'center',
              }}
            >
              {ax.label}
            </span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={Math.max(min, Math.min(max, numVal))}
              aria-label={`${title} ${ax.label}`}
              onChange={(e) =>
                onChange({
                  ...value,
                  [ax.key]: Number(parseFloat(e.target.value).toFixed(2)),
                })
              }
              style={{ width: '100%', accentColor: ax.accent, cursor: 'pointer', height: 14 }}
            />
            <input
              type="number"
              step={step}
              data-testid={`${testIdPrefix}-${ax.key}`}
              className="studio-input"
              value={numVal}
              title={`${title} ${ax.label}${unit}`}
              onChange={(e) => {
                const parsed = parseFloat(e.target.value);
                if (!Number.isNaN(parsed)) {
                  onChange({ ...value, [ax.key]: parsed });
                }
              }}
              style={{
                height: 22,
                padding: '2px 5px',
                fontSize: 11,
                textAlign: 'right',
                fontFamily: "'JetBrains Mono', Consolas, monospace",
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

export const ThreeSceneStudioView: React.FC<ThreeSceneStudioViewProps> = ({
  vfsEntryId,
  sceneId,
}) => {
  const studioRootRef = useRef<HTMLDivElement | null>(null);
  const viewportHostRef = useRef<HTMLDivElement | null>(null);
  const codeScrollRef = useRef<HTMLDivElement | null>(null);

  const project = useStudioStore((s) => s.project);
  const threeScenes = useStudioStore((s) => s.threeScenes);
  const activeThreeSceneId = useStudioStore((s) => s.activeThreeSceneId);

  const ensureActiveThreeScene = useStudioStore((s) => s.ensureActiveThreeScene);
  const saveThreeScene = useStudioStore((s) => s.saveThreeScene);
  const embedThreeSceneInActiveSheet = useStudioStore((s) => s.embedThreeSceneInActiveSheet);
  const pushToast = useStudioStore((s) => s.pushToast);
  const appendConsoleEntry = useStudioStore((s) => s.appendConsoleEntry);

  const resolvedSceneId = sceneId ?? activeThreeSceneId ?? undefined;

  const fallbackInitialScene = useMemo(
    () =>
      createThreeSceneFromPreset(
        project?.id ?? 'proj_studio',
        'pbr-product-showcase',
        resolvedSceneId,
      ),
    [project?.id, resolvedSceneId],
  );

  const sceneDoc: ThreeSceneDocument = useMemo(() => {
    if (resolvedSceneId && threeScenes[resolvedSceneId]) {
      return threeScenes[resolvedSceneId];
    }
    if (activeThreeSceneId && threeScenes[activeThreeSceneId]) {
      return threeScenes[activeThreeSceneId];
    }
    const first = Object.values(threeScenes)[0];
    return first ?? fallbackInitialScene;
  }, [resolvedSceneId, threeScenes, activeThreeSceneId, fallbackInitialScene]);

  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(() => {
    const firstMesh = sceneDoc.objects.find((o) => o.nodeType === 'mesh') ?? sceneDoc.objects[0];
    return firstMesh?.id ?? null;
  });
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [renderBackend, setRenderBackend] = useState<'webgl' | 'software'>('webgl');
  const [codeFormat, setCodeFormat] = useState<ThreeCodeExportFormat>('three-ts');
  const [isNarrowContainer, setIsNarrowContainer] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 1120 : false,
  );
  const [showInspectorDock, setShowInspectorDock] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1120 : true,
  );
  const [showCodePanel, setShowCodePanel] = useState<boolean>(true);
  const [codeSplitDirection, setCodeSplitDirection] = useState<'right' | 'bottom'>('right');
  const [userToggledSplitDir, setUserToggledSplitDir] = useState<boolean>(false);
  const [copiedFlag, setCopiedFlag] = useState<boolean>(false);
  const [savingVfs, setSavingVfs] = useState<boolean>(false);

  const userToggledInspectorRef = useRef<boolean>(false);
  const effectiveSplitDir: 'right' | 'bottom' = userToggledSplitDir
    ? codeSplitDirection
    : isNarrowContainer
      ? 'bottom'
      : codeSplitDirection;

  // Observe 3D Studio container width (< 820px -> auto-collapse Outliner & stack Viewport above Code)
  useLayoutEffect(() => {
    const rootEl = studioRootRef.current;
    if (!rootEl) return;

    const applyWidth = (w: number) => {
      if (w <= 0) return;
      const narrow = w < 820;
      setIsNarrowContainer(narrow);
      if (!userToggledInspectorRef.current) {
        setShowInspectorDock(!narrow);
      }
    };

    applyWidth(rootEl.clientWidth);

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) {
        applyWidth(rect.width);
      }
    });
    ro.observe(rootEl);
    return () => ro.disconnect();
  }, []);

  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSceneRef = useRef<ThreeSceneDocument>(sceneDoc);
  latestSceneRef.current = sceneDoc;

  const selectedIdRef = useRef<string | null>(selectedObjectId);
  selectedIdRef.current = selectedObjectId;

  const isPlayingRef = useRef<boolean>(isPlaying);
  isPlayingRef.current = isPlaying;

  const managedRef = useRef<ManagedThreeSceneState | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rigRef = useRef<SphericalCameraRig>(createCameraRigFromSpec(sceneDoc.camera));
  const fallbackHitRegionsRef = useRef<Array<{ id: string; cx: number; cy: number; hitRadius: number }>>([]);

  // Ensure an active ThreeSceneDocument is registered in store/VFS on mount
  useEffect(() => {
    if (!resolvedSceneId || !threeScenes[resolvedSceneId]) {
      void ensureActiveThreeScene();
    }
  }, [resolvedSceneId, threeScenes, ensureActiveThreeScene]);

  // Keep selectedObjectId valid when scene switches or objects change
  useEffect(() => {
    if (selectedObjectId && sceneDoc.objects.some((o) => o.id === selectedObjectId)) {
      return;
    }
    const nextDefault = sceneDoc.objects.find((o) => o.nodeType === 'mesh') ?? sceneDoc.objects[0];
    setSelectedObjectId(nextDefault?.id ?? null);
  }, [sceneDoc.id, sceneDoc.objects, selectedObjectId]);

  // Commit helper: updates Zustand store at 60fps immediately & debounces VFS persistence
  const commitSceneUpdate = useCallback(
    (nextScene: ThreeSceneDocument, immediateVfs = false) => {
      const stamped: ThreeSceneDocument = { ...nextScene, updatedAt: Date.now() };
      latestSceneRef.current = stamped;
      useStudioStore.setState((s) => ({
        threeScenes: { ...s.threeScenes, [stamped.id]: stamped },
        activeThreeSceneId: stamped.id,
      }));

      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current);
        saveDebounceRef.current = null;
      }

      if (immediateVfs) {
        void saveThreeScene(stamped, vfsEntryId);
      } else {
        saveDebounceRef.current = setTimeout(() => {
          void saveThreeScene(latestSceneRef.current, vfsEntryId);
          saveDebounceRef.current = null;
        }, 140);
      }
    },
    [saveThreeScene, vfsEntryId],
  );

  useEffect(() => {
    return () => {
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current);
        void saveThreeScene(latestSceneRef.current, vfsEntryId);
      }
    };
  }, [saveThreeScene, vfsEntryId]);

  // Sync ThreeSceneDocument + selection -> live THREE.Scene graph
  useEffect(() => {
    if (!managedRef.current) return;
    syncSceneDocumentToThree(managedRef.current, sceneDoc, selectedObjectId, true);
  }, [sceneDoc, selectedObjectId]);

  // Mount WebGLRenderer (or graceful 2D software fallback) + RAF animation loop
  useEffect(() => {
    const container = viewportHostRef.current;
    if (!container) return;

    const managed = createManagedThreeScene();
    managedRef.current = managed;

    const initW = Math.max(180, container.clientWidth || 520);
    const initH = Math.max(160, container.clientHeight || 380);
    const camera = new THREE.PerspectiveCamera(
      latestSceneRef.current.camera.fov || 48,
      initW / initH,
      0.1,
      250,
    );
    cameraRef.current = camera;
    rigRef.current = createCameraRigFromSpec(latestSceneRef.current.camera);
    applyCameraRigToPerspective(camera, rigRef.current);

    syncSceneDocumentToThree(managed, latestSceneRef.current, selectedIdRef.current, true);

    let webglRenderer: THREE.WebGLRenderer | null = null;
    let fallbackCanvas: HTMLCanvasElement | null = null;
    let fallbackCtx: CanvasRenderingContext2D | null = null;

    if (canCreateWebGLRenderer()) {
      try {
        webglRenderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
        });
        webglRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        webglRenderer.setSize(initW, initH, false);
        webglRenderer.shadowMap.enabled = true;
        webglRenderer.shadowMap.type = THREE.PCFShadowMap;
        webglRenderer.toneMapping = THREE.ACESFilmicToneMapping;
        webglRenderer.toneMappingExposure = 1.12;
        webglRenderer.domElement.dataset.testid = 'three-webgl-canvas';
        webglRenderer.domElement.style.width = '100%';
        webglRenderer.domElement.style.height = '100%';
        webglRenderer.domElement.style.display = 'block';
        container.appendChild(webglRenderer.domElement);
        setRenderBackend('webgl');
      } catch {
        webglRenderer = null;
      }
    }

    if (!webglRenderer) {
      fallbackCanvas = document.createElement('canvas');
      fallbackCanvas.dataset.testid = 'three-fallback-canvas';
      fallbackCanvas.width = initW;
      fallbackCanvas.height = initH;
      fallbackCanvas.style.width = '100%';
      fallbackCanvas.style.height = '100%';
      fallbackCanvas.style.display = 'block';
      fallbackCtx = fallbackCanvas.getContext('2d');
      container.appendChild(fallbackCanvas);
      setRenderBackend('software');
    }

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver((entries) => {
            const rect = entries[0]?.contentRect;
            if (!rect) return;
            const w = Math.max(80, Math.floor(rect.width));
            const h = Math.max(80, Math.floor(rect.height));
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            if (webglRenderer) {
              webglRenderer.setSize(w, h, false);
            } else if (fallbackCanvas) {
              fallbackCanvas.width = w;
              fallbackCanvas.height = h;
            }
          })
        : null;
    resizeObserver?.observe(container);

    let lastMs = performance.now();
    let animElapsedSec = 0;
    let rafId = 0;

    const animate = (nowMs: number) => {
      rafId = requestAnimationFrame(animate);
      const dt = Math.min(0.1, Math.max(0, (nowMs - lastMs) * 0.001));
      lastMs = nowMs;

      if (isPlayingRef.current) {
        animElapsedSec += dt;
      }

      applyCameraRigToPerspective(camera, rigRef.current);
      stepThreeSceneAnimations(managed, latestSceneRef.current, animElapsedSec);

      if (webglRenderer) {
        webglRenderer.render(managed.scene, camera);
      } else if (fallbackCtx && fallbackCanvas) {
        fallbackHitRegionsRef.current = renderSoftwareFallback3D(
          fallbackCtx,
          fallbackCanvas.width,
          fallbackCanvas.height,
          latestSceneRef.current,
          managed,
          camera,
          selectedIdRef.current,
        );
      }
    };
    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      disposeManagedThreeScene(managed);
      managedRef.current = null;
      cameraRef.current = null;
      if (webglRenderer) {
        webglRenderer.dispose();
        webglRenderer.domElement.remove();
      }
      if (fallbackCanvas) {
        fallbackCanvas.remove();
      }
    };
  }, []);

  // Viewport Orbit / Pan / Raycaster Click-to-Select Interaction
  const handleViewportPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const stageEl = viewportHostRef.current;
    if (!stageEl) return;

    const isPanGesture = e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey);
    const isOrbitGesture = e.button === 0 && !e.shiftKey;
    if (!isPanGesture && !isOrbitGesture) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let prevX = startX;
    let prevY = startY;
    let totalTravel = 0;

    const onPointerMove = (ev: PointerEvent) => {
      const dx = ev.clientX - prevX;
      const dy = ev.clientY - prevY;
      prevX = ev.clientX;
      prevY = ev.clientY;
      totalTravel += Math.hypot(dx, dy);

      if (isPanGesture || ev.shiftKey) {
        rigRef.current = panCameraRig(rigRef.current, dx, dy);
      } else {
        rigRef.current = orbitCameraRig(rigRef.current, dx, dy);
      }
    };

    const onPointerUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);

      // Click without drag -> THREE.Raycaster 3D object picking
      if (e.button === 0 && !e.shiftKey && totalTravel <= 5) {
        const rect = stageEl.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && managedRef.current && cameraRef.current) {
          const localX = ev.clientX - rect.left;
          const localY = ev.clientY - rect.top;
          const ndcX = (localX / rect.width) * 2 - 1;
          const ndcY = -(localY / rect.height) * 2 + 1;

          let hitId = raycastThreeSceneObject(managedRef.current, cameraRef.current, ndcX, ndcY);

          // Secondary software-projection hit check if in fallback mode
          if (!hitId && renderBackend === 'software') {
            for (let i = fallbackHitRegionsRef.current.length - 1; i >= 0; i--) {
              const reg = fallbackHitRegionsRef.current[i];
              if (Math.hypot(localX - reg.cx, localY - reg.cy) <= reg.hitRadius) {
                hitId = reg.id;
                break;
              }
            }
          }

          setSelectedObjectId(hitId);
        }
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const handleViewportWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.09 : 0.91;
    rigRef.current = zoomCameraRig(rigRef.current, factor);
  };

  const handleResetCamera = () => {
    rigRef.current = createCameraRigFromSpec(sceneDoc.camera);
    if (cameraRef.current) {
      applyCameraRigToPerspective(cameraRef.current, rigRef.current);
    }
  };

  const handleZoomStep = (factor: number) => {
    rigRef.current = zoomCameraRig(rigRef.current, factor);
  };

  // Preset switching
  const handleSelectPreset = (presetId: ThreePresetId) => {
    const nextScene = createThreeSceneFromPreset(
      project?.id ?? sceneDoc.projectId,
      presetId,
      sceneDoc.id,
    );
    rigRef.current = createCameraRigFromSpec(nextScene.camera);
    const firstMesh = nextScene.objects.find((o) => o.nodeType === 'mesh') ?? nextScene.objects[0];
    setSelectedObjectId(firstMesh?.id ?? null);
    commitSceneUpdate(nextScene, true);
    appendConsoleEntry({
      kind: 'info',
      source: 'Three.js Studio',
      message: `Caricato preset 3D "${presetId}" (${nextScene.objects.length} oggetti).`,
    });
    pushToast('info', `Preset 3D applicato: ${nextScene.name}`);
  };

  // Object CRUD actions
  const handleAddMesh = (geometry: ThreeGeometryKind, accentColor: string) => {
    const sameKindCount = sceneDoc.objects.filter((o) => o.geometry === geometry).length;
    const angle = sameKindCount * 1.15;
    const offsetRadius = sameKindCount === 0 || geometry === 'plane' || geometry === 'particles' ? 0 : 1.5;

    const newObj = createThreeMeshObject(geometry, {
      position:
        geometry === 'plane'
          ? { x: 0, y: 0, z: 0 }
          : geometry === 'particles'
            ? { x: 0, y: 2, z: 0 }
            : {
                x: Number((Math.cos(angle) * offsetRadius).toFixed(2)),
                y: 1.0,
                z: Number((Math.sin(angle) * offsetRadius).toFixed(2)),
              },
      material: createDefaultMaterial({
        kind: geometry === 'particles' ? 'basic' : 'standard',
        color: accentColor,
      }),
    });
    if (sameKindCount > 0) {
      newObj.name = `${newObj.name}_${sameKindCount + 1}`;
    }

    const nextScene: ThreeSceneDocument = {
      ...sceneDoc,
      objects: [...sceneDoc.objects, newObj],
    };
    setSelectedObjectId(newObj.id);
    commitSceneUpdate(nextScene, true);
  };

  const handleAddLight = (lightKind: ThreeLightKind) => {
    const lightCount = sceneDoc.objects.filter((o) => o.nodeType === 'light').length;
    const newLight = createThreeLightObject(lightKind, {
      position: {
        x: Number((Math.cos(lightCount * 1.4) * 4.2).toFixed(2)),
        y: 5.5,
        z: Number((Math.sin(lightCount * 1.4) * 4.2).toFixed(2)),
      },
    });
    if (lightCount > 0) {
      newLight.name = `${newLight.name}_${lightCount + 1}`;
    }

    const nextScene: ThreeSceneDocument = {
      ...sceneDoc,
      objects: [...sceneDoc.objects, newLight],
    };
    setSelectedObjectId(newLight.id);
    commitSceneUpdate(nextScene, true);
  };

  const updateObjectById = (
    objId: string,
    updater: (prev: ThreeObjectNode) => ThreeObjectNode,
    immediateVfs = false,
  ) => {
    const nextObjects = sceneDoc.objects.map((o) => (o.id === objId ? updater(o) : o));
    commitSceneUpdate({ ...sceneDoc, objects: nextObjects }, immediateVfs);
  };

  const handleDuplicateObject = (obj: ThreeObjectNode) => {
    const clone: ThreeObjectNode = {
      ...structuredClone(obj),
      id: `${obj.nodeType}3d_dup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      name: `${obj.name}_Copy`,
      position: {
        x: Number((obj.position.x + 0.8).toFixed(2)),
        y: obj.position.y,
        z: Number((obj.position.z + 0.6).toFixed(2)),
      },
    };
    const nextScene: ThreeSceneDocument = {
      ...sceneDoc,
      objects: [...sceneDoc.objects, clone],
    };
    setSelectedObjectId(clone.id);
    commitSceneUpdate(nextScene, true);
    pushToast('info', `Duplicato oggetto 3D: ${clone.name}`);
  };

  const handleDeleteObject = (objId: string) => {
    const remaining = sceneDoc.objects.filter((o) => o.id !== objId);
    if (selectedObjectId === objId) {
      setSelectedObjectId(remaining[0]?.id ?? null);
    }
    commitSceneUpdate({ ...sceneDoc, objects: remaining }, true);
  };

  const selectedObject = useMemo(
    () => sceneDoc.objects.find((o) => o.id === selectedObjectId) ?? null,
    [sceneDoc.objects, selectedObjectId],
  );

  // Live Multi-Format Three.js Codegen + Bidirectional SourceMap
  const compiledThree = useMemo(
    () => compileThreeSceneToCode(sceneDoc, codeFormat),
    [sceneDoc, codeFormat],
  );
  const editableSource = useGeneratedSourceEditor({
    fileName: compiledThree.fileName, generated: compiledThree.code, folders: ['generated'],
    entryKind: codeFormat === 'three-html' ? 'source_file' : 'script_file',
  });
  const codeLines = useMemo(() => compiledThree.code.split('\n'), [compiledThree.code]);

  const highlightedSpan = useMemo(() => {
    if (!selectedObjectId) return null;
    return compiledThree.sourceMap.find((s) => s.canvasNodeId === selectedObjectId) ?? null;
  }, [compiledThree.sourceMap, selectedObjectId]);

  useEffect(() => {
    if (!highlightedSpan || !codeScrollRef.current || !showCodePanel) return;
    const lineEl = codeScrollRef.current.querySelector(`[data-line="${highlightedSpan.startLine}"]`);
    if (lineEl && 'scrollIntoView' in lineEl) {
      (lineEl as HTMLElement).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [highlightedSpan, showCodePanel]);

  const handleCodeLineClick = (lineNum: number) => {
    const hit = compiledThree.sourceMap.find(
      (s) => lineNum >= s.startLine && lineNum <= s.endLine,
    );
    if (hit) {
      setSelectedObjectId(hit.canvasNodeId);
    }
  };

  const handleCopyThreeCode = async () => {
    const code = editableSource.manual ? editableSource.displayed : compiledThree.code;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedFlag(true);
    pushToast(
      'success',
      `Codice Three.js (${compiledThree.fileName}) copiato negli appunti!`,
    );
    setTimeout(() => setCopiedFlag(false), 1800);
  };

  const handleSaveToVfs = async () => {
    setSavingVfs(true);
    try {
      await saveThreeScene(sceneDoc, vfsEntryId);
      if (editableSource.canSave) await editableSource.save();
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setSavingVfs(false);
    }
  };

  const handleEmbedSceneInCanvas = async () => {
    await saveThreeScene(sceneDoc, vfsEntryId);
    await embedThreeSceneInActiveSheet(sceneDoc.id, sceneDoc.name);
    appendConsoleEntry({
      kind: 'info',
      source: 'Three.js -> Canvas 2D',
      message: `Inserito nodo <ThreeViewport> collegato a "${sceneDoc.name}" nel foglio UI attivo.`,
    });
  };

  return (
    <div
      ref={studioRootRef}
      data-testid="three-studio-view"
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-panel)',
        overflow: 'hidden',
      }}
    >
      {/* Top Bar: Scene Name, Presets, Play/Pause, Split Toggle & Embed into 2D Sheet */}
      <div
        className="canvas-subtoolbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          flexWrap: 'nowrap',
          overflowX: 'auto',
          scrollbarWidth: 'none',
          padding: '5px 10px',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span className="badge violet" style={{ fontSize: 11, padding: '2px 7px' }}>
            🧊 Three.js 3D Studio
          </span>

          <input
            type="text"
            className="studio-input"
            aria-label="Nome Scena 3D"
            value={sceneDoc.name}
            onChange={(e) => commitSceneUpdate({ ...sceneDoc, name: e.target.value })}
            style={{ width: isNarrowContainer ? 120 : 155, height: 25, fontWeight: 600, fontSize: 11.5 }}
          />

          <select
            data-testid="three-preset-select"
            className="studio-select"
            value={sceneDoc.presetId}
            onChange={(e) => handleSelectPreset(e.target.value as ThreePresetId)}
            title="Preset Scena 3D con 1 clic"
            style={{
              height: 25,
              fontSize: 11.5,
              fontWeight: 600,
              maxWidth: isNarrowContainer ? 175 : undefined,
              textOverflow: 'ellipsis',
            }}
          >
            {THREE_SCENE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                Preset: {p.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            data-testid="three-toggle-play"
            className={`studio-btn sm ${isPlaying ? 'active' : ''}`}
            onClick={() => setIsPlaying((v) => !v)}
            title="Avvia o metti in pausa il loop requestAnimationFrame"
          >
            {isPlaying ? <Pause size={12} /> : <Play size={12} />}
            <span>{isPlaying ? '⏸ Pausa Animazioni' : '▶ Play Animazioni'}</span>
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <button
            type="button"
            data-testid="btn-toggle-three-outliner"
            className={`studio-btn sm ${showInspectorDock ? 'active' : ''}`}
            onClick={() => {
              userToggledInspectorRef.current = true;
              setShowInspectorDock((v) => !v);
            }}
            title="Mostra/Nascondi Outliner 3D & Material PBR Inspector"
          >
            <Layers size={12} />
            <span>Outliner &amp; PBR</span>
          </button>

          <button
            type="button"
            className={`studio-btn sm ${showCodePanel ? 'active' : ''}`}
            onClick={() => setShowCodePanel((v) => !v)}
            title="Mostra/Nascondi Generatore Codice Three.js Live"
          >
            <Code2 size={12} />
            <span>Codice 3D</span>
          </button>

          <button
            type="button"
            data-testid="btn-embed-three-in-canvas"
            className="studio-btn sm primary"
            onClick={() => void handleEmbedSceneInCanvas()}
            title="Inserisce un widget <ThreeViewport> collegato a questa scena nel foglio UI 2D attivo"
          >
            <Sparkles size={12} />
            <span>➕ Inserisci questa Scena 3D nel Foglio UI 2D</span>
          </button>
        </div>
      </div>

      {/* 3D Primitive & Light Creation Bar */}
      <div
        data-testid="three-add-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '5px 10px',
          background: 'var(--bg-header)',
          borderBottom: '1px solid var(--border-subtle)',
          overflowX: 'auto',
          scrollbarWidth: 'none',
          flexShrink: 0,
        }}
      >
        {ADD_MESH_BUTTONS.map((item) => (
          <button
            key={item.geometry}
            type="button"
            data-testid={`btn-add-3d-${item.geometry}`}
            className="studio-btn sm"
            onClick={() => handleAddMesh(item.geometry, item.color)}
          >
            <Box size={11} color={item.color} />
            <span>{item.label}</span>
          </button>
        ))}

        <div
          style={{
            width: 1,
            height: 16,
            background: 'var(--border-subtle)',
            margin: '0 2px',
            flexShrink: 0,
          }}
        />

        {ADD_LIGHT_BUTTONS.map((lt) => (
          <button
            key={lt.lightKind}
            type="button"
            data-testid={`btn-add-light-${lt.lightKind}`}
            className="studio-btn sm"
            onClick={() => handleAddLight(lt.lightKind)}
          >
            <Lightbulb size={11} color="#fbbf24" />
            <span>{lt.label}</span>
          </button>
        ))}
      </div>

      {/* Main 3D Studio Workspace: Left Outliner+Inspector | Center 3D Viewport + Side/Bottom Code Panel */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          position: 'relative',
          display: 'flex',
          flexDirection: 'row',
          overflow: 'hidden',
        }}
      >
        {/* Left 3D Outliner & PBR / Transform / Animation Inspector (Overlay Drawer when < 820px) */}
        {showInspectorDock && (
          <aside
            style={
              isNarrowContainer
                ? {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    bottom: 0,
                    zIndex: 25,
                    width: 256,
                    maxWidth: '86%',
                    borderRight: '1px solid var(--border-strong)',
                    background: 'var(--bg-panel)',
                    boxShadow: 'var(--shadow-lg)',
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0,
                  }
                : {
                    width: 248,
                    minWidth: 224,
                    maxWidth: 276,
                    borderRight: '1px solid var(--border-subtle)',
                    background: 'var(--bg-panel)',
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0,
                    flexShrink: 0,
                  }
            }
          >
            {/* Scene Outliner Tree */}
            <div
              data-testid="three-outliner"
              style={{
                maxHeight: '36%',
                minHeight: 124,
                display: 'flex',
                flexDirection: 'column',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <div className="sidebar-section-header" style={{ padding: '5px 10px' }}>
                <span>Gerarchia Scena ({sceneDoc.objects.length})</span>
                {isNarrowContainer ? (
                  <button
                    type="button"
                    className="row-icon-btn"
                    title="Chiudi pannello Outliner & PBR"
                    onClick={() => {
                      userToggledInspectorRef.current = true;
                      setShowInspectorDock(false);
                    }}
                  >
                    <X size={12} />
                  </button>
                ) : (
                  <Plus
                    size={12}
                    style={{ opacity: 0.6 }}
                  />
                )}
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {sceneDoc.objects.map((obj) => {
                  const isSel = obj.id === selectedObjectId;
                  return (
                    <div
                      key={obj.id}
                      data-testid={`three-outliner-item-${obj.id}`}
                      onClick={() => setSelectedObjectId(obj.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 4,
                        padding: '4px 6px',
                        borderRadius: 5,
                        cursor: 'pointer',
                        background: isSel ? 'var(--accent-soft)' : 'transparent',
                        border: isSel ? '1px solid var(--accent-primary)' : '1px solid transparent',
                        opacity: obj.visible ? 1 : 0.48,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                        {obj.nodeType === 'light' ? (
                          <Sun size={12} color={obj.light?.color ?? '#fbbf24'} style={{ flexShrink: 0 }} />
                        ) : (
                          <Box size={12} color={obj.material?.color ?? '#60a5fa'} style={{ flexShrink: 0 }} />
                        )}
                        <span
                          style={{
                            fontSize: 11.5,
                            fontWeight: isSel ? 600 : 500,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {obj.name}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                        <button
                          type="button"
                          className="row-icon-btn"
                          data-testid={`three-vis-${obj.id}`}
                          title={obj.visible ? 'Nascondi oggetto' : 'Mostra oggetto'}
                          onClick={(e) => {
                            e.stopPropagation();
                            updateObjectById(obj.id, (prev) => ({ ...prev, visible: !prev.visible }), true);
                          }}
                        >
                          {obj.visible ? <Eye size={11} /> : <EyeOff size={11} />}
                        </button>
                        <button
                          type="button"
                          className="row-icon-btn"
                          data-testid={`three-dup-${obj.id}`}
                          title="Duplica oggetto 3D"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDuplicateObject(obj);
                          }}
                        >
                          <Copy size={11} />
                        </button>
                        <button
                          type="button"
                          className="row-icon-btn"
                          data-testid={`three-del-${obj.id}`}
                          title="Elimina oggetto 3D"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteObject(obj.id);
                          }}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 3D Transform / PBR Material / Light / Animation / Environment Inspector */}
            <div
              data-testid="three-inspector"
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '8px 10px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 11,
              }}
            >
              {selectedObject ? (
                <>
                  {/* Selected Object Header */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent-primary)' }}>
                        {selectedObject.nodeType === 'light'
                          ? `Luce (${selectedObject.light?.lightKind})`
                          : `Mesh (${selectedObject.geometry})`}
                      </span>
                      <button
                        type="button"
                        className="studio-btn sm ghost"
                        style={{ height: 20, fontSize: 10, padding: '0 5px' }}
                        onClick={() =>
                          updateObjectById(
                            selectedObject.id,
                            (prev) => ({
                              ...prev,
                              position: { x: 0, y: prev.geometry === 'plane' ? 0 : 1, z: 0 },
                              rotationDeg: { x: prev.geometry === 'plane' ? -90 : 0, y: 0, z: 0 },
                              scale: { x: 1, y: 1, z: 1 },
                            }),
                            true,
                          )
                        }
                      >
                        Reset Transform
                      </button>
                    </div>
                    <input
                      type="text"
                      className="studio-input"
                      aria-label="Nome Oggetto Selezionato"
                      value={selectedObject.name}
                      onChange={(e) =>
                        updateObjectById(selectedObject.id, (prev) => ({ ...prev, name: e.target.value }))
                      }
                      style={{ height: 24, fontSize: 11.5, fontWeight: 600 }}
                    />
                  </div>

                  {/* Transform Controls */}
                  <Vec3ControlGroup
                    title="Posizione (X, Y, Z)"
                    value={selectedObject.position}
                    min={-12}
                    max={12}
                    step={0.1}
                    testIdPrefix="three-pos"
                    onChange={(nextPos) =>
                      updateObjectById(selectedObject.id, (prev) => ({ ...prev, position: nextPos }))
                    }
                  />

                  <Vec3ControlGroup
                    title="Rotazione° (X, Y, Z)"
                    value={selectedObject.rotationDeg}
                    min={-180}
                    max={180}
                    step={1}
                    unit="°"
                    testIdPrefix="three-rot"
                    onChange={(nextRot) =>
                      updateObjectById(selectedObject.id, (prev) => ({ ...prev, rotationDeg: nextRot }))
                    }
                  />

                  {selectedObject.nodeType === 'mesh' && (
                    <Vec3ControlGroup
                      title="Scala (X, Y, Z)"
                      value={selectedObject.scale}
                      min={0.1}
                      max={6}
                      step={0.05}
                      testIdPrefix="three-scale"
                      onChange={(nextScale) =>
                        updateObjectById(selectedObject.id, (prev) => ({ ...prev, scale: nextScale }))
                      }
                    />
                  )}

                  {/* PBR Material Editor for Meshes */}
                  {selectedObject.nodeType === 'mesh' && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        paddingTop: 8,
                        borderTop: '1px solid var(--border-subtle)',
                      }}
                    >
                      <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                        Materiale PBR
                      </span>
                      {(() => {
                        const mat: ThreeMaterialSpec = selectedObject.material ?? createDefaultMaterial();
                        const patchMat = (patch: Partial<ThreeMaterialSpec>, immediate = false) =>
                          updateObjectById(
                            selectedObject.id,
                            (prev) => ({
                              ...prev,
                              material: { ...(prev.material ?? createDefaultMaterial()), ...patch },
                            }),
                            immediate,
                          );

                        return (
                          <>
                            <select
                              data-testid="three-material-kind-select"
                              className="studio-select"
                              value={mat.kind}
                              onChange={(e) =>
                                patchMat({ kind: e.target.value as ThreeMaterialKind }, true)
                              }
                              style={{ height: 24, fontSize: 11.5 }}
                            >
                              <option value="standard">Standard PBR</option>
                              <option value="physical">Physical Clearcoat</option>
                              <option value="toon">Toon Cel-Shaded</option>
                              <option value="basic">Basic Unlit</option>
                            </select>

                            {/* Color & Emissive Row */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10.5 }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Colore</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <input
                                    type="color"
                                    data-testid="three-mat-color"
                                    value={mat.color}
                                    onChange={(e) => patchMat({ color: e.target.value })}
                                    style={{ width: 24, height: 22, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
                                  />
                                  <input
                                    type="text"
                                    className="studio-input"
                                    value={mat.color}
                                    onChange={(e) => patchMat({ color: e.target.value })}
                                    style={{ width: '100%', height: 22, padding: '2px 4px', fontSize: 10.5, fontFamily: 'monospace' }}
                                  />
                                </div>
                              </label>

                              <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10.5 }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Emissive</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <input
                                    type="color"
                                    data-testid="three-mat-emissive"
                                    value={mat.emissive}
                                    onChange={(e) =>
                                      patchMat({
                                        emissive: e.target.value,
                                        emissiveIntensity:
                                          mat.emissiveIntensity === 0 && e.target.value !== '#000000'
                                            ? 0.45
                                            : mat.emissiveIntensity,
                                      })
                                    }
                                    style={{ width: 24, height: 22, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
                                  />
                                  <input
                                    type="number"
                                    step={0.05}
                                    min={0}
                                    max={4}
                                    className="studio-input"
                                    title="Intensità Emissive"
                                    value={mat.emissiveIntensity}
                                    onChange={(e) =>
                                      patchMat({ emissiveIntensity: Math.max(0, parseFloat(e.target.value) || 0) })
                                    }
                                    style={{ width: '100%', height: 22, padding: '2px 4px', fontSize: 10.5 }}
                                  />
                                </div>
                              </label>
                            </div>

                            {/* Metalness */}
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10.5 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Metalness</span>
                                <span>{mat.metalness.toFixed(2)}</span>
                              </div>
                              <input
                                type="range"
                                data-testid="three-mat-metalness"
                                min={0}
                                max={1}
                                step={0.02}
                                value={mat.metalness}
                                onChange={(e) => patchMat({ metalness: parseFloat(e.target.value) })}
                                style={{ width: '100%', accentColor: 'var(--accent-primary)' }}
                              />
                            </label>

                            {/* Roughness */}
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10.5 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Roughness</span>
                                <span>{mat.roughness.toFixed(2)}</span>
                              </div>
                              <input
                                type="range"
                                data-testid="three-mat-roughness"
                                min={0}
                                max={1}
                                step={0.02}
                                value={mat.roughness}
                                onChange={(e) => patchMat({ roughness: parseFloat(e.target.value) })}
                                style={{ width: '100%', accentColor: 'var(--accent-primary)' }}
                              />
                            </label>

                            {/* Clearcoat (Physical) */}
                            {mat.kind === 'physical' && (
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10.5 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                  <span style={{ color: 'var(--text-secondary)' }}>Clearcoat</span>
                                  <span>{(mat.clearcoat ?? 0.6).toFixed(2)}</span>
                                </div>
                                <input
                                  type="range"
                                  min={0}
                                  max={1}
                                  step={0.02}
                                  value={mat.clearcoat ?? 0.6}
                                  onChange={(e) => patchMat({ clearcoat: parseFloat(e.target.value) })}
                                  style={{ width: '100%', accentColor: 'var(--accent-violet)' }}
                                />
                              </label>
                            )}

                            {/* Opacity */}
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10.5 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Opacità</span>
                                <span>{mat.opacity.toFixed(2)}</span>
                              </div>
                              <input
                                type="range"
                                data-testid="three-mat-opacity"
                                min={0.05}
                                max={1}
                                step={0.05}
                                value={mat.opacity}
                                onChange={(e) => patchMat({ opacity: parseFloat(e.target.value) })}
                                style={{ width: '100%', accentColor: 'var(--accent-primary)' }}
                              />
                            </label>

                            {/* Wireframe & Shadows */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  data-testid="three-mat-wireframe"
                                  checked={mat.wireframe}
                                  onChange={(e) => patchMat({ wireframe: e.target.checked }, true)}
                                />
                                <span>Wireframe</span>
                              </label>

                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={Boolean(selectedObject.castShadow)}
                                  onChange={(e) =>
                                    updateObjectById(
                                      selectedObject.id,
                                      (prev) => ({ ...prev, castShadow: e.target.checked }),
                                      true,
                                    )
                                  }
                                />
                                <span>Ombre</span>
                              </label>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}

                  {/* Light Parameters Editor */}
                  {selectedObject.nodeType === 'light' && selectedObject.light && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        paddingTop: 8,
                        borderTop: '1px solid var(--border-subtle)',
                      }}
                    >
                      <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                        Parametri Luce
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Colore Luce</span>
                        <input
                          type="color"
                          value={selectedObject.light.color}
                          onChange={(e) =>
                            updateObjectById(selectedObject.id, (prev) => ({
                              ...prev,
                              light: { ...prev.light!, color: e.target.value },
                            }))
                          }
                          style={{ width: 32, height: 22, border: 'none', background: 'transparent', cursor: 'pointer' }}
                        />
                      </div>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10.5 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Intensità</span>
                          <span>{selectedObject.light.intensity.toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={6}
                          step={0.1}
                          value={selectedObject.light.intensity}
                          onChange={(e) =>
                            updateObjectById(selectedObject.id, (prev) => ({
                              ...prev,
                              light: { ...prev.light!, intensity: parseFloat(e.target.value) },
                            }))
                          }
                          style={{ width: '100%', accentColor: '#fbbf24' }}
                        />
                      </label>
                    </div>
                  )}

                  {/* Animation Controller */}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      paddingTop: 8,
                      borderTop: '1px solid var(--border-subtle)',
                    }}
                  >
                    <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                      Animazione 3D
                    </span>
                    <select
                      data-testid="three-animation-kind-select"
                      className="studio-select"
                      value={selectedObject.animation.kind}
                      onChange={(e) =>
                        updateObjectById(
                          selectedObject.id,
                          (prev) => ({
                            ...prev,
                            animation: {
                              ...prev.animation,
                              kind: e.target.value as ThreeAnimationKind,
                              speed: prev.animation.speed || 1,
                            },
                          }),
                          true,
                        )
                      }
                      style={{ height: 24, fontSize: 11.5 }}
                    >
                      <option value="none">Nessuna</option>
                      <option value="spin">Rotazione Continua (Spin)</option>
                      <option value="float">Fluttuazione (Float)</option>
                      <option value="pulse">Pulsazione (Pulse)</option>
                      <option value="orbit">Orbita Circolare (Orbit)</option>
                    </select>

                    {selectedObject.animation.kind !== 'none' && (
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10.5 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Velocità</span>
                          <span>{selectedObject.animation.speed.toFixed(1)}x</span>
                        </div>
                        <input
                          type="range"
                          data-testid="three-animation-speed-slider"
                          min={0.1}
                          max={4}
                          step={0.1}
                          value={selectedObject.animation.speed}
                          onChange={(e) =>
                            updateObjectById(selectedObject.id, (prev) => ({
                              ...prev,
                              animation: { ...prev.animation, speed: parseFloat(e.target.value) },
                            }))
                          }
                          style={{ width: '100%', accentColor: 'var(--accent-emerald)' }}
                        />
                      </label>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', padding: '6px 0' }}>
                  Clicca una mesh 3D nella viewport o nell&apos;Outliner per modificarne trasformazioni, materiale PBR e animazioni.
                </div>
              )}

              {/* Environment Controls */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  paddingTop: 8,
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                  Ambiente &amp; Camera
                </span>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Sfondo Scena</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <input
                      type="color"
                      data-testid="three-env-bg"
                      value={sceneDoc.environment.backgroundColor}
                      onChange={(e) =>
                        commitSceneUpdate({
                          ...sceneDoc,
                          environment: {
                            ...sceneDoc.environment,
                            backgroundColor: e.target.value,
                            fogColor: e.target.value,
                          },
                        })
                      }
                      style={{ width: 26, height: 20, border: 'none', background: 'transparent', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: 10.5, fontFamily: 'monospace' }}>
                      {sceneDoc.environment.backgroundColor}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={sceneDoc.environment.showGrid}
                      onChange={(e) =>
                        commitSceneUpdate(
                          {
                            ...sceneDoc,
                            environment: { ...sceneDoc.environment, showGrid: e.target.checked },
                          },
                          true,
                        )
                      }
                    />
                    <span>Griglia</span>
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={sceneDoc.environment.showAxes}
                      onChange={(e) =>
                        commitSceneUpdate(
                          {
                            ...sceneDoc,
                            environment: { ...sceneDoc.environment, showAxes: e.target.checked },
                          },
                          true,
                        )
                      }
                    />
                    <span>Assi XYZ</span>
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={sceneDoc.environment.fogEnabled}
                      onChange={(e) =>
                        commitSceneUpdate(
                          {
                            ...sceneDoc,
                            environment: { ...sceneDoc.environment, fogEnabled: e.target.checked },
                          },
                          true,
                        )
                      }
                    />
                    <span>Nebbia</span>
                  </label>
                </div>
              </div>
            </div>
          </aside>
        )}

        {/* Center + Right/Bottom Split Container: 3D Viewport + Live Three.js Code Generator */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: effectiveSplitDir === 'bottom' ? 'column' : 'row',
            overflow: 'hidden',
          }}
        >
          {/* Interactive 3D Viewport Stage */}
          <div
            data-testid="three-viewport-stage"
            onPointerDown={handleViewportPointerDown}
            onWheel={handleViewportWheel}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              flex: effectiveSplitDir === 'bottom' ? 1 : showCodePanel ? 1.15 : 1,
              minWidth: 220,
              minHeight: 280,
              position: 'relative',
              overflow: 'hidden',
              cursor: 'grab',
              background: sceneDoc.environment.backgroundColor || '#0b1120',
            }}
          >
            {/* Three.js WebGL / Software Mount */}
            <div
              ref={viewportHostRef}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
              }}
            />

            {/* Top-Left HUD Status Pill */}
            <div
              style={{
                position: 'absolute',
                top: 10,
                left: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                pointerEvents: 'none',
                maxWidth: 'calc(100% - 20px)',
              }}
            >
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 9px',
                  borderRadius: 6,
                  background: 'rgba(15, 23, 42, 0.82)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(59, 130, 246, 0.35)',
                  color: '#f1f5f9',
                  fontSize: 10.5,
                  fontWeight: 600,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: renderBackend === 'webgl' ? '#10b981' : '#38bdf8',
                  }}
                />
                <span>
                  {renderBackend === 'webgl' ? 'WebGL PBR Attivo' : 'Canvas 3D Software'} •{' '}
                  {selectedObject ? `Selezionato: ${selectedObject.name}` : 'Nessuna selezione'}
                </span>
              </div>
              <span
                style={{
                  fontSize: 10,
                  color: 'rgba(226, 232, 240, 0.72)',
                  paddingLeft: 4,
                  textShadow: '0 1px 3px rgba(0,0,0,0.85)',
                }}
              >
                Trascina: Orbita • Shift / Tasto Dx: Pan • Rotella: Zoom • Clic: Raycast 3D
              </span>
            </div>

            {/* Bottom-Right Camera & Grid Controls */}
            <div
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                right: 10,
                bottom: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 6px',
                borderRadius: 8,
                background: 'rgba(15, 23, 42, 0.86)',
                backdropFilter: 'blur(8px)',
                border: '1px solid var(--border-strong)',
              }}
            >
              <button
                type="button"
                data-testid="three-zoom-in"
                className="studio-btn sm ghost"
                title="Avvicina Camera (Zoom In)"
                onClick={() => handleZoomStep(0.84)}
              >
                +
              </button>
              <button
                type="button"
                data-testid="three-zoom-out"
                className="studio-btn sm ghost"
                title="Allontana Camera (Zoom Out)"
                onClick={() => handleZoomStep(1.18)}
              >
                −
              </button>
              <button
                type="button"
                data-testid="three-reset-camera"
                className="studio-btn sm"
                title="Ripristina posizione camera predefinita"
                onClick={handleResetCamera}
              >
                <RefreshCw size={11} />
                <span>Reset Camera</span>
              </button>
              <button
                type="button"
                data-testid="three-toggle-grid"
                className={`studio-btn sm ${sceneDoc.environment.showGrid ? 'active' : 'ghost'}`}
                title="Mostra/Nascondi GridHelper"
                onClick={() =>
                  commitSceneUpdate(
                    {
                      ...sceneDoc,
                      environment: {
                        ...sceneDoc.environment,
                        showGrid: !sceneDoc.environment.showGrid,
                      },
                    },
                    true,
                  )
                }
              >
                <Grid3x3 size={11} />
              </button>
            </div>
          </div>

          {/* Built-in Side-by-Side / Stacked Live Three.js Code Generator */}
          {showCodePanel && (
            <section
              data-testid="three-code-panel"
              style={
                effectiveSplitDir === 'bottom'
                  ? {
                      height: 220,
                      flex: '0 0 220px',
                      minHeight: 160,
                      borderTop: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      background: 'var(--code-bg)',
                      overflow: 'hidden',
                    }
                  : {
                      flex: 0.95,
                      minWidth: 250,
                      borderLeft: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      background: 'var(--code-bg)',
                      overflow: 'hidden',
                    }
              }
            >
              {/* Code Panel Toolbar */}
              <div
                className="code-toolbar"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                  flexWrap: 'wrap',
                  padding: '5px 8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                  <Code2 size={13} color="var(--accent-violet)" />
                  <select
                    data-testid="three-code-format-select"
                    className="studio-select"
                    value={codeFormat}
                    onChange={(e) => setCodeFormat(e.target.value as ThreeCodeExportFormat)}
                    style={{ height: 24, fontSize: 11, fontWeight: 600 }}
                  >
                    <option value="three-ts">Vanilla Three.js (TypeScript .ts)</option>
                    <option value="r3f-tsx">React Three Fiber (@react-three/fiber .tsx)</option>
                    <option value="three-html">HTML5 Standalone + Three.js ES Module (.html)</option>
                  </select>

                  <button
                    type="button"
                    className="studio-btn sm ghost"
                    title={
                      effectiveSplitDir === 'right'
                        ? 'Sposta pannello codice in basso'
                        : 'Sposta pannello codice a destra'
                    }
                    onClick={() => {
                      setUserToggledSplitDir(true);
                      setCodeSplitDirection(effectiveSplitDir === 'right' ? 'bottom' : 'right');
                    }}
                  >
                    {effectiveSplitDir === 'right' ? <Rows2 size={12} /> : <Columns2 size={12} />}
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="studio-btn sm"
                    data-testid="btn-edit-three-code"
                    disabled={editableSource.busy || savingVfs}
                    onClick={() => editableSource.manual ? editableSource.setManual(false) : void editableSource.open()}
                  >
                    {editableSource.manual ? 'Vista scena' : 'Modifica codice'}
                  </button>
                  {editableSource.manual && <button
                    type="button"
                    className="studio-btn sm ghost"
                    disabled={editableSource.busy || savingVfs}
                    onClick={() => editableSource.update(compiledThree.code)}
                  >
                    Usa codice della scena
                  </button>}
                  <button
                    type="button"
                    data-testid="btn-copy-three-code"
                    className="studio-btn sm"
                    onClick={() => void handleCopyThreeCode()}
                  >
                    {copiedFlag ? <Check size={11} /> : <Copy size={11} />}
                    <span>Copia Codice Three.js</span>
                  </button>

                  <button
                    type="button"
                    data-testid="btn-save-three-vfs"
                    className="studio-btn sm primary"
                    disabled={savingVfs || editableSource.busy || !editableSource.canSave}
                    onClick={() => void handleSaveToVfs()}
                  >
                    <Save size={11} />
                    <span>Salva in VFS</span>
                  </button>
                </div>
              </div>

              {/* Active Emitted File Header */}
              <div
                style={{
                  padding: '3px 10px',
                  fontSize: 10.5,
                  color: 'var(--text-muted)',
                  background: 'var(--bg-header)',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span style={{ fontFamily: "'JetBrains Mono', Consolas, monospace" }}>
                  {editableSource.manual ? 'generated/' : ''}{compiledThree.fileName}
                </span>
                <span>
                  {editableSource.manual ? 'La vista 3D usa la scena visuale.' : highlightedSpan
                    ? `Righe ${highlightedSpan.startLine}–${highlightedSpan.endLine} sincronizzate`
                    : 'Clicca una riga o mesh 3D per sincronizzare'}
                </span>
              </div>

              {/* Bidirectional SourceMap Code Lines */}
              {editableSource.manual ? <GeneratedSourceTextarea
                label="Sorgente scena Three.js"
                testId="three-code-editor"
                value={editableSource.displayed}
                saving={savingVfs || editableSource.busy}
                onChange={editableSource.update}
                onSave={() => void handleSaveToVfs()}
              /> : <div
                ref={codeScrollRef}
                data-testid="three-code-output"
                className="code-lines-scroll"
              >
                {codeLines.map((line, idx) => {
                  const lineNum = idx + 1;
                  const isHighlighted =
                    highlightedSpan !== null &&
                    lineNum >= highlightedSpan.startLine &&
                    lineNum <= highlightedSpan.endLine;
                  return (
                    <div
                      key={lineNum}
                      data-line={lineNum}
                      className={`code-line ${isHighlighted ? 'highlighted' : ''}`}
                      onClick={() => handleCodeLineClick(lineNum)}
                    >
                      <span className="code-line-num">{lineNum}</span>
                      <span className="code-line-text">{line || ' '}</span>
                    </div>
                  );
                })}
              </div>}
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
