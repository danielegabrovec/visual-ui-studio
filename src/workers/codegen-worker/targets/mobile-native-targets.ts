import {
  BUILTIN_TARGET_DESCRIPTORS,
  type CodegenTargetPlugin,
  type EmittedCodeFile,
  type StylingDialect,
  type UIRModule,
  type UIRNode,
  type UIRTokenDictionary,
} from '@shared/ui-ir';
import { SourceMapWriter } from '../code-writer';
import {
  buildTailwindClasses,
  buildUniqueNameMap,
  escapeDoubleQuoted,
  getAbsoluteFrameMetrics,
  getLiteralText,
  getPrimarySolidFill,
  isAbsolutePositionedNode,
  isFreeformHostContainer,
  resolveColorHex,
  resolveNum,
  resolvePaddingNums,
  resolveRadiusNum,
  toCamelCase,
  toPascalCase,
  toSnakeCase,
} from '../style-helpers';
import {
  analyzeReactSubtreeUsage,
  countUsedReactStateHooks,
  emitCleanReactStateHooks,
  emitReactBlueprintHelper,
  emitReactScriptImports,
  sanitizeHandlerIdent,
} from './web-targets';

const rnDescriptor = BUILTIN_TARGET_DESCRIPTORS.find((d) => d.id === 'react-native')!;
const flutterDescriptor = BUILTIN_TARGET_DESCRIPTORS.find((d) => d.id === 'flutter-dart')!;
const swiftuiDescriptor = BUILTIN_TARGET_DESCRIPTORS.find((d) => d.id === 'swiftui')!;
const composeDescriptor = BUILTIN_TARGET_DESCRIPTORS.find((d) => d.id === 'jetpack-compose')!;

function hexToFlutterColor(hex: string, fallback = '0x00000000'): string {
  const clean = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(clean)) return `Color(0xFF${clean.toUpperCase()})`;
  if (/^[0-9a-fA-F]{8}$/.test(clean)) return `Color(0x${clean.toUpperCase()})`;
  return `Color(${fallback})`;
}

function hexToComposeColor(hex: string, fallback = '0x00000000'): string {
  const clean = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(clean)) return `Color(0xFF${clean.toUpperCase()})`;
  return `Color(${fallback})`;
}

function hexToSwiftColor(hex: string): string {
  const clean = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return 'Color.clear';
  const r = (parseInt(clean.slice(0, 2), 16) / 255).toFixed(3);
  const g = (parseInt(clean.slice(2, 4), 16) / 255).toFixed(3);
  const b = (parseInt(clean.slice(4, 6), 16) / 255).toFixed(3);
  return `Color(red: ${r}, green: ${g}, blue: ${b})`;
}

// ============================================================================
// 7. REACT NATIVE / EXPO (`react-native` — StyleSheet.create + NativeWind v4)
// ============================================================================

function collectRnStyleEntries(
  root: UIRNode,
  tokens: UIRTokenDictionary,
  styleKeyMap: ReadonlyMap<string, string>,
): Map<string, string[]> {
  const styles = new Map<string, string[]>();
  const walk = (n: UIRNode, isRoot: boolean) => {
    const styleKey = styleKeyMap.get(n.canvasNodeId) ?? toCamelCase(n.name || n.kind, 'box');
    const lines: string[] = [];
    const isAbs = isAbsolutePositionedNode(n, isRoot);
    const isFreeHost = isFreeformHostContainer(n);
    const abs = getAbsoluteFrameMetrics(n);

    if (isAbs) {
      lines.push("position: 'absolute',");
      lines.push(`left: ${abs.x},`);
      lines.push(`top: ${abs.y},`);
      lines.push(`width: ${abs.width},`);
      lines.push(`height: ${abs.height},`);
      if (abs.zIndex !== undefined) lines.push(`zIndex: ${abs.zIndex},`);
    } else if (isRoot) {
      lines.push('flex: 1,');
      if (isFreeHost) {
        lines.push("position: 'relative',");
        lines.push(`minHeight: ${Math.max(400, Math.round(n.layout.frame.height))},`);
      }
    } else if (n.layout.width.mode === 'FILL') {
      lines.push('flex: 1,');
    } else if (isFreeHost) {
      lines.push("position: 'relative',");
      lines.push(`minHeight: ${Math.max(80, Math.round(n.layout.frame.height))},`);
    }

    if (!isFreeHost && (n.children.length > 0 || n.kind === 'Button')) {
      lines.push(`flexDirection: '${n.layout.mode === 'ROW' || n.layout.mode === 'GRID' || n.kind === 'Button' ? 'row' : 'column'}',`);
      if (n.layout.mode === 'GRID' || n.layout.wrap) {
        lines.push("flexWrap: 'wrap',");
      }
      if (n.layout.alignItems) {
        const alignMap: Record<string, string> = {
          start: 'flex-start',
          center: 'center',
          end: 'flex-end',
          stretch: 'stretch',
          baseline: 'baseline',
        };
        lines.push(`alignItems: '${n.kind === 'Button' ? 'center' : alignMap[n.layout.alignItems] ?? 'stretch'}',`);
      }
      if (n.layout.justifyContent) {
        const jMap: Record<string, string> = {
          start: 'flex-start',
          center: 'center',
          end: 'flex-end',
          'space-between': 'space-between',
          'space-around': 'space-around',
          'space-evenly': 'space-evenly',
        };
        lines.push(`justifyContent: '${n.kind === 'Button' ? 'center' : jMap[n.layout.justifyContent] ?? 'flex-start'}',`);
      }
    }

    const gap = resolveNum(n.layout.gap, tokens, 0);
    if (gap > 0 && n.children.length > 0) lines.push(`gap: ${gap},`);

    const pad = resolvePaddingNums(n.layout.padding, tokens);
    if (pad.top > 0) lines.push(`paddingTop: ${pad.top},`);
    if (pad.right > 0) lines.push(`paddingRight: ${pad.right},`);
    if (pad.bottom > 0) lines.push(`paddingBottom: ${pad.bottom},`);
    if (pad.left > 0) lines.push(`paddingLeft: ${pad.left},`);

    const fill = getPrimarySolidFill(n);
    const bgHex = resolveColorHex(fill, tokens, '');
    if (bgHex && bgHex !== 'transparent') {
      lines.push(`backgroundColor: '${bgHex}',`);
    }

    if (n.style.base.border && n.style.base.border.style !== 'none') {
      lines.push('borderWidth: 1,');
      lines.push(`borderColor: '${resolveColorHex(n.style.base.border.color, tokens, '#e2e8f0')}',`);
    }

    const rad = resolveRadiusNum(n, tokens);
    if (rad > 0) lines.push(`borderRadius: ${rad},`);

    if (n.style.typography && (n.kind === 'Text' || n.kind === 'Heading' || n.kind === 'Button' || n.kind === 'TextInput')) {
      const fs = resolveNum(n.style.typography.fontSize, tokens, 15);
      const fw = String(n.style.typography.fontWeight ?? '400');
      const tc = resolveColorHex(n.style.typography.color, tokens, '#0f172a');
      lines.push(`fontSize: ${fs},`);
      lines.push(`fontWeight: '${fw}',`);
      lines.push(`color: '${tc}',`);
    }

    styles.set(styleKey, lines);
    for (const c of n.children) walk(c, false);
  };
  walk(root, true);
  return styles;
}

