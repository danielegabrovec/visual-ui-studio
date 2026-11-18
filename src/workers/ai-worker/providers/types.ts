import { z } from 'zod';
import type {
  AgentExecutionMode,
  LocalAIModelInfo,
  LocalAIProviderKind,
  LocalAIProviderStatus,
} from '@shared/ipc-contract';
import type { AICompactNode, AICompactPatchOp } from '@shared/ui-patch';
import type { CodegenTargetId, StylingDialect, UINodeKind, UIControlSubtype, SemanticTag } from '@shared/ui-ir';

export interface ProviderConfig {
  id: LocalAIProviderKind;
  displayName: string;
  baseUrl: string;
  apiKey?: string;
}

export interface ProviderGenerateInput {
  runId: string;
  modelName: string;
  mode: AgentExecutionMode;
  systemPrompt: string;
  userPrompt: string;
  visionImageBase64?: string;
  activeTarget?: CodegenTargetId;
  activeDialect?: StylingDialect;
  numCtx?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
  onTokenDelta?: (delta: string, isThinking?: boolean) => void;
}

export interface StructuredAgentPlan {
  reply: string;
  thinking?: string;
  compactOps: AICompactPatchOp[];
}

export interface ProviderGenerateOutput {
  plan: StructuredAgentPlan;
  rawText: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface ILocalProviderClient {
  readonly kind: LocalAIProviderKind;
  getConfig(): ProviderConfig;
  updateConfig(patch: { baseUrl?: string; apiKey?: string }): void;
  getStatus(timeoutMs?: number): Promise<LocalAIProviderStatus>;
  generatePlan(input: ProviderGenerateInput): Promise<ProviderGenerateOutput>;
}

// ============================================================================
// BOUNDED-DEPTH JSON SCHEMA FOR GBNF / OLLAMA / LM STUDIO STRUCTURED OUTPUT
// Bounded depth avoids infinite $ref recursion in llama.cpp GBNF compilers.
// ============================================================================

function buildCompactNodeJsonSchema(depth: number): Record<string, unknown> {
  const props: Record<string, unknown> = {
    kind: {
      type: 'string',
      enum: ['artboard', 'container', 'text', 'control', 'media', 'vector', 'collection'],
    },
    name: { type: 'string' },
    tag: {
      type: 'string',
      enum: [
        'div',
        'section',
        'header',
        'footer',
        'nav',
        'main',
        'aside',
        'article',
        'form',
        'button',
        'a',
        'input',
        'textarea',
        'select',
        'label',
        'h1',
        'h2',
        'h3',
        'h4',
        'p',
        'span',
        'ul',
        'li',
        'table',
        'dialog',
      ],
    },
    text: { type: 'string' },
    placeholder: { type: 'string' },
    iconName: { type: 'string' },
    controlType: {
      type: 'string',
      enum: [
        'button',
        'icon-button',
        'text-input',
        'password',
        'textarea',
        'select',
        'checkbox',
        'switch',
        'slider',
        'badge',
        'divider',
        'tabs',
        'table',
      ],
    },
    layoutMode: { type: 'string', enum: ['flex', 'grid', 'stack', 'freeform'] },
    direction: { type: 'string', enum: ['row', 'column'] },
    gap: { type: 'number' },
    padding: { type: 'number' },
    justify: {
      type: 'string',
      enum: ['start', 'center', 'end', 'space-between', 'space-around', 'space-evenly'],
    },
    align: { type: 'string', enum: ['start', 'center', 'end', 'stretch', 'baseline'] },
    widthMode: { type: 'string', enum: ['fixed', 'hug', 'fill', 'percentage'] },
    heightMode: { type: 'string', enum: ['fixed', 'hug', 'fill', 'percentage'] },
    width: { type: 'number' },
    height: { type: 'number' },
    bg: { type: 'string' },
    textColor: { type: 'string' },
    fontSize: { type: 'number' },
    fontWeight: { type: 'number' },
    radius: { type: 'number' },
    borderColor: { type: 'string' },
    htmx: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['hx-get', 'hx-post', 'hx-put', 'hx-patch', 'hx-delete'] },
        endpoint: { type: 'string' },
        targetNodeId: { type: 'string' },
        hxSwap: {
          type: 'string',
          enum: ['innerHTML', 'outerHTML', 'beforebegin', 'afterbegin', 'beforeend', 'afterend', 'delete', 'none'],
        },
        hxTrigger: { type: 'string' },
      },
      required: ['method', 'endpoint'],
    },
    mvvmBinding: {
      type: 'object',
      properties: {
        property: { type: 'string' },
        path: { type: 'string' },
        command: { type: 'string' },
      },
      required: ['property', 'path'],
    },
  };

  if (depth > 0) {
    props.children = {
      type: 'array',
      items: buildCompactNodeJsonSchema(depth - 1),
    };
  }

  return {
    type: 'object',
    properties: props,
    required: ['kind', 'name'],
  };
}

