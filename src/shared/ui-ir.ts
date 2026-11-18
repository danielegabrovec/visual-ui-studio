/**
 * Canonical Shared UI Intermediate Representation (UI-IR)
 * Bridges Level-1 Authoring SceneGraph (Canvas & SQLite) and Level-2 Compiler IR (Multi-Target Codegen & Local AI).
 */

import type {
  AutomationRule,
  LinkedScriptModuleRef,
  UIRScriptModuleDecl,
} from './automation-types';

export * from './automation-types';

export type NodeId = string;

export interface TokenRef {
  $token: string; // e.g. "color.primary.500", "space.4", "radius.md"
}

export type TokenOrValue<T> = T | TokenRef;

export type BoundOrLiteral<T> =
  | T
  | {
      $bind: string;
      fallback?: T;
    };

export function isTokenRef<T>(val: TokenOrValue<T> | undefined | null): val is TokenRef {
  return typeof val === 'object' && val !== null && '$token' in val && typeof (val as TokenRef).$token === 'string';
}

export function resolveTokenOrValue<T>(
  val: TokenOrValue<T> | undefined,
  tokens: Record<string, string | number>,
  fallback: T,
): T {
  if (val === undefined || val === null) return fallback;
  if (isTokenRef(val)) {
    const found = tokens[val.$token];
    if (found !== undefined) return found as unknown as T;
    return fallback;
  }
  return val;
}

// ============================================================================
// LEVEL 1: AUTHORING SCENEGRAPH IR (Canvas Engine, Zustand Store & SQLite)
// ============================================================================

export type UINodeKind =
  | 'artboard'
  | 'container'
  | 'text'
  | 'control'
  | 'media'
  | 'vector'
  | 'collection'
  | 'component_instance'
  | 'slot';

export type SemanticTag =
  | 'div'
  | 'section'
  | 'header'
  | 'footer'
  | 'nav'
  | 'main'
  | 'aside'
  | 'article'
  | 'form'
  | 'button'
  | 'a'
  | 'input'
  | 'textarea'
  | 'select'
  | 'label'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'p'
  | 'span'
  | 'ul'
  | 'li'
  | 'table'
  | 'dialog'
  | 'window';

export type CssUnit = 'px' | '%' | 'vw' | 'vh' | 'rem' | 'em' | 'auto' | 'fr';
export type CssLengthUnit = CssUnit;
export type GridTrackUnit = 'px' | 'fr' | '%' | 'auto' | 'minmax';

export interface AxisDimensionSpec {
  mode: 'fixed' | 'hug' | 'fill' | 'percentage' | 'viewport' | 'rem' | 'auto';
  value?: TokenOrValue<number>;
  unit?: CssUnit;
  min?: TokenOrValue<number>;
  minUnit?: CssUnit;
  max?: TokenOrValue<number>;
  maxUnit?: CssUnit;
}

export type SizingAxis = AxisDimensionSpec;

export interface PaddingBox {
  top: TokenOrValue<number>;
  right: TokenOrValue<number>;
  bottom: TokenOrValue<number>;
  left: TokenOrValue<number>;
}

export type MarginSideValue = TokenOrValue<number> | 'auto';

export interface MarginBox {
  top: MarginSideValue;
  right: MarginSideValue;
  bottom: MarginSideValue;
  left: MarginSideValue;
}

export interface GridTrackSpec {
  track: GridTrackUnit;
  value?: number;
  min?: string;
  max?: string;
}

export interface FlexChildSpec {
  grow?: number;
  shrink?: number;
  basis?: TokenOrValue<number> | 'auto';
  basisUnit?: CssUnit;
  alignSelf?: 'auto' | 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  order?: number;
}

export interface LayoutSpec {
  mode: 'flex' | 'grid' | 'stack' | 'freeform';
  positioning: 'flow' | 'absolute' | 'sticky' | 'fixed';
  frame: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
  };
  pins?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
    centerX?: boolean;
    centerY?: boolean;
  };
  width: AxisDimensionSpec;
  height: AxisDimensionSpec;
  aspectRatio?: string;
  boxSizing?: 'border-box' | 'content-box';
  direction?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  wrap?: boolean | 'nowrap' | 'wrap' | 'wrap-reverse';
  justify?: 'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly';
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  alignContent?: 'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'stretch';
  justifyItems?: 'start' | 'center' | 'end' | 'stretch';
  placeItems?: string;
  gap?: TokenOrValue<number>;
  rowGap?: TokenOrValue<number>;
  columnGap?: TokenOrValue<number>;
  flexChild?: FlexChildSpec;
  gridCols?: GridTrackSpec[];
  gridRows?: GridTrackSpec[];
  gridChild?: {
    colStart?: number;
    colSpan?: number;
    rowStart?: number;
    rowSpan?: number;
    alignSelf?: 'auto' | 'start' | 'center' | 'end' | 'stretch';
    justifySelf?: 'auto' | 'start' | 'center' | 'end' | 'stretch';
  };
  padding: PaddingBox;
  margin?: MarginBox;
  overflow?: 'visible' | 'hidden' | 'scroll' | 'auto';
  overflowX?: 'visible' | 'hidden' | 'scroll' | 'auto';
  overflowY?: 'visible' | 'hidden' | 'scroll' | 'auto';
  objectFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
}

