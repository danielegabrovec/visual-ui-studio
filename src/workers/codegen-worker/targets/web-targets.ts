import { findUIRNodeByCanvasId } from '@shared/layout-solver';
import {
  BUILTIN_TARGET_DESCRIPTORS,
  type CodegenTargetPlugin,
  type EmittedCodeFile,
  type StylingDialect,
  type TargetDescriptor,
  type UIRComponentDecl,
  type UIRModule,
  type UIRNode,
  type UIRStateSpec,
} from '@shared/ui-ir';
import { SourceMapWriter } from '../code-writer';
import {
  buildCssClassMap,
  buildStylesheetForTree,
  buildStylesheetWithSourceMap,
  buildTailwindClasses,
  buildUniqueNameMap,
  escapeDoubleQuoted,
  escapeHtml,
  getDomId,
  getLiteralText,
  getNodeCssClassName,
  isBoundValue,
  lookupOfflineIconSvg,
  toCamelCase,
  toPascalCase,
  toSnakeCase,
} from '../style-helpers';
import {
  collectGroupedScriptImportsForSubtree,
  computeRelativeModuleImport,
  getWebScriptModulesForHtml,
} from './script-module-helpers';

export function sanitizeHandlerIdent(raw: string, fallback = 'onAction'): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_$]/g, '');
  if (!cleaned) return fallback;
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

function collectWebSpecialUsage(root: UIRNode): {
  scriptFns: Set<string>;
  hasBlueprintEvents: boolean;
  hasThreeViewports: boolean;
} {
  const scriptFns = new Set<string>();
  let hasBlueprintEvents = false;
  let hasThreeViewports = false;

  const walk = (n: UIRNode) => {
    if (n.kind === 'ThreeViewport' || n.content?.controlType === 'three-viewport') {
      hasThreeViewports = true;
    }
    for (const inter of n.interactions) {
      if (inter.type === 'SCRIPT_CALL') {
        scriptFns.add(sanitizeHandlerIdent(inter.fnName));
      } else if (inter.type === 'BLUEPRINT_EVENT') {
        hasBlueprintEvents = true;
      }
    }
    for (const c of n.children) walk(c);
  };
  walk(root);

  return { scriptFns, hasBlueprintEvents, hasThreeViewports };
}

function getDescriptor(id: string): TargetDescriptor {
  const found = BUILTIN_TARGET_DESCRIPTORS.find((d) => d.id === id);
  if (!found) throw new Error(`Missing target descriptor for ${id}`);
  return found;
}

export function defaultStateLiteralJs(sv: UIRStateSpec): string {
  if (typeof sv.initialValue === 'string') return `'${sv.initialValue.replace(/'/g, "\\'")}'`;
  if (typeof sv.initialValue === 'number' || typeof sv.initialValue === 'boolean') return String(sv.initialValue);
  if (sv.type === 'array') return JSON.stringify(sv.initialValue ?? []);
  if (sv.type === 'object') return JSON.stringify(sv.initialValue ?? {});
  return "''";
}

export function tsTypeForState(sv: UIRStateSpec): string {
  switch (sv.type) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return 'Array<Record<string, unknown>>';
    case 'object':
      return 'Record<string, unknown>';
    default:
      return 'string';
  }
}

// ============================================================================
// 1. HTML5 + CSS3 + VANILLA JS (`html-vanilla`) & 4. HTMX 2.x (`htmx`)
// ============================================================================

function collectHtmxTargetMap(root: UIRNode): Map<string, UIRNode> {
  const map = new Map<string, UIRNode>();
  const walk = (n: UIRNode) => {
    for (const inter of n.interactions) {
      if (inter.type === 'HYPERMEDIA_HTMX') {
        if (inter.targetCanvasNodeId) {
          const targetNode = findUIRNodeByCanvasId(root, inter.targetCanvasNodeId);
          if (targetNode) map.set(inter.targetCanvasNodeId, targetNode);
        }
        if (inter.indicatorCanvasNodeId) {
          const indNode = findUIRNodeByCanvasId(root, inter.indicatorCanvasNodeId);
          if (indNode) map.set(inter.indicatorCanvasNodeId, indNode);
        }
        for (const oobId of inter.oobSwapNodes ?? []) {
          const oobNode = findUIRNodeByCanvasId(root, oobId);
          if (oobNode) map.set(oobId, oobNode);
        }
      }
    }
    for (const c of n.children) walk(c);
  };
  walk(root);
  return map;
}

function renderHtmlSubtree(
  w: SourceMapWriter,
  node: UIRNode,
  ir: UIRModule,
  opts: {
    dialect: StylingDialect;
    includeHtmx: boolean;
    htmxTargets: Map<string, UIRNode>;
    classMap: ReadonlyMap<string, string>;
    domIdMap: ReadonlyMap<string, string>;
    isRoot?: boolean;
  },
): void {
  w.withNode(node.canvasNodeId, () => {
    const clsAttr =
      opts.dialect === 'tailwind'
        ? buildTailwindClasses(node, ir.tokens, Boolean(opts.isRoot))
        : getNodeCssClassName(node, false, opts.classMap);

    const attrs: string[] = [];
    const hasLinkedWebScripts = Boolean(ir.scriptModules && ir.scriptModules.some((m) => m.language !== 'python'));
    const needsDomId =
      opts.htmxTargets.has(node.canvasNodeId) ||
      node.interactions.length > 0 ||
      hasLinkedWebScripts ||
      node.kind === 'Button' ||
      node.kind === 'IconButton' ||
      node.kind === 'TextInput' ||
      node.kind === 'TextArea' ||
      node.kind === 'Select' ||
      node.kind === 'Checkbox' ||
      node.kind === 'Switch' ||
      node.kind === 'Table' ||
      node.kind === 'Form' ||
      node.kind === 'Modal';
    if (needsDomId) {
      attrs.push(`id="${getDomId(node, opts.domIdMap)}"`);
    }
    if (clsAttr) {
      attrs.push(`class="${clsAttr}"`);
    }
    if (node.a11y?.role) attrs.push(`role="${escapeHtml(node.a11y.role)}"`);
    if (node.a11y?.ariaLabel) attrs.push(`aria-label="${escapeHtml(node.a11y.ariaLabel)}"`);
    if (node.dragRegion === 'drag') attrs.push(`data-window-drag="true"`);

    if (opts.includeHtmx) {
      for (const inter of node.interactions) {
        if (inter.type === 'HYPERMEDIA_HTMX') {
          const hxAttr = `hx-${inter.method.toLowerCase()}`;
          attrs.push(`${hxAttr}="${escapeHtml(inter.endpoint)}"`);
          if (inter.targetCanvasNodeId) {
            const targetNode = opts.htmxTargets.get(inter.targetCanvasNodeId);
            const selector = targetNode ? `#${getDomId(targetNode, opts.domIdMap)}` : inter.targetSelectorFallback ?? '#content';
            attrs.push(`hx-target="${escapeHtml(selector)}"`);
          } else if (inter.targetSelectorFallback) {
            attrs.push(`hx-target="${escapeHtml(inter.targetSelectorFallback)}"`);
          }
          attrs.push(`hx-swap="${inter.swap}"`);
          if (inter.triggerSpec) attrs.push(`hx-trigger="${escapeHtml(inter.triggerSpec)}"`);
          if (inter.indicatorCanvasNodeId) {
            const ind = opts.htmxTargets.get(inter.indicatorCanvasNodeId);
            if (ind) attrs.push(`hx-indicator="#${getDomId(ind, opts.domIdMap)}"`);
          }
          if (inter.confirmPrompt) attrs.push(`hx-confirm="${escapeHtml(inter.confirmPrompt)}"`);
          if (inter.pushUrl) {
            attrs.push(`hx-push-url="${typeof inter.pushUrl === 'string' ? escapeHtml(inter.pushUrl) : 'true'}"`);
          }
        }
      }
    } else {
      for (const inter of node.interactions) {
        if (inter.type === 'STATE_MUTATION') {
          attrs.push(`data-state-action="${escapeHtml(inter.targetState)}"`);
        } else if (inter.type === 'NATIVE_IPC_CALL') {
          attrs.push(`data-ipc-command="${escapeHtml(inter.commandName)}"`);
        } else if (inter.type === 'SCRIPT_CALL') {
          attrs.push(`data-script-fn="${escapeHtml(inter.fnName)}"`);
          attrs.push(`data-script-trigger="${escapeHtml(inter.trigger)}"`);
        } else if (inter.type === 'BLUEPRINT_EVENT') {
          attrs.push(`data-blueprint-id="${escapeHtml(inter.blueprintId)}"`);
          attrs.push(`data-blueprint-event="${escapeHtml(inter.eventName)}"`);
        }
      }
    }

    // Also annotate script/blueprint attributes in HTMX mode if attached
    if (opts.includeHtmx) {
      for (const inter of node.interactions) {
        if (inter.type === 'SCRIPT_CALL') {
          attrs.push(`data-script-fn="${escapeHtml(inter.fnName)}"`);
        } else if (inter.type === 'BLUEPRINT_EVENT') {
          attrs.push(`data-blueprint-id="${escapeHtml(inter.blueprintId)}"`);
          attrs.push(`data-blueprint-event="${escapeHtml(inter.eventName)}"`);
        }
      }
    }

    const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

    if (node.kind === 'ThreeViewport' || node.content?.controlType === 'three-viewport') {
      const sceneId = escapeHtml(node.content?.threeSceneId || 'default-3d-scene');
      const label = escapeHtml(node.a11y?.ariaLabel || getLiteralText(node, node.name || 'Three.js 3D Viewport'));
      w.line(`<div${attrStr} data-three-viewport="${sceneId}">`);
      w.indent();
      w.line(`<canvas data-three-scene="${sceneId}" aria-label="${label}" style="width: 100%; height: 100%; display: block;"></canvas>`);
      w.dedent();
      w.line('</div>');
      return;
    }

    if (node.kind === 'TextInput') {
      const placeholder = node.content?.placeholder ? ` placeholder="${escapeHtml(node.content.placeholder)}"` : '';
      const val = node.content?.value ? ` value="${escapeHtml(node.content.value)}"` : '';
      const nameAttr = ` name="${toSnakeCase(node.name, 'query')}"`;
      w.line(`<input type="text"${nameAttr}${attrStr}${placeholder}${val} />`);
      return;
    }

    if (node.kind === 'Checkbox' || node.kind === 'Switch') {
      const checked = node.content?.checked ? ' checked' : '';
      w.line(`<input type="checkbox"${attrStr}${checked} />`);
      return;
    }

    if (node.kind === 'Divider') {
      w.line(`<hr${attrStr} />`);
      return;
    }

    if (node.kind === 'Image') {
      const src = escapeHtml(node.content?.imageUrl || 'https://placehold.co/600x360');
      const alt = escapeHtml(node.a11y?.ariaLabel || node.name);
      w.line(`<img src="${src}" alt="${alt}"${attrStr} />`);
      return;
    }

    const tag = node.semanticTag === 'window' ? 'main' : node.semanticTag || 'div';
    const extraBtnType = tag === 'button' ? ' type="button"' : '';
    const text = getLiteralText(node, '');
    const iconSvg = lookupOfflineIconSvg(node.content?.iconName, 16);

    if (node.children.length === 0) {
      if (iconSvg && text) {
        w.line(`<${tag}${extraBtnType}${attrStr}>`);
        w.indent();
        w.line(iconSvg);
        w.line(`<span>${escapeHtml(text)}</span>`);
        w.dedent();
        w.line(`</${tag}>`);
      } else if (iconSvg) {
        w.line(`<${tag}${extraBtnType}${attrStr}>${iconSvg}</${tag}>`);
      } else {
        w.line(`<${tag}${extraBtnType}${attrStr}>${escapeHtml(text)}</${tag}>`);
      }
      return;
    }

    w.line(`<${tag}${extraBtnType}${attrStr}>`);
    w.indent();
    if (text) {
      w.line(`<span>${escapeHtml(text)}</span>`);
    }
    for (const child of node.children) {
      renderHtmlSubtree(w, child, ir, { ...opts, isRoot: false });
    }
    w.dedent();
    w.line(`</${tag}>`);
  });
}

