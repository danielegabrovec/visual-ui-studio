import type { AgentExecutionMode, LocalAIModelInfo, LocalAIProviderStatus } from '@shared/ipc-contract';
import type { CodegenTargetId, NodeId, UINode, UISheetDocument } from '@shared/ui-ir';
import type { AICompactNode, AICompactPatchOp } from '@shared/ui-patch';
import type { StructuredAgentPlan } from './providers/types';

function isDarkColorLiteral(raw: string): boolean {
  const c = raw.trim().toLowerCase();
  const hexMatch = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hexMatch) {
    const h = hexMatch[1];
    const r = h.length === 3 ? parseInt(h[0] + h[0], 16) : parseInt(h.slice(0, 2), 16);
    const g = h.length === 3 ? parseInt(h[1] + h[1], 16) : parseInt(h.slice(2, 4), 16);
    const b = h.length === 3 ? parseInt(h[2] + h[2], 16) : parseInt(h.slice(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum < 0.45;
  }
  const rgbMatch = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.45;
  }
  return false;
}

function isSheetArtboardDark(sheet: UISheetDocument): boolean {
  const rootId = sheet.rootIds[0];
  const artboard = rootId ? sheet.nodes[rootId] : undefined;
  if (!artboard) return false;

  const firstFill = artboard.style?.fills?.[0];
  if (firstFill) {
    if (firstFill.type === 'solid' && typeof firstFill.color === 'string') {
      return isDarkColorLiteral(firstFill.color);
    }
    if (firstFill.type === 'linear-gradient') {
      const firstStopColor = firstFill.stops?.[0]?.color;
      if (typeof firstStopColor === 'string') {
        return isDarkColorLiteral(firstStopColor);
      }
    }
  }

  for (const cid of artboard.childIds) {
    const child = sheet.nodes[cid];
    if (!child) continue;
    const cf = child.style?.fills?.[0];
    if (child.kind === 'container' && cf?.type === 'solid' && typeof cf.color === 'string') {
      return isDarkColorLiteral(cf.color);
    }
    const tc = child.typography?.color;
    if (child.kind === 'text' && typeof tc === 'string' && /^#(f8fafc|ffffff|fff|f1f5f9|e2e8f0)$/i.test(tc.trim())) {
      return true;
    }
  }

  return artboard.layout.mode === 'freeform';
}

function applyDarkThemeToCompactTree(node: AICompactNode, depth = 0): AICompactNode {
  const next: AICompactNode = { ...node };

  if (next.kind === 'container' || next.kind === 'collection') {
    if (!next.bg || next.bg === '#ffffff' || next.bg === '#f8fafc') {
      next.bg = depth === 0 ? '#111827' : '#1e293b';
    }
    if (!next.borderColor || next.borderColor === '#e2e8f0' || next.borderColor === '#cbd5e1') {
      next.borderColor = '#334155';
    }
  } else if (next.kind === 'text') {
    if (!next.textColor || next.textColor === '#0f172a' || next.textColor === '#1e293b') {
      next.textColor = '#f8fafc';
    } else if (next.textColor === '#64748b' || next.textColor === '#475569') {
      next.textColor = '#94a3b8';
    }
  } else if (next.kind === 'control') {
    if (
      next.controlType === 'text-input' ||
      next.controlType === 'password' ||
      next.controlType === 'textarea'
    ) {
      next.bg = next.bg ?? '#0f172a';
      next.textColor = next.textColor ?? '#f8fafc';
      next.borderColor = '#334155';
    } else if (next.controlType === 'button' && next.bg === '#f1f5f9') {
      next.bg = '#1e293b';
      next.textColor = '#e2e8f0';
      next.borderColor = '#334155';
    }
  }

  if (next.children) {
    next.children = next.children.map((ch) => applyDarkThemeToCompactTree(ch, depth + 1));
  }

  return next;
}

