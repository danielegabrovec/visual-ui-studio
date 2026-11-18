import {
  compileAutomationRuleToCode,
  upsertManagedAutomationInFile,
} from '@shared/automation-ir';
import {
  inferScriptLanguageFromPath,
  parseExternalScriptModule,
  transpileTypeScriptToJs,
} from '@shared/script-ir';
import type {
  CodegenCompileOptions,
  CodegenTargetId,
  EmittedCodeFile,
  UIRIpcCommandSpec,
  UIRModule,
  UIRNode,
  UIRScriptModuleDecl,
  UISheetDocument,
} from '@shared/ui-ir';

export function sanitizeScriptIdent(raw: string, fallback = 'onAction'): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_$]/g, '');
  if (!cleaned) return fallback;
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

export function normalizeRelScriptPath(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/^\/+/, '');
}

export function computeRelativeModuleImport(
  fromFilePath: string,
  targetModuleRelPath: string,
  keepExtension = false,
): string {
  const normFrom = normalizeRelScriptPath(fromFilePath);
  const normTarget = normalizeRelScriptPath(targetModuleRelPath);

  const fromDirs = normFrom.includes('/') ? normFrom.split('/').slice(0, -1).filter(Boolean) : [];
  const targetParts = normTarget.split('/').filter(Boolean);

  let common = 0;
  while (
    common < fromDirs.length &&
    common < targetParts.length - 1 &&
    fromDirs[common] === targetParts[common]
  ) {
    common++;
  }

  const upCount = fromDirs.length - common;
  const prefix = upCount === 0 ? './' : '../'.repeat(upCount);
  let remainder = targetParts.slice(common).join('/');

  if (!keepExtension) {
    remainder = remainder.replace(/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i, '');
  } else if (/\.tsx?$/i.test(remainder)) {
    remainder = remainder.replace(/\.tsx?$/i, '.js');
  }

  return `${prefix}${remainder}`;
}

export function resolveEffectiveScriptModules(
  sheet: UISheetDocument,
  options: CodegenCompileOptions,
): {
  modules: UIRScriptModuleDecl[];
  discoveredIpcCommands: UIRIpcCommandSpec[];
} {
  const byRelPath = new Map<string, UIRScriptModuleDecl>();
  const ipcMap = new Map<string, UIRIpcCommandSpec>();

  for (const mod of options.scriptModules ?? []) {
    const rel = normalizeRelScriptPath(mod.relativePath);
    if (!rel) continue;
    const parsed = parseExternalScriptModule(mod.sourceCode, mod.language, rel);
    for (const call of parsed.externalCalls) {
      if (call.kind === 'tauri_invoke' && !ipcMap.has(call.endpointOrCommand)) {
        ipcMap.set(call.endpointOrCommand, {
          name: call.endpointOrCommand,
          args: [],
          returnType: 'string',
        });
      }
    }
    byRelPath.set(rel, {
      ...mod,
      relativePath: rel,
      exportedFunctions:
        mod.exportedFunctions.length > 0
          ? mod.exportedFunctions
          : parsed.functions.filter((f) => f.isExported).map((f) => f.name),
    });
  }

  // Synthesize or enrich script modules from sheet.automations if not yet materialized in sourceCode
  for (const rule of sheet.automations ?? []) {
    if (!rule.enabled) continue;
    const rel = normalizeRelScriptPath(rule.targetFileRelPath || 'scripts/automations.js');
    const lang = rule.language ?? inferScriptLanguageFromPath(rel);
    const compiled = compileAutomationRuleToCode(rule, {
      target: options.targetId,
      language: lang,
      sheet,
    });

    for (const ipc of compiled.ipcCommands) {
      if (!ipcMap.has(ipc.name)) {
        ipcMap.set(ipc.name, ipc);
      }
    }

    const existing = byRelPath.get(rel);
    if (!existing) {
      const sourceCode = upsertManagedAutomationInFile('', rule, compiled);
      const parsed = parseExternalScriptModule(sourceCode, lang, rel);
      byRelPath.set(rel, {
        vfsEntryId: rule.targetFileVfsId,
        relativePath: rel,
        language: lang,
        loadStrategy: lang === 'python' ? 'backend-route' : 'module',
        sourceCode,
        exportedFunctions: parsed.functions.filter((f) => f.isExported).map((f) => f.name),
        autoInitOnLoad: true,
      });
    } else if (!existing.sourceCode.includes(compiled.fnName)) {
      const mergedCode = upsertManagedAutomationInFile(existing.sourceCode, rule, compiled);
      const parsed = parseExternalScriptModule(mergedCode, existing.language, rel);
      byRelPath.set(rel, {
        ...existing,
        sourceCode: mergedCode,
        exportedFunctions: parsed.functions.filter((f) => f.isExported).map((f) => f.name),
      });
    }
  }

  return {
    modules: Array.from(byRelPath.values()),
    discoveredIpcCommands: Array.from(ipcMap.values()),
  };
}

