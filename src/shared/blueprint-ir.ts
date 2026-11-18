import {
  compileAutomationRuleToCode,
  toCamelFnName,
  toSnakeFnName,
  upsertManagedAutomationInFile,
  type AutomationCodegenTarget,
  type AutomationCondition,
  type AutomationRule,
  type AutomationStep,
  type AutomationTriggerType,
  type ConditionOperator,
  type ScriptLanguage,
  type ValueOperand,
} from './automation-ir';
import { inferScriptLanguageFromPath } from './script-ir';
import type { SqlDesignDocument } from './sql-ir';
import type { CodeDiagnostic, CodeSourceMapSpan, NodeId, UISheetDocument } from './ui-ir';

/**
 * Unreal Engine-Style Visual Scripting Blueprint IR, Catalog, Bezier Geometry,
 * TypeScript Compiler & Step-by-Step Simulator.
 */

export type BlueprintCategory = 'event' | 'flow' | 'ui_action' | 'math_logic' | 'async_3d';

export type BlueprintPinDataType = 'exec' | 'boolean' | 'number' | 'string' | 'any';

export type BlueprintNodeKind =
  // 🔴 Events
  | 'event_begin_play'
  | 'event_ui_click'
  | 'event_input_change'
  | 'event_key_press'
  | 'event_3d_click'
  // ⚪ Flow Control
  | 'flow_branch'
  | 'flow_sequence'
  | 'flow_foreach'
  | 'flow_delay'
  // 🔵 UI & Style Actions
  | 'ui_set_text'
  | 'ui_get_input'
  | 'ui_set_style'
  | 'ui_set_visibility'
  | 'ui_show_toast'
  | 'ui_navigate'
  // 🟢 Variables, Math & Data
  | 'data_get_var'
  | 'data_set_var'
  | 'math_op'
  | 'logic_compare'
  | 'string_format'
  // 🟣 Network, Three.js 3D & Script
  | 'net_http_fetch'
  | 'three_transform'
  | 'debug_log'
  | 'custom_ts_expr';

export interface BlueprintPin {
  id: string;
  name: string;
  label: string;
  direction: 'in' | 'out';
  dataType: BlueprintPinDataType;
  defaultValue?: string | number | boolean;
}

export interface BlueprintNode {
  id: string;
  kind: BlueprintNodeKind;
  category: BlueprintCategory;
  title: string;
  subtitle?: string;
  x: number;
  y: number;
  targetUiNodeId?: NodeId;
  config?: Record<string, string | number | boolean>;
  inputs: BlueprintPin[];
  outputs: BlueprintPin[];
}

export interface BlueprintWire {
  id: string;
  fromNodeId: string;
  fromPinId: string;
  toNodeId: string;
  toPinId: string;
  isExec: boolean;
}

export interface BlueprintVariable {
  id: string;
  name: string;
  type: 'string' | 'number' | 'boolean';
  initialValue: string | number | boolean;
}

export interface BlueprintGraphDocument {
  id: string;
  projectId: string;
  name: string;
  sheetId?: string;
  viewport: { x: number; y: number; zoom: number };
  variables: BlueprintVariable[];
  nodes: BlueprintNode[];
  wires: BlueprintWire[];
  updatedAt: number;
}

export interface BlueprintNodeTemplate {
  kind: BlueprintNodeKind;
  category: BlueprintCategory;
  title: string;
  subtitle: string;
  headerGradient: [string, string];
  defaultConfig?: Record<string, string | number | boolean>;
  inputs: Array<Omit<BlueprintPin, 'id'>>;
  outputs: Array<Omit<BlueprintPin, 'id'>>;
}

export const BLUEPRINT_CATEGORY_THEME: Record<
  BlueprintCategory,
  { label: string; gradient: [string, string]; accent: string }
> = {
  event: { label: 'Eventi', gradient: ['#b91c1c', '#ef4444'], accent: '#ef4444' },
  flow: { label: 'Controllo Flusso', gradient: ['#334155', '#64748b'], accent: '#94a3b8' },
  ui_action: { label: 'Azioni UI & Stile', gradient: ['#1d4ed8', '#3b82f6'], accent: '#3b82f6' },
  math_logic: { label: 'Variabili & Matematica', gradient: ['#047857', '#10b981'], accent: '#10b981' },
  async_3d: { label: 'Rete, 3D & Script', gradient: ['#6d28d9', '#8b5cf6'], accent: '#8b5cf6' },
};

export const BLUEPRINT_PIN_COLORS: Record<BlueprintPinDataType, string> = {
  exec: '#f8fafc',
  boolean: '#ef4444',
  number: '#10b981',
  string: '#ec4899',
  any: '#f59e0b',
};

