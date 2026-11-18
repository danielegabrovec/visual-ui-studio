import type { StudioRuntimeContext } from '@shared/script-ir';

interface RuntimeNode {
  id: string;
  name: string;
  text?: string;
  value?: string;
}

export interface ScriptTestInput {
  code: string;
  selectedFunction: string;
  exportedFunctions: string[];
  state: Record<string, unknown>;
  values: Record<string, string>;
  nodes: RuntimeNode[];
}

interface TestLog {
  message: string;
  kind: 'script' | 'warn' | 'error';
}

export interface ScriptTestResult {
  logs: TestLog[];
  notices: Array<{ kind: 'info' | 'success' | 'warn' | 'error'; message: string }>;
  state: Record<string, unknown>;
  values: Record<string, string>;
  error?: string;
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export async function runScriptTest(input: ScriptTestInput): Promise<ScriptTestResult> {
  const logs: TestLog[] = [];
  const notices: ScriptTestResult['notices'] = [];
  const state = { ...input.state };
  const values = { ...input.values };
  const nodes = new Map(input.nodes.map((node) => [node.id, node]));
  const byName = new Map(input.nodes.map((node) => [node.name.toLowerCase(), node]));
  const nodeFor = (idOrName: string) => nodes.get(idOrName) ?? byName.get(idOrName.toLowerCase());
  const pushLog = (prefix: string, args: unknown[], kind: TestLog['kind'] = 'script') => {
    if (logs.length < 100) logs.push({ kind, message: `${prefix}${args.map(formatValue).join(' ')}`.trim().slice(0, 3000) });
  };

  const ctx: StudioRuntimeContext = {
    state,
    getText(idOrName) {
      const node = nodeFor(idOrName);
      return values[idOrName] ?? node?.text ?? node?.value ?? (idOrName === 'EmailInput' ? 'cliente@novacommerce.it' : '');
    },
    getValue(idOrName) {
      const node = nodeFor(idOrName);
      return values[idOrName] ?? node?.value ?? node?.text ??
        (idOrName === 'EmailInput' ? 'cliente@novacommerce.it' : idOrName === 'SearchInput' ? 'GPU' : '');
    },
    setText(idOrName, text) {
      values[idOrName] = String(text);
      pushLog('[DOM setText] ', [idOrName, '→', text]);
    },
    setValue(idOrName, value) {
      values[idOrName] = String(value);
      pushLog('[DOM setValue] ', [idOrName, '=', value]);
    },
    setStyle: (idOrName, patch) => pushLog('[DOM setStyle] ', [idOrName, patch]),
    setVisible: (idOrName, visible) => pushLog('[DOM setVisible] ', [idOrName, visible ? 'visible' : 'hidden']),
    log: (...args) => pushLog('', args),
    toast(message, kind = 'info') {
      if (notices.length < 10) notices.push({ kind, message: String(message).slice(0, 1000) });
      pushLog(`[Toast ${kind}] `, [message]);
    },
    three: {
      rotate: (name, x, y, z) => pushLog('[Three.js rotate] ', [`${name} (${x}°, ${y}°, ${z}°)`]),
      setColor: (name, color) => pushLog('[Three.js setColor] ', [`${name} → ${color}`]),
    },
  };
  const testConsole = {
    log: (...args: unknown[]) => pushLog('[console.log] ', args),
    info: (...args: unknown[]) => pushLog('[console.info] ', args),
    warn: (...args: unknown[]) => pushLog('[console.warn] ', args, 'warn'),
    error: (...args: unknown[]) => pushLog('[console.error] ', args, 'error'),
  };
  try {
    const handlers: Record<string, (context: StudioRuntimeContext) => unknown> = Object.create(null);
    new Function('window', 'console', input.code)({ __studioScriptHandlers: handlers }, testConsole);
    const target = typeof handlers[input.selectedFunction] === 'function' ? input.selectedFunction : input.exportedFunctions[0];
    if (target && typeof handlers[target] === 'function') {
      const returned = await handlers[target](ctx);
      if (returned !== undefined) pushLog(`Return (${target}): `, [returned]);
      else if (logs.length === 0) pushLog(`Eseguito ${target}(ctx).`, []);
    } else if (logs.length === 0) {
      pushLog('Modulo script valutato.', []);
    }

    const json = JSON.stringify(state, (_, value: unknown) => typeof value === 'bigint' ? String(value) : value);
    if (json.length > 250_000) throw new Error('Lo stato di test supera la dimensione consentita.');
    return { logs, notices, state: JSON.parse(json), values };
  } catch (error) {
    return { logs, notices, state: input.state, values: input.values, error: error instanceof Error ? error.message : String(error) };
  }
}
