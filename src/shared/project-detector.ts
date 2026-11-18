import {
  getProjectStackDescriptor,
  type DetectedDiskProjectInfo,
  type PackageManagerKind,
  type PrimaryCodeLanguage,
  type ProjectStackId,
  type PythonCompanionKind,
} from './project-stacks';
import type { StylingDialect } from './ui-ir';

/**
 * Fast, Non-Destructive Existing Project Stack & Language Detector (v3.0).
 *
 * Pure TypeScript with zero Node.js imports so it runs in Electron Main,
 * Workers, Browser Mode, and unit tests.
 */

export const IGNORED_DISK_PROJECT_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  '.git',
  '.next',
  '.nuxt',
  '.angular',
  '.svelte-kit',
  '.expo',
  'dist',
  'out',
  'build',
  '.uistudio',
  '.pytest_cache',
  '.mypy_cache',
  'coverage',
]);

export interface DiskProjectFilesSummary {
  rootDir?: string;
  name?: string;
  files:
    | string[]
    | Array<{ relativePath: string; content?: string }>
    | Record<string, string>;
  textContents?: Record<string, string>;
  hasExistingUiStudioDb?: boolean;
}

export type FlexibleFilesSummaryInput =
  | DiskProjectFilesSummary
  | string[]
  | Array<{ relativePath: string; content?: string }>
  | Record<string, string>;

function normalizeRelPosix(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+/g, '/').trim();
}

function basenameFromDir(dirPath: string): string {
  const parts = dirPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || 'Progetto Disco';
}

function normalizeSummary(input: FlexibleFilesSummaryInput): {
  rootDir: string;
  explicitName?: string;
  paths: string[];
  lowerToOriginal: Map<string, string>;
  contentsByLower: Map<string, string>;
  hasExistingUiStudioDb: boolean;
} {
  let rootDir = '';
  let explicitName: string | undefined;
  let hasExistingUiStudioDb = false;
  const lowerToOriginal = new Map<string, string>();
  const contentsByLower = new Map<string, string>();

  const registerPath = (rawPath: string, content?: string) => {
    const clean = normalizeRelPosix(rawPath);
    if (!clean) return;
    const segments = clean.split('/');
    if (segments.some((seg) => IGNORED_DISK_PROJECT_DIRS.has(seg) && seg !== '.uistudio')) {
      return;
    }
    if (clean.toLowerCase() === '.uistudio/project.uistudio') {
      hasExistingUiStudioDb = true;
      return;
    }
    if (segments[0] === '.uistudio') return;

    const lower = clean.toLowerCase();
    lowerToOriginal.set(lower, clean);
    if (typeof content === 'string') {
      contentsByLower.set(lower, content);
    }
  };

  if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === 'string') {
        registerPath(item);
      } else if (item && typeof item === 'object' && 'relativePath' in item) {
        registerPath(item.relativePath, item.content);
      }
    }
  } else if (
    input &&
    typeof input === 'object' &&
    ('files' in input || 'rootDir' in input || 'textContents' in input)
  ) {
    const summary = input as DiskProjectFilesSummary;
    rootDir = summary.rootDir ?? '';
    explicitName = summary.name;
    if (summary.hasExistingUiStudioDb) hasExistingUiStudioDb = true;

    if (Array.isArray(summary.files)) {
      for (const item of summary.files) {
        if (typeof item === 'string') {
          registerPath(item);
        } else if (item && typeof item === 'object' && 'relativePath' in item) {
          registerPath(item.relativePath, item.content);
        }
      }
    } else if (summary.files && typeof summary.files === 'object') {
      for (const [k, v] of Object.entries(summary.files)) {
        registerPath(k, typeof v === 'string' ? v : undefined);
      }
    }

    if (summary.textContents) {
      for (const [k, v] of Object.entries(summary.textContents)) {
        const clean = normalizeRelPosix(k);
        if (clean && typeof v === 'string') {
          contentsByLower.set(clean.toLowerCase(), v);
          if (!lowerToOriginal.has(clean.toLowerCase())) {
            lowerToOriginal.set(clean.toLowerCase(), clean);
          }
        }
      }
    }
  } else if (input && typeof input === 'object') {
    for (const [k, v] of Object.entries(input as Record<string, string>)) {
      registerPath(k, typeof v === 'string' ? v : undefined);
    }
  }

  return {
    rootDir,
    explicitName,
    paths: Array.from(lowerToOriginal.values()),
    lowerToOriginal,
    contentsByLower,
    hasExistingUiStudioDb,
  };
}

