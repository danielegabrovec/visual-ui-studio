import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Box,
  ChevronDown,
  ChevronRight,
  Code2,
  Component,
  CornerLeftUp,
  Database,
  Eye,
  EyeOff,
  FileCode2,
  FilePlus2,
  FileUp,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderSync,
  FolderTree,
  Home,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Lock,
  Palette,
  Pencil,
  PlusSquare,
  Search,
  Trash2,
  Unlock,
  Workflow,
} from 'lucide-react';
import { OFFLINE_ICON_CATALOG, searchOfflineIcons } from '@shared/icon-catalog';
import { isTextFileVfsKind, type VfsEntryKind, type VfsNodeDTO } from '@shared/ipc-contract';
import { previewMarkupImport } from '@shared/markup-importer';
import type { NodeId, TokenCategory, UINode } from '@shared/ui-ir';
import { getStudioApi } from '@renderer/api/studio-client';
import { useStudioStore } from '@renderer/state/studio-store';
import {
  PALETTE_ELEMENT_PRESETS,
  REUSABLE_COMPONENT_TEMPLATES,
  type PaletteCategory,
} from '@renderer/utils/palette-catalog';

const PALETTE_CATEGORIES: PaletteCategory[] = ['Layout', 'Controlli', 'Forme', 'Smart Blocks'];
const ICON_CATEGORIES = ['all', 'layout', 'navigation', 'actions', 'commerce', 'media', 'data', 'system', 'ai'] as const;

interface VfsContextMenuState {
  x: number;
  y: number;
  node: VfsNodeDTO;
}

