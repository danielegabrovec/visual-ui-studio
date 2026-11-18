import React, { useMemo, useRef, useState } from 'react';
import { Check, Code2, Copy, FolderDown, RotateCcw } from 'lucide-react';
import { generateRustTauriSqlInstallBundle, generateSqlCodeBundle } from '@codegen/sql-codegen';
import {
  inferVfsKindFromFilename,
  type VfsNodeDTO,
} from '@shared/ipc-contract';
import type { SqlCodegenTargetKind, SqlDesignDocument, SqlDialect } from '@shared/sql-ir';
import { getStudioApi } from '@renderer/api/studio-client';
import { useStudioStore } from '@renderer/state/studio-store';
import type { TargetArtifactBundle } from '@shared/ui-ir';
import { SqlScriptEditor } from './SqlScriptEditor';

export type MaterializedSqlFiles = Map<string, { id: string; content: string }>;

export interface SqlCodegenPanelProps {
  sqlDocument: SqlDesignDocument;
  dialect: SqlDialect;
  drafts: Record<string, string>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  materializedFiles: MaterializedSqlFiles;
}

const CODEGEN_TARGETS: Array<{
  id: SqlCodegenTargetKind;
  label: string;
  badge: string;
  description: string;
}> = [
  {
    id: 'js-node',
    label: 'JavaScript (Node.js + Express)',
    badge: 'JS',
    description: 'db/schema.sql + db/connection.js (node:sqlite / pg / mysql2 / mssql) + db/repository.js + CRUD routes',
  },
  {
    id: 'ts-drizzle',
    label: 'TypeScript (Drizzle ORM)',
    badge: 'TS',
    description: 'src/db/schema.ts + src/db/queries.ts + drizzle.config.ts tipizzati',
  },
  {
    id: 'ts-prisma',
    label: 'TypeScript (Prisma ORM)',
    badge: 'PRISMA',
    description: 'prisma/schema.prisma + PrismaClient singleton + repository tipizzato',
  },
  {
    id: 'ts-kysely',
    label: 'TypeScript (Kysely)',
    badge: 'SQL',
    description: 'Client per il dialetto selezionato, schema TypeScript e repository CRUD parametrizzati',
  },
  {
    id: 'ts-nextjs',
    label: 'Next.js App Router (Server Actions + API)',
    badge: 'NEXT',
    description: "'use server' Actions + app/api/<table>/route.ts + Drizzle schema",
  },
  {
    id: 'python-fastapi',
    label: 'Python (SQLAlchemy 2.0 + FastAPI + sqlite3)',
    badge: 'PY',
    description: 'db/models.py + db/crud.py (Pydantic v2) + routers/db_router.py',
  },
  {
    id: 'rust-tauri',
    label: 'Rust + Tauri v2 (SQLite con rusqlite)',
    badge: 'RUST',
    description: 'src-tauri/src/db.rs (#[tauri::command] CRUD) + wrapper TS invoke()',
  },
];

