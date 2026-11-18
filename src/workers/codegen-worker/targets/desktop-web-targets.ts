import {
  BUILTIN_TARGET_DESCRIPTORS,
  type CodegenTargetPlugin,
  type EmittedCodeFile,
  type StylingDialect,
  type UIRIpcCommandSpec,
} from '@shared/ui-ir';
import { SourceMapWriter } from '../code-writer';
import {
  buildCssClassMap,
  buildStylesheetWithSourceMap,
  escapeDoubleQuoted,
  toCamelCase,
  toKebabCase,
  toPascalCase,
  toSnakeCase,
} from '../style-helpers';
import {
  analyzeReactSubtreeUsage,
  countUsedReactStateHooks,
  emitCleanReactStateHooks,
  emitReactBlueprintHelper,
  emitReactScriptImports,
  hasRepeatCollection,
  renderJsxSubtree,
} from './web-targets';
import {
  patchTauriRustCommandsRegion,
  patchTauriRustHandlersRegion,
} from './script-module-helpers';

export { patchTauriRustCommandsRegion, patchTauriRustHandlersRegion };

const electronDescriptor = BUILTIN_TARGET_DESCRIPTORS.find((d) => d.id === 'electron-target')!;
const tauriDescriptor = BUILTIN_TARGET_DESCRIPTORS.find((d) => d.id === 'tauri-v2')!;
const wailsDescriptor = BUILTIN_TARGET_DESCRIPTORS.find((d) => d.id === 'go-wails')!;

function ensureIpcCommands(cmds: UIRIpcCommandSpec[]): UIRIpcCommandSpec[] {
  if (cmds.length > 0) return cmds;
  return [
    {
      name: 'get_app_status',
      args: [],
      returnType: 'string',
      description: 'Health check IPC command.',
    },
  ];
}

// ============================================================================
// 8. ELECTRON DESKTOP APP (`electron-target`)
// ============================================================================