export const htmlVanillaPlugin: CodegenTargetPlugin = {
  descriptor: getDescriptor('html-vanilla'),
  emitSnippet(node, ir, opts) {
    const dialect = opts.dialect ?? 'vanilla-css';
    const classMap = buildCssClassMap(node);
    const domIdMap = buildUniqueNameMap(node, 'kebab', 'el');
    const w = new SourceMapWriter(2);
    renderHtmlSubtree(w, node, ir, {
      dialect,
      includeHtmx: false,
      htmxTargets: new Map(),
      classMap,
      domIdMap,
      isRoot: false,
    });
    return w.toEmittedFile('snippet.html', 'html', true);
  },
  emitComponent(comp, ir, opts) {
    const dialect: StylingDialect = opts.dialect === 'tailwind' ? 'tailwind' : 'vanilla-css';
    const mode = opts.mode ?? 'bundle';
    const classMap = buildCssClassMap(comp.root);
    const domIdMap = buildUniqueNameMap(comp.root, 'kebab', 'el');
    const cssBuilt = buildStylesheetWithSourceMap(comp.root, ir.tokens, {
      includeTokensRoot: true,
      classMap,
      customCss: ir.customCss,
    });
    const cssCode = cssBuilt.code;
    const specialUsage = collectWebSpecialUsage(comp.root);

    const htmlWriter = new SourceMapWriter(2);
    htmlWriter.line('<!DOCTYPE html>');
    htmlWriter.line('<html lang="en">');
    htmlWriter.line('<head>');
    htmlWriter.indent();
    htmlWriter.line('<meta charset="UTF-8" />');
    htmlWriter.line('<meta name="viewport" content="width=device-width, initial-scale=1.0" />');
    htmlWriter.line(`<title>${escapeHtml(comp.name)}</title>`);
    if (dialect === 'tailwind') {
      htmlWriter.line('<script src="https://cdn.tailwindcss.com"></script>');
    } else {
      htmlWriter.line('<link rel="stylesheet" href="./styles.css" />');
      htmlWriter.line('<style>');
      htmlWriter.rawBlock(cssCode.trimEnd());
      htmlWriter.line('</style>');
    }
    htmlWriter.dedent();
    htmlWriter.line('</head>');
    htmlWriter.line('<body>');
    htmlWriter.indent();
    renderHtmlSubtree(htmlWriter, comp.root, ir, {
      dialect,
      includeHtmx: false,
      htmxTargets: new Map(),
      classMap,
      domIdMap,
      isRoot: true,
    });
    const linkedWebModules = getWebScriptModulesForHtml(ir);
    if (mode !== 'component') {
      for (const sm of linkedWebModules) {
        htmlWriter.line(`<script type="module" src="./${escapeHtml(sm.relativePath)}"></script>`);
      }
      htmlWriter.line('<script type="module" src="./app.js"></script>');
    }
    htmlWriter.dedent();
    htmlWriter.line('</body>');
    htmlWriter.line('</html>');

    const files: EmittedCodeFile[] = [htmlWriter.toEmittedFile('index.html', 'html', true)];

    if (dialect === 'vanilla-css' && mode !== 'snippet') {
      files.push({
        relativePath: 'styles.css',
        language: 'css',
        code: cssCode,
        sourceMap: cssBuilt.sourceMap,
        diagnostics: [],
      });
    }

    if (mode === 'bundle' || mode === 'scaffold') {
      const jsWriter = new SourceMapWriter(2);
      jsWriter.line('// ES2024 Reactive UI Controller');
      linkedWebModules.forEach((sm, idx) => {
        const relImp = computeRelativeModuleImport('app.js', sm.relativePath, true);
        jsWriter.line(`import * as __scriptMod_${idx} from '${relImp}';`);
      });
      if (linkedWebModules.length > 0) {
        jsWriter.line(
          `const __linkedHandlers = Object.assign({}, ${linkedWebModules.map((_, idx) => `__scriptMod_${idx}`).join(', ')});`,
        );
        jsWriter.blank();
      }
      jsWriter.line('const state = {');
      jsWriter.indent();
      for (const sv of comp.stateVars) {
        jsWriter.line(`${toCamelCase(sv.name)}: ${defaultStateLiteralJs(sv)},`);
      }
      jsWriter.dedent();
      jsWriter.line('};');
      jsWriter.blank();
      jsWriter.line("document.querySelectorAll('[data-state-action]').forEach((el) => {");
      jsWriter.indent();
      jsWriter.line("el.addEventListener('click', () => {");
      jsWriter.indent();
      jsWriter.line('const key = el.getAttribute("data-state-action");');
      jsWriter.line('if (key && typeof state[key] === "number") state[key] += 1;');
      jsWriter.line("el.dispatchEvent(new CustomEvent('ui:state-change', { bubbles: true, detail: { ...state } }));");
      jsWriter.dedent();
      jsWriter.line('});');
      jsWriter.dedent();
      jsWriter.line('});');

      if (specialUsage.scriptFns.size > 0 || linkedWebModules.length > 0) {
        jsWriter.blank();
        jsWriter.line("document.querySelectorAll('[data-script-fn]').forEach((el) => {");
        jsWriter.indent();
        jsWriter.line("const fnName = el.getAttribute('data-script-fn');");
        jsWriter.line("const trig = el.getAttribute('data-script-trigger') || 'click';");
        jsWriter.line("if (trig === 'mount') {");
        jsWriter.indent();
        if (linkedWebModules.length > 0) {
          jsWriter.line("if (fnName && typeof __linkedHandlers[fnName] === 'function') __linkedHandlers[fnName]();");
        }
        jsWriter.line("if (fnName && window.__studioScriptHandlers?.[fnName]) window.__studioScriptHandlers[fnName]({ state });");
        jsWriter.line('return;');
        jsWriter.dedent();
        jsWriter.line('}');
        jsWriter.line('el.addEventListener(trig, (event) => {');
        jsWriter.indent();
        if (linkedWebModules.length > 0) {
          jsWriter.line("if (fnName && typeof __linkedHandlers[fnName] === 'function') {");
          jsWriter.indent();
          jsWriter.line('__linkedHandlers[fnName](event);');
          jsWriter.line('return;');
          jsWriter.dedent();
          jsWriter.line('}');
        }
        jsWriter.line('if (fnName && window.__studioScriptHandlers?.[fnName]) {');
        jsWriter.indent();
        jsWriter.line('window.__studioScriptHandlers[fnName]({ state }, event);');
        jsWriter.dedent();
        jsWriter.line('}');
        jsWriter.dedent();
        jsWriter.line('});');
        jsWriter.dedent();
        jsWriter.line('});');
      }

      if (specialUsage.hasBlueprintEvents) {
        jsWriter.blank();
        jsWriter.line("document.querySelectorAll('[data-blueprint-event]').forEach((el) => {");
        jsWriter.indent();
        jsWriter.line("el.addEventListener('click', () => {");
        jsWriter.indent();
        jsWriter.line("const blueprintId = el.getAttribute('data-blueprint-id') || 'default';");
        jsWriter.line("const eventName = el.getAttribute('data-blueprint-event') || 'event_ui_click';");
        jsWriter.line(
          "window.dispatchEvent(new CustomEvent('studio:blueprint-event', { detail: { blueprintId, eventName } }));",
        );
        jsWriter.dedent();
        jsWriter.line('});');
        jsWriter.dedent();
        jsWriter.line('});');
      }

      if (specialUsage.hasThreeViewports) {
        jsWriter.blank();
        jsWriter.line("document.querySelectorAll('canvas[data-three-scene]').forEach((canvasEl) => {");
        jsWriter.indent();
        jsWriter.line("const sceneId = canvasEl.getAttribute('data-three-scene') || 'default';");
        jsWriter.line(
          "window.dispatchEvent(new CustomEvent('studio:mount-three-scene', { detail: { sceneId, canvas: canvasEl } }));",
        );
        jsWriter.dedent();
        jsWriter.line('});');
      }

      files.push(jsWriter.toEmittedFile('app.js', 'javascript', false));
      for (const sm of linkedWebModules) {
        files.push({
          relativePath: sm.relativePath,
          language: 'javascript',
          code: sm.code.endsWith('\n') ? sm.code : `${sm.code}\n`,
          sourceMap: [],
          diagnostics: [],
        });
      }
    }

    return {
      targetId: 'html-vanilla',
      dialect,
      mode,
      entryFilePath: 'index.html',
      files,
      diagnostics: [],
      generatedAt: Date.now(),
    };
  },
};

