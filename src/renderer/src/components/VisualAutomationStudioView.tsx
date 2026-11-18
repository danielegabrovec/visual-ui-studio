import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Code2,
  Database,
  FileCode2,
  GitBranch,
  Layers,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
  Zap,
} from 'lucide-react';
import {
  AUTOMATION_PRESET_CATALOG,
  compileAutomationRuleToCode,
  createAutomationFromPreset,
  getManagedAutomationBodyRange,
  isManagedBlockManuallyModified,
  removeManagedAutomationFromFile,
  resolveAutomationTarget,
  toCamelFnName,
  toSnakeFnName,
  upsertManagedAutomationInFile,
  type AutomationCodegenTarget,
  type AutomationCondition,
  type AutomationPresetDescriptor,
  type AutomationRule,
  type AutomationStep,
  type AutomationTriggerType,
  type ConditionOperator,
  type ScriptLanguage,
  type ValueOperand,
} from '@shared/automation-ir';
import { inferScriptLanguageFromPath, parseExternalScriptModule, toKebabDomId } from '@shared/script-ir';
import { useStudioStore } from '@renderer/state/studio-store';
import { GeneratedSourceTextarea } from './GeneratedSourceEditor';

export interface VisualAutomationStudioViewProps {
  sheetId?: string;
  vfsEntryId?: string;
  initialAutomationId?: string | null;
}

type StepKind = AutomationStep['kind'];

const TRIGGER_OPTIONS: Array<{ value: AutomationTriggerType; label: string }> = [
  { value: 'onClick', label: '🖱️ Al Click (onClick)' },
  { value: 'onDoubleClick', label: '🖱️ Doppio Click (onDoubleClick)' },
  { value: 'onSubmit', label: '📤 Invio Form (onSubmit)' },
  { value: 'onInput', label: '⌨️ Digitazione Live (onInput)' },
  { value: 'onChange', label: '🔄 Cambio Valore / Select (onChange)' },
  { value: 'onMount', label: '🚀 Caricamento Pagina / Componente (onMount)' },
  { value: 'onHover', label: '👆 Passaggio Mouse (onHover)' },
  { value: 'onMouseLeave', label: '👋 Uscita Mouse (onMouseLeave)' },
  { value: 'onFocus', label: '🎯 Focus Campo (onFocus)' },
  { value: 'onBlur', label: '💨 Uscita Focus (onBlur)' },
  { value: 'onKeyDown', label: '⌨️ Pressione Tasto (onKeyDown)' },
  { value: 'onInterval', label: '⏱️ Timer Periodico (onInterval)' },
  { value: 'callable', label: '🧩 Funzione Riutilizzabile Richiamabile (callable)' },
];

const CONDITION_OPERATORS: Array<{ value: ConditionOperator; label: string; unary?: boolean }> = [
  { value: '==', label: 'è uguale a (==)' },
  { value: '!=', label: 'è diverso da (!=)' },
  { value: '>', label: 'è maggiore di (>)' },
  { value: '>=', label: 'è maggiore o uguale (>=)' },
  { value: '<', label: 'è minore di (<)' },
  { value: '<=', label: 'è minore o uguale (<=)' },
  { value: 'contains', label: 'contiene testo' },
  { value: 'startsWith', label: 'inizia con' },
  { value: 'isEmpty', label: 'è vuoto', unary: true },
  { value: 'isNotEmpty', label: 'NON è vuoto', unary: true },
  { value: 'isEmail', label: 'è una Email valida', unary: true },
  { value: 'matchesRegex', label: 'rispetta espressione Regex' },
];

const STEP_KIND_OPTIONS: Array<{ kind: StepKind; label: string; category: string }> = [
  { kind: 'ui_set_text', label: '📝 Imposta Testo Elemento UI', category: 'Interfaccia UI' },
  { kind: 'ui_set_value', label: '✏️ Imposta Valore / Attributo Input', category: 'Interfaccia UI' },
  { kind: 'ui_visibility', label: '👁️ Mostra / Nascondi / Toggle Elemento', category: 'Interfaccia UI' },
  { kind: 'ui_css_class', label: '🎨 Aggiungi / Rimuovi / Toggle Classe CSS', category: 'Stile & CSS' },
  { kind: 'ui_inline_style', label: '🖌️ Cambia Proprietà CSS Inline', category: 'Stile & CSS' },
  { kind: 'validate_form', label: '✅ Valida Campi Form & Evidenzia Errori', category: 'Form & Notifiche' },
  { kind: 'toast', label: '🔔 Mostra Notifica / Toast / Alert', category: 'Form & Notifiche' },
  { kind: 'sql_operation', label: '🗄️ Operazione Database SQL (Tabella / Query)', category: 'Dati, SQL & API' },
  { kind: 'http_fetch', label: '🌐 Chiamata HTTP / REST API (fetch)', category: 'Dati, SQL & API' },
  { kind: 'storage_state', label: '💾 Salva / Aggiorna Stato o localStorage', category: 'Logica & Stato' },
  { kind: 'math_formula', label: '🧮 Formula Matematica / Valuta EUR / Testo', category: 'Logica & Stato' },
  { kind: 'navigate', label: '🧭 Naviga a Foglio / URL / Apri Modale', category: 'Navigazione & App' },
  { kind: 'call_external_fn', label: '📦 Chiama Funzione da File .js / .ts / .py', category: 'Navigazione & App' },
  { kind: 'tauri_invoke', label: '🦀 Comando Nativo Tauri Rust (invoke)', category: 'Navigazione & App' },
  { kind: 'if_else', label: '🔀 Ramificazione Condizionale Se / Altrimenti', category: 'Controllo Flusso' },
  { kind: 'delay', label: '⏳ Attendi Millisecondi (Timer Delay)', category: 'Controllo Flusso' },
];

const TARGET_STACK_OPTIONS: Array<{ value: AutomationCodegenTarget; label: string }> = [
  { value: 'dom-js', label: 'JavaScript Puro ES2024 DOM (.js)' },
  { value: 'dom-ts', label: 'TypeScript DOM Tipizzato (.ts)' },
  { value: 'react', label: 'React 19 Function / Handler (.tsx/.jsx)' },
  { value: 'nextjs', label: 'Next.js App Router Handler (.tsx/.jsx)' },
  { value: 'svelte', label: 'Svelte 5 Runes Function (.ts/.js)' },
  { value: 'angular', label: 'Angular Signals Method (.ts)' },
  { value: 'tauri', label: 'Tauri v2 Desktop + invoke Rust (.ts/.js)' },
  { value: 'nodejs', label: 'Node.js Handler / Service (.ts/.js)' },
  { value: 'python', label: 'Python 3.12 / FastAPI + SQLite (.py)' },
];

function createDefaultStep(
  kind: StepKind,
  defaults: {
    firstNodeId: string;
    firstInputId: string;
    firstTableId: string;
    firstClassName: string;
    firstSqlTable: string;
    firstExternalFn: string;
    firstExternalPath: string;
  },
): AutomationStep {
  const id = `step_${kind}_${Date.now().toString(36).slice(-4)}_${Math.random().toString(36).slice(2, 5)}`;
  switch (kind) {
    case 'ui_set_text':
      return {
        id,
        kind: 'ui_set_text',
        targetNodeId: defaults.firstNodeId,
        value: { source: 'literal', value: 'Operazione completata!' },
      };
    case 'ui_set_value':
      return {
        id,
        kind: 'ui_set_value',
        targetNodeId: defaults.firstInputId,
        prop: 'value',
        value: { source: 'literal', value: '' },
      };
    case 'ui_visibility':
      return {
        id,
        kind: 'ui_visibility',
        targetNodeId: defaults.firstNodeId,
        mode: 'toggle',
        displayType: 'flex',
      };
    case 'ui_css_class':
      return {
        id,
        kind: 'ui_css_class',
        targetNodeId: defaults.firstNodeId,
        mode: 'toggle',
        className: defaults.firstClassName,
      };
    case 'ui_inline_style':
      return {
        id,
        kind: 'ui_inline_style',
        targetNodeId: defaults.firstNodeId,
        cssProperty: 'backgroundColor',
        value: { source: 'literal', value: '#2563eb' },
      };
    case 'validate_form':
      return {
        id,
        kind: 'validate_form',
        stopOnFail: true,
        rules: [
          {
            nodeId: defaults.firstInputId,
            rule: 'required',
            errorMsg: 'Compila questo campo obbligatorio',
          },
        ],
      };
    case 'toast':
      return {
        id,
        kind: 'toast',
        variant: 'success',
        message: { source: 'literal', value: 'Operazione eseguita con successo!' },
      };
    case 'http_fetch':
      return {
        id,
        kind: 'http_fetch',
        method: 'GET',
        url: { source: 'literal', value: '/api/items' },
        targetNodeId: defaults.firstTableId,
        bindMode: 'render_table_rows',
        resultStateKey: 'apiItems',
      };
    case 'sql_operation':
      return {
        id,
        kind: 'sql_operation',
        operation: 'select_to_table',
        tableName: defaults.firstSqlTable,
        targetTableNodeId: defaults.firstTableId,
        resultStateKey: `${defaults.firstSqlTable}Rows`,
        toastOnSuccess: `Dati caricati da ${defaults.firstSqlTable}`,
      };
    case 'storage_state':
      return {
        id,
        kind: 'storage_state',
        target: 'localStorage',
        key: 'preferenzaUtente',
        operation: 'set',
        value: { source: 'literal', value: 'attivo' },
      };
    case 'math_formula':
      return {
        id,
        kind: 'math_formula',
        formulaKind: 'currency_eur',
        left: { source: 'ui_element', nodeId: defaults.firstInputId, prop: 'value' },
        operator: '*',
        right: { source: 'literal', value: 1.22 },
        outputVar: 'totaleCalcolato',
        targetNodeId: defaults.firstNodeId,
      };
    case 'navigate':
      return {
        id,
        kind: 'navigate',
        action: 'open_modal',
        target: defaults.firstNodeId,
      };
    case 'call_external_fn':
      return {
        id,
        kind: 'call_external_fn',
        fnName: defaults.firstExternalFn || 'formatInvoiceTotal',
        moduleRelPath: defaults.firstExternalPath || 'scripts/helpers.js',
        args: [{ source: 'ui_element', nodeId: defaults.firstInputId, prop: 'value' }],
        outputVar: 'risultatoEsterno',
      };
    case 'tauri_invoke':
      return {
        id,
        kind: 'tauri_invoke',
        commandName: 'export_native_report',
        args: { format: { source: 'literal', value: 'pdf' } },
        resultStateKey: 'tauriResult',
      };
    case 'if_else':
      return {
        id,
        kind: 'if_else',
        conditionGroup: {
          combinator: 'AND',
          conditions: [
            {
              id: `cond_${Date.now().toString(36).slice(-4)}`,
              left: { source: 'ui_element', nodeId: defaults.firstInputId, prop: 'value' },
              operator: 'isNotEmpty',
            },
          ],
        },
        thenSteps: [
          {
            id: `then_toast_${Date.now().toString(36).slice(-4)}`,
            kind: 'toast',
            variant: 'success',
            message: { source: 'literal', value: 'Valore valido!' },
          },
        ],
        elseSteps: [
          {
            id: `else_toast_${Date.now().toString(36).slice(-4)}`,
            kind: 'toast',
            variant: 'warn',
            message: { source: 'literal', value: 'Inserisci un valore prima di procedere.' },
          },
        ],
      };
    case 'delay':
      return {
        id,
        kind: 'delay',
        ms: 400,
      };
  }
}

