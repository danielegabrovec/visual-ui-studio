import {
  BUILTIN_TARGET_DESCRIPTORS,
  type CodegenTargetPlugin,
  type EmittedCodeFile,
  type UIRModule,
  type UIRNode,
  type UIRTokenDictionary,
} from '@shared/ui-ir';
import { SourceMapWriter } from '../code-writer';
import {
  buildCssClassMap,
  buildUniqueNameMap,
  escapeDoubleQuoted,
  getAbsoluteFrameMetrics,
  getLiteralText,
  getPrimarySolidFill,
  isAbsolutePositionedNode,
  isFreeformHostContainer,
  resolveColorHex,
  resolveDarkColorHex,
  resolveNum,
  resolvePaddingNums,
  resolveRadiusNum,
  toKebabCase,
  toPascalCase,
  toSnakeCase,
} from '../style-helpers';

const ctkDescriptor = BUILTIN_TARGET_DESCRIPTORS.find((d) => d.id === 'python-customtkinter')!;
const gradioDescriptor = BUILTIN_TARGET_DESCRIPTORS.find((d) => d.id === 'python-gradio')!;
const streamlitDescriptor = BUILTIN_TARGET_DESCRIPTORS.find((d) => d.id === 'python-streamlit')!;
const pyside6Descriptor = BUILTIN_TARGET_DESCRIPTORS.find((d) => d.id === 'python-pyside6')!;
const slintDescriptor = BUILTIN_TARGET_DESCRIPTORS.find((d) => d.id === 'rust-slint')!;

// ============================================================================
// 16. PYTHON CUSTOMTKINTER (`python-customtkinter`)
// ============================================================================

function renderCtkSubtree(
  w: SourceMapWriter,
  node: UIRNode,
  ir: UIRModule,
  parentVar: string,
  varMap: ReadonlyMap<string, string>,
  callbacks: Set<string>,
  gridPos?: { row: number; col: number },
): void {
  w.withNode(node.canvasNodeId, () => {
    const varName = varMap.get(node.canvasNodeId) ?? toSnakeCase(node.name, 'widget');
    const fill = getPrimarySolidFill(node);
    const lightHex = resolveColorHex(fill, ir.tokens, '');
    const darkHex = resolveDarkColorHex(fill, ir.tokens, lightHex);
    const rad = resolveRadiusNum(node, ir.tokens);
    const pad = resolvePaddingNums(node.layout.padding, ir.tokens);
    const isAbs = isAbsolutePositionedNode(node, false);
    const abs = getAbsoluteFrameMetrics(node);

    const placeWidget = (extraPack = '') => {
      if (isAbs) {
        w.line(`${varName}.place(x=${abs.x}, y=${abs.y})`);
      } else if (gridPos) {
        w.line(`${varName}.grid(row=${gridPos.row}, column=${gridPos.col}, padx=6, pady=6, sticky="nsew")`);
      } else {
        const fillMode = node.layout.width.mode === 'FILL' ? ', fill="x"' : '';
        w.line(`${varName}.pack(padx=${Math.max(4, Math.round(pad.left / 2))}, pady=6${fillMode}${extraPack})`);
      }
    };

    const sizeKw = isAbs ? `, width=${abs.width}, height=${abs.height}` : '';

    if (node.kind === 'ThreeViewport' || node.content?.controlType === 'three-viewport') {
      const sceneId = escapeDoubleQuoted(node.content?.threeSceneId || 'default-3d-scene');
      w.line(`${varName} = ctk.CTkFrame(${parentVar}, fg_color="#0b1120", corner_radius=${rad || 10}${sizeKw})`);
      placeWidget();
      w.line(`ctk.CTkLabel(${varName}, text="3D Viewport: ${sceneId}").pack(padx=12, pady=12)`);
      return;
    }

    if (node.kind === 'Button' || node.kind === 'IconButton') {
      const label = escapeDoubleQuoted(getLiteralText(node, node.name));
      const cbName = `on_${varName}`;
      callbacks.add(cbName);
      const fg = lightHex && lightHex !== 'transparent' ? `, fg_color=("${lightHex}", "${darkHex || lightHex}")` : '';
      w.line(`${varName} = ctk.CTkButton(${parentVar}, text="${label}", corner_radius=${rad || 8}${fg}${sizeKw}, command=self.${cbName})`);
      placeWidget(', anchor="w"');
      return;
    }

    if (node.kind === 'TextInput' || node.kind === 'TextArea') {
      const ph = escapeDoubleQuoted(node.content?.placeholder ?? 'Enter text...');
      w.line(`${varName} = ctk.CTkEntry(${parentVar}, placeholder_text="${ph}", corner_radius=${rad || 6}${sizeKw})`);
      placeWidget();
      return;
    }

    if (node.kind === 'Heading' || node.kind === 'Text' || (node.children.length === 0 && getLiteralText(node))) {
      const txt = escapeDoubleQuoted(getLiteralText(node, ''));
      const fs = resolveNum(node.style.typography?.fontSize, ir.tokens, 15);
      const fw = Number(node.style.typography?.fontWeight ?? 400) >= 600 ? 'bold' : 'normal';
      w.line(`${varName} = ctk.CTkLabel(${parentVar}, text="${txt}", font=ctk.CTkFont(size=${fs}, weight="${fw}"), anchor="w"${sizeKw})`);
      placeWidget(', anchor="w"');
      return;
    }

    const freeSizeKw = isFreeformHostContainer(node) && !isAbs
      ? `, width=${Math.max(120, Math.round(node.layout.frame.width))}, height=${Math.max(80, Math.round(node.layout.frame.height))}`
      : sizeKw;
    const fgTuple =
      lightHex && lightHex !== 'transparent'
        ? `fg_color=("${lightHex}", "${darkHex || lightHex}")`
        : 'fg_color="transparent"';
    w.line(`${varName} = ctk.CTkFrame(${parentVar}, ${fgTuple}, corner_radius=${rad}${freeSizeKw})`);
    placeWidget();

    if (!isFreeformHostContainer(node) && (node.layout.mode === 'GRID' || node.layout.mode === 'ROW')) {
      const colCount =
        node.layout.mode === 'GRID'
          ? Math.max(1, (node.layout.gridTracks?.columns ?? ['1fr']).length)
          : Math.max(1, node.children.length);
      for (let c = 0; c < colCount; c++) {
        w.line(`${varName}.grid_columnconfigure(${c}, weight=1)`);
      }
      node.children.forEach((child, idx) => {
        renderCtkSubtree(w, child, ir, varName, varMap, callbacks, {
          row: Math.floor(idx / colCount),
          col: idx % colCount,
        });
      });
    } else {
      for (const child of node.children) {
        renderCtkSubtree(w, child, ir, varName, varMap, callbacks);
      }
    }
  });
}

