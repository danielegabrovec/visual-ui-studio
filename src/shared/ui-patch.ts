import type {
  AutomationRule,
  ControlFlowSpec,
  EventActionBinding,
  GridTrackSpec,
  HtmxExtensionSpec,
  InteractiveStateKey,
  LayoutSpec,
  LinkedScriptModuleRef,
  MvvmExtensionSpec,
  NodeContentSpec,
  NodeId,
  PlatformExtensions,
  ReusableCssClass,
  SemanticTag,
  StateOverrideSpec,
  StyleSpec,
  TypographySpec,
  UIControlSubtype,
  UINode,
  UINodeKind,
  UIRIpcCommandSpec,
  UISheetDocument,
  UISheetStateSpec,
} from './ui-ir';

// ============================================================================
// CANONICAL ATOMIC CANVAS PATCH PROTOCOL (Undo/Redo + AI + Layout Solver)
// ============================================================================

export type UIPatchOp =
  | {
      op: 'insert_node';
      parentId: NodeId | null;
      index?: number;
      node: Partial<UINode> & Pick<UINode, 'kind' | 'name'> & { id?: NodeId };
    }
  | {
      op: 'update_node';
      id: NodeId;
      name?: string;
      semanticTag?: SemanticTag;
      visible?: boolean;
      locked?: boolean;
      classNames?: string[];
      layout?: Partial<LayoutSpec>;
      style?: Partial<StyleSpec>;
      typography?: Partial<TypographySpec>;
      content?: Partial<NodeContentSpec>;
      controlFlow?: ControlFlowSpec;
      stateOverrides?: Partial<Record<InteractiveStateKey, StateOverrideSpec>>;
      responsiveOverrides?: UINode['responsiveOverrides'];
      dataBindings?: UINode['dataBindings'];
      interactions?: EventActionBinding[];
      platform?: Partial<PlatformExtensions>;
    }
  | {
      op: 'move_node';
      id: NodeId;
      newParentId: NodeId | null;
      index: number;
    }
  | {
      op: 'wrap_container';
      targetNodeIds: NodeId[];
      wrapperId?: NodeId;
      wrapperName?: string;
      mode?: 'flex' | 'grid' | 'freeform';
      direction?: 'row' | 'column';
      gap?: number;
      padding?: number;
      gridCols?: GridTrackSpec[];
      gridRows?: GridTrackSpec[];
      presetStyle?: 'plain' | 'card' | 'glass';
    }
  | {
      op: 'ungroup_container';
      id: NodeId;
    }
  | {
      op: 'delete_node';
      id: NodeId;
    }
  | {
      op: 'bind_token';
      id: NodeId;
      propertyPath: string; // e.g. "style.fills.0.color", "layout.gap", "style.radius", "typography.color"
      tokenPath: string; // e.g. "color.primary.500", "space.4"
    }
  | {
      op: 'convert_auto_layout';
      id: NodeId;
      direction: 'row' | 'column' | 'grid';
      gap?: number;
      padding?: number;
      justify?: LayoutSpec['justify'];
      align?: LayoutSpec['align'];
      gridCols?: LayoutSpec['gridCols'];
      gridRows?: LayoutSpec['gridRows'];
    }
  | {
      op: 'set_interaction';
      id: NodeId;
      interactions?: EventActionBinding[];
      htmx?: HtmxExtensionSpec;
      mvvm?: MvvmExtensionSpec;
    }
  | {
      op: 'update_sheet_meta';
      customCss?: string;
      keyframesCss?: string;
      reusableClasses?: ReusableCssClass[];
      linkedScripts?: LinkedScriptModuleRef[];
      automations?: AutomationRule[];
      codeOverrides?: UISheetDocument['codeOverrides'];
      stateSchema?: UISheetStateSpec[];
      ipcSchema?: UIRIpcCommandSpec[];
      defaultLayoutMode?: 'freeform' | 'flex';
    };

// ============================================================================
// SMALL-LLM COMPACT SHORTCODE AST (7B–32B JSON Schema Friendly)
// ============================================================================

export interface AICompactNode {
  id?: string;
  kind: UINodeKind;
  name: string;
  tag?: SemanticTag;
  text?: string;
  placeholder?: string;
  iconName?: string;
  controlType?: UIControlSubtype;
  threeSceneId?: string;
  blueprintId?: string;
  layoutMode?: 'flex' | 'grid' | 'stack' | 'freeform';
  positioning?: LayoutSpec['positioning'];
  direction?: 'row' | 'column';
  gap?: number;
  padding?: number;
  justify?: LayoutSpec['justify'];
  align?: LayoutSpec['align'];
  widthMode?: 'fixed' | 'hug' | 'fill' | 'percentage';
  heightMode?: 'fixed' | 'hug' | 'fill' | 'percentage';
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  zIndex?: number;
  bg?: string;
  textColor?: string;
  fontSize?: number;
  fontWeight?: number | string;
  radius?: number;
  borderColor?: string;
  customCss?: string;
  htmx?: HtmxExtensionSpec;
  mvvmBinding?: { property: string; path: string; command?: string };
  children?: AICompactNode[];
}