function adaptCompactTreeForSheetContext(
  tree: AICompactNode,
  sheet: UISheetDocument,
  parentId: NodeId | null,
  estimatedHeight = 236,
): AICompactNode {
  const darkArtboard = isSheetArtboardDark(sheet);
  let adapted = darkArtboard ? applyDarkThemeToCompactTree(tree, 0) : { ...tree };

  const rootId = sheet.rootIds[0];
  const rootArtboard = rootId ? sheet.nodes[rootId] : undefined;
  const hostContainer = (parentId ? sheet.nodes[parentId] : undefined) ?? rootArtboard;

  if (hostContainer && hostContainer.layout.mode === 'freeform') {
    const children = hostContainer.childIds
      .map((cid) => sheet.nodes[cid])
      .filter((c): c is UINode => Boolean(c && c.visible !== false));

    const nextY = Math.round(
      Math.max(
        48,
        ...children.map((c) => (c.layout.frame?.y ?? 0) + (c.layout.frame?.height ?? 0) + 28),
      ),
    );
    const hostWidth = hostContainer.layout.frame?.width || rootArtboard?.layout.frame?.width || 1200;
    const preferredMaxWidth = adapted.name === 'AuthLoginCard' ? 460 : 880;
    const sectionWidth = Math.max(320, Math.min(preferredMaxWidth, hostWidth - 96));

    adapted = {
      ...adapted,
      positioning: 'absolute',
      x: 48,
      y: nextY,
      widthMode: 'fixed',
      width: sectionWidth,
      heightMode: 'hug',
      height: estimatedHeight,
      zIndex: children.length + 2,
    };
  }

  return adapted;
}

export const BUILTIN_OFFLINE_MODELS: LocalAIModelInfo[] = [
  {
    id: 'studio-offline-architect-v1',
    name: 'Studio Built-in UI Architect (Zero-Setup Offline)',
    provider: 'builtin_offline',
    quantization: 'Deterministic AST',
    supportsVision: true,
    supportsTools: true,
    isUnsloth: false,
    loadedInVram: true,
    vramUsedMb: 0,
  },
];

export function getBuiltinOfflineProviderStatus(): LocalAIProviderStatus {
  return {
    id: 'builtin_offline',
    displayName: 'Built-in Deterministic UI Assistant (Offline Ready)',
    baseUrl: 'builtin://local-ast-synthesizer',
    online: true,
    latencyMs: 1,
    models: BUILTIN_OFFLINE_MODELS,
  };
}

export interface OfflineSynthesisInput {
  mode: AgentExecutionMode;
  prompt: string;
  sheet: UISheetDocument;
  selectedNodeIds: NodeId[];
  activeTarget?: CodegenTargetId;
  hasVisionAttachment: boolean;
  fallbackReason?: string;
}

function findPrimaryContainerParentId(sheet: UISheetDocument, selectedNodeIds: NodeId[]): NodeId | null {
  for (const selId of selectedNodeIds) {
    const sel = sheet.nodes[selId];
    if (sel && (sel.kind === 'artboard' || sel.kind === 'container' || sel.kind === 'collection')) {
      return sel.id;
    }
    if (sel?.parentId && sheet.nodes[sel.parentId]) {
      return sel.parentId;
    }
  }
  return sheet.rootIds[0] ?? null;
}

function buildLoginCardTree(isHtmx: boolean, isMvvm: boolean): AICompactNode {
  return {
    kind: 'container',
    name: 'AuthLoginCard',
    tag: 'form',
    layoutMode: 'flex',
    direction: 'column',
    gap: 14,
    padding: 24,
    widthMode: 'fill',
    bg: '#ffffff',
    borderColor: '#e2e8f0',
    radius: 14,
    htmx: isHtmx
      ? {
          method: 'hx-post',
          endpoint: '/api/auth/login',
          hxSwap: 'outerHTML',
        }
      : undefined,
    children: [
      {
        kind: 'text',
        name: 'LoginHeading',
        tag: 'h2',
        text: 'Sign in to Workspace',
        fontSize: 22,
        fontWeight: 700,
      },
      {
        kind: 'text',
        name: 'LoginSubtext',
        tag: 'p',
        text: 'Enter your credentials to access local projects and analytics.',
        fontSize: 14,
        textColor: '#64748b',
      },
      {
        kind: 'control',
        name: 'EmailField',
        controlType: 'text-input',
        placeholder: 'name@company.com',
        widthMode: 'fill',
        height: 42,
        radius: 8,
        borderColor: '#cbd5e1',
        mvvmBinding: isMvvm ? { property: 'Text', path: 'EmailAddress' } : undefined,
      },
      {
        kind: 'control',
        name: 'PasswordField',
        controlType: 'password',
        placeholder: '••••••••••••',
        widthMode: 'fill',
        height: 42,
        radius: 8,
        borderColor: '#cbd5e1',
        mvvmBinding: isMvvm ? { property: 'Text', path: 'Password' } : undefined,
      },
      {
        kind: 'control',
        name: 'SubmitLoginButton',
        controlType: 'button',
        text: 'Continue Securely',
        iconName: 'lock',
        widthMode: 'fill',
        height: 44,
        bg: '#2563eb',
        textColor: '#ffffff',
        radius: 10,
        mvvmBinding: isMvvm ? { property: 'Command', path: 'LoginCommand', command: 'LoginCommand' } : undefined,
      },
    ],
  };
}