export const pythonCustomTkinterPlugin: CodegenTargetPlugin = {
  descriptor: ctkDescriptor,
  emitSnippet(node, ir) {
    const w = new SourceMapWriter(4);
    const callbacks = new Set<string>();
    const varMap = buildUniqueNameMap(node, 'snake', 'widget');
    renderCtkSubtree(w, node, ir, 'parent', varMap, callbacks);
    return w.toEmittedFile(`${toSnakeCase(node.name)}_widget.py`, 'python', true);
  },
  emitComponent(comp, ir, opts) {
    const mode = opts.mode ?? 'component';
    const snake = toSnakeCase(comp.name, 'studio_app');
    const varMap = buildUniqueNameMap(comp.root, 'snake', 'widget');
    const callbacks = new Set<string>();

    const w = new SourceMapWriter(4);
    w.line('"""Generated Desktop GUI — Python CustomTkinter"""');
    w.line('from __future__ import annotations');
    w.line('import customtkinter as ctk');
    w.blank();
    w.line('ctk.set_appearance_mode("System")');
    w.line('ctk.set_default_color_theme("blue")');
    w.blank();
    w.line(`class ${comp.name}App(ctk.CTk):`);
    w.indent();
    w.line('def __init__(self) -> None:');
    w.indent();
    w.line('super().__init__()');
    const winW = ir.windowChrome?.width ?? 1120;
    const winH = ir.windowChrome?.height ?? 820;
    w.line(`self.title("${escapeDoubleQuoted(ir.windowChrome?.title ?? comp.name)}")`);
    w.line(`self.geometry("${winW}x${winH}")`);
    for (const sv of comp.stateVars) {
      const pyVal =
        typeof sv.initialValue === 'string'
          ? `"${escapeDoubleQuoted(sv.initialValue)}"`
          : typeof sv.initialValue === 'boolean'
            ? sv.initialValue
              ? 'True'
              : 'False'
            : JSON.stringify(sv.initialValue ?? 0);
      w.line(`self.${toSnakeCase(sv.name)} = ${pyVal}`);
    }
    w.line('scroll_root = ctk.CTkScrollableFrame(self, fg_color="transparent")');
    w.line('scroll_root.pack(fill="both", expand=True, padx=16, pady=16)');
    w.line('self._build_ui(scroll_root)');
    w.dedent();
    w.blank();
    w.line('def _build_ui(self, scroll_root: ctk.CTkScrollableFrame) -> None:');
    w.indent();
    renderCtkSubtree(w, comp.root, ir, 'scroll_root', varMap, callbacks);
    w.dedent();
    w.blank();

    for (const cb of callbacks) {
      w.line(`def ${cb}(self) -> None:`);
      w.indent();
      w.line(`print("[${comp.name}App] Triggered ${cb}")`);
      w.dedent();
      w.blank();
    }

    w.dedent();
    w.line('if __name__ == "__main__":');
    w.indent();
    w.line(`app = ${comp.name}App()`);
    w.line('app.mainloop()');
    w.dedent();

    const filePath = `${snake}_app.py`;
    return {
      targetId: 'python-customtkinter',
      dialect: 'vanilla-css',
      mode,
      entryFilePath: filePath,
      files: [w.toEmittedFile(filePath, 'python', true)],
      diagnostics: [],
      generatedAt: Date.now(),
    };
  },
};

// ============================================================================
// 17. PYTHON GRADIO 5 BLOCKS (`python-gradio`)
// ============================================================================

function renderGradioNode(
  w: SourceMapWriter,
  node: UIRNode,
  ir: UIRModule,
  varMap: ReadonlyMap<string, string>,
  events: Array<{ btnVar: string; fnName: string }>,
): void {
  w.withNode(node.canvasNodeId, () => {
    const varName = varMap.get(node.canvasNodeId) ?? toSnakeCase(node.name, 'el');

    if (node.kind === 'Button' || node.kind === 'IconButton') {
      const label = escapeDoubleQuoted(getLiteralText(node, node.name));
      const variant = node.style.base.border ? 'secondary' : 'primary';
      w.line(`${varName} = gr.Button("${label}", variant="${variant}")`);
      if (node.interactions.length > 0) {
        events.push({ btnVar: varName, fnName: `handle_${varName}` });
      }
      return;
    }

    if (node.kind === 'TextInput' || node.kind === 'TextArea') {
      const ph = escapeDoubleQuoted(node.content?.placeholder ?? 'Type here...');
      const lbl = escapeDoubleQuoted(node.a11y?.ariaLabel ?? node.name);
      w.line(`${varName} = gr.Textbox(label="${lbl}", placeholder="${ph}")`);
      return;
    }

    if (node.kind === 'Heading' || node.kind === 'Text' || (node.children.length === 0 && getLiteralText(node))) {
      const raw = getLiteralText(node, '');
      const prefix = node.semanticTag === 'h1' ? '# ' : node.semanticTag === 'h2' ? '## ' : node.semanticTag === 'h3' ? '### ' : '';
      w.line(`gr.Markdown("${escapeDoubleQuoted(prefix + raw)}")`);
      return;
    }

    if (node.children.length === 0) {
      w.line(`gr.HTML("<div></div>")`);
      return;
    }

    const containerCtx = node.layout.mode === 'ROW' || node.layout.mode === 'GRID' ? 'gr.Row()' : 'gr.Column()';
    w.line(`with ${containerCtx}:`);
    w.indent();
    for (const c of node.children) {
      renderGradioNode(w, c, ir, varMap, events);
    }
    w.dedent();
  });
}

