import type {
  BreakpointPreset,
  DesignTheme,
  DesignTokenEntry,
  UINode,
  UISheetDocument,
} from './ui-ir';

// ============================================================================
// DEFAULT BREAKPOINTS & W3C DESIGN TOKENS (LIGHT + DARK THEMES)
// ============================================================================

export const DEFAULT_BREAKPOINTS: BreakpointPreset[] = [
  { id: 'desktop', label: 'Desktop 1440', width: 1280, height: 860, deviceKind: 'desktop' },
  { id: 'tablet', label: 'Tablet 768', width: 768, height: 1024, deviceKind: 'tablet' },
  { id: 'mobile', label: 'Mobile 390', width: 390, height: 844, deviceKind: 'mobile' },
  { id: 'desktop-window', label: 'Desktop App 1080', width: 1080, height: 720, deviceKind: 'desktop-window' },
];

export function createDefaultThemes(projectId: string): {
  lightTheme: DesignTheme;
  darkTheme: DesignTheme;
  all: DesignTheme[];
} {
  const lightTheme: DesignTheme = {
    id: `${projectId}_theme_light`,
    projectId,
    name: 'Light',
    isDefault: true,
  };
  const darkTheme: DesignTheme = {
    id: `${projectId}_theme_dark`,
    projectId,
    name: 'Dark',
    isDefault: false,
  };
  return { lightTheme, darkTheme, all: [lightTheme, darkTheme] };
}

export function createDefaultTokens(projectId: string, darkThemeId?: string): DesignTokenEntry[] {
  const baseSpecs: Array<{ path: string; cat: DesignTokenEntry['category']; val: string; darkVal?: string }> = [
    { path: 'color.bg.canvas', cat: 'color', val: '#f8fafc', darkVal: '#0b1120' },
    { path: 'color.bg.surface', cat: 'color', val: '#ffffff', darkVal: '#111827' },
    { path: 'color.bg.muted', cat: 'color', val: '#f1f5f9', darkVal: '#1e293b' },
    { path: 'color.primary.500', cat: 'color', val: '#3b82f6', darkVal: '#60a5fa' },
    { path: 'color.primary.600', cat: 'color', val: '#2563eb', darkVal: '#3b82f6' },
    { path: 'color.accent.500', cat: 'color', val: '#8b5cf6', darkVal: '#a78bfa' },
    { path: 'color.success.500', cat: 'color', val: '#10b981', darkVal: '#34d399' },
    { path: 'color.warning.500', cat: 'color', val: '#f59e0b', darkVal: '#fbbf24' },
    { path: 'color.danger.500', cat: 'color', val: '#ef4444', darkVal: '#f87171' },
    { path: 'color.text.primary', cat: 'color', val: '#0f172a', darkVal: '#f8fafc' },
    { path: 'color.text.secondary', cat: 'color', val: '#475569', darkVal: '#94a3b8' },
    { path: 'color.border.subtle', cat: 'color', val: '#e2e8f0', darkVal: '#334155' },
    { path: 'space.1', cat: 'spacing', val: '4' },
    { path: 'space.2', cat: 'spacing', val: '8' },
    { path: 'space.3', cat: 'spacing', val: '12' },
    { path: 'space.4', cat: 'spacing', val: '16' },
    { path: 'space.6', cat: 'spacing', val: '24' },
    { path: 'space.8', cat: 'spacing', val: '32' },
    { path: 'radius.sm', cat: 'radius', val: '6' },
    { path: 'radius.md', cat: 'radius', val: '10' },
    { path: 'radius.lg', cat: 'radius', val: '16' },
    { path: 'radius.full', cat: 'radius', val: '9999' },
    { path: 'font.sans', cat: 'typography', val: 'Inter, system-ui, -apple-system, sans-serif' },
    { path: 'font.mono', cat: 'typography', val: 'JetBrains Mono, Consolas, monospace' },
    { path: 'shadow.card', cat: 'shadow', val: '0 4px 16px rgba(15, 23, 42, 0.06)' },
  ];

  const entries: DesignTokenEntry[] = [];
  for (const spec of baseSpecs) {
    entries.push({
      id: `${projectId}_tok_${spec.path.replace(/\./g, '_')}`,
      projectId,
      themeId: null,
      tokenPath: spec.path,
      category: spec.cat,
      rawValue: spec.val,
      aliasOfPath: null,
    });
    if (darkThemeId && spec.darkVal) {
      entries.push({
        id: `${projectId}_tok_dark_${spec.path.replace(/\./g, '_')}`,
        projectId,
        themeId: darkThemeId,
        tokenPath: spec.path,
        category: spec.cat,
        rawValue: spec.darkVal,
        aliasOfPath: null,
      });
    }
  }
  return entries;
}

