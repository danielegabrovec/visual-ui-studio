import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { useStudioStore } from '@renderer/state/studio-store';
import { ApplicationMenuBar } from '@renderer/components/ApplicationMenuBar';
import { WorkbenchShell } from '@renderer/components/WorkbenchShell';
import { ProjectLaunchHub } from '@renderer/components/ProjectLaunchHub';
import { GuidedProjectWizard } from '@renderer/components/GuidedProjectWizard';
import { CommandPaletteModal } from '@renderer/components/CommandPaletteModal';
import { UnslothHubModal } from '@renderer/components/UnslothHubModal';
import { NewProjectModal } from '@renderer/components/NewProjectModal';
import { ImportCodeModal } from '@renderer/components/ImportCodeModal';
import { A11yAuditModal } from '@renderer/components/A11yAuditModal';

export const App: React.FC = () => {
  const bootstrapped = useStudioStore((s) => s.bootstrapped);
  const loadingError = useStudioStore((s) => s.loadingError);
  const showProjectHub = useStudioStore((s) => s.showProjectHub);
  const wizardOpen = useStudioStore((s) => s.wizardOpen);
  const commandPaletteOpen = useStudioStore((s) => s.commandPaletteOpen);
  const shortcutsHelpOpen = useStudioStore((s) => s.shortcutsHelpOpen);
  const bottomConsoleOpen = useStudioStore((s) => s.bottomConsoleOpen);
  const toasts = useStudioStore((s) => s.toasts);
  const isNewProjectModalOpen = useStudioStore((s) => s.isNewProjectModalOpen);
  const isUnslothModalOpen = useStudioStore((s) => s.isUnslothModalOpen);
  const isImportCodeModalOpen = useStudioStore((s) => s.isImportCodeModalOpen);
  const isA11yModalOpen = useStudioStore((s) => s.isA11yModalOpen);

  const initStudio = useStudioStore((s) => s.initStudio);
  const dismissToast = useStudioStore((s) => s.dismissToast);
  const setCommandPaletteOpen = useStudioStore((s) => s.setCommandPaletteOpen);
  const setShortcutsHelpOpen = useStudioStore((s) => s.setShortcutsHelpOpen);
  const setBottomConsoleOpen = useStudioStore((s) => s.setBottomConsoleOpen);
  const setWizardOpen = useStudioStore((s) => s.setWizardOpen);
  const applyLayoutPreset = useStudioStore((s) => s.applyLayoutPreset);
  const selectNode = useStudioStore((s) => s.selectNode);
  const undo = useStudioStore((s) => s.undo);
  const redo = useStudioStore((s) => s.redo);
  const duplicateSelectedNode = useStudioStore((s) => s.duplicateSelectedNode);
  const copySelectedNodes = useStudioStore((s) => s.copySelectedNodes);
  const cutSelectedNodes = useStudioStore((s) => s.cutSelectedNodes);
  const pasteCopiedNodes = useStudioStore((s) => s.pasteCopiedNodes);
  const copySelectedNodeStyle = useStudioStore((s) => s.copySelectedNodeStyle);
  const pasteStyleToSelectedNodes = useStudioStore((s) => s.pasteStyleToSelectedNodes);
  const groupSelectedNodes = useStudioStore((s) => s.groupSelectedNodes);
  const ungroupSelectedContainer = useStudioStore((s) => s.ungroupSelectedContainer);
  const nudgeSelectedNodes = useStudioStore((s) => s.nudgeSelectedNodes);
  const deleteSelectedNode = useStudioStore((s) => s.deleteSelectedNode);

  const anyModalOpen =
    showProjectHub ||
    wizardOpen ||
    commandPaletteOpen ||
    shortcutsHelpOpen ||
    isNewProjectModalOpen ||
    isUnslothModalOpen ||
    isImportCodeModalOpen ||
    isA11yModalOpen;

  useEffect(() => {
    void initStudio();
  }, [initStudio]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector('dialog[open]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const lowerKey = e.key.toLowerCase();

      // Global IDE shortcuts (work even when inputs are focused)
      if ((mod && e.shiftKey && lowerKey === 'p') || (mod && lowerKey === 'k')) {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
        return;
      }
      if (mod && e.shiftKey && lowerKey === 'n') {
        e.preventDefault();
        setWizardOpen(true);
        return;
      }
      if (mod && e.shiftKey && !e.altKey && lowerKey === 'a') {
        const st = useStudioStore.getState();
        if (st.project) {
          e.preventDefault();
          if (st.showProjectHub) st.setShowProjectHub(false);
          applyLayoutPreset('split-automation');
          return;
        }
      }
      if (mod && e.shiftKey && !e.altKey && lowerKey === 'd') {
        const st = useStudioStore.getState();
        if (st.project) {
          e.preventDefault();
          if (st.showProjectHub) st.setShowProjectHub(false);
          applyLayoutPreset('split-sql');
          return;
        }
      }
      if (mod && lowerKey === 'j') {
        e.preventDefault();
        setBottomConsoleOpen(!bottomConsoleOpen);
        return;
      }
      if (e.key === 'F1') {
        e.preventDefault();
        setShortcutsHelpOpen(!shortcutsHelpOpen);
        return;
      }
      if (mod && lowerKey === 's') {
        e.preventDefault();
        if (anyModalOpen) return;
        const state = useStudioStore.getState();
        const group = state.editorGroups.find((item) => item.id === state.activeGroupId);
        const tab = group?.tabs.find((item) => item.id === group.activeTabId);
        if ((tab?.kind === 'source_file' || tab?.kind === 'script') && tab.vfsEntryId) {
          void state.saveSourceDraft(tab.vfsEntryId);
        } else if (tab?.kind === 'code') {
          const targetId = tab.targetId ?? state.globalTarget;
          const target = state.targets.find((item) => item.id === targetId);
          const dialect = tab.dialect ?? target?.defaultDialect ?? state.globalDialect;
          void state.saveCodeDrafts(tab.sheetId ?? state.activeSheetId, targetId, dialect);
        }
        return;
      }

      if (mod && !e.shiftKey && !e.altKey && ['1', '2', '3', '4', '5', '6', '7', '8'].includes(e.key)) {
        const st = useStudioStore.getState();
        if (st.project) {
          e.preventDefault();
          if (st.showProjectHub) {
            st.setShowProjectHub(false);
          }
          const presetMap: Record<string, Parameters<typeof applyLayoutPreset>[0]> = {
            '1': 'canvas',
            '2': 'split-css',
            '3': 'split-code',
            '4': 'split-blueprint',
            '5': 'split-script',
            '6': 'three-studio',
            '7': 'split-preview',
            '8': 'split-sql',
          };
          applyLayoutPreset(presetMap[e.key]);
          return;
        }
      }

      const target = e.target as HTMLElement | null;
      const isTyping =
        Boolean(
          target &&
            (target.tagName === 'INPUT' ||
              target.tagName === 'TEXTAREA' ||
              target.tagName === 'SELECT' ||
              target.isContentEditable),
        ) || anyModalOpen;

      if (isTyping) return;

      if (e.key === 'Escape') {
        selectNode(null);
        return;
      }

      if (mod && e.altKey && lowerKey === 'c') {
        e.preventDefault();
        copySelectedNodeStyle();
      } else if (mod && e.altKey && lowerKey === 'v') {
        e.preventDefault();
        void pasteStyleToSelectedNodes();
      } else if (mod && e.shiftKey && lowerKey === 'g') {
        e.preventDefault();
        void ungroupSelectedContainer();
      } else if (mod && !e.shiftKey && lowerKey === 'g') {
        e.preventDefault();
        void groupSelectedNodes('auto');
      } else if (mod && lowerKey === 'z' && !e.shiftKey) {
        e.preventDefault();
        void undo();
      } else if ((mod && lowerKey === 'y') || (mod && e.shiftKey && lowerKey === 'z')) {
        e.preventDefault();
        void redo();
      } else if (mod && !e.shiftKey && lowerKey === 'd') {
        e.preventDefault();
        void duplicateSelectedNode();
      } else if (mod && !e.altKey && lowerKey === 'x') {
        const hasTextSelection = Boolean(window.getSelection()?.toString());
        if (!hasTextSelection) {
          e.preventDefault();
          void cutSelectedNodes();
        }
      } else if (mod && !e.altKey && lowerKey === 'c') {
        const hasTextSelection = Boolean(window.getSelection()?.toString());
        if (!hasTextSelection) {
          e.preventDefault();
          copySelectedNodes();
        }
      } else if (mod && !e.altKey && lowerKey === 'v') {
        e.preventDefault();
        void pasteCopiedNodes();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        void deleteSelectedNode();
      } else if (
        !mod &&
        !e.altKey &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 8 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        void nudgeSelectedNodes(dx, dy);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    anyModalOpen,
    showProjectHub,
    commandPaletteOpen,
    shortcutsHelpOpen,
    bottomConsoleOpen,
    setCommandPaletteOpen,
    setShortcutsHelpOpen,
    setBottomConsoleOpen,
    setWizardOpen,
    applyLayoutPreset,
    selectNode,
    undo,
    redo,
    duplicateSelectedNode,
    copySelectedNodes,
    cutSelectedNodes,
    pasteCopiedNodes,
    copySelectedNodeStyle,
    pasteStyleToSelectedNodes,
    groupSelectedNodes,
    ungroupSelectedContainer,
    nudgeSelectedNodes,
    deleteSelectedNode,
  ]);

  if (!bootstrapped) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          background: 'var(--bg-app)',
          color: 'var(--text-primary)',
          fontWeight: 600,
        }}
      >
        <img src="./app-icon.png" alt="" width={30} height={30} style={{ borderRadius: 7 }} />
        <span>Avvio di Visual UI Studio…</span>
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--bg-app)',
      }}
    >
      {/* Persistent Desktop Application Menu Bar (always visible on Startup Hub & Workbench) */}
      <ApplicationMenuBar />

      {loadingError && (
        <div
          style={{
            background: 'var(--accent-danger-soft)',
            color: 'var(--accent-danger)',
            padding: '6px 12px',
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          Avviso inizializzazione: {loadingError}
        </div>
      )}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {showProjectHub ? <ProjectLaunchHub /> : <WorkbenchShell />}
      </div>

      <GuidedProjectWizard />
      <CommandPaletteModal />
      <UnslothHubModal />
      <NewProjectModal />
      <ImportCodeModal />
      <A11yAuditModal />

      {/* Top-Right Compact Toast Stack (max 3, never covers bottom-right Inspector or Agent AI) */}
      <div className="toast-viewport" data-testid="toast-viewport">
        {toasts.slice(-3).map((t) => (
          <div
            key={t.id}
            className={`toast-item ${t.kind}`}
            onClick={() => dismissToast(t.id)}
          >
            <span className="toast-message">{t.message}</span>
            <button
              type="button"
              className="toast-close-btn"
              aria-label="Chiudi notifica"
              onClick={(e) => {
                e.stopPropagation();
                dismissToast(t.id);
              }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
