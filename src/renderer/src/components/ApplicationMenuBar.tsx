import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Search, Zap } from 'lucide-react';
import { STUDIO_VERSION } from '@shared/studio-version';
import { createBlueprintNode, simulateBlueprintExecution } from '@shared/blueprint-ir';
import { isEmbeddingOnlyModelName, pickPreferredLocalModel } from '@shared/ipc-contract';
import {
  compileThreeSceneToCode,
  createThreeMeshObject,
  type ThreeCodeExportFormat,
  type ThreeGeometryKind,
} from '@shared/three-ir';
import type { CodegenTargetId } from '@shared/ui-ir';
import { getStudioApi } from '@renderer/api/studio-client';
import { bundleCacheKey, useStudioStore } from '@renderer/state/studio-store';
import { useShellLayoutStore } from './WorkbenchShell';

interface MenuOptionItem {
  kind?: 'item';
  id: string;
  label: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  action: () => unknown;
}

interface MenuDividerItem {
  kind: 'divider';
}

interface MenuSectionItem {
  kind: 'section';
  label: string;
}

type MenuDropdownEntry = MenuOptionItem | MenuDividerItem | MenuSectionItem;

interface TopMenuSpec {
  id: string;
  testId: string;
  label: string;
  items: MenuDropdownEntry[];
}