export function buildTokenLookupMap(
  tokens: DesignTokenEntry[],
  activeThemeId?: string | null,
): Record<string, string | number> {
  const map: Record<string, string | number> = {};
  for (const t of tokens) {
    if (t.themeId === null) {
      const asNum = Number(t.rawValue);
      map[t.tokenPath] =
        (t.category === 'spacing' || t.category === 'radius') && !Number.isNaN(asNum) ? asNum : t.rawValue;
    }
  }
  if (activeThemeId) {
    for (const t of tokens) {
      if (t.themeId === activeThemeId) {
        const asNum = Number(t.rawValue);
        map[t.tokenPath] =
          (t.category === 'spacing' || t.category === 'radius') && !Number.isNaN(asNum) ? asNum : t.rawValue;
      }
    }
  }
  return map;
}

// ============================================================================
// STARTER DEMO PROJECT SHEET (`NovaCommerce Studio`)
// Demonstrates Auto-Layout, Design Tokens, HTMX Hypermedia, MVVM & Native IPC!
// ============================================================================

export function createStarterDemoSheet(projectId: string, sheetId: string, name = 'HomeDashboard'): UISheetDocument {
  const rootArtboardId = 'art_home_root';
  const navbarId = 'nd_top_navbar';
  const brandTitleId = 'nd_brand_title';
  const navActionsId = 'nd_nav_actions';
  const syncIpcBtnId = 'nd_sync_ipc_btn';

  const heroCardId = 'nd_hero_section';
  const heroHeadlineId = 'nd_hero_headline';
  const heroSubtitleId = 'nd_hero_subtitle';
  const heroCtaRowId = 'nd_hero_cta_row';
  const primaryCtaId = 'nd_primary_cta';
  const secondaryCtaId = 'nd_secondary_cta';

  const kpiGridId = 'nd_kpi_grid';
  const kpiCard1Id = 'nd_kpi_revenue';
  const kpiCard1TitleId = 'nd_kpi_rev_label';
  const kpiCard1ValueId = 'nd_kpi_rev_value';
  const kpiCard2Id = 'nd_kpi_orders';
  const kpiCard2TitleId = 'nd_kpi_ord_label';
  const kpiCard2ValueId = 'nd_kpi_ord_value';
  const kpiCard3Id = 'nd_kpi_conversion';
  const kpiCard3TitleId = 'nd_kpi_conv_label';
  const kpiCard3ValueId = 'nd_kpi_conv_value';

  const searchSectionId = 'nd_htmx_search_card';
  const searchHeaderId = 'nd_search_heading';
  const searchBarRowId = 'nd_search_bar_row';
  const searchInputId = 'nd_htmx_search_input';
  const filterBtnId = 'nd_htmx_refresh_btn';
  const resultsRegionId = 'nd_product_results_region';
  const resultRow1Id = 'nd_result_item_1';
  const resultRow2Id = 'nd_result_item_2';

  const nodes: Record<string, UINode> = {
    [rootArtboardId]: {
      id: rootArtboardId,
      sheetId,
      parentId: null,
      childIds: [navbarId, heroCardId, kpiGridId, searchSectionId],
      sortOrder: 'o00010',
      kind: 'artboard',
      name: 'HomeDashboardScreen',
      semanticTag: 'main',
      visible: true,
      locked: false,
      layout: {
        mode: 'flex',
        positioning: 'flow',
        direction: 'column',
        gap: { $token: 'space.6' },
        justify: 'start',
        align: 'stretch',
        frame: { x: 40, y: 40, width: 1120, height: 820 },
        width: { mode: 'fixed', value: 1120 },
        height: { mode: 'fixed', value: 820 },
        padding: {
          top: { $token: 'space.6' },
          right: { $token: 'space.8' },
          bottom: { $token: 'space.8' },
          left: { $token: 'space.8' },
        },
        overflow: 'auto',
      },
      style: {
        fills: [{ type: 'solid', color: { $token: 'color.bg.canvas' } }],
        radius: 12,
      },
      platform: {
        desktopWindow: {
          frameless: false,
          transparent: false,
          backdrop: 'mica',
          resizable: true,
          minWidth: 760,
          minHeight: 540,
          titlebarStyle: 'customControls',
        },
        mvvm: {
          dataType: 'vm:HomeDashboardViewModel',
        },
      },
    },

    [navbarId]: {
      id: navbarId,
      sheetId,
      parentId: rootArtboardId,
      childIds: [brandTitleId, navActionsId],
      sortOrder: 'o00010',
      kind: 'container',
      name: 'TopNavbar',
      semanticTag: 'header',
      visible: true,
      locked: false,
      layout: {
        mode: 'flex',
        positioning: 'flow',
        direction: 'row',
        justify: 'space-between',
        align: 'center',
        gap: 16,
        frame: { x: 0, y: 0, width: 1056, height: 64 },
        width: { mode: 'fill' },
        height: { mode: 'hug', value: 64 },
        padding: { top: 14, right: 20, bottom: 14, left: 20 },
      },
      style: {
        fills: [{ type: 'solid', color: { $token: 'color.bg.surface' } }],
        border: { width: 1, style: 'solid', color: { $token: 'color.border.subtle' } },
        radius: { $token: 'radius.md' },
      },
      platform: {
        desktopWindow: { dragRegion: 'drag' },
        a11y: { role: 'banner', ariaLabel: 'Primary Workspace Navigation' },
      },
    },

    [brandTitleId]: {
      id: brandTitleId,
      sheetId,
      parentId: navbarId,
      childIds: [],
      sortOrder: 'o00010',
      kind: 'text',
      name: 'BrandLogoText',
      semanticTag: 'h2',
      visible: true,
      locked: false,
      layout: {
        mode: 'freeform',
        positioning: 'flow',
        frame: { x: 0, y: 0, width: 220, height: 28 },
        width: { mode: 'hug' },
        height: { mode: 'hug' },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      style: {},
      typography: {
        fontFamily: { $token: 'font.sans' },
        fontSize: 18,
        fontWeight: 700,
        color: { $token: 'color.text.primary' },
      },
      content: { text: 'NovaCommerce Studio' },
    },

    [navActionsId]: {
      id: navActionsId,
      sheetId,
      parentId: navbarId,
      childIds: [syncIpcBtnId],
      sortOrder: 'o00020',
      kind: 'container',
      name: 'NavbarActions',
      semanticTag: 'nav',
      visible: true,
      locked: false,
      layout: {
        mode: 'flex',
        positioning: 'flow',
        direction: 'row',
        gap: 10,
        justify: 'end',
        align: 'center',
        frame: { x: 0, y: 0, width: 200, height: 38 },
        width: { mode: 'hug' },
        height: { mode: 'hug' },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      style: {},
      platform: { desktopWindow: { dragRegion: 'no-drag' } },
    },

    [syncIpcBtnId]: {
      id: syncIpcBtnId,
      sheetId,
      parentId: navActionsId,
      childIds: [],
      sortOrder: 'o00010',
      kind: 'control',
      name: 'ExportReportButton',
      semanticTag: 'button',
      visible: true,
      locked: false,
      layout: {
        mode: 'freeform',
        positioning: 'flow',
        frame: { x: 0, y: 0, width: 152, height: 36 },
        width: { mode: 'hug', value: 152 },
        height: { mode: 'fixed', value: 36 },
        padding: { top: 8, right: 16, bottom: 8, left: 16 },
      },
      style: {
        fills: [{ type: 'solid', color: { $token: 'color.bg.muted' } }],
        border: { width: 1, style: 'solid', color: { $token: 'color.border.subtle' } },
        radius: { $token: 'radius.sm' },
      },
      typography: {
        fontFamily: { $token: 'font.sans' },
        fontSize: 13,
        fontWeight: 600,
        color: { $token: 'color.text.primary' },
        textAlign: 'center',
      },
      content: { controlType: 'button', text: 'Export Local Report', iconName: 'download' },
      interactions: [
        {
          trigger: 'onClick',
          action: {
            kind: 'ipc_invoke',
            channel: 'export_sales_report',
            payloadExpr: '{ format: "pdf" }',
            resultStateKey: 'lastExportStatus',
          },
        },
      ],
      platform: {
        mvvm: { command: { path: 'ExportSalesReportCommand' } },
      },
    },

    [heroCardId]: {
      id: heroCardId,
      sheetId,
      parentId: rootArtboardId,
      childIds: [heroHeadlineId, heroSubtitleId, heroCtaRowId],
      sortOrder: 'o00020',
      kind: 'container',
      name: 'HeroBannerCard',
      semanticTag: 'section',
      visible: true,
      locked: false,
      layout: {
        mode: 'flex',
        positioning: 'flow',
        direction: 'column',
        gap: 12,
        justify: 'start',
        align: 'start',
        frame: { x: 0, y: 88, width: 1056, height: 196 },
        width: { mode: 'fill' },
        height: { mode: 'hug' },
        padding: { top: 28, right: 32, bottom: 28, left: 32 },
      },
      style: {
        fills: [{ type: 'solid', color: { $token: 'color.bg.surface' } }],
        border: { width: 1, style: 'solid', color: { $token: 'color.border.subtle' } },
        radius: { $token: 'radius.lg' },
      },
    },

    [heroHeadlineId]: {
      id: heroHeadlineId,
      sheetId,
      parentId: heroCardId,
      childIds: [],
      sortOrder: 'o00010',
      kind: 'text',
      name: 'HeroHeadline',
      semanticTag: 'h1',
      visible: true,
      locked: false,
      layout: {
        mode: 'freeform',
        positioning: 'flow',
        frame: { x: 0, y: 0, width: 680, height: 38 },
        width: { mode: 'hug' },
        height: { mode: 'hug' },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      style: {},
      typography: {
        fontFamily: { $token: 'font.sans' },
        fontSize: 28,
        fontWeight: 700,
        lineHeight: 1.25,
        color: { $token: 'color.text.primary' },
      },
      content: { text: 'Unified Multi-Platform Storefront & Analytics' },
    },

    [heroSubtitleId]: {
      id: heroSubtitleId,
      sheetId,
      parentId: heroCardId,
      childIds: [],
      sortOrder: 'o00020',
      kind: 'text',
      name: 'HeroSubtitle',
      semanticTag: 'p',
      visible: true,
      locked: false,
      layout: {
        mode: 'freeform',
        positioning: 'flow',
        frame: { x: 0, y: 0, width: 740, height: 24 },
        width: { mode: 'hug' },
        height: { mode: 'hug' },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      style: {},
      typography: {
        fontFamily: { $token: 'font.sans' },
        fontSize: 15,
        fontWeight: 400,
        lineHeight: 1.5,
        color: { $token: 'color.text.secondary' },
      },
      content: {
        text: 'Design visually once — compile idiomatic UI code for React, HTMX, Svelte, .NET MAUI, Tauri, Flutter, and more.',
      },
    },

    [heroCtaRowId]: {
      id: heroCtaRowId,
      sheetId,
      parentId: heroCardId,
      childIds: [primaryCtaId, secondaryCtaId],
      sortOrder: 'o00030',
      kind: 'container',
      name: 'HeroActionsRow',
      semanticTag: 'div',
      visible: true,
      locked: false,
      layout: {
        mode: 'flex',
        positioning: 'flow',
        direction: 'row',
        gap: 12,
        justify: 'start',
        align: 'center',
        frame: { x: 0, y: 0, width: 380, height: 44 },
        width: { mode: 'hug' },
        height: { mode: 'hug' },
        padding: { top: 6, right: 0, bottom: 0, left: 0 },
      },
      style: {},
    },

    [primaryCtaId]: {
      id: primaryCtaId,
      sheetId,
      parentId: heroCtaRowId,
      childIds: [],
      sortOrder: 'o00010',
      kind: 'control',
      name: 'CreateOrderButton',
      semanticTag: 'button',
      visible: true,
      locked: false,
      layout: {
        mode: 'freeform',
        positioning: 'flow',
        frame: { x: 0, y: 0, width: 164, height: 42 },
        width: { mode: 'hug', value: 164 },
        height: { mode: 'fixed', value: 42 },
        padding: { top: 10, right: 20, bottom: 10, left: 20 },
      },
      style: {
        fills: [{ type: 'solid', color: { $token: 'color.primary.600' } }],
        radius: { $token: 'radius.md' },
      },
      typography: {
        fontFamily: { $token: 'font.sans' },
        fontSize: 14,
        fontWeight: 600,
        color: '#ffffff',
        textAlign: 'center',
      },
      content: { controlType: 'button', text: 'Create New Order', iconName: 'plus' },
      interactions: [
        {
          trigger: 'onClick',
          action: { kind: 'set_state', stateKey: 'orderCount', expression: 'orderCount + 1' },
        },
      ],
      platform: {
        mvvm: { command: { path: 'CreateOrderCommand' } },
      },
    },

    [secondaryCtaId]: {
      id: secondaryCtaId,
      sheetId,
      parentId: heroCtaRowId,
      childIds: [],
      sortOrder: 'o00020',
      kind: 'control',
      name: 'ViewAnalyticsButton',
      semanticTag: 'button',
      visible: true,
      locked: false,
      layout: {
        mode: 'freeform',
        positioning: 'flow',
        frame: { x: 0, y: 0, width: 160, height: 42 },
        width: { mode: 'hug', value: 160 },
        height: { mode: 'fixed', value: 42 },
        padding: { top: 10, right: 20, bottom: 10, left: 20 },
      },
      style: {
        fills: [{ type: 'solid', color: { $token: 'color.bg.muted' } }],
        border: { width: 1, style: 'solid', color: { $token: 'color.border.subtle' } },
        radius: { $token: 'radius.md' },
      },
      typography: {
        fontFamily: { $token: 'font.sans' },
        fontSize: 14,
        fontWeight: 600,
        color: { $token: 'color.text.primary' },
        textAlign: 'center',
      },
      content: { controlType: 'button', text: 'Inspect Metrics', iconName: 'bar-chart' },
    },

    [kpiGridId]: {
      id: kpiGridId,
      sheetId,
      parentId: rootArtboardId,
      childIds: [kpiCard1Id, kpiCard2Id, kpiCard3Id],
      sortOrder: 'o00030',
      kind: 'container',
      name: 'MetricsKpiGrid',
      semanticTag: 'section',
      visible: true,
      locked: false,
      layout: {
        mode: 'grid',
        positioning: 'flow',
        gridCols: [
          { track: 'fr', value: 1 },
          { track: 'fr', value: 1 },
          { track: 'fr', value: 1 },
        ],
        gridRows: [{ track: 'auto' }],
        gap: 16,
        frame: { x: 0, y: 310, width: 1056, height: 112 },
        width: { mode: 'fill' },
        height: { mode: 'hug' },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      style: {},
    },

    [kpiCard1Id]: {
      id: kpiCard1Id,
      sheetId,
      parentId: kpiGridId,
      childIds: [kpiCard1TitleId, kpiCard1ValueId],
      sortOrder: 'o00010',
      kind: 'container',
      name: 'RevenueKpiCard',
      semanticTag: 'article',
      visible: true,
      locked: false,
      layout: {
        mode: 'flex',
        positioning: 'flow',
        direction: 'column',
        gap: 6,
        frame: { x: 0, y: 0, width: 340, height: 104 },
        width: { mode: 'fill' },
        height: { mode: 'hug' },
        padding: { top: 20, right: 20, bottom: 20, left: 20 },
      },
      style: {
        fills: [{ type: 'solid', color: { $token: 'color.bg.surface' } }],
        border: { width: 1, style: 'solid', color: { $token: 'color.border.subtle' } },
        radius: { $token: 'radius.md' },
      },
    },
    [kpiCard1TitleId]: {
      id: kpiCard1TitleId,
      sheetId,
      parentId: kpiCard1Id,
      childIds: [],
      sortOrder: 'o00010',
      kind: 'text',
      name: 'RevenueLabel',
      semanticTag: 'span',
      visible: true,
      locked: false,
      layout: {
        mode: 'freeform',
        positioning: 'flow',
        frame: { x: 0, y: 0, width: 140, height: 20 },
        width: { mode: 'hug' },
        height: { mode: 'hug' },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      style: {},
      typography: {
        fontFamily: { $token: 'font.sans' },
        fontSize: 13,
        fontWeight: 500,
        color: { $token: 'color.text.secondary' },
      },
      content: { text: 'Monthly Revenue' },
    },
    [kpiCard1ValueId]: {
      id: kpiCard1ValueId,
      sheetId,
      parentId: kpiCard1Id,
      childIds: [],
      sortOrder: 'o00020',
      kind: 'text',
      name: 'RevenueValue',
      semanticTag: 'h3',
      visible: true,
      locked: false,
      layout: {
        mode: 'freeform',
        positioning: 'flow',
        frame: { x: 0, y: 0, width: 180, height: 32 },
        width: { mode: 'hug' },
        height: { mode: 'hug' },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      style: {},
      typography: {
        fontFamily: { $token: 'font.sans' },
        fontSize: 24,
        fontWeight: 700,
        color: { $token: 'color.text.primary' },
      },
      content: { text: '$128,450' },
      platform: { mvvm: { bindings: { Text: { path: 'MonthlyRevenueFormatted', mode: 'OneWay' } } } },
    },

    [kpiCard2Id]: {
      id: kpiCard2Id,
      sheetId,
      parentId: kpiGridId,
      childIds: [kpiCard2TitleId, kpiCard2ValueId],
      sortOrder: 'o00020',
      kind: 'container',
      name: 'OrdersKpiCard',
      semanticTag: 'article',
      visible: true,
      locked: false,
      layout: {
        mode: 'flex',
        positioning: 'flow',
        direction: 'column',
        gap: 6,
        frame: { x: 0, y: 0, width: 340, height: 104 },
        width: { mode: 'fill' },
        height: { mode: 'hug' },
        padding: { top: 20, right: 20, bottom: 20, left: 20 },
      },
      style: {
        fills: [{ type: 'solid', color: { $token: 'color.bg.surface' } }],
        border: { width: 1, style: 'solid', color: { $token: 'color.border.subtle' } },
        radius: { $token: 'radius.md' },
      },
    },
    [kpiCard2TitleId]: {
      id: kpiCard2TitleId,
      sheetId,
      parentId: kpiCard2Id,
      childIds: [],
      sortOrder: 'o00010',
      kind: 'text',
      name: 'OrdersLabel',
      semanticTag: 'span',
      visible: true,
      locked: false,
      layout: {
        mode: 'freeform',
        positioning: 'flow',
        frame: { x: 0, y: 0, width: 140, height: 20 },
        width: { mode: 'hug' },
        height: { mode: 'hug' },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      style: {},
      typography: {
        fontFamily: { $token: 'font.sans' },
        fontSize: 13,
        fontWeight: 500,
        color: { $token: 'color.text.secondary' },
      },
      content: { text: 'Active Orders' },
    },
    [kpiCard2ValueId]: {
      id: kpiCard2ValueId,
      sheetId,
      parentId: kpiCard2Id,
      childIds: [],
      sortOrder: 'o00020',
      kind: 'text',
      name: 'OrdersValue',
      semanticTag: 'h3',
      visible: true,
      locked: false,
      layout: {
        mode: 'freeform',
        positioning: 'flow',
        frame: { x: 0, y: 0, width: 140, height: 32 },
        width: { mode: 'hug' },
        height: { mode: 'hug' },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      style: {},
      typography: {
        fontFamily: { $token: 'font.sans' },
        fontSize: 24,
        fontWeight: 700,
        color: { $token: 'color.success.500' },
      },
      content: { text: '1,482' },
    },

    [kpiCard3Id]: {
      id: kpiCard3Id,
      sheetId,
      parentId: kpiGridId,
      childIds: [kpiCard3TitleId, kpiCard3ValueId],
      sortOrder: 'o00030',
      kind: 'container',
      name: 'ConversionKpiCard',
      semanticTag: 'article',
      visible: true,
      locked: false,
      layout: {
        mode: 'flex',
        positioning: 'flow',
        direction: 'column',
        gap: 6,
        frame: { x: 0, y: 0, width: 340, height: 104 },
        width: { mode: 'fill' },
        height: { mode: 'hug' },
        padding: { top: 20, right: 20, bottom: 20, left: 20 },
      },
      style: {
        fills: [{ type: 'solid', color: { $token: 'color.bg.surface' } }],
        border: { width: 1, style: 'solid', color: { $token: 'color.border.subtle' } },
        radius: { $token: 'radius.md' },
      },
    },
    [kpiCard3TitleId]: {
      id: kpiCard3TitleId,
      sheetId,
      parentId: kpiCard3Id,
      childIds: [],
      sortOrder: 'o00010',
      kind: 'text',
      name: 'ConversionLabel',
      semanticTag: 'span',
      visible: true,
      locked: false,
      layout: {
        mode: 'freeform',
        positioning: 'flow',
        frame: { x: 0, y: 0, width: 140, height: 20 },
        width: { mode: 'hug' },
        height: { mode: 'hug' },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      style: {},
      typography: {
        fontFamily: { $token: 'font.sans' },
        fontSize: 13,
        fontWeight: 500,
        color: { $token: 'color.text.secondary' },
      },
      content: { text: 'Conversion Rate' },
    },
    [kpiCard3ValueId]: {
      id: kpiCard3ValueId,
      sheetId,
      parentId: kpiCard3Id,
      childIds: [],
      sortOrder: 'o00020',
      kind: 'text',
      name: 'ConversionValue',
      semanticTag: 'h3',
      visible: true,
      locked: false,
      layout: {
        mode: 'freeform',
        positioning: 'flow',
        frame: { x: 0, y: 0, width: 140, height: 32 },
        width: { mode: 'hug' },
        height: { mode: 'hug' },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      style: {},
      typography: {
        fontFamily: { $token: 'font.sans' },
        fontSize: 24,
        fontWeight: 700,
        color: { $token: 'color.accent.500' },
      },
      content: { text: '4.86%' },
    },

    [searchSectionId]: {
      id: searchSectionId,
      sheetId,
      parentId: rootArtboardId,
      childIds: [searchHeaderId, searchBarRowId, resultsRegionId],
      sortOrder: 'o00040',
      kind: 'container',
      name: 'LiveInventoryCard',
      semanticTag: 'section',
      visible: true,
      locked: false,
      layout: {
        mode: 'flex',
        positioning: 'flow',
        direction: 'column',
        gap: 14,
        frame: { x: 0, y: 450, width: 1056, height: 260 },
        width: { mode: 'fill' },
        height: { mode: 'hug' },
        padding: { top: 24, right: 24, bottom: 24, left: 24 },
      },
      style: {
        fills: [{ type: 'solid', color: { $token: 'color.bg.surface' } }],
        border: { width: 1, style: 'solid', color: { $token: 'color.border.subtle' } },
        radius: { $token: 'radius.lg' },
      },
    },

    [searchHeaderId]: {
      id: searchHeaderId,
      sheetId,
      parentId: searchSectionId,
      childIds: [],
      sortOrder: 'o00010',
      kind: 'text',
      name: 'InventorySectionTitle',
      semanticTag: 'h3',
      visible: true,
      locked: false,
      layout: {
        mode: 'freeform',
        positioning: 'flow',
        frame: { x: 0, y: 0, width: 320, height: 24 },
        width: { mode: 'hug' },
        height: { mode: 'hug' },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      style: {},
      typography: {
        fontFamily: { $token: 'font.sans' },
        fontSize: 17,
        fontWeight: 600,
        color: { $token: 'color.text.primary' },
      },
      content: { text: 'Live Product Catalog (HTMX / Reactive Search)' },
    },

    [searchBarRowId]: {
      id: searchBarRowId,
      sheetId,
      parentId: searchSectionId,
      childIds: [searchInputId, filterBtnId],
      sortOrder: 'o00020',
      kind: 'container',
      name: 'SearchControlsRow',
      semanticTag: 'form',
      visible: true,
      locked: false,
      layout: {
        mode: 'flex',
        positioning: 'flow',
        direction: 'row',
        gap: 12,
        justify: 'start',
        align: 'center',
        frame: { x: 0, y: 0, width: 1008, height: 42 },
        width: { mode: 'fill' },
        height: { mode: 'hug' },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      style: {},
    },

    [searchInputId]: {
      id: searchInputId,
      sheetId,
      parentId: searchBarRowId,
      childIds: [],
      sortOrder: 'o00010',
      kind: 'control',
      name: 'ProductSearchInput',
      semanticTag: 'input',
      visible: true,
      locked: false,
      layout: {
        mode: 'freeform',
        positioning: 'flow',
        frame: { x: 0, y: 0, width: 640, height: 40 },
        width: { mode: 'fill' },
        height: { mode: 'fixed', value: 40 },
        padding: { top: 8, right: 14, bottom: 8, left: 14 },
      },
      style: {
        fills: [{ type: 'solid', color: { $token: 'color.bg.muted' } }],
        border: { width: 1, style: 'solid', color: { $token: 'color.border.subtle' } },
        radius: { $token: 'radius.sm' },
      },
      typography: {
        fontFamily: { $token: 'font.sans' },
        fontSize: 14,
        fontWeight: 400,
        color: { $token: 'color.text.primary' },
      },
      content: {
        controlType: 'text-input',
        placeholder: 'Search SKU, product name, or category...',
        iconName: 'search',
      },
      platform: {
        htmx: {
          method: 'hx-get',
          endpoint: '/api/products/search',
          targetNodeId: resultsRegionId,
          hxSwap: 'innerHTML',
          hxTrigger: 'keyup changed delay:250ms, search',
        },
        mvvm: {
          bindings: { Text: { path: 'SearchQuery', mode: 'TwoWay' } },
        },
        a11y: { ariaLabel: 'Search Product Catalog' },
      },
    },

    [filterBtnId]: {
      id: filterBtnId,
      sheetId,
      parentId: searchBarRowId,
      childIds: [],
      sortOrder: 'o00020',
      kind: 'control',
      name: 'RefreshCatalogButton',
      semanticTag: 'button',
      visible: true,
      locked: false,
      layout: {
        mode: 'freeform',
        positioning: 'flow',
        frame: { x: 0, y: 0, width: 148, height: 40 },
        width: { mode: 'hug', value: 148 },
        height: { mode: 'fixed', value: 40 },
        padding: { top: 8, right: 16, bottom: 8, left: 16 },
      },
      style: {
        fills: [{ type: 'solid', color: { $token: 'color.primary.500' } }],
        radius: { $token: 'radius.sm' },
      },
      typography: {
        fontFamily: { $token: 'font.sans' },
        fontSize: 13,
        fontWeight: 600,
        color: '#ffffff',
        textAlign: 'center',
      },
      content: { controlType: 'button', text: 'Sync Inventory', iconName: 'refresh' },
      platform: {
        htmx: {
          method: 'hx-post',
          endpoint: '/api/products/refresh',
          targetNodeId: resultsRegionId,
          hxSwap: 'innerHTML',
          hxTrigger: 'click',
        },
      },
    },

    [resultsRegionId]: {
      id: resultsRegionId,
      sheetId,
      parentId: searchSectionId,
      childIds: [resultRow1Id, resultRow2Id],
      sortOrder: 'o00030',
      kind: 'collection',
      name: 'ProductResultsList',
      semanticTag: 'ul',
      visible: true,
      locked: false,
      layout: {
        mode: 'flex',
        positioning: 'flow',
        direction: 'column',
        gap: 8,
        frame: { x: 0, y: 0, width: 1008, height: 108 },
        width: { mode: 'fill' },
        height: { mode: 'hug' },
        padding: { top: 8, right: 0, bottom: 0, left: 0 },
      },
      style: {},
      controlFlow: {
        repeat: {
          collectionExpr: 'filteredProducts',
          itemVar: 'product',
          keyExpr: 'product.id',
        },
      },
    },

    [resultRow1Id]: {
      id: resultRow1Id,
      sheetId,
      parentId: resultsRegionId,
      childIds: [],
      sortOrder: 'o00010',
      kind: 'text',
      name: 'ProductItemRow1',
      semanticTag: 'li',
      visible: true,
      locked: false,
      layout: {
        mode: 'freeform',
        positioning: 'flow',
        frame: { x: 0, y: 0, width: 1008, height: 42 },
        width: { mode: 'fill' },
        height: { mode: 'hug' },
        padding: { top: 10, right: 14, bottom: 10, left: 14 },
      },
      style: {
        fills: [{ type: 'solid', color: { $token: 'color.bg.muted' } }],
        radius: { $token: 'radius.sm' },
      },
      typography: {
        fontFamily: { $token: 'font.sans' },
        fontSize: 14,
        fontWeight: 500,
        color: { $token: 'color.text.primary' },
      },
      content: { text: 'SKU-4090 • Local Workstation GPU Module — In Stock (24 units) — $1,599' },
    },

    [resultRow2Id]: {
      id: resultRow2Id,
      sheetId,
      parentId: resultsRegionId,
      childIds: [],
      sortOrder: 'o00020',
      kind: 'text',
      name: 'ProductItemRow2',
      semanticTag: 'li',
      visible: true,
      locked: false,
      layout: {
        mode: 'freeform',
        positioning: 'flow',
        frame: { x: 0, y: 0, width: 1008, height: 42 },
        width: { mode: 'fill' },
        height: { mode: 'hug' },
        padding: { top: 10, right: 14, bottom: 10, left: 14 },
      },
      style: {
        fills: [{ type: 'solid', color: { $token: 'color.bg.muted' } }],
        radius: { $token: 'radius.sm' },
      },
      typography: {
        fontFamily: { $token: 'font.sans' },
        fontSize: 14,
        fontWeight: 500,
        color: { $token: 'color.text.primary' },
      },
      content: { text: 'SKU-2088 • Tactile Mechanical Studio Keyboard — In Stock (86 units) — $189' },
    },
  };

  return {
    sheetId,
    projectId,
    name,
    rootIds: [rootArtboardId],
    nodes,
    stateSchema: [
      { name: 'orderCount', type: 'number', initialValue: 1482 },
      { name: 'searchQuery', type: 'string', initialValue: '' },
      { name: 'lastExportStatus', type: 'string', initialValue: 'Ready' },
    ],
    propsSchema: [
      { name: 'storeTitle', type: 'string', required: false, defaultValue: 'NovaCommerce Studio' },
    ],
    ipcSchema: [
      {
        name: 'export_sales_report',
        args: [{ name: 'format', type: 'string' }],
        returnType: 'string',
        description: 'Exports current dashboard analytics to a local report file.',
      },
    ],
  };
}