export const pythonGradioPlugin: CodegenTargetPlugin = {
  descriptor: gradioDescriptor,
  emitSnippet(node, ir) {
    const w = new SourceMapWriter(4);
    const varMap = buildUniqueNameMap(node, 'snake', 'el');
    renderGradioNode(w, node, ir, varMap, []);
    return w.toEmittedFile(`${toSnakeCase(node.name)}_gradio.py`, 'python', true);
  },
  emitComponent(comp, ir, opts) {
    const mode = opts.mode ?? 'component';
    const snake = toSnakeCase(comp.name, 'gradio_app');
    const varMap = buildUniqueNameMap(comp.root, 'snake', 'el');
    const events: Array<{ btnVar: string; fnName: string }> = [];

    const w = new SourceMapWriter(4);
    w.line('"""Generated AI/Data Web UI — Python Gradio Blocks"""');
    w.line('from __future__ import annotations');
    w.line('import gradio as gr');
    w.blank();
    w.line(`def build_${snake}() -> gr.Blocks:`);
    w.indent();
    w.line(`with gr.Blocks(title="${escapeDoubleQuoted(comp.name)}", theme=gr.themes.Soft()) as demo:`);
    w.indent();
    w.line('status_state = gr.State(value="Ready")');
    renderGradioNode(w, comp.root, ir, varMap, events);
    for (const ev of events) {
      w.line(`${ev.btnVar}.click(fn=lambda s: s, inputs=[status_state], outputs=[status_state])`);
    }
    w.dedent();
    w.line('return demo');
    w.dedent();
    w.blank();
    w.line('if __name__ == "__main__":');
    w.indent();
    w.line(`build_${snake}().launch()`);
    w.dedent();

    const filePath = 'app.py';
    return {
      targetId: 'python-gradio',
      dialect: 'vanilla-css',
      mode,
      entryFilePath: filePath,
      files: [w.toEmittedFile(filePath, 'python', true)],
      diagnostics: [],
      generatedAt: Date.now(),
    };
  },
};

// ============================================================================
// 20. PYTHON STREAMLIT AI/DATA DASHBOARD (`python-streamlit`)
// ============================================================================

function isMetricCardNode(node: UIRNode): boolean {
  if (node.children.length !== 2) return false;
  const [first, second] = node.children;
  const bothText =
    (first.kind === 'Text' || first.kind === 'Heading') &&
    (second.kind === 'Text' || second.kind === 'Heading');
  if (!bothText) return false;
  const nameLower = node.name.toLowerCase();
  const valText = getLiteralText(second, '');
  return (
    nameLower.includes('kpi') ||
    nameLower.includes('metric') ||
    nameLower.includes('stat') ||
    /^[$€£¥0-9+-]/.test(valText.trim())
  );
}