function getRnStyleKey(node: UIRNode, styleKeyMap: ReadonlyMap<string, string>): string {
  return styleKeyMap.get(node.canvasNodeId) ?? toCamelCase(node.name || node.kind, 'box');
}

function renderRnNode(
  w: SourceMapWriter,
  node: UIRNode,
  ir: UIRModule,
  dialect: StylingDialect,
  styleKeyMap: ReadonlyMap<string, string>,
  controlledInputs: ReadonlyMap<string, string>,
  isRoot: boolean,
): void {
  w.withNode(node.canvasNodeId, () => {
    const styleProp =
      dialect === 'tailwind'
        ? `className="${buildTailwindClasses(node, ir.tokens, isRoot)}"`
        : `style={styles.${getRnStyleKey(node, styleKeyMap)}}`;

    if (node.kind === 'ThreeViewport' || node.content?.controlType === 'three-viewport') {
      const sceneId = escapeDoubleQuoted(node.content?.threeSceneId || 'default-3d-scene');
      w.line(`<View ${styleProp} accessibilityLabel="Three.js 3D Viewport">`);
      w.indent();
      w.line(`<Text style={{ color: '#93c5fd', fontSize: 12 }}>3D Scene: ${sceneId}</Text>`);
      w.dedent();
      w.line('</View>');
      return;
    }

    if (node.kind === 'Button' || node.kind === 'IconButton') {
      const label = getLiteralText(node, node.name);
      const pressStmts: string[] = [];
      for (const inter of node.interactions) {
        if (inter.type === 'STATE_MUTATION') {
          const setter = `set${toPascalCase(inter.targetState)}`;
          pressStmts.push(inter.expr.includes('+ 1') ? `${setter}((v) => v + 1)` : `${setter}(${inter.expr})`);
        } else if (inter.type === 'NATIVE_IPC_CALL') {
          pressStmts.push(`handle${toPascalCase(inter.commandName)}()`);
        } else if (inter.type === 'SCRIPT_CALL') {
          pressStmts.push(`${sanitizeHandlerIdent(inter.fnName)}()`);
        } else if (inter.type === 'BLUEPRINT_EVENT') {
          pressStmts.push(
            `triggerBlueprint('${inter.blueprintId.replace(/'/g, "\\'")}', '${inter.eventName.replace(/'/g, "\\'")}')`,
          );
        }
      }
      const onPress =
        pressStmts.length === 0
          ? '() => {}'
          : pressStmts.length === 1
            ? `() => ${pressStmts[0]}`
            : `() => { ${pressStmts.map((s) => `${s};`).join(' ')} }`;
      w.line(`<Pressable ${styleProp} onPress={${onPress}} accessibilityRole="button">`);
      w.indent();
      const textColor = resolveColorHex(node.style.typography?.color, ir.tokens, '#ffffff');
      w.line(`<Text style={{ color: '${textColor}', fontWeight: '600' }}>${label}</Text>`);
      w.dedent();
      w.line('</Pressable>');
      return;
    }

    if (node.kind === 'TextInput' || node.kind === 'TextArea') {
      const ph = node.content?.placeholder ? ` placeholder="${escapeDoubleQuoted(node.content.placeholder)}"` : '';
      const boundState = controlledInputs.get(node.canvasNodeId);
      const bindAttrs = boundState ? ` value={${boundState}} onChangeText={set${toPascalCase(boundState)}}` : '';
      w.line(`<TextInput ${styleProp}${ph}${bindAttrs} placeholderTextColor="#94a3b8" />`);
      return;
    }

    if (node.kind === 'Heading' || node.kind === 'Text' || (node.children.length === 0 && getLiteralText(node))) {
      w.line(`<Text ${styleProp}>${getLiteralText(node, '')}</Text>`);
      return;
    }

    const containerTag = isRoot ? 'ScrollView' : 'View';
    const rootAttr = isRoot && dialect !== 'tailwind' ? `contentContainerStyle={styles.${getRnStyleKey(node, styleKeyMap)}}` : styleProp;
    w.line(`<${containerTag} ${rootAttr}>`);
    w.indent();
    for (const c of node.children) {
      renderRnNode(w, c, ir, dialect, styleKeyMap, controlledInputs, false);
    }
    w.dedent();
    w.line(`</${containerTag}>`);
  });
}

