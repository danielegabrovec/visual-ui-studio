import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  auditSheetAccessibilityAndLayout,
  computeBoxIoU,
  computeRelativeLuminance,
  computeWcagContrastRatio,
} from '@shared/a11y-auditor';
import { createDefaultThemes, createDefaultTokens, createStarterDemoSheet } from '@shared/default-tokens';
import { detectMarkupFormat, importMarkupToPatchOps, previewMarkupImport } from '@shared/markup-importer';
import { BUILTIN_TARGET_DESCRIPTORS, type UISheetDocument } from '@shared/ui-ir';
import { applyPatchOpsToSheet, createDefaultUINode } from '@shared/ui-patch';
import { resolveInteractiveExportDir, writeBundleFilesToDir } from '../src/main/bundle-exporter';

function createBlankTestSheet(artboardWidth = 1120): { sheet: UISheetDocument; artboardId: string } {
  const sheetId = 'sheet_test';
  const artboardId = 'art_root';
  const artboard = createDefaultUINode(
    {
      id: artboardId,
      kind: 'artboard',
      name: 'TestArtboard',
      layout: {
        mode: 'flex',
        positioning: 'flow',
        direction: 'column',
        gap: 16,
        justify: 'start',
        align: 'stretch',
        frame: { x: 0, y: 0, width: artboardWidth, height: 800 },
        width: { mode: 'fixed', value: artboardWidth },
        height: { mode: 'fixed', value: 800 },
        padding: { top: 24, right: 24, bottom: 24, left: 24 },
      },
      style: {
        fills: [{ type: 'solid', color: '#ffffff' }],
      },
    },
    sheetId,
  );

  return {
    artboardId,
    sheet: {
      sheetId,
      projectId: 'proj_test',
      name: 'TestScreen',
      rootIds: [artboardId],
      nodes: { [artboardId]: artboard },
    },
  };
}

describe('Shared Target Registry Expansion (26 GUI Targets)', () => {
  it('exposes all 26 unique GUI targets across Tiers 1–4 including the 8 Wave-2 additions', () => {
    expect(BUILTIN_TARGET_DESCRIPTORS).toHaveLength(26);

    const ids = BUILTIN_TARGET_DESCRIPTORS.map((d) => d.id);
    expect(new Set(ids).size).toBe(26);

    const expectedNewTargets: Array<{ id: string; tier: 1 | 2 | 3 | 4; ext: string }> = [
      { id: 'blazor-razor', tier: 2, ext: '.razor' },
      { id: 'python-streamlit', tier: 2, ext: '.py' },
      { id: 'python-pyside6', tier: 2, ext: '.py' },
      { id: 'go-wails', tier: 2, ext: '.go' },
      { id: 'cpp-qt-qml', tier: 3, ext: '.qml' },
      { id: 'winui3-xaml', tier: 3, ext: '.xaml' },
      { id: 'lvgl-c', tier: 4, ext: '.c' },
      { id: 'unity-uitoolkit', tier: 4, ext: '.uxml' },
    ];

    for (const expected of expectedNewTargets) {
      const desc = BUILTIN_TARGET_DESCRIPTORS.find((d) => d.id === expected.id);
      expect(desc, `Missing target descriptor for ${expected.id}`).toBeDefined();
      expect(desc?.tier).toBe(expected.tier);
      expect(desc?.fileExtension).toBe(expected.ext);
    }
  });
});