export const htmxPlugin: CodegenTargetPlugin = {
  descriptor: getDescriptor('htmx'),
  emitSnippet(node, ir, opts) {
    const dialect: StylingDialect = opts.dialect === 'vanilla-css' ? 'vanilla-css' : 'tailwind';
    const fullRoot = ir.components[0]?.root ?? node;
    const classMap = buildCssClassMap(fullRoot);
    const domIdMap = buildUniqueNameMap(fullRoot, 'kebab', 'el');
    const w = new SourceMapWriter(2);
    const htmxTargets = collectHtmxTargetMap(fullRoot);
    renderHtmlSubtree(w, node, ir, {
      dialect,
      includeHtmx: true,
      htmxTargets,
      classMap,
      domIdMap,
      isRoot: false,
    });
    return w.toEmittedFile('htmx-snippet.html', 'html', true);
  },
  emitComponent(comp, ir, opts) {
    const dialect: StylingDialect = opts.dialect === 'vanilla-css' ? 'vanilla-css' : 'tailwind';
    const mode = opts.mode ?? 'bundle';
    const classMap = buildCssClassMap(comp.root);
    const domIdMap = buildUniqueNameMap(comp.root, 'kebab', 'el');
    const htmxTargets = collectHtmxTargetMap(comp.root);
    const cssCode = buildStylesheetForTree(comp.root, ir.tokens, { includeTokensRoot: true, classMap });
    const linkedWebModules = getWebScriptModulesForHtml(ir);

    const w = new SourceMapWriter(2);
    w.line('<!DOCTYPE html>');
    w.line('<html lang="en">');
    w.line('<head>');
    w.indent();
    w.line('<meta charset="UTF-8" />');
    w.line('<meta name="viewport" content="width=device-width, initial-scale=1.0" />');
    w.line(`<title>${escapeHtml(comp.name)} — HTMX Hypermedia</title>`);
    w.line('<script src="https://unpkg.com/htmx.org@2.0.4"></script>');
    if (dialect === 'tailwind') {
      w.line('<script src="https://cdn.tailwindcss.com"></script>');
    }
    w.line('<style>');
    w.rawBlock(cssCode.trimEnd());
    w.line('</style>');
    w.dedent();
    w.line('</head>');
    w.line('<body>');
    w.indent();
    renderHtmlSubtree(w, comp.root, ir, {
      dialect,
      includeHtmx: true,
      htmxTargets,
      classMap,
      domIdMap,
      isRoot: true,
    });
    if (mode !== 'component') {
      for (const sm of linkedWebModules) {
        w.line(`<script type="module" src="./${escapeHtml(sm.relativePath)}"></script>`);
      }
    }
    w.dedent();
    w.line('</body>');
    w.line('</html>');

    const files: EmittedCodeFile[] = [w.toEmittedFile('index.html', 'html', true)];

    if (mode === 'bundle' || mode === 'scaffold') {
      for (const sm of linkedWebModules) {
        files.push({
          relativePath: sm.relativePath,
          language: 'javascript',
          code: sm.code.endsWith('\n') ? sm.code : `${sm.code}\n`,
          sourceMap: [],
          diagnostics: [],
        });
      }
    }

    // Emit extracted server swap partials for every target node referenced by hx-target!
    const emittedPartials = new Set<string>();
    for (const [, targetNode] of htmxTargets) {
      const slug = toSnakeCase(targetNode.name, 'region');
      if (emittedPartials.has(slug)) continue;
      emittedPartials.add(slug);

      const pw = new SourceMapWriter(2);
      pw.line(`<!-- Server-rendered HTMX Swap Partial for #${getDomId(targetNode, domIdMap)} -->`);
      if (targetNode.children.length > 0) {
        for (const child of targetNode.children) {
          renderHtmlSubtree(pw, child, ir, {
            dialect,
            includeHtmx: true,
            htmxTargets,
            classMap,
            domIdMap,
            isRoot: false,
          });
        }
      } else {
        renderHtmlSubtree(pw, targetNode, ir, {
          dialect,
          includeHtmx: true,
          htmxTargets,
          classMap,
          domIdMap,
          isRoot: false,
        });
      }
      files.push(pw.toEmittedFile(`partials/_${slug}.html`, 'html', false));
    }

    return {
      targetId: 'htmx',
      dialect,
      mode,
      entryFilePath: 'index.html',
      files,
      diagnostics: [],
      generatedAt: Date.now(),
    };
  },
};

// ============================================================================
// 2. REACT 19 (`react-tsx`) & 3. NEXT.JS 15 APP ROUTER (`nextjs-app`)
// ============================================================================

function jsxClassAttr(
  node: UIRNode,
  ir: UIRModule,
  dialect: StylingDialect,
  isRoot: boolean,
  classMap?: ReadonlyMap<string, string>,
): string {
  if (dialect === 'css-modules') {
    return `className={styles.${getNodeCssClassName(node, true, classMap)}}`;
  }
  if (dialect === 'vanilla-css') {
    return `className="${getNodeCssClassName(node, false, classMap)}"`;
  }
  const tw = buildTailwindClasses(node, ir.tokens, isRoot);
  return tw ? `className="${tw}"` : '';
}

function reactAttrForTrigger(trigger: string): string {
  switch (trigger) {
    case 'dblclick':
      return 'onDoubleClick';
    case 'change':
      return 'onChange';
    case 'input':
      return 'onInput';
    case 'submit':
      return 'onSubmit';
    case 'hover':
      return 'onMouseEnter';
    case 'mouseleave':
      return 'onMouseLeave';
    case 'focus':
      return 'onFocus';
    case 'blur':
      return 'onBlur';
    case 'keydown':
      return 'onKeyDown';
    case 'click':
    default:
      return 'onClick';
  }
}

function buildReactEventProps(node: UIRNode, controlledState?: string): string[] {
  const byProp = new Map<string, Array<{ bareRef?: string; stmt: string; needsEventArg?: boolean }>>();

  const pushStmt = (prop: string, entry: { bareRef?: string; stmt: string; needsEventArg?: boolean }) => {
    const arr = byProp.get(prop) ?? [];
    arr.push(entry);
    byProp.set(prop, arr);
  };

  if (controlledState) {
    pushStmt('onChange', {
      stmt: `set${toPascalCase(controlledState)}(e.target.value)`,
      needsEventArg: true,
    });
  }

  for (const inter of node.interactions) {
    if (inter.type === 'HYPERMEDIA_HTMX' || inter.trigger === 'mount') continue;
    const prop = reactAttrForTrigger(inter.trigger);
    if (inter.type === 'STATE_MUTATION') {
      const setter = `set${toPascalCase(inter.targetState)}`;
      if (inter.expr.includes('+ 1')) {
        pushStmt(prop, { stmt: `${setter}((prev) => prev + 1)` });
      } else {
        pushStmt(prop, { stmt: `${setter}(${inter.expr})` });
      }
    } else if (inter.type === 'NATIVE_IPC_CALL') {
      const fnName = `handle${toPascalCase(inter.commandName)}`;
      pushStmt(prop, { bareRef: fnName, stmt: `${fnName}()` });
    } else if (inter.type === 'SCRIPT_CALL') {
      const fnIdent = sanitizeHandlerIdent(inter.fnName);
      const argsStr = (inter.args ?? []).join(', ');
      pushStmt(prop, {
        bareRef: argsStr.length === 0 ? fnIdent : undefined,
        stmt: `${fnIdent}(${argsStr})`,
      });
    } else if (inter.type === 'BLUEPRINT_EVENT') {
      pushStmt(prop, {
        stmt: `triggerBlueprint('${escapeSingleQuotedSafe(inter.blueprintId)}', '${escapeSingleQuotedSafe(inter.eventName)}')`,
      });
    }
  }

  const props: string[] = [];
  for (const [prop, items] of byProp.entries()) {
    const anyNeedsEv = items.some((it) => it.needsEventArg);
    const param = anyNeedsEv ? '(e)' : '()';
    if (items.length === 1 && !anyNeedsEv && items[0].bareRef) {
      props.push(`${prop}={${items[0].bareRef}}`);
    } else if (items.length === 1) {
      props.push(`${prop}={${param} => ${items[0].stmt}}`);
    } else {
      props.push(`${prop}={${param} => { ${items.map((it) => `${it.stmt};`).join(' ')} }}`);
    }
  }
  return props;
}

