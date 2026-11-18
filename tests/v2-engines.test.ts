import { describe, expect, it } from 'vitest';
import {
  BLUEPRINT_NODE_CATALOG,
  canConnectBlueprintPins,
  compileBlueprintToRuntimeJs,
  compileBlueprintToTs,
  computeBezierWirePath,
  createBlueprintNode,
  createStarterBlueprintGraph,
  simulateBlueprintExecution,
} from '@shared/blueprint-ir';
import { compileSheetToCss, parseCssEditsToPatchOps } from '@shared/css-sync-engine';
import { createDefaultThemes, createDefaultTokens, createStarterDemoSheet } from '@shared/default-tokens';
import {
  createStarterScriptModuleTs,
  extractScriptFunctions,
  SCRIPT_SNIPPET_TEMPLATES,
  transpileTypeScriptToJs,
} from '@shared/script-ir';
import {
  compileThreeSceneToCode,
  createThreeSceneFromPreset,
  THREE_SCENE_PRESETS,
} from '@shared/three-ir';
import { applyPatchOpsToSheet, hydrateCompactNodeToPatches } from '@shared/ui-patch';
import { buildWizardProjectSeed, WIZARD_PALETTE_PRESETS } from '@shared/wizard-templates';

describe('Visual UI Studio v2.0 — Shared Deterministic Engines', () => {
  const projectId = 'proj_v2_test';
  const sheetId = 'sheet_v2_main';
  const { darkTheme } = createDefaultThemes(projectId);
  const tokens = createDefaultTokens(projectId, darkTheme.id);

  it('preserves absolute freeform positioning when (x, y) coordinates are provided in compact/default nodes', () => {
    const ops = hydrateCompactNodeToPatches(
      {
        kind: 'control',
        controlType: 'button',
        name: 'DroppedFreeButton',
        text: 'Drop Here',
        x: 240,
        y: 168,
        width: 180,
        height: 44,
      },
      'art_home_root',
      sheetId,
    );

    const baseSheet = createStarterDemoSheet(projectId, sheetId);
    const { nextSheet, inverseOps } = applyPatchOpsToSheet(baseSheet, ops);
    const insertedId = ops[0].op === 'insert_node' ? ops[0].node.id! : '';
    const inserted = nextSheet.nodes[insertedId];

    expect(inserted).toBeDefined();
    expect(inserted.layout.positioning).toBe('absolute');
    expect(inserted.layout.frame.x).toBe(240);
    expect(inserted.layout.frame.y).toBe(168);

    const reverted = applyPatchOpsToSheet(nextSheet, inverseOps).nextSheet;
    expect(reverted.nodes[insertedId]).toBeUndefined();
  });

  it('compiles UISheetDocument <-> CSS bidirectionally with accurate SourceMaps and :hover state overrides', () => {
    const sheet = createStarterDemoSheet(projectId, sheetId);
    const compiled = compileSheetToCss(sheet, tokens, darkTheme.id);

    expect(compiled.css).toContain(':root {');
    expect(compiled.css).toContain('.create-order-button');
    expect(compiled.sourceMap.some((s) => s.canvasNodeId === 'nd_primary_cta')).toBe(true);

    const editedCss = `
      /* @node nd_primary_cta (CreateOrderButton) */
      .create-order-button {
        position: absolute;
        left: 312px;
        top: 144px;
        width: 210px;
        background: #10b981;
        border-radius: 18px;
        color: #052e16;
        z-index: 7;
      }
      .create-order-button:hover {
        background: #059669;
        opacity: 0.92;
      }
    `;

    const parsed = parseCssEditsToPatchOps(editedCss, sheet);
    expect(parsed.diagnostics).toHaveLength(0);
    expect(parsed.ops.length).toBeGreaterThan(0);

    const { nextSheet } = applyPatchOpsToSheet(sheet, parsed.ops);
    const updatedBtn = nextSheet.nodes.nd_primary_cta;
    expect(updatedBtn.layout.positioning).toBe('absolute');
    expect(updatedBtn.layout.frame.x).toBe(312);
    expect(updatedBtn.layout.frame.y).toBe(144);
    expect(updatedBtn.layout.frame.width).toBe(210);
    expect(updatedBtn.style.radius).toBe(18);
    expect(updatedBtn.style.zIndex).toBe(7);
    expect(updatedBtn.style.fills?.[0]).toEqual({ type: 'solid', color: '#10b981' });
    expect(updatedBtn.stateOverrides?.hover?.style?.opacity).toBe(0.92);
  });

  it('extracts TypeScript functions and transpiles TS -> executable JS cleanly for runtime execution', () => {
    const tsSource = [
      `export interface OrderPayload { id: string; count: number; }`,
      `export type StatusKind = 'idle' | 'ready';`,
      createStarterScriptModuleTs('TestApp'),
      SCRIPT_SNIPPET_TEMPLATES[3].tsCode,
    ].join('\n\n');

    const extracted = extractScriptFunctions(tsSource);
    expect(extracted.map((f) => f.name)).toEqual(
      expect.arrayContaining(['onPrimaryActionClick', 'refreshDashboardData', 'incrementCounter']),
    );

    const transpiled = transpileTypeScriptToJs(tsSource);
    expect(transpiled.diagnostics).toHaveLength(0);
    expect(transpiled.jsCode).not.toContain('interface OrderPayload');
    expect(transpiled.jsCode).not.toContain(': StudioRuntimeContext');

    const sandboxWin: Record<string, any> = {};
    const runner = new Function('window', transpiled.jsCode);
    runner(sandboxWin);

    const logs: string[] = [];
    const mutatedTexts: Record<string, string> = {};
    const ctx = {
      state: { counter: 41 },
      getText: () => '',
      setText: (k: string, v: string) => {
        mutatedTexts[k] = v;
      },
      getValue: () => '',
      setValue: () => {},
      setStyle: () => {},
      setVisible: () => {},
      log: (...args: unknown[]) => logs.push(args.join(' ')),
      toast: () => {},
    };

    const result = sandboxWin.__studioScriptHandlers.incrementCounter(ctx);
    expect(result).toBe(42);
    expect(mutatedTexts.OrdersValue).toBe('42');
    expect(logs.some((l) => l.includes('42'))).toBe(true);
  });

  it('models Unreal Blueprints, validates pin connections, compiles to TS/JS with SourceMaps, and simulates execution', () => {
    expect(BLUEPRINT_NODE_CATALOG.length).toBeGreaterThanOrEqual(20);
    const bezier = computeBezierWirePath(100, 120, 420, 260);
    expect(bezier.startsWith('M 100 120 C')).toBe(true);

    const ev = createBlueprintNode('event_ui_click', { x: 0, y: 0 });
    const act = createBlueprintNode('ui_set_text', { x: 300, y: 0 });
    // Exec out -> Exec in allowed; Exec out -> String in rejected
    expect(canConnectBlueprintPins(ev, ev.outputs[0], act, act.inputs[0])).toBe(true);
    expect(canConnectBlueprintPins(ev, ev.outputs[0], act, act.inputs[1])).toBe(false);

    const graph = createStarterBlueprintGraph(projectId, sheetId);
    const tsOut = compileBlueprintToTs(graph);
    expect(tsOut.code).toContain('export async function run_bp_ev_click');
    expect(tsOut.sourceMap.some((s) => s.canvasNodeId === 'bp_ui_set_text')).toBe(true);

    const runtimeJs = compileBlueprintToRuntimeJs(graph);
    expect(runtimeJs).toContain('__studioBlueprints');

    const sim = simulateBlueprintExecution(graph);
    expect(sim.finalVars.orderCount).toBe(1483);
    expect(sim.steps.some((st) => st.uiMutation?.text === '1483')).toBe(true);
  });

  it('builds all 4 Three.js 3D scene presets and compiles to Vanilla Three TS, React Three Fiber TSX, and Standalone HTML with SourceMaps', () => {
    for (const preset of THREE_SCENE_PRESETS) {
      const scene = createThreeSceneFromPreset(projectId, preset.id);
      expect(scene.objects.length).toBeGreaterThanOrEqual(4);

      const tsBundle = compileThreeSceneToCode(scene, 'three-ts');
      expect(tsBundle.code).toContain("import * as THREE from 'three';");
      expect(tsBundle.sourceMap.length).toBe(scene.objects.length);

      const r3fBundle = compileThreeSceneToCode(scene, 'r3f-tsx');
      expect(r3fBundle.code).toContain('@react-three/fiber');
      expect(r3fBundle.sourceMap.length).toBe(scene.objects.length);

      const htmlBundle = compileThreeSceneToCode(scene, 'three-html');
      expect(htmlBundle.code).toContain('<!DOCTYPE html>');
      expect(htmlBundle.sourceMap.length).toBe(scene.objects.length);
    }
  });

  it('generates complete multi-file Freeform & Auto-Layout projects via buildWizardProjectSeed', () => {
    expect(WIZARD_PALETTE_PRESETS).toHaveLength(6);

    const seed = buildWizardProjectSeed({
      name: 'Cyber 3D App',
      category: 'three_game',
      primaryTarget: 'html-vanilla',
      stylingPreset: 'vanilla-css',
      layoutMode: 'freeform',
      starterPages: ['home', 'login'],
      includeTsScript: true,
      includeBlueprint: true,
      includeThreeScene: true,
      threePresetId: 'cyberpunk-neon-grid',
      paletteId: 'cyberpunk-neon',
      defaultThemeMode: 'dark',
    });

    expect(seed.sheets).toHaveLength(2);
    expect(seed.sheets[0].defaultLayoutMode).toBe('freeform');
    const allHomeNodes = Object.values(seed.sheets[0].nodes);
    expect(allHomeNodes.some((n) => n.content?.controlType === 'three-viewport')).toBe(true);
    expect(allHomeNodes.filter((n) => n.kind !== 'artboard').every((n) => n.layout.positioning === 'absolute')).toBe(
      true,
    );

    expect(seed.blueprintDoc).toBeDefined();
    expect(seed.threeSceneDoc?.presetId).toBe('cyberpunk-neon-grid');
    expect(seed.vfsItems.some((i) => i.entryKind === 'style_file')).toBe(true);
    expect(seed.vfsItems.some((i) => i.entryKind === 'script_file')).toBe(true);
    expect(seed.vfsItems.some((i) => i.entryKind === 'blueprint_graph')).toBe(true);
    expect(seed.vfsItems.some((i) => i.entryKind === 'three_scene')).toBe(true);
  });
});
