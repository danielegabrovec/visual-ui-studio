import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Cpu, Database, Play, RefreshCw, Terminal, Workflow } from 'lucide-react';
import { useStudioStore, type ConsoleLogEntry } from '@renderer/state/studio-store';
import { buildSandboxPreviewHtml, type SandboxScriptFileInput } from '@renderer/utils/sandbox-html-builder';
import type { SqlCellValue, SqlDesignDocument } from '@shared/sql-ir';

type SandboxLogKind = 'htmx' | 'ipc' | 'state' | 'script' | 'blueprint' | 'sql';

interface SandboxEventLog {
  id: string;
  kind: SandboxLogKind;
  summary: string;
  time: string;
}

function mapSandboxKindToConsoleKind(kind: SandboxLogKind, level?: string): ConsoleLogEntry['kind'] {
  if (level === 'error') return 'error';
  if (level === 'warn') return 'warn';
  if (kind === 'sql') return 'sql';
  if (kind === 'blueprint') return 'blueprint';
  if (kind === 'script') return 'script';
  if (kind === 'htmx') return 'htmx';
  if (kind === 'ipc') return 'ipc';
  return 'info';
}

function badgeClassForSandboxKind(kind: SandboxLogKind): string {
  if (kind === 'htmx' || kind === 'sql') return 'green';
  if (kind === 'blueprint') return 'amber';
  if (kind === 'script' || kind === 'ipc') return 'violet';
  return 'blue';
}

function buildSqlFromSandboxPayload(
  payload: Record<string, unknown>,
  sqlDoc: SqlDesignDocument | null,
): { sql: string; parameters?: SqlCellValue[] | Record<string, SqlCellValue> } {
  if (typeof payload.sql === 'string' && payload.sql.trim()) {
    const rawParams = (payload.params ?? payload.values) as Record<string, SqlCellValue> | SqlCellValue[] | undefined;
    return { sql: payload.sql.trim(), parameters: rawParams };
  }

  const queryId = typeof payload.queryId === 'string' ? payload.queryId : '';
  if (queryId && sqlDoc) {
    const named = sqlDoc.namedQueries.find((q) => q.id === queryId || q.name === queryId);
    const querySql = named?.sqlByDialect?.[sqlDoc.dialect] ?? named?.canonicalSql ?? named?.sql;
    if (querySql?.trim()) {
      return {
        sql: querySql.trim(),
        parameters: (payload.params ?? payload.values) as Record<string, SqlCellValue> | undefined,
      };
    }
  }

  const op = String(payload.operation ?? 'SELECT').toUpperCase();
  const rawTable = String(payload.table ?? sqlDoc?.tables[0]?.name ?? 'items').replace(/[^A-Za-z0-9_]/g, '');
  const valuesObj =
    payload.values && typeof payload.values === 'object' && !Array.isArray(payload.values)
      ? (payload.values as Record<string, SqlCellValue>)
      : payload.params && typeof payload.params === 'object' && !Array.isArray(payload.params)
        ? (payload.params as Record<string, SqlCellValue>)
        : {};

  if (op === 'INSERT') {
    const cols = Object.keys(valuesObj).filter((k) => /^[A-Za-z0-9_]+$/.test(k));
    if (cols.length > 0) {
      const placeholders = cols.map(() => '?').join(', ');
      return {
        sql: `INSERT INTO "${rawTable}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`,
        parameters: cols.map((c) => valuesObj[c] ?? null),
      };
    }
  }

  if (op === 'DELETE' && valuesObj.id !== undefined) {
    return {
      sql: `DELETE FROM "${rawTable}" WHERE "id" = ?`,
      parameters: [valuesObj.id],
    };
  }

  return { sql: `SELECT * FROM "${rawTable}" LIMIT 100` };
}