describe('Code-to-Canvas Reverse Importer (markup-importer.ts)', () => {
  it('parses HTML + Tailwind + HTMX attributes and links internal hx-target IDs cleanly', () => {
    const { sheet, artboardId } = createBlankTestSheet();
    const htmlSnippet = `
      <section id="catalog-panel" class="flex flex-col gap-4 p-6 bg-slate-900 rounded-xl border border-slate-700 shadow-lg">
        <div class="flex flex-row justify-between items-center gap-3">
          <h2 class="text-2xl font-bold text-white">Ricerca Magazzino</h2>
          <span class="text-xs font-semibold text-emerald-400">LIVE HTMX</span>
        </div>
        <form hx-post="/api/inventory/filter" hx-target="#results-grid" hx-swap="innerHTML" hx-trigger="submit" class="flex flex-row gap-3 items-center">
          <input type="text" placeholder="Cerca codice SKU..." aria-label="Cerca SKU" class="w-full p-2 rounded-md bg-slate-800 text-white" />
          <select aria-label="Categoria" class="rounded-md bg-slate-800 text-white">
            <option>Tutte</option>
            <option selected>GPU Locali</option>
          </select>
          <button class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold">Filtra</button>
        </form>
        <div id="results-grid" class="grid grid-cols-3 gap-4 p-4">
          <p class="text-sm text-slate-300">24 articoli trovati</p>
        </div>
      </section>
    `;

    expect(detectMarkupFormat(htmlSnippet)).toBe('html');
    const ops = importMarkupToPatchOps(sheet, artboardId, htmlSnippet);
    expect(ops.length).toBeGreaterThanOrEqual(8);
    expect(ops.every((o) => o.op === 'insert_node')).toBe(true);

    const { nextSheet, inverseOps } = applyPatchOpsToSheet(sheet, ops);
    const allInserted = Object.values(nextSheet.nodes).filter((n) => n.id !== artboardId);
    expect(allInserted.length).toBe(ops.length);

    // Check root section layout & Tailwind styles
    const panel = allInserted.find((n) => n.semanticTag === 'section');
    expect(panel).toBeDefined();
    expect(panel?.kind).toBe('container');
    expect(panel?.layout.mode).toBe('flex');
    expect(panel?.layout.direction).toBe('column');
    expect(panel?.layout.gap).toBe(16);
    expect(panel?.layout.padding.top).toBe(24);
    expect(panel?.style.radius).toBe(16);
    expect(panel?.style.fills?.[0]).toEqual({ type: 'solid', color: '#0f172a' });
    expect(panel?.style.shadows?.length).toBe(1);

    // Check HTMX form & linked targetNodeId
    const formNode = allInserted.find((n) => n.semanticTag === 'form');
    const gridNode = allInserted.find((n) => n.layout.mode === 'grid');
    expect(formNode?.platform?.htmx?.method).toBe('hx-post');
    expect(formNode?.platform?.htmx?.endpoint).toBe('/api/inventory/filter');
    expect(formNode?.platform?.htmx?.hxSwap).toBe('innerHTML');
    expect(formNode?.platform?.htmx?.targetNodeId).toBe(gridNode?.id);
    expect(gridNode?.layout.gridCols).toHaveLength(3);

    // Check select options & button hover override
    const selectNode = allInserted.find((n) => n.content?.controlType === 'select');
    expect(selectNode?.content?.options).toEqual(['Tutte', 'GPU Locali']);
    expect(selectNode?.content?.value).toBe('GPU Locali');

    const btnNode = allInserted.find((n) => n.content?.controlType === 'button');
    expect(btnNode?.content?.text).toBe('Filtra');
    expect(btnNode?.stateOverrides?.hover?.style?.fills?.[0]).toEqual({ type: 'solid', color: '#1d4ed8' });

    // Full Undo restores exact initial node count
    const undone = applyPatchOpsToSheet(nextSheet, inverseOps).nextSheet;
    expect(Object.keys(undone.nodes)).toEqual([artboardId]);
  });

  it('parses React JSX components with className, inline style objects, and arrow event handlers', () => {
    const { sheet, artboardId } = createBlankTestSheet();
    const jsxMarkup = `
      export default function PromoWidget() {
        return (
          <div className="flex flex-col gap-3" style={{ backgroundColor: '#111827', padding: 20, borderRadius: 14 }}>
            <h1 className="text-3xl font-extrabold text-sky-400">AI Workstation</h1>
            <textarea placeholder="Scrivi istruzioni per l'agente..." aria-label="Prompt Agente" />
            <button className="bg-emerald-600 text-white px-5 py-2 rounded-full" onClick={() => launchBuild()}>
              {"Avvia Compilazione"}
            </button>
          </div>
        );
      }
    `;

    const preview = previewMarkupImport(sheet, artboardId, jsxMarkup);
    expect(preview.detectedFormat).toBe('jsx');
    expect(preview.nodeCount).toBe(4);

    const { nextSheet } = applyPatchOpsToSheet(sheet, preview.ops);
    const heading = Object.values(nextSheet.nodes).find((n) => n.semanticTag === 'h1');
    expect(heading?.kind).toBe('text');
    expect(heading?.typography?.fontSize).toBe(30);
    expect(heading?.typography?.fontWeight).toBe(800);
    expect(heading?.typography?.color).toBe('#38bdf8');

    const card = nextSheet.nodes[preview.rootNodeIds[0]];
    expect(card.style.fills?.[0]).toEqual({ type: 'solid', color: '#111827' });
    expect(card.style.radius).toBe(14);
    expect(card.layout.padding.left).toBe(20);

    const btn = Object.values(nextSheet.nodes).find((n) => n.content?.controlType === 'button');
    expect(btn?.content?.text).toBe('Avvia Compilazione');
    expect(btn?.interactions?.[0]).toEqual({
      trigger: 'onClick',
      action: { kind: 'call_handler', handlerName: 'launchBuild' },
    });
  });

  it('parses standalone <svg> vector markup into an atomic media UINode with path and data URI', () => {
    const { sheet, artboardId } = createBlankTestSheet();
    const svgMarkup = `
      <svg viewBox="0 0 64 64" aria-label="Telemetry Wave" stroke="#6366f1" fill="none">
        <title>Telemetry Wave</title>
        <path d="M4 32 L18 14 L32 48 L46 20 L60 32" stroke-width="4" />
      </svg>
    `;

    const preview = previewMarkupImport(sheet, artboardId, svgMarkup);
    expect(preview.detectedFormat).toBe('svg');
    expect(preview.nodeCount).toBe(1);

    const { nextSheet } = applyPatchOpsToSheet(sheet, preview.ops);
    const mediaNode = nextSheet.nodes[preview.rootNodeIds[0]];
    expect(mediaNode.kind).toBe('media');
    expect(mediaNode.layout.frame.width).toBe(64);
    expect(mediaNode.layout.frame.height).toBe(64);
    expect(mediaNode.content?.svgPath).toContain('M4 32');
    expect(mediaNode.content?.imageUrl?.startsWith('data:image/svg+xml;utf8,')).toBe(true);
    expect(mediaNode.platform?.a11y?.ariaLabel).toBe('Telemetry Wave');
  });
});

