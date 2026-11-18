import React, { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useStudioStore } from '@renderer/state/studio-store';
import { TopHeaderBar } from './TopHeaderBar';
import { LeftPermanentSidebar } from './LeftPermanentSidebar';
import { CenterWorkspace } from './CenterWorkspace';
import { BottomConsoleDrawer } from './BottomConsoleDrawer';
import { RightOperationalDock } from './RightOperationalDock';
import { StatusBar } from './StatusBar';

interface ShellLayoutState {
  rightDockCollapsed: boolean;
  setRightDockCollapsed: (collapsed: boolean) => void;
  toggleRightDock: () => void;
}

const compactWorkspace = '(max-width: 1240px)';

export const useShellLayoutStore = create<ShellLayoutState>((set) => ({
  rightDockCollapsed: typeof window !== 'undefined' && window.matchMedia(compactWorkspace).matches,
  setRightDockCollapsed: (collapsed) => set({ rightDockCollapsed: collapsed }),
  toggleRightDock: () => set((s) => ({ rightDockCollapsed: !s.rightDockCollapsed })),
}));

export const WorkbenchShell: React.FC = () => {
  const leftSidebarWidth = useStudioStore((s) => s.leftSidebarWidth);
  const rightPanelWidth = useStudioStore((s) => s.rightPanelWidth);
  const setLeftSidebarWidth = useStudioStore((s) => s.setLeftSidebarWidth);
  const setRightPanelWidth = useStudioStore((s) => s.setRightPanelWidth);

  const rightDockCollapsed = useShellLayoutStore((s) => s.rightDockCollapsed);
  const setRightDockCollapsed = useShellLayoutStore((s) => s.setRightDockCollapsed);

  const [isNarrowViewport, setIsNarrowViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia(compactWorkspace).matches,
  );

  useEffect(() => {
    const viewport = window.matchMedia(compactWorkspace);
    const onChange = (event: MediaQueryListEvent) => {
      setIsNarrowViewport(event.matches);
      if (event.matches) setRightDockCollapsed(true);
    };
    viewport.addEventListener('change', onChange);
    return () => viewport.removeEventListener('change', onChange);
  }, [setRightDockCollapsed]);

  const effectiveLeftWidth = isNarrowViewport
    ? Math.min(leftSidebarWidth, 244)
    : leftSidebarWidth;

  const resizeFromPointer = (
    e: React.PointerEvent<HTMLDivElement>,
    width: number,
    direction: 1 | -1,
    setWidth: (width: number) => void,
  ) => {
    e.preventDefault();
    const startX = e.clientX;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const move = (event: PointerEvent) => setWidth(width + direction * (event.clientX - startX));
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('lostpointercapture', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('lostpointercapture', end);
  };

  const resizeFromKeyboard = (
    e: React.KeyboardEvent,
    width: number,
    direction: 1 | -1,
    setWidth: (width: number) => void,
  ) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    setWidth(width + direction * (e.key === 'ArrowLeft' ? -16 : 16));
  };

  return (
    <div className="workbench-shell" data-testid="workbench-shell">
      {/* Top Studio Header Bar (7 Split Presets + Breakpoints + 26 Targets + Right Dock Toggle) */}
      <TopHeaderBar />

      {/* 3-Column Permanent Studio Body (Right Dock collapsible on narrow panes) */}
      <div className="workbench-body">
        {/* Column 1: Strictly Non-Closable Left Permanent Sidebar */}
        <LeftPermanentSidebar width={effectiveLeftWidth} />

        {/* Left Sash Resizer */}
        <div
          className="sash-vertical"
          role="separator"
          tabIndex={0}
          aria-label="Larghezza barra laterale sinistra"
          aria-orientation="vertical"
          aria-valuenow={effectiveLeftWidth}
          onPointerDown={(e) => resizeFromPointer(e, effectiveLeftWidth, 1, setLeftSidebarWidth)}
          onKeyDown={(e) => resizeFromKeyboard(e, effectiveLeftWidth, 1, setLeftSidebarWidth)}
          title="Ridimensiona barra laterale sinistra"
        />

        {/* Column 2: Multi-Sheet Split Center Workspace + Collapsible Bottom Console */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          <CenterWorkspace />
          <BottomConsoleDrawer />
        </div>

        {/* Column 3: Collapsible Right Operational Dock (Agentic Coding + Property Inspector) */}
        {!rightDockCollapsed && (
          <>
            <div
              className="sash-vertical"
              role="separator"
              tabIndex={0}
              aria-label="Larghezza pannello destro"
              aria-orientation="vertical"
              aria-valuenow={rightPanelWidth}
              onPointerDown={(e) => resizeFromPointer(e, rightPanelWidth, -1, setRightPanelWidth)}
              onKeyDown={(e) => resizeFromKeyboard(e, rightPanelWidth, -1, setRightPanelWidth)}
              title="Ridimensiona dock operativo destro"
            />
            <RightOperationalDock width={rightPanelWidth} />
          </>
        )}
      </div>

      {/* 24px Bottom IDE Status Bar */}
      <StatusBar />
    </div>
  );
};
