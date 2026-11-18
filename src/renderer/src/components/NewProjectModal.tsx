import React, { useState } from 'react';
import { FolderPlus, Wand2, X } from 'lucide-react';
import type { CodegenTargetId, StylingDialect } from '@shared/ui-ir';
import { useStudioStore } from '@renderer/state/studio-store';

export const NewProjectModal: React.FC = () => {
  const isOpen = useStudioStore((s) => s.isNewProjectModalOpen);
  const targets = useStudioStore((s) => s.targets);
  const recentProjects = useStudioStore((s) => s.recentProjects);

  const setNewProjectModalOpen = useStudioStore((s) => s.setNewProjectModalOpen);
  const setWizardOpen = useStudioStore((s) => s.setWizardOpen);
  const createNewProject = useStudioStore((s) => s.createNewProject);
  const openRecentProject = useStudioStore((s) => s.openRecentProject);

  const [name, setName] = useState('Aurora SaaS Dashboard');
  const [target, setTarget] = useState<CodegenTargetId>('react-tsx');
  const [dialect, setDialect] = useState<StylingDialect>('vanilla-css');
  const [layoutMode, setLayoutMode] = useState<'freeform' | 'auto'>('freeform');

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={() => setNewProjectModalOpen(false)}>
      <div
        className="modal-card"
        style={{ width: 'min(540px, 92vw)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-header)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FolderPlus size={16} color="var(--accent-primary)" />
            <strong style={{ fontSize: 14 }}>Nuovo Progetto Rapido o Apri Recente</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              className="studio-btn sm violet"
              onClick={() => {
                setNewProjectModalOpen(false);
                setWizardOpen(true);
              }}
            >
              <Wand2 size={12} />
              <span>Wizard 5 Passi</span>
            </button>
            <button type="button" className="studio-btn sm" onClick={() => setNewProjectModalOpen(false)}>
              <X size={13} />
            </button>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void createNewProject(name, target, dialect, layoutMode);
          }}
          style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600 }}>Nome Progetto</span>
            <input
              className="studio-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Es. Gestionale Desktop, Storefront HTMX..."
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600 }}>Target Principale</span>
              <select
                className="studio-select"
                value={target}
                onChange={(e) => setTarget(e.target.value as CodegenTargetId)}
              >
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.displayName}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600 }}>Dialetto CSS / UI</span>
              <select
                className="studio-select"
                value={dialect}
                onChange={(e) => setDialect(e.target.value as StylingDialect)}
              >
                <option value="vanilla-css">Vanilla CSS</option>
                <option value="tailwind">Tailwind CSS</option>
                <option value="css-modules">CSS Modules</option>
                <option value="shadcn">Shadcn/UI</option>
              </select>
            </label>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600 }}>Modalità Progettazione</span>
            <select
              className="studio-select"
              value={layoutMode}
              onChange={(e) => setLayoutMode(e.target.value as 'freeform' | 'auto')}
            >
              <option value="freeform">Posizionamento Libero (X, Y) — stile Canva</option>
              <option value="auto">Auto-Layout (Flex/Grid) — stile Figma</option>
            </select>
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button type="button" className="studio-btn" onClick={() => setNewProjectModalOpen(false)}>
              Annulla
            </button>
            <button type="submit" className="studio-btn primary">
              Crea Progetto
            </button>
          </div>
        </form>

        {recentProjects.length > 0 && (
          <div style={{ padding: '0 16px 16px' }}>
            <div className="palette-category-title">Progetti Recenti</div>
            {recentProjects.map((rp) => (
              <div
                key={rp.id}
                className="vfs-row"
                onClick={() => void openRecentProject(rp.id)}
                style={{ border: '1px solid var(--border-subtle)', marginBottom: 4, padding: '6px 10px' }}
              >
                <strong>{rp.name}</strong>
                <span className="badge blue">{rp.primaryTarget}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
