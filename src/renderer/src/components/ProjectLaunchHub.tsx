import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Box,
  Check,
  Cpu,
  Download,
  FileUp,
  FolderOpen,
  HardDrive,
  LayoutGrid,
  Loader2,
  MessageSquare,
  Moon,
  Move,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Sun,
  Trash2,
  Wand2,
  Workflow,
  Zap,
} from 'lucide-react';
import {
  filterAndRankLocalModels,
  isEmbeddingOnlyModelName,
  pickPreferredLocalModel,
  type LocalAIModelInfo,
  type ProjectSummary,
} from '@shared/ipc-contract';
import {
  PROJECT_STACK_CATALOG,
  getProjectStackDescriptor,
  type PrimaryCodeLanguage,
  type ProjectStackId,
  type PythonCompanionKind,
} from '@shared/project-stacks';
import type { CodegenTargetId, TargetDescriptor } from '@shared/ui-ir';
import { getStudioApi } from '@renderer/api/studio-client';
import { useStudioStore, type HubSectionId } from '@renderer/state/studio-store';

type ArchitectSubMode = 'create' | 'chat';

type TemplateFilterCategory =
  | 'all'
  | 'web_htmx'
  | 'spa_fullstack'
  | 'desktop'
  | 'mobile'
  | 'python_embedded'
  | 'three_blueprint';

interface AiPresetChipSpec {
  id: string;
  label: string;
  suggestedName: string;
  target: CodegenTargetId;
  layoutMode: 'freeform' | 'auto';
  prompt: string;
}

const AI_ARCHITECT_PRESETS: AiPresetChipSpec[] = [
  {
    id: 'crm',
    label: 'Gestionale Clienti & Fatture',
    suggestedName: 'Gestionale Clienti Pro',
    target: 'react-tsx',
    layoutMode: 'freeform',
    prompt:
      'Crea un gestionale aziendale clienti e fatturazione elettronica con barra di navigazione superiore, 3 schede KPI (Fatturato Mensile, Fatture da Incassare, Clienti Attivi), modulo inserimento cliente/fattura con validazione TypeScript e tabella elenco fatture filtrabile.',
  },
  {
    id: 'kpi',
    label: 'Dashboard KPI & Ordini',
    suggestedName: 'Analytics & Ordini Suite',
    target: 'nextjs-app',
    layoutMode: 'auto',
    prompt:
      'Progetta una dashboard direzionale KPI e controllo ordini in tempo reale con metriche finanziarie, filtri rapidi per periodo/reparto, form creazione ordine rapido collegato ad handler TypeScript e griglia ordini recenti con stato spedizione.',
  },
  {
    id: 'htmx',
    label: 'App Ricerca Live HTMX',
    suggestedName: 'Catalogo Hypermedia HTMX',
    target: 'htmx',
    layoutMode: 'auto',
    prompt:
      'Realizza un portale inventario e ricerca istantanea basato su HTMX 2.x con barra di ricerca hx-get live, contatori giacenze magazzino, form aggiunta articolo rapido senza ricaricamento pagina e tabella risultati aggiornabile parzialmente.',
  },
  {
    id: 'three3d',
    label: 'Showcase Prodotto 3D + UI',
    suggestedName: 'Configuratore 3D Studio',
    target: 'react-tsx',
    layoutMode: 'freeform',
    prompt:
      'Costruisci un configuratore visuale di prodotto con viewport 3D Three.js interattivo integrato nella schermata, indicatori tecnici materiali/dimensioni, form configurazione variante e pulsante preventivo collegato a logica script e Blueprint.',
  },
];

const CHAT_STARTER_QUESTIONS: string[] = [
  'Quale dei 26 framework consigli per un gestionale desktop offline su Windows?',
  'Progetta le schermate e la struttura dati per un software magazzino con codici a barre.',
  'Confronta Posizionamento Libero (X, Y) e Auto-Layout per una dashboard industriale.',
];

function isAutomatedTempTestArtifact(rp: ProjectSummary): boolean {
  const combined = `${rp.rootDiskPath ?? ''} ${rp.dbFilePath ?? ''}`.toLowerCase();
  return (
    combined.includes('visual-ui-studio-v2-e2e-') ||
    combined.includes('visual-ui-studio-v2-scaffold-') ||
    /appdata[\\/]local[\\/]temp[\\/]visual-ui-studio/i.test(combined) ||
    /\/tmp\/visual-ui-studio/i.test(combined)
  );
}

