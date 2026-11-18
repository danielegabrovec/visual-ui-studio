import type { CodegenTargetId, StylingDialect } from './ui-ir';
import type { ThreePresetId } from './three-ir';
import type { WizardPaletteId, WizardStarterPageId } from './wizard-templates';

/**
 * Canonical 11-Stack Real Disk Project Catalog, Multi-Language Matrix (`JS` | `TS` | `Python` | `Rust`),
 * Stack Detector Profile, and Two-Stage Toolchain Runner Contracts (v3.0).
 *
 * Pure TypeScript, zero Node imports.
 */

export type ProjectStackId =
  | 'html-css-js' // 1. HTML5 + CSS3 + JS/TS
  | 'react' // 2. React 19 (Vite 6)
  | 'angular' // 3. Angular 19 Standalone
  | 'svelte' // 4. Svelte 5 Runes (Vite 6)
  | 'htmx' // 5. HTMX 2.x Hypermedia (Node.js JS/TS OR Python FastAPI/Flask)
  | 'react-native' // 6. React Native (Expo SDK 52)
  | 'nextjs' // 7. Next.js 15 (App Router)
  | 'vite' // 8. Vite 6 Modular SPA (Vanilla JS/TS)
  | 'nodejs' // 9. Node.js 24 Backend + Web UI / REST API + node:sqlite
  | 'tauri' // 10. Tauri v2 Desktop (Web UI JS/TS + Tauri Shell)
  | 'rust-tauri'; // 11. Rust + Tauri v2 Full-Stack (Multi-module Rust crate + typed invoke)

export type PrimaryCodeLanguage = 'javascript' | 'typescript' | 'python';

export type PythonCompanionKind = 'none' | 'fastapi' | 'flask' | 'scripts';

export type PackageManagerKind = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface ProjectStackDescriptor {
  id: ProjectStackId;
  order: number;
  label: string;
  shortLabel: string;
  badge: string;
  category: 'web' | 'fullstack' | 'mobile' | 'desktop';
  codegenTargetId: CodegenTargetId;
  supportedLanguages: PrimaryCodeLanguage[];
  defaultLanguage: PrimaryCodeLanguage;
  supportsPythonCompanion: boolean;
  requiresRustToolchain: boolean;
  supportedDialects: StylingDialect[];
  defaultDialect: StylingDialect;
  defaultDevPort: number;
  devCommandLabel: string;
  initStepsSummary: string[];
  keyFilesPreview: string[];
  description: string;
}

export interface DiskProjectInitSpec {
  name: string;
  targetParentDir: string; // Parent directory on disk -> creates `<targetParentDir>/<slug>`
  stackId: ProjectStackId;
  primaryLanguage: PrimaryCodeLanguage;
  primaryTarget?: CodegenTargetId;
  pythonCompanion?: PythonCompanionKind;
  stylingPreset?: StylingDialect;
  layoutMode?: 'freeform' | 'auto';
  starterPages?: WizardStarterPageId[];
  paletteId?: WizardPaletteId;
  defaultThemeMode?: 'dark' | 'light';
  includeAutomations?: boolean;
  includeBlueprint?: boolean;
  includeSqlSqlite?: boolean;
  includeThreeScene?: boolean;
  threePresetId?: ThreePresetId;
  runToolchainInit?: boolean; // Default true in UI (`wizard-checkbox-run-init`)
  initGitRepo?: boolean;
}

export interface DetectedDiskProjectInfo {
  rootDir: string;
  name: string;
  stackId: ProjectStackId;
  primaryTarget: CodegenTargetId;
  primaryLanguage: PrimaryCodeLanguage;
  pythonCompanion: PythonCompanionKind;
  stylingPreset: StylingDialect;
  packageManager: PackageManagerKind;
  hasExistingUiStudioDb: boolean;
  hasRustTauri: boolean;
  hasSqlDatabase: boolean;
  sqlFiles: string[];
  scriptFiles: string[];
  candidateUiEntryFiles: string[];
  detectedDependencies: string[];
  totalIndexedFiles?: number;
  summaryLabel: string;
}

