import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import ts from 'typescript';

import {
  detectMarkupFormat,
  importMarkupToPatchOps,
  liftMarkupToSheetDocument,
} from '@shared/markup-importer';
import { detectDiskProjectStack, detectEditorLanguage } from '@shared/project-detector';
import {
  buildDiskProjectScaffold,
  createValidRgbaIcoBytes,
  createValidRgbaPngBytes,
} from '@shared/project-scaffolder';
import {
  PROJECT_STACK_CATALOG,
  type DiskProjectInitSpec,
  type PrimaryCodeLanguage,
  type ProjectStackId,
  type ToolchainStreamEvent,
} from '@shared/project-stacks';
import { applyPatchOpsToSheet, createDefaultUINode } from '@shared/ui-patch';
import { planRustTauriSqlInstall, RUST_TAURI_SQL_PATHS } from '@shared/rust-tauri-sql-install';
import type { UISheetDocument } from '@shared/ui-ir';
import {
  ToolchainRunnerService,
  createAndInitDiskProjectWithRunner,
  inspectDiskDirectory,
  openExistingDiskProjectWithRunner,
  toolchainDoctor,
  writeScaffoldBundleToDisk,
} from '../src/main/toolchain-runner';
import { DbWorkerService } from '../src/workers/db-worker/service';
import { generateRustTauriSqlInstallBundle } from '../src/workers/codegen-worker/sql-codegen';

const tempDirs: string[] = [];

function makeTempDir(prefix = 'uistudio-v3-proj-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore transient Windows file lock cleanup
      }
    }
  }
});