export type StyleFill =
  | { type: 'solid'; color: TokenOrValue<string>; opacity?: number; enabled?: boolean }
  | {
      type: 'linear-gradient';
      angle: number;
      stops: Array<{ pos: number; color: TokenOrValue<string> }>;
      enabled?: boolean;
    }
  | {
      type: 'radial-gradient';
      shape?: 'circle' | 'ellipse';
      centerX?: number;
      centerY?: number;
      stops: Array<{ pos: number; color: TokenOrValue<string> }>;
      enabled?: boolean;
    }
  | {
      type: 'conic-gradient';
      angle?: number;
      centerX?: number;
      centerY?: number;
      stops: Array<{ pos: number; color: TokenOrValue<string> }>;
      enabled?: boolean;
    }
  | {
      type: 'image';
      assetId?: string;
      imageUrl?: string;
      fit: 'cover' | 'contain' | 'fill' | 'custom';
      position?: string;
      repeat?: 'no-repeat' | 'repeat' | 'repeat-x' | 'repeat-y';
      enabled?: boolean;
    };

export interface StyleShadow {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: TokenOrValue<string>;
  inset?: boolean;
}

export interface BorderSideSpec {
  width: TokenOrValue<number>;
  style: 'solid' | 'dashed' | 'dotted' | 'double' | 'none';
  color: TokenOrValue<string>;
}

export interface OutlineSpec {
  width: number;
  style: 'solid' | 'dashed' | 'dotted' | 'double' | 'none';
  color: TokenOrValue<string>;
  offset?: number;
}

export interface FilterSpec {
  blur?: number;
  brightness?: number;
  contrast?: number;
  saturate?: number;
  grayscale?: number;
  hueRotate?: number;
  invert?: number;
  backdropBlur?: number;
  backdropSaturate?: number;
  backdropBrightness?: number;
}

export interface Transform2DSpec {
  translateX?: number;
  translateXUnit?: 'px' | '%';
  translateY?: number;
  translateYUnit?: 'px' | '%';
  scaleX?: number;
  scaleY?: number;
  rotate?: number;
  skewX?: number;
  skewY?: number;
  origin?: string;
}

export interface CssTransitionSpec {
  property: string;
  durationMs: number;
  timing: string;
  delayMs?: number;
}

export interface CssAnimationSpec {
  name: 'none' | 'fade-in' | 'slide-up' | 'slide-down' | 'scale-in' | 'pulse' | 'spin' | 'bounce' | (string & {});
  durationMs: number;
  timing?: string;
  delayMs?: number;
  iterationCount?: number | 'infinite';
  direction?: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
  fillMode?: 'none' | 'forwards' | 'backwards' | 'both';
}

export interface StyleSpec {
  opacity?: number;
  fills?: StyleFill[];
  border?: {
    width: TokenOrValue<number> | { top: number; right: number; bottom: number; left: number };
    style: 'solid' | 'dashed' | 'dotted' | 'double' | 'none';
    color: TokenOrValue<string>;
    sides?: Partial<Record<'top' | 'right' | 'bottom' | 'left', BorderSideSpec>>;
  };
  outline?: OutlineSpec;
  radius?: TokenOrValue<number> | { tl: number; tr: number; br: number; bl: number };
  shadows?: StyleShadow[];
  backdropBlur?: number;
  filters?: FilterSpec;
  mixBlendMode?:
    | 'normal'
    | 'multiply'
    | 'screen'
    | 'overlay'
    | 'darken'
    | 'lighten'
    | 'color-dodge'
    | 'difference';
  transform?: Transform2DSpec;
  transitions?: CssTransitionSpec[];
  animation?: CssAnimationSpec;
  cursor?:
    | 'auto'
    | 'default'
    | 'pointer'
    | 'grab'
    | 'text'
    | 'move'
    | 'not-allowed'
    | 'crosshair';
  pointerEvents?: 'auto' | 'none';
  userSelect?: 'auto' | 'none' | 'text';
  classNames?: string[];
  zIndex?: number;
  customCss?: string;
}

export interface TypographySpec {
  fontFamily: TokenOrValue<string>;
  fontSize: TokenOrValue<number>;
  fontSizeUnit?: 'px' | 'rem' | 'em' | 'vw';
  fontWeight: TokenOrValue<number | string>;
  fontStyle?: 'normal' | 'italic';
  lineHeight?: TokenOrValue<number | 'normal'>;
  lineHeightUnit?: 'unitless' | 'px' | '%';
  letterSpacing?: TokenOrValue<number>;
  letterSpacingUnit?: 'px' | 'em';
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  color: TokenOrValue<string>;
  textDecoration?: 'none' | 'underline' | 'line-through';
  whiteSpace?: 'normal' | 'nowrap' | 'pre-wrap';
  textOverflow?: 'clip' | 'ellipsis';
  lineClamp?: number;
  textShadow?: {
    x: number;
    y: number;
    blur: number;
    color: TokenOrValue<string>;
  };
}

export type InteractiveStateKey =
  | 'hover'
  | 'focus'
  | 'focus-visible'
  | 'active'
  | 'disabled'
  | 'checked'
  | 'loading'
  | 'dark';

export interface StateOverrideSpec {
  layout?: Partial<LayoutSpec>;
  style?: Partial<StyleSpec>;
  typography?: Partial<TypographySpec>;
}

export interface ReusableCssClass {
  id: string;
  name: string; // normalized slug without leading dot, e.g. "btn-brand", "glass-card"
  description?: string;
  layout?: Partial<LayoutSpec>;
  style?: Partial<StyleSpec>;
  typography?: Partial<TypographySpec>;
  stateOverrides?: Partial<Record<InteractiveStateKey, StateOverrideSpec>>;
  states?: Partial<Record<InteractiveStateKey, StateOverrideSpec>>;
}