function renderStreamlitNode(
  w: SourceMapWriter,
  node: UIRNode,
  ir: UIRModule,
  keyMap: ReadonlyMap<string, string>,
  isRoot = false,
): void {
  w.withNode(node.canvasNodeId, () => {
    const widgetKey = keyMap.get(node.canvasNodeId) ?? toSnakeCase(node.name, 'widget');
    const fill = getPrimarySolidFill(node);
    const hasBorderCard = !isRoot && Boolean(fill || node.style.base.border);

    if (node.kind === 'Button' || node.kind === 'IconButton') {
      const label = escapeDoubleQuoted(getLiteralText(node, node.name));
      const btnType = node.style.base.border ? 'secondary' : 'primary';
      w.line(`if st.button("${label}", key="${widgetKey}", type="${btnType}"):`);
      w.indent();
      let emittedAction = false;
      for (const inter of node.interactions) {
        if (inter.type === 'STATE_MUTATION') {
          const stKey = toSnakeCase(inter.targetState);
          if (inter.expr.includes('+ 1')) {
            w.line(`st.session_state["${stKey}"] = int(st.session_state.get("${stKey}", 0)) + 1`);
          } else {
            w.line(`st.session_state["${stKey}"] = "${escapeDoubleQuoted(inter.expr)}"`);
          }
          emittedAction = true;
        } else if (inter.type === 'NATIVE_IPC_CALL') {
          const resKey = inter.resultStateTarget ? toSnakeCase(inter.resultStateTarget) : 'last_action';
          w.line(`st.session_state["${resKey}"] = "Executed ${escapeDoubleQuoted(inter.commandName)}"`);
          w.line(`st.toast("Completed ${escapeDoubleQuoted(inter.commandName)}")`);
          emittedAction = true;
        }
      }
      if (!emittedAction) {
        w.line(`st.toast("${label}")`);
      }
      w.dedent();
      return;
    }

    if (node.kind === 'TextInput' || node.kind === 'TextArea') {
      const ph = escapeDoubleQuoted(node.content?.placeholder ?? 'Type here...');
      const lbl = escapeDoubleQuoted(node.a11y?.ariaLabel ?? node.name);
      const stateKey = node.mvvm?.bindings?.Text?.path
        ? toSnakeCase(node.mvvm.bindings.Text.path)
        : widgetKey;
      const fn = node.kind === 'TextArea' ? 'text_area' : 'text_input';
      w.line(
        `st.session_state["${stateKey}"] = st.${fn}("${lbl}", value=str(st.session_state.get("${stateKey}", "")), placeholder="${ph}", key="input_${widgetKey}", label_visibility="collapsed")`,
      );
      return;
    }

    if (node.kind === 'Switch' || node.kind === 'Checkbox') {
      const lbl = escapeDoubleQuoted(getLiteralText(node, node.name));
      const fn = node.kind === 'Switch' ? 'toggle' : 'checkbox';
      const def = node.content?.checked ? 'True' : 'False';
      w.line(`st.${fn}("${lbl}", value=${def}, key="${widgetKey}")`);
      return;
    }

    if (node.kind === 'Divider') {
      w.line('st.divider()');
      return;
    }

    if (node.kind === 'Heading' || node.kind === 'Text' || (node.children.length === 0 && getLiteralText(node))) {
      const txt = escapeDoubleQuoted(getLiteralText(node, ''));
      if (node.semanticTag === 'h1') {
        w.line(`st.title("${txt}")`);
      } else if (node.semanticTag === 'h2') {
        w.line(`st.header("${txt}")`);
      } else if (node.semanticTag === 'h3') {
        w.line(`st.subheader("${txt}")`);
      } else {
        const fs = resolveNum(node.style.typography?.fontSize, ir.tokens, 15);
        if (fs <= 13) {
          w.line(`st.caption("${txt}")`);
        } else {
          w.line(`st.markdown("${txt}")`);
        }
      }
      return;
    }

    if (isMetricCardNode(node)) {
      const [labelChild, valueChild] = node.children;
      const metricLabel = escapeDoubleQuoted(getLiteralText(labelChild, labelChild.name));
      const metricValue = escapeDoubleQuoted(getLiteralText(valueChild, '0'));
      w.line('with st.container(border=True):');
      w.indent();
      w.withNode(labelChild.canvasNodeId, () => {
        w.withNode(valueChild.canvasNodeId, () => {
          w.line(`st.metric(label="${metricLabel}", value="${metricValue}")`);
        });
      });
      w.dedent();
      return;
    }

    if (node.controlFlow?.repeat) {
      const samples = node.children.map((c) => getLiteralText(c, 'Sample Item')).filter(Boolean);
      const listPy = (samples.length > 0 ? samples : ['Item 1', 'Item 2'])
        .map((s) => `"${escapeDoubleQuoted(s)}"`)
        .join(', ');
      const listVar = `${toSnakeCase(node.controlFlow.repeat.collectionExpr)}_items`;
      w.line(`${listVar} = [${listPy}]`);
      w.line(`for item in ${listVar}:`);
      w.indent();
      w.line('with st.container(border=True):');
      w.indent();
      w.line('st.markdown(item)');
      w.dedent();
      w.dedent();
      return;
    }

    const emitChildrenLayout = () => {
      if ((node.layout.mode === 'GRID' || node.layout.mode === 'ROW') && node.children.length > 1) {
        const colCount =
          node.layout.mode === 'GRID'
            ? Math.max(1, (node.layout.gridTracks?.columns ?? ['1fr']).length)
            : node.children.length;
        const colsVar = `cols_${widgetKey}`;
        w.line(`${colsVar} = st.columns(${colCount}, gap="medium")`);
        node.children.forEach((child, idx) => {
          w.line(`with ${colsVar}[${idx % colCount}]:`);
          w.indent();
          renderStreamlitNode(w, child, ir, keyMap, false);
          w.dedent();
        });
      } else {
        if (node.children.length === 0) {
          w.line('st.empty()');
          return;
        }
        for (const child of node.children) {
          renderStreamlitNode(w, child, ir, keyMap, false);
        }
      }
    };

    if (hasBorderCard) {
      w.line('with st.container(border=True):');
      w.indent();
      emitChildrenLayout();
      w.dedent();
    } else {
      emitChildrenLayout();
    }
  });
}

export const pythonStreamlitPlugin: CodegenTargetPlugin = {
  descriptor: streamlitDescriptor,
  emitSnippet(node, ir) {
    const w = new SourceMapWriter(4);
    const keyMap = buildUniqueNameMap(node, 'snake', 'widget');
    renderStreamlitNode(w, node, ir, keyMap, false);
    return w.toEmittedFile(`${toSnakeCase(node.name)}_snippet.py`, 'python', true);
  },
  emitComponent(comp, ir, opts) {
    const mode = opts.mode ?? 'bundle';
    const keyMap = buildUniqueNameMap(comp.root, 'snake', 'widget');

    const w = new SourceMapWriter(4);
    w.line('"""Generated AI/Data Dashboard — Python Streamlit"""');
    w.line('from __future__ import annotations');
    w.line('import streamlit as st');
    w.blank();
    w.line('st.set_page_config(');
    w.indent();
    w.line(`page_title="${escapeDoubleQuoted(comp.name)}",`);
    w.line('layout="wide",');
    w.line('initial_sidebar_state="collapsed",');
    w.dedent();
    w.line(')');
    w.blank();
    w.line('def init_session_state() -> None:');
    w.indent();
    w.line('defaults: dict[str, object] = {');
    w.indent();
    for (const sv of comp.stateVars) {
      const pyKey = toSnakeCase(sv.name);
      const pyVal =
        typeof sv.initialValue === 'string'
          ? `"${escapeDoubleQuoted(sv.initialValue)}"`
          : typeof sv.initialValue === 'boolean'
            ? sv.initialValue
              ? 'True'
              : 'False'
            : JSON.stringify(sv.initialValue ?? 0);
      w.line(`"${pyKey}": ${pyVal},`);
    }
    if (comp.stateVars.length === 0) {
      w.line('"ready": True,');
    }
    w.dedent();
    w.line('}');
    w.line('for key, val in defaults.items():');
    w.indent();
    w.line('st.session_state.setdefault(key, val)');
    w.dedent();
    w.dedent();
    w.blank();
    w.line('def main() -> None:');
    w.indent();
    w.line('init_session_state()');
    renderStreamlitNode(w, comp.root, ir, keyMap, true);
    w.dedent();
    w.blank();
    w.line('if __name__ == "__main__":');
    w.indent();
    w.line('main()');
    w.dedent();

    const files: EmittedCodeFile[] = [w.toEmittedFile('app.py', 'python', true)];

    if (mode === 'bundle' || mode === 'scaffold') {
      files.push({
        relativePath: 'requirements.txt',
        language: 'plaintext',
        code: 'streamlit>=1.41.0\npandas>=2.2.0\n',
        sourceMap: [],
        diagnostics: [],
      });
    }

    return {
      targetId: 'python-streamlit',
      dialect: 'vanilla-css',
      mode,
      entryFilePath: 'app.py',
      files,
      diagnostics: [],
      generatedAt: Date.now(),
    };
  },
};

