import {
  BUILTIN_TARGET_DESCRIPTORS,
  isTokenRef,
  type CodeSourceMapSpan,
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
  escapeXmlAttr,
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
  tokenPathToCssVar,
} from '../style-helpers';

const qmlDescriptor = BUILTIN_TARGET_DESCRIPTORS.find((d) => d.id === 'cpp-qt-qml')!;
const lvglDescriptor = BUILTIN_TARGET_DESCRIPTORS.find((d) => d.id === 'lvgl-c')!;
const unityDescriptor = BUILTIN_TARGET_DESCRIPTORS.find((d) => d.id === 'unity-uitoolkit')!;

// ============================================================================
// 23. C++20 / QT 6 QUICK QML (`cpp-qt-qml` — `ui/MainScreen.qml` + `main.cpp` + `CMakeLists.txt`)
// ============================================================================

function renderQmlSubtree(
  w: SourceMapWriter,
  node: UIRNode,
  ir: UIRModule,
  idMap: ReadonlyMap<string, string>,
  isRoot = false,
): void {
  w.withNode(node.canvasNodeId, () => {
    const qmlId = idMap.get(node.canvasNodeId) ?? toCamelCase(node.name, 'item');
    const fill = getPrimarySolidFill(node);
    const bgHex = resolveColorHex(fill, ir.tokens, '');
    const rad = resolveRadiusNum(node, ir.tokens);
    const pad = resolvePaddingNums(node.layout.padding, ir.tokens);
    const gap = resolveNum(node.layout.gap, ir.tokens, 8);
    const isAbs = isAbsolutePositionedNode(node, isRoot);
    const abs = getAbsoluteFrameMetrics(node);

    const emitQmlAbsGeom = () => {
      if (!isAbs) return;
      w.line(`x: ${abs.x}`);
      w.line(`y: ${abs.y}`);
      w.line(`width: ${abs.width}`);
      w.line(`height: ${abs.height}`);
      if (abs.zIndex !== undefined) w.line(`z: ${abs.zIndex}`);
    };

    if (node.kind === 'ThreeViewport' || node.content?.controlType === 'three-viewport') {
      const sceneId = escapeDoubleQuoted(node.content?.threeSceneId || 'default-3d-scene');
      w.line('Rectangle {');
      w.indent();
      w.line(`id: ${qmlId}`);
      emitQmlAbsGeom();
      w.line('color: "#0b1120"');
      w.line(`Text { anchors.centerIn: parent; text: "3D Viewport (${sceneId})"; color: "#93c5fd" }`);
      w.dedent();
      w.line('}');
      return;
    }

    if (node.kind === 'Button' || node.kind === 'IconButton') {
      const label = escapeDoubleQuoted(getLiteralText(node, node.name));
      w.line('Button {');
      w.indent();
      w.line(`id: ${qmlId}`);
      emitQmlAbsGeom();
      w.line(`text: "${label}"`);
      if (!node.style.base.border) {
        w.line('highlighted: true');
      }
      w.line('onClicked: {');
      w.indent();
      let handled = false;
      for (const inter of node.interactions) {
        if (inter.type === 'STATE_MUTATION' && inter.expr.includes('+ 1')) {
          w.line(`root.${toCamelCase(inter.targetState)} += 1`);
          handled = true;
        } else if (inter.type === 'NATIVE_IPC_CALL') {
          w.line(`root.invokeCommand("${escapeDoubleQuoted(inter.commandName)}")`);
          if (inter.resultStateTarget) {
            w.line(`root.${toCamelCase(inter.resultStateTarget)} = "Invoked ${escapeDoubleQuoted(inter.commandName)}"`);
          }
          handled = true;
        }
      }
      if (!handled) {
        w.line(`console.log("Clicked ${escapeDoubleQuoted(qmlId)}")`);
      }
      w.dedent();
      w.line('}');
      w.dedent();
      w.line('}');
      return;
    }

    if (node.kind === 'TextInput' || node.kind === 'TextArea') {
      const ph = escapeDoubleQuoted(node.content?.placeholder ?? 'Search...');
      w.line('TextField {');
      w.indent();
      w.line(`id: ${qmlId}`);
      emitQmlAbsGeom();
      if (!isAbs) w.line('Layout.fillWidth: true');
      w.line(`placeholderText: "${ph}"`);
      if (node.mvvm?.bindings?.Text?.path) {
        const stName = toCamelCase(node.mvvm.bindings.Text.path);
        w.line(`text: root.${stName}`);
        w.line(`onTextEdited: root.${stName} = text`);
      }
      w.dedent();
      w.line('}');
      return;
    }

    if (node.kind === 'Switch' || node.kind === 'Checkbox') {
      const tag = node.kind === 'Switch' ? 'Switch' : 'CheckBox';
      w.line(`${tag} {`);
      w.indent();
      w.line(`id: ${qmlId}`);
      emitQmlAbsGeom();
      w.line(`checked: ${node.content?.checked ? 'true' : 'false'}`);
      w.dedent();
      w.line('}');
      return;
    }

    if (node.kind === 'Heading' || node.kind === 'Text' || (node.children.length === 0 && getLiteralText(node))) {
      const txt = escapeDoubleQuoted(getLiteralText(node, ''));
      const fs = resolveNum(node.style.typography?.fontSize, ir.tokens, 15);
      const isBold = Number(node.style.typography?.fontWeight ?? 400) >= 600;
      const tc = resolveColorHex(node.style.typography?.color, ir.tokens, '#0f172a');
      w.line('Text {');
      w.indent();
      w.line(`id: ${qmlId}`);
      emitQmlAbsGeom();
      w.line(`text: "${txt}"`);
      w.line(`font.pixelSize: ${fs}`);
      if (isBold) w.line('font.bold: true');
      w.line(`color: "${tc}"`);
      w.line('wrapMode: Text.WordWrap');
      if (!isAbs) w.line('Layout.fillWidth: true');
      w.dedent();
      w.line('}');
      return;
    }

    const isFreeHost = isFreeformHostContainer(node);
    const layoutTag = isFreeHost
      ? 'Item'
      : node.layout.mode === 'GRID'
        ? 'GridLayout'
        : node.layout.mode === 'ROW'
          ? 'RowLayout'
          : 'ColumnLayout';
    const hasVisualCard = !isRoot && Boolean((bgHex && bgHex !== 'transparent') || rad > 0 || node.style.base.border);

    const emitLayoutBlock = (layoutId: string, insideRect: boolean) => {
      w.line(`${layoutTag} {`);
      w.indent();
      w.line(`id: ${layoutId}`);
      if (insideRect) {
        w.line('anchors.fill: parent');
        w.line(`anchors.leftMargin: ${pad.left}`);
        w.line(`anchors.rightMargin: ${pad.right}`);
        w.line(`anchors.topMargin: ${pad.top}`);
        w.line(`anchors.bottomMargin: ${pad.bottom}`);
      } else if (isFreeHost) {
        w.line(`implicitWidth: ${Math.max(120, Math.round(node.layout.frame.width))}`);
        w.line(`implicitHeight: ${Math.max(80, Math.round(node.layout.frame.height))}`);
        emitQmlAbsGeom();
      } else {
        emitQmlAbsGeom();
        if (!isAbs) w.line('Layout.fillWidth: true');
      }
      if (layoutTag === 'GridLayout') {
        const colCount = Math.max(1, (node.layout.gridTracks?.columns ?? ['1fr']).length);
        w.line(`columns: ${colCount}`);
        w.line(`rowSpacing: ${gap}`);
        w.line(`columnSpacing: ${gap}`);
      } else if (layoutTag !== 'Item') {
        w.line(`spacing: ${gap}`);
      }
      for (const child of node.children) {
        renderQmlSubtree(w, child, ir, idMap, false);
      }
      w.dedent();
      w.line('}');
    };

    if (hasVisualCard) {
      const innerId = `${qmlId}Layout`;
      w.line('Rectangle {');
      w.indent();
      w.line(`id: ${qmlId}`);
      if (isAbs) {
        emitQmlAbsGeom();
      } else {
        w.line('Layout.fillWidth: true');
        w.line(`implicitHeight: ${isFreeHost ? Math.max(80, Math.round(node.layout.frame.height)) : `${innerId}.implicitHeight + ${pad.top + pad.bottom}`}`);
      }
      if (bgHex && bgHex !== 'transparent') w.line(`color: "${bgHex}"`);
      if (rad > 0) w.line(`radius: ${rad}`);
      if (node.style.base.border) {
        w.line('border.width: 1');
        w.line(`border.color: "${resolveColorHex(node.style.base.border.color, ir.tokens, '#e2e8f0')}"`);
      }
      emitLayoutBlock(innerId, true);
      w.dedent();
      w.line('}');
    } else {
      emitLayoutBlock(qmlId, false);
    }
  });
}

