import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  FileCode2,
  Palette,
  RefreshCw,
  Sparkles,
  Target,
  Wand2,
} from 'lucide-react';
import {
  CSS_QUICK_SNIPPETS,
  compileSheetToCss,
  parseCssEditsToPatchOps,
  type CssQuickSnippet,
} from '@shared/css-sync-engine';
import type { CodeDiagnostic, CodeSourceMapSpan, InteractiveStateKey, NodeId } from '@shared/ui-ir';
import { useStudioStore } from '@renderer/state/studio-store';

export interface CssLiveEditorViewProps {
  sheetId?: string;
  groupId?: string;
  vfsEntryId?: string;
}

const LINE_HEIGHT_PX = 20;
const EDITOR_PAD_TOP = 10;

const STATE_TABS: Array<{ id: 'base' | InteractiveStateKey; label: string }> = [
  { id: 'base', label: 'Base' },
  { id: 'hover', label: ':hover' },
  { id: 'active', label: ':active' },
  { id: 'focus', label: ':focus' },
  { id: 'focus-visible', label: ':focus-visible' },
  { id: 'disabled', label: ':disabled' },
];

function computeLiveCssSpans(
  cssText: string,
  selectorToNodeId: Record<string, NodeId>,
  fallbackMap: CodeSourceMapSpan[],
): CodeSourceMapSpan[] {
  const lines = cssText.split('\n');
  const spans: CodeSourceMapSpan[] = [];
  let pendingNodeId: NodeId | null = null;
  let blockStartLine = 0;
  let currentBlockNodeId: NodeId | null = null;
  let braceDepth = 0;

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1;
    const raw = lines[idx];
    const nodeComment = raw.match(/\/\*\s*@node\s+([a-zA-Z0-9_-]+)/);
    if (nodeComment && braceDepth === 0) {
      pendingNodeId = nodeComment[1];
      blockStartLine = lineNum;
      continue;
    }

    if (braceDepth === 0 && raw.includes('{')) {
      const selPart = raw.slice(0, raw.indexOf('{')).trim();
      if (!selPart.startsWith('@keyframes')) {
        const baseSel = selPart.replace(/:(hover|active|focus-visible|focus|disabled)$/i, '').trim();
        const resolvedId =
          pendingNodeId ??
          selectorToNodeId[baseSel] ??
          (baseSel.startsWith('#') ? baseSel.slice(1) : undefined) ??
          null;
        if (resolvedId) {
          currentBlockNodeId = resolvedId;
          if (!blockStartLine) blockStartLine = lineNum;
        }
      }
      pendingNodeId = null;
    }

    for (const ch of raw) {
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
    }

    if (braceDepth === 0 && currentBlockNodeId && raw.includes('}')) {
      const prev = spans[spans.length - 1];
      if (prev && prev.canvasNodeId === currentBlockNodeId && blockStartLine <= prev.endLine + 2) {
        prev.endLine = lineNum;
      } else {
        spans.push({
          canvasNodeId: currentBlockNodeId,
          startLine: blockStartLine || lineNum,
          startCol: 1,
          endLine: lineNum,
          endCol: raw.length + 1,
        });
      }
      currentBlockNodeId = null;
      blockStartLine = 0;
    }
  }

  return spans.length > 0 ? spans : fallbackMap;
}