// ============================================================================
// 21. PYTHON PYSIDE6 / QT 6 WIDGETS + QSS (`python-pyside6`)
// ============================================================================

function buildPySide6QssFromTokens(root: UIRNode, tokens: UIRTokenDictionary, objNameMap: ReadonlyMap<string, string>): string {
  const canvasBg = tokens.colors['color.bg.canvas']?.light ?? '#f8fafc';
  const surfaceBg = tokens.colors['color.bg.surface']?.light ?? '#ffffff';
  const primaryBg = tokens.colors['color.primary.600']?.light ?? '#2563eb';
  const textPrimary = tokens.colors['color.text.primary']?.light ?? '#0f172a';
  const borderSubtle = tokens.colors['color.border.subtle']?.light ?? '#e2e8f0';

  const rules: string[] = [
    `QMainWindow, QScrollArea { background-color: ${canvasBg}; border: none; }`,
    `QWidget { color: ${textPrimary}; font-family: "Inter", "Segoe UI", sans-serif; }`,
    `QLineEdit { background-color: ${surfaceBg}; border: 1px solid ${borderSubtle}; border-radius: 6px; padding: 8px 12px; }`,
    `QPushButton { background-color: ${primaryBg}; color: #ffffff; border: none; border-radius: 8px; padding: 8px 16px; font-weight: 600; }`,
  ];

  const walk = (n: UIRNode) => {
    const objName = objNameMap.get(n.canvasNodeId) ?? toKebabCase(n.name, 'widget');
    const props: string[] = [];
    const fill = getPrimarySolidFill(n);
    const bgHex = resolveColorHex(fill, tokens, '');
    if (bgHex && bgHex !== 'transparent') {
      props.push(`background-color: ${bgHex};`);
    }
    if (n.style.base.border && n.style.base.border.style !== 'none') {
      const bHex = resolveColorHex(n.style.base.border.color, tokens, borderSubtle);
      props.push(`border: 1px solid ${bHex};`);
    }
    const rad = resolveRadiusNum(n, tokens);
    if (rad > 0) {
      props.push(`border-radius: ${rad}px;`);
    }
    if (n.style.typography) {
      const fs = resolveNum(n.style.typography.fontSize, tokens, 15);
      const fw = Number(n.style.typography.fontWeight ?? 400);
      const tc = resolveColorHex(n.style.typography.color, tokens, '');
      props.push(`font-size: ${fs}px;`);
      if (fw >= 600) props.push(`font-weight: ${fw};`);
      if (tc && tc !== 'transparent') props.push(`color: ${tc};`);
    }
    if (props.length > 0) {
      rules.push(`#${objName} { ${props.join(' ')} }`);
    }
    for (const c of n.children) walk(c);
  };
  walk(root);

  return rules.join('\n') + '\n';
}