export const reactNativePlugin: CodegenTargetPlugin = {
  descriptor: rnDescriptor,
  emitSnippet(node, ir, opts) {
    const dialect: StylingDialect = opts.dialect === 'tailwind' ? 'tailwind' : 'vanilla-css';
    const isJs = opts.scriptLanguage === 'javascript';
    const ext = isJs ? 'jsx' : 'tsx';
    const styleKeyMap = buildUniqueNameMap(node, 'camel', 'box');
    const w = new SourceMapWriter(2);
    renderRnNode(w, node, ir, dialect, styleKeyMap, new Map(), false);
    return w.toEmittedFile(`${toPascalCase(node.name)}.native.${ext}`, isJs ? 'javascript' : 'tsx', true);
  },
  emitComponent(comp, ir, opts) {
    const dialect: StylingDialect = opts.dialect === 'tailwind' ? 'tailwind' : 'vanilla-css';
    const mode = opts.mode ?? 'component';
    const isJs = opts.scriptLanguage === 'javascript';
    const ext = isJs ? 'jsx' : 'tsx';
    const filePath = `app/${comp.name}Screen.${ext}`;
    const styleKeyMap = buildUniqueNameMap(comp.root, 'camel', 'box');
    const usage = analyzeReactSubtreeUsage(comp.root, comp, { enableControlledInputs: true });
    const needsUseState = countUsedReactStateHooks(comp.stateVars, usage) > 0;
    const w = new SourceMapWriter(2);

    w.line(`import React${needsUseState ? ', { useState }' : ''} from 'react';`);
    w.line(
      `import { SafeAreaView, ScrollView, View, Text, TextInput, Pressable${dialect === 'vanilla-css' ? ', StyleSheet' : ''} } from 'react-native';`,
    );
    emitReactScriptImports(w, usage, '../scripts/handlers', {
      root: comp.root,
      ir,
      fromFilePath: filePath,
    });
    w.blank();
    w.line(`export function ${comp.name}Screen() {`);
    w.indent();
    emitCleanReactStateHooks(w, comp.stateVars, usage, !isJs);
    emitReactBlueprintHelper(w, usage, !isJs);
    for (const ipc of comp.ipcCommands) {
      const ipcUse = usage.usedIpcCommands.get(ipc.name);
      if (!ipcUse) continue;
      if (ipcUse.resultStateTarget) {
        w.line(
          `const handle${toPascalCase(ipc.name)} = () => set${toPascalCase(ipcUse.resultStateTarget)}('Completed: ${ipc.name}');`,
        );
      } else {
        w.line(`const handle${toPascalCase(ipc.name)} = () => console.info('${ipc.name}');`);
      }
    }
    w.line('return (');
    w.indent();
    w.line('<SafeAreaView style={{ flex: 1 }}>');
    w.indent();
    renderRnNode(w, comp.root, ir, dialect, styleKeyMap, usage.controlledInputStateByNode, true);
    w.dedent();
    w.line('</SafeAreaView>');
    w.dedent();
    w.line(');');
    w.dedent();
    w.line('}');

    if (dialect === 'vanilla-css') {
      const styleMap = collectRnStyleEntries(comp.root, ir.tokens, styleKeyMap);
      w.blank();
      w.line('const styles = StyleSheet.create({');
      w.indent();
      for (const [key, propLines] of styleMap) {
        w.line(`${key}: {`);
        w.indent();
        for (const pl of propLines) w.line(pl);
        w.dedent();
        w.line('},');
      }
      w.dedent();
      w.line('});');
    }

    w.blank();
    w.line(`export default ${comp.name}Screen;`);

    return {
      targetId: 'react-native',
      dialect,
      mode,
      entryFilePath: filePath,
      files: [w.toEmittedFile(filePath, isJs ? 'javascript' : 'tsx', true)],
      diagnostics: [],
      generatedAt: Date.now(),
    };
  },
};

// ============================================================================
// 12. FLUTTER / DART 3 (`flutter-dart`)
// ============================================================================

