import React from 'react';
import { Bot, Code2, Crosshair, FolderGit2, LayoutGrid, Move, Ruler, Terminal } from 'lucide-react';
import { useStudioStore } from '@renderer/state/studio-store';

export const StatusBar: React.FC = () => {
  const project = useStudioStore((s) => s.project);
  const activeSheetId = useStudioStore((s) => s.activeSheetId);
  const sheetDocuments = useStudioStore((s) => s.sheetDocuments);
  const selectedNodeIds = useStudioStore((s) => s.selectedNodeIds);
  const cursorCanvasPos = useStudioStore((s) => s.cursorCanvasPos);
  const canvasPlacementMode = useStudioStore((s) => s.canvasPlacementMode);
  const snapToGrid8px = useStudioStore((s) => s.snapToGrid8px);
  const showRulers = useStudioStore((s) => s.showRulers);
  const globalTarget = useStudioStore((s) => s.globalTarget);
  const globalDialect = useStudioStore((s) => s.globalDialect);
  const targets = useStudioStore((s) => s.targets);
  const activeProvider = useStudioStore((s) => s.activeProvider);
  const activeModel = useStudioStore((s) => s.activeModel);
  const bottomConsoleOpen = useStudioStore((s) => s.bottomConsoleOpen);
  const consoleEntries = useStudioStore((s) => s.consoleEntries);

  const setBottomConsoleOpen = useStudioStore((s) => s.setBottomConsoleOpen);
  const setCanvasPlacementMode = useStudioStore((s) => s.setCanvasPlacementMode);
  const setShowRulers = useStudioStore((s) => s.setShowRulers);
  const toggleSnapToGrid8px = useStudioStore((s) => s.toggleSnapToGrid8px);
  const setCommandPaletteOpen = useStudioStore((s) => s.setCommandPaletteOpen);

  const sheet = sheetDocuments[activeSheetId];
  const selNode = selectedNodeIds[0] && sheet ? sheet.nodes[selectedNodeIds[0]] : null;
  const targetName = targets.find((t) => t.id === globalTarget)?.displayName ?? globalTarget;

  return (
    <footer className="studio-statusbar" data-testid="studio-status-bar">
      {/* Left: Project Path + Console Toggle */}
      <div className="statusbar-section">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 600 }}>
          <FolderGit2 size={11} color="var(--accent-primary)" />
          <span
            style={{
              maxWidth: 260,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={project?.rootDiskPath || `/${project?.name ?? 'Studio'}`}
          >
            {project?.rootDiskPath ? project.rootDiskPath : `/${project?.name ?? 'Visual UI Studio'} (VFS)`}
          </span>
        </span>

        <button
          type="button"
          className="statusbar-btn"
          data-testid="btn-statusbar-console"
          onClick={() => setBottomConsoleOpen(!bottomConsoleOpen)}
          title="Mostra/Nascondi Console Studio (Ctrl+J)"
        >
          <Terminal size={11} color={bottomConsoleOpen ? 'var(--accent-primary)' : 'currentColor'} />
          <span>Console ({consoleEntries.length})</span>
        </button>
      </div>

      {/* Center: Cursor / Node Coordinates & Size + Layout Mode + Snap/Rulers */}
      <div className="statusbar-section">
        <span
          data-testid="statusbar-coords"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontFamily: "'JetBrains Mono', Consolas, monospace",
          }}
        >
          <Crosshair size={11} color="var(--accent-violet)" />
          {selNode ? (
            <span>
              {selNode.name}: ({Math.round(selNode.layout.frame.x)}, {Math.round(selNode.layout.frame.y)}) •{' '}
              {Math.round(selNode.layout.frame.width)} × {Math.round(selNode.layout.frame.height)}px
            </span>
          ) : cursorCanvasPos ? (
            <span>
              Cursore: ({Math.round(cursorCanvasPos.x)}, {Math.round(cursorCanvasPos.y)})
            </span>
          ) : (
            <span>Pronto</span>
          )}
        </span>

        <button
          type="button"
          className="statusbar-btn"
          data-testid="statusbar-layout-mode"
          onClick={() => setCanvasPlacementMode(canvasPlacementMode === 'freeform' ? 'auto' : 'freeform')}
          title="Clicca per commutare Posizionamento Libero (X,Y) / Auto-Layout"
        >
          {canvasPlacementMode === 'freeform' ? (
            <>
              <Move size={11} color="var(--accent-primary)" />
              <strong style={{ color: 'var(--accent-primary)' }}>Libero (X, Y)</strong>
            </>
          ) : (
            <>
              <LayoutGrid size={11} color="var(--accent-violet)" />
              <strong style={{ color: 'var(--accent-violet)' }}>Auto-Layout</strong>
            </>
          )}
        </button>

        <button
          type="button"
          className="statusbar-btn"
          onClick={() => setShowRulers(!showRulers)}
          title="Mostra/Nascondi Righelli"
        >
          <Ruler size={11} color={showRulers ? 'var(--accent-emerald)' : 'currentColor'} />
          <span>Righelli: {showRulers ? 'ON' : 'OFF'}</span>
        </button>

        <button
          type="button"
          className="statusbar-btn"
          onClick={() => toggleSnapToGrid8px()}
          title="Mostra/Nascondi Snap Griglia 8px"
        >
          <span>Snap 8px: {snapToGrid8px ? 'ON' : 'OFF'}</span>
        </button>
      </div>

      {/* Right: Active Target + AI Status */}
      <div className="statusbar-section">
        <button
          type="button"
          className="statusbar-btn"
          onClick={() => setCommandPaletteOpen(true)}
          title="Cambia Target o esegui comando (Ctrl+Shift+P)"
        >
          <Code2 size={11} color="var(--accent-primary)" />
          <span>
            {targetName} • {globalDialect}
          </span>
        </button>

        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Bot size={11} color="var(--accent-emerald)" />
          <span>
            AI: {activeProvider === 'builtin_offline' ? 'Offline Synth' : activeProvider} ({activeModel})
          </span>
        </span>
      </div>
    </footer>
  );
};