export const LiveSandboxPreview: React.FC<{ sheetId: string }> = ({ sheetId }) => {
  const project = useStudioStore((s) => s.project);
  const sheet = useStudioStore((s) => s.sheetDocuments[sheetId]);
  const tokens = useStudioStore((s) => s.tokens);
  const themes = useStudioStore((s) => s.themes);
  const studioTheme = useStudioStore((s) => s.studioTheme);
  const vfsTree = useStudioStore((s) => s.vfsTree);
  const sourceFiles = useStudioStore((s) => s.sourceFiles);
  const blueprintGraphs = useStudioStore((s) => s.blueprintGraphs);
  const threeScenes = useStudioStore((s) => s.threeScenes);
  const sqlDocument = useStudioStore((s) => s.sqlDocument);
  const executeSqlQueryAction = useStudioStore((s) => s.executeSqlQueryAction);
  const appendConsoleEntry = useStudioStore((s) => s.appendConsoleEntry);
  const setBottomConsoleOpen = useStudioStore((s) => s.setBottomConsoleOpen);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [logs, setLogs] = useState<SandboxEventLog[]>([
    {
      id: 'init_1',
      kind: 'htmx',
      summary:
        'Sandbox interattiva pronta — Moduli ES Separati (.js/.ts), Automazioni No-Code, SQL Bridge, Blueprint & IPC attivi.',
      time: new Date().toLocaleTimeString(),
    },
  ]);

  const scriptFiles = useMemo<SandboxScriptFileInput[]>(() => {
    const items: SandboxScriptFileInput[] = [];
    const linkedIds = new Set(sheet?.linkedScripts?.map((script) => script.vfsEntryId));
    for (const node of Object.values(sheet?.nodes ?? {})) {
      for (const interaction of node.interactions ?? []) {
        if (interaction.action.kind === 'call_script_fn' && interaction.action.vfsEntryId) {
          linkedIds.add(interaction.action.vfsEntryId);
        }
      }
    }
    for (const entry of vfsTree) {
      if (entry.virtualPath.startsWith('/generated/') && !linkedIds.has(entry.id)) continue;
      if (
        (entry.entryKind === 'script_file' || /\.(ts|js|mjs)$/i.test(entry.name)) &&
        !entry.name.endsWith('.generated.ts')
      ) {
        const content = sourceFiles[entry.id];
        if (typeof content === 'string' && content.trim().length > 0) {
          const relativePath = (entry.diskRelPath || entry.virtualPath || `scripts/${entry.name}`).replace(/^\/+/, '');
          items.push({ id: entry.id, name: entry.name, relativePath, content });
        }
      }
    }
    return items;
  }, [vfsTree, sourceFiles, sheet]);

  const blueprintList = useMemo(() => Object.values(blueprintGraphs), [blueprintGraphs]);
  const threeSceneList = useMemo(() => Object.values(threeScenes), [threeScenes]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const frame = iframeRef.current;
      if (!ev.data || !frame?.contentWindow || ev.source !== frame.contentWindow) return;

      if (ev.data.source === 'studio-sandbox-sql-req' && ev.data.reqId) {
        const reqId = String(ev.data.reqId);
        const payload = (ev.data.payload ?? {}) as Record<string, unknown>;
        const { sql, parameters } = buildSqlFromSandboxPayload(payload, sqlDocument);

        void executeSqlQueryAction({
          sql,
          parameters,
          connectionId: null,
          dialect: sqlDocument?.dialect,
          sandboxMode: true,
          schemaDoc: sqlDocument ?? undefined,
        }).then((res) => {
          const reply = res
            ? { ok: res.ok, rows: res.rows, rowCount: res.affectedRows ?? res.rows.length, error: res.error }
            : { ok: false, error: 'Esecuzione SQL non disponibile.' };
          if (iframeRef.current !== frame) return;
          frame.contentWindow?.postMessage(
            { source: 'studio-sandbox-sql-res', reqId, result: reply },
            '*',
          );
          if (res) {
            const summary = res.error
              ? `SQL Error: ${res.error}`
              : `SQL OK (${res.rows.length} righe${res.affectedRows ? `, ${res.affectedRows} modificate` : ''}): ${sql}`;
            setLogs((prev) => [
              {
                id: `${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
                kind: 'sql',
                summary,
                time: new Date().toLocaleTimeString(),
              },
              ...prev.slice(0, 39),
            ]);
          }
        }).catch((error) => {
          if (iframeRef.current !== frame) return;
          frame.contentWindow?.postMessage({
            source: 'studio-sandbox-sql-res', reqId,
            result: { ok: false, error: error instanceof Error ? error.message : String(error) },
          }, '*');
        });
        return;
      }

      if (ev.data.source === 'studio-sandbox') {
        const rawKind = String(ev.data.kind || 'script');
        const safeKind: SandboxLogKind =
          rawKind === 'htmx' ||
          rawKind === 'ipc' ||
          rawKind === 'state' ||
          rawKind === 'blueprint' ||
          rawKind === 'sql' ||
          rawKind === 'script'
            ? rawKind
            : 'script';
        const summary = String(ev.data.summary || '');
        const level = typeof ev.data.level === 'string' ? ev.data.level : undefined;

        setLogs((prev) => [
          {
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            kind: safeKind,
            summary,
            time: new Date().toLocaleTimeString(),
          },
          ...prev.slice(0, 39),
        ]);

        appendConsoleEntry({
          kind: mapSandboxKindToConsoleKind(safeKind, level),
          source:
            safeKind === 'blueprint'
              ? 'Sandbox Blueprint'
              : safeKind === 'sql'
                ? 'Sandbox SQL'
                : safeKind === 'script'
                  ? 'Sandbox TS/JS'
                  : 'Sandbox',
          message: summary,
        });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [appendConsoleEntry, executeSqlQueryAction, sqlDocument]);

  const effectiveThemeId = useMemo(() => {
    if (project?.activeThemeId) return project.activeThemeId;
    const match = themes.find((t) => t.name.toLowerCase() === studioTheme);
    return match?.id ?? null;
  }, [project?.activeThemeId, themes, studioTheme]);

  const srcDoc = useMemo(() => {
    if (!sheet) return '';
    void reloadNonce;
    return buildSandboxPreviewHtml(sheet, tokens, effectiveThemeId, {
      scriptFiles,
      blueprintGraphs: blueprintList,
      threeScenes: threeSceneList,
      sqlDocument: sqlDocument ?? undefined,
      studioTheme,
    });
  }, [sheet, tokens, effectiveThemeId, studioTheme, scriptFiles, blueprintList, threeSceneList, sqlDocument, reloadNonce]);

  if (!sheet) {
    return <div style={{ padding: 20 }}>Nessun foglio attivo per la preview.</div>;
  }
  if (project && !sqlDocument) {
    return <div role="status" style={{ padding: 20 }}>Preparazione dell’anteprima…</div>;
  }

  return (
    <div
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-panel)' }}
      data-testid="live-sandbox-preview"
    >
      {/* Top Sandbox Controls */}
      <div className="canvas-subtoolbar" style={{ flexWrap: 'wrap', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <Play size={13} color="var(--accent-emerald)" />
          <span style={{ fontWeight: 600 }}>Live Interactive Sandbox — {sheet.name}</span>
          <span className="badge green">HTMX / IPC</span>
          <span className="badge violet" title="Moduli TypeScript/JS compilati e iniettati nella Sandbox">
            <Cpu size={10} /> {scriptFiles.length} Script TS/JS
          </span>
          <span className="badge amber" title="Grafi Blueprint compilati in JS runtime nella Sandbox">
            <Workflow size={10} /> {blueprintList.length} Blueprint
          </span>
          <span className="badge blue" title="Tabelle SQL collegate al Sandbox SQL Bridge">
            <Database size={10} /> {sqlDocument?.tables.length ?? 0} SQL Tables
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            className="studio-btn sm ghost"
            onClick={() => setBottomConsoleOpen(true)}
            title="Apri Console Globale Studio"
          >
            <Terminal size={12} />
            <span>Console IDE</span>
          </button>

          <button
            type="button"
            className="studio-btn sm"
            data-testid="btn-reset-sandbox"
            onClick={() => setReloadNonce((n) => n + 1)}
            title="Ricarica stato sandbox"
          >
            <RefreshCw size={12} />
            <span>Reset Sandbox</span>
          </button>
        </div>
      </div>

      {/* Sandboxed iframe */}
      <iframe
        ref={iframeRef}
        key={`${sheet.sheetId}_${reloadNonce}`}
        title={`Live Sandbox Preview - ${sheet.name}`}
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        data-testid="sandbox-preview-iframe"
        style={{
          flex: 1,
          width: '100%',
          border: 'none',
          background: '#0b1120',
        }}
      />

      {/* Hypermedia, Script TS, Blueprint & IPC Event Console */}
      <div
        style={{
          height: 120,
          minHeight: 120,
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
            <Terminal size={12} /> RUNTIME TRACE: SCRIPT TS • BLUEPRINT • HTMX • IPC
          </span>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Activity size={11} color="var(--accent-emerald)" /> {logs.length} eventi
            </span>
            <button
              type="button"
              className="studio-btn sm ghost"
              style={{ height: 18, padding: '0 5px', fontSize: 10 }}
              onClick={() => setLogs([])}
            >
              Pulisci
            </button>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '4px 10px',
            fontFamily: "'JetBrains Mono', Consolas, monospace",
            fontSize: 11,
          }}
        >
          {logs.map((item) => (
            <div key={item.id} style={{ padding: '2px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>[{item.time}]</span>
              <span className={`badge ${badgeClassForSandboxKind(item.kind)}`} style={{ flexShrink: 0 }}>
                {item.kind.toUpperCase()}
              </span>
              <span style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>{item.summary}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