function renderFlutterWidget(w: SourceMapWriter, node: UIRNode, ir: UIRModule, wrapPositioned = false): void {
  w.withNode(node.canvasNodeId, () => {
    const emitInner = () => {
      const fill = getPrimarySolidFill(node);
      const bgHex = resolveColorHex(fill, ir.tokens, '');
      const rad = resolveRadiusNum(node, ir.tokens);
      const pad = resolvePaddingNums(node.layout.padding, ir.tokens);
      const gap = resolveNum(node.layout.gap, ir.tokens, 0);

      if (node.kind === 'ThreeViewport' || node.content?.controlType === 'three-viewport') {
        const sceneId = escapeDoubleQuoted(node.content?.threeSceneId || 'default-3d-scene');
        w.line(`Container(key: const ValueKey("${sceneId}"), child: const Center(child: Text("3D Viewport: ${sceneId}"))),`);
        return;
      }

      if (node.kind === 'Button' || node.kind === 'IconButton') {
        const label = escapeDoubleQuoted(getLiteralText(node, node.name));
        const isOutline = Boolean(node.style.base.border);
        const btnType = isOutline ? 'OutlinedButton' : 'FilledButton';
        let callback = '() {}';
        for (const inter of node.interactions) {
          if (inter.type === 'STATE_MUTATION' && inter.expr.includes('+ 1')) {
            callback = `() => setState(() => _${toCamelCase(inter.targetState)}++)`;
          }
        }
        w.line(`${btnType}(`);
        w.indent();
        w.line(`onPressed: ${callback},`);
        w.line(`child: const Text("${label}"),`);
        w.dedent();
        w.line('),');
        return;
      }

      if (node.kind === 'TextInput' || node.kind === 'TextArea') {
        const hint = escapeDoubleQuoted(node.content?.placeholder ?? 'Enter text...');
        w.line('TextField(');
        w.indent();
        w.line('decoration: InputDecoration(');
        w.indent();
        w.line(`hintText: "${hint}",`);
        w.line('border: const OutlineInputBorder(),');
        w.line('isDense: true,');
        w.dedent();
        w.line('),');
        w.dedent();
        w.line('),');
        return;
      }

      if (node.kind === 'Heading' || node.kind === 'Text' || (node.children.length === 0 && getLiteralText(node))) {
        const txt = escapeDoubleQuoted(getLiteralText(node, ''));
        const fs = resolveNum(node.style.typography?.fontSize, ir.tokens, 15);
        const fw = Number(node.style.typography?.fontWeight ?? 400) >= 600 ? 'FontWeight.bold' : 'FontWeight.normal';
        const tc = resolveColorHex(node.style.typography?.color, ir.tokens, '#0f172a');
        w.line(`Text("${txt}", style: const TextStyle(fontSize: ${fs}, fontWeight: ${fw}, color: ${hexToFlutterColor(tc)})),`);
        return;
      }

      // Container / Stack (Freeform) / Row / Column / Wrap
      const isFreeHost = isFreeformHostContainer(node);
      w.line('Container(');
      w.indent();
      if (isFreeHost) {
        w.line(`width: ${Math.max(120, Math.round(node.layout.frame.width))},`);
        w.line(`height: ${Math.max(80, Math.round(node.layout.frame.height))},`);
      }
      if (pad.top || pad.right || pad.bottom || pad.left) {
        w.line(`padding: const EdgeInsets.fromLTRB(${pad.left}, ${pad.top}, ${pad.right}, ${pad.bottom}),`);
      }
      if ((bgHex && bgHex !== 'transparent') || rad > 0 || node.style.base.border) {
        w.line('decoration: BoxDecoration(');
        w.indent();
        if (bgHex && bgHex !== 'transparent') {
          w.line(`color: const ${hexToFlutterColor(bgHex)},`);
        }
        if (rad > 0) {
          w.line(`borderRadius: BorderRadius.circular(${rad}),`);
        }
        if (node.style.base.border) {
          const bCol = resolveColorHex(node.style.base.border.color, ir.tokens, '#e2e8f0');
          w.line(`border: Border.all(color: const ${hexToFlutterColor(bCol)}),`);
        }
        w.dedent();
        w.line('),');
      }

      if (isFreeHost) {
        w.line('child: Stack(children: [');
        w.indent();
        for (const child of node.children) {
          renderFlutterWidget(w, child, ir, isAbsolutePositionedNode(child, false));
        }
        w.dedent();
        w.line(']),');
      } else {
        const isHorizontal = node.layout.mode === 'ROW' || node.layout.mode === 'GRID';
        if (node.layout.mode === 'GRID') {
          w.line(`child: Wrap(spacing: ${gap || 12}, runSpacing: ${gap || 12}, children: [`);
        } else if (isHorizontal) {
          const mainAlign =
            node.layout.justifyContent === 'space-between' ? 'MainAxisAlignment.spaceBetween' : 'MainAxisAlignment.start';
          w.line(`child: Row(mainAxisAlignment: ${mainAlign}, spacing: ${gap}, children: [`);
        } else {
          w.line(`child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, spacing: ${gap}, children: [`);
        }
        w.indent();
        for (const child of node.children) {
          if (isHorizontal && node.layout.mode !== 'GRID' && child.layout.width.mode === 'FILL') {
            w.line('Expanded(child: ');
            w.indent();
            renderFlutterWidget(w, child, ir, false);
            w.dedent();
            w.line('),');
          } else {
            renderFlutterWidget(w, child, ir, false);
          }
        }
        w.dedent();
        w.line(']),');
      }
      w.dedent();
      w.line('),');
    };

    if (wrapPositioned) {
      const m = getAbsoluteFrameMetrics(node);
      w.line(`Positioned(left: ${m.x}, top: ${m.y}, width: ${m.width}, height: ${m.height}, child: `);
      w.indent();
      emitInner();
      w.dedent();
      w.line('),');
    } else {
      emitInner();
    }
  });
}