export const electronTargetPlugin: CodegenTargetPlugin = {
  descriptor: electronDescriptor,
  emitSnippet(node, ir, opts) {
    const dialect: StylingDialect = opts.dialect === 'vanilla-css' ? 'vanilla-css' : 'tailwind';
    const classMap = buildCssClassMap(node);
    const w = new SourceMapWriter(2);
    renderJsxSubtree(w, node, ir, { dialect, classMap, isRoot: false, electronDragStyle: true });
    return w.toEmittedFile(`${toPascalCase(node.name)}.tsx`, 'tsx', true);
  },
  emitComponent(comp, ir, opts) {
    const dialect: StylingDialect =
      opts.dialect === 'vanilla-css' || opts.dialect === 'css-modules' ? opts.dialect : 'tailwind';
    const mode = opts.mode ?? 'bundle';
    const classMap = buildCssClassMap(comp.root);
    const chrome = ir.windowChrome ?? {
      title: comp.name,
      width: 1120,
      height: 820,
      minWidth: 640,
      minHeight: 480,
      frameless: false,
      transparent: false,
      backdrop: 'none' as const,
      resizable: true,
    };
    const isJs = opts.scriptLanguage === 'javascript';
    const ext = isJs ? 'jsx' : 'tsx';
    const entryPath = `src/renderer/${comp.name}.${ext}`;
    const ipcList = ensureIpcCommands(comp.ipcCommands);
    const usage = analyzeReactSubtreeUsage(comp.root, comp, { enableControlledInputs: true });
    const needsUseState = countUsedReactStateHooks(comp.stateVars, usage) > 0;

    // 1. Renderer TSX/JSX Component (Entry with SourceMap)
    const uiWriter = new SourceMapWriter(2);
    uiWriter.line(`import React${needsUseState ? ', { useState }' : ''} from 'react';`);
    if (dialect === 'vanilla-css') {
      uiWriter.line(`import './${comp.name}.css';`);
    } else if (dialect === 'css-modules') {
      uiWriter.line(`import styles from './${comp.name}.module.css';`);
    }
    emitReactScriptImports(uiWriter, usage, '../scripts/handlers', {
      root: comp.root,
      ir,
      fromFilePath: entryPath,
    });
    uiWriter.blank();
    uiWriter.line(`export function ${comp.name}() {`);
    uiWriter.indent();
    emitCleanReactStateHooks(uiWriter, comp.stateVars, usage, !isJs);
    emitReactBlueprintHelper(uiWriter, usage, !isJs);

    const repInfo = hasRepeatCollection(comp.root);
    if (repInfo && !comp.stateVars.some((s) => toCamelCase(s.name) === repInfo.expr)) {
      const itemsJson = (repInfo.sampleTexts.length > 0 ? repInfo.sampleTexts : ['Workstation Module', 'Studio Keyboard']).map(
        (txt, i) => `{ id: '${i + 1}', label: '${txt.replace(/'/g, "\\'")}' }`,
      );
      uiWriter.line(`const ${repInfo.expr} = [${itemsJson.join(', ')}];`);
    }

    for (const ipc of ipcList) {
      const ipcUse = usage.usedIpcCommands.get(ipc.name);
      if (!ipcUse) continue;
      const fnName = `handle${toPascalCase(ipc.name)}`;
      const camelIpc = toCamelCase(ipc.name);
      const callArgs = ipc.args.map((a) => (a.type === 'number' ? '0' : `'pdf'`)).join(', ');
      uiWriter.line(`const ${fnName} = async () => {`);
      uiWriter.indent();
      uiWriter.line(`const res = await window.desktopApi?.${camelIpc}(${callArgs});`);
      if (ipcUse.resultStateTarget) {
        uiWriter.line(`if (res) set${toPascalCase(ipcUse.resultStateTarget)}(res.channel);`);
      } else {
        uiWriter.line('console.info("IPC response:", res);');
      }
      uiWriter.dedent();
      uiWriter.line('};');
    }

    uiWriter.line('return (');
    uiWriter.indent();
    renderJsxSubtree(uiWriter, comp.root, ir, {
      dialect,
      classMap,
      isRoot: true,
      electronDragStyle: true,
      controlledInputStateByNode: usage.controlledInputStateByNode,
    });
    uiWriter.dedent();
    uiWriter.line(');');
    uiWriter.dedent();
    uiWriter.line('}');
    uiWriter.blank();
    uiWriter.line(`export default ${comp.name};`);

    // 2. Electron Main Process (`src/main/main.ts`)
    const mainWriter = new SourceMapWriter(2);
    mainWriter.line("import { app, BrowserWindow, ipcMain } from 'electron';");
    mainWriter.line("import { join } from 'node:path';");
    mainWriter.blank();
    mainWriter.line('function createMainWindow(): BrowserWindow {');
    mainWriter.indent();
    mainWriter.line('const win = new BrowserWindow({');
    mainWriter.indent();
    mainWriter.line(`title: ${JSON.stringify(chrome.title)},`);
    mainWriter.line(`width: ${chrome.width},`);
    mainWriter.line(`height: ${chrome.height},`);
    if (chrome.minWidth) mainWriter.line(`minWidth: ${chrome.minWidth},`);
    if (chrome.minHeight) mainWriter.line(`minHeight: ${chrome.minHeight},`);
    mainWriter.line(`frame: ${!chrome.frameless},`);
    mainWriter.line(`transparent: ${chrome.transparent},`);
    mainWriter.line(`resizable: ${chrome.resizable},`);
    if (chrome.backdrop && chrome.backdrop !== 'none' && (chrome.backdrop === 'mica' || chrome.backdrop === 'acrylic')) {
      mainWriter.line(`backgroundMaterial: '${chrome.backdrop}',`);
    }
    mainWriter.line('webPreferences: {');
    mainWriter.indent();
    mainWriter.line("preload: join(__dirname, '../preload/preload.js'),");
    mainWriter.line('contextIsolation: true,');
    mainWriter.line('nodeIntegration: false,');
    mainWriter.line('sandbox: true,');
    mainWriter.dedent();
    mainWriter.line('},');
    mainWriter.dedent();
    mainWriter.line('});');
    mainWriter.blank();
    mainWriter.line('if (process.env.ELECTRON_RENDERER_URL) {');
    mainWriter.indent();
    mainWriter.line('win.loadURL(process.env.ELECTRON_RENDERER_URL);');
    mainWriter.dedent();
    mainWriter.line('} else {');
    mainWriter.indent();
    mainWriter.line("win.loadFile(join(__dirname, '../renderer/index.html'));");
    mainWriter.dedent();
    mainWriter.line('}');
    mainWriter.line('return win;');
    mainWriter.dedent();
    mainWriter.line('}');
    mainWriter.blank();
    for (const ipc of ipcList) {
      const argSig = ipc.args.map((a) => `${a.name}: ${a.type || 'string'}`).join(', ');
      const payloadFields = ipc.args.map((a) => a.name).join(', ');
      mainWriter.line(`ipcMain.handle('${ipc.name}', async (_event${argSig ? `, ${argSig}` : ''}) => {`);
      mainWriter.indent();
      mainWriter.line(
        `return { ok: true, channel: '${ipc.name}'${payloadFields ? `, payload: { ${payloadFields} }` : ''}, timestamp: Date.now() };`,
      );
      mainWriter.dedent();
      mainWriter.line('});');
      mainWriter.blank();
    }
    mainWriter.line('app.whenReady().then(() => {');
    mainWriter.indent();
    mainWriter.line('createMainWindow();');
    mainWriter.dedent();
    mainWriter.line('});');

    // 3. Sandboxed Preload (`src/preload/preload.ts`)
    const preloadWriter = new SourceMapWriter(2);
    preloadWriter.line("import { contextBridge, ipcRenderer } from 'electron';");
    preloadWriter.blank();
    preloadWriter.line('const desktopApi = {');
    preloadWriter.indent();
    for (const ipc of ipcList) {
      const camel = toCamelCase(ipc.name);
      const params = ipc.args.map((a) => `${a.name}: ${a.type || 'string'}`).join(', ');
      const passArgs = ipc.args.map((a) => a.name).join(', ');
      preloadWriter.line(
        `${camel}: (${params}) => ipcRenderer.invoke('${ipc.name}'${passArgs ? `, ${passArgs}` : ''}),`,
      );
    }
    preloadWriter.dedent();
    preloadWriter.line('};');
    preloadWriter.blank();
    preloadWriter.line("contextBridge.exposeInMainWorld('desktopApi', desktopApi);");

    // 4. Shared Window Ambient Types
    const dtsWriter = new SourceMapWriter(2);
    dtsWriter.line('export interface DesktopBridgeApi {');
    dtsWriter.indent();
    for (const ipc of ipcList) {
      const camel = toCamelCase(ipc.name);
      const params = ipc.args.map((a) => `${a.name}: ${a.type || 'string'}`).join(', ');
      dtsWriter.line(`${camel}(${params}): Promise<{ ok: boolean; channel: string; timestamp: number }>;`);
    }
    dtsWriter.dedent();
    dtsWriter.line('}');
    dtsWriter.blank();
    dtsWriter.line('declare global {');
    dtsWriter.indent();
    dtsWriter.line('interface Window {');
    dtsWriter.indent();
    dtsWriter.line('desktopApi?: DesktopBridgeApi;');
    dtsWriter.dedent();
    dtsWriter.line('}');
    dtsWriter.dedent();
    dtsWriter.line('}');

    const files: EmittedCodeFile[] = [
      uiWriter.toEmittedFile(entryPath, isJs ? 'javascript' : 'tsx', true),
      mainWriter.toEmittedFile('src/main/main.ts', 'typescript', false),
      preloadWriter.toEmittedFile('src/preload/preload.ts', 'typescript', false),
      dtsWriter.toEmittedFile('src/shared/desktop-api.d.ts', 'typescript', false),
    ];

    if (dialect === 'vanilla-css') {
      const cssBuilt = buildStylesheetWithSourceMap(comp.root, ir.tokens, {
        includeTokensRoot: true,
        classMap,
        customCss: ir.customCss,
      });
      files.push({
        relativePath: `src/renderer/${comp.name}.css`,
        language: 'css',
        code: cssBuilt.code,
        sourceMap: cssBuilt.sourceMap,
        diagnostics: [],
      });
    } else if (dialect === 'css-modules') {
      const cssModBuilt = buildStylesheetWithSourceMap(comp.root, ir.tokens, {
        cssModules: true,
        includeTokensRoot: true,
        classMap,
        customCss: ir.customCss,
      });
      files.push({
        relativePath: `src/renderer/${comp.name}.module.css`,
        language: 'css',
        code: cssModBuilt.code,
        sourceMap: cssModBuilt.sourceMap,
        diagnostics: [],
      });
    }

    return {
      targetId: 'electron-target',
      dialect,
      mode,
      entryFilePath: entryPath,
      files,
      diagnostics: [],
      generatedAt: Date.now(),
    };
  },
};