export const cppQtQmlPlugin: CodegenTargetPlugin = {
  descriptor: qmlDescriptor,
  emitSnippet(node, ir) {
    const w = new SourceMapWriter(4);
    const idMap = buildUniqueNameMap(node, 'camel', 'item');
    renderQmlSubtree(w, node, ir, idMap, false);
    return w.toEmittedFile(`ui/${toPascalCase(node.name)}.qml`, 'qml', true);
  },
  emitComponent(comp, ir, opts) {
    const mode = opts.mode ?? 'bundle';
    const idMap = buildUniqueNameMap(comp.root, 'camel', 'item');
    const winW = ir.windowChrome?.width ?? 1120;
    const winH = ir.windowChrome?.height ?? 820;
    const minW = ir.windowChrome?.minWidth ?? 680;
    const minH = ir.windowChrome?.minHeight ?? 480;
    const canvasColor = ir.tokens.colors['color.bg.canvas']?.light ?? '#f8fafc';

    // 1. `ui/MainScreen.qml` (Entry with Canvas SourceMap)
    const qmlWriter = new SourceMapWriter(4);
    qmlWriter.line('import QtQuick');
    qmlWriter.line('import QtQuick.Controls');
    qmlWriter.line('import QtQuick.Layouts');
    qmlWriter.blank();
    qmlWriter.line('ApplicationWindow {');
    qmlWriter.indent();
    qmlWriter.line('id: root');
    qmlWriter.line(`width: ${winW}`);
    qmlWriter.line(`height: ${winH}`);
    qmlWriter.line(`minimumWidth: ${minW}`);
    qmlWriter.line(`minimumHeight: ${minH}`);
    qmlWriter.line('visible: true');
    qmlWriter.line(`title: qsTr("${escapeDoubleQuoted(ir.windowChrome?.title ?? comp.name)}")`);
    qmlWriter.line(`color: "${canvasColor}"`);
    qmlWriter.blank();

    const declaredQmlProps = new Set<string>();
    for (const sv of comp.stateVars) {
      const cName = toCamelCase(sv.name);
      declaredQmlProps.add(cName);
      if (sv.type === 'number') {
        qmlWriter.line(`property int ${cName}: ${Math.round(Number(sv.initialValue ?? 0))}`);
      } else if (sv.type === 'boolean') {
        qmlWriter.line(`property bool ${cName}: ${sv.initialValue ? 'true' : 'false'}`);
      } else {
        qmlWriter.line(`property string ${cName}: "${escapeDoubleQuoted(String(sv.initialValue ?? ''))}"`);
      }
    }
    if (!declaredQmlProps.has('searchQuery')) {
      qmlWriter.line('property string searchQuery: ""');
    }
    qmlWriter.line('signal invokeCommand(string commandName)');
    qmlWriter.blank();

    qmlWriter.line('ScrollView {');
    qmlWriter.indent();
    qmlWriter.line('anchors.fill: parent');
    qmlWriter.line('contentWidth: availableWidth');
    qmlWriter.line('padding: 24');
    renderQmlSubtree(qmlWriter, comp.root, ir, idMap, true);
    qmlWriter.dedent();
    qmlWriter.line('}');
    qmlWriter.dedent();
    qmlWriter.line('}');

    // 2. `main.cpp`
    const cppWriter = new SourceMapWriter(4);
    cppWriter.line('#include <QGuiApplication>');
    cppWriter.line('#include <QQmlApplicationEngine>');
    cppWriter.line('#include <QQuickStyle>');
    cppWriter.blank();
    cppWriter.line('int main(int argc, char *argv[])');
    cppWriter.line('{');
    cppWriter.indent();
    cppWriter.line('QGuiApplication app(argc, argv);');
    cppWriter.line('QQuickStyle::setStyle("Basic");');
    cppWriter.blank();
    cppWriter.line('QQmlApplicationEngine engine;');
    cppWriter.line('QObject::connect(');
    cppWriter.indent();
    cppWriter.line('&engine,');
    cppWriter.line('&QQmlApplicationEngine::objectCreationFailed,');
    cppWriter.line('&app,');
    cppWriter.line('[]() { QCoreApplication::exit(-1); },');
    cppWriter.line('Qt::QueuedConnection');
    cppWriter.dedent();
    cppWriter.line(');');
    cppWriter.line('engine.loadFromModule("StudioApp", "MainScreen");');
    cppWriter.blank();
    cppWriter.line('return app.exec();');
    cppWriter.dedent();
    cppWriter.line('}');

    // 3. `CMakeLists.txt`
    const appTarget = `app${toPascalCase(comp.name, 'Studio')}`;
    const cmakeWriter = new SourceMapWriter(4);
    cmakeWriter.line('cmake_minimum_required(VERSION 3.21)');
    cmakeWriter.line(`project(${toPascalCase(comp.name, 'StudioApp')} VERSION 0.1.0 LANGUAGES CXX)`);
    cmakeWriter.blank();
    cmakeWriter.line('set(CMAKE_CXX_STANDARD 20)');
    cmakeWriter.line('set(CMAKE_CXX_STANDARD_REQUIRED ON)');
    cmakeWriter.blank();
    cmakeWriter.line('find_package(Qt6 6.5 REQUIRED COMPONENTS Quick QuickControls2)');
    cmakeWriter.line('qt_standard_project_setup(REQUIRES 6.5)');
    cmakeWriter.blank();
    cmakeWriter.line(`qt_add_executable(${appTarget} main.cpp)`);
    cmakeWriter.blank();
    cmakeWriter.line(`qt_add_qml_module(${appTarget}`);
    cmakeWriter.indent();
    cmakeWriter.line('URI StudioApp');
    cmakeWriter.line('VERSION 1.0');
    cmakeWriter.line('QML_FILES ui/MainScreen.qml');
    cmakeWriter.dedent();
    cmakeWriter.line(')');
    cmakeWriter.blank();
    cmakeWriter.line(`target_link_libraries(${appTarget} PRIVATE Qt6::Quick Qt6::QuickControls2)`);

    const entryPath = 'ui/MainScreen.qml';
    const files: EmittedCodeFile[] = [
      qmlWriter.toEmittedFile(entryPath, 'qml', true),
      cppWriter.toEmittedFile('main.cpp', 'cpp', false),
      cmakeWriter.toEmittedFile('CMakeLists.txt', 'cmake', false),
    ];

    return {
      targetId: 'cpp-qt-qml',
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
// 25. EMBEDDED C LVGL 9 (`lvgl-c` — `ui_screen.h` + `ui_screen.c` for ESP32/STM32)
// ============================================================================

function hexToLvglHexLiteral(hex: string, fallback = '0x0F172A'): string {
  const clean = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return `0x${clean.toUpperCase()}`;
  }
  return fallback;
}

interface LvglCallbackSpec {
  fnName: string;
  bodyLines: string[];
}

function renderLvglSubtree(
  w: SourceMapWriter,
  node: UIRNode,
  ir: UIRModule,
  parentExpr: string,
  varMap: ReadonlyMap<string, string>,
  callbacks: Map<string, LvglCallbackSpec>,
  isRoot = false,
): void {
  w.withNode(node.canvasNodeId, () => {
    const baseVar = varMap.get(node.canvasNodeId) ?? toSnakeCase(node.name, 'obj');
    const fill = getPrimarySolidFill(node);
    const bgHex = resolveColorHex(fill, ir.tokens, '');
    const rad = resolveRadiusNum(node, ir.tokens);
    const pad = resolvePaddingNums(node.layout.padding, ir.tokens);
    const gap = resolveNum(node.layout.gap, ir.tokens, 0);
    const isAbs = isAbsolutePositionedNode(node, isRoot);
    const abs = getAbsoluteFrameMetrics(node);

    const emitLvglAbsPos = (vName: string) => {
      if (!isAbs) return;
      w.line(`lv_obj_set_pos(${vName}, ${abs.x}, ${abs.y});`);
      w.line(`lv_obj_set_size(${vName}, ${abs.width}, ${abs.height});`);
    };

    if (node.kind === 'ThreeViewport' || node.content?.controlType === 'three-viewport') {
      const vpVar = `vp_${baseVar}`;
      w.line(`lv_obj_t * ${vpVar} = lv_obj_create(${parentExpr});`);
      emitLvglAbsPos(vpVar);
      return;
    }

    if (node.kind === 'Button' || node.kind === 'IconButton') {
      const btnVar = `btn_${baseVar}`;
      const lblVar = `lbl_${baseVar}`;
      const label = escapeDoubleQuoted(getLiteralText(node, node.name));
      const cbName = `on_${baseVar}_clicked`;

      const cbLines: string[] = [];
      for (const inter of node.interactions) {
        if (inter.type === 'STATE_MUTATION' && inter.expr.includes('+ 1')) {
          cbLines.push(`s_ui_state.${toSnakeCase(inter.targetState)}++;`);
        } else if (inter.type === 'NATIVE_IPC_CALL') {
          cbLines.push(`/* Dispatch embedded command: ${inter.commandName} */`);
        }
      }
      if (cbLines.length === 0) {
        cbLines.push('(void)e;');
      }
      callbacks.set(cbName, { fnName: cbName, bodyLines: cbLines });

      w.line(`lv_obj_t * ${btnVar} = lv_button_create(${parentExpr});`);
      emitLvglAbsPos(btnVar);
      if (bgHex && bgHex !== 'transparent') {
        w.line(`lv_obj_set_style_bg_color(${btnVar}, lv_color_hex(${hexToLvglHexLiteral(bgHex)}), LV_PART_MAIN);`);
      } else {
        w.line(`lv_obj_add_style(${btnVar}, &s_style_primary_btn, LV_PART_MAIN);`);
      }
      if (rad > 0) {
        w.line(`lv_obj_set_style_radius(${btnVar}, ${rad}, LV_PART_MAIN);`);
      }
      w.line(`lv_obj_add_event_cb(${btnVar}, ${cbName}, LV_EVENT_CLICKED, NULL);`);
      w.line(`lv_obj_t * ${lblVar} = lv_label_create(${btnVar});`);
      w.line(`lv_label_set_text(${lblVar}, "${label}");`);
      w.line(`lv_obj_center(${lblVar});`);
      return;
    }

    if (node.kind === 'TextInput' || node.kind === 'TextArea') {
      const taVar = `ta_${baseVar}`;
      const ph = escapeDoubleQuoted(node.content?.placeholder ?? 'Enter text...');
      w.line(`lv_obj_t * ${taVar} = lv_textarea_create(${parentExpr});`);
      if (node.kind === 'TextInput') {
        w.line(`lv_textarea_set_one_line(${taVar}, true);`);
      }
      w.line(`lv_textarea_set_placeholder_text(${taVar}, "${ph}");`);
      if (isAbs) {
        emitLvglAbsPos(taVar);
      } else {
        w.line(`lv_obj_set_width(${taVar}, LV_PCT(100));`);
      }
      return;
    }

    if (node.kind === 'Switch') {
      const swVar = `sw_${baseVar}`;
      w.line(`lv_obj_t * ${swVar} = lv_switch_create(${parentExpr});`);
      emitLvglAbsPos(swVar);
      if (node.content?.checked) w.line(`lv_obj_add_state(${swVar}, LV_STATE_CHECKED);`);
      return;
    }

    if (node.kind === 'Checkbox') {
      const cbVar = `chk_${baseVar}`;
      const label = escapeDoubleQuoted(getLiteralText(node, node.name));
      w.line(`lv_obj_t * ${cbVar} = lv_checkbox_create(${parentExpr});`);
      emitLvglAbsPos(cbVar);
      w.line(`lv_checkbox_set_text(${cbVar}, "${label}");`);
      return;
    }

    if (node.kind === 'Heading' || node.kind === 'Text' || (node.children.length === 0 && getLiteralText(node))) {
      const lblVar = `lbl_${baseVar}`;
      const txt = escapeDoubleQuoted(getLiteralText(node, ''));
      const tc = resolveColorHex(node.style.typography?.color, ir.tokens, '#0f172a');
      w.line(`lv_obj_t * ${lblVar} = lv_label_create(${parentExpr});`);
      emitLvglAbsPos(lblVar);
      w.line(`lv_label_set_text(${lblVar}, "${txt}");`);
      w.line(`lv_label_set_long_mode(${lblVar}, LV_LABEL_LONG_WRAP);`);
      w.line(`lv_obj_set_style_text_color(${lblVar}, lv_color_hex(${hexToLvglHexLiteral(tc)}), LV_PART_MAIN);`);
      return;
    }

    const objVar = isRoot ? 'scr_root' : `cont_${baseVar}`;
    w.line(`lv_obj_t * ${objVar} = lv_obj_create(${parentExpr});`);
    if (isAbs) {
      emitLvglAbsPos(objVar);
    } else if (isRoot) {
      w.line(`lv_obj_set_size(${objVar}, LV_PCT(100), LV_PCT(100));`);
    } else if (node.layout.width.mode === 'FILL') {
      w.line(`lv_obj_set_width(${objVar}, LV_PCT(100));`);
      w.line(`lv_obj_set_height(${objVar}, LV_SIZE_CONTENT);`);
    } else {
      w.line(`lv_obj_set_size(${objVar}, LV_SIZE_CONTENT, LV_SIZE_CONTENT);`);
    }

    if (!isFreeformHostContainer(node)) {
      const flexFlow =
        node.layout.mode === 'GRID'
          ? 'LV_FLEX_FLOW_ROW_WRAP'
          : node.layout.mode === 'ROW'
            ? 'LV_FLEX_FLOW_ROW'
            : 'LV_FLEX_FLOW_COLUMN';
      w.line(`lv_obj_set_flex_flow(${objVar}, ${flexFlow});`);
    }

    if (gap > 0) {
      w.line(`lv_obj_set_style_pad_row(${objVar}, ${gap}, LV_PART_MAIN);`);
      w.line(`lv_obj_set_style_pad_column(${objVar}, ${gap}, LV_PART_MAIN);`);
    }
    if (pad.top > 0 || pad.left > 0) {
      w.line(`lv_obj_set_style_pad_all(${objVar}, ${Math.max(pad.top, pad.left)}, LV_PART_MAIN);`);
    }
    if (bgHex && bgHex !== 'transparent') {
      w.line(`lv_obj_add_style(${objVar}, &s_style_card, LV_PART_MAIN);`);
      w.line(`lv_obj_set_style_bg_color(${objVar}, lv_color_hex(${hexToLvglHexLiteral(bgHex)}), LV_PART_MAIN);`);
    }
    if (rad > 0) {
      w.line(`lv_obj_set_style_radius(${objVar}, ${rad}, LV_PART_MAIN);`);
    }

    for (const child of node.children) {
      renderLvglSubtree(w, child, ir, objVar, varMap, callbacks, false);
    }
  });
}

export const lvglCPlugin: CodegenTargetPlugin = {
  descriptor: lvglDescriptor,
  emitSnippet(node, ir) {
    const w = new SourceMapWriter(4);
    const varMap = buildUniqueNameMap(node, 'snake', 'obj');
    renderLvglSubtree(w, node, ir, 'parent', varMap, new Map(), false);
    return w.toEmittedFile(`${toSnakeCase(node.name)}_lvgl.c`, 'c', true);
  },
  emitComponent(comp, ir, opts) {
    const mode = opts.mode ?? 'bundle';
    const varMap = buildUniqueNameMap(comp.root, 'snake', 'obj');
    const callbacks = new Map<string, LvglCallbackSpec>();

    // Pre-pass on a scratch writer to collect event callback names cleanly before emitting `ui_screen.c`
    const scratch = new SourceMapWriter(4);
    renderLvglSubtree(scratch, comp.root, ir, 'NULL', varMap, callbacks, true);

    const surfaceHex = hexToLvglHexLiteral(ir.tokens.colors['color.bg.surface']?.light ?? '#ffffff', '0xFFFFFF');
    const primaryHex = hexToLvglHexLiteral(ir.tokens.colors['color.primary.600']?.light ?? '#2563eb', '0x2563EB');
    const borderHex = hexToLvglHexLiteral(ir.tokens.colors['color.border.subtle']?.light ?? '#e2e8f0', '0xE2E8F0');

    // 1. `ui_screen.h`
    const hWriter = new SourceMapWriter(4);
    hWriter.line('/**');
    hWriter.line(` * Generated LVGL 9 Embedded Screen Header — ${comp.name} (ESP32 / STM32)`);
    hWriter.line(' */');
    hWriter.line('#ifndef UI_SCREEN_H');
    hWriter.line('#define UI_SCREEN_H');
    hWriter.blank();
    hWriter.line('#ifdef __cplusplus');
    hWriter.line('extern "C" {');
    hWriter.line('#endif');
    hWriter.blank();
    hWriter.line('#include <stdint.h>');
    hWriter.line('#include <stdbool.h>');
    hWriter.line('#include "lvgl.h"');
    hWriter.blank();
    hWriter.line(`#define UI_TOKEN_COLOR_SURFACE ${surfaceHex}`);
    hWriter.line(`#define UI_TOKEN_COLOR_PRIMARY ${primaryHex}`);
    hWriter.line(`#define UI_TOKEN_COLOR_BORDER  ${borderHex}`);
    hWriter.blank();
    hWriter.line('typedef struct {');
    hWriter.indent();
    if (comp.stateVars.length === 0) {
      hWriter.line('bool initialized;');
    } else {
      for (const sv of comp.stateVars) {
        const sName = toSnakeCase(sv.name);
        if (sv.type === 'number') {
          hWriter.line(`int32_t ${sName};`);
        } else if (sv.type === 'boolean') {
          hWriter.line(`bool ${sName};`);
        } else {
          hWriter.line(`const char * ${sName};`);
        }
      }
    }
    hWriter.dedent();
    hWriter.line('} ui_screen_state_t;');
    hWriter.blank();
    hWriter.line('lv_obj_t * ui_screen_create(void);');
    hWriter.blank();
    hWriter.line('#ifdef __cplusplus');
    hWriter.line('} /* extern "C" */');
    hWriter.line('#endif');
    hWriter.blank();
    hWriter.line('#endif /* UI_SCREEN_H */');

    // 2. `ui_screen.c` (Entry with Canvas SourceMap)
    const cWriter = new SourceMapWriter(4);
    cWriter.line('#include "ui_screen.h"');
    cWriter.line('#include <stddef.h>');
    cWriter.blank();
    cWriter.line('static lv_style_t s_style_card;');
    cWriter.line('static lv_style_t s_style_primary_btn;');
    cWriter.line('static bool s_styles_initialized = false;');
    cWriter.line('static ui_screen_state_t s_ui_state = {');
    cWriter.indent();
    if (comp.stateVars.length === 0) {
      cWriter.line('.initialized = true,');
    } else {
      for (const sv of comp.stateVars) {
        const sName = toSnakeCase(sv.name);
        if (sv.type === 'number') {
          cWriter.line(`.${sName} = ${Math.round(Number(sv.initialValue ?? 0))},`);
        } else if (sv.type === 'boolean') {
          cWriter.line(`.${sName} = ${sv.initialValue ? 'true' : 'false'},`);
        } else {
          cWriter.line(`.${sName} = "${escapeDoubleQuoted(String(sv.initialValue ?? ''))}",`);
        }
      }
    }
    cWriter.dedent();
    cWriter.line('};');
    cWriter.blank();

    cWriter.line('static void ui_init_styles(void)');
    cWriter.line('{');
    cWriter.indent();
    cWriter.line('if (s_styles_initialized) return;');
    cWriter.line('s_styles_initialized = true;');
    cWriter.blank();
    cWriter.line('lv_style_init(&s_style_card);');
    cWriter.line('lv_style_set_bg_color(&s_style_card, lv_color_hex(UI_TOKEN_COLOR_SURFACE));');
    cWriter.line('lv_style_set_bg_opa(&s_style_card, LV_OPA_COVER);');
    cWriter.line('lv_style_set_border_color(&s_style_card, lv_color_hex(UI_TOKEN_COLOR_BORDER));');
    cWriter.line('lv_style_set_border_width(&s_style_card, 1);');
    cWriter.line('lv_style_set_radius(&s_style_card, 10);');
    cWriter.blank();
    cWriter.line('lv_style_init(&s_style_primary_btn);');
    cWriter.line('lv_style_set_bg_color(&s_style_primary_btn, lv_color_hex(UI_TOKEN_COLOR_PRIMARY));');
    cWriter.line('lv_style_set_bg_opa(&s_style_primary_btn, LV_OPA_COVER);');
    cWriter.line('lv_style_set_text_color(&s_style_primary_btn, lv_color_hex(0xFFFFFF));');
    cWriter.line('lv_style_set_pad_hor(&s_style_primary_btn, 16);');
    cWriter.line('lv_style_set_pad_ver(&s_style_primary_btn, 8);');
    cWriter.dedent();
    cWriter.line('}');
    cWriter.blank();

    for (const cb of callbacks.values()) {
      cWriter.line(`static void ${cb.fnName}(lv_event_t * e)`);
      cWriter.line('{');
      cWriter.indent();
      cWriter.line('if (lv_event_get_code(e) != LV_EVENT_CLICKED) return;');
      for (const line of cb.bodyLines) {
        cWriter.line(line);
      }
      cWriter.dedent();
      cWriter.line('}');
      cWriter.blank();
    }

    cWriter.line('lv_obj_t * ui_screen_create(void)');
    cWriter.line('{');
    cWriter.indent();
    cWriter.line('ui_init_styles();');
    callbacks.clear();
    renderLvglSubtree(cWriter, comp.root, ir, 'NULL', varMap, callbacks, true);
    cWriter.line('return scr_root;');
    cWriter.dedent();
    cWriter.line('}');

    const entryPath = 'ui_screen.c';
    const files: EmittedCodeFile[] = [
      cWriter.toEmittedFile(entryPath, 'c', true),
      hWriter.toEmittedFile('ui_screen.h', 'c', false),
    ];

    return {
      targetId: 'lvgl-c',
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
// 26. UNITY UI TOOLKIT (`unity-uitoolkit` — `UI/ScreenView.uxml` + `UI/ScreenView.uss` + `Scripts/ScreenController.cs`)
// ============================================================================

interface UnityQueriedControl {
  elementName: string;
  fieldName: string;
  controlType: 'Button' | 'TextField' | 'Toggle';
  callbackName: string;
  actionComment?: string;
}

function renderUnityUxmlSubtree(
  w: SourceMapWriter,
  node: UIRNode,
  classMap: ReadonlyMap<string, string>,
  queriedControls: UnityQueriedControl[],
): void {
  w.withNode(node.canvasNodeId, () => {
    const cls = classMap.get(node.canvasNodeId) ?? 'visual-node';

    if (node.kind === 'Button' || node.kind === 'IconButton') {
      const label = escapeXmlAttr(getLiteralText(node, node.name));
      queriedControls.push({
        elementName: cls,
        fieldName: `_${toCamelCase(cls)}`,
        controlType: 'Button',
        callbackName: `On${toPascalCase(cls)}Clicked`,
        actionComment: node.interactions[0]?.type,
      });
      w.line(`<ui:Button name="${cls}" text="${label}" class="${cls}" />`);
      return;
    }

    if (node.kind === 'TextInput' || node.kind === 'TextArea') {
      const ph = escapeXmlAttr(node.content?.placeholder ?? '');
      const multilineAttr = node.kind === 'TextArea' ? ' multiline="true"' : '';
      queriedControls.push({
        elementName: cls,
        fieldName: `_${toCamelCase(cls)}`,
        controlType: 'TextField',
        callbackName: `On${toPascalCase(cls)}Changed`,
      });
      w.line(`<ui:TextField name="${cls}" label="" placeholder-text="${ph}"${multilineAttr} class="${cls}" />`);
      return;
    }

    if (node.kind === 'Checkbox' || node.kind === 'Switch') {
      const val = node.content?.checked ? 'true' : 'false';
      const label = escapeXmlAttr(getLiteralText(node, node.name));
      queriedControls.push({
        elementName: cls,
        fieldName: `_${toCamelCase(cls)}`,
        controlType: 'Toggle',
        callbackName: `On${toPascalCase(cls)}Toggled`,
      });
      w.line(`<ui:Toggle name="${cls}" label="${label}" value="${val}" class="${cls}" />`);
      return;
    }

    if (node.kind === 'Heading' || node.kind === 'Text' || (node.children.length === 0 && getLiteralText(node))) {
      const txt = escapeXmlAttr(getLiteralText(node, ''));
      w.line(`<ui:Label name="${cls}" text="${txt}" class="${cls}" />`);
      return;
    }

    if (node.children.length === 0) {
      w.line(`<ui:VisualElement name="${cls}" class="${cls}" />`);
      return;
    }

    w.line(`<ui:VisualElement name="${cls}" class="${cls}">`);
    w.indent();
    for (const child of node.children) {
      renderUnityUxmlSubtree(w, child, classMap, queriedControls);
    }
    w.dedent();
    w.line('</ui:VisualElement>');
  });
}

function buildUnityUssStylesheet(
  root: UIRNode,
  tokens: UIRTokenDictionary,
  classMap: ReadonlyMap<string, string>,
): { code: string; sourceMap: CodeSourceMapSpan[] } {
  const lines: string[] = [];
  const sourceMap: CodeSourceMapSpan[] = [];
  const tokenLines: string[] = [':root {'];
  for (const [path, c] of Object.entries(tokens.colors)) {
    tokenLines.push(`  ${tokenPathToCssVar(path)}: ${c.light};`);
  }
  for (const [path, sp] of Object.entries(tokens.spacing)) {
    tokenLines.push(`  ${tokenPathToCssVar(path)}: ${sp}px;`);
  }
  for (const [path, rd] of Object.entries(tokens.radii)) {
    tokenLines.push(`  ${tokenPathToCssVar(path)}: ${rd}px;`);
  }
  tokenLines.push('}');
  lines.push(...tokenLines);
  lines.push('');
  lines.push('.screen-scroll {');
  lines.push('  flex-grow: 1;');
  lines.push('}');

  const visited = new Set<string>();
  const walk = (n: UIRNode, isRoot: boolean) => {
    const cls = classMap.get(n.canvasNodeId) ?? 'visual-node';
    if (!visited.has(cls)) {
      visited.add(cls);
      const props: string[] = [];
      const isAbs = isAbsolutePositionedNode(n, isRoot);
      const isFreeHost = isFreeformHostContainer(n);
      const abs = getAbsoluteFrameMetrics(n);

      if (isAbs) {
        props.push('position: absolute;');
        props.push(`left: ${abs.x}px;`);
        props.push(`top: ${abs.y}px;`);
        props.push(`width: ${abs.width}px;`);
        props.push(`height: ${abs.height}px;`);
      } else {
        if (isFreeHost) {
          props.push('position: relative;');
          props.push(`min-height: ${Math.max(120, Math.round(n.layout.frame.height))}px;`);
        }
        if (isRoot || n.layout.width.mode === 'FILL') {
          props.push('flex-grow: 1;');
        }
      }

      if (!isFreeHost && (n.children.length > 0 || n.kind === 'Button' || n.kind === 'Card' || isRoot)) {
        const isRow = n.layout.mode === 'ROW' || n.layout.mode === 'GRID' || n.kind === 'Button';
        props.push(`flex-direction: ${isRow ? 'row' : 'column'};`);
        if (n.layout.mode === 'GRID' || n.layout.wrap) {
          props.push('flex-wrap: wrap;');
        }
        if (n.layout.alignItems) {
          const al =
            n.layout.alignItems === 'start'
              ? 'flex-start'
              : n.layout.alignItems === 'end'
                ? 'flex-end'
                : n.layout.alignItems === 'baseline'
                  ? 'center'
                  : n.layout.alignItems;
          props.push(`align-items: ${al};`);
        }
        if (n.layout.justifyContent) {
          const ju =
            n.layout.justifyContent === 'start'
              ? 'flex-start'
              : n.layout.justifyContent === 'end'
                ? 'flex-end'
                : n.layout.justifyContent === 'space-evenly'
                  ? 'space-around'
                  : n.layout.justifyContent;
          props.push(`justify-content: ${ju};`);
        }
      }

      const pad = resolvePaddingNums(n.layout.padding, tokens);
      if (pad.top > 0) props.push(`padding-top: ${pad.top}px;`);
      if (pad.right > 0) props.push(`padding-right: ${pad.right}px;`);
      if (pad.bottom > 0) props.push(`padding-bottom: ${pad.bottom}px;`);
      if (pad.left > 0) props.push(`padding-left: ${pad.left}px;`);

      const gap = resolveNum(n.layout.gap, tokens, 0);
      if (!isFreeHost && gap > 0 && n.children.length > 0) {
        props.push(`margin-bottom: ${Math.min(gap, 8)}px;`);
      }

      const fill = getPrimarySolidFill(n);
      if (fill) {
        const fillExpr = isTokenRef(fill)
          ? `var(${tokenPathToCssVar(fill.$token)})`
          : resolveColorHex(fill, tokens, '');
        if (fillExpr && fillExpr !== 'transparent') {
          props.push(`background-color: ${fillExpr};`);
        }
      }

      if (n.style.base.border && n.style.base.border.style !== 'none') {
        const bCol = isTokenRef(n.style.base.border.color)
          ? `var(${tokenPathToCssVar(n.style.base.border.color.$token)})`
          : resolveColorHex(n.style.base.border.color, tokens, '#e2e8f0');
        props.push('border-width: 1px;');
        props.push(`border-color: ${bCol};`);
      }

      const rad = resolveRadiusNum(n, tokens);
      if (rad > 0) {
        props.push(`border-radius: ${rad}px;`);
      }

      if (n.style.typography) {
        const fs = resolveNum(n.style.typography.fontSize, tokens, 15);
        props.push(`font-size: ${fs}px;`);
        const fw = Number(n.style.typography.fontWeight ?? 400);
        if (fw >= 600) {
          props.push('-unity-font-style: bold;');
        }
        const tCol = isTokenRef(n.style.typography.color)
          ? `var(${tokenPathToCssVar(n.style.typography.color.$token)})`
          : resolveColorHex(n.style.typography.color, tokens, '');
        if (tCol && tCol !== 'transparent') {
          props.push(`color: ${tCol};`);
        }
        props.push('white-space: normal;');
      }

      if (props.length > 0) {
        lines.push('');
        const startLine = lines.length + 1;
        lines.push(`.${cls} {`);
        for (const p of props) lines.push(`  ${p}`);
        lines.push('}');
        const endLine = lines.length;
        sourceMap.push({
          canvasNodeId: n.canvasNodeId,
          startLine,
          startCol: 1,
          endLine,
          endCol: 2,
        });
      }
    }

    for (const c of n.children) walk(c, false);
  };

  walk(root, true);
  return { code: lines.join('\n') + '\n', sourceMap };
}

export const unityUiToolkitPlugin: CodegenTargetPlugin = {
  descriptor: unityDescriptor,
  emitSnippet(node) {
    const classMap = buildCssClassMap(node);
    const w = new SourceMapWriter(2);
    renderUnityUxmlSubtree(w, node, classMap, []);
    return w.toEmittedFile(`UI/${toPascalCase(node.name)}.uxml`, 'xml', true);
  },
  emitComponent(comp, ir, opts) {
    const mode = opts.mode ?? 'bundle';
    const classMap = buildCssClassMap(comp.root);
    const queriedControls: UnityQueriedControl[] = [];

    // 1. `UI/ScreenView.uxml` (Entry with Canvas SourceMap)
    const uxmlWriter = new SourceMapWriter(2);
    uxmlWriter.line('<ui:UXML xmlns:ui="UnityEngine.UIElements" xmlns:uie="UnityEditor.UIElements" editor-extension-mode="False">');
    uxmlWriter.indent();
    uxmlWriter.line('<Style src="project://database/Assets/UI/ScreenView.uss" />');
    uxmlWriter.line('<ui:ScrollView name="screen-scroll" class="screen-scroll">');
    uxmlWriter.indent();
    renderUnityUxmlSubtree(uxmlWriter, comp.root, classMap, queriedControls);
    uxmlWriter.dedent();
    uxmlWriter.line('</ui:ScrollView>');
    uxmlWriter.dedent();
    uxmlWriter.line('</ui:UXML>');

    // 2. `UI/ScreenView.uss` (Flexbox/Absolute USS Stylesheet with SourceMap)
    const ussBuilt = buildUnityUssStylesheet(comp.root, ir.tokens, classMap);

    // 3. `Scripts/ScreenController.cs` (MonoBehaviour querying `UIDocument.rootVisualElement.Q<Button>(...)`)
    const csWriter = new SourceMapWriter(4);
    csWriter.line('using UnityEngine;');
    csWriter.line('using UnityEngine.UIElements;');
    csWriter.blank();
    csWriter.line('namespace StudioUI');
    csWriter.line('{');
    csWriter.indent();
    csWriter.line('[RequireComponent(typeof(UIDocument))]');
    csWriter.line('public sealed class ScreenController : MonoBehaviour');
    csWriter.line('{');
    csWriter.indent();
    csWriter.line('private UIDocument _uiDocument = null!;');

    for (const sv of comp.stateVars) {
      const fName = `_${toCamelCase(sv.name)}`;
      if (sv.type === 'number') {
        csWriter.line(`private int ${fName} = ${Math.round(Number(sv.initialValue ?? 0))};`);
      } else if (sv.type === 'boolean') {
        csWriter.line(`private bool ${fName} = ${sv.initialValue ? 'true' : 'false'};`);
      } else {
        csWriter.line(`private string ${fName} = "${escapeDoubleQuoted(String(sv.initialValue ?? ''))}";`);
      }
    }

    for (const ctrl of queriedControls) {
      csWriter.line(`private ${ctrl.controlType}? ${ctrl.fieldName};`);
    }

    csWriter.blank();
    csWriter.line('private void OnEnable()');
    csWriter.line('{');
    csWriter.indent();
    csWriter.line('_uiDocument = GetComponent<UIDocument>();');
    for (const ctrl of queriedControls) {
      csWriter.line(`${ctrl.fieldName} = _uiDocument.rootVisualElement.Q<${ctrl.controlType}>("${ctrl.elementName}");`);
      if (ctrl.controlType === 'Button') {
        csWriter.line(`if (${ctrl.fieldName} != null) ${ctrl.fieldName}.clicked += ${ctrl.callbackName};`);
      } else if (ctrl.controlType === 'TextField') {
        csWriter.line(`if (${ctrl.fieldName} != null) ${ctrl.fieldName}.RegisterValueChangedCallback(${ctrl.callbackName});`);
      } else {
        csWriter.line(`if (${ctrl.fieldName} != null) ${ctrl.fieldName}.RegisterValueChangedCallback(${ctrl.callbackName});`);
      }
    }
    csWriter.dedent();
    csWriter.line('}');

    csWriter.blank();
    csWriter.line('private void OnDisable()');
    csWriter.line('{');
    csWriter.indent();
    for (const ctrl of queriedControls) {
      if (ctrl.controlType === 'Button') {
        csWriter.line(`if (${ctrl.fieldName} != null) ${ctrl.fieldName}.clicked -= ${ctrl.callbackName};`);
      } else {
        csWriter.line(`if (${ctrl.fieldName} != null) ${ctrl.fieldName}.UnregisterValueChangedCallback(${ctrl.callbackName});`);
      }
    }
    csWriter.dedent();
    csWriter.line('}');

    for (const ctrl of queriedControls) {
      csWriter.blank();
      if (ctrl.controlType === 'Button') {
        csWriter.line(`private void ${ctrl.callbackName}()`);
        csWriter.line('{');
        csWriter.indent();
        csWriter.line(`Debug.Log("[ScreenController] Clicked ${ctrl.elementName}");`);
        csWriter.dedent();
        csWriter.line('}');
      } else if (ctrl.controlType === 'TextField') {
        csWriter.line(`private void ${ctrl.callbackName}(ChangeEvent<string> evt)`);
        csWriter.line('{');
        csWriter.indent();
        csWriter.line(`Debug.Log($"[ScreenController] ${ctrl.elementName} = {evt.newValue}");`);
        csWriter.dedent();
        csWriter.line('}');
      } else {
        csWriter.line(`private void ${ctrl.callbackName}(ChangeEvent<bool> evt)`);
        csWriter.line('{');
        csWriter.indent();
        csWriter.line(`Debug.Log($"[ScreenController] ${ctrl.elementName} = {evt.newValue}");`);
        csWriter.dedent();
        csWriter.line('}');
      }
    }

    csWriter.dedent();
    csWriter.line('}');
    csWriter.dedent();
    csWriter.line('}');

    const entryPath = 'UI/ScreenView.uxml';
    const files: EmittedCodeFile[] = [
      uxmlWriter.toEmittedFile(entryPath, 'xml', true),
      {
        relativePath: 'UI/ScreenView.uss',
        language: 'css',
        code: ussBuilt.code,
        sourceMap: ussBuilt.sourceMap,
        diagnostics: [],
      },
      csWriter.toEmittedFile('Scripts/ScreenController.cs', 'csharp', false),
    ];

    return {
      targetId: 'unity-uitoolkit',
      dialect: 'vanilla-css',
      mode,
      entryFilePath: entryPath,
      files,
      diagnostics: [],
      generatedAt: Date.now(),
    };
  },
};