export const flutterDartPlugin: CodegenTargetPlugin = {
  descriptor: flutterDescriptor,
  emitSnippet(node, ir) {
    const w = new SourceMapWriter(2);
    renderFlutterWidget(w, node, ir, isAbsolutePositionedNode(node, false));
    return w.toEmittedFile(`${toSnakeCase(node.name)}.dart`, 'dart', true);
  },
  emitComponent(comp, ir, opts) {
    const mode = opts.mode ?? 'bundle';
    const snake = toSnakeCase(comp.name, 'home_screen');
    const w = new SourceMapWriter(2);

    w.line("import 'package:flutter/material.dart';");
    w.blank();
    w.line(`class ${comp.name}Screen extends StatefulWidget {`);
    w.indent();
    w.line(`const ${comp.name}Screen({super.key});`);
    w.blank();
    w.line('@override');
    w.line(`State<${comp.name}Screen> createState() => _${comp.name}ScreenState();`);
    w.dedent();
    w.line('}');
    w.blank();
    w.line(`class _${comp.name}ScreenState extends State<${comp.name}Screen> {`);
    w.indent();
    for (const sv of comp.stateVars) {
      const cName = `_${toCamelCase(sv.name)}`;
      if (sv.type === 'number') {
        w.line(`int ${cName} = ${Math.round(Number(sv.initialValue ?? 0))};`);
      } else if (sv.type === 'boolean') {
        w.line(`bool ${cName} = ${sv.initialValue ? 'true' : 'false'};`);
      } else {
        w.line(`String ${cName} = "${escapeDoubleQuoted(String(sv.initialValue ?? ''))}";`);
      }
    }
    w.blank();
    w.line('@override');
    w.line('Widget build(BuildContext context) {');
    w.indent();
    w.line('return Scaffold(');
    w.indent();
    w.line('body: SafeArea(');
    w.indent();
    w.line('child: SingleChildScrollView(');
    w.indent();
    w.line('child: ');
    renderFlutterWidget(w, comp.root, ir);
    w.dedent();
    w.line('),');
    w.dedent();
    w.line('),');
    w.dedent();
    w.line(');');
    w.dedent();
    w.line('}');
    w.dedent();
    w.line('}');

    const themeWriter = new SourceMapWriter(2);
    themeWriter.line("import 'package:flutter/material.dart';");
    themeWriter.blank();
    const primaryLight = ir.tokens.colors['color.primary.600']?.light ?? '#2563eb';
    const primaryDark = ir.tokens.colors['color.primary.600']?.dark ?? '#3b82f6';
    themeWriter.line('class AppDesignTokens {');
    themeWriter.indent();
    themeWriter.line(
      `static ThemeData lightTheme = ThemeData(useMaterial3: true, colorSchemeSeed: const ${hexToFlutterColor(primaryLight)});`,
    );
    themeWriter.line(
      `static ThemeData darkTheme = ThemeData(useMaterial3: true, brightness: Brightness.dark, colorSchemeSeed: const ${hexToFlutterColor(primaryDark)});`,
    );
    themeWriter.dedent();
    themeWriter.line('}');

    const entryPath = `lib/screens/${snake}.dart`;
    const files: EmittedCodeFile[] = [
      w.toEmittedFile(entryPath, 'dart', true),
      themeWriter.toEmittedFile('lib/theme/app_tokens.dart', 'dart', false),
    ];

    return {
      targetId: 'flutter-dart',
      dialect: 'vanilla-css',
      mode,
      entryFilePath: entryPath,
      files,
      diagnostics: [],
      generatedAt: Date.now(),
    };
  },
};

// ============================================================================
// 13. SWIFTUI (SWIFT 6 — iOS / macOS / visionOS) (`swiftui`)
// ============================================================================

