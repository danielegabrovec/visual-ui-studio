import { createStarterBlueprintGraph, type BlueprintGraphDocument } from './blueprint-ir';
import { compileSheetToCss } from './css-sync-engine';
import { createDefaultThemes, createDefaultTokens, createStarterDemoSheet } from './default-tokens';
import { createStarterScriptModuleTs } from './script-ir';
import { createThreeSceneFromPreset, type ThreePresetId, type ThreeSceneDocument } from './three-ir';
import type {
  CodegenTargetId,
  DesignTheme,
  DesignTokenEntry,
  StylingDialect,
  UINode,
  UISheetDocument,
} from './ui-ir';
import { createDefaultUINode } from './ui-patch';

/**
 * 5-Step Guided Project Wizard Contracts, 6 Curated Color Palettes,
 * and Deterministic Multi-File Project Seed Builder (shared by SQLite `db-worker` and Browser `studio-client`).
 */

export type WizardAppCategory = 'web' | 'desktop' | 'mobile' | 'python_ai' | 'three_game';

export type WizardPaletteId =
  | 'dark-pro'
  | 'clean-light'
  | 'ocean-blue'
  | 'emerald-studio'
  | 'cyberpunk-neon'
  | 'warm-corporate';

export type WizardStarterPageId = 'home' | 'login' | 'dashboard' | 'form_table';

export interface ProjectWizardSpec {
  name: string;
  category: WizardAppCategory;
  primaryTarget: CodegenTargetId;
  stylingPreset: StylingDialect;
  layoutMode: 'freeform' | 'auto';
  starterPages: WizardStarterPageId[];
  includeTsScript: boolean;
  includeBlueprint: boolean;
  includeThreeScene: boolean;
  threePresetId?: ThreePresetId;
  paletteId: WizardPaletteId;
  defaultThemeMode: 'dark' | 'light';
  rootDiskPath?: string | null;
  seedDemoContent?: boolean;
}

export interface WizardPalettePreset {
  id: WizardPaletteId;
  label: string;
  description: string;
  defaultMode: 'dark' | 'light';
  colors: {
    canvasDark: string;
    surfaceDark: string;
    canvasLight: string;
    surfaceLight: string;
    primary500: string;
    primary600: string;
    accent500: string;
  };
}

export const WIZARD_PALETTE_PRESETS: WizardPalettePreset[] = [
  {
    id: 'dark-pro',
    label: 'Dark Pro IDE',
    description: 'Contrasto profondo blu ardesia e indaco per applicazioni moderne',
    defaultMode: 'dark',
    colors: {
      canvasDark: '#0b1120',
      surfaceDark: '#111827',
      canvasLight: '#f8fafc',
      surfaceLight: '#ffffff',
      primary500: '#3b82f6',
      primary600: '#2563eb',
      accent500: '#8b5cf6',
    },
  },
  {
    id: 'clean-light',
    label: 'Clean Light SaaS',
    description: 'Superfici chiare ariose con accenti blu enterprise',
    defaultMode: 'light',
    colors: {
      canvasDark: '#0f172a',
      surfaceDark: '#1e293b',
      canvasLight: '#f8fafc',
      surfaceLight: '#ffffff',
      primary500: '#2563eb',
      primary600: '#1d4ed8',
      accent500: '#6366f1',
    },
  },
  {
    id: 'ocean-blue',
    label: 'Ocean Cyan',
    description: 'Palette marina ciano e blu profondo per analytics & cloud',
    defaultMode: 'dark',
    colors: {
      canvasDark: '#061321',
      surfaceDark: '#0c2138',
      canvasLight: '#f0f9ff',
      surfaceLight: '#ffffff',
      primary500: '#06b6d4',
      primary600: '#0891b2',
      accent500: '#3b82f6',
    },
  },
  {
    id: 'emerald-studio',
    label: 'Emerald FinTech',
    description: 'Verde smeraldo ad alta leggibilità su grafite scura',
    defaultMode: 'dark',
    colors: {
      canvasDark: '#071510',
      surfaceDark: '#0f241d',
      canvasLight: '#ecfdf5',
      surfaceLight: '#ffffff',
      primary500: '#10b981',
      primary600: '#059669',
      accent500: '#14b8a6',
    },
  },
  {
    id: 'cyberpunk-neon',
    label: 'Cyberpunk Neon',
    description: 'Magenta elettrico e ciano olografico per UI 3D e gaming',
    defaultMode: 'dark',
    colors: {
      canvasDark: '#090418',
      surfaceDark: '#140b2e',
      canvasLight: '#faf5ff',
      surfaceLight: '#ffffff',
      primary500: '#ec4899',
      primary600: '#db2777',
      accent500: '#22d3ee',
    },
  },
  {
    id: 'warm-corporate',
    label: 'Warm Amber',
    description: 'Toni caldi ambra e antracite per portali editoriali e B2B',
    defaultMode: 'light',
    colors: {
      canvasDark: '#18130f',
      surfaceDark: '#261e18',
      canvasLight: '#fffbeb',
      surfaceLight: '#ffffff',
      primary500: '#f59e0b',
      primary600: '#d97706',
      accent500: '#ea580c',
    },
  },
];

