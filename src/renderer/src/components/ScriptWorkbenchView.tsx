import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Code2,
  Cpu,
  FileCode2,
  FilePlus2,
  Link2,
  Play,
  Save,
  Sparkles,
  Terminal,
  Zap,
} from 'lucide-react';
import {
  SCRIPT_SNIPPET_TEMPLATES,
  createStarterScriptModuleTs,
  extractScriptFunctions,
  transpileTypeScriptToJs,
} from '@shared/script-ir';
import type { EventTriggerType, NodeId } from '@shared/ui-ir';
import { runScriptWorker } from '@renderer/utils/run-script-worker';
import { useStudioStore } from '@renderer/state/studio-store';
import { GeneratedSourceTextarea, useGeneratedSourceEditor } from './GeneratedSourceEditor';

export interface ScriptWorkbenchViewProps {
  vfsEntryId?: string;
  sheetId?: string;
}

interface BoundCallerBadge {
  nodeId: NodeId;
  nodeName: string;
  trigger: EventTriggerType;
}

export const ScriptWorkbenchView: React.FC<ScriptWorkbenchViewProps> = ({ vfsEntryId, sheetId }) => {
  const project = useStudioStore((s) => s.project);
  const vfsTree = useStudioStore((s) => s.vfsTree);
  const sourceFiles = useStudioStore((s) => s.sourceFiles);
  const activeScriptVfsId = useStudioStore((s) => s.activeScriptVfsId);
  const activeSheetId = useStudioStore((s) => s.activeSheetId);
  const sheetDocuments = useStudioStore((s) => s.sheetDocuments);
  const selectedNodeIds = useStudioStore((s) => s.selectedNodeIds);

  const ensureActiveScriptFile = useStudioStore((s) => s.ensureActiveScriptFile);
  const saveSourceFileContent = useStudioStore((s) => s.saveSourceFileContent);
  const saveSourceDraft = useStudioStore((s) => s.saveSourceDraft);
  const setSourceDraft = useStudioStore((s) => s.setSourceDraft);
  const createVfsEntry = useStudioStore((s) => s.createVfsEntry);
  const createAndBindScriptFunctionForNode = useStudioStore((s) => s.createAndBindScriptFunctionForNode);
  const commitOps = useStudioStore((s) => s.commitOps);
  const selectNode = useStudioStore((s) => s.selectNode);
  const appendConsoleEntry = useStudioStore((s) => s.appendConsoleEntry);
  const setBottomConsoleOpen = useStudioStore((s) => s.setBottomConsoleOpen);
  const pushToast = useStudioStore((s) => s.pushToast);

  const scriptFiles = useMemo(
    () => vfsTree.filter((n) => n.entryKind === 'script_file' || /\.(ts|js)$/i.test(n.name)),
    [vfsTree],
  );

  const resolvedVfsId =
    vfsEntryId ??
    activeScriptVfsId ??
    scriptFiles.find((f) => !f.name.endsWith('.generated.ts'))?.id ??
    scriptFiles[0]?.id ??
    '';

  const activeFileEntry = scriptFiles.find((f) => f.id === resolvedVfsId);
  const storeCode = resolvedVfsId ? sourceFiles[resolvedVfsId] : undefined;
  const sourceDraft = useStudioStore((s) => s.sourceDrafts[resolvedVfsId]);

  const targetSheetId = sheetId || activeSheetId;
  const sheet = sheetDocuments[targetSheetId];

  const starterCode = useMemo(() => createStarterScriptModuleTs(project?.name ?? 'Visual UI Studio'), [project?.name]);
  const draftCode = sourceDraft?.content ?? storeCode ?? starterCode;
  const [selectedFnName, setSelectedFnName] = useState<string>('');
  const [showTranspiledJs, setShowTranspiledJs] = useState<boolean>(true);
  const [bindTrigger, setBindTrigger] = useState<EventTriggerType>('onClick');
  const [explicitTargetNodeId, setExplicitTargetNodeId] = useState<string>('');
  const [newScriptOpen, setNewScriptOpen] = useState(false);
  const [newScriptName, setNewScriptName] = useState('interactions.ts');

  // Persistent interactive test runtime state
  const [runtimeVars, setRuntimeVars] = useState<Record<string, unknown>>({
    clicks: 0,
    counter: 1482,
    orderCount: 1482,
  });
  const [virtualTexts, setVirtualTexts] = useState<Record<string, string>>({});
  const [recentRunLogs, setRecentRunLogs] = useState<string[]>([
    'Pronto — Premi [▶ Esegui Script & Test] per transpilare TS -> JS ed eseguire sul foglio attivo.',
  ]);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isNarrowLayout, setIsNarrowLayout] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const scriptRun = useRef<AbortController | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setIsNarrowLayout(w < 760);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!resolvedVfsId) {
      void ensureActiveScriptFile().catch((error: unknown) => {
        pushToast('error', error instanceof Error ? error.message : 'Impossibile aprire lo script.');
      });
    }
  }, [resolvedVfsId, ensureActiveScriptFile, pushToast]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      scriptRun.current?.abort();
    };
  }, []);

  const functions = useMemo(() => extractScriptFunctions(draftCode), [draftCode]);
  const transpiled = useMemo(() => transpileTypeScriptToJs(draftCode, { preserveEsExports: true }), [draftCode]);
  const runtime = useGeneratedSourceEditor({
    fileName: `${(activeFileEntry?.name ?? 'script').replace(/\.[^.]+$/, '')}-${resolvedVfsId || 'module'}.js`,
    generated: transpiled.jsCode,
    folders: ['generated'],
    entryKind: 'source_file',
  });

  useEffect(() => {
    if (functions.length > 0 && (!selectedFnName || !functions.some((f) => f.name === selectedFnName))) {
      setSelectedFnName(functions[0].name);
    }
  }, [functions, selectedFnName]);

  // Canvas nodes available for event linking
  const canvasNodes = useMemo(() => {
    if (!sheet) return [];
    return Object.values(sheet.nodes).filter((n) => n.kind !== 'artboard');
  }, [sheet]);

  const effectiveTargetNodeId = useMemo(() => {
    const primarySel = selectedNodeIds[0];
    if (primarySel && sheet?.nodes[primarySel] && sheet.nodes[primarySel].kind !== 'artboard') {
      return primarySel;
    }
    if (explicitTargetNodeId && sheet?.nodes[explicitTargetNodeId]) {
      return explicitTargetNodeId;
    }
    return canvasNodes[0]?.id ?? primarySel ?? '';
  }, [selectedNodeIds, explicitTargetNodeId, sheet, canvasNodes]);

  // Map functionName -> Canvas UI elements calling it
  const callersByFunction = useMemo(() => {
    const map: Record<string, BoundCallerBadge[]> = {};
    if (!sheet) return map;
    for (const node of Object.values(sheet.nodes)) {
      for (const inter of node.interactions ?? []) {
        const fn =
          inter.action.kind === 'call_script_fn'
            ? inter.action.fnName
            : inter.action.kind === 'call_handler'
              ? inter.action.handlerName
              : null;
        if (fn) {
          if (!map[fn]) map[fn] = [];
          map[fn].push({ nodeId: node.id, nodeName: node.name, trigger: inter.trigger });
        }
      }
    }
    return map;
  }, [sheet]);

  const setDraftCode = (nextCode: string) => {
    if (!resolvedVfsId || resolvedVfsId === 'mem_script') return;
    const baseContent = sourceDraft?.baseContent ?? storeCode ?? starterCode;
    setSourceDraft(resolvedVfsId, { content: nextCode, baseContent });
  };

  const scheduleSave = (nextCode: string) => {
    setDraftCode(nextCode);
    if (!resolvedVfsId || resolvedVfsId === 'mem_script') return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveSourceDraft(resolvedVfsId, true);
    }, 320);
  };

  const handleInsertSnippet = async (tsCode: string, label: string) => {
    const extracted = extractScriptFunctions(tsCode);
    const fnName = extracted[0]?.name;

    if (fnName && functions.some((f) => f.name === fnName)) {
      setSelectedFnName(fnName);
      pushToast('info', `Funzione "${fnName}" già presente — selezionata per il test!`);
      return;
    }

    const nextCode = `${draftCode.trimEnd()}\n\n// Template: ${label}\n${tsCode.trim()}\n`;
    setDraftCode(nextCode);
    if (fnName) setSelectedFnName(fnName);

    if (resolvedVfsId && resolvedVfsId !== 'mem_script') {
      if (!await saveSourceDraft(resolvedVfsId, true)) return;
    } else {
      const { vfsEntryId: createdId } = await ensureActiveScriptFile();
      await saveSourceFileContent(createdId, nextCode, true);
    }
    pushToast('success', `Template "${label}" inserito nello script!`);
  };

  const handleBindSelectedElement = async () => {
    if (!effectiveTargetNodeId) {
      pushToast('warn', 'Nessun elemento Canvas disponibile da collegare.');
      return;
    }
    // Flush any unsaved local edits before store appends generated handler
    if (resolvedVfsId && resolvedVfsId !== 'mem_script') {
      if (!await saveSourceDraft(resolvedVfsId, true)) return;
    }
    const res = await createAndBindScriptFunctionForNode(effectiveTargetNodeId, bindTrigger);
    if (res) {
      setSelectedFnName(res.fnName);
    }
  };

  const handleBindExistingFunctionToNode = async (fnName: string) => {
    if (!sheet || !effectiveTargetNodeId) return;
    const node = sheet.nodes[effectiveTargetNodeId];
    if (!node) return;
    const filtered = (node.interactions ?? []).filter(
      (b) => !(b.trigger === bindTrigger && b.action.kind === 'call_script_fn'),
    );
    await commitOps(
      [
        {
          op: 'set_interaction',
          id: node.id,
          interactions: [
            ...filtered,
            {
              trigger: bindTrigger,
              action: { kind: 'call_script_fn', vfsEntryId: resolvedVfsId || undefined, fnName },
            },
          ],
        },
      ],
      `Collega ${node.name} (${bindTrigger}) -> ${fnName}`,
    );
    pushToast('success', `Collegato ${node.name} (${bindTrigger}) -> ${fnName}()`);
  };

  const handleRunScriptAndTest = async (useJavaScript = false) => {
    if (scriptRun.current) return;
    const operation = new AbortController();
    scriptRun.current = operation;
    setIsRunning(true);
    const source = `Script • ${activeFileEntry?.name ?? 'handlers.ts'}`;
    try {
      if (!useJavaScript && resolvedVfsId && resolvedVfsId !== 'mem_script' &&
          !await saveSourceDraft(resolvedVfsId, true)) return;
      if (operation.signal.aborted) return;

      const { jsCode, exportedFunctions, diagnostics } = transpileTypeScriptToJs(useJavaScript ? runtime.displayed : draftCode);
      setBottomConsoleOpen(true);
      if (diagnostics.length > 0) throw new Error(`Errore sintassi TS/JS: ${diagnostics[0]}`);

      const result = await runScriptWorker({
        code: jsCode,
        selectedFunction: selectedFnName,
        exportedFunctions,
        state: runtimeVars,
        values: virtualTexts,
        nodes: Object.values(sheet?.nodes ?? {}).map((node) => ({
          id: node.id, name: node.name, text: node.content?.text, value: node.content?.value,
        })),
      }, operation.signal);
      for (const log of result.logs) appendConsoleEntry({ ...log, source });
      for (const notice of result.notices) pushToast(notice.kind, notice.message);
      if (result.error) throw new Error(result.error);
      setRuntimeVars(result.state);
      setVirtualTexts(result.values);
      setRecentRunLogs((previous) => [...result.logs.map((log) => log.message).reverse(), ...previous].slice(0, 20));
    } catch (error) {
      if (operation.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      setRecentRunLogs((previous) => [message, ...previous.slice(0, 19)]);
      appendConsoleEntry({ kind: 'error', source, message });
      pushToast('error', message);
    } finally {
      scriptRun.current = null;
      if (!operation.signal.aborted) setIsRunning(false);
    }
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      e.stopPropagation();
      if (resolvedVfsId && resolvedVfsId !== 'mem_script') {
        void saveSourceDraft(resolvedVfsId);
      }
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = `${draftCode.slice(0, start)}  ${draftCode.slice(end)}`;
      scheduleSave(next);
      requestAnimationFrame(() => {
        if (editorRef.current) {
          editorRef.current.selectionStart = start + 2;
          editorRef.current.selectionEnd = start + 2;
        }
      });
    }
  };

  const selectedFnObj = functions.find((f) => f.name === selectedFnName);
  const codeLines = useMemo(() => draftCode.split('\n'), [draftCode]);
  const targetNodeObj = effectiveTargetNodeId ? sheet?.nodes[effectiveTargetNodeId] : undefined;

  return (
    <div
      ref={rootRef}
      data-testid="script-workbench-view"
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-panel)',
        overflow: 'hidden',
      }}
    >
      {/* Top Workbench Action Bar */}
      <div className="canvas-subtoolbar" style={{ flexWrap: 'wrap', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <FileCode2 size={14} color="var(--accent-violet)" />
          <span style={{ fontWeight: 700, fontSize: 12 }}>Logica Script TS / JS</span>

          <select
            className="studio-select"
            style={{ height: 24, fontSize: 11.5, padding: '0 7px', fontWeight: 600 }}
            value={resolvedVfsId}
            onChange={(e) => {
              const found = scriptFiles.find((f) => f.id === e.target.value);
              if (found) void useStudioStore.getState().openVfsNode(found);
            }}
          >
            {scriptFiles.length === 0 && <option value="">scripts/handlers.ts</option>}
            {scriptFiles.map((f) => (
              <option key={f.id} value={f.id}>
                📄 {f.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="studio-btn sm"
            data-testid="btn-new-script-file"
            onClick={() => setNewScriptOpen((v) => !v)}
          >
            <FilePlus2 size={12} />
            <span>+ Nuovo Script .ts / .js</span>
          </button>

          {newScriptOpen && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input
                type="text"
                className="studio-input"
                style={{ height: 23, width: 132, fontSize: 11 }}
                value={newScriptName}
                placeholder="es. checkout.ts"
                onChange={(e) => setNewScriptName(e.target.value)}
              />
              <button
                type="button"
                className="studio-btn sm primary"
                onClick={() => {
                  void createVfsEntry(newScriptName, 'script_file');
                  setNewScriptOpen(false);
                }}
              >
                Crea
              </button>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {functions.length > 0 && (
            <select
              className="studio-select"
              style={{ height: 24, fontSize: 11, padding: '0 6px' }}
              value={selectedFnName}
              title="Seleziona funzione esportata da testare"
              onChange={(e) => setSelectedFnName(e.target.value)}
            >
              {functions.map((f) => (
                <option key={f.name} value={f.name}>
                  ƒ {f.name}()
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            className="studio-btn sm primary"
            style={{ background: 'var(--accent-emerald)', borderColor: 'var(--accent-emerald)' }}
            data-testid="btn-run-script"
            disabled={isRunning}
            onClick={() => void handleRunScriptAndTest()}
          >
            <Play size={12} />
            <span>{isRunning ? 'Test in corso…' : 'Esegui script'}</span>
          </button>

          <button
            type="button"
            className={`studio-btn sm ${showTranspiledJs ? 'active' : 'ghost'}`}
            data-testid="btn-toggle-transpiled-js"
            onClick={() => setShowTranspiledJs((v) => !v)}
          >
            <Code2 size={12} />
            <span>JS Transpilato</span>
          </button>

          <button
            type="button"
            className="studio-btn sm"
            onClick={() => {
              if (resolvedVfsId && resolvedVfsId !== 'mem_script') {
                void saveSourceDraft(resolvedVfsId);
              }
            }}
          >
            <Save size={12} />
            <span>Salva</span>
          </button>
        </div>
      </div>

      {/* 1-Click Ready Function Templates Snippet Bar */}
      <div
        data-testid="script-snippet-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '5px 10px',
          background: 'var(--bg-header)',
          borderBottom: '1px solid var(--border-subtle)',
          overflowX: 'auto',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 10.5,
            fontWeight: 700,
            color: 'var(--text-secondary)',
            whiteSpace: 'nowrap',
            marginRight: 2,
          }}
        >
          <Sparkles size={11} color="var(--accent-amber)" /> Template Pronti:
        </span>

        {SCRIPT_SNIPPET_TEMPLATES.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            className="studio-btn sm"
            data-testid={`script-snippet-${tpl.id}`}
            title={tpl.description}
            onClick={() => void handleInsertSnippet(tpl.tsCode, tpl.label)}
            style={{ fontSize: 10.5, height: 22 }}
          >
            <Zap size={10} color="var(--accent-violet)" />
            <span>{tpl.label}</span>
          </button>
        ))}
      </div>

      {/* Main Split Area: Left Function Explorer & UI Linker + Center TS Editor + Right Transpiled JS */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: isNarrowLayout ? 'column' : 'row',
          overflow: isNarrowLayout ? 'auto' : 'hidden',
        }}
      >
        {/* Left Function Explorer & UI Event Linker */}
        <aside
          style={{
            width: isNarrowLayout ? '100%' : 248,
            minWidth: isNarrowLayout ? 0 : 215,
            maxHeight: isNarrowLayout ? 175 : undefined,
            borderRight: isNarrowLayout ? 'none' : '1px solid var(--border-subtle)',
            borderBottom: isNarrowLayout ? '1px solid var(--border-subtle)' : 'none',
            background: 'var(--bg-header)',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            flexShrink: 0,
          }}
        >
          {/* 1-Click Canvas Node Linker Box */}
          <div
            style={{
              padding: 9,
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              🔗 Collega Evento UI Canvas
            </div>

            <div style={{ display: 'flex', gap: 4 }}>
              <select
                className="studio-select"
                style={{ flex: 1, minWidth: 0, height: 23, fontSize: 11, padding: '0 5px' }}
                value={effectiveTargetNodeId}
                onChange={(e) => setExplicitTargetNodeId(e.target.value)}
              >
                {canvasNodes.length === 0 && <option value="">Nessun nodo UI</option>}
                {canvasNodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} ({n.kind})
                  </option>
                ))}
              </select>

              <select
                className="studio-select"
                style={{ width: 82, height: 23, fontSize: 11, padding: '0 4px' }}
                value={bindTrigger}
                onChange={(e) => setBindTrigger(e.target.value as EventTriggerType)}
              >
                <option value="onClick">onClick</option>
                <option value="onInput">onInput</option>
                <option value="onChange">onChange</option>
                <option value="onSubmit">onSubmit</option>
                <option value="onMount">onMount</option>
                <option value="onHover">onHover</option>
              </select>
            </div>

            <button
              type="button"
              className="studio-btn sm violet"
              style={{ width: '100%', justifyContent: 'center' }}
              data-testid="btn-bind-selected-element"
              onClick={() => void handleBindSelectedElement()}
              title={
                targetNodeObj
                  ? `Genera e collega handler ${bindTrigger} per ${targetNodeObj.name}`
                  : 'Seleziona un nodo sul Canvas'
              }
            >
              <Link2 size={11} />
              <span>+ Collega Evento Elemento Selezionato</span>
            </button>
          </div>

          {/* Exported Functions List */}
          <div
            style={{
              padding: '6px 10px',
              fontSize: 10.5,
              fontWeight: 700,
              color: 'var(--text-secondary)',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>FUNZIONI ESPORTATE ({functions.length})</span>
            <span className={`badge ${transpiled.diagnostics.length === 0 ? 'green' : 'amber'}`}>
              {transpiled.diagnostics.length === 0 ? 'TS OK' : 'Syntax!'}
            </span>
          </div>

          <div
            data-testid="script-function-list"
            style={{ flex: 1, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 5 }}
          >
            {functions.length === 0 && (
              <div style={{ padding: 10, fontSize: 11, color: 'var(--text-muted)' }}>
                Nessuna funzione rilevata. Clicca un Template Pronto sopra per iniziare!
              </div>
            )}

            {functions.map((fn) => {
              const isSel = selectedFnName === fn.name;
              const callers = callersByFunction[fn.name] ?? [];
              return (
                <div
                  key={`${fn.name}_${fn.startLine}`}
                  onClick={() => setSelectedFnName(fn.name)}
                  style={{
                    padding: '7px 8px',
                    borderRadius: 7,
                    border: `1px solid ${isSel ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                    background: isSel ? 'var(--accent-soft)' : 'var(--bg-panel)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      ƒ {fn.name}({fn.params.join(', ')})
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
                      L{fn.startLine}–{fn.endLine}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                    {fn.isExported && <span className="badge blue">export</span>}
                    {fn.isAsync && <span className="badge violet">async</span>}
                    {targetNodeObj && (
                      <button
                        type="button"
                        className="studio-btn sm ghost"
                        style={{ height: 18, padding: '0 5px', fontSize: 10, marginLeft: 'auto' }}
                        title={`Assegna ${fn.name} a ${targetNodeObj.name} (${bindTrigger})`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleBindExistingFunctionToNode(fn.name);
                        }}
                      >
                        <Link2 size={10} /> Assegna a {targetNodeObj.name}
                      </button>
                    )}
                  </div>

                  {callers.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 2 }}>
                      {callers.map((c) => (
                        <button
                          key={`${c.nodeId}_${c.trigger}`}
                          type="button"
                          className="badge green"
                          style={{ border: 'none', cursor: 'pointer' }}
                          title="Clicca per selezionare questo elemento sul Canvas"
                          onClick={(e) => {
                            e.stopPropagation();
                            selectNode(c.nodeId, false);
                          }}
                        >
                          ⚡ {c.nodeName} • {c.trigger}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        {/* Center Line-Numbered TypeScript / JavaScript Editor */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: isNarrowLayout ? 220 : 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '4px 10px',
              background: 'var(--bg-panel-elevated)',
              borderBottom: '1px solid var(--border-subtle)',
              fontSize: 10.5,
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              ctx: StudioRuntimeContext → state • getText • setText • getValue • setStyle • setVisible • toast • three
            </span>
            <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{codeLines.length} righe</span>
          </div>

          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'row',
              background: 'var(--code-bg)',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Synchronized Line Numbers Gutter */}
            <div
              ref={gutterRef}
              aria-hidden="true"
              style={{
                width: 44,
                flexShrink: 0,
                overflow: 'hidden',
                padding: '12px 6px 12px 0',
                textAlign: 'right',
                background: 'rgba(15, 23, 42, 0.45)',
                borderRight: '1px solid var(--border-subtle)',
                fontFamily: "'JetBrains Mono', Consolas, monospace",
                fontSize: 12.5,
                lineHeight: '20px',
                color: 'var(--code-gutter)',
                userSelect: 'none',
              }}
            >
              {codeLines.map((_, idx) => {
                const ln = idx + 1;
                const inSelFn =
                  selectedFnObj && ln >= selectedFnObj.startLine && ln <= selectedFnObj.endLine;
                return (
                  <div
                    key={ln}
                    style={{
                      height: 20,
                      color: inSelFn ? 'var(--accent-primary)' : undefined,
                      fontWeight: inSelFn ? 700 : 400,
                    }}
                  >
                    {ln}
                  </div>
                );
              })}
            </div>

            {/* Editable TS/JS Code Area */}
            <textarea
              ref={editorRef}
              data-testid="script-ts-editor"
              spellCheck={false}
              value={draftCode}
              onChange={(e) => scheduleSave(e.target.value)}
              onKeyDown={handleEditorKeyDown}
              onScroll={(e) => {
                if (gutterRef.current) {
                  gutterRef.current.scrollTop = e.currentTarget.scrollTop;
                }
              }}
              style={{
                flex: 1,
                minWidth: 0,
                height: '100%',
                border: 'none',
                outline: 'none',
                resize: 'none',
                padding: '12px 14px',
                background: 'transparent',
                color: 'var(--text-primary)',
                fontFamily: "'JetBrains Mono', Consolas, monospace",
                fontSize: 12.5,
                lineHeight: '20px',
                whiteSpace: 'pre',
                overflow: 'auto',
              }}
            />
          </div>
        </div>

        {/* Right Live Transpiled ES2024 JavaScript Preview */}
        {showTranspiledJs && (
          <aside
            data-testid="script-transpiled-js-preview"
            style={{
              width: isNarrowLayout ? '100%' : 310,
              minWidth: isNarrowLayout ? 0 : 240,
              maxWidth: isNarrowLayout ? '100%' : '38%',
              height: isNarrowLayout ? 150 : undefined,
              borderLeft: isNarrowLayout ? 'none' : '1px solid var(--border-subtle)',
              borderTop: isNarrowLayout ? '1px solid var(--border-subtle)' : 'none',
              background: 'var(--code-bg)',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              flexShrink: 0,
            }}
          >
            <div
              style={{
                padding: '5px 10px',
                background: 'var(--bg-header)',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Cpu size={12} color="var(--accent-emerald)" /> JS Runtime Transpilato
              </span>
              {transpiled.diagnostics.length === 0 ? (
                <span style={{ color: 'var(--accent-emerald)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <CheckCircle2 size={11} /> Valido
                </span>
              ) : (
                <span style={{ color: 'var(--accent-danger)' }}>Errore</span>
              )}
            </div>

            {transpiled.diagnostics.length > 0 && (
              <div
                style={{
                  padding: '6px 10px',
                  background: 'var(--accent-danger-soft)',
                  color: 'var(--accent-danger)',
                  fontSize: 11,
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                {transpiled.diagnostics[0]}
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 8px' }}>
              <button type="button" className="studio-btn sm" data-testid="btn-edit-transpiled-js"
                aria-pressed={runtime.manual} disabled={runtime.busy}
                onClick={() => runtime.manual ? runtime.setManual(false) : void runtime.open()}>
                {runtime.manual ? 'Vista JS' : 'Modifica JS'}
              </button>
              {runtime.manual && (
                <>
                  <button type="button" className="studio-btn sm primary" data-testid="btn-save-transpiled-js"
                    disabled={!runtime.canSave || runtime.busy} onClick={() => void runtime.save()}>
                    Salva JS nel progetto
                  </button>
                  <button type="button" className="studio-btn sm" data-testid="btn-run-transpiled-js"
                    disabled={isRunning}
                    onClick={() => void handleRunScriptAndTest(true)}>
                    Esegui JS
                  </button>
                </>
              )}
            </div>
            {runtime.manual ? (
              <GeneratedSourceTextarea label="JavaScript transpilato" testId="script-transpiled-js-editor"
                value={runtime.displayed} onChange={runtime.update} onSave={() => void runtime.save()} saving={runtime.busy} />
            ) : <pre
              className="selectable-text"
              style={{
                flex: 1,
                margin: 0,
                padding: '10px 12px',
                overflow: 'auto',
                fontFamily: "'JetBrains Mono', Consolas, monospace",
                fontSize: 11,
                lineHeight: 1.55,
                color: 'var(--text-secondary)',
              }}
            >
              {runtime.displayed}
            </pre>}
          </aside>
        )}
      </div>

      {/* Bottom Live Execution & Reactive State Strip */}
      <div
        style={{
          height: 102,
          minHeight: 102,
          borderTop: '1px solid var(--border-subtle)',
          background: 'var(--bg-header)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '4px 10px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 10.5,
            fontWeight: 700,
            color: 'var(--text-secondary)',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Terminal size={12} color="var(--accent-emerald)" /> OUTPUT ESECUZIONE LIVE &amp; STATO REATTIVO
          </span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 500, color: 'var(--text-muted)' }}>
            ctx.state = {JSON.stringify(runtimeVars)}
          </span>
        </div>

        <div
          className="selectable-text"
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '5px 10px',
            fontFamily: "'JetBrains Mono', Consolas, monospace",
            fontSize: 11,
          }}
        >
          {recentRunLogs.map((line, i) => (
            <div
              key={`${i}_${line.slice(0, 18)}`}
              style={{
                padding: '1.5px 0',
                color: line.startsWith('❌') ? 'var(--accent-danger)' : 'var(--text-primary)',
              }}
            >
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
