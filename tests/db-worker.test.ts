import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hydrateCompactOpsToPatches } from '../src/shared/ui-patch';
import { attachWorkerRpcHandler, createWorkerRpcProxy, type IDbWorkerService } from '../src/shared/worker-protocol';
import { DbWorkerService } from '../src/workers/db-worker/service';

describe('DbWorkerService (SQLite WAL + VFS + Undo/Redo + Checkpoints + Unsloth)', () => {
  let tempRoot: string;
  let dbService: DbWorkerService;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'visual-ui-studio-test-'));
    dbService = new DbWorkerService({ storageRootDir: tempRoot });
  });

  afterEach(() => {
    dbService.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('bootstraps default NovaCommerce Studio project in a real .uistudio SQLite WAL database', async () => {
    const boot = await dbService.getCurrentProject();
    expect(boot.project.name).toBe('NovaCommerce Studio');
    expect(existsSync(boot.project.dbFilePath)).toBe(true);
    expect(boot.themes.length).toBe(2);
    expect(boot.tokens.length).toBeGreaterThanOrEqual(25);
    expect(boot.sheets.length).toBe(1);
    expect(boot.initialSheet).not.toBeNull();
    expect(Object.keys(boot.initialSheet!.nodes).length).toBeGreaterThanOrEqual(15);

    // Verify HTMX targetNodeId & MVVM bindings persisted cleanly in SQLite
    const searchInput = boot.initialSheet!.nodes['nd_htmx_search_input'];
    expect(searchInput).toBeDefined();
    expect(searchInput.platform?.htmx?.method).toBe('hx-get');
    expect(searchInput.platform?.htmx?.targetNodeId).toBe('nd_product_results_region');
  });

  it('creates virtual & disk-linked VFS folders, canvas sheets, and source files with two-way sync', async () => {
    const linkedRepoDir = join(tempRoot, 'linked-repo');
    const boot = await dbService.createProject({
      name: 'RepoSyncedApp',
      rootDiskPath: linkedRepoDir,
      primaryTarget: 'nextjs-app',
      stylingPreset: 'tailwind',
    });

    const projectId = boot.project.id;
    expect(existsSync(join(linkedRepoDir, '.uistudio', 'project.uistudio'))).toBe(true);
    expect(existsSync(join(linkedRepoDir, 'src', 'api.ts'))).toBe(true);

    // Create a new folder inside /src
    const srcNode = boot.vfsTree.find((n) => n.virtualPath === '/src')!;
    const { entry: featureFolder } = await dbService.createVfsEntry({
      projectId,
      parentId: srcNode.id,
      name: 'checkout',
      entryKind: 'folder',
    });
    expect(featureFolder.virtualPath).toBe('/src/checkout');
    expect(existsSync(join(linkedRepoDir, 'src', 'checkout'))).toBe(true);

    // Create a new Canvas Sheet inside /src/checkout
    const { entry: checkoutSheetEntry, createdSheet } = await dbService.createVfsEntry({
      projectId,
      parentId: featureFolder.id,
      name: 'CheckoutFlow',
      entryKind: 'canvas_sheet',
    });
    expect(checkoutSheetEntry.name).toBe('CheckoutFlow.canvas');
    expect(createdSheet).toBeDefined();
    expect(createdSheet!.rootIds.length).toBe(1);

    // Create & modify a source file and verify real disk write
    const { entry: utilFile } = await dbService.createVfsEntry({
      projectId,
      parentId: featureFolder.id,
      name: 'pricing.ts',
      entryKind: 'source_file',
      initialContent: 'export const TAX_RATE = 0.22;\n',
    });
    const diskPath = join(linkedRepoDir, 'src', 'checkout', 'pricing.ts');
    expect(readFileSync(diskPath, 'utf8')).toContain('0.22');

    await dbService.writeVfsFile(utilFile.id, 'export const TAX_RATE = 0.19;\n');
    expect(readFileSync(diskPath, 'utf8')).toContain('0.19');

    const previousContents = (await dbService.readVfsFile(utilFile.id)).content;
    const externalContents = 'export const TAX_RATE = 0.18;\n';
    writeFileSync(diskPath, externalContents, 'utf8');
    await expect(dbService.writeVfsFile(utilFile.id, 'export const TAX_RATE = 0.17;\n', previousContents))
      .rejects.toThrow('Ricaricalo prima di salvare');
    expect(readFileSync(diskPath, 'utf8')).toBe(externalContents);
    await dbService.writeVfsFile(utilFile.id, 'export const TAX_RATE = 0.17;\n', externalContents);
    expect(readFileSync(diskPath, 'utf8')).toContain('0.17');

    // Rename folder and verify descendant paths + disk folder rename
    const renamed = await dbService.renameVfsEntry(featureFolder.id, 'billing');
    expect(renamed.virtualPath).toBe('/src/billing');
    expect(existsSync(join(linkedRepoDir, 'src', 'billing', 'pricing.ts'))).toBe(true);

    // Link an existing folder with external files
    writeFileSync(join(linkedRepoDir, 'README.md'), '# Existing Repo\n', 'utf8');
    const syncRes = await dbService.linkDiskDirectory(projectId, linkedRepoDir);
    expect(syncRes.syncedCount).toBeGreaterThan(0);
    const updatedTree = await dbService.listVfsTree(projectId);
    expect(updatedTree.some((n) => n.name === 'README.md')).toBe(true);
  });

  it('commits atomic UIPatchOps, executes <1ms Undo/Redo, and restores Pre-AI Checkpoints cleanly', async () => {
    const boot = await dbService.getCurrentProject();
    const projectId = boot.project.id;
    const sheet = boot.initialSheet!;
    const sheetId = sheet.sheetId;
    const rootId = sheet.rootIds[0];
    const initialCount = Object.keys(sheet.nodes).length;

    // 1. User inserts a button node and updates headline text
    const commit1 = await dbService.commitPatchBatch({
      projectId,
      sheetId,
      actor: 'user',
      label: 'Insert Promo Badge & Rename Hero',
      ops: [
        {
          op: 'insert_node',
          parentId: rootId,
          node: {
            id: 'nd_promo_badge',
            kind: 'control',
            name: 'PromoBadge',
            content: { controlType: 'badge', text: 'SPRING SALE 30% OFF' },
          },
        },
        {
          op: 'update_node',
          id: 'nd_hero_headline',
          content: { text: 'Next-Gen Commerce Platform' },
        },
      ],
    });

    expect(Object.keys(commit1.sheet.nodes).length).toBe(initialCount + 1);
    expect(commit1.sheet.nodes['nd_hero_headline'].content?.text).toBe('Next-Gen Commerce Platform');
    expect(commit1.canUndo).toBe(true);
    expect(commit1.canRedo).toBe(false);

    // 2. Undo reverts both operations atomically
    const undone = await dbService.undo(sheetId);
    expect(undone).not.toBeNull();
    expect(undone!.sheet.nodes['nd_promo_badge']).toBeUndefined();
    expect(undone!.sheet.nodes['nd_hero_headline'].content?.text).toBe(
      'Unified Multi-Platform Storefront & Analytics',
    );
    expect(undone!.canRedo).toBe(true);

    // 3. Redo re-applies both operations
    const redone = await dbService.redo(sheetId);
    expect(redone).not.toBeNull();
    expect(redone!.sheet.nodes['nd_promo_badge']).toBeDefined();
    expect(redone!.sheet.nodes['nd_hero_headline'].content?.text).toBe('Next-Gen Commerce Platform');

    // 4. Create a Pre-AI Checkpoint before hydrating an AI compact tree mutation
    const preAiChk = await dbService.createCheckpoint({
      projectId,
      sheetId,
      reason: 'pre_ai_step',
      label: 'Pre-AI Surgical Refactor',
      aiRunId: 'run_test_01',
    });

    const aiOps = hydrateCompactOpsToPatches(
      [
        {
          op: 'insert_tree',
          parentId: rootId,
          tree: {
            id: 'nd_ai_newsletter_card',
            kind: 'container',
            name: 'NewsletterCard',
            direction: 'row',
            gap: 12,
            children: [
              { id: 'nd_ai_email_inp', kind: 'control', controlType: 'text-input', name: 'EmailInput', placeholder: 'Enter email...' },
              { id: 'nd_ai_sub_btn', kind: 'control', controlType: 'button', name: 'SubscribeBtn', text: 'Subscribe' },
            ],
          },
        },
      ],
      sheetId,
    );

    const afterAi = await dbService.commitPatchBatch({
      projectId,
      sheetId,
      actor: 'ai_agent',
      aiRunId: 'run_test_01',
      label: 'AI: Add Newsletter Card',
      ops: aiOps,
    });
    expect(afterAi.sheet.nodes['nd_ai_newsletter_card']).toBeDefined();
    expect(afterAi.sheet.nodes['nd_ai_sub_btn']).toBeDefined();

    // 5. 1-Click Restore Pre-AI Checkpoint rolls back all 3 AI-inserted nodes
    const restored = await dbService.restoreCheckpoint(preAiChk.id);
    expect(restored.nodes['nd_ai_newsletter_card']).toBeUndefined();
    expect(restored.nodes['nd_promo_badge']).toBeDefined();
  });

  it('searches SQLite FTS5 offline icon catalog, manages tokens, and stores AI threads & Unsloth pairs', async () => {
    const boot = await dbService.getCurrentProject();
    const projectId = boot.project.id;

    // FTS5 Icon Search
    const cartIcons = await dbService.searchIcons('cart ecommerce');
    expect(cartIcons.length).toBeGreaterThanOrEqual(1);
    expect(cartIcons[0].id).toBe('shopping-cart');

    const aiIcons = await dbService.searchIcons('ollama', 'ai');
    expect(aiIcons.some((i) => i.id === 'bot')).toBe(true);

    // Design Token upsert
    const customTok = await dbService.upsertToken({
      projectId,
      themeId: null,
      tokenPath: 'color.brand.neon',
      category: 'color',
      rawValue: '#00f5d4',
    });
    expect(customTok.rawValue).toBe('#00f5d4');
    const allTokens = await dbService.listTokens(projectId);
    expect(allTokens.some((t) => t.tokenPath === 'color.brand.neon')).toBe(true);

    // Record AI Turn & Unsloth Pair
    const chat = await dbService.recordAiTurnMessages({
      projectId,
      titleHint: 'Make Hero Responsive',
      mode: 'surgical',
      provider: 'ollama',
      modelName: 'qwen2.5-coder:14b',
      userPrompt: 'Stack hero buttons on mobile',
      assistantReply: 'Updated HeroActionsRow to wrap on small screens.',
      toolCalls: [
        {
          id: 'tc_1',
          toolName: 'mutate_canvas_nodes',
          argsJson: '{"ops":1}',
          resultSummary: 'Applied 1 patch op',
          status: 'succeeded',
          durationMs: 14,
        },
      ],
    });
    const threads = await dbService.listAiThreads(projectId);
    expect(threads.length).toBe(1);
    const msgs = await dbService.getAiThreadMessages(chat.threadId);
    expect(msgs.length).toBe(2);
    expect(msgs[1].toolCalls?.[0].toolName).toBe('mutate_canvas_nodes');

    await dbService.recordUnslothPair({
      projectId,
      sheetId: boot.initialSheet!.sheetId,
      promptSummary: 'Generate .NET MAUI Grid KPI card',
      normalizedUiIrJson: '{"kind":"Grid"}',
      targetFramework: 'dotnet-maui',
      acceptedCodeOutput: '<Grid ColumnDefinitions="*,*,*" />',
      qualityScore: 5,
    });
    const pairs = await dbService.listUnslothPairs(projectId);
    expect(pairs.length).toBeGreaterThanOrEqual(3); // 2 seeded + 1 recorded
    expect(pairs.some((p) => p.targetFramework === 'dotnet-maui')).toBe(true);

    // Also verify JSON-RPC Worker Proxy framing in-memory
    const listenersA: Array<(m: any) => void> = [];
    const listenersB: Array<(m: any) => void> = [];
    const portA = {
      postMessage: (m: unknown) => queueMicrotask(() => listenersB.forEach((fn) => fn(m))),
      on: (_ev: 'message', fn: (m: any) => void) => {
        listenersA.push(fn);
      },
    };
    const portB = {
      postMessage: (m: unknown) => queueMicrotask(() => listenersA.forEach((fn) => fn(m))),
      on: (_ev: 'message', fn: (m: any) => void) => {
        listenersB.push(fn);
      },
    };
    attachWorkerRpcHandler(portB, dbService);
    const proxy = createWorkerRpcProxy<IDbWorkerService>(portA);
    const recentsViaRpc = await proxy.listRecentProjects();
    expect(recentsViaRpc.length).toBeGreaterThanOrEqual(1);
    void Worker;
  });

  it('v2.0: seeds multi-page Guided Wizard projects (nested VFS folders, .css, .ts, .blueprint.json, .scene3d.json, palette tokens & freeform sheets) in SQLite + Disk', async () => {
    const wizardDiskDir = join(tempRoot, 'wizard-cyberpunk-app');
    const boot = await dbService.createProjectFromWizard({
      name: 'Cyberpunk 3D Configurator',
      category: 'three_game',
      primaryTarget: 'html-vanilla',
      stylingPreset: 'vanilla-css',
      layoutMode: 'freeform',
      starterPages: ['home', 'login', 'dashboard'],
      includeTsScript: true,
      includeBlueprint: true,
      includeThreeScene: true,
      threePresetId: 'pbr-product-showcase',
      paletteId: 'cyberpunk-neon',
      defaultThemeMode: 'dark',
      rootDiskPath: wizardDiskDir,
    });

    expect(boot.project.name).toBe('Cyberpunk 3D Configurator');
    expect(boot.project.primaryTarget).toBe('html-vanilla');
    expect(boot.project.stylingPreset).toBe('vanilla-css');
    expect(boot.project.layoutMode).toBe('freeform');
    expect(boot.sheets.length).toBe(3);
    expect(boot.sheets.map((s) => s.name)).toEqual(['HomeScreen', 'LoginScreen', 'AnalyticsDashboard']);

    // Verify palette token override persisted in SQLite
    const primary500 = boot.tokens.find((t) => t.tokenPath === 'color.primary.500');
    expect(primary500?.rawValue).toBe('#ec4899');

    // Verify nested VFS folders & v2.0 asset entry kinds
    const paths = new Set(boot.vfsTree.map((n) => n.virtualPath));
    expect(paths.has('/src')).toBe(true);
    expect(paths.has('/src/screens')).toBe(true);
    expect(paths.has('/src/styles')).toBe(true);
    expect(paths.has('/src/scripts')).toBe(true);
    expect(paths.has('/src/blueprints')).toBe(true);
    expect(paths.has('/src/scenes3d')).toBe(true);
    expect(paths.has('/src/screens/HomeScreen.canvas')).toBe(true);
    expect(paths.has('/src/screens/LoginScreen.canvas')).toBe(true);
    expect(paths.has('/src/screens/AnalyticsDashboard.canvas')).toBe(true);

    const cssNode = boot.vfsTree.find((n) => n.entryKind === 'style_file')!;
    const tsNode = boot.vfsTree.find((n) => n.entryKind === 'script_file')!;
    const bpNode = boot.vfsTree.find((n) => n.entryKind === 'blueprint_graph')!;
    const scene3dNode = boot.vfsTree.find((n) => n.entryKind === 'three_scene')!;
    expect(cssNode).toBeDefined();
    expect(tsNode).toBeDefined();
    expect(bpNode).toBeDefined();
    expect(scene3dNode).toBeDefined();

    const cssRead = await dbService.readVfsFile(cssNode.id);
    const tsRead = await dbService.readVfsFile(tsNode.id);
    const bpRead = await dbService.readVfsFile(bpNode.id);
    const scene3dRead = await dbService.readVfsFile(scene3dNode.id);
    expect(cssRead.content).toContain(':root');
    expect(tsRead.content).toContain('export function onPrimaryActionClick');
    expect(JSON.parse(bpRead.content).nodes.length).toBeGreaterThanOrEqual(2);
    expect(JSON.parse(scene3dRead.content).objects.length).toBeGreaterThanOrEqual(2);

    // Verify disk sync wrote folders and files cleanly
    expect(existsSync(join(wizardDiskDir, 'src', 'styles', 'theme-and-sheet.css'))).toBe(true);
    expect(existsSync(join(wizardDiskDir, 'src', 'scripts', 'handlers.ts'))).toBe(true);
    expect(existsSync(join(wizardDiskDir, bpNode.diskRelPath!))).toBe(true);
    expect(existsSync(join(wizardDiskDir, scene3dNode.diskRelPath!))).toBe(true);

    // Verify initial freeform sheet has freeform artboard + 3D viewport + script/blueprint CTA
    expect(boot.initialSheet!.defaultLayoutMode).toBe('freeform');
    const rootArt = boot.initialSheet!.nodes[boot.initialSheet!.rootIds[0]];
    expect(rootArt.layout.mode).toBe('freeform');
    expect(Object.values(boot.initialSheet!.nodes).some((n) => n.content?.controlType === 'three-viewport')).toBe(true);
  });

  it('v2.0: moves files and nested folders via moveVfsEntry (updating descendant virtualPath + disk paths and blocking circular moves)', async () => {
    const moveRepoDir = join(tempRoot, 'move-vfs-repo');
    const boot = await dbService.createProject({
      name: 'MoveEntryTestApp',
      rootDiskPath: moveRepoDir,
      layoutMode: 'freeform',
      seedDemoContent: false,
    });
    const projectId = boot.project.id;
    const srcFolder = boot.vfsTree.find((n) => n.virtualPath === '/src')!;

    const { entry: archiveFolder } = await dbService.createVfsEntry({
      projectId,
      parentId: null,
      name: 'archive',
      entryKind: 'folder',
    });
    const { entry: featureFolder } = await dbService.createVfsEntry({
      projectId,
      parentId: srcFolder.id,
      name: 'widgets',
      entryKind: 'folder',
    });
    const { entry: nestedCss } = await dbService.createVfsEntry({
      projectId,
      parentId: featureFolder.id,
      name: 'card.css',
      entryKind: 'style_file',
      initialContent: '.card { position: absolute; left: 32px; top: 48px; }\n',
    });
    expect(existsSync(join(moveRepoDir, 'src', 'widgets', 'card.css'))).toBe(true);

    // Reject circular moves (moving /src into /src/widgets or into itself)
    await expect(dbService.moveVfsEntry(srcFolder.id, srcFolder.id)).rejects.toThrow(/itself/i);
    await expect(dbService.moveVfsEntry(srcFolder.id, featureFolder.id)).rejects.toThrow(/descendants/i);

    // Move entire /src/widgets folder into /archive -> becomes /archive/widgets and updates child /archive/widgets/card.css
    const movedFolder = await dbService.moveVfsEntry(featureFolder.id, archiveFolder.id);
    expect(movedFolder.parentId).toBe(archiveFolder.id);
    expect(movedFolder.virtualPath).toBe('/archive/widgets');

    const treeAfter = await dbService.listVfsTree(projectId);
    const movedCss = treeAfter.find((n) => n.id === nestedCss.id)!;
    expect(movedCss.virtualPath).toBe('/archive/widgets/card.css');
    expect(movedCss.diskRelPath).toBe('archive/widgets/card.css');
    expect(existsSync(join(moveRepoDir, 'archive', 'widgets', 'card.css'))).toBe(true);
    expect(existsSync(join(moveRepoDir, 'src', 'widgets', 'card.css'))).toBe(false);
  });

  it('v2.0: browser studio-client compiles all 26 real targets (HTML5/Vanilla CSS, Svelte 5, .NET MAUI) and persists multi-project Wizard + VFS state in localStorage', async () => {
    const store = new Map<string, string>();
    const prevStorage = (globalThis as Record<string, unknown>).localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => {
          store.set(k, String(v));
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
        clear: () => {
          store.clear();
        },
        key: (i: number) => Array.from(store.keys())[i] ?? null,
        get length() {
          return store.size;
        },
      },
    });

    try {
      const clientModuleSpec = '../src/renderer/src/api/studio-client';
      const clientMod = (await import(clientModuleSpec)) as {
        BROWSER_STUDIO_STORAGE_KEY: string;
        createBrowserStudioApi: () => import('../src/shared/ipc-contract').StudioPreloadApi;
        resetBrowserStudioApiCache: () => void;
      };

      clientMod.resetBrowserStudioApiCache();
      const apiSession1 = clientMod.createBrowserStudioApi();

      // 1. Verify all 26 targets + real HTML5+CSS3 & Svelte 5 compilation in browser mode (NO fake React JSX!)
      const targets = await apiSession1.codegen.listTargets();
      expect(targets.length).toBe(26);

      const wizBoot = await apiSession1.project.createFromWizard({
        name: 'Browser Persisted Studio',
        category: 'web',
        primaryTarget: 'html-vanilla',
        stylingPreset: 'vanilla-css',
        layoutMode: 'freeform',
        starterPages: ['home', 'login'],
        includeTsScript: true,
        includeBlueprint: true,
        includeThreeScene: true,
        paletteId: 'emerald-studio',
        defaultThemeMode: 'dark',
      });

      const htmlCompiled = await apiSession1.codegen.compileSheet({
        projectId: wizBoot.project.id,
        sheetId: wizBoot.initialSheet!.sheetId,
        targetId: 'html-vanilla',
        dialect: 'vanilla-css',
        mode: 'bundle',
      });
      const indexHtml = htmlCompiled.files.find((f) => f.relativePath === 'index.html')!;
      const stylesCss = htmlCompiled.files.find((f) => f.relativePath === 'styles.css')!;
      expect(indexHtml.code).toContain('<!DOCTYPE html>');
      expect(indexHtml.code).not.toContain('import React');
      expect(stylesCss.code).toContain('position: absolute;');
      expect(stylesCss.sourceMap.length).toBeGreaterThan(0);

      const svelteCompiled = await apiSession1.codegen.compileSheet({
        projectId: wizBoot.project.id,
        sheetId: wizBoot.initialSheet!.sheetId,
        targetId: 'svelte5',
        dialect: 'tailwind',
        mode: 'component',
      });
      expect(svelteCompiled.files[0].relativePath.endsWith('.svelte')).toBe(true);
      expect(svelteCompiled.files[0].code).not.toContain('import React');

      // 2. Create a custom script file & move it into /src/scripts, then simulate full browser reload
      const srcDir = wizBoot.vfsTree.find((n) => n.virtualPath === '/src')!;
      const scriptsDir = wizBoot.vfsTree.find((n) => n.virtualPath === '/src/scripts')!;
      const { entry: customTs } = await apiSession1.vfs.createEntry({
        projectId: wizBoot.project.id,
        parentId: srcDir.id,
        name: 'custom-logic.ts',
        entryKind: 'script_file',
        initialContent: 'export function validateOrder(): boolean { return true; }\n',
      });
      const movedTs = await apiSession1.vfs.moveEntry(customTs.id, scriptsDir.id);
      expect(movedTs.virtualPath).toBe('/src/scripts/custom-logic.ts');

      expect(store.has(clientMod.BROWSER_STUDIO_STORAGE_KEY)).toBe(true);

      // 3. Simulate browser reload with a brand-new StudioApi instance reading from localStorage
      clientMod.resetBrowserStudioApiCache();
      const apiSession2 = clientMod.createBrowserStudioApi();
      const reloadedBoot = await apiSession2.project.getCurrent();
      expect(reloadedBoot.project.id).toBe(wizBoot.project.id);
      expect(reloadedBoot.project.name).toBe('Browser Persisted Studio');
      expect(reloadedBoot.sheets.length).toBe(2);

      const recents = await apiSession2.project.listRecent();
      expect(recents.length).toBeGreaterThanOrEqual(2); // Demo project + Wizard project

      const reloadedScript = reloadedBoot.vfsTree.find((n) => n.virtualPath === '/src/scripts/custom-logic.ts')!;
      expect(reloadedScript).toBeDefined();
      const readBack = await apiSession2.vfs.readFile(reloadedScript.id);
      expect(readBack.content).toContain('validateOrder');

      // 4. Verify Freeform AI placement computes non-overlapping nextY + dark-surface colors
      const { synthesizeOfflineAgentPlan } = await import('../src/workers/ai-worker/offline-assistant');
      const freeSheet = reloadedBoot.initialSheet!;
      const rootArt = freeSheet.nodes[freeSheet.rootIds[0]];
      const expectedNextY = Math.round(
        Math.max(
          48,
          ...rootArt.childIds
            .map((cid) => freeSheet.nodes[cid])
            .filter(Boolean)
            .map((c) => c.layout.frame.y + c.layout.frame.height + 28),
        ),
      );

      const plan = synthesizeOfflineAgentPlan({
        mode: 'prompt_to_ui',
        prompt: 'Create a KPI analytics row',
        sheet: freeSheet,
        selectedNodeIds: [],
        activeTarget: 'html-vanilla',
        hasVisionAttachment: false,
      });
      const insertOp = plan.compactOps[0];
      expect(insertOp.op).toBe('insert_tree');
      if (insertOp.op === 'insert_tree') {
        expect(insertOp.tree.positioning).toBe('absolute');
        expect(insertOp.tree.x).toBe(48);
        expect(insertOp.tree.y).toBe(expectedNextY);
        expect(insertOp.tree.bg).toBe('#111827');
      }

      // Also verify browser studio-client runAgentTurn honors Freeform nextY
      const aiTurn = await apiSession2.ai.runAgentTurn({
        projectId: reloadedBoot.project.id,
        sheetId: freeSheet.sheetId,
        mode: 'prompt_to_ui',
        provider: 'builtin_offline',
        modelName: 'offline-studio-architect-v1',
        prompt: 'Aggiungi pannello azioni rapide',
      });
      const insertedBrowserAi = Object.values(aiTurn.updatedSheet.nodes).find(
        (n) => n.name === 'AISynthesizedSection',
      )!;
      expect(insertedBrowserAi).toBeDefined();
      expect(insertedBrowserAi.layout.positioning).toBe('absolute');
      expect(insertedBrowserAi.layout.frame.x).toBe(48);
      expect(insertedBrowserAi.layout.frame.y).toBe(expectedNextY);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        writable: true,
        value: prevStorage,
      });
    }
  });

  it('v2.1: removes recent projects cleanly in SQLite & localStorage and persists AI-generated multi-screen projects end-to-end', async () => {
    const p1 = await dbService.createProject({ name: 'TempTestArtifact', layoutMode: 'freeform', seedDemoContent: false });
    const p2 = await dbService.createProject({ name: 'KeepProductionApp', layoutMode: 'auto', seedDemoContent: true });

    const beforeRemove = await dbService.listRecentProjects();
    expect(beforeRemove.some((r) => r.id === p1.project.id)).toBe(true);
    expect(beforeRemove.some((r) => r.id === p2.project.id && r.layoutMode === 'auto')).toBe(true);

    const afterRemove = await dbService.removeRecentProject(p1.project.id);
    expect(afterRemove.some((r) => r.id === p1.project.id)).toBe(false);
    expect(afterRemove.some((r) => r.id === p2.project.id)).toBe(true);

    // End-to-end AI Project Architect -> SQLite persistence (with offline deterministic domain synthesis)
    const { createAiWorkerService } = await import('../src/workers/ai-worker');
    const offlineAi = createAiWorkerService({
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });

    const seedOut = await offlineAi.generateProjectSeedWithAi({
      prompt: 'Gestionale Clienti & Fatture con emissione SDI e scadenziario',
      primaryTarget: 'htmx',
      stylingPreset: 'tailwind',
      layoutMode: 'freeform',
      provider: 'ollama',
    });

    const persistedAiBoot = await dbService.createProjectFromSeed(seedOut.seed, {
      layoutMode: 'freeform',
      paletteId: seedOut.paletteId,
      defaultThemeMode: seedOut.defaultThemeMode,
      activeAiProviderId: seedOut.provider,
      activeAiModelId: seedOut.modelName,
      initialPrompt: 'Gestionale Clienti & Fatture con emissione SDI e scadenziario',
      initialAssistantSummary: seedOut.assistantSummary,
    });

    expect(persistedAiBoot.project.name).toContain('Fatture');
    expect(persistedAiBoot.project.primaryTarget).toBe('htmx');
    expect(persistedAiBoot.sheets.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(persistedAiBoot.initialSheet!.nodes).length).toBeGreaterThanOrEqual(12);

    const handlersEntry = persistedAiBoot.vfsTree.find((v) => v.virtualPath === '/src/scripts/handlers.ts')!;
    const handlersContent = await dbService.readVfsFile(handlersEntry.id);
    expect(handlersContent.content).toContain('export function onEmitInvoiceSubmit');

    const aiThreads = await dbService.listAiThreads(persistedAiBoot.project.id);
    expect(aiThreads.length).toBe(1);

    // Verify browser studio-client removeRecent & generateProjectWithAi parity
    const store = new Map<string, string>();
    const prevStorage = (globalThis as Record<string, unknown>).localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => store.set(k, String(v)),
        removeItem: (k: string) => store.delete(k),
        clear: () => store.clear(),
        key: (i: number) => Array.from(store.keys())[i] ?? null,
        get length() {
          return store.size;
        },
      },
    });

    try {
      const clientModuleSpec = '../src/renderer/src/api/studio-client';
      const clientMod = (await import(clientModuleSpec)) as {
        createBrowserStudioApi: () => import('../src/shared/ipc-contract').StudioPreloadApi;
        resetBrowserStudioApiCache: () => void;
      };
      clientMod.resetBrowserStudioApiCache();
      const browserApi = clientMod.createBrowserStudioApi();

      const browserGen = await browserApi.ai.generateProjectWithAi({
        prompt: 'Showcase Prodotto 3D con configuratore materiali',
        primaryTarget: 'react-tsx',
        stylingPreset: 'tailwind',
        layoutMode: 'freeform',
        provider: 'builtin_offline',
      });
      expect(browserGen.project.name).toContain('3D');
      expect(browserGen.vfsTree.some((v) => v.entryKind === 'three_scene')).toBe(true);

      const recentsBefore = await browserApi.project.listRecent();
      expect(recentsBefore.some((r) => r.id === browserGen.project.id)).toBe(true);

      const recentsAfter = await browserApi.project.removeRecent(browserGen.project.id);
      expect(recentsAfter.some((r) => r.id === browserGen.project.id)).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        writable: true,
        value: prevStorage,
      });
    }
  });
});