export const AGENT_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    reply: {
      type: 'string',
      description: 'Concise explanation of the UI/code changes applied for the user.',
    },
    ops: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          op: {
            type: 'string',
            enum: ['insert_tree', 'update_props', 'bind_htmx', 'wrap_auto_layout', 'delete_node'],
          },
          parentId: { type: ['string', 'null'] },
          index: { type: 'number' },
          tree: buildCompactNodeJsonSchema(3),
          nodeId: { type: 'string' },
          name: { type: 'string' },
          text: { type: 'string' },
          direction: { type: 'string', enum: ['row', 'column'] },
          gap: { type: 'number' },
          padding: { type: 'number' },
          bg: { type: 'string' },
          textColor: { type: 'string' },
          fontSize: { type: 'number' },
          radius: { type: 'number' },
          widthMode: { type: 'string', enum: ['fixed', 'hug', 'fill'] },
          heightMode: { type: 'string', enum: ['fixed', 'hug', 'fill'] },
          width: { type: 'number' },
          height: { type: 'number' },
          method: { type: 'string', enum: ['hx-get', 'hx-post', 'hx-put', 'hx-patch', 'hx-delete'] },
          endpoint: { type: 'string' },
          targetNodeId: { type: 'string' },
          hxSwap: { type: 'string' },
          hxTrigger: { type: 'string' },
          targetNodeIds: { type: 'array', items: { type: 'string' } },
          wrapperName: { type: 'string' },
        },
        required: ['op'],
      },
    },
  },
  required: ['reply', 'ops'],
};

// ============================================================================
// ROBUST ZOD VALIDATOR & THINK-TAG / JSON FENCE EXTRACTOR
// ============================================================================

const VALID_KINDS = new Set<UINodeKind>([
  'artboard',
  'container',
  'text',
  'control',
  'media',
  'vector',
  'collection',
  'component_instance',
  'slot',
]);

const VALID_CONTROLS = new Set<UIControlSubtype>([
  'button',
  'icon-button',
  'text-input',
  'password',
  'textarea',
  'select',
  'checkbox',
  'switch',
  'slider',
  'badge',
  'divider',
  'tabs',
  'table',
]);

const VALID_TAGS = new Set<SemanticTag>([
  'div',
  'section',
  'header',
  'footer',
  'nav',
  'main',
  'aside',
  'article',
  'form',
  'button',
  'a',
  'input',
  'textarea',
  'select',
  'label',
  'h1',
  'h2',
  'h3',
  'h4',
  'p',
  'span',
  'ul',
  'li',
  'table',
  'dialog',
  'window',
]);

