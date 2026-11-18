import React, { useMemo, useState } from 'react';
import {
  ExternalLink,
  Loader2,
  Play,
  Square,
  Terminal,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { useStudioStore, type ConsoleLogEntry } from '@renderer/state/studio-store';

type ConsoleFilter = 'all' | 'terminal' | 'sql' | 'script' | 'blueprint' | 'warn_error';

export const BottomConsoleDrawer: React.FC = () => {
  const project = useStudioStore((s) => s.project);
  const bottomConsoleOpen = useStudioStore((s) => s.bottomConsoleOpen);
  const bottomConsoleHeight = useStudioStore((s) => s.bottomConsoleHeight);
  const consoleEntries = useStudioStore((s) => s.consoleEntries);
  const toolchainTasks = useStudioStore((s) => s.toolchainTasks);

  const setBottomConsoleOpen = useStudioStore((s) => s.setBottomConsoleOpen);
  const setBottomConsoleHeight = useStudioStore((s) => s.setBottomConsoleHeight);
  const clearConsoleEntries = useStudioStore((s) => s.clearConsoleEntries);
  const selectNodeFromCode = useStudioStore((s) => s.selectNodeFromCode);
  const runToolchainTaskAction = useStudioStore((s) => s.runToolchainTaskAction);
  const stopToolchainTaskAction = useStudioStore((s) => s.stopToolchainTaskAction);

  const [filter, setFilter] = useState<ConsoleFilter>('all');

  const runningTasks = useMemo(
    () => toolchainTasks.filter((t) => t.status === 'running'),
    [toolchainTasks],
  );

  const terminalCount = useMemo(
    () => consoleEntries.filter((e) => e.kind === 'terminal').length,
    [consoleEntries],
  );
  const sqlCount = useMemo(
    () => consoleEntries.filter((e) => e.kind === 'sql').length,
    [consoleEntries],
  );

  const filteredEntries = useMemo(() => {
    if (filter === 'all') return consoleEntries;
    if (filter === 'terminal') return consoleEntries.filter((e) => e.kind === 'terminal');
    if (filter === 'sql') return consoleEntries.filter((e) => e.kind === 'sql');
    if (filter === 'script') return consoleEntries.filter((e) => e.kind === 'script' || e.kind === 'log');
    if (filter === 'blueprint') return consoleEntries.filter((e) => e.kind === 'blueprint');
    return consoleEntries.filter((e) => e.kind === 'warn' || e.kind === 'error');
  }, [consoleEntries, filter]);

  if (!bottomConsoleOpen) return null;

  const handleResizeDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const orig = bottomConsoleHeight;
    const onMove = (ev: PointerEvent) => {
      setBottomConsoleHeight(orig - (ev.clientY - startY));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const badgeClassForKind = (kind: ConsoleLogEntry['kind']): string => {
    if (kind === 'terminal') return 'badge blue';
    if (kind === 'sql') return 'badge green';
    if (kind === 'blueprint') return 'badge violet';
    if (kind === 'script') return 'badge blue';
    if (kind === 'warn') return 'badge amber';
    if (kind === 'error') return 'badge';
    return 'badge green';
  };

  const formatTime = (ts: number) => {
    try {
      return new Date(ts).toLocaleTimeString('it-IT', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return '';
    }
  };

  return (
    <section
      className="bottom-console-drawer"
      style={{ height: bottomConsoleHeight }}
      data-testid="bottom-console-drawer"
    >
      <div
        className="sash-horizontal"
        onPointerDown={handleResizeDown}
        title="Trascina per ridimensionare la Console"
      />

      <div className="console-header" style={{ overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Terminal size={13} color="var(--accent-primary)" />
          <strong style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>Console &amp; Toolchain</strong>
          <div className="segmented-group">
            {(
              [
                ['all', `Tutti (${consoleEntries.length})`],
                ['terminal', `Terminale Toolchain${terminalCount > 0 ? ` (${terminalCount})` : ''}`],
                ['sql', `SQL Log${sqlCount > 0 ? ` (${sqlCount})` : ''}`],
                ['script', 'Script JS/TS'],
                ['blueprint', 'Blueprint'],
                ['warn_error', 'Diagnostica'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                data-testid={`console-tab-${id}`}
                className={`segmented-item ${filter === id ? 'active' : ''}`}
                style={{ height: 20, fontSize: 10.5 }}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {runningTasks.map((task) => (
            <div
              key={task.taskId}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '1px 7px',
                borderRadius: 6,
                background: 'var(--accent-soft)',
                border: '1px solid var(--border-focus)',
                fontSize: 10.5,
              }}
            >
              <Loader2 size={11} className="spin-icon" color="var(--accent-primary)" />
              <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {task.label}
              </span>
              {task.serverUrl && (
                <a
                  href={task.serverUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    color: 'var(--accent-emerald)',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 2,
                    textDecoration: 'none',
                  }}
                >
                  <span>{task.serverUrl}</span>
                  <ExternalLink size={10} />
                </a>
              )}
              <button
                type="button"
                className="studio-btn sm danger"
                style={{ height: 18, padding: '0 5px', fontSize: 10 }}
                data-testid="btn-stop-toolchain-task"
                onClick={() => void stopToolchainTaskAction(task.taskId)}
                title="Interrompi processo e figli (taskkill /T /F)"
              >
                <Square size={9} />
                <span>Stop</span>
              </button>
            </div>
          ))}

          {project && runningTasks.length === 0 && (
            <>
              <button
                type="button"
                className="studio-btn sm ghost"
                data-testid="btn-console-run-init"
                onClick={() => {
                  setFilter('terminal');
                  void runToolchainTaskAction({ kind: 'init' });
                }}
                title="Esegui inizializzazione dipendenze (npm install / .venv / cargo check)"
              >
                <Wrench size={11} />
                <span>Inizializza</span>
              </button>
              <button
                type="button"
                className="studio-btn sm ghost"
                data-testid="btn-console-run-dev"
                onClick={() => {
                  setFilter('terminal');
                  void runToolchainTaskAction({ kind: 'dev' });
                }}
                title="Avvia server di sviluppo live per lo stack corrente"
              >
                <Play size={11} color="var(--accent-emerald)" />
                <span>Avvia Dev</span>
              </button>
            </>
          )}

          <button
            type="button"
            className="studio-btn sm ghost"
            data-testid="btn-clear-console"
            onClick={() => clearConsoleEntries()}
            title="Pulisci output console"
          >
            <Trash2 size={11} />
            <span>Pulisci</span>
          </button>
          <button
            type="button"
            className="studio-btn sm ghost"
            data-testid="btn-close-console"
            onClick={() => setBottomConsoleOpen(false)}
            title="Nascondi console (Ctrl+J)"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      <div className="console-log-list" data-testid="console-log-list">
        {filteredEntries.length === 0 ? (
          <div style={{ padding: 10, color: 'var(--text-muted)' }}>
            Nessun evento registrato per questo filtro. Avvia il Toolchain Runner, una Query SQL o uno Script JS/TS/Python per vedere lo stream in tempo reale.
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const urlMatch = entry.message.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+\S*/i);
            return (
              <div
                key={entry.id}
                className="console-log-row"
                style={{ cursor: entry.nodeId ? 'pointer' : 'default' }}
                onClick={() => {
                  if (entry.nodeId) selectNodeFromCode(entry.nodeId);
                }}
              >
                <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{formatTime(entry.timestamp)}</span>
                <span
                  className={badgeClassForKind(entry.kind)}
                  style={
                    entry.kind === 'error'
                      ? { background: 'var(--accent-danger-soft)', color: 'var(--accent-danger)' }
                      : undefined
                  }
                >
                  {entry.kind.toUpperCase()}
                </span>
                <span style={{ color: 'var(--accent-primary)', fontWeight: 600, flexShrink: 0 }}>
                  [{entry.source}]
                </span>
                <span style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                  {entry.message}{' '}
                  {urlMatch && (
                    <a
                      href={urlMatch[0]}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--accent-emerald)', fontWeight: 600, marginLeft: 6 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      [Apri {urlMatch[0]}]
                    </a>
                  )}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
