import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Code2,
  Columns2,
  Database,
  FileCode2,
  LayoutGrid,
  Palette,
  PlaySquare,
  Rows2,
  ScrollText,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import { isTextFileVfsKind } from '@shared/ipc-contract';
import { useStudioStore, type WorkspaceTab } from '@renderer/state/studio-store';
import { useShallow } from 'zustand/react/shallow';
import { VisualCanvasView } from './VisualCanvasView';
import { CssLiveEditorView } from './CssLiveEditorView';
import { LiveCodeView } from './LiveCodeView';
import { BlueprintNodeEditorView } from './BlueprintNodeEditorView';
import { ScriptWorkbenchView } from './ScriptWorkbenchView';
import { VisualAutomationStudioView } from './VisualAutomationStudioView';
import { SqlStudioView } from './sql-studio/SqlStudioView';
import { ThreeSceneStudioView } from './ThreeSceneStudioView';
import { LiveSandboxPreview } from './LiveSandboxPreview';
import { CodeEditorView } from './CodeEditorView';

export const CenterWorkspace: React.FC = () => {
  const workspaceRef = useRef<HTMLElement | null>(null);
  const [isNarrowMain, setIsNarrowMain] = useState<boolean>(false);

  const project = useStudioStore((s) => s.project);
  const editorGroups = useStudioStore((s) => s.editorGroups);
  const activeGroupId = useStudioStore((s) => s.activeGroupId);
  const splitOrientation = useStudioStore((s) => s.splitOrientation);
  const groupSizes = useStudioStore((s) => s.groupSizes);
  const activeSheetId = useStudioStore((s) => s.activeSheetId);
  const sheetDocuments = useStudioStore((s) => s.sheetDocuments);
  const globalTarget = useStudioStore((s) => s.globalTarget);
  const globalDialect = useStudioStore((s) => s.globalDialect);
  const activeBlueprintId = useStudioStore((s) => s.activeBlueprintId);
  const activeThreeSceneId = useStudioStore((s) => s.activeThreeSceneId);
  const activeScriptVfsId = useStudioStore((s) => s.activeScriptVfsId);
  const activeAutomationId = useStudioStore((s) => s.activeAutomationId);
  const vfsTree = useStudioStore((s) => s.vfsTree);
  const dirtySourceIds = useStudioStore(useShallow((s) => Object.keys(s.sourceDrafts).filter(
    (id) => s.sourceDrafts[id].content !== s.sourceFiles[id],
  )));

  const setGroupSizes = useStudioStore((s) => s.setGroupSizes);
  const activateTab = useStudioStore((s) => s.activateTab);
  const closeTab = useStudioStore((s) => s.closeTab);
  const openTabInGroup = useStudioStore((s) => s.openTabInGroup);
  const openVfsSource = useStudioStore((s) => s.openVfsSource);
  const splitEditorGroup = useStudioStore((s) => s.splitEditorGroup);
  const ensureActiveBlueprintGraph = useStudioStore((s) => s.ensureActiveBlueprintGraph);
  const ensureActiveScriptFile = useStudioStore((s) => s.ensureActiveScriptFile);
  const ensureActiveThreeScene = useStudioStore((s) => s.ensureActiveThreeScene);
  const loadSqlSchemaAction = useStudioStore((s) => s.loadSqlSchemaAction);

  useEffect(() => {
    const el = workspaceRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const updateWidth = (w: number) => {
      if (w > 0) {
        setIsNarrowMain(w < 620);
      }
    };
    updateWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        updateWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const effectiveOrientation: 'horizontal' | 'vertical' =
    editorGroups.length >= 2 && isNarrowMain ? 'vertical' : splitOrientation;

  const activeSheetName = sheetDocuments[activeSheetId]?.name ?? 'HomeDashboard';

  const normalizedSizes =
    groupSizes.length === editorGroups.length
      ? groupSizes
      : editorGroups.map(() => 100 / Math.max(1, editorGroups.length));

  const handleSplitSashDown = (e: React.PointerEvent, leftIndex: number) => {
    e.preventDefault();
    const container = workspaceRef.current;
    if (!container || editorGroups.length < 2) return;
    const rect = container.getBoundingClientRect();
    const totalPx = effectiveOrientation === 'vertical' ? rect.height : rect.width;
    if (totalPx <= 0) return;

    const startCoord = effectiveOrientation === 'vertical' ? e.clientY : e.clientX;
    const startSizes = [...normalizedSizes];
    const pairSum = (startSizes[leftIndex] ?? 50) + (startSizes[leftIndex + 1] ?? 50);

    const onMove = (ev: PointerEvent) => {
      const curCoord = effectiveOrientation === 'vertical' ? ev.clientY : ev.clientX;
      const deltaPct = ((curCoord - startCoord) / totalPx) * 100;
      const minPct = Math.min(18, pairSum * 0.3);
      const nextLeft = Math.max(minPct, Math.min(pairSum - minPct, startSizes[leftIndex] + deltaPct));
      const nextRight = pairSum - nextLeft;
      const updated = [...startSizes];
      updated[leftIndex] = Number(nextLeft.toFixed(2));
      updated[leftIndex + 1] = Number(nextRight.toFixed(2));
      setGroupSizes(updated);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const tabIcon = (tab: WorkspaceTab) => {
    if (tab.kind === 'canvas') return <LayoutGrid size={13} color="var(--accent-primary)" />;
    if (tab.kind === 'css') return <Palette size={13} color="#ec4899" />;
    if (tab.kind === 'code') return <Code2 size={13} color="var(--accent-violet)" />;
    if (tab.kind === 'blueprint') return <Workflow size={13} color="#f59e0b" />;
    if (tab.kind === 'script') return <ScrollText size={13} color="#38bdf8" />;
    if (tab.kind === 'automation') return <Zap size={13} color="var(--accent-amber)" />;
    if (tab.kind === 'sql_studio') return <Database size={13} color="var(--accent-emerald)" />;
    if (tab.kind === 'three_scene') return <Box size={13} color="var(--accent-emerald)" />;
    if (tab.kind === 'preview') return <PlaySquare size={13} color="var(--accent-emerald)" />;
    return <FileCode2 size={13} color="var(--accent-amber)" />;
  };

  return (
    <main
      ref={workspaceRef}
      className="center-workspace"
      style={{ flexDirection: effectiveOrientation === 'vertical' ? 'column' : 'row' }}
      data-testid="center-multi-sheet-workspace"
    >
      {editorGroups.map((group, grpIdx) => {
        const activeTab = group.tabs.find((t) => t.id === group.activeTabId) ?? group.tabs[0];
        const activeFile = activeTab?.vfsEntryId ? vfsTree.find((entry) => entry.id === activeTab.vfsEntryId) : undefined;
        const canOpenSource = activeFile && activeTab?.kind !== 'source_file' && isTextFileVfsKind(activeFile.entryKind);
        const canCloseTab = !(editorGroups.length === 1 && group.tabs.length <= 1);
        const sizePct = normalizedSizes[grpIdx] ?? 100 / Math.max(1, editorGroups.length);

        return (
          <React.Fragment key={group.id}>
            <section
              className="editor-group"
              style={{
                flex: `${sizePct} 1 0%`,
                minWidth: effectiveOrientation === 'vertical' ? 0 : 220,
                minHeight: effectiveOrientation === 'vertical' ? 140 : 180,
                borderRight: 'none',
              }}
              data-testid={`editor-group-${grpIdx + 1}`}
              onPointerDown={() => {
                if (activeGroupId !== group.id && activeTab) {
                  activateTab(group.id, activeTab.id);
                }
              }}
            >
              {/* Group Tab Bar */}
              <div className="editor-tabbar">
                <div className="editor-tabs-list" role="tablist">
                  {group.tabs.map((tab) => {
                    const isAct = activeTab?.id === tab.id;
                    const hasSourceDraft = tab.kind === 'source_file' && tab.vfsEntryId && dirtySourceIds.includes(tab.vfsEntryId);
                    return (
                      <div
                        key={tab.id}
                        role="tab"
                        aria-selected={isAct}
                        className={`editor-tab ${isAct ? 'active' : ''}`}
                        data-testid={`workspace-tab-${tab.kind}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          activateTab(group.id, tab.id);
                        }}
                      >
                        {tabIcon(tab)}
                        <span>{tab.title}</span>
                        {hasSourceDraft && <span title="Modifiche non salvate" aria-label="Modifiche non salvate">●</span>}
                        {canCloseTab && (
                          <button
                            type="button"
                            className="tab-close-btn"
                            data-testid={`close-tab-${tab.kind}`}
                            title="Chiudi scheda"
                            onClick={(e) => {
                              e.stopPropagation();
                              closeTab(group.id, tab.id);
                            }}
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Group Quick Open & Split Controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                  {canOpenSource && (
                    <button
                      type="button"
                      className="studio-btn sm ghost"
                      data-testid="btn-open-workbench-source"
                      title={`Modifica il sorgente di ${activeFile.name}`}
                      onClick={() => void openVfsSource(activeFile, group.id)}
                    >
                      <FileCode2 size={12} />
                      <span>Sorgente</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="studio-btn sm ghost"
                    data-testid={`btn-open-css-tab-${grpIdx + 1}`}
                    title="Apri scheda CSS Bidirezionale in questo gruppo"
                    onClick={() =>
                      openTabInGroup(
                        {
                          kind: 'css',
                          title: `CSS: ${activeSheetName}`,
                          sheetId: activeSheetId,
                        },
                        group.id,
                      )
                    }
                  >
                    <Palette size={12} />
                    <span>CSS</span>
                  </button>

                  <button
                    type="button"
                    className="studio-btn sm ghost"
                    data-testid={`btn-open-code-tab-${grpIdx + 1}`}
                    title="Apri scheda Codice Live in questo gruppo"
                    onClick={() =>
                      openTabInGroup(
                        {
                          kind: 'code',
                          title: `Codice: ${activeSheetName}`,
                          sheetId: activeSheetId,
                          targetId: globalTarget,
                          dialect: globalDialect,
                        },
                        group.id,
                      )
                    }
                  >
                    <Code2 size={12} />
                    <span>Codice</span>
                  </button>

                  <button
                    type="button"
                    className="studio-btn sm ghost"
                    data-testid={`btn-open-automation-tab-${grpIdx + 1}`}
                    title="Apri Studio Automazioni No-Code & Script .js (Ctrl+Shift+A)"
                    onClick={() => {
                      void ensureActiveScriptFile();
                      openTabInGroup(
                        {
                          kind: 'automation',
                          title: 'Automazioni No-Code',
                          sheetId: activeSheetId,
                          vfsEntryId: activeScriptVfsId ?? undefined,
                        },
                        group.id,
                      );
                    }}
                  >
                    <Zap size={12} color="var(--accent-amber)" />
                    <span>Auto</span>
                  </button>

                  <button
                    type="button"
                    className="studio-btn sm ghost"
                    data-testid={`btn-open-sql-tab-${grpIdx + 1}`}
                    title="Apri SQL & Data Studio Multi-Dialetto (Ctrl+Shift+D)"
                    onClick={() => {
                      void loadSqlSchemaAction(project?.id);
                      openTabInGroup(
                        {
                          kind: 'sql_studio',
                          title: 'SQL & Data Studio',
                          sheetId: activeSheetId,
                        },
                        group.id,
                      );
                    }}
                  >
                    <Database size={12} color="var(--accent-emerald)" />
                    <span>SQL</span>
                  </button>

                  <button
                    type="button"
                    className="studio-btn sm ghost"
                    title="Apri scheda Grafo Blueprint in questo gruppo"
                    onClick={() => {
                      void ensureActiveBlueprintGraph();
                      openTabInGroup(
                        {
                          kind: 'blueprint',
                          title: 'Blueprint: Logica',
                          sheetId: activeSheetId,
                          blueprintId: activeBlueprintId ?? undefined,
                        },
                        group.id,
                      );
                    }}
                  >
                    <Workflow size={12} />
                  </button>

                  <button
                    type="button"
                    className="studio-btn sm ghost"
                    title="Apri scheda Script TS/JS in questo gruppo"
                    onClick={() => {
                      void ensureActiveScriptFile();
                      openTabInGroup(
                        {
                          kind: 'script',
                          title: 'Script TS/JS',
                          sheetId: activeSheetId,
                          vfsEntryId: activeScriptVfsId ?? undefined,
                        },
                        group.id,
                      );
                    }}
                  >
                    <ScrollText size={12} />
                  </button>

                  <button
                    type="button"
                    className="studio-btn sm ghost"
                    title="Apri Studio 3D Three.js in questo gruppo"
                    onClick={() => {
                      void ensureActiveThreeScene();
                      openTabInGroup(
                        {
                          kind: 'three_scene',
                          title: 'Studio 3D Three.js',
                          sheetId: activeSheetId,
                          threeSceneId: activeThreeSceneId ?? undefined,
                        },
                        group.id,
                      );
                    }}
                  >
                    <Box size={12} />
                  </button>

                  <button
                    type="button"
                    className="studio-btn sm ghost"
                    data-testid={`btn-open-preview-tab-${grpIdx + 1}`}
                    title="Apri scheda Sandbox Live Preview in questo gruppo"
                    onClick={() =>
                      openTabInGroup(
                        {
                          kind: 'preview',
                          title: `Preview: ${activeSheetName}`,
                          sheetId: activeSheetId,
                        },
                        group.id,
                      )
                    }
                  >
                    <PlaySquare size={12} />
                    <span>Preview</span>
                  </button>

                  <button
                    type="button"
                    className="studio-btn sm ghost"
                    data-testid="btn-split-right"
                    title="Split Right ◫ (Affianca nuovo gruppo a destra)"
                    onClick={() => splitEditorGroup('horizontal', 'code')}
                  >
                    <Columns2 size={13} />
                  </button>

                  <button
                    type="button"
                    className="studio-btn sm ghost"
                    data-testid="btn-split-down"
                    title="Split Down ⊟ (Dividi gruppo in basso)"
                    onClick={() => splitEditorGroup('vertical', 'preview')}
                  >
                    <Rows2 size={13} />
                  </button>
                </div>
              </div>

              {/* Active Tab View Renderer (All 10 WorkspaceTabKinds) */}
              {activeTab?.kind === 'canvas' && (
                <VisualCanvasView sheetId={activeTab.sheetId || activeSheetId} />
              )}
              {activeTab?.kind === 'css' && (
                <CssLiveEditorView
                  sheetId={activeTab.sheetId || activeSheetId}
                  groupId={group.id}
                  vfsEntryId={activeTab.vfsEntryId}
                />
              )}
              {activeTab?.kind === 'code' && <LiveCodeView groupId={group.id} tab={activeTab} />}
              {activeTab?.kind === 'blueprint' && (
                <BlueprintNodeEditorView
                  vfsEntryId={activeTab.vfsEntryId}
                  blueprintId={activeTab.blueprintId ?? activeBlueprintId ?? undefined}
                  sheetId={activeTab.sheetId || activeSheetId}
                />
              )}
              {activeTab?.kind === 'script' && (
                <ScriptWorkbenchView
                  vfsEntryId={activeTab.vfsEntryId ?? activeScriptVfsId ?? undefined}
                  sheetId={activeTab.sheetId || activeSheetId}
                />
              )}
              {activeTab?.kind === 'automation' && (
                <VisualAutomationStudioView
                  sheetId={activeTab.sheetId || activeSheetId}
                  vfsEntryId={activeTab.vfsEntryId ?? activeScriptVfsId ?? undefined}
                  initialAutomationId={activeTab.automationId ?? activeAutomationId}
                />
              )}
              {activeTab?.kind === 'sql_studio' && (
                <SqlStudioView
                  sheetId={activeTab.sheetId || activeSheetId}
                  vfsEntryId={activeTab.vfsEntryId}
                />
              )}
              {activeTab?.kind === 'three_scene' && (
                <ThreeSceneStudioView
                  vfsEntryId={activeTab.vfsEntryId}
                  sceneId={activeTab.threeSceneId ?? activeThreeSceneId ?? undefined}
                  sheetId={activeTab.sheetId || activeSheetId}
                />
              )}
              {activeTab?.kind === 'preview' && (
                <LiveSandboxPreview sheetId={activeTab.sheetId || activeSheetId} />
              )}
              {activeTab?.kind === 'source_file' && activeTab.vfsEntryId && (
                <CodeEditorView
                  key={activeTab.vfsEntryId}
                  vfsEntryId={activeTab.vfsEntryId}
                  groupId={group.id}
                  title={activeTab.title}
                />
              )}
            </section>

            {/* Draggable Resize Sash between Split Groups */}
            {grpIdx < editorGroups.length - 1 && (
              <div
                className={
                  effectiveOrientation === 'vertical'
                    ? 'sash-horizontal editor-split-sash'
                    : 'sash-vertical editor-split-sash'
                }
                data-testid="editor-split-sash"
                title="Trascina per ridimensionare i pannelli affiancati (doppio clic per 50/50)"
                onPointerDown={(e) => handleSplitSashDown(e, grpIdx)}
                onDoubleClick={() =>
                  setGroupSizes(editorGroups.map(() => Math.round(100 / editorGroups.length)))
                }
              />
            )}
          </React.Fragment>
        );
      })}
    </main>
  );
};