export const BLUEPRINT_NODE_CATALOG: BlueprintNodeTemplate[] = [
  // 🔴 EVENTS
  {
    kind: 'event_begin_play',
    category: 'event',
    title: 'Event BeginPlay (Avvio)',
    subtitle: 'Eseguito al caricamento della schermata',
    headerGradient: ['#b91c1c', '#ef4444'],
    inputs: [],
    outputs: [{ name: 'then', label: 'Exec', direction: 'out', dataType: 'exec' }],
  },
  {
    kind: 'event_ui_click',
    category: 'event',
    title: 'On UI Element Click',
    subtitle: 'Click su pulsante o nodo Canvas',
    headerGradient: ['#b91c1c', '#ef4444'],
    defaultConfig: { elementName: 'CreateOrderButton' },
    inputs: [],
    outputs: [
      { name: 'then', label: 'Exec', direction: 'out', dataType: 'exec' },
      { name: 'elementId', label: 'Element ID', direction: 'out', dataType: 'string' },
    ],
  },
  {
    kind: 'event_input_change',
    category: 'event',
    title: 'On Input Change',
    subtitle: 'Variazione testo campo input',
    headerGradient: ['#b91c1c', '#ef4444'],
    defaultConfig: { elementName: 'TextInputField' },
    inputs: [],
    outputs: [
      { name: 'then', label: 'Exec', direction: 'out', dataType: 'exec' },
      { name: 'value', label: 'Testo Input', direction: 'out', dataType: 'string' },
    ],
  },
  {
    kind: 'event_key_press',
    category: 'event',
    title: 'On Key Press',
    subtitle: 'Pressione tasto tastiera',
    headerGradient: ['#b91c1c', '#ef4444'],
    defaultConfig: { key: 'Enter' },
    inputs: [],
    outputs: [
      { name: 'then', label: 'Exec', direction: 'out', dataType: 'exec' },
      { name: 'key', label: 'Key', direction: 'out', dataType: 'string' },
    ],
  },
  {
    kind: 'event_3d_click',
    category: 'event',
    title: 'On 3D Object Click',
    subtitle: 'Raycaster click su mesh Three.js',
    headerGradient: ['#b91c1c', '#ef4444'],
    defaultConfig: { meshName: 'HeroMesh' },
    inputs: [],
    outputs: [
      { name: 'then', label: 'Exec', direction: 'out', dataType: 'exec' },
      { name: 'meshName', label: 'Mesh Name', direction: 'out', dataType: 'string' },
    ],
  },

  // ⚪ FLOW CONTROL
  {
    kind: 'flow_branch',
    category: 'flow',
    title: 'Branch (If / Else)',
    subtitle: 'Devia il flusso in base a Condition',
    headerGradient: ['#334155', '#64748b'],
    inputs: [
      { name: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { name: 'condition', label: 'Condition', direction: 'in', dataType: 'boolean', defaultValue: true },
    ],
    outputs: [
      { name: 'true', label: 'True', direction: 'out', dataType: 'exec' },
      { name: 'false', label: 'False', direction: 'out', dataType: 'exec' },
    ],
  },
  {
    kind: 'flow_sequence',
    category: 'flow',
    title: 'Sequence',
    subtitle: 'Esegue Then 0 e Then 1 in ordine',
    headerGradient: ['#334155', '#64748b'],
    inputs: [{ name: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' }],
    outputs: [
      { name: 'then0', label: 'Then 0', direction: 'out', dataType: 'exec' },
      { name: 'then1', label: 'Then 1', direction: 'out', dataType: 'exec' },
    ],
  },
  {
    kind: 'flow_foreach',
    category: 'flow',
    title: 'ForEach Loop',
    subtitle: 'Itera N volte sul corpo del ciclo',
    headerGradient: ['#334155', '#64748b'],
    inputs: [
      { name: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { name: 'count', label: 'Count', direction: 'in', dataType: 'number', defaultValue: 3 },
    ],
    outputs: [
      { name: 'loopBody', label: 'Loop Body', direction: 'out', dataType: 'exec' },
      { name: 'index', label: 'Index', direction: 'out', dataType: 'number' },
      { name: 'completed', label: 'Completed', direction: 'out', dataType: 'exec' },
    ],
  },
  {
    kind: 'flow_delay',
    category: 'flow',
    title: 'Delay (ms)',
    subtitle: 'Attesa asincrona non bloccante',
    headerGradient: ['#334155', '#64748b'],
    inputs: [
      { name: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { name: 'ms', label: 'Durata (ms)', direction: 'in', dataType: 'number', defaultValue: 300 },
    ],
    outputs: [{ name: 'completed', label: 'Completed', direction: 'out', dataType: 'exec' }],
  },

  // 🔵 UI & STYLE ACTIONS
  {
    kind: 'ui_set_text',
    category: 'ui_action',
    title: 'Set Element Text',
    subtitle: 'Aggiorna testo di un nodo UI',
    headerGradient: ['#1d4ed8', '#3b82f6'],
    defaultConfig: { targetName: 'OrdersValue' },
    inputs: [
      { name: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { name: 'text', label: 'Nuovo Testo', direction: 'in', dataType: 'string', defaultValue: 'Ordine Confermato ✓' },
    ],
    outputs: [{ name: 'then', label: 'Exec', direction: 'out', dataType: 'exec' }],
  },
  {
    kind: 'ui_get_input',
    category: 'ui_action',
    title: 'Get Input Value',
    subtitle: 'Legge il valore corrente di un Input',
    headerGradient: ['#1d4ed8', '#3b82f6'],
    defaultConfig: { targetName: 'TextInputField' },
    inputs: [],
    outputs: [{ name: 'value', label: 'Valore', direction: 'out', dataType: 'string' }],
  },
  {
    kind: 'ui_set_style',
    category: 'ui_action',
    title: 'Set Element Style / Color',
    subtitle: 'Modifica colore / sfondo nodo UI',
    headerGradient: ['#1d4ed8', '#3b82f6'],
    defaultConfig: { targetName: 'HeroBannerCard', property: 'background' },
    inputs: [
      { name: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { name: 'color', label: 'Colore CSS', direction: 'in', dataType: 'string', defaultValue: '#1e3a8a' },
    ],
    outputs: [{ name: 'then', label: 'Exec', direction: 'out', dataType: 'exec' }],
  },
  {
    kind: 'ui_set_visibility',
    category: 'ui_action',
    title: 'Set Visibility',
    subtitle: 'Mostra o nasconde un nodo UI',
    headerGradient: ['#1d4ed8', '#3b82f6'],
    defaultConfig: { targetName: 'HeroBannerCard' },
    inputs: [
      { name: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { name: 'visible', label: 'Visibile', direction: 'in', dataType: 'boolean', defaultValue: true },
    ],
    outputs: [{ name: 'then', label: 'Exec', direction: 'out', dataType: 'exec' }],
  },
  {
    kind: 'ui_show_toast',
    category: 'ui_action',
    title: 'Show Toast / Alert',
    subtitle: 'Mostra notifica interattiva',
    headerGradient: ['#1d4ed8', '#3b82f6'],
    inputs: [
      { name: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { name: 'message', label: 'Messaggio', direction: 'in', dataType: 'string', defaultValue: 'Operazione completata!' },
    ],
    outputs: [{ name: 'then', label: 'Exec', direction: 'out', dataType: 'exec' }],
  },
  {
    kind: 'ui_navigate',
    category: 'ui_action',
    title: 'Navigate Sheet',
    subtitle: 'Passa a un altro foglio / route',
    headerGradient: ['#1d4ed8', '#3b82f6'],
    inputs: [
      { name: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { name: 'route', label: 'Foglio / Route', direction: 'in', dataType: 'string', defaultValue: 'HomeDashboard' },
    ],
    outputs: [{ name: 'then', label: 'Exec', direction: 'out', dataType: 'exec' }],
  },

  // 🟢 VARIABLES, MATH & DATA
  {
    kind: 'data_get_var',
    category: 'math_logic',
    title: 'Get State Variable',
    subtitle: 'Legge variabile reattiva',
    headerGradient: ['#047857', '#10b981'],
    defaultConfig: { varName: 'orderCount' },
    inputs: [],
    outputs: [{ name: 'value', label: 'Value', direction: 'out', dataType: 'any' }],
  },
  {
    kind: 'data_set_var',
    category: 'math_logic',
    title: 'Set State Variable',
    subtitle: 'Scrive variabile reattiva',
    headerGradient: ['#047857', '#10b981'],
    defaultConfig: { varName: 'orderCount' },
    inputs: [
      { name: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { name: 'value', label: 'Value', direction: 'in', dataType: 'any', defaultValue: 1 },
    ],
    outputs: [
      { name: 'then', label: 'Exec', direction: 'out', dataType: 'exec' },
      { name: 'outValue', label: 'Value', direction: 'out', dataType: 'any' },
    ],
  },
  {
    kind: 'math_op',
    category: 'math_logic',
    title: 'Math (+, -, ×, ÷)',
    subtitle: 'Operazione aritmetica pura',
    headerGradient: ['#047857', '#10b981'],
    defaultConfig: { op: '+' },
    inputs: [
      { name: 'a', label: 'A', direction: 'in', dataType: 'number', defaultValue: 1482 },
      { name: 'b', label: 'B', direction: 'in', dataType: 'number', defaultValue: 1 },
    ],
    outputs: [{ name: 'result', label: 'Result', direction: 'out', dataType: 'number' }],
  },
  {
    kind: 'logic_compare',
    category: 'math_logic',
    title: 'Compare (==, !=, >, <)',
    subtitle: 'Confronto logico booleano',
    headerGradient: ['#047857', '#10b981'],
    defaultConfig: { op: '>' },
    inputs: [
      { name: 'a', label: 'A', direction: 'in', dataType: 'number', defaultValue: 10 },
      { name: 'b', label: 'B', direction: 'in', dataType: 'number', defaultValue: 0 },
    ],
    outputs: [{ name: 'result', label: 'Result', direction: 'out', dataType: 'boolean' }],
  },
  {
    kind: 'string_format',
    category: 'math_logic',
    title: 'Format String',
    subtitle: 'Concatena prefisso e valore',
    headerGradient: ['#047857', '#10b981'],
    inputs: [
      { name: 'prefix', label: 'Prefisso', direction: 'in', dataType: 'string', defaultValue: 'Ordini Attivi: ' },
      { name: 'value', label: 'Valore', direction: 'in', dataType: 'any', defaultValue: '1483' },
    ],
    outputs: [{ name: 'text', label: 'Testo', direction: 'out', dataType: 'string' }],
  },

  // 🟣 NETWORK, THREE.JS 3D & SCRIPT
  {
    kind: 'net_http_fetch',
    category: 'async_3d',
    title: 'HTTP Fetch JSON',
    subtitle: 'Richiesta REST API asincrona',
    headerGradient: ['#6d28d9', '#8b5cf6'],
    inputs: [
      { name: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { name: 'url', label: 'Endpoint URL', direction: 'in', dataType: 'string', defaultValue: '/api/orders/stats' },
    ],
    outputs: [
      { name: 'then', label: 'On Success', direction: 'out', dataType: 'exec' },
      { name: 'responseJson', label: 'JSON Data', direction: 'out', dataType: 'any' },
    ],
  },
  {
    kind: 'three_transform',
    category: 'async_3d',
    title: 'Three.js Rotate / Set Color',
    subtitle: 'Anima o colora oggetto 3D',
    headerGradient: ['#6d28d9', '#8b5cf6'],
    defaultConfig: { meshName: 'HeroMesh' },
    inputs: [
      { name: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { name: 'rotY', label: 'Rotazione Y°', direction: 'in', dataType: 'number', defaultValue: 45 },
      { name: 'color', label: 'Colore Hex', direction: 'in', dataType: 'string', defaultValue: '#8b5cf6' },
    ],
    outputs: [{ name: 'then', label: 'Exec', direction: 'out', dataType: 'exec' }],
  },
  {
    kind: 'debug_log',
    category: 'async_3d',
    title: 'Console Log',
    subtitle: 'Stampa valore nella Console Studio',
    headerGradient: ['#6d28d9', '#8b5cf6'],
    inputs: [
      { name: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { name: 'message', label: 'Messaggio', direction: 'in', dataType: 'any', defaultValue: 'Blueprint eseguito!' },
    ],
    outputs: [{ name: 'then', label: 'Exec', direction: 'out', dataType: 'exec' }],
  },
  {
    kind: 'custom_ts_expr',
    category: 'async_3d',
    title: 'Custom TS/JS Expression',
    subtitle: 'Espressione TypeScript inline',
    headerGradient: ['#6d28d9', '#8b5cf6'],
    defaultConfig: { expression: 'new Date().toLocaleTimeString()' },
    inputs: [{ name: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' }],
    outputs: [
      { name: 'then', label: 'Exec', direction: 'out', dataType: 'exec' },
      { name: 'result', label: 'Result', direction: 'out', dataType: 'any' },
    ],
  },
];

let bpSeq = 0;
export function createBlueprintNode(
  kind: BlueprintNodeKind,
  pos: { x: number; y: number },
  overrides?: Partial<Pick<BlueprintNode, 'id' | 'title' | 'targetUiNodeId' | 'config'>>,
): BlueprintNode {
  const tpl = BLUEPRINT_NODE_CATALOG.find((t) => t.kind === kind) ?? BLUEPRINT_NODE_CATALOG[0];
  const nodeId = overrides?.id ?? `bpn_${++bpSeq}_${Date.now().toString(36)}`;
  return {
    id: nodeId,
    kind: tpl.kind,
    category: tpl.category,
    title: overrides?.title ?? tpl.title,
    subtitle: tpl.subtitle,
    x: Math.round(pos.x),
    y: Math.round(pos.y),
    targetUiNodeId: overrides?.targetUiNodeId,
    config: { ...(tpl.defaultConfig ?? {}), ...(overrides?.config ?? {}) },
    inputs: tpl.inputs.map((p) => ({ ...p, id: `${nodeId}_in_${p.name}` })),
    outputs: tpl.outputs.map((p) => ({ ...p, id: `${nodeId}_out_${p.name}` })),
  };
}

export function computeBezierWirePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.abs(x2 - x1);
  const offset = Math.max(64, Math.min(220, dx * 0.55));
  const c1x = x1 + offset;
  const c2x = x2 - offset;
  return `M ${Math.round(x1)} ${Math.round(y1)} C ${Math.round(c1x)} ${Math.round(y1)}, ${Math.round(c2x)} ${Math.round(y2)}, ${Math.round(x2)} ${Math.round(y2)}`;
}

export function canConnectBlueprintPins(
  fromNode: BlueprintNode,
  fromPin: BlueprintPin,
  toNode: BlueprintNode,
  toPin: BlueprintPin,
): boolean {
  if (fromNode.id === toNode.id) return false;
  if (fromPin.direction !== 'out' || toPin.direction !== 'in') return false;
  if (fromPin.dataType === 'exec' || toPin.dataType === 'exec') {
    return fromPin.dataType === 'exec' && toPin.dataType === 'exec';
  }
  if (fromPin.dataType === 'any' || toPin.dataType === 'any') return true;
  if (toPin.dataType === 'string') return true; // numbers/booleans coerce cleanly to string
  return fromPin.dataType === toPin.dataType;
}

export function createStarterBlueprintGraph(
  projectId: string,
  sheetId?: string,
  primaryButtonNodeId = 'nd_primary_cta',
  targetTextNodeId = 'nd_kpi_ord_value',
): BlueprintGraphDocument {
  const evNode = createBlueprintNode('event_ui_click', { x: 60, y: 110 }, {
    id: 'bp_ev_click',
    targetUiNodeId: primaryButtonNodeId,
    config: { elementName: 'CreateOrderButton' },
  });
  const getVar = createBlueprintNode('data_get_var', { x: 60, y: 290 }, {
    id: 'bp_get_orders',
    config: { varName: 'orderCount' },
  });
  const mathAdd = createBlueprintNode('math_op', { x: 320, y: 270 }, {
    id: 'bp_math_inc',
    config: { op: '+' },
  });
  const setVar = createBlueprintNode('data_set_var', { x: 350, y: 100 }, {
    id: 'bp_set_orders',
    config: { varName: 'orderCount' },
  });
  const fmtStr = createBlueprintNode('string_format', { x: 600, y: 270 }, {
    id: 'bp_fmt_label',
  });
  fmtStr.inputs[0].defaultValue = '';
  const setText = createBlueprintNode('ui_set_text', { x: 650, y: 100 }, {
    id: 'bp_ui_set_text',
    targetUiNodeId: targetTextNodeId,
    config: { targetName: 'OrdersValue' },
  });
  const logNode = createBlueprintNode('debug_log', { x: 940, y: 100 }, {
    id: 'bp_debug_log',
  });

  const wires: BlueprintWire[] = [
    {
      id: 'w_exec_1',
      fromNodeId: evNode.id,
      fromPinId: evNode.outputs[0].id,
      toNodeId: setVar.id,
      toPinId: setVar.inputs[0].id,
      isExec: true,
    },
    {
      id: 'w_data_1',
      fromNodeId: getVar.id,
      fromPinId: getVar.outputs[0].id,
      toNodeId: mathAdd.id,
      toPinId: mathAdd.inputs[0].id,
      isExec: false,
    },
    {
      id: 'w_data_2',
      fromNodeId: mathAdd.id,
      fromPinId: mathAdd.outputs[0].id,
      toNodeId: setVar.id,
      toPinId: setVar.inputs[1].id,
      isExec: false,
    },
    {
      id: 'w_exec_2',
      fromNodeId: setVar.id,
      fromPinId: setVar.outputs[0].id,
      toNodeId: setText.id,
      toPinId: setText.inputs[0].id,
      isExec: true,
    },
    {
      id: 'w_data_3',
      fromNodeId: setVar.id,
      fromPinId: setVar.outputs[1].id,
      toNodeId: fmtStr.id,
      toPinId: fmtStr.inputs[1].id,
      isExec: false,
    },
    {
      id: 'w_data_4',
      fromNodeId: fmtStr.id,
      fromPinId: fmtStr.outputs[0].id,
      toNodeId: setText.id,
      toPinId: setText.inputs[1].id,
      isExec: false,
    },
    {
      id: 'w_exec_3',
      fromNodeId: setText.id,
      fromPinId: setText.outputs[0].id,
      toNodeId: logNode.id,
      toPinId: logNode.inputs[0].id,
      isExec: true,
    },
    {
      id: 'w_data_5',
      fromNodeId: fmtStr.id,
      fromPinId: fmtStr.outputs[0].id,
      toNodeId: logNode.id,
      toPinId: logNode.inputs[1].id,
      isExec: false,
    },
  ];

  return {
    id: `bp_graph_${projectId.slice(-6)}`,
    projectId,
    name: 'MainInteractionFlow',
    sheetId,
    viewport: { x: 20, y: 20, zoom: 0.9 },
    variables: [{ id: 'var_orders', name: 'orderCount', type: 'number', initialValue: 1482 }],
    nodes: [evNode, getVar, mathAdd, setVar, fmtStr, setText, logNode],
    wires,
    updatedAt: Date.now(),
  };
}

function formatLiteralTs(val: string | number | boolean | undefined, fallback: string): string {
  if (val === undefined) return fallback;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return JSON.stringify(String(val));
}

export function compileBlueprintToTs(graph: BlueprintGraphDocument): {
  code: string;
  sourceMap: CodeSourceMapSpan[];
  diagnostics: CodeDiagnostic[];
} {
  const lines: string[] = [];
  const sourceMap: CodeSourceMapSpan[] = [];
  const diagnostics: CodeDiagnostic[] = [];
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  lines.push(`// ============================================================================`);
  lines.push(`// Blueprint Visual Graph Compilato -> TypeScript (${graph.name})`);
  lines.push(`// Generato deterministicamente da Visual UI Studio Blueprint Compiler`);
  lines.push(`// ============================================================================`);
  lines.push(``);
  lines.push(`import type { StudioRuntimeContext } from './studio-runtime';`);
  lines.push(``);
  lines.push(`export const blueprintInitialState: Record<string, any> = {`);
  for (const v of graph.variables) {
    lines.push(`  ${v.name}: ${formatLiteralTs(v.initialValue, 'null')},`);
  }
  lines.push(`};`);
  lines.push(``);

  const resolveDataExpr = (node: BlueprintNode, pinName: string, visited = new Set<string>()): string => {
    const pin = node.inputs.find((p) => p.name === pinName);
    if (!pin) return 'undefined';
    const wire = graph.wires.find((w) => !w.isExec && w.toNodeId === node.id && w.toPinId === pin.id);
    if (!wire) {
      return formatLiteralTs(pin.defaultValue, "''");
    }
    if (visited.has(wire.fromNodeId)) return 'undefined';
    const nextVisited = new Set(visited);
    nextVisited.add(wire.fromNodeId);

    const srcNode = nodeMap.get(wire.fromNodeId);
    if (!srcNode) return formatLiteralTs(pin.defaultValue, "''");

    switch (srcNode.kind) {
      case 'data_get_var':
        return `ctx.state[${JSON.stringify(String(srcNode.config?.varName ?? 'value'))}]`;
      case 'data_set_var':
        return `ctx.state[${JSON.stringify(String(srcNode.config?.varName ?? 'value'))}]`;
      case 'ui_get_input':
        return `ctx.getValue(${JSON.stringify(String(srcNode.targetUiNodeId || srcNode.config?.targetName || 'input'))})`;
      case 'math_op': {
        const op = String(srcNode.config?.op ?? '+');
        const safeOp = op === '×' ? '*' : op === '÷' ? '/' : op;
        return `(Number(${resolveDataExpr(srcNode, 'a', nextVisited)}) ${safeOp} Number(${resolveDataExpr(srcNode, 'b', nextVisited)}))`;
      }
      case 'logic_compare': {
        const op = String(srcNode.config?.op ?? '==');
        const safeOp = op === '==' ? '===' : op === '!=' ? '!==' : op;
        return `(${resolveDataExpr(srcNode, 'a', nextVisited)} ${safeOp} ${resolveDataExpr(srcNode, 'b', nextVisited)})`;
      }
      case 'string_format':
        return `(String(${resolveDataExpr(srcNode, 'prefix', nextVisited)}) + String(${resolveDataExpr(srcNode, 'value', nextVisited)}))`;
      case 'custom_ts_expr':
        return `(${String(srcNode.config?.expression || 'null')})`;
      case 'event_input_change':
        return `(eventPayload?.value ?? '')`;
      default:
        return formatLiteralTs(pin.defaultValue, "''");
    }
  };

  const emitExecChain = (nodeId: string | undefined, indent: number, visitedExec: Set<string>) => {
    if (!nodeId || visitedExec.has(nodeId)) return;
    const node = nodeMap.get(nodeId);
    if (!node) return;
    visitedExec.add(nodeId);

    const pad = '  '.repeat(indent);
    const startLine = lines.length + 1;

    const nextTargetForOutPin = (outPinName: string): string | undefined => {
      const outPin = node.outputs.find((p) => p.name === outPinName && p.dataType === 'exec');
      if (!outPin) return undefined;
      return graph.wires.find((w) => w.isExec && w.fromNodeId === node.id && w.fromPinId === outPin.id)?.toNodeId;
    };

    switch (node.kind) {
      case 'flow_branch': {
        const cond = resolveDataExpr(node, 'condition');
        lines.push(`${pad}if (${cond}) {`);
        emitExecChain(nextTargetForOutPin('true'), indent + 1, new Set(visitedExec));
        lines.push(`${pad}} else {`);
        emitExecChain(nextTargetForOutPin('false'), indent + 1, new Set(visitedExec));
        lines.push(`${pad}}`);
        break;
      }
      case 'flow_sequence': {
        lines.push(`${pad}// Sequence: ${node.title}`);
        emitExecChain(nextTargetForOutPin('then0'), indent, new Set(visitedExec));
        emitExecChain(nextTargetForOutPin('then1'), indent, new Set(visitedExec));
        break;
      }
      case 'flow_foreach': {
        const cnt = resolveDataExpr(node, 'count');
        lines.push(`${pad}for (let index = 0; index < Number(${cnt}); index++) {`);
        emitExecChain(nextTargetForOutPin('loopBody'), indent + 1, new Set(visitedExec));
        lines.push(`${pad}}`);
        break;
      }
      case 'flow_delay': {
        const ms = resolveDataExpr(node, 'ms');
        lines.push(`${pad}await new Promise((r) => setTimeout(r, Number(${ms})));`);
        break;
      }
      case 'data_set_var': {
        const varName = String(node.config?.varName ?? 'stateVar');
        const val = resolveDataExpr(node, 'value');
        lines.push(`${pad}ctx.state[${JSON.stringify(varName)}] = ${val};`);
        break;
      }
      case 'ui_set_text': {
        const target = String(node.targetUiNodeId || node.config?.targetName || 'TargetNode');
        const txt = resolveDataExpr(node, 'text');
        lines.push(`${pad}ctx.setText(${JSON.stringify(target)}, String(${txt}));`);
        break;
      }
      case 'ui_set_style': {
        const target = String(node.targetUiNodeId || node.config?.targetName || 'TargetNode');
        const col = resolveDataExpr(node, 'color');
        lines.push(`${pad}ctx.setStyle(${JSON.stringify(target)}, { background: String(${col}) });`);
        break;
      }
      case 'ui_set_visibility': {
        const target = String(node.targetUiNodeId || node.config?.targetName || 'TargetNode');
        const vis = resolveDataExpr(node, 'visible');
        lines.push(`${pad}ctx.setVisible(${JSON.stringify(target)}, Boolean(${vis}));`);
        break;
      }
      case 'ui_show_toast': {
        const msg = resolveDataExpr(node, 'message');
        lines.push(`${pad}ctx.toast(String(${msg}), 'info');`);
        break;
      }
      case 'ui_navigate': {
        const route = resolveDataExpr(node, 'route');
        lines.push(`${pad}ctx.log('[Blueprint Navigate] -> ' + String(${route}));`);
        break;
      }
      case 'net_http_fetch': {
        const url = resolveDataExpr(node, 'url');
        lines.push(`${pad}ctx.log('[Blueprint HTTP Fetch] GET ' + String(${url}));`);
        break;
      }
      case 'three_transform': {
        const mesh = String(node.config?.meshName ?? 'HeroMesh');
        const rotY = resolveDataExpr(node, 'rotY');
        const col = resolveDataExpr(node, 'color');
        lines.push(`${pad}ctx.three?.rotate(${JSON.stringify(mesh)}, 0, Number(${rotY}), 0);`);
        lines.push(`${pad}ctx.three?.setColor(${JSON.stringify(mesh)}, String(${col}));`);
        break;
      }
      case 'debug_log': {
        const msg = resolveDataExpr(node, 'message');
        lines.push(`${pad}ctx.log('[Blueprint]', ${msg});`);
        break;
      }
      case 'custom_ts_expr': {
        const expr = String(node.config?.expression || 'true');
        lines.push(`${pad}void (${expr});`);
        break;
      }
      default:
        break;
    }

    const endLine = Math.max(startLine, lines.length);
    sourceMap.push({
      canvasNodeId: node.id,
      startLine,
      startCol: indent * 2 + 1,
      endLine,
      endCol: (lines[endLine - 1]?.length ?? 1) + 1,
    });

    if (node.kind !== 'flow_branch' && node.kind !== 'flow_sequence') {
      const nextOut = node.kind === 'flow_foreach' || node.kind === 'flow_delay' ? 'completed' : 'then';
      emitExecChain(nextTargetForOutPin(nextOut), indent, visitedExec);
    }
  };

  const eventNodes = graph.nodes.filter((n) => n.category === 'event');
  if (eventNodes.length === 0) {
    diagnostics.push({
      severity: 'warn',
      message: 'Nessun nodo Evento rosso presente nel grafo Blueprint.',
    });
  }

  for (const ev of eventNodes) {
    const fnSuffix = ev.id.replace(/[^a-zA-Z0-9_]/g, '_');
    const startLine = lines.length + 1;
    lines.push(`export async function run_${fnSuffix}(ctx: StudioRuntimeContext, eventPayload?: Record<string, any>): Promise<void> {`);
    lines.push(`  void eventPayload;`);
    const firstExecOut = ev.outputs.find((p) => p.dataType === 'exec');
    const firstWire = firstExecOut
      ? graph.wires.find((w) => w.isExec && w.fromNodeId === ev.id && w.fromPinId === firstExecOut.id)
      : undefined;
    emitExecChain(firstWire?.toNodeId, 1, new Set([ev.id]));
    lines.push(`}`);
    const endLine = lines.length;
    sourceMap.push({
      canvasNodeId: ev.id,
      startLine,
      startCol: 1,
      endLine,
      endCol: 2,
    });
    lines.push(``);
  }

  return {
    code: lines.join('\n').trimEnd() + '\n',
    sourceMap,
    diagnostics,
  };
}

export function compileBlueprintToRuntimeJs(graph: BlueprintGraphDocument): string {
  const { code } = compileBlueprintToTs(graph);
  const stripped = code
    .replace(/^\s*import\s+type\s+[^;\n]+;?\s*$/gm, '')
    .replace(/:\s*Record<string,\s*any>/g, '')
    .replace(/\(ctx:\s*StudioRuntimeContext,\s*eventPayload\?:\s*Record<string,\s*any>\):\s*Promise<void>/g, '(ctx, eventPayload)')
    .replace(/export\s+const\s+blueprintInitialState/g, 'const blueprintInitialState')
    .replace(/export\s+async\s+function\s+(run_[a-zA-Z0-9_]+)/g, 'async function $1');

  const eventEntries = graph.nodes
    .filter((n) => n.category === 'event')
    .map((ev) => {
      const fnName = `run_${ev.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      return `{ id: ${JSON.stringify(ev.id)}, kind: ${JSON.stringify(ev.kind)}, targetUiNodeId: ${JSON.stringify(ev.targetUiNodeId ?? '')}, elementName: ${JSON.stringify(String(ev.config?.elementName ?? ''))}, run: ${fnName} }`;
    });

  return [
    `(function() {`,
    `  const __bp = (window.__studioBlueprints = window.__studioBlueprints || {});`,
    stripped,
    `  __bp[${JSON.stringify(graph.id)}] = { initialState: blueprintInitialState, events: [${eventEntries.join(', ')}] };`,
    `})();`,
  ].join('\n');
}

export interface BlueprintSimStep {
  nodeId: string;
  nodeTitle: string;
  wireIds: string[];
  log: string;
  uiMutation?: {
    targetNodeId?: string;
    targetName?: string;
    text?: string;
    color?: string;
    visible?: boolean;
  };
}

export function simulateBlueprintExecution(
  graph: BlueprintGraphDocument,
  initialVarsOverride?: Record<string, unknown>,
): {
  steps: BlueprintSimStep[];
  finalVars: Record<string, unknown>;
  logs: string[];
} {
  const vars: Record<string, unknown> = {};
  for (const v of graph.variables) {
    vars[v.name] = v.initialValue;
  }
  if (initialVarsOverride) Object.assign(vars, initialVarsOverride);

  const steps: BlueprintSimStep[] = [];
  const logs: string[] = [];
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  const evalData = (node: BlueprintNode, pinName: string, seen = new Set<string>()): unknown => {
    const pin = node.inputs.find((p) => p.name === pinName);
    if (!pin) return undefined;
    const wire = graph.wires.find((w) => !w.isExec && w.toNodeId === node.id && w.toPinId === pin.id);
    if (!wire) return pin.defaultValue;
    if (seen.has(wire.fromNodeId)) return pin.defaultValue;
    const nextSeen = new Set(seen);
    nextSeen.add(wire.fromNodeId);

    const src = nodeMap.get(wire.fromNodeId);
    if (!src) return pin.defaultValue;

    switch (src.kind) {
      case 'data_get_var':
      case 'data_set_var':
        return vars[String(src.config?.varName ?? 'orderCount')] ?? 0;
      case 'math_op': {
        const a = Number(evalData(src, 'a', nextSeen) ?? 0);
        const b = Number(evalData(src, 'b', nextSeen) ?? 0);
        const op = String(src.config?.op ?? '+');
        if (op === '-') return a - b;
        if (op === '*' || op === '×') return a * b;
        if (op === '/' || op === '÷') return b !== 0 ? a / b : 0;
        return a + b;
      }
      case 'logic_compare': {
        const a = evalData(src, 'a', nextSeen);
        const b = evalData(src, 'b', nextSeen);
        const op = String(src.config?.op ?? '>');
        if (op === '==') return a === b;
        if (op === '!=') return a !== b;
        if (op === '<') return Number(a) < Number(b);
        return Number(a) > Number(b);
      }
      case 'string_format':
        return `${String(evalData(src, 'prefix', nextSeen) ?? '')}${String(evalData(src, 'value', nextSeen) ?? '')}`;
      default:
        return pin.defaultValue ?? '';
    }
  };

  const walkExec = (nodeId: string | undefined, incomingWireId: string | null, depth: number) => {
    if (!nodeId || depth > 25) return;
    const node = nodeMap.get(nodeId);
    if (!node) return;

    const wireIds = incomingWireId ? [incomingWireId] : [];
    // Include incoming data wires connected to this node so UI can pulse them too
    for (const dw of graph.wires) {
      if (!dw.isExec && dw.toNodeId === node.id) wireIds.push(dw.id);
    }

    let stepLog = `[${node.title}] eseguito`;
    let uiMutation: BlueprintSimStep['uiMutation'];

    if (node.kind === 'data_set_var') {
      const k = String(node.config?.varName ?? 'orderCount');
      const v = evalData(node, 'value');
      vars[k] = v;
      stepLog = `[Set Variable] ${k} = ${String(v)}`;
    } else if (node.kind === 'ui_set_text') {
      const txt = String(evalData(node, 'text') ?? '');
      const tName = String(node.config?.targetName ?? '');
      stepLog = `[UI Set Text] ${tName || node.targetUiNodeId || 'Node'} -> "${txt}"`;
      uiMutation = { targetNodeId: node.targetUiNodeId, targetName: tName, text: txt };
    } else if (node.kind === 'ui_set_style') {
      const col = String(evalData(node, 'color') ?? '#2563eb');
      const tName = String(node.config?.targetName ?? '');
      stepLog = `[UI Set Style] ${tName || 'Node'} -> ${col}`;
      uiMutation = { targetNodeId: node.targetUiNodeId, targetName: tName, color: col };
    } else if (node.kind === 'debug_log' || node.kind === 'ui_show_toast') {
      const msg = String(evalData(node, 'message') ?? '');
      stepLog = `[Console] ${msg}`;
    } else if (node.kind === 'three_transform') {
      const mesh = String(node.config?.meshName ?? 'HeroMesh');
      stepLog = `[Three.js] Ruota ${mesh} (${String(evalData(node, 'rotY') ?? 45)}°)`;
    }

    steps.push({ nodeId: node.id, nodeTitle: node.title, wireIds, log: stepLog, uiMutation });
    logs.push(stepLog);

    if (node.kind === 'flow_branch') {
      const cond = Boolean(evalData(node, 'condition'));
      const outPin = node.outputs.find((p) => p.name === (cond ? 'true' : 'false'));
      const nextW = outPin ? graph.wires.find((w) => w.isExec && w.fromNodeId === node.id && w.fromPinId === outPin.id) : undefined;
      walkExec(nextW?.toNodeId, nextW?.id ?? null, depth + 1);
      return;
    }

    if (node.kind === 'flow_sequence') {
      for (const pName of ['then0', 'then1']) {
        const outPin = node.outputs.find((p) => p.name === pName);
        const nextW = outPin ? graph.wires.find((w) => w.isExec && w.fromNodeId === node.id && w.fromPinId === outPin.id) : undefined;
        walkExec(nextW?.toNodeId, nextW?.id ?? null, depth + 1);
      }
      return;
    }

    const firstExecOut = node.outputs.find((p) => p.dataType === 'exec');
    const nextWire = firstExecOut
      ? graph.wires.find((w) => w.isExec && w.fromNodeId === node.id && w.fromPinId === firstExecOut.id)
      : undefined;
    walkExec(nextWire?.toNodeId, nextWire?.id ?? null, depth + 1);
  };

  const events = graph.nodes.filter((n) => n.category === 'event');
  for (const ev of events) {
    walkExec(ev.id, null, 0);
  }

  return { steps, finalVars: vars, logs };
}

// ============================================================================
// v3.0 CONSOLIDATED BLUEPRINT <-> AUTOMATION IR & SEPARATE SCRIPT APPLICATOR
// ============================================================================

export function blueprintEventToAutomationRule(
  graph: BlueprintGraphDocument,
  eventNodeId?: string,
  options?: {
    targetFileRelPath?: string;
    language?: ScriptLanguage;
    sheet?: UISheetDocument;
  },
): AutomationRule {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const eventNode =
    (eventNodeId ? nodeMap.get(eventNodeId) : undefined) ??
    graph.nodes.find((n) => n.category === 'event') ??
    graph.nodes[0];

  const targetFileRelPath = options?.targetFileRelPath || 'scripts/automations.js';
  const language = options?.language ?? inferScriptLanguageFromPath(targetFileRelPath);

  const resolveOperand = (node: BlueprintNode, pinName: string, seen = new Set<string>()): ValueOperand => {
    const pin = node.inputs.find((p) => p.name === pinName);
    if (!pin) return { source: 'literal', value: '' };
    const wire = graph.wires.find((w) => !w.isExec && w.toNodeId === node.id && w.toPinId === pin.id);
    if (!wire || seen.has(wire.fromNodeId)) {
      return { source: 'literal', value: pin.defaultValue ?? '' };
    }
    const nextSeen = new Set(seen);
    nextSeen.add(wire.fromNodeId);
    const src = nodeMap.get(wire.fromNodeId);
    if (!src) return { source: 'literal', value: pin.defaultValue ?? '' };

    switch (src.kind) {
      case 'data_get_var':
      case 'data_set_var':
        return { source: 'state', key: String(src.config?.varName ?? 'orderCount') };
      case 'ui_get_input':
        return {
          source: 'ui_element',
          nodeId: String(src.targetUiNodeId || src.config?.targetName || 'InputField'),
          prop: 'value',
        };
      case 'event_input_change':
        return { source: 'event_payload', field: 'value' };
      case 'event_key_press':
        return { source: 'event_payload', field: 'key' };
      case 'math_op': {
        const aOp = resolveOperand(src, 'a', nextSeen);
        const bOp = resolveOperand(src, 'b', nextSeen);
        if (aOp.source === 'literal' && bOp.source === 'literal') {
          const op = String(src.config?.op ?? '+');
          const a = Number(aOp.value || 0);
          const b = Number(bOp.value || 0);
          const val = op === '-' ? a - b : op === '*' || op === '×' ? a * b : op === '/' || op === '÷' ? (b !== 0 ? a / b : 0) : a + b;
          return { source: 'literal', value: val };
        }
        return aOp;
      }
      case 'string_format': {
        const pref = resolveOperand(src, 'prefix', nextSeen);
        const val = resolveOperand(src, 'value', nextSeen);
        if (pref.source === 'literal' && String(pref.value) === '') {
          return val;
        }
        if (pref.source === 'literal' && val.source === 'literal') {
          return { source: 'literal', value: `${pref.value}${val.value}` };
        }
        return val;
      }
      default:
        return { source: 'literal', value: pin.defaultValue ?? '' };
    }
  };

  const resolveBranchCondition = (branchNode: BlueprintNode): AutomationCondition => {
    const condPin = branchNode.inputs.find((p) => p.name === 'condition');
    const wire = condPin
      ? graph.wires.find((w) => !w.isExec && w.toNodeId === branchNode.id && w.toPinId === condPin.id)
      : undefined;
    const src = wire ? nodeMap.get(wire.fromNodeId) : undefined;

    if (src?.kind === 'logic_compare') {
      const rawOp = String(src.config?.op ?? '>');
      const operator: ConditionOperator =
        rawOp === '==' || rawOp === '!=' || rawOp === '>' || rawOp === '<' || rawOp === '>=' || rawOp === '<='
          ? rawOp
          : '>';
      return {
        id: `cond_${src.id}`,
        left: resolveOperand(src, 'a'),
        operator,
        right: resolveOperand(src, 'b'),
      };
    }

    return {
      id: `cond_${branchNode.id}`,
      left: { source: 'literal', value: Boolean(condPin?.defaultValue ?? true) },
      operator: '==',
      right: { source: 'literal', value: true },
    };
  };

  const walkToSteps = (startId: string | undefined, visited: Set<string>): AutomationStep[] => {
    if (!startId || visited.has(startId)) return [];
    const node = nodeMap.get(startId);
    if (!node) return [];
    visited.add(startId);

    const nextForPin = (outName: string): string | undefined => {
      const p = node.outputs.find((o) => o.name === outName && o.dataType === 'exec');
      if (!p) return undefined;
      return graph.wires.find((w) => w.isExec && w.fromNodeId === node.id && w.fromPinId === p.id)?.toNodeId;
    };

    const collected: AutomationStep[] = [];

    switch (node.kind) {
      case 'flow_branch': {
        collected.push({
          id: `bp_step_${node.id}`,
          kind: 'if_else',
          conditionGroup: {
            combinator: 'AND',
            conditions: [resolveBranchCondition(node)],
          },
          thenSteps: walkToSteps(nextForPin('true'), new Set(visited)),
          elseSteps: walkToSteps(nextForPin('false'), new Set(visited)),
        });
        return collected;
      }
      case 'flow_sequence': {
        collected.push(...walkToSteps(nextForPin('then0'), new Set(visited)));
        collected.push(...walkToSteps(nextForPin('then1'), new Set(visited)));
        return collected;
      }
      case 'flow_delay': {
        const msOp = resolveOperand(node, 'ms');
        collected.push({
          id: `bp_step_${node.id}`,
          kind: 'delay',
          ms: msOp.source === 'literal' ? Number(msOp.value || 300) : 300,
        });
        break;
      }
      case 'data_set_var': {
        const varName = String(node.config?.varName ?? 'orderCount');
        const valInPin = node.inputs.find((p) => p.name === 'value');
        const mathWire = valInPin
          ? graph.wires.find((w) => !w.isExec && w.toNodeId === node.id && w.toPinId === valInPin.id)
          : undefined;
        const mathSrc = mathWire ? nodeMap.get(mathWire.fromNodeId) : undefined;

        if (mathSrc?.kind === 'math_op') {
          const opRaw = String(mathSrc.config?.op ?? '+');
          const opClean: '+' | '-' | '*' | '/' =
            opRaw === '-' ? '-' : opRaw === '*' || opRaw === '×' ? '*' : opRaw === '/' || opRaw === '÷' ? '/' : '+';
          collected.push({
            id: `bp_math_${mathSrc.id}`,
            kind: 'math_formula',
            formulaKind: 'math',
            left: resolveOperand(mathSrc, 'a'),
            operator: opClean,
            right: resolveOperand(mathSrc, 'b'),
            outputVar: varName,
          });
          collected.push({
            id: `bp_step_${node.id}`,
            kind: 'storage_state',
            target: 'state',
            key: varName,
            operation: 'set',
            value: { source: 'param', name: varName },
          });
        } else {
          collected.push({
            id: `bp_step_${node.id}`,
            kind: 'storage_state',
            target: 'state',
            key: varName,
            operation: 'set',
            value: resolveOperand(node, 'value'),
          });
        }
        break;
      }
      case 'ui_set_text': {
        const target = String(node.targetUiNodeId || node.config?.targetName || 'TargetNode');
        collected.push({
          id: `bp_step_${node.id}`,
          kind: 'ui_set_text',
          targetNodeId: target,
          value: resolveOperand(node, 'text'),
        });
        break;
      }
      case 'ui_set_style': {
        const target = String(node.targetUiNodeId || node.config?.targetName || 'TargetNode');
        const cssProp = String(node.config?.property ?? 'background-color');
        collected.push({
          id: `bp_step_${node.id}`,
          kind: 'ui_inline_style',
          targetNodeId: target,
          cssProperty: cssProp,
          value: resolveOperand(node, 'color'),
        });
        break;
      }
      case 'ui_set_visibility': {
        const target = String(node.targetUiNodeId || node.config?.targetName || 'TargetNode');
        const visOp = resolveOperand(node, 'visible');
        const show = visOp.source === 'literal' ? Boolean(visOp.value) : true;
        collected.push({
          id: `bp_step_${node.id}`,
          kind: 'ui_visibility',
          targetNodeId: target,
          mode: show ? 'show' : 'hide',
        });
        break;
      }
      case 'ui_show_toast':
      case 'debug_log': {
        collected.push({
          id: `bp_step_${node.id}`,
          kind: 'toast',
          variant: 'info',
          message: resolveOperand(node, 'message'),
        });
        break;
      }
      case 'ui_navigate': {
        const routeOp = resolveOperand(node, 'route');
        collected.push({
          id: `bp_step_${node.id}`,
          kind: 'navigate',
          action: 'navigate_sheet',
          target: routeOp.source === 'literal' ? String(routeOp.value) : 'HomeDashboard',
        });
        break;
      }
      case 'net_http_fetch': {
        collected.push({
          id: `bp_step_${node.id}`,
          kind: 'http_fetch',
          method: 'GET',
          url: resolveOperand(node, 'url'),
        });
        break;
      }
      default:
        break;
    }

    const nextOut = node.kind === 'flow_foreach' || node.kind === 'flow_delay' ? 'completed' : 'then';
    collected.push(...walkToSteps(nextForPin(nextOut), visited));
    return collected;
  };

  let triggerType: AutomationTriggerType = 'onClick';
  if (eventNode?.kind === 'event_begin_play') triggerType = 'onMount';
  else if (eventNode?.kind === 'event_input_change') triggerType = 'onInput';
  else if (eventNode?.kind === 'event_key_press') triggerType = 'onKeyDown';

  const firstExec = eventNode?.outputs.find((p) => p.dataType === 'exec');
  const firstWire = firstExec
    ? graph.wires.find((w) => w.isExec && w.fromNodeId === eventNode.id && w.fromPinId === firstExec.id)
    : undefined;

  const steps = eventNode ? walkToSteps(firstWire?.toNodeId, new Set([eventNode.id])) : [];
  const rawBase = `${graph.name}_${eventNode?.config?.elementName || eventNode?.id || 'Flow'}`;

  return {
    id: `bp_auto_${graph.id}_${eventNode?.id ?? 'main'}`,
    name: `Blueprint: ${graph.name} (${eventNode?.title ?? 'Event'})`,
    description: `Generato dal grafo visuale Blueprint "${graph.name}".`,
    enabled: true,
    targetFileRelPath,
    language,
    generatedFnName: language === 'python' ? toSnakeFnName(rawBase) : toCamelFnName(rawBase),
    trigger: {
      type: triggerType,
      sourceNodeId: eventNode?.targetUiNodeId,
      ...(eventNode?.kind === 'event_key_press' ? { keyFilter: String(eventNode.config?.key ?? 'Enter') } : {}),
    },
    steps,
    updatedAt: Date.now(),
  };
}

export function blueprintGraphToAutomationRules(
  graph: BlueprintGraphDocument,
  options?: {
    targetFileRelPath?: string;
    language?: ScriptLanguage;
    sheet?: UISheetDocument;
  },
): AutomationRule[] {
  const eventNodes = graph.nodes.filter((n) => n.category === 'event');
  if (eventNodes.length === 0) {
    return [blueprintEventToAutomationRule(graph, undefined, options)];
  }
  return eventNodes.map((ev) => blueprintEventToAutomationRule(graph, ev.id, options));
}

export function automationRuleToBlueprintGraph(
  rule: AutomationRule,
  projectId = 'proj_local',
  sheetId?: string,
): BlueprintGraphDocument {
  const nodes: BlueprintNode[] = [];
  const wires: BlueprintWire[] = [];

  const evKind: BlueprintNodeKind =
    rule.trigger.type === 'onMount'
      ? 'event_begin_play'
      : rule.trigger.type === 'onInput' || rule.trigger.type === 'onChange'
        ? 'event_input_change'
        : rule.trigger.type === 'onKeyDown'
          ? 'event_key_press'
          : 'event_ui_click';

  const evNode = createBlueprintNode(
    evKind,
    { x: 60, y: 120 },
    {
      id: `bp_ev_${rule.id}`,
      targetUiNodeId: rule.trigger.sourceNodeId,
      config: rule.trigger.sourceNodeId ? { elementName: rule.trigger.sourceNodeId } : undefined,
    },
  );
  nodes.push(evNode);

  let prevNode = evNode;
  let cursorX = 390;

  for (const st of rule.steps) {
    let bpNode: BlueprintNode | null = null;
    if (st.kind === 'ui_set_text') {
      bpNode = createBlueprintNode(
        'ui_set_text',
        { x: cursorX, y: 120 },
        { targetUiNodeId: st.targetNodeId, config: { targetName: st.targetNodeId } },
      );
      if (st.value.source === 'literal' && bpNode.inputs[1]) {
        bpNode.inputs[1].defaultValue = st.value.value;
      }
    } else if (st.kind === 'ui_inline_style' || st.kind === 'ui_css_class') {
      bpNode = createBlueprintNode(
        'ui_set_style',
        { x: cursorX, y: 120 },
        { targetUiNodeId: st.targetNodeId, config: { targetName: st.targetNodeId } },
      );
    } else if (st.kind === 'ui_visibility') {
      bpNode = createBlueprintNode(
        'ui_set_visibility',
        { x: cursorX, y: 120 },
        { targetUiNodeId: st.targetNodeId, config: { targetName: st.targetNodeId } },
      );
    } else if (st.kind === 'http_fetch' || st.kind === 'sql_operation') {
      bpNode = createBlueprintNode('net_http_fetch', { x: cursorX, y: 120 });
    } else if (st.kind === 'delay') {
      bpNode = createBlueprintNode('flow_delay', { x: cursorX, y: 120 });
    } else if (st.kind === 'navigate') {
      bpNode = createBlueprintNode('ui_navigate', { x: cursorX, y: 120 });
    } else {
      bpNode = createBlueprintNode('ui_show_toast', { x: cursorX, y: 120 });
    }

    if (bpNode) {
      nodes.push(bpNode);
      const outPin = prevNode.outputs.find((p) => p.dataType === 'exec');
      const inPin = bpNode.inputs.find((p) => p.dataType === 'exec');
      if (outPin && inPin) {
        wires.push({
          id: `w_${prevNode.id}_${bpNode.id}`,
          fromNodeId: prevNode.id,
          fromPinId: outPin.id,
          toNodeId: bpNode.id,
          toPinId: inPin.id,
          isExec: true,
        });
      }
      prevNode = bpNode;
      cursorX += 320;
    }
  }

  return {
    id: `bp_from_${rule.id}`,
    projectId,
    name: rule.generatedFnName || rule.name,
    sheetId,
    viewport: { x: 24, y: 24, zoom: 0.9 },
    variables: [],
    nodes,
    wires,
    updatedAt: Date.now(),
  };
}

/**
 * Consolidates Blueprint code emission & non-destructive separate `.js`/`.ts`/`.py` file application
 * directly through `src/shared/automation-ir.ts` (`compileAutomationRuleToCode` + `upsertManagedAutomationInFile`).
 */
export function applyBlueprintToSeparateScriptFile(
  graph: BlueprintGraphDocument,
  existingFileContent = '',
  options?: {
    target?: AutomationCodegenTarget | string;
    language?: ScriptLanguage;
    targetFileRelPath?: string;
    sheet?: UISheetDocument;
    sqlDocument?: SqlDesignDocument | null;
  },
): {
  content: string;
  rules: AutomationRule[];
  compiledFunctions: string[];
} {
  const targetFileRelPath = options?.targetFileRelPath || 'scripts/automations.js';
  const language = options?.language ?? inferScriptLanguageFromPath(targetFileRelPath);
  const rules = blueprintGraphToAutomationRules(graph, {
    targetFileRelPath,
    language,
    sheet: options?.sheet,
  });

  let updatedContent = existingFileContent;
  const compiledFunctions: string[] = [];

  for (const rule of rules) {
    const compiled = compileAutomationRuleToCode(rule, {
      target: options?.target ?? (language === 'python' ? 'python' : language === 'typescript' ? 'dom-ts' : 'dom-js'),
      language,
      sheet: options?.sheet,
      sqlDocument: options?.sqlDocument,
    });
    compiledFunctions.push(compiled.fnName);
    updatedContent = upsertManagedAutomationInFile(updatedContent, rule, compiled);
  }

  return {
    content: updatedContent,
    rules,
    compiledFunctions,
  };
}
