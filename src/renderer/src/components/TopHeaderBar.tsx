import React from 'react';
import {
  Box,
  Braces,
  Code2,
  Database,
  FileCode2,
  FileUp,
  GitFork,
  FolderPlus,
  FolderSync,
  Laptop,
  Loader2,
  Monitor,
  Moon,
  PanelRight,
  PenTool,
  Play,
  Redo2,
  ShieldCheck,
  Smartphone,
  Square,
  Sun,
  Tablet,
  Undo2,
  Workflow,
} from 'lucide-react';
import { DEFAULT_BREAKPOINTS } from '@shared/default-tokens';
import type { BreakpointPreset, CodegenTargetId } from '@shared/ui-ir';
import { useStudioStore, type SplitWorkspacePreset } from '@renderer/state/studio-store';
import { useShellLayoutStore } from './WorkbenchShell';

export const TopHeaderBar: React.FC = () => {
  const project = useStudioStore((s) => s.project);
  const targets = useStudioStore((s) => s.targets);
  const studioTheme = useStudioStore((s) => s.studioTheme);
  const activeBreakpointId = useStudioStore((s) => s.activeBreakpointId);
  const globalTarget = useStudioStore((s) => s.globalTarget);
  const canUndo = useStudioStore((s) => s.canUndo);
  const canRedo = useStudioStore((s) => s.canRedo);
  const editorGroups = useStudioStore((s) => s.editorGroups);
  const toolchainTasks = useStudioStore((s) => s.toolchainTasks);

  const setWizardOpen = useStudioStore((s) => s.setWizardOpen);
  const setImportCodeModalOpen = useStudioStore((s) => s.setImportCodeModalOpen);
  const setA11yModalOpen = useStudioStore((s) => s.setA11yModalOpen);
  const linkDiskFolder = useStudioStore((s) => s.linkDiskFolder);
  const applyLayoutPreset = useStudioStore((s) => s.applyLayoutPreset);
  const setActiveBreakpoint = useStudioStore((s) => s.setActiveBreakpoint);
  const setStudioTheme = useStudioStore((s) => s.setStudioTheme);
  const setGlobalTarget = useStudioStore((s) => s.setGlobalTarget);
  const undo = useStudioStore((s) => s.undo);
  const redo = useStudioStore((s) => s.redo);
  const runToolchainTaskAction = useStudioStore((s) => s.runToolchainTaskAction);
  const stopToolchainTaskAction = useStudioStore((s) => s.stopToolchainTaskAction);

  const rightDockCollapsed = useShellLayoutStore((s) => s.rightDockCollapsed);
  const toggleRightDock = useShellLayoutStore((s) => s.toggleRightDock);

  const breakpoints = project?.breakpoints?.length ? project.breakpoints : DEFAULT_BREAKPOINTS;
  const activeRunningTask = toolchainTasks.find((t) => t.status === 'running');

  const activeKinds = editorGroups.map(
    (g) => g.tabs.find((t) => t.id === g.activeTabId)?.kind ?? g.tabs[0]?.kind,
  );
  const isCanvasOnly = editorGroups.length === 1 && activeKinds[0] === 'canvas';
  const isSplitCss = activeKinds.includes('css');
  const isSplitCode = editorGroups.length >= 2 && activeKinds.includes('code');
  const isSplitBlueprint = activeKinds.includes('blueprint');
  const isSplitScript = activeKinds.includes('script');
  const isSplitAutomation = activeKinds.includes('automation');
  const isSplitSql = activeKinds.includes('sql_studio');
  const isThreeStudio = activeKinds.includes('three_scene');
  const isSplitPreview = editorGroups.length >= 2 && activeKinds.includes('preview');

  const workspaceModes = [
    { id: 'canvas', testId: 'preset-canvas-only', label: 'Design', shortcut: 'Ctrl+1', icon: PenTool, active: isCanvasOnly },
    { id: 'split-css', testId: 'preset-split-css', label: 'CSS', shortcut: 'Ctrl+2', icon: Braces, active: isSplitCss },
    { id: 'split-code', testId: 'preset-split-code', label: 'Codice', shortcut: 'Ctrl+3', icon: Code2, active: isSplitCode },
    { id: 'split-automation', testId: 'preset-split-automation', label: 'Automazioni', shortcut: 'Ctrl+Shift+A', icon: Workflow, active: isSplitAutomation },
    { id: 'split-sql', testId: 'preset-split-sql', label: 'SQL', shortcut: 'Ctrl+8', icon: Database, active: isSplitSql },
    { id: 'split-blueprint', testId: 'preset-split-blueprint', label: 'Blueprint', shortcut: 'Ctrl+4', icon: GitFork, active: isSplitBlueprint },
    { id: 'split-script', testId: 'preset-split-script', label: 'Script', shortcut: 'Ctrl+5', icon: FileCode2, active: isSplitScript },
    { id: 'three-studio', testId: 'preset-three-studio', label: '3D', shortcut: 'Ctrl+6', icon: Box, active: isThreeStudio },
    { id: 'split-preview', testId: 'preset-split-preview', label: 'Anteprima', shortcut: 'Ctrl+7', icon: Play, active: isSplitPreview },
  ] satisfies Array<{
    id: SplitWorkspacePreset;
    testId: string;
    label: string;
    shortcut: string;
    icon: typeof Play;
    active: boolean;
  }>;

  const bpIcon = (kind: string) => {
    if (kind === 'mobile') return <Smartphone size={11} />;
    if (kind === 'tablet') return <Tablet size={11} />;
    if (kind === 'desktop-window') return <Laptop size={11} />;
    return <Monitor size={11} />;
  };

  const compactBpLabel = (bp: BreakpointPreset): string => {
    if (bp.id === 'desktop-window' || bp.deviceKind === 'desktop-window') return 'OS';
    if (bp.id === 'desktop' || bp.deviceKind === 'desktop') return 'Desktop';
    if (bp.id === 'tablet' || bp.deviceKind === 'tablet') return 'Tablet';
    if (bp.id === 'mobile' || bp.deviceKind === 'mobile') return 'Mobile';
    return bp.label.split(' ')[0] || bp.label;
  };

  return (
    <header className="studio-topbar" data-testid="top-studio-header">
      {/* Left: Brand + Active Project + Studio Actions */}
      <div className="topbar-section topbar-left" style={{ gap: 4 }}>
        <div className="studio-brand" style={{ gap: 6 }}>
          <img
            src="./app-icon.png"
            alt=""
            width={20}
            height={20}
            style={{ borderRadius: 5, display: 'block', flexShrink: 0 }}
          />
          <span className="studio-brand-title" style={{ fontSize: 12 }}>
            UI Studio
          </span>
        </div>

        <div
          className="project-pill"
          style={{ maxWidth: 124, padding: '2px 6px' }}
          title={project?.rootDiskPath || project?.dbFilePath || ''}
        >
          <span className="project-pill-name">{project?.name ?? 'Studio...'}</span>
          <span className={`disk-badge ${project?.rootDiskPath ? 'linked' : ''}`}>
            {project?.stackId ? project.stackId : project?.rootDiskPath ? 'Sync' : 'VFS'}
          </span>
        </div>

        <button
          type="button"
          className="studio-btn sm"
          style={{ padding: '0 6px' }}
          data-testid="btn-header-new-project"
          aria-label="Nuovo progetto"
          onClick={() => setWizardOpen(true)}
          title="Avvia Creazione Guidata Nuovo Progetto (Wizard 5 Passi)"
        >
          <FolderPlus size={12} />
          <span className="topbar-btn-label">Nuovo</span>
        </button>

        <button
          type="button"
          className="studio-btn sm"
          style={{ padding: '0 6px' }}
          data-testid="btn-header-link-folder"
          aria-label="Collega cartella"
          onClick={() => void linkDiskFolder()}
          title="Collega una cartella locale sul disco"
        >
          <FolderSync size={12} />
          <span className="topbar-btn-label">Disco</span>
        </button>

        {activeRunningTask ? (
          <button
            type="button"
            className="studio-btn sm danger"
            style={{ padding: '0 6px' }}
            data-testid="btn-header-stop-task"
            onClick={() => void stopToolchainTaskAction(activeRunningTask.taskId)}
            title={`Interrompi ${activeRunningTask.label}${activeRunningTask.serverUrl ? ` (${activeRunningTask.serverUrl})` : ''}`}
          >
            <Loader2 size={11} className="spin-icon" />
            <Square size={9} />
            <span className="topbar-btn-label">Stop</span>
          </button>
        ) : (
          <button
            type="button"
            className="studio-btn sm"
            style={{ padding: '0 6px' }}
            data-testid="btn-header-run-dev"
            aria-label="Avvia server di sviluppo"
            disabled={!project?.rootDiskPath}
            onClick={() => void runToolchainTaskAction({ kind: 'dev' })}
            title="Avvia server di sviluppo live per lo stack del progetto"
          >
            <Play size={11} color="var(--accent-emerald)" />
            <span className="topbar-btn-label">Avvia</span>
          </button>
        )}

        <button
          type="button"
          className="studio-btn sm violet"
          style={{ padding: '0 6px' }}
          data-testid="btn-open-import-code"
          aria-label="Importa codice"
          onClick={() => setImportCodeModalOpen(true)}
          title="Importa HTML, Tailwind, HTMX, React JSX, Svelte o Angular nel Canvas"
        >
          <FileUp size={12} />
          <span>Importa</span>
        </button>

        <button
          type="button"
          className="studio-btn sm"
          style={{ padding: '0 6px' }}
          data-testid="btn-open-a11y-audit"
          onClick={() => setA11yModalOpen(true)}
          title="Esegui Audit Accessibilità WCAG 2.2 AA & Layout Responsivo"
        >
          <ShieldCheck size={12} color="var(--accent-emerald)" />
          <span>WCAG</span>
        </button>
      </div>

      {/* Center: 9 Workspace Mode/Split Presets + Undo/Redo + Breakpoints */}
      <div className="topbar-section topbar-center" style={{ gap: 4 }}>
        <div className="segmented-group topbar-workspace-modes" role="group" aria-label="Area di lavoro">
          {workspaceModes.map(({ id, testId, label, shortcut, icon: Icon, active }) => (
            <button
              key={id}
              type="button"
              className={`segmented-item ${active ? 'active' : ''}`}
              data-testid={testId}
              aria-label={label}
              aria-pressed={active}
              title={`${label} (${shortcut})`}
              onClick={() => applyLayoutPreset(id)}
            >
              <Icon size={13} aria-hidden="true" />
              <span className="workspace-mode-label">{label}</span>
            </button>
          ))}
        </div>

        <div className="segmented-group" role="group" aria-label="Annulla e Ripeti">
          <button
            type="button"
            className="segmented-item"
            style={{ padding: '0 5px' }}
            disabled={!canUndo}
            onClick={() => void undo()}
            title="Annulla (Ctrl+Z)"
            data-testid="btn-header-undo"
          >
            <Undo2 size={12} />
          </button>
          <button
            type="button"
            className="segmented-item"
            style={{ padding: '0 5px' }}
            disabled={!canRedo}
            onClick={() => void redo()}
            title="Ripeti (Ctrl+Y)"
            data-testid="btn-header-redo"
          >
            <Redo2 size={12} />
          </button>
        </div>

        <div className="segmented-group" role="group" aria-label="Breakpoint viewport" data-testid="topbar-breakpoints">
          {breakpoints.map((bp) => (
            <button
              key={bp.id}
              type="button"
              className={`segmented-item ${activeBreakpointId === bp.id ? 'active' : ''}`}
              style={{ padding: '0 5px', fontSize: 10.5 }}
              data-testid={`bp-${bp.id}`}
              aria-label={bp.label}
              aria-pressed={activeBreakpointId === bp.id}
              onClick={() => setActiveBreakpoint(bp.id)}
              title={`${bp.label} (${bp.width}×${bp.height})`}
            >
              {bpIcon(bp.deviceKind)}
              <span className="topbar-breakpoint-label">{compactBpLabel(bp)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Right: Global 26-Target Selector + Theme Toggle + Right Dock Toggle */}
      <div className="topbar-section topbar-right" style={{ gap: 4 }}>
        <select
          className="studio-select topbar-target-select"
          style={{ maxWidth: 128, padding: '0 5px', fontSize: 10.5 }}
          data-testid="global-target-select"
          aria-label="Target di compilazione globale"
          value={globalTarget}
          onChange={(e) => void setGlobalTarget(e.target.value as CodegenTargetId)}
        >
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.displayName} ({t.fileExtension})
            </option>
          ))}
        </select>

        <button
          type="button"
          className="studio-btn sm"
          style={{ padding: '0 6px' }}
          data-testid="btn-theme-toggle"
          onClick={() => void setStudioTheme(studioTheme === 'dark' ? 'light' : 'dark')}
          title="Cambia tema Scuro / Chiaro"
        >
          {studioTheme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
          <span>{studioTheme === 'dark' ? 'Scuro' : 'Chiaro'}</span>
        </button>

        <button
          type="button"
          className={`studio-btn sm ${!rightDockCollapsed ? 'active' : ''}`}
          style={{ padding: '0 6px' }}
          data-testid="btn-toggle-right-dock"
          aria-label="Pannello destro"
          aria-pressed={!rightDockCollapsed}
          onClick={() => toggleRightDock()}
          title="Mostra/Nascondi Pannello Destro AI & Proprietà"
        >
          <PanelRight size={12} />
        </button>
      </div>
    </header>
  );
};
