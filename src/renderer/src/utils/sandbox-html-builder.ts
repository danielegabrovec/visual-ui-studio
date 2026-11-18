import { buildSheetDomIdLookup, compileAutomationRuleToCode, upsertManagedAutomationInFile } from '@shared/automation-ir';
import { compileBlueprintToRuntimeJs, type BlueprintGraphDocument } from '@shared/blueprint-ir';
import {
  compileNodeToCssDeclarations,
  compileReusableClassesCss,
  compileSheetKeyframesCss,
  compileStateOverrideToCssDeclarations,
} from '@shared/css-sync-engine';
import { buildTokenLookupMap } from '@shared/default-tokens';
import { OFFLINE_ICON_CATALOG } from '@shared/icon-catalog';
import { inferScriptLanguageFromPath, parseExternalScriptModule, transpileTypeScriptToJs } from '@shared/script-ir';
import type { SqlDesignDocument } from '@shared/sql-ir';
import type { ThreeSceneDocument } from '@shared/three-ir';
import {
  isTokenRef,
  type DesignTokenEntry,
  type InteractiveStateKey,
  type LayoutSpec,
  type NodeId,
  type UINode,
  type UISheetDocument,
} from '@shared/ui-ir';

export interface SandboxScriptFileInput {
  id?: string;
  name: string;
  relativePath?: string;
  content: string;
}

export interface SandboxBuildOptions {
  scriptFiles?: SandboxScriptFileInput[];
  blueprintGraphs?: BlueprintGraphDocument[];
  threeScenes?: ThreeSceneDocument[];
  sqlDocument?: SqlDesignDocument | null;
  studioTheme?: 'dark' | 'light';
}

function resolveRelativeSandboxPath(fromModulePath: string, importSpec: string): string {
  if (!importSpec.startsWith('.')) return importSpec;
  const fromDirs = fromModulePath.includes('/')
    ? fromModulePath.split('/').slice(0, -1).filter(Boolean)
    : [];
  const segs = [...fromDirs];
  for (const part of importSpec.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') segs.pop();
    else segs.push(part);
  }
  return segs.join('/').replace(/\.(?:ts|tsx|mts|js|jsx|mjs)$/i, '');
}

function collectSandboxScriptFiles(sheet: UISheetDocument, options?: SandboxBuildOptions): SandboxScriptFileInput[] {
  const files = new Map<string, SandboxScriptFileInput>();
  for (const script of options?.scriptFiles ?? []) {
    const path = script.relativePath || script.name;
    files.set(path.replace(/\\/g, '/').replace(/^\/+/, ''), script);
  }
  for (const rule of sheet.automations ?? []) {
    // Older SQL-to-UI documents may store an automation without a corresponding VFS module.
    if (!rule.enabled || rule.targetFileVfsId) continue;
    const path = rule.targetFileRelPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const language = rule.language ?? inferScriptLanguageFromPath(path);
    if (language === 'python') continue;
    const existing = files.get(path);
    const content = existing?.content ?? '';
    const parsed = parseExternalScriptModule(content, language, path);
    if (parsed.functions.some((fn) => fn.name === rule.generatedFnName)) continue;
    const compiled = compileAutomationRuleToCode(rule, { language, sheet, sqlDocument: options?.sqlDocument });
    files.set(path, {
      ...existing,
      name: existing?.name ?? path.split('/').at(-1) ?? 'automations.js',
      relativePath: path,
      content: upsertManagedAutomationInFile(content, rule, compiled),
    });
  }
  return [...files.values()];
}

/**
 * Bundles multiple `.js` / `.ts` VFS files in topological dependency order into
 * `window.__studioModuleRegistry` + `window.__studioScriptHandlers` IIFEs so multi-file
 * ES `import` / `export` modules execute cleanly inside the sandboxed preview iframe.
 */
