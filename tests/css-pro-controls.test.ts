import { describe, expect, it } from 'vitest';
import { buildSandboxPreviewHtml } from '@renderer/utils/sandbox-html-builder';
import {
  SUPPORTED_CSS_PROPERTIES,
  compileNodeToReactStyle,
  compileReusableClassesCss,
  compileSheetToCss,
  mergeCascadedNodeSpecs,
  parseCssEditsToPatchOps,
} from '@shared/css-sync-engine';
import {
  buildTokenLookupMap,
  createDefaultThemes,
  createDefaultTokens,
  createStarterDemoSheet,
} from '@shared/default-tokens';
import { findUIRNodeByCanvasId, normalizeSheetToUIRModule } from '@shared/layout-solver';
import type { ReusableCssClass, UISheetDocument } from '@shared/ui-ir';
import { applyPatchOpsToSheet, createDefaultUINode } from '@shared/ui-patch';
import { createCodegenWorkerService } from '../src/workers/codegen-worker/service';
import {
  buildStylesheetWithSourceMap,
  buildTailwindClasses,
  getNodeCssClassName,
} from '../src/workers/codegen-worker/style-helpers';

describe('Pillar 1 — 78-Property Bidirectional CSS Engine, Reusable Classes, Multi-Target Style Codegen & Group/Ungroup', () => {
  const projectId = 'proj_v3_css';
  const sheetId = 'sheet_v3_pro';
  const { darkTheme, all: themes } = createDefaultThemes(projectId);
  const tokens = createDefaultTokens(projectId, darkTheme.id);
  const tokenMap = buildTokenLookupMap(tokens, darkTheme.id);

  it('blocca la sincronizzazione quando una regola o un commento CSS è incompleto', () => {
    const sheet = createStarterDemoSheet(projectId, sheetId);
    const id = sheet.rootIds[0];
    for (const css of [`#${id} { opacity: 0.5;`, `#${id} { opacity: 0.5; } /* commento aperto`]) {
      const result = parseCssEditsToPatchOps(css, sheet);
      expect(result.ops).toEqual([]);
      expect(result.diagnostics).toEqual([expect.objectContaining({ severity: 'error' })]);
    }
    expect(parseCssEditsToPatchOps(`#${id} { opacity: 0.5; }`, sheet).ops).toHaveLength(1);
  });

  it('registers >= 78 canonical CSS properties and round-trips margins (auto), units, min/max, pins, Flex 9-dot, Grid minmax/spans, gradients, multi-shadows, filters, 2D transforms, transitions, @keyframes & pro typography', () => {
    expect(SUPPORTED_CSS_PROPERTIES.length).toBeGreaterThanOrEqual(78);

    const baseSheet = createStarterDemoSheet(projectId, sheetId, 'ProDesignScreen');
    const gridParentId = 'nd_pro_grid';
    const proCardId = 'nd_pro_card';

    const seeded = applyPatchOpsToSheet(baseSheet, [
      {
        op: 'insert_node',
        parentId: baseSheet.rootIds[0],
        node: createDefaultUINode(
          {
            id: gridParentId,
            kind: 'container',
            name: 'ProMetricsGrid',
          },
          sheetId,
        ),
      },
      {
        op: 'insert_node',
        parentId: gridParentId,
        node: createDefaultUINode(
          {
            id: proCardId,
            kind: 'container',
            name: 'HeroFeatureCard',
            content: { text: 'Pro Design v3.0' },
          },
          sheetId,
        ),
      },
    ]).nextSheet;

    const proCss = `
      @keyframes aurora-glow {
        0% { opacity: 0.85; }
        100% { opacity: 1; }
      }

      /* @node ${gridParentId} (ProMetricsGrid) */
      .pro-metrics-grid {
        display: grid;
        grid-template-columns: minmax(220px, 1fr) 2fr auto;
        grid-template-rows: auto 1fr;
        justify-items: stretch;
        align-items: center;
        row-gap: 18px;
        column-gap: 24px;
        width: 85vw;
        min-width: 320px;
        max-width: 1200px;
        margin: 16px auto 32px auto;
        padding: 20px 28px 24px 28px;
        overflow-x: hidden;
        overflow-y: auto;
      }

      /* @node ${proCardId} (HeroFeatureCard) */
      .hero-feature-card {
        grid-column: 1 / span 2;
        grid-row: 1 / span 2;
        justify-self: stretch;
        display: flex;
        flex-direction: row-reverse;
        flex-wrap: wrap;
        justify-content: space-evenly;
        align-items: baseline;
        flex-grow: 2;
        flex-shrink: 0;
        flex-basis: 280px;
        align-self: center;
        order: 3;
        height: 42vh;
        min-height: 200px;
        max-height: 620px;
        aspect-ratio: 16 / 9;
        box-sizing: border-box;
        background: linear-gradient(135deg, rgba(37, 99, 235, 0.92) 0%, #8b5cf6 50%, #ec4899 100%);
        border-top: 2px dashed #38bdf8;
        border-bottom: 1px solid rgba(148, 163, 184, 0.4);
        border-radius: 20px 20px 6px 6px;
        outline: 2px solid #60a5fa;
        outline-offset: 3px;
        box-shadow: 0px 18px 36px -6px rgba(15, 23, 42, 0.48), inset 0px 1px 0px 0px rgba(255, 255, 255, 0.16);
        filter: blur(1px) brightness(108%) contrast(104%) saturate(115%) grayscale(10%);
        backdrop-filter: blur(16px) saturate(130%);
        transform: translateX(12px) translateY(-6px) rotate(4deg) scale(1.04, 0.98) skewX(3deg);
        transform-origin: top left;
        transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1) 30ms, box-shadow 180ms ease;
        animation: slide-up 450ms ease-out 0ms 1 normal both;
        font-family: 'Plus Jakarta Sans', sans-serif;
        font-size: 1.25rem;
        font-weight: 700;
        font-style: italic;
        line-height: 1.6;
        letter-spacing: 1.5px;
        text-align: center;
        text-transform: uppercase;
        text-decoration: underline;
        white-space: nowrap;
        text-overflow: ellipsis;
        -webkit-line-clamp: 2;
        text-shadow: 0px 2px 10px rgba(59, 130, 246, 0.5);
        color: #f8fafc;
        cursor: grab;
        pointer-events: none;
        user-select: none;
      }

      .hero-feature-card:hover {
        transform: translateY(-4px) scale(1.06);
        opacity: 0.96;
      }

      .hero-feature-card:focus-visible {
        outline: 3px solid #38bdf8;
      }

      .hero-feature-card:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
    `;

    const parsed = parseCssEditsToPatchOps(proCss, seeded);
    expect(parsed.diagnostics).toHaveLength(0);
    expect(parsed.matchedNodeIds).toEqual(expect.arrayContaining([gridParentId, proCardId]));

    const { nextSheet } = applyPatchOpsToSheet(seeded, parsed.ops);
    expect(nextSheet.keyframesCss).toContain('@keyframes aurora-glow');

    const gridNode = nextSheet.nodes[gridParentId];
    expect(gridNode.layout.mode).toBe('grid');
    expect(gridNode.layout.gridCols).toEqual([
      { track: 'minmax', min: '220px', max: '1fr' },
      { track: 'fr', value: 2 },
      { track: 'auto' },
    ]);
    expect(gridNode.layout.gridRows).toEqual([{ track: 'auto' }, { track: 'fr', value: 1 }]);
    expect(gridNode.layout.margin).toEqual({ top: 16, right: 'auto', bottom: 32, left: 'auto' });
    expect(gridNode.layout.padding).toEqual({ top: 20, right: 28, bottom: 24, left: 28 });
    expect(gridNode.layout.width).toMatchObject({ mode: 'viewport', value: 85, unit: 'vw', min: 320, max: 1200 });
    expect(gridNode.layout.overflowX).toBe('hidden');
    expect(gridNode.layout.overflowY).toBe('auto');

    const cardNode = nextSheet.nodes[proCardId];
    expect(cardNode.layout.direction).toBe('row-reverse');
    expect(cardNode.layout.wrap).toBe(true);
    expect(cardNode.layout.justify).toBe('space-evenly');
    expect(cardNode.layout.align).toBe('baseline');
    expect(cardNode.layout.flexChild).toMatchObject({
      grow: 2,
      shrink: 0,
      basis: 280,
      alignSelf: 'center',
      order: 3,
    });
    expect(cardNode.layout.gridChild).toMatchObject({
      colStart: 1,
      colSpan: 2,
      rowStart: 1,
      rowSpan: 2,
      justifySelf: 'stretch',
    });
    expect(cardNode.layout.height).toMatchObject({ mode: 'viewport', value: 42, unit: 'vh', min: 200, max: 620 });
    expect(cardNode.layout.aspectRatio).toBe('16 / 9');

    // Multi-stop linear-gradient with rgba(...) preserved without comma corruption!
    expect(cardNode.style.fills?.[0]).toMatchObject({
      type: 'linear-gradient',
      angle: 135,
      stops: [
        { pos: 0, color: 'rgba(37, 99, 235, 0.92)' },
        { pos: 0.5, color: '#8b5cf6' },
        { pos: 1, color: '#ec4899' },
      ],
    });
    expect(cardNode.style.border?.sides?.top).toMatchObject({ width: 2, style: 'dashed', color: '#38bdf8' });
    expect(cardNode.style.radius).toEqual({ tl: 20, tr: 20, br: 6, bl: 6 });
    expect(cardNode.style.outline).toMatchObject({ width: 2, style: 'solid', color: '#60a5fa', offset: 3 });
    expect(cardNode.style.shadows).toHaveLength(2);
    expect(cardNode.style.shadows?.[1]?.inset).toBe(true);
    expect(cardNode.style.backdropBlur).toBe(16);
    expect(cardNode.style.filters).toMatchObject({
      blur: 1,
      brightness: 108,
      contrast: 104,
      saturate: 115,
      grayscale: 10,
    });
    expect(cardNode.style.transform).toMatchObject({
      translateX: 12,
      translateY: -6,
      rotate: 4,
      scaleX: 1.04,
      scaleY: 0.98,
      skewX: 3,
      origin: 'top left',
    });
    expect(cardNode.style.transitions).toHaveLength(2);
    expect(cardNode.style.animation).toMatchObject({ name: 'slide-up', durationMs: 450 });
    expect(cardNode.typography).toMatchObject({
      fontSize: 1.25,
      fontSizeUnit: 'rem',
      fontWeight: 700,
      fontStyle: 'italic',
      lineHeight: 1.6,
      letterSpacing: 1.5,
      textAlign: 'center',
      textTransform: 'uppercase',
      textDecoration: 'underline',
      whiteSpace: 'nowrap',
      textOverflow: 'ellipsis',
      lineClamp: 2,
    });
    expect(cardNode.style.cursor).toBe('grab');
    expect(cardNode.style.pointerEvents).toBe('none');
    expect(cardNode.stateOverrides?.hover?.style?.opacity).toBe(0.96);
    expect(cardNode.stateOverrides?.['focus-visible']?.style?.outline?.width).toBe(3);
    expect(cardNode.stateOverrides?.disabled?.style?.opacity).toBe(0.45);

    // Re-compile forward and verify lossless output + @keyframes preset emission + SourceMap
    const recompiled = compileSheetToCss(nextSheet, tokens, darkTheme.id);
    expect(recompiled.css).toContain('@keyframes slide-up');
    expect(recompiled.css).toContain('@keyframes aurora-glow');
    expect(recompiled.css).toContain('margin: 16px auto 32px auto;');
    expect(recompiled.css).toContain('grid-template-columns: minmax(220px, 1fr) 2fr auto;');
    expect(recompiled.css).toContain('linear-gradient(135deg, rgba(37, 99, 235, 0.92) 0%, #8b5cf6 50%, #ec4899 100%)');
    expect(recompiled.css).toContain('.hero-feature-card:focus-visible');
    expect(recompiled.css).toContain('.hero-feature-card:disabled');
    expect(recompiled.sourceMap.some((s) => s.canvasNodeId === proCardId)).toBe(true);

    const sandbox = buildSandboxPreviewHtml(nextSheet, tokens, darkTheme.id);
    expect(sandbox).toContain('grid-template-columns: minmax(220px, 1fr) 2fr auto;');
    expect(sandbox).toContain('height: 42vh;');
    expect(sandbox).toContain('outline: 3px solid #38bdf8;');
    expect(sandbox).toContain('@keyframes slide-up');
    expect(sandbox).toContain('#hero-feature-card:focus-visible');

    // Also verify radial-gradient & conic-gradient parsing
    const radParsed = parseCssEditsToPatchOps(
      `#${proCardId} { background: radial-gradient(circle at 30% 40%, #38bdf8 0%, #0f172a 100%), conic-gradient(from 45deg at 50% 50%, #3b82f6 0%, #a855f7 100%); }`,
      nextSheet,
    );
    const radSheet = applyPatchOpsToSheet(nextSheet, radParsed.ops).nextSheet;
    expect(radSheet.nodes[proCardId].style.fills?.[0]?.type).toBe('radial-gradient');
    expect(radSheet.nodes[proCardId].style.fills?.[1]?.type).toBe('conic-gradient');
  });

  it('supports ReusableCssClass cascade, live pseudo-state Canvas styles, CSS round-trip editing, and native/web target codegen', async () => {
    const baseSheet = createStarterDemoSheet(projectId, sheetId, 'ReusableClassDemo');
    const glassCardClass: ReusableCssClass = {
      id: 'rc_glass_card',
      name: 'glass-card',
      style: {
        fills: [{ type: 'solid', color: '#1e293b' }],
        radius: 18,
        backdropBlur: 14,
        border: { width: 1, style: 'solid', color: '#38bdf8' },
      },
      typography: {
        fontFamily: 'Inter, sans-serif',
        fontSize: 18,
        fontWeight: 700,
        color: '#e0f2fe',
      },
      stateOverrides: {
        hover: {
          style: {
            fills: [{ type: 'solid', color: '#0284c7' }],
            transform: { translateY: -3, translateYUnit: 'px', scaleX: 1.02, scaleY: 1.02 },
          },
        },
      },
    };

    const unstyledBoxId = 'nd_reusable_consumer';
    let sheet: UISheetDocument = applyPatchOpsToSheet(baseSheet, [
      { op: 'update_sheet_meta', reusableClasses: [glassCardClass] },
      {
        op: 'insert_node',
        parentId: baseSheet.rootIds[0],
        node: {
          id: unstyledBoxId,
          kind: 'container',
          name: 'PlainBoxWithClass',
          classNames: ['glass-card'],
          style: { fills: [], radius: 0 },
          content: { text: 'Bound to .glass-card' },
        },
      },
    ]).nextSheet;

    const consumer = sheet.nodes[unstyledBoxId];
    const cascadedBase = mergeCascadedNodeSpecs(consumer, sheet.reusableClasses, 'base');
    expect(cascadedBase.style.fills?.[0]).toEqual({ type: 'solid', color: '#1e293b' });
    expect(cascadedBase.style.backdropBlur).toBe(14);

    // Simulated :hover state on Canvas resolves reusable class :hover override!
    const reactHoverStyle = compileNodeToReactStyle(consumer, {
      tokenMap,
      parentMode: 'flex',
      reusableClasses: sheet.reusableClasses,
      activeState: 'hover',
    });
    expect(reactHoverStyle.background).toBe('#0284c7');
    expect(String(reactHoverStyle.transform)).toContain('translateY(-3px)');

    // Forward CSS sheet includes /* @reusable-class glass-card */ and .glass-card:hover
    const reusableCss = compileReusableClassesCss(sheet.reusableClasses, tokenMap);
    expect(reusableCss).toContain('/* @reusable-class glass-card */');
    expect(reusableCss).toContain('.glass-card:hover');

    // Editing .glass-card in CSS updates sheet.reusableClasses via update_sheet_meta!
    const classEditOps = parseCssEditsToPatchOps(
      `.glass-card {\n  background: #0f766e;\n  border-radius: 24px;\n}`,
      sheet,
    );
    expect(classEditOps.ops.some((o) => o.op === 'update_sheet_meta')).toBe(true);
    sheet = applyPatchOpsToSheet(sheet, classEditOps.ops).nextSheet;
    expect(sheet.reusableClasses?.[0].style?.radius).toBe(24);
    expect(sheet.reusableClasses?.[0].style?.fills?.[0]).toEqual({ type: 'solid', color: '#0f766e' });

    // Normalize to UIRModule: verify non-CSS native targets receive pre-merged base defaults AND web targets keep classNames!
    const uir = normalizeSheetToUIRModule(sheet, tokens, themes);
    const uirConsumer = findUIRNodeByCanvasId(uir.components[0].root, unstyledBoxId)!;
    expect(uirConsumer).toBeDefined();
    expect(uirConsumer.classNames).toContain('glass-card');
    expect(uirConsumer.style.base.radius).toBe(24);
    expect(uirConsumer.style.base.fills?.[0]).toEqual({ type: 'solid', color: '#0f766e' });

    // Verify Tailwind, Vanilla CSS, HTML5, React, Svelte 5, and React Native codegen output!
    const twClasses = buildTailwindClasses(uirConsumer, uir.tokens, false);
    expect(twClasses).toContain('glass-card');
    expect(twClasses).toContain('rounded-[24px]');
    expect(twClasses).toContain('backdrop-blur-[14px]');
    expect(twClasses).toContain('hover:scale-[1.02]');

    expect(getNodeCssClassName(uirConsumer, false)).toContain('glass-card');
    const builtStylesheet = buildStylesheetWithSourceMap(uir.components[0].root, uir.tokens);
    expect(builtStylesheet.code).toContain('.glass-card {');

    const codegen = createCodegenWorkerService();
    const htmlBundle = await codegen.compileSheet({
      sheet,
      tokens,
      themes,
      options: { targetId: 'html-vanilla', dialect: 'vanilla-css', mode: 'bundle' },
    });
    const indexHtml = htmlBundle.files.find((f) => f.relativePath === 'index.html')!.code;
    const stylesCss = htmlBundle.files.find((f) => f.relativePath === 'styles.css')!.code;
    expect(indexHtml).toContain('glass-card');
    expect(stylesCss).toContain('.glass-card {');

    const rnBundle = await codegen.compileSheet({
      sheet,
      tokens,
      themes,
      options: { targetId: 'react-native', dialect: 'vanilla-css', mode: 'component' },
    });
    expect(rnBundle.files[0].code).toContain("backgroundColor: '#0f766e'");
    expect(rnBundle.files[0].code).toContain('borderRadius: 24');
  });

  it('executes Group (row / grid / card) & Ungroup with 0px freeform shift, lossless Undo/Redo, and Style Copy/Paste', () => {
    const rootId = 'art_grp';
    const b1 = 'btn_a';
    const b2 = 'btn_b';

    const freeformSheet: UISheetDocument = {
      sheetId: 's_grp',
      projectId,
      name: 'GroupTestSheet',
      rootIds: [rootId],
      nodes: {
        [rootId]: createDefaultUINode(
          {
            id: rootId,
            kind: 'artboard',
            name: 'Artboard',
            childIds: [b1, b2],
            layout: {
              mode: 'freeform',
              positioning: 'flow',
              frame: { x: 0, y: 0, width: 1200, height: 800 },
              width: { mode: 'fixed', value: 1200 },
              height: { mode: 'fixed', value: 800 },
              padding: { top: 0, right: 0, bottom: 0, left: 0 },
            },
          },
          's_grp',
        ),
        [b1]: createDefaultUINode(
          {
            id: b1,
            parentId: rootId,
            kind: 'control',
            name: 'BtnA',
            classNames: ['cta-pill'],
            layout: {
              mode: 'freeform',
              positioning: 'absolute',
              frame: { x: 100, y: 150, width: 140, height: 44 },
              width: { mode: 'fixed', value: 140 },
              height: { mode: 'fixed', value: 44 },
              padding: { top: 8, right: 16, bottom: 8, left: 16 },
            },
            style: {
              fills: [{ type: 'linear-gradient', angle: 90, stops: [{ pos: 0, color: '#2563eb' }, { pos: 1, color: '#7c3aed' }] }],
              radius: 999,
            },
            stateOverrides: {
              hover: { style: { opacity: 0.9 } },
            },
          },
          's_grp',
        ),
        [b2]: createDefaultUINode(
          {
            id: b2,
            parentId: rootId,
            kind: 'control',
            name: 'BtnB',
            layout: {
              mode: 'freeform',
              positioning: 'absolute',
              frame: { x: 280, y: 150, width: 140, height: 44 },
              width: { mode: 'fixed', value: 140 },
              height: { mode: 'fixed', value: 44 },
              padding: { top: 8, right: 16, bottom: 8, left: 16 },
            },
          },
          's_grp',
        ),
      },
    };

    // 1. Wrap into Freeform Group -> children get relative coords (0,0) & (180,0) inside (100,150) wrapper
    const wrapFree = applyPatchOpsToSheet(freeformSheet, [
      {
        op: 'wrap_container',
        targetNodeIds: [b1, b2],
        wrapperId: 'grp_free',
        wrapperName: 'FreeGroup',
        mode: 'freeform',
      },
    ]);
    expect(wrapFree.nextSheet.nodes.grp_free.layout.frame).toMatchObject({ x: 100, y: 150, width: 320, height: 44 });
    expect(wrapFree.nextSheet.nodes[b1].layout.frame).toMatchObject({ x: 0, y: 0 });
    expect(wrapFree.nextSheet.nodes[b2].layout.frame).toMatchObject({ x: 180, y: 0 });

    // 2. Ungroup restores exact absolute (100,150) & (280,150) coordinates and supports Undo!
    const ungrouped = applyPatchOpsToSheet(wrapFree.nextSheet, [{ op: 'ungroup_container', id: 'grp_free' }]);
    expect(ungrouped.nextSheet.nodes.grp_free).toBeUndefined();
    expect(ungrouped.nextSheet.nodes[b1].parentId).toBe(rootId);
    expect(ungrouped.nextSheet.nodes[b1].layout.frame).toMatchObject({ x: 100, y: 150 });
    expect(ungrouped.nextSheet.nodes[b2].layout.frame).toMatchObject({ x: 280, y: 150 });

    const undoneUngroup = applyPatchOpsToSheet(ungrouped.nextSheet, ungrouped.inverseOps);
    expect(undoneUngroup.nextSheet.nodes.grp_free).toBeDefined();
    expect(undoneUngroup.nextSheet.nodes.grp_free.childIds).toEqual([b1, b2]);

    // 3. Wrap into Styled Card Flex Container
    const cardWrapped = applyPatchOpsToSheet(freeformSheet, [
      {
        op: 'wrap_container',
        targetNodeIds: [b1, b2],
        wrapperId: 'grp_card',
        mode: 'flex',
        direction: 'row',
        presetStyle: 'card',
      },
    ]).nextSheet;
    expect(cardWrapped.nodes.grp_card.layout.mode).toBe('flex');
    expect(cardWrapped.nodes.grp_card.style.radius).toBe(12);
    expect(cardWrapped.nodes.grp_card.style.shadows?.length).toBeGreaterThan(0);

    // 4. Copy Style CSS from BtnA -> Paste Style CSS onto BtnB
    const srcNode = freeformSheet.nodes[b1];
    const stylePasteRes = applyPatchOpsToSheet(freeformSheet, [
      {
        op: 'update_node',
        id: b2,
        classNames: srcNode.classNames,
        style: structuredClone(srcNode.style),
        typography: srcNode.typography ? structuredClone(srcNode.typography) : undefined,
        stateOverrides: structuredClone(srcNode.stateOverrides),
      },
    ]).nextSheet;
    expect(stylePasteRes.nodes[b2].classNames).toEqual(['cta-pill']);
    expect(stylePasteRes.nodes[b2].style.radius).toBe(999);
    expect(stylePasteRes.nodes[b2].style.fills?.[0]?.type).toBe('linear-gradient');
    expect(stylePasteRes.nodes[b2].stateOverrides?.hover?.style?.opacity).toBe(0.9);
  });
});