export function getWebScriptModulesForHtml(
  ir: UIRModule,
): Array<{ relativePath: string; code: string; exportedFunctions: string[]; autoInitOnLoad?: boolean }> {
  const out: Array<{
    relativePath: string;
    code: string;
    exportedFunctions: string[];
    autoInitOnLoad?: boolean;
  }> = [];

  for (const mod of ir.scriptModules ?? []) {
    if (mod.language === 'python') continue;
    if (!mod.sourceCode.trim()) continue;
    const relJs = normalizeRelScriptPath(mod.relativePath).replace(/\.(?:ts|tsx|mts)$/i, '.js');
    const code =
      mod.language === 'typescript' || /\.tsx?$/i.test(mod.relativePath)
        ? transpileTypeScriptToJs(mod.sourceCode, { preserveEsExports: true }).jsCode
        : mod.sourceCode;
    out.push({
      relativePath: relJs,
      code,
      exportedFunctions: mod.exportedFunctions,
      autoInitOnLoad: mod.autoInitOnLoad,
    });
  }

  return out;
}

export function formatScriptModulesAsEmittedFiles(
  ir: UIRModule,
  targetId: CodegenTargetId,
  scriptLanguage?: 'javascript' | 'typescript',
): EmittedCodeFile[] {
  const mods = ir.scriptModules ?? [];
  if (mods.length === 0) return [];

  const isPythonPrimary = targetId.startsWith('python-');
  const isWebOrJsTarget =
    targetId === 'html-vanilla' ||
    targetId === 'htmx' ||
    targetId === 'react-tsx' ||
    targetId === 'nextjs-app' ||
    targetId === 'svelte5' ||
    targetId === 'vue3' ||
    targetId === 'angular' ||
    targetId === 'react-native' ||
    targetId === 'electron-target' ||
    targetId === 'tauri-v2' ||
    targetId === 'go-wails';

  if (!isPythonPrimary && !isWebOrJsTarget) {
    return [];
  }

  const forceJs =
    targetId === 'html-vanilla' ||
    targetId === 'htmx' ||
    scriptLanguage === 'javascript';

  const emitted: EmittedCodeFile[] = [];

  for (const mod of mods) {
    if (!mod.sourceCode.trim()) continue;

    if (mod.language === 'python') {
      if (isPythonPrimary || targetId === 'htmx' || targetId === 'nextjs-app' || targetId === 'html-vanilla') {
        emitted.push({
          relativePath: normalizeRelScriptPath(mod.relativePath),
          language: 'python',
          code: mod.sourceCode.endsWith('\n') ? mod.sourceCode : `${mod.sourceCode}\n`,
          sourceMap: [],
          diagnostics: [],
        });
      }
      continue;
    }

    if (isPythonPrimary) continue;

    let relPath = normalizeRelScriptPath(mod.relativePath);
    let code = mod.sourceCode;
    let lang: 'javascript' | 'typescript' =
      mod.language === 'typescript' ? 'typescript' : 'javascript';

    if (forceJs && (mod.language === 'typescript' || /\.tsx?$/i.test(relPath))) {
      relPath = relPath.replace(/\.(?:ts|tsx|mts)$/i, '.js');
      code = transpileTypeScriptToJs(mod.sourceCode, { preserveEsExports: true }).jsCode;
      lang = 'javascript';
    } else if (!forceJs && scriptLanguage === 'typescript' && mod.language === 'javascript') {
      lang = 'javascript';
    }

    emitted.push({
      relativePath: relPath,
      language: lang,
      code: code.endsWith('\n') ? code : `${code}\n`,
      sourceMap: [],
      diagnostics: [],
    });
  }

  return emitted;
}