export const LeftPermanentSidebar: React.FC<{ width: number }> = ({ width }) => {
  const sidebarRef = useRef<HTMLElement | null>(null);

  const project = useStudioStore((s) => s.project);
  const vfsTree = useStudioStore((s) => s.vfsTree);
  const leftTopRatio = useStudioStore((s) => s.leftTopRatio);
  const leftActiveMode = useStudioStore((s) => s.leftActiveMode);
  const selectedFolderId = useStudioStore((s) => s.selectedFolderId);
  const activeSheetId = useStudioStore((s) => s.activeSheetId);
  const sheetDocuments = useStudioStore((s) => s.sheetDocuments);
  const selectedNodeIds = useStudioStore((s) => s.selectedNodeIds);
  const tokens = useStudioStore((s) => s.tokens);
  const themes = useStudioStore((s) => s.themes);

  const setLeftTopRatio = useStudioStore((s) => s.setLeftTopRatio);
  const setLeftActiveMode = useStudioStore((s) => s.setLeftActiveMode);
  const setSelectedFolderId = useStudioStore((s) => s.setSelectedFolderId);
  const createVfsEntry = useStudioStore((s) => s.createVfsEntry);
  const renameVfsEntry = useStudioStore((s) => s.renameVfsEntry);
  const moveVfsEntry = useStudioStore((s) => s.moveVfsEntry);
  const deleteVfsEntry = useStudioStore((s) => s.deleteVfsEntry);
  const openVfsNode = useStudioStore((s) => s.openVfsNode);
  const openVfsSource = useStudioStore((s) => s.openVfsSource);
  const linkDiskFolder = useStudioStore((s) => s.linkDiskFolder);

  const insertPaletteElement = useStudioStore((s) => s.insertPaletteElement);
  const insertReusableComponent = useStudioStore((s) => s.insertReusableComponent);
  const insertOfflineIcon = useStudioStore((s) => s.insertOfflineIcon);
  const selectNode = useStudioStore((s) => s.selectNode);
  const commitOps = useStudioStore((s) => s.commitOps);
  const reorderNode = useStudioStore((s) => s.reorderNode);
  const upsertDesignToken = useStudioStore((s) => s.upsertDesignToken);
  const setImportCodeModalOpen = useStudioStore((s) => s.setImportCodeModalOpen);
  const runToolchainTaskAction = useStudioStore((s) => s.runToolchainTaskAction);
  const openTabInGroup = useStudioStore((s) => s.openTabInGroup);
  const pushToast = useStudioStore((s) => s.pushToast);

  // VFS inline create / rename / expand / context-menu / drag states
  const [creatingKind, setCreatingKind] = useState<VfsEntryKind | null>(null);
  const [creatingName, setCreatingName] = useState('');
  const [creatingParentOverride, setCreatingParentOverride] = useState<string | null | undefined>(undefined);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState('');
  const [dragOverFolderId, setDragOverFolderId] = useState<string | '__root__' | null>(null);
  const [contextMenu, setContextMenu] = useState<VfsContextMenuState | null>(null);

  // Bottom palette search & token creation states
  const [paletteQuery, setPaletteQuery] = useState('');
  const [iconQuery, setIconQuery] = useState('');
  const [iconCategory, setIconCategory] = useState<string>('all');
  const [tokenThemeScope, setTokenThemeScope] = useState<string>('base');
  const [newTokenPath, setNewTokenPath] = useState('');
  const [newTokenValue, setNewTokenValue] = useState('#3b82f6');
  const [newTokenCat, setNewTokenCat] = useState<TokenCategory>('color');

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', onEsc);
    };
  }, [contextMenu]);

  const activeSheet = sheetDocuments[activeSheetId];

  const vfsById = useMemo(() => {
    const map = new Map<string, VfsNodeDTO>();
    for (const item of vfsTree) {
      map.set(item.id, item);
    }
    return map;
  }, [vfsTree]);

  // Compute interactive breadcrumb chain for `selectedFolderId`
  const breadcrumbSegments = useMemo(() => {
    const chain: VfsNodeDTO[] = [];
    const visited = new Set<string>();
    let curId = selectedFolderId;
    while (curId && !visited.has(curId)) {
      visited.add(curId);
      const node = vfsById.get(curId);
      if (!node) break;
      chain.unshift(node);
      curId = node.parentId;
    }
    return chain;
  }, [selectedFolderId, vfsById]);

  const expandPathToFolder = (folderId: string | null) => {
    if (!folderId) return;
    const updates: Record<string, boolean> = {};
    let cur: string | null = folderId;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      updates[cur] = true;
      cur = vfsById.get(cur)?.parentId ?? null;
    }
    setExpandedFolders((prev) => ({ ...prev, ...updates }));
  };

  const selectAndRevealFolder = (folderId: string | null) => {
    setSelectedFolderId(folderId);
    if (folderId) {
      expandPathToFolder(folderId);
    }
  };

  const handleExpandAllFolders = () => {
    const allFolders = vfsTree.filter((n) => n.entryKind === 'folder');
    const anyCollapsed = allFolders.some((f) => expandedFolders[f.id] === false);
    const next: Record<string, boolean> = {};
    for (const f of allFolders) {
      next[f.id] = anyCollapsed ? true : true;
    }
    setExpandedFolders(next);
  };

  const startCreate = (kind: VfsEntryKind, explicitParent?: string | null, customDefaultName?: string) => {
    setCreatingKind(kind);
    setCreatingParentOverride(explicitParent);
    if (explicitParent) {
      expandPathToFolder(explicitParent);
    } else if (selectedFolderId) {
      expandPathToFolder(selectedFolderId);
    }

    if (customDefaultName) {
      setCreatingName(customDefaultName);
    } else if (kind === 'folder') {
      setCreatingName(`modulo-${vfsTree.filter((n) => n.entryKind === 'folder').length + 1}`);
    } else if (kind === 'canvas_sheet') {
      setCreatingName(`Foglio${vfsTree.filter((n) => n.entryKind === 'canvas_sheet').length + 1}.canvas`);
    } else if (kind === 'style_file') {
      setCreatingName(`stili-${vfsTree.filter((n) => n.entryKind === 'style_file').length + 1}.css`);
    } else if (kind === 'script_file') {
      const ext = project?.primaryLanguage === 'javascript' ? 'js' : 'ts';
      setCreatingName(`automations-${vfsTree.filter((n) => n.entryKind === 'script_file').length + 1}.${ext}`);
    } else if (kind === 'sql_file') {
      setCreatingName(`query-${vfsTree.filter((n) => n.entryKind === 'sql_file').length + 1}.sql`);
    } else if (kind === 'blueprint_graph') {
      setCreatingName(`Flusso${vfsTree.filter((n) => n.entryKind === 'blueprint_graph').length + 1}.blueprint.json`);
    } else if (kind === 'three_scene') {
      setCreatingName(`Scena3D_${vfsTree.filter((n) => n.entryKind === 'three_scene').length + 1}.scene3d.json`);
    } else {
      setCreatingName(`componente-${vfsTree.length + 1}.tsx`);
    }
  };

  const confirmCreate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!creatingKind || !creatingName.trim()) return;
    // Fixed Bug 11a: subfolders AND files respect `selectedFolderId` (never forced to `null`!)
    const targetParent =
      creatingParentOverride !== undefined ? creatingParentOverride : selectedFolderId;
    if (targetParent) {
      expandPathToFolder(targetParent);
    }
    await createVfsEntry(creatingName.trim(), creatingKind, targetParent);
    setCreatingKind(null);
    setCreatingName('');
    setCreatingParentOverride(undefined);
  };

  const isDescendantOrSelf = (draggedId: string, candidateParentId: string | null): boolean => {
    if (!candidateParentId) return false;
    if (draggedId === candidateParentId) return true;
    let cur: string | null = candidateParentId;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (cur === draggedId) return true;
      cur = vfsById.get(cur)?.parentId ?? null;
    }
    return false;
  };

  const handleHorizontalSashDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const container = sidebarRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const onMove = (ev: PointerEvent) => {
      const relY = ev.clientY - rect.top;
      setLeftTopRatio(relY / rect.height);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Build hierarchical VFS children map (folders sorted before files)
  const vfsByParent = useMemo(() => {
    const map: Record<string, VfsNodeDTO[]> = { __root__: [] };
    for (const item of vfsTree) {
      const key = item.parentId && vfsById.has(item.parentId) ? item.parentId : '__root__';
      if (!map[key]) map[key] = [];
      map[key].push(item);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => {
        if (a.entryKind === 'folder' && b.entryKind !== 'folder') return -1;
        if (a.entryKind !== 'folder' && b.entryKind === 'folder') return 1;
        return a.name.localeCompare(b.name);
      });
    }
    return map;
  }, [vfsTree, vfsById]);

  const fileIconForNode = (node: VfsNodeDTO) => {
    const lower = node.name.toLowerCase();
    if (node.entryKind === 'canvas_sheet' || lower.endsWith('.canvas')) {
      return <LayoutGrid size={13} color="var(--accent-primary)" style={{ flexShrink: 0 }} />;
    }
    if (node.entryKind === 'style_file' || lower.endsWith('.css') || lower.endsWith('.scss')) {
      return <Palette size={13} color="#ec4899" style={{ flexShrink: 0 }} />;
    }
    if (
      node.entryKind === 'sql_schema' ||
      node.entryKind === 'sql_file' ||
      /\.(sql|sqlite|sqlite3|db)$/i.test(lower)
    ) {
      return <Database size={13} color="var(--accent-emerald)" style={{ flexShrink: 0 }} />;
    }
    if (node.entryKind === 'blueprint_graph' || lower.endsWith('.blueprint.json')) {
      return <Workflow size={13} color="#f59e0b" style={{ flexShrink: 0 }} />;
    }
    if (node.entryKind === 'three_scene' || lower.endsWith('.scene3d.json')) {
      return <Box size={13} color="var(--accent-emerald)" style={{ flexShrink: 0 }} />;
    }
    if (lower.endsWith('.py')) {
      return <FileCode2 size={13} color="#facc15" style={{ flexShrink: 0 }} />;
    }
    if (lower.endsWith('.rs') || lower === 'cargo.toml') {
      return <FileCode2 size={13} color="#f87171" style={{ flexShrink: 0 }} />;
    }
    if (node.entryKind === 'script_file' || /\.(ts|js|mjs)$/i.test(lower)) {
      return <FileCode2 size={13} color="#38bdf8" style={{ flexShrink: 0 }} />;
    }
    return <FileCode2 size={13} color="var(--accent-violet)" style={{ flexShrink: 0 }} />;
  };

  const renderVfsSubtree = (parentId: string | null, depth = 0): React.ReactNode => {
    const list = vfsByParent[parentId ?? '__root__'] ?? [];
    return list.map((node) => {
      const isFolder = node.entryKind === 'folder';
      const isOpen = expandedFolders[node.id] ?? true;
      const isSelected =
        (isFolder && selectedFolderId === node.id) ||
        (!isFolder && node.sheetId && node.sheetId === activeSheetId);
      const isDragOver = isFolder && dragOverFolderId === node.id;

      return (
        <div key={node.id}>
          <div
            className={`vfs-row ${isSelected ? 'selected' : ''} ${isDragOver ? 'drag-over' : ''}`}
            style={{ paddingLeft: 6 + depth * 14 }}
            data-testid={`vfs-item-${node.name}`}
            role="group"
            aria-label={`${isFolder ? 'Cartella' : 'File'} ${node.name}`}
            aria-keyshortcuts="Enter Space"
            tabIndex={renamingId === node.id ? -1 : 0}
            onKeyDown={(ev) => {
              if (ev.target !== ev.currentTarget || (ev.key !== 'Enter' && ev.key !== ' ')) return;
              ev.preventDefault();
              ev.stopPropagation();
              ev.currentTarget.click();
            }}
            draggable={renamingId !== node.id}
            onDragStart={(ev) => {
              ev.dataTransfer.setData('application/x-studio-vfs-id', node.id);
              ev.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(ev) => {
              if (!isFolder) return;
              if (ev.dataTransfer.types.includes('application/x-studio-vfs-id')) {
                ev.preventDefault();
                ev.stopPropagation();
                setDragOverFolderId(node.id);
              }
            }}
            onDragLeave={() => {
              if (dragOverFolderId === node.id) setDragOverFolderId(null);
            }}
            onDrop={(ev) => {
              if (!isFolder) return;
              const draggedId = ev.dataTransfer.getData('application/x-studio-vfs-id');
              setDragOverFolderId(null);
              if (draggedId && !isDescendantOrSelf(draggedId, node.id)) {
                ev.preventDefault();
                ev.stopPropagation();
                expandPathToFolder(node.id);
                void moveVfsEntry(draggedId, node.id);
              }
            }}
            onContextMenu={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              if (isFolder) setSelectedFolderId(node.id);
              setContextMenu({
                x: Math.min(ev.clientX, window.innerWidth - 220),
                y: Math.min(ev.clientY, window.innerHeight - 210),
                node,
              });
            }}
            onClick={() => {
              if (isFolder) {
                setSelectedFolderId(node.id);
                if (!isOpen) {
                  setExpandedFolders((prev) => ({ ...prev, [node.id]: true }));
                }
              } else {
                if (node.parentId) {
                  setSelectedFolderId(node.parentId);
                }
                void openVfsNode(node);
              }
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: 1 }}>
              {isFolder ? (
                <>
                  <button
                    type="button"
                    className="vfs-chevron-btn"
                    data-testid={`vfs-chevron-${node.name}`}
                    aria-expanded={isOpen}
                    title={isOpen ? 'Comprimi cartella' : 'Espandi cartella'}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setExpandedFolders((prev) => ({ ...prev, [node.id]: !isOpen }));
                    }}
                  >
                    {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                  {isOpen ? (
                    <FolderOpen size={13} color="var(--accent-amber)" style={{ flexShrink: 0 }} />
                  ) : (
                    <Folder size={13} color="var(--accent-amber)" style={{ flexShrink: 0 }} />
                  )}
                </>
              ) : (
                <>
                  <span style={{ width: 12, flexShrink: 0 }} />
                  {fileIconForNode(node)}
                </>
              )}

              {renamingId === node.id ? (
                <input
                  className="studio-input"
                  style={{ height: 21, padding: '0 5px', width: '100%', minWidth: 0 }}
                  autoFocus
                  value={renamingValue}
                  onClick={(ev) => ev.stopPropagation()}
                  onChange={(ev) => setRenamingValue(ev.target.value)}
                  onBlur={() => {
                    if (renamingValue.trim() && renamingValue !== node.name) {
                      void renameVfsEntry(node.id, renamingValue);
                    }
                    setRenamingId(null);
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') {
                      if (renamingValue.trim()) void renameVfsEntry(node.id, renamingValue);
                      setRenamingId(null);
                    } else if (ev.key === 'Escape') {
                      setRenamingId(null);
                    }
                  }}
                />
              ) : (
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {node.name}
                </span>
              )}
            </div>

            {isTextFileVfsKind(node.entryKind) && (
              <button
                type="button"
                className="row-icon-btn"
                aria-label={`Modifica codice di ${node.name}`}
                title="Apri e modifica il codice sorgente"
                data-testid={`vfs-edit-source-${node.name}`}
                onClick={(ev) => {
                  ev.stopPropagation();
                  void openVfsSource(node);
                }}
              >
                <Code2 size={12} />
              </button>
            )}
            <div className="vfs-row-actions" onClick={(ev) => ev.stopPropagation()}>
              {isFolder && (
                <button
                  type="button"
                  className="row-icon-btn"
                  title="Nuova sottocartella qui"
                  onClick={() => {
                    setSelectedFolderId(node.id);
                    startCreate('folder', node.id);
                  }}
                >
                  <FolderPlus size={11} />
                </button>
              )}
              <button
                type="button"
                className="row-icon-btn"
                title="Rinomina"
                onClick={() => {
                  setRenamingId(node.id);
                  setRenamingValue(node.name);
                }}
              >
                <Pencil size={11} />
              </button>
              <button
                type="button"
                className="row-icon-btn"
                title="Elimina"
                onClick={() => void deleteVfsEntry(node.id)}
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>

          {isFolder && isOpen && renderVfsSubtree(node.id, depth + 1)}
        </div>
      );
    });
  };

  // Recursive SceneGraph Layers renderer
  const renderLayerTree = (nodeId: NodeId, depth = 0): React.ReactNode => {
    if (!activeSheet) return null;
    const node: UINode | undefined = activeSheet.nodes[nodeId];
    if (!node) return null;
    const isSel = selectedNodeIds.includes(node.id);

    const layoutBadge =
      node.layout.mode === 'flex'
        ? node.layout.direction === 'row'
          ? 'Flex →'
          : 'Flex ↓'
        : node.layout.mode === 'grid'
          ? 'Grid ⊞'
          : node.layout.positioning === 'absolute'
            ? 'X,Y'
            : null;

    return (
      <div key={node.id}>
        <div
          className={`vfs-row ${isSel ? 'selected' : ''}`}
          style={{ paddingLeft: 6 + depth * 13, opacity: node.visible ? 1 : 0.45 }}
          data-testid={`layer-row-${node.id}`}
          role="group"
          aria-label={`Livello ${node.name}`}
          aria-current={isSel ? 'true' : undefined}
          aria-keyshortcuts="Enter Space"
          tabIndex={0}
          onKeyDown={(ev) => {
            if (ev.target !== ev.currentTarget || (ev.key !== 'Enter' && ev.key !== ' ')) return;
            ev.preventDefault();
            ev.stopPropagation();
            selectNode(node.id, ev.shiftKey);
          }}
          onClick={(ev) => selectNode(node.id, ev.shiftKey)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 10, opacity: 0.75 }}>
              {node.kind === 'artboard'
                ? '▣'
                : node.kind === 'container'
                  ? '▢'
                  : node.kind === 'text'
                    ? 'T'
                    : node.kind === 'control'
                      ? '◈'
                      : '●'}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {node.name}
            </span>
            {layoutBadge && <span className="badge blue">{layoutBadge}</span>}
            {node.platform?.htmx && <span className="badge green">hx</span>}
            {node.platform?.mvvm && <span className="badge violet">mvvm</span>}
          </div>

          <div className="vfs-row-actions" onClick={(ev) => ev.stopPropagation()}>
            <button
              type="button"
              className="row-icon-btn"
              title="Sposta su"
              onClick={() => void reorderNode(node.id, -1)}
            >
              <ArrowUp size={11} />
            </button>
            <button
              type="button"
              className="row-icon-btn"
              title="Sposta giù"
              onClick={() => void reorderNode(node.id, 1)}
            >
              <ArrowDown size={11} />
            </button>
            <button
              type="button"
              className="row-icon-btn"
              title={node.visible ? 'Nascondi livello' : 'Mostra livello'}
              onClick={() => void commitOps([{ op: 'update_node', id: node.id, visible: !node.visible }], 'Visibilità nodo')}
            >
              {node.visible ? <Eye size={11} /> : <EyeOff size={11} />}
            </button>
            <button
              type="button"
              className="row-icon-btn"
              title={node.locked ? 'Sblocca livello' : 'Blocca livello'}
              onClick={() => void commitOps([{ op: 'update_node', id: node.id, locked: !node.locked }], 'Blocco nodo')}
            >
              {node.locked ? <Lock size={11} /> : <Unlock size={11} />}
            </button>
            {node.kind !== 'artboard' && (
              <button
                type="button"
                className="row-icon-btn"
                title="Elimina nodo"
                onClick={() => void commitOps([{ op: 'delete_node', id: node.id }], `Elimina ${node.name}`)}
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        </div>
        {node.childIds.map((cid) => renderLayerTree(cid, depth + 1))}
      </div>
    );
  };

  const filteredIcons = useMemo(
    () => searchOfflineIcons(iconQuery, iconCategory),
    [iconQuery, iconCategory],
  );

  const darkThemeObj = themes.find((t) => t.name.toLowerCase() === 'dark');
  const displayedTokens = useMemo(() => {
    if (tokenThemeScope === 'dark' && darkThemeObj) {
      return tokens.filter((t) => t.themeId === darkThemeObj.id);
    }
    return tokens.filter((t) => t.themeId === null);
  }, [tokens, tokenThemeScope, darkThemeObj]);

  const activeScopePathLabel = useMemo(() => {
    if (breadcrumbSegments.length === 0) return '/';
    return '/' + breadcrumbSegments.map((s) => s.name).join('/');
  }, [breadcrumbSegments]);

  const minSidebarWidth = typeof window !== 'undefined' && window.innerWidth < 1080 ? 220 : 256;

  return (
    <aside
      ref={sidebarRef}
      className="left-permanent-sidebar"
      style={{ width: Math.max(minSidebarWidth, width), minWidth: minSidebarWidth }}
      data-testid="left-permanent-sidebar"
      aria-label="Navigatore Progetto e Strumenti Grafici Permanenti"
    >
      {/* ==================== TOP HALF: VS CODE FILE EXPLORER & BREADCRUMB ==================== */}
      <div
        style={{
          height: `${Math.round(leftTopRatio * 100)}%`,
          minHeight: 195,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div className="sidebar-section-header">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
            Esplora Progetto
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <button
              type="button"
              className="row-icon-btn"
              data-testid="btn-vfs-expand-all"
              style={{ width: 'auto', padding: '0 4px', fontSize: 9.5 }}
              title="Scopri ed espandi tutte le cartelle"
              onClick={handleExpandAllFolders}
            >
              <FolderTree size={11} style={{ marginRight: 2 }} />
              <span>Scopri tutto</span>
            </button>
            <span className="badge" style={{ flexShrink: 0 }}>{vfsTree.length}</span>
          </div>
        </div>

        {/* Interactive VS Code Breadcrumb Path Bar */}
        <nav className="vfs-breadcrumb-bar" data-testid="vfs-breadcrumb-bar" aria-label="Percorso del progetto">
          <div className="vfs-breadcrumb-segments">
            <button
              type="button"
              className={`vfs-breadcrumb-seg ${selectedFolderId === null ? 'active' : ''}`}
              data-testid="vfs-breadcrumb-root"
              aria-current={selectedFolderId === null ? 'location' : undefined}
              title="Radice del progetto (clicca o rilascia file qui)"
              onDragOver={(ev) => {
                if (ev.dataTransfer.types.includes('application/x-studio-vfs-id')) {
                  ev.preventDefault();
                  setDragOverFolderId('__root__');
                }
              }}
              onDragLeave={() => {
                if (dragOverFolderId === '__root__') setDragOverFolderId(null);
              }}
              onDrop={(ev) => {
                const draggedId = ev.dataTransfer.getData('application/x-studio-vfs-id');
                setDragOverFolderId(null);
                if (draggedId) {
                  ev.preventDefault();
                  void moveVfsEntry(draggedId, null);
                }
              }}
              onClick={() => selectAndRevealFolder(null)}
            >
              <Home size={11} />
              <span style={{ maxWidth: 84, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {project?.name?.split(' ')[0] ?? 'Progetto'}
              </span>
            </button>

            {breadcrumbSegments.map((seg) => (
              <React.Fragment key={seg.id}>
                <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>/</span>
                <button
                  type="button"
                  className={`vfs-breadcrumb-seg ${selectedFolderId === seg.id ? 'active' : ''}`}
                  data-testid={`vfs-breadcrumb-seg-${seg.name}`}
                  aria-current={selectedFolderId === seg.id ? 'location' : undefined}
                  onClick={() => selectAndRevealFolder(seg.id)}
                >
                  <span>📁 {seg.name}</span>
                </button>
              </React.Fragment>
            ))}
          </div>

          <button
            type="button"
            className="row-icon-btn"
            data-testid="btn-vfs-up-level"
            disabled={!selectedFolderId}
            title="Livello Superiore (Cartella Padre)"
            onClick={() => {
              if (!selectedFolderId) return;
              const parentId = vfsById.get(selectedFolderId)?.parentId ?? null;
              selectAndRevealFolder(parentId);
            }}
          >
            <CornerLeftUp size={12} />
          </button>
        </nav>

        {/* Primary VFS Toolbar (preserves E2E testids + respects selectedFolderId) */}
        <div className="vfs-toolbar">
          <button
            type="button"
            className="studio-btn sm"
            data-testid="btn-new-folder"
            onClick={() => startCreate('folder')}
            title={`Nuova Cartella in ${activeScopePathLabel}`}
          >
            <FolderPlus size={12} style={{ flexShrink: 0 }} />
            <span className="sidebar-btn-text">Nuova Cartella</span>
          </button>
          <button
            type="button"
            className="studio-btn sm primary"
            data-testid="btn-new-sheet"
            onClick={() => startCreate('canvas_sheet')}
            title={`Nuovo Foglio Canvas in ${activeScopePathLabel}`}
          >
            <PlusSquare size={12} style={{ flexShrink: 0 }} />
            <span className="sidebar-btn-text">Nuovo Foglio</span>
          </button>
          <button
            type="button"
            className="studio-btn sm"
            data-testid="btn-new-file"
            onClick={() => startCreate('source_file')}
            title={`Nuovo File Sorgente in ${activeScopePathLabel}`}
          >
            <FilePlus2 size={12} style={{ flexShrink: 0 }} />
            <span className="sidebar-btn-text">Nuovo File</span>
          </button>
          <button
            type="button"
            className="studio-btn sm"
            data-testid="btn-sidebar-link-disk"
            onClick={() => void linkDiskFolder()}
            title="Collega Cartella Disco"
          >
            <FolderSync size={12} style={{ flexShrink: 0 }} />
            <span className="sidebar-btn-text">Collega Disco</span>
          </button>
        </div>

        {/* Quick 1-Click Typed File Pills */}
        <div className="vfs-quick-pills">
          <button
            type="button"
            className="vfs-pill-btn"
            data-testid="pill-new-css"
            onClick={() => startCreate('style_file')}
            title={`Crea foglio stile .css in ${activeScopePathLabel}`}
          >
            + CSS
          </button>
          <button
            type="button"
            className="vfs-pill-btn"
            data-testid="pill-new-script"
            onClick={() => startCreate('script_file')}
            title={`Crea script logica .ts/.js in ${activeScopePathLabel}`}
          >
            + TS/JS
          </button>
          <button
            type="button"
            className="vfs-pill-btn"
            data-testid="pill-new-py"
            onClick={() => startCreate('source_file', undefined, 'automations.py')}
            title={`Crea modulo Python .py in ${activeScopePathLabel}`}
          >
            + .py
          </button>
          <button
            type="button"
            className="vfs-pill-btn"
            data-testid="pill-new-sql"
            onClick={() => startCreate('sql_file')}
            title={`Crea script SQL .sql in ${activeScopePathLabel}`}
          >
            + .sql
          </button>
          <button
            type="button"
            className="vfs-pill-btn"
            data-testid="pill-new-blueprint"
            onClick={() => startCreate('blueprint_graph')}
            title={`Crea grafo visuale .blueprint.json in ${activeScopePathLabel}`}
          >
            + Blueprint
          </button>
          <button
            type="button"
            className="vfs-pill-btn"
            data-testid="pill-new-three"
            onClick={() => startCreate('three_scene')}
            title={`Crea scena 3D .scene3d.json in ${activeScopePathLabel}`}
          >
            + 3D
          </button>
        </div>

        {creatingKind && (
          <form
            onSubmit={(ev) => void confirmCreate(ev)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: '6px 8px',
              background: 'var(--bg-panel-elevated)',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Crea in: <strong style={{ color: 'var(--accent-primary)' }}>{activeScopePathLabel}</strong>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                className="studio-input"
                data-testid="input-create-vfs-name"
                style={{ flex: 1, height: 24, minWidth: 0 }}
                autoFocus
                value={creatingName}
                onChange={(e) => setCreatingName(e.target.value)}
                placeholder={
                  creatingKind === 'folder'
                    ? 'Nome cartella...'
                    : creatingKind === 'canvas_sheet'
                      ? 'NomeFoglio.canvas'
                      : 'nomefile.ts'
                }
              />
              <button type="submit" className="studio-btn sm primary" data-testid="btn-confirm-create-vfs">
                Crea
              </button>
              <button
                type="button"
                className="studio-btn sm"
                onClick={() => {
                  setCreatingKind(null);
                  setCreatingParentOverride(undefined);
                }}
              >
                Annulla
              </button>
            </div>
          </form>
        )}

        <div
          className="vfs-tree-scroll"
          data-testid="vfs-tree-container"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedFolderId(null);
            }
          }}
        >
          {renderVfsSubtree(null, 0)}
        </div>
      </div>

      {/* Right-Click Context Menu on VFS Folders & Files */}
      {contextMenu && (
        <div
          className="vfs-context-menu"
          data-testid="vfs-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="menubar-section-label">{contextMenu.node.name}</div>
          {isTextFileVfsKind(contextMenu.node.entryKind) && (
            <button
              type="button"
              className="menubar-option"
              data-testid="vfs-context-edit-source"
              onClick={() => {
                const node = contextMenu.node;
                setContextMenu(null);
                void openVfsSource(node);
              }}
            >
              <Code2 size={13} />
              <span>Modifica codice sorgente</span>
            </button>
          )}
          {contextMenu.node.entryKind !== 'source_file' && isTextFileVfsKind(contextMenu.node.entryKind) && (
            <button
              type="button"
              className="menubar-option"
              data-testid="vfs-context-open-workbench"
              onClick={() => {
                const node = contextMenu.node;
                setContextMenu(null);
                void openVfsNode(node, 'workbench');
              }}
            >
              <span>Apri nell’editor specializzato</span>
            </button>
          )}
          {/\.(html|jsx|tsx|svelte)$/i.test(contextMenu.node.name) && activeSheet && (
            <button
              type="button"
              className="menubar-option"
              onClick={async () => {
                const targetNode = contextMenu.node;
                setContextMenu(null);
                try {
                  const read = await getStudioApi().vfs.readFile(targetNode.id);
                  const preview = previewMarkupImport(
                    activeSheet,
                    activeSheet.rootIds[0] ?? null,
                    read.content,
                    'auto',
                  );
                  if (preview.ops.length > 0) {
                    await commitOps(preview.ops, `Solleva ${targetNode.name} sul Canvas`, 'code_sync');
                    openTabInGroup({
                      kind: 'canvas',
                      title: `${activeSheet.name}.canvas`,
                      sheetId: activeSheet.sheetId,
                    });
                    pushToast('success', `Sollevati ${preview.nodeCount} nodi da "${targetNode.name}" sul Canvas!`);
                  } else {
                    pushToast('warn', 'Nessun elemento visuale rilevato nel file.');
                  }
                } catch {
                  pushToast('error', 'Impossibile leggere il file selezionato.');
                }
              }}
            >
              <span>🎨 Apri / Solleva nel Canvas Visuale</span>
            </button>
          )}
          {/\.(js|mjs|ts|py)$/i.test(contextMenu.node.name) && (
            <button
              type="button"
              className="menubar-option"
              onClick={() => {
                const targetNode = contextMenu.node;
                setContextMenu(null);
                const rel = (targetNode.diskRelPath || targetNode.virtualPath).replace(/^\/+/, '');
                void runToolchainTaskAction({
                  kind: targetNode.name.toLowerCase().endsWith('.py') ? 'python_run' : 'node_run',
                  scriptRelPath: rel,
                });
              }}
            >
              <span>▶ Esegui File ({contextMenu.node.name.toLowerCase().endsWith('.py') ? 'Python' : 'Node'})</span>
            </button>
          )}
          <button
            type="button"
            className="menubar-option"
            onClick={() => {
              const parentScope =
                contextMenu.node.entryKind === 'folder'
                  ? contextMenu.node.id
                  : contextMenu.node.parentId;
              setSelectedFolderId(parentScope);
              startCreate('folder', parentScope);
              setContextMenu(null);
            }}
          >
            <span>📁 Nuova Sottocartella</span>
          </button>
          <button
            type="button"
            className="menubar-option"
            onClick={() => {
              const parentScope =
                contextMenu.node.entryKind === 'folder'
                  ? contextMenu.node.id
                  : contextMenu.node.parentId;
              setSelectedFolderId(parentScope);
              startCreate('canvas_sheet', parentScope);
              setContextMenu(null);
            }}
          >
            <span>🎨 Nuovo Foglio Canvas qui</span>
          </button>
          <button
            type="button"
            className="menubar-option"
            onClick={() => {
              const parentScope =
                contextMenu.node.entryKind === 'folder'
                  ? contextMenu.node.id
                  : contextMenu.node.parentId;
              setSelectedFolderId(parentScope);
              startCreate('script_file', parentScope);
              setContextMenu(null);
            }}
          >
            <span>📜 Nuovo File qui (.ts)</span>
          </button>
          <div className="menubar-divider" />
          <button
            type="button"
            className="menubar-option"
            onClick={() => {
              setRenamingId(contextMenu.node.id);
              setRenamingValue(contextMenu.node.name);
              setContextMenu(null);
            }}
          >
            <span>✏️ Rinomina</span>
          </button>
          {contextMenu.node.parentId !== null && (
            <button
              type="button"
              className="menubar-option"
              onClick={() => {
                void moveVfsEntry(contextMenu.node.id, null);
                setContextMenu(null);
              }}
            >
              <span>🏠 Sposta in Radice (/)</span>
            </button>
          )}
          <button
            type="button"
            className="menubar-option"
            onClick={() => {
              void deleteVfsEntry(contextMenu.node.id);
              setContextMenu(null);
            }}
          >
            <span>🗑️ Elimina</span>
          </button>
        </div>
      )}

      {/* Horizontal Sash between File Navigation and Mode Selector / Graphic Palettes */}
      <div className="sash-horizontal" onPointerDown={handleHorizontalSashDown} />

      {/* ==================== MIDDLE ANCHOR: MODE SELECTOR BAR ==================== */}
      <nav className="left-mode-selector" data-testid="left-mode-selector" aria-label="Selettore Modalità Grafica">
        <button
          type="button"
          className={`mode-tab-btn ${leftActiveMode === 'insert' ? 'active' : ''}`}
          data-testid="mode-tab-insert"
          onClick={() => setLeftActiveMode('insert')}
        >
          <PlusSquare size={14} />
          <span>Inserisci</span>
        </button>
        <button
          type="button"
          className={`mode-tab-btn ${leftActiveMode === 'components' ? 'active' : ''}`}
          data-testid="mode-tab-components"
          onClick={() => setLeftActiveMode('components')}
        >
          <Component size={14} />
          <span>Componenti</span>
        </button>
        <button
          type="button"
          className={`mode-tab-btn ${leftActiveMode === 'layers' ? 'active' : ''}`}
          data-testid="mode-tab-layers"
          onClick={() => setLeftActiveMode('layers')}
        >
          <Layers size={14} />
          <span>Livelli</span>
        </button>
        <button
          type="button"
          className={`mode-tab-btn ${leftActiveMode === 'assets' ? 'active' : ''}`}
          data-testid="mode-tab-assets"
          onClick={() => setLeftActiveMode('assets')}
        >
          <ImageIcon size={14} />
          <span>Icone</span>
        </button>
        <button
          type="button"
          className={`mode-tab-btn ${leftActiveMode === 'tokens' ? 'active' : ''}`}
          data-testid="mode-tab-tokens"
          onClick={() => setLeftActiveMode('tokens')}
        >
          <Palette size={14} />
          <span>Tokens</span>
        </button>
      </nav>

      {/* ==================== BOTTOM HALF: DYNAMIC GRAPHIC PALETTES ==================== */}
      <div className="left-bottom-palette">
        {/* 1. + INSERISCI */}
        {leftActiveMode === 'insert' && (
          <>
            <div style={{ padding: '7px 10px 4px', display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Search size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                <input
                  className="studio-input"
                  style={{ width: '100%', height: 26, minWidth: 0 }}
                  placeholder="Cerca elemento (Button, HTMX, Grid)..."
                  value={paletteQuery}
                  onChange={(e) => setPaletteQuery(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="studio-btn sm violet"
                data-testid="btn-sidebar-import-code"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => setImportCodeModalOpen(true)}
                title="Incolla HTML, Tailwind, HTMX, JSX o SVG per generare nodi modificabili"
              >
                <FileUp size={12} />
                <span>Importa Codice HTML / JSX / SVG</span>
              </button>
            </div>
            <div className="palette-scroll" data-testid="palette-insert-list">
              {PALETTE_CATEGORIES.map((cat) => {
                const items = PALETTE_ELEMENT_PRESETS.filter(
                  (p) =>
                    p.category === cat &&
                    (!paletteQuery.trim() ||
                      p.label.toLowerCase().includes(paletteQuery.toLowerCase()) ||
                      p.description.toLowerCase().includes(paletteQuery.toLowerCase())),
                );
                if (items.length === 0) return null;
                return (
                  <div key={cat}>
                    <div className="palette-category-title">{cat}</div>
                    <div className="palette-grid">
                      {items.map((item) => {
                        const iconEntry = OFFLINE_ICON_CATALOG.find((i) => i.id === item.iconHint);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className="palette-card"
                            data-testid={`palette-item-${item.id}`}
                            draggable
                            onDragStart={(ev) => {
                              ev.dataTransfer.setData('application/x-studio-palette-id', item.id);
                              ev.dataTransfer.effectAllowed = 'copy';
                            }}
                            onClick={() => void insertPaletteElement(item.id)}
                            title={`${item.description} (Clicca o trascina nel Canvas)`}
                          >
                            {iconEntry && (
                              <svg
                                width="15"
                                height="15"
                                viewBox={iconEntry.viewBox}
                                fill="none"
                                stroke="var(--accent-primary)"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                style={{ flexShrink: 0 }}
                                dangerouslySetInnerHTML={{ __html: iconEntry.svgBody }}
                              />
                            )}
                            <span style={{ fontSize: 11.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {item.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* 2. ❖ COMPONENTI */}
        {leftActiveMode === 'components' && (
          <div className="palette-scroll" data-testid="palette-components-list">
            <div className="palette-category-title">Blocchi UI Pre-Costruiti</div>
            {REUSABLE_COMPONENT_TEMPLATES.map((comp) => (
              <button
                key={comp.id}
                type="button"
                className="component-block-card"
                data-testid={`component-tpl-${comp.id}`}
                onClick={() => void insertReusableComponent(comp.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                  <strong style={{ fontSize: 12.5 }}>{comp.name}</strong>
                  <span className="badge violet">{comp.badge}</span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{comp.description}</span>
              </button>
            ))}
          </div>
        )}

        {/* 3. ≡ LIVELLI */}
        {leftActiveMode === 'layers' && (
          <div className="palette-scroll" data-testid="palette-layers-tree">
            <div className="palette-category-title">
              Gerarchia SceneGraph ({activeSheet ? Object.keys(activeSheet.nodes).length : 0} nodi)
            </div>
            {activeSheet ? (
              activeSheet.rootIds.map((rid) => renderLayerTree(rid, 0))
            ) : (
              <div style={{ color: 'var(--text-muted)', padding: 12 }}>Nessun foglio attivo.</div>
            )}
          </div>
        )}

        {/* 4. 🖼 ICONE / ASSETS */}
        {leftActiveMode === 'assets' && (
          <>
            <div style={{ padding: '7px 8px 4px', display: 'flex', flexDirection: 'column', gap: 5 }}>
              <input
                className="studio-input"
                placeholder="Cerca 64 icone SVG offline..."
                value={iconQuery}
                onChange={(e) => setIconQuery(e.target.value)}
              />
              <select
                className="studio-select"
                value={iconCategory}
                onChange={(e) => setIconCategory(e.target.value)}
              >
                {ICON_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    Categoria: {cat.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
            <div className="palette-scroll" data-testid="palette-icons-grid">
              <div className="icon-grid">
                {filteredIcons.map((ic) => (
                  <button
                    key={ic.id}
                    type="button"
                    className="icon-cell"
                    data-testid={`offline-icon-${ic.id}`}
                    onClick={() => void insertOfflineIcon(ic)}
                    title={`${ic.name} (${ic.id})`}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox={ic.viewBox}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      dangerouslySetInnerHTML={{ __html: ic.svgBody }}
                    />
                    <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ic.id}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* 5. 🎨 TOKENS */}
        {leftActiveMode === 'tokens' && (
          <div className="palette-scroll" data-testid="palette-tokens-editor">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span className="palette-category-title" style={{ margin: 0 }}>
                Design Tokens
              </span>
              <div className="segmented-group">
                <button
                  type="button"
                  className={`segmented-item ${tokenThemeScope === 'base' ? 'active' : ''}`}
                  onClick={() => setTokenThemeScope('base')}
                >
                  Light / Base
                </button>
                <button
                  type="button"
                  className={`segmented-item ${tokenThemeScope === 'dark' ? 'active' : ''}`}
                  onClick={() => setTokenThemeScope('dark')}
                >
                  Dark
                </button>
              </div>
            </div>

            {displayedTokens.map((tok) => (
              <div
                key={tok.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                  padding: '5px 6px',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {tok.tokenPath}
                  </div>
                  <div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>{tok.category}</div>
                </div>
                {tok.category === 'color' && tok.rawValue.startsWith('#') && (
                  <input
                    type="color"
                    value={tok.rawValue.slice(0, 7)}
                    onChange={(e) =>
                      void upsertDesignToken({
                        id: tok.id,
                        projectId: tok.projectId,
                        themeId: tok.themeId,
                        tokenPath: tok.tokenPath,
                        category: tok.category,
                        rawValue: e.target.value,
                      })
                    }
                    style={{ width: 24, height: 22, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
                  />
                )}
                <input
                  className="studio-input"
                  style={{ width: 92, height: 23, fontSize: 11 }}
                  defaultValue={tok.rawValue}
                  onBlur={(e) => {
                    if (e.target.value !== tok.rawValue) {
                      void upsertDesignToken({
                        id: tok.id,
                        projectId: tok.projectId,
                        themeId: tok.themeId,
                        tokenPath: tok.tokenPath,
                        category: tok.category,
                        rawValue: e.target.value,
                      });
                    }
                  }}
                />
              </div>
            ))}

            {/* Quick Add Token */}
            {project && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newTokenPath.trim()) return;
                  void upsertDesignToken({
                    projectId: project.id,
                    themeId: tokenThemeScope === 'dark' && darkThemeObj ? darkThemeObj.id : null,
                    tokenPath: newTokenPath.trim(),
                    category: newTokenCat,
                    rawValue: newTokenValue.trim(),
                  });
                  setNewTokenPath('');
                }}
                style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 6 }}
              >
                <div className="palette-category-title" style={{ margin: 0 }}>
                  + Nuovo Token
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <select
                    className="studio-select"
                    value={newTokenCat}
                    onChange={(e) => setNewTokenCat(e.target.value as TokenCategory)}
                    style={{ width: 88 }}
                  >
                    <option value="color">color</option>
                    <option value="spacing">spacing</option>
                    <option value="radius">radius</option>
                    <option value="typography">font</option>
                  </select>
                  <input
                    className="studio-input"
                    style={{ flex: 1, minWidth: 0 }}
                    placeholder="es. color.brand.400"
                    value={newTokenPath}
                    onChange={(e) => setNewTokenPath(e.target.value)}
                  />
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <input
                    className="studio-input"
                    style={{ flex: 1, minWidth: 0 }}
                    placeholder="Valore (#hex, 16px)..."
                    value={newTokenValue}
                    onChange={(e) => setNewTokenValue(e.target.value)}
                  />
                  <button type="submit" className="studio-btn sm primary">
                    Salva
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