function renderPySide6Subtree(
  w: SourceMapWriter,
  node: UIRNode,
  ir: UIRModule,
  parentLayoutVar: string,
  varMap: ReadonlyMap<string, string>,
  objNameMap: ReadonlyMap<string, string>,
  slots: Map<string, string[]>,
  gridPos?: { row: number; col: number },
  parentWidgetForAbs?: string,
): void {
  w.withNode(node.canvasNodeId, () => {
    const varName = varMap.get(node.canvasNodeId) ?? toSnakeCase(node.name, 'widget');
    const objName = objNameMap.get(node.canvasNodeId) ?? toKebabCase(node.name, 'widget');
    const pad = resolvePaddingNums(node.layout.padding, ir.tokens);
    const gap = resolveNum(node.layout.gap, ir.tokens, 8);
    const isAbs = isAbsolutePositionedNode(node, false);
    const abs = getAbsoluteFrameMetrics(node);

    const attachToParent = () => {
      if (parentWidgetForAbs && isAbs) {
        w.line(`${varName}.setParent(${parentWidgetForAbs})`);
        w.line(`${varName}.setGeometry(${abs.x}, ${abs.y}, ${abs.width}, ${abs.height})`);
      } else if (gridPos) {
        w.line(`${parentLayoutVar}.addWidget(${varName}, ${gridPos.row}, ${gridPos.col})`);
      } else {
        w.line(`${parentLayoutVar}.addWidget(${varName})`);
      }
    };

    if (node.kind === 'ThreeViewport' || node.content?.controlType === 'three-viewport') {
      const sceneId = escapeDoubleQuoted(node.content?.threeSceneId || 'default-3d-scene');
      w.line(`${varName} = QLabel("3D Viewport: ${sceneId}")`);
      w.line(`${varName}.setObjectName("${objName}")`);
      attachToParent();
      return;
    }

    if (node.kind === 'Button' || node.kind === 'IconButton') {
      const label = escapeDoubleQuoted(getLiteralText(node, node.name));
      const slotName = `on_${varName}_clicked`;
      const slotLines: string[] = [];
      for (const inter of node.interactions) {
        if (inter.type === 'STATE_MUTATION' && inter.expr.includes('+ 1')) {
          slotLines.push(`self.${toSnakeCase(inter.targetState)} += 1`);
        } else if (inter.type === 'NATIVE_IPC_CALL') {
          if (inter.resultStateTarget) {
            slotLines.push(`self.${toSnakeCase(inter.resultStateTarget)} = "Completed ${escapeDoubleQuoted(inter.commandName)}"`);
          }
        }
      }
      if (slotLines.length === 0) {
        slotLines.push(`print("[PySide6] ${slotName}")`);
      }
      slots.set(slotName, slotLines);

      w.line(`${varName} = QPushButton("${label}")`);
      w.line(`${varName}.setObjectName("${objName}")`);
      w.line(`${varName}.setCursor(Qt.CursorShape.PointingHandCursor)`);
      w.line(`${varName}.clicked.connect(self.${slotName})`);
      attachToParent();
      return;
    }

    if (node.kind === 'TextInput' || node.kind === 'TextArea') {
      const ph = escapeDoubleQuoted(node.content?.placeholder ?? 'Search...');
      w.line(`${varName} = QLineEdit()`);
      w.line(`${varName}.setObjectName("${objName}")`);
      w.line(`${varName}.setPlaceholderText("${ph}")`);
      if (node.mvvm?.bindings?.Text?.path) {
        const stAttr = toSnakeCase(node.mvvm.bindings.Text.path);
        const slotName = `on_${varName}_changed`;
        slots.set(slotName, [`self.${stAttr} = text`]);
        w.line(`${varName}.textChanged.connect(self.${slotName})`);
      }
      attachToParent();
      return;
    }

    if (node.kind === 'Checkbox' || node.kind === 'Switch') {
      const label = escapeDoubleQuoted(getLiteralText(node, node.name));
      w.line(`${varName} = QCheckBox("${label}")`);
      w.line(`${varName}.setObjectName("${objName}")`);
      if (node.content?.checked) w.line(`${varName}.setChecked(True)`);
      attachToParent();
      return;
    }

    if (node.kind === 'Heading' || node.kind === 'Text' || (node.children.length === 0 && getLiteralText(node))) {
      const txt = escapeDoubleQuoted(getLiteralText(node, ''));
      w.line(`${varName} = QLabel("${txt}")`);
      w.line(`${varName}.setObjectName("${objName}")`);
      w.line(`${varName}.setWordWrap(True)`);
      attachToParent();
      return;
    }

    w.line(`${varName} = QFrame()`);
    w.line(`${varName}.setObjectName("${objName}")`);
    const layoutVar = `${varName}_layout`;

    if (isFreeformHostContainer(node)) {
      w.line(`${varName}.setMinimumSize(${Math.max(120, Math.round(node.layout.frame.width))}, ${Math.max(80, Math.round(node.layout.frame.height))})`);
      for (const child of node.children) {
        renderPySide6Subtree(w, child, ir, parentLayoutVar, varMap, objNameMap, slots, undefined, varName);
      }
    } else if (node.layout.mode === 'GRID') {
      const colCount = Math.max(1, (node.layout.gridTracks?.columns ?? ['1fr']).length);
      w.line(`${layoutVar} = QGridLayout(${varName})`);
      w.line(`${layoutVar}.setContentsMargins(${pad.left}, ${pad.top}, ${pad.right}, ${pad.bottom})`);
      w.line(`${layoutVar}.setSpacing(${gap})`);
      node.children.forEach((child, idx) => {
        renderPySide6Subtree(w, child, ir, layoutVar, varMap, objNameMap, slots, {
          row: Math.floor(idx / colCount),
          col: idx % colCount,
        });
      });
    } else if (node.layout.mode === 'ROW') {
      w.line(`${layoutVar} = QHBoxLayout(${varName})`);
      w.line(`${layoutVar}.setContentsMargins(${pad.left}, ${pad.top}, ${pad.right}, ${pad.bottom})`);
      w.line(`${layoutVar}.setSpacing(${gap})`);
      for (const child of node.children) {
        renderPySide6Subtree(w, child, ir, layoutVar, varMap, objNameMap, slots);
      }
    } else {
      w.line(`${layoutVar} = QVBoxLayout(${varName})`);
      w.line(`${layoutVar}.setContentsMargins(${pad.left}, ${pad.top}, ${pad.right}, ${pad.bottom})`);
      w.line(`${layoutVar}.setSpacing(${gap})`);
      for (const child of node.children) {
        renderPySide6Subtree(w, child, ir, layoutVar, varMap, objNameMap, slots);
      }
    }

    attachToParent();
  });
}