// ============================================================================
// 9. TAURI v2 (RUST + CAPABILITIES ACL + TYPESCRIPT IPC + WEB UI) (`tauri-v2`)
// ============================================================================

function mapTsTypeToRust(tsType: string): string {
  switch (tsType) {
    case 'number':
      return 'f64';
    case 'boolean':
      return 'bool';
    default:
      return 'String';
  }
}

export const tauriV2Plugin: CodegenTargetPlugin = {
  descriptor: tauriDescriptor,
  emitSnippet(node, ir, opts) {
    const dialect: StylingDialect = opts.dialect === 'vanilla-css' ? 'vanilla-css' : 'tailwind';
    const isJs = opts.scriptLanguage === 'javascript';
    const ext = isJs ? 'jsx' : 'tsx';
    const classMap = buildCssClassMap(node);
    const w = new SourceMapWriter(2);
    renderJsxSubtree(w, node, ir, { dialect, classMap, isRoot: false, tauriDragAttr: true });
    return w.toEmittedFile(`${toPascalCase(node.name)}.${ext}`, isJs ? 'javascript' : 'tsx', true);
  },
  emitComponent(comp, ir, opts) {
    const dialect: StylingDialect = opts.dialect === 'vanilla-css' ? 'vanilla-css' : 'tailwind';
    const mode = opts.mode ?? 'bundle';
    const isJs = opts.scriptLanguage === 'javascript';
    const uiExt = isJs ? 'jsx' : 'tsx';
    const libExt = isJs ? 'js' : 'ts';
    const uiEntryPath = `src/components/${comp.name}.${uiExt}`;
    const classMap = buildCssClassMap(comp.root);
    const chrome = ir.windowChrome ?? {
      title: comp.name,
      width: 1120,
      height: 820,
      minWidth: 640,
      minHeight: 480,
      frameless: false,
      transparent: false,
      resizable: true,
    };
    const ipcList = ensureIpcCommands(comp.ipcCommands);
    const appSlug = toKebabCase(comp.name, 'studio-app');
    const usage = analyzeReactSubtreeUsage(comp.root, comp, { enableControlledInputs: true });
    const needsUseState = countUsedReactStateHooks(comp.stateVars, usage) > 0;
    const usedIpcList = ipcList.filter((c) => usage.usedIpcCommands.has(c.name));

    // 1. Frontend UI Component (`src/components/<Name>.tsx|.jsx`) — carries Canvas SourceMap!
    const uiWriter = new SourceMapWriter(2);
    uiWriter.line(`import React${needsUseState ? ', { useState }' : ''} from 'react';`);
    if (usedIpcList.length > 0) {
      const fnImports = usedIpcList.map((c) => toCamelCase(c.name)).join(', ');
      uiWriter.line(`import { ${fnImports} } from '../lib/tauri-commands';`);
    }
    if (dialect === 'vanilla-css') {
      uiWriter.line(`import './${comp.name}.css';`);
    }
    emitReactScriptImports(uiWriter, usage, '../scripts/handlers', {
      root: comp.root,
      ir,
      fromFilePath: uiEntryPath,
    });
    uiWriter.blank();
    uiWriter.line(`export function ${comp.name}() {`);
    uiWriter.indent();
    emitCleanReactStateHooks(uiWriter, comp.stateVars, usage, !isJs);
    emitReactBlueprintHelper(uiWriter, usage, !isJs);

    const repInfo = hasRepeatCollection(comp.root);
    if (repInfo && !comp.stateVars.some((s) => toCamelCase(s.name) === repInfo.expr)) {
      const itemsJson = (repInfo.sampleTexts.length > 0 ? repInfo.sampleTexts : ['Workstation Module', 'Studio Keyboard']).map(
        (txt, i) => `{ id: '${i + 1}', label: '${txt.replace(/'/g, "\\'")}' }`,
      );
      uiWriter.line(`const ${repInfo.expr} = [${itemsJson.join(', ')}];`);
    }

    for (const ipc of usedIpcList) {
      const ipcUse = usage.usedIpcCommands.get(ipc.name)!;
      const handler = `handle${toPascalCase(ipc.name)}`;
      const helperFn = toCamelCase(ipc.name);
      const sampleArgs = ipc.args
        .map((a) => `${toCamelCase(a.name)}: ${a.type === 'number' ? '1' : "'pdf'"}`)
        .join(', ');
      uiWriter.line(`const ${handler} = async () => {`);
      uiWriter.indent();
      uiWriter.line(`const result = await ${helperFn}(${sampleArgs ? `{ ${sampleArgs} }` : ''});`);
      if (ipcUse.resultStateTarget) {
        uiWriter.line(`set${toPascalCase(ipcUse.resultStateTarget)}(result.message);`);
      } else {
        uiWriter.line('console.info("Tauri command result:", result);');
      }
      uiWriter.dedent();
      uiWriter.line('};');
    }

    uiWriter.line('return (');
    uiWriter.indent();
    renderJsxSubtree(uiWriter, comp.root, ir, {
      dialect,
      classMap,
      isRoot: true,
      tauriDragAttr: true,
      controlledInputStateByNode: usage.controlledInputStateByNode,
    });
    uiWriter.dedent();
    uiWriter.line(');');
    uiWriter.dedent();
    uiWriter.line('}');
    uiWriter.blank();
    uiWriter.line(`export default ${comp.name};`);

    // 2. Rust Tauri Commands (`src-tauri/src/commands.rs`) with non-destructive `@studio-tauri-commands` region fences!
    const rustCmdWriter = new SourceMapWriter(4);
    rustCmdWriter.line('use serde::Serialize;');
    rustCmdWriter.blank();
    rustCmdWriter.line('#[derive(Debug, Serialize)]');
    rustCmdWriter.line('pub struct CommandAck {');
    rustCmdWriter.indent();
    rustCmdWriter.line('pub ok: bool,');
    rustCmdWriter.line('pub command: String,');
    rustCmdWriter.line('pub message: String,');
    rustCmdWriter.dedent();
    rustCmdWriter.line('}');
    rustCmdWriter.blank();
    rustCmdWriter.line('// @studio-tauri-commands:start');

    for (const ipc of ipcList) {
      const rustFn = toSnakeCase(ipc.name, 'run_cmd');
      const rustArgs = ipc.args.map((a) => `${toSnakeCase(a.name)}: ${mapTsTypeToRust(a.type)}`).join(', ');
      rustCmdWriter.line('#[tauri::command]');
      rustCmdWriter.line(`pub async fn ${rustFn}(${rustArgs}) -> Result<CommandAck, String> {`);
      rustCmdWriter.indent();
      for (const a of ipc.args) {
        rustCmdWriter.line(`let _ = &${toSnakeCase(a.name)};`);
      }
      rustCmdWriter.line('Ok(CommandAck {');
      rustCmdWriter.indent();
      rustCmdWriter.line('ok: true,');
      rustCmdWriter.line(`command: "${rustFn}".to_string(),`);
      rustCmdWriter.line(`message: "Executed ${rustFn} successfully".to_string(),`);
      rustCmdWriter.dedent();
      rustCmdWriter.line('})');
      rustCmdWriter.dedent();
      rustCmdWriter.line('}');
      rustCmdWriter.blank();
    }
    rustCmdWriter.line('// @studio-tauri-commands:end');

    // 3. Rust `src-tauri/src/lib.rs` with non-destructive `@studio-tauri-handlers` region fences!
    const libRsWriter = new SourceMapWriter(4);
    libRsWriter.line('pub mod commands;');
    libRsWriter.blank();
    libRsWriter.line('#[cfg_attr(mobile, tauri::mobile_entry_point)]');
    libRsWriter.line('pub fn run() {');
    libRsWriter.indent();
    const handlers = ipcList.map((c) => `commands::${toSnakeCase(c.name)}`).join(', ');
    libRsWriter.line('tauri::Builder::default()');
    libRsWriter.indent();
    libRsWriter.line('    // @studio-tauri-handlers:start');
    libRsWriter.line(`    .invoke_handler(tauri::generate_handler![${handlers}])`);
    libRsWriter.line('    // @studio-tauri-handlers:end');
    libRsWriter.line('    .run(tauri::generate_context!())');
    libRsWriter.line('    .expect("error while running tauri application");');
    libRsWriter.dedent();
    libRsWriter.dedent();
    libRsWriter.line('}');

    // 4. Typed TypeScript / JS Invoke Wrapper (`src/lib/tauri-commands.ts|.js`)
    const tsIpcWriter = new SourceMapWriter(2);
    tsIpcWriter.line("import { invoke } from '@tauri-apps/api/core';");
    tsIpcWriter.blank();
    if (!isJs) {
      tsIpcWriter.line('export interface CommandAck { ok: boolean; command: string; message: string; }');
      tsIpcWriter.blank();
    }
    for (const ipc of ipcList) {
      const fnName = toCamelCase(ipc.name);
      const rustName = toSnakeCase(ipc.name);
      if (ipc.args.length > 0) {
        if (isJs) {
          tsIpcWriter.line(`export async function ${fnName}(args) {`);
          tsIpcWriter.indent();
          tsIpcWriter.line(`return invoke('${rustName}', args);`);
          tsIpcWriter.dedent();
          tsIpcWriter.line('}');
        } else {
          const argType = `{ ${ipc.args.map((a) => `${toCamelCase(a.name)}: ${a.type || 'string'}`).join('; ')} }`;
          tsIpcWriter.line(`export async function ${fnName}(args: ${argType}): Promise<CommandAck> {`);
          tsIpcWriter.indent();
          tsIpcWriter.line(`return invoke<CommandAck>('${rustName}', args);`);
          tsIpcWriter.dedent();
          tsIpcWriter.line('}');
        }
      } else if (isJs) {
        tsIpcWriter.line(`export async function ${fnName}() {`);
        tsIpcWriter.indent();
        tsIpcWriter.line(`return invoke('${rustName}');`);
        tsIpcWriter.dedent();
        tsIpcWriter.line('}');
      } else {
        tsIpcWriter.line(`export async function ${fnName}(): Promise<CommandAck> {`);
        tsIpcWriter.indent();
        tsIpcWriter.line(`return invoke<CommandAck>('${rustName}');`);
        tsIpcWriter.dedent();
        tsIpcWriter.line('}');
      }
    }

    // 5. `src-tauri/tauri.conf.json`
    const tauriConf = {
      $schema: 'https://schema.tauri.app/config/2',
      productName: comp.name,
      version: '0.1.0',
      identifier: `com.visualstudio.${appSlug.replace(/-/g, '')}`,
      build: {
        beforeDevCommand: 'npm run dev',
        devUrl: 'http://localhost:5173',
        beforeBuildCommand: 'npm run build',
        frontendDist: '../dist',
      },
      app: {
        windows: [
          {
            label: 'main',
            title: chrome.title,
            width: chrome.width,
            height: chrome.height,
            minWidth: chrome.minWidth ?? 640,
            minHeight: chrome.minHeight ?? 480,
            decorations: !chrome.frameless,
            transparent: chrome.transparent,
            resizable: chrome.resizable,
          },
        ],
        security: {
          csp: "default-src 'self'; style-src 'self' 'unsafe-inline'",
        },
      },
    };

    // 6. Tauri v2 Capabilities ACL (`src-tauri/capabilities/default.json`)
    const capabilitiesJson = {
      $schema: '../gen/schemas/desktop-schema.json',
      identifier: 'default',
      description: 'Least-privilege Tauri v2 window and IPC capabilities',
      windows: ['main'],
      permissions: [
        'core:default',
        'core:window:allow-start-dragging',
        'core:window:allow-minimize',
        'core:window:allow-toggle-maximize',
        'core:window:allow-close',
      ],
    };

    const files: EmittedCodeFile[] = [
      uiWriter.toEmittedFile(uiEntryPath, isJs ? 'javascript' : 'tsx', true),
      rustCmdWriter.toEmittedFile('src-tauri/src/commands.rs', 'rust', false),
      libRsWriter.toEmittedFile('src-tauri/src/lib.rs', 'rust', false),
      tsIpcWriter.toEmittedFile(`src/lib/tauri-commands.${libExt}`, isJs ? 'javascript' : 'typescript', false),
      {
        relativePath: 'src-tauri/tauri.conf.json',
        language: 'json',
        code: JSON.stringify(tauriConf, null, 2) + '\n',
        sourceMap: [],
        diagnostics: [],
      },
      {
        relativePath: 'src-tauri/capabilities/default.json',
        language: 'json',
        code: JSON.stringify(capabilitiesJson, null, 2) + '\n',
        sourceMap: [],
        diagnostics: [],
      },
    ];

    if (dialect === 'vanilla-css') {
      const cssBuilt = buildStylesheetWithSourceMap(comp.root, ir.tokens, {
        includeTokensRoot: true,
        classMap,
        customCss: ir.customCss,
      });
      files.push({
        relativePath: `src/components/${comp.name}.css`,
        language: 'css',
        code: cssBuilt.code,
        sourceMap: cssBuilt.sourceMap,
        diagnostics: [],
      });
    }

    return {
      targetId: 'tauri-v2',
      dialect,
      mode,
      entryFilePath: uiEntryPath,
      files,
      diagnostics: [],
      generatedAt: Date.now(),
    };
  },
};