export type EventTriggerType =
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
  | 'onInterval';

export interface EventActionBinding {
  trigger: EventTriggerType;
  action:
    | { kind: 'set_state'; stateKey: string; expression: string }
    | { kind: 'navigate'; targetSheetOrRoute: string }
    | { kind: 'open_modal'; modalNodeId: NodeId }
    | { kind: 'call_handler'; handlerName: string; args?: string[] }
    | {
        kind: 'call_script_fn';
        vfsEntryId?: string;
        moduleRelPath?: string;
        fnName: string;
        args?: string[];
        passEvent?: boolean;
        debounceMs?: number;
        keyFilter?: string;
        intervalMs?: number;
        automationId?: string;
      }
    | { kind: 'trigger_blueprint'; blueprintId: string; eventName: string }
    | { kind: 'mvvm_command'; commandName: string; parameterExpr?: string }
    | { kind: 'ipc_invoke'; channel: string; payloadExpr?: string; resultStateKey?: string }
    | { kind: 'http_fetch'; method: 'GET' | 'POST' | 'PUT' | 'DELETE'; url: string };
}

export interface ControlFlowSpec {
  conditionalExpr?: string;
  repeat?: {
    collectionExpr: string;
    itemVar: string;
    keyExpr: string;
  };
}

export type HtmxSwapMode =
  | 'innerHTML'
  | 'outerHTML'
  | 'beforebegin'
  | 'afterbegin'
  | 'beforeend'
  | 'afterend'
  | 'delete'
  | 'none'
  | 'morph:outerHTML';

export interface HtmxExtensionSpec {
  method: 'hx-get' | 'hx-post' | 'hx-put' | 'hx-patch' | 'hx-delete';
  endpoint: string;
  targetNodeId?: NodeId;
  targetSelectorFallback?: string;
  hxSwap?: HtmxSwapMode;
  hxTrigger?: string;
  indicatorNodeId?: NodeId;
  oobNodeIds?: NodeId[];
  confirmPrompt?: string;
  pushUrl?: boolean | string;
  hxValsJson?: string;
}

export interface MvvmExtensionSpec {
  dataType?: string;
  bindings?: Record<
    string,
    {
      path: string;
      mode?: 'OneWay' | 'TwoWay' | 'OneTime';
      converter?: string;
    }
  >;
  command?: {
    path: string;
    parameterExpr?: string;
  };
}

export interface DesktopWindowExtensionSpec {
  frameless?: boolean;
  transparent?: boolean;
  backdrop?: 'none' | 'mica' | 'acrylic' | 'vibrancy';
  dragRegion?: boolean | 'drag' | 'no-drag';
  resizable?: boolean;
  minWidth?: number;
  minHeight?: number;
  alwaysOnTop?: boolean;
  titlebarStyle?: 'native' | 'hiddenInset' | 'customControls';
}

export interface A11yExtensionSpec {
  role?: string;
  ariaLabel?: string;
  tabIndex?: number;
}

export interface PlatformExtensions {
  htmx?: HtmxExtensionSpec;
  mvvm?: MvvmExtensionSpec;
  desktopWindow?: DesktopWindowExtensionSpec;
  a11y?: A11yExtensionSpec;
}

export type UIControlSubtype =
  | 'button'
  | 'icon-button'
  | 'text-input'
  | 'password'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'switch'
  | 'slider'
  | 'badge'
  | 'divider'
  | 'tabs'
  | 'table'
  | 'three-viewport';

export interface NodeContentSpec {
  text?: string;
  placeholder?: string;
  value?: string;
  options?: string[];
  checked?: boolean;
  controlType?: UIControlSubtype;
  assetId?: string;
  imageUrl?: string;
  iconName?: string;
  svgPath?: string;
  collectionItemVar?: string;
  tableColumns?: string[];
  tableRows?: string[][];
  threeSceneId?: string;
  blueprintId?: string;
}

export interface UINode {
  id: NodeId;
  sheetId: string;
  parentId: NodeId | null;
  childIds: NodeId[];
  sortOrder: string;
  kind: UINodeKind;
  name: string;
  semanticTag: SemanticTag;
  visible: boolean;
  locked: boolean;
  classNames?: string[];
  layout: LayoutSpec;
  style: StyleSpec;
  typography?: TypographySpec;
  content?: NodeContentSpec;
  componentRef?: {
    componentId: string;
    variantProps?: Record<string, string | boolean>;
    slotOverrides?: Record<string, NodeId[]>;
  };
  controlFlow?: ControlFlowSpec;
  stateOverrides?: Partial<Record<InteractiveStateKey, StateOverrideSpec>>;
  responsiveOverrides?: Record<
    string,
    {
      layout?: Partial<LayoutSpec>;
      style?: Partial<StyleSpec>;
      visible?: boolean;
    }
  >;
  dataBindings?: Record<string, { propOrState: string; fallback?: unknown }>;
  interactions?: EventActionBinding[];
  platform?: PlatformExtensions;
}

export interface UISheetStateSpec {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  initialValue: unknown;
}

export interface UISheetPropSpec {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: unknown;
  description?: string;
}

export interface UIRIpcCommandSpec {
  name: string;
  args: Array<{ name: string; type: string }>;
  returnType: string;
  description?: string;
}

