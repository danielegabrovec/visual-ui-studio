import type {
  EventActionBinding,
  GridTrackSpec,
  HtmxExtensionSpec,
  HtmxSwapMode,
  InteractiveStateKey,
  LayoutSpec,
  NodeContentSpec,
  NodeId,
  PaddingBox,
  PlatformExtensions,
  SemanticTag,
  StyleFill,
  StyleShadow,
  StyleSpec,
  TypographySpec,
  UIControlSubtype,
  UINode,
  UINodeKind,
  UISheetDocument,
} from './ui-ir';
import { applyPatchOpsToSheet, createDefaultUINode, generateNodeId, type UIPatchOp } from './ui-patch';

export type MarkupImportFormat = 'auto' | 'html' | 'jsx' | 'svg' | 'svelte' | 'angular';

export interface MarkupImportPreview {
  detectedFormat: 'html' | 'jsx' | 'svg' | 'svelte' | 'angular';
  ops: UIPatchOp[];
  nodeCount: number;
  rootNodeIds: NodeId[];
  warnings: string[];
}

interface ParsedElementNode {
  kind: 'element';
  tag: string;
  attrs: Record<string, string>;
  rawSource: string;
  children: ParsedAstNode[];
  assignedNodeId: NodeId;
}

interface ParsedTextNode {
  kind: 'text';
  text: string;
}

type ParsedAstNode = ParsedElementNode | ParsedTextNode;

