import React, { useEffect, useMemo, useState } from 'react';
import { Command, FileCode2, Keyboard, Search, Sparkles, Wand2, X } from 'lucide-react';
import { useStudioStore } from '@renderer/state/studio-store';

interface PaletteActionItem {
  id: string;
  category: string;
  label: string;
  shortcut?: string;
  run: () => void | Promise<void>;
}

export const CommandPaletteModal: React.FC = () => {
  const commandPaletteOpen = useStudioStore((s) => s.commandPaletteOpen);
  const shortcutsHelpOpen = useStudioStore((s) => s.shortcutsHelpOpen);
  const vfsTree = useStudioStore((s) => s.vfsTree);
  const targets = useStudioStore((s) => s.targets);
  const activeSheetId = useStudioStore((s) => s.activeSheetId);
  const globalTarget = useStudioStore((s) => s.globalTarget);
  const globalDialect = useStudioStore((s) => s.globalDialect);
  const studioTheme = useStudioStore((s) => s.studioTheme);
  const bottomConsoleOpen = useStudioStore((s) => s.bottomConsoleOpen);

  const setCommandPaletteOpen = useStudioStore((s) => s.setCommandPaletteOpen);
  const setShortcutsHelpOpen = useStudioStore((s) => s.setShortcutsHelpOpen);
  const setShowProjectHub = useStudioStore((s) => s.setShowProjectHub);
  const setWizardOpen = useStudioStore((s) => s.setWizardOpen);
  const createQuickFreeformProject = useStudioStore((s) => s.createQuickFreeformProject);
  const applyLayoutPreset = useStudioStore((s) => s.applyLayoutPreset);
  const setBottomConsoleOpen = useStudioStore((s) => s.setBottomConsoleOpen);
  const setCanvasPlacementMode = useStudioStore((s) => s.setCanvasPlacementMode);
  const solveAutoLayoutOnActive = useStudioStore((s) => s.solveAutoLayoutOnActive);
  const setImportCodeModalOpen = useStudioStore((s) => s.setImportCodeModalOpen);
  const setA11yModalOpen = useStudioStore((s) => s.setA11yModalOpen);
  const setUnslothModalOpen = useStudioStore((s) => s.setUnslothModalOpen);
  const exportProjectScaffold = useStudioStore((s) => s.exportProjectScaffold);
  const setStudioTheme = useStudioStore((s) => s.setStudioTheme);
  const openVfsNode = useStudioStore((s) => s.openVfsNode);
  const setGlobalTarget = useStudioStore((s) => s.setGlobalTarget);

  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery('');
      setSelectedIdx(0);
    }
  }, [commandPaletteOpen]);

  const items = useMemo<PaletteActionItem[]>(() => {
    const core: PaletteActionItem[] = [
      {
        id: 'cmd-wizard',
        category: 'Progetto',
        label: '🪄 Avvia Creazione Guidata Progetto (Wizard 5 Passi)',
        shortcut: 'Ctrl+Shift+N',
        run: () => setWizardOpen(true),
      },
      {
        id: 'cmd-hub',
        category: 'Progetto',
        label: '🏠 Apri Schermata Iniziale Progetti',
        run: () => setShowProjectHub(true),
      },
      {
        id: 'cmd-quick-freeform',
        category: 'Progetto',
        label: '📐 Nuovo Progetto Tela Posizionamento Libero (stile Canva)',
        shortcut: 'Ctrl+N',
        run: () => createQuickFreeformProject(),
      },
      {
        id: 'cmd-split-css',
        category: 'Area di Lavoro',
        label: '💅 Affianca Design + Editor CSS Bidirezionale',
        shortcut: 'Ctrl+2',
        run: () => applyLayoutPreset('split-css'),
      },
      {
        id: 'cmd-split-code',
        category: 'Area di Lavoro',
        label: '💻 Affianca Design + Codice Multi-Target',
        shortcut: 'Ctrl+3',
        run: () => applyLayoutPreset('split-code'),
      },
      {
        id: 'cmd-split-blueprint',
        category: 'Logica & 3D',
        label: '⚡ Apri Editor Grafo Blueprint (stile Unreal Engine)',
        shortcut: 'Ctrl+4',
        run: () => applyLayoutPreset('split-blueprint'),
      },
      {
        id: 'cmd-split-script',
        category: 'Logica & 3D',
        label: '📜 Apri Workbench Script TypeScript / JavaScript',
        shortcut: 'Ctrl+5',
        run: () => applyLayoutPreset('split-script'),
      },
      {
        id: 'cmd-three-studio',
        category: 'Logica & 3D',
        label: '🧊 Apri Three.js 3D Visual Studio',
        shortcut: 'Ctrl+6',
        run: () => applyLayoutPreset('three-studio'),
      },
      {
        id: 'cmd-split-preview',
        category: 'Area di Lavoro',
        label: '▶ Affianca Design + Anteprima Live Sandbox',
        shortcut: 'Ctrl+7',
        run: () => applyLayoutPreset('split-preview'),
      },
      {
        id: 'cmd-canvas-only',
        category: 'Area di Lavoro',
        label: '🎨 Solo Design Canvas',
        shortcut: 'Ctrl+1',
        run: () => applyLayoutPreset('canvas'),
      },
      {
        id: 'cmd-freeform-mode',
        category: 'Design',
        label: 'Passa a Posizionamento Libero (X, Y)',
        run: () => setCanvasPlacementMode('freeform'),
      },
      {
        id: 'cmd-autolayout-solve',
        category: 'Design',
        label: 'Converti Contenitore in Auto-Layout (Flex/Grid)',
        run: () => solveAutoLayoutOnActive(),
      },
      {
        id: 'cmd-console',
        category: 'Visualizza',
        label: 'Mostra / Nascondi Console Inferiore',
        shortcut: 'Ctrl+J',
        run: () => setBottomConsoleOpen(!bottomConsoleOpen),
      },
      {
        id: 'cmd-import-code',
        category: 'Strumenti',
        label: 'Importa Codice HTML / Tailwind / JSX / SVG nel Canvas',
        shortcut: 'Ctrl+I',
        run: () => setImportCodeModalOpen(true),
      },
      {
        id: 'cmd-wcag',
        category: 'Strumenti',
        label: 'Audit Accessibilità WCAG 2.2 AA & Auto-Fix',
        run: () => setA11yModalOpen(true),
      },
      {
        id: 'cmd-unsloth',
        category: 'AI Locale',
        label: 'Apri Unsloth Hub & Esporta Dataset LoRA',
        run: () => setUnslothModalOpen(true),
      },
      {
        id: 'cmd-export-disk',
        category: 'Esporta',
        label: 'Esporta Scaffold Progetto Completo su Disco',
        shortcut: 'Ctrl+Shift+E',
        run: () => {
          if (activeSheetId) void exportProjectScaffold(activeSheetId, globalTarget, globalDialect);
        },
      },
      {
        id: 'cmd-theme',
        category: 'Visualizza',
        label: `Cambia Tema Studio (${studioTheme === 'dark' ? 'Passa a Chiaro' : 'Passa a Scuro'})`,
        run: () => setStudioTheme(studioTheme === 'dark' ? 'light' : 'dark'),
      },
    ];

    const fileItems: PaletteActionItem[] = vfsTree
      .filter((n) => n.entryKind !== 'folder')
      .map((node) => ({
        id: `vfs-${node.id}`,
        category: 'File VFS',
        label: `📄 Apri File: ${node.virtualPath || node.name}`,
        run: () => openVfsNode(node),
      }));

    const targetItems: PaletteActionItem[] = targets.map((t) => ({
      id: `target-${t.id}`,
      category: 'Target 26 GUI',
      label: `Compila verso: ${t.displayName} (${t.fileExtension})`,
      run: () => {
        void setGlobalTarget(t.id);
        applyLayoutPreset('split-code');
      },
    }));

    const all = [...core, ...fileItems, ...targetItems];
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 32);
    return all.filter(
      (it) =>
        it.label.toLowerCase().includes(q) ||
        it.category.toLowerCase().includes(q) ||
        (it.shortcut ?? '').toLowerCase().includes(q),
    );
  }, [
    query,
    vfsTree,
    targets,
    activeSheetId,
    globalTarget,
    globalDialect,
    studioTheme,
    bottomConsoleOpen,
    setWizardOpen,
    setShowProjectHub,
    createQuickFreeformProject,
    applyLayoutPreset,
    setCanvasPlacementMode,
    solveAutoLayoutOnActive,
    setBottomConsoleOpen,
    setImportCodeModalOpen,
    setA11yModalOpen,
    setUnslothModalOpen,
    exportProjectScaffold,
    setStudioTheme,
    openVfsNode,
    setGlobalTarget,
  ]);

  if (shortcutsHelpOpen) {
    return (
      <div
        className="modal-backdrop"
        style={{ zIndex: 150 }}
        onClick={() => setShortcutsHelpOpen(false)}
      >
        <div
          className="cmd-palette-card"
          data-testid="shortcuts-help-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              padding: '12px 16px',
              background: 'var(--bg-header)',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Keyboard size={16} color="var(--accent-primary)" />
              <strong>Guida rapida e scorciatoie</strong>
            </div>
            <button type="button" className="studio-btn sm" onClick={() => setShortcutsHelpOpen(false)}>
              <X size={13} />
            </button>
          </div>
          <div style={{ padding: 16, overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              ['Ctrl + Shift + P / Ctrl + K', 'Apri Palette Comandi Universale'],
              ['Ctrl + 1 .. Ctrl + 7', 'Cambia vista (Design, CSS, Codice, Blueprint, Script, 3D, Preview)'],
              ['Ctrl + J', 'Mostra / Nascondi Console Inferiore'],
              ['Ctrl + Z / Ctrl + Y', 'Annulla / Ripeti modifica sul Canvas'],
              ['Ctrl + C / Ctrl + V / Ctrl + D', 'Copia / Incolla / Duplica nodi'],
              ['Frecce / Shift + Frecce', 'Sposta nodo selezionato di 1px / 8px'],
              ['Spazio + Trascina Mouse', 'Panoramica libera sulla tela infinita'],
              ['Ctrl + S', 'Salva progetto e crea Checkpoint SQLite'],
            ].map(([keys, desc]) => (
              <div
                key={keys}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-panel)',
                }}
              >
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--accent-primary)', fontWeight: 700 }}>
                  {keys}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!commandPaletteOpen) return null;

  const executeItem = (item: PaletteActionItem | undefined) => {
    if (!item) return;
    setCommandPaletteOpen(false);
    void item.run();
  };

  return (
    <div
      className="modal-backdrop"
      style={{ alignItems: 'flex-start', paddingTop: '9vh', zIndex: 150 }}
      onClick={() => setCommandPaletteOpen(false)}
    >
      <div
        className="cmd-palette-card"
        data-testid="command-palette-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '10px 14px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-header)',
          }}
        >
          <Search size={15} color="var(--accent-primary)" />
          <input
            className="studio-input"
            data-testid="command-palette-input"
            style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 13, padding: '2px 0' }}
            autoFocus
            placeholder="Digita un comando, nome file VFS o target (es. Blueprint, Three.js, Svelte, CSS)..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setCommandPaletteOpen(false);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIdx((i) => Math.min(Math.max(0, items.length - 1), i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIdx((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                executeItem(items[selectedIdx]);
              }
            }}
          />
          <button type="button" className="studio-btn sm" onClick={() => setCommandPaletteOpen(false)}>
            <X size={12} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
          {items.length === 0 ? (
            <div style={{ padding: 18, textAlign: 'center', color: 'var(--text-muted)' }}>
              Nessun comando o file corrispondente a &ldquo;{query}&rdquo;.
            </div>
          ) : (
            items.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                className={`cmd-palette-item ${idx === selectedIdx ? 'active' : ''}`}
                data-testid={`cmd-item-${item.id}`}
                onMouseEnter={() => setSelectedIdx(idx)}
                onClick={() => executeItem(item)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  {item.category === 'File VFS' ? (
                    <FileCode2 size={13} color="var(--accent-amber)" />
                  ) : item.category === 'Progetto' ? (
                    <Wand2 size={13} color="var(--accent-violet)" />
                  ) : item.category === 'Target 26 GUI' ? (
                    <Sparkles size={13} color="var(--accent-emerald)" />
                  ) : (
                    <Command size={13} color="var(--accent-primary)" />
                  )}
                  <span className="badge">{item.category}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.label}
                  </span>
                </div>
                {item.shortcut && <span className="menubar-shortcut">{item.shortcut}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
