/**
 * Unified No-Code Visual Automation & Function Compiler + Safe `@studio-automation` File Patcher (v3.0).
 *
 * Principle: "Senza Scrivere Codice, Ma Che Applica Codice Vero"
 * Compiles guided visual `AutomationRule`s into 100% clean, idiomatic, standalone functions
 * (ZERO proprietary runtime lock-in!) across `dom-js`, `dom-ts`, `react`, `svelte`, `angular`,
 * `nextjs`, `tauri`, `nodejs`, and `python`, and patches them non-destructively into separate
 * `.js` / `.ts` / `.py` files while preserving all user-written manual functions, imports, and comments.
 */

import type {
  AutomationCondition,
  AutomationConditionGroup,
  AutomationRule,
  AutomationStep,
  AutomationTriggerType,
  ConditionOperator,
  FormValidationFieldRule,
  ScriptLanguage,
  ScriptParamSpec,
  ValueOperand,
} from './automation-types';
import { inferScriptLanguageFromPath, parseExternalScriptModule, toKebabDomId } from './script-ir';
import { adaptParameterizedSqlForSqlite, formatParameterPlaceholder, qualifyTableName, quoteIdentifier } from './sql-dialects';
import type { SqlDesignDocument, SqlNamedQueryDef, SqlTableDef } from './sql-ir';
import type { NodeId, UIRIpcCommandSpec, UISheetDocument } from './ui-ir';

export * from './automation-types';

export type AutomationCodegenTarget =
  | 'dom-js'
  | 'dom-ts'
  | 'react'
  | 'svelte'
  | 'angular'
  | 'nextjs'
  | 'tauri'
  | 'nodejs'
  | 'python';

export interface AutomationCompileContext {
  target?: AutomationCodegenTarget | string;
  language?: ScriptLanguage;
  sheet?: UISheetDocument;
  sqlDocument?: SqlDesignDocument | null;
  includeFences?: boolean;
  emitDomInitHelper?: boolean;
  fastapiRoutePrefix?: string;
}

export interface CompiledAutomationResult {
  code: string;
  fencedCode: string;
  fnName: string;
  language: ScriptLanguage;
  target: AutomationCodegenTarget;
  isAsync: boolean;
  requiredImports: string[];
  ipcCommands: UIRIpcCommandSpec[];
  hash: string;
  diagnostics: string[];
  toString(): string;
}

// ============================================================================
// DETERMINISTIC FNV-1A HASH & IDENTIFIER SANITIZERS
// ============================================================================