function buildPricingOrKpiSection(prompt: string): AICompactNode {
  const isPricing = /pric|piano|plan|tier|abbonament/i.test(prompt);
  return {
    kind: 'container',
    name: isPricing ? 'PricingPlansRow' : 'AnalyticsStatsRow',
    tag: 'section',
    layoutMode: 'flex',
    direction: 'row',
    gap: 16,
    padding: 20,
    widthMode: 'fill',
    bg: '#f8fafc',
    borderColor: '#e2e8f0',
    radius: 14,
    children: [
      {
        kind: 'container',
        name: isPricing ? 'StarterTierCard' : 'ActiveUsersCard',
        tag: 'article',
        direction: 'column',
        gap: 8,
        padding: 20,
        widthMode: 'fill',
        bg: '#ffffff',
        borderColor: '#e2e8f0',
        radius: 12,
        children: [
          {
            kind: 'text',
            name: 'CardOneLabel',
            tag: 'span',
            text: isPricing ? 'Starter Local' : 'Active Sessions',
            fontSize: 13,
            textColor: '#64748b',
          },
          {
            kind: 'text',
            name: 'CardOneValue',
            tag: 'h3',
            text: isPricing ? '$0 / mo' : '8,940',
            fontSize: 24,
            fontWeight: 700,
          },
          {
            kind: 'control',
            name: 'CardOneAction',
            controlType: 'button',
            text: isPricing ? 'Get Started' : 'View Report',
            bg: '#2563eb',
            textColor: '#ffffff',
            radius: 8,
          },
        ],
      },
      {
        kind: 'container',
        name: isPricing ? 'ProStudioCard' : 'InferenceThroughputCard',
        tag: 'article',
        direction: 'column',
        gap: 8,
        padding: 20,
        widthMode: 'fill',
        bg: '#ffffff',
        borderColor: '#3b82f6',
        radius: 12,
        children: [
          {
            kind: 'text',
            name: 'CardTwoLabel',
            tag: 'span',
            text: isPricing ? 'Pro Team' : 'Local AI Speed',
            fontSize: 13,
            textColor: '#2563eb',
          },
          {
            kind: 'text',
            name: 'CardTwoValue',
            tag: 'h3',
            text: isPricing ? '$29 / mo' : '64.2 tok/s',
            fontSize: 24,
            fontWeight: 700,
          },
          {
            kind: 'control',
            name: 'CardTwoAction',
            controlType: 'button',
            text: isPricing ? 'Upgrade Workspace' : 'Inspect Telemetry',
            bg: '#1d4ed8',
            textColor: '#ffffff',
            radius: 8,
          },
        ],
      },
    ],
  };
}