export type AICompactPatchOp =
  | { op: 'insert_tree'; parentId: NodeId | null; index?: number; tree: AICompactNode }
  | {
      op: 'update_props';
      nodeId: NodeId;
      name?: string;
      text?: string;
      direction?: 'row' | 'column';
      gap?: number;
      padding?: number;
      bg?: string;
      textColor?: string;
      fontSize?: number;
      radius?: number;
      widthMode?: 'fixed' | 'hug' | 'fill';
      heightMode?: 'fixed' | 'hug' | 'fill';
      width?: number;
      height?: number;
    }
  | {
      op: 'bind_htmx';
      nodeId: NodeId;
      method: HtmxExtensionSpec['method'];
      endpoint: string;
      targetNodeId?: string;
      hxSwap?: HtmxExtensionSpec['hxSwap'];
      hxTrigger?: string;
    }
  | { op: 'wrap_auto_layout'; targetNodeIds: NodeId[]; wrapperName?: string; direction: 'row' | 'column'; gap?: number }
  | { op: 'delete_node'; nodeId: NodeId };

let idCounter = 0;
export function generateNodeId(prefix = 'nd'): NodeId {
  idCounter = (idCounter + 1) % 1_000_000;
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${ts}_${idCounter.toString(36)}${rand}`;
}

export function fractionalOrderAt(index: number): string {
  const padded = String(Math.max(0, index) * 10 + 10).padStart(5, '0');
  return `o${padded}`;
}

export function inferDefaultSemanticTag(kind: UINodeKind, controlType?: UIControlSubtype): SemanticTag {
  if (kind === 'artboard') return 'main';
  if (kind === 'text') return 'p';
  if (kind === 'collection') return 'ul';
  if (kind === 'control') {
    switch (controlType) {
      case 'button':
      case 'icon-button':
        return 'button';
      case 'text-input':
      case 'password':
      case 'checkbox':
      case 'switch':
      case 'slider':
        return 'input';
      case 'textarea':
        return 'textarea';
      case 'select':
        return 'select';
      case 'table':
        return 'table';
      default:
        return 'div';
    }
  }
  return 'div';
}

export function createDefaultUINode(
  partial: Partial<UINode> & Pick<UINode, 'kind' | 'name'>,
  sheetId: string,
): UINode {
  const id = partial.id ?? generateNodeId(partial.kind === 'artboard' ? 'art' : 'nd');
  const isContainerLike =
    partial.kind === 'artboard' || partial.kind === 'container' || partial.kind === 'collection';

  const hasExplicitCoords =
    partial.kind !== 'artboard' &&
    ((partial.layout?.frame?.x !== undefined && partial.layout.frame.x !== 0) ||
      (partial.layout?.frame?.y !== undefined && partial.layout.frame.y !== 0));

  const defaultLayout: LayoutSpec = {
    mode: isContainerLike ? 'flex' : 'freeform',
    positioning: partial.layout?.positioning ?? (hasExplicitCoords ? 'absolute' : 'flow'),
    frame: {
      x: partial.layout?.frame?.x ?? 0,
      y: partial.layout?.frame?.y ?? 0,
      width: partial.layout?.frame?.width ?? (partial.kind === 'artboard' ? 1280 : isContainerLike ? 360 : 160),
      height: partial.layout?.frame?.height ?? (partial.kind === 'artboard' ? 840 : isContainerLike ? 200 : 44),
      rotation: partial.layout?.frame?.rotation ?? 0,
    },
    width: partial.layout?.width ?? {
      mode: partial.kind === 'artboard' ? 'fixed' : isContainerLike ? 'fill' : 'hug',
      value: partial.kind === 'artboard' ? 1280 : 160,
    },
    height: partial.layout?.height ?? {
      mode: partial.kind === 'artboard' ? 'fixed' : 'hug',
      value: partial.kind === 'artboard' ? 840 : 44,
    },
    direction: partial.layout?.direction ?? 'column',
    wrap: partial.layout?.wrap ?? false,
    justify: partial.layout?.justify ?? 'start',
    align: partial.layout?.align ?? 'stretch',
    gap: partial.layout?.gap ?? (isContainerLike ? 16 : 8),
    padding: partial.layout?.padding ?? {
      top: isContainerLike ? 16 : 8,
      right: isContainerLike ? 16 : 12,
      bottom: isContainerLike ? 16 : 8,
      left: isContainerLike ? 16 : 12,
    },
    overflow: partial.layout?.overflow ?? 'visible',
    ...(partial.layout ?? {}),
  };

  const defaultStyle: StyleSpec = {
    opacity: 1,
    fills:
      partial.style?.fills ??
      (partial.kind === 'artboard'
        ? [{ type: 'solid', color: { $token: 'color.bg.canvas' } }]
        : partial.kind === 'control' && partial.content?.controlType === 'button'
          ? [{ type: 'solid', color: { $token: 'color.primary.600' } }]
          : []),
    radius: partial.style?.radius ?? (partial.kind === 'control' || partial.kind === 'container' ? 8 : 0),
    ...(partial.style ?? {}),
  };

  const needsTypography = partial.kind === 'text' || partial.kind === 'control' || Boolean(partial.typography);
  const defaultTypography: TypographySpec | undefined = needsTypography
    ? {
        fontFamily: { $token: 'font.sans' },
        fontSize: 15,
        fontWeight: partial.kind === 'control' ? 600 : 400,
        lineHeight: 1.4,
        textAlign: partial.kind === 'control' && partial.content?.controlType === 'button' ? 'center' : 'left',
        color:
          partial.kind === 'control' && partial.content?.controlType === 'button'
            ? '#ffffff'
            : { $token: 'color.text.primary' },
        ...(partial.typography ?? {}),
      }
    : undefined;

  return {
    id,
    sheetId,
    parentId: partial.parentId ?? null,
    childIds: partial.childIds ? [...partial.childIds] : [],
    sortOrder: partial.sortOrder ?? fractionalOrderAt(0),
    kind: partial.kind,
    name: partial.name,
    semanticTag: partial.semanticTag ?? inferDefaultSemanticTag(partial.kind, partial.content?.controlType),
    visible: partial.visible ?? true,
    locked: partial.locked ?? false,
    classNames: partial.classNames ?? partial.style?.classNames ? [...(partial.classNames ?? partial.style?.classNames ?? [])] : undefined,
    layout: defaultLayout,
    style: defaultStyle,
    typography: defaultTypography,
    content: partial.content ? { ...partial.content } : undefined,
    componentRef: partial.componentRef ? { ...partial.componentRef } : undefined,
    controlFlow: partial.controlFlow ? { ...partial.controlFlow } : undefined,
    stateOverrides: partial.stateOverrides ? { ...partial.stateOverrides } : undefined,
    responsiveOverrides: partial.responsiveOverrides ? { ...partial.responsiveOverrides } : undefined,
    dataBindings: partial.dataBindings ? { ...partial.dataBindings } : undefined,
    interactions: partial.interactions ? [...partial.interactions] : undefined,
    platform: partial.platform ? { ...partial.platform } : undefined,
  };
}

export function hydrateCompactNodeToPatches(
  compact: AICompactNode,
  parentId: NodeId | null,
  sheetId: string,
  index?: number,
): UIPatchOp[] {
  const nodeId = compact.id ?? generateNodeId(compact.kind === 'artboard' ? 'art' : 'nd');
  const pad = compact.padding ?? (compact.kind === 'container' || compact.kind === 'artboard' ? 16 : 10);
  const ops: UIPatchOp[] = [];

  const explicitPos =
    compact.positioning ??
    (compact.kind !== 'artboard' && (compact.x !== undefined || compact.y !== undefined)
      ? 'absolute'
      : 'flow');

  const hydrated = createDefaultUINode(
    {
      id: nodeId,
      parentId,
      kind: compact.kind,
      name: compact.name,
      semanticTag: compact.tag ?? inferDefaultSemanticTag(compact.kind, compact.controlType),
      layout: {
        mode:
          compact.layoutMode ??
          (compact.kind === 'container' || compact.kind === 'artboard' || compact.children?.length
            ? 'flex'
            : 'freeform'),
        positioning: explicitPos,
        direction: compact.direction ?? 'column',
        gap: compact.gap ?? 12,
        justify: compact.justify ?? 'start',
        align: compact.align ?? 'stretch',
        frame: {
          x: compact.x ?? 0,
          y: compact.y ?? 0,
          width: compact.width ?? (compact.kind === 'artboard' ? 1280 : 320),
          height: compact.height ?? (compact.kind === 'artboard' ? 840 : 48),
        },
        width: {
          mode:
            compact.widthMode ??
            (compact.kind === 'artboard' || explicitPos === 'absolute'
              ? 'fixed'
              : compact.children?.length
                ? 'fill'
                : 'hug'),
          value: compact.width ?? 320,
        },
        height: {
          mode: compact.heightMode ?? (compact.kind === 'artboard' ? 'fixed' : 'hug'),
          value: compact.height ?? 48,
        },
        padding: { top: pad, right: pad, bottom: pad, left: pad },
      },
      style: {
        fills: compact.bg ? [{ type: 'solid', color: compact.bg }] : undefined,
        radius: compact.radius ?? 8,
        border: compact.borderColor
          ? { width: 1, style: 'solid', color: compact.borderColor }
          : undefined,
        zIndex: compact.zIndex,
        customCss: compact.customCss,
      },
      typography:
        compact.text || compact.textColor || compact.fontSize
          ? {
              fontFamily: { $token: 'font.sans' },
              fontSize: compact.fontSize ?? 15,
              fontWeight: compact.fontWeight ?? (compact.tag?.startsWith('h') ? 700 : 500),
              color: compact.textColor ?? { $token: 'color.text.primary' },
            }
          : undefined,
      content:
        compact.text ||
        compact.placeholder ||
        compact.iconName ||
        compact.controlType ||
        compact.threeSceneId ||
        compact.blueprintId
          ? {
              text: compact.text,
              placeholder: compact.placeholder,
              iconName: compact.iconName,
              controlType: compact.controlType,
              threeSceneId: compact.threeSceneId,
              blueprintId: compact.blueprintId,
            }
          : undefined,
      platform:
        compact.htmx || compact.mvvmBinding
          ? {
              htmx: compact.htmx,
              mvvm: compact.mvvmBinding
                ? {
                    bindings: {
                      [compact.mvvmBinding.property]: { path: compact.mvvmBinding.path, mode: 'TwoWay' },
                    },
                    command: compact.mvvmBinding.command ? { path: compact.mvvmBinding.command } : undefined,
                  }
                : undefined,
            }
          : undefined,
    },
    sheetId,
  );

  ops.push({
    op: 'insert_node',
    parentId,
    index,
    node: hydrated,
  });

  if (compact.children && compact.children.length > 0) {
    compact.children.forEach((child, childIdx) => {
      ops.push(...hydrateCompactNodeToPatches(child, nodeId, sheetId, childIdx));
    });
  }

  return ops;
}

export function hydrateCompactOpsToPatches(compactOps: AICompactPatchOp[], sheetId: string): UIPatchOp[] {
  const result: UIPatchOp[] = [];
  for (const cOp of compactOps) {
    switch (cOp.op) {
      case 'insert_tree':
        result.push(...hydrateCompactNodeToPatches(cOp.tree, cOp.parentId, sheetId, cOp.index));
        break;
      case 'update_props': {
        const pad = cOp.padding;
        result.push({
          op: 'update_node',
          id: cOp.nodeId,
          name: cOp.name,
          layout: {
            ...(cOp.direction ? { mode: 'flex', direction: cOp.direction } : {}),
            ...(cOp.gap !== undefined ? { gap: cOp.gap } : {}),
            ...(pad !== undefined ? { padding: { top: pad, right: pad, bottom: pad, left: pad } } : {}),
            ...(cOp.widthMode ? { width: { mode: cOp.widthMode, value: cOp.width } } : {}),
            ...(cOp.heightMode ? { height: { mode: cOp.heightMode, value: cOp.height } } : {}),
          },
          style: {
            ...(cOp.bg ? { fills: [{ type: 'solid', color: cOp.bg }] } : {}),
            ...(cOp.radius !== undefined ? { radius: cOp.radius } : {}),
          },
          typography:
            cOp.textColor || cOp.fontSize
              ? {
                  fontFamily: { $token: 'font.sans' },
                  fontSize: cOp.fontSize ?? 15,
                  fontWeight: 500,
                  color: cOp.textColor ?? { $token: 'color.text.primary' },
                }
              : undefined,
          content: cOp.text !== undefined ? { text: cOp.text } : undefined,
        });
        break;
      }
      case 'bind_htmx':
        result.push({
          op: 'set_interaction',
          id: cOp.nodeId,
          htmx: {
            method: cOp.method,
            endpoint: cOp.endpoint,
            targetNodeId: cOp.targetNodeId,
            hxSwap: cOp.hxSwap ?? 'innerHTML',
            hxTrigger: cOp.hxTrigger,
          },
        });
        break;
      case 'wrap_auto_layout':
        result.push({
          op: 'wrap_container',
          targetNodeIds: cOp.targetNodeIds,
          wrapperName: cOp.wrapperName ?? 'AutoGroup',
          direction: cOp.direction,
          gap: cOp.gap ?? 12,
        });
        break;
      case 'delete_node':
        result.push({ op: 'delete_node', id: cOp.nodeId });
        break;
    }
  }
  return result;
}

// ============================================================================
// DETERMINISTIC PURE PATCH APPLIER + EXACT INVERSE PATCH GENERATOR
// ============================================================================

function cloneDeep<T>(obj: T): T {
  return structuredClone(obj);
}

function collectSubtreePostOrder(nodes: Record<NodeId, UINode>, rootId: NodeId): UINode[] {
  const node = nodes[rootId];
  if (!node) return [];
  const list: UINode[] = [cloneDeep(node)];
  for (const cid of node.childIds) {
    list.push(...collectSubtreePostOrder(nodes, cid));
  }
  return list;
}

function setByDotPath(target: Record<string, unknown>, path: string, value: unknown): unknown {
  const parts = path.split('.');
  let cur: any = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (cur[key] === undefined || cur[key] === null) {
      cur[key] = Number.isInteger(Number(parts[i + 1])) ? [] : {};
    }
    cur = cur[key];
  }
  const last = parts[parts.length - 1];
  const prev = cur[last];
  cur[last] = value;
  return prev;
}

export function applyPatchOpsToSheet(
  sheet: UISheetDocument,
  ops: UIPatchOp[],
): { nextSheet: UISheetDocument; inverseOps: UIPatchOp[] } {
  const next = cloneDeep(sheet);
  const inverseStack: UIPatchOp[] = [];

  const reindexChildren = (parentId: NodeId | null) => {
    const ids = parentId ? next.nodes[parentId]?.childIds ?? [] : next.rootIds;
    ids.forEach((cid, idx) => {
      if (next.nodes[cid]) {
        next.nodes[cid].sortOrder = fractionalOrderAt(idx);
      }
    });
  };

  for (const op of ops) {
    switch (op.op) {
      case 'insert_node': {
        const fullNode = createDefaultUINode(
          {
            ...op.node,
            parentId: op.parentId,
          },
          next.sheetId,
        );
        next.nodes[fullNode.id] = fullNode;

        if (op.parentId && next.nodes[op.parentId]) {
          const arr = next.nodes[op.parentId].childIds;
          const idx = op.index !== undefined ? Math.min(Math.max(0, op.index), arr.length) : arr.length;
          arr.splice(idx, 0, fullNode.id);
          reindexChildren(op.parentId);
        } else {
          fullNode.parentId = null;
          const idx =
            op.index !== undefined ? Math.min(Math.max(0, op.index), next.rootIds.length) : next.rootIds.length;
          next.rootIds.splice(idx, 0, fullNode.id);
          reindexChildren(null);
        }
        inverseStack.unshift({ op: 'delete_node', id: fullNode.id });
        break;
      }

      case 'update_node': {
        const existing = next.nodes[op.id];
        if (!existing) break;
        const before = cloneDeep(existing);

        if (op.name !== undefined) existing.name = op.name;
        if (op.semanticTag !== undefined) existing.semanticTag = op.semanticTag;
        if (op.visible !== undefined) existing.visible = op.visible;
        if (op.locked !== undefined) existing.locked = op.locked;
        if (op.classNames !== undefined) {
          existing.classNames = [...op.classNames];
          existing.style = { ...existing.style, classNames: [...op.classNames] };
        }
        if (op.layout) {
          existing.layout = {
            ...existing.layout,
            ...op.layout,
            frame: op.layout.frame ? { ...existing.layout.frame, ...op.layout.frame } : existing.layout.frame,
            pins: op.layout.pins !== undefined ? { ...(existing.layout.pins ?? {}), ...op.layout.pins } : existing.layout.pins,
            width: op.layout.width ? { ...existing.layout.width, ...op.layout.width } : existing.layout.width,
            height: op.layout.height ? { ...existing.layout.height, ...op.layout.height } : existing.layout.height,
            padding: op.layout.padding
              ? { ...existing.layout.padding, ...op.layout.padding }
              : existing.layout.padding,
            margin: op.layout.margin
              ? { ...(existing.layout.margin ?? { top: 0, right: 0, bottom: 0, left: 0 }), ...op.layout.margin }
              : existing.layout.margin,
            flexChild: op.layout.flexChild
              ? { ...(existing.layout.flexChild ?? {}), ...op.layout.flexChild }
              : existing.layout.flexChild,
            gridChild: op.layout.gridChild
              ? { ...(existing.layout.gridChild ?? {}), ...op.layout.gridChild }
              : existing.layout.gridChild,
          };
        }
        if (op.style) {
          existing.style = {
            ...existing.style,
            ...op.style,
            border:
              op.style.border !== undefined
                ? { ...(existing.style.border ?? { width: 1, style: 'solid', color: '#334155' }), ...op.style.border }
                : existing.style.border,
            filters:
              op.style.filters !== undefined
                ? { ...(existing.style.filters ?? {}), ...op.style.filters }
                : existing.style.filters,
            transform:
              op.style.transform !== undefined
                ? { ...(existing.style.transform ?? {}), ...op.style.transform }
                : existing.style.transform,
          };
          if (op.style.classNames !== undefined && op.classNames === undefined) {
            existing.classNames = [...op.style.classNames];
          }
        }
        if (op.typography) {
          existing.typography = {
            fontFamily: { $token: 'font.sans' },
            fontSize: 15,
            fontWeight: 400,
            color: { $token: 'color.text.primary' },
            ...(existing.typography ?? {}),
            ...op.typography,
          };
        }
        if (op.content) {
          existing.content = { ...(existing.content ?? {}), ...op.content };
        }
        if (op.controlFlow !== undefined) existing.controlFlow = cloneDeep(op.controlFlow);
        if (op.stateOverrides !== undefined) {
          existing.stateOverrides = { ...(existing.stateOverrides ?? {}), ...cloneDeep(op.stateOverrides) };
        }
        if (op.responsiveOverrides !== undefined) {
          existing.responsiveOverrides = {
            ...(existing.responsiveOverrides ?? {}),
            ...cloneDeep(op.responsiveOverrides),
          };
        }
        if (op.dataBindings !== undefined) existing.dataBindings = cloneDeep(op.dataBindings);
        if (op.interactions !== undefined) existing.interactions = cloneDeep(op.interactions);
        if (op.platform) {
          existing.platform = {
            ...(existing.platform ?? {}),
            ...cloneDeep(op.platform),
          };
        }

        inverseStack.unshift({
          op: 'update_node',
          id: before.id,
          name: before.name,
          semanticTag: before.semanticTag,
          visible: before.visible,
          locked: before.locked,
          classNames: before.classNames,
          layout: before.layout,
          style: before.style,
          typography: before.typography,
          content: before.content,
          controlFlow: before.controlFlow,
          stateOverrides: before.stateOverrides,
          responsiveOverrides: before.responsiveOverrides,
          dataBindings: before.dataBindings,
          interactions: before.interactions,
          platform: before.platform,
        });
        break;
      }

      case 'move_node': {
        const node = next.nodes[op.id];
        if (!node) break;
        const oldParentId = node.parentId;
        const oldList = oldParentId ? next.nodes[oldParentId]?.childIds ?? [] : next.rootIds;
        const oldIndex = Math.max(0, oldList.indexOf(op.id));
        const posInOld = oldList.indexOf(op.id);
        if (posInOld >= 0) oldList.splice(posInOld, 1);

        node.parentId = op.newParentId;
        const newList = op.newParentId ? next.nodes[op.newParentId]?.childIds ?? [] : next.rootIds;
        const clampedIdx = Math.min(Math.max(0, op.index), newList.length);
        newList.splice(clampedIdx, 0, op.id);
        reindexChildren(oldParentId);
        if (op.newParentId !== oldParentId) reindexChildren(op.newParentId);

        inverseStack.unshift({
          op: 'move_node',
          id: op.id,
          newParentId: oldParentId,
          index: oldIndex,
        });
        break;
      }

      case 'wrap_container': {
        const validIds = op.targetNodeIds.filter((tid) => Boolean(next.nodes[tid]));
        if (validIds.length === 0) break;
        const first = next.nodes[validIds[0]];
        const commonParentId = first.parentId;
        const commonParent = commonParentId ? next.nodes[commonParentId] : undefined;
        const parentIsFreeform = commonParent?.layout.mode === 'freeform';
        const parentList = commonParentId ? next.nodes[commonParentId]?.childIds ?? [] : next.rootIds;
        const insertAt = Math.max(0, parentList.indexOf(first.id));

        const minX = Math.min(...validIds.map((id) => next.nodes[id].layout.frame.x));
        const minY = Math.min(...validIds.map((id) => next.nodes[id].layout.frame.y));
        const maxX = Math.max(...validIds.map((id) => next.nodes[id].layout.frame.x + next.nodes[id].layout.frame.width));
        const maxY = Math.max(...validIds.map((id) => next.nodes[id].layout.frame.y + next.nodes[id].layout.frame.height));

        const wrapperMode = op.mode ?? 'flex';
        const pad = op.padding ?? (op.presetStyle === 'card' || op.presetStyle === 'glass' ? 16 : wrapperMode === 'freeform' ? 0 : 12);
        const bboxW = Math.max(80, Math.round(maxX - minX + (wrapperMode === 'freeform' ? 0 : pad * 2)));
        const bboxH = Math.max(44, Math.round(maxY - minY + (wrapperMode === 'freeform' ? 0 : pad * 2)));

        const wrapperId = op.wrapperId ?? generateNodeId('wrap');
        const presetStyleSpec: Partial<StyleSpec> =
          op.presetStyle === 'card'
            ? {
                fills: [{ type: 'solid', color: { $token: 'color.bg.surface' } }],
                border: { width: 1, style: 'solid', color: { $token: 'color.border.subtle' } },
                radius: 12,
                shadows: [{ x: 0, y: 8, blur: 24, spread: -4, color: 'rgba(15, 23, 42, 0.22)' }],
              }
            : op.presetStyle === 'glass'
              ? {
                  fills: [{ type: 'solid', color: 'rgba(255, 255, 255, 0.08)' }],
                  border: { width: 1, style: 'solid', color: 'rgba(255, 255, 255, 0.16)' },
                  radius: 14,
                  backdropBlur: 14,
                }
              : {};

        const wrapper = createDefaultUINode(
          {
            id: wrapperId,
            parentId: commonParentId,
            kind: 'container',
            name: op.wrapperName ?? (op.presetStyle === 'card' ? 'CardGroup' : wrapperMode === 'grid' ? 'GridGroup' : 'AutoGroup'),
            layout: {
              mode: wrapperMode,
              positioning: parentIsFreeform ? 'absolute' : 'flow',
              direction: wrapperMode === 'flex' ? (op.direction ?? 'row') : undefined,
              gap: op.gap ?? 12,
              justify: 'start',
              align: wrapperMode === 'grid' ? 'stretch' : 'center',
              gridCols:
                wrapperMode === 'grid'
                  ? (op.gridCols ?? [{ track: 'fr', value: 1 }, { track: 'fr', value: 1 }])
                  : undefined,
              gridRows: wrapperMode === 'grid' ? op.gridRows : undefined,
              frame: { x: minX, y: minY, width: bboxW, height: bboxH, rotation: 0 },
              width: wrapperMode === 'freeform' || parentIsFreeform ? { mode: 'fixed', value: bboxW } : { mode: 'hug' },
              height: wrapperMode === 'freeform' ? { mode: 'fixed', value: bboxH } : { mode: 'hug' },
              padding: { top: pad, right: pad, bottom: pad, left: pad },
            },
            style: presetStyleSpec,
          },
          next.sheetId,
        );
        next.nodes[wrapperId] = wrapper;
        parentList.splice(insertAt, 0, wrapperId);

        const moveBackOps: UIPatchOp[] = [];
        const childLayoutRestores: UIPatchOp[] = [];
        validIds.forEach((tid) => {
          const child = next.nodes[tid];
          const beforeChildLayout = cloneDeep(child.layout);
          const prevParent = child.parentId;
          const prevArr = prevParent ? next.nodes[prevParent]?.childIds ?? [] : next.rootIds;
          const prevIdx = Math.max(0, prevArr.indexOf(tid));
          const loc = prevArr.indexOf(tid);
          if (loc >= 0) prevArr.splice(loc, 1);

          child.parentId = wrapperId;
          if (wrapperMode === 'freeform') {
            child.layout.positioning = 'absolute';
            child.layout.frame = {
              ...child.layout.frame,
              x: Math.round(child.layout.frame.x - minX),
              y: Math.round(child.layout.frame.y - minY),
            };
          } else {
            child.layout.positioning = 'flow';
          }
          wrapper.childIds.push(tid);
          moveBackOps.push({ op: 'move_node', id: tid, newParentId: prevParent, index: prevIdx });
          childLayoutRestores.push({ op: 'update_node', id: tid, layout: beforeChildLayout });
        });
        reindexChildren(commonParentId);
        reindexChildren(wrapperId);

        inverseStack.unshift(...childLayoutRestores);
        inverseStack.unshift({ op: 'delete_node', id: wrapperId });
        for (let i = moveBackOps.length - 1; i >= 0; i--) {
          inverseStack.unshift(moveBackOps[i]);
        }
        break;
      }

      case 'ungroup_container': {
        const wrapper = next.nodes[op.id];
        if (!wrapper || wrapper.kind === 'artboard') break;
        const parentId = wrapper.parentId;
        const parentNode = parentId ? next.nodes[parentId] : undefined;
        const parentIsFreeform = parentNode?.layout.mode === 'freeform';
        const parentList = parentId ? next.nodes[parentId]?.childIds ?? [] : next.rootIds;
        const wrapperIdx = Math.max(0, parentList.indexOf(wrapper.id));

        const wrapperClone = cloneDeep(wrapper);
        const childIds = [...wrapper.childIds];
        const childSnapshots = childIds
          .map((cid) => next.nodes[cid])
          .filter((n): n is UINode => Boolean(n))
          .map((n) => cloneDeep(n));

        const pos = parentList.indexOf(wrapper.id);
        if (pos >= 0) {
          parentList.splice(pos, 1, ...childIds);
        }

        for (const cid of childIds) {
          const child = next.nodes[cid];
          if (!child) continue;
          child.parentId = parentId;
          if (parentIsFreeform) {
            child.layout.positioning = 'absolute';
            child.layout.frame = {
              ...child.layout.frame,
              x: Math.round(wrapper.layout.frame.x + child.layout.frame.x),
              y: Math.round(wrapper.layout.frame.y + child.layout.frame.y),
            };
          } else {
            child.layout.positioning = 'flow';
          }
        }

        delete next.nodes[wrapper.id];
        reindexChildren(parentId);

        const inverseOpsForUngroup: UIPatchOp[] = [
          {
            op: 'insert_node',
            parentId,
            index: wrapperIdx,
            node: { ...wrapperClone, childIds: [] },
          },
          ...childSnapshots.map((snap, idx): UIPatchOp => ({
            op: 'move_node',
            id: snap.id,
            newParentId: wrapperClone.id,
            index: idx,
          })),
          ...childSnapshots.map((snap): UIPatchOp => ({
            op: 'update_node',
            id: snap.id,
            layout: snap.layout,
          })),
        ];
        inverseStack.unshift(...inverseOpsForUngroup);
        break;
      }

      case 'delete_node': {
        const target = next.nodes[op.id];
        if (!target) break;
        const parentId = target.parentId;
        const list = parentId ? next.nodes[parentId]?.childIds ?? [] : next.rootIds;
        const oldIdx = Math.max(0, list.indexOf(op.id));
        const subtree = collectSubtreePostOrder(next.nodes, op.id);

        const pos = list.indexOf(op.id);
        if (pos >= 0) list.splice(pos, 1);
        for (const sub of subtree) {
          delete next.nodes[sub.id];
        }
        reindexChildren(parentId);

        const recreateOps: UIPatchOp[] = subtree.map((sub, i) => ({
          op: 'insert_node',
          parentId: sub.parentId,
          index: i === 0 ? oldIdx : undefined,
          node: { ...sub, childIds: [] },
        }));
        inverseStack.unshift(...recreateOps);
        break;
      }

      case 'bind_token': {
        const node = next.nodes[op.id];
        if (!node) break;
        const before = cloneDeep(node);
        setByDotPath(node as unknown as Record<string, unknown>, op.propertyPath, { $token: op.tokenPath });
        inverseStack.unshift({
          op: 'update_node',
          id: before.id,
          layout: before.layout,
          style: before.style,
          typography: before.typography,
        });
        break;
      }

      case 'convert_auto_layout': {
        const node = next.nodes[op.id];
        if (!node) break;
        const beforeLayout = cloneDeep(node.layout);
        const childRestores: UIPatchOp[] = [];
        const pad = op.padding ?? 16;

        node.layout = {
          ...node.layout,
          mode: op.direction === 'grid' ? 'grid' : 'flex',
          direction: op.direction === 'grid' ? undefined : op.direction,
          gap: op.gap ?? 16,
          justify: op.justify ?? 'start',
          align: op.align ?? 'stretch',
          gridCols: op.gridCols ?? node.layout.gridCols,
          gridRows: op.gridRows ?? node.layout.gridRows,
          padding: { top: pad, right: pad, bottom: pad, left: pad },
        };

        for (const cid of node.childIds) {
          const child = next.nodes[cid];
          if (child && child.layout.positioning === 'absolute') {
            childRestores.push({
              op: 'update_node',
              id: cid,
              layout: cloneDeep(child.layout),
            });
            child.layout.positioning = 'flow';
          }
        }

        inverseStack.unshift(...childRestores, {
          op: 'update_node',
          id: node.id,
          layout: beforeLayout,
        });
        break;
      }

      case 'set_interaction': {
        const node = next.nodes[op.id];
        if (!node) break;
        const prevInteractions = cloneDeep(node.interactions);
        const prevPlatform = cloneDeep(node.platform);

        if (op.interactions !== undefined) {
          node.interactions = cloneDeep(op.interactions);
        }
        if (op.htmx !== undefined || op.mvvm !== undefined) {
          node.platform = {
            ...(node.platform ?? {}),
            ...(op.htmx !== undefined ? { htmx: cloneDeep(op.htmx) } : {}),
            ...(op.mvvm !== undefined ? { mvvm: cloneDeep(op.mvvm) } : {}),
          };
        }

        inverseStack.unshift({
          op: 'update_node',
          id: node.id,
          interactions: prevInteractions,
          platform: prevPlatform,
        });
        break;
      }

      case 'update_sheet_meta': {
        const inverseMeta: Extract<UIPatchOp, { op: 'update_sheet_meta' }> = {
          op: 'update_sheet_meta',
        };
        if (op.customCss !== undefined) {
          inverseMeta.customCss = next.customCss ?? '';
          next.customCss = op.customCss;
        }
        if (op.keyframesCss !== undefined) {
          inverseMeta.keyframesCss = next.keyframesCss ?? '';
          next.keyframesCss = op.keyframesCss;
        }
        if (op.reusableClasses !== undefined) {
          inverseMeta.reusableClasses = cloneDeep(next.reusableClasses ?? []);
          next.reusableClasses = cloneDeep(op.reusableClasses);
        }
        if (op.codeOverrides !== undefined) {
          inverseMeta.codeOverrides = cloneDeep(next.codeOverrides ?? {});
          next.codeOverrides = cloneDeep(op.codeOverrides);
        }
        if (op.linkedScripts !== undefined) {
          inverseMeta.linkedScripts = cloneDeep(next.linkedScripts ?? []);
          next.linkedScripts = cloneDeep(op.linkedScripts);
        }
        if (op.automations !== undefined) {
          inverseMeta.automations = cloneDeep(next.automations ?? []);
          next.automations = cloneDeep(op.automations);
        }
        if (op.stateSchema !== undefined) {
          inverseMeta.stateSchema = cloneDeep(next.stateSchema ?? []);
          next.stateSchema = cloneDeep(op.stateSchema);
        }
        if (op.ipcSchema !== undefined) {
          inverseMeta.ipcSchema = cloneDeep(next.ipcSchema ?? []);
          next.ipcSchema = cloneDeep(op.ipcSchema);
        }
        if (op.defaultLayoutMode !== undefined) {
          inverseMeta.defaultLayoutMode = next.defaultLayoutMode;
          next.defaultLayoutMode = op.defaultLayoutMode;
        }
        inverseStack.unshift(inverseMeta);
        break;
      }
    }
  }

  return { nextSheet: next, inverseOps: inverseStack };
}