describe('WCAG 2.2 Accessibility & Layout Auditor (a11y-auditor.ts)', () => {
  it('computes exact WCAG 2.2 relative luminance, contrast ratios, and bounding-box IoU', () => {
    expect(computeRelativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
    expect(computeRelativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
    expect(computeWcagContrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2);
    expect(computeWcagContrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 2);

    const iouIdentical = computeBoxIoU({ x: 10, y: 10, width: 100, height: 50 }, { x: 10, y: 10, width: 100, height: 50 });
    expect(iouIdentical).toBeCloseTo(1, 4);
    const iouDisjoint = computeBoxIoU({ x: 0, y: 0, width: 50, height: 50 }, { x: 100, y: 100, width: 50, height: 50 });
    expect(iouDisjoint).toBe(0);
  });

  it('detects contrast, touch-target, missing-label, freeform-overlap, and overflow issues, then auto-fixes to 100/100', () => {
    const projectId = 'proj_audit';
    const { darkTheme } = createDefaultThemes(projectId);
    const tokens = createDefaultTokens(projectId, darkTheme.id);
    const { sheet, artboardId } = createBlankTestSheet(1000);

    // 1. Low contrast normal text (#cbd5e1 on #ffffff => ~1.48:1 < 4.5:1)
    // 2. Cramped unlabeled icon button (height: 24px < 36px, no text, no ariaLabel)
    // 3. Freeform container with two overlapping children (IoU > 0.2)
    // 4. Wide banner exceeding artboard width (1320px > 1000px)
    const setupOps = [
      {
        op: 'insert_node' as const,
        parentId: artboardId,
        node: {
          id: 'nd_low_contrast_txt',
          kind: 'text' as const,
          name: 'FaintCaption',
          typography: {
            fontFamily: 'Inter',
            fontSize: 14,
            fontWeight: 400,
            color: '#cbd5e1',
          },
          content: { text: 'Testo troppo chiaro su sfondo bianco' },
        },
      },
      {
        op: 'insert_node' as const,
        parentId: artboardId,
        node: {
          id: 'nd_tiny_unlabeled_btn',
          kind: 'control' as const,
          name: 'CloseModalIconBtn',
          semanticTag: 'button' as const,
          layout: {
            mode: 'freeform' as const,
            positioning: 'flow' as const,
            frame: { x: 0, y: 0, width: 24, height: 24 },
            width: { mode: 'fixed' as const, value: 24 },
            height: { mode: 'fixed' as const, value: 24 },
            padding: { top: 4, right: 4, bottom: 4, left: 4 },
          },
          style: { fills: [{ type: 'solid' as const, color: '#1e293b' }] },
          content: { controlType: 'icon-button' as const, text: '' },
        },
      },
      {
        op: 'insert_node' as const,
        parentId: artboardId,
        node: {
          id: 'nd_messy_freeform',
          kind: 'container' as const,
          name: 'MessyFreeformBox',
          layout: {
            mode: 'freeform' as const,
            positioning: 'flow' as const,
            frame: { x: 0, y: 0, width: 600, height: 200 },
            width: { mode: 'fill' as const },
            height: { mode: 'fixed' as const, value: 200 },
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
          },
        },
      },
      {
        op: 'insert_node' as const,
        parentId: 'nd_messy_freeform',
        node: {
          id: 'nd_overlap_a',
          kind: 'text' as const,
          name: 'CardBadgeA',
          layout: {
            mode: 'freeform' as const,
            positioning: 'absolute' as const,
            frame: { x: 20, y: 20, width: 200, height: 80 },
            width: { mode: 'fixed' as const, value: 200 },
            height: { mode: 'fixed' as const, value: 80 },
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
          },
          typography: { fontFamily: 'Inter', fontSize: 16, fontWeight: 600, color: '#0f172a' },
          content: { text: 'Blocco A' },
        },
      },
      {
        op: 'insert_node' as const,
        parentId: 'nd_messy_freeform',
        node: {
          id: 'nd_overlap_b',
          kind: 'text' as const,
          name: 'CardBadgeB',
          layout: {
            mode: 'freeform' as const,
            positioning: 'absolute' as const,
            frame: { x: 50, y: 30, width: 200, height: 80 },
            width: { mode: 'fixed' as const, value: 200 },
            height: { mode: 'fixed' as const, value: 80 },
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
          },
          typography: { fontFamily: 'Inter', fontSize: 16, fontWeight: 600, color: '#0f172a' },
          content: { text: 'Blocco B' },
        },
      },
      {
        op: 'insert_node' as const,
        parentId: artboardId,
        node: {
          id: 'nd_overflow_banner',
          kind: 'container' as const,
          name: 'WideOverflowBanner',
          layout: {
            mode: 'flex' as const,
            positioning: 'flow' as const,
            direction: 'row' as const,
            frame: { x: 0, y: 0, width: 1320, height: 72 },
            width: { mode: 'fixed' as const, value: 1320 },
            height: { mode: 'fixed' as const, value: 72 },
            padding: { top: 12, right: 12, bottom: 12, left: 12 },
          },
        },
      },
    ];

    const buggySheet = applyPatchOpsToSheet(sheet, setupOps).nextSheet;
    const beforeAudit = auditSheetAccessibilityAndLayout(buggySheet, tokens);

    expect(beforeAudit.score).toBeLessThan(70);
    expect(beforeAudit.countsByCategory.contrast).toBe(1);
    expect(beforeAudit.countsByCategory['touch-target']).toBe(1);
    expect(beforeAudit.countsByCategory['missing-label']).toBe(1);
    expect(beforeAudit.countsByCategory['freeform-overlap']).toBe(1);
    expect(beforeAudit.countsByCategory['responsive-overflow']).toBe(1);
    expect(beforeAudit.autoFixPatches.length).toBeGreaterThanOrEqual(4);

    // Apply 1-click Auto-Fix patches and verify 100% clean audit
    const { nextSheet: fixedSheet } = applyPatchOpsToSheet(buggySheet, beforeAudit.autoFixPatches);
    const afterAudit = auditSheetAccessibilityAndLayout(fixedSheet, tokens);

    expect(afterAudit.issues).toHaveLength(0);
    expect(afterAudit.score).toBe(100);
    expect(fixedSheet.nodes.nd_tiny_unlabeled_btn.layout.frame.height).toBe(40);
    expect(fixedSheet.nodes.nd_tiny_unlabeled_btn.platform?.a11y?.ariaLabel).toBeTruthy();
    expect(fixedSheet.nodes.nd_messy_freeform.layout.mode).toBe('flex');
    expect(fixedSheet.nodes.nd_overflow_banner.layout.frame.width).toBeLessThanOrEqual(1000);
  });

  it('audits and auto-fixes the default NovaCommerce starter sheet cleanly', () => {
    const projectId = 'proj_demo';
    const { darkTheme } = createDefaultThemes(projectId);
    const tokens = createDefaultTokens(projectId, darkTheme.id);
    const demoSheet = createStarterDemoSheet(projectId, 'sheet_demo');

    const initial = auditSheetAccessibilityAndLayout(demoSheet, tokens);
    const { nextSheet: fixedDemo } = applyPatchOpsToSheet(demoSheet, initial.autoFixPatches);
    const after = auditSheetAccessibilityAndLayout(fixedDemo, tokens);

    expect(after.issues).toHaveLength(0);
    expect(after.score).toBe(100);
  });
});

describe('Scaffold Multi-File Disk Exporter & Path-Traversal Guard (bundle-exporter.ts)', () => {
  it('writes nested scaffold files inside targetDir and blocks path traversal attempts', () => {
    const tmpBase = mkdtempSync(join(tmpdir(), 'fn-bundle-test-'));
    try {
      const res = writeBundleFilesToDir(tmpBase, [
        { relativePath: 'package.json', code: '{"name":"exported-app"}' },
        { relativePath: 'src/components/App.tsx', code: 'export const App = () => <main />;' },
      ]);

      expect(res.fileCount).toBe(2);
      expect(existsSync(join(tmpBase, 'package.json'))).toBe(true);
      expect(readFileSync(join(tmpBase, 'src', 'components', 'App.tsx'), 'utf8')).toContain('export const App');

      expect(() =>
        writeBundleFilesToDir(tmpBase, [{ relativePath: '../outside-escape.txt', code: 'pwn' }]),
      ).toThrow(/path traversal/i);

      expect(() =>
        writeBundleFilesToDir(tmpBase, [{ relativePath: 'src/../../outside-escape.txt', code: 'pwn' }]),
      ).toThrow(/path traversal/i);

      const nested = resolveInteractiveExportDir(tmpBase, 'My Blazor App');
      expect(nested).toBe(join(tmpBase, 'My-Blazor-App'));
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });
});