function formatCleanProjectLocation(rp: ProjectSummary): { label: string; isDiskLinked: boolean } {
  if (rp.rootDiskPath && rp.rootDiskPath.trim().length > 0) {
    const raw = rp.rootDiskPath.trim();
    const shortened = raw
      .replace(/^[A-Za-z]:\\Users\\[^\\]+\\/i, '~\\')
      .replace(/^\/Users\/[^/]+\//, '~/')
      .replace(/^\/home\/[^/]+\//, '~/');
    return { label: shortened, isDiskLinked: true };
  }
  return { label: 'Workspace VFS Interno (SQLite)', isDiskLinked: false };
}

function formatModelSizeGb(sizeBytes?: number): string | null {
  if (!sizeBytes || sizeBytes <= 0) return null;
  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function matchesTemplateCategory(target: TargetDescriptor, cat: TemplateFilterCategory): boolean {
  if (cat === 'all') return true;
  if (cat === 'web_htmx') {
    return ['html-vanilla', 'htmx', 'alpinejs', 'astro', 'lit-wc'].includes(target.id);
  }
  if (cat === 'spa_fullstack') {
    return ['react-tsx', 'nextjs-app', 'vue3', 'svelte5', 'angular', 'solidjs', 'qwik', 'blazor-razor'].includes(
      target.id,
    );
  }
  if (cat === 'desktop') {
    return [
      'electron-target',
      'tauri-v2',
      'dotnet-maui',
      'winui3-xaml',
      'avalonia-ui',
      'cpp-qt-qml',
      'rust-slint',
      'go-wails',
    ].includes(target.id);
  }
  if (cat === 'mobile') {
    return ['react-native', 'flutter-dart', 'swiftui', 'jetpack-compose'].includes(target.id);
  }
  if (cat === 'python_embedded') {
    return [
      'python-streamlit',
      'python-gradio',
      'python-pyside6',
      'python-customtkinter',
      'lvgl-c',
      'unity-uitoolkit',
    ].includes(target.id);
  }
  return false;
}

export const ProjectLaunchHub: React.FC = () => {
  const showProjectHub = useStudioStore((s) => s.showProjectHub);
  const hasOpenedProjectInSession = useStudioStore((s) => s.hasOpenedProjectInSession);
  const hubActiveSection = useStudioStore((s) => s.hubActiveSection);
  const project = useStudioStore((s) => s.project);
  const recentProjects = useStudioStore((s) => s.recentProjects);
  const targets = useStudioStore((s) => s.targets);
  const studioTheme = useStudioStore((s) => s.studioTheme);

  const ollamaEnsureStatus = useStudioStore((s) => s.ollamaEnsureStatus);
  const ollamaStartedByApp = useStudioStore((s) => s.ollamaStartedByApp);
  const ollamaStatusMessage = useStudioStore((s) => s.ollamaStatusMessage);
  const hardwareReport = useStudioStore((s) => s.hardwareReport);
  const providers = useStudioStore((s) => s.providers);
  const activeProvider = useStudioStore((s) => s.activeProvider);
  const activeModel = useStudioStore((s) => s.activeModel);
  const isGeneratingAiProject = useStudioStore((s) => s.isGeneratingAiProject);
  const aiProjectGenStatus = useStudioStore((s) => s.aiProjectGenStatus);
  const startupChatMessages = useStudioStore((s) => s.startupChatMessages);
  const isRunningStartupChat = useStudioStore((s) => s.isRunningStartupChat);
  const startupChatStreaming = useStudioStore((s) => s.startupChatStreaming);
  const unslothCatalog = useStudioStore((s) => s.unslothCatalog);
  const pullProgress = useStudioStore((s) => s.pullProgress);
  const toolchainDoctor = useStudioStore((s) => s.toolchainDoctor);

  const setShowProjectHub = useStudioStore((s) => s.setShowProjectHub);
  const setHubActiveSection = useStudioStore((s) => s.setHubActiveSection);
  const setWizardOpen = useStudioStore((s) => s.setWizardOpen);
  const setImportCodeModalOpen = useStudioStore((s) => s.setImportCodeModalOpen);
  const createNewProject = useStudioStore((s) => s.createNewProject);
  const createQuickFreeformProject = useStudioStore((s) => s.createQuickFreeformProject);
  const createProjectFromWizard = useStudioStore((s) => s.createProjectFromWizard);
  const createAndInitDiskProjectAction = useStudioStore((s) => s.createAndInitDiskProjectAction);
  const openExistingDiskProjectAction = useStudioStore((s) => s.openExistingDiskProjectAction);
  const refreshToolchainDoctor = useStudioStore((s) => s.refreshToolchainDoctor);
  const openDemoProject = useStudioStore((s) => s.openDemoProject);
  const openRecentProject = useStudioStore((s) => s.openRecentProject);
  const removeRecentProject = useStudioStore((s) => s.removeRecentProject);
  const setStudioTheme = useStudioStore((s) => s.setStudioTheme);
  const ensureOllamaRunningAction = useStudioStore((s) => s.ensureOllamaRunningAction);
  const refreshAiProviders = useStudioStore((s) => s.refreshAiProviders);
  const setActiveProvider = useStudioStore((s) => s.setActiveProvider);
  const setActiveModel = useStudioStore((s) => s.setActiveModel);
  const generateProjectWithAiAction = useStudioStore((s) => s.generateProjectWithAiAction);
  const sendStartupChatPrompt = useStudioStore((s) => s.sendStartupChatPrompt);
  const clearStartupChat = useStudioStore((s) => s.clearStartupChat);
  const pullUnslothModel = useStudioStore((s) => s.pullUnslothModel);

  // Local UI state for Startup Architect, Chat, Recents & Templates
  const [aiTab, setAiTab] = useState<ArchitectSubMode>('create');
  const [aiProjectName, setAiProjectName] = useState('');
  const [aiTarget, setAiTarget] = useState<CodegenTargetId>('react-tsx');
  const [aiLayoutMode, setAiLayoutMode] = useState<'freeform' | 'auto'>('freeform');
  const [aiPrompt, setAiPrompt] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [elapsedSec, setElapsedSec] = useState(0);

  const [searchQuery, setSearchQuery] = useState('');
  const [recentLayoutFilter, setRecentLayoutFilter] = useState<'all' | 'freeform' | 'auto' | 'disk'>('all');
  const [templateCat, setTemplateCat] = useState<TemplateFilterCategory>('all');
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateLayoutMode, setTemplateLayoutMode] = useState<'freeform' | 'auto'>('freeform');
  const [customPullModelInput, setCustomPullModelInput] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // v3.0 11-Stack Real Disk Project Quick Initializer State
  const [quickStackId, setQuickStackId] = useState<ProjectStackId>('react');
  const [quickLanguage, setQuickLanguage] = useState<PrimaryCodeLanguage>('typescript');
  const [quickPythonCompanion, setQuickPythonCompanion] = useState<PythonCompanionKind>('none');
  const [quickProjectName, setQuickProjectName] = useState<string>('Mio Progetto Studio');
  const [quickParentDir, setQuickParentDir] = useState<string>('');
  const [quickRunInit, setQuickRunInit] = useState<boolean>(true);

  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  // Allow Escape to return to Workbench ONLY when user already opened a project in this session
  useEffect(() => {
    if (!showProjectHub) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && hasOpenedProjectInSession && project) {
        setShowProjectHub(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showProjectHub, hasOpenedProjectInSession, project, setShowProjectHub]);

  // Live elapsed timer during AI project generation
  useEffect(() => {
    if (!isGeneratingAiProject || !aiProjectGenStatus) {
      setElapsedSec(0);
      return;
    }
    const tick = () => {
      setElapsedSec(Math.max(0, (Date.now() - aiProjectGenStatus.startedAt) / 1000));
    };
    tick();
    const timer = setInterval(tick, 150);
    return () => clearInterval(timer);
  }, [isGeneratingAiProject, aiProjectGenStatus]);

  // Auto-scroll startup operational chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [startupChatMessages, startupChatStreaming?.text]);

  const ollamaProv = useMemo(() => providers.find((p) => p.id === 'ollama'), [providers]);
  const isOllamaOnline = Boolean(ollamaProv?.online || ollamaEnsureStatus === 'online');

  const rankedOllamaModels: LocalAIModelInfo[] = useMemo(
    () => filterAndRankLocalModels(ollamaProv?.models ?? []),
    [ollamaProv],
  );

  const selectedOllamaModelValue = useMemo(() => {
    if (rankedOllamaModels.length > 0) {
      if (rankedOllamaModels.some((m) => m.id === activeModel) && !isEmbeddingOnlyModelName(activeModel)) {
        return activeModel;
      }
      return pickPreferredLocalModel(rankedOllamaModels) ?? rankedOllamaModels[0].id;
    }
    return 'offline-studio-architect-v1';
  }, [rankedOllamaModels, activeModel]);

  // Smart filtering of automated E2E temp test artifacts:
  // If non-temp projects exist, hide stray `AppData\Local\Temp\visual-ui-studio*` entries automatically.
  // If ALL projects live inside `Temp\visual-ui-studio*` (because the app itself was launched with `STUDIO_DATA_DIR` in E2E), keep them!
  const visibleBaseRecents = useMemo(() => {
    const nonTemp = recentProjects.filter((rp) => !isAutomatedTempTestArtifact(rp));
    return nonTemp.length > 0 ? nonTemp : recentProjects;
  }, [recentProjects]);

  const filteredRecents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return visibleBaseRecents.filter((rp) => {
      if (recentLayoutFilter === 'freeform' && rp.layoutMode !== 'freeform') return false;
      if (recentLayoutFilter === 'auto' && rp.layoutMode === 'freeform') return false;
      if (recentLayoutFilter === 'disk' && !rp.rootDiskPath) return false;
      if (!q) return true;
      return (
        rp.name.toLowerCase().includes(q) ||
        rp.primaryTarget.toLowerCase().includes(q) ||
        (rp.rootDiskPath ?? '').toLowerCase().includes(q)
      );
    });
  }, [visibleBaseRecents, searchQuery, recentLayoutFilter]);

  const filteredTemplates = useMemo(() => {
    const q = templateSearch.trim().toLowerCase();
    return targets.filter((t) => {
      if (templateCat !== 'three_blueprint' && !matchesTemplateCategory(t, templateCat)) {
        return false;
      }
      if (!q) return true;
      return (
        t.displayName.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.languages.some((l) => l.toLowerCase().includes(q))
      );
    });
  }, [targets, templateCat, templateSearch]);

  if (!showProjectHub) return null;

  const targetDisplayName = (targetId: string) =>
    targets.find((t) => t.id === targetId)?.displayName ?? targetId;

  const formatTimestamp = (ts: number) => {
    if (!ts) return 'Recente';
    try {
      return new Date(ts).toLocaleString('it-IT', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return 'Recente';
    }
  };

  const handleSelectOllamaModel = (modelId: string) => {
    if (modelId === 'offline-studio-architect-v1') {
      setActiveProvider('builtin_offline');
      setActiveModel(modelId);
      return;
    }
    if (activeProvider !== 'ollama') {
      setActiveProvider('ollama');
    }
    setActiveModel(modelId);
  };

  const handleOpenDiskDirectory = async () => {
    setBusyAction('disk');
    try {
      await openExistingDiskProjectAction();
    } finally {
      setBusyAction(null);
    }
  };

  const handleSelectQuickStack = (stackId: ProjectStackId) => {
    setQuickStackId(stackId);
    const desc = getProjectStackDescriptor(stackId);
    if (!desc.supportedLanguages.includes(quickLanguage)) {
      setQuickLanguage(desc.defaultLanguage);
    }
    if (!desc.supportsPythonCompanion) {
      setQuickPythonCompanion('none');
    }
  };

  const handlePickQuickFolder = async () => {
    const chosen = await getStudioApi().project.pickDirectory('Scegli Cartella Padre per il Progetto');
    if (chosen) {
      setQuickParentDir(chosen);
    }
  };

  const handleCreateRealDiskProject = async () => {
    setBusyAction('create_disk_stack');
    try {
      const desc = getProjectStackDescriptor(quickStackId);
      await createAndInitDiskProjectAction({
        name: quickProjectName.trim() || `App ${desc.shortLabel}`,
        targetParentDir: quickParentDir.trim(),
        stackId: quickStackId,
        primaryLanguage: quickLanguage,
        pythonCompanion: quickLanguage === 'python' ? (quickPythonCompanion === 'flask' ? 'flask' : 'fastapi') : quickPythonCompanion,
        stylingPreset: desc.defaultDialect,
        layoutMode: 'freeform',
        defaultThemeMode: studioTheme,
        runToolchainInit: quickRunInit,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleImportCodeFromHub = () => {
    if (project) {
      setShowProjectHub(false);
    }
    setImportCodeModalOpen(true);
  };

  const handleQuickFreeform = async () => {
    setBusyAction('freeform');
    try {
      await createQuickFreeformProject('Tela Libera Studio');
    } finally {
      setBusyAction(null);
    }
  };

  const handleQuickAutoLayout = async () => {
    setBusyAction('autolayout');
    try {
      await createProjectFromWizard({
        name: 'Workspace Auto-Layout Pro',
        category: 'web',
        primaryTarget: 'react-tsx',
        stylingPreset: 'tailwind',
        layoutMode: 'auto',
        starterPages: ['home', 'dashboard'],
        includeTsScript: true,
        includeBlueprint: true,
        includeThreeScene: false,
        paletteId: 'dark-pro',
        defaultThemeMode: studioTheme,
        seedDemoContent: false,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleQuickThreeBlueprint = async () => {
    setBusyAction('three');
    try {
      await createProjectFromWizard({
        name: 'Studio 3D Three.js & Blueprint',
        category: 'three_game',
        primaryTarget: 'react-tsx',
        stylingPreset: 'vanilla-css',
        layoutMode: 'freeform',
        starterPages: ['home'],
        includeTsScript: true,
        includeBlueprint: true,
        includeThreeScene: true,
        threePresetId: 'scifi-orbital-system',
        paletteId: 'cyberpunk-neon',
        defaultThemeMode: 'dark',
        seedDemoContent: false,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleOpenDemo = async () => {
    setBusyAction('demo');
    try {
      await openDemoProject();
    } finally {
      setBusyAction(null);
    }
  };

  const handleGenerateAiProject = async () => {
    if (!aiPrompt.trim() || isGeneratingAiProject) return;
    const targetDesc = targets.find((t) => t.id === aiTarget);
    await generateProjectWithAiAction({
      prompt: aiPrompt.trim(),
      projectName: aiProjectName.trim() || undefined,
      primaryTarget: aiTarget,
      stylingPreset: targetDesc?.defaultDialect ?? 'tailwind',
      layoutMode: aiLayoutMode,
      provider: isOllamaOnline ? 'ollama' : 'builtin_offline',
      modelName: isOllamaOnline ? selectedOllamaModelValue : 'offline-studio-architect-v1',
    });
  };

  const handleSendChat = async () => {
    const text = chatInput.trim();
    if (!text || isRunningStartupChat) return;
    setChatInput('');
    await sendStartupChatPrompt(text);
  };

  const handleCreateProjectFromChatReply = async (suggestedPrompt: string, replyContent: string) => {
    const combinedPrompt = (suggestedPrompt || replyContent).trim();
    setAiPrompt(combinedPrompt);
    setAiTab('create');
    const targetDesc = targets.find((t) => t.id === aiTarget);
    await generateProjectWithAiAction({
      prompt: combinedPrompt,
      projectName: aiProjectName.trim() || undefined,
      primaryTarget: aiTarget,
      stylingPreset: targetDesc?.defaultDialect ?? 'tailwind',
      layoutMode: aiLayoutMode,
      provider: isOllamaOnline ? 'ollama' : 'builtin_offline',
      modelName: isOllamaOnline ? selectedOllamaModelValue : 'offline-studio-architect-v1',
    });
  };

  const handleCreateFromTemplateTarget = async (target: TargetDescriptor) => {
    setBusyAction(`tpl_${target.id}`);
    try {
      await createNewProject(
        `Progetto ${target.displayName.split(' ')[0]}`,
        target.id,
        target.defaultDialect,
        templateLayoutMode,
      );
    } finally {
      setBusyAction(null);
    }
  };

  const renderRecentRow = (rp: ProjectSummary) => {
    const isFreeform = rp.layoutMode === 'freeform';
    const loc = formatCleanProjectLocation(rp);
    return (
      <div
        key={rp.id}
        className="ide-recent-row"
        data-testid={`recent-project-card-${rp.id}`}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <span
            className="ide-quick-tile-icon"
            style={{
              background: isFreeform ? 'var(--accent-amber-soft)' : 'var(--accent-soft)',
              color: isFreeform ? 'var(--accent-amber)' : 'var(--accent-primary)',
            }}
          >
            {isFreeform ? <Move size={14} /> : <LayoutGrid size={14} />}
          </span>

          <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <strong
                style={{
                  fontSize: 12.5,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 220,
                }}
              >
                {rp.name}
              </strong>
              <span className="badge blue">
                {rp.stackId ? getProjectStackDescriptor(rp.stackId).shortLabel : targetDisplayName(rp.primaryTarget)}
              </span>
              {rp.primaryLanguage && (
                <span className="badge green">
                  {rp.primaryLanguage === 'typescript' ? 'TS' : rp.primaryLanguage === 'python' ? 'Python' : 'JS'}
                </span>
              )}
              <span className={`badge ${isFreeform ? 'amber' : 'violet'}`}>
                {isFreeform ? 'Libero (X,Y)' : 'Auto-Layout'}
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 10.5,
                color: 'var(--text-muted)',
                minWidth: 0,
              }}
            >
              <span
                style={{
                  fontFamily: "'JetBrains Mono', Consolas, monospace",
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 260,
                  color: loc.isDiskLinked ? 'var(--accent-emerald)' : 'var(--text-muted)',
                }}
                title={rp.rootDiskPath || 'Archivio progetto SQLite gestito da Visual UI Studio'}
              >
                {loc.isDiskLinked ? `📂 ${loc.label}` : `🗄️ ${loc.label}`}
              </span>
              <span>• {formatTimestamp(rp.updatedAt)}</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <button
            type="button"
            className="studio-btn sm ghost danger"
            data-testid={`btn-remove-recent-${rp.id}`}
            title="Rimuovi dalla cronologia recenti"
            onClick={(e) => {
              e.stopPropagation();
              void removeRecentProject(rp.id);
            }}
          >
            <Trash2 size={12} />
          </button>

          <button
            type="button"
            className="studio-btn sm primary"
            data-testid={`btn-open-recent-${rp.id}`}
            onClick={() => void openRecentProject(rp.id)}
          >
            <Workflow size={11} />
            <span>Apri</span>
          </button>
        </div>
      </div>
    );
  };

  const navItems: Array<{
    id: HubSectionId;
    label: string;
    badge?: string;
    badgeClass?: string;
  }> = [
    {
      id: 'architect',
      label: '🤖 Crea con AI & Progetti',
    },
    {
      id: 'recents',
      label: '🗂️ Progetti Recenti & Disco',
      badge: String(visibleBaseRecents.length),
    },
    {
      id: 'templates',
      label: '🧩 Template (26 Framework)',
      badge: String(targets.length),
      badgeClass: 'violet',
    },
    {
      id: 'ollama',
      label: '⚙️ Motore Ollama Locale',
      badge: isOllamaOnline ? 'ON' : 'OFF',
      badgeClass: isOllamaOnline ? 'green' : 'amber',
    },
  ];

  return (
    <div className="ide-startup-workbench" data-testid="project-launch-hub">
      {/* =====================================================================
          LEFT IDE SIDEBAR RAIL (236px, Flush Border-Right, Zero Marketing)
         ===================================================================== */}
      <aside className="ide-hub-rail" aria-label="Navigazione Startup IDE">
        <div>
          {/* App Identity Header */}
          <div className="ide-hub-identity">
            <img
              src="./app-icon.png"
              alt="Visual UI Studio"
              width={38}
              height={38}
              style={{ borderRadius: 9, flexShrink: 0, display: 'block' }}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <strong style={{ fontSize: 13.5, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
                  Visual UI Studio
                </strong>
                <span className="badge blue">0.1.0</span>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', marginTop: 1 }}>
                IDE Visuale &amp; AI Locale
              </div>
            </div>
          </div>

          {/* Primary IDE Navigation */}
          <nav className="ide-hub-nav">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`ide-hub-nav-item ${hubActiveSection === item.id ? 'active' : ''}`}
                data-testid={`hub-nav-${item.id}`}
                onClick={() => setHubActiveSection(item.id)}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.label}
                </span>
                {item.badge && (
                  <span className={`badge ${item.badgeClass ?? ''}`}>{item.badge}</span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Left Rail Quick Actions Footer */}
        <div className="ide-hub-rail-footer">
          <div
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--text-muted)',
              padding: '0 2px 2px',
            }}
          >
            Azioni Rapide Sistema
          </div>

          <button
            type="button"
            className="ide-hub-rail-action"
            data-testid="btn-hub-open-disk-folder"
            disabled={busyAction !== null}
            onClick={() => void handleOpenDiskDirectory()}
          >
            <FolderOpen size={13} color="var(--accent-amber)" />
            <span>Apri Cartella da Disco...</span>
          </button>

          <button
            type="button"
            className="ide-hub-rail-action"
            data-testid="btn-launch-wizard"
            onClick={() => setWizardOpen(true)}
          >
            <Wand2 size={13} color="var(--accent-primary)" />
            <span>Creazione Guidata (5 Passi)</span>
          </button>

          <button
            type="button"
            className="ide-hub-rail-action"
            data-testid="btn-hub-import-code"
            onClick={handleImportCodeFromHub}
          >
            <FileUp size={13} color="var(--accent-violet)" />
            <span>Importa HTML / JSX / SVG...</span>
          </button>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: 4,
              gap: 6,
            }}
          >
            <button
              type="button"
              className="studio-btn sm"
              style={{ flex: 1 }}
              onClick={() => void setStudioTheme(studioTheme === 'dark' ? 'light' : 'dark')}
              title="Cambia tema interfaccia IDE"
            >
              {studioTheme === 'dark' ? <Sun size={11} /> : <Moon size={11} />}
              <span>{studioTheme === 'dark' ? 'Passa a Tema Chiaro' : 'Passa a Tema Scuro'}</span>
            </button>
          </div>

          {hasOpenedProjectInSession && project && (
            <button
              type="button"
              className="ide-hub-rail-action return-editor"
              data-testid="btn-close-project-hub"
              onClick={() => setShowProjectHub(false)}
              title={`Torna al progetto attivo "${project.name}"`}
            >
              <Play size={12} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Torna a &ldquo;{project.name}&rdquo;
              </span>
            </button>
          )}
        </div>
      </aside>

      {/* =====================================================================
          MAIN OPERATIONAL AREA (100% Height, Zero Empty Marketing Space)
         ===================================================================== */}
      <main className="ide-hub-main">
        {/* -------------------------------------------------------------------
            VIEW 1 (DEFAULT): 🤖 CREA CON AI & PROGETTI (2-COLUMN IDE SPLIT)
           ------------------------------------------------------------------- */}
        {hubActiveSection === 'architect' && (
          <div className="ide-hub-split">
            {/* COLUMN A: 🤖 Architetto di Progetto AI Locale (Ollama) */}
            <section
              className="ide-hub-panel with-border-right"
              data-testid="hub-ai-architect-panel"
            >
              <div className="ide-hub-panel-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Bot size={15} color="var(--accent-primary)" />
                  <strong style={{ fontSize: 13 }}>Architetto di Progetto AI Locale (Ollama)</strong>
                </div>
                <span className="badge">SQLite + VFS + 26 Target</span>
              </div>

              {/* Live Engine Header Bar */}
              <div className="ide-ollama-engine-bar">
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  {isOllamaOnline ? (
                    <span className="badge green" style={{ padding: '2px 7px', fontSize: 10.5 }}>
                      🟢 Ollama Attivo (:11434)
                      {ollamaStartedByApp ? ' • Auto-Avviato' : ''}
                    </span>
                  ) : ollamaEnsureStatus === 'starting' ? (
                    <span className="badge amber" style={{ padding: '2px 7px', fontSize: 10.5 }}>
                      <Loader2 size={10} className="spin-icon" />
                      <span>Avvio automatico Ollama...</span>
                    </span>
                  ) : (
                    <>
                      <span className="badge amber">Ollama Offline</span>
                      <button
                        type="button"
                        className="studio-btn sm primary"
                        data-testid="btn-hub-start-ollama"
                        onClick={() => void ensureOllamaRunningAction(false)}
                      >
                        <Zap size={11} />
                        <span>Avvia Ollama</span>
                      </button>
                    </>
                  )}
                </div>

                {/* Local Model Selector + Refresh */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, justifyContent: 'flex-end', minWidth: 210 }}>
                  <select
                    className="studio-select"
                    style={{ height: 25, fontSize: 11, maxWidth: 260, width: '100%' }}
                    data-testid="hub-ollama-model-select"
                    aria-label="Modello Ollama locale per progettazione e chat"
                    value={selectedOllamaModelValue}
                    onChange={(e) => handleSelectOllamaModel(e.target.value)}
                  >
                    {rankedOllamaModels.length > 0 ? (
                      rankedOllamaModels.map((m) => {
                        const gb = formatModelSizeGb(m.sizeBytes);
                        const metaParts = [m.quantization, gb].filter(Boolean).join(' • ');
                        return (
                          <option key={m.id} value={m.id}>
                            {m.name}
                            {metaParts ? ` (${metaParts})` : ''}
                            {m.loadedInVram ? ' ⚡ VRAM' : ''}
                          </option>
                        );
                      })
                    ) : (
                      <option value="offline-studio-architect-v1">
                        Sintetizzatore UI Locale (Fallback Offline)
                      </option>
                    )}
                  </select>

                  <button
                    type="button"
                    className="studio-btn sm"
                    data-testid="btn-hub-refresh-ollama"
                    title="Aggiorna demone e modelli Ollama su :11434"
                    onClick={() => void ensureOllamaRunningAction(false)}
                  >
                    <RefreshCw size={11} />
                  </button>
                </div>
              </div>

              {/* Mode Segmented Switch */}
              <div className="ide-hub-mode-bar">
                <div className="segmented-group" role="tablist" aria-label="Modalità AI Startup">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={aiTab === 'create'}
                    className={`segmented-item ${aiTab === 'create' ? 'active' : ''}`}
                    data-testid="hub-ai-tab-create"
                    onClick={() => setAiTab('create')}
                  >
                    <span>🏗️ Crea Progetto con AI</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={aiTab === 'chat'}
                    className={`segmented-item ${aiTab === 'chat' ? 'active' : ''}`}
                    data-testid="hub-ai-tab-chat"
                    onClick={() => setAiTab('chat')}
                  >
                    <span>💬 Chat Operativa Ollama</span>
                    {startupChatMessages.length > 0 && (
                      <span className="badge blue">{startupChatMessages.length}</span>
                    )}
                  </button>
                </div>

                {aiTab === 'chat' && startupChatMessages.length > 0 && (
                  <button
                    type="button"
                    className="studio-btn sm ghost"
                    onClick={clearStartupChat}
                    title="Azzera conversazione di avvio"
                  >
                    <Trash2 size={11} />
                    <span>Pulisci</span>
                  </button>
                )}
              </div>

              {/* SUB-MODE A1: 🏗️ Crea Progetto con AI */}
              {aiTab === 'create' ? (
                <>
                  <div className="ide-hub-scroll-body">
                    {/* Compact 3-Field Config Row */}
                    <div className="ide-config-grid-3">
                      <div className="ide-field-block">
                        <label className="ide-field-label" htmlFor="hub-ai-project-name">
                          Nome Progetto
                        </label>
                        <input
                          id="hub-ai-project-name"
                          className="studio-input"
                          style={{ height: 28 }}
                          data-testid="hub-ai-project-name"
                          placeholder="Opzionale (scelto dall'AI)"
                          value={aiProjectName}
                          onChange={(e) => setAiProjectName(e.target.value)}
                        />
                      </div>

                      <div className="ide-field-block">
                        <label className="ide-field-label" htmlFor="hub-ai-target-select">
                          Framework Target ({targets.length})
                        </label>
                        <select
                          id="hub-ai-target-select"
                          className="studio-select"
                          style={{ height: 28 }}
                          data-testid="hub-ai-target-select"
                          value={aiTarget}
                          onChange={(e) => setAiTarget(e.target.value as CodegenTargetId)}
                        >
                          {targets.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.displayName} ({t.fileExtension})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="ide-field-block">
                        <label className="ide-field-label" htmlFor="hub-ai-layout-select">
                          Modalità Canvas
                        </label>
                        <select
                          id="hub-ai-layout-select"
                          className="studio-select"
                          style={{ height: 28 }}
                          data-testid="hub-ai-layout-select"
                          value={aiLayoutMode}
                          onChange={(e) => setAiLayoutMode(e.target.value as 'freeform' | 'auto')}
                        >
                          <option value="freeform">Posizionamento Libero (X, Y)</option>
                          <option value="auto">Auto-Layout (Flex / Grid)</option>
                        </select>
                      </div>
                    </div>

                    {/* Prompt Box */}
                    <div className="ide-field-block">
                      <label className="ide-field-label" htmlFor="hub-ai-project-prompt">
                        Specifiche Funzionali &amp; Interfaccia del Progetto
                      </label>
                      <textarea
                        id="hub-ai-project-prompt"
                        className="studio-textarea"
                        style={{ minHeight: 112, resize: 'vertical', lineHeight: 1.45 }}
                        data-testid="hub-ai-project-prompt"
                        placeholder="Descrivi cosa deve fare il progetto: schermate, menu, tabelle, form, stile grafico o logica... Ollama progetterà l'interfaccia e il codice iniziale."
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                      />
                    </div>

                    {/* 4 Compact Preset Chips */}
                    <div className="ide-field-block">
                      <span className="ide-field-label">Preset Operativi 1-Click</span>
                      <div className="ide-preset-chips">
                        {AI_ARCHITECT_PRESETS.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            className="ide-preset-chip"
                            data-testid={`hub-preset-${preset.id}`}
                            onClick={() => {
                              setAiPrompt(preset.prompt);
                              setAiProjectName(preset.suggestedName);
                              setAiTarget(preset.target);
                              setAiLayoutMode(preset.layoutMode);
                            }}
                          >
                            <Sparkles size={11} color="var(--accent-primary)" />
                            <span>{preset.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Live Generation Stream Box OR Technical Scaffold Summary */}
                    {isGeneratingAiProject && aiProjectGenStatus ? (
                      <div className="ide-gen-stream-box" data-testid="hub-ai-gen-stream">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <Loader2 size={13} className="spin-icon" color="var(--accent-primary)" />
                            <strong style={{ fontSize: 12 }}>{aiProjectGenStatus.status}</strong>
                          </div>
                          <span
                            style={{
                              fontFamily: "'JetBrains Mono', Consolas, monospace",
                              fontSize: 11,
                              color: 'var(--accent-emerald)',
                            }}
                          >
                            {elapsedSec.toFixed(1)}s • {aiProjectGenStatus.percent}%
                          </span>
                        </div>

                        <div className="ide-progress-track">
                          <div
                            className="ide-progress-fill"
                            style={{ width: `${Math.min(100, Math.max(8, aiProjectGenStatus.percent))}%` }}
                          />
                        </div>

                        {aiProjectGenStatus.streamedTokens && (
                          <pre
                            style={{
                              margin: 0,
                              maxHeight: 130,
                              overflowY: 'auto',
                              padding: '7px 9px',
                              borderRadius: 5,
                              background: 'var(--code-bg)',
                              border: '1px solid var(--border-subtle)',
                              fontFamily: "'JetBrains Mono', Consolas, monospace",
                              fontSize: 10.5,
                              color: 'var(--text-secondary)',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            {aiProjectGenStatus.streamedTokens}
                          </pre>
                        )}
                      </div>
                    ) : (
                      <div className="ide-spec-summary-box">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>
                            Struttura VFS Multi-File Generata in Automatico
                          </span>
                          <span className="badge">
                            {aiLayoutMode === 'freeform' ? 'Coordinate (X, Y)' : 'Flex / Grid'}
                          </span>
                        </div>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                            gap: '4px 10px',
                            fontFamily: "'JetBrains Mono', Consolas, monospace",
                            fontSize: 10.5,
                            color: 'var(--text-secondary)',
                          }}
                        >
                          <span>• /src/screens/*.canvas (UI-IR)</span>
                          <span>• /src/styles/theme-and-sheet.css</span>
                          <span>• /src/scripts/handlers.ts</span>
                          <span>• /src/blueprints/*.blueprint.json</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Pinned Primary CTA Footer */}
                  <div className="ide-hub-cta-footer">
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Motore:{' '}
                      <strong style={{ color: 'var(--text-secondary)' }}>
                        {isOllamaOnline ? selectedOllamaModelValue : 'Sintetizzatore Locale'}
                      </strong>
                    </span>

                    <button
                      type="button"
                      className="studio-btn primary"
                      style={{ height: 32, padding: '0 16px', fontSize: 12.5 }}
                      data-testid="btn-hub-ai-generate-project"
                      disabled={!aiPrompt.trim() || isGeneratingAiProject}
                      onClick={() => void handleGenerateAiProject()}
                    >
                      {isGeneratingAiProject ? (
                        <>
                          <Loader2 size={13} className="spin-icon" />
                          <span>Generazione in corso...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles size={13} />
                          <span>Genera Progetto con Ollama</span>
                        </>
                      )}
                    </button>
                  </div>
                </>
              ) : (
                /* SUB-MODE A2: 💬 Chat Operativa Ollama */
                <>
                  <div
                    ref={chatScrollRef}
                    className="ide-hub-scroll-body"
                    data-testid="hub-ai-chat-history"
                  >
                    {startupChatMessages.length === 0 && !startupChatStreaming && (
                      <div className="ide-spec-summary-box" style={{ gap: 9 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <MessageSquare size={14} color="var(--accent-primary)" />
                          <strong style={{ fontSize: 12 }}>
                            Dialoga con Ollama prima di generare il progetto
                          </strong>
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                          Chiedi consigli sull&apos;architettura UI, scegli il framework migliore tra i 26 supportati o definisci schermate e form: con un clic potrai trasformare la risposta in un progetto completo.
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          {CHAT_STARTER_QUESTIONS.map((q, idx) => (
                            <button
                              key={idx}
                              type="button"
                              className="ide-preset-chip"
                              style={{ justifyContent: 'flex-start', height: 'auto', padding: '6px 9px', textAlign: 'left' }}
                              onClick={() => void sendStartupChatPrompt(q)}
                            >
                              <span>→ {q}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {startupChatMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`chat-bubble ${msg.role}`}
                        style={{ display: 'flex', flexDirection: 'column', gap: 7 }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            fontSize: 10,
                            color: 'var(--text-muted)',
                          }}
                        >
                          <strong>{msg.role === 'user' ? 'Tu' : `Ollama (${msg.modelName ?? selectedOllamaModelValue})`}</strong>
                          {typeof msg.latencyMs === 'number' && <span>{msg.latencyMs} ms</span>}
                        </div>

                        <div style={{ whiteSpace: 'pre-wrap', userSelect: 'text' }}>{msg.content}</div>

                        {msg.role === 'assistant' && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 2, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="studio-btn sm primary"
                              data-testid="btn-chat-create-project"
                              disabled={isGeneratingAiProject}
                              onClick={() =>
                                void handleCreateProjectFromChatReply(
                                  msg.suggestedProjectPrompt || '',
                                  msg.content,
                                )
                              }
                            >
                              <Plus size={11} />
                              <span>Crea Progetto da questa Conversazione</span>
                            </button>

                            <button
                              type="button"
                              className="studio-btn sm"
                              onClick={() => {
                                setAiPrompt(msg.suggestedProjectPrompt || msg.content);
                                setAiTab('create');
                              }}
                            >
                              <span>Modifica nel Prompt</span>
                            </button>
                          </div>
                        )}
                      </div>
                    ))}

                    {startupChatStreaming && (
                      <div className="chat-bubble assistant" data-testid="hub-ai-chat-streaming">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--accent-primary)', marginBottom: 4 }}>
                          <Loader2 size={11} className="spin-icon" />
                          <strong>Risposta live da {selectedOllamaModelValue}...</strong>
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap' }}>
                          {startupChatStreaming.text || 'Elaborazione token in corso...'}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Chat Input Footer */}
                  <div className="ide-hub-cta-footer" style={{ gap: 8 }}>
                    <input
                      className="studio-input"
                      style={{ flex: 1, height: 30 }}
                      data-testid="hub-ai-chat-input"
                      placeholder="Scrivi a Ollama (es. struttura schermate, componenti, HTMX, Three.js)..."
                      value={chatInput}
                      disabled={isRunningStartupChat}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void handleSendChat();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="studio-btn primary"
                      style={{ height: 30, padding: '0 13px' }}
                      data-testid="btn-hub-ai-chat-send"
                      disabled={!chatInput.trim() || isRunningStartupChat}
                      onClick={() => void handleSendChat()}
                    >
                      {isRunningStartupChat ? <Loader2 size={12} className="spin-icon" /> : <Send size={12} />}
                      <span>Invia</span>
                    </button>
                  </div>
                </>
              )}
            </section>

            {/* COLUMN B: 🗂️ Progetti Recenti & Avvio Rapido */}
            <section className="ide-hub-panel" data-testid="recent-projects-section">
              <div className="ide-hub-panel-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <HardDrive size={14} color="var(--accent-emerald)" />
                  <strong style={{ fontSize: 13 }}>Avvio Rapido &amp; Progetti Recenti</strong>
                </div>
                <span className="badge">
                  {visibleBaseRecents.length === 1 ? '1 progetto' : `${visibleBaseRecents.length} progetti`}
                </span>
              </div>

              {/* Compact 4-Button New Project Strip (keeps exact E2E data-testids) */}
              <div className="ide-quick-strip">
                <button
                  type="button"
                  className="ide-quick-tile"
                  data-testid="btn-quick-freeform"
                  disabled={busyAction !== null}
                  onClick={() => void handleQuickFreeform()}
                >
                  <span
                    className="ide-quick-tile-icon"
                    style={{ background: 'var(--accent-soft)', color: 'var(--accent-primary)' }}
                  >
                    <Move size={14} />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      Tela Bianca Libera (X,Y)
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                      Coordinate assolute + CSS
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  className="ide-quick-tile"
                  data-testid="btn-quick-autolayout"
                  disabled={busyAction !== null}
                  onClick={() => void handleQuickAutoLayout()}
                >
                  <span
                    className="ide-quick-tile-icon"
                    style={{ background: 'var(--accent-violet-soft)', color: 'var(--accent-violet)' }}
                  >
                    <LayoutGrid size={14} />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      Nuovo Auto-Layout
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                      Flex / Grid + Tokens
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  className="ide-quick-tile"
                  data-testid="btn-quick-three-blueprint"
                  disabled={busyAction !== null}
                  onClick={() => void handleQuickThreeBlueprint()}
                >
                  <span
                    className="ide-quick-tile-icon"
                    style={{ background: 'var(--accent-emerald-soft)', color: 'var(--accent-emerald)' }}
                  >
                    <Box size={14} />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      Studio 3D + Blueprint
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                      Three.js PBR + Nodi Unreal
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  className="ide-quick-tile"
                  data-testid="btn-open-demo-project"
                  disabled={busyAction !== null}
                  onClick={() => void handleOpenDemo()}
                >
                  <span
                    className="ide-quick-tile-icon"
                    style={{ background: 'var(--accent-amber-soft)', color: 'var(--accent-amber)' }}
                  >
                    <Sparkles size={14} />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      Demo NovaCommerce
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                      Progetto completo 26 target
                    </div>
                  </div>
                </button>
              </div>

              {/* v3.0 Toolchain Doctor + 11-Stack Real Disk Project Quick Initializer */}
              <div
                data-testid="hub-11-stacks-strip"
                style={{
                  padding: '9px 14px',
                  borderBottom: '1px solid var(--border-subtle)',
                  background: 'var(--bg-panel-elevated)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 7,
                  flexShrink: 0,
                }}
              >
                <div
                  data-testid="hub-toolchain-doctor"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6,
                    flexWrap: 'wrap',
                  }}
                >
                  <strong style={{ fontSize: 11.5 }}>
                    🚀 Nuovo Progetto Reale su Disco (11 Stack)
                  </strong>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                    <span
                      className={`badge ${toolchainDoctor?.node.available ? 'green' : 'amber'}`}
                      title={toolchainDoctor?.node.version ?? 'Node.js'}
                    >
                      Node {toolchainDoctor?.node.available ? '✓' : '—'}
                    </span>
                    <span
                      className={`badge ${toolchainDoctor?.python.available ? 'green' : 'amber'}`}
                      title={toolchainDoctor?.python.version ?? 'Python'}
                    >
                      Python {toolchainDoctor?.python.available ? '✓' : '—'}
                    </span>
                    <span
                      className={`badge ${toolchainDoctor?.rustc.available ? 'green' : 'amber'}`}
                      title={toolchainDoctor?.rustc.version ?? 'Rust / Cargo'}
                    >
                      Rust {toolchainDoctor?.rustc.available ? '✓' : '—'}
                    </span>
                    <button
                      type="button"
                      className="studio-btn sm ghost"
                      style={{ height: 19, padding: '0 4px' }}
                      onClick={() => void refreshToolchainDoctor()}
                      title="Aggiorna verifica Toolchain Doctor"
                    >
                      <RefreshCw size={10} />
                    </button>
                  </div>
                </div>

                {/* 11 Stack Pills */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {PROJECT_STACK_CATALOG.map((st) => {
                    const active = quickStackId === st.id;
                    return (
                      <button
                        key={st.id}
                        type="button"
                        data-testid={`hub-stack-${st.id}`}
                        className={`studio-btn sm ${active ? 'primary' : ''}`}
                        style={{ height: 22, padding: '0 7px', fontSize: 10.5 }}
                        onClick={() => handleSelectQuickStack(st.id)}
                        title={st.description}
                      >
                        <span>{st.shortLabel}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Language + Python Companion + Folder + Create */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <input
                    className="studio-input"
                    data-testid="hub-disk-project-name"
                    style={{ height: 25, fontSize: 11, width: 132 }}
                    value={quickProjectName}
                    onChange={(e) => setQuickProjectName(e.target.value)}
                    placeholder="Nome progetto..."
                  />

                  <div className="segmented-group">
                    {(['javascript', 'typescript', 'python'] as PrimaryCodeLanguage[]).map((lang) => {
                      const stackDesc = getProjectStackDescriptor(quickStackId);
                      const supported = stackDesc.supportedLanguages.includes(lang);
                      if (!supported) return null;
                      return (
                        <button
                          key={lang}
                          type="button"
                          data-testid={`hub-lang-${lang}`}
                          className={`segmented-item ${quickLanguage === lang ? 'active' : ''}`}
                          style={{ height: 20, fontSize: 10, padding: '0 6px' }}
                          onClick={() => setQuickLanguage(lang)}
                        >
                          {lang === 'javascript' ? 'JS' : lang === 'typescript' ? 'TS' : 'Python'}
                        </button>
                      );
                    })}
                    {getProjectStackDescriptor(quickStackId).requiresRustToolchain && (
                      <span className="badge amber" style={{ margin: '0 4px' }}>
                        + Rust
                      </span>
                    )}
                  </div>

                  {getProjectStackDescriptor(quickStackId).supportsPythonCompanion && (
                      <select
                        className="studio-select"
                        data-testid="hub-python-companion-select"
                        style={{ height: 25, fontSize: 10.5, width: 116 }}
                        value={quickLanguage === 'python' && quickPythonCompanion !== 'flask' ? 'fastapi' : quickPythonCompanion}
                        onChange={(e) => setQuickPythonCompanion(e.target.value as PythonCompanionKind)}
                        title="Backend o script Python"
                      >
                        {quickLanguage !== 'python' && <option value="none">Senza Python</option>}
                        <option value="fastapi">FastAPI</option>
                        <option value="flask">Flask</option>
                        {quickLanguage !== 'python' && <option value="scripts">Script .py</option>}
                      </select>
                    )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 130 }}>
                    <input
                      className="studio-input"
                      data-testid="hub-disk-parent-input"
                      style={{ height: 25, fontSize: 10.5, flex: 1, minWidth: 0 }}
                      value={quickParentDir}
                      onChange={(e) => setQuickParentDir(e.target.value)}
                      placeholder="Cartella disco (opzionale)..."
                    />
                    <button
                      type="button"
                      className="studio-btn sm"
                      data-testid="btn-hub-pick-disk-dir"
                      style={{ height: 25, padding: '0 6px' }}
                      onClick={() => void handlePickQuickFolder()}
                      title="Sfoglia cartella su disco"
                    >
                      <FolderOpen size={11} />
                    </button>
                  </div>

                  <button
                    type="button"
                    className="studio-btn sm primary"
                    data-testid="btn-hub-create-disk-project"
                    style={{ height: 25, padding: '0 10px' }}
                    disabled={busyAction !== null}
                    onClick={() => void handleCreateRealDiskProject()}
                  >
                    <Plus size={11} />
                    <span>Crea su Disco</span>
                  </button>
                </div>

                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 10.5,
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    data-testid="hub-checkbox-run-init"
                    checked={quickRunInit}
                    onChange={(e) => setQuickRunInit(e.target.checked)}
                  />
                  <span>Inizializza subito dipendenze e ambiente su disco (npm install / .venv / cargo check)</span>
                </label>
              </div>

              {/* Recent Projects Filter Toolbar */}
              <div className="ide-recents-toolbar">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                  <Search size={12} color="var(--text-muted)" />
                  <input
                    className="studio-input"
                    style={{ width: '100%', height: 26, fontSize: 11.5 }}
                    data-testid="hub-recent-filter-input"
                    placeholder="Filtra progetti recenti per nome o framework..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              {/* Dense IDE Recent Projects List */}
              <div className="ide-recents-list" data-testid="recent-projects-list">
                {filteredRecents.length === 0 ? (
                  <div
                    style={{
                      padding: '22px 16px',
                      borderRadius: 8,
                      border: '1px dashed var(--border-strong)',
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                      fontSize: 12,
                    }}
                  >
                    Nessun progetto corrispondente al filtro. Crea un progetto con <strong>Ollama AI</strong> a sinistra o scegli una tela rapida qui sopra.
                  </div>
                ) : (
                  filteredRecents.map((rp) => renderRecentRow(rp))
                )}
              </div>
            </section>
          </div>
        )}

        {/* -------------------------------------------------------------------
            VIEW 2: 🗂️ PROGETTI RECENTI & DISCO (FULL-WIDTH PROJECT MANAGER)
           ------------------------------------------------------------------- */}
        {hubActiveSection === 'recents' && (
          <section className="ide-hub-panel" data-testid="hub-view-recents">
            <div className="ide-hub-panel-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FolderOpen size={15} color="var(--accent-amber)" />
                <strong style={{ fontSize: 13.5 }}>Gestione Progetti Recenti &amp; Cartelle su Disco</strong>
                <span className="badge">
                  {filteredRecents.length === 1 ? '1 voce' : `${filteredRecents.length} voci`}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  className="studio-btn sm"
                  onClick={() => void handleOpenDiskDirectory()}
                >
                  <FolderOpen size={12} />
                  <span>Apri Cartella da Disco...</span>
                </button>
                <button
                  type="button"
                  className="studio-btn sm primary"
                  onClick={() => setWizardOpen(true)}
                >
                  <Plus size={12} />
                  <span>Nuovo Progetto Guidato</span>
                </button>
              </div>
            </div>

            <div className="ide-recents-toolbar">
              <div className="segmented-group">
                {(['all', 'freeform', 'auto', 'disk'] as const).map((flt) => (
                  <button
                    key={flt}
                    type="button"
                    className={`segmented-item ${recentLayoutFilter === flt ? 'active' : ''}`}
                    onClick={() => setRecentLayoutFilter(flt)}
                  >
                    <span>
                      {flt === 'all'
                        ? 'Tutti'
                        : flt === 'freeform'
                          ? 'Libero (X,Y)'
                          : flt === 'auto'
                            ? 'Auto-Layout'
                            : 'Collegati a Disco'}
                    </span>
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: 320 }}>
                <Search size={12} color="var(--text-muted)" />
                <input
                  className="studio-input"
                  style={{ width: '100%', height: 26 }}
                  placeholder="Cerca per nome, framework o percorso..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="ide-recents-list" data-testid="recent-projects-list">
              {filteredRecents.length === 0 ? (
                <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)' }}>
                  Nessun progetto trovato con i filtri selezionati.
                </div>
              ) : (
                filteredRecents.map((rp) => renderRecentRow(rp))
              )}
            </div>
          </section>
        )}

        {/* -------------------------------------------------------------------
            VIEW 3: 🧩 TEMPLATE (26 FRAMEWORK TARGETS + 3D & BLUEPRINT)
           ------------------------------------------------------------------- */}
        {hubActiveSection === 'templates' && (
          <section className="ide-hub-panel" data-testid="hub-view-templates">
            <div className="ide-hub-panel-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <LayoutGrid size={15} color="var(--accent-violet)" />
                <strong style={{ fontSize: 13.5 }}>Matrice Template &amp; 26 Compilatori Framework</strong>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Modalità iniziale:</span>
                <div className="segmented-group">
                  <button
                    type="button"
                    className={`segmented-item ${templateLayoutMode === 'freeform' ? 'active' : ''}`}
                    onClick={() => setTemplateLayoutMode('freeform')}
                  >
                    <span>Libero (X, Y)</span>
                  </button>
                  <button
                    type="button"
                    className={`segmented-item ${templateLayoutMode === 'auto' ? 'active' : ''}`}
                    onClick={() => setTemplateLayoutMode('auto')}
                  >
                    <span>Auto-Layout</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="ide-recents-toolbar" style={{ flexWrap: 'wrap' }}>
              <div className="segmented-group" style={{ flexWrap: 'wrap' }}>
                {(
                  [
                    { id: 'all', label: `Tutti (${targets.length})` },
                    { id: 'web_htmx', label: 'Web / HTMX' },
                    { id: 'spa_fullstack', label: 'React / Next / Vue / Svelte' },
                    { id: 'desktop', label: 'Desktop (Electron / Tauri / MAUI / Qt)' },
                    { id: 'mobile', label: 'Mobile (RN / Flutter / SwiftUI)' },
                    { id: 'python_embedded', label: 'Python AI & Embedded' },
                    { id: 'three_blueprint', label: '3D Three.js & Blueprint' },
                  ] as Array<{ id: TemplateFilterCategory; label: string }>
                ).map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    className={`segmented-item ${templateCat === cat.id ? 'active' : ''}`}
                    data-testid={`hub-tpl-cat-${cat.id}`}
                    onClick={() => setTemplateCat(cat.id)}
                  >
                    <span>{cat.label}</span>
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: 240 }}>
                <Search size={12} color="var(--text-muted)" />
                <input
                  className="studio-input"
                  style={{ width: '100%', height: 26 }}
                  placeholder="Filtra framework..."
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="ide-hub-scroll-body">
              {templateCat === 'three_blueprint' ? (
                <div className="ide-template-matrix">
                  <div className="ide-template-card">
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <strong>Three.js PBR + Blueprint Unreal</strong>
                        <span className="badge green">.scene3d + .blueprint</span>
                      </div>
                      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                        Workspace completo con scena 3D WebGL PBR, viewport integrato nel Canvas 2D e grafo logico a nodi.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="studio-btn primary"
                      onClick={() => void handleQuickThreeBlueprint()}
                    >
                      <Box size={12} />
                      <span>Crea Studio 3D + Blueprint</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="ide-template-matrix">
                  {filteredTemplates.map((t) => (
                    <div
                      key={t.id}
                      className="ide-template-card"
                      data-testid={`hub-template-card-${t.id}`}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                          <strong style={{ fontSize: 12.5 }}>{t.displayName}</strong>
                          <span className="badge blue">{t.fileExtension}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                          {t.description}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                          {t.languages.map((lang) => (
                            <span key={lang} className="badge">
                              {lang}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                          type="button"
                          className="studio-btn sm primary"
                          style={{ flex: 1 }}
                          data-testid={`btn-create-tpl-${t.id}`}
                          disabled={busyAction !== null}
                          onClick={() => void handleCreateFromTemplateTarget(t)}
                        >
                          <Plus size={11} />
                          <span>Crea Vuoto</span>
                        </button>
                        <button
                          type="button"
                          className="studio-btn sm violet"
                          style={{ flex: 1 }}
                          onClick={() => {
                            setAiTarget(t.id);
                            setAiLayoutMode(templateLayoutMode);
                            setAiTab('create');
                            setHubActiveSection('architect');
                          }}
                        >
                          <Sparkles size={11} />
                          <span>Progetta con AI</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* -------------------------------------------------------------------
            VIEW 4: ⚙️ MOTORE OLLAMA LOCALE (DAEMON, MODELS & GGUF PULL)
           ------------------------------------------------------------------- */}
        {hubActiveSection === 'ollama' && (
          <section className="ide-hub-panel" data-testid="hub-view-ollama">
            <div className="ide-hub-panel-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Cpu size={15} color="var(--accent-emerald)" />
                <strong style={{ fontSize: 13.5 }}>Motore Ollama Locale &amp; Gestione Modelli</strong>
                <span className={`badge ${isOllamaOnline ? 'green' : 'amber'}`}>
                  {isOllamaOnline ? 'Attivo su 127.0.0.1:11434' : 'Non Connesso'}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  className="studio-btn sm primary"
                  onClick={() => void ensureOllamaRunningAction(false)}
                >
                  <Zap size={11} />
                  <span>{isOllamaOnline ? 'Verifica / Riallinea Ollama' : 'Avvia Demone Ollama'}</span>
                </button>
                <button
                  type="button"
                  className="studio-btn sm"
                  onClick={() => void refreshAiProviders()}
                >
                  <RefreshCw size={11} />
                  <span>Aggiorna Telemetria</span>
                </button>
              </div>
            </div>

            <div className="ide-hub-scroll-body" style={{ gap: 14 }}>
              {/* Daemon & Hardware Telemetry Summary */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: 10,
                }}
              >
                <div className="ide-spec-summary-box">
                  <span className="ide-field-label">Stato Demone Locale</span>
                  <strong style={{ fontSize: 13, color: isOllamaOnline ? 'var(--accent-emerald)' : 'var(--accent-amber)' }}>
                    {isOllamaOnline ? '🟢 Online (http://127.0.0.1:11434)' : '🟡 Offline'}
                  </strong>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {ollamaStatusMessage || 'Avvio automatico attivo all\'apertura del programma'}
                  </span>
                </div>

                <div className="ide-spec-summary-box">
                  <span className="ide-field-label">Modello Predefinito Selezionato</span>
                  <strong style={{ fontSize: 13, fontFamily: "'JetBrains Mono', Consolas, monospace" }}>
                    {selectedOllamaModelValue}
                  </strong>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Modelli embedding (*embed*) esclusi automaticamente
                  </span>
                </div>

                {hardwareReport && (
                  <div className="ide-spec-summary-box">
                    <span className="ide-field-label">Risorse Sistema Rilevate</span>
                    <strong style={{ fontSize: 13 }}>
                      {Math.round(hardwareReport.totalSystemRamMb / 1024)} GB RAM ({hardwareReport.cpuCores} Core CPU)
                    </strong>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Libera: {(hardwareReport.freeSystemRamMb / 1024).toFixed(1)} GB • Tier {hardwareReport.recommendedTier.toUpperCase()}
                    </span>
                  </div>
                )}
              </div>

              {/* Installed Ollama Chat/Coding Models Table */}
              <div
                style={{
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                  overflow: 'hidden',
                  background: 'var(--bg-panel-elevated)',
                }}
              >
                <div
                  style={{
                    padding: '8px 12px',
                    background: 'var(--bg-header)',
                    borderBottom: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <strong style={{ fontSize: 12 }}>
                    Modelli Chat &amp; Coding Installati ({rankedOllamaModels.length})
                  </strong>
                  {typeof ollamaProv?.latencyMs === 'number' && (
                    <span className="badge green">Ping {ollamaProv.latencyMs} ms</span>
                  )}
                </div>

                {rankedOllamaModels.length === 0 ? (
                  <div style={{ padding: 18, fontSize: 12, color: 'var(--text-muted)' }}>
                    Nessun modello chat/coding rilevato su Ollama. Clicca <strong>Avvia Demone Ollama</strong> o scarica un modello qui sotto.
                  </div>
                ) : (
                  <table className="ide-models-table" data-testid="hub-ollama-models-table">
                    <thead>
                      <tr>
                        <th>Modello</th>
                        <th>Quantizzazione</th>
                        <th>Dimensione</th>
                        <th>Stato / Capacità</th>
                        <th style={{ textAlign: 'right' }}>Azione</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankedOllamaModels.map((m) => {
                        const isSelected = m.id === selectedOllamaModelValue && activeProvider === 'ollama';
                        return (
                          <tr key={m.id}>
                            <td style={{ fontFamily: "'JetBrains Mono', Consolas, monospace", fontWeight: 600 }}>
                              {m.name}
                            </td>
                            <td>
                              <span className="badge">{m.quantization || 'GGUF'}</span>
                            </td>
                            <td style={{ color: 'var(--text-secondary)' }}>
                              {formatModelSizeGb(m.sizeBytes) ?? '—'}
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {m.loadedInVram && <span className="badge green">⚡ In VRAM</span>}
                                {m.supportsTools && <span className="badge blue">Tools</span>}
                                {m.supportsVision && <span className="badge violet">Vision</span>}
                              </div>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              {isSelected ? (
                                <span className="badge green">
                                  <Check size={10} /> Attivo
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className="studio-btn sm"
                                  onClick={() => handleSelectOllamaModel(m.id)}
                                >
                                  <span>Usa Modello</span>
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Pull New Model / Unsloth GGUF */}
              <div className="ide-spec-summary-box" style={{ gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <strong style={{ fontSize: 12 }}>Scarica Nuovo Modello Ollama / Unsloth GGUF</strong>
                  {pullProgress && (
                    <span className="badge blue">
                      {pullProgress.modelRef}: {pullProgress.status}{' '}
                      {typeof pullProgress.percent === 'number' ? `(${pullProgress.percent}%)` : ''}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="studio-input"
                    style={{ flex: 1, height: 28, fontFamily: "'JetBrains Mono', Consolas, monospace" }}
                    placeholder="Es. qwen2.5-coder:14b oppure hf.co/unsloth/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M"
                    value={customPullModelInput}
                    onChange={(e) => setCustomPullModelInput(e.target.value)}
                  />
                  <button
                    type="button"
                    className="studio-btn primary"
                    disabled={!customPullModelInput.trim() || Boolean(pullProgress)}
                    onClick={() => {
                      const uri = customPullModelInput.trim();
                      if (uri) void pullUnslothModel(uri);
                    }}
                  >
                    <Download size={12} />
                    <span>Scarica (ollama pull)</span>
                  </button>
                </div>

                {unslothCatalog.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
                    {unslothCatalog.slice(0, 3).map((rec) => (
                      <div
                        key={rec.id}
                        style={{
                          padding: '9px 11px',
                          borderRadius: 7,
                          border: '1px solid var(--border-subtle)',
                          background: 'var(--bg-panel-elevated)',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: 6,
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                            <strong style={{ fontSize: 11.5 }}>{rec.displayName}</strong>
                            <span className="badge violet">{rec.quantization}</span>
                          </div>
                          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>
                            ~{rec.estimatedVramGb} GB VRAM • {rec.role}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="studio-btn sm"
                          disabled={Boolean(pullProgress)}
                          onClick={() => void pullUnslothModel(rec.ollamaPullUri)}
                        >
                          <Download size={11} />
                          <span>Installa in Ollama</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
};
