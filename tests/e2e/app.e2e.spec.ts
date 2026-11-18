import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';

test.describe('Visual UI Studio v2.1 — Complete Desktop IDE, Startup Ollama Architect, 11-Menu Bar & 26-Target E2E Verification', () => {
  test('verifies Persistent Top 11-Menu Bar on Startup, Custom App Icons, Auto-Start Ollama & Model Filtering, AI Project Architect & Startup Chat, 5-Step Wizard, VFS, Freeform Drag, CSS/Code Sync, TS Script, Unreal Blueprint, Three.js 3D, WCAG 2.2 & Unsloth', async ({}, testInfo) => {
    test.setTimeout(180000);
    const tempStudioDataDir = mkdtempSync(join(tmpdir(), 'visual-ui-studio-v2-e2e-'));
    const tempScaffoldExportDir = mkdtempSync(join(tmpdir(), 'visual-ui-studio-v2-scaffold-'));

    const mainEntry = resolve(process.cwd(), 'out/main/index.js');
    const winIconIco = resolve(process.cwd(), 'resources/icon.ico');
    const winIconPng = resolve(process.cwd(), 'resources/icon.png');
    const rendererAppIconPng = resolve(process.cwd(), 'out/renderer/app-icon.png');

    expect(existsSync(mainEntry)).toBe(true);
    expect(existsSync(winIconIco)).toBe(true);
    expect(statSync(winIconIco).size).toBeGreaterThan(10000);
    expect(existsSync(winIconPng)).toBe(true);
    expect(statSync(winIconPng).size).toBeGreaterThan(10000);
    expect(existsSync(rendererAppIconPng)).toBe(true);
    expect(statSync(rendererAppIconPng).size).toBeGreaterThan(10000);

    // Ensure ELECTRON_RUN_AS_NODE is unset so Electron boots as a full GUI desktop app
    const launchEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k !== 'ELECTRON_RUN_AS_NODE' && typeof v === 'string') {
        launchEnv[k] = v;
      }
    }
    launchEnv.STUDIO_DATA_DIR = tempStudioDataDir;

    const electronApp = await electron.launch({
      args: [mainEntry, `--user-data-dir=${join(tempStudioDataDir, 'profile')}`],
      env: launchEnv,
    });

    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];

    try {
      const page = await electronApp.firstWindow();

      page.on('pageerror', (err) => {
        pageErrors.push(err.message || String(err));
      });
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      // Set crisp 1600x960 content viewport dimensions & mock native folder dialog for automated scaffold export
      await electronApp.evaluate(({ BrowserWindow, dialog }, scaffoldDir) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
          win.setContentSize(1600, 960);
          win.center();
        }
        dialog.showOpenDialog = (async () => ({
          canceled: false,
          filePaths: [scaffoldDir],
        })) as typeof dialog.showOpenDialog;
      }, tempScaffoldExportDir);

      // =========================================================================================
      // POINT 1 (v2.1): Persistent Top 11-Menu Bar on Startup, Custom Icons, Ollama Boot & IDE Hub
      // =========================================================================================
      const launchHub = page.getByTestId('project-launch-hub');
      await expect(launchHub).toBeVisible({ timeout: 20000 });

      // Assert IDE Shell boots in signature Dark Pro IDE theme (`data-theme="dark"`)
      const initialIdeTheme = await page.evaluate(() => document.documentElement.dataset.theme);
      expect(initialIdeTheme).toBe('dark');

      // 1a. Verify Top 11-Menu Bar (`app-menubar`) is immediately visible & interactive ON THE STARTUP HUB!
      const appMenubar = page.getByTestId('app-menubar');
      await expect(appMenubar).toBeVisible();

      const all11Menus = [
        'menu-file',
        'menu-edit',
        'menu-selection',
        'menu-view',
        'menu-insert',
        'menu-design-css',
        'menu-logic-blueprint',
        'menu-three',
        'menu-project-export',
        'menu-ai',
        'menu-help',
      ];
      for (const mId of all11Menus) {
        await expect(page.getByTestId(mId)).toBeVisible();
      }

      // Open `AI Locale` & hover-switch to `File` directly while on Startup Hub, then close via Escape
      await page.getByTestId('menu-ai').click();
      await expect(page.getByTestId('dropdown-menu-ai')).toBeVisible();
      await page.getByTestId('menu-file').hover();
      await expect(page.getByTestId('dropdown-menu-file')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('dropdown-menu-file')).toHaveCount(0);

      // 1b. Verify Custom App Icon (`img[src*="app-icon.png"]`) loads cleanly with naturalWidth > 0
      const iconMetrics = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('img[src*="app-icon.png"]'));
        return imgs.map((img) => ({
          complete: img.complete,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
        }));
      });
      expect(iconMetrics.length).toBeGreaterThanOrEqual(2);
      for (const metric of iconMetrics) {
        expect(metric.complete).toBe(true);
        expect(metric.naturalWidth).toBeGreaterThan(0);
        expect(metric.naturalHeight).toBeGreaterThan(0);
      }

      // 1c. Verify v2.1 Preload Bridge contracts (`ensureOllamaRunning`, `generateProjectWithAi`, `askStartupAssistant`, `removeRecent`)
      const hasV21PreloadBridge = await page.evaluate(() => {
        const g = globalThis as unknown as {
          studioApi?: {
            project?: {
              createFromWizard?: unknown;
              exportBundleToDisk?: unknown;
              removeRecent?: unknown;
            };
            vfs?: { moveEntry?: unknown };
            ai?: {
              ensureOllamaRunning?: unknown;
              generateProjectWithAi?: unknown;
              askStartupAssistant?: unknown;
            };
          };
        };
        return Boolean(
          g.studioApi &&
            typeof g.studioApi.project?.createFromWizard === 'function' &&
            typeof g.studioApi.project?.exportBundleToDisk === 'function' &&
            typeof g.studioApi.project?.removeRecent === 'function' &&
            typeof g.studioApi.vfs?.moveEntry === 'function' &&
            typeof g.studioApi.ai?.ensureOllamaRunning === 'function' &&
            typeof g.studioApi.ai?.generateProjectWithAi === 'function' &&
            typeof g.studioApi.ai?.askStartupAssistant === 'function',
        );
      });
      expect(hasV21PreloadBridge).toBe(true);

      // 1d. Verify Ollama Auto-Start / Connection on Boot & Zero `*embed*` Models in Dropdown
      const ollamaPill = page.getByTestId('menubar-ollama-pill');
      const hubModelSelect = page.getByTestId('hub-ollama-model-select');
      await expect(ollamaPill).toBeVisible();
      await expect(hubModelSelect).toBeVisible();

      await expect
        .poll(
          async () => {
            const pillText = (await ollamaPill.innerText()).trim();
            return !pillText.includes('Avvio Ollama...');
          },
          { timeout: 15000 },
        )
        .toBe(true);

      const modelOptionValues = await hubModelSelect.locator('option').evaluateAll((opts) =>
        opts.map((o) => ({
          value: (o as HTMLOptionElement).value,
          label: (o.textContent || '').trim(),
        })),
      );
      expect(modelOptionValues.length).toBeGreaterThanOrEqual(1);
      for (const opt of modelOptionValues) {
        expect(opt.value.toLowerCase()).not.toContain('embed');
        expect(opt.label.toLowerCase()).not.toContain('embed');
      }

      // 1e. Verify Redesigned IDE Startup Workbench (zero marketing bloat, Left Rail, AI Architect & Recents)
      await expect(page.getByText('NOVITÀ v2.0')).toHaveCount(0);
      await expect(page.getByTestId('hub-nav-architect')).toBeVisible();
      await expect(page.getByTestId('hub-nav-recents')).toBeVisible();
      await expect(page.getByTestId('hub-nav-templates')).toBeVisible();
      await expect(page.getByTestId('hub-nav-ollama')).toBeVisible();
      await expect(page.getByTestId('hub-ai-architect-panel')).toBeVisible();
      await expect(page.getByTestId('recent-projects-section')).toBeVisible();
      await expect(page.getByTestId('btn-launch-wizard')).toBeVisible();
      await expect(page.getByTestId('btn-quick-freeform')).toBeVisible();
      await expect(page.getByTestId('btn-quick-autolayout')).toBeVisible();
      await expect(page.getByTestId('btn-quick-three-blueprint')).toBeVisible();
      await expect(page.getByTestId('btn-open-demo-project')).toBeVisible();

      // Populate AI Architect via 1-click CRM/Invoicing preset so primary CTA is armed & ready
      await page.getByTestId('hub-preset-crm').click();
      await expect(page.getByTestId('hub-ai-project-name')).toHaveValue('Gestionale Clienti Pro');
      await expect(page.getByTestId('btn-hub-ai-generate-project')).toBeEnabled();

      // Capture crisp 1600x960 v2.1 Primary Startup Workbench Screenshot
      await page.screenshot({
        path: testInfo.outputPath('v21-01-new-ide-startup-hub-ollama-menus.png'),
      });

      // 1f. Verify Left Rail Navigation: Ollama Engine View (`hub-nav-ollama`) & 26-Framework Matrix (`hub-nav-templates`)
      await page.getByTestId('hub-nav-ollama').click();
      await expect(page.getByTestId('hub-view-ollama')).toBeVisible();
      const modelsTable = page.getByTestId('hub-ollama-models-table');
      if ((await modelsTable.count()) > 0) {
        await expect(modelsTable).toBeVisible();
        const tableText = (await modelsTable.innerText()).toLowerCase();
        expect(tableText).not.toContain('nomic-embed');
      }
      await page.screenshot({
        path: testInfo.outputPath('v21-02-startup-ollama-models-and-templates.png'),
      });

      await page.getByTestId('hub-nav-templates').click();
      await expect(page.getByTestId('hub-view-templates')).toBeVisible();
      await expect(page.locator('[data-testid^="hub-template-card-"]')).toHaveCount(26);
      await page.screenshot({
        path: testInfo.outputPath('v21-03-startup-26-templates-matrix.png'),
      });

      await page.getByTestId('hub-nav-recents').click();
      await expect(page.getByTestId('hub-view-recents')).toBeVisible();

      // Return to Default 2-Column AI Architect + Recents Workbench
      await page.getByTestId('hub-nav-architect').click();
      await expect(page.getByTestId('hub-ai-architect-panel')).toBeVisible();

      // Pick fastest lightweight local model if present so live E2E chat & project generation finish swiftly
      const fastModelCandidate = modelOptionValues.find(
        (m) =>
          m.value === 'gemma:latest' ||
          m.value.startsWith('qwen2.5-coder:14b') ||
          m.value === 'offline-studio-architect-v1',
      );
      if (fastModelCandidate) {
        await hubModelSelect.selectOption(fastModelCandidate.value);
      }

      // 1g. Verify Startup Operational Chat (`hub-ai-tab-chat`)
      await page.getByTestId('hub-ai-tab-chat').click();
      await expect(page.getByTestId('hub-ai-chat-history')).toBeVisible();
      await page
        .getByTestId('hub-ai-chat-input')
        .fill('Suggerisci in una frase i componenti principali per un gestionale fatture.');
      await page.getByTestId('btn-hub-ai-chat-send').click();
      await expect(page.getByTestId('btn-chat-create-project').first()).toBeVisible({ timeout: 45000 });

      // 1h. Verify AI Project Architect Generation (`btn-hub-ai-generate-project`) -> Opens Real Multi-File Project!
      await page.getByTestId('hub-ai-tab-create').click();
      await page.getByTestId('hub-preset-crm').click();
      await page.getByTestId('btn-hub-ai-generate-project').click();

      await expect(launchHub).toHaveCount(0, { timeout: 50000 });
      await expect(page.getByTestId('workbench-shell')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('visual-canvas-sheet')).toBeVisible();

      // Return to Startup Hub via `btn-menubar-home` -> verify `btn-close-project-hub` & Recent Projects management!
      await page.getByTestId('btn-menubar-home').click();
      await expect(launchHub).toBeVisible();
      await expect(page.getByTestId('btn-close-project-hub')).toBeVisible();
      await expect(page.getByTestId('recent-projects-list')).toContainText('Gestionale Clienti Pro');

      // =========================================================================================
      // POINT 2: 5-Step Guided Project Creation Wizard (`btn-launch-wizard` -> `btn-wizard-finish`)
      // =========================================================================================
      await page.getByTestId('btn-launch-wizard').click();
      const wizardModal = page.getByTestId('guided-project-wizard');
      await expect(wizardModal).toBeVisible();

      // Step 1: Category
      await expect(page.getByTestId('wizard-step-1')).toBeVisible();
      await page.getByTestId('wizard-cat-web').click();
      await page.getByTestId('btn-wizard-next').click();

      // Step 2: Target & CSS Dialect (select HTML5 + Vanilla CSS)
      await expect(page.getByTestId('wizard-step-2')).toBeVisible();
      await page.getByTestId('wizard-toggle-all-targets').click();
      await page.getByTestId('wizard-target-html-vanilla').click();
      await page.getByTestId('wizard-dialect-vanilla-css').click();
      await page.getByTestId('btn-wizard-next').click();

      // Step 3: Freeform Layout + Starter Pages + TS Script + Blueprint + Three.js 3D
      await expect(page.getByTestId('wizard-step-3')).toBeVisible();
      await page.getByTestId('wizard-layout-freeform').click();
      await page.getByTestId('wizard-page-dashboard').click();

      await page.getByTestId('btn-wizard-next').click();

      // Step 4: Palette & Dark Theme
      await expect(page.getByTestId('wizard-step-4')).toBeVisible();
      await page.getByTestId('wizard-palette-dark-pro').click();
      await page.getByTestId('wizard-theme-dark').click();
      await page.getByTestId('btn-wizard-next').click();

      // Step 5: Project Name & Generate
      await expect(page.getByTestId('wizard-step-5')).toBeVisible();
      await page.getByTestId('wizard-input-name').fill('NovaStudio v2 Pro');
      await page.getByTestId('btn-wizard-finish').click();

      await expect(wizardModal).toHaveCount(0);
      await expect(launchHub).toHaveCount(0);
      await expect(page.getByTestId('workbench-shell')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('visual-canvas-sheet')).toBeVisible();

      // Verify multi-file Wizard VFS entries (.canvas, .css, .ts, .blueprint.json, .scene3d.json)
      await page.getByTestId('btn-vfs-expand-all').click();
      const vfsContainer = page.getByTestId('vfs-tree-container');
      await expect(vfsContainer.locator('[data-testid$=".canvas"]').first()).toBeVisible();
      await expect(vfsContainer.locator('[data-testid$=".css"]').first()).toBeVisible();
      await expect(vfsContainer.locator('[data-testid$=".ts"]').first()).toBeVisible();
      await expect(vfsContainer.locator('[data-testid$=".blueprint.json"]').first()).toBeVisible();
      await expect(vfsContainer.locator('[data-testid$=".scene3d.json"]').first()).toBeVisible();

      // =========================================================================================
      // POINT 3: Top 11-Menu Desktop Application Menu Bar & Non-Overlapping 1600px Header
      // =========================================================================================
      await expect(appMenubar).toBeVisible();
      for (const mId of all11Menus) {
        await expect(page.getByTestId(mId)).toBeVisible();
      }

      // Assert Top Header Bar controls do NOT overlap horizontally & fit inside 1600px viewport
      const orderedHeaderTestIds = [
        'btn-header-new-project',
        'btn-header-link-folder',
        'btn-open-import-code',
        'btn-open-a11y-audit',
        'preset-canvas-only',
        'preset-split-css',
        'preset-split-code',
        'preset-split-blueprint',
        'preset-split-script',
        'preset-three-studio',
        'preset-split-preview',
        'btn-header-undo',
        'btn-header-redo',
        'bp-desktop',
        'bp-tablet',
        'bp-mobile',
        'bp-desktop-window',
        'global-target-select',
        'btn-theme-toggle',
        'btn-toggle-right-dock',
      ];
      const headerBoxes: Array<{ id: string; x: number; y: number; width: number; height: number }> = [];
      for (const tid of orderedHeaderTestIds) {
        const loc = page.getByTestId(tid);
        await expect(loc).toBeVisible();
        const box = await loc.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x + box!.width).toBeLessThanOrEqual(1600.5);
        headerBoxes.push({ id: tid, ...box! });
      }
      for (let i = 0; i < headerBoxes.length - 1; i++) {
        const left = headerBoxes[i];
        const right = headerBoxes[i + 1];
        expect(
          left.x + left.width,
          `Header control "${left.id}" must not overlap "${right.id}"`,
        ).toBeLessThanOrEqual(right.x + 1.5);
      }

      // Open `File` menu -> execute `Salva Tutto`
      await page.getByTestId('menu-file').click();
      await expect(page.getByTestId('dropdown-menu-file')).toBeVisible();
      await page.getByTestId('menu-item-save-all').click();
      await expect(page.getByTestId('dropdown-menu-file')).toHaveCount(0);

      // Open `Visualizza` menu -> trigger `Mostra/Nascondi Console Inferiore` and close it back
      await page.getByTestId('menu-view').click();
      await expect(page.getByTestId('dropdown-menu-view')).toBeVisible();
      await page.getByTestId('menu-item-toggle-console').click();
      await expect(page.getByTestId('bottom-console-drawer')).toBeVisible();
      await page.getByTestId('btn-close-console').click();

      // Open `Logica & Blueprint` menu -> trigger `Apri Editor Grafo Blueprint`
      await page.getByTestId('menu-logic-blueprint').click();
      await expect(page.getByTestId('dropdown-menu-logic-blueprint')).toBeVisible();
      await page.getByTestId('menu-item-open-blueprint').click();
      await expect(page.getByTestId('blueprint-editor-view')).toBeVisible();

      // Open `Scena 3D` menu -> trigger `Apri Three.js 3D Studio` then return to `Solo Design Canvas` via `Visualizza`
      await page.getByTestId('menu-three').click();
      await expect(page.getByTestId('dropdown-menu-three')).toBeVisible();
      await page.getByTestId('menu-item-open-three-studio').click();
      await expect(page.getByTestId('three-studio-view')).toBeVisible();

      await page.getByTestId('menu-view').click();
      await page.getByTestId('menu-item-view-canvas').click();
      await expect(page.getByTestId('visual-canvas-sheet')).toBeVisible();

      // =========================================================================================
      // POINT 4: True VS Code File Explorer & Interactive Breadcrumb Path Bar
      // =========================================================================================
      const leftSidebar = page.getByTestId('left-permanent-sidebar');
      await expect(leftSidebar).toBeVisible();
      const breadcrumbBar = page.getByTestId('vfs-breadcrumb-bar');
      await expect(breadcrumbBar).toBeVisible();

      // Select `src` folder -> verify `src` appears in Breadcrumb -> create nested subfolder `widgets` inside `src`
      await page.getByTestId('vfs-item-src').click();
      await expect(page.getByTestId('vfs-breadcrumb-seg-src')).toBeVisible();

      await page.getByTestId('btn-new-folder').click();
      await page.getByTestId('input-create-vfs-name').fill('widgets');
      await page.getByTestId('btn-confirm-create-vfs').click();
      await expect(page.getByTestId('vfs-item-widgets')).toBeVisible();

      // Click nested `widgets` -> verify breadcrumb shows `/ src / widgets`!
      await page.getByTestId('vfs-item-widgets').click();
      await expect(page.getByTestId('vfs-breadcrumb-seg-src')).toBeVisible();
      await expect(page.getByTestId('vfs-breadcrumb-seg-widgets')).toBeVisible();

      // Navigate up via `btn-vfs-up-level` -> back to `src`, then collapse & re-expand `src` chevron
      await page.getByTestId('btn-vfs-up-level').click();
      await expect(page.getByTestId('vfs-breadcrumb-seg-widgets')).toHaveCount(0);
      await expect(page.getByTestId('vfs-breadcrumb-seg-src')).toBeVisible();

      await page.getByTestId('vfs-chevron-src').click();
      await expect(page.getByTestId('vfs-item-widgets')).toHaveCount(0);
      await page.getByTestId('vfs-chevron-src').click();
      await expect(page.getByTestId('vfs-item-widgets')).toBeVisible();

      // Navigate to root via Breadcrumb root pill
      await page.getByTestId('vfs-breadcrumb-root').click();
      await expect(page.getByTestId('vfs-breadcrumb-seg-src')).toHaveCount(0);

      // =========================================================================================
      // POINT 5: Real Freeform Canvas Positioning (Exact `(X, Y)` Insert + Real Mouse Drag-Move)
      // =========================================================================================
      await expect(page.getByTestId('canvas-tool-strip')).toBeVisible();
      await expect(page.getByTestId('canvas-ruler-top')).toBeVisible();
      await expect(page.getByTestId('canvas-ruler-left')).toBeVisible();

      // 5a. Use Direct Figma Drawing Tool (`tool-btn-button`) to draw a Button at an exact `(x, y)` region on the Artboard
      await page.getByTestId('tool-btn-button').click();
      const rootArtboardLocator = page.locator('[data-canvas-node-id]').first();
      const artboardBox = await rootArtboardLocator.boundingBox();
      expect(artboardBox).not.toBeNull();

      const drawStartX = Math.round(artboardBox!.x + 120);
      const drawStartY = Math.round(artboardBox!.y + 440);
      await page.mouse.move(drawStartX, drawStartY);
      await page.mouse.down();
      await page.mouse.move(drawStartX + 184, drawStartY + 48, { steps: 8 });
      await page.mouse.up();

      // Find the newly drawn ActionButton (`Nuovo Bottone`) on the Canvas
      const drawnButton = page
        .locator('[data-testid^="canvas-node-"]', { hasText: 'Nuovo Bottone' })
        .last();
      await expect(drawnButton).toBeVisible();

      const boxBeforeDrag = await drawnButton.boundingBox();
      expect(boxBeforeDrag).not.toBeNull();

      // 5b. Real Mouse Drag-Move of existing element from `(x1, y1)` to `(x1 + 160, y1 + 64)`!
      const startCenterX = Math.round(boxBeforeDrag!.x + boxBeforeDrag!.width / 2);
      const startCenterY = Math.round(boxBeforeDrag!.y + boxBeforeDrag!.height / 2);
      const targetCenterX = startCenterX + 160;
      const targetCenterY = startCenterY + 64;

      await page.mouse.move(startCenterX, startCenterY);
      await page.mouse.down();
      await page.mouse.move(targetCenterX, targetCenterY, { steps: 14 });
      await page.mouse.up();

      const boxAfterDrag = await drawnButton.boundingBox();
      expect(boxAfterDrag).not.toBeNull();
      expect(
        Math.abs(boxAfterDrag!.x - boxBeforeDrag!.x),
        `Dragged button boundingBox.x must move by >80px (before=${boxBeforeDrag!.x}, after=${boxAfterDrag!.x})`,
      ).toBeGreaterThan(80);
      expect(Math.abs(boxAfterDrag!.y - boxBeforeDrag!.y)).toBeGreaterThan(30);

      // =========================================================================================
      // POINT 6: `Design <-> CSS` Bidirectional Live Editor (`preset-split-css`)
      // =========================================================================================
      await page.getByTestId('preset-split-css').click();
      const cssEditor = page.getByTestId('css-live-editor');
      await expect(cssEditor).toBeVisible();

      // Switch to Selected Element scope & edit CSS property (`background-color` + `border-radius`) -> verify Canvas node updates!
      await drawnButton.click();
      const drawnNodeTestId = await drawnButton.getAttribute('data-testid');
      const drawnNodeId = (drawnNodeTestId ?? '').replace('canvas-node-', '');
      expect(drawnNodeId.length).toBeGreaterThan(2);

      await page.getByTestId('css-scope-selected').click();
      const cssTextarea = page.getByTestId('css-editor-textarea');
      await expect(cssTextarea).toHaveValue(new RegExp(drawnNodeId));
      await expect(cssTextarea).not.toHaveValue(/:root/);
      const initialSelectedCss = await cssTextarea.inputValue();
      const updatedCss = initialSelectedCss
        .replace(/background:\s*[^;]+;/, 'background: #10b981;')
        .replace(/border-radius:\s*[^;]+;/, 'border-radius: 24px;');
      await cssTextarea.fill(updatedCss);
      await page.getByTestId('btn-apply-css').click();

      await expect(drawnButton).toHaveCSS('border-radius', '24px');
      await expect(drawnButton).toHaveCSS('background-color', 'rgb(16, 185, 129)');

      // Switch to Full Sheet CSS (`css-scope-sheet`) and click a CSS gutter line for a DIFFERENT element -> verify Canvas selection syncs!
      await page.getByTestId('css-scope-sheet').click();
      await expect(cssTextarea).toHaveValue(/:root/);
      const fullCssText = await cssTextarea.inputValue();
      const fullCssLines = fullCssText.split('\n');
      let otherRuleLine = -1;
      for (let idx = 0; idx < fullCssLines.length; idx++) {
        const m = fullCssLines[idx].match(/\/\*\s*@node\s+([a-zA-Z0-9_-]+)/);
        if (m && m[1] !== drawnNodeId && !m[1].startsWith('art_')) {
          otherRuleLine = idx + 2; // selector line right below `@node` comment
          break;
        }
      }
      expect(otherRuleLine).toBeGreaterThan(0);
      await page.getByTestId(`css-gutter-line-${otherRuleLine}`).click();
      await expect(page.getByTestId('canvas-code-pulse-badge')).toBeVisible();

      // =========================================================================================
      // POINT 7: Side-by-Side `Design + Code` + Resizable Sash + HTML5/Svelte5 + Bidirectional Click
      // =========================================================================================
      await page.getByTestId('preset-split-code').click();
      const group1 = page.getByTestId('editor-group-1');
      const group2 = page.getByTestId('editor-group-2');
      const splitSash = page.getByTestId('editor-split-sash');
      await expect(group1).toBeVisible();
      await expect(group2).toBeVisible();
      await expect(splitSash).toBeVisible();
      await expect(page.getByTestId('live-code-sheet')).toBeVisible();

      // 7a. Drag `editor-split-sash` horizontally by -110px and assert `editor-group-1` actually resizes!
      const group1Before = await group1.boundingBox();
      const sashBox = await splitSash.boundingBox();
      expect(group1Before).not.toBeNull();
      expect(sashBox).not.toBeNull();

      await page.mouse.move(sashBox!.x + sashBox!.width / 2, sashBox!.y + sashBox!.height / 2);
      await page.mouse.down();
      await page.mouse.move(sashBox!.x - 110, sashBox!.y + sashBox!.height / 2, { steps: 10 });
      await page.mouse.up();

      const group1After = await group1.boundingBox();
      expect(group1After).not.toBeNull();
      expect(group1Before!.width - group1After!.width).toBeGreaterThan(60);

      // Double-click sash to restore balanced 50/50 split
      await splitSash.dblclick();

      const codeTargetSelect = page.getByTestId('code-target-select');
      const codeOutput = page.getByTestId('code-viewer-output');
      await expect(codeTargetSelect.locator('option')).toHaveCount(26);

      // 7b. Verify `HTML5 + CSS3 + JS` (`html-vanilla`) emits authentic HTML5 (NO React JSX `export function` or `className=`)!
      await codeTargetSelect.selectOption('html-vanilla');
      await expect(codeOutput).toContainText('<!DOCTYPE html>', { timeout: 10000 });
      const html5Code = await codeOutput.innerText();
      expect(html5Code).not.toContain('export function');
      expect(html5Code).not.toContain('className=');
      expect(html5Code).toContain('Nuovo Bottone');

      // 7c. Bidirectional Click Highlight:
      await drawnButton.click();
      await expect(codeOutput.locator('.code-line.highlighted').first()).toBeVisible();
      const highlightedForButton = await codeOutput.locator('.code-line.highlighted').allInnerTexts();
      expect(highlightedForButton.join('\n')).toContain('Nuovo Bottone');

      const nonHighlightedButtonOrHeadingLine = codeOutput
        .locator('.code-line:not(.highlighted)', { hasText: /<h1|<h2|<p|<header/ })
        .first();
      if ((await nonHighlightedButtonOrHeadingLine.count()) > 0) {
        await nonHighlightedButtonOrHeadingLine.click();
        await expect(page.getByTestId('canvas-code-pulse-badge')).toBeVisible();
      }

      // 7d. Verify `Svelte 5` (`svelte5`) emits authentic Svelte 5 Runes (NO React `import React` or `className=`)!
      await codeTargetSelect.selectOption('svelte5');
      await expect(codeOutput).toContainText('<script lang="ts">', { timeout: 10000 });
      const svelteCode = await codeOutput.innerText();
      expect(svelteCode).not.toContain('className=');
      expect(svelteCode).not.toContain('export function');

      // Quick regression sweep across React 19, .NET MAUI, LVGL 9, and Blazor Disk Scaffold Export
      await codeTargetSelect.selectOption('react-tsx');
      await expect(codeOutput).toContainText('export function', { timeout: 10000 });
      expect(await codeOutput.innerText()).not.toContain('void ');

      await codeTargetSelect.selectOption('dotnet-maui');
      await expect(codeOutput).toContainText('ContentPage', { timeout: 10000 });

      await codeTargetSelect.selectOption('lvgl-c');
      await expect(page.getByTestId('bundle-files-switcher')).toContainText('ui_screen.c', {
        timeout: 10000,
      });

      await codeTargetSelect.selectOption('blazor-razor');
      await expect(codeOutput).toContainText('@page', { timeout: 10000 });
      await page.getByTestId('btn-export-scaffold').click();
      await expect(page.getByTestId('toast-viewport')).toContainText('Progetto blazor-razor esportato', {
        timeout: 10000,
      });
      const exportedEntries = readdirSync(tempScaffoldExportDir);
      expect(exportedEntries.length).toBeGreaterThanOrEqual(1);

      // =========================================================================================
      // POINT 8: JS / TS Script Logic Workbench (`preset-split-script` -> `script-workbench-view`)
      // =========================================================================================
      await drawnButton.click();
      await page.getByTestId('preset-split-script').click();
      const scriptWorkbench = page.getByTestId('script-workbench-view');
      await expect(scriptWorkbench).toBeVisible();
      await expect(page.getByTestId('script-ts-editor')).toBeVisible();
      await expect(page.getByTestId('script-transpiled-js-preview')).toBeVisible();

      // Bind TS click function to selected Canvas element & run live script test -> verify Console log output!
      await page.getByTestId('btn-bind-selected-element').click();
      await page.getByTestId('btn-run-script').click();

      const bottomConsole = page.getByTestId('bottom-console-drawer');
      await expect(bottomConsole).toBeVisible();
      await expect(page.getByTestId('console-log-list')).toContainText('Script', { timeout: 10000 });

      // =========================================================================================
      // POINT 9: Unreal Engine-Style Card & Wire Blueprint Editor (`preset-split-blueprint`)
      // =========================================================================================
      await page.getByTestId('preset-split-blueprint').click();
      const blueprintEditor = page.getByTestId('blueprint-editor-view');
      await expect(blueprintEditor).toBeVisible();

      // Verify Blueprint cards and SVG cubic Bezier wires (`M ... C ...`)
      const bpCards = blueprintEditor.locator('[data-testid^="blueprint-node-"]');
      const initialCardCount = await bpCards.count();
      expect(initialCardCount).toBeGreaterThanOrEqual(2);

      const firstWire = blueprintEditor.locator('[data-testid^="blueprint-wire-"]').first();
      await expect(firstWire).toBeVisible();
      const wirePathD = await firstWire.getAttribute('d');
      expect(wirePathD).toMatch(/^M\s+[-\d.]+\s+[-\d.]+\s+C\s+/);

      // Add a new Blueprint card from the Unreal node palette
      await page.getByTestId('btn-add-blueprint-node').click();
      await expect(page.getByTestId('blueprint-node-palette')).toBeVisible();
      await page.getByTestId('btn-spawn-bp-ui_show_toast').click();
      await expect(bpCards).toHaveCount(initialCardCount + 1);

      // Toggle compiled TypeScript split drawer, fit graph view & run live Blueprint simulation
      await page.getByTestId('btn-toggle-blueprint-code').click();
      const bpCodeDrawer = page.getByTestId('blueprint-code-drawer');
      await expect(bpCodeDrawer).toBeVisible();
      await expect(bpCodeDrawer).toContainText('StudioRuntimeContext');
      await page.getByTestId('btn-fit-blueprint-view').click();

      await page.getByTestId('btn-run-blueprint-sim').click();
      await expect(page.getByTestId('console-log-list')).toContainText('Blueprint', { timeout: 10000 });
      await page.getByTestId('btn-close-console').click();

      // =========================================================================================
      // POINT 10: Three.js 3D Visual Studio (`preset-three-studio` -> `three-studio-view`)
      // =========================================================================================
      await page.getByTestId('preset-three-studio').click();
      const threeStudio = page.getByTestId('three-studio-view');
      await expect(threeStudio).toBeVisible();
      await expect(page.getByTestId('three-viewport-stage')).toBeVisible();
      await expect(page.getByTestId('three-outliner')).toBeVisible();
      await expect(page.getByTestId('three-inspector')).toBeVisible();
      await expect(page.getByTestId('three-code-panel')).toBeVisible();

      const outlinerItems = page.getByTestId('three-outliner').locator('[data-testid^="three-outliner-item-"]');
      const countBeforeAdd3D = await outlinerItems.count();

      // Add a 3D TorusKnot geometry & inspect generated Vanilla Three.js + React Three Fiber code
      await page.getByTestId('btn-add-3d-torusKnot').click();
      await expect(outlinerItems).toHaveCount(countBeforeAdd3D + 1);
      await expect(page.getByTestId('three-code-output')).toContainText('TorusKnotGeometry');

      await page.getByTestId('three-code-format-select').selectOption('r3f-tsx');
      await expect(page.getByTestId('three-code-output')).toContainText('@react-three/fiber');
      await expect(page.getByTestId('three-code-output')).toContainText('<Canvas');

      // Embed 3D scene directly into the active 2D Visual Canvas sheet!
      await page.getByTestId('btn-embed-three-in-canvas').click();

      // =========================================================================================
      // POINT 11: Embedded 3D Viewport in 2D Canvas + Live Preview + WCAG + Local AI + Unsloth
      // =========================================================================================
      await page.getByTestId('preset-split-preview').click();
      await expect(page.getByTestId('visual-canvas-sheet')).toBeVisible();
      await expect(page.getByTestId('three-embedded-preview').first()).toBeVisible();
      await expect(page.getByTestId('live-sandbox-preview')).toBeVisible();
      await expect(page.getByTestId('sandbox-preview-iframe')).toBeVisible();

      // Verify Code Importer & WCAG 2.2 Auditor Modal
      await page.getByTestId('btn-open-a11y-audit').click();
      await expect(page.getByTestId('a11y-audit-modal')).toBeVisible();
      await expect(page.getByTestId('a11y-health-score')).toBeVisible();
      await page.getByTestId('btn-close-a11y-audit').click();

      // Verify Right Agentic Coding Panel: Offline AI Canvas Mutation + Pre-AI SQLite Checkpoint
      await page.getByTestId('right-mode-agent').click();
      await expect(page.getByTestId('agentic-coding-panel')).toBeVisible();
      await page.getByTestId('ai-provider-select').selectOption('builtin_offline');
      await page.getByTestId('ai-mode-prompt_to_ui').click();
      await page.getByTestId('ai-prompt-input').fill('Aggiungi sezione KPI con CTA');
      await page.getByTestId('btn-send-ai-prompt').click();
      await expect(page.getByTestId('tool-badge-mutate_canvas_nodes').first()).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByTestId('btn-restore-checkpoint').last()).toBeVisible();

      // Verify Unsloth LoRA Dataset Exporter
      await page.getByTestId('btn-open-unsloth').click();
      const unslothModal = page.getByTestId('unsloth-hub-modal');
      await expect(unslothModal).toBeVisible();
      await page.getByTestId('unsloth-tab-dataset').click();
      await page.getByTestId('btn-export-unsloth-dataset').click();
      const exportResultBox = page.getByTestId('unsloth-export-result');
      await expect(exportResultBox).toBeVisible({ timeout: 10000 });
      const codePaths = await exportResultBox.locator('code').allTextContents();
      expect(codePaths.length).toBeGreaterThanOrEqual(3);
      expect(readFileSync(codePaths[1].trim(), 'utf-8')).toContain('FastLanguageModel');
      await page.getByTestId('btn-close-unsloth').click();

      // =========================================================================================
      // POINT 12: Zero Runtime Page Errors & Zero Console Errors Gate
      // =========================================================================================
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
    } finally {
      await electronApp.close();
      try {
        rmSync(tempStudioDataDir, { recursive: true, force: true });
        rmSync(tempScaffoldExportDir, { recursive: true, force: true });
      } catch {
        // Ignore Windows file-handle release race on temp cleanup
      }
    }
  });
});