export interface GeneratedWizardVfsSeedItem {
  key: string;
  parentKey: string | null;
  name: string;
  virtualPath: string;
  entryKind:
    | 'folder'
    | 'canvas_sheet'
    | 'style_file'
    | 'script_file'
    | 'blueprint_graph'
    | 'three_scene'
    | 'source_file';
  sheetId?: string;
  contentText?: string;
}

export interface WizardProjectSeedBundle {
  projectId: string;
  projectName: string;
  primaryTarget: CodegenTargetId;
  stylingPreset: StylingDialect;
  activeThemeId: string;
  themes: DesignTheme[];
  tokens: DesignTokenEntry[];
  sheets: UISheetDocument[];
  blueprintDoc?: BlueprintGraphDocument;
  threeSceneDoc?: ThreeSceneDocument;
  vfsItems: GeneratedWizardVfsSeedItem[];
}

function createFreeformStarterSheet(
  projectId: string,
  sheetId: string,
  sheetName: string,
  pageKind: WizardStarterPageId,
  threeSceneId?: string,
  blueprintId?: string,
): UISheetDocument {
  const artId = `art_${sheetId}`;
  const titleId = `nd_title_${sheetId}`;
  const subtitleId = `nd_sub_${sheetId}`;
  const cardId = `nd_card_${sheetId}`;
  const ctaBtnId = `nd_cta_${sheetId}`;
  const inputId = `nd_inp_${sheetId}`;
  const threeNodeId = `nd_three_${sheetId}`;

  const childIds: string[] = [titleId, subtitleId, cardId, inputId, ctaBtnId];
  if (threeSceneId && pageKind === 'home') {
    childIds.push(threeNodeId);
  }

  const pageTitles: Record<WizardStarterPageId, { title: string; sub: string; btn: string }> = {
    home: {
      title: 'Benvenuto nel Canvas Posizionamento Libero',
      sub: 'Trascina qualsiasi elemento in coordinate (X, Y) esatte o disegna direttamente sulla tela.',
      btn: 'Esegui Azione Principale',
    },
    login: {
      title: 'Accesso Utente Sicuro',
      sub: 'Inserisci le tue credenziali aziendali per accedere allo spazio di lavoro.',
      btn: 'Accedi Ora',
    },
    dashboard: {
      title: 'Pannello Telemetria & KPI',
      sub: 'Monitoraggio in tempo reale con componenti posizionabili liberamente.',
      btn: 'Aggiorna Dati',
    },
    form_table: {
      title: 'Gestione Record & Moduli',
      sub: 'Compila i campi e invia per validare tramite Script TypeScript o Blueprint.',
      btn: 'Salva Record',
    },
  };

  const copy = pageTitles[pageKind];

  const nodes: Record<string, UINode> = {
    [artId]: createDefaultUINode(
      {
        id: artId,
        kind: 'artboard',
        name: `${sheetName}Artboard`,
        childIds,
        layout: {
          mode: 'freeform',
          positioning: 'flow',
          frame: { x: 40, y: 40, width: 1120, height: 780 },
          width: { mode: 'fixed', value: 1120 },
          height: { mode: 'fixed', value: 780 },
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        style: {
          fills: [{ type: 'solid', color: { $token: 'color.bg.canvas' } }],
          radius: 12,
        },
      },
      sheetId,
    ),
    [titleId]: createDefaultUINode(
      {
        id: titleId,
        parentId: artId,
        kind: 'text',
        name: 'HeroHeading',
        semanticTag: 'h1',
        layout: {
          mode: 'freeform',
          positioning: 'absolute',
          frame: { x: 48, y: 44, width: 640, height: 42 },
          width: { mode: 'fixed', value: 640 },
          height: { mode: 'hug', value: 42 },
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        typography: {
          fontFamily: { $token: 'font.sans' },
          fontSize: 28,
          fontWeight: 700,
          color: { $token: 'color.text.primary' },
        },
        content: { text: copy.title },
      },
      sheetId,
    ),
    [subtitleId]: createDefaultUINode(
      {
        id: subtitleId,
        parentId: artId,
        kind: 'text',
        name: 'HeroSubtitle',
        semanticTag: 'p',
        layout: {
          mode: 'freeform',
          positioning: 'absolute',
          frame: { x: 48, y: 96, width: 620, height: 28 },
          width: { mode: 'fixed', value: 620 },
          height: { mode: 'hug', value: 28 },
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        typography: {
          fontFamily: { $token: 'font.sans' },
          fontSize: 15,
          fontWeight: 400,
          color: { $token: 'color.text.secondary' },
        },
        content: { text: copy.sub },
      },
      sheetId,
    ),
    [cardId]: createDefaultUINode(
      {
        id: cardId,
        parentId: artId,
        kind: 'container',
        name: 'FeatureSurfaceCard',
        semanticTag: 'section',
        layout: {
          mode: 'freeform',
          positioning: 'absolute',
          frame: { x: 48, y: 156, width: 460, height: 220 },
          width: { mode: 'fixed', value: 460 },
          height: { mode: 'fixed', value: 220 },
          padding: { top: 20, right: 20, bottom: 20, left: 20 },
        },
        style: {
          fills: [{ type: 'solid', color: { $token: 'color.bg.surface' } }],
          border: { width: 1, style: 'solid', color: { $token: 'color.border.subtle' } },
          radius: 14,
          zIndex: 1,
        },
        content: { text: 'Scheda Freeform — spostala o ridimensionala liberamente!' },
      },
      sheetId,
    ),
    [inputId]: createDefaultUINode(
      {
        id: inputId,
        parentId: artId,
        kind: 'control',
        name: 'EmailInput',
        semanticTag: 'input',
        layout: {
          mode: 'freeform',
          positioning: 'absolute',
          frame: { x: 72, y: 224, width: 320, height: 42 },
          width: { mode: 'fixed', value: 320 },
          height: { mode: 'fixed', value: 42 },
          padding: { top: 8, right: 14, bottom: 8, left: 14 },
        },
        style: {
          fills: [{ type: 'solid', color: { $token: 'color.bg.muted' } }],
          border: { width: 1, style: 'solid', color: { $token: 'color.border.subtle' } },
          radius: 8,
          zIndex: 2,
        },
        content: { controlType: 'text-input', placeholder: 'nome@studio.it' },
      },
      sheetId,
    ),
    [ctaBtnId]: createDefaultUINode(
      {
        id: ctaBtnId,
        parentId: artId,
        kind: 'control',
        name: 'CreateOrderButton',
        semanticTag: 'button',
        layout: {
          mode: 'freeform',
          positioning: 'absolute',
          frame: { x: 72, y: 286, width: 220, height: 44 },
          width: { mode: 'fixed', value: 220 },
          height: { mode: 'fixed', value: 44 },
          padding: { top: 10, right: 20, bottom: 10, left: 20 },
        },
        style: {
          fills: [{ type: 'solid', color: { $token: 'color.primary.600' } }],
          radius: 10,
          zIndex: 3,
        },
        typography: {
          fontFamily: { $token: 'font.sans' },
          fontSize: 14,
          fontWeight: 600,
          color: '#ffffff',
          textAlign: 'center',
        },
        content: {
          controlType: 'button',
          text: copy.btn,
          iconName: 'sparkles',
          blueprintId,
        },
        interactions: [
          {
            trigger: 'onClick',
            action: { kind: 'call_script_fn', fnName: 'onPrimaryActionClick' },
          },
          ...(blueprintId
            ? [
                {
                  trigger: 'onClick' as const,
                  action: { kind: 'trigger_blueprint' as const, blueprintId, eventName: 'event_ui_click' },
                },
              ]
            : []),
        ],
      },
      sheetId,
    ),
  };

  if (threeSceneId && pageKind === 'home') {
    nodes[threeNodeId] = createDefaultUINode(
      {
        id: threeNodeId,
        parentId: artId,
        kind: 'control',
        name: 'InteractiveThreeViewport',
        semanticTag: 'div',
        layout: {
          mode: 'freeform',
          positioning: 'absolute',
          frame: { x: 540, y: 156, width: 520, height: 340 },
          width: { mode: 'fixed', value: 520 },
          height: { mode: 'fixed', value: 340 },
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        style: {
          fills: [{ type: 'solid', color: '#0b1120' }],
          border: { width: 1, style: 'solid', color: { $token: 'color.primary.500' } },
          radius: 14,
          zIndex: 2,
        },
        content: {
          controlType: 'three-viewport',
          text: 'Three.js 3D Viewport',
          threeSceneId,
        },
      },
      sheetId,
    );
  }

  return {
    sheetId,
    projectId,
    name: sheetName,
    rootIds: [artId],
    nodes,
    defaultLayoutMode: 'freeform',
    stateSchema: [{ name: 'clicks', type: 'number', initialValue: 0 }],
    propsSchema: [],
    ipcSchema: [],
  };
}

export function buildWizardProjectSeed(
  spec: ProjectWizardSpec,
  explicitProjectId?: string,
): WizardProjectSeedBundle {
  const projectId =
    explicitProjectId ?? `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const projectName = spec.name.trim() || 'Nuovo Progetto Studio';
  const palette = WIZARD_PALETTE_PRESETS.find((p) => p.id === spec.paletteId) ?? WIZARD_PALETTE_PRESETS[0];

  const { lightTheme, darkTheme, all: themes } = createDefaultThemes(projectId);
  const activeThemeId = spec.defaultThemeMode === 'light' ? lightTheme.id : darkTheme.id;

  const tokens = createDefaultTokens(projectId, darkTheme.id).map((tok) => {
    const isDark = tok.themeId === darkTheme.id;
    if (tok.tokenPath === 'color.bg.canvas') {
      return { ...tok, rawValue: isDark ? palette.colors.canvasDark : palette.colors.canvasLight };
    }
    if (tok.tokenPath === 'color.bg.surface') {
      return { ...tok, rawValue: isDark ? palette.colors.surfaceDark : palette.colors.surfaceLight };
    }
    if (tok.tokenPath === 'color.primary.500') {
      return { ...tok, rawValue: palette.colors.primary500 };
    }
    if (tok.tokenPath === 'color.primary.600') {
      return { ...tok, rawValue: palette.colors.primary600 };
    }
    if (tok.tokenPath === 'color.accent.500') {
      return { ...tok, rawValue: palette.colors.accent500 };
    }
    return tok;
  });

  const threeSceneDoc = spec.includeThreeScene
    ? createThreeSceneFromPreset(projectId, spec.threePresetId ?? 'pbr-product-showcase')
    : undefined;

  const pages: WizardStarterPageId[] = spec.starterPages.length > 0 ? spec.starterPages : ['home'];
  const pageNameMap: Record<WizardStarterPageId, string> = {
    home: 'HomeScreen',
    login: 'LoginScreen',
    dashboard: 'AnalyticsDashboard',
    form_table: 'DataFormScreen',
  };

  let blueprintDoc: BlueprintGraphDocument | undefined;
  const sheets: UISheetDocument[] = [];

  pages.forEach((pId, idx) => {
    const sheetId = `sheet_${pId}_${projectId.slice(-5)}_${idx}`;
    const sheetName = spec.seedDemoContent && idx === 0 ? 'HomeDashboard' : pageNameMap[pId];

    if (idx === 0 && spec.includeBlueprint) {
      blueprintDoc = createStarterBlueprintGraph(projectId, sheetId, `nd_cta_${sheetId}`, `nd_title_${sheetId}`);
    }

    if (spec.seedDemoContent && idx === 0 && spec.layoutMode === 'auto') {
      sheets.push(createStarterDemoSheet(projectId, sheetId, sheetName));
    } else if (spec.layoutMode === 'freeform') {
      sheets.push(
        createFreeformStarterSheet(projectId, sheetId, sheetName, pId, threeSceneDoc?.id, blueprintDoc?.id),
      );
    } else {
      const autoSheet = createStarterDemoSheet(projectId, sheetId, sheetName);
      autoSheet.defaultLayoutMode = 'flex';
      sheets.push(autoSheet);
    }
  });

  const vfsItems: GeneratedWizardVfsSeedItem[] = [
    { key: 'dir_src', parentKey: null, name: 'src', virtualPath: '/src', entryKind: 'folder' },
    { key: 'dir_screens', parentKey: 'dir_src', name: 'screens', virtualPath: '/src/screens', entryKind: 'folder' },
    { key: 'dir_styles', parentKey: 'dir_src', name: 'styles', virtualPath: '/src/styles', entryKind: 'folder' },
    { key: 'dir_scripts', parentKey: 'dir_src', name: 'scripts', virtualPath: '/src/scripts', entryKind: 'folder' },
    {
      key: 'dir_blueprints',
      parentKey: 'dir_src',
      name: 'blueprints',
      virtualPath: '/src/blueprints',
      entryKind: 'folder',
    },
    { key: 'dir_scenes3d', parentKey: 'dir_src', name: 'scenes3d', virtualPath: '/src/scenes3d', entryKind: 'folder' },
  ];

  for (const sh of sheets) {
    vfsItems.push({
      key: `sheet_${sh.sheetId}`,
      parentKey: 'dir_screens',
      name: `${sh.name}.canvas`,
      virtualPath: `/src/screens/${sh.name}.canvas`,
      entryKind: 'canvas_sheet',
      sheetId: sh.sheetId,
    });
  }

  // Always seed bidirectional CSS stylesheet for the primary sheet
  const firstCss = compileSheetToCss(sheets[0], tokens, activeThemeId).css;
  vfsItems.push({
    key: 'file_main_css',
    parentKey: 'dir_styles',
    name: 'theme-and-sheet.css',
    virtualPath: '/src/styles/theme-and-sheet.css',
    entryKind: 'style_file',
    contentText: firstCss,
  });

  if (spec.includeTsScript) {
    vfsItems.push({
      key: 'file_handlers_ts',
      parentKey: 'dir_scripts',
      name: 'handlers.ts',
      virtualPath: '/src/scripts/handlers.ts',
      entryKind: 'script_file',
      contentText: createStarterScriptModuleTs(projectName),
    });
  }

  if (blueprintDoc) {
    vfsItems.push({
      key: 'file_main_bp',
      parentKey: 'dir_blueprints',
      name: `${blueprintDoc.name}.blueprint.json`,
      virtualPath: `/src/blueprints/${blueprintDoc.name}.blueprint.json`,
      entryKind: 'blueprint_graph',
      contentText: JSON.stringify(blueprintDoc, null, 2),
    });
  }

  if (threeSceneDoc) {
    vfsItems.push({
      key: 'file_main_3d',
      parentKey: 'dir_scenes3d',
      name: `${threeSceneDoc.name}.scene3d.json`,
      virtualPath: `/src/scenes3d/${threeSceneDoc.name}.scene3d.json`,
      entryKind: 'three_scene',
      contentText: JSON.stringify(threeSceneDoc, null, 2),
    });
  }

  vfsItems.push({
    key: 'file_readme',
    parentKey: null,
    name: 'README.md',
    virtualPath: '/README.md',
    entryKind: 'source_file',
    contentText: `# ${projectName}\n\nGenerato con **Visual UI Studio v2.0** (${spec.primaryTarget} • ${spec.stylingPreset} • Modalità ${spec.layoutMode === 'freeform' ? 'Posizionamento Libero (X,Y)' : 'Auto-Layout'}).\n`,
  });

  return {
    projectId,
    projectName,
    primaryTarget: spec.primaryTarget,
    stylingPreset: spec.stylingPreset,
    activeThemeId,
    themes,
    tokens,
    sheets,
    blueprintDoc,
    threeSceneDoc,
    vfsItems,
  };
}