describe('Pillar 3A — 11-Stack Real Disk Project Scaffolder (project-scaffolder.ts)', () => {
  it('exposes all 11 canonical ProjectStackIds in PROJECT_STACK_CATALOG', () => {
    const ids = PROJECT_STACK_CATALOG.map((s) => s.id);
    expect(ids).toEqual([
      'html-css-js',
      'react',
      'angular',
      'svelte',
      'htmx',
      'react-native',
      'nextjs',
      'vite',
      'nodejs',
      'tauri',
      'rust-tauri',
    ]);
  });

  it('scaffolds complete, valid repository files for all 11 stacks across JS, TS, Python, and Rust+Tauri', () => {
    const matrix: Array<{
      stackId: ProjectStackId;
      lang: PrimaryCodeLanguage;
      expectedPaths: string[];
    }> = [
      {
        stackId: 'html-css-js',
        lang: 'javascript',
        expectedPaths: ['index.html', 'styles/main.css', 'scripts/automations.js', 'scripts/dev-server.mjs', 'package.json'],
      },
      {
        stackId: 'html-css-js',
        lang: 'typescript',
        expectedPaths: ['index.html', 'styles/main.css', 'scripts/automations.ts', 'src/main.ts', 'tsconfig.json', 'vite.config.ts'],
      },
      {
        stackId: 'react',
        lang: 'javascript',
        expectedPaths: ['package.json', 'vite.config.js', 'jsconfig.json', 'index.html', 'src/main.jsx', 'src/App.jsx', 'src/scripts/automations.js'],
      },
      {
        stackId: 'react',
        lang: 'typescript',
        expectedPaths: ['package.json', 'vite.config.ts', 'tsconfig.json', 'index.html', 'src/main.tsx', 'src/App.tsx', 'src/scripts/automations.ts'],
      },
      {
        stackId: 'angular',
        lang: 'typescript',
        expectedPaths: ['angular.json', 'package.json', 'tsconfig.json', 'src/main.ts', 'src/styles.css', 'src/app/app.component.ts', 'src/app/app.component.html', 'src/app/app.component.css'],
      },
      {
        stackId: 'svelte',
        lang: 'javascript',
        expectedPaths: ['package.json', 'svelte.config.js', 'vite.config.js', 'src/main.js', 'src/App.svelte', 'src/scripts/automations.js'],
      },
      {
        stackId: 'svelte',
        lang: 'typescript',
        expectedPaths: ['package.json', 'svelte.config.js', 'vite.config.ts', 'tsconfig.json', 'src/main.ts', 'src/App.svelte', 'src/scripts/automations.ts'],
      },
      {
        stackId: 'htmx',
        lang: 'javascript',
        expectedPaths: ['server.js', 'package.json', 'public/index.html', 'public/partials/items-list.html', 'public/scripts/automations.js'],
      },
      {
        stackId: 'htmx',
        lang: 'typescript',
        expectedPaths: ['server.ts', 'package.json', 'tsconfig.json', 'public/index.html', 'public/partials/items-list.html', 'public/scripts/automations.ts'],
      },
      {
        stackId: 'htmx',
        lang: 'python',
        expectedPaths: ['main.py', 'automations.py', 'requirements.txt', 'pyproject.toml', 'public/index.html', 'public/partials/items-list.html', 'public/scripts/automations.js'],
      },
      {
        stackId: 'react-native',
        lang: 'javascript',
        expectedPaths: ['app.json', 'package.json', 'App.js', 'components/ActionCard.js', 'scripts/automations.js'],
      },
      {
        stackId: 'react-native',
        lang: 'typescript',
        expectedPaths: ['app.json', 'package.json', 'tsconfig.json', 'App.tsx', 'components/ActionCard.tsx', 'scripts/automations.ts'],
      },
      {
        stackId: 'nextjs',
        lang: 'javascript',
        expectedPaths: ['package.json', 'next.config.mjs', 'src/app/layout.jsx', 'src/app/page.jsx', 'src/app/globals.css', 'src/app/api/health/route.js'],
      },
      {
        stackId: 'nextjs',
        lang: 'typescript',
        expectedPaths: ['package.json', 'next.config.mjs', 'tsconfig.json', 'src/app/layout.tsx', 'src/app/page.tsx', 'src/app/globals.css', 'src/app/api/health/route.ts'],
      },
      {
        stackId: 'vite',
        lang: 'javascript',
        expectedPaths: ['package.json', 'vite.config.js', 'index.html', 'src/main.js', 'src/styles/theme-and-sheet.css', 'src/scripts/automations.js'],
      },
      {
        stackId: 'vite',
        lang: 'typescript',
        expectedPaths: ['package.json', 'vite.config.ts', 'tsconfig.json', 'index.html', 'src/main.ts', 'src/styles/theme-and-sheet.css', 'src/scripts/automations.ts'],
      },
      {
        stackId: 'nodejs',
        lang: 'javascript',
        expectedPaths: ['package.json', 'src/server.js', 'src/db.js', 'public/index.html', 'public/scripts/app.js', 'public/scripts/automations.js'],
      },
      {
        stackId: 'nodejs',
        lang: 'typescript',
        expectedPaths: ['package.json', 'tsconfig.json', 'src/server.ts', 'src/db.ts', 'public/index.html', 'public/scripts/app.js', 'public/scripts/automations.ts'],
      },
      {
        stackId: 'tauri',
        lang: 'typescript',
        expectedPaths: [
          'package.json',
          'src/App.tsx',
          'src-tauri/Cargo.toml',
          'src-tauri/build.rs',
          'src-tauri/tauri.conf.json',
          'src-tauri/capabilities/default.json',
          'src-tauri/src/main.rs',
          'src-tauri/src/lib.rs',
          'src-tauri/src/commands.rs',
          'src-tauri/icons/icon.png',
          'src-tauri/icons/icon.ico',
        ],
      },
      {
        stackId: 'rust-tauri',
        lang: 'typescript',
        expectedPaths: [
          'package.json',
          'src/App.tsx',
          'src/lib/tauri-bridge.ts',
          'src-tauri/Cargo.toml',
          'src-tauri/build.rs',
          'src-tauri/tauri.conf.json',
          'src-tauri/capabilities/default.json',
          'src-tauri/src/main.rs',
          'src-tauri/src/lib.rs',
          'src-tauri/src/commands.rs',
          'src-tauri/src/models.rs',
          'src-tauri/src/db.rs',
          'src-tauri/icons/icon.png',
          'src-tauri/icons/icon.ico',
        ],
      },
    ];

    for (const testCase of matrix) {
      const spec: DiskProjectInitSpec = {
        name: `L'app "Studio" & <Design> {UI} \` ${testCase.stackId}`,
        targetParentDir: 'C:/Temp',
        stackId: testCase.stackId,
        primaryLanguage: testCase.lang,
      };
      const bundle = buildDiskProjectScaffold(spec);
      const fileMap = new Map(bundle.files.map((f) => [f.relativePath, f]));

      for (const expectedRel of testCase.expectedPaths) {
        expect(
          fileMap.has(expectedRel),
          `Stack "${testCase.stackId}" (${testCase.lang}) missing file "${expectedRel}"`,
        ).toBe(true);
      }

      // Every JSON file in the bundle must parse cleanly
      for (const f of bundle.files) {
        if (!f.isBinary && f.relativePath.endsWith('.json')) {
          expect(() => JSON.parse(f.content), `Invalid JSON in ${testCase.stackId}:${f.relativePath}`).not.toThrow();
        }
        if (/\.(?:[cm]?js|jsx|tsx?)$/.test(f.relativePath) && !f.relativePath.endsWith('.d.ts')) {
          const compiled = ts.transpileModule(f.content, {
            fileName: f.relativePath,
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
            reportDiagnostics: true,
          });
          const errors = (compiled.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
          expect(errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')), `${testCase.stackId}:${f.relativePath}`).toEqual([]);
        }
      }
    }
  });

  it('creates a real linked project, reloads external edits and preserves existing repositories', async () => {
    const parent = makeTempDir('studio-real-project-');
    const dbWorker = new DbWorkerService({ storageRootDir: join(parent, 'studio-data') });
    const runner = new ToolchainRunnerService({});
    const spec: DiskProjectInitSpec = {
      name: 'Progetto Demo',
      targetParentDir: parent,
      stackId: 'html-css-js',
      primaryLanguage: 'javascript',
      includeAutomations: false,
      includeBlueprint: true,
      runToolchainInit: false,
    };
    const deps = { dbWorker, runner, defaultProjectsParentDir: parent };
    try {
      const created = await createAndInitDiskProjectWithRunner(spec, deps);
      const root = created.project.rootDiskPath!;
      expect(created.initialSheet?.linkedScripts ?? []).toHaveLength(0);
      expect(created.vfsTree.some((file) => file.entryKind === 'blueprint_graph')).toBe(true);
      const indexFile = created.vfsTree.find((file) => file.virtualPath === '/index.html')!;
      const html = join(root, 'index.html');
      const original = readFileSync(html, 'utf8');
      expect(original).toContain('Progetto Demo');
      writeFileSync(html, '<main>Modifica esterna</main>', 'utf8');
      await dbWorker.reconcileDiskPaths(created.project.id, ['index.html']);
      expect((await dbWorker.readVfsFile(indexFile.id)).content).toContain('Modifica esterna');

      await expect(createAndInitDiskProjectWithRunner(spec, deps)).rejects.toThrow('esiste già');
      expect(readFileSync(html, 'utf8')).toBe('<main>Modifica esterna</main>');

      const reopened = await openExistingDiskProjectWithRunner(root, { dbWorker, runner });
      expect(reopened.project.id).toBe(created.project.id);
      await dbWorker.writeVfsFile(indexFile.id, original);
      expect(readFileSync(html, 'utf8')).toBe(original);
    } finally {
      runner.unwatchDirectory();
      dbWorker.close();
    }
  });

  it('installs generated Rust SQLite CRUD beside native files and preserves edited sources', async () => {
    const parent = makeTempDir('studio-rust-sql-');
    const dbWorker = new DbWorkerService({ storageRootDir: join(parent, 'studio-data') });
    const runner = new ToolchainRunnerService({});
    try {
      const { project } = await createAndInitDiskProjectWithRunner({
        name: 'Rust SQLite Demo', targetParentDir: parent, stackId: 'rust-tauri',
        primaryLanguage: 'typescript', runToolchainInit: false,
      }, { dbWorker, runner, defaultProjectsParentDir: parent });
      const root = project.rootDiskPath!;
      const read = (path: string) => readFileSync(join(root, path), 'utf8');
      const nativePaths = ['src-tauri/src/db.rs', 'src-tauri/src/commands.rs', RUST_TAURI_SQL_PATHS.manifest];
      const nativeFiles = nativePaths.map(read);
      const doc = await dbWorker.loadSqlSchema(project.id);
      const bundle = generateRustTauriSqlInstallBundle({ schema: doc, targetKind: 'rust-tauri', includeSeedScript: true });
      const lib = RUST_TAURI_SQL_PATHS.library;
      const library = read(lib);
      const legacyLibrary = library.replace(/^.*@studio-tauri-sql-(?:module|setup)\r?\n/gm, '');
      expect(planRustTauriSqlInstall(bundle, read(RUST_TAURI_SQL_PATHS.manifest), legacyLibrary).library).toContain('mod studio_sql;');
      writeFileSync(join(root, lib), library.replace('// @studio-tauri-handlers:end', '// marcatore rimosso'));
      await expect(dbWorker.installRustTauriSqlModule(project.id, bundle)).rejects.toThrow('Punto di integrazione');
      expect(existsSync(join(root, RUST_TAURI_SQL_PATHS.rustModule))).toBe(false);
      writeFileSync(join(root, lib), library);

      const installed = await dbWorker.installRustTauriSqlModule(project.id, bundle);
      expect(installed.writtenPaths).toEqual([
        RUST_TAURI_SQL_PATHS.rustModule, RUST_TAURI_SQL_PATHS.client,
        RUST_TAURI_SQL_PATHS.schema, RUST_TAURI_SQL_PATHS.library,
      ]);
      const registered = read(lib);
      expect(registered).toContain('commands::list_records,');
      expect(registered).toContain('mod studio_sql;');
      expect(registered).toContain('.app_data_dir()?.join("studio_sql.sqlite")');
      expect(registered).toMatch(/studio_sql::studio_sql_update_/);
      expect(nativePaths.map(read)).toEqual(nativeFiles);
      expect((await dbWorker.listVfsTree(project.id)).some((node) => node.virtualPath === `/${RUST_TAURI_SQL_PATHS.rustModule}`)).toBe(true);
      expect((await dbWorker.installRustTauriSqlModule(project.id, bundle)).writtenPaths).toEqual([]);

      writeFileSync(join(root, RUST_TAURI_SQL_PATHS.client), '// modificato manualmente');
      await expect(dbWorker.installRustTauriSqlModule(project.id, bundle)).rejects.toThrow('contiene un file diverso');
      expect(read(RUST_TAURI_SQL_PATHS.client)).toBe('// modificato manualmente');
      expect(read(lib)).toBe(registered);
    } finally {
      runner.unwatchDirectory();
      dbWorker.close();
    }
  });

  it.skipIf(process.env.STUDIO_RUN_LOOPBACK_SMOKE !== '1')('serves a generated HTML project over HTTP on a real local port', async () => {
    const root = makeTempDir('studio-http-');
    writeScaffoldBundleToDisk(root, buildDiskProjectScaffold({
      name: 'App di Test', targetParentDir: root, stackId: 'html-css-js', primaryLanguage: 'javascript',
    }));
    const child = spawn(process.execPath, ['scripts/dev-server.mjs'], {
      cwd: root,
      env: { ...process.env, PORT: '0' },
      windowsHide: true,
    });
    const closed = once(child, 'close');
    try {
      const [line] = await Promise.race([
        once(child.stdout, 'data'),
        closed.then(() => { throw new Error('Il server di test è terminato prima di avviarsi.'); }),
      ]);
      const address = String(line).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      expect(address).toBeTruthy();
      const homepage = await fetch(address!);
      expect(homepage.status).toBe(200);
      expect(await homepage.text()).toContain('<h1>App di Test</h1>');
      const health = await fetch(`${address}/api/health`);
      expect(await health.json()).toEqual({ ok: true, stack: 'html-css-js' });
      expect((await fetch(`${address}/styles/main.css`)).status).toBe(200);
      expect((await fetch(`${address}/package.json`)).status).toBe(404);
    } finally {
      child.kill();
      await closed;
    }
  });

  it('generates valid RGBA PNG (colorType=6) and ICO binary icons + @studio-tauri-commands fences for rust-tauri', () => {
    const png = createValidRgbaPngBytes(32, 32);
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    // Byte 25 in standard PNG header is IHDR colorType (8 sig + 4 len + 4 'IHDR' + 4 width + 4 height + 1 depth = offset 25)
    expect(png[25]).toBe(6); // RGBA

    const ico = createValidRgbaIcoBytes(png);
    expect(Array.from(ico.slice(0, 6))).toEqual([0, 0, 1, 0, 1, 0]);
    expect(ico.length).toBe(22 + png.length);

    const rustTauri = buildDiskProjectScaffold({
      name: 'Gestionale Magazzino Rust',
      targetParentDir: 'C:/Projects',
      stackId: 'rust-tauri',
      primaryLanguage: 'typescript',
    });

    const commandsRs = rustTauri.files.find((f) => f.relativePath === 'src-tauri/src/commands.rs')?.content ?? '';
    const libRs = rustTauri.files.find((f) => f.relativePath === 'src-tauri/src/lib.rs')?.content ?? '';
    expect(commandsRs).toContain('// @studio-tauri-commands:start');
    expect(commandsRs).toContain('// @studio-tauri-commands:end');
    expect(commandsRs).toContain('#[tauri::command]');
    expect(libRs).toContain('// @studio-tauri-handlers:start');
    expect(libRs).toContain('// @studio-tauri-handlers:end');
  });

  it('supports HTMX Flask backend and optional Python FastAPI companion on web stacks', () => {
    const htmxFlask = buildDiskProjectScaffold({
      name: 'HTMX Flask Portal',
      targetParentDir: 'C:/Projects',
      stackId: 'htmx',
      primaryLanguage: 'python',
      pythonCompanion: 'flask',
    });
    const flaskMain = htmxFlask.files.find((f) => f.relativePath === 'main.py')?.content ?? '';
    expect(flaskMain).toContain('from flask import Flask');

    const reactWithPy = buildDiskProjectScaffold({
      name: 'React FastAPI Suite',
      targetParentDir: 'C:/Projects',
      stackId: 'react',
      primaryLanguage: 'typescript',
      pythonCompanion: 'fastapi',
    });
    const paths = new Set(reactWithPy.files.map((f) => f.relativePath));
    expect(paths.has('backend/main.py')).toBe(true);
    expect(paths.has('backend/automations.py')).toBe(true);
    expect(paths.has('requirements.txt')).toBe(true);
    expect(paths.has('pyproject.toml')).toBe(true);
    const viteCfg = reactWithPy.files.find((f) => f.relativePath === 'vite.config.ts')?.content ?? '';
    expect(viteCfg).toContain('http://127.0.0.1:8000');
  });

  it('serves TypeScript automation from its live source for HTMX and Node without a stale JavaScript copy', () => {
    for (const stackId of ['htmx', 'nodejs'] as const) {
      const scaffold = buildDiskProjectScaffold({ name: 'Automation', targetParentDir: '.', stackId, primaryLanguage: 'typescript' });
      const files = new Map(scaffold.files.map((file) => [file.relativePath, file.content]));
      const server = files.get(stackId === 'htmx' ? 'server.ts' : 'src/server.ts')!;
      expect(files.has('public/scripts/automations.js')).toBe(false);
      expect(files.has('public/scripts/automations.ts')).toBe(true);
      expect(server).toContain("app.get('/scripts/automations.js'");
      expect(server).toContain("'public/scripts/automations.ts'");
      expect(server).toContain("'Cache-Control', 'no-store'");
      expect(server.indexOf("app.get('/scripts/automations.js'")).toBeLessThan(server.indexOf('express.static('));
    }
  });
});

describe('Pillar 3A — Non-Destructive Stack Detector & Folder Inspector (project-detector.ts)', () => {
  it('accurately round-trip detects all 11 scaffolded stacks and languages', () => {
    const stacks: Array<{ stackId: ProjectStackId; lang: PrimaryCodeLanguage }> = [
      { stackId: 'html-css-js', lang: 'javascript' },
      { stackId: 'react', lang: 'typescript' },
      { stackId: 'angular', lang: 'typescript' },
      { stackId: 'svelte', lang: 'typescript' },
      { stackId: 'htmx', lang: 'python' },
      { stackId: 'htmx', lang: 'javascript' },
      { stackId: 'react-native', lang: 'typescript' },
      { stackId: 'nextjs', lang: 'typescript' },
      { stackId: 'vite', lang: 'javascript' },
      { stackId: 'nodejs', lang: 'typescript' },
      { stackId: 'tauri', lang: 'typescript' },
      { stackId: 'rust-tauri', lang: 'typescript' },
    ];

    for (const item of stacks) {
      const scaffold = buildDiskProjectScaffold({
        name: `Detect-${item.stackId}`,
        targetParentDir: '/tmp',
        stackId: item.stackId,
        primaryLanguage: item.lang,
      });
      const detected = detectDiskProjectStack({
        rootDir: `/tmp/${scaffold.slug}`,
        files: scaffold.files.filter((f) => !f.isBinary),
      });
      expect(detected.stackId).toBe(item.stackId);
      expect(detected.primaryLanguage).toBe(item.lang);
      expect(detected.candidateUiEntryFiles.length).toBeGreaterThan(0);
    }
  });

  it('inspects an existing disk repo ignoring node_modules/.venv and opens non-destructively without overwriting user files', async () => {
    const repoDir = makeTempDir('existing-svelte-repo-');
    const scaffold = buildDiskProjectScaffold({
      name: 'User Existing Svelte Repo',
      targetParentDir: repoDir,
      stackId: 'svelte',
      primaryLanguage: 'typescript',
    });
    writeScaffoldBundleToDisk(repoDir, scaffold);

    // Custom user content that MUST NEVER be overwritten
    const customAppSvelte = `<script lang="ts">
  let counter = $state(42);
  function incrementCounter() { counter += 1; }
</script>
<main class="p-6 flex flex-col gap-4">
  <h1>Custom User Svelte App</h1>
  {#if counter > 0}
    <button onclick={incrementCounter}>Incrementa {counter}</button>
  {/if}
</main>
`;
    const appSveltePath = join(repoDir, 'src', 'App.svelte');
    writeFileSync(appSveltePath, customAppSvelte, 'utf8');

    // Polluted ignored dirs (`node_modules`, `.venv`, `target`)
    mkdirSync(join(repoDir, 'node_modules', 'fake-pkg'), { recursive: true });
    writeFileSync(join(repoDir, 'node_modules', 'fake-pkg', 'index.js'), 'module.exports = {};');
    mkdirSync(join(repoDir, '.venv', 'Lib'), { recursive: true });
    writeFileSync(join(repoDir, '.venv', 'Lib', 'site.py'), '# ignored');

    const detected = inspectDiskDirectory(repoDir);
    expect(detected.stackId).toBe('svelte');
    expect(detected.primaryLanguage).toBe('typescript');
    expect(detected.candidateUiEntryFiles[0]).toBe('src/App.svelte');

    let capturedImportArg: any = null;
    const runner = new ToolchainRunnerService();
    try {
      await openExistingDiskProjectWithRunner(repoDir, {
        runner,
        dbWorker: {
          importExistingDiskProject: async (arg: any) => {
            capturedImportArg = arg;
            return {
              project: {
                id: 'proj_imported',
                name: arg.detected.name,
                dbFilePath: join(repoDir, '.uistudio', 'project.uistudio'),
                rootDiskPath: repoDir,
                primaryTarget: arg.detected.primaryTarget,
                stylingPreset: arg.detected.stylingPreset,
                stackId: arg.detected.stackId,
                primaryLanguage: arg.detected.primaryLanguage,
                activeThemeId: null,
                breakpoints: [],
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
              workspace: {} as any,
              vfsTree: [],
              sheets: [],
              initialSheet: arg.liftedInitialSheet,
              themes: [],
              tokens: [],
            };
          },
        } as any,
      });
    } finally {
      runner.unwatchDirectory();
    }

    // Verify user file on disk is 100% untouched byte-for-byte
    expect(readFileSync(appSveltePath, 'utf8')).toBe(customAppSvelte);
    expect(capturedImportArg).toBeTruthy();
    expect(capturedImportArg.linkedEntryRelPath).toBe('src/App.svelte');
    expect(capturedImportArg.liftedInitialSheet).toBeTruthy();
    const liftedNodes = Object.values(capturedImportArg.liftedInitialSheet.nodes) as any[];
    expect(liftedNodes.some((n) => n.content?.text?.includes('Custom User Svelte App'))).toBe(true);
  });
});

describe('Pillar 3A — Svelte 5 & Angular 19 Markup Lift (markup-importer.ts)', () => {
  function makeSheet(): { sheet: UISheetDocument; artboardId: string } {
    const sheetId = 'sheet_lift_test';
    const artboardId = 'art_lift_root';
    const art = createDefaultUINode({ id: artboardId, kind: 'artboard', name: 'Artboard' }, sheetId);
    return {
      artboardId,
      sheet: { sheetId, projectId: 'proj_1', name: 'LiftTest', rootIds: [artboardId], nodes: { [artboardId]: art } },
    };
  }

  it('lifts Svelte 5 SFC markup stripping <script>/<style> and {#if}/{#each} while binding onclick/on:click', () => {
    const { sheet, artboardId } = makeSheet();
    const svelteCode = `
      <script lang="ts">
        let items = $state(['A', 'B']);
        function saveOrder() {}
      </script>

      <section class="flex flex-col gap-4 p-6 bg-slate-900 rounded-xl">
        <h2 class="text-xl font-bold text-white">Ordini Svelte 5</h2>
        {#if items.length > 0}
          <button class="px-4 py-2 bg-blue-600 text-white rounded-lg" onclick={saveOrder}>
            Conferma Ordine
          </button>
        {/if}
      </section>

      <style>
        section { border: 1px solid #334155; }
      </style>
    `;

    expect(detectMarkupFormat(svelteCode)).toBe('svelte');
    const ops = importMarkupToPatchOps(sheet, artboardId, svelteCode);
    expect(ops.length).toBeGreaterThanOrEqual(3);

    const nextSheet = applyPatchOpsToSheet(sheet, ops).nextSheet;
    const nodes = Object.values(nextSheet.nodes);
    const btn = nodes.find((n) => n.content?.controlType === 'button');
    expect(btn?.content?.text).toBe('Conferma Ordine');
    expect(btn?.interactions?.[0]).toEqual({
      trigger: 'onClick',
      action: { kind: 'call_handler', handlerName: 'saveOrder' },
    });
  });

  it('lifts Angular 19 templates (@if, @for, *ngIf, {{ interpolation }}, (click)) into clean Canvas UINodes', () => {
    const angularHtml = `
      <main class="flex flex-col gap-3 p-4 bg-slate-950">
        <h1>{{ pageTitle }}</h1>
        @if (isReady()) {
          <div class="flex flex-row gap-2" *ngIf="visible">
            <input placeholder="Codice cliente..." />
            <button type="button" (click)="runPrimaryAutomation()">Salva Cliente</button>
          </div>
        }
      </main>
    `;

    expect(detectMarkupFormat(angularHtml)).toBe('angular');
    const lifted = liftMarkupToSheetDocument({
      projectId: 'proj_ng',
      sheetName: 'CustomerScreen',
      markup: angularHtml,
    });
    expect(lifted).not.toBeNull();
    const nodes = Object.values(lifted!.nodes);
    const heading = nodes.find((n) => n.semanticTag === 'h1');
    expect(heading?.content?.text).toBe('pageTitle');

    const btn = nodes.find((n) => n.content?.controlType === 'button');
    expect(btn?.content?.text).toBe('Salva Cliente');
    expect(btn?.interactions?.[0]).toEqual({
      trigger: 'onClick',
      action: { kind: 'call_handler', handlerName: 'runPrimaryAutomation' },
    });
  });
});

describe('Pillar 3A — Toolchain Doctor, Process Runner & Multi-Language Editor', () => {
  it('probes local system toolchains via toolchainDoctor()', async () => {
    const report = await toolchainDoctor(true);
    expect(report.node.available).toBe(true);
    expect(report.node.version).toBeTruthy();
    expect(report.npm.available).toBe(true);
    expect(typeof report.python.available).toBe('boolean');
    expect(typeof report.rustc.available).toBe('boolean');
    expect(typeof report.cargo.available).toBe('boolean');
  });

  it('streams stdout + server_ready events on node_run and cleanly stops long-running tasks', async () => {
    const dir = makeTempDir('runner-exec-');
    writeFileSync(
      join(dir, 'hello.mjs'),
      `console.log('Hello from Studio Runner');\nconsole.log('Dev listening at http://localhost:5199');\n`,
      'utf8',
    );

    const events: ToolchainStreamEvent[] = [];
    let resolveDone!: () => void;
    const donePromise = new Promise<void>((res) => {
      resolveDone = res;
    });

    const runner = new ToolchainRunnerService({
      onStreamEvent: (ev) => {
        events.push(ev);
        if (ev.type === 'task_completed') {
          resolveDone();
        }
      },
    });

    await runner.runTask({
      projectId: 'proj_runner_1',
      rootDiskPath: dir,
      kind: 'node_run',
      scriptRelPath: 'hello.mjs',
    });

    await donePromise;

    expect(events.some((e) => e.type === 'task_started')).toBe(true);
    expect(
      events.some((e) => e.type === 'stdout' && e.line.includes('Hello from Studio Runner')),
    ).toBe(true);
    expect(
      events.some((e) => e.type === 'server_ready' && e.url === 'http://localhost:5199'),
    ).toBe(true);
    expect(
      events.some((e) => e.type === 'task_completed' && e.status === 'succeeded'),
    ).toBe(true);

    // Also verify stopping a long-running process (`taskkill /T /F` on Windows)
    writeFileSync(
      join(dir, 'hang.mjs'),
      `console.log('started-hang'); setInterval(() => {}, 1000);\n`,
      'utf8',
    );
    let resolveStopped!: () => void;
    const stoppedPromise = new Promise<void>((res) => {
      resolveStopped = res;
    });
    let startedHangTaskId = '';

    const stoppableRunner = new ToolchainRunnerService({
      onStreamEvent: (ev) => {
        if (ev.type === 'stdout' && ev.line.includes('started-hang')) {
          void stoppableRunner.stopTask(startedHangTaskId);
        }
        if (ev.type === 'task_completed') {
          resolveStopped();
        }
      },
    });

    const started = await stoppableRunner.runTask({
      projectId: 'proj_runner_2',
      rootDiskPath: dir,
      kind: 'node_run',
      scriptRelPath: 'hang.mjs',
    });
    startedHangTaskId = started.taskId;
    await stoppedPromise;
    expect(stoppableRunner.listActiveTasks().length).toBe(0);
  });

  it('uses the imported package start script and streams output without a final newline', async () => {
    const dir = makeTempDir('imported toolchain-');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { start: 'node start.mjs' } }));
    writeFileSync(join(dir, 'start.mjs'), "process.stdout.write('Script reale del progetto');");
    let finish!: (event: Extract<ToolchainStreamEvent, { type: 'task_completed' }>) => void;
    const completion = new Promise<Extract<ToolchainStreamEvent, { type: 'task_completed' }>>((resolve) => { finish = resolve; });
    const stdout: string[] = [];
    const runner = new ToolchainRunnerService({
      onStreamEvent: (event) => {
        if (event.type === 'stdout') stdout.push(event.line);
        if (event.type === 'task_completed') finish(event);
      },
    });
    await runner.runTask({ kind: 'dev', projectId: 'imported', rootDiskPath: dir });
    expect((await completion).status).toBe('succeeded');
    expect(stdout).toContain('Script reale del progetto');
  });

  it('classifies all 10 multi-language editor file families accurately', () => {
    expect(detectEditorLanguage('automations.js').id).toBe('javascript');
    expect(detectEditorLanguage('server.ts').id).toBe('typescript');
    expect(detectEditorLanguage('App.tsx').canLiftToCanvas).toBe(true);
    expect(detectEditorLanguage('main.py').canRunNodeOrPy).toBe('python');
    expect(detectEditorLanguage('commands.rs').canCargoCheck).toBe(true);
    expect(detectEditorLanguage('schema.sql').isSql).toBe(true);
    expect(detectEditorLanguage('index.html').canLiftToCanvas).toBe(true);
    expect(detectEditorLanguage('main.css').id).toBe('css');
    expect(detectEditorLanguage('App.svelte').canLiftToCanvas).toBe(true);
    expect(detectEditorLanguage('Cargo.toml').canCargoCheck).toBe(true);
  });
});
