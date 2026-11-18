import { execFile, spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  realpathSync,
  readdirSync,
  readFileSync,
  statSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { inferVfsKindFromFilename } from '../shared/ipc-contract';
import { liftMarkupToSheetDocument } from '../shared/markup-importer';
import {
  detectDiskProjectStack,
  IGNORED_DISK_PROJECT_DIRS,
} from '../shared/project-detector';
import {
  buildDiskProjectScaffold,
  type DiskProjectScaffoldBundle,
  type ScaffoldTaskCommandSpec,
} from '../shared/project-scaffolder';
import {
  getProjectStackDescriptor,
  type DetectedDiskProjectInfo,
  type DiskProjectInitSpec,
  type ToolchainBinaryProbe,
  type ToolchainDoctorReport,
  type ToolchainStreamEvent,
  type ToolchainTaskRequest,
  type ToolchainTaskStatus,
} from '../shared/project-stacks';
import type { IDbWorkerService } from '../shared/worker-protocol';
import {
  buildWizardProjectSeed,
  type GeneratedWizardVfsSeedItem,
} from '../shared/wizard-templates';

/**
 * Toolchain Doctor, Two-Stage Disk Project Initializer, Non-Destructive Importer,
 * Recursive Disk Watcher & Windows-Safe Process Runner (v3.0).
 *
 * Pure Node.js (`node:child_process`, `node:fs`, `node:path`) with zero Electron imports
 * so it can be unit-tested directly in Vitest as well as wired in `src/main/index.ts`.
 */

const IS_WIN = process.platform === 'win32';

function sanitizeCmdArg(arg: string): string {
  if (/["%!^&|<>\r\n]/.test(arg)) {
    throw new Error('Il comando contiene caratteri non supportati da Windows.');
  }
  if (/^[a-zA-Z0-9_./:\\@=-]+$/.test(arg)) return arg;
  return `"${arg}"`;
}

function resolveProjectFile(root: string, path: string): string {
  const target = resolve(root, path);
  const relativePath = relative(root, target);
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error('Il file deve trovarsi nella cartella del progetto.');
  }
  return target;
}

function resolveSpawnSpec(
  cmd: string,
  args: string[],
  cwd: string,
): { file: string; finalArgs: string[] } {
  if (cmd === 'pip_venv') {
    const venvPy = IS_WIN
      ? join(cwd, '.venv', 'Scripts', 'python.exe')
      : join(cwd, '.venv', 'bin', 'python');
    if (existsSync(venvPy)) {
      return { file: venvPy, finalArgs: ['-m', 'pip', ...args] };
    }
    return { file: 'python', finalArgs: ['-m', 'pip', ...args] };
  }

  if (cmd === 'python') {
    const venvPy = IS_WIN
      ? join(cwd, '.venv', 'Scripts', 'python.exe')
      : join(cwd, '.venv', 'bin', 'python');
    if (existsSync(venvPy) && args[0] !== '-m') {
      return { file: venvPy, finalArgs: args };
    }
    if (existsSync(venvPy) && args[0] === '-m' && args[1] !== 'venv') {
      return { file: venvPy, finalArgs: args };
    }
    return { file: 'python', finalArgs: args };
  }

  // On Windows + Node 24, spawning `.cmd` shims (`npm.cmd`, `npx.cmd`) directly with shell:false throws EINVAL
  if (IS_WIN && (cmd === 'npm' || cmd === 'npx' || cmd === 'pnpm' || cmd === 'yarn')) {
    const cmdLine = [cmd, ...args.map(sanitizeCmdArg)].join(' ');
    return {
      file: process.env.ComSpec || 'cmd.exe',
      finalArgs: ['/d', '/s', '/c', cmdLine],
    };
  }

  return { file: cmd, finalArgs: args };
}

function execProbeAsync(
  name: ToolchainBinaryProbe['name'],
  cmd: string,
  args: string[],
  timeoutMs = 3500,
): Promise<ToolchainBinaryProbe> {
  return new Promise((resolveProbe) => {
    const { file, finalArgs } = resolveSpawnSpec(cmd, args, process.cwd());
    execFile(
      file,
      finalArgs,
      { encoding: 'utf8', timeout: timeoutMs, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          resolveProbe({
            name,
            available: false,
            version: null,
            binaryPath: null,
            error: err.message,
          });
          return;
        }
        const combined = `${stdout || ''}\n${stderr || ''}`.trim();
        const firstLine =
          combined
            .split(/\r?\n/)
            .map((l) => l.trim())
            .find(Boolean) ?? null;
        resolveProbe({
          name,
          available: true,
          version: firstLine,
          binaryPath: cmd,
        });
      },
    );
  });
}