function sanitizeCompactNode(raw: any): AICompactNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const rawKind = typeof raw.kind === 'string' ? raw.kind.toLowerCase() : 'container';
  const kind: UINodeKind = VALID_KINDS.has(rawKind as UINodeKind)
    ? (rawKind as UINodeKind)
    : rawKind === 'button' || rawKind === 'input'
      ? 'control'
      : 'container';

  const controlType: UIControlSubtype | undefined =
    typeof raw.controlType === 'string' && VALID_CONTROLS.has(raw.controlType as UIControlSubtype)
      ? (raw.controlType as UIControlSubtype)
      : rawKind === 'button'
        ? 'button'
        : rawKind === 'input'
          ? 'text-input'
          : undefined;

  const tag: SemanticTag | undefined =
    typeof raw.tag === 'string' && VALID_TAGS.has(raw.tag as SemanticTag) ? (raw.tag as SemanticTag) : undefined;

  const children: AICompactNode[] = Array.isArray(raw.children)
    ? (raw.children.map(sanitizeCompactNode).filter(Boolean) as AICompactNode[])
    : [];

  return {
    id: typeof raw.id === 'string' ? raw.id : undefined,
    kind,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'GeneratedElement',
    tag,
    text: typeof raw.text === 'string' ? raw.text : undefined,
    placeholder: typeof raw.placeholder === 'string' ? raw.placeholder : undefined,
    iconName: typeof raw.iconName === 'string' ? raw.iconName : undefined,
    controlType,
    layoutMode:
      raw.layoutMode === 'flex' || raw.layoutMode === 'grid' || raw.layoutMode === 'stack' || raw.layoutMode === 'freeform'
        ? raw.layoutMode
        : undefined,
    direction: raw.direction === 'row' || raw.direction === 'column' ? raw.direction : undefined,
    gap: typeof raw.gap === 'number' ? raw.gap : undefined,
    padding: typeof raw.padding === 'number' ? raw.padding : undefined,
    justify: raw.justify,
    align: raw.align,
    widthMode: raw.widthMode,
    heightMode: raw.heightMode,
    width: typeof raw.width === 'number' ? raw.width : undefined,
    height: typeof raw.height === 'number' ? raw.height : undefined,
    x: typeof raw.x === 'number' ? raw.x : undefined,
    y: typeof raw.y === 'number' ? raw.y : undefined,
    bg: typeof raw.bg === 'string' ? raw.bg : undefined,
    textColor: typeof raw.textColor === 'string' ? raw.textColor : undefined,
    fontSize: typeof raw.fontSize === 'number' ? raw.fontSize : undefined,
    fontWeight: typeof raw.fontWeight === 'number' || typeof raw.fontWeight === 'string' ? raw.fontWeight : undefined,
    radius: typeof raw.radius === 'number' ? raw.radius : undefined,
    borderColor: typeof raw.borderColor === 'string' ? raw.borderColor : undefined,
    htmx:
      raw.htmx && typeof raw.htmx === 'object' && typeof raw.htmx.endpoint === 'string'
        ? {
            method: raw.htmx.method ?? 'hx-get',
            endpoint: raw.htmx.endpoint,
            targetNodeId: typeof raw.htmx.targetNodeId === 'string' ? raw.htmx.targetNodeId : undefined,
            hxSwap: raw.htmx.hxSwap ?? 'innerHTML',
            hxTrigger: typeof raw.htmx.hxTrigger === 'string' ? raw.htmx.hxTrigger : undefined,
          }
        : undefined,
    mvvmBinding:
      raw.mvvmBinding && typeof raw.mvvmBinding === 'object' && typeof raw.mvvmBinding.path === 'string'
        ? {
            property: typeof raw.mvvmBinding.property === 'string' ? raw.mvvmBinding.property : 'Text',
            path: raw.mvvmBinding.path,
            command: typeof raw.mvvmBinding.command === 'string' ? raw.mvvmBinding.command : undefined,
          }
        : undefined,
    children: children.length > 0 ? children : undefined,
  };
}

const RawEnvelopeSchema = z.object({
  reply: z.string().optional(),
  ops: z.array(z.record(z.string(), z.any())).optional(),
});

export function extractThinkingAndJsonBody(rawText: string): { thinking?: string; cleanedBody: string } {
  let thinkingParts: string[] = [];
  let cleaned = rawText.replace(/<think>([\s\S]*?)<\/think>/gi, (_match, inner) => {
    if (typeof inner === 'string' && inner.trim()) {
      thinkingParts.push(inner.trim());
    }
    return '';
  });

  cleaned = cleaned.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    cleaned = fenceMatch[1].trim();
  } else {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
  }

  return {
    thinking: thinkingParts.length > 0 ? thinkingParts.join('\n\n') : undefined,
    cleanedBody: cleaned,
  };
}