export interface ReactSubtreeUsage {
  controlledInputStateByNode: Map<string, string>;
  usedIdentifiers: Set<string>;
  usedSetters: Set<string>;
  usedIpcCommands: Map<string, { resultStateTarget?: string }>;
  usedScriptFns: Set<string>;
  hasBlueprintEvents: boolean;
}

function extractIdentifiersFromExpr(expr: string, into: Set<string>): void {
  const matches = expr.match(/[A-Za-z_$][A-Za-z0-9_$]*/g);
  if (!matches) return;
  for (const ident of matches) {
    into.add(ident);
  }
}

export function analyzeReactSubtreeUsage(
  root: UIRNode,
  comp: Pick<UIRComponentDecl, 'props' | 'stateVars' | 'ipcCommands'>,
  options?: {
    extractedIslands?: ReadonlyMap<string, string>;
    enableControlledInputs?: boolean;
  },
): ReactSubtreeUsage {
  const controlledInputStateByNode = new Map<string, string>();
  const usedIdentifiers = new Set<string>();
  const usedSetters = new Set<string>();
  const usedIpcCommands = new Map<string, { resultStateTarget?: string }>();
  const usedScriptFns = new Set<string>();
  let hasBlueprintEvents = false;

  const stringStateNames = new Set(
    comp.stateVars.filter((sv) => sv.type === 'string').map((sv) => toCamelCase(sv.name)),
  );
  const allStateNames = new Set(comp.stateVars.map((sv) => toCamelCase(sv.name)));

  const walk = (n: UIRNode) => {
    if (options?.extractedIslands?.has(n.canvasNodeId)) {
      return;
    }

    if (options?.enableControlledInputs && (n.kind === 'TextInput' || n.kind === 'TextArea')) {
      const boundPath = n.mvvm?.bindings?.Text?.path ? toCamelCase(n.mvvm.bindings.Text.path) : null;
      let matchedState: string | null = null;
      if (boundPath && stringStateNames.has(boundPath)) {
        matchedState = boundPath;
      } else if (stringStateNames.has('searchQuery') && n.name.toLowerCase().includes('search')) {
        matchedState = 'searchQuery';
      }
      if (matchedState) {
        controlledInputStateByNode.set(n.canvasNodeId, matchedState);
        usedIdentifiers.add(matchedState);
        usedSetters.add(matchedState);
      }
    }

    if (isBoundValue(n.content?.text)) {
      extractIdentifiersFromExpr(n.content.text.$bind, usedIdentifiers);
    }
    if (n.controlFlow?.conditional) {
      extractIdentifiersFromExpr(n.controlFlow.conditional, usedIdentifiers);
    }
    if (n.controlFlow?.repeat) {
      extractIdentifiersFromExpr(n.controlFlow.repeat.collectionExpr, usedIdentifiers);
    }

    for (const inter of n.interactions) {
      if (inter.type === 'STATE_MUTATION' && inter.trigger !== 'mount') {
        const stName = toCamelCase(inter.targetState);
        usedSetters.add(stName);
        if (!inter.expr.includes('+ 1')) {
          extractIdentifiersFromExpr(inter.expr, usedIdentifiers);
        }
      } else if (inter.type === 'NATIVE_IPC_CALL' && inter.trigger !== 'mount') {
        const resState = inter.resultStateTarget ? toCamelCase(inter.resultStateTarget) : undefined;
        const validResState = resState && allStateNames.has(resState) ? resState : undefined;
        usedIpcCommands.set(inter.commandName, { resultStateTarget: validResState });
        if (validResState) {
          usedSetters.add(validResState);
        }
      } else if (inter.type === 'SCRIPT_CALL' && inter.trigger !== 'mount') {
        usedScriptFns.add(sanitizeHandlerIdent(inter.fnName));
      } else if (inter.type === 'BLUEPRINT_EVENT' && inter.trigger !== 'mount') {
        hasBlueprintEvents = true;
      }
    }

    for (const child of n.children) {
      walk(child);
    }
  };

  walk(root);

  return {
    controlledInputStateByNode,
    usedIdentifiers,
    usedSetters,
    usedIpcCommands,
    usedScriptFns,
    hasBlueprintEvents,
  };
}

export function emitReactScriptImports(
  w: SourceMapWriter,
  usage: ReactSubtreeUsage,
  importPath = './scripts/handlers',
  moduleCtx?: {
    root: UIRNode;
    ir: UIRModule;
    fromFilePath: string;
    extractedIslands?: ReadonlyMap<string, string>;
  },
): void {
  if (moduleCtx) {
    const grouped = collectGroupedScriptImportsForSubtree(
      moduleCtx.root,
      moduleCtx.ir,
      moduleCtx.fromFilePath,
      importPath,
      { extractedIslands: moduleCtx.extractedIslands },
    );
    for (const grp of grouped) {
      if (grp.fnNames.length > 0) {
        w.line(`import { ${grp.fnNames.join(', ')} } from '${grp.importSpec}';`);
      }
    }
    return;
  }
  if (usage.usedScriptFns.size === 0) return;
  const fns = Array.from(usage.usedScriptFns).join(', ');
  w.line(`import { ${fns} } from '${importPath}';`);
}

export function emitReactBlueprintHelper(w: SourceMapWriter, usage: ReactSubtreeUsage, typed = true): void {
  if (!usage.hasBlueprintEvents) return;
  w.line(
    typed
      ? 'const triggerBlueprint = (blueprintId: string, eventName: string) => {'
      : 'const triggerBlueprint = (blueprintId, eventName) => {',
  );
  w.indent();
  w.line("window.dispatchEvent(new CustomEvent('studio:blueprint-event', { detail: { blueprintId, eventName } }));");
  w.dedent();
  w.line('};');
}

export function emitCleanReactStateHooks(
  w: SourceMapWriter,
  stateVars: UIRStateSpec[],
  usage: ReactSubtreeUsage,
  typed = true,
): number {
  let emittedCount = 0;
  for (const sv of stateVars) {
    const cName = toCamelCase(sv.name);
    const setter = `set${toPascalCase(sv.name)}`;
    const valUsed = usage.usedIdentifiers.has(cName);
    const setterUsed = usage.usedSetters.has(cName);
    if (!valUsed && !setterUsed) continue;

    const typeParam = typed ? `<${tsTypeForState(sv)}>` : '';
    const init = defaultStateLiteralJs(sv);
    if (valUsed && setterUsed) {
      w.line(`const [${cName}, ${setter}] = useState${typeParam}(${init});`);
    } else if (valUsed) {
      w.line(`const [${cName}] = useState${typeParam}(${init});`);
    } else {
      w.line(`const [, ${setter}] = useState${typeParam}(${init});`);
    }
    emittedCount++;
  }
  return emittedCount;
}

export function countUsedReactStateHooks(stateVars: UIRStateSpec[], usage: ReactSubtreeUsage): number {
  let count = 0;
  for (const sv of stateVars) {
    const cName = toCamelCase(sv.name);
    if (usage.usedIdentifiers.has(cName) || usage.usedSetters.has(cName)) {
      count++;
    }
  }
  return count;
}

