import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Code2,
  GitBranch,
  Plus,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import {
  compileStateOverrideToCssDeclarations,
  mergeCascadedNodeSpecs,
  parseCssEditsToPatchOps,
  sanitizeCssClassSlug,
} from '@shared/css-sync-engine';
import { buildTokenLookupMap } from '@shared/default-tokens';
import { extractScriptFunctions, type ScriptFunctionSig } from '@shared/script-ir';
import type {
  EventActionBinding,
  EventTriggerType,
  HtmxExtensionSpec,
  HtmxSwapMode,
  InteractiveStateKey,
  LayoutSpec,
  SemanticTag,
  StyleSpec,
  TypographySpec,
} from '@shared/ui-ir';
import { useStudioStore } from '@renderer/state/studio-store';
import {
  BackgroundGradientSection,
  BorderShadowSection,
  BoxModelSection,
  ClassAndStateBar,
  EffectsTransformTransitionSection,
  FlexGridMatrixSection,
  SizingPositionSection,
  TypographyProSection,
  type InspectorSectionProps,
} from './inspector';

const SEMANTIC_TAGS: SemanticTag[] = [
  'div', 'section', 'header', 'footer', 'nav', 'main', 'aside', 'article',
  'form', 'button', 'a', 'input', 'textarea', 'select', 'label',
  'h1', 'h2', 'h3', 'h4', 'p', 'span', 'ul', 'li', 'table', 'dialog', 'window',
];

const HTMX_SWAPS: HtmxSwapMode[] = [
  'innerHTML', 'outerHTML', 'beforeend', 'afterbegin', 'beforebegin', 'afterend', 'delete', 'none', 'morph:outerHTML',
];

const EVENT_TRIGGERS: EventTriggerType[] = [
  'onClick',
  'onDoubleClick',
  'onSubmit',
  'onChange',
  'onInput',
  'onMount',
  'onHover',
  'onMouseLeave',
  'onFocus',
  'onBlur',
  'onKeyDown',
  'onInterval',
];

const BLUEPRINT_EVENT_PRESETS = [
  'OnButtonClicked',
  'OnFormSubmit',
  'OnValueChanged',
  'OnMountInit',
];