export function parseStructuredAgentPlan(rawText: string, externalThinking?: string): StructuredAgentPlan {
  const { thinking: inlineThinking, cleanedBody } = extractThinkingAndJsonBody(rawText);
  const combinedThinking = [externalThinking, inlineThinking].filter(Boolean).join('\n\n') || undefined;

  let parsedObj: unknown;
  try {
    parsedObj = JSON.parse(cleanedBody);
  } catch (err) {
    throw new Error(`Invalid JSON from local model: ${err instanceof Error ? err.message : String(err)}`);
  }

  const envelope = RawEnvelopeSchema.parse(parsedObj);
  const compactOps: AICompactPatchOp[] = [];

  for (const rawOp of envelope.ops ?? []) {
    switch (rawOp.op) {
      case 'insert_tree': {
        const tree = sanitizeCompactNode(rawOp.tree ?? rawOp.node);
        if (tree) {
          compactOps.push({
            op: 'insert_tree',
            parentId: typeof rawOp.parentId === 'string' ? rawOp.parentId : null,
            index: typeof rawOp.index === 'number' ? rawOp.index : undefined,
            tree,
          });
        }
        break;
      }
      case 'update_props': {
        if (typeof rawOp.nodeId === 'string') {
          compactOps.push({
            op: 'update_props',
            nodeId: rawOp.nodeId,
            name: typeof rawOp.name === 'string' ? rawOp.name : undefined,
            text: typeof rawOp.text === 'string' ? rawOp.text : undefined,
            direction: rawOp.direction === 'row' || rawOp.direction === 'column' ? rawOp.direction : undefined,
            gap: typeof rawOp.gap === 'number' ? rawOp.gap : undefined,
            padding: typeof rawOp.padding === 'number' ? rawOp.padding : undefined,
            bg: typeof rawOp.bg === 'string' ? rawOp.bg : undefined,
            textColor: typeof rawOp.textColor === 'string' ? rawOp.textColor : undefined,
            fontSize: typeof rawOp.fontSize === 'number' ? rawOp.fontSize : undefined,
            radius: typeof rawOp.radius === 'number' ? rawOp.radius : undefined,
            widthMode:
              rawOp.widthMode === 'fixed' || rawOp.widthMode === 'hug' || rawOp.widthMode === 'fill'
                ? rawOp.widthMode
                : undefined,
            heightMode:
              rawOp.heightMode === 'fixed' || rawOp.heightMode === 'hug' || rawOp.heightMode === 'fill'
                ? rawOp.heightMode
                : undefined,
            width: typeof rawOp.width === 'number' ? rawOp.width : undefined,
            height: typeof rawOp.height === 'number' ? rawOp.height : undefined,
          });
        }
        break;
      }
      case 'bind_htmx': {
        if (typeof rawOp.nodeId === 'string' && typeof rawOp.endpoint === 'string') {
          compactOps.push({
            op: 'bind_htmx',
            nodeId: rawOp.nodeId,
            method: rawOp.method ?? 'hx-get',
            endpoint: rawOp.endpoint,
            targetNodeId: typeof rawOp.targetNodeId === 'string' ? rawOp.targetNodeId : undefined,
            hxSwap: rawOp.hxSwap ?? 'innerHTML',
            hxTrigger: typeof rawOp.hxTrigger === 'string' ? rawOp.hxTrigger : undefined,
          });
        }
        break;
      }
      case 'wrap_auto_layout': {
        if (Array.isArray(rawOp.targetNodeIds) && rawOp.targetNodeIds.length > 0) {
          compactOps.push({
            op: 'wrap_auto_layout',
            targetNodeIds: rawOp.targetNodeIds.filter((x: unknown): x is string => typeof x === 'string'),
            wrapperName: typeof rawOp.wrapperName === 'string' ? rawOp.wrapperName : 'AutoGroup',
            direction: rawOp.direction === 'column' ? 'column' : 'row',
            gap: typeof rawOp.gap === 'number' ? rawOp.gap : 12,
          });
        }
        break;
      }
      case 'delete_node': {
        if (typeof rawOp.nodeId === 'string') {
          compactOps.push({
            op: 'delete_node',
            nodeId: rawOp.nodeId,
          });
        }
        break;
      }
    }
  }

  return {
    reply: envelope.reply?.trim() || 'Canvas updated successfully.',
    thinking: combinedThinking,
    compactOps,
  };
}

export function inferModelCapabilitiesFromName(
  modelId: string,
  provider: LocalAIProviderKind,
  extraMeta?: {
    sizeBytes?: number;
    quantization?: string;
    families?: string[];
    loadedInVram?: boolean;
    vramUsedMb?: number;
  },
): LocalAIModelInfo {
  const lower = modelId.toLowerCase();
  const families = (extraMeta?.families ?? []).map((f) => f.toLowerCase());
  const supportsVision =
    lower.includes('vl') ||
    lower.includes('vision') ||
    lower.includes('llava') ||
    lower.includes('gemma3') ||
    lower.includes('gemma-3') ||
    lower.includes('pixtral') ||
    lower.includes('minicpm-v') ||
    lower.includes('moondream') ||
    families.includes('clip') ||
    families.includes('mllama');

  const isUnsloth = lower.includes('unsloth') || lower.includes('ud-q4') || lower.includes('ud-q5');

  return {
    id: modelId,
    name: modelId,
    provider,
    sizeBytes: extraMeta?.sizeBytes,
    quantization: extraMeta?.quantization,
    supportsVision,
    supportsTools: !lower.includes('embed') && !lower.includes('whisper'),
    isUnsloth,
    loadedInVram: extraMeta?.loadedInVram ?? false,
    vramUsedMb: extraMeta?.vramUsedMb,
  };
}

export function stripDataUriPrefix(base64OrDataUri: string): { mimeType: string; rawBase64: string; dataUri: string } {
  const trimmed = base64OrDataUri.trim();
  const match = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (match) {
    return {
      mimeType: match[1],
      rawBase64: match[2].replace(/\s+/g, ''),
      dataUri: trimmed,
    };
  }
  const clean = trimmed.replace(/\s+/g, '');
  return {
    mimeType: 'image/png',
    rawBase64: clean,
    dataUri: `data:image/png;base64,${clean}`,
  };
}
