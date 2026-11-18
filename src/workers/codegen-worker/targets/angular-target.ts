import {
  BUILTIN_TARGET_DESCRIPTORS,
  type CodegenTargetPlugin,
  type EmittedCodeFile,
  type StylingDialect,
  type UIRNode,
  type UIRStateSpec,
} from '@shared/ui-ir';
import { SourceMapWriter } from '../code-writer';
import {
  buildCssClassMap,
  buildStylesheetWithSourceMap,
  buildTailwindClasses,
  escapeHtml,
  getLiteralText,
  getNodeCssClassName,
  toCamelCase,
  toKebabCase,
  toPascalCase,
} from '../style-helpers';
import { sanitizeHandlerIdent } from './web-targets';
import { collectGroupedScriptImportsForSubtree } from './script-module-helpers';

const angularDescriptor = BUILTIN_TARGET_DESCRIPTORS.find((d) => d.id === 'angular')!;

function renderAngularTemplate(
  w: SourceMapWriter,
  node: UIRNode,
  ir: Parameters<CodegenTargetPlugin['emitSnippet']>[1],
  dialect: StylingDialect,
  classMap: ReadonlyMap<string, string>,
  isRoot: boolean,
  scriptMethods: Set<string>,
  blueprintEvents: Map<string, { blueprintId: string; eventName: string }>,
): void {
  const emitElement = () => {
    const cls =
      dialect === 'tailwind'
        ? buildTailwindClasses(node, ir.tokens, isRoot)
        : getNodeCssClassName(node, false, classMap);

    const attrs: string[] = [];
    if (cls) attrs.push(`class="${cls}"`);
    if (node.a11y?.ariaLabel) attrs.push(`aria-label="${escapeHtml(node.a11y.ariaLabel)}"`);

    const byEvent = new Map<string, string[]>();
    const pushEv = (ev: string, call: string) => {
      const arr = byEvent.get(ev) ?? [];
      arr.push(call);
      byEvent.set(ev, arr);
    };

    for (const inter of node.interactions) {
      if (inter.type === 'HYPERMEDIA_HTMX' || inter.trigger === 'mount') continue;
      const ev = inter.trigger === 'hover' ? 'mouseenter' : inter.trigger;
      if (inter.type === 'STATE_MUTATION') {
        const fn = `increment${toPascalCase(inter.targetState)}`;
        pushEv(ev, `${fn}()`);
      } else if (inter.type === 'NATIVE_IPC_CALL') {
        pushEv(ev, `on${toPascalCase(inter.commandName)}()`);
      } else if (inter.type === 'SCRIPT_CALL') {
        const fn = sanitizeHandlerIdent(inter.fnName);
        scriptMethods.add(fn);
        pushEv(ev, `${fn}()`);
      } else if (inter.type === 'BLUEPRINT_EVENT') {
        const method = `triggerBlueprint${toPascalCase(inter.eventName)}`;
        blueprintEvents.set(method, { blueprintId: inter.blueprintId, eventName: inter.eventName });
        pushEv(ev, `${method}()`);
      }
    }

    for (const [ev, calls] of byEvent.entries()) {
      attrs.push(`(${ev})="${escapeHtml(calls.join('; '))}"`);
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
      w.line(`@for (${rep.itemVar} of ${rep.collectionExpr}(); track ${rep.keyExpr}) {`);
      w.indent();
      w.line(`<li>{{ ${rep.itemVar}.label }}</li>`);
      w.dedent();
      w.line('}');
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
      renderAngularTemplate(w, c, ir, dialect, classMap, false, scriptMethods, blueprintEvents);
    }
    w.dedent();
    w.line(`</${tag}>`);
  };

  w.withNode(node.canvasNodeId, () => {
    if (node.controlFlow?.conditional) {
      w.line(`@if (${node.controlFlow.conditional}) {`);
      w.indent();
      emitElement();
      w.dedent();
      w.line('}');
    } else {
      emitElement();
    }
  });
}

function defaultSignalVal(sv: UIRStateSpec): string {
  if (typeof sv.initialValue === 'string') return `'${sv.initialValue.replace(/'/g, "\\'")}'`;
  if (typeof sv.initialValue === 'number' || typeof sv.initialValue === 'boolean') return String(sv.initialValue);
  return "''";
}

function collectRepeatLists(node: UIRNode): Array<{ name: string; samples: string[] }> {
  const out: Array<{ name: string; samples: string[] }> = [];
  if (node.controlFlow?.repeat) {
    out.push({
      name: node.controlFlow.repeat.collectionExpr,
      samples: node.children.map((c) => getLiteralText(c, 'Item')).filter(Boolean),
    });
  }
  for (const c of node.children) {
    out.push(...collectRepeatLists(c));
  }
  return out;
}