export function renderJsxSubtree(
  w: SourceMapWriter,
  node: UIRNode,
  ir: UIRModule,
  opts: {
    dialect: StylingDialect;
    classMap?: ReadonlyMap<string, string>;
    isRoot?: boolean;
    extractedIslands?: Map<string, string>;
    tauriDragAttr?: boolean;
    electronDragStyle?: boolean;
    wailsDragStyle?: boolean;
    controlledInputStateByNode?: ReadonlyMap<string, string>;
  },
): void {
  const islandName = opts.extractedIslands?.get(node.canvasNodeId);
  if (islandName) {
    w.withNode(node.canvasNodeId, () => {
      w.line(`<${islandName} />`);
    });
    return;
  }

  const emitBody = () => {
    const cls = jsxClassAttr(node, ir, opts.dialect, Boolean(opts.isRoot), opts.classMap);
    const isInputNode = node.kind === 'TextInput' || node.kind === 'TextArea';
    const controlledState = isInputNode ? opts.controlledInputStateByNode?.get(node.canvasNodeId) : undefined;
    const controlledValueAttr = controlledState ? ` value={${controlledState}}` : '';

    const attrParts: string[] = [];
    if (cls) attrParts.push(cls);
    if (node.a11y?.role) attrParts.push(`role="${escapeDoubleQuoted(node.a11y.role)}"`);
    if (node.a11y?.ariaLabel) attrParts.push(`aria-label="${escapeDoubleQuoted(node.a11y.ariaLabel)}"`);
    if (opts.tauriDragAttr && node.dragRegion === 'drag') {
      attrParts.push('data-tauri-drag-region');
    }
    if (opts.electronDragStyle && node.dragRegion) {
      attrParts.push(`style={{ WebkitAppRegion: '${node.dragRegion}' } as React.CSSProperties}`);
    }
    if (opts.wailsDragStyle && node.dragRegion) {
      attrParts.push(`style={{ '--wails-draggable': '${node.dragRegion}' } as React.CSSProperties}`);
    }
    attrParts.push(...buildReactEventProps(node, controlledState));
    const attrStr = attrParts.length > 0 ? ' ' + attrParts.join(' ') : '';

    if (node.kind === 'ThreeViewport' || node.content?.controlType === 'three-viewport') {
      const sceneId = escapeDoubleQuoted(node.content?.threeSceneId || 'default-3d-scene');
      const label = escapeDoubleQuoted(node.a11y?.ariaLabel || getLiteralText(node, node.name || 'Three.js 3D Viewport'));
      w.line(`<div${attrStr} data-three-viewport="${sceneId}">`);
      w.indent();
      w.line(
        `<canvas data-three-scene="${sceneId}" aria-label="${label}" style={{ width: '100%', height: '100%', display: 'block' }} />`,
      );
      w.dedent();
      w.line('</div>');
      return;
    }

    // Shadcn primitive mapping when dialect === 'shadcn'
    if (opts.dialect === 'shadcn') {
      if (node.kind === 'Button' || node.kind === 'IconButton') {
        const label = getLiteralText(node, node.name);
        const ev = buildReactEventProps(node).join(' ');
        const isSecondary =
          node.name.toLowerCase().includes('secondary') ||
          node.name.toLowerCase().includes('view') ||
          node.name.toLowerCase().includes('export');
        const variantAttr = isSecondary ? ' variant="outline"' : '';
        w.line(`<Button type="button"${variantAttr}${ev ? ' ' + ev : ''}>${escapeHtml(label)}</Button>`);
        return;
      }
      if (node.kind === 'TextInput') {
        const ph = node.content?.placeholder ? ` placeholder="${escapeDoubleQuoted(node.content.placeholder)}"` : '';
        w.line(`<Input type="text"${ph}${controlledValueAttr}${attrStr} />`);
        return;
      }
    }

    if (node.kind === 'TextInput') {
      const ph = node.content?.placeholder ? ` placeholder="${escapeDoubleQuoted(node.content.placeholder)}"` : '';
      w.line(`<input type="text"${ph}${controlledValueAttr}${attrStr} />`);
      return;
    }

    if (node.kind === 'Checkbox' || node.kind === 'Switch') {
      w.line(`<input type="checkbox" defaultChecked={${Boolean(node.content?.checked)}}${attrStr} />`);
      return;
    }

    if (node.kind === 'Divider') {
      w.line(`<hr${attrStr} />`);
      return;
    }

    const tag = node.semanticTag === 'window' ? 'main' : node.semanticTag || 'div';
    const typeAttr = tag === 'button' ? ' type="button"' : '';
    const textRaw = node.content?.text;
    const textExpr = isBoundValue(textRaw)
      ? `{${textRaw.$bind}}`
      : textRaw
        ? escapeHtml(textRaw)
        : '';

    if (node.controlFlow?.repeat) {
      const rep = node.controlFlow.repeat;
      w.line(`<${tag}${attrStr}>`);
      w.indent();
      w.line(`{${rep.collectionExpr}.map((${rep.itemVar}, idx) => (`);
      w.indent();
      if (node.children.length > 0) {
        const firstChild = node.children[0];
        const itemCls = jsxClassAttr(firstChild, ir, opts.dialect, false, opts.classMap);
        w.line(`<li key={${rep.keyExpr} ?? idx}${itemCls ? ' ' + itemCls : ''}>{String(${rep.itemVar}.label ?? ${rep.itemVar})}</li>`);
      } else {
        w.line(`<li key={${rep.keyExpr} ?? idx}>{String(${rep.itemVar})}</li>`);
      }
      w.dedent();
      w.line('))}');
      w.dedent();
      w.line(`</${tag}>`);
      return;
    }

    if (node.children.length === 0) {
      w.line(`<${tag}${typeAttr}${attrStr}>${textExpr}</${tag}>`);
      return;
    }

    w.line(`<${tag}${typeAttr}${attrStr}>`);
    w.indent();
    if (textExpr) w.line(`<span>${textExpr}</span>`);
    for (const child of node.children) {
      renderJsxSubtree(w, child, ir, { ...opts, isRoot: false });
    }
    w.dedent();
    w.line(`</${tag}>`);
  };

  w.withNode(node.canvasNodeId, () => {
    if (node.controlFlow?.conditional) {
      w.line(`{Boolean(${node.controlFlow.conditional}) && (`);
      w.indent();
      emitBody();
      w.dedent();
      w.line(')}');
    } else {
      emitBody();
    }
  });
}

export function hasRepeatCollection(node: UIRNode): { expr: string; sampleTexts: string[] } | null {
  if (node.controlFlow?.repeat) {
    const samples = node.children.map((c) => getLiteralText(c, 'Sample Item')).filter(Boolean);
    return { expr: node.controlFlow.repeat.collectionExpr, sampleTexts: samples };
  }
  for (const c of node.children) {
    const found = hasRepeatCollection(c);
    if (found) return found;
  }
  return null;
}

