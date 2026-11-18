import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Code2,
  Database,
  Hammer,
  LayoutGrid,
  Play,
  RefreshCw,
  Save,
  Zap,
} from 'lucide-react';
import { isTextFileVfsKind } from '@shared/ipc-contract';
import { previewMarkupImport } from '@shared/markup-importer';
import {
  detectEditorLanguage,
  type EditorSyntaxLanguage,
} from '@shared/project-detector';
import { useStudioStore } from '@renderer/state/studio-store';

export { detectEditorLanguage, type EditorSyntaxLanguage };

export interface CodeEditorViewProps {
  vfsEntryId: string;
  groupId?: string;
  title?: string;
}

const KEYWORDS_BY_LANG: Record<EditorSyntaxLanguage, Set<string>> = {
  javascript: new Set([
    'import', 'export', 'from', 'default', 'function', 'async', 'await', 'return', 'const', 'let',
    'var', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'try', 'catch',
    'finally', 'throw', 'new', 'class', 'extends', 'true', 'false', 'null', 'undefined', 'typeof', 'void',
  ]),
  typescript: new Set([
    'import', 'export', 'from', 'default', 'function', 'async', 'await', 'return', 'const', 'let',
    'var', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'try', 'catch',
    'finally', 'throw', 'new', 'class', 'extends', 'implements', 'interface', 'type', 'enum',
    'public', 'private', 'protected', 'readonly', 'as', 'keyof', 'true', 'false', 'null', 'undefined', 'void',
  ]),
  jsx: new Set([
    'import', 'export', 'from', 'default', 'function', 'async', 'await', 'return', 'const', 'let',
    'if', 'else', 'for', 'while', 'switch', 'case', 'try', 'catch', 'interface', 'type', 'as',
    'true', 'false', 'null', 'undefined',
  ]),
  python: new Set([
    'def', 'async', 'await', 'return', 'import', 'from', 'as', 'class', 'if', 'elif', 'else',
    'for', 'in', 'while', 'try', 'except', 'finally', 'raise', 'with', 'pass', 'break', 'continue',
    'True', 'False', 'None', 'and', 'or', 'not', 'is', 'lambda', 'yield',
  ]),
  rust: new Set([
    'fn', 'pub', 'mod', 'use', 'crate', 'super', 'self', 'Self', 'struct', 'enum', 'impl', 'trait',
    'let', 'mut', 'const', 'static', 'async', 'await', 'return', 'if', 'else', 'match', 'for', 'in',
    'while', 'loop', 'where', 'type', 'true', 'false', 'Some', 'None', 'Ok', 'Err', 'Result', 'Option',
  ]),
  sql: new Set([
    'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE',
    'ALTER', 'DROP', 'TABLE', 'INDEX', 'VIEW', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'NOT',
    'NULL', 'DEFAULT', 'UNIQUE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'ON', 'GROUP', 'BY', 'ORDER',
    'ASC', 'DESC', 'LIMIT', 'OFFSET', 'AS', 'AND', 'OR', 'IN', 'COUNT', 'SUM', 'AVG', 'AUTOINCREMENT',
  ]),
  html: new Set(['DOCTYPE', 'html', 'head', 'body', 'script', 'style', 'link', 'meta']),
  css: new Set(['@media', '@keyframes', '@import', 'important', 'solid', 'flex', 'grid', 'none', 'auto']),
  svelte: new Set([
    'import', 'export', 'let', 'const', 'function', 'async', 'await', 'return', 'if', 'else', 'each',
    '$state', '$derived', '$effect', '$props',
  ]),
  json_toml: new Set(['true', 'false', 'null']),
};

interface ColoredSpan {
  text: string;
  color?: string;
  italic?: boolean;
  bold?: boolean;
}