export type DetectedProjectProfile = DetectedDiskProjectInfo;

export interface ToolchainBinaryProbe {
  name: 'node' | 'npm' | 'python' | 'rustc' | 'cargo' | 'git';
  available: boolean;
  version: string | null;
  binaryPath?: string | null;
  error?: string;
}

export interface ToolchainDoctorReport {
  checkedAt: number;
  platform: string;
  isBrowserSandbox?: boolean;
  node: ToolchainBinaryProbe;
  npm: ToolchainBinaryProbe;
  python: ToolchainBinaryProbe;
  rustc: ToolchainBinaryProbe;
  cargo: ToolchainBinaryProbe;
  git: ToolchainBinaryProbe;
}

export type ToolchainTaskKind =
  | 'init'
  | 'init_project'
  | 'dev'
  | 'dev_server'
  | 'build'
  | 'npm_install'
  | 'python_venv_sync'
  | 'python_run'
  | 'python_backend'
  | 'node_run'
  | 'cargo_check'
  | 'run_script';

export interface ToolchainTaskRequest {
  projectId: string;
  rootDiskPath?: string;
  kind: ToolchainTaskKind;
  stackId?: ProjectStackId;
  primaryLanguage?: PrimaryCodeLanguage;
  pythonCompanion?: PythonCompanionKind;
  scriptRelPath?: string;
  args?: string[];
  initGitRepo?: boolean;
}

export type RunToolchainTaskRequest = ToolchainTaskRequest;

export interface ToolchainTaskStatus {
  taskId: string;
  projectId: string;
  kind: ToolchainTaskKind;
  label: string;
  status: 'running' | 'succeeded' | 'failed' | 'stopped';
  pid?: number;
  cwd: string;
  serverUrl?: string;
  startedAt: number;
  endedAt?: number;
  exitCode?: number | null;
}

export type ToolchainStreamEvent =
  | { type: 'task_started'; task: ToolchainTaskStatus }
  | {
      type: 'stdout' | 'stderr';
      taskId: string;
      projectId: string;
      line: string;
      timestamp: number;
    }
  | { type: 'server_ready'; taskId: string; projectId: string; url: string; port?: number }
  | {
      type: 'task_completed';
      taskId: string;
      projectId: string;
      status: 'succeeded' | 'failed' | 'stopped';
      exitCode: number | null;
      durationMs: number;
    };