let cachedDoctorReport: ToolchainDoctorReport | null = null;

export async function toolchainDoctor(forceRefresh = false): Promise<ToolchainDoctorReport> {
  if (!forceRefresh && cachedDoctorReport && Date.now() - cachedDoctorReport.checkedAt < 30_000) {
    return cachedDoctorReport;
  }

  const [nodeProbe, npmProbe, pythonPrimary, rustcProbe, cargoProbe, gitProbe] = await Promise.all([
    execProbeAsync('node', 'node', ['-v']),
    execProbeAsync('npm', 'npm', ['-v']),
    execProbeAsync('python', 'python', ['--version']),
    execProbeAsync('rustc', 'rustc', ['--version']),
    execProbeAsync('cargo', 'cargo', ['--version']),
    execProbeAsync('git', 'git', ['--version']),
  ]);

  let finalNode = nodeProbe;
  if (!finalNode.available && process.versions?.node) {
    finalNode = {
      name: 'node',
      available: true,
      version: `v${process.versions.node}`,
      binaryPath: process.execPath,
    };
  }

  let finalPython = pythonPrimary;
  if (!finalPython.available && IS_WIN) {
    finalPython = await execProbeAsync('python', 'py', ['-3', '--version']);
  }

  const report: ToolchainDoctorReport = {
    checkedAt: Date.now(),
    platform: process.platform,
    node: finalNode,
    npm: npmProbe,
    python: finalPython,
    rustc: rustcProbe,
    cargo: cargoProbe,
    git: gitProbe,
  };
  cachedDoctorReport = report;
  return report;
}

export const detectDoctor = toolchainDoctor;

// ============================================================================
// NON-DESTRUCTIVE DISK FOLDER INSPECTOR & SCAFFOLD WRITER
// ============================================================================

const MANIFEST_READ_TARGETS = new Set([
  'package.json',
  'angular.json',
  'svelte.config.js',
  'svelte.config.ts',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'app.json',
  'tsconfig.json',
  'pyproject.toml',
  'requirements.txt',
  'backend/requirements.txt',
  'cargo.toml',
  'src-tauri/cargo.toml',
  'src-tauri/tauri.conf.json',
  'index.html',
  'public/index.html',
  'templates/index.html',
  'src/index.html',
]);

export function inspectDiskDirectory(dirPath: string): DetectedDiskProjectInfo {
  const resolvedRoot = realpathSync(dirPath);
  if (!statSync(resolvedRoot).isDirectory()) {
    throw new Error('La posizione selezionata deve essere una cartella.');
  }
  const relFiles: string[] = [];
  const textContents: Record<string, string> = {};
  const hasExistingUiStudioDb = existsSync(join(resolvedRoot, '.uistudio', 'project.uistudio'));

  const walk = (currentDir: string, depth: number) => {
    if (depth > 6 || !existsSync(currentDir)) return;
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of entries) {
      if (IGNORED_DISK_PROJECT_DIRS.has(dirent.name)) continue;
      const fullPath = join(currentDir, dirent.name);
      const relPosix = relative(resolvedRoot, fullPath).replace(/\\/g, '/');
      if (dirent.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (dirent.isFile()) {
        relFiles.push(relPosix);
        if (MANIFEST_READ_TARGETS.has(relPosix.toLowerCase())) {
          try {
            const st = statSync(fullPath);
            if (st.size <= 256 * 1024) {
              textContents[relPosix] = readFileSync(fullPath, 'utf8');
            }
          } catch {
            // Ignore unreadable manifest
          }
        }
      }
    }
  };

  walk(resolvedRoot, 0);

  return detectDiskProjectStack({
    rootDir: resolvedRoot,
    name: basename(resolvedRoot) || 'Progetto Disco',
    files: relFiles,
    textContents,
    hasExistingUiStudioDb,
  });
}

