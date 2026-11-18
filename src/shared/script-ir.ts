/**
 * Shared External Separate `.js` / `.ts` / `.py` Script File Reader, AST-Lite Extractor,
 * 1-Click Reverse DOM Auto-Linker, Snippets & Browser-Safe TypeScript -> JavaScript Transpiler (v3.0).
 *
 * Pure TypeScript, zero Node imports — safe across Renderer, Main, DB Worker, Codegen Worker, and AI Worker.
 */

import type {
  AutomationRule,
  AutomationStep,
  ExtractedDomBinding,
  ExtractedFunctionSig,
  ExtractedNetworkOrIpcCall,
  LinkedScriptModuleRef,
  ParsedExternalScript,
  ParsedScriptModuleAnalysis,
  ScriptLanguage,
  ScriptLoadStrategy,
  ScriptParamSpec,
  UIRScriptModuleDecl,
} from './automation-types';
import type { EventTriggerType, NodeId, UINode, UISheetDocument } from './ui-ir';
import type { UIPatchOp } from './ui-patch';

export type {
  ExtractedDomBinding,
  ExtractedFunctionSig,
  ExtractedNetworkOrIpcCall,
  LinkedScriptModuleRef,
  ParsedExternalScript,
  ParsedScriptModuleAnalysis,
  ScriptLanguage,
  ScriptLoadStrategy,
  ScriptParamSpec,
  UIRScriptModuleDecl,
};

export interface ScriptFunctionSig extends ExtractedFunctionSig {}

export interface ScriptSnippetTemplate {
  id: string;
  label: string;
  category: 'validation' | 'network' | 'state' | 'filter' | 'animation' | 'threejs';
  description: string;
  tsCode: string;
}

export interface StudioRuntimeContext {
  state: Record<string, unknown>;
  getText(nodeIdOrName: string): string;
  setText(nodeIdOrName: string, text: string): void;
  getValue(nodeIdOrName: string): string;
  setValue(nodeIdOrName: string, value: string): void;
  setStyle(nodeIdOrName: string, cssPatch: Record<string, string | number>): void;
  setVisible(nodeIdOrName: string, visible: boolean): void;
  log(...args: unknown[]): void;
  toast(message: string, kind?: 'info' | 'success' | 'warn' | 'error'): void;
  three?: {
    rotate(objectNameOrId: string, dx: number, dy: number, dz: number): void;
    setColor(objectNameOrId: string, hexColor: string): void;
  };
}

export const STUDIO_RUNTIME_CONTEXT_DTS = `export interface StudioRuntimeContext {
  state: Record<string, any>;
  getText(nodeIdOrName: string): string;
  setText(nodeIdOrName: string, text: string): void;
  getValue(nodeIdOrName: string): string;
  setValue(nodeIdOrName: string, value: string): void;
  setStyle(nodeIdOrName: string, cssPatch: Record<string, string | number>): void;
  setVisible(nodeIdOrName: string, visible: boolean): void;
  log(...args: any[]): void;
  toast(message: string, kind?: 'info' | 'success' | 'warn' | 'error'): void;
  three?: {
    rotate(objectNameOrId: string, dx: number, dy: number, dz: number): void;
    setColor(objectNameOrId: string, hexColor: string): void;
  };
}`;

export const SCRIPT_SNIPPET_TEMPLATES: ScriptSnippetTemplate[] = [
  {
    id: 'form-validation',
    label: 'Validazione Form & Email',
    category: 'validation',
    description: 'Valida input email/campi obbligatori e aggiorna badge di stato UI',
    tsCode: `export function validateContactForm(ctx: StudioRuntimeContext): boolean {
  const email: string = ctx.getValue('EmailInput') || ctx.getText('EmailInput');
  const isValid = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email.trim());
  if (!isValid) {
    ctx.setStyle('EmailInput', { borderColor: '#ef4444' });
    ctx.toast('Inserisci un indirizzo email valido!', 'warn');
    ctx.log('[Validazione] Email non valida:', email);
    return false;
  }
  ctx.setStyle('EmailInput', { borderColor: '#10b981' });
  ctx.toast('Form validato con successo!', 'success');
  ctx.log('[Validazione] OK:', email);
  return true;
}`,
  },
  {
    id: 'fetch-rest-api',
    label: 'Fetch API REST (async/await)',
    category: 'network',
    description: 'Chiamata HTTP asincrona con gestione stato caricamento e fallback',
    tsCode: `export async function syncRemoteMetrics(ctx: StudioRuntimeContext): Promise<void> {
  ctx.log('[REST] Richiesta aggiornamento metriche in corso...');
  ctx.state.loading = true;
  try {
    const samplePayload = { revenue: '€ 142.890', activeOrders: 1524, updatedAt: new Date().toLocaleTimeString() };
    ctx.setText('RevenueValue', samplePayload.revenue);
    ctx.setText('OrdersValue', String(samplePayload.activeOrders));
    ctx.toast('Metriche sincronizzate (' + samplePayload.updatedAt + ')', 'success');
    ctx.log('[REST] 200 OK:', samplePayload);
  } finally {
    ctx.state.loading = false;
  }
}`,
  },
  {
    id: 'live-search-filter',
    label: 'Filtro / Ricerca Live',
    category: 'filter',
    description: 'Filtra elementi in tempo reale al cambiare del testo di input',
    tsCode: `export function onSearchQueryInput(ctx: StudioRuntimeContext, query = ''): void {
  const normalized: string = (query || ctx.getValue('SearchInput')).trim().toLowerCase();
  const catalog: string[] = ['Workstation GPU 24GB', 'Monitor OLED 4K', 'Tastiera Meccanica Pro', 'NVMe Gen5 4TB'];
  const matches = catalog.filter((item) => item.toLowerCase().includes(normalized));
  ctx.state.filteredCount = matches.length;
  ctx.log('[Filtro Live] Query="' + normalized + '" -> ' + matches.length + ' risultati:', matches.join(', '));
}`,
  },
  {
    id: 'reactive-counter',
    label: 'Contatore & Stato Reattivo',
    category: 'state',
    description: 'Incrementa una variabile reattiva e aggiorna il testo del nodo UI',
    tsCode: `export function incrementCounter(ctx: StudioRuntimeContext): number {
  const current = Number(ctx.state.counter ?? 0) + 1;
  ctx.state.counter = current;
  ctx.setText('OrdersValue', String(current));
  ctx.log('[Stato] Contatore aggiornato ->', current);
  return current;
}`,
  },
  {
    id: 'css-pulse-animation',
    label: 'Timer & Animazione CSS',
    category: 'animation',
    description: 'Applica una transizione visiva dinamica a un componente del Canvas',
    tsCode: `export function pulseHeroHighlight(ctx: StudioRuntimeContext): void {
  ctx.setStyle('HeroBannerCard', {
    transform: 'scale(1.015)',
    boxShadow: '0 16px 38px rgba(59, 130, 246, 0.35)',
    transition: 'all 0.22s ease',
  });
  ctx.log('[Animazione] Highlight applicato a HeroBannerCard');
}`,
  },
  {
    id: 'threejs-object-control',
    label: 'Controllo Oggetto 3D Three.js',
    category: 'threejs',
    description: 'Ruota e cambia colore PBR di una mesh nella scena Three.js collegata',
    tsCode: `export function spinFeatured3DMesh(ctx: StudioRuntimeContext): void {
  ctx.three?.rotate('HeroMesh', 0, 45, 15);
  ctx.three?.setColor('HeroMesh', '#8b5cf6');
  ctx.log('[Three.js] Ruotato HeroMesh (+45° Y) e aggiornato colore PBR -> #8b5cf6');
}`,
  },
];

export function createStarterScriptModuleTs(projectName = 'Visual UI Studio'): string {
  return `// ============================================================================
// Modulo Logica Applicativa TypeScript — ${projectName}
// Collega queste funzioni agli eventi UI (onClick, onInput, onChange, onMount)
// ============================================================================

export function onPrimaryActionClick(ctx: StudioRuntimeContext): void {
  const nextCount: number = Number(ctx.state.clicks ?? 0) + 1;
  ctx.state.clicks = nextCount;
  ctx.log('[Script TS] onPrimaryActionClick eseguito — click #' + nextCount);
  ctx.toast('Azione eseguita (#' + nextCount + ')', 'success');
}

export async function refreshDashboardData(ctx: StudioRuntimeContext): Promise<void> {
  const stamp: string = new Date().toLocaleTimeString();
  ctx.state.lastSync = stamp;
  ctx.log('[Script TS] Dati aggiornati alle ' + stamp);
}
`;
}

export function createStarterScriptModuleJs(projectName = 'Visual UI Studio'): string {
  return `// ============================================================================
// Modulo Script Separato ES2024 — ${projectName}
// Zero dipendenze proprietarie: standard DOM, fetch() e funzioni esportate
// ============================================================================

export function onPrimaryActionClick(event) {
  event?.preventDefault?.();
  console.info('[Script JS] onPrimaryActionClick attivato');
}
`;
}

