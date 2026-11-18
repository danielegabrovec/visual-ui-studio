import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Box,
  Check,
  Code2,
  Cpu,
  FolderOpen,
  Globe,
  Laptop,
  LayoutGrid,
  Move,
  Palette,
  RefreshCw,
  Rocket,
  Smartphone,
  Wand2,
  Workflow,
  X,
} from 'lucide-react';
import {
  PROJECT_STACK_CATALOG,
  getProjectStackDescriptor,
  type PrimaryCodeLanguage,
  type ProjectStackId,
  type PythonCompanionKind,
} from '@shared/project-stacks';
import { THREE_SCENE_PRESETS, type ThreePresetId } from '@shared/three-ir';
import type { CodegenTargetId, StylingDialect, TargetDescriptor } from '@shared/ui-ir';
import {
  WIZARD_PALETTE_PRESETS,
  type ProjectWizardSpec,
  type WizardAppCategory,
  type WizardPaletteId,
  type WizardStarterPageId,
} from '@shared/wizard-templates';
import { getStudioApi } from '@renderer/api/studio-client';
import { useStudioStore } from '@renderer/state/studio-store';

const WIZARD_CATEGORIES: Array<{
  id: WizardAppCategory;
  title: string;
  badge: string;
  description: string;
  defaultTarget: CodegenTargetId;
  defaultStack: ProjectStackId;
  defaultDialect: StylingDialect;
  defaultLayout: 'freeform' | 'auto';
  icon: React.ReactNode;
}> = [
  {
    id: 'web',
    title: 'Web App & Full-Stack',
    badge: 'HTML/JS • React • Angular • Svelte • Next.js • Vite • Node • HTMX',
    description: 'Applicazioni web moderne, SPA, portali hypermedia HTMX e backend Node.js/Python.',
    defaultTarget: 'react-tsx',
    defaultStack: 'react',
    defaultDialect: 'vanilla-css',
    defaultLayout: 'freeform',
    icon: <Globe size={18} color="var(--accent-primary)" />,
  },
  {
    id: 'desktop',
    title: 'App Desktop Nativa (Tauri / Rust)',
    badge: 'Tauri v2 • Rust + Tauri Full-Stack • Electron • .NET MAUI • Qt 6',
    description: 'Software desktop multipiattaforma con crate Rust multi-modulo, SQL nativo e bridge invoke().',
    defaultTarget: 'tauri-v2',
    defaultStack: 'rust-tauri',
    defaultDialect: 'tailwind',
    defaultLayout: 'freeform',
    icon: <Laptop size={18} color="var(--accent-violet)" />,
  },
  {
    id: 'mobile',
    title: 'App Mobile Cross-Platform',
    badge: 'React Native (Expo SDK 52) • Flutter • SwiftUI • Compose',
    description: 'Interfacce touch iOS, Android e Web con Expo SDK 52 in JavaScript o TypeScript.',
    defaultTarget: 'react-native',
    defaultStack: 'react-native',
    defaultDialect: 'vanilla-css',
    defaultLayout: 'auto',
    icon: <Smartphone size={18} color="var(--accent-emerald)" />,
  },
  {
    id: 'python_ai',
    title: 'Backend Python, HTMX & AI',
    badge: 'FastAPI • Flask • HTMX + Python • Streamlit • PySide6',
    description: 'Applicazioni Python con ambiente virtuale .venv, FastAPI/Flask e pannelli operativi AI.',
    defaultTarget: 'htmx',
    defaultStack: 'htmx',
    defaultDialect: 'vanilla-css',
    defaultLayout: 'freeform',
    icon: <Cpu size={18} color="var(--accent-amber)" />,
  },
  {
    id: 'three_game',
    title: 'Esperienza 3D Three.js & Game UI',
    badge: 'Three.js • React Three Fiber • Unity UXML',
    description: 'Scene 3D PBR interattive, HUD di gioco, particelle e logica Blueprint stile Unreal.',
    defaultTarget: 'react-tsx',
    defaultStack: 'react',
    defaultDialect: 'vanilla-css',
    defaultLayout: 'freeform',
    icon: <Box size={18} color="#ec4899" />,
  },
];