function renderSwiftUiNode(w: SourceMapWriter, node: UIRNode, ir: UIRModule, isRoot = false): void {
  w.withNode(node.canvasNodeId, () => {
    const fill = getPrimarySolidFill(node);
    const bgHex = resolveColorHex(fill, ir.tokens, '');
    const rad = resolveRadiusNum(node, ir.tokens);
    const pad = resolvePaddingNums(node.layout.padding, ir.tokens);
    const gap = resolveNum(node.layout.gap, ir.tokens, 0);
    const isAbs = isAbsolutePositionedNode(node, isRoot);
    const abs = getAbsoluteFrameMetrics(node);

    const emitAbsoluteModifiers = () => {
      if (!isAbs) return;
      w.line(`.frame(width: ${abs.width}, height: ${abs.height})`);
      w.line(`.offset(x: ${abs.x}, y: ${abs.y})`);
      if (abs.zIndex !== undefined) w.line(`.zIndex(${abs.zIndex})`);
    };

    if (node.kind === 'ThreeViewport' || node.content?.controlType === 'three-viewport') {
      const sceneId = escapeDoubleQuoted(node.content?.threeSceneId || 'default-3d-scene');
      w.line(`ZStack { Text("3D Viewport: ${sceneId}") }`);
      emitAbsoluteModifiers();
      return;
    }

    if (node.kind === 'Button' || node.kind === 'IconButton') {
      const label = escapeDoubleQuoted(getLiteralText(node, node.name));
      let actionBody = '// Trigger action';
      for (const inter of node.interactions) {
        if (inter.type === 'STATE_MUTATION' && inter.expr.includes('+ 1')) {
          actionBody = `${toCamelCase(inter.targetState)} += 1`;
        }
      }
      w.line(`Button("${label}") {`);
      w.indent();
      w.line(actionBody);
      w.dedent();
      w.line('}');
      w.line(node.style.base.border ? '.buttonStyle(.bordered)' : '.buttonStyle(.borderedProminent)');
      emitAbsoluteModifiers();
      return;
    }

    if (node.kind === 'TextInput' || node.kind === 'TextArea') {
      const ph = escapeDoubleQuoted(node.content?.placeholder ?? 'Search...');
      w.line(`TextField("${ph}", text: $searchQuery)`);
      w.indent();
      w.line('.textFieldStyle(.roundedBorder)');
      w.dedent();
      emitAbsoluteModifiers();
      return;
    }

    if (node.kind === 'Heading' || node.kind === 'Text' || (node.children.length === 0 && getLiteralText(node))) {
      const txt = escapeDoubleQuoted(getLiteralText(node, ''));
      const fs = resolveNum(node.style.typography?.fontSize, ir.tokens, 15);
      const fw = Number(node.style.typography?.fontWeight ?? 400) >= 600 ? '.bold' : '.regular';
      const tc = resolveColorHex(node.style.typography?.color, ir.tokens, '#0f172a');
      w.line(`Text("${txt}")`);
      w.indent();
      w.line(`.font(.system(size: ${fs}, weight: ${fw}))`);
      w.line(`.foregroundStyle(${hexToSwiftColor(tc)})`);
      w.dedent();
      emitAbsoluteModifiers();
      return;
    }

    const isFreeHost = isFreeformHostContainer(node);
    if (isFreeHost) {
      w.line('ZStack(alignment: .topLeading) {');
      w.indent();
      for (const c of node.children) renderSwiftUiNode(w, c, ir, false);
      w.dedent();
      w.line('}');
      w.line(`.frame(width: ${Math.max(120, Math.round(node.layout.frame.width))}, height: ${Math.max(80, Math.round(node.layout.frame.height))}, alignment: .topLeading)`);
    } else if (node.layout.mode === 'GRID') {
      const colCount = Math.max(1, (node.layout.gridTracks?.columns ?? ['1fr']).length);
      const gridItems = Array.from({ length: colCount }, () => 'GridItem(.flexible())').join(', ');
      w.line(`LazyVGrid(columns: [${gridItems}], spacing: ${gap || 12}) {`);
      w.indent();
      for (const c of node.children) renderSwiftUiNode(w, c, ir, false);
      w.dedent();
      w.line('}');
    } else if (node.layout.mode === 'ROW') {
      w.line(`HStack(alignment: .center, spacing: ${gap}) {`);
      w.indent();
      node.children.forEach((c, idx) => {
        renderSwiftUiNode(w, c, ir, false);
        if (node.layout.justifyContent === 'space-between' && idx === 0 && node.children.length > 1) {
          w.line('Spacer()');
        }
      });
      w.dedent();
      w.line('}');
    } else if (node.layout.mode === 'STACK') {
      w.line('ZStack {');
      w.indent();
      for (const c of node.children) renderSwiftUiNode(w, c, ir, false);
      w.dedent();
      w.line('}');
    } else {
      w.line(`VStack(alignment: .leading, spacing: ${gap}) {`);
      w.indent();
      for (const c of node.children) renderSwiftUiNode(w, c, ir, false);
      w.dedent();
      w.line('}');
    }

    if (pad.top || pad.right || pad.bottom || pad.left) {
      w.line(`.padding(EdgeInsets(top: ${pad.top}, leading: ${pad.left}, bottom: ${pad.bottom}, trailing: ${pad.right}))`);
    }
    if (!isFreeHost && node.layout.width.mode === 'FILL') {
      w.line('.frame(maxWidth: .infinity, alignment: .leading)');
    }
    if (bgHex && bgHex !== 'transparent') {
      w.line(`.background(${hexToSwiftColor(bgHex)})`);
    }
    if (rad > 0) {
      w.line(`.clipShape(RoundedRectangle(cornerRadius: ${rad}, style: .continuous))`);
    }
    emitAbsoluteModifiers();
  });
}

