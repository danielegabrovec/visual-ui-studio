/**
 * Canonical Shared Types for Separate Script Modules (`.js` / `.ts` / `.py`)
 * and No-Code Visual Automations / Function Application Pipeline (v3.0).
 *
 * Pure TypeScript, zero Node imports — safe across Renderer, Main, DB Worker, Codegen Worker, and AI Worker.
 */

export type ScriptLanguage = 'javascript' | 'typescript' | 'python';

export type ScriptLoadStrategy =
  | 'module'
  | 'defer'
  | 'async'
  | 'es-import'
  | 'backend-route';

export interface LinkedScriptModuleRef {
  vfsEntryId: string;
  relativePath: string; // e.g. "scripts/automations.js", "src/scripts/handlers.ts", "backend/automations.py"
  language: ScriptLanguage;
  loadStrategy: ScriptLoadStrategy;
  autoInitOnLoad?: boolean;
  scope: 'sheet' | 'project';
}

export interface ScriptParamSpec {
  name: string;
  typeAnnotation?: string;
  defaultValue?: string;
  optional?: boolean;
}

export interface ExtractedFunctionSig {
  name: string;
  params: string[];
  detailedParams?: ScriptParamSpec[];
  returnType?: string;
  isAsync: boolean;
  isExported: boolean;
  startLine: number;
  endLine: number;
  description?: string;
  kind?: 'function' | 'arrow' | 'controller_method' | 'python_def';
  decorator?: string;
  managedAutomationId?: string;
}

export interface ExtractedDomBinding {
  selector: string; // e.g. "#btn-save", ".card-item", "[data-node-name='EmailInput']"
  method: 'getElementById' | 'querySelector' | 'querySelectorAll';
  eventTrigger?: string; // e.g. "click", "submit", "input"
  handlerFnName?: string;
  domReads: Array<'value' | 'textContent' | 'innerHTML' | 'checked' | 'dataset'>;
  domWrites: Array<'value' | 'textContent' | 'innerHTML' | 'style' | 'classList' | 'hidden'>;
  line: number;
  matchedNodeId?: string;
}

export interface ExtractedNetworkOrIpcCall {
  kind: 'fetch' | 'tauri_invoke' | 'electron_ipc' | 'sql_query' | 'fastapi_route';
  endpointOrCommand: string;
  httpMethod?: string;
  enclosingFnName?: string;
  line: number;
}

export interface ParsedExternalScript {
  filePath: string;
  language: ScriptLanguage;
  imports: Array<{ source: string; specifiers: string[]; isTypeOnly: boolean; line: number }>;
  functions: ExtractedFunctionSig[];
  domBindings: ExtractedDomBinding[];
  externalCalls: ExtractedNetworkOrIpcCall[];
  managedAutomations: AutomationRule[];
  diagnostics: Array<{ line: number; message: string; severity: 'warn' | 'error' }>;
}

export type ParsedScriptModuleAnalysis = ParsedExternalScript;

export interface UIRScriptModuleDecl {
  vfsEntryId?: string;
  relativePath: string;
  language: ScriptLanguage;
  loadStrategy: ScriptLoadStrategy;
  sourceCode: string;
  exportedFunctions: string[];
  autoInitOnLoad?: boolean;
}

// ============================================================================
// NO-CODE VISUAL AUTOMATION & FUNCTION COMPILER IR ("Senza Scrivere Codice")
// ============================================================================

export type AutomationTriggerType =
  | 'onClick'
  | 'onDoubleClick'
  | 'onSubmit'
  | 'onChange'
  | 'onInput'
  | 'onMount'
  | 'onHover'
  | 'onMouseLeave'
  | 'onFocus'
  | 'onBlur'
  | 'onKeyDown'
  | 'onInterval'
  | 'callable';

export interface AutomationTrigger {
  type: AutomationTriggerType;
  sourceNodeId?: string;
  debounceMs?: number;
  intervalMs?: number;
  keyFilter?: string;
}

export type ValueOperand =
  | { source: 'literal'; value: string | number | boolean }
  | {
      source: 'ui_element';
      nodeId: string;
      prop: 'value' | 'text' | 'checked' | 'visible' | 'dataAttr';
      attrName?: string;
    }
  | { source: 'state'; key: string }
  | { source: 'local_storage'; key: string }
  | { source: 'event_payload'; field: 'value' | 'key' | 'targetId' | 'formDataJson' }
  | { source: 'step_result'; stepId: string; path?: string }
  | { source: 'param'; name: string };

export type ConditionOperator =
  | '=='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'contains'
  | 'startsWith'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'isEmail'
  | 'matchesRegex';

export interface AutomationCondition {
  id: string;
  left: ValueOperand;
  operator: ConditionOperator;
  right?: ValueOperand;
}

export interface AutomationConditionGroup {
  combinator: 'AND' | 'OR';
  conditions: AutomationCondition[];
}

export interface FormValidationFieldRule {
  nodeId: string;
  rule: 'required' | 'email' | 'minLength' | 'number';
  min?: number;
  errorMsg: string;
}