export const angularPlugin: CodegenTargetPlugin = {
  descriptor: angularDescriptor,
  emitSnippet(node, ir, opts) {
    const dialect: StylingDialect = opts.dialect === 'tailwind' ? 'tailwind' : 'vanilla-css';
    const classMap = buildCssClassMap(node);
    const w = new SourceMapWriter(2);
    renderAngularTemplate(w, node, ir, dialect, classMap, false, new Set(), new Map());
    return w.toEmittedFile(`${toKebabCase(node.name)}.component.html`, 'html', true);
  },
  emitComponent(comp, ir, opts) {
    const dialect: StylingDialect = opts.dialect === 'tailwind' ? 'tailwind' : 'vanilla-css';
    const mode = opts.mode ?? 'bundle';
    const kebab = toKebabCase(comp.name, 'app-screen');
    const classMap = buildCssClassMap(comp.root);
    const scriptMethods = new Set<string>();
    const blueprintEvents = new Map<string, { blueprintId: string; eventName: string }>();

    if (mode === 'component') {
      const singlePath = `${kebab}.component.ts`;
      const groupedImports = collectGroupedScriptImportsForSubtree(
        comp.root,
        ir,
        singlePath,
        './scripts/handlers',
      );
      const importedFns = new Set(groupedImports.flatMap((g) => g.fnNames));

      // Single-file Angular 19 Standalone Component with inline template & SourceMap
      const singleWriter = new SourceMapWriter(2);
      singleWriter.line("import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';");
      for (const grp of groupedImports) {
        if (grp.fnNames.length > 0) {
          const aliased = grp.fnNames.map((fn) => `${fn} as __ext_${fn}`).join(', ');
          singleWriter.line(`import { ${aliased} } from '${grp.importSpec}';`);
        }
      }
      singleWriter.blank();
      singleWriter.line('@Component({');
      singleWriter.indent();
      singleWriter.line(`selector: 'app-${kebab}',`);
      singleWriter.line('standalone: true,');
      singleWriter.line('changeDetection: ChangeDetectionStrategy.OnPush,');
      singleWriter.line('template: `');
      singleWriter.indent();
      renderAngularTemplate(singleWriter, comp.root, ir, dialect, classMap, true, scriptMethods, blueprintEvents);
      singleWriter.dedent();
      singleWriter.line('`,');
      singleWriter.dedent();
      singleWriter.line('})');
      singleWriter.line(`export class ${comp.name}Component {`);
      singleWriter.indent();
      for (const p of comp.props) {
        const def = p.defaultValue !== undefined ? JSON.stringify(p.defaultValue) : "''";
        singleWriter.line(`readonly ${toCamelCase(p.name)} = input<${p.type || 'string'}>(${def});`);
      }
      for (const sv of comp.stateVars) {
        const cName = toCamelCase(sv.name);
        singleWriter.line(`readonly ${cName} = signal(${defaultSignalVal(sv)});`);
        if (sv.type === 'number') {
          singleWriter.line(`increment${toPascalCase(sv.name)}(): void { this.${cName}.update((v) => v + 1); }`);
        }
      }
      for (const rep of collectRepeatLists(comp.root)) {
        const items = (rep.samples.length ? rep.samples : ['Item 1', 'Item 2']).map(
          (s, i) => `{ id: '${i + 1}', label: '${s.replace(/'/g, "\\'")}' }`,
        );
        singleWriter.line(`readonly ${rep.name} = signal([${items.join(', ')}]);`);
      }
      for (const ipc of comp.ipcCommands) {
        singleWriter.line(`on${toPascalCase(ipc.name)}(): void { console.info('${ipc.name}'); }`);
      }
      for (const fn of scriptMethods) {
        if (importedFns.has(fn)) {
          singleWriter.line(`${fn}(event?: Event): void { void __ext_${fn}(event); }`);
        } else {
          singleWriter.line(`${fn}(): void { console.info('Script handler:', '${fn}'); }`);
        }
      }
      for (const [mName, bp] of blueprintEvents.entries()) {
        singleWriter.line(
          `${mName}(): void { window.dispatchEvent(new CustomEvent('studio:blueprint-event', { detail: { blueprintId: '${bp.blueprintId}', eventName: '${bp.eventName}' } })); }`,
        );
      }
      singleWriter.dedent();
      singleWriter.line('}');

      return {
        targetId: 'angular',
        dialect,
        mode,
        entryFilePath: singlePath,
        files: [singleWriter.toEmittedFile(singlePath, 'typescript', true)],
        diagnostics: [],
        generatedAt: Date.now(),
      };
    }

    // Multi-file Angular 19 bundle: Template (.html with SourceMap) + Component (.ts) + Styles (.css)
    const htmlWriter = new SourceMapWriter(2);
    renderAngularTemplate(htmlWriter, comp.root, ir, dialect, classMap, true, scriptMethods, blueprintEvents);

    const tsCompPath = `${kebab}.component.ts`;
    const groupedImports = collectGroupedScriptImportsForSubtree(
      comp.root,
      ir,
      tsCompPath,
      './scripts/handlers',
    );
    const importedFns = new Set(groupedImports.flatMap((g) => g.fnNames));

    const tsWriter = new SourceMapWriter(2);
    tsWriter.line("import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';");
    for (const grp of groupedImports) {
      if (grp.fnNames.length > 0) {
        const aliased = grp.fnNames.map((fn) => `${fn} as __ext_${fn}`).join(', ');
        tsWriter.line(`import { ${aliased} } from '${grp.importSpec}';`);
      }
    }
    tsWriter.blank();
    tsWriter.line('@Component({');
    tsWriter.indent();
    tsWriter.line(`selector: 'app-${kebab}',`);
    tsWriter.line('standalone: true,');
    tsWriter.line(`templateUrl: './${kebab}.component.html',`);
    if (dialect === 'vanilla-css') {
      tsWriter.line(`styleUrl: './${kebab}.component.css',`);
    }
    tsWriter.line('changeDetection: ChangeDetectionStrategy.OnPush,');
    tsWriter.dedent();
    tsWriter.line('})');
    tsWriter.line(`export class ${comp.name}Component {`);
    tsWriter.indent();
    for (const p of comp.props) {
      const def = p.defaultValue !== undefined ? JSON.stringify(p.defaultValue) : "''";
      tsWriter.line(`readonly ${toCamelCase(p.name)} = input<${p.type || 'string'}>(${def});`);
    }
    for (const sv of comp.stateVars) {
      const cName = toCamelCase(sv.name);
      tsWriter.line(`readonly ${cName} = signal(${defaultSignalVal(sv)});`);
      if (sv.type === 'number') {
        tsWriter.line(`increment${toPascalCase(sv.name)}(): void { this.${cName}.update((v) => v + 1); }`);
      }
    }
    for (const rep of collectRepeatLists(comp.root)) {
      const items = (rep.samples.length ? rep.samples : ['Item 1', 'Item 2']).map(
        (s, i) => `{ id: '${i + 1}', label: '${s.replace(/'/g, "\\'")}' }`,
      );
      tsWriter.line(`readonly ${rep.name} = signal([${items.join(', ')}]);`);
    }
    for (const ipc of comp.ipcCommands) {
      tsWriter.line(`on${toPascalCase(ipc.name)}(): void { console.info('${ipc.name}'); }`);
    }
    for (const fn of scriptMethods) {
      if (importedFns.has(fn)) {
        tsWriter.line(`${fn}(event?: Event): void { void __ext_${fn}(event); }`);
      } else {
        tsWriter.line(`${fn}(): void { console.info('Script handler:', '${fn}'); }`);
      }
    }
    for (const [mName, bp] of blueprintEvents.entries()) {
      tsWriter.line(
        `${mName}(): void { window.dispatchEvent(new CustomEvent('studio:blueprint-event', { detail: { blueprintId: '${bp.blueprintId}', eventName: '${bp.eventName}' } })); }`,
      );
    }
    tsWriter.dedent();
    tsWriter.line('}');

    const entryTemplatePath = `${kebab}.component.html`;
    const files: EmittedCodeFile[] = [
      htmlWriter.toEmittedFile(entryTemplatePath, 'html', true),
      tsWriter.toEmittedFile(`${kebab}.component.ts`, 'typescript', false),
    ];

    if (dialect === 'vanilla-css') {
      const cssBuilt = buildStylesheetWithSourceMap(comp.root, ir.tokens, {
        includeTokensRoot: true,
        classMap,
        customCss: ir.customCss,
      });
      files.push({
        relativePath: `${kebab}.component.css`,
        language: 'css',
        code: cssBuilt.code,
        sourceMap: cssBuilt.sourceMap,
        diagnostics: [],
      });
    }

    return {
      targetId: 'angular',
      dialect,
      mode,
      entryFilePath: entryTemplatePath,
      files,
      diagnostics: [],
      generatedAt: Date.now(),
    };
  },
};