export function writeScaffoldBundleToDisk(
  rootDiskPath: string,
  scaffold: DiskProjectScaffoldBundle,
): string[] {
  mkdirSync(rootDiskPath, { recursive: true });
  const resolvedRoot = realpathSync(rootDiskPath);
  const written: string[] = [];

  const targets = scaffold.files.map((file) => {
    const path = resolveProjectFile(resolvedRoot, file.relativePath);
    const parent = dirname(path);
    for (let ancestor = parent; ancestor !== resolvedRoot; ancestor = dirname(ancestor)) {
      if (existsSync(ancestor) && realpathSync(ancestor) !== ancestor) {
        throw new Error(`Percorso di progetto non valido: ${file.relativePath}`);
      }
    }
    if (existsSync(path)) throw new Error(`Il file esiste già: ${file.relativePath}`);
    return { file, path, parent };
  });
  for (const { file, path, parent } of targets) {
    mkdirSync(parent, { recursive: true });
    if (file.isBinary && file.binaryData) {
      writeFileSync(path, Buffer.from(file.binaryData), { flag: 'wx' });
    } else {
      writeFileSync(path, file.content, { encoding: 'utf8', flag: 'wx' });
    }
    written.push(file.relativePath);
  }
  return written;
}

function killProcessTree(pid: number | undefined, child?: ChildProcess): Promise<void> {
  return new Promise((resolveKill) => {
    if (!pid) {
      try {
        child?.kill('SIGTERM');
      } catch {
        // ignore
      }
      resolveKill();
      return;
    }

    if (IS_WIN) {
      execFile(
        'taskkill',
        ['/PID', String(pid), '/T', '/F'],
        { windowsHide: true, timeout: 4000 },
        (error) => {
          if (error) child?.kill();
          resolveKill();
        },
      );
      return;
    }

    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        child?.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
    resolveKill();
  });
}

// ============================================================================
// TOOLCHAIN LIVE PROCESS RUNNER & RECURSIVE DISK WATCHER SERVICE
// ============================================================================

interface ActiveTaskRecord {
  status: ToolchainTaskStatus;
  child: ChildProcess | null;
  stopRequested: boolean;
}

export interface ToolchainRunnerOptions {
  onStreamEvent?: (event: ToolchainStreamEvent) => void;
  onDiskVfsChanged?: (event: { projectId: string; paths: string[] }) => void;
}

export class ToolchainRunnerService {
  private readonly activeTasks = new Map<string, ActiveTaskRecord>();
  private watcher: FSWatcher | null = null;
  private watchedProjectId: string | null = null;
  private watchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChangedPaths = new Set<string>();
  private readonly onStreamEvent?: (event: ToolchainStreamEvent) => void;
  private readonly onDiskVfsChanged?: (event: { projectId: string; paths: string[] }) => void;

  public constructor(opts: ToolchainRunnerOptions = {}) {
    this.onStreamEvent = opts.onStreamEvent;
    this.onDiskVfsChanged = opts.onDiskVfsChanged;
  }

  private emit(ev: ToolchainStreamEvent): void {
    this.onStreamEvent?.(ev);
  }

  public checkDoctor(forceRefresh = false): Promise<ToolchainDoctorReport> {
    return toolchainDoctor(forceRefresh);
  }

  public listActiveTasks(projectId?: string): ToolchainTaskStatus[] {
    const all = Array.from(this.activeTasks.values()).map((r) => ({ ...r.status }));
    return projectId ? all.filter((t) => t.projectId === projectId) : all;
  }

  public watchProjectDirectory(
    projectId: string,
    rootDiskPath: string,
    dbWorker?: IDbWorkerService,
  ): void {
    this.unwatchDirectory();
    if (!rootDiskPath || !existsSync(rootDiskPath)) return;
    this.watchedProjectId = projectId;

    try {
      this.watcher = watch(rootDiskPath, { recursive: true }, (_eventType, filename) => {
        if (!filename || this.watchedProjectId !== projectId) return;
        const norm = String(filename).replace(/\\/g, '/');
        const segments = norm.split('/');
        if (segments.some((s) => IGNORED_DISK_PROJECT_DIRS.has(s))) return;

        this.pendingChangedPaths.add(norm);
        if (this.watchDebounceTimer) clearTimeout(this.watchDebounceTimer);
        this.watchDebounceTimer = setTimeout(async () => {
          const paths = Array.from(this.pendingChangedPaths);
          this.pendingChangedPaths.clear();
          if (paths.length === 0) return;
          try {
            await dbWorker?.reconcileDiskPaths(projectId, paths);
          } catch {
            // ignore transient sqlite busy
          }
          if (this.watchedProjectId === projectId) this.onDiskVfsChanged?.({ projectId, paths });
        }, 220);
      });
      this.watcher.on('error', () => {
        // Ignore non-fatal OS watcher errors
      });
    } catch {
      // Recursive watch unsupported on some network mounts
    }
  }