export const reactTsxPlugin: CodegenTargetPlugin = {
  descriptor: getDescriptor('react-tsx'),
  emitSnippet(node, ir, opts) {
    const dialect: StylingDialect = opts.dialect ?? 'tailwind';
    const isJs = opts.scriptLanguage === 'javascript';
    const ext = isJs ? 'jsx' : 'tsx';
    const classMap = buildCssClassMap(node);
    const w = new SourceMapWriter(2);
    renderJsxSubtree(w, node, ir, { dialect, classMap, isRoot: false });
    return w.toEmittedFile(`${toPascalCase(node.name, 'Snippet')}.${ext}`, isJs ? 'javascript' : 'tsx', true);
  },
  emitComponent(comp, ir, opts) {
    const dialect: StylingDialect = opts.dialect ?? 'tailwind';
    const mode = opts.mode ?? 'bundle';
    const isJs = opts.scriptLanguage === 'javascript';
    const ext = isJs ? 'jsx' : 'tsx';
    const entryPath = `${comp.name}.${ext}`;
    const classMap = buildCssClassMap(comp.root);
    const usage = analyzeReactSubtreeUsage(comp.root, comp, { enableControlledInputs: true });
    const needsUseState = countUsedReactStateHooks(comp.stateVars, usage) > 0;
    const w = new SourceMapWriter(2);

    w.line(`import React${needsUseState ? ', { useState }' : ''} from 'react';`);
    if (dialect === 'css-modules') {
      w.line(`import styles from './${comp.name}.module.css';`);
    } else if (dialect === 'vanilla-css') {
      w.line(`import './${comp.name}.css';`);
    } else if (dialect === 'shadcn') {
      w.line(`import { Button } from '@/components/ui/button';`);
      w.line(`import { Input } from '@/components/ui/input';`);
    }
    emitReactScriptImports(w, usage, './scripts/handlers', {
      root: comp.root,
      ir,
      fromFilePath: entryPath,
    });
    w.blank();

    if (!isJs) {
      w.line(`export interface ${comp.name}Props {`);
      w.indent();
      for (const p of comp.props) {
        w.line(`${p.name}${p.required ? '' : '?'}: ${p.type || 'string'};`);
      }
      w.line('className?: string;');
      w.dedent();
      w.line('}');
      w.blank();
    }

    const referencedProps = comp.props.filter((p) => usage.usedIdentifiers.has(p.name));
    const propParam = isJs
      ? referencedProps.length > 0
        ? `{ ${referencedProps
            .map((p) => (p.defaultValue !== undefined ? `${p.name} = ${JSON.stringify(p.defaultValue)}` : p.name))
            .join(', ')} }`
        : ''
      : referencedProps.length > 0
        ? `{ ${referencedProps
            .map((p) => (p.defaultValue !== undefined ? `${p.name} = ${JSON.stringify(p.defaultValue)}` : p.name))
            .join(', ')} }: ${comp.name}Props`
        : `_props: ${comp.name}Props`;

    w.line(`export function ${comp.name}(${propParam}) {`);
    w.indent();

    emitCleanReactStateHooks(w, comp.stateVars, usage, !isJs);
    emitReactBlueprintHelper(w, usage, !isJs);

    const repInfo = hasRepeatCollection(comp.root);
    if (repInfo && !comp.stateVars.some((s) => toCamelCase(s.name) === repInfo.expr)) {
      const itemsJson = (repInfo.sampleTexts.length > 0 ? repInfo.sampleTexts : ['Item 1', 'Item 2']).map(
        (txt, i) => `{ id: '${i + 1}', label: '${txt.replace(/'/g, "\\'")}' }`,
      );
      w.line(`const ${repInfo.expr} = [${itemsJson.join(', ')}];`);
    }

    for (const ipc of comp.ipcCommands) {
      const ipcUse = usage.usedIpcCommands.get(ipc.name);
      if (!ipcUse) continue;
      const fnName = `handle${toPascalCase(ipc.name)}`;
      w.line(`const ${fnName} = async () => {`);
      w.indent();
      if (ipcUse.resultStateTarget) {
        w.line(`set${toPascalCase(ipcUse.resultStateTarget)}('Completed: ${ipc.name}');`);
      } else {
        w.line(`console.info('Invoke command: ${ipc.name}');`);
      }
      w.dedent();
      w.line('};');
    }

    w.blank();
    w.line('return (');
    w.indent();
    renderJsxSubtree(w, comp.root, ir, {
      dialect,
      classMap,
      isRoot: true,
      controlledInputStateByNode: usage.controlledInputStateByNode,
    });
    w.dedent();
    w.line(');');
    w.dedent();
    w.line('}');
    w.blank();
    w.line(`export default ${comp.name};`);

    const files: EmittedCodeFile[] = [w.toEmittedFile(entryPath, isJs ? 'javascript' : 'tsx', true)];

    if (dialect === 'css-modules' && mode !== 'snippet') {
      const cssModBuilt = buildStylesheetWithSourceMap(comp.root, ir.tokens, {
        cssModules: true,
        includeTokensRoot: true,
        classMap,
        customCss: ir.customCss,
      });
      files.push({
        relativePath: `${comp.name}.module.css`,
        language: 'css',
        code: cssModBuilt.code,
        sourceMap: cssModBuilt.sourceMap,
        diagnostics: [],
      });
    } else if (dialect === 'vanilla-css' && mode !== 'snippet') {
      const cssVanBuilt = buildStylesheetWithSourceMap(comp.root, ir.tokens, {
        cssModules: false,
        includeTokensRoot: true,
        classMap,
        customCss: ir.customCss,
      });
      files.push({
        relativePath: `${comp.name}.css`,
        language: 'css',
        code: cssVanBuilt.code,
        sourceMap: cssVanBuilt.sourceMap,
        diagnostics: [],
      });
    } else if (dialect === 'shadcn' && (mode === 'bundle' || mode === 'scaffold')) {
      files.push({
        relativePath: `components/ui/button.${ext}`,
        language: isJs ? 'javascript' : 'tsx',
        code: isJs
          ? `import React from 'react';\n\nexport function Button({ variant = 'default', className = '', ...props }) {\n  const base = variant === 'outline'\n    ? 'inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50'\n    : 'inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-500';\n  return <button className={\`\${base} \${className}\`.trim()} {...props} />;\n}\n`
          : `import React from 'react';\n\nexport interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {\n  variant?: 'default' | 'outline' | 'ghost';\n}\n\nexport function Button({ variant = 'default', className = '', ...props }: ButtonProps) {\n  const base = variant === 'outline'\n    ? 'inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50'\n    : 'inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-500';\n  return <button className={\`\${base} \${className}\`.trim()} {...props} />;\n}\n`,
        sourceMap: [],
        diagnostics: [],
      });
      files.push({
        relativePath: `components/ui/input.${ext}`,
        language: isJs ? 'javascript' : 'tsx',
        code: isJs
          ? `import React from 'react';\n\nexport function Input({ className = '', ...props }) {\n  return (\n    <input\n      className={\`flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/40 \${className}\`.trim()}\n      {...props}\n    />\n  );\n}\n`
          : `import React from 'react';\n\nexport function Input({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {\n  return (\n    <input\n      className={\`flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/40 \${className}\`.trim()}\n      {...props}\n    />\n  );\n}\n`,
        sourceMap: [],
        diagnostics: [],
      });
    }

    return {
      targetId: 'react-tsx',
      dialect,
      mode,
      entryFilePath: entryPath,
      files,
      diagnostics: [],
      generatedAt: Date.now(),
    };
  },
};

export const nextjsAppPlugin: CodegenTargetPlugin = {
  descriptor: getDescriptor('nextjs-app'),
  emitSnippet(node, ir, opts) {
    return reactTsxPlugin.emitSnippet(node, ir, opts);
  },
  emitComponent(comp, ir, opts) {
    const dialect: StylingDialect =
      opts.dialect === 'css-modules' ? 'css-modules' : opts.dialect === 'shadcn' ? 'shadcn' : 'tailwind';
    const mode = opts.mode ?? 'bundle';
    const isJs = opts.scriptLanguage === 'javascript';
    const ext = isJs ? 'jsx' : 'tsx';
    const entryPagePath = `app/page.${ext}`;
    const classMap = buildCssClassMap(comp.root);

    // Identify minimal interactive leaf nodes to extract into `'use client'` Islands!
    const extractedIslands = new Map<string, string>();
    const islandNodes: UIRNode[] = [];

    const findInteractiveLeaves = (n: UIRNode, isRoot: boolean) => {
      const hasDirectClientAction = n.interactions.some(
        (i) =>
          i.type === 'STATE_MUTATION' ||
          i.type === 'NATIVE_IPC_CALL' ||
          i.type === 'SCRIPT_CALL' ||
          i.type === 'BLUEPRINT_EVENT',
      );
      if (!isRoot && hasDirectClientAction && n.children.length === 0) {
        const islandName = `${toPascalCase(n.name, 'Action')}ClientIsland`;
        extractedIslands.set(n.canvasNodeId, islandName);
        islandNodes.push(n);
        return;
      }
      for (const c of n.children) {
        findInteractiveLeaves(c, false);
      }
    };
    findInteractiveLeaves(comp.root, true);

    const pageUsage = analyzeReactSubtreeUsage(comp.root, comp, { extractedIslands });
    const pageWriter = new SourceMapWriter(2);
    pageWriter.line('// Next.js 15 App Router — React Server Component (RSC)');
    for (const islandNode of islandNodes) {
      const islandName = extractedIslands.get(islandNode.canvasNodeId)!;
      pageWriter.line(`import { ${islandName} } from './components/${islandName}';`);
    }
    if (dialect === 'shadcn') {
      pageWriter.line(`import { Button } from '@/components/ui/button';`);
      pageWriter.line(`import { Input } from '@/components/ui/input';`);
    }
    emitReactScriptImports(pageWriter, pageUsage, '../scripts/handlers', {
      root: comp.root,
      ir,
      fromFilePath: entryPagePath,
      extractedIslands,
    });
    pageWriter.blank();

    const repInfo = hasRepeatCollection(comp.root);
    pageWriter.line(`export default async function ${comp.name}Page() {`);
    pageWriter.indent();
    emitReactBlueprintHelper(pageWriter, pageUsage, !isJs);
    if (repInfo) {
      const itemsJson = (repInfo.sampleTexts.length > 0 ? repInfo.sampleTexts : ['Item 1', 'Item 2']).map(
        (txt, i) => `{ id: '${i + 1}', label: '${txt.replace(/'/g, "\\'")}' }`,
      );
      pageWriter.line(`const ${repInfo.expr} = [${itemsJson.join(', ')}];`);
    }
    pageWriter.line('return (');
    pageWriter.indent();
    renderJsxSubtree(pageWriter, comp.root, ir, {
      dialect: dialect === 'css-modules' ? 'tailwind' : dialect,
      classMap,
      isRoot: true,
      extractedIslands,
    });
    pageWriter.dedent();
    pageWriter.line(');');
    pageWriter.dedent();
    pageWriter.line('}');

    const files: EmittedCodeFile[] = [
      pageWriter.toEmittedFile(entryPagePath, isJs ? 'javascript' : 'tsx', true),
    ];

    if (dialect === 'css-modules' && mode !== 'snippet') {
      const modBuilt = buildStylesheetWithSourceMap(comp.root, ir.tokens, {
        cssModules: true,
        includeTokensRoot: true,
        classMap,
        customCss: ir.customCss,
      });
      files.push({
        relativePath: `app/${comp.name}.module.css`,
        language: 'css',
        code: modBuilt.code,
        sourceMap: modBuilt.sourceMap,
        diagnostics: [],
      });
    }

    for (const islandNode of islandNodes) {
      const islandName = extractedIslands.get(islandNode.canvasNodeId)!;
      const islandFilePath = `app/components/${islandName}.${ext}`;
      const islandUsage = analyzeReactSubtreeUsage(islandNode, comp, { enableControlledInputs: true });
      const islandNeedsState = countUsedReactStateHooks(comp.stateVars, islandUsage) > 0;

      const iw = new SourceMapWriter(2);
      iw.line("'use client';");
      iw.blank();
      iw.line(`import React${islandNeedsState ? ', { useState }' : ''} from 'react';`);
      emitReactScriptImports(iw, islandUsage, '../../scripts/handlers', {
        root: islandNode,
        ir,
        fromFilePath: islandFilePath,
      });
      iw.blank();
      iw.line(`export function ${islandName}() {`);
      iw.indent();
      emitCleanReactStateHooks(iw, comp.stateVars, islandUsage, !isJs);
      emitReactBlueprintHelper(iw, islandUsage, !isJs);
      for (const ipc of comp.ipcCommands) {
        const ipcUse = islandUsage.usedIpcCommands.get(ipc.name);
        if (!ipcUse) continue;
        iw.line(`const handle${toPascalCase(ipc.name)} = async () => {`);
        iw.indent();
        if (ipcUse.resultStateTarget) {
          iw.line(`set${toPascalCase(ipcUse.resultStateTarget)}('Completed: ${ipc.name}');`);
        } else {
          iw.line(`console.info('Client action: ${ipc.name}');`);
        }
        iw.dedent();
        iw.line('};');
      }
      iw.line('return (');
      iw.indent();
      renderJsxSubtree(iw, islandNode, ir, {
        dialect: 'tailwind',
        classMap,
        isRoot: false,
        controlledInputStateByNode: islandUsage.controlledInputStateByNode,
      });
      iw.dedent();
      iw.line(');');
      iw.dedent();
      iw.line('}');
      files.push(iw.toEmittedFile(islandFilePath, isJs ? 'javascript' : 'tsx', false));
    }

    if (mode === 'bundle' || mode === 'scaffold') {
      files.push({
        relativePath: `app/layout.${ext}`,
        language: isJs ? 'javascript' : 'tsx',
        code: isJs
          ? `import React from 'react';\nimport './globals.css';\n\nexport const metadata = {\n  title: '${escapeSingleQuotedSafe(comp.name)}',\n};\n\nexport default function RootLayout({ children }) {\n  return (\n    <html lang="en">\n      <body className="antialiased">{children}</body>\n    </html>\n  );\n}\n`
          : `import React from 'react';\nimport './globals.css';\n\nexport const metadata = {\n  title: '${escapeSingleQuotedSafe(comp.name)}',\n};\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html lang="en">\n      <body className="antialiased">{children}</body>\n    </html>\n  );\n}\n`,
        sourceMap: [],
        diagnostics: [],
      });
    }

    return {
      targetId: 'nextjs-app',
      dialect,
      mode,
      entryFilePath: entryPagePath,
      files,
      diagnostics: [],
      generatedAt: Date.now(),
    };
  },
};