export const PROJECT_STACK_CATALOG: ProjectStackDescriptor[] = [
  {
    id: 'html-css-js',
    order: 1,
    label: 'HTML5 + CSS3 + JavaScript / TS',
    shortLabel: 'HTML / CSS / JS',
    badge: 'WEB STANDARD',
    category: 'web',
    codegenTargetId: 'html-vanilla',
    supportedLanguages: ['javascript', 'typescript'],
    defaultLanguage: 'javascript',
    supportsPythonCompanion: true,
    requiresRustToolchain: false,
    supportedDialects: ['vanilla-css', 'tailwind'],
    defaultDialect: 'vanilla-css',
    defaultDevPort: 5173,
    devCommandLabel: 'node scripts/dev-server.mjs',
    initStepsSummary: ['Scaffolding index.html + styles/ + scripts/automations.js'],
    keyFilesPreview: [
      'index.html',
      'styles/theme-and-sheet.css',
      'scripts/automations.js',
      'scripts/dev-server.mjs',
      'package.json',
    ],
    description:
      'Progetto web puro e immediato con HTML5 semantico, fogli CSS3 e moduli ES2024 separati pronti per il browser.',
  },
  {
    id: 'react',
    order: 2,
    label: 'React 19 (Vite 6)',
    shortLabel: 'React',
    badge: 'REACT 19',
    category: 'web',
    codegenTargetId: 'react-tsx',
    supportedLanguages: ['typescript', 'javascript'],
    defaultLanguage: 'typescript',
    supportsPythonCompanion: true,
    requiresRustToolchain: false,
    supportedDialects: ['tailwind', 'vanilla-css', 'css-modules', 'shadcn'],
    defaultDialect: 'tailwind',
    defaultDevPort: 5173,
    devCommandLabel: 'npm run dev',
    initStepsSummary: ['npm install (React 19 + Vite 6)'],
    keyFilesPreview: [
      'package.json',
      'vite.config.ts',
      'index.html',
      'src/main.tsx',
      'src/App.tsx',
      'src/scripts/automations.ts',
    ],
    description:
      'Applicazione SPA moderna con React 19, Vite 6 HMR istantaneo e supporto completo sia JSX (.js) che TSX (.ts).',
  },
  {
    id: 'angular',
    order: 3,
    label: 'Angular 19 Standalone',
    shortLabel: 'Angular',
    badge: 'ANGULAR 19',
    category: 'web',
    codegenTargetId: 'angular',
    supportedLanguages: ['typescript'],
    defaultLanguage: 'typescript',
    supportsPythonCompanion: true,
    requiresRustToolchain: false,
    supportedDialects: ['vanilla-css', 'tailwind'],
    defaultDialect: 'vanilla-css',
    defaultDevPort: 4200,
    devCommandLabel: 'npx ng serve --port 4200',
    initStepsSummary: ['npm install (@angular/core 19 + @angular/cli)'],
    keyFilesPreview: [
      'angular.json',
      'package.json',
      'tsconfig.json',
      'src/main.ts',
      'src/app/app.component.ts',
      'src/app/app.component.html',
    ],
    description:
      'Architettura enterprise Angular 19 con componenti Standalone, Signals, template tipizzati e stili incapsulati.',
  },
  {
    id: 'svelte',
    order: 4,
    label: 'Svelte 5 Runes (Vite 6)',
    shortLabel: 'Svelte',
    badge: 'SVELTE 5',
    category: 'web',
    codegenTargetId: 'svelte5',
    supportedLanguages: ['typescript', 'javascript'],
    defaultLanguage: 'typescript',
    supportsPythonCompanion: true,
    requiresRustToolchain: false,
    supportedDialects: ['vanilla-css', 'tailwind'],
    defaultDialect: 'vanilla-css',
    defaultDevPort: 5173,
    devCommandLabel: 'npm run dev',
    initStepsSummary: ['npm install (Svelte 5 + @sveltejs/vite-plugin-svelte)'],
    keyFilesPreview: [
      'package.json',
      'svelte.config.js',
      'vite.config.ts',
      'src/main.ts',
      'src/App.svelte',
      'src/scripts/automations.ts',
    ],
    description:
      'Compilatore reattivo ultra-leggero Svelte 5 con Runes ($state, $derived), CSS scoped nativo e moduli JS/TS.',
  },
  {
    id: 'htmx',
    order: 5,
    label: 'HTMX 2.x + Node.js / Python FastAPI',
    shortLabel: 'HTMX',
    badge: 'HYPERMEDIA',
    category: 'fullstack',
    codegenTargetId: 'htmx',
    supportedLanguages: ['javascript', 'typescript', 'python'],
    defaultLanguage: 'python',
    supportsPythonCompanion: true,
    requiresRustToolchain: false,
    supportedDialects: ['vanilla-css', 'tailwind'],
    defaultDialect: 'vanilla-css',
    defaultDevPort: 8000,
    devCommandLabel: 'uvicorn main:app --reload / npm run dev',
    initStepsSummary: ['Server Node Express oppure Python .venv + FastAPI + Jinja2'],
    keyFilesPreview: [
      'main.py',
      'requirements.txt',
      'templates/index.html',
      'static/styles/theme-and-sheet.css',
      'static/scripts/automations.js',
    ],
    description:
      'Applicazione ipermediale HTMX 2.x con swap parziali server-driven su backend Python FastAPI/Flask o Node.js.',
  },
  {
    id: 'react-native',
    order: 6,
    label: 'React Native (Expo SDK 52)',
    shortLabel: 'React Native',
    badge: 'MOBILE + WEB',
    category: 'mobile',
    codegenTargetId: 'react-native',
    supportedLanguages: ['typescript', 'javascript'],
    defaultLanguage: 'typescript',
    supportsPythonCompanion: true,
    requiresRustToolchain: false,
    supportedDialects: ['vanilla-css'],
    defaultDialect: 'vanilla-css',
    defaultDevPort: 8081,
    devCommandLabel: 'npx expo start --web',
    initStepsSummary: ['npm install (Expo SDK 52 + React Native + Web)'],
    keyFilesPreview: [
      'app.json',
      'package.json',
      'App.tsx',
      'src/screens/HomeScreen.tsx',
      'src/scripts/automations.ts',
    ],
    description:
      'App nativa iOS, Android e Web con Expo SDK 52, StyleSheet nativi pre-risolti e logica condivisa in JS o TS.',
  },
  {
    id: 'nextjs',
    order: 7,
    label: 'Next.js 15 (App Router)',
    shortLabel: 'Next.js',
    badge: 'FULL-STACK',
    category: 'fullstack',
    codegenTargetId: 'nextjs-app',
    supportedLanguages: ['typescript', 'javascript'],
    defaultLanguage: 'typescript',
    supportsPythonCompanion: true,
    requiresRustToolchain: false,
    supportedDialects: ['tailwind', 'css-modules', 'vanilla-css', 'shadcn'],
    defaultDialect: 'tailwind',
    defaultDevPort: 3000,
    devCommandLabel: 'npm run dev',
    initStepsSummary: ['npm install (Next.js 15 + React 19)'],
    keyFilesPreview: [
      'package.json',
      'next.config.mjs',
      'src/app/layout.tsx',
      'src/app/page.tsx',
      'src/app/globals.css',
      'src/app/api/health/route.ts',
    ],
    description:
      'Framework full-stack Next.js 15 con App Router, Server Components, Route Handlers API, Server Actions e SQL.',
  },
  {
    id: 'vite',
    order: 8,
    label: 'Vite 6 Modular SPA (JS / TS)',
    shortLabel: 'Vite',
    badge: 'VITE 6',
    category: 'web',
    codegenTargetId: 'html-vanilla',
    supportedLanguages: ['typescript', 'javascript'],
    defaultLanguage: 'typescript',
    supportsPythonCompanion: true,
    requiresRustToolchain: false,
    supportedDialects: ['vanilla-css', 'tailwind'],
    defaultDialect: 'vanilla-css',
    defaultDevPort: 5173,
    devCommandLabel: 'npm run dev',
    initStepsSummary: ['npm install (Vite 6 bundler + ES Modules)'],
    keyFilesPreview: [
      'package.json',
      'vite.config.ts',
      'index.html',
      'src/main.ts',
      'src/styles/theme-and-sheet.css',
      'src/scripts/automations.ts',
    ],
    description:
      'Web app modulare velocissima su Vite 6 senza overhead di framework pesanti, in JavaScript o TypeScript.',
  },
  {
    id: 'nodejs',
    order: 9,
    label: 'Node.js 24 Full-Stack + SQL API',
    shortLabel: 'Node.js',
    badge: 'NODE 24',
    category: 'fullstack',
    codegenTargetId: 'html-vanilla',
    supportedLanguages: ['javascript', 'typescript'],
    defaultLanguage: 'javascript',
    supportsPythonCompanion: true,
    requiresRustToolchain: false,
    supportedDialects: ['vanilla-css', 'tailwind'],
    defaultDialect: 'vanilla-css',
    defaultDevPort: 3000,
    devCommandLabel: 'node --watch src/server.js',
    initStepsSummary: ['npm install (Express + node:sqlite nativo)'],
    keyFilesPreview: [
      'package.json',
      'src/server.js',
      'src/db.js',
      'public/index.html',
      'public/styles/theme-and-sheet.css',
      'public/scripts/automations.js',
    ],
    description:
      'Server Node.js 24 con API REST, database SQLite nativo integrato (`node:sqlite`) e frontend web servito in live reload.',
  },
  {
    id: 'tauri',
    order: 10,
    label: 'Tauri v2 Desktop App',
    shortLabel: 'Tauri',
    badge: 'DESKTOP',
    category: 'desktop',
    codegenTargetId: 'tauri-v2',
    supportedLanguages: ['typescript', 'javascript'],
    defaultLanguage: 'typescript',
    supportsPythonCompanion: true,
    requiresRustToolchain: true,
    supportedDialects: ['tailwind', 'vanilla-css'],
    defaultDialect: 'tailwind',
    defaultDevPort: 1420,
    devCommandLabel: 'npx tauri dev',
    initStepsSummary: ['npm install', 'cargo check --manifest-path src-tauri/Cargo.toml'],
    keyFilesPreview: [
      'package.json',
      'src/App.tsx',
      'src-tauri/Cargo.toml',
      'src-tauri/tauri.conf.json',
      'src-tauri/capabilities/default.json',
      'src-tauri/src/lib.rs',
    ],
    description:
      'Applicazione desktop nativa ultra-leggera Tauri v2 con Web UI moderna (JS/TS) e shell nativa Windows/macOS/Linux.',
  },
  {
    id: 'rust-tauri',
    order: 11,
    label: 'Rust + Tauri v2 Full-Stack',
    shortLabel: 'Rust + Tauri',
    badge: 'RUST + TAURI',
    category: 'desktop',
    codegenTargetId: 'tauri-v2',
    supportedLanguages: ['typescript', 'javascript'],
    defaultLanguage: 'typescript',
    supportsPythonCompanion: false,
    requiresRustToolchain: true,
    supportedDialects: ['tailwind', 'vanilla-css'],
    defaultDialect: 'tailwind',
    defaultDevPort: 1420,
    devCommandLabel: 'npx tauri dev',
    initStepsSummary: ['npm install', 'cargo check --manifest-path src-tauri/Cargo.toml'],
    keyFilesPreview: [
      'src-tauri/Cargo.toml',
      'src-tauri/src/main.rs',
      'src-tauri/src/lib.rs',
      'src-tauri/src/commands.rs',
      'src-tauri/src/models.rs',
      'src-tauri/src/db.rs',
    ],
    description:
      'Architettura completa Rust + Tauri v2 con crate multi-modulo (`commands.rs`, `models.rs`, `db.rs`), SQL nativo e bridge `invoke()` tipizzato.',
  },
];

