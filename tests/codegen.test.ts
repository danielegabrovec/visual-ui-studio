import { MessageChannel } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { createDefaultThemes, createDefaultTokens, createStarterDemoSheet } from '@shared/default-tokens';
import { normalizeSheetToUIRModule, solveFreeformToAutoLayout } from '@shared/layout-solver';
import { BUILTIN_TARGET_DESCRIPTORS, type UISheetDocument } from '@shared/ui-ir';
import { applyPatchOpsToSheet, createDefaultUINode } from '@shared/ui-patch';
import { attachWorkerRpcHandler, createWorkerRpcProxy, type ICodegenWorkerService } from '@shared/worker-protocol';
import { createCodegenWorkerService } from '../src/workers/codegen-worker';

describe('Wave 2 — Spatial Layout Solver & 26-Target Multi-Paradigm Codegen Engine', () => {
  const projectId = 'proj_test';
  const sheetId = 'sheet_home';
  const { darkTheme, all: themes } = createDefaultThemes(projectId);
  const tokens = createDefaultTokens(projectId, darkTheme.id);
  const demoSheet = createStarterDemoSheet(projectId, sheetId, 'HomeDashboard');
  const service = createCodegenWorkerService();

  it('registers all 26 built-in GUI targets across Tiers 1–4 (Web, Mobile, Desktop, Python, Go, Rust, C++, Embedded & Game)', async () => {
    const listed = await service.listTargets();
    expect(listed.length).toBe(26);
    const listedIds = listed.map((t) => t.id).sort();
    const expectedIds = BUILTIN_TARGET_DESCRIPTORS.map((t) => t.id).sort();
    expect(listedIds).toEqual(expectedIds);
  });

  it('exports an edited CSS layout and preserves a linked handwritten script in HTML bundles', async () => {
    const scriptPath = 'scripts/handlers.js';
    const sourceCode = 'export function apriDettagli() { document.title = "Dettagli"; }\n';
    const { nextSheet: sheet } = applyPatchOpsToSheet(demoSheet, [
      {
        op: 'update_node',
        id: 'nd_primary_cta',
        layout: { margin: { top: 17, right: 2, bottom: 3, left: 4 } },
      },
      {
        op: 'set_interaction',
        id: 'nd_primary_cta',
        interactions: [{
          trigger: 'onClick',
          action: { kind: 'call_script_fn', moduleRelPath: scriptPath, fnName: 'apriDettagli' },
        }],
      },
    ]);
    const result = await service.compileSheet({
      sheet,
      tokens,
      themes,
      options: {
        targetId: 'html-vanilla',
        dialect: 'vanilla-css',
        mode: 'bundle',
        scriptModules: [{
          relativePath: scriptPath,
          language: 'javascript',
          sourceCode,
          exportedFunctions: ['apriDettagli'],
          loadStrategy: 'module',
        }],
      },
    });
    const files = new Map(result.files.map((f) => [f.relativePath, f.code]));
    expect(files.get('styles.css')).toContain('margin: 17px 2px 3px 4px');
    expect(files.get('index.html')).toContain('data-script-fn="apriDettagli"');
    expect(files.get('app.js')).toContain("from './scripts/handlers.js'");
    expect(files.get(scriptPath)).toBe(sourceCode);
  });

  it('solves freeform 2D card grid, space-between navbar, sub-rows, and enclosed labels into clean Auto-Layout', () => {
    const rootId = 'art_free';
    const navBoxId = 'nav_free';
    const logoId = 'logo_free';
    const ctaId = 'cta_free';
    const matrixBoxId = 'matrix_free';
    const c1 = 'c_1', c2 = 'c_2', c3 = 'c_3', c4 = 'c_4', c5 = 'c_5', c6 = 'c_6';
    const encloseOuterId = 'card_outer';
    const encloseInnerTextId = 'label_inside_outer';

    const freeSheet: UISheetDocument = {
      sheetId: 's_free',
      projectId,
      name: 'FreeformCanvas',
      rootIds: [rootId],
      nodes: {
        [rootId]: createDefaultUINode(
          {
            id: rootId,
            kind: 'artboard',
            name: 'FreeformArtboard',
            childIds: [navBoxId, matrixBoxId, encloseOuterId, encloseInnerTextId],
            layout: {
              mode: 'freeform',
              positioning: 'flow',
              frame: { x: 0, y: 0, width: 1000, height: 800 },
              width: { mode: 'fixed', value: 1000 },
              height: { mode: 'fixed', value: 800 },
              padding: { top: 0, right: 0, bottom: 0, left: 0 },
            },
          },
          's_free',
        ),
        [navBoxId]: createDefaultUINode(
          {
            id: navBoxId,
            parentId: rootId,
            kind: 'container',
            name: 'FreeNavbar',
            childIds: [logoId, ctaId],
            layout: {
              mode: 'freeform',
              positioning: 'absolute',
              frame: { x: 24, y: 20, width: 952, height: 60 },
              width: { mode: 'fixed', value: 952 },
              height: { mode: 'fixed', value: 60 },
              padding: { top: 0, right: 0, bottom: 0, left: 0 },
            },
          },
          's_free',
        ),
        [logoId]: createDefaultUINode(
          {
            id: logoId,
            parentId: navBoxId,
            kind: 'text',
            name: 'Logo',
            content: { text: 'Brand' },
            layout: {
              mode: 'freeform',
              positioning: 'absolute',
              frame: { x: 20, y: 16, width: 120, height: 28 },
              width: { mode: 'hug' },
              height: { mode: 'hug' },
              padding: { top: 0, right: 0, bottom: 0, left: 0 },
            },
          },
          's_free',
        ),
        [ctaId]: createDefaultUINode(
          {
            id: ctaId,
            parentId: navBoxId,
            kind: 'control',
            name: 'LoginBtn',
            content: { controlType: 'button', text: 'Sign In' },
            layout: {
              mode: 'freeform',
              positioning: 'absolute',
              frame: { x: 820, y: 12, width: 112, height: 36 },
              width: { mode: 'fixed', value: 112 },
              height: { mode: 'fixed', value: 36 },
              padding: { top: 8, right: 16, bottom: 8, left: 16 },
            },
          },
          's_free',
        ),
        [matrixBoxId]: createDefaultUINode(
          {
            id: matrixBoxId,
            parentId: rootId,
            kind: 'container',
            name: 'FreeMatrix',
            childIds: [c1, c2, c3, c4, c5, c6],
            layout: {
              mode: 'freeform',
              positioning: 'absolute',
              frame: { x: 24, y: 110, width: 952, height: 260 },
              width: { mode: 'fixed', value: 952 },
              height: { mode: 'fixed', value: 260 },
              padding: { top: 0, right: 0, bottom: 0, left: 0 },
            },
          },
          's_free',
        ),
        ...Object.fromEntries(
          [c1, c2, c3, c4, c5, c6].map((cid, idx) => {
            const col = idx % 3;
            const row = Math.floor(idx / 3);
            return [
              cid,
              createDefaultUINode(
                {
                  id: cid,
                  parentId: matrixBoxId,
                  kind: 'container',
                  name: `Tile_${idx + 1}`,
                  layout: {
                    mode: 'freeform',
                    positioning: 'absolute',
                    frame: { x: 16 + col * 310, y: 16 + row * 120, width: 290, height: 100 },
                    width: { mode: 'fixed', value: 290 },
                    height: { mode: 'fixed', value: 100 },
                    padding: { top: 12, right: 12, bottom: 12, left: 12 },
                  },
                },
                's_free',
              ),
            ];
          }),
        ),
        [encloseOuterId]: createDefaultUINode(
          {
            id: encloseOuterId,
            parentId: rootId,
            kind: 'container',
            name: 'FooterBox',
            childIds: [],
            layout: {
              mode: 'freeform',
              positioning: 'absolute',
              frame: { x: 24, y: 400, width: 952, height: 120 },
              width: { mode: 'fixed', value: 952 },
              height: { mode: 'fixed', value: 120 },
              padding: { top: 0, right: 0, bottom: 0, left: 0 },
            },
          },
          's_free',
        ),
        [encloseInnerTextId]: createDefaultUINode(
          {
            id: encloseInnerTextId,
            parentId: rootId,
            kind: 'text',
            name: 'EnclosedLabel',
            content: { text: 'Automatically reparented inside FooterBox' },
            layout: {
              mode: 'freeform',
              positioning: 'absolute',
              frame: { x: 48, y: 430, width: 320, height: 28 },
              width: { mode: 'hug' },
              height: { mode: 'hug' },
              padding: { top: 0, right: 0, bottom: 0, left: 0 },
            },
          },
          's_free',
        ),
      },
    };

    const { ops, summary } = solveFreeformToAutoLayout(freeSheet);
    expect(ops.length).toBeGreaterThan(0);
    expect(summary).toContain('Auto-Layout');

    const { nextSheet, inverseOps } = applyPatchOpsToSheet(freeSheet, ops);

    expect(nextSheet.nodes[rootId].layout.mode).toBe('flex');
    expect(nextSheet.nodes[rootId].layout.direction).toBe('column');
    expect(nextSheet.nodes[navBoxId].layout.mode).toBe('flex');
    expect(nextSheet.nodes[navBoxId].layout.direction).toBe('row');
    expect(nextSheet.nodes[navBoxId].layout.justify).toBe('space-between');
    expect(nextSheet.nodes[matrixBoxId].layout.mode).toBe('grid');
    expect(nextSheet.nodes[matrixBoxId].layout.gridCols?.length).toBe(3);
    expect(nextSheet.nodes[encloseInnerTextId].parentId).toBe(encloseOuterId);
    expect(nextSheet.nodes[encloseOuterId].childIds).toContain(encloseInnerTextId);

    const reverted = applyPatchOpsToSheet(nextSheet, inverseOps).nextSheet;
    expect(reverted.nodes[matrixBoxId].layout.mode).toBe('freeform');
    expect(reverted.nodes[encloseInnerTextId].parentId).toBe(rootId);
  });

  it('normalizes Level-1 UISheetDocument into Level-2 UIRModule with desktop no-drag safety & tokens', () => {
    const ir = normalizeSheetToUIRModule(demoSheet, tokens, themes);
    expect(ir.components.length).toBe(1);
    expect(ir.tokens.colors['color.primary.600']?.light).toBe('#2563eb');
    expect(ir.tokens.colors['color.primary.600']?.dark).toBe('#3b82f6');
    expect(ir.windowChrome?.backdrop).toBe('mica');

    const navbar = ir.components[0].root.children.find((n) => n.canvasNodeId === 'nd_top_navbar');
    expect(navbar?.dragRegion).toBe('drag');
    const navActions = navbar?.children.find((n) => n.canvasNodeId === 'nd_nav_actions');
    expect(navActions?.dragRegion).toBe('no-drag');
  });

  it('compiles ALL 26 targets across snippet, component, bundle, and scaffold modes with accurate SourceMaps', async () => {
    for (const desc of BUILTIN_TARGET_DESCRIPTORS) {
      // 1. Snippet mode
      const snippetRes = await service.compileSheet({
        sheet: demoSheet,
        tokens,
        themes,
        options: {
          targetId: desc.id,
          mode: 'snippet',
          selectedNodeId: 'nd_primary_cta',
        },
      });
      expect(snippetRes.targetId).toBe(desc.id);
      expect(snippetRes.mode).toBe('snippet');
      expect(snippetRes.files).toHaveLength(1);
      expect(snippetRes.files[0].code.trim().length).toBeGreaterThan(10);
      expect(snippetRes.files[0].sourceMap.some((s) => s.canvasNodeId === 'nd_primary_cta')).toBe(true);

      // 2. Component, Bundle, and Scaffold modes
      for (const mode of ['component', 'bundle', 'scaffold'] as const) {
        const res = await service.compileSheet({
          sheet: demoSheet,
          tokens,
          themes,
          options: {
            targetId: desc.id,
            mode,
          },
        });

        expect(res.targetId).toBe(desc.id);
        expect(res.mode).toBe(mode);
        expect(res.files.length).toBeGreaterThanOrEqual(1);
        if (mode === 'scaffold') {
          expect(res.files.some((f) => f.relativePath === 'tokens.json')).toBe(true);
        }

        const entryFile = res.files.find((f) => f.relativePath === res.entryFilePath) ?? res.files[0];
        expect(entryFile).toBeDefined();
        expect(entryFile.code.trim().length).toBeGreaterThan(100);

        const totalLines = entryFile.code.split('\n').length;
        expect(entryFile.sourceMap.length).toBeGreaterThanOrEqual(8);

        for (const span of entryFile.sourceMap) {
          expect(span.startLine).toBeGreaterThanOrEqual(1);
          expect(span.endLine).toBeGreaterThanOrEqual(span.startLine);
          expect(span.endLine).toBeLessThanOrEqual(totalLines);
        }

        const mappedIds = new Set(entryFile.sourceMap.map((s) => s.canvasNodeId));
        expect(mappedIds.has('art_home_root')).toBe(true);
        expect(mappedIds.has('nd_primary_cta')).toBe(true);
        expect(mappedIds.has('nd_htmx_search_input')).toBe(true);
      }
    }
  });

  it('Bugfix #1: emits clean kebab-case CSS class names with ZERO garbled node-ID suffixes and numeric collision suffixes only on duplicate names', async () => {
    const htmlBundle = await service.compileSheet({
      sheet: demoSheet,
      tokens,
      themes,
      options: { targetId: 'html-vanilla', dialect: 'vanilla-css', mode: 'bundle' },
    });
    const htmlCode = htmlBundle.files.find((f) => f.relativePath === 'index.html')!.code;
    const cssCode = htmlBundle.files.find((f) => f.relativePath === 'styles.css')!.code;

    // Clean deterministic class names
    expect(cssCode).toContain('.metrics-kpi-grid {');
    expect(cssCode).toContain('.revenue-kpi-card {');
    expect(cssCode).toContain('.revenue-label {');
    expect(htmlCode).toContain('class="metrics-kpi-grid"');
    expect(htmlCode).toContain('class="revenue-kpi-card"');
    expect(htmlCode).toContain('class="revenue-label"');

    // ZERO garbled `.slice(-4)` suffixes from node IDs (`nd_kpi_grid`, `nd_kpi_revenue`, `nd_kpi_rev_label`)
    for (const badPattern of ['metrics-kpi-grid-grid', 'revenue-kpi-card-enue', 'revenue-label-abel', '-enue', '-abel', '-grid-grid']) {
      expect(cssCode).not.toContain(badPattern);
      expect(htmlCode).not.toContain(badPattern);
    }

    // CSS Modules camelCase check
    const reactCssMod = await service.compileSheet({
      sheet: demoSheet,
      tokens,
      themes,
      options: { targetId: 'react-tsx', dialect: 'css-modules', mode: 'bundle' },
    });
    const tsxMod = reactCssMod.files.find((f) => f.relativePath.endsWith('.tsx'))!.code;
    const modCss = reactCssMod.files.find((f) => f.relativePath.endsWith('.module.css'))!.code;
    expect(tsxMod).toContain('styles.metricsKpiGrid');
    expect(tsxMod).toContain('styles.revenueKpiCard');
    expect(tsxMod).toContain('styles.revenueLabel');
    expect(modCss).toContain('.metricsKpiGrid {');

    // Collision check: duplicate node names produce `-2` and `-3`
    const dupSheet: UISheetDocument = {
      sheetId: 's_dup',
      projectId,
      name: 'CollisionCheck',
      rootIds: ['root_dup'],
      nodes: {
        root_dup: createDefaultUINode({ id: 'root_dup', kind: 'artboard', name: 'RootBoard', childIds: ['n1', 'n2', 'n3'] }, 's_dup'),
        n1: createDefaultUINode({ id: 'n1', parentId: 'root_dup', kind: 'container', name: 'MetricCard' }, 's_dup'),
        n2: createDefaultUINode({ id: 'n2', parentId: 'root_dup', kind: 'container', name: 'MetricCard' }, 's_dup'),
        n3: createDefaultUINode({ id: 'n3', parentId: 'root_dup', kind: 'container', name: 'MetricCard' }, 's_dup'),
      },
    };
    const dupBundle = await service.compileSheet({
      sheet: dupSheet,
      tokens,
      themes,
      options: { targetId: 'html-vanilla', dialect: 'vanilla-css', mode: 'bundle' },
    });
    const dupHtml = dupBundle.files[0].code;
    expect(dupHtml).toContain('class="metric-card"');
    expect(dupHtml).toContain('class="metric-card-2"');
    expect(dupHtml).toContain('class="metric-card-3"');
  });

  it('Bugfix #2: emits ZERO `void varName;` boilerplate across React, Next.js, React Native, Electron, Tauri & Wails', async () => {
    const tsTargets = ['react-tsx', 'nextjs-app', 'react-native', 'electron-target', 'tauri-v2', 'go-wails'] as const;
    for (const targetId of tsTargets) {
      const bundle = await service.compileSheet({
        sheet: demoSheet,
        tokens,
        themes,
        options: { targetId, mode: 'bundle' },
      });
      for (const file of bundle.files) {
        if (file.language === 'tsx' || file.language === 'typescript') {
          expect(file.code).not.toMatch(/\bvoid\s+[A-Za-z_$]/);
        }
      }
    }

    // Verify unused setter destructuring is omitted when state value is read-only in JSX
    const readOnlySheet: UISheetDocument = {
      sheetId: 's_ro',
      projectId,
      name: 'ReadOnlyMetric',
      rootIds: ['art_ro'],
      stateSchema: [{ name: 'activeCount', type: 'number', initialValue: 42 }],
      nodes: {
        art_ro: createDefaultUINode(
          {
            id: 'art_ro',
            kind: 'artboard',
            name: 'ReadOnlyBoard',
            childIds: ['txt_ro'],
          },
          's_ro',
        ),
        txt_ro: {
          ...createDefaultUINode(
            {
              id: 'txt_ro',
              parentId: 'art_ro',
              kind: 'text',
              name: 'CountText',
              content: { text: '42' },
            },
            's_ro',
          ),
          dataBindings: { text: { propOrState: 'activeCount', fallback: '42' } },
        },
      },
    };
    const roBundle = await service.compileSheet({
      sheet: readOnlySheet,
      tokens,
      themes,
      options: { targetId: 'react-tsx', mode: 'component' },
    });
    expect(roBundle.files[0].code).toContain('const [activeCount] = useState<number>(42);');
    expect(roBundle.files[0].code).not.toContain('setActiveCount');
    expect(roBundle.files[0].code).not.toContain('void ');
  });

  it('emits Next.js 15 RSC page + isolated "use client" interactive island components', async () => {
    const bundle = await service.compileSheet({
      sheet: demoSheet,
      tokens,
      themes,
      options: { targetId: 'nextjs-app', mode: 'bundle' },
    });

    const pageFile = bundle.files.find((f) => f.relativePath === 'app/page.tsx')!;
    expect(pageFile).toBeDefined();
    expect(pageFile.code).not.toContain("'use client'");
    expect(pageFile.code).toContain('export default async function');

    const islandFiles = bundle.files.filter((f) => f.relativePath.startsWith('app/components/'));
    expect(islandFiles.length).toBeGreaterThanOrEqual(1);
    expect(islandFiles[0].code.startsWith("'use client';")).toBe(true);
  });

  it('emits HTMX 2.x hypermedia attributes wired to #target IDs AND extracts server swap partials', async () => {
    const bundle = await service.compileSheet({
      sheet: demoSheet,
      tokens,
      themes,
      options: { targetId: 'htmx', mode: 'bundle' },
    });

    const indexHtml = bundle.files.find((f) => f.relativePath === 'index.html')!;
    expect(indexHtml.code).toContain('hx-get="/api/products/search"');
    expect(indexHtml.code).toContain('hx-post="/api/products/refresh"');
    expect(indexHtml.code).toContain('hx-swap="innerHTML"');
    expect(indexHtml.code).toContain('hx-target="#product-results-list"');

    const partialFile = bundle.files.find((f) => f.relativePath.startsWith('partials/_'));
    expect(partialFile).toBeDefined();
    expect(partialFile!.code).toContain('SKU-4090');
  });

  it('emits .NET MAUI XAML Grid/Border + AppThemeBinding + C# CommunityToolkit.Mvvm ViewModel', async () => {
    const bundle = await service.compileSheet({
      sheet: demoSheet,
      tokens,
      themes,
      options: { targetId: 'dotnet-maui', mode: 'bundle' },
    });

    const xaml = bundle.files.find((f) => f.relativePath.endsWith('Page.xaml'))!;
    const vm = bundle.files.find((f) => f.relativePath.endsWith('ViewModel.cs'))!;
    const res = bundle.files.find((f) => f.relativePath === 'Resources/Styles/Tokens.xaml')!;

    expect(xaml.code).toContain('x:DataType="vm:HomeDashboardViewModel"');
    expect(xaml.code).toContain('<Grid ColumnDefinitions="*, *, *"');
    expect(xaml.code).toContain('StrokeShape="RoundRectangle');
    expect(xaml.code).toContain('AppThemeBinding');
    expect(vm.code).toContain('ObservableObject');
    expect(vm.code).toContain('[ObservableProperty]');
    expect(vm.code).toContain('[RelayCommand]');
    expect(res.code).toContain('<ResourceDictionary');
  });

  it('emits Electron sandboxed preload + BrowserWindow main AND Tauri v2 Rust commands + ACL capabilities', async () => {
    const electronBundle = await service.compileSheet({
      sheet: demoSheet,
      tokens,
      themes,
      options: { targetId: 'electron-target', mode: 'bundle' },
    });
    expect(electronBundle.files.some((f) => f.relativePath === 'src/main/main.ts' && f.code.includes("ipcMain.handle('export_sales_report'"))).toBe(true);
    expect(electronBundle.files.some((f) => f.relativePath === 'src/preload/preload.ts' && f.code.includes('contextBridge.exposeInMainWorld'))).toBe(true);

    const tauriBundle = await service.compileSheet({
      sheet: demoSheet,
      tokens,
      themes,
      options: { targetId: 'tauri-v2', mode: 'bundle' },
    });
    const uiFile = tauriBundle.files.find((f) => f.relativePath.endsWith('.tsx'))!;
    const rsFile = tauriBundle.files.find((f) => f.relativePath === 'src-tauri/src/commands.rs')!;
    const confFile = tauriBundle.files.find((f) => f.relativePath === 'src-tauri/tauri.conf.json')!;
    const capFile = tauriBundle.files.find((f) => f.relativePath === 'src-tauri/capabilities/default.json')!;

    expect(uiFile.code).toContain('data-tauri-drag-region');
    expect(rsFile.code).toContain('#[tauri::command]');
    expect(rsFile.code).toContain('pub async fn export_sales_report');
    expect(() => JSON.parse(confFile.code)).not.toThrow();
    expect(() => JSON.parse(capFile.code)).not.toThrow();
  });

  it('emits idiomatic multi-file bundles & scaffolds for ALL 8 new Wave 2 targets', async () => {
    // 1. Blazor (`blazor-razor`)
    const blazor = await service.compileSheet({
      sheet: demoSheet,
      tokens,
      themes,
      options: { targetId: 'blazor-razor', mode: 'scaffold' },
    });
    const razorFile = blazor.files.find((f) => f.relativePath.endsWith('.razor'))!;
    const razorCss = blazor.files.find((f) => f.relativePath.endsWith('.razor.css'))!;
    const blazorCsproj = blazor.files.find((f) => f.relativePath.endsWith('.csproj'))!;
    expect(razorFile.code).toContain('@page "/home-dashboard"');
    expect(razorFile.code).toContain('@foreach (var product in FilteredProducts)');
    expect(razorFile.code).toContain('@bind="SearchQuery"');
    expect(razorFile.code).toContain('EventCallback<string>');
    expect(razorCss.code).toContain('.metrics-kpi-grid {');
    expect(blazorCsproj.code).toContain('Microsoft.NET.Sdk.Web');

    // 2. Python Streamlit (`python-streamlit`)
    const streamlit = await service.compileSheet({
      sheet: demoSheet,
      tokens,
      themes,
      options: { targetId: 'python-streamlit', mode: 'scaffold' },
    });
    const stApp = streamlit.files.find((f) => f.relativePath === 'app.py')!;
    const stReq = streamlit.files.find((f) => f.relativePath === 'requirements.txt')!;
    expect(stApp.code).toContain('st.set_page_config(');
    expect(stApp.code).toContain('st.columns(');
    expect(stApp.code).toContain('st.container(border=True)');
    expect(stApp.code).toContain('st.metric(');
    expect(stApp.code).toContain('st.text_input(');
    expect(stApp.code).toContain('st.button(');
    expect(stApp.code).toContain('st.session_state');
    expect(stReq.code).toContain('streamlit');

    // 3. Python PySide6 (`python-pyside6`)
    const pyside = await service.compileSheet({
      sheet: demoSheet,
      tokens,
      themes,
      options: { targetId: 'python-pyside6', mode: 'bundle' },
    });
    const uiWin = pyside.files.find((f) => f.relativePath === 'ui_window.py')!;
    const pyMain = pyside.files.find((f) => f.relativePath === 'main.py')!;
    expect(uiWin.code).toContain('QMainWindow');
    expect(uiWin.code).toContain('QVBoxLayout');
    expect(uiWin.code).toContain('QHBoxLayout');
    expect(uiWin.code).toContain('QGridLayout');
    expect(uiWin.code).toContain('QFrame');
    expect(uiWin.code).toContain('QPushButton');
    expect(uiWin.code).toContain('QLineEdit');
    expect(uiWin.code).toContain('QLabel');
    expect(uiWin.code).toContain('APP_QSS_STYLESHEET');
    expect(pyMain.code).toContain('QApplication');

    // 4. Go Wails v2 (`go-wails`)
    const wails = await service.compileSheet({
      sheet: demoSheet,
      tokens,
      themes,
      options: { targetId: 'go-wails', mode: 'scaffold' },
    });
    const appGo = wails.files.find((f) => f.relativePath === 'app.go')!;
    const mainGo = wails.files.find((f) => f.relativePath === 'main.go')!;
    const wailsJson = wails.files.find((f) => f.relativePath === 'wails.json')!;
    const wailsUi = wails.files.find((f) => f.relativePath.endsWith('.tsx'))!;
    expect(appGo.code).toContain('type App struct');
    expect(appGo.code).toContain('func (a *App) ExportSalesReport(');
    expect(mainGo.code).toContain('wails.Run(&options.App{');
    expect(() => JSON.parse(wailsJson.code)).not.toThrow();
    expect(wailsUi.code).toContain('window.go?.main?.App?.ExportSalesReport');

    // 5. Qt 6 Quick QML (`cpp-qt-qml`)
    const qml = await service.compileSheet({
      sheet: demoSheet,
      tokens,
      themes,
      options: { targetId: 'cpp-qt-qml', mode: 'bundle' },
    });
    const mainQml = qml.files.find((f) => f.relativePath === 'ui/MainScreen.qml')!;
    const mainCpp = qml.files.find((f) => f.relativePath === 'main.cpp')!;
    const cmake = qml.files.find((f) => f.relativePath === 'CMakeLists.txt')!;
    expect(mainQml.code).toContain('ColumnLayout');
    expect(mainQml.code).toContain('RowLayout');
    expect(mainQml.code).toContain('GridLayout');
    expect(mainQml.code).toContain('Rectangle');
    expect(mainQml.code).toContain('Button');
    expect(mainQml.code).toContain('TextField');
    expect(mainQml.code).toContain('Text');
    expect(mainCpp.code).toContain('QQmlApplicationEngine');
    expect(cmake.code).toContain('qt_add_qml_module');

    // 6. WinUI 3 (`winui3-xaml`)
    const winui = await service.compileSheet({
      sheet: demoSheet,
      tokens,
      themes,
      options: { targetId: 'winui3-xaml', mode: 'scaffold' },
    });
    const winXaml = winui.files.find((f) => f.relativePath === 'MainWindow.xaml')!;
    const winCs = winui.files.find((f) => f.relativePath === 'MainWindow.xaml.cs')!;
    expect(winXaml.code).toContain('<Window.SystemBackdrop>');
    expect(winXaml.code).toContain('<MicaBackdrop />');
    expect(winXaml.code).toContain('<Grid ColumnDefinitions="*, *, *"');
    expect(winXaml.code).toContain('<StackPanel');
    expect(winXaml.code).toContain('<Border');
    expect(winXaml.code).toContain('ThemeResource');
    expect(winCs.code).toContain('public sealed partial class MainWindow : Window');

    // 7. Embedded C LVGL 9 (`lvgl-c`)
    const lvgl = await service.compileSheet({
      sheet: demoSheet,
      tokens,
      themes,
      options: { targetId: 'lvgl-c', mode: 'bundle' },
    });
    const lvglH = lvgl.files.find((f) => f.relativePath === 'ui_screen.h')!;
    const lvglC = lvgl.files.find((f) => f.relativePath === 'ui_screen.c')!;
    expect(lvglH.code).toContain('#include "lvgl.h"');
    expect(lvglC.code).toContain('lv_obj_create(');
    expect(lvglC.code).toContain('lv_obj_set_flex_flow(');
    expect(lvglC.code).toContain('LV_FLEX_FLOW_ROW');
    expect(lvglC.code).toContain('LV_FLEX_FLOW_COLUMN');
    expect(lvglC.code).toContain('lv_style_set_');
    expect(lvglC.code).toContain('lv_label_create(');
    expect(lvglC.code).toContain('lv_button_create(');
    expect(lvglC.code).toContain('lv_textarea_create(');

    // 8. Unity UI Toolkit (`unity-uitoolkit`)
    const unity = await service.compileSheet({
      sheet: demoSheet,
      tokens,
      themes,
      options: { targetId: 'unity-uitoolkit', mode: 'bundle' },
    });
    const uxml = unity.files.find((f) => f.relativePath === 'UI/ScreenView.uxml')!;
    const uss = unity.files.find((f) => f.relativePath === 'UI/ScreenView.uss')!;
    const unityCs = unity.files.find((f) => f.relativePath === 'Scripts/ScreenController.cs')!;
    expect(uxml.code).toContain('<ui:UXML');
    expect(uxml.code).toContain('<ui:Button name="create-order-button"');
    expect(uss.code).toContain('.metrics-kpi-grid {');
    expect(uss.code).toContain('flex-direction:');
    expect(unityCs.code).toContain('UIDocument');
    expect(unityCs.code).toContain('_uiDocument.rootVisualElement.Q<Button>("create-order-button")');
  });

  it('supports all 4 styling dialects (tailwind, vanilla-css, css-modules, shadcn) and snippet/scaffold modes', async () => {
    for (const dialect of ['tailwind', 'vanilla-css', 'css-modules', 'shadcn'] as const) {
      const reactBundle = await service.compileSheet({
        sheet: demoSheet,
        tokens,
        themes,
        options: { targetId: 'react-tsx', dialect, mode: 'bundle' },
      });
      expect(reactBundle.dialect).toBe(dialect);
      expect(reactBundle.files[0].code.length).toBeGreaterThan(80);
    }

    const snippet = await service.compileSheet({
      sheet: demoSheet,
      tokens,
      themes,
      options: {
        targetId: 'react-tsx',
        mode: 'snippet',
        selectedNodeId: 'nd_primary_cta',
      },
    });
    expect(snippet.mode).toBe('snippet');
    expect(snippet.files).toHaveLength(1);
    expect(snippet.files[0].code).toContain('Create New Order');
    expect(snippet.files[0].code).not.toContain('export default');

    const scaffold = await service.compileSheet({
      sheet: demoSheet,
      tokens,
      themes,
      options: {
        targetId: 'flutter-dart',
        mode: 'scaffold',
      },
    });
    expect(scaffold.files.some((f) => f.relativePath === 'pubspec.yaml')).toBe(true);
    expect(scaffold.files.some((f) => f.relativePath === 'tokens.json')).toBe(true);
  });

  it('communicates cleanly over MessagePort JSON-RPC via attachWorkerRpcHandler & createWorkerRpcProxy', async () => {
    const { port1, port2 } = new MessageChannel();
    attachWorkerRpcHandler(port1, createCodegenWorkerService());
    const proxy = createWorkerRpcProxy<ICodegenWorkerService>(port2);

    try {
      const targets = await proxy.listTargets();
      expect(targets).toHaveLength(26);

      const slintBundle = await proxy.compileSheet({
        sheet: demoSheet,
        tokens,
        themes,
        options: { targetId: 'rust-slint', mode: 'bundle' },
      });
      expect(slintBundle.entryFilePath).toContain('.slint');
      expect(slintBundle.files.some((f) => f.relativePath === 'src/main.rs')).toBe(true);
    } finally {
      port1.close();
      port2.close();
    }
  });

  it('v2.0: emits Freeform / Absolute coordinates (left/top/width/height/z-index), Three.js 3D viewport, and TS/Blueprint event handlers across targets', async () => {
    const freeformSheet: UISheetDocument = {
      sheetId: 's_v2_free',
      projectId,
      name: 'FreeformShowcase',
      defaultLayoutMode: 'freeform',
      rootIds: ['art_v2_free'],
      nodes: {
        art_v2_free: createDefaultUINode(
          {
            id: 'art_v2_free',
            kind: 'artboard',
            name: 'FreeformShowcaseBoard',
            childIds: ['nd_abs_card', 'nd_abs_cta', 'nd_abs_three'],
            layout: {
              mode: 'freeform',
              positioning: 'flow',
              frame: { x: 0, y: 0, width: 1200, height: 800 },
              width: { mode: 'fixed', value: 1200 },
              height: { mode: 'fixed', value: 800 },
              padding: { top: 0, right: 0, bottom: 0, left: 0 },
            },
          },
          's_v2_free',
        ),
        nd_abs_card: createDefaultUINode(
          {
            id: 'nd_abs_card',
            parentId: 'art_v2_free',
            kind: 'container',
            name: 'FloatingHeroCard',
            layout: {
              mode: 'freeform',
              positioning: 'absolute',
              frame: { x: 140, y: 95, width: 420, height: 260 },
              width: { mode: 'fixed', value: 420 },
              height: { mode: 'fixed', value: 260 },
              padding: { top: 20, right: 20, bottom: 20, left: 20 },
            },
            style: {
              fills: [{ type: 'solid', color: '#111827' }],
              radius: 16,
              zIndex: 7,
              customCss: 'backdrop-filter: blur(12px);',
            },
          },
          's_v2_free',
        ),
        nd_abs_cta: {
          ...createDefaultUINode(
            {
              id: 'nd_abs_cta',
              parentId: 'art_v2_free',
              kind: 'control',
              name: 'LaunchActionButton',
              semanticTag: 'button',
              content: { controlType: 'button', text: 'Avvia Scena 3D' },
              layout: {
                mode: 'freeform',
                positioning: 'absolute',
                frame: { x: 160, y: 380, width: 210, height: 48 },
                width: { mode: 'fixed', value: 210 },
                height: { mode: 'fixed', value: 48 },
                padding: { top: 10, right: 20, bottom: 10, left: 20 },
              },
              style: {
                fills: [{ type: 'solid', color: '#2563eb' }],
                radius: 10,
                zIndex: 12,
              },
            },
            's_v2_free',
          ),
          interactions: [
            {
              trigger: 'onClick',
              action: {
                kind: 'call_script_fn',
                fnName: 'onPrimaryActionClick',
              },
            },
            {
              trigger: 'onClick',
              action: {
                kind: 'trigger_blueprint',
                blueprintId: 'bp_hero_flow',
                eventName: 'event_ui_click',
              },
            },
          ],
        },
        nd_abs_three: createDefaultUINode(
          {
            id: 'nd_abs_three',
            parentId: 'art_v2_free',
            kind: 'control',
            name: 'ProductThreeViewport',
            content: {
              controlType: 'three-viewport',
              threeSceneId: 'scn_pbr_showcase',
              text: 'Three.js Showcase',
            },
            layout: {
              mode: 'freeform',
              positioning: 'absolute',
              frame: { x: 620, y: 80, width: 500, height: 420 },
              width: { mode: 'fixed', value: 500 },
              height: { mode: 'fixed', value: 420 },
              padding: { top: 0, right: 0, bottom: 0, left: 0 },
            },
            style: {
              radius: 18,
              zIndex: 3,
            },
          },
          's_v2_free',
        ),
      },
    };

    // 1. HTML5 + Vanilla CSS
    const htmlRes = await service.compileSheet({
      sheet: freeformSheet,
      tokens,
      themes,
      options: { targetId: 'html-vanilla', dialect: 'vanilla-css', mode: 'bundle' },
    });
    const htmlCode = htmlRes.files.find((f) => f.relativePath === 'index.html')!.code;
    const cssCode = htmlRes.files.find((f) => f.relativePath === 'styles.css')!.code;

    expect(cssCode).toContain('position: relative;');
    expect(cssCode).toContain('position: absolute;');
    expect(cssCode).toContain('left: 140px;');
    expect(cssCode).toContain('top: 95px;');
    expect(cssCode).toContain('width: 420px;');
    expect(cssCode).toContain('height: 260px;');
    expect(cssCode).toContain('z-index: 7;');
    expect(cssCode).toContain('backdrop-filter: blur(12px);');
    expect(htmlCode).toContain('data-three-viewport="scn_pbr_showcase"');
    expect(htmlCode).toContain('<canvas data-three-scene="scn_pbr_showcase"');
    expect(htmlCode).toContain('onPrimaryActionClick');
    expect(htmlCode).toContain('bp_hero_flow');

    // 2. React TSX + Tailwind (single merged onClick, zero duplicate attributes, zero void boilerplate)
    const reactRes = await service.compileSheet({
      sheet: freeformSheet,
      tokens,
      themes,
      options: { targetId: 'react-tsx', dialect: 'tailwind', mode: 'component' },
    });
    const tsxCode = reactRes.files[0].code;
    expect(tsxCode).toContain('absolute left-[140px] top-[95px]');
    expect(tsxCode).toContain('w-[420px]');
    expect(tsxCode).toContain('h-[260px]');
    expect(tsxCode).toContain('z-[7]');
    expect(tsxCode).toContain("import { onPrimaryActionClick } from './scripts/handlers';");
    expect(tsxCode).toContain('triggerBlueprint(');
    expect(tsxCode).toContain("onClick={() => { onPrimaryActionClick(); triggerBlueprint('bp_hero_flow', 'event_ui_click'); }}");
    expect(tsxCode).toContain('data-three-scene="scn_pbr_showcase"');
    expect(tsxCode).not.toMatch(/\bvoid\s+[A-Za-z_$]/);

    // 3. Svelte 5 & Vue 3
    const svelteRes = await service.compileSheet({
      sheet: freeformSheet,
      tokens,
      themes,
      options: { targetId: 'svelte5', dialect: 'tailwind', mode: 'component' },
    });
    expect(svelteRes.files[0].code).toContain('data-three-scene="scn_pbr_showcase"');
    expect(svelteRes.files[0].code).toContain('onPrimaryActionClick()');
    expect(svelteRes.files[0].code).toContain("triggerBlueprint('bp_hero_flow', 'event_ui_click')");

    const vueRes = await service.compileSheet({
      sheet: freeformSheet,
      tokens,
      themes,
      options: { targetId: 'vue3', dialect: 'tailwind', mode: 'component' },
    });
    expect(vueRes.files[0].code).toContain('data-three-scene="scn_pbr_showcase"');
    expect(vueRes.files[0].code).toContain('onPrimaryActionClick()');

    // 4. React Native StyleSheet
    const rnRes = await service.compileSheet({
      sheet: freeformSheet,
      tokens,
      themes,
      options: { targetId: 'react-native', mode: 'component' },
    });
    expect(rnRes.files[0].code).toContain("position: 'absolute'");
    expect(rnRes.files[0].code).toContain('left: 140');
    expect(rnRes.files[0].code).toContain('top: 95');
    expect(rnRes.files[0].code).toContain('zIndex: 7');

    // 5. .NET MAUI (AbsoluteLayout) & WinUI 3 / Avalonia (Canvas.Left / Canvas.Top)
    const mauiRes = await service.compileSheet({
      sheet: freeformSheet,
      tokens,
      themes,
      options: { targetId: 'dotnet-maui', mode: 'bundle' },
    });
    const mauiXaml = mauiRes.files.find((f) => f.relativePath.endsWith('Page.xaml'))!.code;
    expect(mauiXaml).toContain('<AbsoluteLayout');
    expect(mauiXaml).toContain('AbsoluteLayout.LayoutBounds="140,95,420,260"');

    const winuiRes = await service.compileSheet({
      sheet: freeformSheet,
      tokens,
      themes,
      options: { targetId: 'winui3-xaml', mode: 'bundle' },
    });
    const winuiXaml = winuiRes.files.find((f) => f.relativePath === 'MainWindow.xaml')!.code;
    expect(winuiXaml).toContain('<Canvas');
    expect(winuiXaml).toContain('Canvas.Left="140" Canvas.Top="95"');

    // 6. Flutter (Stack + Positioned)
    const flutterRes = await service.compileSheet({
      sheet: freeformSheet,
      tokens,
      themes,
      options: { targetId: 'flutter-dart', mode: 'component' },
    });
    expect(flutterRes.files[0].code).toContain('Stack(');
    expect(flutterRes.files[0].code).toContain('Positioned(left: 140, top: 95, width: 420, height: 260,');
  });

  it('v2.0: populates accurate CodeSourceMapSpan[] line ranges on secondary .css and .module.css files', async () => {
    // 1. HTML5 + Vanilla CSS secondary styles.css
    const htmlBundle = await service.compileSheet({
      sheet: demoSheet,
      tokens,
      themes,
      options: { targetId: 'html-vanilla', dialect: 'vanilla-css', mode: 'bundle' },
    });
    const cssFile = htmlBundle.files.find((f) => f.relativePath === 'styles.css')!;
    const cssLines = cssFile.code.split('\n');
    expect(cssFile.sourceMap.length).toBeGreaterThanOrEqual(8);

    for (const span of cssFile.sourceMap) {
      expect(span.startLine).toBeGreaterThanOrEqual(1);
      expect(span.endLine).toBeGreaterThanOrEqual(span.startLine);
      expect(span.endLine).toBeLessThanOrEqual(cssLines.length);
      expect(cssLines[span.startLine - 1]).toMatch(/^\.[A-Za-z0-9_-]+/);
      expect(cssLines[span.endLine - 1]).toBe('}');
    }

    const kpiSpan = cssFile.sourceMap.find((s) => s.canvasNodeId === 'nd_kpi_grid')!;
    expect(kpiSpan).toBeDefined();
    expect(cssLines[kpiSpan.startLine - 1]).toContain('.metrics-kpi-grid {');

    // 2. React TSX + CSS Modules secondary .module.css
    const reactModBundle = await service.compileSheet({
      sheet: demoSheet,
      tokens,
      themes,
      options: { targetId: 'react-tsx', dialect: 'css-modules', mode: 'bundle' },
    });
    const modCssFile = reactModBundle.files.find((f) => f.relativePath.endsWith('.module.css'))!;
    const modLines = modCssFile.code.split('\n');
    expect(modCssFile.sourceMap.length).toBeGreaterThanOrEqual(8);
    const modKpiSpan = modCssFile.sourceMap.find((s) => s.canvasNodeId === 'nd_kpi_grid')!;
    expect(modKpiSpan).toBeDefined();
    expect(modLines[modKpiSpan.startLine - 1]).toContain('.metricsKpiGrid {');
  });
});