export function createStarterScriptModulePy(projectName = 'Visual UI Studio'): string {
  return `# ============================================================================
# Modulo Backend / Automazioni Python — ${projectName}
# ============================================================================
from __future__ import annotations
from typing import Any


async def handle_primary_action(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """Handler Python collegato al progetto."""
    data = payload or {}
    return {"ok": True, "received": data}
`;
}

// ============================================================================
// LEXICAL & STRUCTURAL HELPERS (JS / TS / PYTHON AST-LITE)
// ============================================================================

export function inferScriptLanguageFromPath(relPath: string | undefined, sourceHint?: string): ScriptLanguage {
  const lower = (relPath ?? '').trim().toLowerCase();
  if (lower.endsWith('.py') || lower.endsWith('.pyw')) return 'python';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.mts') || lower.endsWith('.cts')) {
    return 'typescript';
  }
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return 'javascript';
  }
  if (sourceHint) {
    if (/^\s*(?:async\s+)?def\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/m.test(sourceHint)) return 'python';
    if (/\b(?:interface|type)\s+[A-Z]|\):\s*[A-Za-z0-9_<>\[\]|&\s]+\s*(?:=>|\{)/.test(sourceHint)) {
      return 'typescript';
    }
  }
  return 'javascript';
}

export function toKebabDomId(raw: string, fallback = 'el'): string {
  const words = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return fallback;
  const joined = words.map((w) => w.toLowerCase()).join('-');
  return /^[0-9]/.test(joined) ? `ui-${joined}` : joined;
}

function splitTopLevelCommaList(raw: string): string[] {
  const items: string[] = [];
  let cur = '';
  let depth = 0;
  let quote: string | null = null;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      cur += ch;
      if (ch === '\\') {
        if (i + 1 < raw.length) cur += raw[++i];
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') {
      depth++;
      cur += ch;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}' || ch === '>') {
      depth = Math.max(0, depth - 1);
      cur += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      if (cur.trim()) items.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) items.push(cur.trim());
  return items;
}

export function parseParamSpecs(rawParamList: string, language: ScriptLanguage): ScriptParamSpec[] {
  // Strip single-line comments inside multi-line parameter lists
  const cleaned = rawParamList
    .split('\n')
    .map((ln) => {
      if (language === 'python') {
        const hashIdx = ln.indexOf('#');
        return hashIdx >= 0 ? ln.slice(0, hashIdx) : ln;
      }
      const slashIdx = ln.indexOf('//');
      return slashIdx >= 0 ? ln.slice(0, slashIdx) : ln;
    })
    .join(' ')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();

  if (!cleaned) return [];

  const parts = splitTopLevelCommaList(cleaned);
  const specs: ScriptParamSpec[] = [];

  for (const part of parts) {
    let token = part.trim();
    if (!token || token === '/' || token === '*') continue;
    if (language === 'python' && (token === 'self' || token === 'cls' || token.startsWith('self:'))) {
      continue;
    }

    // Find top-level `=` default value (ignoring `=>`)
    let eqIdx = -1;
    let depth = 0;
    let quote: string | null = null;
    for (let i = 0; i < token.length; i++) {
      const ch = token[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        quote = ch;
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth++;
      else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') depth = Math.max(0, depth - 1);
      else if (ch === '=' && depth === 0 && token[i + 1] !== '>' && token[i - 1] !== '!' && token[i - 1] !== '=') {
        eqIdx = i;
        break;
      }
    }

    const defaultValue = eqIdx >= 0 ? token.slice(eqIdx + 1).trim() : undefined;
    const leftSide = eqIdx >= 0 ? token.slice(0, eqIdx).trim() : token;

    // Find top-level `:` type annotation (handle destructured object params `{ a, b }: Props`)
    let colonIdx = -1;
    depth = 0;
    for (let i = 0; i < leftSide.length; i++) {
      const ch = leftSide[i];
      if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth++;
      else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') depth = Math.max(0, depth - 1);
      else if (ch === ':' && depth === 0) {
        colonIdx = i;
        break;
      }
    }

    const rawName = (colonIdx >= 0 ? leftSide.slice(0, colonIdx) : leftSide).trim();
    const typeAnnotation = colonIdx >= 0 ? leftSide.slice(colonIdx + 1).trim() : undefined;
    const optional = rawName.endsWith('?') || defaultValue !== undefined;
    const cleanName = rawName
      .replace(/\?$/, '')
      .replace(/^(?:public|private|protected|readonly)\s+/, '')
      .trim();

    if (cleanName) {
      specs.push({
        name: cleanName,
        ...(typeAnnotation ? { typeAnnotation } : {}),
        ...(defaultValue !== undefined ? { defaultValue } : {}),
        ...(optional ? { optional: true } : {}),
      });
    }
  }

  return specs;
}

function buildLineStartOffsets(lines: string[]): number[] {
  const offsets: number[] = [];
  let acc = 0;
  for (const ln of lines) {
    offsets.push(acc);
    acc += ln.length + 1;
  }
  return offsets;
}

function offsetToLineNumber(offset: number, lineOffsets: number[]): number {
  let lo = 0;
  let hi = lineOffsets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineOffsets[mid] <= offset) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return Math.max(1, hi + 1);
}

