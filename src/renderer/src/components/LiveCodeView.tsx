import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  Edit3,
  FileCode,
  FolderDown,
  Layers,
  Package,
  Palette,
  RefreshCw,
  Rocket,
  Save,
  Undo2,
} from 'lucide-react';
import { parseCssEditsToPatchOps } from '@shared/css-sync-engine';
import type { CodeSourceMapSpan, CodegenTargetId, NodeId, StylingDialect } from '@shared/ui-ir';
import {
  applyCodeDrafts, bundleCacheKey, bundleWithCodeOverrides, codeDraftKey, codeOverrideKey,
  useStudioStore, type WorkspaceTab,
} from '@renderer/state/studio-store';

const EDIT_LINE_HEIGHT_PX = 19;

export const LiveCodeView: React.FC<{ groupId: string; tab: WorkspaceTab }> = ({ groupId, tab }) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedFromCodeRef = useRef<NodeId | null>(null);

  const targets = useStudioStore((s) => s.targets);
  const projectId = useStudioStore((s) => s.project?.id ?? '');
  const activeSheetId = useStudioStore((s) => s.activeSheetId);
  const sheetDocuments = useStudioStore((s) => s.sheetDocuments);
  const selectedNodeIds = useStudioStore((s) => s.selectedNodeIds);
  const hoveredNodeId = useStudioStore((s) => s.hoveredNodeId);
  const compiledBundles = useStudioStore((s) => s.compiledBundles);
  const compilingKeys = useStudioStore((s) => s.compilingKeys);

  const updateCodeTabTarget = useStudioStore((s) => s.updateCodeTabTarget);
  const updateCodeTabActiveFile = useStudioStore((s) => s.updateCodeTabActiveFile);
  const compileSheetForTarget = useStudioStore((s) => s.compileSheetForTarget);
  const setCodeDraft = useStudioStore((s) => s.setCodeDraft);
  const saveCodeDrafts = useStudioStore((s) => s.saveCodeDrafts);
  const saveBundleToDisk = useStudioStore((s) => s.saveBundleToDisk);
  const exportProjectScaffold = useStudioStore((s) => s.exportProjectScaffold);
  const selectNode = useStudioStore((s) => s.selectNode);
  const selectNodeFromCode = useStudioStore((s) => s.selectNodeFromCode);
  const setHoveredNode = useStudioStore((s) => s.setHoveredNode);
  const openTabInGroup = useStudioStore((s) => s.openTabInGroup);
  const commitOps = useStudioStore((s) => s.commitOps);
  const pushToast = useStudioStore((s) => s.pushToast);

  const sheetId = tab.sheetId || activeSheetId;
  const sheet = sheetDocuments[sheetId];
  const sheetName = sheet?.name ?? 'HomeDashboard';
  const targetId: CodegenTargetId = tab.targetId ?? 'react-tsx';
  const targetMeta = targets.find((t) => t.id === targetId) ?? targets[0];
  const dialect: StylingDialect =
    tab.dialect && targetMeta?.supportedDialects.includes(tab.dialect)
      ? tab.dialect
      : targetMeta?.defaultDialect ?? 'tailwind';

  const cacheKey = bundleCacheKey(sheetId, targetId, dialect);
  const draftKey = codeDraftKey(projectId, sheetId, targetId, dialect);
  const drafts = useStudioStore((s) => s.codeDrafts[draftKey]);
  const generated = compiledBundles[cacheKey];
  const savedOverrides = sheet?.codeOverrides?.[codeOverrideKey(targetId, dialect)];
  const overrides = useMemo(() => applyCodeDrafts(savedOverrides, drafts), [savedOverrides, drafts]);
  const bundle = useMemo(() => generated && bundleWithCodeOverrides(generated, overrides), [generated, overrides]);
  const isCompiling = Boolean(compilingKeys[cacheKey]);

  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copiedMode, setCopiedMode] = useState<string | null>(null);
  const [isExportingScaffold, setIsExportingScaffold] = useState(false);

  useEffect(() => {
    if (sheetId && !generated && !isCompiling) {
      void compileSheetForTarget(sheetId, targetId, dialect);
    }
  }, [sheetId, targetId, dialect, generated, isCompiling, compileSheetForTarget]);

  const activeFile = useMemo(() => {
    if (!bundle || bundle.files.length === 0) return null;
    if (tab.activeFilePath) {
      const found = bundle.files.find((f) => f.relativePath === tab.activeFilePath);
      if (found) return found;
    }
    return bundle.files.find((f) => f.isEntry) ?? bundle.files[0];
  }, [bundle, tab.activeFilePath]);

  const activeCode = activeFile?.code ?? '';
  const hasDrafts = Boolean(drafts && Object.keys(drafts).length > 0);
  const activePath = activeFile?.relativePath ?? '';
  const activeGeneratedFile = generated?.files.find((file) => file.relativePath === activePath);
  const activeHasOverride = Object.hasOwn(overrides, activePath);
  const activeHasDraft = Boolean(drafts && Object.hasOwn(drafts, activePath));
  const codeLines = useMemo(() => activeCode.split('\n'), [activeCode]);

  const updateCode = (code: string) => {
    if (!activeFile) return;
    const savedCode = savedOverrides?.[activePath] ?? activeGeneratedFile?.code;
    setCodeDraft(draftKey, activePath, code === savedCode ? undefined : code);
  };

  const handleSave = async (writeBundle = false) => {
    if (saving) return;
    setSaving(true);
    try {
      if (await saveCodeDrafts(sheetId, targetId, dialect) && writeBundle && bundle) {
        await saveBundleToDisk(bundle);
      }
    } finally {
      setSaving(false);
    }
  };

  const selectedNodeId = selectedNodeIds[0] ?? null;

  // Compute highlighted line range from SourceMap for selected Canvas node
  const selectedSpan = useMemo(() => {
    if (!activeFile || !selectedNodeId) return null;
    const matches = activeFile.sourceMap.filter((s) => s.canvasNodeId === selectedNodeId);
    if (matches.length === 0) return null;
    return matches.sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine))[0];
  }, [activeFile, selectedNodeId]);

  const hoveredSpan = useMemo(() => {
    if (!activeFile || !hoveredNodeId || hoveredNodeId === selectedNodeId) return null;
    const matches = activeFile.sourceMap.filter((s) => s.canvasNodeId === hoveredNodeId);
    if (matches.length === 0) return null;
    return matches.sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine))[0];
  }, [activeFile, hoveredNodeId, selectedNodeId]);

  // Smoothly scroll highlighted code lines into center when an element is clicked on the Canvas
  useEffect(() => {
    if (!selectedSpan) return;
    if (selectedFromCodeRef.current === selectedNodeId) {
      selectedFromCodeRef.current = null;
      return;
    }

    if (!editMode && scrollContainerRef.current) {
      const el = scrollContainerRef.current.querySelector(`[data-line="${selectedSpan.startLine}"]`);
      if (el && 'scrollIntoView' in el) {
        (el as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    } else if (editMode && textareaRef.current) {
      const ta = textareaRef.current;
      const targetScroll = Math.max(
        0,
        (selectedSpan.startLine - 1) * EDIT_LINE_HEIGHT_PX - ta.clientHeight / 2 + 24,
      );
      ta.scrollTop = targetScroll;
    }
  }, [selectedSpan, selectedNodeId, editMode]);

  const copyToClipboard = async (text: string, modeLabel: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedMode(modeLabel);
    pushToast('success', `${modeLabel} copiato negli appunti (${text.split('\n').length} righe)!`);
    setTimeout(() => setCopiedMode(null), 1800);
  };

  const handleCopySnippet = () => {
    if (!activeFile) return;
    if (selectedSpan) {
      const slice = codeLines.slice(Math.max(0, selectedSpan.startLine - 1), selectedSpan.endLine).join('\n');
      void copyToClipboard(slice || activeCode, 'Snippet Nodo');
    } else {
      void copyToClipboard(activeCode, 'Snippet');
    }
  };

  const handleCopyComponent = () => {
    if (!activeFile) return;
    void copyToClipboard(activeCode, 'Componente');
  };

  const handleCopyMultiFileBundle = () => {
    if (!bundle) return;
    const combined = bundle.files
      .map(
        (f) =>
          `// ============================================================\n// FILE: ${f.relativePath} (${f.language})\n// ============================================================\n${f.code}`,
      )
      .join('\n\n');
    void copyToClipboard(combined, 'Bundle Multi-File');
  };

  // Pick the innermost / smallest span (`endLine - startLine`) containing `lineNum`
  const findInnermostSpan = (lineNum: number): CodeSourceMapSpan | null => {
    if (!activeFile) return null;
    const containing = activeFile.sourceMap.filter(
      (s) => lineNum >= s.startLine && lineNum <= s.endLine,
    );
    if (containing.length === 0) return null;
    return containing.sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine))[0];
  };

  const handleLineClick = (lineNum: number) => {
    const tightest = findInnermostSpan(lineNum);
    if (tightest) {
      selectedFromCodeRef.current = tightest.canvasNodeId;
      selectNode(tightest.canvasNodeId);
      selectNodeFromCode(tightest.canvasNodeId);
    }
  };

  const handleTextareaCaretSync = (el: HTMLTextAreaElement) => {
    const caretOffset = el.selectionStart ?? 0;
    const lineNum = 1 + el.value.slice(0, caretOffset).split('\n').length - 1;
    handleLineClick(lineNum);
  };

  const handleSwitchToCss = () => {
    openTabInGroup(
      {
        kind: 'css',
        title: `CSS: ${sheetName}`,
        sheetId,
      },
      groupId,
    );
  };

  const handleSyncEditedCssFile = async () => {
    if (!sheet || !activeFile || activeFile.language !== 'css') return;
    const parsed = parseCssEditsToPatchOps(activeCode, sheet, selectedNodeId);
    if (parsed.ops.length > 0) {
      await commitOps(parsed.ops, 'Sincronizza file CSS -> Canvas', 'code_sync', sheetId);
      pushToast('success', `Applicate ${parsed.ops.length} modifiche dal file CSS al Canvas!`);
    } else {
      pushToast('info', 'Nessuna regola CSS modificata rilevata.');
    }
  };

  return (
    <div className="code-sheet-container" data-testid="live-code-sheet">
      {/* Top Target, Dialect, CSS Jump & 4-Mode Smart Copy Toolbar */}
      <div className="code-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Code2 size={14} color="var(--accent-primary)" />
          <select
            className="studio-select"
            data-testid="code-target-select"
            value={targetId}
            onChange={(e) => updateCodeTabTarget(groupId, tab.id, e.target.value as CodegenTargetId)}
            style={{ fontWeight: 600, height: 26 }}
          >
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                [Tier {t.tier}] {t.displayName}
              </option>
            ))}
          </select>

          <select
            className="studio-select"
            data-testid="code-dialect-select"
            value={dialect}
            onChange={(e) =>
              updateCodeTabTarget(groupId, tab.id, targetId, e.target.value as StylingDialect)
            }
            style={{ height: 26 }}
          >
            {(targetMeta?.supportedDialects ?? ['tailwind', 'vanilla-css']).map((d) => (
              <option key={d} value={d}>
                Stile: {d}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="studio-btn sm"
            onClick={() => void compileSheetForTarget(sheetId, targetId, dialect)}
            title="Ricompila foglio"
          >
            <RefreshCw size={12} />
          </button>

          <button
            type="button"
            className={`studio-btn sm ${editMode ? 'active' : ''}`}
            data-testid="btn-toggle-code-edit"
            onClick={() => setEditMode((v) => !v)}
            title="Modifica il file selezionato"
            aria-pressed={editMode}
          >
            <Edit3 size={12} />
            <span>{editMode ? 'Vista SourceMap' : 'Modifica'}</span>
          </button>

          {(editMode || hasDrafts) && (
            <button
              type="button"
              className="studio-btn sm"
              data-testid="btn-save-code-edits"
              disabled={!hasDrafts || saving}
              onClick={() => void handleSave()}
              title="Salva le modifiche nel foglio (Ctrl+S)"
            >
              <Save size={12} />
              <span>Salva modifiche</span>
            </button>
          )}
          {editMode && (activeHasDraft || activeHasOverride) && activeGeneratedFile && (
            <button
              type="button"
              className="studio-btn sm"
              data-testid="btn-reset-generated-code"
              onClick={() => setCodeDraft(
                draftKey, activePath, savedOverrides && Object.hasOwn(savedOverrides, activePath) ? null : undefined,
              )}
              title="Ripristina il codice generato per questo file. Salva per confermare."
            >
              <Undo2 size={12} />
              <span>Ripristina generato</span>
            </button>
          )}

          {/* Quick Jump to Bidirectional CSS Editor */}
          <button
            type="button"
            className="studio-btn sm violet"
            data-testid="btn-switch-to-css"
            onClick={handleSwitchToCss}
            title="Apri l'Editor CSS Live bidirezionale per questo foglio"
          >
            <Palette size={12} />
            <span>💅 Passa a CSS</span>
          </button>

          {editMode && activeFile?.language === 'css' && (
            <button
              type="button"
              className="studio-btn sm primary"
              onClick={() => void handleSyncEditedCssFile()}
              title="Applica le modifiche CSS di questo file direttamente ai nodi del Canvas"
            >
              <Check size={12} />
              <span>Applica CSS al Canvas</span>
            </button>
          )}
        </div>

        {/* 4-Mode Smart Copy & Disk Export */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="studio-btn sm"
            data-testid="btn-copy-snippet"
            onClick={handleCopySnippet}
            disabled={!activeFile}
          >
            {copiedMode === 'Snippet Nodo' || copiedMode === 'Snippet' ? <Check size={12} /> : <Copy size={12} />}
            <span>Copia Snippet</span>
          </button>

          <button
            type="button"
            className="studio-btn sm"
            data-testid="btn-copy-component"
            onClick={handleCopyComponent}
            disabled={!activeFile}
          >
            {copiedMode === 'Componente' ? <Check size={12} /> : <Layers size={12} />}
            <span>Copia Componente</span>
          </button>

          <button
            type="button"
            className="studio-btn sm"
            data-testid="btn-copy-bundle"
            onClick={handleCopyMultiFileBundle}
            disabled={!bundle}
          >
            {copiedMode === 'Bundle Multi-File' ? <Check size={12} /> : <Package size={12} />}
            <span>Copia Bundle Multi-File</span>
          </button>

          <button
            type="button"
            className="studio-btn sm"
            data-testid="btn-save-bundle-disk"
            onClick={() => void handleSave(true)}
            disabled={!bundle || saving}
            title="Salva i file del bundle con le modifiche correnti"
          >
            <FolderDown size={12} />
            <span>Salva Bundle</span>
          </button>

          <button
            type="button"
            className="studio-btn sm primary"
            data-testid="btn-export-scaffold"
            disabled={isExportingScaffold}
            onClick={() => {
              setIsExportingScaffold(true);
              void exportProjectScaffold(sheetId, targetId, dialect).finally(() =>
                setIsExportingScaffold(false),
              );
            }}
            title="Compila in modalità Scaffold ed esporta su disco l'intero progetto eseguibile (package.json / Cargo.toml / .csproj / CMakeLists.txt / app.py)"
          >
            <Rocket size={12} />
            <span>📦 Esporta Progetto</span>
          </button>
        </div>
      </div>

      {/* Multi-File Bundle Switcher Bar + Active SourceMap Breadcrumb */}
      {bundle && bundle.files.length > 0 && (
        <div
          className="bundle-files-bar"
          data-testid="bundle-files-switcher"
          style={{ justifyContent: 'space-between' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflowX: 'auto' }}>
            {bundle.files.map((f) => {
              const isAct = activeFile?.relativePath === f.relativePath;
              return (
                <button
                  key={f.relativePath}
                  type="button"
                  className={`studio-btn sm ${isAct ? 'active' : 'ghost'}`}
                  data-testid={`bundle-file-${f.relativePath}`}
                  onClick={() => updateCodeTabActiveFile(groupId, tab.id, f.relativePath)}
                >
                  <FileCode size={12} />
                  <span>{f.relativePath}{Object.hasOwn(drafts ?? {}, f.relativePath) ? ' •' : ''}</span>
                  <span className="badge">{f.language}</span>
                </button>
              );
            })}
          </div>

          {activeHasOverride ? (
            <span className="badge" title="Questo file usa il codice personalizzato per copia ed esportazione">
              Codice personalizzato
            </span>
          ) : selectedSpan && selectedNodeId && sheet?.nodes[selectedNodeId] && (
            <span className="badge blue" style={{ flexShrink: 0 }}>
              🔗 {sheet.nodes[selectedNodeId].name} (righe {selectedSpan.startLine}–{selectedSpan.endLine})
            </span>
          )}
        </div>
      )}

      {/* Code Output Body */}
      {isCompiling && !bundle ? (
        <div style={{ padding: 20, color: 'var(--text-secondary)' }}>
          Compilazione UI-IR verso <strong>{targetMeta?.displayName}</strong> in corso...
        </div>
      ) : editMode && activeFile ? (
        <textarea
          ref={textareaRef}
          className="studio-textarea"
          data-testid="code-editable-textarea"
          spellCheck={false}
          style={{
            flex: 1,
            width: '100%',
            border: 'none',
            borderRadius: 0,
            fontFamily: "'JetBrains Mono', Consolas, monospace",
            fontSize: 12,
            lineHeight: `${EDIT_LINE_HEIGHT_PX}px`,
            padding: 14,
            resize: 'none',
            background: 'var(--code-bg)',
          }}
          value={activeCode}
          aria-label={`Modifica ${activePath}`}
          onChange={(e) => updateCode(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
              e.preventDefault();
              e.stopPropagation();
              void handleSave();
            }
          }}
          onClick={(e) => handleTextareaCaretSync(e.currentTarget)}
          onKeyUp={(e) => handleTextareaCaretSync(e.currentTarget)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const relY = e.clientY - rect.top + e.currentTarget.scrollTop - 14;
            const lineNum = Math.max(1, Math.floor(relY / EDIT_LINE_HEIGHT_PX) + 1);
            const sp = findInnermostSpan(lineNum);
            setHoveredNode(sp?.canvasNodeId ?? null);
          }}
          onMouseLeave={() => setHoveredNode(null)}
        />
      ) : (
        <div
          ref={scrollContainerRef}
          className="code-lines-scroll"
          data-testid="code-viewer-output"
          onMouseLeave={() => setHoveredNode(null)}
        >
          {codeLines.map((line, idx) => {
            const lineNum = idx + 1;
            const isHighlighted =
              selectedSpan !== null &&
              lineNum >= selectedSpan.startLine &&
              lineNum <= selectedSpan.endLine;
            const isHoveredLine =
              hoveredSpan !== null &&
              lineNum >= hoveredSpan.startLine &&
              lineNum <= hoveredSpan.endLine;
            const spanAtLine = findInnermostSpan(lineNum);

            return (
              <div
                key={lineNum}
                data-line={lineNum}
                className={`code-line ${isHighlighted ? 'highlighted' : ''}`}
                style={
                  !isHighlighted && isHoveredLine
                    ? {
                        background: 'rgba(139, 92, 246, 0.12)',
                        borderLeftColor: 'var(--accent-violet)',
                      }
                    : undefined
                }
                onClick={() => handleLineClick(lineNum)}
                onMouseEnter={() => setHoveredNode(spanAtLine?.canvasNodeId ?? null)}
              >
                <span className="code-line-num">{lineNum}</span>
                <span className="code-line-text">{line || ' '}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Diagnostics Footer */}
      {bundle && bundle.diagnostics.length > 0 && (
        <div
          style={{
            padding: '5px 12px',
            borderTop: '1px solid var(--border-subtle)',
            background: 'var(--bg-header)',
            fontSize: 11,
            color: 'var(--accent-amber)',
          }}
        >
          ℹ️ {bundle.diagnostics.map((d) => d.message).join(' • ')}
        </div>
      )}
    </div>
  );
};
