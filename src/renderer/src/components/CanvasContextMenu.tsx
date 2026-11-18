import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  ArrowDown,
  ArrowUp,
  ClipboardPaste,
  Columns3,
  Copy,
  CreditCard,
  Grid2x2,
  Paintbrush,
  Palette,
  Pin,
  Rows3,
  Scissors,
  Trash2,
  Ungroup,
} from 'lucide-react';
import { useStudioStore } from '@renderer/state/studio-store';

export interface CanvasContextMenuProps {
  x: number;
  y: number;
  canvasX?: number;
  canvasY?: number;
  targetNodeId?: string | null;
  onToggleDetach?: () => void;
  onClose: () => void;
}

export const CanvasContextMenu: React.FC<CanvasContextMenuProps> = ({
  x,
  y,
  canvasX,
  canvasY,
  targetNodeId,
  onToggleDetach,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  const activeSheetId = useStudioStore((s) => s.activeSheetId);
  const sheet = useStudioStore((s) => s.sheetDocuments[activeSheetId]);
  const selectedNodeIds = useStudioStore((s) => s.selectedNodeIds);
  const copiedClipboard = useStudioStore((s) => s.copiedClipboard);
  const copiedNodeStyle = useStudioStore((s) => s.copiedNodeStyle);

  const cutSelectedNodes = useStudioStore((s) => s.cutSelectedNodes);
  const copySelectedNodes = useStudioStore((s) => s.copySelectedNodes);
  const pasteCopiedNodes = useStudioStore((s) => s.pasteCopiedNodes);
  const duplicateSelectedNode = useStudioStore((s) => s.duplicateSelectedNode);
  const deleteSelectedNode = useStudioStore((s) => s.deleteSelectedNode);
  const copySelectedNodeStyle = useStudioStore((s) => s.copySelectedNodeStyle);
  const pasteStyleToSelectedNodes = useStudioStore((s) => s.pasteStyleToSelectedNodes);
  const groupSelectedNodes = useStudioStore((s) => s.groupSelectedNodes);
  const ungroupSelectedContainer = useStudioStore((s) => s.ungroupSelectedContainer);
  const distributeSelectedNodes = useStudioStore((s) => s.distributeSelectedNodes);
  const adjustSelectedZIndex = useStudioStore((s) => s.adjustSelectedZIndex);
  const toggleNodeFreeformDetach = useStudioStore((s) => s.toggleNodeFreeformDetach);
  const openSplitMode = useStudioStore((s) => s.openSplitMode);

  const enabledItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:enabled') ?? []);

  // Viewport clamping so menu never overflows right or bottom edges
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 10;
    const clampedLeft = Math.max(pad, Math.min(x, window.innerWidth - rect.width - pad));
    const clampedTop = Math.max(pad, Math.min(y, window.innerHeight - rect.height - pad));
    setPos({ left: clampedLeft, top: clampedTop });
  }, [x, y]);

  useEffect(() => {
    const menu = menuRef.current;
    const original = document.activeElement as HTMLElement | null;
    enabledItems()[0]?.focus();
    return () => {
      if (original?.isConnected && (!document.activeElement || document.activeElement === document.body || menu?.contains(document.activeElement))) {
        original.focus();
      }
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (ev: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const effectiveId = targetNodeId ?? selectedNodeIds[0] ?? null;
  const targetNode = sheet && effectiveId ? sheet.nodes[effectiveId] : undefined;
  const isNonArtboard = Boolean(targetNode && targetNode.kind !== 'artboard');
  const canUngroup = Boolean(targetNode && targetNode.kind !== 'artboard' && targetNode.childIds.length > 0);
  const canDistribute = selectedNodeIds.filter((id) => sheet?.nodes[id]?.kind !== 'artboard').length >= 3;

  const runAndClose = (fn: () => void | Promise<void>) => {
    onClose();
    const pushToast = useStudioStore.getState().pushToast;
    void Promise.resolve().then(fn).catch((error) => {
      pushToast('error', error instanceof Error ? error.message : 'Impossibile eseguire l’azione sul Canvas.');
    });
  };

  const renderItem = (opts: {
    testId: string;
    icon: React.ReactNode;
    label: string;
    shortcut?: string;
    disabled?: boolean;
    danger?: boolean;
    onClick: () => void | Promise<void>;
  }) => (
    <button
      key={opts.testId}
      type="button"
      role="menuitem"
      tabIndex={-1}
      data-testid={opts.testId}
      disabled={opts.disabled}
      onClick={() => {
        if (!opts.disabled) runAndClose(opts.onClick);
      }}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        padding: '5px 9px',
        border: 'none',
        borderRadius: 5,
        background: 'transparent',
        color: opts.disabled
          ? 'var(--text-muted)'
          : opts.danger
            ? 'var(--accent-danger)'
            : 'var(--text-primary)',
        fontSize: 11.5,
        cursor: opts.disabled ? 'not-allowed' : 'pointer',
        opacity: opts.disabled ? 0.45 : 1,
        textAlign: 'left',
      }}
      onMouseEnter={(e) => {
        if (!opts.disabled) {
          e.currentTarget.style.background = opts.danger ? 'var(--accent-danger-soft)' : 'var(--bg-panel-hover)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
        {opts.icon}
        <span>{opts.label}</span>
      </span>
      {opts.shortcut && (
        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', Consolas, monospace" }}>
          {opts.shortcut}
        </span>
      )}
    </button>
  );

  const divider = <div style={{ height: 1, background: 'var(--border-subtle)', margin: '3px 4px' }} />;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Azioni del Canvas"
      data-testid="canvas-context-menu"
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const items = enabledItems();
        if (!items.length) return;
        const selected = items.findIndex((item) => item === document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (selected + (event.key === 'ArrowDown' || selected < 0 ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        width: 248,
        maxWidth: 'calc(100vw - 20px)',
        maxHeight: 'calc(100vh - 20px)',
        overflowY: 'auto',
        padding: 4,
        borderRadius: 9,
        background: 'var(--hud-bg)',
        backdropFilter: 'blur(14px)',
        border: '1px solid var(--border-strong)',
        boxShadow: 'var(--shadow-lg)',
        zIndex: 250,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      {renderItem({
        testId: 'ctx-item-cut',
        icon: <Scissors size={12} />,
        label: 'Taglia',
        shortcut: 'Ctrl+X',
        disabled: !isNonArtboard,
        onClick: () => cutSelectedNodes(),
      })}
      {renderItem({
        testId: 'ctx-item-copy',
        icon: <Copy size={12} />,
        label: 'Copia',
        shortcut: 'Ctrl+C',
        disabled: !isNonArtboard,
        onClick: () => copySelectedNodes(),
      })}
      {renderItem({
        testId: 'ctx-item-paste-here',
        icon: <ClipboardPaste size={12} />,
        label: 'Incolla qui',
        shortcut: 'Ctrl+V',
        disabled: !copiedClipboard || copiedClipboard.rootIds.length === 0,
        onClick: () =>
          pasteCopiedNodes(
            canvasX !== undefined && canvasY !== undefined ? { x: canvasX, y: canvasY } : undefined,
          ),
      })}
      {renderItem({
        testId: 'ctx-item-duplicate',
        icon: <Copy size={12} />,
        label: 'Duplica',
        shortcut: 'Ctrl+D',
        disabled: !isNonArtboard,
        onClick: () => duplicateSelectedNode(),
      })}

      {divider}

      {renderItem({
        testId: 'ctx-item-copy-style',
        icon: <Paintbrush size={12} />,
        label: 'Copia Stile CSS',
        shortcut: 'Ctrl+Alt+C',
        disabled: !targetNode,
        onClick: () => copySelectedNodeStyle(),
      })}
      {renderItem({
        testId: 'ctx-item-paste-style',
        icon: <Palette size={12} />,
        label: 'Incolla Stile CSS',
        shortcut: 'Ctrl+Alt+V',
        disabled: !copiedNodeStyle || !targetNode,
        onClick: () => pasteStyleToSelectedNodes(),
      })}

      {divider}

      {renderItem({
        testId: 'ctx-item-group-row',
        icon: <Columns3 size={12} />,
        label: 'Raggruppa in Row',
        shortcut: 'Ctrl+G',
        disabled: !isNonArtboard,
        onClick: () => groupSelectedNodes('row'),
      })}
      {renderItem({
        testId: 'ctx-item-group-col',
        icon: <Rows3 size={12} />,
        label: 'Raggruppa in Col',
        disabled: !isNonArtboard,
        onClick: () => groupSelectedNodes('column'),
      })}
      {renderItem({
        testId: 'ctx-item-group-grid',
        icon: <Grid2x2 size={12} />,
        label: 'Raggruppa in Grid',
        disabled: !isNonArtboard,
        onClick: () => groupSelectedNodes('grid'),
      })}
      {renderItem({
        testId: 'ctx-item-group-card',
        icon: <CreditCard size={12} />,
        label: 'Raggruppa in Card',
        disabled: !isNonArtboard,
        onClick: () => groupSelectedNodes('card'),
      })}
      {renderItem({
        testId: 'ctx-item-ungroup',
        icon: <Ungroup size={12} />,
        label: 'Separa Gruppo',
        shortcut: 'Ctrl+Shift+G',
        disabled: !canUngroup,
        onClick: () => ungroupSelectedContainer(),
      })}

      {divider}

      {renderItem({
        testId: 'ctx-item-distribute-h',
        icon: <AlignHorizontalDistributeCenter size={12} />,
        label: 'Distribuisci Orizzontalmente',
        disabled: !canDistribute,
        onClick: () => distributeSelectedNodes('horizontal'),
      })}
      {renderItem({
        testId: 'ctx-item-distribute-v',
        icon: <AlignVerticalDistributeCenter size={12} />,
        label: 'Distribuisci Verticalmente',
        disabled: !canDistribute,
        onClick: () => distributeSelectedNodes('vertical'),
      })}
      {renderItem({
        testId: 'ctx-item-toggle-detach',
        icon: <Pin size={12} />,
        label:
          targetNode?.layout.positioning === 'absolute'
            ? 'Rimettilo nel Flusso'
            : 'Sgancia Libero (X,Y)',
        disabled: !isNonArtboard,
        onClick: () => {
          if (onToggleDetach) onToggleDetach();
          else if (targetNode) return toggleNodeFreeformDetach(targetNode.id);
        },
      })}
      {renderItem({
        testId: 'ctx-item-z-up',
        icon: <ArrowUp size={12} />,
        label: 'Livello Z-Index (+1 Avanti)',
        disabled: !isNonArtboard,
        onClick: () => adjustSelectedZIndex(1),
      })}
      {renderItem({
        testId: 'ctx-item-z-down',
        icon: <ArrowDown size={12} />,
        label: 'Livello Z-Index (-1 Dietro)',
        disabled: !isNonArtboard,
        onClick: () => adjustSelectedZIndex(-1),
      })}

      {divider}

      {renderItem({
        testId: 'ctx-item-open-css',
        icon: <Palette size={12} color="var(--accent-violet)" />,
        label: 'Apri Regola CSS',
        onClick: () => openSplitMode('split-css'),
      })}
      {renderItem({
        testId: 'ctx-item-delete',
        icon: <Trash2 size={12} />,
        label: 'Elimina Elemento',
        shortcut: 'Canc',
        danger: true,
        disabled: !isNonArtboard,
        onClick: () => deleteSelectedNode(),
      })}
    </div>
  );
};