export interface UISheetDocument {
  sheetId: string;
  projectId: string;
  name: string;
  rootIds: NodeId[];
  nodes: Record<NodeId, UINode>;
  stateSchema?: UISheetStateSpec[];
  propsSchema?: UISheetPropSpec[];
  ipcSchema?: UIRIpcCommandSpec[];
  customCss?: string;
  keyframesCss?: string;
  reusableClasses?: ReusableCssClass[];
  linkedScripts?: LinkedScriptModuleRef[];
  automations?: AutomationRule[];
  codeOverrides?: Record<string, Record<string, string>>;
  defaultLayoutMode?: 'freeform' | 'flex';
}

// ============================================================================
// DESIGN TOKENS & THEMES
// ============================================================================

export type TokenCategory = 'color' | 'spacing' | 'typography' | 'radius' | 'shadow';

export interface DesignTokenEntry {
  id: string;
  projectId: string;
  themeId: string | null; // null = global/base token, string = theme override
  tokenPath: string; // e.g. "color.primary.500", "space.4"
  category: TokenCategory;
  rawValue: string;
  aliasOfPath?: string | null;
}

export interface DesignTheme {
  id: string;
  projectId: string;
  name: string; // e.g. "Light", "Dark"
  isDefault: boolean;
}

export interface BreakpointPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  deviceKind: 'desktop' | 'tablet' | 'mobile' | 'desktop-window';
}

// ============================================================================
// LEVEL 2: NORMALIZED COMPILER IR & MULTI-TARGET CODEGEN PLUGIN CONTRACTS
// ============================================================================

export type BuiltinCodegenTargetId =
  // Tier 1 — 10 Explicitly Requested Core Targets
  | 'html-vanilla'
  | 'react-tsx'
  | 'nextjs-app'
  | 'htmx'
  | 'svelte5'
  | 'angular'
  | 'react-native'
  | 'electron-target'
  | 'tauri-v2'
  | 'dotnet-maui'
  // Tier 2 — High-Value Multi-Language Web, Mobile, Desktop & AI Targets
  | 'vue3'
  | 'blazor-razor'
  | 'flutter-dart'
  | 'swiftui'
  | 'jetpack-compose'
  | 'avalonia-ui'
  | 'python-customtkinter'
  | 'python-gradio'
  | 'python-streamlit'
  | 'python-pyside6'
  | 'go-wails'
  // Tier 3 — Native Systems & OS Desktop Frameworks
  | 'rust-slint'
  | 'cpp-qt-qml'
  | 'winui3-xaml'
  // Tier 4 — Embedded MCU & Game Engine UI Frameworks
  | 'lvgl-c'
  | 'unity-uitoolkit';

export type CodegenTargetId = BuiltinCodegenTargetId | (string & {});

export type StylingDialect = 'tailwind' | 'vanilla-css' | 'css-modules' | 'shadcn';

export type CopyExportMode = 'snippet' | 'component' | 'bundle' | 'scaffold';

export interface TargetCapabilityFlags {
  gridLayout: boolean;
  backdropBlur: boolean;
  responsiveBreakpoints: boolean;
  nativeIpc: boolean;
  hypermediaSwap: boolean;
  mvvmBindings: boolean;
  serverComponents: boolean;
}

export interface TargetDescriptor {
  id: CodegenTargetId;
  displayName: string;
  tier: 1 | 2 | 3 | 4;
  category: 'web' | 'mobile' | 'desktop' | 'backend-template' | 'embedded-game-tui';
  languages: string[];
  supportedDialects: StylingDialect[];
  defaultDialect: StylingDialect;
  fileExtension: string;
  description: string;
  capabilities: TargetCapabilityFlags;
}

export interface UIRTokenDictionary {
  colors: Record<string, { light: string; dark?: string }>;
  spacing: Record<string, number>;
  radii: Record<string, number>;
  typography: Record<string, string | number>;
  shadows: Record<string, string>;
  flatMap: Record<string, string | number>;
}

export interface UIRDesktopWindowSpec {
  title: string;
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  frameless: boolean;
  transparent: boolean;
  backdrop?: 'none' | 'mica' | 'acrylic' | 'vibrancy';
  titlebarStyle?: 'native' | 'hiddenInset' | 'customControls';
  resizable: boolean;
  alwaysOnTop?: boolean;
}

export type UIRPropSpec = UISheetPropSpec;
export type UIRStateSpec = UISheetStateSpec;

export type UIRSemanticKind =
  | 'Box'
  | 'Text'
  | 'Heading'
  | 'Button'
  | 'IconButton'
  | 'TextInput'
  | 'TextArea'
  | 'Select'
  | 'Checkbox'
  | 'Switch'
  | 'Slider'
  | 'Badge'
  | 'Image'
  | 'Icon'
  | 'Card'
  | 'List'
  | 'Table'
  | 'Tabs'
  | 'Modal'
  | 'Form'
  | 'Nav'
  | 'Header'
  | 'Footer'
  | 'ScrollArea'
  | 'Divider'
  | 'Slot'
  | 'ComponentInstance'
  | 'ThreeViewport';

export interface UIRStyleBundle {
  base: StyleSpec;
  typography?: TypographySpec;
  states?: Partial<Record<InteractiveStateKey, StateOverrideSpec>>;
  responsive?: Record<
    string,
    {
      layout?: Partial<LayoutSpec>;
      style?: Partial<StyleSpec>;
      visible?: boolean;
    }
  >;
}