const CANDIDATE_UI_PRIORITY: string[] = [
  'src/app.tsx',
  'src/app.jsx',
  'src/app.svelte',
  'src/app/page.tsx',
  'src/app/page.jsx',
  'src/app/app.component.html',
  'src/app/app.component.ts',
  'app.tsx',
  'app.jsx',
  'app.js',
  'public/index.html',
  'templates/index.html',
  'src/index.html',
  'index.html',
];

export function detectDiskProjectStack(summaryInput: FlexibleFilesSummaryInput): DetectedDiskProjectInfo {
  const {
    rootDir,
    explicitName,
    paths,
    lowerToOriginal,
    contentsByLower,
    hasExistingUiStudioDb,
  } = normalizeSummary(summaryInput);

  const hasFile = (relLower: string) => lowerToOriginal.has(relLower.toLowerCase());
  const hasAnyMatching = (re: RegExp) => paths.some((p) => re.test(p));
  const readText = (relLower: string) => contentsByLower.get(relLower.toLowerCase()) ?? '';

  // Parse package.json if available
  let pkgName: string | undefined;
  const depSet = new Set<string>();
  const rawPkg = readText('package.json');
  if (rawPkg) {
    try {
      const parsed = JSON.parse(rawPkg) as {
        name?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      if (typeof parsed.name === 'string' && parsed.name.trim()) {
        pkgName = parsed.name.trim();
      }
      for (const bucket of [parsed.dependencies, parsed.devDependencies, parsed.peerDependencies]) {
        if (bucket && typeof bucket === 'object') {
          for (const dep of Object.keys(bucket)) {
            depSet.add(dep.toLowerCase());
          }
        }
      }
    } catch {
      // Non-fatal malformed package.json
    }
  }

  // Parse Python requirements / pyproject
  const pyText = `${readText('requirements.txt')}\n${readText('backend/requirements.txt')}\n${readText('pyproject.toml')}`.toLowerCase();
  const hasPythonManifest =
    hasFile('requirements.txt') ||
    hasFile('backend/requirements.txt') ||
    hasFile('pyproject.toml') ||
    hasAnyMatching(/(^|\/)(main|app|automations)\.py$/i);

  if (pyText.includes('fastapi')) depSet.add('fastapi');
  if (pyText.includes('flask')) depSet.add('flask');
  if (pyText.includes('uvicorn')) depSet.add('uvicorn');

  // Parse Cargo.toml if Tauri/Rust present
  const hasRustTauri =
    hasFile('src-tauri/cargo.toml') || hasFile('src-tauri/tauri.conf.json') || hasFile('cargo.toml');
  const cargoToml = `${readText('src-tauri/cargo.toml')}\n${readText('cargo.toml')}`.toLowerCase();
  if (cargoToml.includes('rusqlite')) depSet.add('rusqlite');
  if (cargoToml.includes('sqlx')) depSet.add('sqlx');
  if (cargoToml.includes('tauri')) depSet.add('tauri');

  // Inspect HTML / template files for HTMX markers
  const combinedHtml = [
    readText('index.html'),
    readText('public/index.html'),
    readText('templates/index.html'),
  ]
    .join('\n')
    .toLowerCase();
  const hasHtmxMarkup =
    combinedHtml.includes('htmx.org') ||
    /\bhx-(get|post|put|patch|delete|swap|target)\s*=/.test(combinedHtml) ||
    hasAnyMatching(/^public\/partials\/.+\.html$/i);

  // Inspect app.json for Expo
  const rawAppJson = readText('app.json').toLowerCase();
  const hasExpoConfig = rawAppJson.includes('"expo"') || depSet.has('expo') || depSet.has('react-native');

  // 11-Stack Priority Resolution
  let stackId: ProjectStackId = 'html-css-js';

  if (hasFile('src-tauri/cargo.toml') || hasFile('src-tauri/tauri.conf.json')) {
    const isFullMultiModRust =
      hasFile('src-tauri/src/models.rs') ||
      hasFile('src-tauri/src/db.rs') ||
      hasFile('src-tauri/src/state.rs') ||
      depSet.has('rusqlite') ||
      depSet.has('sqlx');
    stackId = isFullMultiModRust ? 'rust-tauri' : 'tauri';
  } else if (hasFile('angular.json') || depSet.has('@angular/core')) {
    stackId = 'angular';
  } else if (
    hasAnyMatching(/^next\.config\.(js|mjs|cjs|ts)$/i) ||
    depSet.has('next')
  ) {
    stackId = 'nextjs';
  } else if (hasExpoConfig) {
    stackId = 'react-native';
  } else if (
    hasAnyMatching(/^svelte\.config\.(js|mjs|cjs|ts)$/i) ||
    hasAnyMatching(/\.svelte$/i) ||
    depSet.has('svelte')
  ) {
    stackId = 'svelte';
  } else if (depSet.has('react') || depSet.has('react-dom') || hasAnyMatching(/^src\/app\.(tsx|jsx)$/i)) {
    stackId = 'react';
  } else if (hasHtmxMarkup) {
    stackId = 'htmx';
  } else if (
    hasAnyMatching(/^(src\/)?server\.(js|mjs|cjs|ts)$/i) ||
    depSet.has('express') ||
    depSet.has('fastify') ||
    depSet.has('hono') ||
    depSet.has('koa')
  ) {
    stackId = 'nodejs';
  } else if (
    (hasAnyMatching(/^vite\.config\.(js|mjs|cjs|ts)$/i) || depSet.has('vite')) &&
    !hasFile('styles/main.css')
  ) {
    stackId = 'vite';
  } else if (hasPythonManifest && !hasFile('package.json')) {
    stackId = 'htmx';
  } else {
    stackId = 'html-css-js';
  }

  // Primary Language Detection
  const hasTsFiles =
    hasFile('tsconfig.json') ||
    hasAnyMatching(/\.(ts|tsx)$/i);

  let primaryLanguage: PrimaryCodeLanguage = 'javascript';
  if (stackId === 'angular') {
    primaryLanguage = 'typescript';
  } else if (stackId === 'htmx' && hasPythonManifest && !hasFile('package.json') && !hasAnyMatching(/^(src\/)?server\.[jt]s$/i)) {
    primaryLanguage = 'python';
  } else if (hasTsFiles) {
    primaryLanguage = 'typescript';
  } else if (hasPythonManifest && !hasFile('package.json')) {
    primaryLanguage = 'python';
  }

  // Python Companion Detection
  let pythonCompanion: PythonCompanionKind = 'none';
  if (hasPythonManifest) {
    if (depSet.has('fastapi') || pyText.includes('fastapi')) {
      pythonCompanion = 'fastapi';
    } else if (depSet.has('flask') || pyText.includes('flask')) {
      pythonCompanion = 'flask';
    } else {
      pythonCompanion = 'scripts';
    }
  }

  // Styling Dialect Detection
  let stylingPreset: StylingDialect = getProjectStackDescriptor(stackId).defaultDialect;
  if (hasFile('components.json')) {
    stylingPreset = 'shadcn';
  } else if (
    hasAnyMatching(/^tailwind\.config\.(js|cjs|mjs|ts)$/i) ||
    depSet.has('tailwindcss') ||
    depSet.has('@tailwindcss/vite')
  ) {
    stylingPreset = 'tailwind';
  } else if (hasAnyMatching(/\.module\.(css|scss)$/i)) {
    stylingPreset = 'css-modules';
  } else if (hasAnyMatching(/\.(css|scss)$/i)) {
    stylingPreset = 'vanilla-css';
  }

  // Package Manager Detection
  let packageManager: PackageManagerKind = 'npm';
  if (hasFile('pnpm-lock.yaml')) packageManager = 'pnpm';
  else if (hasFile('yarn.lock')) packageManager = 'yarn';
  else if (hasFile('bun.lockb') || hasFile('bun.lock')) packageManager = 'bun';

  // SQL & Script File Discovery
  const sqlFiles = paths.filter((p) => /\.(sql|sqlite|sqlite3|db|db3|schema\.sql\.json)$/i.test(p));
  const hasSqlDatabase =
    sqlFiles.length > 0 ||
    depSet.has('rusqlite') ||
    depSet.has('sqlx') ||
    depSet.has('pg') ||
    depSet.has('mysql2') ||
    depSet.has('mssql') ||
    depSet.has('better-sqlite3') ||
    hasAnyMatching(/(^|\/)db\.(js|ts|rs|py)$/i);

  const scriptFiles = paths.filter(
    (p) =>
      /\.(m?[jt]s|py)$/i.test(p) &&
      !p.endsWith('.d.ts') &&
      !/\.(config|conf)\.[cm]?[jt]s$/i.test(p) &&
      (/(^|\/)(scripts|automations)\//i.test(p) || /automations\.(js|ts|py)$/i.test(p)),
  );

  // Candidate UI Entry Files
  const candidateUiEntryFiles: string[] = [];
  for (const cand of CANDIDATE_UI_PRIORITY) {
    const orig = lowerToOriginal.get(cand);
    if (orig && !candidateUiEntryFiles.includes(orig)) {
      candidateUiEntryFiles.push(orig);
    }
  }
  for (const p of paths) {
    if (
      /\.(svelte|html|tsx|jsx)$/i.test(p) &&
      !candidateUiEntryFiles.includes(p) &&
      !/node_modules|dist|build/i.test(p)
    ) {
      candidateUiEntryFiles.push(p);
    }
  }

  const stackDesc = getProjectStackDescriptor(stackId);
  const resolvedName = explicitName || pkgName || (rootDir ? basenameFromDir(rootDir) : 'Progetto Disco');
  const langBadge =
    primaryLanguage === 'typescript' ? 'TS' : primaryLanguage === 'python' ? 'Python' : 'JS';
  const pySuffix =
    primaryLanguage !== 'python' && pythonCompanion !== 'none' ? ` + Python (${pythonCompanion})` : '';

  return {
    rootDir,
    name: resolvedName,
    stackId,
    primaryTarget: stackDesc.codegenTargetId,
    primaryLanguage,
    pythonCompanion,
    stylingPreset,
    packageManager,
    hasExistingUiStudioDb,
    hasRustTauri,
    hasSqlDatabase,
    sqlFiles,
    scriptFiles,
    candidateUiEntryFiles,
    detectedDependencies: Array.from(depSet).sort(),
    totalIndexedFiles: paths.length,
    summaryLabel: `${resolvedName} — ${stackDesc.shortLabel} (${langBadge}${pySuffix})`,
  };
}

export const detectProjectStack = detectDiskProjectStack;

export type EditorSyntaxLanguage =
  | 'javascript'
  | 'typescript'
  | 'jsx'
  | 'python'
  | 'rust'
  | 'sql'
  | 'html'
  | 'css'
  | 'svelte'
  | 'json_toml';

export interface EditorLanguageProfile {
  id: EditorSyntaxLanguage;
  badge: string;
  color: string;
  canRunNodeOrPy: 'node' | 'python' | null;
  canCargoCheck: boolean;
  canLiftToCanvas: boolean;
  isSql: boolean;
}

export function detectEditorLanguage(fileName: string): EditorLanguageProfile {
  const lower = (fileName || '').trim().toLowerCase();
  if (lower.endsWith('.tsx') || lower.endsWith('.jsx')) {
    return {
      id: 'jsx',
      badge: lower.endsWith('.tsx') ? 'TSX' : 'JSX',
      color: '#38bdf8',
      canRunNodeOrPy: null,
      canCargoCheck: false,
      canLiftToCanvas: true,
      isSql: false,
    };
  }
  if (lower.endsWith('.svelte')) {
    return {
      id: 'svelte',
      badge: 'Svelte 5',
      color: '#f97316',
      canRunNodeOrPy: null,
      canCargoCheck: false,
      canLiftToCanvas: true,
      isSql: false,
    };
  }
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return {
      id: 'html',
      badge: lower.endsWith('.component.html') ? 'Angular HTML' : 'HTML5',
      color: '#fb923c',
      canRunNodeOrPy: null,
      canCargoCheck: false,
      canLiftToCanvas: true,
      isSql: false,
    };
  }
  if (lower.endsWith('.py')) {
    return {
      id: 'python',
      badge: 'Python',
      color: '#facc15',
      canRunNodeOrPy: 'python',
      canCargoCheck: false,
      canLiftToCanvas: false,
      isSql: false,
    };
  }
  if (lower.endsWith('.rs')) {
    return {
      id: 'rust',
      badge: 'Rust',
      color: '#f87171',
      canRunNodeOrPy: null,
      canCargoCheck: true,
      canLiftToCanvas: false,
      isSql: false,
    };
  }
  if (lower.endsWith('.sql')) {
    return {
      id: 'sql',
      badge: 'SQL',
      color: '#34d399',
      canRunNodeOrPy: null,
      canCargoCheck: false,
      canLiftToCanvas: false,
      isSql: true,
    };
  }
  if (lower.endsWith('.css') || lower.endsWith('.scss')) {
    return {
      id: 'css',
      badge: 'CSS3',
      color: '#ec4899',
      canRunNodeOrPy: null,
      canCargoCheck: false,
      canLiftToCanvas: false,
      isSql: false,
    };
  }
  if (lower.endsWith('.json') || lower.endsWith('.toml') || lower.endsWith('.yaml') || lower.endsWith('.yml')) {
    return {
      id: 'json_toml',
      badge: lower.endsWith('.toml') ? 'TOML' : 'JSON',
      color: '#a78bfa',
      canRunNodeOrPy: null,
      canCargoCheck: lower === 'cargo.toml',
      canLiftToCanvas: false,
      isSql: false,
    };
  }
  if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts')) {
    return {
      id: 'typescript',
      badge: 'TypeScript',
      color: '#60a5fa',
      canRunNodeOrPy: 'node',
      canCargoCheck: false,
      canLiftToCanvas: lower.endsWith('.component.ts'),
      isSql: false,
    };
  }
  return {
    id: 'javascript',
    badge: 'JavaScript',
    color: '#fbbf24',
    canRunNodeOrPy: lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs') ? 'node' : null,
    canCargoCheck: false,
    canLiftToCanvas: false,
    isSql: false,
  };
}