function escapeSingleQuotedSafe(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ============================================================================
// 5. SVELTE 5 RUNES (`svelte5`) & 11. VUE 3 `<script setup>` (`vue3`)
// ============================================================================

function buildSvelteEventAttrs(node: UIRNode): string[] {
  const byEvent = new Map<string, string[]>();
  const push = (ev: string, stmt: string) => {
    const arr = byEvent.get(ev) ?? [];
    arr.push(stmt);
    byEvent.set(ev, arr);
  };
  for (const inter of node.interactions) {
    if (inter.type === 'HYPERMEDIA_HTMX' || inter.trigger === 'mount') continue;
    const ev = inter.trigger === 'hover' ? 'onmouseenter' : `on${inter.trigger}`;
    if (inter.type === 'STATE_MUTATION') {
      const st = toCamelCase(inter.targetState);
      push(ev, `${st} = ${inter.expr.includes('+ 1') ? `${st} + 1` : inter.expr}`);
    } else if (inter.type === 'NATIVE_IPC_CALL') {
      push(ev, `handle${toPascalCase(inter.commandName)}()`);
    } else if (inter.type === 'SCRIPT_CALL') {
      const fn = sanitizeHandlerIdent(inter.fnName);
      push(ev, `${fn}(${(inter.args ?? []).join(', ')})`);
    } else if (inter.type === 'BLUEPRINT_EVENT') {
      push(
        ev,
        `triggerBlueprint('${escapeSingleQuotedSafe(inter.blueprintId)}', '${escapeSingleQuotedSafe(inter.eventName)}')`,
      );
    }
  }
  const out: string[] = [];
  for (const [ev, stmts] of byEvent.entries()) {
    if (stmts.length === 1) {
      out.push(`${ev}={() => (${stmts[0]})}`);
    } else {
      out.push(`${ev}={() => { ${stmts.map((s) => `${s};`).join(' ')} }}`);
    }
  }
  return out;
}

function renderSvelteSubtree(
  w: SourceMapWriter,
  node: UIRNode,
  ir: UIRModule,
  dialect: StylingDialect,
  classMap: ReadonlyMap<string, string>,
  isRoot: boolean,
): void {
  w.withNode(node.canvasNodeId, () => {
    const cls =
      dialect === 'tailwind'
        ? buildTailwindClasses(node, ir.tokens, isRoot)
        : getNodeCssClassName(node, false, classMap);

    const attrs: string[] = [];
    if (cls) attrs.push(`class="${cls}"`);
    if (node.a11y?.ariaLabel) attrs.push(`aria-label="${escapeHtml(node.a11y.ariaLabel)}"`);
    attrs.push(...buildSvelteEventAttrs(node));

    const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

    if (node.kind === 'ThreeViewport' || node.content?.controlType === 'three-viewport') {
      const sceneId = escapeHtml(node.content?.threeSceneId || 'default-3d-scene');
      const label = escapeHtml(node.a11y?.ariaLabel || getLiteralText(node, node.name || 'Three.js 3D Viewport'));
      w.line(`<div${attrStr} data-three-viewport="${sceneId}">`);
      w.indent();
      w.line(`<canvas data-three-scene="${sceneId}" aria-label="${label}" style="width: 100%; height: 100%; display: block;"></canvas>`);
      w.dedent();
      w.line('</div>');
      return;
    }

    if (node.kind === 'TextInput') {
      const ph = node.content?.placeholder ? ` placeholder="${escapeHtml(node.content.placeholder)}"` : '';
      w.line(`<input type="text"${ph}${attrStr} />`);
      return;
    }

    const tag = node.semanticTag === 'window' ? 'main' : node.semanticTag || 'div';
    const typeAttr = tag === 'button' ? ' type="button"' : '';
    const text = getLiteralText(node, '');

    if (node.controlFlow?.repeat) {
      const rep = node.controlFlow.repeat;
      w.line(`<${tag}${attrStr}>`);
      w.indent();
      w.line(`{#each ${rep.collectionExpr} as ${rep.itemVar} (${rep.keyExpr})}`);
      w.indent();
      w.line(`<li>{${rep.itemVar}.label ?? ${rep.itemVar}}</li>`);
      w.dedent();
      w.line('{/each}');
      w.dedent();
      w.line(`</${tag}>`);
      return;
    }

    if (node.children.length === 0) {
      w.line(`<${tag}${typeAttr}${attrStr}>${escapeHtml(text)}</${tag}>`);
      return;
    }

    w.line(`<${tag}${typeAttr}${attrStr}>`);
    w.indent();
    if (text) w.line(`<span>${escapeHtml(text)}</span>`);
    for (const c of node.children) {
      renderSvelteSubtree(w, c, ir, dialect, classMap, false);
    }
    w.dedent();
    w.line(`</${tag}>`);
  });
}

export const svelte5Plugin: CodegenTargetPlugin = {
  descriptor: getDescriptor('svelte5'),
  emitSnippet(node, ir, opts) {
    const dialect: StylingDialect = opts.dialect === 'tailwind' ? 'tailwind' : 'vanilla-css';
    const classMap = buildCssClassMap(node);
    const w = new SourceMapWriter(2);
    renderSvelteSubtree(w, node, ir, dialect, classMap, false);
    return w.toEmittedFile(`${toPascalCase(node.name)}.svelte`, 'svelte', true);
  },
  emitComponent(comp, ir, opts) {
    const dialect: StylingDialect = opts.dialect === 'tailwind' ? 'tailwind' : 'vanilla-css';
    const mode = opts.mode ?? 'component';
    const isJs = opts.scriptLanguage === 'javascript';
    const filePath = `${comp.name}.svelte`;
    const classMap = buildCssClassMap(comp.root);
    const specialUsage = collectWebSpecialUsage(comp.root);
    const groupedImports = collectGroupedScriptImportsForSubtree(
      comp.root,
      ir,
      filePath,
      './scripts/handlers',
    );
    const w = new SourceMapWriter(2);

    w.line(isJs ? '<script>' : '<script lang="ts">');
    w.indent();
    for (const grp of groupedImports) {
      if (grp.fnNames.length > 0) {
        w.line(`import { ${grp.fnNames.join(', ')} } from '${grp.importSpec}';`);
      }
    }
    if (comp.props.length > 0) {
      if (!isJs) {
        w.line('interface Props {');
        w.indent();
        for (const p of comp.props) {
          w.line(`${p.name}${p.required ? '' : '?'}: ${p.type || 'string'};`);
        }
        w.dedent();
        w.line('}');
      }
      const propBindings = comp.props
        .map((p) => (p.defaultValue !== undefined ? `${p.name} = ${JSON.stringify(p.defaultValue)}` : p.name))
        .join(', ');
      w.line(isJs ? `let { ${propBindings} } = $props();` : `let { ${propBindings} }: Props = $props();`);
    }

    for (const sv of comp.stateVars) {
      w.line(`let ${toCamelCase(sv.name)} = $state(${defaultStateLiteralJs(sv)});`);
    }

    const repInfo = hasRepeatCollection(comp.root);
    if (repInfo) {
      const itemsJson = (repInfo.sampleTexts.length > 0 ? repInfo.sampleTexts : ['Item 1', 'Item 2']).map(
        (txt, i) => `{ id: '${i + 1}', label: '${txt.replace(/'/g, "\\'")}' }`,
      );
      w.line(`let ${repInfo.expr} = $state([${itemsJson.join(', ')}]);`);
    }

    for (const ipc of comp.ipcCommands) {
      w.line(`function handle${toPascalCase(ipc.name)}() {`);
      w.indent();
      w.line(`console.info('Dispatch ${ipc.name}');`);
      w.dedent();
      w.line('}');
    }
    if (specialUsage.hasBlueprintEvents) {
      w.line(
        isJs
          ? 'function triggerBlueprint(blueprintId, eventName) {'
          : 'function triggerBlueprint(blueprintId: string, eventName: string) {',
      );
      w.indent();
      w.line("window.dispatchEvent(new CustomEvent('studio:blueprint-event', { detail: { blueprintId, eventName } }));");
      w.dedent();
      w.line('}');
    }
    w.dedent();
    w.line('</script>');
    w.blank();

    renderSvelteSubtree(w, comp.root, ir, dialect, classMap, true);

    if (dialect === 'vanilla-css') {
      w.blank();
      w.line('<style>');
      w.rawBlock(
        buildStylesheetForTree(comp.root, ir.tokens, { includeTokensRoot: true, classMap, customCss: ir.customCss }).trimEnd(),
      );
      w.line('</style>');
    }

    return {
      targetId: 'svelte5',
      dialect,
      mode,
      entryFilePath: filePath,
      files: [w.toEmittedFile(filePath, 'svelte', true)],
      diagnostics: [],
      generatedAt: Date.now(),
    };
  },
};

function buildVueEventAttrs(node: UIRNode): string[] {
  const byEvent = new Map<string, string[]>();
  const push = (ev: string, stmt: string) => {
    const arr = byEvent.get(ev) ?? [];
    arr.push(stmt);
    byEvent.set(ev, arr);
  };
  for (const inter of node.interactions) {
    if (inter.type === 'HYPERMEDIA_HTMX' || inter.trigger === 'mount') continue;
    const ev = inter.trigger === 'hover' ? '@mouseenter' : `@${inter.trigger}`;
    if (inter.type === 'STATE_MUTATION') {
      const st = toCamelCase(inter.targetState);
      push(ev, inter.expr.includes('+ 1') ? `${st}++` : `${st} = ${inter.expr}`);
    } else if (inter.type === 'NATIVE_IPC_CALL') {
      push(ev, `handle${toPascalCase(inter.commandName)}()`);
    } else if (inter.type === 'SCRIPT_CALL') {
      const fn = sanitizeHandlerIdent(inter.fnName);
      push(ev, `${fn}(${(inter.args ?? []).join(', ')})`);
    } else if (inter.type === 'BLUEPRINT_EVENT') {
      push(
        ev,
        `triggerBlueprint('${escapeSingleQuotedSafe(inter.blueprintId)}', '${escapeSingleQuotedSafe(inter.eventName)}')`,
      );
    }
  }
  const out: string[] = [];
  for (const [ev, stmts] of byEvent.entries()) {
    out.push(`${ev}="${escapeHtml(stmts.join('; '))}"`);
  }
  return out;
}

function renderVueSubtree(
  w: SourceMapWriter,
  node: UIRNode,
  ir: UIRModule,
  dialect: StylingDialect,
  classMap: ReadonlyMap<string, string>,
  isRoot: boolean,
): void {
  w.withNode(node.canvasNodeId, () => {
    const cls =
      dialect === 'tailwind'
        ? buildTailwindClasses(node, ir.tokens, isRoot)
        : getNodeCssClassName(node, false, classMap);

    const attrs: string[] = [];
    if (cls) attrs.push(`class="${cls}"`);
    if (node.controlFlow?.conditional) attrs.push(`v-if="${escapeHtml(node.controlFlow.conditional)}"`);
    attrs.push(...buildVueEventAttrs(node));

    const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

    if (node.kind === 'ThreeViewport' || node.content?.controlType === 'three-viewport') {
      const sceneId = escapeHtml(node.content?.threeSceneId || 'default-3d-scene');
      const label = escapeHtml(node.a11y?.ariaLabel || getLiteralText(node, node.name || 'Three.js 3D Viewport'));
      w.line(`<div${attrStr} data-three-viewport="${sceneId}">`);
      w.indent();
      w.line(`<canvas data-three-scene="${sceneId}" aria-label="${label}" style="width: 100%; height: 100%; display: block;"></canvas>`);
      w.dedent();
      w.line('</div>');
      return;
    }

    if (node.kind === 'TextInput') {
      const ph = node.content?.placeholder ? ` placeholder="${escapeHtml(node.content.placeholder)}"` : '';
      w.line(`<input type="text"${ph}${attrStr} />`);
      return;
    }

    const tag = node.semanticTag === 'window' ? 'main' : node.semanticTag || 'div';
    const typeAttr = tag === 'button' ? ' type="button"' : '';
    const text = getLiteralText(node, '');

    if (node.controlFlow?.repeat) {
      const rep = node.controlFlow.repeat;
      w.line(`<${tag}${attrStr}>`);
      w.indent();
      w.line(`<li v-for="${rep.itemVar} in ${rep.collectionExpr}" :key="${rep.keyExpr}">{{ ${rep.itemVar}.label }}</li>`);
      w.dedent();
      w.line(`</${tag}>`);
      return;
    }

    if (node.children.length === 0) {
      w.line(`<${tag}${typeAttr}${attrStr}>${escapeHtml(text)}</${tag}>`);
      return;
    }

    w.line(`<${tag}${typeAttr}${attrStr}>`);
    w.indent();
    if (text) w.line(`<span>${escapeHtml(text)}</span>`);
    for (const c of node.children) {
      renderVueSubtree(w, c, ir, dialect, classMap, false);
    }
    w.dedent();
    w.line(`</${tag}>`);
  });
}

export const vue3Plugin: CodegenTargetPlugin = {
  descriptor: getDescriptor('vue3'),
  emitSnippet(node, ir, opts) {
    const dialect: StylingDialect = opts.dialect === 'vanilla-css' ? 'vanilla-css' : 'tailwind';
    const classMap = buildCssClassMap(node);
    const w = new SourceMapWriter(2);
    renderVueSubtree(w, node, ir, dialect, classMap, false);
    return w.toEmittedFile(`${toPascalCase(node.name)}.vue`, 'vue', true);
  },
  emitComponent(comp, ir, opts) {
    const dialect: StylingDialect = opts.dialect === 'vanilla-css' ? 'vanilla-css' : 'tailwind';
    const mode = opts.mode ?? 'component';
    const isJs = opts.scriptLanguage === 'javascript';
    const filePath = `${comp.name}.vue`;
    const classMap = buildCssClassMap(comp.root);
    const specialUsage = collectWebSpecialUsage(comp.root);
    const groupedImports = collectGroupedScriptImportsForSubtree(
      comp.root,
      ir,
      filePath,
      './scripts/handlers',
    );
    const w = new SourceMapWriter(2);

    w.line(isJs ? '<script setup>' : '<script setup lang="ts">');
    w.indent();
    w.line("import { ref } from 'vue';");
    for (const grp of groupedImports) {
      if (grp.fnNames.length > 0) {
        w.line(`import { ${grp.fnNames.join(', ')} } from '${grp.importSpec}';`);
      }
    }
    if (comp.props.length > 0) {
      if (isJs) {
        w.line(`defineProps([${comp.props.map((p) => `'${p.name}'`).join(', ')}]);`);
      } else {
        w.line(`defineProps<{ ${comp.props.map((p) => `${p.name}?: ${p.type || 'string'}`).join('; ')} }>();`);
      }
    }
    for (const sv of comp.stateVars) {
      w.line(`const ${toCamelCase(sv.name)} = ref(${defaultStateLiteralJs(sv)});`);
    }
    const repInfo = hasRepeatCollection(comp.root);
    if (repInfo) {
      const itemsJson = (repInfo.sampleTexts.length > 0 ? repInfo.sampleTexts : ['Item 1', 'Item 2']).map(
        (txt, i) => `{ id: '${i + 1}', label: '${txt.replace(/'/g, "\\'")}' }`,
      );
      w.line(`const ${repInfo.expr} = ref([${itemsJson.join(', ')}]);`);
    }
    for (const ipc of comp.ipcCommands) {
      w.line(`function handle${toPascalCase(ipc.name)}() { console.info('${ipc.name}'); }`);
    }
    if (specialUsage.hasBlueprintEvents) {
      w.line(
        isJs
          ? 'function triggerBlueprint(blueprintId, eventName) {'
          : 'function triggerBlueprint(blueprintId: string, eventName: string) {',
      );
      w.indent();
      w.line("window.dispatchEvent(new CustomEvent('studio:blueprint-event', { detail: { blueprintId, eventName } }));");
      w.dedent();
      w.line('}');
    }
    w.dedent();
    w.line('</script>');
    w.blank();

    w.line('<template>');
    w.indent();
    renderVueSubtree(w, comp.root, ir, dialect, classMap, true);
    w.dedent();
    w.line('</template>');

    if (dialect === 'vanilla-css') {
      w.blank();
      w.line('<style scoped>');
      w.rawBlock(
        buildStylesheetForTree(comp.root, ir.tokens, { includeTokensRoot: true, classMap, customCss: ir.customCss }).trimEnd(),
      );
      w.line('</style>');
    }

    return {
      targetId: 'vue3',
      dialect,
      mode,
      entryFilePath: filePath,
      files: [w.toEmittedFile(filePath, 'vue', true)],
      diagnostics: [],
      generatedAt: Date.now(),
    };
  },
};