function findMatchingParen(code: string, openParenIdx: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openParenIdx; i < code.length; i++) {
    const ch = code[i];
    const next = code[i + 1];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') {
      const nl = code.indexOf('\n', i + 2);
      if (nl < 0) return -1;
      i = nl;
      continue;
    }
    if (ch === '/' && next === '*') {
      const endC = code.indexOf('*/', i + 2);
      if (endC < 0) return -1;
      i = endC + 1;
      continue;
    }
    if (ch === '#') {
      const nl = code.indexOf('\n', i + 1);
      if (nl < 0) return -1;
      i = nl;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findMatchingBrace(code: string, openBraceIdx: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openBraceIdx; i < code.length; i++) {
    const ch = code[i];
    const next = code[i + 1];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') {
      const nl = code.indexOf('\n', i + 2);
      if (nl < 0) return code.length - 1;
      i = nl;
      continue;
    }
    if (ch === '/' && next === '*') {
      const endC = code.indexOf('*/', i + 2);
      if (endC < 0) return code.length - 1;
      i = endC + 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return code.length - 1;
}

function skipOptionalGenerics(code: string, idx: number): number {
  let p = idx;
  while (p < code.length && /\s/.test(code[p])) p++;
  if (code[p] !== '<') return p;
  let depth = 0;
  for (; p < code.length; p++) {
    if (code[p] === '<') depth++;
    else if (code[p] === '>') {
      depth--;
      if (depth === 0) {
        p++;
        while (p < code.length && /\s/.test(code[p])) p++;
        return p;
      }
    }
  }
  return idx;
}

function extractLeadingDocComment(lines: string[], startLineZeroIdx: number, isPython: boolean): string | undefined {
  let k = startLineZeroIdx - 1;
  // Skip Python decorators when looking above `def`
  if (isPython) {
    while (k >= 0 && lines[k].trim().startsWith('@')) {
      k--;
    }
  }
  while (k >= 0 && lines[k].trim() === '') {
    // Only allow at most 0 blank lines so unrelated file headers aren't attached
    break;
  }
  if (k < 0) return undefined;

  const trimmed = lines[k].trim();
  if (isPython) {
    if (trimmed.startsWith('#') && !trimmed.includes('@studio-automation')) {
      const collected: string[] = [];
      while (k >= 0 && lines[k].trim().startsWith('#') && !lines[k].includes('@studio-automation')) {
        collected.unshift(lines[k].trim().replace(/^#+\s*/, ''));
        k--;
      }
      return collected.join(' ').trim() || undefined;
    }
    return undefined;
  }

  // Single-line `//` comment(s)
  if (trimmed.startsWith('//') && !trimmed.includes('@studio-automation') && !trimmed.startsWith('// ===')) {
    const collected: string[] = [];
    while (
      k >= 0 &&
      lines[k].trim().startsWith('//') &&
      !lines[k].includes('@studio-automation') &&
      !lines[k].trim().startsWith('// ===')
    ) {
      collected.unshift(lines[k].trim().replace(/^\/\/+\s*/, ''));
      k--;
    }
    return collected.join(' ').trim() || undefined;
  }

  // JSDoc `/** ... */`
  if (trimmed.endsWith('*/')) {
    const jsdocLines: string[] = [];
    while (k >= 0) {
      const ln = lines[k].trim();
      const clean = ln
        .replace(/^\/\*\*?/, '')
        .replace(/\*\/$/, '')
        .replace(/^\*\s?/, '')
        .trim();
      if (clean && !clean.startsWith('@param') && !clean.startsWith('@returns')) {
        jsdocLines.unshift(clean);
      }
      if (ln.startsWith('/*')) break;
      k--;
    }
    return jsdocLines.join(' ').trim() || undefined;
  }

  return undefined;
}

interface ManagedRegionSpan {
  id: string;
  startLine: number;
  endLine: number;
  rule?: AutomationRule;
}

function extractManagedAutomationRegions(lines: string[]): {
  regions: ManagedRegionSpan[];
  rules: AutomationRule[];
} {
  const regions: ManagedRegionSpan[] = [];
  const rules: AutomationRule[] = [];
  let active: ManagedRegionSpan | null = null;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const startMatch = trimmed.match(
      /^(?:\/\/|#)\s*@studio-automation:start\s+(?:id="([^"]+)"|([A-Za-z0-9_.-]+))/,
    );
    if (startMatch) {
      const id = (startMatch[1] || startMatch[2] || '').trim();
      active = { id, startLine: i + 1, endLine: lines.length };
      continue;
    }

    const metaMatch = trimmed.match(/^(?:\/\/|#)\s*@studio-automation-meta\s+(\{.+\})\s*$/);
    if (metaMatch) {
      try {
        const parsed = JSON.parse(metaMatch[1]) as AutomationRule;
        if (parsed && parsed.id && parsed.generatedFnName) {
          rules.push(parsed);
          if (active && active.id === parsed.id) {
            active.rule = parsed;
          }
        }
      } catch {
        // ignore malformed meta comment
      }
      continue;
    }

    if (/^(?:\/\/|#)\s*@studio-automation:end\b/.test(trimmed)) {
      if (active) {
        active.endLine = i + 1;
        regions.push(active);
        active = null;
      }
    }
  }

  if (active) {
    regions.push(active);
  }

  return { regions, rules };
}

function findManagedIdForLine(line: number, regions: ManagedRegionSpan[]): string | undefined {
  for (const r of regions) {
    if (line >= r.startLine && line <= r.endLine) return r.id;
  }
  return undefined;
}

const JS_RESERVED_METHOD_NAMES = new Set([
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'catch',
  'finally',
  'try',
  'return',
  'throw',
  'new',
  'typeof',
  'delete',
  'void',
  'function',
  'constructor',
  'super',
  'import',
  'export',
]);

function parsePythonModule(
  code: string,
  filePath: string,
  lines: string[],
  regions: ManagedRegionSpan[],
  managedAutomations: AutomationRule[],
): ParsedExternalScript {
  const imports: ParsedExternalScript['imports'] = [];
  const functions: ExtractedFunctionSig[] = [];
  const externalCalls: ExtractedNetworkOrIpcCall[] = [];
  const diagnostics: ParsedExternalScript['diagnostics'] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const fromImp = trimmed.match(/^from\s+([A-Za-z0-9_.]+)\s+import\s+(.+)$/);
    if (fromImp) {
      const specs = fromImp[2]
        .replace(/[()]/g, '')
        .split(',')
        .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean);
      imports.push({ source: fromImp[1], specifiers: specs, isTypeOnly: fromImp[1] === 'typing', line: i + 1 });
      continue;
    }
    const plainImp = trimmed.match(/^import\s+([A-Za-z0-9_.,\s]+)$/);
    if (plainImp) {
      const mods = plainImp[1]
        .split(',')
        .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean);
      for (const m of mods) {
        imports.push({ source: m, specifiers: [m], isTypeOnly: m === 'typing', line: i + 1 });
      }
    }
  }

  const lineOffsets = buildLineStartOffsets(lines);
  let pendingDecorators: Array<{ text: string; line: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    if (trimmed.startsWith('@')) {
      let decText = trimmed;
      const decLine = i + 1;
      if (trimmed.includes('(') && !trimmed.includes(')')) {
        const openIdx = lineOffsets[i] + rawLine.indexOf('(');
        const closeIdx = findMatchingParen(code, openIdx);
        if (closeIdx > openIdx) {
          decText = code.slice(lineOffsets[i] + rawLine.indexOf('@'), closeIdx + 1).replace(/\s+/g, ' ');
          i = offsetToLineNumber(closeIdx, lineOffsets) - 1;
        }
      }
      pendingDecorators.push({ text: decText, line: decLine });
      continue;
    }

    const defMatch = rawLine.match(/^(\s*)(async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (!defMatch) {
      pendingDecorators = [];
      continue;
    }

    const baseIndent = defMatch[1].replace(/\t/g, '    ').length;
    const isAsync = Boolean(defMatch[2]);
    const fnName = defMatch[3];
    const startLine = i + 1;
    const openParenOffset = lineOffsets[i] + rawLine.indexOf('(');
    const closeParenOffset = findMatchingParen(code, openParenOffset);

    let rawParams = '';
    let returnType: string | undefined;
    let headerEndLineIdx = i;

    if (closeParenOffset > openParenOffset) {
      rawParams = code.slice(openParenOffset + 1, closeParenOffset);
      headerEndLineIdx = offsetToLineNumber(closeParenOffset, lineOffsets) - 1;
      const afterParen = code.slice(closeParenOffset + 1, code.indexOf('\n', closeParenOffset) >= 0 ? code.indexOf('\n', closeParenOffset) : code.length);
      const retMatch = afterParen.match(/^\s*->\s*([^:]+):/);
      if (retMatch) {
        returnType = retMatch[1].trim();
      }
    }

    // Find end of Python indented block
    let endLine = headerEndLineIdx + 1;
    let inTripleQuote: string | null = null;
    for (let j = headerEndLineIdx + 1; j < lines.length; j++) {
      const bodyLn = lines[j];
      const bodyTrim = bodyLn.trim();

      const tripleMatches = bodyLn.match(/"""|'''/g);
      if (tripleMatches) {
        for (const tq of tripleMatches) {
          if (!inTripleQuote) inTripleQuote = tq;
          else if (inTripleQuote === tq) inTripleQuote = null;
        }
        endLine = j + 1;
        continue;
      }
      if (inTripleQuote) {
        endLine = j + 1;
        continue;
      }
      if (!bodyTrim || bodyTrim.startsWith('#')) {
        continue;
      }
      const indentLen = (bodyLn.match(/^\s*/)?.[0] ?? '').replace(/\t/g, '    ').length;
      if (indentLen <= baseIndent) {
        break;
      }
      endLine = j + 1;
    }

    // Extract docstring if first statement is """..."""
    let docDesc = extractLeadingDocComment(lines, i, true);
    const firstBodyLine = lines[headerEndLineIdx + 1]?.trim() ?? '';
    if (!docDesc && (firstBodyLine.startsWith('"""') || firstBodyLine.startsWith("'''"))) {
      const q = firstBodyLine.slice(0, 3);
      const rest = firstBodyLine.slice(3);
      const endQ = rest.indexOf(q);
      docDesc = (endQ >= 0 ? rest.slice(0, endQ) : rest).trim() || undefined;
    }

    const detailedParams = parseParamSpecs(rawParams, 'python');
    const decoratorStr = pendingDecorators.length > 0 ? pendingDecorators.map((d) => d.text).join(' ') : undefined;

    for (const dec of pendingDecorators) {
      const routeMatch = dec.text.match(
        /^@(?:[A-Za-z0-9_]+\.)?(get|post|put|patch|delete|route)\(\s*['"]([^'"]+)['"](?:.*?methods\s*=\s*\[\s*['"]([A-Za-z]+)['"])?/i,
      );
      if (routeMatch) {
        const verb = routeMatch[1].toLowerCase() === 'route' ? (routeMatch[3] || 'GET') : routeMatch[1];
        externalCalls.push({
          kind: 'fastapi_route',
          endpointOrCommand: routeMatch[2],
          httpMethod: verb.toUpperCase(),
          enclosingFnName: fnName,
          line: dec.line,
        });
      }
    }

    functions.push({
      name: fnName,
      params: detailedParams.map((p) => p.name),
      detailedParams,
      ...(returnType ? { returnType } : {}),
      isAsync,
      isExported: !fnName.startsWith('_'),
      startLine,
      endLine,
      ...(docDesc ? { description: docDesc } : {}),
      kind: 'python_def',
      ...(decoratorStr ? { decorator: decoratorStr } : {}),
      ...(findManagedIdForLine(startLine, regions)
        ? { managedAutomationId: findManagedIdForLine(startLine, regions) }
        : {}),
    });

    pendingDecorators = [];
  }

  // Scan Python body for SQL queries or HTTP requests
  const findEnclosingFn = (ln: number) =>
    functions.find((f) => ln >= f.startLine && ln <= f.endLine)?.name;

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const sqlMatch = ln.match(/(['"])\s*((?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+[^'"]+)\1/i);
    if (sqlMatch) {
      externalCalls.push({
        kind: 'sql_query',
        endpointOrCommand: sqlMatch[2].replace(/\s+/g, ' ').trim(),
        enclosingFnName: findEnclosingFn(i + 1),
        line: i + 1,
      });
    }
  }

  return {
    filePath,
    language: 'python',
    imports,
    functions,
    domBindings: [],
    externalCalls,
    managedAutomations,
    diagnostics,
  };
}

/**
 * Parses an external `.js`, `.ts`, or `.py` script file into functions, detailed parameters,
 * imports, DOM `getElementById`/`querySelector`/`addEventListener` bindings, `fetch`/`invoke` calls,
 * and rehydrated `@studio-automation` rules.
 *
 * Accepts either `parseExternalScriptModule(code, language, relPath)` or `parseExternalScriptModule(code, relPath)`.
 */
export function parseExternalScriptModule(
  code: string,
  languageOrPath?: ScriptLanguage | string,
  explicitRelPath?: string,
): ParsedExternalScript {
  let language: ScriptLanguage;
  let filePath: string;

  if (languageOrPath === 'javascript' || languageOrPath === 'typescript' || languageOrPath === 'python') {
    language = languageOrPath;
    filePath =
      explicitRelPath ??
      (language === 'python'
        ? 'backend/automations.py'
        : language === 'typescript'
          ? 'src/scripts/automations.ts'
          : 'scripts/automations.js');
  } else {
    filePath = languageOrPath || explicitRelPath || 'scripts/automations.js';
    language = inferScriptLanguageFromPath(filePath, code);
  }

  const normalizedCode = code.replace(/\r\n/g, '\n');
  const lines = normalizedCode.split('\n');
  const { regions, rules: managedAutomations } = extractManagedAutomationRegions(lines);

  if (language === 'python') {
    return parsePythonModule(normalizedCode, filePath, lines, regions, managedAutomations);
  }

  const lineOffsets = buildLineStartOffsets(lines);
  const imports: ParsedExternalScript['imports'] = [];
  const functions: ExtractedFunctionSig[] = [];
  const domBindings: ExtractedDomBinding[] = [];
  const externalCalls: ExtractedNetworkOrIpcCall[] = [];
  const diagnostics: ParsedExternalScript['diagnostics'] = [];

  // 1. Parse ES Imports (single-line and multi-line)
  const importRegex = /^\s*import\s+(type\s+)?([\s\S]*?)\s+from\s+(['"])([^'"]+)\3\s*;?/gm;
  let impMatch: RegExpExecArray | null;
  while ((impMatch = importRegex.exec(normalizedCode)) !== null) {
    const isTypeOnly = Boolean(impMatch[1]);
    const rawClause = impMatch[2].trim();
    const source = impMatch[4];
    const line = offsetToLineNumber(impMatch.index, lineOffsets);
    const specifiers: string[] = [];

    const namedMatch = rawClause.match(/\{([\s\S]*?)\}/);
    if (namedMatch) {
      for (const item of namedMatch[1].split(',')) {
        const clean = item.replace(/^\s*type\s+/, '').trim();
        if (!clean) continue;
        const aliasParts = clean.split(/\s+as\s+/);
        specifiers.push((aliasParts[1] || aliasParts[0]).trim());
      }
    }
    const beforeBrace = rawClause.replace(/\{[\s\S]*?\}/, '').replace(/,/g, '').trim();
    if (beforeBrace) {
      const nsMatch = beforeBrace.match(/^\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
      specifiers.push(nsMatch ? nsMatch[1] : beforeBrace);
    }

    imports.push({ source, specifiers, isTypeOnly, line });
  }

  // Collect `export { a, b }` or `module.exports = { a, b }` named re-exports
  const namedExportedSet = new Set<string>();
  const exportListRegex = /\b(?:export\s*\{([^}]+)\}|module\.exports\s*=\s*\{([^}]+)\})/g;
  let expMatch: RegExpExecArray | null;
  while ((expMatch = exportListRegex.exec(normalizedCode)) !== null) {
    const body = expMatch[1] || expMatch[2] || '';
    for (const item of body.split(',')) {
      const ident = item.split(':')[0].split(/\s+as\s+/)[0].trim();
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(ident)) {
        namedExportedSet.add(ident);
      }
    }
  }

  const seenFnKeys = new Set<string>();

  // 2A. Multi-line `function` declarations: `[export] [default] [async] function name[<T>](params)[: Ret] {`
  const fnDeclRegex = /^[ \t]*(export\s+)?(default\s+)?(async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = fnDeclRegex.exec(normalizedCode)) !== null) {
    const isExported = Boolean(m[1]) || namedExportedSet.has(m[4]);
    const isAsync = Boolean(m[3]);
    const name = m[4];
    const startLine = offsetToLineNumber(m.index, lineOffsets);
    const afterName = skipOptionalGenerics(normalizedCode, m.index + m[0].length);
    if (normalizedCode[afterName] !== '(') continue;

    const closeParen = findMatchingParen(normalizedCode, afterName);
    if (closeParen < 0) continue;
    const rawParams = normalizedCode.slice(afterName + 1, closeParen);

    // Find opening `{` of function body
    let bodyBrace = closeParen + 1;
    let returnType: string | undefined;
    const openBraceIdx = normalizedCode.indexOf('{', closeParen + 1);
    if (openBraceIdx > closeParen) {
      const between = normalizedCode.slice(closeParen + 1, openBraceIdx).trim();
      if (between.startsWith(':')) {
        returnType = between.slice(1).trim();
      }
      bodyBrace = openBraceIdx;
    }

    const closeBrace = normalizedCode[bodyBrace] === '{' ? findMatchingBrace(normalizedCode, bodyBrace) : closeParen;
    const endLine = offsetToLineNumber(closeBrace, lineOffsets);
    const detailedParams = parseParamSpecs(rawParams, language);
    const description = extractLeadingDocComment(lines, startLine - 1, false);
    const managedAutomationId = findManagedIdForLine(startLine, regions);

    const key = `${name}:${startLine}`;
    if (!seenFnKeys.has(key)) {
      seenFnKeys.add(key);
      functions.push({
        name,
        params: detailedParams.map((p) => p.name),
        detailedParams,
        ...(returnType ? { returnType } : {}),
        isAsync,
        isExported,
        startLine,
        endLine,
        ...(description ? { description } : {}),
        kind: 'function',
        ...(managedAutomationId ? { managedAutomationId } : {}),
      });
    }
  }

  // 2B. Multi-line Arrow & Function-Expression declarations:
  // `[export] const|let|var name[: Type] = [async] [<T>](params)[: Ret] =>` OR `exports.name = [async] function(...)`
  const arrowDeclRegex =
    /^[ \t]*(?:(export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=\n]+)?=\s*|(?:module\.)?exports\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*)(async\s+)?/gm;
  while ((m = arrowDeclRegex.exec(normalizedCode)) !== null) {
    const name = m[2] || m[3];
    if (!name) continue;
    const isExported = Boolean(m[1]) || Boolean(m[3]) || namedExportedSet.has(name);
    const isAsync = Boolean(m[4]);
    const startLine = offsetToLineNumber(m.index, lineOffsets);
    let cursor = skipOptionalGenerics(normalizedCode, m.index + m[0].length);

    let rawParams = '';
    let returnType: string | undefined;
    let bodyStart = -1;
    let isValidFn = false;

    if (normalizedCode.slice(cursor, cursor + 8) === 'function') {
      cursor += 8;
      while (cursor < normalizedCode.length && /[A-Za-z0-9_$\s]/.test(normalizedCode[cursor])) cursor++;
      cursor = skipOptionalGenerics(normalizedCode, cursor);
      if (normalizedCode[cursor] === '(') {
        const closeParen = findMatchingParen(normalizedCode, cursor);
        if (closeParen > cursor) {
          rawParams = normalizedCode.slice(cursor + 1, closeParen);
          const braceIdx = normalizedCode.indexOf('{', closeParen + 1);
          if (braceIdx > closeParen) {
            const between = normalizedCode.slice(closeParen + 1, braceIdx).trim();
            if (between.startsWith(':')) returnType = between.slice(1).trim();
            bodyStart = braceIdx;
            isValidFn = true;
          }
        }
      }
    } else if (normalizedCode[cursor] === '(') {
      const closeParen = findMatchingParen(normalizedCode, cursor);
      if (closeParen > cursor) {
        // Look ahead for `=>`
        const arrowSearchWindow = normalizedCode.slice(closeParen + 1, closeParen + 180);
        const arrowIdxRel = arrowSearchWindow.indexOf('=>');
        if (arrowIdxRel >= 0) {
          const between = arrowSearchWindow.slice(0, arrowIdxRel).trim();
          if (!between.includes(';') && (!between || between.startsWith(':'))) {
            rawParams = normalizedCode.slice(cursor + 1, closeParen);
            if (between.startsWith(':')) returnType = between.slice(1).trim();
            bodyStart = closeParen + 1 + arrowIdxRel + 2;
            isValidFn = true;
          }
        }
      }
    } else {
      // Single-identifier arrow `const double = x => x * 2`
      const singleParamMatch = normalizedCode.slice(cursor, cursor + 80).match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*=>/);
      if (singleParamMatch) {
        rawParams = singleParamMatch[1];
        bodyStart = cursor + singleParamMatch[0].length;
        isValidFn = true;
      }
    }

    if (!isValidFn || bodyStart < 0) continue;

    while (bodyStart < normalizedCode.length && /\s/.test(normalizedCode[bodyStart])) bodyStart++;
    let endOffset = bodyStart;
    if (normalizedCode[bodyStart] === '{') {
      endOffset = findMatchingBrace(normalizedCode, bodyStart);
    } else if (normalizedCode[bodyStart] === '(') {
      endOffset = findMatchingParen(normalizedCode, bodyStart);
      if (endOffset < 0) endOffset = bodyStart;
    } else {
      const semi = normalizedCode.indexOf('\n', bodyStart);
      endOffset = semi > bodyStart ? semi : normalizedCode.length - 1;
    }

    const endLine = offsetToLineNumber(endOffset, lineOffsets);
    const detailedParams = parseParamSpecs(rawParams, language);
    const description = extractLeadingDocComment(lines, startLine - 1, false);
    const managedAutomationId = findManagedIdForLine(startLine, regions);

    const key = `${name}:${startLine}`;
    if (!seenFnKeys.has(key)) {
      seenFnKeys.add(key);
      functions.push({
        name,
        params: detailedParams.map((p) => p.name),
        detailedParams,
        ...(returnType ? { returnType } : {}),
        isAsync,
        isExported,
        startLine,
        endLine,
        ...(description ? { description } : {}),
        kind: 'arrow',
        ...(managedAutomationId ? { managedAutomationId } : {}),
      });
    }
  }

  // 2C. Object Controller & Class Methods (`const App = { init() {}, async save(id) {} }` or `class Controller { ... }`)
  const containerRegex =
    /^[ \t]*(export\s+)?(?:(?:default\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)(?:\s+extends\s+[^{]+)?|(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=\n]+)?=\s*|module\.exports\s*=\s*|export\s+default\s+)\{/gm;
  while ((m = containerRegex.exec(normalizedCode)) !== null) {
    const containerOpenBrace = normalizedCode.indexOf('{', m.index + m[0].length - 1);
    if (containerOpenBrace < 0) continue;
    const containerCloseBrace = findMatchingBrace(normalizedCode, containerOpenBrace);
    const containerExported = Boolean(m[1]) || m[0].includes('module.exports') || m[0].includes('export default') || namedExportedSet.has(m[2] || m[3] || '');

    // Scan depth-1 inside container for methods
    let pos = containerOpenBrace + 1;
    while (pos < containerCloseBrace) {
      const ch = normalizedCode[pos];
      if (/\s|,|;/.test(ch)) {
        pos++;
        continue;
      }
      if (ch === '/' && normalizedCode[pos + 1] === '/') {
        const nl = normalizedCode.indexOf('\n', pos + 2);
        pos = nl < 0 ? containerCloseBrace : nl + 1;
        continue;
      }
      if (ch === '/' && normalizedCode[pos + 1] === '*') {
        const endC = normalizedCode.indexOf('*/', pos + 2);
        pos = endC < 0 ? containerCloseBrace : endC + 2;
        continue;
      }

      const slice = normalizedCode.slice(pos, Math.min(containerCloseBrace, pos + 160));
      const methodHead = slice.match(
        /^(?:public\s+|private\s+|protected\s+|static\s+)*(async\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>]*>)?\s*\(/,
      );
      if (methodHead && !JS_RESERVED_METHOD_NAMES.has(methodHead[2])) {
        const isAsync = Boolean(methodHead[1]);
        const methodName = methodHead[2];
        const startLine = offsetToLineNumber(pos, lineOffsets);
        const openParen = pos + methodHead[0].lastIndexOf('(');
        const closeParen = findMatchingParen(normalizedCode, openParen);
        if (closeParen > openParen && closeParen < containerCloseBrace) {
          let afterP = closeParen + 1;
          while (afterP < containerCloseBrace && /\s/.test(normalizedCode[afterP])) afterP++;
          let returnType: string | undefined;
          if (normalizedCode[afterP] === ':') {
            const braceCandidate = normalizedCode.indexOf('{', afterP + 1);
            if (braceCandidate > afterP && braceCandidate < containerCloseBrace) {
              returnType = normalizedCode.slice(afterP + 1, braceCandidate).trim();
              afterP = braceCandidate;
            }
          }
          if (normalizedCode[afterP] === '{') {
            const methodCloseBrace = findMatchingBrace(normalizedCode, afterP);
            const endLine = offsetToLineNumber(methodCloseBrace, lineOffsets);
            const rawParams = normalizedCode.slice(openParen + 1, closeParen);
            const detailedParams = parseParamSpecs(rawParams, language);
            const description = extractLeadingDocComment(lines, startLine - 1, false);
            const key = `${methodName}:${startLine}`;
            if (!seenFnKeys.has(key)) {
              seenFnKeys.add(key);
              functions.push({
                name: methodName,
                params: detailedParams.map((p) => p.name),
                detailedParams,
                ...(returnType ? { returnType } : {}),
                isAsync,
                isExported: containerExported,
                startLine,
                endLine,
                ...(description ? { description } : {}),
                kind: 'controller_method',
              });
            }
            pos = methodCloseBrace + 1;
            continue;
          }
        }
      }

      // Skip nested braces/parens/strings safely so we stay at depth 1
      if (ch === '{') {
        pos = findMatchingBrace(normalizedCode, pos) + 1;
      } else if (ch === '(') {
        const cp = findMatchingParen(normalizedCode, pos);
        pos = cp > pos ? cp + 1 : pos + 1;
      } else if (ch === "'" || ch === '"' || ch === '`') {
        const q = ch;
        pos++;
        while (pos < containerCloseBrace) {
          if (normalizedCode[pos] === '\\') pos += 2;
          else if (normalizedCode[pos] === q) {
            pos++;
            break;
          } else pos++;
        }
      } else {
        const nextNl = normalizedCode.indexOf('\n', pos);
        pos = nextNl > pos && nextNl < containerCloseBrace ? nextNl + 1 : containerCloseBrace;
      }
    }
  }

  functions.sort((a, b) => a.startLine - b.startLine);

  const findEnclosingFn = (ln: number): string | undefined =>
    functions.find((f) => ln >= f.startLine && ln <= f.endLine)?.name;

  // 3. Extract DOM Bindings (`getElementById`, `querySelector`, `querySelectorAll`, `addEventListener`, reads & writes)
  const varToBinding = new Map<string, ExtractedDomBinding>();

  const normalizeSelector = (method: ExtractedDomBinding['method'], rawSel: string): string => {
    const trimmedSel = rawSel.trim();
    if (method === 'getElementById') {
      return trimmedSel.startsWith('#') ? trimmedSel : `#${trimmedSel}`;
    }
    return trimmedSel;
  };

  // 3A. Assigned DOM refs: `const btn = document.getElementById('save-btn')`
  const assignedDomRegex =
    /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=;\n]+)?=\s*document\.(getElementById|querySelector|querySelectorAll)\s*(?:<[^>]*>)?\(\s*(['"`])([^'"`]+)\3\s*\)/g;
  while ((m = assignedDomRegex.exec(normalizedCode)) !== null) {
    const varName = m[1];
    const method = m[2] as ExtractedDomBinding['method'];
    const selector = normalizeSelector(method, m[4]);
    const line = offsetToLineNumber(m.index, lineOffsets);
    const entry: ExtractedDomBinding = {
      selector,
      method,
      domReads: [],
      domWrites: [],
      line,
    };
    domBindings.push(entry);
    varToBinding.set(varName, entry);
  }

  // 3B. Direct chained DOM queries: `document.getElementById('btn')?.addEventListener('click', onSave)` or `.textContent = ...`
  const directDomRegex =
    /document\.(getElementById|querySelector|querySelectorAll)\s*(?:<[^>]*>)?\(\s*(['"`])([^'"`]+)\2\s*\)(?:\s*as\s+[A-Za-z0-9_$<>|\s]+)?\s*(\?\.)?\./g;
  while ((m = directDomRegex.exec(normalizedCode)) !== null) {
    const method = m[1] as ExtractedDomBinding['method'];
    const selector = normalizeSelector(method, m[3]);
    const line = offsetToLineNumber(m.index, lineOffsets);
    const tail = normalizedCode.slice(m.index + m[0].length, m.index + m[0].length + 220);

    let entry = domBindings.find((b) => b.selector === selector && Math.abs(b.line - line) <= 2);
    if (!entry) {
      entry = { selector, method, domReads: [], domWrites: [], line };
      domBindings.push(entry);
    }

    const listenerMatch = tail.match(
      /^addEventListener\(\s*(['"])([^'"]+)\1\s*,\s*([A-Za-z_$][A-Za-z0-9_$.]*|async\b|\(|function\b)/,
    );
    if (listenerMatch) {
      entry.eventTrigger = listenerMatch[2];
      const rawHandler = listenerMatch[3];
      entry.handlerFnName =
        rawHandler === '(' || rawHandler === 'async' || rawHandler === 'function'
          ? '<inline>'
          : rawHandler.split('.').pop();
    }

    const writePropMatch = tail.match(/^(value|textContent|innerHTML|hidden)\s*=/);
    if (writePropMatch) {
      const prop = writePropMatch[1] as ExtractedDomBinding['domWrites'][number];
      if (!entry.domWrites.includes(prop)) entry.domWrites.push(prop);
    } else if (/^style\b/.test(tail)) {
      if (!entry.domWrites.includes('style')) entry.domWrites.push('style');
    } else if (/^classList\.(?:add|remove|toggle|replace)\b/.test(tail)) {
      if (!entry.domWrites.includes('classList')) entry.domWrites.push('classList');
    } else {
      const readPropMatch = tail.match(/^(value|textContent|innerHTML|checked|dataset)\b/);
      if (readPropMatch) {
        const prop = readPropMatch[1] as ExtractedDomBinding['domReads'][number];
        if (!entry.domReads.includes(prop)) entry.domReads.push(prop);
      }
    }
  }

  // 3C. Scan tracked DOM variable usages for `.addEventListener`, reads, and writes
  for (const [varName, binding] of varToBinding.entries()) {
    const escapedVar = varName.replace(/\$/g, '\\$');

    const evRegex = new RegExp(
      `\\b${escapedVar}\\??\\.addEventListener\\(\\s*(['"])([^'"]+)\\1\\s*,\\s*([A-Za-z_$][A-Za-z0-9_$.]*|async\\b|\\(|function\\b)`,
      'g',
    );
    let evM: RegExpExecArray | null;
    while ((evM = evRegex.exec(normalizedCode)) !== null) {
      binding.eventTrigger = evM[2];
      const rawH = evM[3];
      binding.handlerFnName =
        rawH === '(' || rawH === 'async' || rawH === 'function' ? '<inline>' : rawH.split('.').pop();
    }

    const writeRegex = new RegExp(`\\b${escapedVar}\\??\\.(value|textContent|innerHTML|hidden)\\s*=(?!=)`, 'g');
    let wM: RegExpExecArray | null;
    while ((wM = writeRegex.exec(normalizedCode)) !== null) {
      const p = wM[1] as ExtractedDomBinding['domWrites'][number];
      if (!binding.domWrites.includes(p)) binding.domWrites.push(p);
    }

    if (new RegExp(`\\b${escapedVar}\\??\\.style\\b`).test(normalizedCode)) {
      if (!binding.domWrites.includes('style')) binding.domWrites.push('style');
    }
    if (new RegExp(`\\b${escapedVar}\\??\\.classList\\.(?:add|remove|toggle|replace)\\b`).test(normalizedCode)) {
      if (!binding.domWrites.includes('classList')) binding.domWrites.push('classList');
    }

    const readRegex = new RegExp(
      `\\b${escapedVar}\\??\\.(value|textContent|innerHTML|checked|dataset)\\b(?!\\s*=(?!=))`,
      'g',
    );
    let rM: RegExpExecArray | null;
    while ((rM = readRegex.exec(normalizedCode)) !== null) {
      const p = rM[1] as ExtractedDomBinding['domReads'][number];
      if (!binding.domReads.includes(p)) binding.domReads.push(p);
    }
  }

  // 4. Extract `fetch(...)`, Tauri `invoke(...)`, Electron IPC, and SQL Queries
  const fetchRegex = /\bfetch\s*\(\s*(['"`])([^'"`]+)\1(?:\s*,\s*\{([\s\S]{0,260}?)\})?/g;
  while ((m = fetchRegex.exec(normalizedCode)) !== null) {
    const endpoint = m[2];
    const optsBlock = m[3] ?? '';
    const methodMatch = optsBlock.match(/\bmethod\s*:\s*(['"])([A-Za-z]+)\1/);
    const httpMethod = methodMatch ? methodMatch[2].toUpperCase() : 'GET';
    const line = offsetToLineNumber(m.index, lineOffsets);
    externalCalls.push({
      kind: 'fetch',
      endpointOrCommand: endpoint,
      httpMethod,
      enclosingFnName: findEnclosingFn(line),
      line,
    });
  }

  const tauriInvokeRegex = /\binvoke\s*(?:<[^>]*>)?\(\s*(['"`])([^'"`]+)\1/g;
  while ((m = tauriInvokeRegex.exec(normalizedCode)) !== null) {
    // Skip `ipcRenderer.invoke` so it's classified as electron_ipc instead
    const prefix = normalizedCode.slice(Math.max(0, m.index - 16), m.index);
    if (prefix.includes('ipcRenderer.')) continue;
    const line = offsetToLineNumber(m.index, lineOffsets);
    externalCalls.push({
      kind: 'tauri_invoke',
      endpointOrCommand: m[2],
      enclosingFnName: findEnclosingFn(line),
      line,
    });
  }

  const electronIpcRegex = /\b(?:ipcRenderer\.invoke\s*\(\s*(['"`])([^'"`]+)\1|desktopApi\??\.([A-Za-z0-9_$]+)\s*\()/g;
  while ((m = electronIpcRegex.exec(normalizedCode)) !== null) {
    const cmd = m[2] || m[3];
    if (!cmd) continue;
    const line = offsetToLineNumber(m.index, lineOffsets);
    externalCalls.push({
      kind: 'electron_ipc',
      endpointOrCommand: cmd,
      enclosingFnName: findEnclosingFn(line),
      line,
    });
  }

  const sqlStringRegex = /(['"`])\s*((?:SELECT\s+[\s\S]+?\s+FROM|INSERT\s+INTO|UPDATE\s+[A-Za-z0-9_"`[\]]+\s+SET|DELETE\s+FROM)\s+[^'"`]+)\1/gi;
  while ((m = sqlStringRegex.exec(normalizedCode)) !== null) {
    const line = offsetToLineNumber(m.index, lineOffsets);
    externalCalls.push({
      kind: 'sql_query',
      endpointOrCommand: m[2].replace(/\s+/g, ' ').trim(),
      enclosingFnName: findEnclosingFn(line),
      line,
    });
  }

  return {
    filePath,
    language,
    imports,
    functions,
    domBindings,
    externalCalls,
    managedAutomations,
    diagnostics,
  };
}

export function extractScriptFunctions(sourceCode: string, language?: ScriptLanguage): ScriptFunctionSig[] {
  return parseExternalScriptModule(sourceCode, language).functions;
}

// ============================================================================
// 1-CLICK REVERSE DOM AUTO-LINKER (`matchDomBindingsToSheetNodes`)
// ============================================================================

function mapDomEventToTriggerType(domEvent: string | undefined): EventTriggerType {
  switch ((domEvent ?? 'click').toLowerCase()) {
    case 'dblclick':
      return 'onDoubleClick';
    case 'submit':
      return 'onSubmit';
    case 'change':
      return 'onChange';
    case 'input':
    case 'keyup':
      return 'onInput';
    case 'keydown':
    case 'keypress':
      return 'onKeyDown';
    case 'mouseenter':
    case 'mouseover':
      return 'onHover';
    case 'mouseleave':
    case 'mouseout':
      return 'onMouseLeave';
    case 'focus':
    case 'focusin':
      return 'onFocus';
    case 'blur':
    case 'focusout':
      return 'onBlur';
    case 'load':
    case 'domcontentloaded':
      return 'onMount';
    case 'click':
    default:
      return 'onClick';
  }
}

export interface MatchedDomBindingItem {
  binding: ExtractedDomBinding;
  nodeId: NodeId;
  nodeName: string;
  trigger?: EventTriggerType;
  fnName?: string;
}

export interface DomBindingMatchResult {
  bindings: ExtractedDomBinding[];
  matches: MatchedDomBindingItem[];
  matchedPatches: UIPatchOp[];
  matchedCount: number;
}

export function findCanvasNodeForSelector(selector: string, sheet: UISheetDocument): UINode | undefined {
  const raw = selector.trim();
  if (!raw) return undefined;

  const candidates = Object.values(sheet.nodes).filter((n) => n.kind !== 'artboard');

  // 1. `[data-node-name='EmailInput']` or `[data-node-id='nd_1']`
  const dataNameMatch = raw.match(/\[data-node-name=['"]([^'"]+)['"]\]/i);
  if (dataNameMatch) {
    const target = dataNameMatch[1].toLowerCase();
    return candidates.find((n) => n.name.toLowerCase() === target);
  }
  const dataIdMatch = raw.match(/\[data-node-id=['"]([^'"]+)['"]\]/i);
  if (dataIdMatch && sheet.nodes[dataIdMatch[1]]) {
    return sheet.nodes[dataIdMatch[1]];
  }

  // 2. ID selector `#btn-save` or bare id `btn-save`
  if (raw.startsWith('#') || (!raw.startsWith('.') && !raw.includes(' ') && !raw.includes('['))) {
    const idClean = raw.replace(/^#/, '');
    const withoutNodePrefix = idClean.replace(/^node-/, '');
    if (sheet.nodes[withoutNodePrefix] && sheet.nodes[withoutNodePrefix].kind !== 'artboard') {
      return sheet.nodes[withoutNodePrefix];
    }

    const idKebab = toKebabDomId(idClean, '');
    const exactMatch = candidates.find(
      (n) =>
        n.id === idClean ||
        n.name === idClean ||
        n.name.toLowerCase() === idClean.toLowerCase() ||
        toKebabDomId(n.name, '') === idClean.toLowerCase() ||
        (idKebab && toKebabDomId(n.name, '') === idKebab),
    );
    if (exactMatch) return exactMatch;

    // Fuzzy token match (e.g. `#btn-save` <-> `SaveButton` or `CreateOrderBtn` <-> `#create-order`)
    const tokens = idKebab.split('-').filter((t) => t.length >= 3 && t !== 'btn' && t !== 'button' && t !== 'field');
    if (tokens.length > 0) {
      const fuzzy = candidates.find((n) => {
        const nk = toKebabDomId(n.name, '');
        return tokens.every((tok) => nk.includes(tok));
      });
      if (fuzzy) return fuzzy;
    }
  }

  // 3. CSS class selector `.glass-card`
  if (raw.startsWith('.')) {
    const clsName = raw.slice(1).trim();
    const byClass = candidates.find((n) => {
      const attached = n.classNames ?? n.style.classNames ?? [];
      return attached.includes(clsName) || toKebabDomId(n.name, '') === clsName;
    });
    if (byClass) return byClass;
  }

  // 4. Unique semantic tag fallback (`form`, `table`, `dialog`)
  const tagCandidates = candidates.filter((n) => n.semanticTag === raw.toLowerCase());
  if (tagCandidates.length === 1) return tagCandidates[0];

  return undefined;
}

export function matchDomBindingsToSheetNodes(
  parsed: ParsedExternalScript,
  sheet: UISheetDocument,
  vfsEntryId?: string,
): DomBindingMatchResult {
  const enrichedBindings: ExtractedDomBinding[] = [];
  const matches: MatchedDomBindingItem[] = [];
  const interactionsByNode = new Map<NodeId, NonNullable<UINode['interactions']>>();

  for (const b of parsed.domBindings) {
    const matchedNode = findCanvasNodeForSelector(b.selector, sheet);
    const cloned: ExtractedDomBinding = {
      ...b,
      ...(matchedNode ? { matchedNodeId: matchedNode.id } : {}),
    };
    enrichedBindings.push(cloned);

    if (!matchedNode) continue;

    const trigger = b.eventTrigger ? mapDomEventToTriggerType(b.eventTrigger) : undefined;
    const fnName =
      b.handlerFnName && b.handlerFnName !== '<inline>'
        ? b.handlerFnName
        : parsed.functions.find((f) => b.line >= f.startLine && b.line <= f.endLine)?.name;

    matches.push({
      binding: cloned,
      nodeId: matchedNode.id,
      nodeName: matchedNode.name,
      trigger,
      fnName,
    });

    if (trigger && fnName) {
      const currentList = interactionsByNode.get(matchedNode.id) ?? [...(matchedNode.interactions ?? [])];
      const alreadyBound = currentList.some(
        (inter) =>
          inter.trigger === trigger &&
          inter.action.kind === 'call_script_fn' &&
          inter.action.fnName === fnName,
      );
      if (!alreadyBound) {
        currentList.push({
          trigger,
          action: {
            kind: 'call_script_fn',
            ...(vfsEntryId ? { vfsEntryId } : {}),
            moduleRelPath: parsed.filePath,
            fnName,
          },
        });
        interactionsByNode.set(matchedNode.id, currentList);
      }
    }
  }

  const matchedPatches: UIPatchOp[] = [];
  for (const [nodeId, interactions] of interactionsByNode.entries()) {
    matchedPatches.push({
      op: 'set_interaction',
      id: nodeId,
      interactions,
    });
  }

  return {
    bindings: enrichedBindings,
    matches,
    matchedPatches,
    matchedCount: matches.length,
  };
}

/**
 * Heuristic lifter from simple hand-written JS/TS function bodies into visual `AutomationStep[]`.
 */
export function liftSimpleFunctionToAutomationSteps(
  fnName: string,
  sourceCode: string,
  sheet?: UISheetDocument,
): AutomationStep[] {
  const parsed = parseExternalScriptModule(sourceCode);
  const fn = parsed.functions.find((f) => f.name === fnName);
  if (!fn) return [];

  const bodyLines = sourceCode.replace(/\r\n/g, '\n').split('\n').slice(fn.startLine - 1, fn.endLine);
  const body = bodyLines.join('\n');
  const steps: AutomationStep[] = [];
  let seq = 0;

  const resolveId = (rawSel: string): string => {
    if (!sheet) return rawSel.replace(/^#/, '');
    return findCanvasNodeForSelector(rawSel, sheet)?.id ?? rawSel.replace(/^#/, '');
  };

  // Detect textContent writes
  const textRegex = /getElementById\(\s*['"]([^'"]+)['"]\s*\)\??\.textContent\s*=\s*(['"])([^'"]*)\2/g;
  let m: RegExpExecArray | null;
  while ((m = textRegex.exec(body)) !== null) {
    steps.push({
      id: `step_lift_${++seq}`,
      kind: 'ui_set_text',
      targetNodeId: resolveId(m[1]),
      value: { source: 'literal', value: m[3] },
    });
  }

  // Detect classList add/remove/toggle
  const clsRegex = /getElementById\(\s*['"]([^'"]+)['"]\s*\)\??\.classList\.(add|remove|toggle)\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = clsRegex.exec(body)) !== null) {
    steps.push({
      id: `step_lift_${++seq}`,
      kind: 'ui_css_class',
      targetNodeId: resolveId(m[1]),
      mode: m[2] as 'add' | 'remove' | 'toggle',
      className: m[3],
    });
  }

  // Detect fetch calls
  const fetchMatch = body.match(/\bfetch\(\s*['"]([^'"]+)['"](?:\s*,\s*\{\s*method:\s*['"]([A-Za-z]+)['"])?/);
  if (fetchMatch) {
    steps.push({
      id: `step_lift_${++seq}`,
      kind: 'http_fetch',
      method: ((fetchMatch[2] || 'GET').toUpperCase() as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'),
      url: { source: 'literal', value: fetchMatch[1] },
    });
  }

  // Detect Tauri invoke
  const invokeMatch = body.match(/\binvoke(?:\s*<[^>]*>)?\(\s*['"]([^'"]+)['"]/);
  if (invokeMatch) {
    steps.push({
      id: `step_lift_${++seq}`,
      kind: 'tauri_invoke',
      commandName: invokeMatch[1],
    });
  }

  return steps;
}

// ============================================================================
// BROWSER-SAFE & ES-MODULE-PRESERVING TS -> JS TRANSPILER
// ============================================================================

function stripParamTypes(paramList: string): string {
  if (!paramList.trim()) return '';
  const parts = splitTopLevelCommaList(
    paramList
      .split('\n')
      .map((ln) => {
        const idx = ln.indexOf('//');
        return idx >= 0 ? ln.slice(0, idx) : ln;
      })
      .join(' ')
      .replace(/\/\*[\s\S]*?\*\//g, ''),
  );

  return parts
    .map((raw) => {
      const p = raw.trim();
      if (!p) return '';
      let eqIdx = -1;
      let d = 0;
      let quote: string | null = null;
      for (let i = 0; i < p.length; i++) {
        const c = p[i];
        if (quote) {
          if (c === '\\') i++;
          else if (c === quote) quote = null;
          continue;
        }
        if (c === "'" || c === '"' || c === '`') {
          quote = c;
          continue;
        }
        if (c === '<' || c === '(' || c === '{' || c === '[') d++;
        else if (c === '>' || c === ')' || c === '}' || c === ']') d = Math.max(0, d - 1);
        else if (c === '=' && d === 0 && p[i + 1] !== '>' && p[i - 1] !== '!' && p[i - 1] !== '=') {
          eqIdx = i;
          break;
        }
      }
      const defaultPart = eqIdx >= 0 ? ' ' + p.slice(eqIdx).trim() : '';
      const leftPart = eqIdx >= 0 ? p.slice(0, eqIdx).trim() : p;

      let colonIdx = -1;
      d = 0;
      for (let i = 0; i < leftPart.length; i++) {
        const c = leftPart[i];
        if (c === '<' || c === '(' || c === '{' || c === '[') d++;
        else if (c === '>' || c === ')' || c === '}' || c === ']') d = Math.max(0, d - 1);
        else if (c === ':' && d === 0) {
          colonIdx = i;
          break;
        }
      }
      const nameClean = (colonIdx >= 0 ? leftPart.slice(0, colonIdx) : leftPart)
        .replace(/\?$/, '')
        .replace(/^(?:public|private|protected|readonly)\s+/, '')
        .trim();
      return `${nameClean}${defaultPart}`;
    })
    .filter(Boolean)
    .join(', ');
}

export interface TranspileTsOptions {
  preserveEsExports?: boolean;
  registerWindowHandlers?: boolean;
}

/**
 * Browser-safe, zero-Node-dependency TypeScript -> Executable JavaScript transpiler.
 * - Default mode (`preserveEsExports: false`): strips TS annotations/interfaces/types and registers
 *   exported functions onto `window.__studioScriptHandlers` for immediate Sandbox/Workbench execution.
 * - Module mode (`preserveEsExports: true`): strips all TS syntax while keeping clean ES2024
 *   `import` and `export` statements intact for separate `.js` module files!
 */
export function transpileTypeScriptToJs(
  tsCode: string,
  options?: TranspileTsOptions,
): {
  jsCode: string;
  exportedFunctions: string[];
  diagnostics: string[];
} {
  const preserveEsExports = Boolean(options?.preserveEsExports);
  const registerWindowHandlers = options?.registerWindowHandlers ?? !preserveEsExports;

  const diagnostics: string[] = [];
  const parsed = parseExternalScriptModule(tsCode, 'typescript');
  const exportedFunctions = parsed.functions.filter((f) => f.isExported || !preserveEsExports).map((f) => f.name);

  let code = tsCode.replace(/\r\n/g, '\n');

  // 1. Strip `export interface Foo extends Bar { ... }` and `interface Foo { ... }`
  code = code.replace(
    /\b(?:export\s+)?interface\s+[A-Za-z_$][A-Za-z0-9_$]*(?:\s*<[^>]*>)?(?:\s+extends\s+[^{]+)?\s*\{/g,
    () => '__STRIP_INTERFACE_START__{',
  );
  while (code.includes('__STRIP_INTERFACE_START__{')) {
    const start = code.indexOf('__STRIP_INTERFACE_START__{');
    const braceStart = start + '__STRIP_INTERFACE_START__'.length;
    const closeBrace = findMatchingBrace(code, braceStart);
    code = code.slice(0, start) + code.slice(closeBrace + 1);
  }

  // 2. Strip `import type ...` and inline `type Foo` inside `import { a, type Foo } from '...'`
  code = code.replace(/^\s*import\s+type\s+[\s\S]*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, '');
  code = code.replace(/import\s*\{([^}]+)\}\s*from\s*(['"][^'"]+['"])/g, (_m, specList: string, src: string) => {
    const kept = specList
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && !/^type\s+/.test(s));
    if (kept.length === 0) return '';
    return `import { ${kept.join(', ')} } from ${src}`;
  });

  // 3. Strip `export type Foo = ...;` (including multi-line union types ending with `;`)
  code = code.replace(/^\s*(?:export\s+)?type\s+[A-Za-z_$][A-Za-z0-9_$]*(?:\s*<[^>]*>)?\s*=[^;]+;\s*$/gm, '');

  // 4. Strip generic call type args on common DOM/Tauri helpers: `querySelector<HTMLInputElement>(` -> `querySelector(`
  code = code.replace(/\b(querySelector|querySelectorAll|invoke|useState|ref)\s*<[^>()]+>\s*\(/g, '$1(');

  // 5. Rewrite multi-line function declarations: strip `<T>`, parameter types, and `: ReturnType` before `{`
  const rewriteFunctionSignatures = (input: string): string => {
    const fnHeadRegex = /\b(export\s+)?(default\s+)?(async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
    let out = '';
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = fnHeadRegex.exec(input)) !== null) {
      const afterName = skipOptionalGenerics(input, match.index + match[0].length);
      if (input[afterName] !== '(') continue;
      const closeParen = findMatchingParen(input, afterName);
      if (closeParen < 0) continue;
      const openBrace = input.indexOf('{', closeParen + 1);
      if (openBrace < 0) continue;
      const between = input.slice(closeParen + 1, openBrace).trim();
      if (between && !between.startsWith(':')) continue;

      const rawParams = input.slice(afterName + 1, closeParen);
      const expPrefix = preserveEsExports ? `${match[1] ?? ''}${match[2] ?? ''}` : '';
      const asyncKw = match[3] ?? '';
      const fnName = match[4];

      out += input.slice(lastIdx, match.index);
      out += `${expPrefix}${asyncKw}function ${fnName}(${stripParamTypes(rawParams)}) {`;
      lastIdx = openBrace + 1;
      fnHeadRegex.lastIndex = lastIdx;
    }

    out += input.slice(lastIdx);
    return out;
  };
  code = rewriteFunctionSignatures(code);

  // 6. Rewrite multi-line typed arrow functions: `[export] const name[: Type] = [async] [<T>](params)[: Ret] =>`
  const rewriteArrowSignatures = (input: string): string => {
    const arrowHeadRegex = /\b(export\s+)?(const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=\n]+)?=\s*(async\s+)?/g;
    let out = '';
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = arrowHeadRegex.exec(input)) !== null) {
      const afterEq = skipOptionalGenerics(input, match.index + match[0].length);
      if (input[afterEq] !== '(') continue;
      const closeParen = findMatchingParen(input, afterEq);
      if (closeParen < 0) continue;
      const lookahead = input.slice(closeParen + 1, closeParen + 160);
      const arrowPos = lookahead.indexOf('=>');
      if (arrowPos < 0) continue;
      const between = lookahead.slice(0, arrowPos).trim();
      if (between && !between.startsWith(':')) continue;

      const rawParams = input.slice(afterEq + 1, closeParen);
      const expPrefix = preserveEsExports ? (match[1] ?? '') : '';
      const declKw = match[2];
      const varName = match[3];
      const asyncKw = match[4] ?? '';

      out += input.slice(lastIdx, match.index);
      out += `${expPrefix}${declKw} ${varName} = ${asyncKw}(${stripParamTypes(rawParams)}) =>`;
      lastIdx = closeParen + 1 + arrowPos + 2;
      arrowHeadRegex.lastIndex = lastIdx;
    }

    out += input.slice(lastIdx);
    return out;
  };
  code = rewriteArrowSignatures(code);

  // 7. Strip inline callback parameter types e.g. `(item: string, idx: number) =>`
  code = code.replace(/\(([^()\n]+:[^()\n]+)\)\s*=>/g, (_m, inner: string) => `(${stripParamTypes(inner)}) =>`);

  // 8. Handle ES imports & exports when NOT preserving ES module syntax (Sandbox / Function() evaluation)
  if (!preserveEsExports) {
    code = code.replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, '');
    code = code.replace(/^\s*export\s+default\s+/gm, '');
    code = code.replace(/^\s*export\s+(const|let|var|async|function|class)\b/gm, '$1');
    code = code.replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');
  }

  // 9. Strip local variable type annotations `const x: string | number =`
  code = code.replace(/\b(const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*[^=;\n]+=/g, '$1 $2 =');

  // 10. Strip ` as SomeType` assertions (including `as HTMLInputElement | null`)
  code = code.replace(
    /(\)|\]|[A-Za-z0-9_$'"])\s+as\s+(?:const\b|[A-Z][A-Za-z0-9_$<>\[\]|&\s]*?)(?=[;.,)\]\n]|$)/g,
    '$1',
  );

  // Clean excessive blank lines left by stripped interfaces/types
  code = code.replace(/\n{3,}/g, '\n\n').trim();

  if (preserveEsExports && !registerWindowHandlers) {
    const jsCode = code + '\n';
    try {
      const syntaxProbe = code
        .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, '')
        .replace(/^\s*import\s+['"][^'"]+['"]\s*;?\s*$/gm, '')
        .replace(/^\s*export\s+default\s+/gm, '')
        .replace(/^\s*export\s+(const|let|var|async|function|class)\b/gm, '$1')
        .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');
      new Function('window', syntaxProbe);
    } catch (err) {
      diagnostics.push(err instanceof Error ? err.message : String(err));
    }
    return { jsCode, exportedFunctions, diagnostics };
  }

  const registrationLines = exportedFunctions.map(
    (fnName) => `if (typeof ${fnName} === 'function') { __studioExports[${JSON.stringify(fnName)}] = ${fnName}; }`,
  );

  const jsCode = [
    `const __studioExports = (typeof window !== 'undefined' ? (window.__studioScriptHandlers = window.__studioScriptHandlers || {}) : {});`,
    code,
    ...registrationLines,
  ].join('\n\n');

  try {
    new Function('window', jsCode);
  } catch (err) {
    diagnostics.push(err instanceof Error ? err.message : String(err));
  }

  return { jsCode, exportedFunctions, diagnostics };
}