export const pythonPySide6Plugin: CodegenTargetPlugin = {
  descriptor: pyside6Descriptor,
  emitSnippet(node, ir) {
    const w = new SourceMapWriter(4);
    const varMap = buildUniqueNameMap(node, 'snake', 'widget');
    const objNameMap = buildCssClassMap(node);
    renderPySide6Subtree(w, node, ir, 'parent_layout', varMap, objNameMap, new Map());
    return w.toEmittedFile(`${toSnakeCase(node.name)}_widget.py`, 'python', true);
  },
  emitComponent(comp, ir, opts) {
    const mode = opts.mode ?? 'bundle';
    const varMap = buildUniqueNameMap(comp.root, 'snake', 'widget');
    const objNameMap = buildCssClassMap(comp.root);
    const qss = buildPySide6QssFromTokens(comp.root, ir.tokens, objNameMap);
    const slots = new Map<string, string[]>();

    const winW = ir.windowChrome?.width ?? 1120;
    const winH = ir.windowChrome?.height ?? 820;
    const minW = ir.windowChrome?.minWidth ?? 680;
    const minH = ir.windowChrome?.minHeight ?? 480;

    const w = new SourceMapWriter(4);
    w.line('"""Generated Qt 6 Desktop Window — Python PySide6 + QSS Design Tokens"""');
    w.line('from __future__ import annotations');
    w.line('from PySide6.QtCore import Qt, Slot');
    w.line('from PySide6.QtWidgets import (');
    w.indent();
    w.line('QCheckBox,');
    w.line('QFrame,');
    w.line('QGridLayout,');
    w.line('QHBoxLayout,');
    w.line('QLabel,');
    w.line('QLineEdit,');
    w.line('QMainWindow,');
    w.line('QPushButton,');
    w.line('QScrollArea,');
    w.line('QVBoxLayout,');
    w.line('QWidget,');
    w.dedent();
    w.line(')');
    w.blank();
    w.line('APP_QSS_STYLESHEET = """');
    w.rawBlock(qss.trimEnd());
    w.line('"""');
    w.blank();
    w.line(`class ${comp.name}Window(QMainWindow):`);
    w.indent();
    w.line('def __init__(self) -> None:');
    w.indent();
    w.line('super().__init__()');
    w.line(`self.setWindowTitle("${escapeDoubleQuoted(ir.windowChrome?.title ?? comp.name)}")`);
    w.line(`self.resize(${winW}, ${winH})`);
    w.line(`self.setMinimumSize(${minW}, ${minH})`);
    for (const sv of comp.stateVars) {
      const pyVal =
        typeof sv.initialValue === 'string'
          ? `"${escapeDoubleQuoted(sv.initialValue)}"`
          : typeof sv.initialValue === 'boolean'
            ? sv.initialValue
              ? 'True'
              : 'False'
            : JSON.stringify(sv.initialValue ?? 0);
      w.line(`self.${toSnakeCase(sv.name)} = ${pyVal}`);
    }
    w.line('self.setStyleSheet(APP_QSS_STYLESHEET)');
    w.line('self._build_ui()');
    w.dedent();
    w.blank();
    w.line('def _build_ui(self) -> None:');
    w.indent();
    w.line('central = QWidget(self)');
    w.line('outer_layout = QVBoxLayout(central)');
    w.line('outer_layout.setContentsMargins(0, 0, 0, 0)');
    w.line('scroll = QScrollArea(central)');
    w.line('scroll.setWidgetResizable(True)');
    w.line('content_host = QWidget()');
    w.line('root_layout = QVBoxLayout(content_host)');
    w.line('root_layout.setContentsMargins(16, 16, 16, 16)');
    renderPySide6Subtree(w, comp.root, ir, 'root_layout', varMap, objNameMap, slots);
    w.line('root_layout.addStretch(1)');
    w.line('scroll.setWidget(content_host)');
    w.line('outer_layout.addWidget(scroll)');
    w.line('self.setCentralWidget(central)');
    w.dedent();

    for (const [slotName, bodyLines] of slots) {
      w.blank();
      if (slotName.endsWith('_changed')) {
        w.line('@Slot(str)');
        w.line(`def ${slotName}(self, text: str) -> None:`);
      } else {
        w.line('@Slot()');
        w.line(`def ${slotName}(self) -> None:`);
      }
      w.indent();
      for (const bl of bodyLines) w.line(bl);
      w.dedent();
    }

    const mainWriter = new SourceMapWriter(4);
    mainWriter.line('"""Application Entrypoint — Python PySide6"""');
    mainWriter.line('from __future__ import annotations');
    mainWriter.line('import sys');
    mainWriter.line('from PySide6.QtWidgets import QApplication');
    mainWriter.line(`from ui_window import ${comp.name}Window`);
    mainWriter.blank();
    mainWriter.line('def main() -> int:');
    mainWriter.indent();
    mainWriter.line('app = QApplication(sys.argv)');
    mainWriter.line(`window = ${comp.name}Window()`);
    mainWriter.line('window.show()');
    mainWriter.line('return app.exec()');
    mainWriter.dedent();
    mainWriter.blank();
    mainWriter.line('if __name__ == "__main__":');
    mainWriter.indent();
    mainWriter.line('raise SystemExit(main())');
    mainWriter.dedent();

    const files: EmittedCodeFile[] = [
      w.toEmittedFile('ui_window.py', 'python', true),
      mainWriter.toEmittedFile('main.py', 'python', false),
      {
        relativePath: 'styles.qss',
        language: 'css',
        code: qss,
        sourceMap: [],
        diagnostics: [],
      },
    ];

    return {
      targetId: 'python-pyside6',
      dialect: 'vanilla-css',
      mode,
      entryFilePath: 'ui_window.py',
      files,
      diagnostics: [],
      generatedAt: Date.now(),
    };
  },
};

// ============================================================================
// 18. RUST SLINT UI (`.slint` + `src/main.rs`) (`rust-slint`)
// ============================================================================