export type UIRTrigger =
  | 'click'
  | 'dblclick'
  | 'submit'
  | 'change'
  | 'input'
  | 'mount'
  | 'hover'
  | 'mouseleave'
  | 'focus'
  | 'blur'
  | 'keydown'
  | 'interval';

export type UIRInteraction =
  | { type: 'STATE_MUTATION'; trigger: UIRTrigger; targetState: string; expr: string }
  | { type: 'NAVIGATION'; trigger: UIRTrigger; routeOrSheetId: string }
  | { type: 'MVVM_COMMAND'; trigger: UIRTrigger; commandName: string; parameterExpr?: string }
  | {
      type: 'SCRIPT_CALL';
      trigger: UIRTrigger;
      fnName: string;
      vfsEntryId?: string;
      moduleRelPath?: string;
      args?: string[];
      passEvent?: boolean;
      debounceMs?: number;
      keyFilter?: string;
      intervalMs?: number;
      automationId?: string;
    }
  | { type: 'BLUEPRINT_EVENT'; trigger: UIRTrigger; blueprintId: string; eventName: string }
  | {
      type: 'HYPERMEDIA_HTMX';
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      endpoint: string;
      triggerSpec?: string;
      targetCanvasNodeId?: string;
      targetSelectorFallback?: string;
      swap: HtmxSwapMode;
      indicatorCanvasNodeId?: string;
      confirmPrompt?: string;
      pushUrl?: boolean | string;
      oobSwapNodes?: string[];
    }
  | {
      type: 'NATIVE_IPC_CALL';
      trigger: UIRTrigger;
      commandName: string;
      argsPayload: Record<string, string>;
      resultStateTarget?: string;
    };

export interface UIRNode {
  id: string;
  canvasNodeId: NodeId;
  name: string;
  kind: UIRSemanticKind;
  semanticTag: SemanticTag;
  classNames?: string[];
  dragRegion?: 'drag' | 'no-drag';
  clientInteractive?: boolean;
  layout: {
    mode: 'ROW' | 'COLUMN' | 'GRID' | 'STACK' | 'FLOATING' | 'FREEFORM';
    direction?: LayoutSpec['direction'];
    positioning?: 'flow' | 'absolute' | 'sticky' | 'fixed';
    pins?: LayoutSpec['pins'];
    zIndex?: number;
    frame: { x: number; y: number; width: number; height: number; rotation?: number };
    width: {
      mode: 'FIXED' | 'HUG' | 'FILL' | 'PERCENTAGE' | 'VIEWPORT' | 'REM' | 'AUTO';
      value?: number;
      unit?: CssUnit;
      min?: number;
      minUnit?: CssUnit;
      max?: number;
      maxUnit?: CssUnit;
    };
    height: {
      mode: 'FIXED' | 'HUG' | 'FILL' | 'PERCENTAGE' | 'VIEWPORT' | 'REM' | 'AUTO';
      value?: number;
      unit?: CssUnit;
      min?: number;
      minUnit?: CssUnit;
      max?: number;
      maxUnit?: CssUnit;
    };
    aspectRatio?: string;
    boxSizing?: LayoutSpec['boxSizing'];
    gap?: TokenOrValue<number>;
    rowGap?: TokenOrValue<number>;
    columnGap?: TokenOrValue<number>;
    padding?: PaddingBox;
    margin?: MarginBox;
    alignItems?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
    justifyContent?: 'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly';
    alignContent?: LayoutSpec['alignContent'];
    justifyItems?: LayoutSpec['justifyItems'];
    placeItems?: string;
    flexChild?: FlexChildSpec;
    gridTracks?: { columns: string[]; rows: string[] };
    gridChild?: LayoutSpec['gridChild'];
    wrap?: boolean | 'nowrap' | 'wrap' | 'wrap-reverse';
    overflow?: 'visible' | 'hidden' | 'scroll' | 'auto';
    overflowX?: 'visible' | 'hidden' | 'scroll' | 'auto';
    overflowY?: 'visible' | 'hidden' | 'scroll' | 'auto';
    objectFit?: LayoutSpec['objectFit'];
  };
  style: UIRStyleBundle;
  content?: {
    text?: BoundOrLiteral<string>;
    placeholder?: string;
    value?: string;
    options?: string[];
    checked?: boolean;
    controlType?: UIControlSubtype;
    assetId?: string;
    imageUrl?: string;
    iconName?: string;
    svgPath?: string;
    tableColumns?: string[];
    tableRows?: string[][];
    threeSceneId?: string;
    blueprintId?: string;
  };
  a11y?: {
    role?: string;
    ariaLabel?: string;
    htmlTag?: SemanticTag;
    tabIndex?: number;
  };
  mvvm?: MvvmExtensionSpec;
  controlFlow?: {
    conditional?: string;
    repeat?: { collectionExpr: string; itemVar: string; keyExpr: string };
  };
  interactions: UIRInteraction[];
  children: UIRNode[];
}

export interface UIRComponentDecl {
  id: string;
  name: string;
  sourceCanvasNodeId: NodeId;
  props: UIRPropSpec[];
  stateVars: UIRStateSpec[];
  ipcCommands: UIRIpcCommandSpec[];
  root: UIRNode;
}

export interface UIRModule {
  id: string;
  name: string;
  projectId: string;
  sheetId: string;
  tokens: UIRTokenDictionary;
  windowChrome?: UIRDesktopWindowSpec;
  customCss?: string;
  keyframesCss?: string;
  reusableClasses?: ReusableCssClass[];
  scriptModules?: UIRScriptModuleDecl[];
  components: UIRComponentDecl[];
  entryComponentId: string;
}