export const SqlCodegenPanel: React.FC<SqlCodegenPanelProps> = ({
  sqlDocument, dialect, drafts, setDrafts, materializedFiles,
}) => {
  const project = useStudioStore((s) => s.project);
  const pushToast = useStudioStore((s) => s.pushToast);
  const appendConsoleEntry = useStudioStore((s) => s.appendConsoleEntry);

  const [targetKind, setTargetKind] = useState<SqlCodegenTargetKind>('js-node');
  const [includeRestRoutes, setIncludeRestRoutes] = useState(true);
  const [includeSeedScript, setIncludeSeedScript] = useState(true);
  const [selectedFilePath, setSelectedFilePath] = useState<string>('');
  const [writingToProject, setWritingToProject] = useState(false);
  const saveInProgress = useRef(false);
  const [writtenDone, setWrittenDone] = useState(false);
  const installRustModule = targetKind === 'rust-tauri' && project?.stackId === 'rust-tauri' && Boolean(project.rootDiskPath && window.studioApi);

  const generation = useMemo<{ bundle?: TargetArtifactBundle; error?: string }>(() => {
    const generate = installRustModule ? generateRustTauriSqlInstallBundle : generateSqlCodeBundle;
    try {
      return { bundle: generate({
        schema: sqlDocument,
        targetKind,
        dialect,
        includeRestRoutes,
        includeSeedScript,
      }) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [sqlDocument, targetKind, dialect, includeRestRoutes, includeSeedScript, installRustModule]);

  const bundle = generation.bundle;
  const files = bundle?.files ?? [];
  const draftKey = (path: string) => JSON.stringify([
    sqlDocument.projectId, targetKind, dialect, includeRestRoutes, includeSeedScript, installRustModule, path,
  ]);
  const activeFile = files.find((file) => file.relativePath === selectedFilePath) ?? files[0];
  const activeDraftKey = activeFile ? draftKey(activeFile.relativePath) : undefined;
  const activeCode = activeDraftKey ? drafts[activeDraftKey] ?? activeFile?.code ?? '' : '';
  const isEdited = activeFile && activeCode !== activeFile.code;
  const isBlocked = bundle?.diagnostics.some((diagnostic) => diagnostic.severity === 'error');

  const handleChangeCode = (code: string) => {
    if (!activeFile || !activeDraftKey) return;
    setDrafts((current) => {
      if (code !== activeFile.code) return { ...current, [activeDraftKey]: code };
      const next = { ...current };
      delete next[activeDraftKey];
      return next;
    });
  };

  const handleCopyFile = async () => {
    if (!activeFile) return;
    try {
      await navigator.clipboard.writeText(activeCode);
      pushToast('success', `Copiato ${activeFile.relativePath}.`);
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error));
    }
  };

  const handleWriteModuleIntoProject = async () => {
    if (!project || !bundle || isBlocked || saveInProgress.current) return;
    const editedBundle = {
      ...bundle,
      files: files.map((file) => ({ ...file, code: drafts[draftKey(file.relativePath)] ?? file.code })),
    };
    saveInProgress.current = true;
    setWritingToProject(true);
    try {
      const api = getStudioApi();
      if (installRustModule) {
        const { writtenPaths } = await api.sql.installRustTauriModule(project.id, editedBundle);
        useStudioStore.setState({ vfsTree: await api.vfs.listTree(project.id) });
        appendConsoleEntry({
          kind: 'sql',
          source: 'SQL Codegen (Rust + Tauri)',
          message: writtenPaths.length ? `Modulo SQLite registrato in Tauri. File aggiornati: ${writtenPaths.join(', ')}` : 'Modulo SQLite già registrato in Tauri.',
        });
        pushToast('success', writtenPaths.length ? 'Modulo SQLite installato e comandi Tauri registrati.' : 'Il modulo SQLite è già installato.');
        setWrittenDone(true);
        setTimeout(() => setWrittenDone(false), 2500);
        return;
      }
      const currentTree: VfsNodeDTO[] = await api.vfs.listTree(project.id);
      const pendingFiles = [];
      const updates: Array<{ id: string; path: string; content: string; expected: string }> = [];
      for (const file of editedBundle.files) {
        const path = `/${file.relativePath.replace(/^\/+/, '')}`;
        const existing = currentTree.find((entry) => entry.virtualPath === path);
        if (!existing) {
          pendingFiles.push(file);
          continue;
        }
        const existingContent = existing.entryKind === 'folder' ? undefined : (await api.vfs.readFile(existing.id)).content;
        if (existingContent === file.code) continue;
        const owned = materializedFiles.get(draftKey(file.relativePath));
        if (!owned || owned.id !== existing.id || owned.content !== existingContent) {
          throw new Error(`Il percorso ${path} contiene un file diverso. Apri il file esistente per integrare le modifiche.`);
        }
        updates.push({ id: existing.id, path: file.relativePath, content: file.code, expected: owned.content });
      }

      const rememberWrite = (path: string, id: string, content: string) => {
        materializedFiles.set(draftKey(path), { id, content });
        useStudioStore.setState((state) => state.project?.id === project.id
          ? { sourceFiles: { ...state.sourceFiles, [id]: content } }
          : {});
      };

      const ensureFolderChain = async (folderParts: string[]): Promise<string | null> => {
        let parentId: string | null = null;
        let accumPath = '';
        for (const seg of folderParts) {
          accumPath += `/${seg}`;
          const existing = currentTree.find(
            (n) => n.entryKind === 'folder' && n.virtualPath === accumPath,
          );
          if (existing) {
            parentId = existing.id;
          } else {
            const created = await api.vfs.createEntry({
              projectId: project.id,
              parentId,
              name: seg,
              entryKind: 'folder',
            });
            currentTree.push(created.entry);
            parentId = created.entry.id;
          }
        }
        return parentId;
      };

      for (const file of pendingFiles) {
        const cleanRel = file.relativePath.replace(/^\/+/, '');
        const parts = cleanRel.split('/').filter(Boolean);
        const fileName = parts[parts.length - 1];
        const parentId = await ensureFolderChain(parts.slice(0, -1));
        const created = await api.vfs.createEntry({
          projectId: project.id,
          parentId,
          name: fileName,
          entryKind: inferVfsKindFromFilename(fileName, cleanRel),
          initialContent: file.code,
        });
        currentTree.push(created.entry);
        rememberWrite(file.relativePath, created.entry.id, file.code);
      }

      for (const update of updates) {
        await api.vfs.writeFile(update.id, update.content, update.expected);
        rememberWrite(update.path, update.id, update.content);
      }

      const refreshedTree = await api.vfs.listTree(project.id);
      if (useStudioStore.getState().project?.id === project.id) {
        useStudioStore.setState({ vfsTree: refreshedTree });
      }

      const savedCount = pendingFiles.length + updates.length;
      appendConsoleEntry({
        kind: 'sql',
        source: `SQL Codegen (${targetKind})`,
        message: `Modulo DB ${targetKind}: ${pendingFiles.length} file creati, ${updates.length} aggiornati.`,
      });
      pushToast(
        'success',
        savedCount ? `Salvati ${savedCount} file del modulo DB.` : 'I file del modulo DB sono già nel progetto.',
      );
      setWrittenDone(true);
      setTimeout(() => setWrittenDone(false), 2500);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      saveInProgress.current = false;
      setWritingToProject(false);
    }
  };

  return (
    <div
      data-testid="sql-codegen-panel"
      style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }}
    >
      {/* Left Stack & File Selector */}
      <aside
        style={{
          width: 310,
          flexShrink: 0,
          borderRight: '1px solid var(--border-subtle)',
          background: 'var(--bg-panel)',
          padding: 12,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div>
          <strong style={{ fontSize: 12 }}>1. Scegli Stack Codice DB</strong>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            {CODEGEN_TARGETS.map((t) => {
              const active = t.id === targetKind;
              return (
                <button
                  key={t.id}
                  type="button"
                  data-testid={`sql-codegen-target-${t.id}`}
                  onClick={() => {
                    setTargetKind(t.id);
                    setSelectedFilePath('');
                  }}
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: active
                      ? '1px solid var(--accent-primary)'
                      : '1px solid var(--border-subtle)',
                    background: active ? 'var(--accent-soft)' : 'var(--bg-panel-elevated)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: 11.5 }}>{t.label}</strong>
                    <span
                      style={{
                        fontSize: 9.5,
                        padding: '1px 5px',
                        borderRadius: 4,
                        background: 'var(--bg-panel)',
                        color: 'var(--accent-primary)',
                        fontWeight: 700,
                      }}
                    >
                      {t.badge}
                    </span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {t.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11.5 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={includeRestRoutes}
              onChange={(e) => setIncludeRestRoutes(e.target.checked)}
            />
            Includi Route REST / API CRUD
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={includeSeedScript}
              onChange={(e) => setIncludeSeedScript(e.target.checked)}
            />
            Includi INSERT Seed Rows in schema.sql
          </label>
        </div>

        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
          <strong style={{ fontSize: 12 }}>2. File Generati ({files.length})</strong>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
            {files.map((f) => {
              const isSel = f.relativePath === activeFile?.relativePath;
              return (
                <button
                  key={f.relativePath}
                  type="button"
                  data-testid={`sql-codegen-file-${f.relativePath}`}
                  onClick={() => setSelectedFilePath(f.relativePath)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 8px',
                    borderRadius: 6,
                    border: isSel
                      ? '1px solid var(--accent-primary)'
                      : '1px solid var(--border-subtle)',
                    background: isSel ? 'var(--accent-soft)' : 'transparent',
                    fontSize: 11.5,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <Code2 size={13} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.relativePath}{drafts[draftKey(f.relativePath)] !== undefined ? ' · Modificato' : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      {/* Right Code Preview & Write Action */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <div
          style={{
            padding: '8px 14px',
            background: 'var(--bg-panel)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div>
            <code style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--accent-primary)' }}>
              {activeFile?.relativePath}
            </code>
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>
              ({dialect.toUpperCase()} · {sqlDocument.tables.length} tabelle)
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {isEdited && (
              <button
                type="button"
                className="toolbar-btn"
                aria-label="Ripristina codice generato"
                title="Ripristina codice generato"
                onClick={() => handleChangeCode(activeFile.code)}
              >
                <RotateCcw size={13} />
              </button>
            )}
            <button
              type="button"
              disabled={!activeFile}
              onClick={() => void handleCopyFile()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '5px 10px',
                borderRadius: 6,
                border: '1px solid var(--border-strong)',
                background: 'var(--bg-panel-elevated)',
                cursor: 'pointer',
              }}
            >
              <Copy size={13} /> Copia File
            </button>

            <button
              type="button"
              disabled={writingToProject || !bundle || isBlocked}
              data-testid="btn-sql-write-codegen"
              onClick={() => void handleWriteModuleIntoProject()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 14px',
                borderRadius: 6,
                border: 'none',
                background: 'var(--accent-primary)',
                color: '#fff',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {writtenDone ? <Check size={14} /> : <FolderDown size={14} />}
              {installRustModule ? 'Integra modulo SQLite in Tauri' : `Scrivi Modulo DB nel Progetto (${files.length} file)`}
            </button>
          </div>
        </div>

        {generation.error && <div role="alert" style={{ padding: '8px 14px' }}>{generation.error}</div>}
        {bundle?.diagnostics.map((diagnostic) => (
          <div key={diagnostic.message} role={diagnostic.severity === 'error' ? 'alert' : 'status'} style={{ padding: '8px 14px' }}>
            {diagnostic.message}
          </div>
        ))}
        {activeFile && (
          <SqlScriptEditor
            label={`Codice di ${activeFile.relativePath}`}
            testId="sql-codegen-preview"
            value={activeCode}
            onChange={handleChangeCode}
            onSave={() => void handleWriteModuleIntoProject()}
            style={{ flex: 1, padding: 16, border: 0, borderRadius: 0, resize: 'none' }}
          />
        )}
      </div>
    </div>
  );
};