export const swiftUiPlugin: CodegenTargetPlugin = {
  descriptor: swiftuiDescriptor,
  emitSnippet(node, ir) {
    const w = new SourceMapWriter(4);
    renderSwiftUiNode(w, node, ir, false);
    return w.toEmittedFile(`${toPascalCase(node.name)}View.swift`, 'swift', true);
  },
  emitComponent(comp, ir, opts) {
    const mode = opts.mode ?? 'component';
    const w = new SourceMapWriter(4);

    w.line('import SwiftUI');
    w.blank();
    w.line(`public struct ${comp.name}View: View {`);
    w.indent();
    let hasSearchQuery = false;
    for (const sv of comp.stateVars) {
      const cName = toCamelCase(sv.name);
      if (cName === 'searchQuery') hasSearchQuery = true;
      if (sv.type === 'number') {
        w.line(`@State private var ${cName}: Int = ${Math.round(Number(sv.initialValue ?? 0))}`);
      } else if (sv.type === 'boolean') {
        w.line(`@State private var ${cName}: Bool = ${sv.initialValue ? 'true' : 'false'}`);
      } else {
        w.line(`@State private var ${cName}: String = "${escapeDoubleQuoted(String(sv.initialValue ?? ''))}"`);
      }
    }
    if (!hasSearchQuery) {
      w.line('@State private var searchQuery: String = ""');
    }
    w.blank();
    w.line(`public init() {}`);
    w.blank();
    w.line('public var body: some View {');
    w.indent();
    w.line('ScrollView {');
    w.indent();
    renderSwiftUiNode(w, comp.root, ir, true);
    w.dedent();
    w.line('}');
    w.dedent();
    w.line('}');
    w.dedent();
    w.line('}');
    w.blank();
    w.line('#Preview {');
    w.indent();
    w.line(`${comp.name}View()`);
    w.dedent();
    w.line('}');

    const filePath = `Sources/Views/${comp.name}View.swift`;
    return {
      targetId: 'swiftui',
      dialect: 'vanilla-css',
      mode,
      entryFilePath: filePath,
      files: [w.toEmittedFile(filePath, 'swift', true)],
      diagnostics: [],
      generatedAt: Date.now(),
    };
  },
};

// ============================================================================
// 14. JETPACK COMPOSE / COMPOSE MULTIPLATFORM (KOTLIN 2.x) (`jetpack-compose`)
// ============================================================================

function renderComposeNode(w: SourceMapWriter, node: UIRNode, ir: UIRModule, isRoot = false): void {
  w.withNode(node.canvasNodeId, () => {
    const fill = getPrimarySolidFill(node);
    const bgHex = resolveColorHex(fill, ir.tokens, '');
    const rad = resolveRadiusNum(node, ir.tokens);
    const pad = resolvePaddingNums(node.layout.padding, ir.tokens);
    const gap = resolveNum(node.layout.gap, ir.tokens, 0);
    const isAbs = isAbsolutePositionedNode(node, isRoot);
    const abs = getAbsoluteFrameMetrics(node);
    const posMod = isAbs ? `.offset(x = ${abs.x}.dp, y = ${abs.y}.dp).size(width = ${abs.width}.dp, height = ${abs.height}.dp)` : '';

    if (node.kind === 'ThreeViewport' || node.content?.controlType === 'three-viewport') {
      const sceneId = escapeDoubleQuoted(node.content?.threeSceneId || 'default-3d-scene');
      w.line(`Box(modifier = Modifier${posMod}) { Text("3D Viewport: ${sceneId}") }`);
      return;
    }

    if (node.kind === 'Button' || node.kind === 'IconButton') {
      const label = escapeDoubleQuoted(getLiteralText(node, node.name));
      const fn = node.style.base.border ? 'OutlinedButton' : 'Button';
      let onClick = '{}';
      for (const inter of node.interactions) {
        if (inter.type === 'STATE_MUTATION' && inter.expr.includes('+ 1')) {
          onClick = `{ ${toCamelCase(inter.targetState)}++ }`;
        }
      }
      const btnMod = posMod ? `, modifier = Modifier${posMod}` : '';
      w.line(`${fn}(onClick = ${onClick}${btnMod}) {`);
      w.indent();
      w.line(`Text("${label}")`);
      w.dedent();
      w.line('}');
      return;
    }

    if (node.kind === 'TextInput' || node.kind === 'TextArea') {
      const ph = escapeDoubleQuoted(node.content?.placeholder ?? 'Search...');
      w.line('OutlinedTextField(');
      w.indent();
      w.line('value = searchQuery,');
      w.line('onValueChange = { searchQuery = it },');
      w.line(`placeholder = { Text("${ph}") },`);
      w.line(`modifier = Modifier.${isAbs ? posMod.slice(1) : 'fillMaxWidth()'},`);
      w.dedent();
      w.line(')');
      return;
    }

    if (node.kind === 'Heading' || node.kind === 'Text' || (node.children.length === 0 && getLiteralText(node))) {
      const txt = escapeDoubleQuoted(getLiteralText(node, ''));
      const fs = resolveNum(node.style.typography?.fontSize, ir.tokens, 15);
      const fw = Number(node.style.typography?.fontWeight ?? 400) >= 600 ? 'FontWeight.Bold' : 'FontWeight.Normal';
      const tc = resolveColorHex(node.style.typography?.color, ir.tokens, '#0f172a');
      const txtMod = posMod ? `, modifier = Modifier${posMod}` : '';
      w.line(`Text(text = "${txt}", fontSize = ${fs}.sp, fontWeight = ${fw}, color = ${hexToComposeColor(tc)}${txtMod})`);
      return;
    }

    const modChain: string[] = ['Modifier'];
    if (isAbs) {
      modChain.push(`offset(x = ${abs.x}.dp, y = ${abs.y}.dp)`, `size(width = ${abs.width}.dp, height = ${abs.height}.dp)`);
    } else if (node.layout.width.mode === 'FILL') {
      modChain.push('fillMaxWidth()');
    }
    if (isFreeformHostContainer(node) && !isAbs) {
      modChain.push(`height(${Math.max(120, Math.round(node.layout.frame.height))}.dp)`);
    }
    if (rad > 0) modChain.push(`clip(RoundedCornerShape(${rad}.dp))`);
    if (bgHex && bgHex !== 'transparent') modChain.push(`background(${hexToComposeColor(bgHex)})`);
    if (pad.top || pad.right || pad.bottom || pad.left) {
      modChain.push(`padding(start = ${pad.left}.dp, top = ${pad.top}.dp, end = ${pad.right}.dp, bottom = ${pad.bottom}.dp)`);
    }
    const modExpr = modChain.join('.');

    if (isFreeformHostContainer(node)) {
      w.line(`Box(modifier = ${modExpr}) {`);
      w.indent();
      for (const c of node.children) renderComposeNode(w, c, ir, false);
      w.dedent();
      w.line('}');
      return;
    }

    const isHoriz = node.layout.mode === 'ROW' || node.layout.mode === 'GRID';
    if (isHoriz) {
      const arr =
        node.layout.justifyContent === 'space-between'
          ? 'Arrangement.SpaceBetween'
          : `Arrangement.spacedBy(${gap || 12}.dp)`;
      w.line(`Row(modifier = ${modExpr}, horizontalArrangement = ${arr}, verticalAlignment = Alignment.CenterVertically) {`);
      w.indent();
      for (const c of node.children) renderComposeNode(w, c, ir, false);
      w.dedent();
      w.line('}');
    } else {
      w.line(`Column(modifier = ${modExpr}, verticalArrangement = Arrangement.spacedBy(${gap}.dp)) {`);
      w.indent();
      for (const c of node.children) renderComposeNode(w, c, ir, false);
      w.dedent();
      w.line('}');
    }
  });
}