export const VisualAutomationStudioView: React.FC<VisualAutomationStudioViewProps> = ({
  sheetId,
  vfsEntryId,
  initialAutomationId,
}) => {
  const activeSheetId = useStudioStore((s) => s.activeSheetId);
  const sheetDocuments = useStudioStore((s) => s.sheetDocuments);
  const sheets = useStudioStore((s) => s.sheets);
  const vfsTree = useStudioStore((s) => s.vfsTree);
  const sourceFiles = useStudioStore((s) => s.sourceFiles);
  const globalTarget = useStudioStore((s) => s.globalTarget);
  const activeAutomationId = useStudioStore((s) => s.activeAutomationId);
  const sqlDocument = useStudioStore((s) => s.sqlDocument);

  const setActiveAutomationId = useStudioStore((s) => s.setActiveAutomationId);
  const saveAndApplyAutomationRule = useStudioStore((s) => s.saveAndApplyAutomationRule);
  const deleteAutomationRule = useStudioStore((s) => s.deleteAutomationRule);
  const loadSqlSchemaAction = useStudioStore((s) => s.loadSqlSchemaAction);
  const openTabInGroup = useStudioStore((s) => s.openTabInGroup);
  const setBottomConsoleOpen = useStudioStore((s) => s.setBottomConsoleOpen);
  const pushToast = useStudioStore((s) => s.pushToast);

  const resolvedSheetId = sheetId || activeSheetId;
  const sheet = sheetDocuments[resolvedSheetId];

  useEffect(() => {
    if (!sqlDocument) {
      void loadSqlSchemaAction();
    }
  }, [sqlDocument, loadSqlSchemaAction]);

  // Discover all separate script files (.js / .ts / .py) in VFS
  const projectScriptFiles = useMemo(() => {
    return vfsTree
      .filter(
        (f) =>
          (f.entryKind === 'script_file' || /\.(js|mjs|ts|py)$/i.test(f.name)) &&
          !f.name.endsWith('.generated.ts'),
      )
      .map((f) => {
        const relPath = (f.diskRelPath || f.virtualPath || `scripts/${f.name}`).replace(/^\/+/, '');
        const content = sourceFiles[f.id] ?? '';
        const lang = inferScriptLanguageFromPath(relPath, content);
        const parsed = parseExternalScriptModule(content, lang, relPath);
        return { vfsEntry: f, relPath, content, lang, parsed };
      });
  }, [vfsTree, sourceFiles]);

  // External functions available for 1-click invocation in `call_external_fn`
  const externalFunctionsCatalog = useMemo(() => {
    const list: Array<{ fnName: string; relPath: string; vfsId: string; params: string[] }> = [];
    for (const sf of projectScriptFiles) {
      for (const fn of sf.parsed.functions) {
        list.push({
          fnName: fn.name,
          relPath: sf.relPath,
          vfsId: sf.vfsEntry.id,
          params: fn.params,
        });
      }
    }
    return list;
  }, [projectScriptFiles]);

  // Merge sheet.automations + any @studio-automation blocks parsed directly from separate script files
  const allAutomations = useMemo<AutomationRule[]>(() => {
    const byId = new Map<string, AutomationRule>();
    for (const rule of sheet?.automations ?? []) {
      byId.set(rule.id, rule);
    }
    for (const sf of projectScriptFiles) {
      for (const managed of sf.parsed.managedAutomations) {
        if (!byId.has(managed.id)) {
          byId.set(managed.id, {
            ...managed,
            targetFileVfsId: sf.vfsEntry.id,
            targetFileRelPath: sf.relPath,
          });
        }
      }
    }
    return Array.from(byId.values());
  }, [sheet?.automations, projectScriptFiles]);

  // Canvas UI elements for zero-code dropdowns
  const canvasNodes = useMemo(() => {
    if (!sheet) return [];
    return Object.values(sheet.nodes).filter((n) => n.kind !== 'artboard');
  }, [sheet]);

  const stepDefaults = useMemo(() => {
    const firstBtn =
      canvasNodes.find((n) => n.content?.controlType === 'button' || n.semanticTag === 'button')?.id ??
      canvasNodes[0]?.id ??
      'ActionButton';
    const firstInput =
      canvasNodes.find(
        (n) =>
          n.content?.controlType === 'text-input' ||
          n.semanticTag === 'input' ||
          n.name.toLowerCase().includes('input'),
      )?.id ??
      canvasNodes[0]?.id ??
      'EmailInput';
    const firstTable =
      canvasNodes.find((n) => n.content?.controlType === 'table' || n.semanticTag === 'table')?.id ??
      canvasNodes.find((n) => n.kind === 'collection')?.id ??
      canvasNodes[0]?.id ??
      'DataTable';
    const firstClassName = sheet?.reusableClasses?.[0]?.name ?? 'active-highlight';
    const firstSqlTable = sqlDocument?.tables[0]?.name ?? 'customers';
    const firstExt = externalFunctionsCatalog[0];
    return {
      firstBtnId: firstBtn,
      firstNodeId: canvasNodes[0]?.id ?? 'HeroTitle',
      firstInputId: firstInput,
      firstTableId: firstTable,
      firstClassName,
      firstSqlTable,
      firstExternalFn: firstExt?.fnName ?? 'calcolaSconto',
      firstExternalPath: firstExt?.relPath ?? 'scripts/helpers.js',
    };
  }, [canvasNodes, sheet?.reusableClasses, sqlDocument?.tables, externalFunctionsCatalog]);

  const initialTargetPath = useMemo(() => {
    if (vfsEntryId) {
      const match = projectScriptFiles.find((f) => f.vfsEntry.id === vfsEntryId);
      if (match) return match.relPath;
    }
    if (sheet?.linkedScripts?.[0]?.relativePath) {
      return sheet.linkedScripts[0].relativePath;
    }
    if (projectScriptFiles[0]?.relPath) {
      return projectScriptFiles[0].relPath;
    }
    return 'scripts/automations.js';
  }, [vfsEntryId, sheet?.linkedScripts, projectScriptFiles]);

  const createBlankAutomation = useCallback(
    (targetPath = initialTargetPath): AutomationRule => {
      const lang = inferScriptLanguageFromPath(targetPath);
      return {
        id: `auto_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
        name: 'Nuova Automazione UI',
        generatedFnName: lang === 'python' ? 'gestisci_azione_ui' : 'gestisciAzioneUi',
        enabled: true,
        targetFileRelPath: targetPath,
        language: lang,
        trigger: { type: 'onClick', sourceNodeId: stepDefaults.firstBtnId },
        steps: [],
        updatedAt: Date.now(),
      };
    },
    [initialTargetPath, stepDefaults.firstBtnId],
  );

  const [draftRule, setDraftRule] = useState<AutomationRule>(() => {
    const wantedId = initialAutomationId ?? activeAutomationId;
    const found = wantedId ? allAutomations.find((a) => a.id === wantedId) : allAutomations[0];
    return found ?? createBlankAutomation();
  });

  const [targetStack, setTargetStack] = useState<AutomationCodegenTarget>(() => {
    const resolved = resolveAutomationTarget(globalTarget, draftRule.language, draftRule.targetFileRelPath);
    return resolved.target;
  });

  const [newStepKind, setNewStepKind] = useState<StepKind>('toast');
  const [previewMode, setPreviewMode] = useState<'function' | 'full_file'>('full_file');
  const [codeEdits, setCodeEdits] = useState<Record<string, { content: string; expectedFile: string }>>({});
  const [saving, setSaving] = useState(false);

  // Sync selection when activeAutomationId changes externally (e.g. from ScriptWorkbenchView or Inspector)
  useEffect(() => {
    const wantedId = initialAutomationId ?? activeAutomationId;
    if (!wantedId) return;
    const found = allAutomations.find((a) => a.id === wantedId);
    if (found && found.id !== draftRule.id) {
      setDraftRule(found);
      const resolved = resolveAutomationTarget(globalTarget, found.language, found.targetFileRelPath);
      setTargetStack(resolved.target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAutomationId, activeAutomationId]);

  // Available target file options (both existing VFS files and standard separate `.js` / `.ts` / `.py` paths)
  const targetFileOptions = useMemo(() => {
    const map = new Map<string, { relPath: string; vfsId?: string; label: string }>();
    for (const sf of projectScriptFiles) {
      map.set(sf.relPath, {
        relPath: sf.relPath,
        vfsId: sf.vfsEntry.id,
        label: `📄 ${sf.relPath} (esistente)`,
      });
    }
    const defaults: Array<{ relPath: string; label: string }> = [
      { relPath: 'scripts/automations.js', label: '🟨 scripts/automations.js (JavaScript ES Module)' },
      { relPath: 'src/scripts/automations.ts', label: '🟦 src/scripts/automations.ts (TypeScript Module)' },
      { relPath: 'backend/automations.py', label: '🐍 backend/automations.py (Python / FastAPI)' },
    ];
    for (const d of defaults) {
      if (!map.has(d.relPath)) {
        map.set(d.relPath, d);
      }
    }
    if (draftRule.targetFileRelPath && !map.has(draftRule.targetFileRelPath)) {
      map.set(draftRule.targetFileRelPath, {
        relPath: draftRule.targetFileRelPath,
        vfsId: draftRule.targetFileVfsId,
        label: `📄 ${draftRule.targetFileRelPath}`,
      });
    }
    return Array.from(map.values());
  }, [projectScriptFiles, draftRule.targetFileRelPath, draftRule.targetFileVfsId]);

  const existingTargetFileContent = useMemo(() => {
    const match = projectScriptFiles.find(
      (sf) =>
        (draftRule.targetFileVfsId && sf.vfsEntry.id === draftRule.targetFileVfsId) ||
        sf.relPath === draftRule.targetFileRelPath,
    );
    return match?.content ?? '';
  }, [projectScriptFiles, draftRule.targetFileVfsId, draftRule.targetFileRelPath]);

  const hasManualConflict = useMemo(() => {
    if (!existingTargetFileContent) return false;
    return isManagedBlockManuallyModified(existingTargetFileContent, draftRule.id);
  }, [existingTargetFileContent, draftRule.id]);

  // Live compilation + non-destructive @studio-automation file preview
  const compiledResult = useMemo(() => {
    const lang: ScriptLanguage =
      targetStack === 'python'
        ? 'python'
        : inferScriptLanguageFromPath(draftRule.targetFileRelPath);
    return compileAutomationRuleToCode(
      { ...draftRule, language: lang },
      {
        target: targetStack,
        language: lang,
        sheet,
        sqlDocument,
        includeFences: true,
      },
    );
  }, [draftRule, targetStack, sheet, sqlDocument]);

  const patchedFullFilePreview = useMemo(() => {
    const lang: ScriptLanguage =
      targetStack === 'python'
        ? 'python'
        : inferScriptLanguageFromPath(draftRule.targetFileRelPath);
    return upsertManagedAutomationInFile(
      existingTargetFileContent,
      { ...draftRule, language: lang },
      compiledResult,
    );
  }, [existingTargetFileContent, draftRule, targetStack, compiledResult]);

  const sourceKey = JSON.stringify([resolvedSheetId, draftRule.id, draftRule.targetFileRelPath]);
  const codeEdit = codeEdits[sourceKey];
  const fileContent = codeEdit?.content ?? (hasManualConflict ? existingTargetFileContent : patchedFullFilePreview);
  const functionBody = getManagedAutomationBodyRange(fileContent, draftRule.id);
  const editFunction = previewMode === 'function' && functionBody !== undefined;

  const updateFileDraft = (content: string) => {
    setCodeEdits((before) => ({
      ...before, [sourceKey]: { content, expectedFile: before[sourceKey]?.expectedFile ?? existingTargetFileContent },
    }));
  };

  const updateCodeEditor = (text: string) => {
    if (!editFunction || !functionBody) {
      updateFileDraft(text);
      return;
    }
    const newline = fileContent.match(/\r\n|\n|\r/)?.[0] ?? '\n';
    const body = text.replace(/\r\n|\n|\r/g, newline);
    updateFileDraft(fileContent.slice(0, functionBody.start) + (body.endsWith(newline) ? body : body + newline) + fileContent.slice(functionBody.end));
  };

  const handleSelectAutomation = (rule: AutomationRule) => {
    setDraftRule(rule);
    setActiveAutomationId(rule.id);
    const resolved = resolveAutomationTarget(globalTarget, rule.language, rule.targetFileRelPath);
    setTargetStack(resolved.target);
  };

  const handleCreateNewBlank = () => {
    const fresh = createBlankAutomation(draftRule.targetFileRelPath || initialTargetPath);
    setDraftRule(fresh);
    setActiveAutomationId(fresh.id);
  };

  const handleLoadPreset = (presetId: AutomationPresetDescriptor['id']) => {
    const targetPath = draftRule.targetFileRelPath || initialTargetPath;
    const lang = inferScriptLanguageFromPath(targetPath);
    const created = createAutomationFromPreset(presetId, {
      sheet,
      sqlDocument,
      targetFileRelPath: targetPath,
      language: lang,
    });
    setDraftRule(created);
    setActiveAutomationId(created.id);
    pushToast('info', `Preset "${created.name}" pronto — clicca [✓ Applica Codice al File e Collega UI] per attivarlo!`);
  };

  const handleTargetFileChange = (nextRelPath: string) => {
    const opt = targetFileOptions.find((o) => o.relPath === nextRelPath);
    const lang = inferScriptLanguageFromPath(nextRelPath);
    const nextFnName =
      lang === 'python'
        ? toSnakeFnName(draftRule.name || draftRule.generatedFnName)
        : toCamelFnName(draftRule.name || draftRule.generatedFnName);
    setDraftRule((prev) => ({
      ...prev,
      targetFileRelPath: nextRelPath,
      targetFileVfsId: opt?.vfsId,
      language: lang,
      generatedFnName: nextFnName,
    }));
    if (lang === 'python') {
      setTargetStack('python');
    } else if (lang === 'javascript' && (targetStack === 'dom-ts' || targetStack === 'python')) {
      setTargetStack('dom-js');
    } else if (lang === 'typescript' && (targetStack === 'dom-js' || targetStack === 'python')) {
      setTargetStack('dom-ts');
    }
  };

  const handleApplyToFileAndWireUi = async (): Promise<boolean> => {
    if (!sheet || saving) return false;
    const lang: ScriptLanguage =
      targetStack === 'python'
        ? 'python'
        : inferScriptLanguageFromPath(draftRule.targetFileRelPath);
    const matchedFile = projectScriptFiles.find((sf) => sf.relPath === draftRule.targetFileRelPath);
    const finalRule: AutomationRule = {
      ...draftRule,
      language: lang,
      generatedFnName: compiledResult.fnName,
      targetFileVfsId: matchedFile?.vfsEntry.id ?? draftRule.targetFileVfsId,
      updatedAt: Date.now(),
    };
    const updatedContent = codeEdit || hasManualConflict
      ? fileContent
      : upsertManagedAutomationInFile(existingTargetFileContent, finalRule, compiledResult);
    if (codeEdit || hasManualConflict) {
      const review = parseExternalScriptModule(updatedContent, lang, finalRule.targetFileRelPath);
      if (!getManagedAutomationBodyRange(updatedContent, finalRule.id) || !review.functions.some((fn) =>
        fn.name === finalRule.generatedFnName && (lang === 'python' || fn.isExported),
      )) {
        pushToast('error', `Mantieni il blocco gestito e la funzione ${finalRule.generatedFnName}${lang === 'python' ? '' : ' esportata'} per conservare il collegamento.`);
        return false;
      }
    }
    setSaving(true);
    try {
      await saveAndApplyAutomationRule(finalRule, updatedContent, codeEdit?.expectedFile ?? existingTargetFileContent, sheet.sheetId);
      setCodeEdits((before) => {
        if (!before[sourceKey]) return before;
        const next = { ...before };
        delete next[sourceKey];
        return next;
      });
      setDraftRule(finalRule);
      setActiveAutomationId(finalRule.id);
      return true;
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleTestNow = async () => {
    if (!(await handleApplyToFileAndWireUi())) return;
    setBottomConsoleOpen(true);
    if (sheet) {
      openTabInGroup({
        kind: 'preview',
        title: `▶ Preview: ${sheet.name}`,
        sheetId: sheet.sheetId,
      });
    }
  };

  const handleDeleteAutomation = async (rule: AutomationRule, e: React.MouseEvent) => {
    e.stopPropagation();
    const sf = projectScriptFiles.find(
      (f) => f.vfsEntry.id === rule.targetFileVfsId || f.relPath === rule.targetFileRelPath,
    );
    const cleaned = sf ? removeManagedAutomationFromFile(sf.content, rule.id) : undefined;
    try {
      await deleteAutomationRule(rule.id, cleaned, sf?.content, resolvedSheetId);
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error));
      return;
    }
    if (draftRule.id === rule.id) {
      const remaining = allAutomations.filter((a) => a.id !== rule.id);
      setDraftRule(remaining[0] ?? createBlankAutomation());
    }
  };

  // Condition helpers
  const handleAddCondition = () => {
    const cond: AutomationCondition = {
      id: `cond_${Date.now().toString(36).slice(-4)}_${Math.random().toString(36).slice(2, 4)}`,
      left: { source: 'ui_element', nodeId: stepDefaults.firstInputId, prop: 'value' },
      operator: 'isNotEmpty',
      right: { source: 'literal', value: '' },
    };
    setDraftRule((prev) => ({
      ...prev,
      conditionCombinator: prev.conditionCombinator ?? 'AND',
      conditions: [...(prev.conditions ?? []), cond],
    }));
  };

  const handleUpdateCondition = (condId: string, updater: (c: AutomationCondition) => AutomationCondition) => {
    setDraftRule((prev) => ({
      ...prev,
      conditions: (prev.conditions ?? []).map((c) => (c.id === condId ? updater(c) : c)),
    }));
  };

  const handleRemoveCondition = (condId: string) => {
    setDraftRule((prev) => ({
      ...prev,
      conditions: (prev.conditions ?? []).filter((c) => c.id !== condId),
    }));
  };

  // Step helpers
  const handleAddStep = (kind: StepKind = newStepKind) => {
    const step = createDefaultStep(kind, stepDefaults);
    setDraftRule((prev) => ({
      ...prev,
      steps: [...prev.steps, step],
    }));
  };

  const handleUpdateStep = (stepId: string, updater: (s: AutomationStep) => AutomationStep) => {
    setDraftRule((prev) => ({
      ...prev,
      steps: prev.steps.map((s) => (s.id === stepId ? updater(s) : s)),
    }));
  };

  const handleMoveStep = (index: number, delta: -1 | 1) => {
    const targetIdx = index + delta;
    if (targetIdx < 0 || targetIdx >= draftRule.steps.length) return;
    setDraftRule((prev) => {
      const next = [...prev.steps];
      const [moved] = next.splice(index, 1);
      next.splice(targetIdx, 0, moved);
      return { ...prev, steps: next };
    });
  };

  const handleRemoveStep = (stepId: string) => {
    setDraftRule((prev) => ({
      ...prev,
      steps: prev.steps.filter((s) => s.id !== stepId),
    }));
  };

  // Reusable guided ValueOperand editor (zero-code dropdowns!)
  const renderOperandPicker = (
    operand: ValueOperand,
    onChange: (next: ValueOperand) => void,
    compact = false,
  ) => {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', flex: 1 }}>
        <select
          className="studio-select"
          style={{ height: 24, fontSize: 11, padding: '0 5px', width: compact ? 116 : 138 }}
          value={operand.source}
          onChange={(e) => {
            const src = e.target.value as ValueOperand['source'];
            if (src === 'ui_element') {
              onChange({ source: 'ui_element', nodeId: stepDefaults.firstInputId, prop: 'value' });
            } else if (src === 'state') {
              onChange({ source: 'state', key: sheet?.stateSchema?.[0]?.name ?? 'counter' });
            } else if (src === 'local_storage') {
              onChange({ source: 'local_storage', key: 'savedKey' });
            } else if (src === 'event_payload') {
              onChange({ source: 'event_payload', field: 'value' });
            } else if (src === 'param') {
              onChange({ source: 'param', name: draftRule.parameters?.[0]?.name ?? 'valore' });
            } else {
              onChange({ source: 'literal', value: '' });
            }
          }}
        >
          <option value="literal">🔤 Valore Fisso</option>
          <option value="ui_element">🧩 Elemento Canvas</option>
          <option value="event_payload">⚡ Valore Evento</option>
          <option value="state">📦 Variabile Stato</option>
          <option value="local_storage">💾 localStorage</option>
          <option value="param">📥 Parametro Funzione</option>
        </select>

        {operand.source === 'literal' && (
          <input
            type="text"
            className="studio-input"
            style={{ height: 24, fontSize: 11, flex: 1, minWidth: 90 }}
            value={String(operand.value ?? '')}
            placeholder="Testo o numero..."
            onChange={(e) => {
              const raw = e.target.value;
              const asNum = raw.trim() !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
              onChange({ source: 'literal', value: asNum });
            }}
          />
        )}

        {operand.source === 'ui_element' && (
          <>
            <select
              className="studio-select"
              style={{ height: 24, fontSize: 11, padding: '0 5px', flex: 1, minWidth: 110 }}
              value={operand.nodeId}
              onChange={(e) => onChange({ ...operand, nodeId: e.target.value })}
            >
              {canvasNodes.length === 0 && <option value={operand.nodeId}>{operand.nodeId}</option>}
              {canvasNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} (#{toKebabDomId(n.name)})
                </option>
              ))}
            </select>
            <select
              className="studio-select"
              style={{ height: 24, fontSize: 11, padding: '0 4px', width: 78 }}
              value={operand.prop}
              onChange={(e) =>
                onChange({
                  ...operand,
                  prop: e.target.value as 'value' | 'text' | 'checked' | 'visible',
                })
              }
            >
              <option value="value">.value</option>
              <option value="text">.text</option>
              <option value="checked">.checked</option>
              <option value="visible">visibile</option>
            </select>
          </>
        )}

        {operand.source === 'event_payload' && (
          <select
            className="studio-select"
            style={{ height: 24, fontSize: 11, padding: '0 5px', flex: 1 }}
            value={operand.field}
            onChange={(e) =>
              onChange({
                source: 'event_payload',
                field: e.target.value as 'value' | 'key' | 'targetId' | 'formDataJson',
              })
            }
          >
            <option value="value">event.target.value</option>
            <option value="key">event.key (Tasto)</option>
            <option value="targetId">event.target.id</option>
            <option value="formDataJson">FormData (JSON)</option>
          </select>
        )}

        {(operand.source === 'state' || operand.source === 'local_storage') && (
          <input
            type="text"
            className="studio-input"
            style={{ height: 24, fontSize: 11, flex: 1, minWidth: 90 }}
            value={operand.key}
            placeholder="Nome chiave..."
            onChange={(e) => onChange({ ...operand, key: e.target.value })}
          />
        )}

        {operand.source === 'param' && (
          <input
            type="text"
            className="studio-input"
            style={{ height: 24, fontSize: 11, flex: 1, minWidth: 90 }}
            value={operand.name}
            placeholder="Nome parametro..."
            onChange={(e) => onChange({ source: 'param', name: e.target.value })}
          />
        )}
      </div>
    );
  };

  const renderCanvasNodeSelect = (
    value: string | undefined,
    onChange: (nodeId: string) => void,
    placeholderLabel = 'Seleziona elemento UI...',
  ) => (
    <select
      className="studio-select"
      style={{ height: 24, fontSize: 11, padding: '0 6px', flex: 1, minWidth: 128 }}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholderLabel}</option>
      {value && !canvasNodes.some((n) => n.id === value) && (
        <option value={value}>🎯 {value}</option>
      )}
      {canvasNodes.map((n) => (
        <option key={n.id} value={n.id}>
          {n.name} ({n.content?.controlType ?? n.kind} • #{toKebabDomId(n.name)})
        </option>
      ))}
    </select>
  );

  const renderStepBody = (step: AutomationStep) => {
    switch (step.kind) {
      case 'ui_set_text':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 88 }}>Elemento UI:</span>
              {renderCanvasNodeSelect(step.targetNodeId, (id) =>
                handleUpdateStep(step.id, () => ({ ...step, targetNodeId: id })),
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 88 }}>Nuovo Testo:</span>
              {renderOperandPicker(step.value, (val) =>
                handleUpdateStep(step.id, () => ({ ...step, value: val })),
              )}
            </div>
          </div>
        );

      case 'ui_set_value':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 88 }}>Campo Input:</span>
              {renderCanvasNodeSelect(step.targetNodeId, (id) =>
                handleUpdateStep(step.id, () => ({ ...step, targetNodeId: id })),
              )}
              <select
                className="studio-select"
                style={{ height: 24, fontSize: 11, width: 102 }}
                value={step.prop ?? 'value'}
                onChange={(e) =>
                  handleUpdateStep(step.id, () => ({
                    ...step,
                    prop: e.target.value as 'value' | 'placeholder' | 'checked' | 'disabled' | 'src',
                  }))
                }
              >
                <option value="value">value</option>
                <option value="placeholder">placeholder</option>
                <option value="checked">checked</option>
                <option value="disabled">disabled</option>
                <option value="src">src</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 88 }}>Valore:</span>
              {renderOperandPicker(step.value, (val) =>
                handleUpdateStep(step.id, () => ({ ...step, value: val })),
              )}
            </div>
          </div>
        );

      case 'ui_visibility':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <select
              className="studio-select"
              style={{ height: 24, fontSize: 11, width: 120 }}
              value={step.mode}
              onChange={(e) =>
                handleUpdateStep(step.id, () => ({
                  ...step,
                  mode: e.target.value as 'show' | 'hide' | 'toggle',
                }))
              }
            >
              <option value="show">👁️ Mostra</option>
              <option value="hide">🙈 Nascondi</option>
              <option value="toggle">🔄 Alterna (Toggle)</option>
            </select>
            {renderCanvasNodeSelect(step.targetNodeId, (id) =>
              handleUpdateStep(step.id, () => ({ ...step, targetNodeId: id })),
            )}
          </div>
        );

      case 'ui_css_class': {
        const reusableClasses = sheet?.reusableClasses ?? [];
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <select
              className="studio-select"
              style={{ height: 24, fontSize: 11, width: 112 }}
              value={step.mode}
              onChange={(e) =>
                handleUpdateStep(step.id, () => ({
                  ...step,
                  mode: e.target.value as 'add' | 'remove' | 'toggle',
                }))
              }
            >
              <option value="toggle">🔄 Toggle</option>
              <option value="add">➕ Aggiungi</option>
              <option value="remove">➖ Rimuovi</option>
            </select>
            {renderCanvasNodeSelect(step.targetNodeId, (id) =>
              handleUpdateStep(step.id, () => ({ ...step, targetNodeId: id })),
            )}
            {reusableClasses.length > 0 && (
              <select
                className="studio-select"
                style={{ height: 24, fontSize: 11, width: 132 }}
                value={reusableClasses.some((c) => c.name === step.className) ? step.className : ''}
                onChange={(e) => {
                  if (e.target.value) {
                    handleUpdateStep(step.id, () => ({ ...step, className: e.target.value }));
                  }
                }}
              >
                <option value="">Classi Foglio...</option>
                {reusableClasses.map((rc) => (
                  <option key={rc.id} value={rc.name}>
                    .{rc.name}
                  </option>
                ))}
              </select>
            )}
            <input
              type="text"
              className="studio-input"
              style={{ height: 24, fontSize: 11, width: 130 }}
              value={step.className}
              placeholder="es. dark-mode"
              onChange={(e) =>
                handleUpdateStep(step.id, () => ({
                  ...step,
                  className: e.target.value.replace(/^\.+/, ''),
                }))
              }
            />
          </div>
        );
      }

      case 'ui_inline_style':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {renderCanvasNodeSelect(step.targetNodeId, (id) =>
                handleUpdateStep(step.id, () => ({ ...step, targetNodeId: id })),
              )}
              <select
                className="studio-select"
                style={{ height: 24, fontSize: 11, width: 146 }}
                value={step.cssProperty}
                onChange={(e) =>
                  handleUpdateStep(step.id, () => ({ ...step, cssProperty: e.target.value }))
                }
              >
                <option value="backgroundColor">backgroundColor</option>
                <option value="color">color</option>
                <option value="opacity">opacity</option>
                <option value="borderColor">borderColor</option>
                <option value="transform">transform</option>
                <option value="boxShadow">boxShadow</option>
              </select>
            </div>
            {renderOperandPicker(step.value, (val) =>
              handleUpdateStep(step.id, () => ({ ...step, value: val })),
            )}
          </div>
        );

      case 'validate_form':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {step.rules.map((r, rIdx) => (
              <div key={`${step.id}_r_${rIdx}`} style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                {renderCanvasNodeSelect(r.nodeId, (nodeId) =>
                  handleUpdateStep(step.id, () => ({
                    ...step,
                    rules: step.rules.map((item, idx) => (idx === rIdx ? { ...item, nodeId } : item)),
                  })),
                )}
                <select
                  className="studio-select"
                  style={{ height: 24, fontSize: 11, width: 122 }}
                  value={r.rule}
                  onChange={(e) =>
                    handleUpdateStep(step.id, () => ({
                      ...step,
                      rules: step.rules.map((item, idx) =>
                        idx === rIdx
                          ? { ...item, rule: e.target.value as 'required' | 'email' | 'minLength' | 'number' }
                          : item,
                      ),
                    }))
                  }
                >
                  <option value="required">Obbligatorio</option>
                  <option value="email">Formato Email</option>
                  <option value="minLength">Lunghezza Min.</option>
                  <option value="number">Valore Numerico</option>
                </select>
                <input
                  type="text"
                  className="studio-input"
                  style={{ height: 24, fontSize: 11, flex: 1, minWidth: 120 }}
                  value={r.errorMsg}
                  placeholder="Messaggio errore..."
                  onChange={(e) =>
                    handleUpdateStep(step.id, () => ({
                      ...step,
                      rules: step.rules.map((item, idx) =>
                        idx === rIdx ? { ...item, errorMsg: e.target.value } : item,
                      ),
                    }))
                  }
                />
              </div>
            ))}
            <button
              type="button"
              className="studio-btn sm ghost"
              style={{ alignSelf: 'flex-start', fontSize: 10.5 }}
              onClick={() =>
                handleUpdateStep(step.id, () => ({
                  ...step,
                  rules: [
                    ...step.rules,
                    {
                      nodeId: stepDefaults.firstInputId,
                      rule: 'required',
                      errorMsg: 'Campo richiesto',
                    },
                  ],
                }))
              }
            >
              <Plus size={11} /> Aggiungi Campo da Validare
            </button>
          </div>
        );

      case 'toast':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <select
              className="studio-select"
              style={{ height: 24, fontSize: 11, width: 115 }}
              value={step.variant}
              onChange={(e) =>
                handleUpdateStep(step.id, () => ({
                  ...step,
                  variant: e.target.value as 'info' | 'success' | 'warn' | 'error' | 'alert',
                }))
              }
            >
              <option value="success">✅ Success</option>
              <option value="info">ℹ️ Info</option>
              <option value="warn">⚠️ Warning</option>
              <option value="error">❌ Error</option>
              <option value="alert">🪟 Alert Nativo</option>
            </select>
            {renderOperandPicker(step.message, (msg) =>
              handleUpdateStep(step.id, () => ({ ...step, message: msg })),
            )}
          </div>
        );

      case 'sql_operation': {
        const sqlTables = sqlDocument?.tables ?? [];
        const namedQueries = sqlDocument?.namedQueries ?? [];
        const selectedTableObj = sqlTables.find((t) => t.name === step.tableName);
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <select
                className="studio-select"
                style={{ height: 24, fontSize: 11, width: 168 }}
                value={step.operation}
                onChange={(e) =>
                  handleUpdateStep(step.id, () => ({
                    ...step,
                    operation: e.target.value as typeof step.operation,
                  }))
                }
              >
                <option value="select_to_table">📋 SELECT -&gt; Tabella UI</option>
                <option value="insert_from_form">➕ INSERT da Campi Form</option>
                <option value="update_by_id">✏️ UPDATE Riga per ID</option>
                <option value="delete_by_id">🗑️ DELETE Riga per ID</option>
                <option value="run_named_query">⚡ Esegui Query Rapida</option>
              </select>

              {step.operation === 'run_named_query' ? (
                <select
                  className="studio-select"
                  style={{ height: 24, fontSize: 11, flex: 1 }}
                  value={step.namedQueryId ?? ''}
                  onChange={(e) =>
                    handleUpdateStep(step.id, () => ({ ...step, namedQueryId: e.target.value }))
                  }
                >
                  <option value="">Seleziona Query Salvata...</option>
                  {namedQueries.map((nq) => (
                    <option key={nq.id} value={nq.id}>
                      ⚡ {nq.name}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  className="studio-select"
                  style={{ height: 24, fontSize: 11, flex: 1 }}
                  value={step.tableName ?? ''}
                  onChange={(e) => {
                    const nextTable = e.target.value;
                    const tbl = sqlTables.find((t) => t.name === nextTable);
                    const autoMappings =
                      step.operation === 'insert_from_form' && tbl
                        ? tbl.columns
                            .filter((c) => !c.autoIncrement)
                            .slice(0, 3)
                            .map((c) => ({
                              columnName: c.name,
                              value: {
                                source: 'ui_element' as const,
                                nodeId: stepDefaults.firstInputId,
                                prop: 'value' as const,
                              },
                            }))
                        : step.columnMappings;
                    handleUpdateStep(step.id, () => ({
                      ...step,
                      tableName: nextTable,
                      columnMappings: autoMappings,
                    }));
                  }}
                >
                  {sqlTables.length === 0 && (
                    <option value={step.tableName ?? 'customers'}>
                      🗄️ {step.tableName ?? 'customers'}
                    </option>
                  )}
                  {sqlTables.map((t) => (
                    <option key={t.id} value={t.name}>
                      🗄️ Tabella: {t.name} ({t.columns.length} col.)
                    </option>
                  ))}
                </select>
              )}
            </div>

            {(step.operation === 'select_to_table' || step.operation === 'run_named_query') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 105 }}>Popola Tabella UI:</span>
                {renderCanvasNodeSelect(
                  step.targetTableNodeId,
                  (id) => handleUpdateStep(step.id, () => ({ ...step, targetTableNodeId: id })),
                  'Nessuna (solo stato)',
                )}
              </div>
            )}

            {(step.operation === 'insert_from_form' || step.operation === 'update_by_id') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(step.columnMappings ?? []).map((cm, cmIdx) => (
                  <div key={`${step.id}_cm_${cmIdx}`} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <select
                      className="studio-select"
                      style={{ height: 24, fontSize: 11, width: 122 }}
                      value={cm.columnName}
                      onChange={(e) =>
                        handleUpdateStep(step.id, () => ({
                          ...step,
                          columnMappings: (step.columnMappings ?? []).map((m, i) =>
                            i === cmIdx ? { ...m, columnName: e.target.value } : m,
                          ),
                        }))
                      }
                    >
                      {!selectedTableObj?.columns.some((c) => c.name === cm.columnName) && (
                        <option value={cm.columnName}>{cm.columnName}</option>
                      )}
                      {(selectedTableObj?.columns ?? []).map((col) => (
                        <option key={col.id} value={col.name}>
                          {col.name} ({col.canonicalType})
                        </option>
                      ))}
                    </select>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>←</span>
                    {renderOperandPicker(
                      cm.value,
                      (val) =>
                        handleUpdateStep(step.id, () => ({
                          ...step,
                          columnMappings: (step.columnMappings ?? []).map((m, i) =>
                            i === cmIdx ? { ...m, value: val } : m,
                          ),
                        })),
                      true,
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className="studio-btn sm ghost"
                  style={{ alignSelf: 'flex-start', fontSize: 10.5 }}
                  onClick={() => {
                    const nextCol =
                      selectedTableObj?.columns.find(
                        (c) => !c.autoIncrement && !(step.columnMappings ?? []).some((m) => m.columnName === c.name),
                      )?.name ?? 'name';
                    handleUpdateStep(step.id, () => ({
                      ...step,
                      columnMappings: [
                        ...(step.columnMappings ?? []),
                        {
                          columnName: nextCol,
                          value: { source: 'ui_element', nodeId: stepDefaults.firstInputId, prop: 'value' },
                        },
                      ],
                    }));
                  }}
                >
                  <Plus size={11} /> Mappa Colonna SQL
                </button>
              </div>
            )}
          </div>
        );
      }

      case 'http_fetch':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <select
                className="studio-select"
                style={{ height: 24, fontSize: 11, width: 84 }}
                value={step.method}
                onChange={(e) =>
                  handleUpdateStep(step.id, () => ({
                    ...step,
                    method: e.target.value as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
                  }))
                }
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
              </select>
              {renderOperandPicker(step.url, (url) =>
                handleUpdateStep(step.id, () => ({ ...step, url })),
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <select
                className="studio-select"
                style={{ height: 24, fontSize: 11, width: 152 }}
                value={step.bindMode ?? 'render_table_rows'}
                onChange={(e) =>
                  handleUpdateStep(step.id, () => ({
                    ...step,
                    bindMode: e.target.value as 'set_text' | 'render_table_rows' | 'save_state',
                  }))
                }
              >
                <option value="render_table_rows">Popola Tabella/Lista UI</option>
                <option value="set_text">Mostra Testo in Nodo UI</option>
                <option value="save_state">Salva in Variabile Stato</option>
              </select>
              {renderCanvasNodeSelect(
                step.targetNodeId,
                (id) => handleUpdateStep(step.id, () => ({ ...step, targetNodeId: id })),
                'Elemento destinazione...',
              )}
            </div>
          </div>
        );

      case 'storage_state':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <select
              className="studio-select"
              style={{ height: 24, fontSize: 11, width: 118 }}
              value={step.target}
              onChange={(e) =>
                handleUpdateStep(step.id, () => ({
                  ...step,
                  target: e.target.value as 'state' | 'localStorage' | 'sessionStorage',
                }))
              }
            >
              <option value="state">Stato Pagina</option>
              <option value="localStorage">localStorage</option>
              <option value="sessionStorage">sessionStorage</option>
            </select>
            <input
              type="text"
              className="studio-input"
              style={{ height: 24, fontSize: 11, width: 112 }}
              value={step.key}
              placeholder="Chiave..."
              onChange={(e) => handleUpdateStep(step.id, () => ({ ...step, key: e.target.value }))}
            />
            <select
              className="studio-select"
              style={{ height: 24, fontSize: 11, width: 112 }}
              value={step.operation}
              onChange={(e) =>
                handleUpdateStep(step.id, () => ({
                  ...step,
                  operation: e.target.value as 'set' | 'increment' | 'decrement' | 'toggle_bool' | 'remove',
                }))
              }
            >
              <option value="set">Imposta (=)</option>
              <option value="increment">Incrementa (+1)</option>
              <option value="decrement">Decrementa (-1)</option>
              <option value="toggle_bool">Inverti Bool (!)</option>
              <option value="remove">Rimuovi</option>
            </select>
            {step.operation === 'set' &&
              step.value &&
              renderOperandPicker(
                step.value,
                (val) => handleUpdateStep(step.id, () => ({ ...step, value: val })),
                true,
              )}
          </div>
        );

      case 'math_formula':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              <select
                className="studio-select"
                style={{ height: 24, fontSize: 11, width: 132 }}
                value={step.formulaKind ?? 'currency_eur'}
                onChange={(e) =>
                  handleUpdateStep(step.id, () => ({
                    ...step,
                    formulaKind: e.target.value as 'math' | 'string_concat' | 'currency_eur',
                  }))
                }
              >
                <option value="currency_eur">💶 Valuta EUR (€)</option>
                <option value="math">🔢 Calcolo Numerico</option>
                <option value="string_concat">🔗 Unisci Testi</option>
              </select>
              {renderOperandPicker(
                step.left,
                (left) => handleUpdateStep(step.id, () => ({ ...step, left })),
                true,
              )}
              <select
                className="studio-select"
                style={{ height: 24, fontSize: 11, width: 54 }}
                value={step.operator ?? '*'}
                onChange={(e) =>
                  handleUpdateStep(step.id, () => ({
                    ...step,
                    operator: e.target.value as '+' | '-' | '*' | '/',
                  }))
                }
              >
                <option value="+">+</option>
                <option value="-">-</option>
                <option value="*">×</option>
                <option value="/">÷</option>
              </select>
              {step.right &&
                renderOperandPicker(
                  step.right,
                  (right) => handleUpdateStep(step.id, () => ({ ...step, right })),
                  true,
                )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 96 }}>Mostra in UI:</span>
              {renderCanvasNodeSelect(step.targetNodeId, (id) =>
                handleUpdateStep(step.id, () => ({ ...step, targetNodeId: id })),
              )}
            </div>
          </div>
        );

      case 'navigate':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <select
              className="studio-select"
              style={{ height: 24, fontSize: 11, width: 146 }}
              value={step.action}
              onChange={(e) =>
                handleUpdateStep(step.id, () => ({
                  ...step,
                  action: e.target.value as 'navigate_sheet' | 'navigate_url' | 'open_modal' | 'close_modal',
                }))
              }
            >
              <option value="navigate_sheet">📄 Vai a Foglio App</option>
              <option value="navigate_url">🌐 Apri Route / URL</option>
              <option value="open_modal">🪟 Apri Dialog / Modale</option>
              <option value="close_modal">✖️ Chiudi Dialog / Modale</option>
            </select>
            {step.action === 'navigate_sheet' ? (
              <select
                className="studio-select"
                style={{ height: 24, fontSize: 11, flex: 1 }}
                value={step.target}
                onChange={(e) => handleUpdateStep(step.id, () => ({ ...step, target: e.target.value }))}
              >
                {sheets.map((sh) => (
                  <option key={sh.id} value={sh.name}>
                    📄 {sh.name}
                  </option>
                ))}
              </select>
            ) : step.action === 'navigate_url' ? (
              <input
                type="text"
                className="studio-input"
                style={{ height: 24, fontSize: 11, flex: 1 }}
                value={step.target}
                placeholder="/dashboard o https://..."
                onChange={(e) => handleUpdateStep(step.id, () => ({ ...step, target: e.target.value }))}
              />
            ) : (
              renderCanvasNodeSelect(step.target, (id) =>
                handleUpdateStep(step.id, () => ({ ...step, target: id })),
              )
            )}
          </div>
        );

      case 'call_external_fn':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {externalFunctionsCatalog.length > 0 ? (
              <select
                className="studio-select"
                style={{ height: 24, fontSize: 11, flex: 1 }}
                value={`${step.moduleRelPath ?? ''}::${step.fnName}`}
                onChange={(e) => {
                  const [relPath, fnName] = e.target.value.split('::');
                  const match = externalFunctionsCatalog.find(
                    (f) => f.relPath === relPath && f.fnName === fnName,
                  );
                  handleUpdateStep(step.id, () => ({
                    ...step,
                    fnName: fnName || step.fnName,
                    moduleRelPath: relPath || step.moduleRelPath,
                    vfsEntryId: match?.vfsId,
                  }));
                }}
              >
                {!externalFunctionsCatalog.some(
                  (f) => f.relPath === (step.moduleRelPath ?? '') && f.fnName === step.fnName,
                ) && (
                  <option value={`${step.moduleRelPath ?? ''}::${step.fnName}`}>
                    ƒ {step.fnName}() — {step.moduleRelPath ?? 'modulo esterno'}
                  </option>
                )}
                {externalFunctionsCatalog.map((fn) => (
                  <option key={`${fn.relPath}::${fn.fnName}`} value={`${fn.relPath}::${fn.fnName}`}>
                    ƒ {fn.fnName}({fn.params.join(', ')}) — {fn.relPath}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input
                  type="text"
                  className="studio-input"
                  style={{ height: 24, fontSize: 11, width: 135 }}
                  value={step.fnName}
                  placeholder="nomeFunzione"
                  onChange={(e) => handleUpdateStep(step.id, () => ({ ...step, fnName: e.target.value }))}
                />
                <input
                  type="text"
                  className="studio-input"
                  style={{ height: 24, fontSize: 11, flex: 1 }}
                  value={step.moduleRelPath ?? ''}
                  placeholder="scripts/helpers.js"
                  onChange={(e) =>
                    handleUpdateStep(step.id, () => ({ ...step, moduleRelPath: e.target.value }))
                  }
                />
              </>
            )}
          </div>
        );

      case 'tauri_invoke':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Comando Rust:</span>
            <input
              type="text"
              className="studio-input"
              style={{ height: 24, fontSize: 11, flex: 1 }}
              value={step.commandName}
              placeholder="es. save_local_invoice"
              onChange={(e) =>
                handleUpdateStep(step.id, () => ({ ...step, commandName: e.target.value }))
              }
            />
          </div>
        );

      case 'if_else': {
        const firstCond = step.conditionGroup.conditions[0];
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11 }}>
            {firstCond && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                <span className="badge amber">SE</span>
                {renderOperandPicker(
                  firstCond.left,
                  (left) =>
                    handleUpdateStep(step.id, () => ({
                      ...step,
                      conditionGroup: {
                        ...step.conditionGroup,
                        conditions: [{ ...firstCond, left }, ...step.conditionGroup.conditions.slice(1)],
                      },
                    })),
                  true,
                )}
                <select
                  className="studio-select"
                  style={{ height: 24, fontSize: 11, width: 132 }}
                  value={firstCond.operator}
                  onChange={(e) =>
                    handleUpdateStep(step.id, () => ({
                      ...step,
                      conditionGroup: {
                        ...step.conditionGroup,
                        conditions: [
                          { ...firstCond, operator: e.target.value as ConditionOperator },
                          ...step.conditionGroup.conditions.slice(1),
                        ],
                      },
                    }))
                  }
                >
                  {CONDITION_OPERATORS.map((op) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>
              Ramo VERO: {step.thenSteps.length} azioni • Ramo ALTRIMENTI: {(step.elseSteps ?? []).length} azioni
            </div>
          </div>
        );
      }

      case 'delay':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Attesa (ms):</span>
            <input
              type="number"
              className="studio-input"
              style={{ height: 24, fontSize: 11, width: 96 }}
              min={10}
              step={50}
              value={step.ms}
              onChange={(e) =>
                handleUpdateStep(step.id, () => ({ ...step, ms: Math.max(0, Number(e.target.value) || 0) }))
              }
            />
          </div>
        );
    }
  };

  return (
    <div
      data-testid="visual-automation-studio"
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-panel)',
        overflow: 'hidden',
      }}
    >
      {/* Top Studio Header Bar */}
      <div className="canvas-subtoolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <Wand2 size={14} color="var(--accent-violet)" />
          <span style={{ fontWeight: 700, fontSize: 12.5 }}>
            Automazioni &amp; Funzioni Senza Codice
          </span>
          <span className="badge violet">Zero Lock-In • Vero Codice .js / .ts / .py</span>
          {sheet && (
            <span className="badge blue" title="Foglio Canvas attivo">
              Foglio: {sheet.name}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="studio-btn sm primary"
            data-testid="btn-apply-automation"
            disabled={saving || !sheet}
            onClick={() => void handleApplyToFileAndWireUi()}
          >
            <Check size={12} />
            <span>✓ Applica Codice al File e Collega UI</span>
          </button>

          <button
            type="button"
            className="studio-btn sm"
            style={{
              background: 'var(--accent-emerald)',
              borderColor: 'var(--accent-emerald)',
              color: '#ffffff',
              fontWeight: 700,
            }}
            data-testid="btn-test-automation"
            disabled={saving || !sheet}
            onClick={() => void handleTestNow()}
          >
            <Play size={12} />
            <span>▶ Testa Subito</span>
          </button>
        </div>
      </div>

      {/* Main 3-Column Guided Workspace */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        {/* LEFT COLUMN: Automations List + + Nuova Automazione + 5 Ready Presets */}
        <aside
          style={{
            width: 268,
            minWidth: 230,
            borderRight: '1px solid var(--border-subtle)',
            background: 'var(--bg-header)',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            flexShrink: 0,
          }}
        >
          <div style={{ padding: 10, borderBottom: '1px solid var(--border-subtle)' }}>
            <button
              type="button"
              className="studio-btn sm primary"
              style={{ width: '100%', justifyContent: 'center', height: 28, fontWeight: 700 }}
              data-testid="btn-new-automation"
              onClick={handleCreateNewBlank}
            >
              <Plus size={13} />
              <span>+ Nuova Automazione / Funzione Senza Codice</span>
            </button>
          </div>

          {/* Active Automations on Sheet / Script Files */}
          <div
            style={{
              padding: '6px 10px',
              fontSize: 10.5,
              fontWeight: 700,
              color: 'var(--text-secondary)',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>AUTOMAZIONI ATTIVE ({allAutomations.length})</span>
          </div>

          <div
            data-testid="automation-list"
            style={{
              maxHeight: 215,
              overflowY: 'auto',
              padding: 6,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            {allAutomations.length === 0 && (
              <div style={{ padding: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                Nessuna automazione salvata sul foglio. Scegli uno dei 5 Preset pronti qui sotto o clicca
                [✓ Applica Codice al File e Collega UI]!
              </div>
            )}
            {allAutomations.map((item) => {
              const isSelected = item.id === draftRule.id;
              return (
                <div
                  key={item.id}
                  onClick={() => handleSelectAutomation(item)}
                  style={{
                    padding: '7px 8px',
                    borderRadius: 7,
                    border: `1px solid ${isSelected ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                    background: isSelected ? 'var(--accent-soft)' : 'var(--bg-panel)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                      ⚡ {item.name}
                    </span>
                    <button
                      type="button"
                      className="studio-btn sm ghost"
                      style={{ height: 18, width: 18, padding: 0 }}
                      title="Rimuovi automazione dal foglio e dal file script"
                      onClick={(e) => void handleDeleteAutomation(item, e)}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 10,
                      color: 'var(--text-muted)',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    <span className="badge blue">{item.trigger.type}</span>
                    <span>ƒ {item.generatedFnName}()</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 5 Ready Zero-Code Presets */}
          <div
            style={{
              padding: '6px 10px',
              fontSize: 10.5,
              fontWeight: 700,
              color: 'var(--text-secondary)',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <Sparkles size={11} color="var(--accent-amber)" />
            <span>5 PRESET PRONTI SENZA CODICE</span>
          </div>

          <div
            data-testid="automation-presets-list"
            style={{ flex: 1, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 5 }}
          >
            {AUTOMATION_PRESET_CATALOG.map((preset) => (
              <button
                key={preset.id}
                type="button"
                data-testid={`btn-preset-${preset.id}`}
                onClick={() => handleLoadPreset(preset.id)}
                style={{
                  textAlign: 'left',
                  padding: '8px 9px',
                  borderRadius: 7,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-panel)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700 }}>{preset.title}</span>
                  <span className="badge violet" style={{ flexShrink: 0 }}>
                    {preset.badge}
                  </span>
                </div>
                <span style={{ fontSize: 10.5, color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                  {preset.subtitle}
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* CENTER COLUMN: 3-Stage Guided Visual Builder (1. QUANDO -> 2. SE -> 3. AZIONI PASSO-PASSO) */}
        <main
          style={{
            flex: 1,
            minWidth: 320,
            overflowY: 'auto',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {/* Identity & Generated Function Header */}
          <div
            style={{
              padding: 10,
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-header)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <div style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)' }}>
                NOME AUTOMAZIONE / FUNZIONE
              </label>
              <input
                type="text"
                className="studio-input"
                data-testid="automation-name-input"
                style={{ height: 26, fontSize: 12, fontWeight: 600 }}
                value={draftRule.name}
                onChange={(e) => {
                  const name = e.target.value;
                  const lang = inferScriptLanguageFromPath(draftRule.targetFileRelPath);
                  setDraftRule((prev) => ({
                    ...prev,
                    name,
                    generatedFnName: lang === 'python' ? toSnakeFnName(name) : toCamelFnName(name),
                  }));
                }}
              />
            </div>

            <div style={{ width: 195, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)' }}>
                FUNZIONE ESPORTATA NEL FILE
              </label>
              <input
                type="text"
                className="studio-input"
                data-testid="automation-fn-name-input"
                style={{ height: 26, fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace" }}
                value={draftRule.generatedFnName}
                onChange={(e) =>
                  setDraftRule((prev) => ({
                    ...prev,
                    generatedFnName: e.target.value.replace(/[^A-Za-z0-9_$]/g, ''),
                  }))
                }
              />
            </div>
          </div>

          {/* STAGE 1: 1. QUANDO (Trigger) */}
          <section
            data-testid="automation-stage-trigger"
            style={{
              padding: 11,
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-header)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="badge blue">1. QUANDO (Trigger)</span>
              <span style={{ fontSize: 11.5, fontWeight: 700 }}>
                Scegli l&apos;evento dell&apos;elemento Canvas o crea una funzione richiamabile
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <select
                className="studio-select"
                data-testid="automation-trigger-type-select"
                style={{ height: 26, fontSize: 11.5, minWidth: 225 }}
                value={draftRule.trigger.type}
                onChange={(e) =>
                  setDraftRule((prev) => ({
                    ...prev,
                    trigger: {
                      ...prev.trigger,
                      type: e.target.value as AutomationTriggerType,
                    },
                  }))
                }
              >
                {TRIGGER_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>

              {draftRule.trigger.type !== 'callable' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 180 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    su Elemento:
                  </span>
                  {renderCanvasNodeSelect(
                    draftRule.trigger.sourceNodeId,
                    (sourceNodeId) =>
                      setDraftRule((prev) => ({
                        ...prev,
                        trigger: { ...prev.trigger, sourceNodeId },
                      })),
                    'Seleziona Bottone / Input / Form...',
                  )}
                </div>
              )}

              {draftRule.trigger.type === 'onInput' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Debounce (ms):</span>
                  <input
                    type="number"
                    className="studio-input"
                    style={{ height: 24, width: 72, fontSize: 11 }}
                    value={draftRule.trigger.debounceMs ?? 0}
                    onChange={(e) =>
                      setDraftRule((prev) => ({
                        ...prev,
                        trigger: { ...prev.trigger, debounceMs: Number(e.target.value) || undefined },
                      }))
                    }
                  />
                </div>
              )}

              {draftRule.trigger.type === 'onKeyDown' && (
                <select
                  className="studio-select"
                  style={{ height: 24, fontSize: 11, width: 110 }}
                  value={draftRule.trigger.keyFilter ?? 'Enter'}
                  onChange={(e) =>
                    setDraftRule((prev) => ({
                      ...prev,
                      trigger: { ...prev.trigger, keyFilter: e.target.value },
                    }))
                  }
                >
                  <option value="Enter">Enter</option>
                  <option value="Escape">Escape</option>
                  <option value="Space">Space</option>
                  <option value="ArrowDown">ArrowDown</option>
                </select>
              )}

              {draftRule.trigger.type === 'onInterval' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Ogni (ms):</span>
                  <input
                    type="number"
                    className="studio-input"
                    style={{ height: 24, width: 84, fontSize: 11 }}
                    value={draftRule.trigger.intervalMs ?? 5000}
                    onChange={(e) =>
                      setDraftRule((prev) => ({
                        ...prev,
                        trigger: { ...prev.trigger, intervalMs: Math.max(250, Number(e.target.value) || 5000) },
                      }))
                    }
                  />
                </div>
              )}
            </div>
          </section>

          {/* STAGE 2: 2. SE (Condizioni opzionali) */}
          <section
            data-testid="automation-stage-conditions"
            style={{
              padding: 11,
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-header)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="badge amber">
                  <GitBranch size={10} /> 2. SE (Condizioni opzionali)
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 700 }}>
                  Esegui solo se si verificano queste condizioni ({(draftRule.conditions ?? []).length})
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {(draftRule.conditions ?? []).length > 1 && (
                  <select
                    className="studio-select"
                    style={{ height: 22, fontSize: 10.5, width: 138 }}
                    value={draftRule.conditionCombinator ?? 'AND'}
                    onChange={(e) =>
                      setDraftRule((prev) => ({
                        ...prev,
                        conditionCombinator: e.target.value as 'AND' | 'OR',
                      }))
                    }
                  >
                    <option value="AND">TUTTE vere (AND)</option>
                    <option value="OR">ALMENO UNA vera (OR)</option>
                  </select>
                )}
                <button
                  type="button"
                  className="studio-btn sm"
                  data-testid="btn-add-condition"
                  onClick={handleAddCondition}
                >
                  <Plus size={11} />
                  <span>+ Aggiungi Condizione</span>
                </button>
              </div>
            </div>

            {(draftRule.conditions ?? []).map((cond) => {
              const opMeta = CONDITION_OPERATORS.find((o) => o.value === cond.operator);
              return (
                <div
                  key={cond.id}
                  style={{
                    padding: 7,
                    borderRadius: 6,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-panel)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    flexWrap: 'wrap',
                  }}
                >
                  {renderOperandPicker(
                    cond.left,
                    (left) => handleUpdateCondition(cond.id, (c) => ({ ...c, left })),
                    true,
                  )}
                  <select
                    className="studio-select"
                    style={{ height: 24, fontSize: 11, width: 152 }}
                    value={cond.operator}
                    onChange={(e) =>
                      handleUpdateCondition(cond.id, (c) => ({
                        ...c,
                        operator: e.target.value as ConditionOperator,
                      }))
                    }
                  >
                    {CONDITION_OPERATORS.map((op) => (
                      <option key={op.value} value={op.value}>
                        {op.label}
                      </option>
                    ))}
                  </select>
                  {!opMeta?.unary &&
                    renderOperandPicker(
                      cond.right ?? { source: 'literal', value: '' },
                      (right) => handleUpdateCondition(cond.id, (c) => ({ ...c, right })),
                      true,
                    )}
                  <button
                    type="button"
                    className="studio-btn sm ghost"
                    style={{ height: 22, width: 22, padding: 0 }}
                    onClick={() => handleRemoveCondition(cond.id)}
                    title="Rimuovi condizione"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              );
            })}
          </section>

          {/* STAGE 3: 3. AZIONI PASSO-PASSO */}
          <section
            data-testid="automation-stage-steps"
            style={{
              padding: 11,
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-header)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="badge green">
                  <Layers size={10} /> 3. AZIONI PASSO-PASSO ({draftRule.steps.length})
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 700 }}>
                  Costruisci la sequenza guidata di azioni UI, CSS, SQL e API
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                <select
                  className="studio-select"
                  data-testid="select-new-step-kind"
                  style={{ height: 25, fontSize: 11, minWidth: 225 }}
                  value={newStepKind}
                  onChange={(e) => setNewStepKind(e.target.value as StepKind)}
                >
                  {STEP_KIND_OPTIONS.map((opt) => (
                    <option key={opt.kind} value={opt.kind}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="studio-btn sm primary"
                  data-testid="btn-add-step"
                  onClick={() => handleAddStep(newStepKind)}
                >
                  <Plus size={12} />
                  <span>+ Aggiungi Passo</span>
                </button>
              </div>
            </div>

            {draftRule.steps.length === 0 && (
              <div
                style={{
                  padding: 14,
                  textAlign: 'center',
                  fontSize: 11.5,
                  color: 'var(--text-muted)',
                  border: '1px dashed var(--border-subtle)',
                  borderRadius: 7,
                }}
              >
                Nessun passo presente. Scegli un&apos;azione dal menu e clicca [+ Aggiungi Passo]!
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {draftRule.steps.map((step, idx) => {
                const meta = STEP_KIND_OPTIONS.find((o) => o.kind === step.kind);
                return (
                  <div
                    key={step.id}
                    data-testid={`automation-step-card-${step.kind}`}
                    style={{
                      padding: 9,
                      borderRadius: 7,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-panel)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 7,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="badge violet">#{idx + 1}</span>
                        <span style={{ fontSize: 11.5, fontWeight: 700 }}>
                          {meta?.label ?? step.kind}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <button
                          type="button"
                          className="studio-btn sm ghost"
                          style={{ height: 20, width: 20, padding: 0 }}
                          disabled={idx === 0}
                          title="Sposta passo in alto"
                          onClick={() => handleMoveStep(idx, -1)}
                        >
                          <ArrowUp size={11} />
                        </button>
                        <button
                          type="button"
                          className="studio-btn sm ghost"
                          style={{ height: 20, width: 20, padding: 0 }}
                          disabled={idx === draftRule.steps.length - 1}
                          title="Sposta passo in basso"
                          onClick={() => handleMoveStep(idx, 1)}
                        >
                          <ArrowDown size={11} />
                        </button>
                        <button
                          type="button"
                          className="studio-btn sm ghost"
                          style={{ height: 20, width: 20, padding: 0 }}
                          title="Elimina questo passo"
                          onClick={() => handleRemoveStep(step.id)}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>

                    {renderStepBody(step)}
                  </div>
                );
              })}
            </div>
          </section>
        </main>

        {/* RIGHT COLUMN: Separate Target File Selector + Stack Picker + Live Clean Code Preview */}
        <aside
          style={{
            width: 360,
            minWidth: 285,
            borderLeft: '1px solid var(--border-subtle)',
            background: 'var(--code-bg)',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              padding: 9,
              background: 'var(--bg-header)',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <FileCode2 size={12} color="var(--accent-violet)" /> FILE SEPARATO DI DESTINAZIONE
              </span>
              <span className="badge green">{compiledResult.language.toUpperCase()}</span>
            </div>

            <select
              className="studio-select"
              data-testid="automation-target-file-select"
              style={{ height: 26, fontSize: 11, fontWeight: 600 }}
              value={draftRule.targetFileRelPath}
              onChange={(e) => handleTargetFileChange(e.target.value)}
            >
              {targetFileOptions.map((opt) => (
                <option key={opt.relPath} value={opt.relPath}>
                  {opt.label}
                </option>
              ))}
            </select>

            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Code2 size={12} color="var(--text-muted)" />
              <select
                className="studio-select"
                data-testid="automation-target-stack-select"
                style={{ height: 24, fontSize: 11, flex: 1 }}
                value={targetStack}
                onChange={(e) => setTargetStack(e.target.value as AutomationCodegenTarget)}
              >
                {TARGET_STACK_OPTIONS.map((st) => (
                  <option key={st.value} value={st.value}>
                    {st.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                className={`studio-btn sm ${previewMode === 'full_file' ? 'active' : 'ghost'}`}
                style={{ flex: 1, justifyContent: 'center', fontSize: 10.5 }}
                onClick={() => setPreviewMode('full_file')}
              >
                File Completo Patchato
              </button>
              <button
                type="button"
                className={`studio-btn sm ${previewMode === 'function' ? 'active' : 'ghost'}`}
                style={{ flex: 1, justifyContent: 'center', fontSize: 10.5 }}
                disabled={!functionBody}
                onClick={() => setPreviewMode('function')}
              >
                Solo Funzione
              </button>
            </div>
          </div>

          {(hasManualConflict || codeEdit) && (
            <div
              data-testid="automation-manual-conflict-banner"
              style={{
                padding: '7px 10px',
                background: 'rgba(245, 158, 11, 0.16)',
                borderBottom: '1px solid rgba(245, 158, 11, 0.45)',
                color: '#fbbf24',
                fontSize: 11,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <AlertTriangle size={13} style={{ flexShrink: 0 }} />
              <span>
                Applica salva il codice visibile. Le modifiche al sorgente non aggiornano i passi visuali.
              </span>
              <button
                type="button"
                className="studio-btn sm"
                disabled={saving}
                onClick={() => setCodeEdits((before) => ({
                  ...before, [sourceKey]: { content: patchedFullFilePreview, expectedFile: existingTargetFileContent },
                }))}
              >Rigenera dal flusso</button>
            </div>
          )}

          {compiledResult.ipcCommands.length > 0 && (
            <div
              style={{
                padding: '5px 10px',
                background: 'rgba(139, 92, 246, 0.12)',
                borderBottom: '1px solid var(--border-subtle)',
                fontSize: 10.5,
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <Database size={11} color="var(--accent-violet)" />
              <span>
                Comandi Tauri Rust auto-registrati: {compiledResult.ipcCommands.map((c) => c.name).join(', ')}
              </span>
            </div>
          )}

          <GeneratedSourceTextarea
            label={editFunction ? 'Funzione gestita' : 'Sorgente automazione'}
            testId="automation-live-code-preview"
            value={editFunction && functionBody ? fileContent.slice(functionBody.start, functionBody.end) : fileContent}
            saving={saving}
            onChange={updateCodeEditor}
            onSave={() => void handleApplyToFileAndWireUi()}
          />

          <div
            style={{
              padding: 9,
              background: 'var(--bg-header)',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              gap: 6,
            }}
          >
            <button
              type="button"
              className="studio-btn sm primary"
              style={{ flex: 1, justifyContent: 'center', height: 28, fontWeight: 700 }}
              disabled={saving || !sheet}
              onClick={() => void handleApplyToFileAndWireUi()}
            >
              <Zap size={12} />
              <span>✓ Applica su {draftRule.targetFileRelPath}</span>
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};