const DIALECT_OPTIONS: Array<{ id: StylingDialect; label: string; desc: string }> = [
  { id: 'vanilla-css', label: 'Vanilla CSS', desc: 'CSS3 standard con variabili --token e sync bidirezionale' },
  { id: 'tailwind', label: 'Tailwind CSS', desc: 'Utility classes atomiche ad alta produttività' },
  { id: 'css-modules', label: 'CSS Modules', desc: 'Classi .module.css isolate per componente' },
  { id: 'shadcn', label: 'Shadcn/UI', desc: 'Componenti Radix/Tailwind accessibili e componibili' },
];

const STARTER_PAGES: Array<{ id: WizardStarterPageId; label: string; desc: string }> = [
  { id: 'home', label: 'Home', desc: 'Schermata principale con Hero, Card e CTA' },
  { id: 'login', label: 'Login', desc: 'Modulo autenticazione utente' },
  { id: 'dashboard', label: 'Dashboard', desc: 'Pannello KPI e metriche operative' },
  { id: 'form_table', label: 'Form/Tabella', desc: 'Inserimento dati e tabella record' },
];

const STEP_LABELS = [
  '1. Categoria & Stack',
  '2. Linguaggio & Target',
  '3. Layout & Moduli',
  '4. Design & Tema',
  '5. Disco & Toolchain',
];

function matchesWizardCategory(t: TargetDescriptor, cat: WizardAppCategory): boolean {
  if (cat === 'python_ai') {
    return t.id.startsWith('python-') || t.id === 'htmx' || t.id === 'lvgl-c';
  }
  if (cat === 'three_game') {
    return t.id === 'html-vanilla' || t.id === 'react-tsx' || t.id === 'nextjs-app' || t.id === 'unity-uitoolkit';
  }
  if (cat === 'web') {
    return (t.category === 'web' || t.category === 'backend-template') && !t.id.startsWith('python-');
  }
  if (cat === 'desktop') {
    return t.category === 'desktop' && !t.id.startsWith('python-');
  }
  if (cat === 'mobile') {
    return t.category === 'mobile';
  }
  return true;
}