export const CssLiveEditorView: React.FC<CssLiveEditorViewProps> = ({ sheetId, vfsEntryId }) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isFocusedRef = useRef<boolean>(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedFromCssRef = useRef<NodeId | null>(null);
  const latestDesignDraftRef = useRef('');
  const designDirtyRef = useRef(false);

  const project = useStudioStore((s) => s.project);
  const activeSheetId = useStudioStore((s) => s.activeSheetId);
  const sheetDocuments = useStudioStore((s) => s.sheetDocuments);
  const tokens = useStudioStore((s) => s.tokens);
  const selectedNodeIds = useStudioStore((s) => s.selectedNodeIds);
  const hoveredNodeId = useStudioStore((s) => s.hoveredNodeId);
  const simulatedCanvasState = useStudioStore((s) => s.simulatedCanvasState);
  const savedFile = useStudioStore((s) => vfsEntryId ? s.sourceFiles[vfsEntryId] : undefined);
  const fileDraft = useStudioStore((s) => vfsEntryId ? s.sourceDrafts[vfsEntryId] : undefined);

  const commitOps = useStudioStore((s) => s.commitOps);
  const selectNodeFromCode = useStudioStore((s) => s.selectNodeFromCode);
  const setHoveredNode = useStudioStore((s) => s.setHoveredNode);
  const setSimulatedCanvasState = useStudioStore((s) => s.setSimulatedCanvasState);
  const setSourceDraft = useStudioStore((s) => s.setSourceDraft);
  const saveSourceDraft = useStudioStore((s) => s.saveSourceDraft);
  const pushToast = useStudioStore((s) => s.pushToast);

  const effectiveSheetId = sheetId || activeSheetId;
  const sheet = sheetDocuments[effectiveSheetId];
  const selectedNodeId = selectedNodeIds[0] ?? sheet?.rootIds[0] ?? null;
  const selectedNode = sheet && selectedNodeId ? sheet.nodes[selectedNodeId] : undefined;

  const [scope, setScope] = useState<'sheet' | 'selected'>('sheet');
  const [activeState, setActiveState] = useState<'base' | InteractiveStateKey>('base');
  const [designDraft, setDesignDraft] = useState('');
  const [designDirty, setDesignDirty] = useState(false);
  const [diagnostics, setDiagnostics] = useState<CodeDiagnostic[]>([]);
  const [copied, setCopied] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const editingFile = Boolean(vfsEntryId && scope === 'sheet');
  const draftCss = editingFile ? fileDraft?.content ?? savedFile ?? '' : designDraft;
  const isDirty = editingFile ? Boolean(fileDraft) : designDirty;

  const updateDesignDraft = (content: string, dirty: boolean) => {
    latestDesignDraftRef.current = content;
    designDirtyRef.current = dirty;
    setDesignDraft(content);
    setDesignDirty(dirty);
  };

  const stageDraft = (content: string) => {
    if (editingFile && vfsEntryId) {
      const baseContent = fileDraft?.baseContent ?? savedFile ?? '';
      setSourceDraft(vfsEntryId, { content, baseContent });
    } else {
      updateDesignDraft(content, true);
    }
  };

  const compiled = useMemo(() => {
    if (!sheet) return null;
    const baseCompiled = compileSheetToCss(sheet, tokens, project?.activeThemeId ?? null, {
      scope,
      selectedNodeId,
      activeState,
    });

    if (scope === 'sheet' && activeState !== 'base' && selectedNodeId && sheet.nodes[selectedNodeId]) {
      const sel = baseCompiled.nodeIdToSelector[selectedNodeId] ?? `#${selectedNodeId}`;
      const pseudoHeader = `${sel}:${activeState}`;
      if (!baseCompiled.css.includes(pseudoHeader)) {
        const appended = `${baseCompiled.css.trimEnd()}\n\n/* @node ${selectedNodeId} (${sheet.nodes[selectedNodeId].name} ${activeState}) */\n${pseudoHeader} {\n  /* Aggiungi dichiarazioni :${activeState} qui */\n}\n`;
        return { ...baseCompiled, css: appended };
      }
    }

    return baseCompiled;
  }, [sheet, tokens, project?.activeThemeId, scope, selectedNodeId, activeState]);

  useEffect(() => {
    if (!compiled) return;
    if (!isFocusedRef.current && !designDirtyRef.current) {
      updateDesignDraft(compiled.css, false);
      setDiagnostics([]);
    }
  }, [compiled]);

  useEffect(() => {
    if (!compiled) return;
    isFocusedRef.current = false;
    updateDesignDraft(compiled.css, false);
    setDiagnostics([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, activeState, scope === 'selected' ? selectedNodeId : null]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  const liveSpans = useMemo(() => {
    if (!compiled) return [];
    return computeLiveCssSpans(draftCss, compiled.selectorToNodeId, compiled.sourceMap);
  }, [draftCss, compiled]);

  const cssLines = useMemo(() => draftCss.split('\n'), [draftCss]);

  const selectedSpan = useMemo(() => {
    if (!selectedNodeId) return null;
    const matches = liveSpans.filter((s) => s.canvasNodeId === selectedNodeId);
    if (matches.length === 0) return null;
    return matches.sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine))[0];
  }, [liveSpans, selectedNodeId]);

  const hoveredSpan = useMemo(() => {
    if (!hoveredNodeId || hoveredNodeId === selectedNodeId) return null;
    return liveSpans.find((s) => s.canvasNodeId === hoveredNodeId) ?? null;
  }, [liveSpans, hoveredNodeId, selectedNodeId]);

  useEffect(() => {
    if (!selectedSpan || !scrollContainerRef.current) return;
    if (selectedFromCssRef.current === selectedNodeId) {
      selectedFromCssRef.current = null;
      return;
    }
    const targetTop = Math.max(0, EDITOR_PAD_TOP + (selectedSpan.startLine - 3) * LINE_HEIGHT_PX);
    if (typeof scrollContainerRef.current.scrollTo === 'function') {
      scrollContainerRef.current.scrollTo({ top: targetTop, behavior: 'smooth' });
    } else {
      scrollContainerRef.current.scrollTop = targetTop;
    }
  }, [selectedNodeId, selectedSpan]);

  if (!sheet || !compiled) {
    return (
      <div data-testid="css-live-editor" style={{ flex: 1, padding: 20, color: 'var(--text-secondary)' }}>
        Caricamento Foglio Stili CSS...
      </div>
    );
  }

  const findSpanAtLine = (lineNum: number): CodeSourceMapSpan | null => {
    const matches = liveSpans.filter((s) => lineNum >= s.startLine && lineNum <= s.endLine);
    if (matches.length === 0) return null;
    return matches.sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine))[0];
  };

  const applyCssChangesToCanvas = async (cssToParse: string, explicitToast: boolean) => {
    const fallbackTarget = scope === 'selected' ? selectedNodeId : null;
    const state = useStudioStore.getState();
    if (state.project?.id !== project?.id) return;
    const currentSheet = state.sheetDocuments[effectiveSheetId];
    if (!currentSheet) return;
    const parsed = parseCssEditsToPatchOps(cssToParse, currentSheet, fallbackTarget);
    setDiagnostics(parsed.diagnostics);
    if (parsed.diagnostics.some((item) => item.severity === 'error') || (!explicitToast && parsed.diagnostics.length)) return;

    try {
      let saved = false;
      if (editingFile && vfsEntryId) {
        const currentDraft = state.sourceDrafts[vfsEntryId];
        if (currentDraft) {
          if (currentDraft.content !== cssToParse || !(await saveSourceDraft(vfsEntryId, true))) return;
          saved = true;
        }
      }
      if (parsed.ops.length) await commitOps(parsed.ops, 'Sincronizza CSS -> Design', 'code_sync', effectiveSheetId);
      if (!editingFile && latestDesignDraftRef.current === cssToParse) {
        designDirtyRef.current = false;
        setDesignDirty(false);
      }
      if (parsed.ops.length || saved) setLastSyncedAt(Date.now());
      if (explicitToast) {
        if (parsed.ops.length) pushToast('success', `CSS applicato al Design (${parsed.matchedNodeIds.length || parsed.ops.length} regole aggiornate).`);
        else if (saved) pushToast('success', 'File CSS salvato nel progetto.');
        else pushToast('info', 'Nessuna modifica CSS da applicare.');
      }
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : 'Impossibile applicare le modifiche CSS.');
    }
  };

  const handleDraftChange = (nextVal: string) => {
    stageDraft(nextVal);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void applyCssChangesToCanvas(nextVal, false);
    }, 450);
  };

  const handleApplySnippet = async (snippet: CssQuickSnippet) => {
    const targetId = selectedNodeId ?? sheet.rootIds[0];
    if (!targetId || !sheet.nodes[targetId]) return;
    const baseSel = compiled.nodeIdToSelector[targetId] ?? `#${targetId}`;
    const fullSel = activeState !== 'base' ? `${baseSel}:${activeState}` : baseSel;

    let snippetBlock = `/* @node ${targetId} */\n${fullSel} {\n  ${snippet.declarations}\n}`;
    if (snippet.id === 'hover-lift' && activeState === 'base') {
      snippetBlock += `\n${baseSel}:hover {\n  opacity: 0.95;\n  transform: translateY(-2px);\n}`;
    }

    const parsed = parseCssEditsToPatchOps(snippetBlock, sheet, targetId);
    if (parsed.ops.length > 0) {
      isFocusedRef.current = false;
      await commitOps(parsed.ops, `Snippet CSS: ${snippet.label}`, 'code_sync', effectiveSheetId);
      pushToast('success', `Applicato stile "${snippet.label}" a ${sheet.nodes[targetId].name}`);
    }
  };

  const handleCopyCss = async () => {
    try {
      await navigator.clipboard.writeText(draftCss);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = draftCss;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    pushToast('success', `CSS copiato negli appunti (${cssLines.length} righe)!`);
    setTimeout(() => setCopied(false), 1600);
  };

  const handleLineSelect = (lineNum: number) => {
    const span = findSpanAtLine(lineNum);
    if (span) {
      selectedFromCssRef.current = span.canvasNodeId;
      selectNodeFromCode(span.canvasNodeId);
    }
  };

  const handleTextareaCaretSync = (el: HTMLTextAreaElement) => {
    const pos = el.selectionStart ?? 0;
    const caretLine = 1 + el.value.slice(0, pos).split('\n').length - 1;
    handleLineSelect(caretLine);
  };

  const editorContentHeight = Math.max(360, cssLines.length * LINE_HEIGHT_PX + EDITOR_PAD_TOP * 2 + 40);
  const selectedSelectorLabel = selectedNodeId ? compiled.nodeIdToSelector[selectedNodeId] ?? `#${selectedNodeId}` : '';

  return (
    <div
      className="code-sheet-container"
      data-testid="css-live-editor"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      {/* Top Toolbar: Scope Toggle, State Tabs, Copy & Apply */}
      <div className="code-toolbar" style={{ gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Palette size={14} color="var(--accent-violet)" />

          {/* Scope Toggle: Selected Element vs Full Sheet */}
          <div className="segmented-group">
            <button
              type="button"
              className={`segmented-item ${scope === 'selected' ? 'active' : ''}`}
              data-testid="css-scope-selected"
              onClick={() => setScope('selected')}
              title="Mostra e modifica solo la regola CSS dell'elemento attualmente selezionato"
            >
              <Target size={11} />
              <span>🎯 CSS Elemento Selezionato</span>
            </button>
            <button
              type="button"
              className={`segmented-item ${scope === 'sheet' ? 'active' : ''}`}
              data-testid="css-scope-sheet"
              onClick={() => setScope('sheet')}
              title="Mostra l'intero foglio CSS con variabili :root, @keyframes, classi riutilizzabili e nodi"
            >
              <FileCode2 size={11} />
              <span>📄 Foglio CSS Completo</span>
            </button>
          </div>

          {/* Interactive State Tabs */}
          <div className="segmented-group">
            {STATE_TABS.map((st) => (
              <button
                key={st.id}
                type="button"
                className={`segmented-item ${activeState === st.id ? 'active' : ''}`}
                data-testid={`css-state-${st.id}`}
                onClick={() => {
                  setActiveState(st.id);
                  setSimulatedCanvasState(st.id);
                }}
              >
                {st.label}
              </button>
            ))}
          </div>

          {activeState !== 'base' && (
            <button
              type="button"
              className={`studio-btn sm ${simulatedCanvasState === activeState ? 'active' : ''}`}
              onClick={() => setSimulatedCanvasState(simulatedCanvasState === activeState ? 'base' : activeState)}
              title="Simula lo stato pseudo-CSS direttamente sul Canvas"
            >
              <Eye size={11} />
              <span>Simula :{activeState}</span>
            </button>
          )}
        </div>

        {/* Right Actions: Refresh, Copy CSS, Apply CSS to Design */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          {selectedNode && (
            <span className="badge blue" title={`Selettore associato a ${selectedNode.name}`}>
              {selectedSelectorLabel}
            </span>
          )}

          <button
            type="button"
            className="studio-btn sm"
            onClick={() => {
              isFocusedRef.current = false;
              if (editingFile) stageDraft(compiled.css);
              else updateDesignDraft(compiled.css, false);
              setDiagnostics([]);
            }}
            title="Rigenera CSS dal Canvas attuale"
          >
            <RefreshCw size={12} />
          </button>

          <button
            type="button"
            className="studio-btn sm"
            data-testid="btn-copy-css"
            onClick={() => void handleCopyCss()}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            <span>Copia CSS</span>
          </button>

          <button
            type="button"
            className="studio-btn sm primary"
            data-testid="btn-apply-css"
            onClick={() => {
              if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
              isFocusedRef.current = false;
              void applyCssChangesToCanvas(draftCss, true);
            }}
            title="Applica immediatamente le regole CSS al Design sul Canvas (Ctrl+Invio)"
          >
            <Check size={12} />
            <span>✓ Applica CSS al Design</span>
          </button>
        </div>
      </div>

      {/* Quick CSS Preset Snippets Bar */}
      <div
        className="bundle-files-bar"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <Sparkles size={11} color="var(--accent-violet)" />
            Preset CSS:
          </span>
          {CSS_QUICK_SNIPPETS.map((snip) => (
            <button
              key={snip.id}
              type="button"
              className="studio-btn sm violet"
              data-testid={`css-snippet-${snip.id}`}
              onClick={() => void handleApplySnippet(snip)}
              title={snip.description}
              style={{ height: 21, fontSize: 10.5, padding: '0 7px' }}
            >
              <Wand2 size={10} />
              <span>{snip.label}</span>
            </button>
          ))}
        </div>

        <span style={{ fontSize: 10.5, color: isDirty ? 'var(--accent-amber)' : 'var(--accent-emerald)' }}>
          {isDirty
            ? '● Modifiche CSS da applicare'
            : lastSyncedAt
              ? '✓ Sincronizzato con il Canvas'
              : '⇄ Sync Bidirezionale 78-Prop Attivo'}
        </span>
      </div>

      {/* Interactive Line-Numbered CSS Viewer + Live Editor */}
      <div
        ref={scrollContainerRef}
        data-testid="css-lines-scroll"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          position: 'relative',
          background: 'var(--code-bg)',
          fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
          fontSize: 12.5,
          lineHeight: `${LINE_HEIGHT_PX}px`,
        }}
        onMouseLeave={() => setHoveredNode(null)}
      >
        <div style={{ display: 'flex', minHeight: editorContentHeight, position: 'relative' }}>
          {/* Clickable & Hoverable Line Gutter */}
          <div
            data-testid="css-line-gutter"
            style={{
              width: 52,
              minWidth: 52,
              paddingTop: EDITOR_PAD_TOP,
              paddingBottom: EDITOR_PAD_TOP,
              background: 'var(--bg-header)',
              borderRight: '1px solid var(--border-subtle)',
              userSelect: 'none',
              zIndex: 3,
            }}
          >
            {cssLines.map((_, idx) => {
              const lineNum = idx + 1;
              const spanAtLine = findSpanAtLine(lineNum);
              const isSelLine =
                selectedSpan !== null && lineNum >= selectedSpan.startLine && lineNum <= selectedSpan.endLine;
              return (
                <div
                  key={lineNum}
                  data-testid={`css-gutter-line-${lineNum}`}
                  onClick={() => handleLineSelect(lineNum)}
                  onMouseEnter={() => setHoveredNode(spanAtLine?.canvasNodeId ?? null)}
                  title={
                    spanAtLine && sheet.nodes[spanAtLine.canvasNodeId]
                      ? `Clicca per selezionare "${sheet.nodes[spanAtLine.canvasNodeId].name}" sul Canvas`
                      : `Riga ${lineNum}`
                  }
                  style={{
                    height: LINE_HEIGHT_PX,
                    lineHeight: `${LINE_HEIGHT_PX}px`,
                    paddingRight: 8,
                    paddingLeft: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: spanAtLine ? 'pointer' : 'default',
                    color: isSelLine ? 'var(--accent-primary)' : 'var(--code-gutter)',
                    fontWeight: isSelLine ? 700 : 400,
                    background: isSelLine ? 'var(--code-line-highlight)' : 'transparent',
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: isSelLine
                        ? 'var(--accent-primary)'
                        : spanAtLine
                          ? 'rgba(148, 163, 184, 0.35)'
                          : 'transparent',
                    }}
                  />
                  <span>{lineNum}</span>
                </div>
              );
            })}
          </div>

          {/* Editor Surface with Synchronized Highlight Band + Native Textarea */}
          <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
            {selectedSpan && (
              <div
                data-testid="css-selected-block-highlight"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: EDITOR_PAD_TOP + (selectedSpan.startLine - 1) * LINE_HEIGHT_PX,
                  height: (selectedSpan.endLine - selectedSpan.startLine + 1) * LINE_HEIGHT_PX,
                  background: 'var(--code-line-highlight)',
                  borderLeft: '3px solid var(--accent-primary)',
                  pointerEvents: 'none',
                  zIndex: 1,
                }}
              />
            )}

            {hoveredSpan && (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: EDITOR_PAD_TOP + (hoveredSpan.startLine - 1) * LINE_HEIGHT_PX,
                  height: (hoveredSpan.endLine - hoveredSpan.startLine + 1) * LINE_HEIGHT_PX,
                  background: 'rgba(148, 163, 184, 0.08)',
                  borderLeft: '2px dashed var(--accent-violet)',
                  pointerEvents: 'none',
                  zIndex: 1,
                }}
              />
            )}

            <textarea
              ref={textareaRef}
              data-testid="css-editor-textarea"
              aria-label={editingFile ? 'Sorgente file CSS' : 'Regole CSS del Canvas'}
              spellCheck={false}
              wrap="off"
              value={draftCss}
              onFocus={() => {
                isFocusedRef.current = true;
              }}
              onBlur={() => {
                isFocusedRef.current = false;
                if (isDirty) {
                  if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
                  void applyCssChangesToCanvas(draftCss, false);
                }
              }}
              onChange={(e) => handleDraftChange(e.target.value)}
              onClick={(e) => handleTextareaCaretSync(e.currentTarget)}
              onKeyUp={(e) => {
                if (
                  e.key === 'ArrowUp' ||
                  e.key === 'ArrowDown' ||
                  e.key === 'PageUp' ||
                  e.key === 'PageDown'
                ) {
                  handleTextareaCaretSync(e.currentTarget);
                }
              }}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && (e.key === 'Enter' || (editingFile && e.key.toLowerCase() === 's'))) {
                  e.preventDefault();
                  e.stopPropagation();
                  if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
                  void applyCssChangesToCanvas(draftCss, true);
                }
              }}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const relY = e.clientY - rect.top - EDITOR_PAD_TOP;
                const lineNum = Math.max(1, Math.floor(relY / LINE_HEIGHT_PX) + 1);
                const span = findSpanAtLine(lineNum);
                setHoveredNode(span?.canvasNodeId ?? null);
              }}
              style={{
                position: 'relative',
                zIndex: 2,
                width: '100%',
                height: editorContentHeight,
                minHeight: '100%',
                padding: `${EDITOR_PAD_TOP}px 14px`,
                border: 'none',
                outline: 'none',
                resize: 'none',
                overflowX: 'auto',
                overflowY: 'hidden',
                background: 'transparent',
                color: 'var(--text-primary)',
                caretColor: 'var(--accent-primary)',
                fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
                fontSize: 12.5,
                lineHeight: `${LINE_HEIGHT_PX}px`,
                whiteSpace: 'pre',
                tabSize: 2,
              }}
            />
          </div>
        </div>
      </div>

      {/* Diagnostics / Status Footer */}
      <div
        style={{
          padding: '5px 12px',
          borderTop: '1px solid var(--border-subtle)',
          background: 'var(--bg-header)',
          fontSize: 11,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          color: diagnostics.length > 0 ? 'var(--accent-amber)' : 'var(--text-muted)',
        }}
      >
        <span>
          {diagnostics.length > 0
            ? `⚠️ ${diagnostics.map((d) => d.message).join(' • ')}`
            : `Clicca qualsiasi selettore CSS o modifica .classe riutilizzabile / @keyframes • Ctrl+Invio per applicare`}
        </span>
        <span>{liveSpans.length} regole mappate</span>
      </div>
    </div>
  );
};