function renderSlintNode(w: SourceMapWriter, node: UIRNode, ir: UIRModule, callbacks: Set<string>, isRoot = false): void {
  w.withNode(node.canvasNodeId, () => {
    const fill = getPrimarySolidFill(node);
    const bgHex = resolveColorHex(fill, ir.tokens, '');
    const rad = resolveRadiusNum(node, ir.tokens);
    const pad = resolvePaddingNums(node.layout.padding, ir.tokens);
    const gap = resolveNum(node.layout.gap, ir.tokens, 0);
    const isAbs = isAbsolutePositionedNode(node, isRoot);
    const abs = getAbsoluteFrameMetrics(node);
    const posStr = isAbs ? ` x: ${abs.x}px; y: ${abs.y}px; width: ${abs.width}px; height: ${abs.height}px;` : '';

    if (node.kind === 'ThreeViewport' || node.content?.controlType === 'three-viewport') {
      const sceneId = escapeDoubleQuoted(node.content?.threeSceneId || 'default-3d-scene');
      w.line(`Rectangle {${posStr} background: #0b1120; Text { text: "3D Viewport: ${sceneId}"; color: #93c5fd; } }`);
      return;
    }

    if (node.kind === 'Button' || node.kind === 'IconButton') {
      const label = escapeDoubleQuoted(getLiteralText(node, node.name));
      const cb = toKebabCase(node.name, 'button-clicked');
      callbacks.add(cb);
      w.line(`Button {${posStr} text: "${label}"; clicked => { root.${cb}(); } }`);
      return;
    }

    if (node.kind === 'TextInput' || node.kind === 'TextArea') {
      const ph = escapeDoubleQuoted(node.content?.placeholder ?? 'Search...');
      w.line(`LineEdit {${posStr} placeholder-text: "${ph}"; }`);
      return;
    }

    if (node.kind === 'Heading' || node.kind === 'Text' || (node.children.length === 0 && getLiteralText(node))) {
      const txt = escapeDoubleQuoted(getLiteralText(node, ''));
      const fs = resolveNum(node.style.typography?.fontSize, ir.tokens, 15);
      const fw = Number(node.style.typography?.fontWeight ?? 400);
      const tc = resolveColorHex(node.style.typography?.color, ir.tokens, '#0f172a');
      w.line(`Text {${posStr} text: "${txt}"; font-size: ${fs}px; font-weight: ${fw}; color: ${tc}; wrap: word-wrap; }`);
      return;
    }

    if (isFreeformHostContainer(node)) {
      w.line('Rectangle {');
      w.indent();
      if (isAbs) {
        w.line(`x: ${abs.x}px; y: ${abs.y}px; width: ${abs.width}px; height: ${abs.height}px;`);
      } else {
        w.line(`min-height: ${Math.max(80, Math.round(node.layout.frame.height))}px;`);
      }
      if (bgHex && bgHex !== 'transparent') w.line(`background: ${bgHex};`);
      if (rad > 0) w.line(`border-radius: ${rad}px;`);
      if (node.style.base.border) {
        w.line('border-width: 1px;');
        w.line(`border-color: ${resolveColorHex(node.style.base.border.color, ir.tokens, '#e2e8f0')};`);
      }
      for (const c of node.children) renderSlintNode(w, c, ir, callbacks, false);
      w.dedent();
      w.line('}');
      return;
    }

    const layoutTag = node.layout.mode === 'ROW' || node.layout.mode === 'GRID' ? 'HorizontalLayout' : 'VerticalLayout';
    const hasVisualBox = Boolean((bgHex && bgHex !== 'transparent') || rad > 0 || node.style.base.border);

    if (hasVisualBox) {
      w.line('Rectangle {');
      w.indent();
      if (isAbs) w.line(`x: ${abs.x}px; y: ${abs.y}px; width: ${abs.width}px; height: ${abs.height}px;`);
      if (bgHex && bgHex !== 'transparent') w.line(`background: ${bgHex};`);
      if (rad > 0) w.line(`border-radius: ${rad}px;`);
      if (node.style.base.border) {
        w.line('border-width: 1px;');
        w.line(`border-color: ${resolveColorHex(node.style.base.border.color, ir.tokens, '#e2e8f0')};`);
      }
      w.line(`${layoutTag} {`);
      w.indent();
      if (gap > 0) w.line(`spacing: ${gap}px;`);
      if (pad.top || pad.left) w.line(`padding-top: ${pad.top}px; padding-bottom: ${pad.bottom}px; padding-left: ${pad.left}px; padding-right: ${pad.right}px;`);
      for (const c of node.children) renderSlintNode(w, c, ir, callbacks, false);
      w.dedent();
      w.line('}');
      w.dedent();
      w.line('}');
    } else {
      w.line(`${layoutTag} {`);
      w.indent();
      if (gap > 0) w.line(`spacing: ${gap}px;`);
      if (pad.top || pad.left) w.line(`padding: ${pad.top}px;`);
      for (const c of node.children) renderSlintNode(w, c, ir, callbacks, false);
      w.dedent();
      w.line('}');
    }
  });
}

export const rustSlintPlugin: CodegenTargetPlugin = {
  descriptor: slintDescriptor,
  emitSnippet(node, ir) {
    const w = new SourceMapWriter(4);
    renderSlintNode(w, node, ir, new Set());
    return w.toEmittedFile(`${toKebabCase(node.name)}.slint`, 'slint', true);
  },
  emitComponent(comp, ir, opts) {
    const mode = opts.mode ?? 'bundle';
    const kebab = toKebabCase(comp.name, 'app-window');
    const callbacks = new Set<string>();

    // Collect callbacks first so header declarations sit cleanly at component top
    const collectCbs = (n: UIRNode) => {
      if (n.kind === 'Button' || n.kind === 'IconButton') {
        callbacks.add(toKebabCase(n.name, 'button-clicked'));
      }
      for (const c of n.children) collectCbs(c);
    };
    collectCbs(comp.root);

    const w = new SourceMapWriter(4);
    w.line('import { Button, LineEdit, ScrollView } from "std-widgets.slint";');
    w.blank();
    w.line(`export component ${comp.name}Window inherits Window {`);
    w.indent();
    w.line(`title: "${escapeDoubleQuoted(ir.windowChrome?.title ?? comp.name)}";`);
    w.line(`preferred-width: ${ir.windowChrome?.width ?? 1120}px;`);
    w.line(`preferred-height: ${ir.windowChrome?.height ?? 820}px;`);
    for (const sv of comp.stateVars) {
      const kName = toKebabCase(sv.name);
      if (sv.type === 'number') {
        w.line(`in-out property <int> ${kName}: ${Math.round(Number(sv.initialValue ?? 0))};`);
      } else if (sv.type === 'boolean') {
        w.line(`in-out property <bool> ${kName}: ${sv.initialValue ? 'true' : 'false'};`);
      } else {
        w.line(`in-out property <string> ${kName}: "${escapeDoubleQuoted(String(sv.initialValue ?? ''))}";`);
      }
    }
    for (const cb of callbacks) {
      w.line(`callback ${cb}();`);
    }
    w.blank();
    w.line('ScrollView {');
    w.indent();
    renderSlintNode(w, comp.root, ir, callbacks, true);
    w.dedent();
    w.line('}');
    w.dedent();
    w.line('}');

    const rsWriter = new SourceMapWriter(4);
    rsWriter.line('slint::include_modules!();');
    rsWriter.blank();
    rsWriter.line('fn main() -> Result<(), slint::PlatformError> {');
    rsWriter.indent();
    rsWriter.line(`let app = ${comp.name}Window::new()?;`);
    for (const cb of callbacks) {
      const rustCb = `on_${cb.replace(/-/g, '_')}`;
      rsWriter.line(`app.${rustCb}(|| {`);
      rsWriter.indent();
      rsWriter.line(`println!("Callback invoked: ${cb}");`);
      rsWriter.dedent();
      rsWriter.line('});');
    }
    rsWriter.line('app.run()');
    rsWriter.dedent();
    rsWriter.line('}');

    const entryPath = `ui/${kebab}.slint`;
    const files: EmittedCodeFile[] = [
      w.toEmittedFile(entryPath, 'slint', true),
      rsWriter.toEmittedFile('src/main.rs', 'rust', false),
    ];

    return {
      targetId: 'rust-slint',
      dialect: 'vanilla-css',
      mode,
      entryFilePath: entryPath,
      files,
      diagnostics: [],
      generatedAt: Date.now(),
    };
  },
};