  public unwatchDirectory(): void {
    if (this.watchDebounceTimer) {
      clearTimeout(this.watchDebounceTimer);
      this.watchDebounceTimer = null;
    }
    this.pendingChangedPaths.clear();
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        // ignore
      }
      this.watcher = null;
    }
    this.watchedProjectId = null;
  }

  private buildStepPipeline(req: ToolchainTaskRequest, cwd: string): {
    label: string;
    steps: ScaffoldTaskCommandSpec[];
  } {
    const stackId = req.stackId ?? 'html-css-js';
    const lang = req.primaryLanguage ?? getProjectStackDescriptor(stackId).defaultLanguage;
    const pyComp = req.pythonCompanion ?? 'none';
    const pkgPath = join(cwd, 'package.json');
    const hasPackage = existsSync(pkgPath);
    type PackageManifest = {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    let pkg: PackageManifest | undefined;
    if (hasPackage && ['init', 'init_project', 'build', 'dev', 'dev_server'].includes(req.kind)) {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageManifest;
    }
    const packageManager = existsSync(join(cwd, 'pnpm-lock.yaml')) ? 'pnpm'
      : existsSync(join(cwd, 'yarn.lock')) ? 'yarn'
      : existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bun.lockb')) ? 'bun'
      : 'npm';
    const installStep = {
      label: `${packageManager} install`,
      cmd: packageManager,
      args: packageManager === 'npm' ? ['install', '--no-audit', '--no-fund'] : ['install'],
    };

    switch (req.kind) {
      case 'init':
      case 'init_project': {
        const steps: ScaffoldTaskCommandSpec[] = [];
        if (Object.keys(pkg?.dependencies ?? {}).length + Object.keys(pkg?.devDependencies ?? {}).length > 0) {
          steps.push(installStep);
        }
        const reqTxt = existsSync(join(cwd, 'requirements.txt'))
          ? 'requirements.txt'
          : existsSync(join(cwd, 'backend', 'requirements.txt'))
            ? 'backend/requirements.txt'
            : null;
        if (reqTxt) {
          steps.push(
            { label: 'python -m venv .venv', cmd: 'python', args: ['-m', 'venv', '.venv'] },
            { label: `pip install -r ${reqTxt}`, cmd: 'pip_venv', args: ['install', '-r', reqTxt] },
          );
        }
        if (existsSync(join(cwd, 'src-tauri', 'Cargo.toml'))) {
          steps.push({
            label: 'cargo check (src-tauri)',
            cmd: 'cargo',
            args: ['check', '--manifest-path', 'src-tauri/Cargo.toml'],
          });
        }
        if (req.initGitRepo && !existsSync(join(cwd, '.git'))) {
          steps.push({ label: 'git init', cmd: 'git', args: ['init'] });
        }
        if (steps.length === 0) {
          steps.push({ label: 'node -v (verifica ambiente)', cmd: 'node', args: ['-v'] });
        }
        return { label: `Inizializzazione Toolchain (${stackId})`, steps };
      }

      case 'npm_install':
        if (!hasPackage) throw new Error('package.json non trovato.');
        return {
          label: installStep.label,
          steps: [installStep],
        };

      case 'python_venv_sync': {
        const reqFile = existsSync(join(cwd, 'requirements.txt'))
          ? 'requirements.txt'
          : 'backend/requirements.txt';
        return {
          label: 'Python .venv + pip install',
          steps: [
            { label: 'python -m venv .venv', cmd: 'python', args: ['-m', 'venv', '.venv'] },
            { label: 'pip install', cmd: 'pip_venv', args: ['install', '-r', reqFile] },
          ],
        };
      }

      case 'cargo_check':
        return {
          label: 'cargo check',
          steps: [
            {
              label: 'cargo check',
              cmd: 'cargo',
              args: existsSync(join(cwd, 'src-tauri', 'Cargo.toml'))
                ? ['check', '--manifest-path', 'src-tauri/Cargo.toml']
                : ['check'],
            },
          ],
        };

      case 'build': {
        if (pkg?.scripts?.build) {
          const script = pkg.scripts['tauri:build'] && (stackId === 'tauri' || stackId === 'rust-tauri') ? 'tauri:build' : 'build';
          const label = `${packageManager} run ${script}`;
          return {
            label,
            steps: [{ label, cmd: packageManager, args: ['run', script] }],
          };
        }
        if (existsSync(join(cwd, 'src-tauri', 'Cargo.toml'))) {
          return {
            label: 'cargo build',
            steps: [
              {
                label: 'cargo build',
                cmd: 'cargo',
                args: ['build', '--manifest-path', 'src-tauri/Cargo.toml'],
              },
            ],
          };
        }
        throw new Error('Il progetto non dispone di un comando di build.');
      }

      case 'python_backend': {
        const module = existsSync(join(cwd, 'backend', 'main.py')) ? 'backend.main' : 'main';
        if (pyComp === 'flask') {
          return {
            label: 'Python Flask Backend (:8000)',
            steps: [{ label: 'python flask', cmd: 'python', args: ['-m', module, ...(req.args ?? [])] }],
          };
        }
        return {
          label: 'Python FastAPI Backend (:8000)',
          steps: [
            {
              label: 'uvicorn',
              cmd: 'python',
              args: ['-m', 'uvicorn', `${module}:app`, '--reload', '--port', '8000', ...(req.args ?? [])],
            },
          ],
        };
      }

      case 'python_run': {
        const targetPy = req.scriptRelPath || 'main.py';
        const scriptPath = realpathSync(resolveProjectFile(cwd, targetPy));
        resolveProjectFile(cwd, scriptPath);
        return {
          label: `Python: ${targetPy}`,
          steps: [{ label: `python ${targetPy}`, cmd: 'python', args: [scriptPath, ...(req.args ?? [])] }],
        };
      }

      case 'node_run':
      case 'run_script': {
        const rel = req.scriptRelPath || 'scripts/automations.js';
        const scriptPath = realpathSync(resolveProjectFile(cwd, rel));
        resolveProjectFile(cwd, scriptPath);
        const ext = extname(rel).toLowerCase();
        if (ext === '.py') {
          return {
            label: `Python: ${rel}`,
            steps: [{ label: `python ${rel}`, cmd: 'python', args: [scriptPath, ...(req.args ?? [])] }],
          };
        }
        if (ext === '.ts') {
          return {
            label: `Node TS: ${rel}`,
            steps: [
              {
                label: `node ${rel}`,
                cmd: 'node',
                args: ['--experimental-strip-types', scriptPath, ...(req.args ?? [])],
              },
            ],
          };
        }
        return {
          label: `Node: ${rel}`,
          steps: [{ label: `node ${rel}`, cmd: 'node', args: [scriptPath, ...(req.args ?? [])] }],
        };
      }

      case 'dev':
      case 'dev_server': {
        const script = (stackId === 'tauri' || stackId === 'rust-tauri') && pkg?.scripts?.['tauri:dev']
          ? 'tauri:dev'
          : pkg?.scripts?.dev ? 'dev' : pkg?.scripts?.start ? 'start' : null;
        if (script) {
          const label = `${packageManager} run ${script}`;
          const extraArgs = req.args?.length ? [...(packageManager === 'npm' ? ['--'] : []), ...req.args] : [];
          return { label, steps: [{ label, cmd: packageManager, args: ['run', script, ...extraArgs] }] };
        }
        const scaffoldPreview = buildDiskProjectScaffold({
          name: basename(cwd) || 'app',
          targetParentDir: dirname(cwd),
          stackId,
          primaryLanguage: lang,
          pythonCompanion: pyComp,
        });
        if ((scaffoldPreview.devCommand.cmd === 'npm' || scaffoldPreview.devCommand.cmd === 'npx')) {
          throw new Error('Definisci uno script dev o start in package.json.');
        }
        return {
          label: `Dev Server (${scaffoldPreview.devCommand.label})`,
          steps: [
            {
              label: scaffoldPreview.devCommand.label,
              cmd: scaffoldPreview.devCommand.cmd,
              args: [...scaffoldPreview.devCommand.args, ...(req.args ?? [])],
            },
          ],
        };
      }
    }
    throw new Error('Tipo di attività toolchain non riconosciuto.');
  }

  public async runTask(req: ToolchainTaskRequest): Promise<{ taskId: string }> {
    if (!req.rootDiskPath) throw new Error('Collega il progetto a una cartella su disco.');
    const cwd = realpathSync(req.rootDiskPath);
    if (!statSync(cwd).isDirectory()) throw new Error('La cartella di progetto non è valida.');
    const taskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const { label, steps } = this.buildStepPipeline(req, cwd);

    const status: ToolchainTaskStatus = {
      taskId,
      projectId: req.projectId,
      kind: req.kind,
      label,
      status: 'running',
      cwd,
      startedAt: Date.now(),
    };

    const record: ActiveTaskRecord = {
      status,
      child: null,
      stopRequested: false,
    };
    this.activeTasks.set(taskId, record);
    this.emit({ type: 'task_started', task: { ...status } });

    void this.executePipelineAsync(record, steps);
    return { taskId };
  }

  private async executePipelineAsync(
    record: ActiveTaskRecord,
    steps: ScaffoldTaskCommandSpec[],
  ): Promise<void> {
    const { taskId, projectId, cwd, startedAt } = record.status;
    let finalExitCode: number | null = 0;

    for (const step of steps) {
      if (record.stopRequested) break;

      const stepCwd = step.cwdRel ? join(cwd, step.cwdRel) : cwd;
      this.emit({
        type: 'stdout',
        taskId,
        projectId,
        line: `$ ${step.cmd} ${step.args.join(' ')}`,
        timestamp: Date.now(),
      });

      const code = await new Promise<number | null>((resolveStep) => {
        let child: ChildProcess;
        try {
          const { file, finalArgs } = resolveSpawnSpec(step.cmd, step.args, stepCwd);
          child = spawn(file, finalArgs, {
            cwd: stepCwd,
            windowsHide: true,
            detached: !IS_WIN,
            env: {
              ...process.env,
              BROWSER: 'none',
              FORCE_COLOR: '0',
              CI: ['init', 'init_project', 'npm_install'].includes(record.status.kind) ? 'true' : process.env.CI,
            },
          });
        } catch (spawnErr) {
          this.emit({
            type: 'stderr',
            taskId,
            projectId,
            line: `Errore avvio comando "${step.cmd}": ${spawnErr instanceof Error ? spawnErr.message : String(spawnErr)}`,
            timestamp: Date.now(),
          });
          resolveStep(1);
          return;
        }

        record.child = child;
        record.status.pid = child.pid;

        const streamBuffer = (stream: ChildProcess['stdout'], type: 'stdout' | 'stderr') => {
          let leftover = '';
          const emitLines = (lines: string[]) => {
            for (const rawLine of lines) {
              const cleanLine = rawLine.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').trimEnd();
              if (!cleanLine) continue;
              this.emit({
                type,
                taskId,
                projectId,
                line: cleanLine,
                timestamp: Date.now(),
              });
              const urlMatch = cleanLine.match(/https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)\S*/i);
              if (urlMatch && !record.status.serverUrl) {
                const detectedUrl = urlMatch[0].replace(/[.,;)]+$/, '');
                record.status.serverUrl = detectedUrl;
                this.emit({
                  type: 'server_ready',
                  taskId,
                  projectId,
                  url: detectedUrl,
                  port: Number(urlMatch[1]),
                });
              }
            }
          };
          stream?.setEncoding('utf8');
          stream?.on('data', (chunk: string) => {
            const lines = (leftover + chunk).split(/\r?\n/);
            leftover = lines.pop() ?? '';
            emitLines(lines);
          });
          return () => emitLines([leftover]);
        };

        const flushOut = streamBuffer(child.stdout, 'stdout');
        const flushErr = streamBuffer(child.stderr, 'stderr');
        child.on('error', (err) => {
          this.emit({
            type: 'stderr',
            taskId,
            projectId,
            line: `Errore processo: ${err.message}`,
            timestamp: Date.now(),
          });
        });
        child.on('close', (exitCode) => {
          flushOut();
          flushErr();
          record.child = null;
          delete record.status.pid;
          resolveStep(exitCode);
        });
      });

      finalExitCode = code;
      if (record.stopRequested || code !== 0) {
        break;
      }
    }

    const finalStatus: ToolchainTaskStatus['status'] = record.stopRequested
      ? 'stopped'
      : finalExitCode === 0
        ? 'succeeded'
        : 'failed';

    record.status.status = finalStatus;
    record.status.exitCode = finalExitCode;
    record.status.endedAt = Date.now();
    this.activeTasks.delete(taskId);

    this.emit({
      type: 'task_completed',
      taskId,
      projectId,
      status: finalStatus,
      exitCode: finalExitCode,
      durationMs: Math.max(1, Date.now() - startedAt),
    });
  }

  public async stopTask(taskId: string): Promise<void> {
    const record = this.activeTasks.get(taskId);
    if (!record) return;
    record.stopRequested = true;
    await killProcessTree(record.child?.pid, record.child ?? undefined);
  }

  public async stopAllTasks(): Promise<void> {
    const ids = Array.from(this.activeTasks.keys());
    await Promise.all(ids.map((id) => this.stopTask(id)));
  }
}

