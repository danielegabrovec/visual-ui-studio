import { useState } from 'react';
import { getStudioApi } from '@renderer/api/studio-client';
import { useStudioStore } from '@renderer/state/studio-store';
import type { VfsNodeDTO } from '@shared/ipc-contract';

interface GeneratedSourceOptions {
  fileName: string;
  generated: string;
  folders: readonly string[];
  entryKind: 'script_file' | 'source_file';
}

export function useGeneratedSourceEditor({ fileName, generated, folders, entryKind }: GeneratedSourceOptions) {
  const projectId = useStudioStore((state) => state.project?.id);
  const tree = useStudioStore((state) => state.vfsTree);
  const [manualSelection, setManual] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const pendingKey = JSON.stringify(['generated', projectId, ...folders, fileName]);

  const findTarget = (entries: VfsNodeDTO[]) => {
    const parents = folders.map((name) => entries.find((item) => item.parentId === null && item.entryKind === 'folder' && item.name === name)?.id)
      .filter((id): id is string => Boolean(id));
    const targetParents = folders.length ? parents : [null];
    const entry = targetParents.map((parentId) => entries.find((item) =>
      item.parentId === parentId && item.name === fileName,
    )).find(Boolean);
    return { entry, preferredFolder: entries.find((item) => item.parentId === null && item.name === folders[0]) };
  };

  const entry = findTarget(tree).entry;
  const saved = useStudioStore((state) => entry ? state.sourceFiles[entry.id] : undefined);
  const entryDraft = useStudioStore((state) => entry ? state.sourceDrafts[entry.id] : undefined);
  const pendingDraft = useStudioStore((state) => state.sourceDrafts[pendingKey]);
  const draft = pendingDraft ?? entryDraft;
  const manual = manualSelection ?? Boolean(draft);
  const displayed = draft?.content ?? saved ?? generated;

  const update = (content: string) => {
    const draftKey = pendingDraft ? pendingKey : (entry?.id ?? pendingKey);
    const baseContent = draft?.baseContent ?? saved ?? generated;
    useStudioStore.getState().setSourceDraft(draftKey, { content, baseContent });
  };

  const open = async () => {
    if (!projectId || draft) {
      setManual(true);
      return;
    }
    setBusy(true);
    try {
      const api = getStudioApi();
      const refreshed = await api.vfs.listTree(projectId);
      const current = findTarget(refreshed).entry;
      if (current?.entryKind === 'folder') throw new Error(`Il percorso ${fileName} è occupato da una cartella.`);
      const contents = current ? (await api.vfs.readFile(current.id)).content : undefined;
      useStudioStore.setState((state) => state.project?.id === projectId ? {
        vfsTree: refreshed,
        sourceFiles: current && contents !== undefined ? { ...state.sourceFiles, [current.id]: contents } : state.sourceFiles,
      } : state);
      setManual(true);
    } catch (error) {
      useStudioStore.getState().pushToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const save = async (): Promise<VfsNodeDTO | undefined> => {
    if (!projectId || busy) return;
    setBusy(true);
    try {
      const api = getStudioApi();
      const target = findTarget(await api.vfs.listTree(projectId));
      const state = useStudioStore.getState();
      if (state.project?.id !== projectId) return;
      if (target.entry?.entryKind === 'folder') throw new Error(`Il percorso ${fileName} è occupato da una cartella.`);
      if ((pendingDraft && target.entry) || (entryDraft && target.entry?.id !== entry?.id)) {
        throw new Error('Il file è stato spostato o creato da un altro editor. Apri il file aggiornato prima di salvare.');
      }

      let savedEntry: VfsNodeDTO;
      if (target.entry) {
        if (!entryDraft) return target.entry;
        if (!(await state.saveSourceDraft(target.entry.id, true))) return;
        savedEntry = target.entry;
      } else {
        if (target.preferredFolder && target.preferredFolder.entryKind !== 'folder') {
          throw new Error(`Il percorso ${folders[0]} è occupato da un file.`);
        }
        const parentId = target.preferredFolder?.id ?? (folders[0]
          ? (await api.vfs.createEntry({ projectId, parentId: null, name: folders[0], entryKind: 'folder' })).entry.id
          : null);
        const code = pendingDraft?.content ?? generated;
        const created = await api.vfs.createEntry({ projectId, parentId, name: fileName, entryKind, initialContent: code });
        savedEntry = created.entry;
        const refreshed = await api.vfs.listTree(projectId);
        useStudioStore.setState((current) => {
          const drafts = { ...current.sourceDrafts };
          const latest = drafts[pendingKey];
          delete drafts[pendingKey];
          if (latest && latest.content !== code) {
            drafts[savedEntry.id] = { content: latest.content, baseContent: code };
          }
          return {
            sourceDrafts: drafts,
            ...(current.project?.id === projectId ? {
              vfsTree: refreshed,
              sourceFiles: { ...current.sourceFiles, [savedEntry.id]: code },
            } : {}),
          };
        });
      }
      state.pushToast('success', `Sorgente salvato nel progetto: ${savedEntry.virtualPath}`);
      return savedEntry;
    } catch (error) {
      useStudioStore.getState().pushToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return { manual, setManual, busy, displayed, update, open, save, canSave: Boolean(projectId) };
}

export function GeneratedSourceTextarea({
  label, testId, value, onChange, onSave, saving = false,
}: {
  label: string;
  testId: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  saving?: boolean;
}) {
  return <textarea
    aria-label={label}
    data-testid={testId}
    value={value}
    readOnly={saving}
    onChange={(event) => onChange(event.target.value)}
    onKeyDown={(event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        event.stopPropagation();
        if (!saving) onSave();
      }
    }}
    autoCapitalize="off"
    spellCheck={false}
    wrap="off"
    style={{
      flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', border: '1px solid var(--border-subtle)',
      borderRadius: 0, padding: '8px 10px', resize: 'none', background: 'var(--code-bg)', color: 'var(--text-primary)',
      fontFamily: "'JetBrains Mono', Consolas, monospace", fontSize: 11.5, lineHeight: 1.55, tabSize: 2,
    }}
  />;
}