function tokenizeLine(line: string, lang: EditorSyntaxLanguage): ColoredSpan[] {
  if (!line) return [{ text: '' }];

  const trimmed = line.trimStart();
  if (
    ((lang === 'python' || lang === 'json_toml') && trimmed.startsWith('#')) ||
    (lang === 'sql' && trimmed.startsWith('--')) ||
    ((lang === 'javascript' || lang === 'typescript' || lang === 'jsx' || lang === 'rust') &&
      trimmed.startsWith('//'))
  ) {
    return [{ text: line, color: 'var(--code-comment)', italic: true }];
  }

  const spans: ColoredSpan[] = [];
  const kwSet = KEYWORDS_BY_LANG[lang];
  const tokenRe =
    /(<!--[\s\S]*?-->|\/\/.*$|#\[[^\]]+\]|@[a-zA-Z_][a-zA-Z0-9_-]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|<\/?[a-zA-Z][a-zA-Z0-9:._-]*|\$[a-zA-Z_][a-zA-Z0-9_]*|\b\d+(?:\.\d+)?\b|\b[a-zA-Z_][a-zA-Z0-9_]*\b)/g;

  let lastIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = tokenRe.exec(line)) !== null) {
    if (m.index > lastIdx) {
      spans.push({ text: line.slice(lastIdx, m.index) });
    }
    const tok = m[0];
    if (tok.startsWith('//') || tok.startsWith('<!--')) {
      spans.push({ text: tok, color: 'var(--code-comment)', italic: true });
    } else if (tok.startsWith('"') || tok.startsWith("'") || tok.startsWith('`')) {
      const nextChar = line.slice(m.index + tok.length).trimStart()[0];
      if (lang === 'json_toml' && nextChar === ':') {
        spans.push({ text: tok, color: 'var(--code-attr)', bold: true });
      } else {
        spans.push({ text: tok, color: 'var(--code-str)' });
      }
    } else if (tok.startsWith('<')) {
      spans.push({ text: tok, color: 'var(--code-tag)', bold: true });
    } else if (tok.startsWith('#[') || tok.startsWith('@')) {
      spans.push({ text: tok, color: 'var(--code-attr)', bold: true });
    } else if (/^\d/.test(tok)) {
      spans.push({ text: tok, color: '#fb923c' });
    } else if (
      kwSet.has(tok) ||
      (lang === 'sql' && kwSet.has(tok.toUpperCase()))
    ) {
      spans.push({ text: tok, color: 'var(--code-kw)', bold: true });
    } else {
      spans.push({ text: tok });
    }
    lastIdx = m.index + tok.length;
  }

  if (lastIdx < line.length) {
    spans.push({ text: line.slice(lastIdx) });
  }
  return spans;
}