// ============================================================================
// HIGH-LEVEL DISK PROJECT CREATOR & NON-DESTRUCTIVE IMPORTER ORCHESTRATORS
// ============================================================================

export async function createAndInitDiskProjectWithRunner(
  spec: DiskProjectInitSpec,
  deps: {
    dbWorker: IDbWorkerService;
    runner: ToolchainRunnerService;
    defaultProjectsParentDir: string;
  },
) {
  const scaffold = buildDiskProjectScaffold(spec);
  const parentDir = spec.targetParentDir?.trim() || deps.defaultProjectsParentDir;
  const rootDiskPath = resolve(join(parentDir, scaffold.slug));
  mkdirSync(dirname(rootDiskPath), { recursive: true });
  try {
    mkdirSync(rootDiskPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new Error(`La cartella del progetto esiste già: ${rootDiskPath}`);
  }

  // Stage 1: Write deterministic 11-stack scaffold files onto disk (including valid RGBA Tauri icons)
  writeScaffoldBundleToDisk(rootDiskPath, scaffold);

  const stackMeta = getProjectStackDescriptor(spec.stackId);
  const seed = buildWizardProjectSeed({
    name: scaffold.projectName,
    category:
      stackMeta.category === 'desktop'
        ? 'desktop'
        : stackMeta.category === 'mobile'
          ? 'mobile'
          : 'web',
    primaryTarget: spec.primaryTarget ?? scaffold.codegenTargetId,
    stylingPreset: scaffold.stylingPreset,
    layoutMode: spec.layoutMode ?? 'freeform',
    starterPages: spec.starterPages?.length ? spec.starterPages : ['home'],
    includeTsScript: false,
    includeBlueprint: Boolean(spec.includeBlueprint),
    includeThreeScene: Boolean(spec.includeThreeScene),
    threePresetId: spec.threePresetId,
    paletteId: spec.paletteId ?? 'dark-pro',
    defaultThemeMode: spec.defaultThemeMode ?? 'dark',
    rootDiskPath,
    seedDemoContent: false,
  });

  // Merge scaffold text files into VFS seed items (ensuring parent folders exist in VFS)
  const existingVirtualPaths = new Set(
    seed.vfsItems.map((it) => it.virtualPath.replace(/\\/g, '/').replace(/^\/+/, '')),
  );
  const folderKeyByRel = new Map<string, string>();
  for (const it of seed.vfsItems) {
    if (it.entryKind === 'folder') {
      folderKeyByRel.set(it.virtualPath.replace(/^\/+/, ''), it.key);
    }
  }

  const ensureFolderChain = (dirRelPosix: string): string | null => {
    if (!dirRelPosix || dirRelPosix === '.') return null;
    if (folderKeyByRel.has(dirRelPosix)) return folderKeyByRel.get(dirRelPosix)!;
    const parts = dirRelPosix.split('/').filter(Boolean);
    let currentRel = '';
    let parentKey: string | null = null;
    for (const seg of parts) {
      currentRel = currentRel ? `${currentRel}/${seg}` : seg;
      let key = folderKeyByRel.get(currentRel);
      if (!key) {
        key = `scaf_dir_${currentRel.replace(/[^a-zA-Z0-9_]/g, '_')}`;
        folderKeyByRel.set(currentRel, key);
        seed.vfsItems.push({
          key,
          parentKey,
          name: seg,
          virtualPath: `/${currentRel}`,
          entryKind: 'folder',
        });
      }
      parentKey = key;
    }
    return parentKey;
  };

  for (const scafFile of scaffold.files) {
    if (scafFile.isBinary) continue;
    const rel = scafFile.relativePath.replace(/^\/+/, '');
    if (existingVirtualPaths.has(rel)) {
      const target = seed.vfsItems.find((it) => it.virtualPath.replace(/^\/+/, '') === rel);
      if (target) target.contentText = scafFile.content;
      continue;
    }
    const slashIdx = rel.lastIndexOf('/');
    const dirRel = slashIdx > 0 ? rel.slice(0, slashIdx) : '';
    const fileName = slashIdx >= 0 ? rel.slice(slashIdx + 1) : rel;
    const parentKey = ensureFolderChain(dirRel);
    const inferredKind = inferVfsKindFromFilename(fileName, rel);
    const vfsEntryKind: GeneratedWizardVfsSeedItem['entryKind'] =
      inferredKind === 'style_file' ||
      inferredKind === 'script_file' ||
      inferredKind === 'blueprint_graph' ||
      inferredKind === 'three_scene'
        ? inferredKind
        : 'source_file';

    seed.vfsItems.push({
      key: `scaf_file_${rel.replace(/[^a-zA-Z0-9_]/g, '_')}`,
      parentKey,
      name: fileName,
      virtualPath: `/${rel}`,
      entryKind: vfsEntryKind,
      contentText: scafFile.content,
    });
    existingVirtualPaths.add(rel);
  }

  const bootstrap = await deps.dbWorker.createProjectFromSeed(seed, {
    layoutMode: spec.layoutMode ?? 'freeform',
    paletteId: spec.paletteId ?? 'dark-pro',
    defaultThemeMode: spec.defaultThemeMode ?? 'dark',
    rootDiskPath,
    stackId: spec.stackId,
    primaryLanguage: scaffold.primaryLanguage,
    pythonCompanion: scaffold.pythonCompanion,
  });

  await deps.dbWorker.reconcileDiskPaths(bootstrap.project.id);

  // Link primary automations script module onto initial sheet
  const refreshed = await deps.dbWorker.getCurrentProject();
  const autoVfs = refreshed.vfsTree.find(
    (n) =>
      n.virtualPath.replace(/^\/+/, '') === scaffold.automationsRelPath ||
      n.diskRelPath === scaffold.automationsRelPath,
  );
  if (spec.includeAutomations !== false && autoVfs && refreshed.initialSheet) {
    await deps.dbWorker.commitPatchBatch({
      projectId: refreshed.project.id,
      sheetId: refreshed.initialSheet.sheetId,
      actor: 'code_sync',
      label: 'Link initial automations script',
      ops: [
        {
          op: 'update_sheet_meta',
          linkedScripts: [
            {
              vfsEntryId: autoVfs.id,
              relativePath: scaffold.automationsRelPath,
              language: scaffold.primaryLanguage,
              loadStrategy: scaffold.primaryLanguage === 'python' ? 'backend-route' : 'module',
              autoInitOnLoad: true,
              scope: 'sheet',
            },
          ],
        },
      ],
    });
  }

  deps.runner.watchProjectDirectory(refreshed.project.id, rootDiskPath, deps.dbWorker);

  // Stage 2: Asynchronous Toolchain Initialization (`npm install` / `.venv` / `cargo check`)
  if (spec.runToolchainInit !== false && scaffold.initSteps.length > 0) {
    await deps.runner.runTask({
      projectId: refreshed.project.id,
      rootDiskPath,
      kind: 'init',
      stackId: spec.stackId,
      primaryLanguage: scaffold.primaryLanguage,
      pythonCompanion: scaffold.pythonCompanion,
      initGitRepo: spec.initGitRepo,
    });
  }

  return deps.dbWorker.getCurrentProject();
}

export async function openExistingDiskProjectWithRunner(
  dirPath: string,
  deps: {
    dbWorker: IDbWorkerService;
    runner: ToolchainRunnerService;
  },
) {
  const resolvedDir = realpathSync(dirPath);
  if (!statSync(resolvedDir).isDirectory()) {
    throw new Error('La posizione selezionata deve essere una cartella.');
  }
  const sidecarPath = join(resolvedDir, '.uistudio', 'project.uistudio');

  if (existsSync(sidecarPath)) {
    const opened = await deps.dbWorker.openProject(resolvedDir);
    await deps.dbWorker.reconcileDiskPaths(opened.project.id);
    deps.runner.watchProjectDirectory(opened.project.id, resolvedDir, deps.dbWorker);
    return deps.dbWorker.getCurrentProject();
  }

  // Non-destructive detection & UI Lift (writes ZERO demo files into user repository!)
  const detected = inspectDiskDirectory(resolvedDir);
  let liftedInitialSheet = null;
  let linkedEntryRelPath: string | null = null;

  for (const candRel of detected.candidateUiEntryFiles) {
    const fullEntry = join(resolvedDir, candRel);
    if (!existsSync(fullEntry)) continue;
    try {
      const st = statSync(fullEntry);
      if (st.size > 256 * 1024) continue;
      const rawMarkup = readFileSync(fullEntry, 'utf8');
      const sheetName =
        basename(candRel, extname(candRel)).replace(/[^a-zA-Z0-9_]/g, '') || 'MainView';
      const lifted = liftMarkupToSheetDocument({
        projectId: 'proj_pending',
        sheetName: sheetName.charAt(0).toUpperCase() + sheetName.slice(1),
        markup: rawMarkup,
      });
      if (lifted) {
        liftedInitialSheet = lifted;
        linkedEntryRelPath = candRel;
        break;
      }
    } catch {
      // Try next candidate
    }
  }

  const imported = await deps.dbWorker.importExistingDiskProject({
    rootDiskPath: resolvedDir,
    detected,
    liftedInitialSheet,
    linkedEntryRelPath,
  });

  deps.runner.watchProjectDirectory(imported.project.id, resolvedDir, deps.dbWorker);
  return imported;
}