export interface CodeSourceMapSpan {
  canvasNodeId: NodeId;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface CodeDiagnostic {
  severity: 'info' | 'warn' | 'error';
  canvasNodeId?: NodeId;
  message: string;
}

export interface EmittedCodeFile {
  relativePath: string;
  language: string;
  code: string;
  isEntry?: boolean;
  sourceMap: CodeSourceMapSpan[];
  diagnostics: CodeDiagnostic[];
}

export interface TargetArtifactBundle {
  targetId: CodegenTargetId;
  dialect: StylingDialect;
  mode: CopyExportMode;
  entryFilePath: string;
  files: EmittedCodeFile[];
  diagnostics: CodeDiagnostic[];
  generatedAt: number;
}

export interface CodegenCompileOptions {
  targetId: CodegenTargetId;
  dialect?: StylingDialect;
  mode?: CopyExportMode;
  selectedNodeId?: NodeId | null;
  autoSolveFreeform?: boolean;
  componentNameOverride?: string;
  scriptLanguage?: 'javascript' | 'typescript';
  scriptModules?: UIRScriptModuleDecl[];
}

export interface CodegenTargetPlugin<TOptions extends CodegenCompileOptions = CodegenCompileOptions> {
  readonly descriptor: TargetDescriptor;
  lowerIR?(ir: UIRModule, opts: TOptions): UIRModule;
  emitSnippet(node: UIRNode, ir: UIRModule, opts: TOptions): EmittedCodeFile;
  emitComponent(comp: UIRComponentDecl, ir: UIRModule, opts: TOptions): TargetArtifactBundle;
  emitProjectScaffold?(ir: UIRModule, opts: TOptions): TargetArtifactBundle;
}

// ============================================================================
// BUILT-IN 26 ACTIVE TARGETS METADATA ACROSS ALL 4 TIERS
// ============================================================================

const WEB_CAPS: TargetCapabilityFlags = {
  gridLayout: true,
  backdropBlur: true,
  responsiveBreakpoints: true,
  nativeIpc: false,
  hypermediaSwap: false,
  mvvmBindings: false,
  serverComponents: false,
};

export const BUILTIN_TARGET_DESCRIPTORS: TargetDescriptor[] = [
  {
    id: 'html-vanilla',
    displayName: 'HTML5 + CSS3 + JS',
    tier: 1,
    category: 'web',
    languages: ['html', 'css', 'javascript'],
    supportedDialects: ['vanilla-css', 'tailwind'],
    defaultDialect: 'vanilla-css',
    fileExtension: '.html',
    description: 'Semantic HTML5, CSS Custom Properties (--tokens), Flexbox/Grid, clean ES2024 event controllers.',
    capabilities: WEB_CAPS,
  },
  {
    id: 'react-tsx',
    displayName: 'React 19 (TSX)',
    tier: 1,
    category: 'web',
    languages: ['typescript', 'tsx', 'css'],
    supportedDialects: ['tailwind', 'css-modules', 'vanilla-css', 'shadcn'],
    defaultDialect: 'tailwind',
    fileExtension: '.tsx',
    description: 'Typed React 19 functional components, hooks, ARIA roles, Tailwind / CSS Modules / Shadcn.',
    capabilities: WEB_CAPS,
  },
  {
    id: 'nextjs-app',
    displayName: 'Next.js 15 (App Router)',
    tier: 1,
    category: 'web',
    languages: ['typescript', 'tsx'],
    supportedDialects: ['tailwind', 'shadcn', 'css-modules'],
    defaultDialect: 'tailwind',
    fileExtension: '.tsx',
    description: 'Automatic RSC Server Component + minimal "use client" interactive islands & Server Actions.',
    capabilities: { ...WEB_CAPS, serverComponents: true },
  },
  {
    id: 'htmx',
    displayName: 'HTMX 2.x Hypermedia',
    tier: 1,
    category: 'backend-template',
    languages: ['html', 'css'],
    supportedDialects: ['tailwind', 'vanilla-css'],
    defaultDialect: 'tailwind',
    fileExtension: '.html',
    description: 'Declarative hx-get/hx-post/hx-target/hx-swap attributes + auto-extracted server swap partials.',
    capabilities: { ...WEB_CAPS, hypermediaSwap: true },
  },
  {
    id: 'svelte5',
    displayName: 'Svelte 5 (Runes)',
    tier: 1,
    category: 'web',
    languages: ['svelte', 'typescript', 'css'],
    supportedDialects: ['vanilla-css', 'tailwind'],
    defaultDialect: 'vanilla-css',
    fileExtension: '.svelte',
    description: 'Svelte 5 Runes ($props, $state, $derived), {#if}/{#each} control flow, and scoped styles.',
    capabilities: WEB_CAPS,
  },
  {
    id: 'angular',
    displayName: 'Angular 19 (Signals)',
    tier: 1,
    category: 'web',
    languages: ['typescript', 'html', 'css'],
    supportedDialects: ['vanilla-css', 'tailwind'],
    defaultDialect: 'vanilla-css',
    fileExtension: '.component.ts',
    description: 'Standalone Angular 19 components with input(), signal(), computed(), and @if/@for blocks.',
    capabilities: { ...WEB_CAPS, mvvmBindings: true },
  },
  {
    id: 'react-native',
    displayName: 'React Native / Expo',
    tier: 1,
    category: 'mobile',
    languages: ['typescript', 'tsx'],
    supportedDialects: ['vanilla-css', 'tailwind'],
    defaultDialect: 'vanilla-css',
    fileExtension: '.tsx',
    description: 'Expo / React Native View, Text, Pressable, ScrollView, StyleSheet.create & NativeWind.',
    capabilities: { ...WEB_CAPS, gridLayout: false, backdropBlur: false },
  },
  {
    id: 'electron-target',
    displayName: 'Electron Desktop App',
    tier: 1,
    category: 'desktop',
    languages: ['typescript', 'tsx', 'css'],
    supportedDialects: ['tailwind', 'vanilla-css', 'css-modules'],
    defaultDialect: 'tailwind',
    fileExtension: '.tsx',
    description: 'BrowserWindow main.ts, contextBridge sandboxed preload.ts, typed IPC channels, and Renderer UI.',
    capabilities: { ...WEB_CAPS, nativeIpc: true },
  },
  {
    id: 'tauri-v2',
    displayName: 'Tauri v2 (Rust + Web)',
    tier: 1,
    category: 'desktop',
    languages: ['rust', 'typescript', 'json'],
    supportedDialects: ['tailwind', 'vanilla-css'],
    defaultDialect: 'tailwind',
    fileExtension: '.rs',
    description: 'tauri.conf.json, v2 ACL capabilities, Rust #[tauri::command] handlers, and typed TS invoke client.',
    capabilities: { ...WEB_CAPS, nativeIpc: true },
  },
  {
    id: 'dotnet-maui',
    displayName: '.NET MAUI (XAML + C# MVVM)',
    tier: 1,
    category: 'desktop',
    languages: ['xml', 'csharp'],
    supportedDialects: ['vanilla-css'],
    defaultDialect: 'vanilla-css',
    fileExtension: '.xaml',
    description: 'Performant Grid/FlexLayout/Border XAML, Tokens ResourceDictionary, and CommunityToolkit.Mvvm ViewModel.',
    capabilities: {
      gridLayout: true,
      backdropBlur: false,
      responsiveBreakpoints: true,
      nativeIpc: true,
      hypermediaSwap: false,
      mvvmBindings: true,
      serverComponents: false,
    },
  },
  {
    id: 'vue3',
    displayName: 'Vue 3 / Nuxt (<script setup>)',
    tier: 2,
    category: 'web',
    languages: ['vue', 'typescript', 'css'],
    supportedDialects: ['tailwind', 'vanilla-css'],
    defaultDialect: 'tailwind',
    fileExtension: '.vue',
    description: 'Vue 3 Single-File Components with <script setup lang="ts">, ref(), defineProps(), and v-if/v-for.',
    capabilities: WEB_CAPS,
  },
  {
    id: 'flutter-dart',
    displayName: 'Flutter (Dart 3)',
    tier: 2,
    category: 'mobile',
    languages: ['dart'],
    supportedDialects: ['vanilla-css'],
    defaultDialect: 'vanilla-css',
    fileExtension: '.dart',
    description: 'Material 3 StatelessWidget/StatefulWidget, Row/Column/Stack/Expanded, and ThemeData.',
    capabilities: { ...WEB_CAPS, hypermediaSwap: false },
  },
  {
    id: 'swiftui',
    displayName: 'SwiftUI (Apple iOS/macOS)',
    tier: 2,
    category: 'mobile',
    languages: ['swift'],
    supportedDialects: ['vanilla-css'],
    defaultDialect: 'vanilla-css',
    fileExtension: '.swift',
    description: 'Declarative Swift 6 View structs, VStack/HStack/ZStack/LazyVGrid, @State, and #Preview.',
    capabilities: { ...WEB_CAPS, backdropBlur: true },
  },
  {
    id: 'jetpack-compose',
    displayName: 'Jetpack Compose / Multiplatform',
    tier: 2,
    category: 'mobile',
    languages: ['kotlin'],
    supportedDialects: ['vanilla-css'],
    defaultDialect: 'vanilla-css',
    fileExtension: '.kt',
    description: 'Kotlin @Composable functions, Row/Column/Box, Modifier chains, remember state, and Material 3.',
    capabilities: WEB_CAPS,
  },
  {
    id: 'avalonia-ui',
    displayName: 'Avalonia UI (.NET Cross-Platform)',
    tier: 2,
    category: 'desktop',
    languages: ['xml', 'csharp'],
    supportedDialects: ['vanilla-css'],
    defaultDialect: 'vanilla-css',
    fileExtension: '.axaml',
    description: 'Cross-platform .axaml markup with compiled bindings and C# MVVM ViewModel for Win/macOS/Linux.',
    capabilities: { ...WEB_CAPS, mvvmBindings: true, nativeIpc: true },
  },
  {
    id: 'python-customtkinter',
    displayName: 'Python CustomTkinter',
    tier: 2,
    category: 'desktop',
    languages: ['python'],
    supportedDialects: ['vanilla-css'],
    defaultDialect: 'vanilla-css',
    fileExtension: '.py',
    description: 'Modern themed Python desktop GUI classes using CTkFrame, CTkButton, CTkEntry, and grid/pack.',
    capabilities: { ...WEB_CAPS, backdropBlur: false, responsiveBreakpoints: false },
  },
  {
    id: 'python-gradio',
    displayName: 'Python Gradio (AI/Data UI)',
    tier: 2,
    category: 'web',
    languages: ['python'],
    supportedDialects: ['vanilla-css'],
    defaultDialect: 'vanilla-css',
    fileExtension: '.py',
    description: 'Gradio gr.Blocks, gr.Row, gr.Column, interactive inputs, and Python event callbacks for AI apps.',
    capabilities: WEB_CAPS,
  },
  {
    id: 'blazor-razor',
    displayName: 'Blazor / ASP.NET Core (.razor)',
    tier: 2,
    category: 'web',
    languages: ['razor', 'csharp', 'css'],
    supportedDialects: ['vanilla-css', 'tailwind'],
    defaultDialect: 'vanilla-css',
    fileExtension: '.razor',
    description: 'C# / ASP.NET Core Blazor .razor components with @page, @bind, EventCallback, and scoped .razor.css.',
    capabilities: { ...WEB_CAPS, mvvmBindings: true, serverComponents: true },
  },
  {
    id: 'python-streamlit',
    displayName: 'Python Streamlit (AI/Data App)',
    tier: 2,
    category: 'web',
    languages: ['python'],
    supportedDialects: ['vanilla-css'],
    defaultDialect: 'vanilla-css',
    fileExtension: '.py',
    description: 'Python Streamlit AI/Data dashboard app.py with st.columns, st.container, st.metric, and st.session_state.',
    capabilities: WEB_CAPS,
  },
  {
    id: 'python-pyside6',
    displayName: 'Python PySide6 (Qt 6 Widgets)',
    tier: 2,
    category: 'desktop',
    languages: ['python', 'css'],
    supportedDialects: ['vanilla-css'],
    defaultDialect: 'vanilla-css',
    fileExtension: '.py',
    description: 'Python PySide6 / Qt 6 Widgets desktop GUI with QVBoxLayout/QHBoxLayout/QGridLayout and QSS Design Tokens.',
    capabilities: { ...WEB_CAPS, backdropBlur: false, responsiveBreakpoints: false, nativeIpc: true },
  },
  {
    id: 'go-wails',
    displayName: 'Go Wails v2 (Desktop + Web)',
    tier: 2,
    category: 'desktop',
    languages: ['go', 'typescript', 'json'],
    supportedDialects: ['tailwind', 'vanilla-css'],
    defaultDialect: 'tailwind',
    fileExtension: '.go',
    description: 'Go Wails v2 desktop app with app.go bound IPC struct methods, wails.json, and typed frontend UI.',
    capabilities: { ...WEB_CAPS, nativeIpc: true },
  },
  {
    id: 'rust-slint',
    displayName: 'Rust Slint UI (.slint + .rs)',
    tier: 3,
    category: 'desktop',
    languages: ['slint', 'rust'],
    supportedDialects: ['vanilla-css'],
    defaultDialect: 'vanilla-css',
    fileExtension: '.slint',
    description: 'Declarative .slint UI hierarchy paired with zero-overhead native Rust callbacks for desktop & embedded.',
    capabilities: { ...WEB_CAPS, nativeIpc: true },
  },
  {
    id: 'cpp-qt-qml',
    displayName: 'C++ / Qt 6 Quick (QML)',
    tier: 3,
    category: 'desktop',
    languages: ['qml', 'cpp', 'cmake'],
    supportedDialects: ['vanilla-css'],
    defaultDialect: 'vanilla-css',
    fileExtension: '.qml',
    description: 'C++20 & Qt 6 Quick .qml UI with RowLayout/ColumnLayout/GridLayout, main.cpp, and CMakeLists.txt.',
    capabilities: { ...WEB_CAPS, mvvmBindings: true, nativeIpc: true },
  },
  {
    id: 'winui3-xaml',
    displayName: 'WinUI 3 (Windows App SDK)',
    tier: 3,
    category: 'desktop',
    languages: ['xml', 'csharp'],
    supportedDialects: ['vanilla-css'],
    defaultDialect: 'vanilla-css',
    fileExtension: '.xaml',
    description: 'Windows App SDK WinUI 3 XAML with MicaBackdrop, Grid/StackPanel, ThemeResource, and C# code-behind.',
    capabilities: { ...WEB_CAPS, backdropBlur: true, mvvmBindings: true, nativeIpc: true },
  },
  {
    id: 'lvgl-c',
    displayName: 'LVGL 9 Embedded C (ESP32/STM32)',
    tier: 4,
    category: 'embedded-game-tui',
    languages: ['c'],
    supportedDialects: ['vanilla-css'],
    defaultDialect: 'vanilla-css',
    fileExtension: '.c',
    description: 'Embedded C LVGL 9 screen generator (ui_screen.c/.h) with lv_obj flex layouts and styles for ESP32/STM32.',
    capabilities: {
      gridLayout: true,
      backdropBlur: false,
      responsiveBreakpoints: false,
      nativeIpc: true,
      hypermediaSwap: false,
      mvvmBindings: false,
      serverComponents: false,
    },
  },
  {
    id: 'unity-uitoolkit',
    displayName: 'Unity UI Toolkit (UXML + USS)',
    tier: 4,
    category: 'embedded-game-tui',
    languages: ['xml', 'css', 'csharp'],
    supportedDialects: ['vanilla-css'],
    defaultDialect: 'vanilla-css',
    fileExtension: '.uxml',
    description: 'Unity UI Toolkit .uxml visual hierarchy, .uss Flexbox stylesheet, and C# UIDocument controller.',
    capabilities: {
      gridLayout: false,
      backdropBlur: false,
      responsiveBreakpoints: true,
      nativeIpc: true,
      hypermediaSwap: false,
      mvvmBindings: true,
      serverComponents: false,
    },
  },
];