// ============================================================================
// 22. GO WAILS v2 DESKTOP (`go-wails` — `app.go` + `main.go` + `wails.json` + UI)
// ============================================================================

function mapTsTypeToGo(tsType: string): string {
  switch (tsType) {
    case 'number':
      return 'float64';
    case 'boolean':
      return 'bool';
    default:
      return 'string';
  }
}

export const goWailsPlugin: CodegenTargetPlugin = {
  descriptor: wailsDescriptor,
  emitSnippet(node, ir, opts) {
    const dialect: StylingDialect = opts.dialect === 'vanilla-css' ? 'vanilla-css' : 'tailwind';
    const classMap = buildCssClassMap(node);
    const w = new SourceMapWriter(2);
    renderJsxSubtree(w, node, ir, { dialect, classMap, isRoot: false, wailsDragStyle: true });
    return w.toEmittedFile(`${toPascalCase(node.name)}.tsx`, 'tsx', true);
  },
  emitComponent(comp, ir, opts) {
    const dialect: StylingDialect = opts.dialect === 'vanilla-css' ? 'vanilla-css' : 'tailwind';
    const mode = opts.mode ?? 'bundle';
    const classMap = buildCssClassMap(comp.root);
    const chrome = ir.windowChrome ?? {
      title: comp.name,
      width: 1120,
      height: 820,
      minWidth: 640,
      minHeight: 480,
      frameless: false,
      transparent: false,
      backdrop: 'none' as const,
      resizable: true,
    };
    const isJs = opts.scriptLanguage === 'javascript';
    const ext = isJs ? 'jsx' : 'tsx';
    const entryPath = `frontend/src/${comp.name}.${ext}`;
    const ipcList = ensureIpcCommands(comp.ipcCommands);
    const appSlug = toKebabCase(comp.name, 'studio-wails-app');
    const usage = analyzeReactSubtreeUsage(comp.root, comp, { enableControlledInputs: true });
    const needsUseState = countUsedReactStateHooks(comp.stateVars, usage) > 0;

    // 1. Frontend React UI calling `window.go.main.App.*` (`frontend/src/<Name>.tsx|.jsx` — carries Canvas SourceMap!)
    const uiWriter = new SourceMapWriter(2);
    uiWriter.line(`import React${needsUseState ? ', { useState }' : ''} from 'react';`);
    if (dialect === 'vanilla-css') {
      uiWriter.line(`import './${comp.name}.css';`);
    }
    emitReactScriptImports(uiWriter, usage, '../scripts/handlers', {
      root: comp.root,
      ir,
      fromFilePath: entryPath,
    });
    uiWriter.blank();
    uiWriter.line(`export function ${comp.name}() {`);
    uiWriter.indent();
    emitCleanReactStateHooks(uiWriter, comp.stateVars, usage, !isJs);
    emitReactBlueprintHelper(uiWriter, usage, !isJs);

    const repInfo = hasRepeatCollection(comp.root);
    if (repInfo && !comp.stateVars.some((s) => toCamelCase(s.name) === repInfo.expr)) {
      const itemsJson = (repInfo.sampleTexts.length > 0 ? repInfo.sampleTexts : ['Workstation Module', 'Studio Keyboard']).map(
        (txt, i) => `{ id: '${i + 1}', label: '${txt.replace(/'/g, "\\'")}' }`,
      );
      uiWriter.line(`const ${repInfo.expr} = [${itemsJson.join(', ')}];`);
    }

    for (const ipc of ipcList) {
      const ipcUse = usage.usedIpcCommands.get(ipc.name);
      if (!ipcUse) continue;
      const goMethod = toPascalCase(ipc.name);
      const handler = `handle${goMethod}`;
      const callArgs = ipc.args.map((a) => (a.type === 'number' ? '1' : `'pdf'`)).join(', ');
      uiWriter.line(`const ${handler} = async () => {`);
      uiWriter.indent();
      uiWriter.line(`const ack = await window.go?.main?.App?.${goMethod}(${callArgs});`);
      if (ipcUse.resultStateTarget) {
        uiWriter.line(`if (ack) set${toPascalCase(ipcUse.resultStateTarget)}(ack.message);`);
      } else {
        uiWriter.line('console.info("Wails Go response:", ack);');
      }
      uiWriter.dedent();
      uiWriter.line('};');
    }

    uiWriter.line('return (');
    uiWriter.indent();
    renderJsxSubtree(uiWriter, comp.root, ir, {
      dialect,
      classMap,
      isRoot: true,
      wailsDragStyle: true,
      controlledInputStateByNode: usage.controlledInputStateByNode,
    });
    uiWriter.dedent();
    uiWriter.line(');');
    uiWriter.dedent();
    uiWriter.line('}');
    uiWriter.blank();
    uiWriter.line(`export default ${comp.name};`);

    // 2. Go Bound App Struct (`app.go`)
    const appGoWriter = new SourceMapWriter(4);
    appGoWriter.line('package main');
    appGoWriter.blank();
    appGoWriter.line('import (');
    appGoWriter.indent();
    appGoWriter.line('"context"');
    appGoWriter.line('"fmt"');
    appGoWriter.line('"time"');
    appGoWriter.dedent();
    appGoWriter.line(')');
    appGoWriter.blank();
    appGoWriter.line('// CommandAck represents a structured IPC response returned to the Wails webview.');
    appGoWriter.line('type CommandAck struct {');
    appGoWriter.indent();
    appGoWriter.line('Ok        bool   `json:"ok"`');
    appGoWriter.line('Command   string `json:"command"`');
    appGoWriter.line('Message   string `json:"message"`');
    appGoWriter.line('Timestamp int64  `json:"timestamp"`');
    appGoWriter.dedent();
    appGoWriter.line('}');
    appGoWriter.blank();
    appGoWriter.line('// App struct holds application state and Wails runtime context.');
    appGoWriter.line('type App struct {');
    appGoWriter.indent();
    appGoWriter.line('ctx context.Context');
    appGoWriter.dedent();
    appGoWriter.line('}');
    appGoWriter.blank();
    appGoWriter.line('func NewApp() *App {');
    appGoWriter.indent();
    appGoWriter.line('return &App{}');
    appGoWriter.dedent();
    appGoWriter.line('}');
    appGoWriter.blank();
    appGoWriter.line('func (a *App) startup(ctx context.Context) {');
    appGoWriter.indent();
    appGoWriter.line('a.ctx = ctx');
    appGoWriter.dedent();
    appGoWriter.line('}');
    appGoWriter.blank();

    for (const ipc of ipcList) {
      const goMethod = toPascalCase(ipc.name);
      const goParams = ipc.args.map((a) => `${toCamelCase(a.name)} ${mapTsTypeToGo(a.type)}`).join(', ');
      const fmtArgs = ipc.args.length > 0 ? `, ${ipc.args.map((a) => toCamelCase(a.name)).join(', ')}` : '';
      const fmtPlaceholders = ipc.args.length > 0 ? ` (${ipc.args.map(() => '%v').join(', ')})` : '';
      appGoWriter.line(`// ${goMethod} is bound to window.go.main.App.${goMethod} in the frontend.`);
      appGoWriter.line(`func (a *App) ${goMethod}(${goParams}) (CommandAck, error) {`);
      appGoWriter.indent();
      appGoWriter.line('return CommandAck{');
      appGoWriter.indent();
      appGoWriter.line('Ok:        true,');
      appGoWriter.line(`Command:   "${escapeDoubleQuoted(ipc.name)}",`);
      appGoWriter.line(`Message:   fmt.Sprintf("Executed ${escapeDoubleQuoted(goMethod)}${fmtPlaceholders}"${fmtArgs}),`);
      appGoWriter.line('Timestamp: time.Now().UnixMilli(),');
      appGoWriter.dedent();
      appGoWriter.line('}, nil');
      appGoWriter.dedent();
      appGoWriter.line('}');
      appGoWriter.blank();
    }

    // 3. Go Entry Point (`main.go`)
    const mainGoWriter = new SourceMapWriter(4);
    mainGoWriter.line('package main');
    mainGoWriter.blank();
    mainGoWriter.line('import (');
    mainGoWriter.indent();
    mainGoWriter.line('"embed"');
    mainGoWriter.line('"log"');
    mainGoWriter.blank();
    mainGoWriter.line('"github.com/wailsapp/wails/v2"');
    mainGoWriter.line('"github.com/wailsapp/wails/v2/pkg/options"');
    mainGoWriter.line('"github.com/wailsapp/wails/v2/pkg/options/assetserver"');
    mainGoWriter.line('"github.com/wailsapp/wails/v2/pkg/options/windows"');
    mainGoWriter.dedent();
    mainGoWriter.line(')');
    mainGoWriter.blank();
    mainGoWriter.line('//go:embed all:frontend/dist');
    mainGoWriter.line('var assets embed.FS');
    mainGoWriter.blank();
    mainGoWriter.line('func main() {');
    mainGoWriter.indent();
    mainGoWriter.line('app := NewApp()');
    mainGoWriter.blank();
    mainGoWriter.line('err := wails.Run(&options.App{');
    mainGoWriter.indent();
    mainGoWriter.line(`Title:         "${escapeDoubleQuoted(chrome.title)}",`);
    mainGoWriter.line(`Width:         ${chrome.width},`);
    mainGoWriter.line(`Height:        ${chrome.height},`);
    mainGoWriter.line(`MinWidth:      ${chrome.minWidth ?? 640},`);
    mainGoWriter.line(`MinHeight:     ${chrome.minHeight ?? 480},`);
    mainGoWriter.line(`Frameless:     ${chrome.frameless ? 'true' : 'false'},`);
    mainGoWriter.line(`DisableResize: ${chrome.resizable ? 'false' : 'true'},`);
    mainGoWriter.line('AssetServer: &assetserver.Options{');
    mainGoWriter.indent();
    mainGoWriter.line('Assets: assets,');
    mainGoWriter.dedent();
    mainGoWriter.line('},');
    mainGoWriter.line('OnStartup: app.startup,');
    mainGoWriter.line('Bind: []interface{}{');
    mainGoWriter.indent();
    mainGoWriter.line('app,');
    mainGoWriter.dedent();
    mainGoWriter.line('},');
    mainGoWriter.line('Windows: &windows.Options{');
    mainGoWriter.indent();
    mainGoWriter.line(`WebviewIsTransparent: ${chrome.transparent ? 'true' : 'false'},`);
    mainGoWriter.line(
      `BackdropType:         windows.${chrome.backdrop === 'acrylic' ? 'Acrylic' : chrome.backdrop === 'mica' ? 'Mica' : 'Auto'},`,
    );
    mainGoWriter.dedent();
    mainGoWriter.line('},');
    mainGoWriter.dedent();
    mainGoWriter.line('})');
    mainGoWriter.line('if err != nil {');
    mainGoWriter.indent();
    mainGoWriter.line('log.Fatal(err)');
    mainGoWriter.dedent();
    mainGoWriter.line('}');
    mainGoWriter.dedent();
    mainGoWriter.line('}');

    // 4. `wails.json`
    const wailsJson = {
      $schema: 'https://wails.io/schemas/config.v2.json',
      name: appSlug,
      outputfilename: appSlug,
      'frontend:install': 'npm install',
      'frontend:build': 'npm run build',
      'frontend:dev:watcher': 'npm run dev',
      'frontend:dev:serverUrl': 'auto',
    };

    // 5. Ambient `window.go.main.App` TypeScript Bindings (`frontend/src/wailsjs.d.ts`)
    const dtsWriter = new SourceMapWriter(2);
    dtsWriter.line('export interface WailsCommandAck {');
    dtsWriter.indent();
    dtsWriter.line('ok: boolean;');
    dtsWriter.line('command: string;');
    dtsWriter.line('message: string;');
    dtsWriter.line('timestamp: number;');
    dtsWriter.dedent();
    dtsWriter.line('}');
    dtsWriter.blank();
    dtsWriter.line('export interface WailsMainAppBindings {');
    dtsWriter.indent();
    for (const ipc of ipcList) {
      const goMethod = toPascalCase(ipc.name);
      const params = ipc.args.map((a) => `${toCamelCase(a.name)}: ${a.type || 'string'}`).join(', ');
      dtsWriter.line(`${goMethod}(${params}): Promise<WailsCommandAck>;`);
    }
    dtsWriter.dedent();
    dtsWriter.line('}');
    dtsWriter.blank();
    dtsWriter.line('declare global {');
    dtsWriter.indent();
    dtsWriter.line('interface Window {');
    dtsWriter.indent();
    dtsWriter.line('go?: { main?: { App?: WailsMainAppBindings } };');
    dtsWriter.dedent();
    dtsWriter.line('}');
    dtsWriter.dedent();
    dtsWriter.line('}');

    const files: EmittedCodeFile[] = [
      uiWriter.toEmittedFile(entryPath, isJs ? 'javascript' : 'tsx', true),
      appGoWriter.toEmittedFile('app.go', 'go', false),
      mainGoWriter.toEmittedFile('main.go', 'go', false),
      {
        relativePath: 'wails.json',
        language: 'json',
        code: JSON.stringify(wailsJson, null, 2) + '\n',
        sourceMap: [],
        diagnostics: [],
      },
      dtsWriter.toEmittedFile('frontend/src/wailsjs.d.ts', 'typescript', false),
    ];

    if (dialect === 'vanilla-css') {
      const cssBuilt = buildStylesheetWithSourceMap(comp.root, ir.tokens, {
        includeTokensRoot: true,
        classMap,
        customCss: ir.customCss,
      });
      files.push({
        relativePath: `frontend/src/${comp.name}.css`,
        language: 'css',
        code: cssBuilt.code,
        sourceMap: cssBuilt.sourceMap,
        diagnostics: [],
      });
    }

    return {
      targetId: 'go-wails',
      dialect,
      mode,
      entryFilePath: entryPath,
      files,
      diagnostics: [],
      generatedAt: Date.now(),
    };
  },
};