export const PropertyInspectorPanel: React.FC = () => {
  const [subTab, setSubTab] = useState<'layout' | 'style' | 'interactions'>('layout');
  const [cssStateScope, setCssStateScope] = useState<'base' | InteractiveStateKey>('base');
  const [editingClassName, setEditingClassName] = useState<string | null>(null);
  const [inlineCssDraft, setInlineCssDraft] = useState<string>('');
  const [selectedTrigger, setSelectedTrigger] = useState<EventTriggerType>('onClick');
  const [bpEventName, setBpEventName] = useState<string>('OnButtonClicked');

  const project = useStudioStore((s) => s.project);
  const activeSheetId = useStudioStore((s) => s.activeSheetId);
  const sheetDocuments = useStudioStore((s) => s.sheetDocuments);
  const selectedNodeIds = useStudioStore((s) => s.selectedNodeIds);
  const tokens = useStudioStore((s) => s.tokens);
  const vfsTree = useStudioStore((s) => s.vfsTree);
  const sourceFiles = useStudioStore((s) => s.sourceFiles);
  const blueprintGraphs = useStudioStore((s) => s.blueprintGraphs);
  const activeBlueprintId = useStudioStore((s) => s.activeBlueprintId);
  const threeScenes = useStudioStore((s) => s.threeScenes);
  const activeThreeSceneId = useStudioStore((s) => s.activeThreeSceneId);
  const simulatedCanvasState = useStudioStore((s) => s.simulatedCanvasState);

  const commitOps = useStudioStore((s) => s.commitOps);
  const upsertReusableCssClass = useStudioStore((s) => s.upsertReusableCssClass);
  const setSimulatedCanvasState = useStudioStore((s) => s.setSimulatedCanvasState);
  const setActiveAutomationId = useStudioStore((s) => s.setActiveAutomationId);
  const createAndBindScriptFunctionForNode = useStudioStore((s) => s.createAndBindScriptFunctionForNode);
  const ensureActiveBlueprintGraph = useStudioStore((s) => s.ensureActiveBlueprintGraph);
  const openSplitMode = useStudioStore((s) => s.openSplitMode);
  const pushToast = useStudioStore((s) => s.pushToast);

  const sheet = sheetDocuments[activeSheetId];
  const node = useMemo(() => {
    if (!sheet) return null;
    const id = selectedNodeIds[0] ?? sheet.rootIds[0];
    return id ? sheet.nodes[id] : null;
  }, [sheet, selectedNodeIds]);

  const tokenMap = useMemo(
    () => buildTokenLookupMap(tokens, project?.activeThemeId ?? null),
    [tokens, project?.activeThemeId],
  );

  // Sync local cssStateScope if simulatedCanvasState was toggled externally
  useEffect(() => {
    setCssStateScope(simulatedCanvasState);
  }, [simulatedCanvasState]);

  // Reset inline reusable class editing if selected node no longer carries that class
  useEffect(() => {
    if (!node || !editingClassName) return;
    const attached = node.classNames ?? node.style.classNames ?? [];
    if (!attached.includes(editingClassName)) {
      setEditingClassName(null);
    }
  }, [node?.id, node?.classNames, editingClassName]);

  const editingReusableClass = useMemo(() => {
    if (!sheet || !editingClassName) return null;
    return (
      (sheet.reusableClasses ?? []).find((rc) => sanitizeCssClassSlug(rc.name) === editingClassName) ?? null
    );
  }, [sheet, editingClassName]);

  const cascaded = useMemo(() => {
    if (!node || !sheet) return null;
    return mergeCascadedNodeSpecs(node, sheet.reusableClasses, cssStateScope);
  }, [node, sheet, cssStateScope]);

  // Parse all exported/top-level functions from project .ts / .js / .py script files
  const parsedScriptFunctions = useMemo(() => {
    const out: Array<{ vfsEntryId: string; fileName: string; fn: ScriptFunctionSig }> = [];
    for (const entry of vfsTree) {
      if (entry.entryKind === 'script_file' || /\.(ts|js)$/i.test(entry.name)) {
        const content = sourceFiles[entry.id];
        if (!content) continue;
        const fns = extractScriptFunctions(content);
        for (const fn of fns) {
          out.push({ vfsEntryId: entry.id, fileName: entry.name, fn });
        }
      }
    }
    return out;
  }, [vfsTree, sourceFiles]);

  // Sync inlineCssDraft when selected node or CSS state scope changes
  useEffect(() => {
    if (!node) return;
    if (cssStateScope === 'base') {
      setInlineCssDraft(node.style.customCss ?? '');
    } else {
      const ov = node.stateOverrides?.[cssStateScope];
      if (!ov) {
        setInlineCssDraft('');
      } else {
        const decls = compileStateOverrideToCssDeclarations(ov, { tokenMap, emitTokenVars: false });
        setInlineCssDraft(decls.join('\n'));
      }
    }
  }, [node?.id, node?.style.customCss, node?.stateOverrides, cssStateScope, tokenMap]);

  if (!sheet || !node || !cascaded) {
    return (
      <div className="inspector-panel" data-testid="property-inspector-panel" style={{ padding: 14, color: 'var(--text-muted)' }}>
        Seleziona un elemento nel Canvas per modificarne proprietà, stile e binding.
      </div>
    );
  }

  // Unified patch routing: edits either ReusableCssClass, Node Pseudo-State, or Node Base!
  const applyLayoutPatch = (patch: Partial<LayoutSpec>, label: string) => {
    if (editingReusableClass) {
      if (cssStateScope === 'base') {
        void upsertReusableCssClass({
          ...editingReusableClass,
          layout: { ...(editingReusableClass.layout ?? {}), ...patch },
        });
      } else {
        const states = { ...(editingReusableClass.stateOverrides ?? editingReusableClass.states ?? {}) };
        states[cssStateScope] = {
          ...(states[cssStateScope] ?? {}),
          layout: { ...(states[cssStateScope]?.layout ?? {}), ...patch },
        };
        void upsertReusableCssClass({ ...editingReusableClass, stateOverrides: states, states });
      }
      return;
    }

    if (cssStateScope !== 'base') {
      const prevOv = node.stateOverrides?.[cssStateScope] ?? {};
      void commitOps(
        [
          {
            op: 'update_node',
            id: node.id,
            stateOverrides: {
              ...(node.stateOverrides ?? {}),
              [cssStateScope]: {
                ...prevOv,
                layout: { ...(prevOv.layout ?? {}), ...patch },
              },
            },
          },
        ],
        `${label} (:${cssStateScope})`,
      );
      return;
    }

    void commitOps([{ op: 'update_node', id: node.id, layout: patch }], label);
  };

  const applyStylePatch = (patch: Partial<StyleSpec>, label: string) => {
    if (editingReusableClass) {
      if (cssStateScope === 'base') {
        void upsertReusableCssClass({
          ...editingReusableClass,
          style: { ...(editingReusableClass.style ?? {}), ...patch },
        });
      } else {
        const states = { ...(editingReusableClass.stateOverrides ?? editingReusableClass.states ?? {}) };
        states[cssStateScope] = {
          ...(states[cssStateScope] ?? {}),
          style: { ...(states[cssStateScope]?.style ?? {}), ...patch },
        };
        void upsertReusableCssClass({ ...editingReusableClass, stateOverrides: states, states });
      }
      return;
    }

    if (cssStateScope !== 'base') {
      const prevOv = node.stateOverrides?.[cssStateScope] ?? {};
      void commitOps(
        [
          {
            op: 'update_node',
            id: node.id,
            stateOverrides: {
              ...(node.stateOverrides ?? {}),
              [cssStateScope]: {
                ...prevOv,
                style: { ...(prevOv.style ?? {}), ...patch },
              },
            },
          },
        ],
        `${label} (:${cssStateScope})`,
      );
      return;
    }

    void commitOps([{ op: 'update_node', id: node.id, style: patch }], label);
  };

  const applyTypographyPatch = (patch: Partial<TypographySpec>, label: string) => {
    if (editingReusableClass) {
      if (cssStateScope === 'base') {
        void upsertReusableCssClass({
          ...editingReusableClass,
          typography: { ...(editingReusableClass.typography ?? {}), ...patch },
        });
      } else {
        const states = { ...(editingReusableClass.stateOverrides ?? editingReusableClass.states ?? {}) };
        states[cssStateScope] = {
          ...(states[cssStateScope] ?? {}),
          typography: { ...(states[cssStateScope]?.typography ?? {}), ...patch },
        };
        void upsertReusableCssClass({ ...editingReusableClass, stateOverrides: states, states });
      }
      return;
    }

    if (cssStateScope !== 'base') {
      const prevOv = node.stateOverrides?.[cssStateScope] ?? {};
      void commitOps(
        [
          {
            op: 'update_node',
            id: node.id,
            stateOverrides: {
              ...(node.stateOverrides ?? {}),
              [cssStateScope]: {
                ...prevOv,
                typography: { ...(prevOv.typography ?? {}), ...patch },
              },
            },
          },
        ],
        `${label} (:${cssStateScope})`,
      );
      return;
    }

    void commitOps(
      [
        {
          op: 'update_node',
          id: node.id,
          typography: {
            fontFamily: { $token: 'font.sans' },
            fontSize: 15,
            fontWeight: 400,
            color: { $token: 'color.text.primary' },
            ...(node.typography ?? {}),
            ...patch,
          },
        },
      ],
      label,
    );
  };

  const handleResetCurrentState = () => {
    if (cssStateScope === 'base') return;
    if (editingReusableClass) {
      const states = { ...(editingReusableClass.stateOverrides ?? editingReusableClass.states ?? {}) };
      delete states[cssStateScope];
      void upsertReusableCssClass({ ...editingReusableClass, stateOverrides: states, states });
      return;
    }
    const nextOverrides = { ...(node.stateOverrides ?? {}) };
    delete nextOverrides[cssStateScope];
    void commitOps(
      [{ op: 'update_node', id: node.id, stateOverrides: nextOverrides }],
      `Reset :${cssStateScope}`,
    );
  };

  const applyInlineCssDraft = async (rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed) {
      if (cssStateScope === 'base') {
        await commitOps([{ op: 'update_node', id: node.id, style: { customCss: '' } }], 'Pulisci CSS inline');
      } else {
        handleResetCurrentState();
      }
      return;
    }

    const wrappedSelector = cssStateScope === 'base' ? `#${node.id}` : `#${node.id}:${cssStateScope}`;
    const wrappedCss = trimmed.includes('{') ? trimmed : `/* @node ${node.id} */\n${wrappedSelector} {\n  ${trimmed}\n}`;
    const parsed = parseCssEditsToPatchOps(wrappedCss, sheet, node.id);
    if (parsed.ops.length > 0) {
      await commitOps(parsed.ops, `CSS Inline (${cssStateScope})`, 'code_sync');
      pushToast('success', `CSS ${cssStateScope === 'base' ? 'Base' : ':' + cssStateScope} applicato a ${node.name}`);
    }
  };

  const sharedSectionProps: InspectorSectionProps = {
    node,
    sheet,
    tokens,
    tokenMap,
    activeState: cssStateScope,
    editingReusableClass,
    effectiveLayout: cascaded.layout,
    effectiveStyle: cascaded.style,
    effectiveTypography: cascaded.typography,
    applyLayoutPatch,
    applyStylePatch,
    applyTypographyPatch,
  };

  const allSheetNodes = Object.values(sheet.nodes);
  const blueprintList = Object.values(blueprintGraphs);
  const threeSceneList = Object.values(threeScenes);
  const nodeAutomations = (sheet.automations ?? []).filter((a) => a.trigger.sourceNodeId === node.id);

  const htmx: HtmxExtensionSpec = node.platform?.htmx ?? {
    method: 'hx-get',
    endpoint: '/api/items',
    hxSwap: 'innerHTML',
  };

  const mvvmPropKey = Object.keys(node.platform?.mvvm?.bindings ?? {})[0] ?? 'Text';
  const mvvmBinding = node.platform?.mvvm?.bindings?.[mvvmPropKey];
  const nodeInteractions: EventActionBinding[] = node.interactions ?? [];

  const currentScriptBindingForTrigger = nodeInteractions.find(
    (b) => b.trigger === selectedTrigger && b.action.kind === 'call_script_fn',
  );
  const currentBpBindingForTrigger = nodeInteractions.find(
    (b) => b.trigger === selectedTrigger && b.action.kind === 'trigger_blueprint',
  );

  const handleBindScriptFn = async (encodedValue: string) => {
    if (!encodedValue) {
      const remaining = nodeInteractions.filter(
        (b) => !(b.trigger === selectedTrigger && b.action.kind === 'call_script_fn'),
      );
      await commitOps([{ op: 'set_interaction', id: node.id, interactions: remaining }], 'Rimuovi funzione script');
      return;
    }
    const [vfsEntryId, fnName] = encodedValue.split('::');
    if (!fnName) return;
    const remaining = nodeInteractions.filter(
      (b) => !(b.trigger === selectedTrigger && b.action.kind === 'call_script_fn'),
    );
    await commitOps(
      [
        {
          op: 'set_interaction',
          id: node.id,
          interactions: [
            ...remaining,
            {
              trigger: selectedTrigger,
              action: { kind: 'call_script_fn', vfsEntryId: vfsEntryId || undefined, fnName },
            },
          ],
        },
      ],
      `Collega ${selectedTrigger} -> ${fnName}()`,
    );
    pushToast('success', `Evento ${selectedTrigger} collegato a ${fnName}()`);
  };

  const handleBindBlueprintEvent = async () => {
    const ensured = await ensureActiveBlueprintGraph();
    const targetBpId = activeBlueprintId ?? ensured.graph.id;
    const cleanEvent = bpEventName.trim() || 'OnButtonClicked';
    const remaining = nodeInteractions.filter(
      (b) => !(b.trigger === selectedTrigger && b.action.kind === 'trigger_blueprint'),
    );
    await commitOps(
      [
        {
          op: 'set_interaction',
          id: node.id,
          interactions: [
            ...remaining,
            {
              trigger: selectedTrigger,
              action: { kind: 'trigger_blueprint', blueprintId: targetBpId, eventName: cleanEvent },
            },
          ],
        },
      ],
      `Collega ${selectedTrigger} -> Blueprint:${cleanEvent}`,
    );
    pushToast('success', `Evento ${selectedTrigger} collegato al nodo Blueprint "${cleanEvent}"!`);
  };

  const handleRemoveInteractionAt = async (idx: number) => {
    const next = nodeInteractions.filter((_, i) => i !== idx);
    await commitOps([{ op: 'set_interaction', id: node.id, interactions: next }], 'Rimuovi binding evento');
  };

  return (
    <div className="inspector-panel" data-testid="property-inspector-panel">
      {/* Selected Node Header + Sub-tabs */}
      <div
        style={{
          padding: '7px 10px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 5 }}>
          <input
            className="studio-input"
            data-testid="inspector-node-name"
            style={{ fontWeight: 700, flex: 1, height: 24, minWidth: 0 }}
            value={node.name}
            onChange={(e) => void commitOps([{ op: 'update_node', id: node.id, name: e.target.value }], 'Rinomina nodo')}
          />
          <select
            className="studio-select"
            style={{ width: 76, height: 24, padding: '0 4px', fontSize: 10.5 }}
            value={node.semanticTag}
            onChange={(e) =>
              void commitOps(
                [{ op: 'update_node', id: node.id, semanticTag: e.target.value as SemanticTag }],
                'Tag HTML',
              )
            }
            title="Tag semantico HTML"
          >
            {SEMANTIC_TAGS.map((tag) => (
              <option key={tag} value={tag}>
                &lt;{tag}&gt;
              </option>
            ))}
          </select>
          <span className="badge blue">{node.kind}</span>
        </div>

        <div className="segmented-group" style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <button
            type="button"
            className={`segmented-item ${subTab === 'layout' ? 'active' : ''}`}
            data-testid="inspector-tab-layout"
            onClick={() => setSubTab('layout')}
          >
            Layout
          </button>
          <button
            type="button"
            className={`segmented-item ${subTab === 'style' ? 'active' : ''}`}
            data-testid="inspector-tab-style"
            onClick={() => setSubTab('style')}
          >
            Stile
          </button>
          <button
            type="button"
            className={`segmented-item ${subTab === 'interactions' ? 'active' : ''}`}
            data-testid="inspector-tab-interactions"
            onClick={() => setSubTab('interactions')}
          >
            Interazioni
          </button>
        </div>
      </div>

      {/* Section 1: Persistent Reusable CSS Classes & Live Pseudo-State Bar */}
      {subTab !== 'interactions' && (
        <ClassAndStateBar
          node={node}
          sheet={sheet}
          activeState={cssStateScope}
          onChangeState={(st) => {
            setCssStateScope(st);
            setSimulatedCanvasState(st);
          }}
          editingClassName={editingClassName}
          onChangeEditingClassName={setEditingClassName}
          onResetCurrentState={handleResetCurrentState}
        />
      )}

      <div className="inspector-scroll">
        {/* ==================== TAB 1: PRO LAYOUT, BOX MODEL, SIZING & FLEX/GRID ==================== */}
        {subTab === 'layout' && (
          <>
            <BoxModelSection {...sharedSectionProps} />
            <FlexGridMatrixSection {...sharedSectionProps} />
            <SizingPositionSection {...sharedSectionProps} />

            {node.content?.controlType === 'three-viewport' && (
              <div className="prop-group">
                <div className="prop-group-title">
                  <span>🧊 Scena Three.js 3D</span>
                  <button
                    type="button"
                    className="studio-btn sm primary"
                    onClick={() => openSplitMode('three-studio')}
                  >
                    <Box size={11} />
                    <span>Studio 3D</span>
                  </button>
                </div>
                <div className="prop-row">
                  <span className="prop-label">Scena Attiva</span>
                  <select
                    className="studio-select"
                    value={node.content?.threeSceneId ?? activeThreeSceneId ?? ''}
                    onChange={(e) =>
                      void commitOps(
                        [
                          {
                            op: 'update_node',
                            id: node.id,
                            content: { ...node.content, threeSceneId: e.target.value || undefined },
                          },
                        ],
                        'Collega scena 3D',
                      )
                    }
                  >
                    {threeSceneList.map((sc) => (
                      <option key={sc.id} value={sc.id}>
                        {sc.name} ({sc.objects.length} oggetti)
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </>
        )}

        {/* ==================== TAB 2: PRO STILE, GRADIENTI, BORDI, TIPOGRAFIA & EFFETTI ==================== */}
        {subTab === 'style' && (
          <>
            <BackgroundGradientSection {...sharedSectionProps} />
            <BorderShadowSection {...sharedSectionProps} />
            <TypographyProSection {...sharedSectionProps} />
            <EffectsTransformTransitionSection
              {...sharedSectionProps}
              inlineCssDraft={inlineCssDraft}
              onChangeInlineCssDraft={setInlineCssDraft}
              onApplyInlineCssDraft={(val) => void applyInlineCssDraft(val)}
              onChangeActiveState={(st) => {
                setCssStateScope(st);
                setSimulatedCanvasState(st);
              }}
            />
          </>
        )}

        {/* ==================== TAB 3: INTERAZIONI, AUTOMAZIONI NO-CODE, SCRIPT & BLUEPRINT ==================== */}
        {subTab === 'interactions' && (
          <>
            {/* v3.0 No-Code Visual Automation Studio Quick Card */}
            <div className="prop-group" data-testid="inspector-nocode-automation-card">
              <div className="prop-group-title">
                <span>✨ Automazioni Visuali Senza Codice</span>
              </div>
              <p style={{ margin: '0 0 7px', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                Crea funzioni JS / TS / Python complete (validazione form, fetch API, query SQL, cambio classi CSS) tramite menu guidati.
              </p>

              {nodeAutomations.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 7 }}>
                  {nodeAutomations.map((auto) => (
                    <button
                      key={auto.id}
                      type="button"
                      className="studio-btn sm"
                      style={{ justifyContent: 'space-between', width: '100%' }}
                      onClick={() => {
                        setActiveAutomationId(auto.id);
                        openSplitMode('split-automation');
                      }}
                    >
                      <span>⚡ {auto.name}</span>
                      <span className="badge blue">{auto.trigger.type}</span>
                    </button>
                  ))}
                </div>
              )}

              <button
                type="button"
                className="studio-btn sm primary"
                data-testid="btn-inspector-open-automation"
                style={{ width: '100%' }}
                onClick={() => openSplitMode('split-automation')}
              >
                <Sparkles size={11} />
                <span>⚡ Apri Visual Automation Studio</span>
              </button>
            </div>

            {/* Eventi Script (JS/TS/Py) & Unreal Blueprint */}
            <div className="prop-group" data-testid="inspector-script-blueprint-section">
              <div className="prop-group-title">
                <span>⚡ Eventi Script (JS/TS) &amp; Blueprint</span>
                <span className="badge blue">Code</span>
              </div>

              <div className="prop-row">
                <span className="prop-label">Trigger UI</span>
                <select
                  className="studio-select"
                  data-testid="inspector-event-trigger-select"
                  value={selectedTrigger}
                  onChange={(e) => setSelectedTrigger(e.target.value as EventTriggerType)}
                >
                  {EVENT_TRIGGERS.map((tr) => (
                    <option key={tr} value={tr}>
                      {tr}
                    </option>
                  ))}
                </select>
              </div>

              {/* JS / TS Script Function Binding */}
              <div
                style={{
                  padding: 7,
                  borderRadius: 6,
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  marginBottom: 7,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, fontWeight: 600 }}>
                  <span>📜 Funzione Script TS / JS</span>
                  <button
                    type="button"
                    className="studio-btn sm ghost"
                    onClick={() => openSplitMode('split-script')}
                    title="Apri Script Workbench TS/JS"
                    style={{ height: 20, padding: '0 6px' }}
                  >
                    <Code2 size={11} />
                    <span>Apri Script</span>
                  </button>
                </div>

                <select
                  className="studio-select"
                  data-testid="inspector-script-fn-select"
                  value={
                    currentScriptBindingForTrigger && currentScriptBindingForTrigger.action.kind === 'call_script_fn'
                      ? `${currentScriptBindingForTrigger.action.vfsEntryId ?? ''}::${currentScriptBindingForTrigger.action.fnName}`
                      : ''
                  }
                  onChange={(e) => void handleBindScriptFn(e.target.value)}
                >
                  <option value="">(Nessuna funzione collegata su {selectedTrigger})</option>
                  {parsedScriptFunctions.map((item) => (
                    <option
                      key={`${item.vfsEntryId}::${item.fn.name}`}
                      value={`${item.vfsEntryId}::${item.fn.name}`}
                    >
                      {item.fn.name}() — {item.fileName}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  className="studio-btn sm primary"
                  data-testid="btn-create-bind-ts-fn"
                  style={{ width: '100%' }}
                  onClick={() => void createAndBindScriptFunctionForNode(node.id, selectedTrigger)}
                >
                  <Plus size={11} />
                  <span>+ Crea Funzione TS ({selectedTrigger})</span>
                </button>
              </div>

              {/* Unreal-Style Blueprint Event Binding */}
              <div
                style={{
                  padding: 7,
                  borderRadius: 6,
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, fontWeight: 600 }}>
                  <span>🔵 Evento Visual Blueprint</span>
                  {blueprintList.length > 0 && (
                    <span className="badge violet">{blueprintList[0].name}</span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 4 }}>
                  <input
                    className="studio-input"
                    data-testid="inspector-blueprint-event-input"
                    list="blueprint-events-datalist"
                    style={{ flex: 1 }}
                    placeholder="es. OnButtonClicked"
                    value={
                      currentBpBindingForTrigger && currentBpBindingForTrigger.action.kind === 'trigger_blueprint'
                        ? currentBpBindingForTrigger.action.eventName
                        : bpEventName
                    }
                    onChange={(e) => setBpEventName(e.target.value)}
                  />
                  <datalist id="blueprint-events-datalist">
                    {BLUEPRINT_EVENT_PRESETS.map((evName) => (
                      <option key={evName} value={evName} />
                    ))}
                  </datalist>
                  <button
                    type="button"
                    className="studio-btn sm"
                    data-testid="btn-bind-blueprint-event"
                    onClick={() => void handleBindBlueprintEvent()}
                  >
                    Collega
                  </button>
                </div>

                <button
                  type="button"
                  className="studio-btn sm violet"
                  data-testid="btn-open-in-blueprint"
                  style={{ width: '100%' }}
                  onClick={() => {
                    void ensureActiveBlueprintGraph();
                    openSplitMode('split-blueprint');
                  }}
                >
                  <Zap size={11} />
                  <span>⚡ Apri nel Blueprint</span>
                </button>
              </div>

              {/* Active Event Bindings Summary */}
              {nodeInteractions.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    Eventi Attivi sul Nodo ({nodeInteractions.length})
                  </div>
                  {nodeInteractions.map((binding, idx) => {
                    const desc =
                      binding.action.kind === 'call_script_fn'
                        ? `Fn: ${binding.action.fnName}()`
                        : binding.action.kind === 'trigger_blueprint'
                          ? `BP: ${binding.action.eventName}`
                          : binding.action.kind;
                    return (
                      <div
                        key={`${binding.trigger}_${idx}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 6,
                          padding: '3px 7px',
                          borderRadius: 5,
                          background: 'var(--bg-input)',
                          border: '1px solid var(--border-subtle)',
                          fontSize: 11,
                        }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                          <GitBranch size={11} color="var(--accent-primary)" />
                          <strong>{binding.trigger}</strong>
                          <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            → {desc}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="row-icon-btn"
                          title="Rimuovi binding"
                          onClick={() => void handleRemoveInteractionAt(idx)}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* HTMX Hypermedia */}
            <div className="prop-group">
              <div className="prop-group-title">
                <span>⚡ HTMX Hypermedia</span>
                <span className="badge green">hx-*</span>
              </div>

              <div className="prop-row">
                <span className="prop-label">Metodo</span>
                <select
                  className="studio-select"
                  value={htmx.method}
                  onChange={(e) =>
                    void commitOps(
                      [
                        {
                          op: 'set_interaction',
                          id: node.id,
                          htmx: { ...htmx, method: e.target.value as HtmxExtensionSpec['method'] },
                        },
                      ],
                      'Metodo HTMX',
                    )
                  }
                >
                  <option value="hx-get">hx-get</option>
                  <option value="hx-post">hx-post</option>
                  <option value="hx-put">hx-put</option>
                  <option value="hx-patch">hx-patch</option>
                  <option value="hx-delete">hx-delete</option>
                </select>
              </div>

              <div className="prop-row">
                <span className="prop-label">Endpoint</span>
                <input
                  className="studio-input"
                  placeholder="/api/products/search"
                  value={node.platform?.htmx?.endpoint ?? ''}
                  onChange={(e) =>
                    void commitOps(
                      [{ op: 'set_interaction', id: node.id, htmx: { ...htmx, endpoint: e.target.value } }],
                      'Endpoint HTMX',
                    )
                  }
                />
              </div>

              <div className="prop-row">
                <span className="prop-label">Target Nodo</span>
                <select
                  className="studio-select"
                  data-testid="htmx-target-node-select"
                  value={node.platform?.htmx?.targetNodeId ?? ''}
                  onChange={(e) =>
                    void commitOps(
                      [
                        {
                          op: 'set_interaction',
                          id: node.id,
                          htmx: { ...htmx, targetNodeId: e.target.value || undefined },
                        },
                      ],
                      'Target HTMX',
                    )
                  }
                >
                  <option value="">(Self / Nessuno)</option>
                  {allSheetNodes.map((sn) => (
                    <option key={sn.id} value={sn.id}>
                      #{sn.name} ({sn.kind})
                    </option>
                  ))}
                </select>
              </div>

              <div className="prop-row">
                <span className="prop-label">hx-swap</span>
                <select
                  className="studio-select"
                  value={node.platform?.htmx?.hxSwap ?? 'innerHTML'}
                  onChange={(e) =>
                    void commitOps(
                      [
                        {
                          op: 'set_interaction',
                          id: node.id,
                          htmx: { ...htmx, hxSwap: e.target.value as HtmxSwapMode },
                        },
                      ],
                      'Swap HTMX',
                    )
                  }
                >
                  {HTMX_SWAPS.map((sw) => (
                    <option key={sw} value={sw}>
                      {sw}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* .NET MAUI / Avalonia MVVM */}
            <div className="prop-group">
              <div className="prop-group-title">
                <span>💜 .NET MAUI / MVVM</span>
                <span className="badge violet">XAML</span>
              </div>

              <div className="prop-row">
                <span className="prop-label">Bind Path</span>
                <input
                  className="studio-input"
                  placeholder="es. MonthlyRevenue"
                  value={mvvmBinding?.path ?? ''}
                  onChange={(e) =>
                    void commitOps(
                      [
                        {
                          op: 'set_interaction',
                          id: node.id,
                          mvvm: {
                            ...(node.platform?.mvvm ?? {}),
                            bindings: {
                              [mvvmPropKey]: { path: e.target.value, mode: mvvmBinding?.mode ?? 'TwoWay' },
                            },
                          },
                        },
                      ],
                      'Binding MVVM',
                    )
                  }
                />
              </div>

              <div className="prop-row">
                <span className="prop-label">RelayCommand</span>
                <input
                  className="studio-input"
                  placeholder="es. SaveOrderCommand"
                  value={node.platform?.mvvm?.command?.path ?? ''}
                  onChange={(e) =>
                    void commitOps(
                      [
                        {
                          op: 'set_interaction',
                          id: node.id,
                          mvvm: {
                            ...(node.platform?.mvvm ?? {}),
                            command: e.target.value ? { path: e.target.value } : undefined,
                          },
                        },
                      ],
                      'RelayCommand MVVM',
                    )
                  }
                />
              </div>
            </div>

            {/* Desktop Window & A11y */}
            <div className="prop-group">
              <div className="prop-group-title">🖥️ Desktop Window &amp; A11y</div>

              <div className="prop-row">
                <span className="prop-label">Frameless</span>
                <input
                  type="checkbox"
                  checked={Boolean(node.platform?.desktopWindow?.frameless)}
                  onChange={(e) =>
                    void commitOps(
                      [
                        {
                          op: 'update_node',
                          id: node.id,
                          platform: {
                            desktopWindow: {
                              ...(node.platform?.desktopWindow ?? {}),
                              frameless: e.target.checked,
                            },
                          },
                        },
                      ],
                      'Frameless window',
                    )
                  }
                />
              </div>

              <div className="prop-row">
                <span className="prop-label">Drag Region</span>
                <select
                  className="studio-select"
                  value={String(node.platform?.desktopWindow?.dragRegion ?? 'none')}
                  onChange={(e) =>
                    void commitOps(
                      [
                        {
                          op: 'update_node',
                          id: node.id,
                          platform: {
                            desktopWindow: {
                              ...(node.platform?.desktopWindow ?? {}),
                              dragRegion:
                                e.target.value === 'none'
                                  ? undefined
                                  : (e.target.value as 'drag' | 'no-drag'),
                            },
                          },
                        },
                      ],
                      'Drag region',
                    )
                  }
                >
                  <option value="none">Default</option>
                  <option value="drag">drag (Titlebar)</option>
                  <option value="no-drag">no-drag (Controlli)</option>
                </select>
              </div>

              <div className="prop-row">
                <span className="prop-label">Backdrop</span>
                <select
                  className="studio-select"
                  value={node.platform?.desktopWindow?.backdrop ?? 'none'}
                  onChange={(e) =>
                    void commitOps(
                      [
                        {
                          op: 'update_node',
                          id: node.id,
                          platform: {
                            desktopWindow: {
                              ...(node.platform?.desktopWindow ?? {}),
                              backdrop: e.target.value as 'none' | 'mica' | 'acrylic' | 'vibrancy',
                            },
                          },
                        },
                      ],
                      'Backdrop finestra',
                    )
                  }
                >
                  <option value="none">None</option>
                  <option value="mica">Windows Mica</option>
                  <option value="acrylic">Acrylic Blur</option>
                  <option value="vibrancy">macOS Vibrancy</option>
                </select>
              </div>

              <div className="prop-row">
                <span className="prop-label">aria-label</span>
                <input
                  className="studio-input"
                  placeholder="Descrizione accessibile..."
                  value={node.platform?.a11y?.ariaLabel ?? ''}
                  onChange={(e) =>
                    void commitOps(
                      [
                        {
                          op: 'update_node',
                          id: node.id,
                          platform: {
                            a11y: { ...(node.platform?.a11y ?? {}), ariaLabel: e.target.value },
                          },
                        },
                      ],
                      'ARIA label',
                    )
                  }
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
