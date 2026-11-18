import { describe, expect, it } from 'vitest';
import {
  BLUEPRINT_CATEGORY_THEME,
  BLUEPRINT_NODE_CATALOG,
  canConnectBlueprintPins,
  compileBlueprintToRuntimeJs,
  compileBlueprintToTs,
  computeBezierWirePath,
  createBlueprintNode,
  createStarterBlueprintGraph,
  simulateBlueprintExecution,
  type BlueprintGraphDocument,
} from '@shared/blueprint-ir';
import { createDefaultThemes, createDefaultTokens, createStarterDemoSheet } from '@shared/default-tokens';
import {
  SCRIPT_SNIPPET_TEMPLATES,
  createStarterScriptModuleTs,
  extractScriptFunctions,
  matchDomBindingsToSheetNodes,
  parseExternalScriptModule,
  transpileTypeScriptToJs,
  type StudioRuntimeContext,
} from '@shared/script-ir';
import { createThreeSceneFromPreset } from '@shared/three-ir';
import { applyPatchOpsToSheet } from '@shared/ui-patch';
import {
  buildSandboxPreviewHtml,
  sanitizeBlueprintRuntimeJs,
} from '@renderer/utils/sandbox-html-builder';

describe('Blueprint Visual Scripting, TypeScript Workbench & Interactive Sandbox Builder', () => {
  const projectId = 'proj_bp_test';
  const sheetId = 'sheet_bp_main';
  const { darkTheme } = createDefaultThemes(projectId);
  const tokens = createDefaultTokens(projectId, darkTheme.id);

  it('exposes all 5 Unreal Blueprint categories, 24 node templates, Bezier geometry, and pin type rules', () => {
    expect(Object.keys(BLUEPRINT_CATEGORY_THEME)).toEqual([
      'event',
      'flow',
      'ui_action',
      'math_logic',
      'async_3d',
    ]);
    expect(BLUEPRINT_NODE_CATALOG.length).toBe(24);

    const path = computeBezierWirePath(100, 120, 420, 260);
    expect(path).toMatch(/^M 100 120 C \d+ 120, \d+ 260, 420 260$/);

    const evClick = createBlueprintNode('event_ui_click', { x: 40, y: 80 });
    const mathNode = createBlueprintNode('math_op', { x: 280, y: 200 });
    const setText = createBlueprintNode('ui_set_text', { x: 560, y: 80 });

    // Exec -> Exec allowed; Exec -> Data forbidden
    expect(canConnectBlueprintPins(evClick, evClick.outputs[0], setText, setText.inputs[0])).toBe(true);
    expect(canConnectBlueprintPins(evClick, evClick.outputs[0], setText, setText.inputs[1])).toBe(false);

    // Self-connection forbidden
    expect(canConnectBlueprintPins(setText, setText.outputs[0], setText, setText.inputs[0])).toBe(false);

    // Number -> String coercion allowed; String -> Number forbidden
    expect(canConnectBlueprintPins(mathNode, mathNode.outputs[0], setText, setText.inputs[1])).toBe(true);
    expect(canConnectBlueprintPins(evClick, evClick.outputs[1], mathNode, mathNode.inputs[0])).toBe(false);
  });

  it('compiles Blueprint graphs with Branch, Compare, UI & Three.js nodes to TypeScript + executable Runtime JS', async () => {
    const evBegin = createBlueprintNode('event_begin_play', { x: 40, y: 80 }, { id: 'ev_start' });
    const cmp = createBlueprintNode('logic_compare', { x: 40, y: 240 }, { id: 'cmp_gt', config: { op: '>' } });
    cmp.inputs[0].defaultValue = 25;
    cmp.inputs[1].defaultValue = 10;

    const branch = createBlueprintNode('flow_branch', { x: 320, y: 80 }, { id: 'br_main' });
    const uiTextTrue = createBlueprintNode('ui_set_text', { x: 640, y: 40 }, {
      id: 'ui_ok',
      targetUiNodeId: 'nd_kpi_ord_value',
      config: { targetName: 'OrdersValue' },
    });
    uiTextTrue.inputs[1].defaultValue = ' Soglia Superata! ';

    const threeSpin = createBlueprintNode('three_transform', { x: 940, y: 40 }, {
      id: 'three_rot',
      config: { meshName: 'HeroMesh' },
    });
    threeSpin.inputs[1].defaultValue = 90;
    threeSpin.inputs[2].defaultValue = '#10b981';

    const graph: BlueprintGraphDocument = {
      id: 'bp_custom_branch',
      projectId,
      name: 'BranchAnd3DFlow',
      sheetId,
      viewport: { x: 0, y: 0, zoom: 1 },
      variables: [{ id: 'v1', name: 'threshold', type: 'number', initialValue: 10 }],
      nodes: [evBegin, cmp, branch, uiTextTrue, threeSpin],
      wires: [
        {
          id: 'w1',
          fromNodeId: evBegin.id,
          fromPinId: evBegin.outputs[0].id,
          toNodeId: branch.id,
          toPinId: branch.inputs[0].id,
          isExec: true,
        },
        {
          id: 'w2',
          fromNodeId: cmp.id,
          fromPinId: cmp.outputs[0].id,
          toNodeId: branch.id,
          toPinId: branch.inputs[1].id,
          isExec: false,
        },
        {
          id: 'w3',
          fromNodeId: branch.id,
          fromPinId: branch.outputs[0].id, // True branch
          toNodeId: uiTextTrue.id,
          toPinId: uiTextTrue.inputs[0].id,
          isExec: true,
        },
        {
          id: 'w4',
          fromNodeId: uiTextTrue.id,
          fromPinId: uiTextTrue.outputs[0].id,
          toNodeId: threeSpin.id,
          toPinId: threeSpin.inputs[0].id,
          isExec: true,
        },
      ],
      updatedAt: Date.now(),
    };

    const tsOut = compileBlueprintToTs(graph);
    expect(tsOut.diagnostics).toHaveLength(0);
    expect(tsOut.code).toContain('if ((25 > 10)) {');
    expect(tsOut.code).toContain('ctx.setText("nd_kpi_ord_value"');
    expect(tsOut.code).toContain('ctx.three?.rotate("HeroMesh", 0, Number(90), 0);');
    expect(tsOut.sourceMap.some((s) => s.canvasNodeId === 'ui_ok')).toBe(true);

    // Step-by-step simulation verification
    const sim = simulateBlueprintExecution(graph);
    expect(sim.steps.map((s) => s.nodeId)).toEqual(['ev_start', 'br_main', 'ui_ok', 'three_rot']);
    expect(sim.steps[2].wireIds).toContain('w3');
    expect(sim.steps[2].uiMutation?.text).toBe(' Soglia Superata! ');

    // Execute sanitized Runtime JS in an isolated window mock
    const runtimeJs = sanitizeBlueprintRuntimeJs(compileBlueprintToRuntimeJs(graph));
    const mockWin: Record<string, any> = {};
    const runner = new Function('window', runtimeJs);
    runner(mockWin);

    const reg = mockWin.__studioBlueprints['bp_custom_branch'];
    expect(reg).toBeDefined();
    expect(reg.events).toHaveLength(1);

    const mutatedTexts: Record<string, string> = {};
    const threeCalls: string[] = [];
    const ctx: StudioRuntimeContext = {
      state: { ...reg.initialState },
      getText: (k) => mutatedTexts[k] ?? '',
      setText: (k, v) => {
        mutatedTexts[k] = v;
      },
      getValue: () => '',
      setValue: () => {},
      setStyle: () => {},
      setVisible: () => {},
      log: () => {},
      toast: () => {},
      three: {
        rotate: (m, _x, y) => threeCalls.push(`rot:${m}:${y}`),
        setColor: (m, c) => threeCalls.push(`col:${m}:${c}`),
      },
    };

    await reg.events[0].run(ctx, {});
    expect(mutatedTexts['nd_kpi_ord_value']).toBe(' Soglia Superata! ');
    expect(threeCalls).toEqual(['rot:HeroMesh:90', 'col:HeroMesh:#10b981']);
  });

  it('extracts functions, transpiles TypeScript to valid JS, and executes all 6 ready templates cleanly', async () => {
    const complexTs = `
      export interface OrderItem {
        id: string;
        qty: number;
      }
      export type OrderStatus = 'pending' | 'paid';

      // Gestisce invio ordine
      export async function submitOrder<T>(ctx: StudioRuntimeContext, mode: OrderStatus = 'paid'): Promise<string> {
        const count: number = Number(ctx.state.orders ?? 10) + 1;
        ctx.state.orders = count;
        const tag = ('ORD-' + count) as OrderStatus;
        ctx.setText('OrderBadge', tag + ':' + mode);
        return tag;
      }

      export const resetOrders = (ctx: StudioRuntimeContext): void => {
        ctx.state.orders = 0;
      };
    `;

    const fns = extractScriptFunctions(complexTs);
    expect(fns.map((f) => f.name)).toEqual(['submitOrder', 'resetOrders']);
    expect(fns[0].isAsync).toBe(true);
    expect(fns[0].isExported).toBe(true);
    expect(fns[0].description).toBe('Gestisce invio ordine');

    const transpiled = transpileTypeScriptToJs(complexTs);
    expect(transpiled.diagnostics).toEqual([]);
    expect(transpiled.exportedFunctions).toEqual(['submitOrder', 'resetOrders']);

    const mockWin: Record<string, any> = {};
    new Function('window', transpiled.jsCode)(mockWin);

    const texts: Record<string, string> = { EmailInput: 'arch@studio.dev', SearchInput: 'OLED' };
    const ctx: StudioRuntimeContext = {
      state: { orders: 41 },
      getText: (k) => texts[k] ?? '',
      setText: (k, v) => {
        texts[k] = v;
      },
      getValue: (k) => texts[k] ?? '',
      setValue: (k, v) => {
        texts[k] = v;
      },
      setStyle: () => {},
      setVisible: () => {},
      log: () => {},
      toast: () => {},
      three: { rotate: () => {}, setColor: () => {} },
    };

    const res = await mockWin.__studioScriptHandlers.submitOrder(ctx);
    expect(res).toBe('ORD-42');
    expect(texts.OrderBadge).toBe('ORD-42:paid');

    mockWin.__studioScriptHandlers.resetOrders(ctx);
    expect(ctx.state.orders).toBe(0);

    // Every built-in snippet template must transpile with 0 syntax diagnostics and execute without throwing
    expect(SCRIPT_SNIPPET_TEMPLATES).toHaveLength(6);
    for (const tpl of SCRIPT_SNIPPET_TEMPLATES) {
      const out = transpileTypeScriptToJs(tpl.tsCode);
      expect(out.diagnostics).toEqual([]);
      const w: Record<string, any> = {};
      new Function('window', out.jsCode)(w);
      const fnName = out.exportedFunctions[0];
      expect(typeof w.__studioScriptHandlers[fnName]).toBe('function');
      await Promise.resolve(w.__studioScriptHandlers[fnName](ctx));
    }
  });

  it('reads external TS/JS bindings and Python routes without changing their source', () => {
    const sheet = createStarterDemoSheet(projectId, sheetId);
    const src = [
      'import { invoke } from "@tauri-apps/api/core";',
      '/** Refreshes the dashboard. */',
      'export async function refresh(',
      '  mode: string = "brief",',
      ') {',
      '  await fetch("/api/items", { method: "GET" });',
      '  await invoke("refresh_items", { mode });',
      '}',
      'const button = document.getElementById("node-nd_primary_cta");',
      'button.addEventListener("click", refresh);',
    ].join('\n');
    const parsed = parseExternalScriptModule(src, 'src/scripts/external.ts');
    expect(parsed.functions).toContainEqual(expect.objectContaining({
      name: 'refresh', isAsync: true, isExported: true,
    }));
    expect(parsed.externalCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'fetch', endpointOrCommand: '/api/items' }),
      expect.objectContaining({ kind: 'tauri_invoke', endpointOrCommand: 'refresh_items' }),
    ]));
    expect(matchDomBindingsToSheetNodes(parsed, sheet, 'external-file').matches).toContainEqual(
      expect.objectContaining({ nodeId: 'nd_primary_cta', trigger: 'onClick', fnName: 'refresh' }),
    );
    const python = parseExternalScriptModule(
      '@app.get("/items")\nasync def items(\n    limit: int = 12,\n):\n    return []\n',
      'backend/routes.py',
    );
    expect(python.functions).toContainEqual(expect.objectContaining({ name: 'items', isAsync: true }));
    expect(python.language).toBe('python');
  });

  it('builds Sandbox HTML with Bug 2e absolute positioning fix, valid embedded JS syntax, injected TS scripts, Blueprint runtime, and 3D viewports', () => {
    const baseSheet = createStarterDemoSheet(projectId, sheetId);

    // Insert 1) an absolute-positioned button inside a flex container (Bug 2e scenario!)
    // and 2) a freeform container with a child + 3D viewport
    const { nextSheet } = applyPatchOpsToSheet(baseSheet, [
      {
        op: 'insert_node',
        parentId: 'art_home_root',
        node: {
          id: 'nd_abs_floating_btn',
          kind: 'control',
          name: 'FloatingActionBtn',
          semanticTag: 'button',
          layout: {
            mode: 'freeform',
            positioning: 'absolute',
            frame: { x: 315, y: 188, width: 190, height: 46 },
            width: { mode: 'fixed', value: 190 },
            height: { mode: 'fixed', value: 46 },
            padding: { top: 8, right: 14, bottom: 8, left: 14 },
          },
          style: {
            fills: [{ type: 'solid', color: '#2563eb' }],
            radius: 10,
            zIndex: 9,
          },
          content: {
            controlType: 'button',
            text: 'Esegui Azione TS',
          },
          interactions: [
            {
              trigger: 'onClick',
              action: { kind: 'call_script_fn', fnName: 'onPrimaryActionClick' },
            },
          ],
        },
      },
      {
        op: 'insert_node',
        parentId: 'art_home_root',
        node: {
          id: 'nd_freeform_stage',
          kind: 'container',
          name: 'FreeformStageBox',
          semanticTag: 'section',
          layout: {
            mode: 'freeform',
            positioning: 'flow',
            frame: { x: 0, y: 0, width: 600, height: 320 },
            width: { mode: 'fixed', value: 600 },
            height: { mode: 'fixed', value: 320 },
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
          },
          style: { fills: [{ type: 'solid', color: '#0f172a' }] },
        },
      },
      {
        op: 'insert_node',
        parentId: 'nd_freeform_stage',
        node: {
          id: 'nd_child_in_freeform',
          kind: 'control',
          name: 'ThreeCanvasCard',
          semanticTag: 'div',
          layout: {
            mode: 'freeform',
            positioning: 'flow', // parentMode === 'freeform' must still force position:absolute!
            frame: { x: 48, y: 36, width: 320, height: 220 },
            width: { mode: 'fixed', value: 320 },
            height: { mode: 'fixed', value: 220 },
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
          },
          style: { zIndex: 4 },
          content: {
            controlType: 'three-viewport',
            text: 'Showcase 3D',
            threeSceneId: 'scene_demo_1',
          },
        },
      },
    ]);

    const starterBp = createStarterBlueprintGraph(projectId, sheetId, 'nd_primary_cta', 'nd_kpi_ord_value');
    const starterTs = createStarterScriptModuleTs('NovaCommerce');
    const starter3d = createThreeSceneFromPreset(projectId, 'pbr-product-showcase');

    const html = buildSandboxPreviewHtml(nextSheet, tokens, darkTheme.id, {
      scriptFiles: [{ id: 'vfs_ts_1', name: 'handlers.ts', content: starterTs }],
      blueprintGraphs: [starterBp],
      threeScenes: [starter3d],
    });

    // Bug 2e checks: both positioning==='absolute' inside flex parent AND child inside freeform parent get position:absolute + left + top + z-index
    expect(html).toContain('id="node-nd_abs_floating_btn"');
    expect(html).toMatch(/\{ position: absolute; left: 315px; top: 188px; [^}]*z-index: 9;/);
    expect(html).toContain('id="node-nd_child_in_freeform"');
    expect(html).toMatch(/\{ position: absolute; left: 48px; top: 36px; [^}]*z-index: 4;/);

    // Script & Blueprint & 3D data attributes + injected runtimes
    expect(html).toContain('data-script-click="onPrimaryActionClick"');
    expect(html).toContain(`data-bp-event="${starterBp.id}::bp_ev_click"`);
    expect(html).toContain('data-three-scene="scene_demo_1"');
    expect(html).toContain('window.__studioScriptHandlers');
    expect(html).toContain('window.__studioBlueprints');

    // Verify the entire embedded <script> block inside Sandbox HTML parses cleanly as valid JavaScript!
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(scriptMatch).toBeTruthy();
    expect(() => new Function('window', 'document', 'requestAnimationFrame', scriptMatch![1])).not.toThrow();
  });

  it('faithfully renders Freeform dark custom & gradient artboards with position:relative, min-height, fill background, and light foreground (Fix C)', () => {
    const { lightTheme } = createDefaultThemes(projectId);
    const baseSheet = createStarterDemoSheet(projectId, sheetId);

    // Mutate root artboard to Freeform mode with explicit dark #0b1120 fill and 860px height
    const { nextSheet: darkFreeformSheet } = applyPatchOpsToSheet(baseSheet, [
      {
        op: 'update_node',
        id: 'art_home_root',
        layout: {
          mode: 'freeform',
          positioning: 'flow',
          frame: { x: 40, y: 40, width: 1200, height: 860 },
          width: { mode: 'fixed', value: 1200 },
          height: { mode: 'hug' },
        },
        style: {
          fills: [{ type: 'solid', color: '#0b1120' }],
        },
      },
    ]);
    darkFreeformSheet.defaultLayoutMode = 'freeform';

    // Even when activeThemeId is null OR lightTheme.id, the explicit #0b1120 artboard must stay dark with #f8fafc foreground!
    const htmlWithNullTheme = buildSandboxPreviewHtml(darkFreeformSheet, tokens, null);
    expect(htmlWithNullTheme).toContain('position: relative;');
    expect(htmlWithNullTheme).toContain('min-height: 860px;');
    expect(htmlWithNullTheme).toContain('background: #0b1120;');
    expect(htmlWithNullTheme).toContain('color: #f8fafc;');
    expect(htmlWithNullTheme).not.toContain('background: #f8fafc; color: #0f172a;');

    const htmlWithLightTheme = buildSandboxPreviewHtml(darkFreeformSheet, tokens, lightTheme.id);
    expect(htmlWithLightTheme).toContain('background: #0b1120;');
    expect(htmlWithLightTheme).toContain('color: #f8fafc;');
    expect(htmlWithLightTheme).toContain('min-height: 860px;');

    // Gradient artboard verification
    const { nextSheet: gradSheet } = applyPatchOpsToSheet(darkFreeformSheet, [
      {
        op: 'update_node',
        id: 'art_home_root',
        style: {
          fills: [
            {
              type: 'linear-gradient',
              angle: 135,
              stops: [
                { pos: 0, color: '#090d16' },
                { pos: 1, color: '#1e293b' },
              ],
            },
          ],
        },
      },
    ]);
    const gradHtml = buildSandboxPreviewHtml(gradSheet, tokens, null);
    expect(gradHtml).toContain('background: linear-gradient(135deg, #090d16 0%, #1e293b 100%);');
    expect(gradHtml).toContain('color: #f8fafc;');
  });
});
