import React, { useState } from 'react';
import { CheckCircle2, Database, PlugZap, ShieldCheck, Trash2, X } from 'lucide-react';
import { SQL_DIALECT_CATALOG, type SqlConnectionProfile, type SqlDialect } from '@shared/sql-ir';
import { getStudioApi } from '@renderer/api/studio-client';

export interface SqlConnectionModalProps {
  projectId: string;
  connections: SqlConnectionProfile[];
  onClose: () => void;
  onConnectionsUpdated: (list: SqlConnectionProfile[], activeId?: string | null) => void;
  onIntrospectedSchema?: () => void;
}

export const SqlConnectionModal: React.FC<SqlConnectionModalProps> = ({
  projectId,
  connections,
  onClose,
  onConnectionsUpdated,
  onIntrospectedSchema,
}) => {
  const [name, setName] = useState('Server PostgreSQL Locale');
  const [dialect, setDialect] = useState<SqlDialect>('postgresql');
  const [mode, setMode] = useState<SqlConnectionProfile['mode']>('remote');
  const [sqliteFilePath, setSqliteFilePath] = useState('data/app.sqlite');
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState('5432');
  const [database, setDatabase] = useState('app_db');
  const [username, setUsername] = useState('postgres');
  const [password, setPassword] = useState('');
  const [envVarRef, setEnvVarRef] = useState('');
  const [ssl, setSsl] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const handleChangeDialect = (nextDialect: SqlDialect) => {
    setDialect(nextDialect);
    const meta = SQL_DIALECT_CATALOG.find((d) => d.id === nextDialect);
    if (nextDialect === 'sqlite') {
      setMode('local_sqlite');
      setName('SQLite File Locale');
    } else {
      setMode('remote');
      setPort(String(meta?.defaultPort ?? 5432));
      setName(`Connessione ${meta?.shortLabel ?? nextDialect}`);
      setUsername(
        nextDialect === 'postgresql'
          ? 'postgres'
          : nextDialect === 'sqlserver'
            ? 'sa'
            : 'root',
      );
    }
  };

  const handleSaveAndTest = async (andIntrospect = false) => {
    setBusy(true);
    setStatusMsg(null);
    try {
      const api = getStudioApi();
      const saved = await api.sql.saveConnection(
        {
          projectId,
          name: name.trim() || `DB ${dialect}`,
          dialect,
          mode: dialect === 'sqlite' ? 'local_sqlite' : mode,
          sqliteFilePath: dialect === 'sqlite' ? sqliteFilePath.trim() : undefined,
          host: dialect !== 'sqlite' ? host.trim() : undefined,
          port: dialect !== 'sqlite' && port ? Number(port) : undefined,
          database: dialect !== 'sqlite' ? database.trim() : undefined,
          username: dialect !== 'sqlite' ? username.trim() : undefined,
          ssl,
          envVarRef: envVarRef.trim() || undefined,
          readOnly,
        },
        password || undefined,
      );

      const all = await api.sql.listConnections(projectId);
      onConnectionsUpdated(all, saved.id);

      const testRes = await api.sql.testConnection(saved.id, password || undefined);
      setStatusMsg({
        ok: testRes.ok,
        text: testRes.ok
          ? `${testRes.message}${testRes.version ? ` — ${testRes.version}` : ''} (${testRes.latencyMs ?? 1}ms)`
          : `Connessione salvata ma test fallito: ${testRes.message}`,
      });

      if (testRes.ok && andIntrospect) {
        const introspected = await api.sql.introspectConnection(saved.id);
        await api.sql.saveSchema(projectId, introspected);
        onIntrospectedSchema?.();
      }
    } catch (err) {
      setStatusMsg({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteConnection = async (id: string) => {
    const api = getStudioApi();
    await api.sql.deleteConnection(id);
    const updated = await api.sql.listConnections(projectId);
    onConnectionsUpdated(updated, null);
  };

  return (
    <div
      data-testid="sql-connection-modal"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        background: 'rgba(5, 8, 16, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          width: 640,
          maxWidth: '96vw',
          maxHeight: '90vh',
          overflowY: 'auto',
          borderRadius: 14,
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-strong)',
          boxShadow: 'var(--shadow-lg)',
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Database size={18} style={{ color: 'var(--accent-primary)' }} />
            <h3 style={{ margin: 0, fontSize: 15 }}>
              Connessioni Database (SQLite, PostgreSQL, MySQL, MariaDB, SQL Server)
            </h3>
          </div>
          <button type="button" onClick={onClose} style={closeBtnStyle}>
            <X size={15} />
          </button>
        </div>

        {/* Existing Profiles */}
        {connections.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600 }}>
              Profili salvati nel progetto ({connections.length})
            </span>
            {connections.map((c) => (
              <div
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 10px',
                  borderRadius: 8,
                  background: 'var(--bg-panel-elevated)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div>
                  <strong>{c.name}</strong>{' '}
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    ({c.dialect} · {c.mode === 'local_sqlite' ? c.sqliteFilePath : `${c.host}:${c.port}/${c.database}`})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDeleteConnection(c.id)}
                  style={{ border: 'none', background: 'transparent', color: 'var(--accent-danger)', cursor: 'pointer' }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* New Connection Form */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={lblStyle}>
            <span>Motore SQL</span>
            <select
              data-testid="sql-conn-dialect"
              value={dialect}
              onChange={(e) => handleChangeDialect(e.target.value as SqlDialect)}
              style={fieldStyle}
            >
              {SQL_DIALECT_CATALOG.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label} ({d.driverPackage})
                </option>
              ))}
            </select>
          </label>

          <label style={lblStyle}>
            <span>Nome Profilo</span>
            <input
              data-testid="sql-conn-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={fieldStyle}
            />
          </label>
        </div>

        {dialect === 'sqlite' ? (
          <label style={lblStyle}>
            <span>Percorso File SQLite (.sqlite / .db relativo al progetto o assoluto)</span>
            <input
              data-testid="sql-conn-sqlite-path"
              value={sqliteFilePath}
              onChange={(e) => setSqliteFilePath(e.target.value)}
              placeholder="data/app.sqlite"
              style={fieldStyle}
            />
          </label>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 1fr', gap: 10 }}>
              <label style={lblStyle}>
                <span>Host / Server</span>
                <input value={host} onChange={(e) => setHost(e.target.value)} style={fieldStyle} />
              </label>
              <label style={lblStyle}>
                <span>Porta</span>
                <input value={port} onChange={(e) => setPort(e.target.value)} style={fieldStyle} />
              </label>
              <label style={lblStyle}>
                <span>Database</span>
                <input value={database} onChange={(e) => setDatabase(e.target.value)} style={fieldStyle} />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <label style={lblStyle}>
                <span>Utente</span>
                <input value={username} onChange={(e) => setUsername(e.target.value)} style={fieldStyle} />
              </label>
              <label style={lblStyle}>
                <span>Password / URI (cifrata OS safeStorage)</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={fieldStyle}
                />
              </label>
              <label style={lblStyle}>
                <span>Oppure Variabile .env</span>
                <input
                  value={envVarRef}
                  onChange={(e) => setEnvVarRef(e.target.value)}
                  placeholder="DATABASE_URL"
                  style={fieldStyle}
                />
              </label>
            </div>
          </>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12 }}>
          {dialect !== 'sqlite' && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={ssl} onChange={(e) => setSsl(e.target.checked)} />
              Connessione TLS / SSL
            </label>
          )}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
            Modalità Sola Lettura (blocca scritture e DDL)
          </label>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 10px',
            borderRadius: 8,
            background: 'var(--bg-panel-elevated)',
            fontSize: 11.5,
            color: 'var(--text-secondary)',
          }}
        >
          <ShieldCheck size={14} style={{ color: 'var(--accent-emerald)', flexShrink: 0 }} />
          Le credenziali non vengono mai scritte in chiaro nel progetto VFS: sono protette tramite DPAPI / Keychain di sistema.
        </div>

        {statusMsg && (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              background: statusMsg.ok ? 'var(--accent-emerald-soft)' : 'var(--accent-amber-soft)',
              color: statusMsg.ok ? 'var(--accent-emerald)' : 'var(--accent-amber)',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <CheckCircle2 size={14} /> {statusMsg.text}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '7px 14px',
              borderRadius: 7,
              border: '1px solid var(--border-subtle)',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            Chiudi
          </button>
          <button
            type="button"
            disabled={busy}
            data-testid="btn-sql-conn-save-test"
            onClick={() => void handleSaveAndTest(false)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 14px',
              borderRadius: 7,
              border: '1px solid var(--accent-primary)',
              background: 'var(--accent-soft)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <PlugZap size={14} /> Salva &amp; Testa Connessione
          </button>
          <button
            type="button"
            disabled={busy}
            data-testid="btn-sql-conn-introspect"
            onClick={() => void handleSaveAndTest(true)}
            style={{
              padding: '7px 14px',
              borderRadius: 7,
              border: 'none',
              background: 'var(--accent-primary)',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Salva &amp; Importa Schema dal DB
          </button>
        </div>
      </div>
    </div>
  );
};

const lblStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 11.5,
  color: 'var(--text-secondary)',
};

const fieldStyle: React.CSSProperties = {
  padding: '6px 9px',
  borderRadius: 6,
  border: '1px solid var(--border-strong)',
  background: 'var(--bg-input)',
  color: 'var(--text-primary)',
  fontSize: 12,
};

const closeBtnStyle: React.CSSProperties = {
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-panel-elevated)',
  borderRadius: 6,
  width: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
};