export const jetpackComposePlugin: CodegenTargetPlugin = {
  descriptor: composeDescriptor,
  emitSnippet(node, ir) {
    const w = new SourceMapWriter(4);
    renderComposeNode(w, node, ir);
    return w.toEmittedFile(`${toPascalCase(node.name)}.kt`, 'kotlin', true);
  },
  emitComponent(comp, ir, opts) {
    const mode = opts.mode ?? 'component';
    const w = new SourceMapWriter(4);

    w.line('package com.studio.ui');
    w.blank();
    w.line('import androidx.compose.foundation.background');
    w.line('import androidx.compose.foundation.layout.*');
    w.line('import androidx.compose.foundation.rememberScrollState');
    w.line('import androidx.compose.foundation.shape.RoundedCornerShape');
    w.line('import androidx.compose.foundation.verticalScroll');
    w.line('import androidx.compose.material3.*');
    w.line('import androidx.compose.runtime.*');
    w.line('import androidx.compose.ui.Alignment');
    w.line('import androidx.compose.ui.Modifier');
    w.line('import androidx.compose.ui.draw.clip');
    w.line('import androidx.compose.ui.graphics.Color');
    w.line('import androidx.compose.ui.text.font.FontWeight');
    w.line('import androidx.compose.ui.unit.dp');
    w.line('import androidx.compose.ui.unit.sp');
    w.blank();
    w.line('@Composable');
    w.line(`fun ${comp.name}Screen(modifier: Modifier = Modifier) {`);
    w.indent();
    let hasSearch = false;
    for (const sv of comp.stateVars) {
      const cName = toCamelCase(sv.name);
      if (cName === 'searchQuery') hasSearch = true;
      const init =
        sv.type === 'number'
          ? String(Math.round(Number(sv.initialValue ?? 0)))
          : sv.type === 'boolean'
            ? String(Boolean(sv.initialValue))
            : `"${escapeDoubleQuoted(String(sv.initialValue ?? ''))}"`;
      w.line(`var ${cName} by remember { mutableStateOf(${init}) }`);
    }
    if (!hasSearch) {
      w.line('var searchQuery by remember { mutableStateOf("") }');
    }
    w.line('Column(modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState())) {');
    w.indent();
    renderComposeNode(w, comp.root, ir);
    w.dedent();
    w.line('}');
    w.dedent();
    w.line('}');

    const filePath = `ui/${comp.name}Screen.kt`;
    return {
      targetId: 'jetpack-compose',
      dialect: 'vanilla-css',
      mode,
      entryFilePath: filePath,
      files: [w.toEmittedFile(filePath, 'kotlin', true)],
      diagnostics: [],
      generatedAt: Date.now(),
    };
  },
};