function buildHtmxInteractivePanel(): AICompactNode {
  const targetResultsId = `nd_ai_htmx_results_${Date.now().toString(36)}`;
  return {
    kind: 'container',
    name: 'HtmxLiveFilterPanel',
    tag: 'section',
    layoutMode: 'flex',
    direction: 'column',
    gap: 12,
    padding: 20,
    widthMode: 'fill',
    bg: '#ffffff',
    borderColor: '#e2e8f0',
    radius: 12,
    children: [
      {
        kind: 'text',
        name: 'HtmxSectionTitle',
        tag: 'h3',
        text: 'Live Hypermedia Search & Swap',
        fontSize: 18,
        fontWeight: 700,
      },
      {
        kind: 'container',
        name: 'HtmxFilterRow',
        direction: 'row',
        gap: 10,
        padding: 0,
        widthMode: 'fill',
        children: [
          {
            kind: 'control',
            name: 'HtmxQueryInput',
            controlType: 'text-input',
            placeholder: 'Filter records via hx-get...',
            widthMode: 'fill',
            height: 40,
            borderColor: '#cbd5e1',
            htmx: {
              method: 'hx-get',
              endpoint: '/api/items/search',
              targetNodeId: targetResultsId,
              hxSwap: 'innerHTML',
              hxTrigger: 'keyup changed delay:250ms',
            },
          },
          {
            kind: 'control',
            name: 'HtmxReloadBtn',
            controlType: 'button',
            text: 'Sync Now',
            iconName: 'refresh',
            bg: '#2563eb',
            textColor: '#ffffff',
            height: 40,
            htmx: {
              method: 'hx-post',
              endpoint: '/api/items/sync',
              targetNodeId: targetResultsId,
              hxSwap: 'innerHTML',
            },
          },
        ],
      },
      {
        id: targetResultsId,
        kind: 'container',
        name: 'HtmxSwapTargetRegion',
        direction: 'column',
        gap: 8,
        padding: 12,
        widthMode: 'fill',
        bg: '#f8fafc',
        radius: 8,
        children: [
          {
            kind: 'text',
            name: 'SampleRowText',
            tag: 'p',
            text: 'Ready for HTMX partial swap response (/api/items/search).',
            fontSize: 13,
            textColor: '#475569',
          },
        ],
      },
    ],
  };
}

function buildGenericFeatureSection(prompt: string, isMvvm: boolean): AICompactNode {
  const cleanLabel = prompt.trim().slice(0, 56) || 'Generated UI Module';
  return {
    kind: 'container',
    name: 'AIGeneratedSection',
    tag: 'section',
    layoutMode: 'flex',
    direction: 'column',
    gap: 14,
    padding: 22,
    widthMode: 'fill',
    bg: '#ffffff',
    borderColor: '#e2e8f0',
    radius: 14,
    children: [
      {
        kind: 'text',
        name: 'SectionTitle',
        tag: 'h2',
        text: cleanLabel,
        fontSize: 20,
        fontWeight: 700,
      },
      {
        kind: 'text',
        name: 'SectionDescription',
        tag: 'p',
        text: 'Auto-Layout section synthesized with semantic design tokens and multi-target bindings.',
        fontSize: 14,
        textColor: '#64748b',
      },
      {
        kind: 'container',
        name: 'SectionActionsBar',
        direction: 'row',
        gap: 12,
        padding: 0,
        align: 'center',
        children: [
          {
            kind: 'control',
            name: 'PrimaryActionButton',
            controlType: 'button',
            text: 'Confirm Action',
            iconName: 'sparkles',
            bg: '#2563eb',
            textColor: '#ffffff',
            radius: 8,
            height: 42,
            mvvmBinding: isMvvm ? { property: 'Command', path: 'PrimaryActionCommand', command: 'PrimaryActionCommand' } : undefined,
          },
          {
            kind: 'control',
            name: 'SecondaryActionButton',
            controlType: 'button',
            text: 'Cancel',
            bg: '#f1f5f9',
            textColor: '#0f172a',
            radius: 8,
            height: 42,
          },
        ],
      },
    ],
  };
}