export type AutomationStep =
  // 1. Set UI element text content
  | {
      id: string;
      kind: 'ui_set_text';
      targetNodeId: string;
      value: ValueOperand;
    }
  // 2. Set UI input/control value or attribute
  | {
      id: string;
      kind: 'ui_set_value';
      targetNodeId: string;
      prop?: 'value' | 'placeholder' | 'checked' | 'disabled' | 'src';
      value: ValueOperand;
    }
  // 3. Show / Hide / Toggle UI element visibility
  | {
      id: string;
      kind: 'ui_visibility';
      targetNodeId: string;
      mode: 'show' | 'hide' | 'toggle';
      displayType?: 'flex' | 'grid' | 'block';
    }
  // 4. Add / Remove / Toggle Reusable CSS Class on UI element
  | {
      id: string;
      kind: 'ui_css_class';
      targetNodeId: string;
      mode: 'add' | 'remove' | 'toggle';
      className: string;
    }
  // 5. Mutate inline CSS style property on UI element
  | {
      id: string;
      kind: 'ui_inline_style';
      targetNodeId: string;
      cssProperty: string;
      value: ValueOperand;
    }
  // 6. Declarative Form Validation with automatic field highlight
  | {
      id: string;
      kind: 'validate_form';
      rules: FormValidationFieldRule[];
      stopOnFail?: boolean;
    }
  // 7. User Toast / Notification / Native Alert
  | {
      id: string;
      kind: 'toast';
      variant: 'info' | 'success' | 'warn' | 'error' | 'alert';
      message: ValueOperand;
    }
  // 8. HTTP / REST API Fetch + UI / State response binding
  | {
      id: string;
      kind: 'http_fetch';
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      url: ValueOperand;
      headers?: Record<string, string>;
      bodyFormNodeId?: string;
      bodyFields?: Array<{ key: string; value: ValueOperand }>;
      targetNodeId?: string;
      resultStateKey?: string;
      responseJsonPath?: string;
      bindMode?: 'set_text' | 'render_table_rows' | 'save_state';
      columnsMap?: string[];
    }
  // 9. Canonical SQL Operation Step (integrated with SqlDesignDocument & Named Queries)
  | {
      id: string;
      kind: 'sql_operation';
      operation:
        | 'run_named_query'
        | 'insert_from_form'
        | 'select_to_table'
        | 'update_by_id'
        | 'delete_by_id';
      tableName?: string;
      namedQueryId?: string;
      columnMappings?: Array<{ columnName: string; value: ValueOperand }>;
      paramBindings?: Record<string, ValueOperand | string>;
      targetTableNodeId?: string;
      resultStateKey?: string;
      refreshQueryId?: string;
      toastOnSuccess?: string;
      executionBridge?: 'auto' | 'backend_api_endpoint' | 'tauri_rust_sql' | 'electron_ipc_sql';
    }
  // 10. Reactive State / localStorage / sessionStorage mutation
  | {
      id: string;
      kind: 'storage_state';
      target: 'state' | 'localStorage' | 'sessionStorage';
      key: string;
      operation: 'set' | 'increment' | 'decrement' | 'toggle_bool' | 'remove';
      value?: ValueOperand;
    }
  // 11. Math / String / Currency Formula evaluation
  | {
      id: string;
      kind: 'math_formula';
      formulaKind?: 'math' | 'string_concat' | 'currency_eur';
      left: ValueOperand;
      operator?: '+' | '-' | '*' | '/';
      right?: ValueOperand;
      outputVar: string;
      targetNodeId?: string;
    }
  // 12. Sheet / Route Navigation or Modal Open/Close
  | {
      id: string;
      kind: 'navigate';
      action: 'navigate_sheet' | 'navigate_url' | 'open_modal' | 'close_modal';
      target: string;
    }
  // 13. Call External Function in Separate `.js`/`.ts`/`.py` Module
  | {
      id: string;
      kind: 'call_external_fn';
      fnName: string;
      moduleRelPath?: string;
      vfsEntryId?: string;
      args?: ValueOperand[];
      outputVar?: string;
    }
  // 14. Tauri v2 / Native Desktop Rust Command Invoke
  | {
      id: string;
      kind: 'tauri_invoke';
      commandName: string;
      args?: Record<string, ValueOperand>;
      resultStateKey?: string;
      targetNodeId?: string;
    }
  // 15. Nested Visual Conditional Branch (If / Else)
  | {
      id: string;
      kind: 'if_else';
      conditionGroup: AutomationConditionGroup;
      thenSteps: AutomationStep[];
      elseSteps?: AutomationStep[];
    }
  // 16. Async Delay / Timer Wait
  | {
      id: string;
      kind: 'delay';
      ms: number;
    };

export interface AutomationRule {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  targetFileVfsId?: string;
  targetFileRelPath: string;
  language?: ScriptLanguage;
  generatedFnName: string;
  trigger: AutomationTrigger;
  conditions?: AutomationCondition[];
  conditionCombinator?: 'AND' | 'OR';
  parameters?: ScriptParamSpec[];
  returnValue?: ValueOperand;
  steps: AutomationStep[];
  elseSteps?: AutomationStep[];
  updatedAt: number;
}