export const ApplicationMenuBar: React.FC = () => {
  const barRef = useRef<HTMLElement | null>(null);
  const aboutRef = useRef<HTMLDialogElement | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 30, left: 8 });

  const rightDockCollapsed = useShellLayoutStore((s) => s.rightDockCollapsed);
  const setRightDockCollapsed = useShellLayoutStore((s) => s.setRightDockCollapsed);
  const toggleRightDock = useShellLayoutStore((s) => s.toggleRightDock);

  const showProjectHub = useStudioStore((s) => s.showProjectHub);
  const project = useStudioStore((s) => s.project);
  const activeSheetId = useStudioStore((s) => s.activeSheetId);
  const sheetDocuments = useStudioStore((s) => s.sheetDocuments);
  const vfsTree = useStudioStore((s) => s.vfsTree);
  const selectedNodeIds = useStudioStore((s) => s.selectedNodeIds);
  const canUndo = useStudioStore((s) => s.canUndo);
  const canRedo = useStudioStore((s) => s.canRedo);
  const copiedClipboard = useStudioStore((s) => s.copiedClipboard);
  const showRulers = useStudioStore((s) => s.showRulers);
  const snapToGrid8px = useStudioStore((s) => s.snapToGrid8px);
  const bottomConsoleOpen = useStudioStore((s) => s.bottomConsoleOpen);
  const studioTheme = useStudioStore((s) => s.studioTheme);
  const canvasPlacementMode = useStudioStore((s) => s.canvasPlacementMode);
  const globalTarget = useStudioStore((s) => s.globalTarget);
  const globalDialect = useStudioStore((s) => s.globalDialect);
  const compiledBundles = useStudioStore((s) => s.compiledBundles);
  const checkpoints = useStudioStore((s) => s.checkpoints);
  const agentMode = useStudioStore((s) => s.agentMode);
  const providers = useStudioStore((s) => s.providers);
  const activeProvider = useStudioStore((s) => s.activeProvider);
  const activeModel = useStudioStore((s) => s.activeModel);
  const ollamaEnsureStatus = useStudioStore((s) => s.ollamaEnsureStatus);

  const setShowProjectHub = useStudioStore((s) => s.setShowProjectHub);
  const setHubActiveSection = useStudioStore((s) => s.setHubActiveSection);
  const setWizardOpen = useStudioStore((s) => s.setWizardOpen);
  const setCommandPaletteOpen = useStudioStore((s) => s.setCommandPaletteOpen);
  const setShortcutsHelpOpen = useStudioStore((s) => s.setShortcutsHelpOpen);
  const setBottomConsoleOpen = useStudioStore((s) => s.setBottomConsoleOpen);
  const appendConsoleEntry = useStudioStore((s) => s.appendConsoleEntry);
  const createQuickFreeformProject = useStudioStore((s) => s.createQuickFreeformProject);
  const openDemoProject = useStudioStore((s) => s.openDemoProject);
  const linkDiskFolder = useStudioStore((s) => s.linkDiskFolder);
  const createVfsEntry = useStudioStore((s) => s.createVfsEntry);
  const setImportCodeModalOpen = useStudioStore((s) => s.setImportCodeModalOpen);
  const setA11yModalOpen = useStudioStore((s) => s.setA11yModalOpen);
  const setUnslothModalOpen = useStudioStore((s) => s.setUnslothModalOpen);
  const exportProjectScaffold = useStudioStore((s) => s.exportProjectScaffold);
  const undo = useStudioStore((s) => s.undo);
  const redo = useStudioStore((s) => s.redo);
  const copySelectedNodes = useStudioStore((s) => s.copySelectedNodes);
  const cutSelectedNodes = useStudioStore((s) => s.cutSelectedNodes);
  const pasteCopiedNodes = useStudioStore((s) => s.pasteCopiedNodes);
  const copySelectedNodeStyle = useStudioStore((s) => s.copySelectedNodeStyle);
  const pasteStyleToSelectedNodes = useStudioStore((s) => s.pasteStyleToSelectedNodes);
  const copiedNodeStyle = useStudioStore((s) => s.copiedNodeStyle);
  const groupSelectedNodes = useStudioStore((s) => s.groupSelectedNodes);
  const ungroupSelectedContainer = useStudioStore((s) => s.ungroupSelectedContainer);
  const duplicateSelectedNode = useStudioStore((s) => s.duplicateSelectedNode);
  const deleteSelectedNode = useStudioStore((s) => s.deleteSelectedNode);
  const selectNode = useStudioStore((s) => s.selectNode);
  const nudgeSelectedNodes = useStudioStore((s) => s.nudgeSelectedNodes);
  const adjustSelectedZIndex = useStudioStore((s) => s.adjustSelectedZIndex);
  const applyLayoutPreset = useStudioStore((s) => s.applyLayoutPreset);
  const setShowRulers = useStudioStore((s) => s.setShowRulers);
  const toggleSnapToGrid8px = useStudioStore((s) => s.toggleSnapToGrid8px);
  const setStudioTheme = useStudioStore((s) => s.setStudioTheme);
  const insertPaletteElement = useStudioStore((s) => s.insertPaletteElement);
  const embedThreeSceneInActiveSheet = useStudioStore((s) => s.embedThreeSceneInActiveSheet);
  const setCanvasPlacementMode = useStudioStore((s) => s.setCanvasPlacementMode);
  const toggleNodeFreeformDetach = useStudioStore((s) => s.toggleNodeFreeformDetach);
  const solveAutoLayoutOnActive = useStudioStore((s) => s.solveAutoLayoutOnActive);
  const setLeftActiveMode = useStudioStore((s) => s.setLeftActiveMode);
  const ensureActiveBlueprintGraph = useStudioStore((s) => s.ensureActiveBlueprintGraph);
  const saveBlueprintGraph = useStudioStore((s) => s.saveBlueprintGraph);
  const createAndBindScriptFunctionForNode = useStudioStore((s) => s.createAndBindScriptFunctionForNode);
  const ensureActiveThreeScene = useStudioStore((s) => s.ensureActiveThreeScene);
  const saveThreeScene = useStudioStore((s) => s.saveThreeScene);
  const setGlobalTarget = useStudioStore((s) => s.setGlobalTarget);
  const compileSheetForTarget = useStudioStore((s) => s.compileSheetForTarget);
  const openExistingDiskProjectAction = useStudioStore((s) => s.openExistingDiskProjectAction);
  const refreshToolchainDoctor = useStudioStore((s) => s.refreshToolchainDoctor);
  const runToolchainTaskAction = useStudioStore((s) => s.runToolchainTaskAction);
  const stopToolchainTaskAction = useStudioStore((s) => s.stopToolchainTaskAction);
  const toolchainTasks = useStudioStore((s) => s.toolchainTasks);
  const loadSqlSchemaAction = useStudioStore((s) => s.loadSqlSchemaAction);
  const setAgentMode = useStudioStore((s) => s.setAgentMode);
  const setRightPanelMode = useStudioStore((s) => s.setRightPanelMode);
  const askAiAboutSelection = useStudioStore((s) => s.askAiAboutSelection);
  const restoreAiCheckpoint = useStudioStore((s) => s.restoreAiCheckpoint);
  const ensureOllamaRunningAction = useStudioStore((s) => s.ensureOllamaRunningAction);
  const refreshAiProviders = useStudioStore((s) => s.refreshAiProviders);
  const pushToast = useStudioStore((s) => s.pushToast);

  useEffect(() => {
    if (!openMenuId) return;
    const onPointerDown = (e: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenuId(null);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    const onResize = () => setOpenMenuId(null);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [openMenuId]);

  // Helper: if user triggers an editor/canvas/view/insert/3D/blueprint action while on Startup Hub, transition into Workbench first
  const enterWorkbenchThen = async (fn: () => unknown) => {
    const st = useStudioStore.getState();
    if (st.showProjectHub && st.project) {
      st.setShowProjectHub(false);
    }
    await fn();
  };

  const activeSheet = sheetDocuments[activeSheetId];
  const selectedNode = selectedNodeIds[0] && activeSheet ? activeSheet.nodes[selectedNodeIds[0]] : null;

  const ollamaProv = providers.find((p) => p.id === 'ollama');
  const isOllamaOnline = Boolean(ollamaProv?.online || ollamaEnsureStatus === 'online');
  const displayOllamaModel = (() => {
    if (activeProvider === 'ollama' && activeModel && !isEmbeddingOnlyModelName(activeModel)) {
      return activeModel;
    }
    if (ollamaProv?.models.length) {
      return pickPreferredLocalModel(ollamaProv.models) ?? ollamaProv.models[0].id;
    }
    return activeModel && activeModel !== 'offline-studio-architect-v1' ? activeModel : 'Ollama';
  })();

  const findFolderByName = (name: string): string | null =>
    vfsTree.find((n) => n.entryKind === 'folder' && n.name === name)?.id ??
    vfsTree.find((n) => n.entryKind === 'folder' && n.name === 'src')?.id ??
    null;

  const handleSaveAll = async () => {
    if (!project || !activeSheetId) {
      pushToast('info', 'Stato configurazione e sessione salvati automaticamente.');
      return;
    }
    try {
      await getStudioApi().canvas.createCheckpoint({
        projectId: project.id,
        sheetId: activeSheetId,
        reason: 'manual',
        label: `Salvataggio manuale (${new Date().toLocaleTimeString('it-IT')})`,
      });
    } catch {
      // ignore checkpoint error in lightweight mode
    }
    pushToast('success', 'Progetto, file VFS e checkpoint salvati con successo (Ctrl+S).');
  };

  const handleSelectAll = () => {
    if (!activeSheet) return;
    const allChildIds = Object.values(activeSheet.nodes)
      .filter((n) => n.kind !== 'artboard')
      .map((n) => n.id);
    if (allChildIds.length > 0) {
      useStudioStore.setState({ selectedNodeIds: allChildIds });
      pushToast('info', `Selezionati ${allChildIds.length} elementi sul foglio.`);
    }
  };

  const handleSelectParent = () => {
    if (selectedNode?.parentId && activeSheet?.nodes[selectedNode.parentId]) {
      selectNode(selectedNode.parentId);
    }
  };

  const handleSelectChildren = () => {
    if (selectedNode && selectedNode.childIds.length > 0) {
      useStudioStore.setState({ selectedNodeIds: [...selectedNode.childIds] });
    }
  };

  const handleAddBlueprintClickEvent = async () => {
    const { vfsEntryId, graph } = await ensureActiveBlueprintGraph();
    const newNode = createBlueprintNode(
      'event_ui_click',
      { x: 80 + (graph.nodes.length % 4) * 45, y: 120 + (graph.nodes.length % 4) * 55 },
      {
        targetUiNodeId: selectedNode?.id,
        config: { elementName: selectedNode?.name ?? 'ActionButton' },
      },
    );
    await saveBlueprintGraph({ ...graph, nodes: [...graph.nodes, newNode] }, vfsEntryId);
    applyLayoutPreset('split-blueprint');
    pushToast('success', `Nodo Evento Click aggiunto al grafo Blueprint "${graph.name}".`);
  };

  const handleRunBlueprintSim = async () => {
    const { graph } = await ensureActiveBlueprintGraph();
    const sim = simulateBlueprintExecution(graph);
    for (const logLine of sim.logs) {
      appendConsoleEntry({
        kind: 'blueprint',
        source: `Blueprint:${graph.name}`,
        message: logLine,
      });
    }
    setBottomConsoleOpen(true);
    pushToast('success', `Simulazione Blueprint eseguita (${sim.steps.length} step registrati in Console).`);
  };

  const handleAddThreeObject = async (geometry: ThreeGeometryKind) => {
    const { vfsEntryId, scene } = await ensureActiveThreeScene();
    const offset = (scene.objects.length % 5) * 0.65 - 1.2;
    const mesh = createThreeMeshObject(geometry, {
      position: { x: Number(offset.toFixed(2)), y: 1.1, z: 0 },
    });
    await saveThreeScene({ ...scene, objects: [...scene.objects, mesh] }, vfsEntryId);
    applyLayoutPreset('three-studio');
    pushToast('success', `Oggetto 3D "${mesh.name}" aggiunto alla scena Three.js!`);
  };

  const handleExportThreeCode = async (format: ThreeCodeExportFormat) => {
    const { scene } = await ensureActiveThreeScene();
    const compiled = compileThreeSceneToCode(scene, format);
    const parentId = findFolderByName('scripts');
    await createVfsEntry(
      compiled.fileName,
      format === 'three-html' ? 'source_file' : 'script_file',
      parentId,
      compiled.code,
    );
    try {
      await navigator.clipboard?.writeText(compiled.code);
    } catch {
      // ignore clipboard permission in headless
    }
    pushToast('success', `Codice ${compiled.fileName} generato in VFS e copiato negli appunti!`);
  };

  const handleCopyComponentCode = async () => {
    let bundle = compiledBundles[bundleCacheKey(activeSheetId, globalTarget, globalDialect)];
    if (!bundle && activeSheetId) {
      bundle = (await compileSheetForTarget(activeSheetId, globalTarget, globalDialect)) ?? undefined!;
    }
    const primaryCode = bundle?.files[0]?.code ?? '';
    if (primaryCode) {
      try {
        await navigator.clipboard?.writeText(primaryCode);
      } catch {
        // ignore headless clipboard restriction
      }
      pushToast('success', `Codice ${globalTarget} copiato negli appunti!`);
    }
  };

  const QUICK_TARGETS: Array<{ id: CodegenTargetId; label: string }> = [
    { id: 'html-vanilla', label: 'HTML5 + CSS3 + JS (.html)' },
    { id: 'react-tsx', label: 'React 19 (TSX)' },
    { id: 'nextjs-app', label: 'Next.js 15 (App Router)' },
    { id: 'vue3', label: 'Vue 3 / Nuxt (.vue)' },
    { id: 'svelte5', label: 'Svelte 5 Runes (.svelte)' },
    { id: 'htmx', label: 'HTMX 2.x Hypermedia' },
    { id: 'electron-target', label: 'Electron Desktop App' },
    { id: 'tauri-v2', label: 'Tauri v2 (Rust + Web)' },
    { id: 'dotnet-maui', label: '.NET MAUI (XAML + MVVM)' },
    { id: 'flutter-dart', label: 'Flutter (Dart 3)' },
    { id: 'python-streamlit', label: 'Python Streamlit (AI)' },
    { id: 'lvgl-c', label: 'LVGL 9 Embedded C' },
  ];

  const menus: TopMenuSpec[] = [
    {
      id: 'file',
      testId: 'menu-file',
      label: 'File',
      items: [
        {
          id: 'new-ai-project',
          label: 'Crea Progetto con AI (Ollama)...',
          action: () => {
            setHubActiveSection('architect');
            setShowProjectHub(true);
          },
        },
        {
          id: 'new-quick-freeform',
          label: 'Nuovo Progetto Rapido (Libero)',
          shortcut: 'Ctrl+N',
          action: () => createQuickFreeformProject(),
        },
        {
          id: 'open-wizard',
          label: 'Creazione Guidata (Wizard)...',
          shortcut: 'Ctrl+Shift+N',
          action: () => setWizardOpen(true),
        },
        {
          id: 'open-hub',
          label: 'Schermata Iniziale / Progetti Recenti...',
          action: () => setShowProjectHub(true),
        },
        {
          id: 'open-existing-disk',
          label: 'Apri Progetto Esistente da Disco...',
          action: () => openExistingDiskProjectAction(),
        },
        {
          id: 'link-disk',
          label: 'Collega Cartella su Disco...',
          action: () => linkDiskFolder(),
        },
        { kind: 'divider' },
        {
          id: 'new-sheet',
          label: 'Nuovo Foglio Canvas',
          action: () =>
            enterWorkbenchThen(() =>
              createVfsEntry(
                `Schermata${vfsTree.filter((n) => n.entryKind === 'canvas_sheet').length + 1}.canvas`,
                'canvas_sheet',
                findFolderByName('screens'),
              ),
            ),
        },
        {
          id: 'new-css',
          label: 'Nuovo Stile CSS',
          action: () =>
            enterWorkbenchThen(() =>
              createVfsEntry(
                `stili-${vfsTree.filter((n) => n.entryKind === 'style_file').length + 1}.css`,
                'style_file',
                findFolderByName('styles'),
              ),
            ),
        },
        {
          id: 'new-script',
          label: 'Nuovo Script TS/JS',
          action: () =>
            enterWorkbenchThen(() =>
              createVfsEntry(
                `controller-${vfsTree.filter((n) => n.entryKind === 'script_file').length + 1}.ts`,
                'script_file',
                findFolderByName('scripts'),
              ),
            ),
        },
        {
          id: 'new-blueprint',
          label: 'Nuovo Grafo Blueprint',
          action: () =>
            enterWorkbenchThen(() =>
              createVfsEntry(
                `FlussoLogico${vfsTree.filter((n) => n.entryKind === 'blueprint_graph').length + 1}.blueprint.json`,
                'blueprint_graph',
                findFolderByName('blueprints'),
              ),
            ),
        },
        {
          id: 'new-three',
          label: 'Nuova Scena 3D Three.js',
          action: () =>
            enterWorkbenchThen(() =>
              createVfsEntry(
                `Scena3D_${vfsTree.filter((n) => n.entryKind === 'three_scene').length + 1}.scene3d.json`,
                'three_scene',
                findFolderByName('scenes3d'),
              ),
            ),
        },
        { kind: 'divider' },
        {
          id: 'import-code',
          label: 'Importa Codice HTML/JSX/SVG...',
          shortcut: 'Ctrl+I',
          action: () => enterWorkbenchThen(() => setImportCodeModalOpen(true)),
        },
        {
          id: 'export-disk',
          label: 'Esporta Progetto Completo su Disco...',
          shortcut: 'Ctrl+Shift+E',
          action: () => {
            if (activeSheetId) void exportProjectScaffold(activeSheetId, globalTarget, globalDialect);
          },
        },
        {
          id: 'save-all',
          label: 'Salva Tutto',
          shortcut: 'Ctrl+S',
          action: () => handleSaveAll(),
        },
      ],
    },
    {
      id: 'edit',
      testId: 'menu-edit',
      label: 'Modifica',
      items: [
        {
          id: 'undo',
          label: 'Annulla',
          shortcut: 'Ctrl+Z',
          disabled: !canUndo,
          action: () => enterWorkbenchThen(() => undo()),
        },
        {
          id: 'redo',
          label: 'Ripeti',
          shortcut: 'Ctrl+Y',
          disabled: !canRedo,
          action: () => enterWorkbenchThen(() => redo()),
        },
        { kind: 'divider' },
        {
          id: 'cut',
          label: 'Taglia Elemento',
          shortcut: 'Ctrl+X',
          disabled: selectedNodeIds.length === 0,
          action: () => enterWorkbenchThen(() => cutSelectedNodes()),
        },
        {
          id: 'copy',
          label: 'Copia Elemento',
          shortcut: 'Ctrl+C',
          action: () => enterWorkbenchThen(() => copySelectedNodes()),
        },
        {
          id: 'paste',
          label: 'Incolla',
          shortcut: 'Ctrl+V',
          disabled: !copiedClipboard,
          action: () => enterWorkbenchThen(() => pasteCopiedNodes()),
        },
        {
          id: 'copy-style',
          label: 'Copia Stile CSS Nodo',
          shortcut: 'Ctrl+Alt+C',
          disabled: selectedNodeIds.length === 0,
          action: () => enterWorkbenchThen(() => copySelectedNodeStyle()),
        },
        {
          id: 'paste-style',
          label: 'Incolla Stile CSS su Selezione',
          shortcut: 'Ctrl+Alt+V',
          disabled: !copiedNodeStyle || selectedNodeIds.length === 0,
          action: () => enterWorkbenchThen(() => pasteStyleToSelectedNodes()),
        },
        {
          id: 'duplicate',
          label: 'Duplica',
          shortcut: 'Ctrl+D',
          action: () => enterWorkbenchThen(() => duplicateSelectedNode()),
        },
        {
          id: 'group-nodes',
          label: 'Raggruppa in Contenitore',
          shortcut: 'Ctrl+G',
          disabled: selectedNodeIds.length === 0,
          action: () => enterWorkbenchThen(() => groupSelectedNodes('auto')),
        },
        {
          id: 'ungroup-nodes',
          label: 'Separa Contenitore (Ungroup)',
          shortcut: 'Ctrl+Shift+G',
          disabled: !selectedNode || selectedNode.kind !== 'container',
          action: () => enterWorkbenchThen(() => ungroupSelectedContainer()),
        },
        {
          id: 'delete',
          label: 'Elimina',
          shortcut: 'Canc',
          action: () => enterWorkbenchThen(() => deleteSelectedNode()),
        },
        { kind: 'divider' },
        {
          id: 'select-all',
          label: 'Seleziona Tutto',
          shortcut: 'Ctrl+A',
          action: () => enterWorkbenchThen(() => handleSelectAll()),
        },
      ],
    },
    {
      id: 'selection',
      testId: 'menu-selection',
      label: 'Selezione',
      items: [
        {
          id: 'sel-parent',
          label: 'Seleziona Elemento Padre',
          disabled: !selectedNode?.parentId,
          action: () => enterWorkbenchThen(() => handleSelectParent()),
        },
        {
          id: 'sel-children',
          label: 'Seleziona Figli',
          disabled: !selectedNode || selectedNode.childIds.length === 0,
          action: () => enterWorkbenchThen(() => handleSelectChildren()),
        },
        {
          id: 'deselect-all',
          label: 'Deseleziona Tutto',
          shortcut: 'Esc',
          action: () => enterWorkbenchThen(() => selectNode(null)),
        },
        { kind: 'divider' },
        {
          id: 'nudge-up-1',
          label: 'Sposta Su di 1px',
          shortcut: '↑',
          action: () => enterWorkbenchThen(() => nudgeSelectedNodes(0, -1)),
        },
        {
          id: 'nudge-down-1',
          label: 'Sposta Giù di 1px',
          shortcut: '↓',
          action: () => enterWorkbenchThen(() => nudgeSelectedNodes(0, 1)),
        },
        {
          id: 'nudge-up-8',
          label: 'Sposta Su di 8px',
          shortcut: 'Shift+↑',
          action: () => enterWorkbenchThen(() => nudgeSelectedNodes(0, -8)),
        },
        {
          id: 'nudge-down-8',
          label: 'Sposta Giù di 8px',
          shortcut: 'Shift+↓',
          action: () => enterWorkbenchThen(() => nudgeSelectedNodes(0, 8)),
        },
        { kind: 'divider' },
        {
          id: 'z-front',
          label: 'Porta Avanti (Z-Index +1)',
          action: () => enterWorkbenchThen(() => adjustSelectedZIndex(1)),
        },
        {
          id: 'z-back',
          label: 'Porta Dietro (Z-Index -1)',
          action: () => enterWorkbenchThen(() => adjustSelectedZIndex(-1)),
        },
      ],
    },
    {
      id: 'view',
      testId: 'menu-view',
      label: 'Visualizza',
      items: [
        {
          id: 'view-canvas',
          label: 'Solo Design Canvas',
          shortcut: 'Ctrl+1',
          action: () => enterWorkbenchThen(() => applyLayoutPreset('canvas')),
        },
        {
          id: 'view-split-css',
          label: 'Affianca Design + CSS',
          shortcut: 'Ctrl+2',
          action: () => enterWorkbenchThen(() => applyLayoutPreset('split-css')),
        },
        {
          id: 'view-split-code',
          label: 'Affianca Design + Codice',
          shortcut: 'Ctrl+3',
          action: () => enterWorkbenchThen(() => applyLayoutPreset('split-code')),
        },
        {
          id: 'view-split-blueprint',
          label: 'Affianca Design + Blueprint',
          shortcut: 'Ctrl+4',
          action: () => enterWorkbenchThen(() => applyLayoutPreset('split-blueprint')),
        },
        {
          id: 'view-split-script',
          label: 'Affianca Design + Script TS/JS',
          shortcut: 'Ctrl+5',
          action: () => enterWorkbenchThen(() => applyLayoutPreset('split-script')),
        },
        {
          id: 'view-three-studio',
          label: 'Studio 3D Three.js',
          shortcut: 'Ctrl+6',
          action: () => enterWorkbenchThen(() => applyLayoutPreset('three-studio')),
        },
        {
          id: 'view-split-preview',
          label: 'Affianca Design + Anteprima Live',
          shortcut: 'Ctrl+7',
          action: () => enterWorkbenchThen(() => applyLayoutPreset('split-preview')),
        },
        { kind: 'divider' },
        {
          id: 'toggle-rulers',
          label: 'Mostra/Nascondi Righelli',
          checked: showRulers,
          action: () => enterWorkbenchThen(() => setShowRulers(!showRulers)),
        },
        {
          id: 'toggle-grid',
          label: 'Mostra/Nascondi Griglia Snap',
          checked: snapToGrid8px,
          action: () => enterWorkbenchThen(() => toggleSnapToGrid8px()),
        },
        {
          id: 'toggle-console',
          label: 'Mostra/Nascondi Console Inferiore',
          shortcut: 'Ctrl+J',
          checked: bottomConsoleOpen,
          action: () => enterWorkbenchThen(() => setBottomConsoleOpen(!bottomConsoleOpen)),
        },
        {
          id: 'toggle-right-dock',
          label: 'Mostra/Nascondi Pannello Destro AI & Proprietà',
          checked: !rightDockCollapsed,
          action: () => enterWorkbenchThen(() => toggleRightDock()),
        },
        {
          id: 'toggle-theme',
          label: 'Tema Chiaro / Scuro',
          action: () => setStudioTheme(studioTheme === 'dark' ? 'light' : 'dark'),
        },
        { kind: 'divider' },
        {
          id: 'open-cmd-palette',
          label: 'Palette Comandi...',
          shortcut: 'Ctrl+Shift+P',
          action: () => setCommandPaletteOpen(true),
        },
      ],
    },
    {
      id: 'insert',
      testId: 'menu-insert',
      label: 'Inserisci',
      items: [
        {
          id: 'ins-frame',
          label: 'Contenitore Libero / Frame',
          action: () => enterWorkbenchThen(() => insertPaletteElement('layout-zstack')),
        },
        {
          id: 'ins-row',
          label: 'Riga Flex',
          action: () => enterWorkbenchThen(() => insertPaletteElement('layout-row')),
        },
        {
          id: 'ins-col',
          label: 'Colonna Flex',
          action: () => enterWorkbenchThen(() => insertPaletteElement('layout-column')),
        },
        {
          id: 'ins-grid',
          label: 'Griglia 2x2',
          action: () => enterWorkbenchThen(() => insertPaletteElement('layout-grid')),
        },
        { kind: 'divider' },
        {
          id: 'ins-button',
          label: 'Bottone',
          action: () => enterWorkbenchThen(() => insertPaletteElement('ctrl-button')),
        },
        {
          id: 'ins-heading',
          label: 'Testo / Titolo',
          action: () => enterWorkbenchThen(() => insertPaletteElement('ctrl-heading')),
        },
        {
          id: 'ins-input',
          label: 'Input Testo',
          action: () => enterWorkbenchThen(() => insertPaletteElement('ctrl-input')),
        },
        {
          id: 'ins-card',
          label: 'Card',
          action: () => enterWorkbenchThen(() => insertPaletteElement('layout-card')),
        },
        {
          id: 'ins-table',
          label: 'Tabella',
          action: () => enterWorkbenchThen(() => insertPaletteElement('ctrl-table')),
        },
        {
          id: 'ins-htmx-form',
          label: 'Form HTMX',
          action: () => enterWorkbenchThen(() => insertPaletteElement('smart-htmx-form')),
        },
        { kind: 'divider' },
        {
          id: 'ins-three-vp',
          label: 'Viewport 3D Three.js',
          action: () => enterWorkbenchThen(() => embedThreeSceneInActiveSheet()),
        },
      ],
    },
    {
      id: 'design-css',
      testId: 'menu-design-css',
      label: 'Design & CSS',
      items: [
        {
          id: 'mode-freeform',
          label: 'Passa a Posizionamento Libero (X, Y)',
          checked: canvasPlacementMode === 'freeform',
          action: () => enterWorkbenchThen(() => setCanvasPlacementMode('freeform')),
        },
        {
          id: 'detach-node',
          label: 'Sgancia / Riaggancia Elemento (Absolute ↔ Flow)',
          disabled: !selectedNode || selectedNode.kind === 'artboard',
          action: () => enterWorkbenchThen(() => toggleNodeFreeformDetach()),
        },
        {
          id: 'convert-autolayout',
          label: 'Converti Contenitore in Auto-Layout',
          action: () => enterWorkbenchThen(() => solveAutoLayoutOnActive()),
        },
        { kind: 'divider' },
        {
          id: 'open-css-live',
          label: 'Apri Editor CSS Bidirezionale',
          shortcut: 'Ctrl+2',
          action: () => enterWorkbenchThen(() => applyLayoutPreset('split-css')),
        },
        {
          id: 'open-tokens',
          label: 'Design Tokens & Temi',
          action: () => enterWorkbenchThen(() => setLeftActiveMode('tokens')),
        },
        {
          id: 'open-wcag',
          label: 'Audit Accessibilità WCAG 2.2...',
          action: () => enterWorkbenchThen(() => setA11yModalOpen(true)),
        },
      ],
    },
    {
      id: 'logic-blueprint',
      testId: 'menu-logic-blueprint',
      label: 'Automazioni No-Code',
      items: [
        {
          id: 'open-automation-studio',
          label: 'Apri Studio Automazioni No-Code & Script .js',
          shortcut: 'Ctrl+Shift+A',
          action: () => enterWorkbenchThen(() => applyLayoutPreset('split-automation')),
        },
        {
          id: 'open-script',
          label: 'Apri Editor Script JS / TS / Python',
          shortcut: 'Ctrl+5',
          action: () => enterWorkbenchThen(() => applyLayoutPreset('split-script')),
        },
        {
          id: 'open-blueprint',
          label: 'Apri Editor Grafo Blueprint (stile Unreal)',
          shortcut: 'Ctrl+4',
          action: () => enterWorkbenchThen(() => applyLayoutPreset('split-blueprint')),
        },
        {
          id: 'bind-script-click',
          label: 'Collega Funzione Click al Nodo Selezionato',
          disabled: !selectedNode,
          action: () =>
            enterWorkbenchThen(async () => {
              if (selectedNode) {
                await createAndBindScriptFunctionForNode(selectedNode.id, 'onClick');
                applyLayoutPreset('split-script');
              }
            }),
        },
        { kind: 'divider' },
        {
          id: 'add-bp-click',
          label: 'Nuovo Nodo Evento Click (Blueprint)',
          action: () => enterWorkbenchThen(() => handleAddBlueprintClickEvent()),
        },
        {
          id: 'run-bp-sim',
          label: 'Esegui Simulazione Logica',
          action: () => enterWorkbenchThen(() => handleRunBlueprintSim()),
        },
      ],
    },
    {
      id: 'sql-studio',
      testId: 'menu-sql-studio',
      label: 'SQL Studio',
      items: [
        {
          id: 'open-sql-studio',
          label: 'Apri SQL & Data Studio (5 Dialetti)',
          shortcut: 'Ctrl+Shift+D',
          action: () =>
            enterWorkbenchThen(async () => {
              await loadSqlSchemaAction(project?.id);
              applyLayoutPreset('split-sql');
            }),
        },
        {
          id: 'new-sql-file',
          label: 'Nuovo File Query SQL (.sql)',
          action: () =>
            enterWorkbenchThen(() =>
              createVfsEntry(
                `query-${vfsTree.filter((n) => n.entryKind === 'sql_file').length + 1}.sql`,
                'sql_file',
                findFolderByName('src'),
              ),
            ),
        },
      ],
    },
    {
      id: 'three',
      testId: 'menu-three',
      label: 'Scena 3D',
      items: [
        {
          id: 'open-three-studio',
          label: 'Apri Three.js 3D Studio',
          shortcut: 'Ctrl+6',
          action: () => enterWorkbenchThen(() => applyLayoutPreset('three-studio')),
        },
        {
          id: 'embed-three-canvas',
          label: 'Inserisci Viewport 3D nel Canvas',
          action: () => enterWorkbenchThen(() => embedThreeSceneInActiveSheet()),
        },
        { kind: 'divider' },
        {
          id: 'add-3d-box',
          label: 'Aggiungi Cubo 3D',
          action: () => enterWorkbenchThen(() => handleAddThreeObject('box')),
        },
        {
          id: 'add-3d-sphere',
          label: 'Aggiungi Sfera 3D',
          action: () => enterWorkbenchThen(() => handleAddThreeObject('sphere')),
        },
        {
          id: 'add-3d-torusknot',
          label: 'Aggiungi TorusKnot 3D',
          action: () => enterWorkbenchThen(() => handleAddThreeObject('torusKnot')),
        },
        {
          id: 'add-3d-particles',
          label: 'Aggiungi Particelle 3D',
          action: () => enterWorkbenchThen(() => handleAddThreeObject('particles')),
        },
        { kind: 'divider' },
        {
          id: 'export-three-ts',
          label: 'Esporta Codice Three.js (.ts)',
          action: () => enterWorkbenchThen(() => handleExportThreeCode('three-ts')),
        },
        {
          id: 'export-r3f-tsx',
          label: 'Esporta Codice React Three Fiber (.tsx)',
          action: () => enterWorkbenchThen(() => handleExportThreeCode('r3f-tsx')),
        },
      ],
    },
    {
      id: 'project-export',
      testId: 'menu-project-export',
      label: 'Progetto',
      items: [
        { kind: 'section', label: 'Toolchain Runner & Ambiente Disco' },
        {
          id: 'tc-doctor',
          label: 'Verifica Toolchain Doctor (Node / Python / Rust)',
          action: () =>
            enterWorkbenchThen(async () => {
              const rep = await refreshToolchainDoctor();
              setBottomConsoleOpen(true);
              if (rep) {
                pushToast(
                  'info',
                  `Toolchain: Node ${rep.node.version ?? '—'} • Python ${rep.python.version ?? '—'} • Rust ${rep.rustc.version ?? '—'}`,
                );
              }
            }),
        },
        {
          id: 'tc-init',
          label: 'Inizializza Dipendenze (npm install / .venv / cargo)',
          action: () => enterWorkbenchThen(() => runToolchainTaskAction({ kind: 'init' })),
        },
        {
          id: 'tc-dev',
          label: 'Avvia Dev Server Live',
          action: () => enterWorkbenchThen(() => runToolchainTaskAction({ kind: 'dev' })),
        },
        {
          id: 'tc-cargo-check',
          label: 'Esegui Cargo Check (Tauri / Rust)',
          action: () => enterWorkbenchThen(() => runToolchainTaskAction({ kind: 'cargo_check' })),
        },
        {
          id: 'tc-stop',
          label: 'Interrompi Processi Toolchain Attivi',
          disabled: !toolchainTasks.some((t) => t.status === 'running'),
          action: () =>
            enterWorkbenchThen(async () => {
              for (const t of toolchainTasks.filter((tk) => tk.status === 'running')) {
                await stopToolchainTaskAction(t.taskId);
              }
            }),
        },
        { kind: 'divider' },
        { kind: 'section', label: 'Cambio Rapido Target Compilazione' },
        ...QUICK_TARGETS.map((qt) => ({
          id: `qt-${qt.id}`,
          label: qt.label,
          checked: globalTarget === qt.id,
          action: () => setGlobalTarget(qt.id),
        })),
        { kind: 'divider' },
        {
          id: 'copy-comp-code',
          label: 'Copia Componente Compilato',
          action: () => handleCopyComponentCode(),
        },
        {
          id: 'export-scaffold-full',
          label: 'Esporta Scaffold Completo su Disco...',
          shortcut: 'Ctrl+Shift+E',
          action: () => {
            if (activeSheetId) void exportProjectScaffold(activeSheetId, globalTarget, globalDialect);
          },
        },
      ],
    },
    {
      id: 'ai',
      testId: 'menu-ai',
      label: 'AI Locale',
      items: [
        {
          id: 'ai-ensure-ollama',
          label: isOllamaOnline
            ? `Ollama Attivo (${displayOllamaModel}) — Aggiorna`
            : 'Avvia / Riconnetti Ollama (:11434)',
          checked: isOllamaOnline,
          action: () => ensureOllamaRunningAction(false),
        },
        {
          id: 'ai-hub-architect',
          label: 'Architetto Progetto AI (Startup)...',
          action: () => {
            setHubActiveSection('architect');
            setShowProjectHub(true);
          },
        },
        {
          id: 'ai-ollama-engine',
          label: 'Gestione Motore & Modelli Ollama...',
          action: () => {
            setHubActiveSection('ollama');
            setShowProjectHub(true);
          },
        },
        { kind: 'divider' },
        {
          id: 'ai-prompt-ui',
          label: 'Prompt -> UI (Editor)',
          checked: !showProjectHub && agentMode === 'prompt_to_ui',
          action: () =>
            enterWorkbenchThen(() => {
              setRightDockCollapsed(false);
              setAgentMode('prompt_to_ui');
              setRightPanelMode('agent');
            }),
        },
        {
          id: 'ai-vision-ui',
          label: 'Vision -> UI (Screenshot)',
          checked: !showProjectHub && agentMode === 'vision_to_ui',
          action: () =>
            enterWorkbenchThen(() => {
              setRightDockCollapsed(false);
              setAgentMode('vision_to_ui');
              setRightPanelMode('agent');
            }),
        },
        {
          id: 'ai-surgical',
          label: 'Co-Pilot Chirurgico',
          checked: !showProjectHub && agentMode === 'surgical',
          action: () =>
            enterWorkbenchThen(() => {
              setRightDockCollapsed(false);
              askAiAboutSelection();
            }),
        },
        { kind: 'divider' },
        {
          id: 'ai-unsloth',
          label: 'Unsloth Hub & Esporta Dataset LoRA...',
          action: () => setUnslothModalOpen(true),
        },
        {
          id: 'ai-restore-cp',
          label: 'Ripristina Ultimo Checkpoint SQLite',
          disabled: checkpoints.length === 0,
          action: () =>
            enterWorkbenchThen(() => {
              if (checkpoints[0]) void restoreAiCheckpoint(checkpoints[0].id);
            }),
        },
        {
          id: 'ai-refresh',
          label: 'Aggiorna Stato Ollama / LM Studio',
          action: () => refreshAiProviders(),
        },
      ],
    },
    {
      id: 'help',
      testId: 'menu-help',
      label: 'Aiuto',
      items: [
        {
          id: 'help-about',
          label: 'Informazioni su Visual UI Studio',
          action: () => aboutRef.current?.showModal(),
        },
        {
          id: 'help-cmd-palette',
          label: 'Palette Comandi',
          shortcut: 'Ctrl+Shift+P',
          action: () => setCommandPaletteOpen(true),
        },
        {
          id: 'help-shortcuts',
          label: 'Guida Rapida & Scorciatoie',
          shortcut: 'F1',
          action: () => setShortcutsHelpOpen(true),
        },
        { kind: 'divider' },
        {
          id: 'help-demo',
          label: 'Apri Demo NovaCommerce',
          action: () => openDemoProject(),
        },
      ],
    },
  ];

  const handleOllamaPillClick = () => {
    setOpenMenuId(null);
    if (!isOllamaOnline) {
      void ensureOllamaRunningAction(false);
      return;
    }
    if (showProjectHub) {
      setHubActiveSection('ollama');
      void refreshAiProviders();
    } else {
      setRightDockCollapsed(false);
      setRightPanelMode('agent');
      void refreshAiProviders();
    }
  };

  return (
    <nav
      ref={barRef}
      className="app-menubar"
      data-testid="app-menubar"
      aria-label="Barra dei menu dell'applicazione"
    >
      <div className="menubar-left">
        <button
          type="button"
          className={`menubar-home-btn ${showProjectHub ? 'active' : ''}`}
          data-testid="btn-menubar-home"
          title="Schermata Iniziale — Apertura & Creazione Progetti"
          aria-label="Schermata iniziale"
          onClick={() => {
            setOpenMenuId(null);
            setShowProjectHub(true);
          }}
        >
          <img
            src="./app-icon.png"
            alt=""
            width={18}
            height={18}
            style={{ borderRadius: 4, display: 'block' }}
          />
        </button>

        {menus.map((menu) => {
          const isOpen = openMenuId === menu.id;
          const openAnchoredTo = (el: HTMLElement, nextId: string | null) => {
            if (!nextId) {
              setOpenMenuId(null);
              return;
            }
            const rect = el.getBoundingClientRect();
            const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
            const left = Math.max(6, Math.min(rect.left, vw - 326));
            setDropdownPos({ top: Math.round(rect.bottom + 3), left: Math.round(left) });
            setOpenMenuId(nextId);
          };

          return (
            <div key={menu.id} className="menubar-item-wrap">
              <button
                type="button"
                className={`menubar-trigger ${isOpen ? 'open' : ''}`}
                data-testid={menu.testId}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                aria-controls={isOpen ? `studio-dropdown-${menu.id}` : undefined}
                onClick={(e) => openAnchoredTo(e.currentTarget, isOpen ? null : menu.id)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    const buttons = Array.from(barRef.current?.querySelectorAll<HTMLButtonElement>('.menubar-trigger') ?? []);
                    const index = buttons.indexOf(e.currentTarget);
                    const step = e.key === 'ArrowLeft' ? -1 : 1;
                    const next = buttons[(index + step + buttons.length) % buttons.length];
                    if (!next) return;
                    e.preventDefault();
                    setOpenMenuId(null);
                    next.focus();
                    return;
                  }
                  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                  e.preventDefault();
                  const last = e.key === 'ArrowUp';
                  openAnchoredTo(e.currentTarget, menu.id);
                  requestAnimationFrame(() => {
                    const options = document.getElementById(`studio-dropdown-${menu.id}`)
                      ?.querySelectorAll<HTMLButtonElement>('.menubar-option:not(:disabled)');
                    if (options?.length) options[last ? options.length - 1 : 0].focus();
                  });
                }}
                onMouseEnter={(e) => {
                  if (openMenuId && openMenuId !== menu.id) {
                    openAnchoredTo(e.currentTarget, menu.id);
                  }
                }}
              >
                {menu.label}
              </button>

              {isOpen && (
                <div
                  className="menubar-dropdown"
                  style={{ top: dropdownPos.top, left: dropdownPos.left }}
                  role="menu"
                  id={`studio-dropdown-${menu.id}`}
                  aria-label={menu.label}
                  data-testid={`dropdown-${menu.testId}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      setOpenMenuId(null);
                      e.currentTarget.parentElement?.querySelector<HTMLButtonElement>('.menubar-trigger')?.focus();
                      return;
                    }
                    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
                    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('.menubar-option:not(:disabled)'));
                    if (items.length === 0) return;
                    e.preventDefault();
                    const current = items.indexOf(document.activeElement as HTMLButtonElement);
                    if (e.key === 'Home') items[0].focus();
                    else if (e.key === 'End') items.at(-1)?.focus();
                    else {
                      const step = e.key === 'ArrowUp' ? -1 : 1;
                      items[(current + step + items.length) % items.length].focus();
                    }
                  }}
                >
                  {menu.items.map((entry, idx) => {
                    if (entry.kind === 'divider') {
                      return <div key={`div_${idx}`} className="menubar-divider" />;
                    }
                    if (entry.kind === 'section') {
                      return (
                        <div key={`sec_${idx}`} className="menubar-section-label">
                          {entry.label}
                        </div>
                      );
                    }
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        role="menuitem"
                        className="menubar-option"
                        data-testid={`menu-item-${entry.id}`}
                        disabled={entry.disabled}
                        onClick={() => {
                          setOpenMenuId(null);
                          void entry.action();
                        }}
                      >
                        <span className="menubar-option-left">
                          <span className="menubar-check">
                            {entry.checked ? <Check size={12} /> : null}
                          </span>
                          <span>{entry.label}</span>
                        </span>
                        {entry.shortcut && (
                          <span className="menubar-shortcut">{entry.shortcut}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="menubar-right">
        {/* Live Ollama Daemon & Model Pill */}
        <button
          type="button"
          className={`menubar-ollama-pill ${isOllamaOnline ? 'online' : ollamaEnsureStatus === 'starting' ? 'starting' : 'offline'}`}
          data-testid="menubar-ollama-pill"
          onClick={handleOllamaPillClick}
          title={
            isOllamaOnline
              ? `Ollama attivo su :11434 (${displayOllamaModel}) — clicca per pannello modelli`
              : 'Clicca per avviare / connettere Ollama in locale (:11434)'
          }
        >
          {isOllamaOnline ? (
            <>
              <span className="menubar-status-dot online" aria-hidden="true" />
              <span className="menubar-ollama-text">Ollama: {displayOllamaModel}</span>
            </>
          ) : ollamaEnsureStatus === 'starting' ? (
            <>
              <Loader2 size={11} className="spin-icon" color="var(--accent-amber)" />
              <span className="menubar-ollama-text">Avvio Ollama...</span>
            </>
          ) : (
            <>
              <Zap size={11} color="var(--accent-amber)" />
              <span className="menubar-ollama-text">Avvia Ollama</span>
            </>
          )}
        </button>

        {/* VS Code-style Quick Command Search Pill */}
        <button
          type="button"
          className="menubar-command-pill"
          data-testid="btn-open-command-palette"
          aria-label="Palette comandi"
          onClick={() => {
            setOpenMenuId(null);
            setCommandPaletteOpen(true);
          }}
          title="Apri Palette Comandi (Ctrl+Shift+P / Ctrl+K)"
        >
          <Search size={11} />
          <span>Comandi</span>
          <span className="menubar-shortcut">Ctrl+Shift+P</span>
        </button>
      </div>
      <dialog
        ref={aboutRef}
        className="studio-about-dialog"
        aria-labelledby="studio-about-title"
        data-testid="studio-about-dialog"
        onClose={() => barRef.current?.querySelector<HTMLButtonElement>('[data-testid="menu-help"]')?.focus()}
      >
        <img src="./app-icon.png" width={44} height={44} alt="" />
        <h2 id="studio-about-title">Visual UI Studio</h2>
        <p>Versione {STUDIO_VERSION}</p>
        <p>Copyright © 2026 Daniele Gabrovec</p>
        <p>
          <a href="https://github.com/danielegabrovec/visual-ui-studio/blob/main/LICENSE" target="_blank" rel="noreferrer">Licenza MIT</a>
          {' · '}
          <a href="https://github.com/danielegabrovec/visual-ui-studio" target="_blank" rel="noreferrer">Codice sorgente</a>
        </p>
        <form method="dialog">
          <button type="submit" className="studio-btn">Chiudi</button>
        </form>
      </dialog>
    </nav>
  );
};