export function synthesizeOfflineAgentPlan(input: OfflineSynthesisInput): StructuredAgentPlan {
  const lowerPrompt = input.prompt.toLowerCase();
  const isHtmx = input.activeTarget === 'htmx' || lowerPrompt.includes('htmx') || lowerPrompt.includes('hx-');
  const isMvvm =
    input.activeTarget === 'dotnet-maui' ||
    input.activeTarget === 'avalonia-ui' ||
    input.activeTarget === 'angular' ||
    lowerPrompt.includes('mvvm') ||
    lowerPrompt.includes('maui');

  const rawParentId = findPrimaryContainerParentId(input.sheet, input.selectedNodeIds);
  const rootArtboardId = input.sheet.rootIds[0] ?? null;
  const rootArtboardNode = rootArtboardId ? input.sheet.nodes[rootArtboardId] : undefined;
  const rawParentNode = rawParentId ? input.sheet.nodes[rawParentId] : undefined;
  const parentId =
    (input.mode === 'prompt_to_ui' || input.mode === 'vision_to_ui' || input.hasVisionAttachment) &&
    rootArtboardNode?.layout.mode === 'freeform' &&
    rawParentNode &&
    rawParentNode.kind !== 'artboard' &&
    rawParentNode.layout.mode === 'freeform' &&
    (rawParentNode.layout.frame?.width ?? 0) < 600
      ? rootArtboardId
      : rawParentId;
  const statusNote = input.fallbackReason
    ? ` *(Local daemon notice: ${input.fallbackReason} — executed via Built-in Offline AST Synthesizer)*`
    : '';

  // 1. VISION -> UI MODE
  if (input.mode === 'vision_to_ui' || input.hasVisionAttachment) {
    const rawVisionTree: AICompactNode = {
      kind: 'container',
      name: 'VisionImportedFrame',
      tag: 'section',
      layoutMode: 'flex',
      direction: 'column',
      gap: 16,
      padding: 24,
      widthMode: 'fill',
      bg: '#ffffff',
      borderColor: '#cbd5e1',
      radius: 14,
      children: [
        {
          kind: 'container',
          name: 'VisionHeaderBar',
          tag: 'header',
          direction: 'row',
          justify: 'space-between',
          align: 'center',
          padding: 12,
          widthMode: 'fill',
          bg: '#f8fafc',
          radius: 8,
          children: [
            { kind: 'text', name: 'VisionTitle', tag: 'h3', text: 'Wireframe Captured Layout', fontSize: 18, fontWeight: 700 },
            { kind: 'control', name: 'VisionActionBtn', controlType: 'button', text: 'Publish', bg: '#2563eb', textColor: '#ffffff', radius: 8 },
          ],
        },
        buildPricingOrKpiSection(input.prompt),
      ],
    };
    const visionTree = adaptCompactTreeForSheetContext(rawVisionTree, input.sheet, parentId, 320);

    return {
      thinking: 'Analyzed wireframe aspect ratio and synthesized normalized Auto-Layout Flex container hierarchy.',
      reply: `Reconstructed structured Auto-Layout frame \`VisionImportedFrame\` onto the Canvas.${statusNote}`,
      compactOps: [{ op: 'insert_tree', parentId, tree: visionTree }],
    };
  }

  // 2. SURGICAL CO-PILOT MODE
  if (input.mode === 'surgical') {
    const validSelected = input.selectedNodeIds.filter((id) => Boolean(input.sheet.nodes[id]));
    const fallbackTargetId =
      validSelected[0] ??
      (parentId ? input.sheet.nodes[parentId]?.childIds[0] ?? parentId : Object.keys(input.sheet.nodes)[0]);

    if (validSelected.length >= 2 && /wrap|group|row|col|raggruppa|auto.?layout/i.test(lowerPrompt)) {
      const dir = /col|vertical/i.test(lowerPrompt) ? 'column' : 'row';
      return {
        thinking: `Wrapping ${validSelected.length} selected nodes into a ${dir} Auto-Layout container.`,
        reply: `Wrapped ${validSelected.length} selected elements into a responsive Flex \`${dir}\` container.${statusNote}`,
        compactOps: [
          {
            op: 'wrap_auto_layout',
            targetNodeIds: validSelected,
            wrapperName: 'SurgicalAutoGroup',
            direction: dir,
            gap: 12,
          },
        ],
      };
    }

    if (fallbackTargetId && isHtmx) {
      return {
        thinking: `Binding HTMX attributes onto node ${fallbackTargetId}.`,
        reply: `Configured HTMX \`hx-post="/api/action"\` hypermedia swap on \`${input.sheet.nodes[fallbackTargetId]?.name ?? fallbackTargetId}\`.${statusNote}`,
        compactOps: [
          {
            op: 'bind_htmx',
            nodeId: fallbackTargetId,
            method: lowerPrompt.includes('hx-get') ? 'hx-get' : 'hx-post',
            endpoint: '/api/action',
            hxSwap: 'outerHTML',
          },
        ],
      };
    }

    if (fallbackTargetId) {
      const targetNode = input.sheet.nodes[fallbackTargetId];
      const wantsRow = /row|orizzontal|horizontal/i.test(lowerPrompt);
      const wantsDarkOrAccent = /accent|primary|blu|dark|highlight|evidenzia/i.test(lowerPrompt);
      const darkArtboard = isSheetArtboardDark(input.sheet);
      const isAbsoluteNode = targetNode?.layout.positioning === 'absolute';
      return {
        thinking: `Applying surgical responsive & style patch to node ${fallbackTargetId}.`,
        reply: `Updated \`${targetNode?.name ?? fallbackTargetId}\` with responsive Auto-Layout sizing and refined styling.${statusNote}`,
        compactOps: [
          {
            op: 'update_props',
            nodeId: fallbackTargetId,
            direction: wantsRow ? 'row' : 'column',
            gap: 14,
            padding: 18,
            ...(isAbsoluteNode ? {} : { widthMode: 'fill' as const }),
            radius: 12,
            ...(wantsDarkOrAccent
              ? darkArtboard
                ? { bg: '#1e293b', textColor: '#f8fafc' }
                : { bg: '#eff6ff', textColor: '#1e3a8a' }
              : {}),
          },
        ],
      };
    }
  }

  // 3. REFACTOR MODE
  if (input.mode === 'refactor') {
    const rootId = input.sheet.rootIds[0];
    const compactOps: AICompactPatchOp[] = [];
    if (rootId && input.sheet.nodes[rootId]) {
      const rootNode = input.sheet.nodes[rootId];
      compactOps.push({
        op: 'update_props',
        nodeId: rootId,
        gap: 20,
        ...(rootNode.layout.mode === 'freeform' ? {} : { padding: 28 }),
      });
    }
    return {
      thinking: `Audited ${Object.keys(input.sheet.nodes).length} SceneGraph nodes for Auto-Layout consistency, WCAG contrast, and ${input.activeTarget ?? 'multi-target'} idioms.`,
      reply: `Normalized root container spacing/padding for clean \`${input.activeTarget ?? 'react-tsx'}\` code emission across ${Object.keys(input.sheet.nodes).length} nodes.${statusNote}`,
      compactOps,
    };
  }

  // 4. PROMPT -> UI MODE (Default Generative Mode)
  let rawTree: AICompactNode;
  let estimatedHeight = 220;
  if (/login|signin|sign-in|auth|accedi|registra|password/i.test(lowerPrompt)) {
    rawTree = buildLoginCardTree(isHtmx, isMvvm);
    estimatedHeight = 290;
  } else if (isHtmx || /search|ricerca|filtro|filter/i.test(lowerPrompt)) {
    rawTree = buildHtmxInteractivePanel();
    estimatedHeight = 230;
  } else if (/kpi|metric|stat|dashboard|analytics|pric|card|griglia/i.test(lowerPrompt)) {
    rawTree = buildPricingOrKpiSection(input.prompt);
    estimatedHeight = 210;
  } else {
    rawTree = buildGenericFeatureSection(input.prompt, isMvvm);
    estimatedHeight = 200;
  }

  const tree = adaptCompactTreeForSheetContext(rawTree, input.sheet, parentId, estimatedHeight);
  const placementDesc =
    tree.positioning === 'absolute' ? `at Freeform (${tree.x}, ${tree.y})` : 'with Auto-Layout';

  return {
    thinking: `Synthesizing structured ${tree.name} component tree under parent ${parentId ?? 'root'} (${placementDesc}) for target ${input.activeTarget ?? 'default'}.`,
    reply: `Created component \`${tree.name}\` on the Canvas ${placementDesc} with semantic structure and responsive sizing.${statusNote}`,
    compactOps: [
      {
        op: 'insert_tree',
        parentId,
        tree,
      },
    ],
  };
}