export function collectGroupedScriptImportsForSubtree(
  root: UIRNode,
  ir: UIRModule,
  fromFilePath: string,
  defaultImportPath: string,
  options?: {
    extractedIslands?: ReadonlyMap<string, string>;
    includeMount?: boolean;
  },
): Array<{ importSpec: string; fnNames: string[] }> {
  const byImportSpec = new Map<string, Set<string>>();

  const resolveImportForCall = (fnIdent: string, explicitModRelPath?: string): string => {
    if (explicitModRelPath) {
      return computeRelativeModuleImport(fromFilePath, explicitModRelPath, false);
    }
    const matchedMod = (ir.scriptModules ?? []).find(
      (m) => m.language !== 'python' && m.exportedFunctions.includes(fnIdent),
    );
    if (matchedMod) {
      return computeRelativeModuleImport(fromFilePath, matchedMod.relativePath, false);
    }
    return defaultImportPath;
  };

  const walk = (n: UIRNode) => {
    if (options?.extractedIslands?.has(n.canvasNodeId)) {
      return;
    }
    for (const inter of n.interactions) {
      if (inter.type === 'SCRIPT_CALL' && (options?.includeMount || inter.trigger !== 'mount')) {
        const fnIdent = sanitizeScriptIdent(inter.fnName);
        const spec = resolveImportForCall(fnIdent, inter.moduleRelPath);
        const set = byImportSpec.get(spec) ?? new Set<string>();
        set.add(fnIdent);
        byImportSpec.set(spec, set);
      }
    }
    for (const child of n.children) {
      walk(child);
    }
  };

  walk(root);

  return Array.from(byImportSpec.entries()).map(([importSpec, fnSet]) => ({
    importSpec,
    fnNames: Array.from(fnSet),
  }));
}

/**
 * Non-destructive region patcher for `src-tauri/src/commands.rs` (`// @studio-tauri-commands:start` ... `:end`).
 */
export function patchTauriRustCommandsRegion(
  existingCommandsRs: string,
  generatedCommandsBlock: string,
): string {
  const startMarker = '// @studio-tauri-commands:start';
  const endMarker = '// @studio-tauri-commands:end';
  const fenced = `${startMarker}\n${generatedCommandsBlock.trim()}\n${endMarker}`;

  if (!existingCommandsRs.trim()) {
    return `${fenced}\n`;
  }

  const normalized = existingCommandsRs.replace(/\r\n/g, '\n');
  const sIdx = normalized.indexOf(startMarker);
  const eIdx = normalized.indexOf(endMarker);

  if (sIdx >= 0 && eIdx > sIdx) {
    return (
      normalized.slice(0, sIdx) +
      fenced +
      normalized.slice(eIdx + endMarker.length)
    );
  }

  return `${normalized.trimEnd()}\n\n${fenced}\n`;
}

/**
 * Non-destructive region patcher for `src-tauri/src/lib.rs` (`// @studio-tauri-handlers:start` ... `:end`).
 */
export function patchTauriRustHandlersRegion(
  existingLibRs: string,
  handlerRefs: string[],
): string {
  const startMarker = '// @studio-tauri-handlers:start';
  const endMarker = '// @studio-tauri-handlers:end';
  const invokeLine = `        .invoke_handler(tauri::generate_handler![${handlerRefs.join(', ')}])`;
  const fenced = `        ${startMarker}\n${invokeLine}\n        ${endMarker}`;

  if (!existingLibRs.trim()) {
    return [
      'pub mod commands;',
      '',
      '#[cfg_attr(mobile, tauri::mobile_entry_point)]',
      'pub fn run() {',
      '    tauri::Builder::default()',
      fenced,
      '        .run(tauri::generate_context!())',
      '        .expect("error while running tauri application");',
      '}',
      '',
    ].join('\n');
  }

  const normalized = existingLibRs.replace(/\r\n/g, '\n');
  const sIdx = normalized.indexOf(startMarker);
  const eIdx = normalized.indexOf(endMarker);
  if (sIdx >= 0 && eIdx > sIdx) {
    return (
      normalized.slice(0, sIdx) +
      `${startMarker}\n${invokeLine}\n        ${endMarker}` +
      normalized.slice(eIdx + endMarker.length)
    );
  }

  return normalized;
}