export function getProjectStackDescriptor(stackId: ProjectStackId): ProjectStackDescriptor {
  return PROJECT_STACK_CATALOG.find((s) => s.id === stackId) ?? PROJECT_STACK_CATALOG[0];
}

export function inferStackFromCodegenTarget(targetId: CodegenTargetId): ProjectStackId {
  switch (targetId) {
    case 'react-tsx':
      return 'react';
    case 'angular':
      return 'angular';
    case 'svelte5':
      return 'svelte';
    case 'htmx':
      return 'htmx';
    case 'react-native':
      return 'react-native';
    case 'nextjs-app':
      return 'nextjs';
    case 'tauri-v2':
    case 'rust-slint':
      return 'rust-tauri';
    default:
      return 'html-css-js';
  }
}

export function resolveDefaultAutomationsPath(
  stackId: ProjectStackId,
  language: PrimaryCodeLanguage,
): string {
  if (language === 'python') {
    return stackId === 'htmx' ? 'automations.py' : 'backend/automations.py';
  }
  const ext = language === 'typescript' ? 'ts' : 'js';
  switch (stackId) {
    case 'html-css-js':
      return `scripts/automations.${ext}`;
    case 'htmx':
      return `public/scripts/automations.${ext}`;
    case 'nodejs':
      return `public/scripts/automations.${ext}`;
    case 'react-native':
      return `src/scripts/automations.${ext}`;
    default:
      return `src/scripts/automations.${ext}`;
  }
}