export function computeFnv1aHash(input: string): string {
  const normalized = input.replace(/\r\n/g, '\n').trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function toCamelFnName(raw: string, fallback = 'autoAction'): string {
  const words = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return fallback;
  const camel = words
    .map((w, idx) => (idx === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
  return /^[0-9]/.test(camel) ? `fn${camel}` : camel;
}

export function toSnakeFnName(raw: string, fallback = 'auto_action'): string {
  const words = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return fallback;
  const snake = words.map((w) => w.toLowerCase()).join('_');
  return /^[0-9]/.test(snake) ? `fn_${snake}` : snake;
}

function sanitizeJsIdent(raw: string, fallback = 'val'): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_$]/g, '_');
  if (!cleaned) return fallback;
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

function toKebabCssProp(prop: string): string {
  const trimmed = prop.trim();
  if (trimmed.startsWith('--')) return trimmed;
  return trimmed.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

export function resolveAutomationTarget(
  rawTarget?: string,
  explicitLanguage?: ScriptLanguage,
  fileRelPath?: string,
): { target: AutomationCodegenTarget; language: ScriptLanguage } {
  const t = (rawTarget ?? '').trim().toLowerCase();
  const pathLang = fileRelPath ? inferScriptLanguageFromPath(fileRelPath) : undefined;

  if (t === 'python' || t.startsWith('python-') || explicitLanguage === 'python' || pathLang === 'python') {
    return { target: 'python', language: 'python' };
  }
  if (t === 'dom-js' || t === 'html-vanilla' || t === 'html-css-js' || t === 'htmx') {
    const lang = explicitLanguage ?? pathLang ?? 'javascript';
    return { target: lang === 'typescript' ? 'dom-ts' : 'dom-js', language: lang };
  }
  if (t === 'dom-ts') {
    return { target: 'dom-ts', language: 'typescript' };
  }
  if (t === 'tauri' || t === 'tauri-v2' || t === 'rust-tauri') {
    return { target: 'tauri', language: explicitLanguage ?? pathLang ?? 'typescript' };
  }
  if (t === 'nextjs' || t === 'nextjs-app') {
    return { target: 'nextjs', language: explicitLanguage ?? pathLang ?? 'typescript' };
  }
  if (t === 'svelte' || t === 'svelte5') {
    return { target: 'svelte', language: explicitLanguage ?? pathLang ?? 'typescript' };
  }
  if (t === 'angular') {
    return { target: 'angular', language: explicitLanguage ?? 'typescript' };
  }
  if (t === 'nodejs' || t === 'node') {
    return { target: 'nodejs', language: explicitLanguage ?? pathLang ?? 'javascript' };
  }
  if (
    t === 'react' ||
    t === 'react-tsx' ||
    t === 'react-native' ||
    t === 'vite' ||
    t === 'vue3' ||
    t === 'electron-target' ||
    t === 'go-wails'
  ) {
    return { target: 'react', language: explicitLanguage ?? pathLang ?? 'typescript' };
  }

  const fallbackLang = explicitLanguage ?? pathLang ?? 'javascript';
  return {
    target: fallbackLang === 'typescript' ? 'dom-ts' : 'dom-js',
    language: fallbackLang,
  };
}

export function buildSheetDomIdLookup(sheet?: UISheetDocument): Map<string, string> {
  const map = new Map<string, string>();
  if (!sheet) return map;
  const used = new Set<string>();

  const walk = (nodeId: NodeId) => {
    const node = sheet.nodes[nodeId];
    if (!node || map.has(nodeId)) return;
    const base = toKebabDomId(node.name || node.kind, 'el');
    let candidate = base;
    let n = 2;
    while (used.has(candidate)) {
      candidate = `${base}-${n++}`;
    }
    used.add(candidate);
    map.set(nodeId, candidate);
    for (const cid of node.childIds) walk(cid);
  };

  for (const rid of sheet.rootIds) walk(rid);
  for (const nid of Object.keys(sheet.nodes)) walk(nid);
  return map;
}

function resolveNodeDomId(nodeId: string, sheet: UISheetDocument | undefined, domMap: Map<string, string>): string {
  const mapped = domMap.get(nodeId);
  if (mapped) return mapped;
  if (sheet) {
    const byName = Object.values(sheet.nodes).find(
      (n) => n.name === nodeId || n.name.toLowerCase() === nodeId.toLowerCase(),
    );
    if (byName && domMap.has(byName.id)) {
      return domMap.get(byName.id)!;
    }
  }
  const clean = nodeId.replace(/^#/, '').replace(/^node-/, '');
  return toKebabDomId(clean.replace(/^nd_/, ''), clean || 'element');
}

function computeRelativeJsImport(fromRelPath: string, toRelPath: string, keepJsExt: boolean): string {
  const normFrom = fromRelPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const normTo = toRelPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const fromParts = normFrom.split('/').slice(0, -1).filter(Boolean);
  const toParts = normTo.split('/').filter(Boolean);

  let common = 0;
  while (common < fromParts.length && common < toParts.length - 1 && fromParts[common] === toParts[common]) {
    common++;
  }

  const upCount = fromParts.length - common;
  const prefix = upCount === 0 ? './' : '../'.repeat(upCount);
  let tail = toParts.slice(common).join('/');
  if (!keepJsExt) {
    tail = tail.replace(/\.(?:ts|tsx|js|jsx|mjs)$/, '');
  } else if (tail.endsWith('.ts')) {
    tail = tail.replace(/\.ts$/, '.js');
  }
  return `${prefix}${tail}`;
}

function stepListUsesAwait(steps: AutomationStep[], target: AutomationCodegenTarget): boolean {
  for (const st of steps) {
    if (
      st.kind === 'http_fetch' ||
      st.kind === 'sql_operation' ||
      st.kind === 'tauri_invoke' ||
      st.kind === 'call_external_fn' ||
      st.kind === 'delay'
    ) {
      return true;
    }
    if (st.kind === 'if_else') {
      if (stepListUsesAwait(st.thenSteps, target) || (st.elseSteps && stepListUsesAwait(st.elseSteps, target))) {
        return true;
      }
    }
  }
  void target;
  return false;
}

// ============================================================================
// PYTHON CODE EMITTER (`python` / FastAPI / Desktop Script)
// ============================================================================

function formatPythonLiteral(val: string | number | boolean): string {
  if (typeof val === 'boolean') return val ? 'True' : 'False';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : '0';
  return JSON.stringify(String(val));
}

function compilePythonOperand(
  op: ValueOperand | undefined,
  sheet: UISheetDocument | undefined,
  domMap: Map<string, string>,
): string {
  if (!op) return "''";
  switch (op.source) {
    case 'literal':
      return formatPythonLiteral(op.value);
    case 'ui_element': {
      const key = toSnakeFnName(resolveNodeDomId(op.nodeId, sheet, domMap), 'field');
      return `payload.get(${JSON.stringify(key)}, "")`;
    }
    case 'state':
    case 'local_storage':
      return `app_state.get(${JSON.stringify(op.key)}, "")`;
    case 'event_payload':
      return `payload.get(${JSON.stringify(op.field)}, "")`;
    case 'step_result': {
      const base = `step_res_${toSnakeFnName(op.stepId, 'res')}`;
      if (!op.path) return base;
      return op.path
        .split('.')
        .reduce((acc, seg) => `(${acc}.get(${JSON.stringify(seg)}) if isinstance(${acc}, dict) else None)`, base);
    }
    case 'param':
      return toSnakeFnName(op.name, 'arg');
  }
}

function compilePythonCondition(
  cond: AutomationCondition,
  sheet: UISheetDocument | undefined,
  domMap: Map<string, string>,
  needsReRef: { value: boolean },
): string {
  const L = compilePythonOperand(cond.left, sheet, domMap);
  const R = compilePythonOperand(cond.right, sheet, domMap);

  switch (cond.operator) {
    case '==':
      return `(${L} == ${R})`;
    case '!=':
      return `(${L} != ${R})`;
    case '>':
    case '>=':
    case '<':
    case '<=':
      return `(float(${L} or 0) ${cond.operator} float(${R} or 0))`;
    case 'contains':
      return `(str(${R}) in str(${L}))`;
    case 'startsWith':
      return `str(${L}).startswith(str(${R}))`;
    case 'isEmpty':
      return `(len(str(${L}).strip()) == 0)`;
    case 'isNotEmpty':
      return `(len(str(${L}).strip()) > 0)`;
    case 'isEmail':
      needsReRef.value = true;
      return `bool(re.match(r"^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", str(${L}).strip()))`;
    case 'matchesRegex':
      needsReRef.value = true;
      return `bool(re.search(str(${R}), str(${L})))`;
  }
}

function compilePythonAutomation(
  rule: AutomationRule,
  ctx: AutomationCompileContext,
  domMap: Map<string, string>,
): {
  bodyCode: string;
  fnName: string;
  isAsync: boolean;
  requiredImports: string[];
} {
  const fnName = toSnakeFnName(rule.generatedFnName || rule.name, 'auto_handler');
  const isAsync =
    stepListUsesAwait(rule.steps, 'python') ||
    (rule.elseSteps ? stepListUsesAwait(rule.elseSteps, 'python') : false);

  const importsSet = new Set<string>(['from typing import Any']);
  const needsReRef = { value: false };
  const lines: string[] = [];

  const emitPySteps = (steps: AutomationStep[], indentLevel: number) => {
    const pad = '    '.repeat(indentLevel);
    if (steps.length === 0) {
      lines.push(`${pad}pass`);
      return;
    }

    for (const st of steps) {
      const stepVar = `step_res_${toSnakeFnName(st.id, 'step')}`;

      switch (st.kind) {
        case 'ui_set_text': {
          const domId = resolveNodeDomId(st.targetNodeId, ctx.sheet, domMap);
          lines.push(`${pad}ui_mutations[${JSON.stringify(domId)}] = {"text": str(${compilePythonOperand(st.value, ctx.sheet, domMap)})}`);
          break;
        }
        case 'ui_set_value': {
          const domId = resolveNodeDomId(st.targetNodeId, ctx.sheet, domMap);
          const prop = st.prop ?? 'value';
          lines.push(
            `${pad}ui_mutations[${JSON.stringify(domId)}] = {${JSON.stringify(prop)}: ${compilePythonOperand(st.value, ctx.sheet, domMap)}}`,
          );
          break;
        }
        case 'ui_visibility': {
          const domId = resolveNodeDomId(st.targetNodeId, ctx.sheet, domMap);
          lines.push(`${pad}ui_mutations[${JSON.stringify(domId)}] = {"visibility": ${JSON.stringify(st.mode)}}`);
          break;
        }
        case 'ui_css_class': {
          const domId = resolveNodeDomId(st.targetNodeId, ctx.sheet, domMap);
          lines.push(
            `${pad}ui_mutations[${JSON.stringify(domId)}] = {"cssClass": {"mode": ${JSON.stringify(st.mode)}, "className": ${JSON.stringify(st.className)}}}`,
          );
          break;
        }
        case 'ui_inline_style': {
          const domId = resolveNodeDomId(st.targetNodeId, ctx.sheet, domMap);
          lines.push(
            `${pad}ui_mutations[${JSON.stringify(domId)}] = {"style": {${JSON.stringify(toKebabCssProp(st.cssProperty))}: str(${compilePythonOperand(st.value, ctx.sheet, domMap)})}}`,
          );
          break;
        }
        case 'validate_form': {
          for (const r of st.rules) {
            const fieldKey = toSnakeFnName(resolveNodeDomId(r.nodeId, ctx.sheet, domMap), 'field');
            const valExpr = `str(payload.get(${JSON.stringify(fieldKey)}, "")).strip()`;
            if (r.rule === 'required') {
              lines.push(`${pad}if not ${valExpr}:`);
            } else if (r.rule === 'email') {
              needsReRef.value = true;
              lines.push(`${pad}if not re.match(r"^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", ${valExpr}):`);
            } else if (r.rule === 'minLength') {
              lines.push(`${pad}if len(${valExpr}) < ${r.min ?? 3}:`);
            } else {
              lines.push(`${pad}if not ${valExpr}.replace(".", "", 1).lstrip("-").isdigit():`);
            }
            lines.push(`${pad}    return {"ok": False, "field": ${JSON.stringify(fieldKey)}, "error": ${JSON.stringify(r.errorMsg)}}`);
          }
          break;
        }
        case 'toast': {
          lines.push(
            `${pad}notifications.append({"variant": ${JSON.stringify(st.variant)}, "message": str(${compilePythonOperand(st.message, ctx.sheet, domMap)})})`,
          );
          break;
        }
        case 'http_fetch': {
          importsSet.add('import json');
          importsSet.add('import urllib.request');
          const urlExpr = compilePythonOperand(st.url, ctx.sheet, domMap);
          if (st.bodyFields && st.bodyFields.length > 0 && st.method !== 'GET') {
            const bodyEntries = st.bodyFields
              .map((bf) => `${JSON.stringify(bf.key)}: ${compilePythonOperand(bf.value, ctx.sheet, domMap)}`)
              .join(', ');
            lines.push(`${pad}_req_body = json.dumps({${bodyEntries}}).encode("utf-8")`);
            lines.push(
              `${pad}_req = urllib.request.Request(str(${urlExpr}), data=_req_body, headers={"Content-Type": "application/json"}, method=${JSON.stringify(st.method)})`,
            );
          } else {
            lines.push(`${pad}_req = urllib.request.Request(str(${urlExpr}), method=${JSON.stringify(st.method)})`);
          }
          lines.push(`${pad}with urllib.request.urlopen(_req, timeout=10) as _resp:`);
          lines.push(`${pad}    ${stepVar} = json.loads(_resp.read().decode("utf-8"))`);
          if (st.resultStateKey) {
            lines.push(`${pad}app_state[${JSON.stringify(st.resultStateKey)}] = ${stepVar}`);
          }
          break;
        }
        case 'sql_operation': {
          importsSet.add('import sqlite3');
          importsSet.add('from contextlib import closing');
          const dbPath = ctx.sqlDocument?.databaseFileRelPath || 'data/app.sqlite';
          const resolvedSql = resolveSqlStatementForStep(st, ctx.sqlDocument);
          const namedQuery = ctx.sqlDocument?.namedQueries.find(
            (query) => query.id === st.namedQueryId || query.name === st.namedQueryId,
          );
          const expressions = new Map<string, string>();
          for (const { columnName, value } of st.columnMappings ?? []) {
            expressions.set(columnName, compilePythonOperand(value, ctx.sheet, domMap));
          }
          for (const [name, value] of Object.entries(st.paramBindings ?? {})) {
            expressions.set(name, typeof value === 'string'
              ? formatPythonLiteral(value)
              : compilePythonOperand(value, ctx.sheet, domMap));
          }
          const names = namedQuery?.parameters.map((parameter) => parameter.name) ?? [...expressions.keys()];
          const markers: Record<string, string> = {};
          const args: string[] = [];
          for (const [index, name] of names.entries()) {
            const number = index + 1;
            markers[name] = String(index);
            args.push(expressions.get(name) ?? expressions.get(String(number)) ?? expressions.get(`p${number}`) ?? 'None');
          }
          for (const [index, name] of names.entries()) {
            const number = index + 1;
            markers[`p${number}`] ??= markers[name];
          }
          const sqlite = adaptParameterizedSqlForSqlite(resolvedSql, markers, ctx.sqlDocument?.dialect);
          const values = sqlite.bindings.map((binding) => binding === null ? 'None' : args[Number(binding)] ?? 'None');
          const tuple = `(${values.join(', ')}${values.length === 1 ? ',' : ''})`;
          lines.push(`${pad}with closing(sqlite3.connect(${JSON.stringify(dbPath)})) as _conn:`);
          lines.push(`${pad}    _conn.row_factory = sqlite3.Row`);
          lines.push(`${pad}    _cur = _conn.execute(${JSON.stringify(sqlite.sql)}, ${tuple})`);
          if (st.operation === 'select_to_table' || st.operation === 'run_named_query' && namedQuery?.kind === 'select') {
            lines.push(`${pad}    ${stepVar} = [dict(r) for r in _cur.fetchall()]`);
          } else {
            lines.push(`${pad}    _conn.commit()`);
            lines.push(`${pad}    ${stepVar} = {"ok": True, "rowCount": _cur.rowcount, "lastRowId": _cur.lastrowid}`);
          }

          if (st.resultStateKey) {
            lines.push(`${pad}app_state[${JSON.stringify(st.resultStateKey)}] = ${stepVar}`);
          }
          break;
        }
        case 'storage_state': {
          const k = JSON.stringify(st.key);
          if (st.operation === 'remove') {
            lines.push(`${pad}app_state.pop(${k}, None)`);
          } else if (st.operation === 'increment') {
            lines.push(`${pad}app_state[${k}] = float(app_state.get(${k}, 0)) + 1`);
          } else if (st.operation === 'decrement') {
            lines.push(`${pad}app_state[${k}] = float(app_state.get(${k}, 0)) - 1`);
          } else if (st.operation === 'toggle_bool') {
            lines.push(`${pad}app_state[${k}] = not bool(app_state.get(${k}, False))`);
          } else {
            lines.push(`${pad}app_state[${k}] = ${compilePythonOperand(st.value, ctx.sheet, domMap)}`);
          }
          break;
        }
        case 'math_formula': {
          const outVar = toSnakeFnName(st.outputVar || 'formula_result', 'formula_result');
          const L = compilePythonOperand(st.left, ctx.sheet, domMap);
          const R = st.right ? compilePythonOperand(st.right, ctx.sheet, domMap) : '0';
          const op = st.operator ?? '+';
          if (st.formulaKind === 'string_concat') {
            lines.push(`${pad}${outVar} = f"{${L}}{${R}}"`);
          } else if (st.formulaKind === 'currency_eur') {
            lines.push(`${pad}${outVar} = f"€ {(float(${L} or 0) ${op} float(${R} or 0)):,.2f}"`);
          } else {
            lines.push(`${pad}${outVar} = float(${L} or 0) ${op} float(${R} or 0)`);
          }
          lines.push(`${pad}app_state[${JSON.stringify(st.outputVar || outVar)}] = ${outVar}`);
          break;
        }
        case 'navigate': {
          lines.push(
            `${pad}ui_mutations["__navigation__"] = {"action": ${JSON.stringify(st.action)}, "target": ${JSON.stringify(st.target)}}`,
          );
          break;
        }
        case 'call_external_fn': {
          const extFn = toSnakeFnName(st.fnName, 'external_fn');
          const argsCode = (st.args ?? []).map((a) => compilePythonOperand(a, ctx.sheet, domMap)).join(', ');
          const outName = st.outputVar ? `${toSnakeFnName(st.outputVar)} = ` : '';
          lines.push(`${pad}${outName}${extFn}(${argsCode})`);
          break;
        }
        case 'tauri_invoke': {
          const argsEntries = Object.entries(st.args ?? {})
            .map(([k, v]) => `${JSON.stringify(k)}: ${compilePythonOperand(v, ctx.sheet, domMap)}`)
            .join(', ');
          lines.push(`${pad}${stepVar} = {"command": ${JSON.stringify(st.commandName)}, "args": {${argsEntries}}}`);
          break;
        }
        case 'if_else': {
          const comb = st.conditionGroup.combinator === 'OR' ? ' or ' : ' and ';
          const condExpr =
            st.conditionGroup.conditions.length > 0
              ? st.conditionGroup.conditions
                  .map((c) => compilePythonCondition(c, ctx.sheet, domMap, needsReRef))
                  .join(comb)
              : 'True';
          lines.push(`${pad}if ${condExpr}:`);
          emitPySteps(st.thenSteps, indentLevel + 1);
          if (st.elseSteps && st.elseSteps.length > 0) {
            lines.push(`${pad}else:`);
            emitPySteps(st.elseSteps, indentLevel + 1);
          }
          break;
        }
        case 'delay': {
          importsSet.add('import asyncio');
          lines.push(`${pad}await asyncio.sleep(${Math.max(0, st.ms) / 1000})`);
          break;
        }
      }
    }
  };

  const paramSpecs: ScriptParamSpec[] = rule.parameters ?? [];
  const pyParams = [
    'payload: dict[str, Any] | None = None',
    ...paramSpecs.map((p) => `${toSnakeFnName(p.name)}: ${p.typeAnnotation || 'Any'} = ${p.defaultValue ?? 'None'}`),
  ].join(', ');

  if (ctx.fastapiRoutePrefix) {
    lines.push(`# FastAPI Endpoint: POST ${ctx.fastapiRoutePrefix}/${fnName}`);
  }
  lines.push(`${isAsync ? 'async ' : ''}def ${fnName}(${pyParams}) -> dict[str, Any]:`);
  if (rule.description || rule.name) {
    lines.push(`    """${(rule.description || rule.name).replace(/"""/g, "'''")}"""`);
  }
  lines.push(`    payload = payload or {}`);
  lines.push(`    app_state: dict[str, Any] = {}`);
  lines.push(`    ui_mutations: dict[str, Any] = {}`);
  lines.push(`    notifications: list[dict[str, str]] = []`);

  if (rule.conditions && rule.conditions.length > 0) {
    const comb = rule.conditionCombinator === 'OR' ? ' or ' : ' and ';
    const topCond = rule.conditions
      .map((c) => compilePythonCondition(c, ctx.sheet, domMap, needsReRef))
      .join(comb);
    lines.push(`    if ${topCond}:`);
    emitPySteps(rule.steps, 2);
    if (rule.elseSteps && rule.elseSteps.length > 0) {
      lines.push(`    else:`);
      emitPySteps(rule.elseSteps, 2);
    }
  } else {
    emitPySteps(rule.steps, 1);
  }

  if (rule.returnValue) {
    lines.push(`    return {"ok": True, "result": ${compilePythonOperand(rule.returnValue, ctx.sheet, domMap)}, "ui": ui_mutations, "notifications": notifications}`);
  } else {
    lines.push(`    return {"ok": True, "state": app_state, "ui": ui_mutations, "notifications": notifications}`);
  }

  if (needsReRef.value) {
    importsSet.add('import re');
  }

  return {
    bodyCode: lines.join('\n'),
    fnName,
    isAsync,
    requiredImports: Array.from(importsSet),
  };
}

// ============================================================================
// JS / TS / REACT / SVELTE / ANGULAR / NEXTJS / TAURI / NODEJS CODE EMITTER
// ============================================================================

function resolveSqlStatementForStep(
  step: Extract<AutomationStep, { kind: 'sql_operation' }>,
  sqlDoc?: SqlDesignDocument | null,
): string {
  if (step.namedQueryId) {
    const foundQuery: SqlNamedQueryDef | undefined = sqlDoc?.namedQueries.find(
      (q) => q.id === step.namedQueryId || q.name === step.namedQueryId,
    );
    if (foundQuery) return foundQuery.sqlByDialect?.[sqlDoc?.dialect ?? 'sqlite'] ?? foundQuery.canonicalSql;
  }

  const tableName = step.tableName || sqlDoc?.tables[0]?.name || 'items';
  const tableDef: SqlTableDef | undefined = sqlDoc?.tables.find(
    (t) => t.name === tableName || t.id === tableName,
  );
  const dialect = sqlDoc?.dialect ?? 'sqlite';
  const safeTbl = qualifyTableName(dialect, tableDef?.name ?? tableName, tableDef?.schema);
  const quote = (name: string) => quoteIdentifier(name, dialect);
  const pk = quote(tableDef?.columns.find((column) => column.primaryKey)?.name ?? 'id');
  const placeholder = (index: number) => formatParameterPlaceholder(dialect, index);

  switch (step.operation) {
    case 'select_to_table':
    case 'run_named_query': {
      const cols = tableDef?.columns.length ? tableDef.columns.map((c) => quote(c.name)).join(', ') : '*';
      return dialect === 'sqlserver'
        ? `SELECT TOP (100) ${cols} FROM ${safeTbl} ORDER BY 1 DESC`
        : `SELECT ${cols} FROM ${safeTbl} ORDER BY 1 DESC LIMIT 100`;
    }
    case 'insert_from_form': {
      const cols =
        step.columnMappings && step.columnMappings.length > 0
          ? step.columnMappings.map((m) => m.columnName)
          : (tableDef?.columns.filter((c) => !c.autoIncrement).map((c) => c.name) ?? ['name']);
      const ph = cols.map((_, index) => placeholder(index + 1)).join(', ');
      return `INSERT INTO ${safeTbl} (${cols.map(quote).join(', ')}) VALUES (${ph})`;
    }
    case 'update_by_id': {
      const cols =
        step.columnMappings && step.columnMappings.length > 0
          ? step.columnMappings.map((m, index) => `${quote(m.columnName)} = ${placeholder(index + 1)}`).join(', ')
          : 'updated_at = CURRENT_TIMESTAMP';
      return `UPDATE ${safeTbl} SET ${cols} WHERE ${pk} = ${placeholder((step.columnMappings?.length ?? 0) + 1)}`;
    }
    case 'delete_by_id':
      return `DELETE FROM ${safeTbl} WHERE ${pk} = ${placeholder(1)}`;
  }
}

function compileJsTsOperand(
  op: ValueOperand | undefined,
  typed: boolean,
  target: AutomationCodegenTarget,
  sheet: UISheetDocument | undefined,
  domMap: Map<string, string>,
): string {
  if (!op) return "''";
  switch (op.source) {
    case 'literal':
      if (typeof op.value === 'number' || typeof op.value === 'boolean') return String(op.value);
      return JSON.stringify(String(op.value));
    case 'ui_element': {
      const domId = resolveNodeDomId(op.nodeId, sheet, domMap);
      if (target === 'nodejs') {
        return `(payload?.[${JSON.stringify(toCamelFnName(domId, 'field'))}] ?? '')`;
      }
      const getEl = `document.getElementById(${JSON.stringify(domId)})`;
      switch (op.prop) {
        case 'value':
          return typed
            ? `((${getEl} as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null)?.value ?? '')`
            : `(${getEl}?.value ?? '')`;
        case 'checked': {
          const checkbox = `(${getEl}?.querySelector('input[type="checkbox"]') ?? ${getEl})`;
          return typed ? `Boolean((${checkbox} as HTMLInputElement | null)?.checked)` : `Boolean(${checkbox}?.checked)`;
        }
        case 'visible':
          return `(${getEl} ? getComputedStyle(${getEl}).display !== 'none' : false)`;
        case 'dataAttr':
          return `(${getEl}?.getAttribute(${JSON.stringify(op.attrName || 'data-value')}) ?? '')`;
        case 'text':
        default:
          return `(${getEl}?.textContent?.trim() ?? '')`;
      }
    }
    case 'state':
      return typed
        ? `((globalThis as Record<string, any>).__appState?.[${JSON.stringify(op.key)}])`
        : `(globalThis.__appState?.[${JSON.stringify(op.key)}])`;
    case 'local_storage':
      if (target === 'nodejs') {
        return `(payload?.[${JSON.stringify(op.key)}] ?? '')`;
      }
      return `(localStorage.getItem(${JSON.stringify(op.key)}) ?? '')`;
    case 'event_payload': {
      if (target === 'nodejs') {
        return `(payload?.[${JSON.stringify(op.field)}] ?? '')`;
      }
      switch (op.field) {
        case 'value':
          return typed
            ? `((event?.target as HTMLInputElement | null)?.value ?? '')`
            : `(event?.target?.value ?? '')`;
        case 'key':
          return typed
            ? `((event as KeyboardEvent | undefined)?.key ?? '')`
            : `(event?.key ?? '')`;
        case 'targetId':
          return typed
            ? `((event?.currentTarget as HTMLElement | null)?.id ?? '')`
            : `(event?.currentTarget?.id ?? '')`;
        case 'formDataJson':
          return `(event?.currentTarget instanceof HTMLFormElement ? Object.fromEntries(new FormData(event.currentTarget).entries()) : {})`;
      }
      return "''";
    }
    case 'step_result': {
      const base = `stepRes_${sanitizeJsIdent(op.stepId)}`;
      if (!op.path) return base;
      const chain = op.path
        .split('.')
        .filter(Boolean)
        .map((seg) => (/^\d+$/.test(seg) ? `?.[${seg}]` : `?.${seg}`))
        .join('');
      return `(${base}${chain})`;
    }
    case 'param':
      return sanitizeJsIdent(op.name, 'arg');
  }
}

function compileJsTsCondition(
  cond: AutomationCondition,
  typed: boolean,
  target: AutomationCodegenTarget,
  sheet: UISheetDocument | undefined,
  domMap: Map<string, string>,
): string {
  const L = compileJsTsOperand(cond.left, typed, target, sheet, domMap);
  const R = compileJsTsOperand(cond.right, typed, target, sheet, domMap);

  switch (cond.operator as ConditionOperator) {
    case '==':
      return `(${L} === ${R})`;
    case '!=':
      return `(${L} !== ${R})`;
    case '>':
    case '>=':
    case '<':
    case '<=':
      return `(Number(${L}) ${cond.operator} Number(${R}))`;
    case 'contains':
      return `String(${L}).includes(String(${R}))`;
    case 'startsWith':
      return `String(${L}).startsWith(String(${R}))`;
    case 'isEmpty':
      return `(String(${L ?? ''}).trim().length === 0)`;
    case 'isNotEmpty':
      return `(String(${L ?? ''}).trim().length > 0)`;
    case 'isEmail':
      return `/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(String(${L}).trim())`;
    case 'matchesRegex':
      return `new RegExp(String(${R})).test(String(${L}))`;
  }
}

/**
 * Compiles a visual `AutomationRule` into clean, human-readable, standalone code for the requested stack/language.
 */
export function compileAutomationRuleToCode(
  rule: AutomationRule,
  ctxInput?: AutomationCompileContext | AutomationCodegenTarget | string,
): CompiledAutomationResult {
  const ctx: AutomationCompileContext =
    typeof ctxInput === 'string' ? { target: ctxInput } : (ctxInput ?? {});

  const { target, language } = resolveAutomationTarget(
    ctx.target,
    ctx.language ?? rule.language,
    rule.targetFileRelPath,
  );

  const domMap = buildSheetDomIdLookup(ctx.sheet);
  const diagnostics: string[] = [];
  const ipcCommandsMap = new Map<string, UIRIpcCommandSpec>();

  if (language === 'python' || target === 'python') {
    const pyBuilt = compilePythonAutomation(rule, ctx, domMap);
    const hash = computeFnv1aHash(pyBuilt.bodyCode);
    const fencedCode = buildFencedAutomationBlock(rule, pyBuilt.bodyCode, 'python', hash);
    const finalCode = ctx.includeFences ? fencedCode : pyBuilt.bodyCode;
    return {
      code: finalCode,
      fencedCode,
      fnName: pyBuilt.fnName,
      language: 'python',
      target: 'python',
      isAsync: pyBuilt.isAsync,
      requiredImports: pyBuilt.requiredImports,
      ipcCommands: [],
      hash,
      diagnostics,
      toString: () => finalCode,
    };
  }

  const typed = language === 'typescript';
  const fnName = sanitizeJsIdent(rule.generatedFnName || toCamelFnName(rule.name, 'autoAction'));
  const isAsync =
    target === 'nextjs' ||
    stepListUsesAwait(rule.steps, target) ||
    (rule.elseSteps ? stepListUsesAwait(rule.elseSteps, target) : false);

  const requiredImports = new Set<string>();
  const lines: string[] = [];
  let varSeq = 0;

  const emitToastLines = (pad: string, variant: string, msgExpr: string) => {
    if (target === 'nodejs') {
      lines.push(`${pad}console.info('[${variant.toUpperCase()}]', ${msgExpr});`);
      return;
    }
    if (variant === 'alert') {
      lines.push(`${pad}if (typeof window !== 'undefined' && typeof window.alert === 'function') {`);
      lines.push(`${pad}  window.alert(String(${msgExpr}));`);
      lines.push(`${pad}}`);
      return;
    }
    lines.push(`${pad}if (typeof window !== 'undefined') {`);
    lines.push(`${pad}  const message = String(${msgExpr});`);
    lines.push(
      `${pad}  const showFallback = window.dispatchEvent(new CustomEvent('studio:toast', { cancelable: true, detail: { variant: ${JSON.stringify(variant)}, message } }));`,
    );
    lines.push(`${pad}  if (showFallback && document.body) {`);
    lines.push(`${pad}    let toastHost = document.getElementById('studio-toast-host');`);
    lines.push(`${pad}    if (!toastHost) {`);
    lines.push(`${pad}      toastHost = document.createElement('div');`);
    lines.push(`${pad}      toastHost.id = 'studio-toast-host';`);
    lines.push(`${pad}      toastHost.setAttribute('role', 'status');`);
    lines.push(`${pad}      Object.assign(toastHost.style, { position: 'fixed', right: '16px', bottom: '16px', zIndex: '9999', display: 'grid', gap: '6px', pointerEvents: 'none' });`);
    lines.push(`${pad}      document.body.appendChild(toastHost);`);
    lines.push(`${pad}    }`);
    lines.push(`${pad}    const toastEl = document.createElement('div');`);
    lines.push(`${pad}    toastEl.className = 'studio-sandbox-toast';`);
    lines.push(`${pad}    toastEl.textContent = message;`);
    lines.push(`${pad}    Object.assign(toastEl.style, { padding: '8px 14px', background: '#0f172a', color: '#f8fafc', borderRadius: '8px', boxShadow: '0 8px 24px #0004' });`);
    lines.push(`${pad}    toastHost.appendChild(toastEl);`);
    lines.push(`${pad}    setTimeout(() => toastEl.remove(), 2600);`);
    lines.push(`${pad}  }`);
    lines.push(`${pad}}`);
  };

  const emitTableRenderLines = (
    pad: string,
    tableNodeId: string,
    rowsExpr: string,
    columnsHint?: string[],
  ) => {
    if (target === 'nodejs') return;
    const tblDomId = resolveNodeDomId(tableNodeId, ctx.sheet, domMap);
    const tblVar = `tbl_${++varSeq}`;
    const tbodyVar = `tbody_${varSeq}`;
    const rowsVar = `rows_${varSeq}`;
    lines.push(`${pad}const ${tblVar} = document.getElementById(${JSON.stringify(tblDomId)});`);
    lines.push(`${pad}const ${tbodyVar} = ${tblVar}?.querySelector('tbody') ?? ${tblVar};`);
    lines.push(`${pad}const ${rowsVar} = ${rowsExpr};`);
    lines.push(`${pad}if (${tbodyVar} && Array.isArray(${rowsVar})) {`);
    lines.push(`${pad}  const fragment = document.createDocumentFragment();`);
    lines.push(`${pad}  for (const row of ${rowsVar}) {`);
    lines.push(`${pad}    const tr = document.createElement('tr');`);
    const cells = columnsHint?.length
      ? `${JSON.stringify(columnsHint)}.map((col) => row?.[col])`
      : 'Object.values(row ?? {})';
    lines.push(`${pad}    for (const cell of ${cells}) {`);
    lines.push(`${pad}      tr.insertCell().textContent = String(cell ?? '');`);
    lines.push(`${pad}    }`);
    lines.push(`${pad}    fragment.append(tr);`);
    lines.push(`${pad}  }`);
    lines.push(`${pad}  ${tbodyVar}.replaceChildren(fragment);`);
    lines.push(`${pad}}`);
  };

  const emitJsTsSteps = (steps: AutomationStep[], indentLevel: number) => {
    const pad = '  '.repeat(indentLevel);

    for (const st of steps) {
      const stepResVar = `stepRes_${sanitizeJsIdent(st.id)}`;

      switch (st.kind) {
        case 'ui_set_text': {
          const domId = resolveNodeDomId(st.targetNodeId, ctx.sheet, domMap);
          const valExpr = compileJsTsOperand(st.value, typed, target, ctx.sheet, domMap);
          const elVar = `el_${++varSeq}`;
          lines.push(`${pad}const ${elVar} = document.getElementById(${JSON.stringify(domId)});`);
          lines.push(`${pad}if (${elVar}) {`);
          lines.push(`${pad}  const textSpan = ${elVar}.querySelector('.studio-node-text');`);
          lines.push(`${pad}  if (textSpan) textSpan.textContent = String(${valExpr});`);
          lines.push(`${pad}  else ${elVar}.textContent = String(${valExpr});`);
          lines.push(`${pad}}`);
          break;
        }

        case 'ui_set_value': {
          const domId = resolveNodeDomId(st.targetNodeId, ctx.sheet, domMap);
          const prop = st.prop ?? 'value';
          const valExpr = compileJsTsOperand(st.value, typed, target, ctx.sheet, domMap);
          const elVar = `el_${++varSeq}`;
          if (prop === 'checked' || prop === 'disabled') {
            lines.push(
              `${pad}const ${elVar}Root = document.getElementById(${JSON.stringify(domId)});`,
              `${pad}const ${elVar} = (${elVar}Root instanceof HTMLLabelElement ? ${elVar}Root.control : ${elVar}Root)${typed ? ' as HTMLInputElement | null' : ''};`,
            );
            lines.push(`${pad}if (${elVar}) ${elVar}.${prop} = Boolean(${valExpr});`);
          } else if (prop === 'src') {
            lines.push(
              `${pad}const ${elVar} = document.getElementById(${JSON.stringify(domId)})${typed ? ' as HTMLImageElement | null' : ''};`,
            );
            lines.push(`${pad}if (${elVar}) ${elVar}.src = String(${valExpr});`);
          } else {
            lines.push(
              `${pad}const ${elVar} = document.getElementById(${JSON.stringify(domId)})${typed ? ' as HTMLInputElement | HTMLTextAreaElement | null' : ''};`,
            );
            lines.push(`${pad}if (${elVar}) ${elVar}.${prop} = String(${valExpr});`);
          }
          break;
        }

        case 'ui_visibility': {
          const domId = resolveNodeDomId(st.targetNodeId, ctx.sheet, domMap);
          const disp = st.displayType ?? 'block';
          const elVar = `el_${++varSeq}`;
          lines.push(`${pad}const ${elVar} = document.getElementById(${JSON.stringify(domId)});`);
          lines.push(`${pad}if (${elVar}) {`);
          if (st.mode === 'show') {
            lines.push(`${pad}  ${elVar}.style.display = ${JSON.stringify(disp)};`);
            lines.push(`${pad}  ${elVar}.hidden = false;`);
          } else if (st.mode === 'hide') {
            lines.push(`${pad}  ${elVar}.style.display = 'none';`);
          } else {
            lines.push(
              `${pad}  const isHidden = ${elVar}.style.display === 'none' || ${elVar}.hidden;`,
            );
            lines.push(`${pad}  ${elVar}.style.display = isHidden ? ${JSON.stringify(disp)} : 'none';`);
            lines.push(`${pad}  ${elVar}.hidden = !isHidden;`);
          }
          lines.push(`${pad}}`);
          break;
        }

        case 'ui_css_class': {
          const domId = resolveNodeDomId(st.targetNodeId, ctx.sheet, domMap);
          const cleanCls = st.className.trim().replace(/^\.+/, '');
          if (cleanCls) {
            lines.push(
              `${pad}document.getElementById(${JSON.stringify(domId)})?.classList.${st.mode}(${JSON.stringify(cleanCls)});`,
            );
          }
          break;
        }

        case 'ui_inline_style': {
          const domId = resolveNodeDomId(st.targetNodeId, ctx.sheet, domMap);
          const cssProp = toKebabCssProp(st.cssProperty);
          const valExpr = compileJsTsOperand(st.value, typed, target, ctx.sheet, domMap);
          lines.push(
            `${pad}document.getElementById(${JSON.stringify(domId)})?.style.setProperty(${JSON.stringify(cssProp)}, String(${valExpr}));`,
          );
          break;
        }

        case 'validate_form': {
          for (const ruleItem of st.rules) {
            emitValidationRuleCheck(pad, ruleItem, st.stopOnFail !== false);
          }
          break;
        }

        case 'toast': {
          const msgExpr = compileJsTsOperand(st.message, typed, target, ctx.sheet, domMap);
          emitToastLines(pad, st.variant, msgExpr);
          break;
        }

        case 'http_fetch': {
          const urlExpr = compileJsTsOperand(st.url, typed, target, ctx.sheet, domMap);
          const resVar = `res_${++varSeq}`;
          const headersObj: Record<string, string> = { ...(st.headers ?? {}) };
          const hasBody = st.method !== 'GET' && Boolean(st.bodyFormNodeId || (st.bodyFields && st.bodyFields.length > 0));
          if (hasBody && !headersObj['Content-Type']) {
            headersObj['Content-Type'] = 'application/json';
          }

          if (st.method === 'GET' && Object.keys(headersObj).length === 0) {
            lines.push(`${pad}const ${resVar} = await fetch(String(${urlExpr}));`);
          } else {
            let bodyExpr = 'undefined';
            if (st.bodyFormNodeId) {
              const formDomId = resolveNodeDomId(st.bodyFormNodeId, ctx.sheet, domMap);
              bodyExpr = typed
                ? `JSON.stringify(Object.fromEntries(new FormData(document.getElementById(${JSON.stringify(formDomId)}) as HTMLFormElement).entries()))`
                : `JSON.stringify(Object.fromEntries(new FormData(document.getElementById(${JSON.stringify(formDomId)})).entries()))`;
            } else if (st.bodyFields && st.bodyFields.length > 0) {
              const fieldsCode = st.bodyFields
                .map((bf) => `${JSON.stringify(bf.key)}: ${compileJsTsOperand(bf.value, typed, target, ctx.sheet, domMap)}`)
                .join(', ');
              bodyExpr = `JSON.stringify({ ${fieldsCode} })`;
            }

            lines.push(`${pad}const ${resVar} = await fetch(String(${urlExpr}), {`);
            lines.push(`${pad}  method: ${JSON.stringify(st.method)},`);
            if (Object.keys(headersObj).length > 0) {
              lines.push(`${pad}  headers: ${JSON.stringify(headersObj)},`);
            }
            if (hasBody) {
              lines.push(`${pad}  body: ${bodyExpr},`);
            }
            lines.push(`${pad}});`);
          }

          lines.push(`${pad}if (!${resVar}.ok) {`);
          lines.push(`${pad}  throw new Error(\`HTTP \${${resVar}.status}: \${${resVar}.statusText}\`);`);
          lines.push(`${pad}}`);
          lines.push(`${pad}const ${stepResVar} = await ${resVar}.json();`);

          const extractedExpr = st.responseJsonPath
            ? `${stepResVar}${st.responseJsonPath
                .split('.')
                .filter(Boolean)
                .map((s) => `?.${s}`)
                .join('')}`
            : stepResVar;

          if (st.resultStateKey) {
            const stateRoot = typed
              ? `((globalThis as Record<string, any>).__appState ??= {})`
              : `(globalThis.__appState ??= {})`;
            lines.push(`${pad}${stateRoot}[${JSON.stringify(st.resultStateKey)}] = ${extractedExpr};`);
          }

          if (st.bindMode === 'render_table_rows' && st.targetNodeId) {
            emitTableRenderLines(pad, st.targetNodeId, `(Array.isArray(${extractedExpr}) ? ${extractedExpr} : (${extractedExpr}?.rows ?? []))`, st.columnsMap);
          } else if (st.targetNodeId) {
            const targetDomId = resolveNodeDomId(st.targetNodeId, ctx.sheet, domMap);
            lines.push(
              `${pad}const fetchTargetEl_${varSeq} = document.getElementById(${JSON.stringify(targetDomId)});`,
            );
            lines.push(`${pad}if (fetchTargetEl_${varSeq}) fetchTargetEl_${varSeq}.textContent = String(${extractedExpr} ?? '');`);
          }
          break;
        }

        case 'sql_operation': {
          const tableName = st.tableName || ctx.sqlDocument?.tables[0]?.name || 'items';
          const namedQuery = ctx.sqlDocument?.namedQueries.find(
            (query) => query.id === st.namedQueryId || query.name === st.namedQueryId,
          );
          const sqlText = resolveSqlStatementForStep(st, ctx.sqlDocument);
          const useTauriSql = target === 'tauri' || st.executionBridge === 'tauri_rust_sql';
          const paramExpressions = new Map<string, string>();
          for (const { columnName, value } of st.columnMappings ?? []) {
            paramExpressions.set(columnName, compileJsTsOperand(value, typed, target, ctx.sheet, domMap));
          }
          for (const [name, value] of Object.entries(st.paramBindings ?? {})) {
            paramExpressions.set(name, typeof value === 'string'
              ? JSON.stringify(value)
              : compileJsTsOperand(value, typed, target, ctx.sheet, domMap));
          }
          const positional = (namedQuery?.parameters ?? []).map(({ name }, index) => {
            const number = index + 1;
            const value = paramExpressions.get(name) ?? paramExpressions.get(String(number)) ?? paramExpressions.get(`p${number}`);
            return value ?? 'null';
          });
          const params = /\$\d+|@p\d+|\?/.test(sqlText)
            ? `[${(namedQuery ? positional : [...paramExpressions.values()]).join(', ')}]`
            : `{ ${[...paramExpressions].map(([name, value]) => `${JSON.stringify(name)}: ${value}`).join(', ')} }`;

          const requestSql = (
            resultVar: string,
            operation: string,
            queryId: string | undefined,
            sql: string,
            bindings: string,
          ) => {
            const payload = `{ operation: ${JSON.stringify(operation)}, table: ${JSON.stringify(tableName)}, queryId: ${JSON.stringify(queryId ?? null)}, sql: ${JSON.stringify(sql)}, params: ${bindings} }`;
            if (useTauriSql) {
              requiredImports.add("import { invoke } from '@tauri-apps/api/core';");
              const commandName = operation === 'run_named_query' && queryId
                ? `sql_${toSnakeFnName(queryId)}`
                : `sql_${operation.split('_')[0]}_${toSnakeFnName(tableName)}`;
              ipcCommandsMap.set(commandName, {
                name: commandName,
                args: [{ name: 'payload', type: 'string' }],
                returnType: 'string',
                description: `SQL ${operation} on ${tableName}`,
              });
              lines.push(`${pad}const ${resultVar} = await invoke${typed ? '<Record<string, any>>' : ''}(${JSON.stringify(commandName)}, ${payload});`);
            } else {
              const res = `sqlHttp_${++varSeq}`;
              lines.push(`${pad}const ${res} = await fetch(${JSON.stringify(`/api/sql/${encodeURIComponent(tableName)}`)}, {`);
              lines.push(`${pad}  method: 'POST',`);
              lines.push(`${pad}  headers: { 'Content-Type': 'application/json' },`);
              lines.push(`${pad}  body: JSON.stringify(${payload}),`);
              lines.push(`${pad}});`);
              lines.push(`${pad}const ${resultVar} = await ${res}.json();`);
              lines.push(`${pad}if (!${res}.ok) throw new Error(${resultVar}?.error ?? ('SQL HTTP ' + ${res}.status));`);
            }
            lines.push(`${pad}if (${resultVar}?.ok === false) throw new Error(${resultVar}.error ?? 'Errore SQL');`);
          };

          requestSql(stepResVar, st.operation, st.namedQueryId, sqlText, params);

          if (st.resultStateKey) {
            const stateRoot = typed
              ? `((globalThis as Record<string, any>).__appState ??= {})`
              : `(globalThis.__appState ??= {})`;
            lines.push(`${pad}${stateRoot}[${JSON.stringify(st.resultStateKey)}] = ${stepResVar}?.rows ?? ${stepResVar};`);
          }

          if (st.targetTableNodeId) {
            const refreshQuery = ctx.sqlDocument?.namedQueries.find((query) => query.id === st.refreshQueryId);
            let rowsSource = stepResVar;
            if (refreshQuery) {
              rowsSource = `refresh_${++varSeq}`;
              requestSql(
                rowsSource, 'run_named_query', refreshQuery.id,
                refreshQuery.sqlByDialect?.[ctx.sqlDocument?.dialect ?? 'sqlite'] ?? refreshQuery.canonicalSql,
                '[]',
              );
            }
            const tableDef = ctx.sqlDocument?.tables.find((t) => t.name === tableName || t.id === tableName);
            const returnColumns = (refreshQuery ?? namedQuery)?.returnColumns;
            emitTableRenderLines(
              pad,
              st.targetTableNodeId,
              `(${rowsSource}?.rows ?? (Array.isArray(${rowsSource}) ? ${rowsSource} : []))`,
              returnColumns?.map((c) => c.name) ?? tableDef?.columns.map((c) => c.name),
            );
          }

          if (st.toastOnSuccess) {
            emitToastLines(pad, 'success', JSON.stringify(st.toastOnSuccess));
          }
          break;
        }

        case 'storage_state': {
          const keyLit = JSON.stringify(st.key);
          if (st.target === 'localStorage' || st.target === 'sessionStorage') {
            const storeObj = st.target;
            if (st.operation === 'remove') {
              lines.push(`${pad}${storeObj}.removeItem(${keyLit});`);
            } else if (st.operation === 'increment') {
              lines.push(`${pad}${storeObj}.setItem(${keyLit}, String(Number(${storeObj}.getItem(${keyLit}) ?? 0) + 1));`);
            } else if (st.operation === 'decrement') {
              lines.push(`${pad}${storeObj}.setItem(${keyLit}, String(Number(${storeObj}.getItem(${keyLit}) ?? 0) - 1));`);
            } else if (st.operation === 'toggle_bool') {
              lines.push(`${pad}${storeObj}.setItem(${keyLit}, ${storeObj}.getItem(${keyLit}) === 'true' ? 'false' : 'true');`);
            } else {
              const valExpr = compileJsTsOperand(st.value, typed, target, ctx.sheet, domMap);
              lines.push(`${pad}${storeObj}.setItem(${keyLit}, String(${valExpr}));`);
            }
          } else {
            const stateRoot = typed
              ? `((globalThis as Record<string, any>).__appState ??= {})`
              : `(globalThis.__appState ??= {})`;
            if (st.operation === 'remove') {
              lines.push(`${pad}delete ${stateRoot}[${keyLit}];`);
            } else if (st.operation === 'increment') {
              lines.push(`${pad}${stateRoot}[${keyLit}] = Number(${stateRoot}[${keyLit}] ?? 0) + 1;`);
            } else if (st.operation === 'decrement') {
              lines.push(`${pad}${stateRoot}[${keyLit}] = Number(${stateRoot}[${keyLit}] ?? 0) - 1;`);
            } else if (st.operation === 'toggle_bool') {
              lines.push(`${pad}${stateRoot}[${keyLit}] = !Boolean(${stateRoot}[${keyLit}]);`);
            } else {
              const valExpr = compileJsTsOperand(st.value, typed, target, ctx.sheet, domMap);
              lines.push(`${pad}${stateRoot}[${keyLit}] = ${valExpr};`);
            }
            if (target !== 'nodejs') {
              lines.push(
                `${pad}if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('studio:state-change', { detail: { key: ${keyLit}, value: ${stateRoot}[${keyLit}] } }));`,
              );
            }
          }
          break;
        }

        case 'math_formula': {
          const outVar = sanitizeJsIdent(st.outputVar || `calc_${++varSeq}`, 'formulaResult');
          const L = compileJsTsOperand(st.left, typed, target, ctx.sheet, domMap);
          const R = st.right ? compileJsTsOperand(st.right, typed, target, ctx.sheet, domMap) : '0';
          const op = st.operator ?? '+';

          if (st.formulaKind === 'string_concat') {
            lines.push(`${pad}const ${outVar} = \`\${${L}}\${${R}}\`;`);
          } else if (st.formulaKind === 'currency_eur') {
            lines.push(
              `${pad}const ${outVar} = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(${L}) ${op} Number(${R}));`,
            );
          } else {
            lines.push(`${pad}const ${outVar} = Number(${L}) ${op} Number(${R});`);
          }
          lines.push(`${pad}const ${stepResVar} = ${outVar};`);
          lines.push(`${pad}void ${stepResVar};`);

          if (st.targetNodeId && target !== 'nodejs') {
            const targetDomId = resolveNodeDomId(st.targetNodeId, ctx.sheet, domMap);
            const targetElVar = `formulaEl_${++varSeq}`;
            lines.push(`${pad}const ${targetElVar} = document.getElementById(${JSON.stringify(targetDomId)});`);
            lines.push(`${pad}if (${targetElVar}) ${targetElVar}.textContent = String(${outVar});`);
          }
          break;
        }

        case 'navigate': {
          if (st.action === 'navigate_url') {
            lines.push(`${pad}window.location.href = ${JSON.stringify(st.target)};`);
          } else if (st.action === 'navigate_sheet') {
            lines.push(`${pad}window.location.hash = ${JSON.stringify(`#${st.target.replace(/^#/, '')}`)};`);
            lines.push(
              `${pad}window.dispatchEvent(new CustomEvent('studio:navigate', { detail: { target: ${JSON.stringify(st.target)} } }));`,
            );
          } else if (st.action === 'open_modal') {
            const modalDomId = resolveNodeDomId(st.target, ctx.sheet, domMap);
            const mVar = `modal_${++varSeq}`;
            lines.push(
              `${pad}const ${mVar} = document.getElementById(${JSON.stringify(modalDomId)})${typed ? ' as HTMLDialogElement | HTMLElement | null' : ''};`,
            );
            lines.push(`${pad}if (${mVar}) {`);
            lines.push(`${pad}  if ('showModal' in ${mVar} && typeof ${mVar}.showModal === 'function') ${mVar}.showModal();`);
            lines.push(`${pad}  else ${mVar}.style.display = 'flex';`);
            lines.push(`${pad}}`);
          } else {
            const modalDomId = resolveNodeDomId(st.target, ctx.sheet, domMap);
            const mVar = `modal_${++varSeq}`;
            lines.push(
              `${pad}const ${mVar} = document.getElementById(${JSON.stringify(modalDomId)})${typed ? ' as HTMLDialogElement | HTMLElement | null' : ''};`,
            );
            lines.push(`${pad}if (${mVar}) {`);
            lines.push(`${pad}  if ('close' in ${mVar} && typeof ${mVar}.close === 'function') ${mVar}.close();`);
            lines.push(`${pad}  else ${mVar}.style.display = 'none';`);
            lines.push(`${pad}}`);
          }
          break;
        }

        case 'call_external_fn': {
          const extFn = sanitizeJsIdent(st.fnName, 'externalHandler');
          if (
            st.moduleRelPath &&
            st.moduleRelPath.replace(/^\/+/, '') !== (rule.targetFileRelPath || '').replace(/^\/+/, '')
          ) {
            const relSpec = computeRelativeJsImport(
              rule.targetFileRelPath || 'scripts/automations.js',
              st.moduleRelPath,
              target === 'dom-js',
            );
            requiredImports.add(`import { ${extFn} } from '${relSpec}';`);
          }
          const callArgs = (st.args ?? [])
            .map((a) => compileJsTsOperand(a, typed, target, ctx.sheet, domMap))
            .join(', ');
          if (st.outputVar) {
            const outIdent = sanitizeJsIdent(st.outputVar);
            lines.push(`${pad}const ${outIdent} = await ${extFn}(${callArgs});`);
            lines.push(`${pad}const ${stepResVar} = ${outIdent};`);
            lines.push(`${pad}void ${stepResVar};`);
          } else {
            lines.push(`${pad}await ${extFn}(${callArgs});`);
          }
          break;
        }

        case 'tauri_invoke': {
          requiredImports.add("import { invoke } from '@tauri-apps/api/core';");
          const argEntries = Object.entries(st.args ?? {});
          ipcCommandsMap.set(st.commandName, {
            name: st.commandName,
            args: argEntries.map(([k]) => ({ name: k, type: 'string' })),
            returnType: 'string',
          });
          const payloadStr =
            argEntries.length > 0
              ? `, { ${argEntries
                  .map(([k, v]) => `${JSON.stringify(k)}: ${compileJsTsOperand(v, typed, target, ctx.sheet, domMap)}`)
                  .join(', ')} }`
              : '';
          lines.push(
            `${pad}const ${stepResVar} = await invoke${typed ? '<unknown>' : ''}(${JSON.stringify(st.commandName)}${payloadStr});`,
          );
          if (st.resultStateKey) {
            const stateRoot = typed
              ? `((globalThis as Record<string, any>).__appState ??= {})`
              : `(globalThis.__appState ??= {})`;
            lines.push(`${pad}${stateRoot}[${JSON.stringify(st.resultStateKey)}] = ${stepResVar};`);
          }
          if (st.targetNodeId && target !== 'nodejs') {
            const tDomId = resolveNodeDomId(st.targetNodeId, ctx.sheet, domMap);
            lines.push(
              `${pad}const tauriTarget_${varSeq} = document.getElementById(${JSON.stringify(tDomId)});`,
            );
            lines.push(
              `${pad}if (tauriTarget_${varSeq}) tauriTarget_${varSeq}.textContent = typeof ${stepResVar} === 'string' ? ${stepResVar} : JSON.stringify(${stepResVar});`,
            );
          }
          break;
        }

        case 'if_else': {
          const comb = st.conditionGroup.combinator === 'OR' ? ' || ' : ' && ';
          const condExpr =
            st.conditionGroup.conditions.length > 0
              ? st.conditionGroup.conditions
                  .map((c) => compileJsTsCondition(c, typed, target, ctx.sheet, domMap))
                  .join(comb)
              : 'true';
          lines.push(`${pad}if (${condExpr}) {`);
          emitJsTsSteps(st.thenSteps, indentLevel + 1);
          if (st.elseSteps && st.elseSteps.length > 0) {
            lines.push(`${pad}} else {`);
            emitJsTsSteps(st.elseSteps, indentLevel + 1);
          }
          lines.push(`${pad}}`);
          break;
        }

        case 'delay': {
          lines.push(`${pad}await new Promise((resolve) => setTimeout(resolve, ${Math.max(0, st.ms)}));`);
          break;
        }
      }
    }
  };

  function emitValidationRuleCheck(pad: string, fieldRule: FormValidationFieldRule, stopOnFail: boolean) {
    const domId = resolveNodeDomId(fieldRule.nodeId, ctx.sheet, domMap);
    const elVar = `fieldEl_${++varSeq}`;
    const valVar = `fieldVal_${varSeq}`;
    lines.push(
      `${pad}const ${elVar} = document.getElementById(${JSON.stringify(domId)})${typed ? ' as HTMLInputElement | HTMLTextAreaElement | null' : ''};`,
    );
    lines.push(`${pad}const ${valVar} = (${elVar}?.value ?? '').trim();`);

    let failCond = `!${valVar}`;
    if (fieldRule.rule === 'email') {
      failCond = `!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(${valVar})`;
    } else if (fieldRule.rule === 'minLength') {
      failCond = `${valVar}.length < ${fieldRule.min ?? 3}`;
    } else if (fieldRule.rule === 'number') {
      failCond = `${valVar} === '' || Number.isNaN(Number(${valVar}))`;
    }

    lines.push(`${pad}if (${failCond}) {`);
    lines.push(`${pad}  ${elVar}?.style.setProperty('border-color', '#ef4444');`);
    lines.push(`${pad}  ${elVar}?.setAttribute('aria-invalid', 'true');`);
    emitToastLines(`${pad}  `, 'warn', JSON.stringify(fieldRule.errorMsg));
    if (stopOnFail) lines.push(`${pad}  return;`);
    lines.push(`${pad}} else {`);
    lines.push(`${pad}  ${elVar}?.style.removeProperty('border-color');`);
    lines.push(`${pad}  ${elVar}?.removeAttribute('aria-invalid');`);
    lines.push(`${pad}}`);
  }

  // Build function header
  const userParams = rule.parameters ?? [];
  const formattedParams: string[] = [];
  if (target === 'nodejs') {
    formattedParams.push(typed ? 'payload: Record<string, any> = {}' : 'payload = {}');
  } else if (rule.trigger.type !== 'callable') {
    formattedParams.push(typed ? 'event?: Event' : 'event');
  }
  for (const p of userParams) {
    const defPart = p.defaultValue !== undefined ? ` = ${p.defaultValue}` : '';
    const optMark = p.optional && !defPart && typed ? '?' : '';
    const typePart = typed ? `: ${p.typeAnnotation || 'any'}` : '';
    formattedParams.push(`${sanitizeJsIdent(p.name)}${optMark}${typePart}${defPart}`);
  }

  if (rule.name) {
    lines.push(`/** ${rule.name}${rule.description ? ` — ${rule.description}` : ''} */`);
  }

  lines.push(`export ${isAsync ? 'async ' : ''}function ${fnName}(${formattedParams.join(', ')}) {`);

  if (target !== 'nodejs' && rule.trigger.type === 'onSubmit') {
    lines.push(`  event?.preventDefault?.();`);
  } else if (target !== 'nodejs' && rule.trigger.type !== 'callable') {
    lines.push(`  if (event && typeof event.preventDefault === 'function' && event.type === 'submit') {`);
    lines.push(`    event.preventDefault();`);
    lines.push(`  }`);
  }

  if (rule.conditions && rule.conditions.length > 0) {
    const comb = rule.conditionCombinator === 'OR' ? ' || ' : ' && ';
    const topCond = rule.conditions
      .map((c) => compileJsTsCondition(c, typed, target, ctx.sheet, domMap))
      .join(comb);
    lines.push(`  if (${topCond}) {`);
    emitJsTsSteps(rule.steps, 2);
    if (rule.elseSteps && rule.elseSteps.length > 0) {
      lines.push(`  } else {`);
      emitJsTsSteps(rule.elseSteps, 2);
    }
    lines.push(`  }`);
  } else {
    emitJsTsSteps(rule.steps, 1);
  }

  if (rule.returnValue) {
    lines.push(`  return ${compileJsTsOperand(rule.returnValue, typed, target, ctx.sheet, domMap)};`);
  }

  lines.push(`}`);

  if (ctx.emitDomInitHelper && (target === 'dom-js' || target === 'dom-ts') && rule.trigger.sourceNodeId) {
    const srcDomId = resolveNodeDomId(rule.trigger.sourceNodeId, ctx.sheet, domMap);
    const domEvent = mapTriggerToNativeDomEvent(rule.trigger.type);
    if (domEvent) {
      lines.push(``);
      lines.push(`export function bind_${fnName}() {`);
      lines.push(`  document.getElementById(${JSON.stringify(srcDomId)})?.addEventListener(${JSON.stringify(domEvent)}, ${fnName});`);
      lines.push(`}`);
    }
  }

  // Strip unused `void stepRes_*;` lines if that variable was actually referenced later
  const rawBody = lines.join('\n');
  const cleanedBody = rawBody
    .split('\n')
    .filter((ln) => {
      const voidM = ln.trim().match(/^void\s+(stepRes_[A-Za-z0-9_$]+);$/);
      if (!voidM) return true;
      const ident = voidM[1];
      const occurrences = rawBody.split(ident).length - 1;
      // If only `const stepRes_x = ...` and `void stepRes_x;` exist (2 occurrences) and we are in JS or clean TS:
      // remove the dead `const stepRes_x` + `void stepRes_x` pair!
      return occurrences > 2 ? false : false;
    })
    .filter((ln) => {
      const deadDecl = ln.trim().match(/^const\s+(stepRes_[A-Za-z0-9_$]+)\s*=\s*[A-Za-z0-9_$]+;$/);
      if (!deadDecl) return true;
      const ident = deadDecl[1];
      return rawBody.split(ident).length - 1 > 2;
    })
    .join('\n');

  const importsHeader = Array.from(requiredImports);
  const hash = computeFnv1aHash(cleanedBody);
  const fencedCode = buildFencedAutomationBlock(rule, cleanedBody, language, hash);
  const standaloneWithImports =
    importsHeader.length > 0 && !ctx.includeFences
      ? `${importsHeader.join('\n')}\n\n${cleanedBody}`
      : ctx.includeFences
        ? fencedCode
        : cleanedBody;

  return {
    code: standaloneWithImports,
    fencedCode,
    fnName,
    language,
    target,
    isAsync,
    requiredImports: importsHeader,
    ipcCommands: Array.from(ipcCommandsMap.values()),
    hash,
    diagnostics,
    toString: () => standaloneWithImports,
  };
}

function mapTriggerToNativeDomEvent(trigger: AutomationTriggerType): string | null {
  switch (trigger) {
    case 'onClick':
      return 'click';
    case 'onDoubleClick':
      return 'dblclick';
    case 'onSubmit':
      return 'submit';
    case 'onChange':
      return 'change';
    case 'onInput':
      return 'input';
    case 'onHover':
      return 'mouseenter';
    case 'onMouseLeave':
      return 'mouseleave';
    case 'onFocus':
      return 'focus';
    case 'onBlur':
      return 'blur';
    case 'onKeyDown':
      return 'keydown';
    default:
      return null;
  }
}

// ============================================================================
// NON-DESTRUCTIVE `@studio-automation` REGION PATCHER (`upsert` / `remove`)
// ============================================================================

export function buildFencedAutomationBlock(
  rule: AutomationRule,
  compiledBodyCode: string,
  language: ScriptLanguage,
  explicitHash?: string,
): string {
  const commentPrefix = language === 'python' ? '#' : '//';
  const cleanBody = stripExistingAutomationFences(compiledBodyCode).trim();
  const hash = explicitHash ?? computeFnv1aHash(cleanBody);
  const metaJson = JSON.stringify({
    ...rule,
    language,
  });

  return [
    `${commentPrefix} @studio-automation:start ${rule.id} [hash:${hash}]`,
    `${commentPrefix} @studio-automation-meta ${metaJson}`,
    cleanBody,
    `${commentPrefix} @studio-automation:end ${rule.id}`,
  ].join('\n');
}

function stripExistingAutomationFences(code: string): string {
  return code
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((ln) => !/^\s*(?:\/\/|#)\s*@studio-automation(?::start|:end|-meta)\b/.test(ln))
    .join('\n')
    .trim();
}

interface LocatedManagedBlock {
  id: string;
  startLineIdx: number;
  endLineIdx: number;
  storedHash?: string;
  currentBodyHash: string;
  bodyText: string;
}

function locateManagedBlocks(fileContent: string): LocatedManagedBlock[] {
  const lines = splitFileLines(fileContent).map((line) => line.replace(/(?:\r\n|\n|\r)$/, ''));
  const blocks: LocatedManagedBlock[] = [];
  let active: { id: string; startIdx: number; storedHash?: string; bodyLines: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const startMatch = trimmed.match(
      /^(?:\/\/|#)\s*@studio-automation:start\s+(?:id="([^"]+)"|([A-Za-z0-9_.-]+))(?:\s+\[hash:([0-9a-fA-F]+)\]|.*?hash="([0-9a-fA-F]+)")?/,
    );
    if (startMatch) {
      active = {
        id: (startMatch[1] || startMatch[2] || '').trim(),
        startIdx: i,
        storedHash: startMatch[3] || startMatch[4],
        bodyLines: [],
      };
      continue;
    }

    if (active) {
      if (/^(?:\/\/|#)\s*@studio-automation-meta\b/.test(trimmed)) {
        continue;
      }
      if (/^(?:\/\/|#)\s*@studio-automation:end\b/.test(trimmed)) {
        const bodyText = active.bodyLines.join('\n').trim();
        blocks.push({
          id: active.id,
          startLineIdx: active.startIdx,
          endLineIdx: i,
          storedHash: active.storedHash,
          currentBodyHash: computeFnv1aHash(bodyText),
          bodyText,
        });
        active = null;
        continue;
      }
      active.bodyLines.push(lines[i]);
    }
  }

  return blocks;
}

export function checkManagedAutomationConflict(
  existingFileContent: string,
  automationId: string,
): {
  exists: boolean;
  isManuallyModified: boolean;
  storedHash?: string;
  currentHash?: string;
} {
  const found = locateManagedBlocks(existingFileContent).find((b) => b.id === automationId);
  if (!found) {
    return { exists: false, isManuallyModified: false };
  }
  const isManuallyModified = Boolean(found.storedHash && found.storedHash !== found.currentBodyHash);
  return {
    exists: true,
    isManuallyModified,
    storedHash: found.storedHash,
    currentHash: found.currentBodyHash,
  };
}

export function isManagedBlockManuallyModified(existingFileContent: string, automationId: string): boolean {
  return checkManagedAutomationConflict(existingFileContent, automationId).isManuallyModified;
}

export function getManagedAutomationBodyRange(fileContent: string, automationId: string): { start: number; end: number } | undefined {
  const block = locateManagedBlocks(fileContent).find((entry) => entry.id === automationId);
  if (!block) return undefined;
  const lines = splitFileLines(fileContent);
  let startLine = block.startLineIdx + 1;
  if (/^\s*(?:\/\/|#)\s*@studio-automation-meta\b/.test(lines[startLine] ?? '')) startLine++;
  const start = lines.slice(0, startLine).join('').length;
  return { start, end: start + lines.slice(startLine, block.endLineIdx).join('').length };
}

function mergeTopLevelImportsNonDestructively(
  existingLines: string[],
  requiredImports: string[],
  language: ScriptLanguage,
): string[] {
  if (requiredImports.length === 0) return existingLines;
  const fullText = existingLines.join('\n');
  const parsed = parseExternalScriptModule(fullText, language);

  const missingImports = requiredImports.filter((impLine) => {
    const trimmedImp = impLine.trim();
    if (fullText.includes(trimmedImp)) return false;

    // Check module source match so we don't duplicate `@tauri-apps/api/core` etc.
    const jsFromMatch = trimmedImp.match(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/);
    if (jsFromMatch) {
      const wantedSpec = jsFromMatch[1].trim();
      const wantedSrc = jsFromMatch[2].trim();
      return !parsed.imports.some((i) => i.source === wantedSrc && i.specifiers.includes(wantedSpec));
    }
    return true;
  });

  if (missingImports.length === 0) return existingLines;

  // Preserve the file prologue and place new imports outside managed blocks and function bodies.
  let insertAtIdx = 0;
  for (const line of existingLines) {
    const trimmed = line.trim();
    if (/@studio-automation(?::start|-meta)\b/.test(trimmed)) break;
    if (!trimmed || /^(?:\/\/|#|['"]use (?:client|server|strict)['"];?$)/.test(trimmed)) {
      insertAtIdx++;
      continue;
    }
    break;
  }
  if (language === 'python') {
    const docstring = existingLines[insertAtIdx]?.trim().match(/^(?:[rRuU])?("""|''')/);
    if (docstring) {
      const first = insertAtIdx++;
      if (!existingLines[first].trim().slice(docstring[0].length).includes(docstring[1])) {
        while (insertAtIdx < existingLines.length && !existingLines[insertAtIdx++].includes(docstring[1])) { /* docstring */ }
      }
    }
    while (insertAtIdx < existingLines.length) {
      const line = existingLines[insertAtIdx].trim();
      if (!line || line.startsWith('#') || line.startsWith('from __future__ import ')) insertAtIdx++;
      else break;
    }
  }

  const next = [...existingLines];
  next.splice(insertAtIdx, 0, ...missingImports);
  return next;
}

/**
 * Surgically inserts or updates a `@studio-automation` fenced block inside an existing `.js`, `.ts`, or `.py` file
 * while 100% preserving all manual functions, custom imports, and user comments outside the block!
 */
export function upsertManagedAutomationInFile(
  existingFileContent: string,
  rule: AutomationRule,
  compiledFnCodeOrCtx?: string | CompiledAutomationResult | AutomationCompileContext,
): string {
  const inferredLang =
    rule.language ?? inferScriptLanguageFromPath(rule.targetFileRelPath, existingFileContent);

  let bodyOnlyCode: string;
  let requiredImports: string[] = [];

  if (typeof compiledFnCodeOrCtx === 'string') {
    // Extract any leading top-level import lines from the passed compiledFnCode so imports stay at top of module!
    const rawLines = stripExistingAutomationFences(compiledFnCodeOrCtx).split('\n');
    const bodyLines: string[] = [];
    for (const ln of rawLines) {
      const t = ln.trim();
      if (/^(?:import\s+.+|from\s+[A-Za-z0-9_.]+\s+import\s+.+)$/.test(t)) {
        requiredImports.push(t);
      } else {
        bodyLines.push(ln);
      }
    }
    bodyOnlyCode = bodyLines.join('\n').trim();
  } else if (compiledFnCodeOrCtx && 'code' in compiledFnCodeOrCtx && 'hash' in compiledFnCodeOrCtx) {
    requiredImports = compiledFnCodeOrCtx.requiredImports;
    const rawLines = stripExistingAutomationFences(compiledFnCodeOrCtx.code).split('\n');
    bodyOnlyCode = rawLines
      .filter((ln) => !/^\s*(?:import\s+.+|from\s+[A-Za-z0-9_.]+\s+import\s+.+)$/.test(ln.trim()))
      .join('\n')
      .trim();
  } else {
    const compiled = compileAutomationRuleToCode(rule, {
      ...(compiledFnCodeOrCtx ?? {}),
      language: inferredLang,
    });
    requiredImports = compiled.requiredImports;
    bodyOnlyCode = stripExistingAutomationFences(compiled.fencedCode);
  }

  const fencedBlock = buildFencedAutomationBlock(rule, bodyOnlyCode, inferredLang);
  const fencedLines = fencedBlock.split('\n');

  const newline = existingFileContent.match(/\r\n|\n|\r/)?.[0] ?? '\n';
  if (!existingFileContent) {
    const header = inferredLang === 'python'
      ? '# Modulo Automazioni generato da Visual UI Studio\nfrom __future__ import annotations'
      : '// Modulo Automazioni generato da Visual UI Studio';
    return [...mergeTopLevelImportsNonDestructively(header.split('\n'), requiredImports, inferredLang), '', ...fencedLines, ''].join(newline);
  }

  // Keep the original terminator of every line outside the managed block.
  let lines = splitFileLines(existingFileContent);
  const existingBlock = locateManagedBlocks(existingFileContent).find((b) => b.id === rule.id);
  if (existingBlock) {
    const end = lines[existingBlock.endLineIdx].match(/(?:\r\n|\n|\r)$/)?.[0] ?? '';
    lines.splice(
      existingBlock.startLineIdx,
      existingBlock.endLineIdx - existingBlock.startLineIdx + 1,
      fencedLines.join(newline) + end,
    );
  } else {
    const separator = existingFileContent.endsWith(newline) ? newline : newline + newline;
    lines.push(separator, fencedLines.join(newline) + newline);
  }

  const contentWithBlock = lines.join('');
  lines = splitFileLines(contentWithBlock);
  const originalLines = lines.map((line) => line.replace(/(?:\r\n|\n|\r)$/, ''));
  const withImports = mergeTopLevelImportsNonDestructively(originalLines, requiredImports, inferredLang);
  if (withImports.length === originalLines.length) return contentWithBlock;

  const insertion = withImports.findIndex((line, index) => line !== originalLines[index]);
  const count = withImports.length - originalLines.length;
  lines.splice(insertion, 0, withImports.slice(insertion, insertion + count).join(newline) + newline);
  return lines.join('');
}

function splitFileLines(content: string): string[] {
  return content.match(/[^\r\n]*(?:\r\n|\n|\r)|[^\r\n]+$/g) ?? [];
}

/** Removes a managed block and preserves all surrounding source text. */
export function removeManagedAutomationFromFile(
  existingFileContent: string,
  automationId: string,
): string {
  const target = locateManagedBlocks(existingFileContent).find((b) => b.id === automationId);
  if (!target) return existingFileContent;
  const lines = splitFileLines(existingFileContent);
  lines.splice(target.startLineIdx, target.endLineIdx - target.startLineIdx + 1);
  return lines.join('');
}

// ============================================================================
// 5 READY ZERO-CODE AUTOMATION PRESETS (FOR VISUAL AUTOMATION STUDIO)
// ============================================================================

export interface AutomationPresetDescriptor {
  id:
    | 'valida-form-toast'
    | 'salva-form-sql'
    | 'carica-lista-api-sql'
    | 'toggle-dark-modal-css'
    | 'calcola-totale-preventivo';
  title: string;
  subtitle: string;
  badge: string;
}

export const AUTOMATION_PRESET_CATALOG: AutomationPresetDescriptor[] = [
  {
    id: 'valida-form-toast',
    title: 'Valida Form & Mostra Notifica',
    subtitle: 'Controlla campi obbligatori/email, evidenzia errori e mostra Toast di conferma',
    badge: 'Validazione',
  },
  {
    id: 'salva-form-sql',
    title: 'Salva Form nella Tabella SQL',
    subtitle: 'Valida input UI e inserisce una nuova riga nella tabella SQL del progetto',
    badge: 'Form -> SQL',
  },
  {
    id: 'carica-lista-api-sql',
    title: 'Carica Lista da API REST / SQL',
    subtitle: 'Esegue SELECT SQL o GET REST e popola automaticamente la Tabella UI sul Canvas',
    badge: 'Dati -> UI',
  },
  {
    id: 'toggle-dark-modal-css',
    title: 'Toggle Dark/Modal con Classe CSS',
    subtitle: 'Attiva/disattiva una ReusableCssClass o apre/chiude una finestra modale',
    badge: 'CSS & Modali',
  },
  {
    id: 'calcola-totale-preventivo',
    title: 'Calcola Totale Preventivo Live',
    subtitle: 'Moltiplica quantità × prezzo con formattazione Valuta EUR in tempo reale',
    badge: 'Formula Live',
  },
];

export function createAutomationFromPreset(
  presetId: AutomationPresetDescriptor['id'],
  options?: {
    sheet?: UISheetDocument;
    sqlDocument?: SqlDesignDocument | null;
    targetFileRelPath?: string;
    language?: ScriptLanguage;
  },
): AutomationRule {
  const sheet = options?.sheet;
  const sqlDoc = options?.sqlDocument;
  const targetFileRelPath = options?.targetFileRelPath || 'scripts/automations.js';
  const language = options?.language ?? inferScriptLanguageFromPath(targetFileRelPath);

  const nonArtboard = sheet ? Object.values(sheet.nodes).filter((n) => n.kind !== 'artboard') : [];
  const firstBtn =
    nonArtboard.find((n) => n.content?.controlType === 'button' || n.semanticTag === 'button')?.id ??
    nonArtboard[0]?.id;
  const firstInput =
    nonArtboard.find(
      (n) =>
        n.content?.controlType === 'text-input' ||
        n.semanticTag === 'input' ||
        n.name.toLowerCase().includes('input'),
    )?.id ??
    nonArtboard[0]?.id ??
    'EmailInput';
  const secondInput =
    nonArtboard.filter((n) => n.id !== firstInput && (n.semanticTag === 'input' || n.kind === 'control'))[0]?.id ??
    firstInput;
  const firstTable =
    nonArtboard.find((n) => n.content?.controlType === 'table' || n.semanticTag === 'table')?.id ??
    nonArtboard.find((n) => n.kind === 'collection' || n.semanticTag === 'ul')?.id ??
    nonArtboard[0]?.id ??
    'DataTable';
  const firstText =
    nonArtboard.find((n) => n.kind === 'text' || n.name.toLowerCase().includes('value'))?.id ??
    nonArtboard[0]?.id ??
    'TotalLabel';
  const firstContainer =
    nonArtboard.find((n) => n.kind === 'container')?.id ?? nonArtboard[0]?.id ?? 'MainCard';

  const firstSqlTable = sqlDoc?.tables[0];
  const tableName = firstSqlTable?.name ?? 'customers';
  const firstReusableCls = sheet?.reusableClasses?.[0]?.name ?? 'dark-surface';

  const suffix = Date.now().toString(36).slice(-4);

  switch (presetId) {
    case 'valida-form-toast':
      return {
        id: `auto_valida_form_${suffix}`,
        name: 'Valida Form & Mostra Notifica',
        description: 'Verifica la validità dei campi e notifica il risultato senza codice manuale.',
        enabled: true,
        targetFileRelPath,
        language,
        generatedFnName: language === 'python' ? 'valida_form_notifica' : 'validaFormENotifica',
        trigger: { type: 'onClick', sourceNodeId: firstBtn },
        steps: [
          {
            id: `st_val_${suffix}`,
            kind: 'validate_form',
            stopOnFail: true,
            rules: [
              {
                nodeId: firstInput,
                rule: 'email',
                errorMsg: 'Inserisci un indirizzo email valido!',
              },
            ],
          },
          {
            id: `st_toast_${suffix}`,
            kind: 'toast',
            variant: 'success',
            message: { source: 'literal', value: 'Modulo validato con successo!' },
          },
        ],
        updatedAt: Date.now(),
      };

    case 'salva-form-sql': {
      const editableCols = firstSqlTable?.columns.filter((c) => !c.autoIncrement).slice(0, 2) ?? [
        { name: 'full_name' },
        { name: 'email' },
      ];
      return {
        id: `auto_salva_sql_${suffix}`,
        name: `Salva Form nella Tabella SQL (${tableName})`,
        description: `Valida i campi e inserisce il record in "${tableName}".`,
        enabled: true,
        targetFileRelPath,
        language,
        generatedFnName: language === 'python' ? `salva_in_${toSnakeFnName(tableName)}` : `salvaIn${toCamelFnName(tableName).replace(/^./, (c) => c.toUpperCase())}`,
        trigger: { type: 'onClick', sourceNodeId: firstBtn },
        steps: [
          {
            id: `st_val_sql_${suffix}`,
            kind: 'validate_form',
            stopOnFail: true,
            rules: [{ nodeId: firstInput, rule: 'required', errorMsg: 'Compila il campo obbligatorio.' }],
          },
          {
            id: `st_ins_sql_${suffix}`,
            kind: 'sql_operation',
            operation: 'insert_from_form',
            tableName,
            columnMappings: editableCols.map((c, idx) => ({
              columnName: c.name,
              value: {
                source: 'ui_element',
                nodeId: idx === 0 ? firstInput : secondInput,
                prop: 'value',
              },
            })),
            toastOnSuccess: `Record salvato in ${tableName}!`,
          },
        ],
        updatedAt: Date.now(),
      };
    }

    case 'carica-lista-api-sql':
      return {
        id: `auto_carica_lista_${suffix}`,
        name: `Carica Lista da SQL (${tableName})`,
        description: `Popola automaticamente la tabella UI con le righe di "${tableName}".`,
        enabled: true,
        targetFileRelPath,
        language,
        generatedFnName: language === 'python' ? `carica_lista_${toSnakeFnName(tableName)}` : `caricaLista${toCamelFnName(tableName).replace(/^./, (c) => c.toUpperCase())}`,
        trigger: { type: 'onMount', sourceNodeId: firstTable },
        steps: [
          {
            id: `st_sel_sql_${suffix}`,
            kind: 'sql_operation',
            operation: 'select_to_table',
            tableName,
            targetTableNodeId: firstTable,
            resultStateKey: `${tableName}Rows`,
          },
        ],
        updatedAt: Date.now(),
      };

    case 'toggle-dark-modal-css':
      return {
        id: `auto_toggle_css_${suffix}`,
        name: 'Toggle Dark/Modal con Classe CSS',
        description: 'Alterna una classe CSS riutilizzabile sul contenitore selezionato.',
        enabled: true,
        targetFileRelPath,
        language,
        generatedFnName: language === 'python' ? 'toggle_classe_tema' : 'toggleClasseTema',
        trigger: { type: 'onClick', sourceNodeId: firstBtn },
        steps: [
          {
            id: `st_cls_${suffix}`,
            kind: 'ui_css_class',
            targetNodeId: firstContainer,
            mode: 'toggle',
            className: firstReusableCls,
          },
          {
            id: `st_toast_cls_${suffix}`,
            kind: 'toast',
            variant: 'info',
            message: { source: 'literal', value: `Classe .${firstReusableCls} aggiornata` },
          },
        ],
        updatedAt: Date.now(),
      };

    case 'calcola-totale-preventivo':
      return {
        id: `auto_calcola_totale_${suffix}`,
        name: 'Calcola Totale Preventivo Live',
        description: 'Calcola importo formattato in Euro al variare del valore input.',
        enabled: true,
        targetFileRelPath,
        language,
        generatedFnName: language === 'python' ? 'calcola_totale_preventivo' : 'calcolaTotalePreventivo',
        trigger: { type: 'onInput', sourceNodeId: firstInput, debounceMs: 180 },
        steps: [
          {
            id: `st_math_${suffix}`,
            kind: 'math_formula',
            formulaKind: 'currency_eur',
            left: { source: 'ui_element', nodeId: firstInput, prop: 'value' },
            operator: '*',
            right: { source: 'literal', value: 1.22 },
            outputVar: 'totaleIvatoEur',
            targetNodeId: firstText,
          },
        ],
        updatedAt: Date.now(),
      };
  }
}