export const GuidedProjectWizard: React.FC = () => {
  const wizardOpen = useStudioStore((s) => s.wizardOpen);
  const targets = useStudioStore((s) => s.targets);
  const toolchainDoctor = useStudioStore((s) => s.toolchainDoctor);
  const setWizardOpen = useStudioStore((s) => s.setWizardOpen);
  const createProjectFromWizard = useStudioStore((s) => s.createProjectFromWizard);
  const createAndInitDiskProjectAction = useStudioStore((s) => s.createAndInitDiskProjectAction);
  const refreshToolchainDoctor = useStudioStore((s) => s.refreshToolchainDoctor);

  const [step, setStep] = useState<number>(1);
  const [showAllTargets, setShowAllTargets] = useState<boolean>(false);
  const [targetFilter, setTargetFilter] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  const [category, setCategory] = useState<WizardAppCategory>('web');
  const [stackId, setStackId] = useState<ProjectStackId>('html-css-js');
  const [primaryLanguage, setPrimaryLanguage] = useState<PrimaryCodeLanguage>('javascript');
  const [pythonCompanion, setPythonCompanion] = useState<PythonCompanionKind>('none');
  const [primaryTarget, setPrimaryTarget] = useState<CodegenTargetId>('html-vanilla');
  const [stylingPreset, setStylingPreset] = useState<StylingDialect>('vanilla-css');
  const [layoutMode, setLayoutMode] = useState<'freeform' | 'auto'>('freeform');
  const [starterPages, setStarterPages] = useState<WizardStarterPageId[]>(['home']);
  const [includeTsScript, setIncludeTsScript] = useState<boolean>(true);
  const [includeBlueprint, setIncludeBlueprint] = useState<boolean>(true);
  const [includeThreeScene, setIncludeThreeScene] = useState<boolean>(true);
  const [threePresetId, setThreePresetId] = useState<ThreePresetId>('pbr-product-showcase');
  const [paletteId, setPaletteId] = useState<WizardPaletteId>('dark-pro');
  const [defaultThemeMode, setDefaultThemeMode] = useState<'dark' | 'light'>('dark');
  const [projectName, setProjectName] = useState<string>('Progetto Studio v3');
  const [rootDiskPath, setRootDiskPath] = useState<string>('');
  const [runToolchainInit, setRunToolchainInit] = useState<boolean>(true);
  const [initGitRepo, setInitGitRepo] = useState<boolean>(false);

  const displayedTargets = useMemo(() => {
    const base = showAllTargets ? targets : targets.filter((t) => matchesWizardCategory(t, category));
    const q = targetFilter.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (t) =>
        t.displayName.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
    );
  }, [targets, showAllTargets, category, targetFilter]);

  if (!wizardOpen) return null;

  const currentStackDesc = getProjectStackDescriptor(stackId);

  const selectStack = (nextStackId: ProjectStackId) => {
    const desc = getProjectStackDescriptor(nextStackId);
    setStackId(nextStackId);
    setPrimaryTarget(desc.codegenTargetId);
    if (!desc.supportedLanguages.includes(primaryLanguage)) {
      setPrimaryLanguage(desc.defaultLanguage);
    }
    if (!desc.supportsPythonCompanion) {
      setPythonCompanion('none');
    }
    if (!desc.supportedDialects.includes(stylingPreset)) {
      setStylingPreset(desc.defaultDialect);
    }
  };

  const selectCategory = (catId: WizardAppCategory) => {
    setCategory(catId);
    const meta = WIZARD_CATEGORIES.find((c) => c.id === catId);
    if (meta) {
      selectStack(meta.defaultStack);
      setPrimaryTarget(meta.defaultTarget);
      setStylingPreset(meta.defaultDialect);
      setLayoutMode(meta.defaultLayout);
      if (catId === 'python_ai') {
        setPrimaryLanguage('python');
        setPythonCompanion('fastapi');
      } else if (catId === 'three_game') {
        setIncludeThreeScene(true);
        setIncludeBlueprint(true);
        setPaletteId('cyberpunk-neon');
      }
    }
  };

  const toggleStarterPage = (pageId: WizardStarterPageId) => {
    setStarterPages((prev) => {
      if (prev.includes(pageId)) {
        return prev.length > 1 ? prev.filter((p) => p !== pageId) : prev;
      }
      return [...prev, pageId];
    });
  };

  const handleBrowseFolder = async () => {
    const chosen = await getStudioApi().project.pickDirectory('Seleziona Cartella Padre su Disco');
    if (chosen) {
      setRootDiskPath(chosen);
    }
  };

  const handleFinish = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      const cleanParentDir = rootDiskPath.trim();
      if (cleanParentDir) {
        const created = await createAndInitDiskProjectAction({
          name: projectName.trim() || 'Nuovo Progetto Studio',
          targetParentDir: cleanParentDir,
          stackId,
          primaryLanguage,
          primaryTarget,
          pythonCompanion,
          stylingPreset,
          layoutMode,
          starterPages: starterPages.length > 0 ? starterPages : ['home'],
          paletteId,
          defaultThemeMode,
          includeAutomations: includeTsScript,
          includeBlueprint,
          includeThreeScene,
          threePresetId,
          runToolchainInit,
          initGitRepo,
        });
        if (!created) return;
      } else {
        const spec: ProjectWizardSpec = {
          name: projectName.trim() || 'Nuovo Progetto Studio',
          category,
          primaryTarget,
          stylingPreset,
          layoutMode,
          starterPages: starterPages.length > 0 ? starterPages : ['home'],
          includeTsScript,
          includeBlueprint,
          includeThreeScene,
          threePresetId,
          paletteId,
          defaultThemeMode,
          rootDiskPath: null,
          seedDemoContent: false,
        };
        await createProjectFromWizard(spec);
      }
      setStep(1);
    } finally {
      setIsGenerating(false);
    }
  };

  const selectedTargetObj = targets.find((t) => t.id === primaryTarget);
  const selectedPaletteObj =
    WIZARD_PALETTE_PRESETS.find((p) => p.id === paletteId) ?? WIZARD_PALETTE_PRESETS[0];

  return (
    <div
      className="modal-backdrop"
      style={{ zIndex: 130 }}
      onClick={() => setWizardOpen(false)}
    >
      <div
        className="wizard-modal-card"
        data-testid="guided-project-wizard"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '12px 18px',
            background: 'var(--bg-header)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Wand2 size={17} color="var(--accent-primary)" />
            <div>
              <strong style={{ fontSize: 14 }}>
                Nuovo progetto
              </strong>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Configura stack reale su disco (JS, TS, Python, Rust+Tauri), toolchain, layout, CSS, Automazioni e SQL
              </div>
            </div>
          </div>

          <button
            type="button"
            className="studio-btn sm"
            data-testid="btn-close-wizard"
            onClick={() => setWizardOpen(false)}
          >
            <X size={13} />
          </button>
        </div>

        {/* 5-Step Progress Bar */}
        <div className="wizard-stepper">
          {STEP_LABELS.map((lbl, idx) => {
            const num = idx + 1;
            const isActive = step === num;
            const isDone = step > num;
            return (
              <button
                key={lbl}
                type="button"
                className={`wizard-step-pill ${isActive ? 'active' : isDone ? 'done' : ''}`}
                data-testid={`wizard-step-btn-${num}`}
                onClick={() => setStep(num)}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    background: isActive
                      ? 'var(--accent-primary)'
                      : isDone
                        ? 'var(--accent-emerald)'
                        : 'var(--bg-panel-hover)',
                    color: isActive || isDone ? '#ffffff' : 'var(--text-secondary)',
                    flexShrink: 0,
                  }}
                >
                  {isDone ? <Check size={11} /> : num}
                </span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {lbl}
                </span>
              </button>
            );
          })}
        </div>

        {/* Step Body */}
        <div className="wizard-body">
          {/* STEP 1: Category + 11 Project Stacks */}
          {step === 1 && (
            <div data-testid="wizard-step-1" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>
                  Step 1 — Scegli lo Stack di Progetto (11 Stack Reali) o la Categoria
                </h3>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
                  Seleziona uno degli 11 stack repository completi pronti su disco, oppure filtra per famiglia applicativa.
                </p>
              </div>

              {/* 11 Real Stacks Grid */}
              <div>
                <div className="palette-category-title" style={{ marginTop: 0 }}>
                  11 Stack di Progetto Completi (Scaffolding Reale su Disco)
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(195px, 1fr))',
                    gap: 8,
                  }}
                >
                  {PROJECT_STACK_CATALOG.map((st) => {
                    const isSel = stackId === st.id;
                    return (
                      <button
                        key={st.id}
                        type="button"
                        className={`wizard-choice-card ${isSel ? 'selected' : ''}`}
                        style={{ padding: '9px 11px', gap: 4 }}
                        data-testid={`wizard-stack-${st.id}`}
                        onClick={() => selectStack(st.id)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                          <strong style={{ fontSize: 12 }}>{st.shortLabel}</strong>
                          <span className={`badge ${st.requiresRustToolchain ? 'amber' : 'blue'}`}>
                            {st.badge}
                          </span>
                        </div>
                        <span style={{ fontSize: 10.5, color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                          {st.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="palette-category-title" style={{ marginTop: 0 }}>
                  Famiglie Applicative Rapide
                </div>
                <div className="wizard-choice-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
                  {WIZARD_CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      className={`wizard-choice-card ${category === cat.id ? 'selected' : ''}`}
                      style={{ padding: '9px 12px' }}
                      data-testid={`wizard-cat-${cat.id}`}
                      onClick={() => selectCategory(cat.id)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        {cat.icon}
                        {category === cat.id && <span className="badge blue">Selezionato</span>}
                      </div>
                      <strong style={{ fontSize: 12.5 }}>{cat.title}</strong>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                        {cat.description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Language Matrix (JS / TS / Python / Rust) + 26 Codegen Targets + CSS Dialect */}
          {step === 2 && (
            <div data-testid="wizard-step-2" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Language & Python Companion Matrix */}
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-panel-elevated)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 12 }}>
                    Linguaggio Codice ({currentStackDesc.shortLabel}):
                  </strong>
                  <div className="segmented-group">
                    {(['javascript', 'typescript', 'python'] as PrimaryCodeLanguage[]).map((lang) => {
                      const supported = currentStackDesc.supportedLanguages.includes(lang);
                      return (
                        <button
                          key={lang}
                          type="button"
                          disabled={!supported}
                          data-testid={`wizard-lang-${lang}`}
                          className={`segmented-item ${primaryLanguage === lang ? 'active' : ''}`}
                          style={{ opacity: supported ? 1 : 0.4 }}
                          onClick={() => setPrimaryLanguage(lang)}
                        >
                          {lang === 'javascript'
                            ? 'JavaScript (.js/.jsx)'
                            : lang === 'typescript'
                              ? 'TypeScript (.ts/.tsx)'
                              : 'Python (.py)'}
                        </button>
                      );
                    })}
                  </div>
                  {currentStackDesc.requiresRustToolchain && (
                    <span className="badge amber">🦀 Crate Rust + Tauri v2 attivo</span>
                  )}
                </div>

                {currentStackDesc.supportsPythonCompanion && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Backend Python:</span>
                    <select
                      className="studio-select"
                      data-testid="wizard-python-companion"
                      style={{ height: 27, fontSize: 11.5 }}
                      value={primaryLanguage === 'python' && pythonCompanion !== 'flask' ? 'fastapi' : pythonCompanion}
                      onChange={(e) => setPythonCompanion(e.target.value as PythonCompanionKind)}
                    >
                      {primaryLanguage !== 'python' && <option value="none">Nessuno</option>}
                      <option value="fastapi">FastAPI</option>
                      <option value="flask">Flask</option>
                      {primaryLanguage !== 'python' && <option value="scripts">Script Automazioni (.py)</option>}
                    </select>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ margin: '0 0 2px', fontSize: 14.5 }}>
                    Compilatore UI Primario (26 Target) &amp; Dialetto CSS
                  </h3>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    className="studio-input"
                    style={{ width: 180, height: 27 }}
                    placeholder="Cerca target (es. Svelte, HTML)..."
                    value={targetFilter}
                    onChange={(e) => setTargetFilter(e.target.value)}
                  />
                  <button
                    type="button"
                    className={`studio-btn sm ${showAllTargets ? 'active' : ''}`}
                    data-testid="wizard-toggle-all-targets"
                    onClick={() => setShowAllTargets((v) => !v)}
                  >
                    <span>{showAllTargets ? 'Tutti i 26 Target (Attivo)' : 'Mostra tutti i 26 Target'}</span>
                  </button>
                </div>
              </div>

              <div
                className="wizard-choice-grid"
                style={{ maxHeight: 195, overflowY: 'auto', paddingRight: 4 }}
              >
                {displayedTargets.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`wizard-choice-card ${primaryTarget === t.id ? 'selected' : ''}`}
                    data-testid={`wizard-target-${t.id}`}
                    onClick={() => {
                      setPrimaryTarget(t.id);
                      if (!t.supportedDialects.includes(stylingPreset)) {
                        setStylingPreset(t.defaultDialect);
                      }
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                      <strong style={{ fontSize: 12.5 }}>{t.displayName}</strong>
                      <span className="badge blue">{t.fileExtension}</span>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                      {t.description}
                    </span>
                  </button>
                ))}
              </div>

              <div>
                <div className="palette-category-title" style={{ marginTop: 0 }}>
                  Dialetto Stili CSS
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
                  {DIALECT_OPTIONS.map((d) => {
                    const supported = selectedTargetObj ? selectedTargetObj.supportedDialects.includes(d.id) : true;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        className={`wizard-choice-card ${stylingPreset === d.id ? 'selected' : ''}`}
                        data-testid={`wizard-dialect-${d.id}`}
                        style={{ opacity: supported ? 1 : 0.65, padding: '9px 11px' }}
                        onClick={() => setStylingPreset(d.id)}
                      >
                        <strong style={{ fontSize: 12 }}>{d.label}</strong>
                        <span style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>{d.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Layout Mode, Starter Pages & Modules */}
          {step === 3 && (
            <div data-testid="wizard-step-3" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <h3 style={{ margin: '0 0 3px', fontSize: 15 }}>Step 3 — Modalità Progettazione &amp; Moduli</h3>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
                  Scegli se posizionare liberamente gli elementi per coordinate (X, Y) o usare contenitori Auto-Layout, e attiva i moduli logici/3D.
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <button
                  type="button"
                  className={`wizard-choice-card ${layoutMode === 'freeform' ? 'selected' : ''}`}
                  data-testid="wizard-layout-freeform"
                  onClick={() => setLayoutMode('freeform')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Move size={17} color="var(--accent-primary)" />
                    <strong style={{ fontSize: 13 }}>Posizionamento Libero (X, Y) — stile Canva</strong>
                  </div>
                  <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                    Trascina qualsiasi controllo o forma in coordinate assolute esatte (`left`, `top`, `z-index`), disegna rettangoli e ridimensiona liberamente.
                  </span>
                </button>

                <button
                  type="button"
                  className={`wizard-choice-card ${layoutMode === 'auto' ? 'selected' : ''}`}
                  data-testid="wizard-layout-auto"
                  onClick={() => setLayoutMode('auto')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <LayoutGrid size={17} color="var(--accent-violet)" />
                    <strong style={{ fontSize: 13 }}>Auto-Layout (Flex/Grid) — stile Figma</strong>
                  </div>
                  <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                     Struttura gerarchica responsiva basata su righe, colonne, gap e griglie adattive per ogni breakpoint.
                  </span>
                </button>
              </div>

              <div>
                <div className="palette-category-title" style={{ marginTop: 0 }}>
                  Schermate Iniziali (`.canvas` in `src/screens/`)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
                  {STARTER_PAGES.map((pg) => {
                    const active = starterPages.includes(pg.id);
                    return (
                      <button
                        key={pg.id}
                        type="button"
                        className={`wizard-choice-card ${active ? 'selected' : ''}`}
                        data-testid={`wizard-page-${pg.id}`}
                        style={{ padding: '9px 11px' }}
                        onClick={() => toggleStarterPage(pg.id)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                          <strong style={{ fontSize: 12 }}>{pg.label}</strong>
                          {active && <Check size={13} color="var(--accent-primary)" />}
                        </div>
                        <span style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>{pg.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="palette-category-title" style={{ marginTop: 0 }}>
                  Moduli Interattivi, Automazioni No-Code &amp; Studio 3D
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                  <label
                    className={`wizard-choice-card ${includeTsScript ? 'selected' : ''}`}
                    data-testid="wizard-mod-script"
                    style={{ cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <input
                        type="checkbox"
                        checked={includeTsScript}
                        onChange={(e) => setIncludeTsScript(e.target.checked)}
                      />
                      <Code2 size={15} color="var(--accent-primary)" />
                      <strong style={{ fontSize: 12 }}>Automazioni JS / TS / Py</strong>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      Genera modulo separato `automations.{primaryLanguage === 'typescript' ? 'ts' : primaryLanguage === 'python' ? 'py' : 'js'}` collegato al Canvas.
                    </span>
                  </label>

                  <label
                    className={`wizard-choice-card ${includeBlueprint ? 'selected' : ''}`}
                    data-testid="wizard-mod-blueprint"
                    style={{ cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <input
                        type="checkbox"
                        checked={includeBlueprint}
                        onChange={(e) => setIncludeBlueprint(e.target.checked)}
                      />
                      <Workflow size={15} color="var(--accent-violet)" />
                      <strong style={{ fontSize: 12 }}>Grafo Blueprint (stile Unreal)</strong>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      Genera `src/blueprints/*.blueprint.json` con nodi Eventi, Branch e Azioni UI.
                    </span>
                  </label>

                  <div
                    className={`wizard-choice-card ${includeThreeScene ? 'selected' : ''}`}
                    data-testid="wizard-mod-three"
                  >
                    <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', width: '100%' }}>
                      <input
                        type="checkbox"
                        checked={includeThreeScene}
                        onChange={(e) => setIncludeThreeScene(e.target.checked)}
                      />
                      <Box size={15} color="var(--accent-emerald)" />
                      <strong style={{ fontSize: 12 }}>Scena 3D Three.js</strong>
                    </label>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      Genera `src/scenes3d/*.scene3d.json` + viewport 3D nel Canvas.
                    </span>
                    {includeThreeScene && (
                      <select
                        className="studio-select"
                        style={{
                          width: '100%',
                          maxWidth: '100%',
                          minWidth: 0,
                          height: 25,
                          fontSize: 11,
                          marginTop: 2,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        value={threePresetId}
                        onChange={(e) => setThreePresetId(e.target.value as ThreePresetId)}
                      >
                        {THREE_SCENE_PRESETS.map((pr) => (
                          <option key={pr.id} value={pr.id}>
                            Preset: {pr.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Design System & Theme */}
          {step === 4 && (
            <div data-testid="wizard-step-4" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <h3 style={{ margin: '0 0 3px', fontSize: 15 }}>Step 4 — Design System, Palette &amp; Tema</h3>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
                    Scegli una delle 6 palette professionali calibrate per contrasto WCAG e il tema predefinito.
                  </p>
                </div>

                <div className="segmented-group">
                  <button
                    type="button"
                    className={`segmented-item ${defaultThemeMode === 'dark' ? 'active' : ''}`}
                    data-testid="wizard-theme-dark"
                    onClick={() => setDefaultThemeMode('dark')}
                  >
                    🌙 Default Scuro (Dark)
                  </button>
                  <button
                    type="button"
                    className={`segmented-item ${defaultThemeMode === 'light' ? 'active' : ''}`}
                    data-testid="wizard-theme-light"
                    onClick={() => setDefaultThemeMode('light')}
                  >
                    ☀️ Default Chiaro (Light)
                  </button>
                </div>
              </div>

              <div className="wizard-choice-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                {WIZARD_PALETTE_PRESETS.map((pal) => (
                  <button
                    key={pal.id}
                    type="button"
                    className={`wizard-choice-card ${paletteId === pal.id ? 'selected' : ''}`}
                    data-testid={`wizard-palette-${pal.id}`}
                    onClick={() => {
                      setPaletteId(pal.id);
                      setDefaultThemeMode(pal.defaultMode);
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Palette size={14} color={pal.colors.primary500} />
                        <strong style={{ fontSize: 12.5 }}>{pal.label}</strong>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {[
                          pal.colors.canvasDark,
                          pal.colors.surfaceDark,
                          pal.colors.primary500,
                          pal.colors.accent500,
                        ].map((hex, idx) => (
                          <span
                            key={idx}
                            style={{
                              width: 15,
                              height: 15,
                              borderRadius: 4,
                              background: hex,
                              border: '1px solid rgba(255,255,255,0.22)',
                            }}
                          />
                        ))}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{pal.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* STEP 5: Name, Disk Folder, Toolchain Init & Summary */}
          {step === 5 && (
            <div data-testid="wizard-step-5" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <h3 style={{ margin: '0 0 3px', fontSize: 15 }}>
                    Step 5 — Nome Progetto, Cartella su Disco &amp; Inizializzazione Toolchain
                  </h3>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
                    Scegli una cartella su disco per generare il repository completo ({currentStackDesc.shortLabel}) e avviare le dipendenze.
                  </p>
                </div>

                {/* Toolchain Doctor Badges */}
                <div
                  data-testid="wizard-toolchain-doctor"
                  style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}
                >
                  <span className={`badge ${toolchainDoctor?.node.available ? 'green' : 'amber'}`}>
                    Node {toolchainDoctor?.node.version ?? '—'}
                  </span>
                  <span className={`badge ${toolchainDoctor?.python.available ? 'green' : 'amber'}`}>
                    Python {toolchainDoctor?.python.version ?? '—'}
                  </span>
                  <span className={`badge ${toolchainDoctor?.rustc.available ? 'green' : 'amber'}`}>
                    Rust {toolchainDoctor?.rustc.version ? '✓' : '—'}
                  </span>
                  <button
                    type="button"
                    className="studio-btn sm ghost"
                    onClick={() => void refreshToolchainDoctor()}
                    title="Aggiorna verifica Toolchain Doctor"
                  >
                    <RefreshCw size={11} />
                  </button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 12 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Nome del Progetto</span>
                  <input
                    className="studio-input"
                    data-testid="wizard-input-name"
                    style={{ height: 32, fontSize: 13 }}
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="Es. Gestionale Cloud v3, App Rust Tauri..."
                  />
                </label>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>
                    Cartella Padre su Disco (Genera Repository Reale `&lt;cartella&gt;/&lt;slug&gt;`)
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      className="studio-input"
                      data-testid="wizard-input-disk-path"
                      style={{ height: 32, flex: 1 }}
                      value={rootDiskPath}
                      onChange={(e) => setRootDiskPath(e.target.value)}
                      placeholder="Opzionale: C:\Progetti (lascia vuoto per solo VFS interno)"
                    />
                    <button
                      type="button"
                      className="studio-btn"
                      data-testid="btn-wizard-pick-dir"
                      style={{ height: 32 }}
                      onClick={() => void handleBrowseFolder()}
                    >
                      <FolderOpen size={14} color="var(--accent-amber)" />
                      <span>Sfoglia...</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Stage-2 Toolchain Init Checkboxes */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 18,
                  flexWrap: 'wrap',
                  padding: '9px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-panel-elevated)',
                }}
              >
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12 }}>
                  <input
                    type="checkbox"
                    data-testid="wizard-checkbox-run-init"
                    checked={runToolchainInit}
                    onChange={(e) => setRunToolchainInit(e.target.checked)}
                  />
                  <strong>Inizializza subito dipendenze e ambiente su disco</strong>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                    ({currentStackDesc.initStepsSummary.join(' + ')})
                  </span>
                </label>

                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                  <input
                    type="checkbox"
                    data-testid="wizard-checkbox-git-init"
                    checked={initGitRepo}
                    onChange={(e) => setInitGitRepo(e.target.checked)}
                  />
                  <span>Inizializza repository Git (`git init`)</span>
                </label>
              </div>

              {/* Architecture & VFS Summary Box */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                  padding: 14,
                  borderRadius: 10,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-panel-elevated)',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                  <strong style={{ fontSize: 12.5 }}>Configurazione Scelta</strong>
                  <div>
                    • Stack Repository: <strong>{currentStackDesc.label}</strong> (<code>{stackId}</code>)
                  </div>
                  <div>
                    • Linguaggio: <strong>{primaryLanguage.toUpperCase()}</strong>
                    {pythonCompanion !== 'none' && primaryLanguage !== 'python'
                      ? ` + Python (${pythonCompanion})`
                      : ''}
                  </div>
                  <div>
                    • Compilatore UI: <strong>{selectedTargetObj?.displayName ?? primaryTarget}</strong> ({stylingPreset})
                  </div>
                  <div>
                    • Modalità Tela:{' '}
                    <strong style={{ color: 'var(--accent-primary)' }}>
                      {layoutMode === 'freeform' ? 'Posizionamento Libero (X, Y)' : 'Auto-Layout (Flex/Grid)'}
                    </strong>
                  </div>
                  <div>• Palette &amp; Tema: <strong>{selectedPaletteObj.label}</strong> ({defaultThemeMode})</div>
                </div>

                <div
                  style={{
                    fontFamily: "'JetBrains Mono', Consolas, monospace",
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                  }}
                >
                  <strong style={{ color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 12 }}>
                    File Principali Generati ({stackId}):
                  </strong>
                  {currentStackDesc.keyFilesPreview.map((fp) => (
                    <div key={fp}>📄 /{fp}</div>
                  ))}
                  {pythonCompanion !== 'none' && primaryLanguage !== 'python' && (
                    <div>🐍 /backend/main.py + requirements.txt</div>
                  )}
                  <div>🗄️ /.uistudio/project.uistudio ({starterPages.length} fogli `.canvas`)</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="wizard-footer">
          <button
            type="button"
            className="studio-btn"
            data-testid="btn-wizard-prev"
            disabled={step <= 1 || isGenerating}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
          >
            <ArrowLeft size={13} />
            <span>Indietro</span>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="studio-btn"
              onClick={() => setWizardOpen(false)}
              disabled={isGenerating}
            >
              Annulla
            </button>

            {step < 5 ? (
              <button
                type="button"
                className="studio-btn primary"
                data-testid="btn-wizard-next"
                onClick={() => setStep((s) => Math.min(5, s + 1))}
              >
                <span>Avanti (Step {step + 1}/5)</span>
                <ArrowRight size={13} />
              </button>
            ) : (
              <button
                type="button"
                className="studio-btn primary"
                data-testid="btn-wizard-finish"
                style={{ height: 34, padding: '0 16px', fontSize: 12.5 }}
                disabled={isGenerating}
                onClick={() => void handleFinish()}
              >
                <Rocket size={14} />
                <span>{isGenerating ? 'Generazione in corso...' : 'Genera e Apri Progetto'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