export const CodeEditorView: React.FC<CodeEditorViewProps> = ({ vfsEntryId, groupId, title }) => {
  const vfsTree = useStudioStore((s) => s.vfsTree);
  const savedContent = useStudioStore((s) => s.sourceFiles[vfsEntryId] ?? '');
  const sourceDraft = useStudioStore((s) => s.sourceDrafts[vfsEntryId]);
  const activeSheetId = useStudioStore((s) => s.activeSheetId);
  const sheetDocuments = useStudioStore((s) => s.sheetDocuments);

  const openVfsSource = useStudioStore((s) => s.openVfsSource);
  const openVfsNode = useStudioStore((s) => s.openVfsNode);
  const setSourceDraft = useStudioStore((s) => s.setSourceDraft);
  const saveSourceDraft = useStudioStore((s) => s.saveSourceDraft);
  const runToolchainTaskAction = useStudioStore((s) => s.runToolchainTaskAction);
  const commitOps = useStudioStore((s) => s.commitOps);
  const openTabInGroup = useStudioStore((s) => s.openTabInGroup);
  const applyLayoutPreset = useStudioStore((s) => s.applyLayoutPreset);
  const pushToast = useStudioStore((s) => s.pushToast);

  const vfsNode = useMemo(
    () => vfsTree.find((n) => n.id === vfsEntryId),
    [vfsTree, vfsEntryId],
  );

  const displayTitle = vfsNode?.name || title || 'File Sorgente';
  const relPath = (vfsNode?.diskRelPath || vfsNode?.virtualPath || displayTitle).replace(/^\/+/, '');
  const langProfile = useMemo(() => detectEditorLanguage(displayTitle), [displayTitle]);

  const [justSaved, setJustSaved] = useState<boolean>(false);
  const [isBusy, setIsBusy] = useState(false);

  const gutterRef = useRef<HTMLDivElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileOperation = useRef(false);
  const savedIndicatorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const draft = sourceDraft?.content ?? savedContent;
  const editorText = draft.replace(/\r\n/g, '\n');
  const isDirty = draft !== savedContent;
  const externalChangedBanner = isDirty && sourceDraft?.baseContent !== savedContent;
  const hasWorkbench = vfsNode && (langProfile.isSql || (vfsNode.entryKind !== 'source_file' && isTextFileVfsKind(vfsNode.entryKind)));

  const setEditorText = (text: string) => {
    const baseContent = sourceDraft?.baseContent ?? savedContent;
    const content = baseContent.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text;
    setSourceDraft(vfsEntryId, content === savedContent ? null : { content, baseContent });
  };

  useEffect(() => () => {
    if (savedIndicatorTimer.current) clearTimeout(savedIndicatorTimer.current);
  }, []);

  const lines = useMemo(() => editorText.split('\n'), [editorText]);

  const highlightedLines = useMemo(() => {
    if (lines.length > 900) return null;
    return lines.map((ln) => tokenizeLine(ln, langProfile.id));
  }, [lines, langProfile.id]);

  const syncScroll = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (gutterRef.current) {
      gutterRef.current.scrollTop = ta.scrollTop;
    }
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop;
      preRef.current.scrollLeft = ta.scrollLeft;
    }
  };

  const handleSave = async (silent = false) => {
    if (fileOperation.current) return false;
    if (!isDirty) return true;
    fileOperation.current = true;
    setIsBusy(true);
    try {
      if (!await saveSourceDraft(vfsEntryId, silent)) return false;
      setJustSaved(true);
      if (savedIndicatorTimer.current) clearTimeout(savedIndicatorTimer.current);
      savedIndicatorTimer.current = setTimeout(() => setJustSaved(false), 1400);
      return true;
    } finally {
      fileOperation.current = false;
      setIsBusy(false);
    }
  };

  const handleDiscard = async () => {
    if (!vfsNode || fileOperation.current) return;
    const discardedDraft = useStudioStore.getState().sourceDrafts[vfsEntryId];
    fileOperation.current = true;
    setIsBusy(true);
    try {
      if (!await openVfsSource(vfsNode, groupId)) return;
      if (useStudioStore.getState().sourceDrafts[vfsEntryId] === discardedDraft) {
        setSourceDraft(vfsEntryId, null);
      }
    } finally {
      fileOperation.current = false;
      setIsBusy(false);
    }
  };

  const handleRunFile = async () => {
    if (!await handleSave(true)) return;
    if (langProfile.canRunNodeOrPy === 'python') {
      await runToolchainTaskAction({
        kind: 'python_run',
        scriptRelPath: relPath,
      });
    } else if (langProfile.canRunNodeOrPy === 'node') {
      await runToolchainTaskAction({
        kind: 'node_run',
        scriptRelPath: relPath,
      });
    }
  };

  const handleCargoCheck = async () => {
    if (!await handleSave(true)) return;
    await runToolchainTaskAction({ kind: 'cargo_check' });
  };

  const handleLiftToCanvas = async () => {
    if (!await handleSave(true)) return;
    const sheet = sheetDocuments[activeSheetId];
    if (!sheet) {
      pushToast('warn', 'Nessun foglio Canvas attivo su cui sollevare il markup.');
      return;
    }
    const artboardId = sheet.rootIds[0] ?? null;
    const preview = previewMarkupImport(sheet, artboardId, draft, 'auto');
    if (preview.ops.length === 0) {
      pushToast('warn', preview.warnings[0] ?? 'Nessun elemento visuale rilevato nel file.');
      return;
    }
    await commitOps(preview.ops, `Solleva ${displayTitle} nel Canvas Visuale`, 'code_sync');
    openTabInGroup({
      kind: 'canvas',
      title: `${sheet.name}.canvas`,
      sheetId: sheet.sheetId,
    });
    pushToast(
      'success',
      `Sollevati ${preview.nodeCount} nodi da "${displayTitle}" (${preview.detectedFormat.toUpperCase()}) nel Canvas Visuale!`,
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      e.stopPropagation();
      void handleSave();
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart ?? 0;
      const end = ta.selectionEnd ?? 0;
      const next = `${ta.value.slice(0, start)}  ${ta.value.slice(end)}`;
      setEditorText(next);
      requestAnimationFrame(() => {
        ta.selectionStart = start + 2;
        ta.selectionEnd = start + 2;
      });
    }
  };

  return (
    <div
      data-testid="code-editor-view"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        background: 'var(--code-bg)',
      }}
    >
      {/* Top Multi-Language Action Toolbar */}
      <div
        className="canvas-subtoolbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '6px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-header)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Code2 size={14} color={langProfile.color} />
          <strong
            style={{
              fontSize: 12,
              fontFamily: "'JetBrains Mono', Consolas, monospace",
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={relPath}
          >
            {relPath}
          </strong>
          <span
            className="badge"
            data-testid="code-editor-lang-badge"
            style={{
              border: `1px solid ${langProfile.color}55`,
              color: langProfile.color,
              background: 'var(--bg-panel-elevated)',
            }}
          >
            {langProfile.badge}
          </span>
          {isDirty && (
            <span
              className="badge amber"
              data-testid="code-editor-dirty-dot"
              title="Modifiche locali non ancora salvate (Ctrl+S)"
            >
              ● Non salvato
            </span>
          )}
          {!isDirty && justSaved && (
            <span className="badge green">
              <Check size={10} /> Salvato
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {langProfile.canLiftToCanvas && (
            <button
              type="button"
              className="studio-btn sm violet"
              data-testid="btn-code-editor-lift-canvas"
              onClick={() => void handleLiftToCanvas()}
              title="Solleva / importa gli elementi UI di questo file sul Canvas Visuale"
            >
              <LayoutGrid size={12} />
              <span>🎨 Apri / Aggiorna nel Canvas Visuale</span>
            </button>
          )}

          {langProfile.canRunNodeOrPy && (
            <button
              type="button"
              className="studio-btn sm"
              data-testid="btn-code-editor-run"
              onClick={() => void handleRunFile()}
              title="Esegui questo file nel Terminale Toolchain"
            >
              <Play size={11} color="var(--accent-emerald)" />
              <span>
                ▶ Esegui con {langProfile.canRunNodeOrPy === 'python' ? 'Python' : 'Node'}
              </span>
            </button>
          )}

          {langProfile.canCargoCheck && (
            <button
              type="button"
              className="studio-btn sm"
              data-testid="btn-code-editor-cargo-check"
              onClick={() => void handleCargoCheck()}
              title="Esegui cargo check sul crate Rust / Tauri"
            >
              <Hammer size={11} color="#f87171" />
              <span>🦀 Cargo Check</span>
            </button>
          )}

          {(langProfile.id === 'javascript' ||
            langProfile.id === 'typescript' ||
            langProfile.id === 'python') && (
            <button
              type="button"
              className="studio-btn sm ghost"
              onClick={() => applyLayoutPreset('split-automation')}
              title="Apri nello Studio Automazioni No-Code"
            >
              <Zap size={11} color="var(--accent-amber)" />
              <span>Automazioni</span>
            </button>
          )}

          {hasWorkbench && (
            <button
              type="button"
              className="studio-btn sm ghost"
              data-testid="btn-code-editor-workbench"
              onClick={() => void openVfsNode(vfsNode, 'workbench')}
              title="Apri questo file nell’editor specializzato"
            >
              {langProfile.isSql && <Database size={11} color="var(--accent-emerald)" />}
              <span>{langProfile.isSql ? 'SQL Studio' : 'Editor specializzato'}</span>
            </button>
          )}

          {isDirty && !externalChangedBanner && (
            <button
              type="button"
              className="studio-btn sm ghost"
              data-testid="btn-code-editor-discard"
              disabled={isBusy}
              onClick={() => void handleDiscard()}
            >
              Scarta modifiche
            </button>
          )}
          <button
            type="button"
            className="studio-btn sm primary"
            data-testid="btn-code-editor-save"
            disabled={!isDirty || isBusy || externalChangedBanner}
            onClick={() => void handleSave()}
            title="Salva modifiche su Disco / VFS (Ctrl+S)"
          >
            <Save size={12} />
            <span>Salva (Ctrl+S)</span>
          </button>
        </div>
      </div>

      {/* External Disk Change Banner */}
      {externalChangedBanner && (
        <div
          role="status"
          data-testid="code-editor-external-conflict"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '5px 12px',
            background: 'var(--accent-amber-soft)',
            borderBottom: '1px solid var(--border-subtle)',
            fontSize: 11.5,
          }}
        >
          <span>Il file è cambiato dall’ultima lettura. La tua bozza è ancora disponibile.</span>
          <button
            type="button"
            className="studio-btn sm"
            data-testid="btn-code-editor-reload"
            disabled={isBusy}
            onClick={() => void handleDiscard()}
          >
            <RefreshCw size={11} />
            <span>Scarta bozza e ricarica il file</span>
          </button>
        </div>
      )}

      {/* Line-Numbered Syntax-Highlighted Code Body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          position: 'relative',
          overflow: 'hidden',
          fontFamily: "'JetBrains Mono', Consolas, monospace",
          fontSize: 12.5,
          lineHeight: '20px',
        }}
      >
        {/* Line Numbers Gutter */}
        <div
          ref={gutterRef}
          data-testid="code-editor-gutter"
          aria-hidden="true"
          style={{
            width: 48,
            flexShrink: 0,
            padding: '12px 8px 12px 4px',
            textAlign: 'right',
            color: 'var(--code-gutter)',
            background: 'var(--bg-panel)',
            borderRight: '1px solid var(--border-subtle)',
            overflow: 'hidden',
            userSelect: 'none',
            fontSize: 11.5,
            lineHeight: '20px',
          }}
        >
          {lines.map((_, idx) => (
            <div key={idx}>{idx + 1}</div>
          ))}
        </div>

        {/* Highlighted Overlay + Editable Textarea */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
          {highlightedLines && (
            <pre
              ref={preRef}
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                margin: 0,
                padding: '12px 14px',
                fontFamily: "'JetBrains Mono', Consolas, monospace",
                fontSize: 12.5,
                lineHeight: '20px',
                tabSize: 2,
                whiteSpace: 'pre',
                overflow: 'hidden',
                pointerEvents: 'none',
                color: 'var(--text-primary)',
              }}
            >
              {highlightedLines.map((spans, lineIdx) => (
                <div key={lineIdx} style={{ minHeight: 20 }}>
                  {spans.map((sp, spIdx) => (
                    <span
                      key={spIdx}
                      style={{
                        color: sp.color,
                        fontStyle: sp.italic ? 'italic' : undefined,
                        fontWeight: sp.bold ? 600 : undefined,
                      }}
                    >
                      {sp.text}
                    </span>
                  ))}
                </div>
              ))}
            </pre>
          )}

          <textarea
            ref={textareaRef}
            data-testid="code-editor-textarea"
            aria-label={`Codice sorgente di ${displayTitle}`}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            value={editorText}
            onChange={(e) => setEditorText(e.target.value)}
            onScroll={syncScroll}
            onKeyDown={handleKeyDown}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              margin: 0,
              padding: '12px 14px',
              border: 'none',
              outline: 'none',
              resize: 'none',
              fontFamily: "'JetBrains Mono', Consolas, monospace",
              fontSize: 12.5,
              lineHeight: '20px',
              tabSize: 2,
              whiteSpace: 'pre',
              overflow: 'auto',
              background: highlightedLines ? 'transparent' : 'var(--code-bg)',
              color: highlightedLines ? 'transparent' : 'var(--text-primary)',
              caretColor: 'var(--text-primary)',
            }}
          />
        </div>
      </div>

      {/* Footer Status Strip */}
      <div
        style={{
          height: 22,
          padding: '0 12px',
          borderTop: '1px solid var(--border-subtle)',
          background: 'var(--bg-header)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 10.5,
          color: 'var(--text-muted)',
        }}
      >
        <span>
          {lines.length} righe • {draft.length} caratteri • UTF-8
        </span>
        <span>
          {vfsNode?.syncMode === 'two_way_disk' ? '📂 Sincronizzato su Disco' : '🗄️ VFS SQLite'}
        </span>
      </div>
    </div>
  );
};