const VOID_HTML_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const VALID_SEMANTIC_TAGS = new Set<SemanticTag>([
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

const VALID_HTMX_SWAPS = new Set<HtmxSwapMode>([
  'innerHTML',
  'outerHTML',
  'beforebegin',
  'afterbegin',
  'beforeend',
  'afterend',
  'delete',
  'none',
  'morph:outerHTML',
]);

// Canonical Tailwind v3/v4 hex palette for deterministic color resolution
const TAILWIND_PALETTE: Record<string, Record<string, string>> = {
  slate: {
    '50': '#f8fafc',
    '100': '#f1f5f9',
    '200': '#e2e8f0',
    '300': '#cbd5e1',
    '400': '#94a3b8',
    '500': '#64748b',
    '600': '#475569',
    '700': '#334155',
    '800': '#1e293b',
    '900': '#0f172a',
    '950': '#020617',
  },
  gray: {
    '50': '#f9fafb',
    '100': '#f3f4f6',
    '200': '#e5e7eb',
    '300': '#d1d5db',
    '400': '#9ca3af',
    '500': '#6b7280',
    '600': '#4b5563',
    '700': '#374151',
    '800': '#1f2937',
    '900': '#111827',
    '950': '#030712',
  },
  zinc: {
    '50': '#fafafa',
    '100': '#f4f4f5',
    '200': '#e4e4e7',
    '300': '#d4d4d8',
    '400': '#a1a1aa',
    '500': '#71717a',
    '600': '#52525b',
    '700': '#3f3f46',
    '800': '#27272a',
    '900': '#18181b',
    '950': '#09090b',
  },
  neutral: {
    '50': '#fafafa',
    '100': '#f5f5f5',
    '200': '#e5e5e5',
    '300': '#d4d4d4',
    '400': '#a3a3a3',
    '500': '#737373',
    '600': '#525252',
    '700': '#404040',
    '800': '#262626',
    '900': '#171717',
    '950': '#0a0a0a',
  },
  red: {
    '50': '#fef2f2',
    '100': '#fee2e2',
    '200': '#fecaca',
    '300': '#fca5a5',
    '400': '#f87171',
    '500': '#ef4444',
    '600': '#dc2626',
    '700': '#b91c1c',
    '800': '#991b1b',
    '900': '#7f1d1d',
    '950': '#450a0a',
  },
  orange: {
    '50': '#fff7ed',
    '100': '#ffedd5',
    '200': '#fed7aa',
    '300': '#fdba74',
    '400': '#fb923c',
    '500': '#f97316',
    '600': '#ea580c',
    '700': '#c2410c',
    '800': '#9a3412',
    '900': '#7c2d12',
    '950': '#431407',
  },
  amber: {
    '50': '#fffbeb',
    '100': '#fef3c7',
    '200': '#fde68a',
    '300': '#fcd34d',
    '400': '#fbbf24',
    '500': '#f59e0b',
    '600': '#d97706',
    '700': '#b45309',
    '800': '#92400e',
    '900': '#78350f',
    '950': '#451a03',
  },
  yellow: {
    '50': '#fefce8',
    '100': '#fef9c3',
    '200': '#fef08a',
    '300': '#fde047',
    '400': '#facc15',
    '500': '#eab308',
    '600': '#ca8a04',
    '700': '#a16207',
    '800': '#854d0e',
    '900': '#713f12',
  },
  green: {
    '50': '#f0fdf4',
    '100': '#dcfce7',
    '200': '#bbf7d0',
    '300': '#86efac',
    '400': '#4ade80',
    '500': '#22c55e',
    '600': '#16a34a',
    '700': '#15803d',
    '800': '#166534',
    '900': '#14532d',
    '950': '#052e16',
  },
  emerald: {
    '50': '#ecfdf5',
    '100': '#d1fae5',
    '200': '#a7f3d0',
    '300': '#6ee7b7',
    '400': '#34d399',
    '500': '#10b981',
    '600': '#059669',
    '700': '#047857',
    '800': '#065f46',
    '900': '#064e3b',
    '950': '#022c22',
  },
  teal: {
    '50': '#f0fdfa',
    '100': '#ccfbf1',
    '200': '#99f6e4',
    '300': '#5eead4',
    '400': '#2dd4bf',
    '500': '#14b8a6',
    '600': '#0d9488',
    '700': '#0f766e',
    '800': '#115e59',
    '900': '#134e4a',
  },
  cyan: {
    '50': '#ecfeff',
    '100': '#cffafe',
    '200': '#a5f3fc',
    '300': '#67e8f9',
    '400': '#22d3ee',
    '500': '#06b6d4',
    '600': '#0891b2',
    '700': '#0e7490',
    '800': '#155e75',
    '900': '#164e63',
  },
  sky: {
    '50': '#f0f9ff',
    '100': '#e0f2fe',
    '200': '#bae6fd',
    '300': '#7dd3fc',
    '400': '#38bdf8',
    '500': '#0ea5e9',
    '600': '#0284c7',
    '700': '#0369a1',
    '800': '#075985',
    '900': '#0c4a6e',
  },
  blue: {
    '50': '#eff6ff',
    '100': '#dbeafe',
    '200': '#bfdbfe',
    '300': '#93c5fd',
    '400': '#60a5fa',
    '500': '#3b82f6',
    '600': '#2563eb',
    '700': '#1d4ed8',
    '800': '#1e40af',
    '900': '#1e3a8a',
    '950': '#172554',
  },
  indigo: {
    '50': '#eef2ff',
    '100': '#e0e7ff',
    '200': '#c7d2fe',
    '300': '#a5b4fc',
    '400': '#818cf8',
    '500': '#6366f1',
    '600': '#4f46e5',
    '700': '#4338ca',
    '800': '#3730a3',
    '900': '#312e81',
    '950': '#1e1b4b',
  },
  violet: {
    '50': '#f5f3ff',
    '100': '#ede9fe',
    '200': '#ddd6fe',
    '300': '#c4b5fd',
    '400': '#a78bfa',
    '500': '#8b5cf6',
    '600': '#7c3aed',
    '700': '#6d28d9',
    '800': '#5b21b6',
    '900': '#4c1d95',
  },
  purple: {
    '50': '#faf5ff',
    '100': '#f3e8ff',
    '200': '#e9d5ff',
    '300': '#d8b4fe',
    '400': '#c084fc',
    '500': '#a855f7',
    '600': '#9333ea',
    '700': '#7e22ce',
    '800': '#6b21a8',
    '900': '#581c87',
  },
  pink: {
    '50': '#fdf2f8',
    '100': '#fce7f3',
    '200': '#fbcfe8',
    '300': '#f9a8d4',
    '400': '#f472b6',
    '500': '#ec4899',
    '600': '#db2777',
    '700': '#be185d',
    '800': '#9d174d',
    '900': '#831843',
  },
  rose: {
    '50': '#fff1f2',
    '100': '#ffe4e6',
    '200': '#fecdd3',
    '300': '#fda4af',
    '400': '#fb7185',
    '500': '#f43f5e',
    '600': '#e11d48',
    '700': '#be123c',
    '800': '#9f1239',
    '900': '#881337',
  },
};

export function detectMarkupFormat(
  markup: string,
  hint: MarkupImportFormat = 'auto',
): 'html' | 'jsx' | 'svg' | 'svelte' | 'angular' {
  if (hint && hint !== 'auto') return hint;
  const raw = markup || '';
  if (
    /\{#(if|each|await|key)\b/.test(raw) ||
    /\bon:[a-zA-Z]+\s*=/.test(raw) ||
    /\bbind:[a-zA-Z]+\s*=/.test(raw) ||
    /\$state\s*\(/.test(raw)
  ) {
    return 'svelte';
  }
  if (
    /@Component\s*\(/.test(raw) ||
    /\*ng(If|For|Switch)\s*=/.test(raw) ||
    /@(if|for|switch)\s*\(/.test(raw) ||
    /\((click|ngSubmit|input|change|ngModelChange)\)\s*=/.test(raw)
  ) {
    return 'angular';
  }
  const trimmed = extractMarkupBody(markup).trim();
  if (/^<svg[\s>]/i.test(trimmed)) return 'svg';
  if (
    /\bclassName\s*=/.test(markup) ||
    /\bhtmlFor\s*=/.test(markup) ||
    /\bonClick\s*=\s*\{/.test(markup) ||
    /\bstyle\s*=\s*\{\{/.test(markup) ||
    /\bexport\s+(default\s+)?function\b/.test(markup)
  ) {
    return 'jsx';
  }
  return 'html';
}

/**
 * Unwraps Angular 17+/19 block control flow (`@if (...) { ... }`, `@else { ... }`,
 * `@for (...; track ...) { ... }`, `@empty { ... }`, `@switch (...) { ... }`, `@case (...) { ... }`)
 * while preserving inner HTML elements intact.
 */
function unwrapAngularControlFlowBlocks(input: string): string {
  let src = input;
  const headerRe = /@(?:else\s+if|if|for|switch|case)\s*\([^)]*\)\s*\{|@(?:else|empty|default)\s*\{/;
  let guard = 0;

  while (guard++ < 120) {
    const m = headerRe.exec(src);
    if (!m) break;
    const openBraceIdx = m.index + m[0].length - 1;
    let depth = 1;
    let i = openBraceIdx + 1;
    while (i < src.length && depth > 0) {
      if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
        const q = src[i++];
        while (i < src.length && src[i] !== q) {
          if (src[i] === '\\') i++;
          i++;
        }
      } else if (src[i] === '{' && src[i + 1] === '{') {
        i += 2;
        while (i < src.length && !(src[i] === '}' && src[i + 1] === '}')) i++;
        i++;
      } else if (src[i] === '{') {
        depth++;
      } else if (src[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }
    if (depth === 0) {
      const inner = src.slice(openBraceIdx + 1, i);
      src = src.slice(0, m.index) + inner + src.slice(i + 1);
    } else {
      break;
    }
  }
  return src;
}

function extractMarkupBody(raw: string): string {
  let cleaned = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .trim();

  // Extract inline Angular `@Component({ template: `...` })` if a `.component.ts` file was passed
  if (/@Component\s*\(/.test(cleaned)) {
    const inlineTplMatch = cleaned.match(/\btemplate\s*:\s*`([\s\S]*?)`/);
    if (inlineTplMatch) {
      cleaned = inlineTplMatch[1].trim();
    }
  }

  // Strip top-level <script> and <style> blocks early (critical for Svelte 5 / Vue SFCs)
  cleaned = cleaned
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .trim();

  // Strip Svelte control tags `{#if ...}`, `{:else ...}`, `{/if}`, `{#each ...}`, `{/each}`, `{@render ...}`
  cleaned = cleaned
    .replace(/\{#(?:if|each|await|key)\b[^}]*\}/g, '')
    .replace(/\{:(?:else(?:\s+if)?|then|catch)\b[^}]*\}/g, '')
    .replace(/\{\/(?:if|each|await|key)\s*\}/g, '')
    .replace(/\{@(?:render|const|html|debug)\b[^}]*\}/g, '')
    .trim();

  // Unwrap Angular 17+/19 `@if (...) { ... }` / `@for (...) { ... }` blocks
  if (/@(?:if|for|switch|else)\b/.test(cleaned)) {
    cleaned = unwrapAngularControlFlowBlocks(cleaned).trim();
  }

  // Unwrap React component wrapper `return ( <...> )` or arrow `=> ( <...> )` if pasted
  const returnMatch = cleaned.match(/\breturn\s*\(\s*(<[\s\S]*>)\s*\)\s*;?\s*\}?\s*$/);
  if (returnMatch) {
    cleaned = returnMatch[1].trim();
  } else {
    const arrowMatch = cleaned.match(/=>\s*\(\s*(<[\s\S]*>)\s*\)\s*;?\s*$/);
    if (arrowMatch) {
      cleaned = arrowMatch[1].trim();
    }
  }

  // Replace JSX fragments `<>...</>` or `<React.Fragment>...</React.Fragment>` with children
  cleaned = cleaned
    .replace(/^<>\s*/, '')
    .replace(/\s*<\/>$/, '')
    .replace(/<\/?(?:React\.)?Fragment>/g, '');

  // If full HTML document was pasted, extract <body> inner markup
  const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    cleaned = bodyMatch[1].trim();
  }

  return cleaned;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&euro;/gi, '€')
    .replace(/&copy;/gi, '©')
    .replace(/&rarr;/gi, '→')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));
}

function cleanTextContent(raw: string): string {
  // Unwrap Angular double-brace `{{ title }}` / `{{ statusBanner() }}`
  let unwrapped = raw.replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, (_m, expr: string) => {
    const cleanExpr = expr.replace(/\(\s*\)$/, '').trim();
    return cleanExpr || '';
  });
  // Unwrap simple JSX string expressions like `{"Save"}` or `{'Save'}`
  unwrapped = unwrapped.replace(/\{\s*(['"`])([\s\S]*?)\1\s*\}/g, '$2');
  // Unwrap simple Svelte/JSX identifier interpolations like `{statusMessage}`
  unwrapped = unwrapped.replace(/\{\s*([a-zA-Z_$][a-zA-Z0-9_$.]*)\s*\}/g, '$1');
  return decodeHtmlEntities(unwrapped).replace(/\s+/g, ' ').trim();
}

interface ScannedTagToken {
  type: 'open' | 'close' | 'self';
  tagName: string;
  attrs: Record<string, string>;
  endIndex: number;
}

function scanTagToken(src: string, startLt: number): ScannedTagToken | null {
  const len = src.length;
  if (src[startLt] !== '<') return null;

  let i = startLt + 1;
  while (i < len && /\s/.test(src[i])) i++;

  let isClosing = false;
  if (src[i] === '/') {
    isClosing = true;
    i++;
    while (i < len && /\s/.test(src[i])) i++;
  }

  const nameStart = i;
  while (i < len && /[a-zA-Z0-9:._-]/.test(src[i])) i++;
  const rawTagName = src.slice(nameStart, i);
  if (!rawTagName) return null;

  const normalizedTag = rawTagName.includes('.') ? rawTagName : rawTagName.toLowerCase();

  if (isClosing) {
    while (i < len && src[i] !== '>') i++;
    return {
      type: 'close',
      tagName: normalizedTag,
      attrs: {},
      endIndex: i < len ? i + 1 : len,
    };
  }

  const attrs: Record<string, string> = {};
  let selfClosing = false;

  while (i < len) {
    while (i < len && /\s/.test(src[i])) i++;
    if (i >= len) break;

    if (src[i] === '>') {
      i++;
      break;
    }
    if (src[i] === '/' && src[i + 1] === '>') {
      selfClosing = true;
      i += 2;
      break;
    }

    // Skip JSX spread `{...props}` safely
    if (src[i] === '{') {
      let depth = 1;
      i++;
      while (i < len && depth > 0) {
        if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
          const q = src[i++];
          while (i < len && src[i] !== q) {
            if (src[i] === '\\') i++;
            i++;
          }
        } else if (src[i] === '{') {
          depth++;
        } else if (src[i] === '}') {
          depth--;
        }
        i++;
      }
      continue;
    }

    const attrStart = i;
    while (i < len && !/[\s=/>{]/.test(src[i])) i++;
    const attrName = src.slice(attrStart, i);
    if (!attrName) {
      i++;
      continue;
    }

    while (i < len && /\s/.test(src[i])) i++;
    if (src[i] !== '=') {
      attrs[attrName] = 'true';
      continue;
    }
    i++; // skip '='
    while (i < len && /\s/.test(src[i])) i++;

    if (src[i] === '"' || src[i] === "'") {
      const quote = src[i++];
      const valStart = i;
      while (i < len && src[i] !== quote) {
        if (src[i] === '\\') i++;
        i++;
      }
      attrs[attrName] = decodeHtmlEntities(src.slice(valStart, i));
      if (i < len && src[i] === quote) i++;
    } else if (src[i] === '{') {
      let depth = 1;
      i++;
      const exprStart = i;
      while (i < len && depth > 0) {
        if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
          const q = src[i++];
          while (i < len && src[i] !== q) {
            if (src[i] === '\\') i++;
            i++;
          }
        } else if (src[i] === '{') {
          depth++;
        } else if (src[i] === '}') {
          depth--;
          if (depth === 0) break;
        }
        i++;
      }
      const rawExpr = src.slice(exprStart, i).trim();
      if (i < len && src[i] === '}') i++;

      // Unquote simple string literal inside `{ "..." }`
      if (
        (rawExpr.startsWith('"') && rawExpr.endsWith('"')) ||
        (rawExpr.startsWith("'") && rawExpr.endsWith("'")) ||
        (rawExpr.startsWith('`') && rawExpr.endsWith('`'))
      ) {
        attrs[attrName] = rawExpr.slice(1, -1);
      } else {
        attrs[attrName] = `{${rawExpr}}`;
      }
    } else {
      const valStart = i;
      while (i < len && !/[\s/>]/.test(src[i])) i++;
      attrs[attrName] = decodeHtmlEntities(src.slice(valStart, i));
    }
  }

  const isVoid = selfClosing || VOID_HTML_TAGS.has(normalizedTag.toLowerCase());
  return {
    type: isVoid ? 'self' : 'open',
    tagName: normalizedTag,
    attrs,
    endIndex: i,
  };
}

function parseMarkupToAst(src: string): { roots: ParsedAstNode[]; domIdMap: Map<string, NodeId> } {
  const roots: ParsedAstNode[] = [];
  const stack: Array<{ node: ParsedElementNode; openStart: number }> = [];
  const domIdMap = new Map<string, NodeId>();

  const pushNode = (astNode: ParsedAstNode) => {
    if (stack.length > 0) {
      stack[stack.length - 1].node.children.push(astNode);
    } else {
      roots.push(astNode);
    }
  };

  let cursor = 0;
  const len = src.length;

  while (cursor < len) {
    const nextLt = src.indexOf('<', cursor);
    if (nextLt === -1) {
      const trailing = cleanTextContent(src.slice(cursor));
      if (trailing) pushNode({ kind: 'text', text: trailing });
      break;
    }

    if (nextLt > cursor) {
      const textChunk = cleanTextContent(src.slice(cursor, nextLt));
      if (textChunk) pushNode({ kind: 'text', text: textChunk });
    }

    const token = scanTagToken(src, nextLt);
    if (!token) {
      cursor = nextLt + 1;
      continue;
    }

    if (token.type === 'close') {
      // Find matching open tag in stack
      let matchIdx = -1;
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].node.tag.toLowerCase() === token.tagName.toLowerCase()) {
          matchIdx = s;
          break;
        }
      }
      if (matchIdx !== -1) {
        while (stack.length > matchIdx) {
          const popped = stack.pop()!;
          popped.node.rawSource = src.slice(popped.openStart, token.endIndex);
          pushNode(popped.node);
        }
      }
      cursor = token.endIndex;
      continue;
    }

    // Skip <script> and <style> blocks
    const lowerTag = token.tagName.toLowerCase();
    if (lowerTag === 'script' || lowerTag === 'style') {
      if (token.type === 'self') {
        cursor = token.endIndex;
        continue;
      }
      const closeRe = new RegExp(`</${lowerTag}\\s*>`, 'ig');
      closeRe.lastIndex = token.endIndex;
      const closeMatch = closeRe.exec(src);
      cursor = closeMatch ? closeMatch.index + closeMatch[0].length : len;
      continue;
    }

    const assignedNodeId = generateNodeId('imp');
    if (token.attrs.id) {
      domIdMap.set(token.attrs.id.replace(/^#/, ''), assignedNodeId);
    }

    const elem: ParsedElementNode = {
      kind: 'element',
      tag: token.tagName,
      attrs: token.attrs,
      rawSource: src.slice(nextLt, token.endIndex),
      children: [],
      assignedNodeId,
    };

    if (token.type === 'self') {
      pushNode(elem);
    } else {
      stack.push({ node: elem, openStart: nextLt });
    }

    cursor = token.endIndex;
  }

  while (stack.length > 0) {
    const unclosed = stack.pop()!;
    unclosed.node.rawSource = src.slice(unclosed.openStart);
    pushNode(unclosed.node);
  }

  return { roots, domIdMap };
}

function parseSpacingValue(token: string): number | null {
  if (token === 'px') return 1;
  const arb = token.match(/^\[(\d+(?:\.\d+)?)(px|rem)?\]$/);
  if (arb) {
    const num = Number(arb[1]);
    return arb[2] === 'rem' ? Math.round(num * 16) : Math.round(num);
  }
  const num = Number(token);
  if (!Number.isNaN(num) && Number.isFinite(num)) {
    return Math.round(num * 4);
  }
  return null;
}

function resolveTailwindColor(colorToken: string): string | null {
  const clean = colorToken.split('/')[0]; // strip opacity suffix like bg-slate-900/80
  if (clean === 'white') return '#ffffff';
  if (clean === 'black') return '#000000';
  if (clean === 'transparent') return 'transparent';

  const arb = clean.match(/^\[(#[0-9a-fA-F]{3,8}|rgb\([^\]]+\)|rgba\([^\]]+\))\]$/);
  if (arb) return arb[1];

  const dashIdx = clean.lastIndexOf('-');
  if (dashIdx > 0) {
    const family = clean.slice(0, dashIdx);
    const shade = clean.slice(dashIdx + 1);
    const found = TAILWIND_PALETTE[family]?.[shade];
    if (found) return found;
  }
  return null;
}

function parseRadiusToken(suffix: string): number | null {
  switch (suffix) {
    case 'none':
      return 0;
    case 'sm':
      return 4;
    case '':
      return 6;
    case 'md':
      return 8;
    case 'lg':
      return 12;
    case 'xl':
      return 16;
    case '2xl':
      return 20;
    case '3xl':
      return 24;
    case 'full':
      return 9999;
    default: {
      const arb = suffix.match(/^\[(\d+)px\]$/);
      return arb ? Number(arb[1]) : null;
    }
  }
}

function parseShadowToken(suffix: string): StyleShadow | null {
  switch (suffix) {
    case 'sm':
      return { x: 0, y: 1, blur: 2, spread: 0, color: 'rgba(15, 23, 42, 0.06)' };
    case '':
      return { x: 0, y: 2, blur: 6, spread: 0, color: 'rgba(15, 23, 42, 0.1)' };
    case 'md':
      return { x: 0, y: 4, blur: 10, spread: -1, color: 'rgba(15, 23, 42, 0.12)' };
    case 'lg':
      return { x: 0, y: 10, blur: 18, spread: -3, color: 'rgba(15, 23, 42, 0.16)' };
    case 'xl':
    case '2xl':
      return { x: 0, y: 20, blur: 28, spread: -5, color: 'rgba(15, 23, 42, 0.22)' };
    default:
      return null;
  }
}

function parseInlineStyles(styleAttr: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!styleAttr) return out;
  const trimmed = styleAttr.trim();

  // JSX object syntax `{{ backgroundColor: '#1e293b', padding: 16 }}`
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    let inner = trimmed.slice(1, -1).trim();
    if (inner.startsWith('{') && inner.endsWith('}')) {
      inner = inner.slice(1, -1).trim();
    }
    const propRe = /([a-zA-Z0-9_-]+)\s*:\s*(?:'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?))/g;
    let m: RegExpExecArray | null;
    while ((m = propRe.exec(inner)) !== null) {
      const kebabKey = m[1].replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
      const val = m[2] ?? m[3] ?? (m[4] ? `${m[4]}px` : '');
      out[kebabKey] = val.trim();
    }
    return out;
  }

  // Standard HTML CSS `style="background: #fff; padding: 12px 16px;"`
  for (const decl of trimmed.split(';')) {
    const colon = decl.indexOf(':');
    if (colon <= 0) continue;
    const key = decl.slice(0, colon).trim().toLowerCase();
    const val = decl.slice(colon + 1).trim();
    if (key && val) out[key] = val;
  }
  return out;
}

function parsePxNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = raw.trim().match(/^(-?\d+(?:\.\d+)?)(px|rem)?$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2]?.toLowerCase() === 'rem' ? Math.round(n * 16) : Math.round(n);
}

interface InferredNodeSpecs {
  layout: Partial<LayoutSpec>;
  style: Partial<StyleSpec>;
  typography: Partial<TypographySpec>;
  hasExplicitTypography: boolean;
  stateOverrides: UINode['stateOverrides'];
}

function inferSpecsFromClassesAndStyle(
  classAttr: string | undefined,
  styleAttr: string | undefined,
  isContainerLike: boolean,
): InferredNodeSpecs {
  const layout: Partial<LayoutSpec> = {};
  const style: Partial<StyleSpec> = {};
  const typography: Partial<TypographySpec> = {};
  let hasExplicitTypography = false;
  const stateOverrides: NonNullable<UINode['stateOverrides']> = {};

  const padding: PaddingBox = isContainerLike
    ? { top: 16, right: 16, bottom: 16, left: 16 }
    : { top: 8, right: 12, bottom: 8, left: 12 };
  let hasCustomPadding = false;

  const classes = (classAttr ?? '')
    .split(/\s+/)
    .map((c) => c.trim())
    .filter(Boolean);

  for (const rawCls of classes) {
    let stateKey: InteractiveStateKey | null = null;
    let cls = rawCls;
    const parts = rawCls.split(':');
    if (parts.length >= 2) {
      const prefix = parts[0];
      cls = parts[parts.length - 1];
      if (
        prefix === 'hover' ||
        prefix === 'focus' ||
        prefix === 'active' ||
        prefix === 'disabled' ||
        prefix === 'dark'
      ) {
        stateKey = prefix;
      }
    }

    if (stateKey) {
      if (cls.startsWith('bg-')) {
        const col = resolveTailwindColor(cls.slice(3));
        if (col) {
          stateOverrides[stateKey] = {
            ...(stateOverrides[stateKey] ?? {}),
            style: {
              ...(stateOverrides[stateKey]?.style ?? {}),
              fills: [{ type: 'solid', color: col }],
            },
          };
        }
      } else if (cls.startsWith('text-')) {
        const col = resolveTailwindColor(cls.slice(5));
        if (col) {
          stateOverrides[stateKey] = {
            ...(stateOverrides[stateKey] ?? {}),
            typography: {
              ...(stateOverrides[stateKey]?.typography ?? {}),
              color: col,
            },
          };
        }
      }
      continue;
    }

    // Layout mode & direction
    if (cls === 'flex' || cls === 'inline-flex') {
      layout.mode = 'flex';
      if (!layout.direction) layout.direction = 'row';
    } else if (cls === 'flex-row') {
      layout.mode = 'flex';
      layout.direction = 'row';
    } else if (cls === 'flex-col') {
      layout.mode = 'flex';
      layout.direction = 'column';
    } else if (cls === 'flex-wrap') {
      layout.wrap = true;
    } else if (cls === 'grid') {
      layout.mode = 'grid';
      if (!layout.gridCols) {
        layout.gridCols = [{ track: 'fr', value: 1 }, { track: 'fr', value: 1 }];
      }
    } else if (cls.startsWith('grid-cols-')) {
      const count = Number(cls.slice('grid-cols-'.length));
      if (Number.isInteger(count) && count >= 1 && count <= 12) {
        layout.mode = 'grid';
        const tracks: GridTrackSpec[] = Array.from({ length: count }, () => ({ track: 'fr', value: 1 }));
        layout.gridCols = tracks;
      }
    } else if (cls.startsWith('gap-x-')) {
      const g = parseSpacingValue(cls.slice(6));
      if (g !== null) layout.columnGap = g;
    } else if (cls.startsWith('gap-y-')) {
      const g = parseSpacingValue(cls.slice(6));
      if (g !== null) layout.rowGap = g;
    } else if (cls.startsWith('gap-')) {
      const g = parseSpacingValue(cls.slice(4));
      if (g !== null) layout.gap = g;
    } else if (cls.startsWith('space-y-')) {
      const g = parseSpacingValue(cls.slice(8));
      if (g !== null) {
        layout.mode = 'flex';
        layout.direction = 'column';
        layout.gap = g;
      }
    } else if (cls.startsWith('space-x-')) {
      const g = parseSpacingValue(cls.slice(8));
      if (g !== null) {
        layout.mode = 'flex';
        layout.direction = 'row';
        layout.gap = g;
      }
    } else if (cls.startsWith('justify-')) {
      const j = cls.slice(8);
      if (j === 'start') layout.justify = 'start';
      else if (j === 'center') layout.justify = 'center';
      else if (j === 'end') layout.justify = 'end';
      else if (j === 'between') layout.justify = 'space-between';
      else if (j === 'around') layout.justify = 'space-around';
      else if (j === 'evenly') layout.justify = 'space-evenly';
    } else if (cls.startsWith('items-')) {
      const a = cls.slice(6);
      if (a === 'start') layout.align = 'start';
      else if (a === 'center') layout.align = 'center';
      else if (a === 'end') layout.align = 'end';
      else if (a === 'stretch') layout.align = 'stretch';
      else if (a === 'baseline') layout.align = 'baseline';
    } else if (cls.startsWith('p-')) {
      const v = parseSpacingValue(cls.slice(2));
      if (v !== null) {
        padding.top = v;
        padding.right = v;
        padding.bottom = v;
        padding.left = v;
        hasCustomPadding = true;
      }
    } else if (cls.startsWith('px-')) {
      const v = parseSpacingValue(cls.slice(3));
      if (v !== null) {
        padding.left = v;
        padding.right = v;
        hasCustomPadding = true;
      }
    } else if (cls.startsWith('py-')) {
      const v = parseSpacingValue(cls.slice(3));
      if (v !== null) {
        padding.top = v;
        padding.bottom = v;
        hasCustomPadding = true;
      }
    } else if (cls.startsWith('pt-')) {
      const v = parseSpacingValue(cls.slice(3));
      if (v !== null) {
        padding.top = v;
        hasCustomPadding = true;
      }
    } else if (cls.startsWith('pr-')) {
      const v = parseSpacingValue(cls.slice(3));
      if (v !== null) {
        padding.right = v;
        hasCustomPadding = true;
      }
    } else if (cls.startsWith('pb-')) {
      const v = parseSpacingValue(cls.slice(3));
      if (v !== null) {
        padding.bottom = v;
        hasCustomPadding = true;
      }
    } else if (cls.startsWith('pl-')) {
      const v = parseSpacingValue(cls.slice(3));
      if (v !== null) {
        padding.left = v;
        hasCustomPadding = true;
      }
    } else if (cls === 'w-full' || cls === 'flex-1' || cls === 'grow') {
      layout.width = { mode: 'fill' };
    } else if (cls === 'w-fit' || cls === 'w-auto') {
      layout.width = { mode: 'hug' };
    } else if (cls.startsWith('w-')) {
      const px = parseSpacingValue(cls.slice(2));
      if (px !== null && px > 0) {
        layout.width = { mode: 'fixed', value: px };
      }
    } else if (cls === 'h-full') {
      layout.height = { mode: 'fill' };
    } else if (cls === 'h-fit' || cls === 'h-auto') {
      layout.height = { mode: 'hug' };
    } else if (cls.startsWith('h-')) {
      const px = parseSpacingValue(cls.slice(2));
      if (px !== null && px > 0) {
        layout.height = { mode: 'fixed', value: px };
      }
    } else if (cls.startsWith('overflow-')) {
      const ov = cls.slice(9);
      if (ov === 'hidden' || ov === 'scroll' || ov === 'auto' || ov === 'visible') {
        layout.overflow = ov;
      }
    } else if (cls.startsWith('bg-')) {
      const col = resolveTailwindColor(cls.slice(3));
      if (col && col !== 'transparent') {
        const fills: StyleFill[] = [{ type: 'solid', color: col }];
        style.fills = fills;
      }
    } else if (cls === 'rounded' || cls.startsWith('rounded-')) {
      const suffix = cls === 'rounded' ? '' : cls.slice('rounded-'.length);
      const rad = parseRadiusToken(suffix);
      if (rad !== null) style.radius = rad;
    } else if (cls === 'border' || cls.startsWith('border-')) {
      const suffix = cls === 'border' ? '' : cls.slice('border-'.length);
      if (suffix === '0' || suffix === 'none') {
        style.border = undefined;
      } else if (suffix === '' || suffix === '2' || suffix === '4') {
        const bw = suffix === '' ? 1 : Number(suffix);
        style.border = {
          width: bw,
          style: style.border?.style ?? 'solid',
          color: style.border?.color ?? '#e2e8f0',
        };
      } else if (suffix === 'dashed' || suffix === 'dotted' || suffix === 'solid') {
        style.border = {
          width: style.border?.width ?? 1,
          style: suffix,
          color: style.border?.color ?? '#e2e8f0',
        };
      } else {
        const col = resolveTailwindColor(suffix);
        if (col) {
          style.border = {
            width: style.border?.width ?? 1,
            style: style.border?.style ?? 'solid',
            color: col,
          };
        }
      }
    } else if (cls === 'shadow' || cls.startsWith('shadow-')) {
      const suffix = cls === 'shadow' ? '' : cls.slice('shadow-'.length);
      const sh = parseShadowToken(suffix);
      if (sh) style.shadows = [sh];
    } else if (cls.startsWith('opacity-')) {
      const opNum = Number(cls.slice(8));
      if (!Number.isNaN(opNum)) style.opacity = Math.max(0, Math.min(1, opNum / 100));
    } else if (cls === 'backdrop-blur' || cls.startsWith('backdrop-blur-')) {
      style.backdropBlur = cls.endsWith('lg') ? 16 : cls.endsWith('sm') ? 4 : 8;
    } else if (cls.startsWith('text-')) {
      const rest = cls.slice(5);
      const sizeMap: Record<string, number> = {
        xs: 12,
        sm: 14,
        base: 16,
        lg: 18,
        xl: 20,
        '2xl': 24,
        '3xl': 30,
        '4xl': 36,
        '5xl': 48,
      };
      if (rest in sizeMap) {
        typography.fontSize = sizeMap[rest];
        hasExplicitTypography = true;
      } else if (rest === 'left' || rest === 'center' || rest === 'right' || rest === 'justify') {
        typography.textAlign = rest;
        hasExplicitTypography = true;
      } else {
        const arbSize = rest.match(/^\[(\d+)px\]$/);
        if (arbSize) {
          typography.fontSize = Number(arbSize[1]);
          hasExplicitTypography = true;
        } else {
          const col = resolveTailwindColor(rest);
          if (col) {
            typography.color = col;
            hasExplicitTypography = true;
          }
        }
      }
    } else if (cls.startsWith('font-')) {
      const rest = cls.slice(5);
      const weightMap: Record<string, number> = {
        thin: 100,
        extralight: 200,
        light: 300,
        normal: 400,
        medium: 500,
        semibold: 600,
        bold: 700,
        extrabold: 800,
        black: 900,
      };
      if (rest in weightMap) {
        typography.fontWeight = weightMap[rest];
        hasExplicitTypography = true;
      } else if (rest === 'mono') {
        typography.fontFamily = { $token: 'font.mono' };
        hasExplicitTypography = true;
      } else if (rest === 'sans') {
        typography.fontFamily = { $token: 'font.sans' };
        hasExplicitTypography = true;
      }
    } else if (cls === 'underline') {
      typography.textDecoration = 'underline';
      hasExplicitTypography = true;
    } else if (cls === 'line-through') {
      typography.textDecoration = 'line-through';
      hasExplicitTypography = true;
    }
  }

  // Merge inline `style` overrides
  const inline = parseInlineStyles(styleAttr);
  if (inline.display === 'flex' || inline.display === 'inline-flex') {
    layout.mode = 'flex';
    layout.direction = inline['flex-direction'] === 'column' ? 'column' : (layout.direction ?? 'row');
  } else if (inline.display === 'grid') {
    layout.mode = 'grid';
  }
  if (inline['flex-direction'] === 'column') {
    layout.mode = 'flex';
    layout.direction = 'column';
  } else if (inline['flex-direction'] === 'row') {
    layout.mode = 'flex';
    layout.direction = 'row';
  }
  if (inline['justify-content']) {
    const jc = inline['justify-content'];
    if (jc.includes('between')) layout.justify = 'space-between';
    else if (jc.includes('around')) layout.justify = 'space-around';
    else if (jc.includes('evenly')) layout.justify = 'space-evenly';
    else if (jc.includes('center')) layout.justify = 'center';
    else if (jc.includes('end')) layout.justify = 'end';
    else layout.justify = 'start';
  }
  if (inline['align-items']) {
    const ai = inline['align-items'];
    if (ai.includes('center')) layout.align = 'center';
    else if (ai.includes('end')) layout.align = 'end';
    else if (ai.includes('stretch')) layout.align = 'stretch';
    else if (ai.includes('baseline')) layout.align = 'baseline';
    else layout.align = 'start';
  }
  const inlineGap = parsePxNumber(inline.gap);
  if (inlineGap !== undefined) layout.gap = inlineGap;

  if (inline.padding) {
    const parts = inline.padding.split(/\s+/).map((p) => parsePxNumber(p) ?? 0);
    if (parts.length === 1) {
      padding.top = parts[0];
      padding.right = parts[0];
      padding.bottom = parts[0];
      padding.left = parts[0];
    } else if (parts.length === 2) {
      padding.top = parts[0];
      padding.bottom = parts[0];
      padding.left = parts[1];
      padding.right = parts[1];
    } else if (parts.length >= 4) {
      padding.top = parts[0];
      padding.right = parts[1];
      padding.bottom = parts[2];
      padding.left = parts[3];
    }
    hasCustomPadding = true;
  }

  const inlineW = parsePxNumber(inline.width);
  if (inlineW !== undefined && inlineW > 0) {
    layout.width = { mode: 'fixed', value: inlineW };
  } else if (inline.width === '100%') {
    layout.width = { mode: 'fill' };
  }
  const inlineH = parsePxNumber(inline.height);
  if (inlineH !== undefined && inlineH > 0) {
    layout.height = { mode: 'fixed', value: inlineH };
  }

  const bgInline = inline['background-color'] ?? inline.background;
  if (bgInline && !bgInline.includes('gradient') && bgInline !== 'transparent' && bgInline !== 'none') {
    style.fills = [{ type: 'solid', color: bgInline }];
  }
  const radInline = parsePxNumber(inline['border-radius']);
  if (radInline !== undefined) style.radius = radInline;

  if (inline['border-color']) {
    style.border = {
      width: parsePxNumber(inline['border-width']) ?? 1,
      style: 'solid',
      color: inline['border-color'],
    };
  } else if (inline.border && inline.border !== 'none') {
    const colorMatch = inline.border.match(/(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/);
    const widthMatch = inline.border.match(/(\d+)px/);
    style.border = {
      width: widthMatch ? Number(widthMatch[1]) : 1,
      style: inline.border.includes('dashed') ? 'dashed' : 'solid',
      color: colorMatch ? colorMatch[1] : '#cbd5e1',
    };
  }

  if (inline.color) {
    typography.color = inline.color;
    hasExplicitTypography = true;
  }
  const fsInline = parsePxNumber(inline['font-size']);
  if (fsInline !== undefined) {
    typography.fontSize = fsInline;
    hasExplicitTypography = true;
  }
  if (inline['font-weight']) {
    const fwNum = Number(inline['font-weight']);
    typography.fontWeight = Number.isNaN(fwNum) ? inline['font-weight'] : fwNum;
    hasExplicitTypography = true;
  }
  if (
    inline['text-align'] === 'left' ||
    inline['text-align'] === 'center' ||
    inline['text-align'] === 'right' ||
    inline['text-align'] === 'justify'
  ) {
    typography.textAlign = inline['text-align'];
    hasExplicitTypography = true;
  }

  if (hasCustomPadding) {
    layout.padding = padding;
  }

  return {
    layout,
    style,
    typography,
    hasExplicitTypography,
    stateOverrides: Object.keys(stateOverrides).length > 0 ? stateOverrides : undefined,
  };
}

function collectInnerText(node: ParsedElementNode): string {
  const chunks: string[] = [];
  const walk = (n: ParsedAstNode) => {
    if (n.kind === 'text') {
      if (n.text) chunks.push(n.text);
    } else {
      for (const c of n.children) walk(c);
    }
  };
  walk(node);
  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}

function extractSvgMetadata(svgNode: ParsedElementNode): {
  svgPath?: string;
  imageUrl: string;
  width: number;
  height: number;
  title?: string;
} {
  const paths: string[] = [];
  let title: string | undefined;

  const walkSvg = (el: ParsedElementNode) => {
    const t = el.tag.toLowerCase();
    if (t === 'path' && el.attrs.d) {
      paths.push(el.attrs.d.trim());
    } else if (t === 'title') {
      const txt = collectInnerText(el);
      if (txt) title = txt;
    }
    for (const c of el.children) {
      if (c.kind === 'element') walkSvg(c);
    }
  };
  walkSvg(svgNode);

  let width = parsePxNumber(svgNode.attrs.width) ?? 0;
  let height = parsePxNumber(svgNode.attrs.height) ?? 0;

  if ((!width || !height) && svgNode.attrs.viewBox) {
    const vbParts = svgNode.attrs.viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (vbParts.length === 4 && !vbParts.some(Number.isNaN)) {
      if (!width) width = Math.max(16, Math.round(vbParts[2]));
      if (!height) height = Math.max(16, Math.round(vbParts[3]));
    }
  }
  if (!width) width = 48;
  if (!height) height = 48;

  const rawSvg = svgNode.rawSource.includes('xmlns=')
    ? svgNode.rawSource
    : svgNode.rawSource.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  const imageUrl = `data:image/svg+xml;utf8,${encodeURIComponent(rawSvg)}`;

  return {
    svgPath: paths.length > 0 ? paths.join(' ') : undefined,
    imageUrl,
    width,
    height,
    title,
  };
}

function extractHtmxExtension(
  attrs: Record<string, string>,
  domIdMap: Map<string, NodeId>,
): HtmxExtensionSpec | undefined {
  const methods: Array<HtmxExtensionSpec['method']> = ['hx-get', 'hx-post', 'hx-put', 'hx-patch', 'hx-delete'];
  const foundMethod = methods.find((m) => Boolean(attrs[m]));
  if (!foundMethod) return undefined;

  const rawTarget = attrs['hx-target']?.trim();
  let targetNodeId: NodeId | undefined;
  if (rawTarget && rawTarget.startsWith('#')) {
    targetNodeId = domIdMap.get(rawTarget.slice(1));
  }

  const rawSwap = attrs['hx-swap']?.trim().split(/\s+/)[0] as HtmxSwapMode | undefined;
  const hxSwap: HtmxSwapMode = rawSwap && VALID_HTMX_SWAPS.has(rawSwap) ? rawSwap : 'innerHTML';

  const rawIndicator = attrs['hx-indicator']?.trim();
  const indicatorNodeId =
    rawIndicator && rawIndicator.startsWith('#') ? domIdMap.get(rawIndicator.slice(1)) : undefined;

  const rawPushUrl = attrs['hx-push-url'];
  const pushUrl =
    rawPushUrl === 'true' ? true : rawPushUrl === 'false' ? false : rawPushUrl ? rawPushUrl : undefined;

  return {
    method: foundMethod,
    endpoint: attrs[foundMethod],
    targetNodeId,
    targetSelectorFallback: rawTarget,
    hxSwap,
    hxTrigger: attrs['hx-trigger'],
    indicatorNodeId,
    confirmPrompt: attrs['hx-confirm'],
    pushUrl,
    hxValsJson: attrs['hx-vals'],
  };
}

function parseHandlerIdentifier(rawExpr: string): string | null {
  const cleaned = rawExpr
    .replace(/^\{|\}$/g, '')
    .replace(/^\(\s*\)\s*=>\s*/, '')
    .replace(/^\([^)]*\)\s*=>\s*/, '')
    .replace(/^this\./, '')
    .trim();
  const callMatch = cleaned.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/);
  if (callMatch) return callMatch[1];
  const identMatch = cleaned.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)$/);
  if (identMatch) return identMatch[1];
  return null;
}

function extractInteractions(attrs: Record<string, string>): EventActionBinding[] | undefined {
  const list: EventActionBinding[] = [];
  const rawOnClick =
    attrs.onClick ??
    attrs.onclick ??
    attrs['on:click'] ??
    attrs['(click)'] ??
    attrs['on-click'] ??
    attrs.onPress;
  if (rawOnClick) {
    const fnName = parseHandlerIdentifier(rawOnClick);
    list.push({
      trigger: 'onClick',
      action: {
        kind: 'call_handler',
        handlerName: fnName ?? 'handleImportedClick',
      },
    });
  }

  const rawOnSubmit =
    attrs.onSubmit ?? attrs.onsubmit ?? attrs['on:submit'] ?? attrs['(ngSubmit)'] ?? attrs['(submit)'];
  if (rawOnSubmit) {
    const fnName = parseHandlerIdentifier(rawOnSubmit);
    list.push({
      trigger: 'onSubmit',
      action: {
        kind: 'call_handler',
        handlerName: fnName ?? 'handleImportedSubmit',
      },
    });
  }

  const rawOnInput =
    attrs.onInput ??
    attrs.oninput ??
    attrs['on:input'] ??
    attrs['(input)'] ??
    attrs['(ngModelChange)'] ??
    attrs.onChangeText;
  if (rawOnInput) {
    const fnName = parseHandlerIdentifier(rawOnInput);
    if (fnName) {
      list.push({
        trigger: 'onInput',
        action: {
          kind: 'call_handler',
          handlerName: fnName,
        },
      });
    }
  }

  if (attrs.href && !attrs.href.startsWith('javascript:')) {
    list.push({
      trigger: 'onClick',
      action: {
        kind: 'navigate',
        targetSheetOrRoute: attrs.href,
      },
    });
  }
  return list.length > 0 ? list : undefined;
}

function deriveReadableNodeName(el: ParsedElementNode, kind: UINodeKind, textHint?: string): string {
  if (el.attrs.id) {
    return el.attrs.id
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');
  }
  if (el.attrs['data-name'] || el.attrs['aria-label']) {
    const label = (el.attrs['data-name'] ?? el.attrs['aria-label'])
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .slice(0, 28);
    if (label) {
      return label
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join('');
    }
  }
  // Custom JSX PascalCase tag name like `<HeroCard>`
  if (/^[A-Z]/.test(el.tag)) {
    return el.tag.replace(/[^a-zA-Z0-9]/g, '');
  }
  if (textHint) {
    const words = textHint
      .replace(/[^a-zA-Z0-9À-ÿ]+/g, ' ')
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .join('');
    if (words) {
      const suffix = kind === 'control' ? 'Control' : kind === 'text' ? 'Text' : '';
      return `${words.slice(0, 20)}${suffix}`;
    }
  }
  const tagCap = el.tag.charAt(0).toUpperCase() + el.tag.slice(1).toLowerCase();
  return `Imported${tagCap}`;
}

export function previewMarkupImport(
  sheet: UISheetDocument,
  parentId: NodeId | null,
  markup: string,
  format: MarkupImportFormat = 'auto',
): MarkupImportPreview {
  const warnings: string[] = [];
  const detectedFormat = detectMarkupFormat(markup, format);
  const body = extractMarkupBody(markup);

  if (!body) {
    return {
      detectedFormat,
      ops: [],
      nodeCount: 0,
      rootNodeIds: [],
      warnings: ['Nessun markup valido rilevato da importare.'],
    };
  }

  const resolvedRootParentId: NodeId | null =
    parentId !== null
      ? sheet.nodes[parentId]
        ? parentId
        : (sheet.rootIds[0] ?? null)
      : null;

  const { roots, domIdMap } = parseMarkupToAst(body);
  const ops: UIPatchOp[] = [];
  const rootNodeIds: NodeId[] = [];

  const emitAstNode = (ast: ParsedAstNode, targetParentId: NodeId | null, siblingIndex?: number): void => {
    if (ast.kind === 'text') {
      if (!ast.text) return;
      const txtId = generateNodeId('imp_txt');
      const hydratedText = createDefaultUINode(
        {
          id: txtId,
          parentId: targetParentId,
          kind: 'text',
          name: deriveReadableNodeName(
            { kind: 'element', tag: 'span', attrs: {}, rawSource: '', children: [], assignedNodeId: txtId },
            'text',
            ast.text,
          ),
          semanticTag: 'span',
          content: { text: ast.text },
        },
        sheet.sheetId,
      );
      if (targetParentId === resolvedRootParentId) rootNodeIds.push(txtId);
      ops.push({ op: 'insert_node', parentId: targetParentId, index: siblingIndex, node: hydratedText });
      return;
    }

    const el = ast;
    const lowerTag = el.tag.toLowerCase();
    const classStr = el.attrs.class ?? el.attrs.className;
    const styleStr = el.attrs.style;

    // 1. Atomic SVG Media Node
    if (lowerTag === 'svg') {
      const svgMeta = extractSvgMetadata(el);
      const specs = inferSpecsFromClassesAndStyle(classStr, styleStr, false);
      const finalW =
        specs.layout.width?.mode === 'fixed' && typeof specs.layout.width.value === 'number'
          ? specs.layout.width.value
          : svgMeta.width;
      const finalH =
        specs.layout.height?.mode === 'fixed' && typeof specs.layout.height.value === 'number'
          ? specs.layout.height.value
          : svgMeta.height;

      const strokeOrFillColor =
        (typeof specs.typography.color === 'string' ? specs.typography.color : undefined) ??
        (el.attrs.stroke && el.attrs.stroke !== 'none' && el.attrs.stroke !== 'currentColor'
          ? el.attrs.stroke
          : undefined) ??
        (el.attrs.fill && el.attrs.fill !== 'none' && el.attrs.fill !== 'currentColor'
          ? el.attrs.fill
          : undefined);

      const ariaLabel = el.attrs['aria-label'] ?? svgMeta.title ?? 'Imported SVG Graphic';
      const svgNode = createDefaultUINode(
        {
          id: el.assignedNodeId,
          parentId: targetParentId,
          kind: 'media',
          name: deriveReadableNodeName(el, 'media', svgMeta.title),
          semanticTag: 'div',
          layout: {
            mode: 'freeform',
            positioning: 'flow',
            frame: { x: 0, y: 0, width: finalW, height: finalH },
            width: specs.layout.width ?? { mode: 'fixed', value: finalW },
            height: specs.layout.height ?? { mode: 'fixed', value: finalH },
            padding: specs.layout.padding ?? { top: 0, right: 0, bottom: 0, left: 0 },
          },
          style: {
            ...specs.style,
          },
          typography: strokeOrFillColor
            ? {
                fontFamily: { $token: 'font.sans' },
                fontSize: 14,
                fontWeight: 400,
                color: strokeOrFillColor,
              }
            : undefined,
          content: {
            svgPath: svgMeta.svgPath,
            imageUrl: svgMeta.imageUrl,
            text: ariaLabel,
          },
          platform: {
            a11y: {
              role: el.attrs.role ?? 'img',
              ariaLabel,
            },
          },
        },
        sheet.sheetId,
      );

      if (targetParentId === resolvedRootParentId) rootNodeIds.push(svgNode.id);
      ops.push({ op: 'insert_node', parentId: targetParentId, index: siblingIndex, node: svgNode });
      return;
    }

    // 2. Atomic Image Media Node
    if (lowerTag === 'img') {
      const specs = inferSpecsFromClassesAndStyle(classStr, styleStr, false);
      const w = parsePxNumber(el.attrs.width) ?? 240;
      const h = parsePxNumber(el.attrs.height) ?? 160;
      const altText = el.attrs.alt ?? el.attrs['aria-label'] ?? 'Image';
      const imgNode = createDefaultUINode(
        {
          id: el.assignedNodeId,
          parentId: targetParentId,
          kind: 'media',
          name: deriveReadableNodeName(el, 'media', altText),
          semanticTag: 'div',
          layout: {
            mode: 'freeform',
            positioning: 'flow',
            frame: { x: 0, y: 0, width: w, height: h },
            width: specs.layout.width ?? { mode: 'fixed', value: w },
            height: specs.layout.height ?? { mode: 'fixed', value: h },
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
          },
          style: {
            radius: specs.style.radius ?? 8,
            ...specs.style,
          },
          content: {
            imageUrl: el.attrs.src ?? '',
            text: altText,
          },
          platform: {
            a11y: {
              role: 'img',
              ariaLabel: altText,
            },
          },
        },
        sheet.sheetId,
      );
      if (targetParentId === resolvedRootParentId) rootNodeIds.push(imgNode.id);
      ops.push({ op: 'insert_node', parentId: targetParentId, index: siblingIndex, node: imgNode });
      return;
    }

    // 3. Determine Element Category (Control vs Text vs Container)
    const elementChildren = el.children.filter((c): c is ParsedElementNode => c.kind === 'element');
    const inlineTextTags = new Set(['span', 'strong', 'b', 'em', 'i', 'small', 'code', 'u']);
    const onlyInlineFormattingChildren =
      elementChildren.length > 0 &&
      elementChildren.every((c) => inlineTextTags.has(c.tag.toLowerCase()) && c.children.every((gc) => gc.kind === 'text'));

    const isControlTag =
      lowerTag === 'button' ||
      lowerTag === 'pressable' ||
      lowerTag === 'touchableopacity' ||
      lowerTag === 'input' ||
      lowerTag === 'textinput' ||
      lowerTag === 'select' ||
      lowerTag === 'textarea';
    const isHeadingTag = lowerTag === 'h1' || lowerTag === 'h2' || lowerTag === 'h3' || lowerTag === 'h4';
    const isPureTextTag =
      isHeadingTag ||
      lowerTag === 'p' ||
      lowerTag === 'text' ||
      lowerTag === 'span' ||
      lowerTag === 'label' ||
      lowerTag === 'strong' ||
      lowerTag === 'em' ||
      lowerTag === 'small' ||
      lowerTag === 'code';

    let kind: UINodeKind = 'container';
    let controlType: UIControlSubtype | undefined;
    let content: NodeContentSpec | undefined;

    if (isControlTag) {
      kind = 'control';
      if (lowerTag === 'button' || lowerTag === 'pressable' || lowerTag === 'touchableopacity') {
        const btnText = collectInnerText(el);
        controlType = btnText ? 'button' : 'icon-button';
        content = {
          controlType,
          text: btnText || el.attrs['aria-label'] || 'Button',
        };
      } else if (lowerTag === 'input' || lowerTag === 'textinput') {
        const inpType = (el.attrs.type ?? 'text').toLowerCase();
        if (inpType === 'checkbox') {
          controlType = 'checkbox';
          content = {
            controlType,
            checked: 'checked' in el.attrs || 'defaultChecked' in el.attrs,
            text: el.attrs['aria-label'] ?? el.attrs.name,
          };
        } else if (inpType === 'range') {
          controlType = 'slider';
          content = { controlType, value: el.attrs.value };
        } else if (inpType === 'password') {
          controlType = 'password';
          content = {
            controlType,
            placeholder: el.attrs.placeholder ?? '••••••••',
            value: el.attrs.value ?? el.attrs.defaultValue,
          };
        } else {
          controlType = 'text-input';
          content = {
            controlType,
            placeholder: el.attrs.placeholder ?? '',
            value: el.attrs.value ?? el.attrs.defaultValue,
          };
        }
      } else if (lowerTag === 'textarea') {
        controlType = 'textarea';
        content = {
          controlType,
          placeholder: el.attrs.placeholder ?? '',
          value: collectInnerText(el) || el.attrs.value || el.attrs.defaultValue,
        };
      } else if (lowerTag === 'select') {
        controlType = 'select';
        const options: string[] = [];
        let selectedVal: string | undefined;
        for (const child of elementChildren) {
          if (child.tag.toLowerCase() === 'option') {
            const optLabel = collectInnerText(child) || child.attrs.value || 'Option';
            options.push(optLabel);
            if ('selected' in child.attrs) selectedVal = optLabel;
          }
        }
        content = {
          controlType,
          options: options.length > 0 ? options : ['Option 1', 'Option 2'],
          value: selectedVal ?? options[0],
        };
      }
    } else if (lowerTag === 'hr') {
      kind = 'control';
      controlType = 'divider';
      content = { controlType: 'divider' };
    } else if ((isPureTextTag || lowerTag === 'a') && (elementChildren.length === 0 || onlyInlineFormattingChildren)) {
      kind = 'text';
      content = { text: collectInnerText(el) };
    }

    const isContainerLike = kind === 'container';
    const specs = inferSpecsFromClassesAndStyle(classStr, styleStr, isContainerLike);

    // Heading typography defaults when not explicitly overridden by classes/inline styles
    const headingSizes: Record<string, { size: number; weight: number }> = {
      h1: { size: 30, weight: 700 },
      h2: { size: 24, weight: 700 },
      h3: { size: 20, weight: 600 },
      h4: { size: 18, weight: 600 },
    };
    const headingDefault = headingSizes[lowerTag];

    const finalFontSize = specs.typography.fontSize ?? headingDefault?.size ?? (kind === 'control' ? 14 : 15);
    const finalFontWeight =
      specs.typography.fontWeight ?? headingDefault?.weight ?? (kind === 'control' ? 600 : 400);

    const semanticTag: SemanticTag = VALID_SEMANTIC_TAGS.has(lowerTag as SemanticTag)
      ? (lowerTag as SemanticTag)
      : kind === 'text'
        ? 'p'
        : 'div';

    const htmxSpec = extractHtmxExtension(el.attrs, domIdMap);
    const interactions = extractInteractions(el.attrs);
    const ariaLabel = el.attrs['aria-label'] ?? el.attrs.title;
    const role = el.attrs.role;
    const rawTabIdx = el.attrs.tabindex ?? el.attrs.tabIndex;
    const tabIndex = rawTabIdx !== undefined && !Number.isNaN(Number(rawTabIdx)) ? Number(rawTabIdx) : undefined;

    const platform: PlatformExtensions | undefined =
      htmxSpec || ariaLabel || role || tabIndex !== undefined
        ? {
            ...(htmxSpec ? { htmx: htmxSpec } : {}),
            ...(ariaLabel || role || tabIndex !== undefined
              ? { a11y: { role, ariaLabel, tabIndex } }
              : {}),
          }
        : undefined;

    const defaultWidthPx = isContainerLike ? 420 : kind === 'control' ? 180 : 240;
    const defaultHeightPx = isContainerLike
      ? 160
      : kind === 'control'
        ? lowerTag === 'textarea'
          ? 88
          : 40
        : Math.max(24, Math.round(Number(finalFontSize) * 1.45));

    const hydrated = createDefaultUINode(
      {
        id: el.assignedNodeId,
        parentId: targetParentId,
        kind,
        name: deriveReadableNodeName(el, kind, content?.text ?? content?.placeholder),
        semanticTag,
        layout: {
          mode: isContainerLike ? (specs.layout.mode ?? 'flex') : 'freeform',
          positioning: 'flow',
          direction: specs.layout.direction ?? 'column',
          wrap: specs.layout.wrap ?? false,
          justify: specs.layout.justify ?? 'start',
          align: specs.layout.align ?? (isContainerLike && specs.layout.direction === 'row' ? 'center' : 'stretch'),
          gap: specs.layout.gap ?? (isContainerLike ? 12 : 8),
          rowGap: specs.layout.rowGap,
          columnGap: specs.layout.columnGap,
          gridCols: specs.layout.gridCols,
          gridRows: specs.layout.gridRows,
          overflow: specs.layout.overflow ?? 'visible',
          frame: {
            x: 0,
            y: 0,
            width:
              specs.layout.width?.mode === 'fixed' && typeof specs.layout.width.value === 'number'
                ? specs.layout.width.value
                : defaultWidthPx,
            height:
              specs.layout.height?.mode === 'fixed' && typeof specs.layout.height.value === 'number'
                ? specs.layout.height.value
                : defaultHeightPx,
          },
          width:
            specs.layout.width ??
            (isContainerLike
              ? { mode: 'fill', value: defaultWidthPx }
              : controlType === 'text-input' || controlType === 'textarea' || controlType === 'select'
                ? { mode: 'fill', value: defaultWidthPx }
                : { mode: 'hug', value: defaultWidthPx }),
          height:
            specs.layout.height ??
            (kind === 'control'
              ? { mode: 'fixed', value: defaultHeightPx }
              : { mode: 'hug', value: defaultHeightPx }),
          padding:
            specs.layout.padding ??
            (isContainerLike
              ? { top: 16, right: 16, bottom: 16, left: 16 }
              : kind === 'control'
                ? { top: 8, right: 16, bottom: 8, left: 16 }
                : { top: 0, right: 0, bottom: 0, left: 0 }),
        },
        style: {
          ...specs.style,
        },
        typography:
          kind === 'text' || kind === 'control' || specs.hasExplicitTypography
            ? {
                fontFamily: specs.typography.fontFamily ?? { $token: 'font.sans' },
                fontSize: finalFontSize,
                fontWeight: finalFontWeight,
                lineHeight: isHeadingTag ? 1.25 : 1.45,
                textAlign:
                  specs.typography.textAlign ??
                  (kind === 'control' && controlType === 'button' ? 'center' : 'left'),
                color:
                  specs.typography.color ??
                  (kind === 'control' && controlType === 'button' && !specs.style.fills
                    ? '#ffffff'
                    : { $token: 'color.text.primary' }),
                textDecoration: specs.typography.textDecoration,
              }
            : undefined,
        content,
        stateOverrides: specs.stateOverrides,
        interactions,
        platform,
      },
      sheet.sheetId,
    );

    if (targetParentId === resolvedRootParentId) {
      rootNodeIds.push(hydrated.id);
    }
    ops.push({
      op: 'insert_node',
      parentId: targetParentId,
      index: siblingIndex,
      node: hydrated,
    });

    // Recurse into children only for container nodes
    if (isContainerLike) {
      el.children.forEach((child, idx) => {
        emitAstNode(child, hydrated.id, idx);
      });
    }
  };

  roots.forEach((rootAst) => {
    emitAstNode(rootAst, resolvedRootParentId);
  });

  if (ops.length === 0) {
    warnings.push('Nessun elemento convertibile trovato nel markup incollato.');
  }

  return {
    detectedFormat,
    ops,
    nodeCount: ops.length,
    rootNodeIds,
    warnings,
  };
}

/**
 * Deterministic reverse compiler converting pasted HTML, Tailwind, HTMX (`hx-*`),
 * React JSX (`className`, `style={{...}}`), or `<svg>` markup into structured `UIPatchOp[]` (`insert_node`).
 */
export function importMarkupToPatchOps(
  sheet: UISheetDocument,
  parentId: NodeId | null,
  markup: string,
  format: MarkupImportFormat = 'auto',
): UIPatchOp[] {
  return previewMarkupImport(sheet, parentId, markup, format).ops;
}

/**
 * Lifts an existing on-disk HTML, React JSX/TSX, Svelte 5, Angular 19, or Expo file
 * into a standalone `UISheetDocument` without modifying the original disk file.
 */
export function liftMarkupToSheetDocument(input: {
  projectId: string;
  sheetId?: string;
  sheetName: string;
  markup: string;
  format?: MarkupImportFormat;
}): UISheetDocument | null {
  const sheetId = input.sheetId || `sheet_lift_${Date.now().toString(36)}`;
  const artboardId = `art_${sheetId}`;
  const artboard = createDefaultUINode(
    {
      id: artboardId,
      kind: 'artboard',
      name: `${input.sheetName.replace(/[^a-zA-Z0-9_]/g, '') || 'MainView'}Artboard`,
      semanticTag: 'main',
      layout: {
        mode: 'flex',
        positioning: 'flow',
        direction: 'column',
        gap: 16,
        justify: 'start',
        align: 'stretch',
        frame: { x: 40, y: 40, width: 1200, height: 800 },
        width: { mode: 'fixed', value: 1200 },
        height: { mode: 'hug', value: 800 },
        padding: { top: 24, right: 24, bottom: 24, left: 24 },
      },
      style: {
        fills: [{ type: 'solid', color: { $token: 'color.bg.canvas' } }],
        radius: 14,
      },
    },
    sheetId,
  );

  const baseSheet: UISheetDocument = {
    sheetId,
    projectId: input.projectId,
    name: input.sheetName || 'MainView',
    rootIds: [artboardId],
    nodes: { [artboardId]: artboard },
    defaultLayoutMode: 'flex',
  };

  const preview = previewMarkupImport(baseSheet, artboardId, input.markup, input.format ?? 'auto');
  if (preview.ops.length === 0) {
    return null;
  }

  return applyPatchOpsToSheet(baseSheet, preview.ops).nextSheet;
}