export function bundleScriptsForSandboxRegistry(scriptFiles: SandboxScriptFileInput[]): string[] {
  const validFiles = scriptFiles.filter(
    (f) => !f.name.endsWith('.generated.ts') && !/\.pyw?$/i.test(f.name) && f.content.trim().length > 0,
  );
  if (validFiles.length === 0) return [];

  const entries = validFiles.map((file) => {
    const normPath = (file.relativePath || file.name)
      .replace(/\\/g, '/')
      .replace(/^\.?\//, '')
      .replace(/^\/+/, '');
    const extLess = normPath.replace(/\.(?:ts|tsx|mts|js|jsx|mjs)$/i, '');
    const baseName = extLess.split('/').pop() || extLess;
    const parsed = parseExternalScriptModule(file.content, undefined, normPath);
    const deps = parsed.imports
      .filter((imp) => !imp.isTypeOnly && imp.source.startsWith('.'))
      .map((imp) => resolveRelativeSandboxPath(normPath, imp.source));
    return { file, normPath, extLess, baseName, parsed, deps };
  });

  // Topological sort by relative imports
  const visited = new Set<string>();
  const ordered: typeof entries = [];
  const byExtLess = new Map(entries.map((e) => [e.extLess, e]));
  const byBase = new Map(entries.map((e) => [e.baseName, e]));

  const visit = (item: (typeof entries)[number], stack = new Set<string>()) => {
    if (visited.has(item.normPath) || stack.has(item.normPath)) return;
    stack.add(item.normPath);
    for (const dep of item.deps) {
      const depBase = dep.split('/').pop() || dep;
      const depItem = byExtLess.get(dep) ?? byBase.get(depBase);
      if (depItem) visit(depItem, stack);
    }
    visited.add(item.normPath);
    ordered.push(item);
  };
  for (const item of entries) visit(item);

  const emittedBlocks: string[] = [];

  for (const item of ordered) {
    const { jsCode: rawModuleJs, diagnostics } = transpileTypeScriptToJs(item.file.content, {
      preserveEsExports: true,
    });
    if (diagnostics.length > 0) {
      emittedBlocks.push(
        `console.warn(${JSON.stringify(`[Script ${item.file.name}] Errore sintassi TS/JS: ${diagnostics[0]}`)});`,
      );
      continue;
    }

    const exportedPairs: Array<{ local: string; exported: string }> = [];
    let transformed = rawModuleJs;

    // 1. Rewrite ES imports to read from `window.__studioModuleRegistry`
    transformed = transformed.replace(
      /^\s*import\s+([\s\S]*?)\s+from\s+(['"])([^'"]+)\2\s*;?\s*$/gm,
      (_m, rawClause: string, _q: string, src: string) => {
        const resolved = resolveRelativeSandboxPath(item.normPath, src);
        const fallbackBase = resolved.split('/').pop() || resolved;
        const regLookup = `(window.__studioModuleRegistry[${JSON.stringify(resolved)}] || window.__studioModuleRegistry[${JSON.stringify(src)}] || window.__studioModuleRegistry[${JSON.stringify(fallbackBase)}] || {})`;

        const stmts: string[] = [];
        const clause = rawClause.trim();
        const namedBlock = clause.match(/\{([\s\S]*?)\}/);
        if (namedBlock) {
          const destructured = namedBlock[1]
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => {
              const parts = s.split(/\s+as\s+/);
              return parts.length === 2 ? `${parts[0].trim()}: ${parts[1].trim()}` : parts[0].trim();
            })
            .join(', ');
          if (destructured) {
            stmts.push(`const { ${destructured} } = ${regLookup};`);
          }
        }
        const rest = clause.replace(/\{[\s\S]*?\}/, '').replace(/,/g, '').trim();
        if (rest) {
          const ns = rest.match(/^\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/);
          if (ns) {
            stmts.push(`const ${ns[1]} = ${regLookup};`);
          } else {
            stmts.push(`const ${rest} = (${regLookup}).default ?? ${regLookup};`);
          }
        }
        return stmts.join('\n');
      },
    );

    // 2. Collect & rewrite ES exports
    transformed = transformed.replace(
      /^\s*export\s+default\s+(async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm,
      (_m, asyncKw: string | undefined, fnName: string) => {
        exportedPairs.push({ local: fnName, exported: 'default' });
        exportedPairs.push({ local: fnName, exported: fnName });
        return `${asyncKw ?? ''}function ${fnName}`;
      },
    );
    transformed = transformed.replace(/^\s*export\s+default\s+/gm, () => {
      exportedPairs.push({ local: '__defaultExport', exported: 'default' });
      return 'const __defaultExport = ';
    });
    transformed = transformed.replace(
      /^\s*export\s+(async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm,
      (_m, asyncKw: string | undefined, fnName: string) => {
        exportedPairs.push({ local: fnName, exported: fnName });
        return `${asyncKw ?? ''}function ${fnName}`;
      },
    );
    transformed = transformed.replace(
      /^\s*export\s+(const|let|var|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm,
      (_m, kw: string, ident: string) => {
        exportedPairs.push({ local: ident, exported: ident });
        return `${kw} ${ident}`;
      },
    );
    transformed = transformed.replace(/^\s*export\s*\{([^}]+)\}\s*;?\s*$/gm, (_m, list: string) => {
      for (const spec of list.split(',')) {
        const clean = spec.trim();
        if (!clean) continue;
        const parts = clean.split(/\s+as\s+/);
        const local = parts[0].trim();
        const exported = (parts[1] || parts[0]).trim();
        exportedPairs.push({ local, exported });
      }
      return '';
    });

    // Also expose top-level functions if file had no explicit `export` keyword (plain browser `.js` scripts)
    for (const fn of item.parsed.functions) {
      if (
        (fn.kind === 'function' || fn.kind === 'arrow') &&
        !exportedPairs.some((p) => p.exported === fn.name)
      ) {
        exportedPairs.push({ local: fn.name, exported: fn.name });
      }
    }

    const exportAssignLines = exportedPairs.map(
      ({ local, exported }) =>
        `if (typeof ${local} !== 'undefined') { __modExports[${JSON.stringify(exported)}] = ${local}; if (typeof ${local} === 'function') { __handlers[${JSON.stringify(exported)}] = ${local}; } }`,
    );

    const moduleWrapper = [
      `(function() {`,
      `  try {`,
      `  const __reg = (window.__studioModuleRegistry = window.__studioModuleRegistry || {});`,
      `  const __handlers = (window.__studioScriptHandlers = window.__studioScriptHandlers || {});`,
      `  const __modExports = {};`,
      transformed,
      ...exportAssignLines.map((l) => `  ${l}`),
      `  __reg[${JSON.stringify(item.normPath)}] = __modExports;`,
      `  __reg[${JSON.stringify(item.extLess)}] = __modExports;`,
      `  __reg[${JSON.stringify(item.baseName)}] = __modExports;`,
      `  } catch (error) {`,
      `    console.warn(${JSON.stringify(`[Script ${item.normPath}] `)} + (error?.message ?? String(error)));`,
      `  }`,
      `})();`,
    ].join('\n');

    emittedBlocks.push(escapeInlineScript(moduleWrapper));
  }

  return emittedBlocks;
}

export function isCssSurfaceDark(cssColor: string | undefined): boolean {
  if (!cssColor) return true;
  const trimmed = cssColor.trim().toLowerCase();
  if (!trimmed || trimmed === 'transparent') return true;
  if (trimmed === 'black') return true;
  if (trimmed === 'white') return false;

  const hexMatch = trimmed.match(/#([0-9a-f]{3,8})\b/i);
  if (hexMatch) {
    const raw = hexMatch[1];
    let r = 0;
    let g = 0;
    let b = 0;
    if (raw.length === 3 || raw.length === 4) {
      r = parseInt(raw[0] + raw[0], 16);
      g = parseInt(raw[1] + raw[1], 16);
      b = parseInt(raw[2] + raw[2], 16);
    } else {
      r = parseInt(raw.slice(0, 2), 16);
      g = parseInt(raw.slice(2, 4), 16);
      b = parseInt(raw.slice(4, 6), 16);
    }
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return lum < 140;
  }

  const rgbMatch = trimmed.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return lum < 140;
  }

  return true;
}

function resolveNodeFillCss(
  node: UINode | undefined,
  tokenMap: Record<string, string | number>,
  fallbackBg?: string,
): string | null {
  const firstFill = node?.style.fills?.[0];
  if (firstFill?.type === 'solid') {
    const col = tokenCssVarOrVal(firstFill.color, tokenMap, fallbackBg ?? 'transparent');
    if (col === 'transparent' && fallbackBg) return fallbackBg;
    return col;
  }
  if (firstFill?.type === 'linear-gradient') {
    const stops = firstFill.stops
      .map((s) => `${tokenCssVarOrVal(s.color, tokenMap, '#3b82f6')} ${Math.round(s.pos * 100)}%`)
      .join(', ');
    return `linear-gradient(${firstFill.angle}deg, ${stops})`;
  }
  return fallbackBg ?? null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeInlineScript(js: string): string {
  return js.replace(/<\/script/gi, '<\\/script');
}

export function sanitizeBlueprintRuntimeJs(rawRuntimeJs: string): string {
  return rawRuntimeJs.replace(
    /\(ctx:\s*StudioRuntimeContext,\s*eventPayload\?(?::\s*Record<string,\s*any>)?\)(?::\s*Promise<void>)?/g,
    '(ctx, eventPayload)',
  );
}

function tokenCssVarOrVal<T extends string | number>(
  val: T | { $token: string } | undefined,
  tokenMap: Record<string, string | number>,
  fallback: T,
  unit = '',
): string {
  if (val === undefined || val === null) return `${fallback}${unit}`;
  if (isTokenRef(val)) {
    const resolved = tokenMap[val.$token];
    if (resolved !== undefined) {
      return typeof resolved === 'number' ? `${resolved}${unit}` : String(resolved);
    }
    return `${fallback}${unit}`;
  }
  return typeof val === 'number' ? `${val}${unit}` : String(val);
}

function previewStateSelector(selector: string, state: InteractiveStateKey): string {
  switch (state) {
    case 'checked':
      return `${selector}:is(:checked, :has(> input:checked))`;
    case 'disabled':
      return `${selector}:is(:disabled, :has(> input:disabled))`;
    case 'loading':
      return `${selector}[aria-busy="true"]`;
    case 'dark':
      return `:root[data-theme="dark"] ${selector}`;
    default:
      return `${selector}:${state}`;
  }
}

interface PreviewStyleRules {
  defaults: string[];
  nodes: string[];
  states: string[];
}

function renderNodeHtml(
  nodeId: NodeId,
  sheet: UISheetDocument,
  tokenMap: Record<string, string | number>,
  parentMode: LayoutSpec['mode'],
  options: SandboxBuildOptions | undefined,
  rules: PreviewStyleRules,
  fallbackCanvasBg: string,
  domIdMap: ReadonlyMap<string, string>,
): string {
  const node = sheet.nodes[nodeId];
  if (!node || !node.visible) return '';

  const canonicalDomId = domIdMap.get(node.id) ?? `node-${node.id}`;
  const selector = `#${canonicalDomId}`;
  const isArtboard = node.kind === 'artboard';
  const layout = node.layout;
  const useFrame = !isArtboard && (
    layout.positioning === 'absolute' || (parentMode === 'freeform' && layout.positioning === 'flow')
  );
  const defaults: string[] = ['position: relative;'];
  const normalizedLayout = useFrame
    ? {
        ...layout,
        positioning: 'absolute' as const,
        width: layout.width.mode === 'fill'
          ? { ...layout.width, mode: 'fixed' as const, value: layout.frame.width }
          : layout.width,
      }
    : layout;
  const context = { tokenMap, parentMode, emitTokenVars: false };
  const compiled = compileNodeToCssDeclarations({ ...node, layout: normalizedLayout }, context);
  if (useFrame) defaults.push('z-index: 1;');
  if (isArtboard) {
    const fill = resolveNodeFillCss(node, tokenMap, fallbackCanvasBg) ?? fallbackCanvasBg;
    defaults.push(`background: ${fallbackCanvasBg};`);
    defaults.push(`color: ${isCssSurfaceDark(fill) ? '#f8fafc' : '#0f172a'};`);
    defaults.push(`width: ${Math.round(layout.frame.width || 1120)}px;`);
    defaults.push('box-shadow: 0 20px 48px rgba(0,0,0,0.38);');
  } else if (layout.width.mode === 'fill' && parentMode === 'flex' && !useFrame && !layout.flexChild) {
    defaults.push('flex: 1 1 0%;');
  }
  if (node.semanticTag === 'ul') defaults.push('list-style: none;', 'margin: 0;');
  if (/^h[1-6]$/.test(node.semanticTag) || node.semanticTag === 'p') defaults.push('margin: 0;');

  for (const [state, override] of Object.entries(node.stateOverrides ?? {})) {
    if (!override) continue;
    const declarations = compileStateOverrideToCssDeclarations(override, context);
    if (declarations.length > 0) {
      rules.states.push(`${previewStateSelector(selector, state as InteractiveStateKey)} { ${declarations.join(' ')} }`);
    }
  }

  // Fallback control styles sit below the assigned classes and authored node CSS.
  const addStyleRules = (controlDefaults: string[] = []) => {
    rules.defaults.push(`${selector} { ${[...defaults, ...controlDefaults].join(' ')} }`);
    rules.nodes.push(`${selector} { ${compiled.join(' ')} }`);
  };

  // Attributes (Canonical DOM ID + Legacy studio-id + HTMX + Interactive State + IPC + Script + Blueprints)
  const attrs: string[] = [
    `id="${escapeHtml(canonicalDomId)}"`,
    `data-studio-id="node-${escapeHtml(node.id)}"`,
    `data-node-id="${escapeHtml(node.id)}"`,
    `data-node-name="${escapeHtml(node.name)}"`,
  ];

  const attachedClasses = node.classNames ?? node.style.classNames ?? [];
  if (attachedClasses.length > 0) {
    attrs.push(`class="${escapeHtml(attachedClasses.join(' '))}"`);
  }

  if (node.platform?.a11y?.ariaLabel) {
    attrs.push(`aria-label="${escapeHtml(node.platform.a11y.ariaLabel)}"`);
  }
  if (node.platform?.a11y?.role) {
    attrs.push(`role="${escapeHtml(node.platform.a11y.role)}"`);
  }

  if (node.platform?.htmx) {
    const hx = node.platform.htmx;
    attrs.push(`${hx.method}="${escapeHtml(hx.endpoint)}"`);
    const targetSel = hx.targetNodeId
      ? `#${domIdMap.get(hx.targetNodeId) ?? `node-${hx.targetNodeId}`}`
      : hx.targetSelectorFallback || '';
    if (targetSel) attrs.push(`hx-target="${escapeHtml(targetSel)}"`);
    attrs.push(`hx-swap="${escapeHtml(hx.hxSwap ?? 'innerHTML')}"`);
    if (hx.hxTrigger) attrs.push(`hx-trigger="${escapeHtml(hx.hxTrigger)}"`);
  }

  let hasBpClickAttr = false;
  let hasBpInputAttr = false;

  for (const interaction of node.interactions ?? []) {
    const { trigger, action } = interaction;
    if (action.kind === 'ipc_invoke') {
      attrs.push(`data-ipc-channel="${escapeHtml(action.channel)}"`);
    } else if (action.kind === 'set_state') {
      attrs.push(`data-state-key="${escapeHtml(action.stateKey)}"`);
    } else if (action.kind === 'navigate') {
      attrs.push(`data-nav-target="${escapeHtml(action.targetSheetOrRoute)}"`);
    } else if (action.kind === 'http_fetch') {
      attrs.push(`data-http-fetch="${escapeHtml(`${action.method} ${action.url}`)}"`);
    } else if (action.kind === 'call_script_fn' || action.kind === 'call_handler') {
      const fnName = action.kind === 'call_script_fn' ? action.fnName : action.handlerName;
      if (action.kind === 'call_script_fn') {
        if (action.debounceMs) attrs.push(`data-script-debounce="${action.debounceMs}"`);
        if (action.keyFilter) attrs.push(`data-script-key="${escapeHtml(action.keyFilter)}"`);
        if (action.intervalMs) attrs.push(`data-script-interval-ms="${action.intervalMs}"`);
      }
      if (trigger === 'onInput') {
        attrs.push(`data-script-input="${escapeHtml(fnName)}"`);
      } else if (trigger === 'onChange') {
        attrs.push(`data-script-change="${escapeHtml(fnName)}"`);
      } else if (trigger === 'onSubmit') {
        attrs.push(`data-script-submit="${escapeHtml(fnName)}"`);
      } else if (trigger === 'onMount') {
        attrs.push(`data-script-mount="${escapeHtml(fnName)}"`);
      } else if (trigger === 'onHover') {
        attrs.push(`data-script-hover="${escapeHtml(fnName)}"`);
      } else if (trigger === 'onDoubleClick') {
        attrs.push(`data-script-dblclick="${escapeHtml(fnName)}"`);
      } else if (trigger === 'onMouseLeave') {
        attrs.push(`data-script-mouseleave="${escapeHtml(fnName)}"`);
      } else if (trigger === 'onFocus') {
        attrs.push(`data-script-focus="${escapeHtml(fnName)}"`);
      } else if (trigger === 'onBlur') {
        attrs.push(`data-script-blur="${escapeHtml(fnName)}"`);
      } else if (trigger === 'onKeyDown') {
        attrs.push(`data-script-keydown="${escapeHtml(fnName)}"`);
      } else if (trigger === 'onInterval') {
        attrs.push(`data-script-interval="${escapeHtml(fnName)}"`);
      } else {
        attrs.push(`data-script-click="${escapeHtml(fnName)}"`);
      }
    } else if (action.kind === 'trigger_blueprint') {
      const bpSpec = `${action.blueprintId}::${action.eventName}`;
      if (trigger === 'onInput' || trigger === 'onChange') {
        attrs.push(`data-bp-input="${escapeHtml(bpSpec)}"`);
        hasBpInputAttr = true;
      } else {
        attrs.push(`data-bp-event="${escapeHtml(bpSpec)}"`);
        hasBpClickAttr = true;
      }
    }
  }

  // Auto-wire Blueprint event nodes targeting this Canvas element by ID or Name
  if (options?.blueprintGraphs) {
    for (const bpGraph of options.blueprintGraphs) {
      for (const bpNode of bpGraph.nodes) {
        if (bpNode.category !== 'event') continue;
        const matchesNode =
          bpNode.targetUiNodeId === node.id ||
          (bpNode.config?.elementName && String(bpNode.config.elementName) === node.name);
        if (!matchesNode) continue;

        const bpSpec = `${bpGraph.id}::${bpNode.id}`;
        if (bpNode.kind === 'event_ui_click' && !hasBpClickAttr) {
          attrs.push(`data-bp-event="${escapeHtml(bpSpec)}"`);
          hasBpClickAttr = true;
        } else if (bpNode.kind === 'event_input_change' && !hasBpInputAttr) {
          attrs.push(`data-bp-input="${escapeHtml(bpSpec)}"`);
          hasBpInputAttr = true;
        }
      }
    }
  }

  const iconObj = node.content?.iconName
    ? OFFLINE_ICON_CATALOG.find((ic) => ic.id === node.content?.iconName)
    : undefined;
  const iconSvg = iconObj
    ? `<svg width="15" height="15" viewBox="${iconObj.viewBox}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">${iconObj.svgBody}</svg>`
    : '';

  // Specific control rendering
  const ctrl = node.content?.controlType;
  if (node.kind === 'control') {
    if (ctrl === 'three-viewport') {
      const sceneId = node.content?.threeSceneId ?? '';
      addStyleRules(['overflow: hidden;', 'display: flex;', 'flex-direction: column;', 'justify-content: space-between;', 'cursor: pointer;']);
      return `<div ${attrs.join(' ')} data-three-scene="${escapeHtml(sceneId)}">
        <canvas class="studio-three-canvas" data-three-canvas="${escapeHtml(sceneId)}" width="480" height="300" style="width:100%;height:100%;display:block"></canvas>
        <div style="position:absolute;left:10px;bottom:8px;padding:2px 8px;border-radius:999px;background:rgba(15,23,42,0.82);border:1px solid rgba(59,130,246,0.45);color:#93c5fd;font-size:11px;font-weight:600;pointer-events:none">
          🧊 ${escapeHtml(node.content?.text ?? node.name)} (Clicca per interagire)
        </div>
      </div>`;
    }
    if (ctrl === 'text-input' || ctrl === 'password') {
      addStyleRules();
      const inputType = ctrl === 'password' ? 'password' : 'text';
      return `<input type="${inputType}" ${attrs.join(' ')} placeholder="${escapeHtml(node.content?.placeholder ?? '')}" value="${escapeHtml(node.content?.value ?? '')}" />`;
    }
    if (ctrl === 'textarea') {
      addStyleRules(['resize: vertical;']);
      return `<textarea ${attrs.join(' ')} placeholder="${escapeHtml(node.content?.placeholder ?? '')}">${escapeHtml(node.content?.value ?? '')}</textarea>`;
    }
    if (ctrl === 'select') {
      addStyleRules();
      const opts = (node.content?.options ?? ['Option 1', 'Option 2'])
        .map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`)
        .join('');
      return `<select ${attrs.join(' ')}>${opts}</select>`;
    }
    if (ctrl === 'checkbox' || ctrl === 'switch') {
      addStyleRules(['display: inline-flex;', 'align-items: center;', 'gap: 8px;', 'cursor: pointer;']);
      const checkedAttr = node.content?.checked ? 'checked' : '';
      return `<label ${attrs.join(' ')}><input type="checkbox" ${checkedAttr} /> <span class="studio-node-text">${escapeHtml(node.content?.text ?? node.name)}</span></label>`;
    }
    if (ctrl === 'table') {
      const cols = node.content?.tableColumns ?? ['ID', 'Name', 'Status'];
      const rows = node.content?.tableRows ?? [['1', 'Sample', 'OK']];
      addStyleRules(['border-collapse: collapse;', 'overflow: hidden;']);
      const ths = cols
        .map(
          (c) =>
            `<th style="text-align:left;padding:10px 14px;border-bottom:1px solid #33415544;font-size:12px">${escapeHtml(c)}</th>`,
        )
        .join('');
      const trs = rows
        .map(
          (r) =>
            `<tr>${r.map((cell) => `<td style="padding:9px 14px;border-bottom:1px solid #33415522;font-size:13px">${escapeHtml(cell)}</td>`).join('')}</tr>`,
        )
        .join('');
      return `<table ${attrs.join(' ')}><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
    }
    if (ctrl === 'button' || node.semanticTag === 'button') {
      addStyleRules([
        'display: inline-flex;', 'align-items: center;', 'justify-content: center;', 'gap: 7px;',
        'cursor: pointer;', 'transition: filter 0.12s ease, transform 0.1s ease;', 'border: none;',
      ]);
      return `<button type="button" ${attrs.join(' ')}>${iconSvg}<span class="studio-node-text">${escapeHtml(node.content?.text ?? node.name)}</span></button>`;
    }
  }

  if (node.kind === 'media' && node.content?.imageUrl) {
    addStyleRules(['object-fit: contain;', 'display: block;']);
    return `<img ${attrs.join(' ')} src="${escapeHtml(node.content.imageUrl)}" alt="${escapeHtml(node.content?.text ?? node.name)}" />`;
  }

  addStyleRules();
  const tag = node.semanticTag === 'window' ? 'main' : node.semanticTag || 'div';
  const childrenHtml = node.childIds
    .map((cid) =>
      renderNodeHtml(
        cid,
        sheet,
        tokenMap,
        node.layout.mode,
        options,
        rules,
        fallbackCanvasBg,
        domIdMap,
      ),
    )
    .join('\n');
  const innerText = node.content?.text ? `${iconSvg}${escapeHtml(node.content.text)}` : iconSvg;

  return `<${tag} ${attrs.join(' ')}>${innerText}${childrenHtml}</${tag}>`;
}

export function buildSandboxPreviewHtml(
  sheet: UISheetDocument,
  tokens: DesignTokenEntry[],
  activeThemeId: string | null,
  options?: SandboxBuildOptions,
): string {
  // Resolve dark theme override ID if activeThemeId is unset while Studio is in dark mode
  const darkThemeOverrideId =
    tokens.find((t) => t.themeId !== null && t.tokenPath === 'color.bg.canvas' && isCssSurfaceDark(t.rawValue))
      ?.themeId ??
    tokens.find((t) => t.themeId !== null)?.themeId ??
    null;

  const effectiveThemeId =
    activeThemeId ?? (options?.studioTheme !== 'light' ? darkThemeOverrideId : null);

  let tokenMap = buildTokenLookupMap(tokens, effectiveThemeId);

  const rootArtboard =
    sheet.rootIds.map((rid) => sheet.nodes[rid]).find((n) => n?.kind === 'artboard') ??
    (sheet.rootIds[0] ? sheet.nodes[sheet.rootIds[0]] : undefined);

  const initialBgCanvas = String(tokenMap['color.bg.canvas'] ?? '#0b1120');
  const artboardFillPreview = resolveNodeFillCss(rootArtboard, tokenMap, initialBgCanvas) ?? initialBgCanvas;
  const artboardIsDark = isCssSurfaceDark(artboardFillPreview);

  // If the root artboard explicitly uses a dark fill (e.g. #0b1120) while tokenMap resolved light tokens,
  // align semantic surface/text tokens so dark custom artboards never render white surfaces behind white text.
  if (artboardIsDark && !isCssSurfaceDark(String(tokenMap['color.bg.surface'] ?? '#111827'))) {
    if (darkThemeOverrideId) {
      tokenMap = buildTokenLookupMap(tokens, darkThemeOverrideId);
    } else {
      tokenMap = {
        ...tokenMap,
        'color.bg.canvas': '#0b1120',
        'color.bg.surface': '#111827',
        'color.bg.muted': '#1e293b',
        'color.text.primary': '#f8fafc',
        'color.text.secondary': '#94a3b8',
        'color.border.subtle': '#334155',
      };
    }
  }

  const bgCanvas = String(tokenMap['color.bg.canvas'] ?? (artboardIsDark ? '#0b1120' : '#f8fafc'));
  const resolvedArtboardBg = resolveNodeFillCss(rootArtboard, tokenMap, bgCanvas) ?? bgCanvas;
  const isFinalDark = isCssSurfaceDark(resolvedArtboardBg);
  const textPrimary = isFinalDark
    ? String(isCssSurfaceDark(String(tokenMap['color.text.primary'] ?? '#f8fafc')) ? '#f8fafc' : tokenMap['color.text.primary'] ?? '#f8fafc')
    : String(!isCssSurfaceDark(String(tokenMap['color.text.primary'] ?? '#0f172a')) ? '#0f172a' : tokenMap['color.text.primary'] ?? '#0f172a');
  const bgMuted = String(tokenMap['color.bg.muted'] ?? (isFinalDark ? '#1e293b' : '#f1f5f9'));
  const outerStageBg = isFinalDark ? '#070a12' : '#e2e8f0';

  const rules: PreviewStyleRules = { defaults: [], nodes: [], states: [] };
  const domIdMap = buildSheetDomIdLookup(sheet);
  const classes = compileReusableClassesCss(sheet.reusableClasses, tokenMap, {
    emitTokenVars: false,
    scope: 'base',
  });
  const classStates = compileReusableClassesCss(sheet.reusableClasses, tokenMap, {
    emitTokenVars: false,
    scope: 'states',
    stateSelector: previewStateSelector,
  });
  const keyframes = compileSheetKeyframesCss(sheet);

  const rootParentMode = sheet.defaultLayoutMode === 'freeform' ? 'freeform' : 'flex';
  const bodyNodes = sheet.rootIds
    .map((rid) =>
      renderNodeHtml(rid, sheet, tokenMap, rootParentMode, options, rules, bgCanvas, domIdMap),
    )
    .join('\n');

  const initialStateEntries: Record<string, unknown> = {};
  for (const st of sheet.stateSchema ?? []) {
    initialStateEntries[st.name] = st.initialValue;
  }

  // Bundle all separate .js / .ts scripts into topological __studioModuleRegistry ES module blocks
  const transpiledScripts = bundleScriptsForSandboxRegistry(collectSandboxScriptFiles(sheet, options));
  const sqlSeedMap: Record<string, unknown[]> = {};
  for (const sr of options?.sqlDocument?.seedRows ?? []) {
    sqlSeedMap[sr.tableName] = sr.rows;
  }

  // Compile all Blueprint graphs into executable runtime JS
  const compiledBlueprints: string[] = [];
  for (const bp of options?.blueprintGraphs ?? []) {
    const cleanBpJs = sanitizeBlueprintRuntimeJs(compileBlueprintToRuntimeJs(bp));
    compiledBlueprints.push(`/* --- Blueprint: ${bp.name} --- */\n${escapeInlineScript(cleanBpJs)}`);
  }

  const threeMeta = (options?.threeScenes ?? []).map((sc) => ({
    id: sc.id,
    name: sc.name,
    bg: sc.environment.backgroundColor,
    meshes: sc.objects
      .filter((o) => o.nodeType === 'mesh' && o.visible)
      .map((o) => ({
        id: o.id,
        name: o.name,
        color: o.material?.color ?? '#3b82f6',
        rotY: o.rotationDeg.y ?? 0,
      })),
  }));

  const previewCss = [
    `@layer studio-defaults {\n${rules.defaults.join('\n')}\n}`,
    `@layer studio-classes {\n${classes}\n}`,
    `@layer studio-nodes {\n${rules.nodes.join('\n')}\n}`,
    `@layer studio-states {\n${classStates}\n${rules.states.join('\n')}\n}`,
    keyframes,
    sheet.customCss,
  ].filter(Boolean).join('\n');
  const colorScheme = isFinalDark ? 'dark' : 'light';

  return `<!doctype html>
<html lang="it" data-theme="${colorScheme}">
<head>
  <meta charset="UTF-8" />
  <style>
    @layer studio-defaults, studio-classes, studio-nodes, studio-states;
    body {
      margin: 0;
      padding: 20px;
      background: ${outerStageBg};
      color: ${textPrimary};
      font-family: Inter, system-ui, -apple-system, sans-serif;
    }
    @layer studio-defaults {
      * { box-sizing: border-box; }
      button:hover { filter: brightness(1.08); }
      button:active { transform: translateY(1px); }
    }
    .htmx-swapping { opacity: 0.55; transition: opacity 120ms ease; }
    .mock-item {
      padding: 10px 14px;
      border-radius: 6px;
      background: ${bgMuted};
      color: ${textPrimary};
      font-size: 13.5px;
      font-weight: 500;
      margin-bottom: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    #studio-toast-host {
      position: fixed;
      right: 16px;
      bottom: 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      z-index: 9999;
      pointer-events: none;
    }
    .studio-sandbox-toast {
      padding: 8px 14px;
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.94);
      border: 1px solid rgba(59, 130, 246, 0.55);
      color: #f8fafc;
      font-size: 12px;
      font-weight: 600;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.45);
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    ${previewCss.replace(/<\/style/gi, '\\3C /style')}
  </style>
</head>
<body>
  ${bodyNodes}
  <div id="studio-toast-host"></div>
  <script>
    (function() {
      const MOCK_CATALOG = [
        { sku: 'SKU-4090', title: 'Local Workstation GPU Module 24GB', stock: '24 units', price: '$1,599' },
        { sku: 'SKU-2088', title: 'Tactile Mechanical Studio Keyboard', stock: '86 units', price: '$189' },
        { sku: 'SKU-7710', title: '4K Calibrated OLED Reference Monitor', stock: '12 units', price: '$949' },
        { sku: 'SKU-5120', title: 'NVMe Gen5 Local AI Dataset Array 4TB', stock: '41 units', price: '$379' },
        { sku: 'SKU-3301', title: 'Thunderbolt 5 Audio & Capture Dock', stock: '19 units', price: '$299' }
      ];
      let orderCounter = 1482;

      function emitLog(kind, summary, level) {
        window.parent.postMessage({ source: 'studio-sandbox', kind, level: level || 'info', summary: String(summary), ts: Date.now() }, '*');
      }

      function formatArg(val) {
        if (typeof val === 'string') return val;
        if (val === undefined) return 'undefined';
        if (val === null) return 'null';
        try { return JSON.stringify(val); } catch (_e) { return String(val); }
      }

      // Forward console.log / info / warn / error to Studio Console
      const origConsole = {
        log: console.log.bind(console),
        info: console.info.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
      };
      ['log', 'info', 'warn', 'error'].forEach(function(lvl) {
        console[lvl] = function() {
          origConsole[lvl].apply(console, arguments);
          const msg = Array.prototype.slice.call(arguments).map(formatArg).join(' ');
          emitLog('script', msg, lvl);
        };
      });

      function decorateSandboxToast(pill, kind) {
        if (kind === 'success') pill.style.borderColor = '#10b981';
        else if (kind === 'warn' || kind === 'warning') pill.style.borderColor = '#f59e0b';
        else if (kind === 'error') pill.style.borderColor = '#ef4444';
      }

      function showSandboxToast(message, kind) {
        const host = document.getElementById('studio-toast-host');
        if (!host) return;
        const pill = document.createElement('div');
        pill.className = 'studio-sandbox-toast';
        decorateSandboxToast(pill, kind);
        pill.textContent = String(message);
        host.appendChild(pill);
        setTimeout(function() {
          pill.style.opacity = '0';
          setTimeout(function() { if (pill.parentNode) pill.parentNode.removeChild(pill); }, 220);
        }, 2400);
      }

      // Listen for standalone v3.0 DOM CustomEvent('studio:toast')
      if (typeof window.addEventListener === 'function') {
        window.addEventListener('studio:toast', function(ev) {
          const detail = (ev && ev.detail) || {};
          const msg = String(detail.message ?? 'Notifica');
          const variant = detail.variant || 'info';
          if (ev.cancelable) {
            ev.preventDefault();
            showSandboxToast(msg, variant);
          } else {
            // Legacy generated listeners append their own fallback after dispatching the event.
            const host = document.getElementById('studio-toast-host');
            const start = host?.children.length ?? 0;
            queueMicrotask(function() {
              const fallback = host && Array.from(host.children).slice(start).find(function(child) {
                return child.classList.contains('studio-sandbox-toast') && child.textContent === msg;
              });
              if (fallback) decorateSandboxToast(fallback, variant);
              else showSandboxToast(msg, variant);
            });
          }
          emitLog('script', '[Toast] ' + msg, variant === 'error' ? 'error' : 'info');
        });
      }

      // Preserve legacy v2.x document.getElementById('node-<id>') alongside canonical kebab-case DOM IDs
      const origGetById = document.getElementById ? document.getElementById.bind(document) : null;
      if (origGetById) {
        document.getElementById = function(id) {
          const direct = origGetById(id);
          if (direct) return direct;
          if (document.querySelector && id) {
            const escaped = String(id).split('"').join('');
            return document.querySelector('[data-studio-id="' + escaped + '"]') || document.querySelector('[data-node-id="' + escaped + '"]');
          }
          return null;
        };
      }

      function findNodeElement(idOrName) {
        if (!idOrName) return null;
        const byPrefixedId = document.getElementById('node-' + idOrName);
        if (byPrefixedId) return byPrefixedId;
        const byDirectId = document.getElementById(idOrName);
        if (byDirectId) return byDirectId;
        const allNamed = document.querySelectorAll('[data-node-name]');
        for (let i = 0; i < allNamed.length; i++) {
          if (allNamed[i].getAttribute('data-node-name') === idOrName) return allNamed[i];
        }
        const lower = String(idOrName).toLowerCase();
        for (let i = 0; i < allNamed.length; i++) {
          if ((allNamed[i].getAttribute('data-node-name') || '').toLowerCase() === lower) return allNamed[i];
        }
        return null;
      }

      // SQL Sandbox Bridge + Seed Fallback + Fetch / Tauri Invoke Interceptors
      const sqlSeedTables = ${escapeInlineScript(JSON.stringify(sqlSeedMap))};
      const pendingSqlCallbacks = {};

      if (typeof window.addEventListener === 'function') {
        window.addEventListener('message', function(ev) {
          if (ev.source === window.parent && ev.data?.source === 'studio-sandbox-sql-res' && ev.data.reqId) {
            const cb = pendingSqlCallbacks[ev.data.reqId];
            if (cb) {
              delete pendingSqlCallbacks[ev.data.reqId];
              cb(ev.data.result);
            }
          }
        });
      }

      function runLocalSeedFallback(payload) {
        const op = String((payload && payload.operation) || 'SELECT').toUpperCase();
        const rawSql = String((payload && payload.sql) || '');
        let table = (payload && payload.table) || '';
        if (!table && rawSql) {
          const m = rawSql.match(/(?:FROM|INTO|UPDATE)\\s+["']?([A-Za-z0-9_]+)["']?/i);
          if (m) table = m[1];
        }
        if (!table) {
          const keys = Object.keys(sqlSeedTables);
          table = keys[0] || 'items';
        }
        if (!Array.isArray(sqlSeedTables[table])) {
          sqlSeedTables[table] = [];
        }
        const rows = sqlSeedTables[table];
        if (op === 'INSERT' || /^\\s*INSERT/i.test(rawSql)) {
          const record = Object.assign({ id: rows.length + 1 }, (payload && (payload.values || payload.params)) || {});
          rows.push(record);
          return { ok: true, rows: [record], rowCount: 1 };
        }
        if (op === 'DELETE' || /^\\s*DELETE/i.test(rawSql)) {
          const removed = rows.length > 0 ? 1 : 0;
          if (rows.length > 0) rows.pop();
          return { ok: true, rows: [], rowCount: removed };
        }
        return { ok: true, rows: rows.slice(), rowCount: rows.length };
      }

      window.__studioSqlBridge = function(payload) {
        const safePayload = payload || {};
        const label = safePayload.sql || ((safePayload.operation || 'SELECT') + ' ' + (safePayload.table || safePayload.queryId || ''));
        emitLog('sql', '[SQL Bridge] ' + label, 'info');

        if (window.parent && window.parent !== window && typeof window.parent.postMessage === 'function') {
          const reqId = 'sql_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
          return new Promise(function(resolve) {
            let settled = false;
            const timer = setTimeout(function() {
              if (settled) return;
              settled = true;
              delete pendingSqlCallbacks[reqId];
              resolve({ ok: false, error: 'Tempo di attesa del Sandbox SQL scaduto.' });
            }, 10000);
            pendingSqlCallbacks[reqId] = function(res) {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              resolve(res ?? { ok: false, error: 'Risposta del Sandbox SQL mancante.' });
            };
            window.parent.postMessage({ source: 'studio-sandbox-sql-req', reqId: reqId, payload: safePayload }, '*');
          });
        }
        return Promise.resolve(runLocalSeedFallback(safePayload));
      };

      window.__studioTauriInvoke = function(cmd, args) {
        const commandName = String(cmd || '');
        if (commandName.indexOf('sql_') === 0 || (args && (args.sql || args.table || args.queryId))) {
          return window.__studioSqlBridge(Object.assign({ command: commandName }, args || {}));
        }
        emitLog('ipc', 'Tauri invoke("' + commandName + '", ' + formatArg(args || {}) + ') -> OK', 'info');
        return Promise.resolve({ ok: true, command: commandName, payload: args || {} });
      };

      window.__studioModuleRegistry = window.__studioModuleRegistry || {};
      window.__studioModuleRegistry['@tauri-apps/api/core'] = { invoke: window.__studioTauriInvoke };
      window.__studioModuleRegistry['@tauri-apps/api/tauri'] = { invoke: window.__studioTauriInvoke };

      const origFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
      window.fetch = function(input, init) {
        const url = typeof input === 'string' ? input : (input && input.url ? input.url : String(input));
        const method = ((init && init.method) || 'GET').toUpperCase();
        if (url.indexOf('/api/sql') === 0 || url.indexOf('/api/db') === 0) {
          let parsedBody = {};
          if (init && typeof init.body === 'string' && init.body.trim()) {
            try { parsedBody = JSON.parse(init.body); } catch (_e) { parsedBody = { raw: init.body }; }
          }
          const pathSegment = url.replace(/^\\/api\\/(?:sql|db)\\/?/, '').split('?')[0];
          const sqlPayload = Object.assign(
            {
              operation: method === 'POST' ? 'INSERT' : method === 'PUT' || method === 'PATCH' ? 'UPDATE' : method === 'DELETE' ? 'DELETE' : 'SELECT',
              table: parsedBody.table || (pathSegment && pathSegment !== 'query' ? pathSegment : undefined),
            },
            parsedBody
          );
          return window.__studioSqlBridge(sqlPayload).then(function(res) {
            return {
              ok: res.ok,
              status: res.ok ? 200 : 400,
              json: function() { return Promise.resolve(res); },
              text: function() { return Promise.resolve(JSON.stringify(res)); },
            };
          });
        }
        if (url.indexOf('/api/') === 0) {
          emitLog('script', '[fetch] ' + method + ' ' + url + ' -> 200 OK (Sandbox Mock)', 'info');
          const mockPayload = method === 'GET' ? MOCK_CATALOG : { ok: true, id: ++orderCounter };
          return Promise.resolve({
            ok: true,
            status: 200,
            json: function() { return Promise.resolve(mockPayload); },
            text: function() { return Promise.resolve(JSON.stringify(mockPayload)); },
          });
        }
        if (origFetch) {
          return origFetch(input, init);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: function() { return Promise.resolve([]); },
          text: function() { return Promise.resolve('[]'); },
        });
      };

      // Live 3D Viewport Canvas State
      const threeScenesMeta = ${escapeInlineScript(JSON.stringify(threeMeta))};
      const threeMeshState = {};
      threeScenesMeta.forEach(function(sc) {
        (sc.meshes || []).forEach(function(m) {
          threeMeshState[m.name] = { color: m.color, rotY: m.rotY || 0, rotX: 18 };
          threeMeshState[m.id] = threeMeshState[m.name];
        });
      });
      if (!threeMeshState.HeroMesh) {
        threeMeshState.HeroMesh = { color: '#3b82f6', rotY: 0, rotX: 18 };
      }

      // StudioRuntimeContext implementation for TypeScript Scripts & Unreal Blueprints
      const runtimeState = Object.assign({ orderCount: 1482, counter: 1482, clicks: 0 }, ${escapeInlineScript(JSON.stringify(initialStateEntries))});
      window.__appState = runtimeState;

      for (const storageName of ['localStorage', 'sessionStorage']) {
        try {
          window[storageName].getItem('');
        } catch (_error) {
          const entries = new Map();
          Object.defineProperty(window, storageName, { configurable: true, value: {
            get length() { return entries.size; },
            getItem: (key) => entries.get(String(key)) ?? null,
            setItem: (key, value) => entries.set(String(key), String(value)),
            removeItem: (key) => entries.delete(String(key)),
            clear: () => entries.clear(),
            key: (index) => Array.from(entries.keys())[index] ?? null,
          } });
        }
      }
      const ctx = {
        state: runtimeState,
        getText: function(idOrName) {
          const el = findNodeElement(idOrName);
          if (!el) return '';
          if ('value' in el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return el.value || '';
          const innerSpan = el.querySelector('.studio-node-text');
          return (innerSpan ? innerSpan.textContent : el.textContent) || '';
        },
        setText: function(idOrName, text) {
          const el = findNodeElement(idOrName);
          if (!el) return;
          const innerSpan = el.querySelector('.studio-node-text');
          if (innerSpan) innerSpan.textContent = String(text);
          else el.textContent = String(text);
        },
        getValue: function(idOrName) {
          const el = findNodeElement(idOrName);
          if (!el) return '';
          if ('value' in el) return String(el.value || '');
          return el.textContent || '';
        },
        setValue: function(idOrName, value) {
          const el = findNodeElement(idOrName);
          if (el && 'value' in el) el.value = String(value);
        },
        setStyle: function(idOrName, cssPatch) {
          const el = findNodeElement(idOrName);
          if (!el || !cssPatch) return;
          Object.keys(cssPatch).forEach(function(k) {
            el.style[k] = String(cssPatch[k]);
          });
        },
        setVisible: function(idOrName, visible) {
          const el = findNodeElement(idOrName);
          if (el) el.style.display = visible ? '' : 'none';
        },
        log: function() {
          const msg = Array.prototype.slice.call(arguments).map(formatArg).join(' ');
          const isBp = msg.indexOf('[Blueprint') === 0;
          emitLog(isBp ? 'blueprint' : 'script', msg, 'info');
        },
        toast: function(message, kind) {
          showSandboxToast(message, kind || 'info');
          emitLog('script', '[Toast] ' + String(message), 'info');
        },
        three: {
          rotate: function(meshName, dx, dy, dz) {
            const st = threeMeshState[meshName] || (threeMeshState[meshName] = { color: '#8b5cf6', rotY: 0, rotX: 18 });
            st.rotX += Number(dx || 0);
            st.rotY += Number(dy || 0);
            void dz;
            emitLog('blueprint', '[Three.js] Rotate ' + meshName + ' -> Y=' + Math.round(st.rotY) + '°', 'info');
          },
          setColor: function(meshName, hexColor) {
            const st = threeMeshState[meshName] || (threeMeshState[meshName] = { color: '#8b5cf6', rotY: 0, rotX: 18 });
            st.color = String(hexColor || '#8b5cf6');
            emitLog('blueprint', '[Three.js] Color ' + meshName + ' -> ' + st.color, 'info');
          }
        }
      };
      window.__studioRuntimeCtx = ctx;

      ${transpiledScripts.join('\n\n      ')}

      ${compiledBlueprints.join('\n\n      ')}

      // Merge Blueprint initial variables into runtimeState
      const bpRegistry = window.__studioBlueprints || {};
      Object.keys(bpRegistry).forEach(function(bpId) {
        const initVars = bpRegistry[bpId] && bpRegistry[bpId].initialState;
        if (initVars) {
          Object.keys(initVars).forEach(function(k) {
            if (runtimeState[k] === undefined) runtimeState[k] = initVars[k];
          });
        }
      });

      function invokeScriptHandler(fnName, payload, domEvent) {
        const handlers = window.__studioScriptHandlers || {};
        const fn = handlers[fnName];
        if (typeof fn !== 'function') {
          emitLog('script', 'Handler "' + fnName + '" non trovato negli script caricati.', 'warn');
          return;
        }
        try {
          const fnSrc = Function.prototype.toString.call(fn);
          const expectsCtxFirst =
            /^\\s*(?:async\\s+)?(?:function\\s*[A-Za-z0-9_$]*\\s*)?\\(\\s*ctx\\b/.test(fnSrc) ||
            /^\\s*(?:async\\s+)?ctx\\s*=>/.test(fnSrc);
          const res = expectsCtxFirst ? fn(ctx, payload) : fn(domEvent || payload, ctx);
          if (res && typeof res.then === 'function') {
            res.catch(function(err) {
              emitLog('script', 'Errore async in ' + fnName + ': ' + (err && err.message ? err.message : String(err)), 'error');
            });
          }
        } catch (err) {
          emitLog('script', 'Errore in ' + fnName + ': ' + (err && err.message ? err.message : String(err)), 'error');
        }
      }

      function invokeBlueprintSpec(spec, payload) {
        if (!spec) return;
        const parts = spec.split('::');
        const bpId = parts[0];
        const evIdOrName = parts[1] || '';
        const bp = bpRegistry[bpId] || bpRegistry[Object.keys(bpRegistry)[0]];
        if (!bp || !Array.isArray(bp.events)) return;
        const matched = bp.events.filter(function(ev) {
          return ev.id === evIdOrName || ev.kind === evIdOrName || ev.elementName === evIdOrName;
        });
        const targets = matched.length > 0 ? matched : bp.events.slice(0, 1);
        targets.forEach(function(ev) {
          emitLog('blueprint', '▶ Blueprint Event [' + ev.kind + '] attivato (' + (ev.elementName || ev.id) + ')', 'info');
          Promise.resolve(ev.run(ctx, payload || {})).catch(function(err) {
            emitLog('blueprint', 'Errore Blueprint: ' + (err && err.message ? err.message : String(err)), 'error');
          });
        });
      }

      // Wire data-script-* attributes (supporting both standalone v3.0 DOM functions and legacy ctx handlers)
      document.querySelectorAll('[data-script-click]').forEach(function(el) {
        el.addEventListener('click', function(e) {
          if (el.tagName === 'A') e.preventDefault();
          invokeScriptHandler(el.getAttribute('data-script-click'), { elementId: el.id }, e);
        });
      });
      document.querySelectorAll('[data-script-dblclick]').forEach(function(el) {
        el.addEventListener('dblclick', function(e) {
          invokeScriptHandler(el.getAttribute('data-script-dblclick'), { elementId: el.id }, e);
        });
      });
      document.querySelectorAll('[data-script-input]').forEach(function(el) {
        const debounceMs = Number(el.getAttribute('data-script-debounce') || 0);
        let timer = null;
        el.addEventListener('input', function(e) {
          const val = e.target ? e.target.value : '';
          if (debounceMs > 0) {
            clearTimeout(timer);
            timer = setTimeout(function() {
              invokeScriptHandler(el.getAttribute('data-script-input'), val, e);
            }, debounceMs);
          } else {
            invokeScriptHandler(el.getAttribute('data-script-input'), val, e);
          }
        });
      });
      document.querySelectorAll('[data-script-change]').forEach(function(el) {
        el.addEventListener('change', function(e) {
          invokeScriptHandler(el.getAttribute('data-script-change'), e.target ? e.target.value : '', e);
        });
      });
      document.querySelectorAll('[data-script-submit]').forEach(function(el) {
        el.addEventListener('submit', function(e) {
          e.preventDefault();
          invokeScriptHandler(el.getAttribute('data-script-submit'), {}, e);
        });
      });
      document.querySelectorAll('[data-script-hover]').forEach(function(el) {
        el.addEventListener('mouseenter', function(e) {
          invokeScriptHandler(el.getAttribute('data-script-hover'), {}, e);
        });
      });
      document.querySelectorAll('[data-script-mouseleave]').forEach(function(el) {
        el.addEventListener('mouseleave', function(e) {
          invokeScriptHandler(el.getAttribute('data-script-mouseleave'), {}, e);
        });
      });
      document.querySelectorAll('[data-script-focus]').forEach(function(el) {
        el.addEventListener('focus', function(e) {
          invokeScriptHandler(el.getAttribute('data-script-focus'), {}, e);
        });
      });
      document.querySelectorAll('[data-script-blur]').forEach(function(el) {
        el.addEventListener('blur', function(e) {
          invokeScriptHandler(el.getAttribute('data-script-blur'), {}, e);
        });
      });
      document.querySelectorAll('[data-script-keydown]').forEach(function(el) {
        const keyFilter = el.getAttribute('data-script-key') || '';
        el.addEventListener('keydown', function(e) {
          if (keyFilter && e.key !== keyFilter) return;
          invokeScriptHandler(el.getAttribute('data-script-keydown'), { key: e.key }, e);
        });
      });
      document.querySelectorAll('[data-script-mount]').forEach(function(el) {
        invokeScriptHandler(el.getAttribute('data-script-mount'), {}, { type: 'mount', target: el });
      });
      document.querySelectorAll('[data-script-interval]').forEach(function(el) {
        const ms = Math.max(250, Number(el.getAttribute('data-script-interval-ms') || 5000));
        setInterval(function() {
          invokeScriptHandler(el.getAttribute('data-script-interval'), {}, { type: 'interval', target: el });
        }, ms);
      });

      // Wire data-bp-event & data-bp-input attributes
      document.querySelectorAll('[data-bp-event]').forEach(function(el) {
        el.addEventListener('click', function() {
          invokeBlueprintSpec(el.getAttribute('data-bp-event'), { elementId: el.getAttribute('data-node-id') || el.id });
        });
      });
      document.querySelectorAll('[data-bp-input]').forEach(function(el) {
        el.addEventListener('input', function(e) {
          invokeBlueprintSpec(el.getAttribute('data-bp-input'), { value: e.target ? e.target.value : '' });
        });
      });

      // Execute Blueprint BeginPlay & KeyPress & 3D Click events
      Object.keys(bpRegistry).forEach(function(bpId) {
        const bp = bpRegistry[bpId];
        if (!bp || !Array.isArray(bp.events)) return;
        bp.events.forEach(function(ev) {
          if (ev.kind === 'event_begin_play') {
            emitLog('blueprint', '▶ Blueprint BeginPlay eseguito', 'info');
            Promise.resolve(ev.run(ctx, {})).catch(function() {});
          } else if (ev.kind === 'event_key_press') {
            window.addEventListener('keydown', function(ke) {
              emitLog('blueprint', '▶ Blueprint KeyPress: ' + ke.key, 'info');
              Promise.resolve(ev.run(ctx, { key: ke.key })).catch(function() {});
            });
          }
        });
      });

      // Interactive 2D/3D Projection Canvas for embedded Three.js Viewports
      const threeCanvases = document.querySelectorAll('.studio-three-canvas');
      if (threeCanvases.length > 0) {
        let tick = 0;
        threeCanvases.forEach(function(cv) {
          cv.parentElement.addEventListener('click', function() {
            const hero = threeMeshState.HeroMesh;
            hero.rotY += 35;
            emitLog('blueprint', '🧊 3D Raycast Click su HeroMesh (rotY=' + Math.round(hero.rotY) + '°)', 'info');
            Object.keys(bpRegistry).forEach(function(bpId) {
              const bp = bpRegistry[bpId];
              (bp.events || []).forEach(function(ev) {
                if (ev.kind === 'event_3d_click') {
                  Promise.resolve(ev.run(ctx, { meshName: 'HeroMesh' })).catch(function() {});
                }
              });
            });
          });
        });

        function renderThreePreview() {
          tick += 0.022;
          threeCanvases.forEach(function(cv) {
            const g = cv.getContext('2d');
            if (!g) return;
            const w = cv.width, h = cv.height;
            g.fillStyle = '#070b14';
            g.fillRect(0, 0, w, h);
            g.strokeStyle = 'rgba(59,130,246,0.16)';
            g.lineWidth = 1;
            for (let gx = -5; gx <= 5; gx++) {
              g.beginPath();
              g.moveTo(w / 2 + gx * 36, h * 0.62);
              g.lineTo(w / 2 + gx * 74, h);
              g.stroke();
            }
            const hero = threeMeshState.HeroMesh;
            const angle = tick + (hero.rotY * Math.PI) / 180;
            const cx = w / 2, cy = h * 0.46, r = 58;
            g.save();
            g.translate(cx, cy);
            const grad = g.createRadialGradient(-16, -18, 8, 0, 0, r * 1.2);
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(0.32, hero.color || '#3b82f6');
            grad.addColorStop(1, '#0f172a');
            g.fillStyle = grad;
            g.beginPath();
            for (let i = 0; i < 8; i++) {
              const a = angle + (i * Math.PI) / 4;
              const rad = i % 2 === 0 ? r : r * 0.74;
              const px = Math.cos(a) * rad;
              const py = Math.sin(a) * rad * 0.82;
              if (i === 0) g.moveTo(px, py);
              else g.lineTo(px, py);
            }
            g.closePath();
            g.fill();
            g.strokeStyle = 'rgba(255,255,255,0.45)';
            g.lineWidth = 1.5;
            g.stroke();
            g.restore();
          });
          requestAnimationFrame(renderThreePreview);
        }
        requestAnimationFrame(renderThreePreview);
      }

      // HTMX Hypermedia Responder
      function buildMockHtmlResponse(method, endpoint, query) {
        const q = (query || '').trim().toLowerCase();
        if (endpoint.includes('search') || method === 'GET') {
          const matches = MOCK_CATALOG.filter(function(item) {
            return !q || item.sku.toLowerCase().includes(q) || item.title.toLowerCase().includes(q);
          });
          if (matches.length === 0) {
            return '<li class="mock-item">Nessun risultato trovato per "' + q.replace(/</g, '&lt;') + '"</li>';
          }
          return matches.map(function(m) {
            return '<li class="mock-item"><span><strong>' + m.sku + '</strong> • ' + m.title + ' — In Stock (' + m.stock + ')</span><strong>' + m.price + '</strong></li>';
          }).join('');
        }
        if (endpoint.includes('refresh')) {
          const ts = new Date().toLocaleTimeString();
          return MOCK_CATALOG.slice(0, 3).map(function(m) {
            return '<li class="mock-item"><span>✅ [Sync ' + ts + '] <strong>' + m.sku + '</strong> • ' + m.title + '</span><strong>' + m.price + '</strong></li>';
          }).join('');
        }
        return '<div class="mock-item">✅ Risposta ipermediale 200 OK da <code>' + endpoint + '</code> (' + new Date().toLocaleTimeString() + ')</div>';
      }

      function executeHtmxSwap(el, queryValue) {
        const methodAttr = ['hx-get', 'hx-post', 'hx-put', 'hx-patch', 'hx-delete'].find(function(a) { return el.hasAttribute(a); });
        if (!methodAttr) return;
        const method = methodAttr.replace('hx-', '').toUpperCase();
        const endpoint = el.getAttribute(methodAttr) || '/api/mock';
        const targetSel = el.getAttribute('hx-target');
        const swapMode = el.getAttribute('hx-swap') || 'innerHTML';
        const target = targetSel
          ? (document.querySelector(targetSel) ||
            document.querySelector('[data-studio-id="' + targetSel.replace(/^#/, '') + '"]'))
          : el;

        const html = buildMockHtmlResponse(method, endpoint, queryValue);
        if (target) {
          target.classList.add('htmx-swapping');
          setTimeout(function() {
            if (swapMode === 'outerHTML') target.outerHTML = html;
            else if (swapMode === 'beforeend') target.insertAdjacentHTML('beforeend', html);
            else if (swapMode === 'afterbegin') target.insertAdjacentHTML('afterbegin', html);
            else target.innerHTML = html;
            target.classList.remove('htmx-swapping');
          }, 60);
        }
        emitLog('htmx', method + ' ' + endpoint + (queryValue ? '?q=' + queryValue : '') + ' -> swap(' + swapMode + ') su ' + (targetSel || 'self'));
      }

      document.querySelectorAll('[hx-get],[hx-post],[hx-put],[hx-patch],[hx-delete]').forEach(function(el) {
        const tag = el.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') {
          let timer = null;
          el.addEventListener('input', function(e) {
            clearTimeout(timer);
            timer = setTimeout(function() { executeHtmxSwap(el, e.target.value); }, 160);
          });
        } else if (tag === 'form') {
          el.addEventListener('submit', function(e) {
            e.preventDefault();
            const firstInput = el.querySelector('input');
            executeHtmxSwap(el, firstInput ? firstInput.value : '');
          });
        } else {
          el.addEventListener('click', function(e) {
            e.preventDefault();
            executeHtmxSwap(el, '');
          });
        }
      });

      // Wire Native IPC & State & Navigation buttons
      document.querySelectorAll('[data-ipc-channel]').forEach(function(el) {
        el.addEventListener('click', function() {
          const ch = el.getAttribute('data-ipc-channel');
          emitLog('ipc', 'ipcRenderer.invoke("' + ch + '", { format: "pdf" }) -> 200 OK (Report salvato)');
        });
      });

      document.querySelectorAll('[data-state-key]').forEach(function(el) {
        if (el.hasAttribute('data-bp-event') || el.hasAttribute('data-script-click')) return;
        el.addEventListener('click', function() {
          orderCounter += 1;
          const ordNode = document.getElementById('node-nd_kpi_ord_value');
          if (ordNode) ordNode.textContent = orderCounter.toLocaleString();
          emitLog('state', 'State mutation: orderCount -> ' + orderCounter);
        });
      });

      document.querySelectorAll('[data-nav-target]').forEach(function(el) {
        el.addEventListener('click', function() {
          const dest = el.getAttribute('data-nav-target');
          showSandboxToast('Navigazione -> ' + dest, 'info');
          emitLog('state', 'Navigate -> ' + dest);
        });
      });
      document.body.dataset.studioReady = 'true';
    })();
  </script>
</body>
</html>`;
}
