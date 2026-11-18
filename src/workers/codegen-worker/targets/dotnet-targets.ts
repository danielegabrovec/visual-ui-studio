import {
  BUILTIN_TARGET_DESCRIPTORS,
  type CodegenTargetPlugin,
  type EmittedCodeFile,
  type StylingDialect,
  type UIRComponentDecl,
  type UIRModule,
  type UIRNode,
  type UIRTokenDictionary,
} from '@shared/ui-ir';
import { SourceMapWriter } from '../code-writer';
import {
  buildCssClassMap,
  buildStylesheetWithSourceMap,
  buildTailwindClasses,
  escapeDoubleQuoted,
  escapeHtml,
  escapeXmlAttr,
  getAbsoluteFrameMetrics,
  getLiteralText,
  getNodeCssClassName,
  getPrimarySolidFill,
  isAbsolutePositionedNode,
  isBoundValue,
  isFreeformHostContainer,
  resolveColorHex,
  resolveDarkColorHex,
  resolveNum,
  resolvePaddingNums,
  resolveRadiusNum,
  toCamelCase,
  toKebabCase,
  toPascalCase,
} from '../style-helpers';
import { sanitizeHandlerIdent } from './web-targets';

const mauiDescriptor = BUILTIN_TARGET_DESCRIPTORS.find((d) => d.id === 'dotnet-maui')!;
const avaloniaDescriptor = BUILTIN_TARGET_DESCRIPTORS.find((d) => d.id === 'avalonia-ui')!;
const blazorDescriptor = BUILTIN_TARGET_DESCRIPTORS.find((d) => d.id === 'blazor-razor')!;
const winui3Descriptor = BUILTIN_TARGET_DESCRIPTORS.find((d) => d.id === 'winui3-xaml')!;

interface MvvmCollectedBinding {
  properties: Map<string, { csType: string; defaultVal: string }>;
  commands: Set<string>;
}

function collectMvvmMembers(comp: UIRComponentDecl): MvvmCollectedBinding {
  const properties = new Map<string, { csType: string; defaultVal: string }>();
  const commands = new Set<string>();

  for (const sv of comp.stateVars) {
    const pName = toPascalCase(sv.name);
    if (sv.type === 'number') {
      properties.set(pName, { csType: 'int', defaultVal: String(Math.round(Number(sv.initialValue ?? 0))) });
    } else if (sv.type === 'boolean') {
      properties.set(pName, { csType: 'bool', defaultVal: sv.initialValue ? 'true' : 'false' });
    } else {
      properties.set(pName, {
        csType: 'string',
        defaultVal: `"${String(sv.initialValue ?? '').replace(/"/g, '\\"')}"`,
      });
    }
  }

  const walk = (n: UIRNode) => {
    if (n.mvvm?.bindings) {
      for (const b of Object.values(n.mvvm.bindings)) {
        const propName = toPascalCase(b.path);
        if (!properties.has(propName)) {
          const fallback = getLiteralText(n, '');
          properties.set(propName, {
            csType: 'string',
            defaultVal: `"${fallback.replace(/"/g, '\\"')}"`,
          });
        }
      }
    }
    if (n.mvvm?.command?.path) {
      commands.add(toPascalCase(n.mvvm.command.path));
    }
    for (const inter of n.interactions) {
      if (inter.type === 'MVVM_COMMAND') {
        commands.add(toPascalCase(inter.commandName));
      } else if (inter.type === 'NATIVE_IPC_CALL') {
        commands.add(`${toPascalCase(inter.commandName)}Command`);
      } else if (inter.type === 'STATE_MUTATION') {
        commands.add(`Update${toPascalCase(inter.targetState)}Command`);
      } else if (inter.type === 'SCRIPT_CALL') {
        commands.add(`${toPascalCase(inter.fnName)}Command`);
      } else if (inter.type === 'BLUEPRINT_EVENT') {
        commands.add(`Trigger${toPascalCase(inter.eventName)}Command`);
      }
    }
    if (n.controlFlow?.repeat) {
      const colProp = toPascalCase(n.controlFlow.repeat.collectionExpr);
      const samples = n.children.map((c) => `"${getLiteralText(c, 'Sample Item').replace(/"/g, '\\"')}"`);
      const itemsInit = samples.length > 0 ? samples.join(', ') : '"Item 1", "Item 2"';
      properties.set(colProp, {
        csType: 'ObservableCollection<string>',
        defaultVal: `new ObservableCollection<string> { ${itemsInit} }`,
      });
    }
    for (const c of n.children) walk(c);
  };
  walk(comp.root);

  return { properties, commands };
}

function formatMauiPadding(node: UIRNode, tokens: UIRTokenDictionary): string | null {
  const p = resolvePaddingNums(node.layout.padding, tokens);
  if (p.top === 0 && p.right === 0 && p.bottom === 0 && p.left === 0) return null;
  if (p.top === p.bottom && p.left === p.right) {
    return p.top === p.left ? `${p.top}` : `${p.left},${p.top}`;
  }
  return `${p.left},${p.top},${p.right},${p.bottom}`;
}

function mauiThemeColorAttr(attrName: string, fill: ReturnType<typeof getPrimarySolidFill>, tokens: UIRTokenDictionary): string {
  if (!fill) return '';
  const light = resolveColorHex(fill, tokens, '');
  if (!light || light === 'transparent') return '';
  const dark = resolveDarkColorHex(fill, tokens, light);
  if (dark && dark !== light) {
    return `${attrName}="{AppThemeBinding Light=${escapeXmlAttr(light)}, Dark=${escapeXmlAttr(dark)}}"`;
  }
  return `${attrName}="${escapeXmlAttr(light)}"`;
}

function convertTracksToMaui(tracks: string[] | undefined): string {
  if (!tracks || tracks.length === 0) return '*';
  return tracks
    .map((t) => {
      if (t === 'auto') return 'Auto';
      if (t.endsWith('fr')) {
        const num = parseFloat(t);
        return num === 1 || Number.isNaN(num) ? '*' : `${num}*`;
      }
      if (t.endsWith('px')) return String(Math.round(parseFloat(t)));
      return '*';
    })
    .join(', ');
}

function emitCommunityToolkitViewModel(comp: UIRComponentDecl, namespaceName: string): EmittedCodeFile {
  const { properties, commands } = collectMvvmMembers(comp);
  const w = new SourceMapWriter(4);
  w.line('using System.Collections.ObjectModel;');
  w.line('using System.Threading.Tasks;');
  w.line('using CommunityToolkit.Mvvm.ComponentModel;');
  w.line('using CommunityToolkit.Mvvm.Input;');
  w.blank();
  w.line(`namespace ${namespaceName};`);
  w.blank();
  w.line(`public partial class ${comp.name}ViewModel : ObservableObject`);
  w.line('{');
  w.indent();

  for (const [propName, meta] of properties) {
    const fieldName = `_${toCamelCase(propName)}`;
    w.line('[ObservableProperty]');
    w.line(`private ${meta.csType} ${fieldName} = ${meta.defaultVal};`);
    w.blank();
  }

  for (const cmdRaw of commands) {
    const baseMethod = cmdRaw.endsWith('Command') ? cmdRaw.slice(0, -7) : cmdRaw;
    w.line('[RelayCommand]');
    w.line(`private async Task ${baseMethod}Async()`);
    w.line('{');
    w.indent();
    w.line('await Task.CompletedTask;');
    w.dedent();
    w.line('}');
    w.blank();
  }

  w.dedent();
  w.line('}');
  return w.toEmittedFile(`ViewModels/${comp.name}ViewModel.cs`, 'csharp', false);
}

// ============================================================================
// 10. .NET MAUI (.NET 8/9 XAML + C# CommunityToolkit.Mvvm) (`dotnet-maui`)
// ============================================================================

function renderMauiNode(
  w: SourceMapWriter,
  node: UIRNode,
  ir: UIRModule,
  gridPlacementAttrs = '',
): void {
  w.withNode(node.canvasNodeId, () => {
    const gAttr = gridPlacementAttrs ? ` ${gridPlacementAttrs}` : '';
    const fill = getPrimarySolidFill(node);
    const padStr = formatMauiPadding(node, ir.tokens);
    const gap = resolveNum(node.layout.gap, ir.tokens, 0);
    const rad = resolveRadiusNum(node, ir.tokens);

    if (node.kind === 'ThreeViewport' || node.content?.controlType === 'three-viewport') {
      const sceneId = escapeXmlAttr(node.content?.threeSceneId || 'ThreeScene');
      w.line(
        `<Border StrokeShape="RoundRectangle ${rad || 12}" BackgroundColor="#0B1120"${gAttr}><Label Text="3D Viewport (${sceneId})" TextColor="#93C5FD" HorizontalOptions="Center" VerticalOptions="Center" /></Border>`,
      );
      return;
    }

    // Controls
    if (node.kind === 'Button' || node.kind === 'IconButton') {
      const label = escapeXmlAttr(getLiteralText(node, node.name));
      const bg = mauiThemeColorAttr('BackgroundColor', fill, ir.tokens);
      const tColor = node.style.typography?.color
        ? mauiThemeColorAttr('TextColor', node.style.typography.color, ir.tokens)
        : '';
      let cmdBinding = '';
      if (node.mvvm?.command?.path) {
        cmdBinding = ` Command="{Binding ${toPascalCase(node.mvvm.command.path)}}"`;
      } else {
        const ipcInter = node.interactions.find((i) => i.type === 'NATIVE_IPC_CALL');
        const stateInter = node.interactions.find((i) => i.type === 'STATE_MUTATION');
        const scriptInter = node.interactions.find((i) => i.type === 'SCRIPT_CALL');
        const bpInter = node.interactions.find((i) => i.type === 'BLUEPRINT_EVENT');
        if (ipcInter && ipcInter.type === 'NATIVE_IPC_CALL') {
          cmdBinding = ` Command="{Binding ${toPascalCase(ipcInter.commandName)}Command}"`;
        } else if (stateInter && stateInter.type === 'STATE_MUTATION') {
          cmdBinding = ` Command="{Binding Update${toPascalCase(stateInter.targetState)}Command}"`;
        } else if (scriptInter && scriptInter.type === 'SCRIPT_CALL') {
          cmdBinding = ` Command="{Binding ${toPascalCase(scriptInter.fnName)}Command}"`;
        } else if (bpInter && bpInter.type === 'BLUEPRINT_EVENT') {
          cmdBinding = ` Command="{Binding Trigger${toPascalCase(bpInter.eventName)}Command}"`;
        }
      }
      const cr = rad > 0 ? ` CornerRadius="${rad}"` : '';
      const pd = padStr ? ` Padding="${padStr}"` : '';
      w.line(
        `<Button Text="${label}"${cmdBinding}${bg ? ' ' + bg : ''}${tColor ? ' ' + tColor : ''}${cr}${pd}${gAttr} />`,
      );
      return;
    }

    if (node.kind === 'TextInput' || node.kind === 'TextArea') {
      const ph = node.content?.placeholder ? ` Placeholder="${escapeXmlAttr(node.content.placeholder)}"` : '';
      const textBind = node.mvvm?.bindings?.Text
        ? ` Text="{Binding ${toPascalCase(node.mvvm.bindings.Text.path)}, Mode=${node.mvvm.bindings.Text.mode ?? 'TwoWay'}}"`
        : '';
      const tag = node.kind === 'TextArea' ? 'Editor' : 'Entry';
      w.line(`<${tag}${ph}${textBind}${gAttr} />`);
      return;
    }

    if (node.kind === 'Switch' || node.kind === 'Checkbox') {
      const tag = node.kind === 'Switch' ? 'Switch' : 'CheckBox';
      const prop = node.kind === 'Switch' ? 'IsToggled' : 'IsChecked';
      w.line(`<${tag} ${prop}="${node.content?.checked ? 'True' : 'False'}"${gAttr} />`);
      return;
    }

    if (node.kind === 'Heading' || node.kind === 'Text' || (node.children.length === 0 && getLiteralText(node))) {
      const fs = resolveNum(node.style.typography?.fontSize, ir.tokens, 15);
      const fw = Number(node.style.typography?.fontWeight ?? 400);
      const fontAttr = fw >= 600 ? ' FontAttributes="Bold"' : '';
      const tColor = node.style.typography?.color
        ? ' ' + mauiThemeColorAttr('TextColor', node.style.typography.color, ir.tokens)
        : '';
      const textBinding = node.mvvm?.bindings?.Text
        ? `{Binding ${toPascalCase(node.mvvm.bindings.Text.path)}}`
        : escapeXmlAttr(getLiteralText(node, ''));
      w.line(`<Label Text="${textBinding}" FontSize="${fs}"${fontAttr}${tColor}${gAttr} />`);
      return;
    }

    if (node.controlFlow?.repeat) {
      const colProp = toPascalCase(node.controlFlow.repeat.collectionExpr);
      w.line(`<CollectionView ItemsSource="{Binding ${colProp}}"${gAttr}>`);
      w.indent();
      w.line('<CollectionView.ItemTemplate>');
      w.indent();
      w.line('<DataTemplate x:DataType="x:String">');
      w.indent();
      w.line('<Border StrokeShape="RoundRectangle 6" Padding="12,10" Margin="0,0,0,8">');
      w.indent();
      w.line('<Label Text="{Binding .}" FontSize="14" />');
      w.dedent();
      w.line('</Border>');
      w.dedent();
      w.line('</DataTemplate>');
      w.dedent();
      w.line('</CollectionView.ItemTemplate>');
      w.dedent();
      w.line('</CollectionView>');
      return;
    }

    // Containers: AbsoluteLayout (freeform) vs Grid vs Stack wrapped in Border when styled
    const isFreeHost = isFreeformHostContainer(node);
    const hasCardBox = Boolean(fill || node.style.base.border || rad > 0);
    const innerLayoutTag = isFreeHost
      ? 'AbsoluteLayout'
      : node.layout.mode === 'GRID'
        ? 'Grid'
        : node.layout.mode === 'ROW'
          ? 'HorizontalStackLayout'
          : 'VerticalStackLayout';

    const emitInnerContainer = (placementOnInner: string) => {
      if (innerLayoutTag === 'AbsoluteLayout') {
        const wReq = Math.max(120, Math.round(node.layout.frame.width));
        const hReq = Math.max(80, Math.round(node.layout.frame.height));
        const pd = !hasCardBox && padStr ? ` Padding="${padStr}"` : '';
        w.line(`<AbsoluteLayout MinimumWidthRequest="${wReq}" MinimumHeightRequest="${hReq}"${pd}${placementOnInner}>`);
        w.indent();
        for (const child of node.children) {
          const m = getAbsoluteFrameMetrics(child);
          const zAttr = m.zIndex !== undefined ? ` ZIndex="${m.zIndex}"` : '';
          const bounds = isAbsolutePositionedNode(child, false)
            ? `AbsoluteLayout.LayoutBounds="${m.x},${m.y},${m.width},${m.height}"${zAttr}`
            : '';
          renderMauiNode(w, child, ir, bounds);
        }
        w.dedent();
        w.line('</AbsoluteLayout>');
      } else if (innerLayoutTag === 'Grid') {
        const cols = convertTracksToMaui(node.layout.gridTracks?.columns);
        const colCount = Math.max(1, (node.layout.gridTracks?.columns ?? ['1fr']).length);
        const rowCount = Math.max(1, Math.ceil(node.children.length / colCount));
        const rows = Array.from({ length: rowCount }, () => 'Auto').join(', ');
        const sp = gap > 0 ? ` ColumnSpacing="${gap}" RowSpacing="${gap}"` : '';
        const pd = !hasCardBox && padStr ? ` Padding="${padStr}"` : '';
        w.line(`<Grid ColumnDefinitions="${cols}" RowDefinitions="${rows}"${sp}${pd}${placementOnInner}>`);
        w.indent();
        node.children.forEach((child, idx) => {
          const c = idx % colCount;
          const r = Math.floor(idx / colCount);
          const place = `Grid.Row="${r}" Grid.Column="${c}"`;
          renderMauiNode(w, child, ir, place);
        });
        w.dedent();
        w.line('</Grid>');
      } else {
        const sp = gap > 0 ? ` Spacing="${gap}"` : '';
        const pd = !hasCardBox && padStr ? ` Padding="${padStr}"` : '';
        w.line(`<${innerLayoutTag}${sp}${pd}${placementOnInner}>`);
        w.indent();
        for (const child of node.children) {
          renderMauiNode(w, child, ir, '');
        }
        w.dedent();
        w.line(`</${innerLayoutTag}>`);
      }
    };

    if (hasCardBox) {
      const bg = mauiThemeColorAttr('BackgroundColor', fill, ir.tokens);
      const stroke = node.style.base.border
        ? mauiThemeColorAttr('Stroke', node.style.base.border.color, ir.tokens) + ' StrokeThickness="1"'
        : 'StrokeThickness="0"';
      const shape = rad > 0 ? ` StrokeShape="RoundRectangle ${rad}"` : '';
      const pd = padStr ? ` Padding="${padStr}"` : '';
      w.line(`<Border${shape}${bg ? ' ' + bg : ''} ${stroke}${pd}${gAttr}>`);
      w.indent();
      emitInnerContainer('');
      w.dedent();
      w.line('</Border>');
    } else {
      emitInnerContainer(gAttr);
    }
  });
}

function buildMauiTokensResourceDictionary(tokens: UIRTokenDictionary): string {
  const w = new SourceMapWriter(4);
  w.line('<?xml version="1.0" encoding="UTF-8" ?>');
  w.line('<ResourceDictionary xmlns="http://schemas.microsoft.com/dotnet/2021/maui"');
  w.line('                    xmlns:x="http://schemas.microsoft.com/winfx/2009/xaml">');
  w.indent();
  for (const [path, c] of Object.entries(tokens.colors)) {
    const key = toPascalCase(path);
    w.line(`<Color x:Key="${key}Light">${escapeXmlAttr(c.light)}</Color>`);
    if (c.dark) {
      w.line(`<Color x:Key="${key}Dark">${escapeXmlAttr(c.dark)}</Color>`);
    }
  }
  for (const [path, sp] of Object.entries(tokens.spacing)) {
    w.line(`<x:Double x:Key="${toPascalCase(path)}">${sp}</x:Double>`);
  }
  for (const [path, rd] of Object.entries(tokens.radii)) {
    w.line(`<x:Double x:Key="${toPascalCase(path)}">${rd}</x:Double>`);
  }
  w.dedent();
  w.line('</ResourceDictionary>');
  return w.toCode();
}

export const dotnetMauiPlugin: CodegenTargetPlugin = {
  descriptor: mauiDescriptor,
  emitSnippet(node, ir) {
    const w = new SourceMapWriter(4);
    const snippetBounds = isAbsolutePositionedNode(node, false)
      ? (() => {
          const m = getAbsoluteFrameMetrics(node);
          return `AbsoluteLayout.LayoutBounds="${m.x},${m.y},${m.width},${m.height}"`;
        })()
      : '';
    renderMauiNode(w, node, ir, snippetBounds);
    return w.toEmittedFile(`${toPascalCase(node.name)}.xaml`, 'xml', true);
  },
  emitComponent(comp, ir, opts) {
    const mode = opts.mode ?? 'bundle';
    const xamlWriter = new SourceMapWriter(4);
    xamlWriter.line('<?xml version="1.0" encoding="utf-8" ?>');
    xamlWriter.line('<ContentPage xmlns="http://schemas.microsoft.com/dotnet/2021/maui"');
    xamlWriter.line('             xmlns:x="http://schemas.microsoft.com/winfx/2009/xaml"');
    xamlWriter.line('             xmlns:vm="clr-namespace:StudioApp.ViewModels"');
    xamlWriter.line(`             x:Class="StudioApp.Views.${comp.name}Page"`);
    xamlWriter.line(`             x:DataType="vm:${comp.name}ViewModel"`);
    xamlWriter.line(`             Title="${escapeXmlAttr(comp.name)}">`);
    xamlWriter.indent();
    xamlWriter.line('<ScrollView>');
    xamlWriter.indent();
    renderMauiNode(xamlWriter, comp.root, ir);
    xamlWriter.dedent();
    xamlWriter.line('</ScrollView>');
    xamlWriter.dedent();
    xamlWriter.line('</ContentPage>');

    const codeBehindWriter = new SourceMapWriter(4);
    codeBehindWriter.line('using Microsoft.Maui.Controls;');
    codeBehindWriter.line('using StudioApp.ViewModels;');
    codeBehindWriter.blank();
    codeBehindWriter.line('namespace StudioApp.Views;');
    codeBehindWriter.blank();
    codeBehindWriter.line(`public partial class ${comp.name}Page : ContentPage`);
    codeBehindWriter.line('{');
    codeBehindWriter.indent();
    codeBehindWriter.line(`public ${comp.name}Page(${comp.name}ViewModel viewModel)`);
    codeBehindWriter.line('{');
    codeBehindWriter.indent();
    codeBehindWriter.line('InitializeComponent();');
    codeBehindWriter.line('BindingContext = viewModel;');
    codeBehindWriter.dedent();
    codeBehindWriter.line('}');
    codeBehindWriter.dedent();
    codeBehindWriter.line('}');

    const entryPath = `Views/${comp.name}Page.xaml`;
    const files: EmittedCodeFile[] = [
      xamlWriter.toEmittedFile(entryPath, 'xml', true),
      emitCommunityToolkitViewModel(comp, 'StudioApp.ViewModels'),
      codeBehindWriter.toEmittedFile(`Views/${comp.name}Page.xaml.cs`, 'csharp', false),
      {
        relativePath: 'Resources/Styles/Tokens.xaml',
        language: 'xml',
        code: buildMauiTokensResourceDictionary(ir.tokens),
        sourceMap: [],
        diagnostics: [],
      },
    ];

    return {
      targetId: 'dotnet-maui',
      dialect: 'vanilla-css',
      mode,
      entryFilePath: entryPath,
      files,
      diagnostics: [],
      generatedAt: Date.now(),
    };
  },
};

// ============================================================================
// 15. AVALONIA UI 11 (`.axaml` + C# MVVM) (`avalonia-ui`)
// ============================================================================

function renderAvaloniaNode(w: SourceMapWriter, node: UIRNode, ir: UIRModule, gridAttrs = ''): void {
  w.withNode(node.canvasNodeId, () => {
    const gAttr = gridAttrs ? ` ${gridAttrs}` : '';
    const fill = getPrimarySolidFill(node);
    const bgHex = resolveColorHex(fill, ir.tokens, '');
    const rad = resolveRadiusNum(node, ir.tokens);
    const padStr = formatMauiPadding(node, ir.tokens);
    const gap = resolveNum(node.layout.gap, ir.tokens, 0);

    if (node.kind === 'ThreeViewport' || node.content?.controlType === 'three-viewport') {
      const sceneId = escapeXmlAttr(node.content?.threeSceneId || 'ThreeScene');
      w.line(
        `<Border CornerRadius="${rad || 12}" Background="#0B1120"${gAttr}><TextBlock Text="3D Viewport (${sceneId})" Foreground="#93C5FD" HorizontalAlignment="Center" VerticalAlignment="Center" /></Border>`,
      );
      return;
    }

    if (node.kind === 'Button' || node.kind === 'IconButton') {
      const label = escapeXmlAttr(getLiteralText(node, node.name));
      const bgAttr = bgHex && bgHex !== 'transparent' ? ` Background="${escapeXmlAttr(bgHex)}"` : '';
      const crAttr = rad > 0 ? ` CornerRadius="${rad}"` : '';
      let cmd = '';
      if (node.mvvm?.command?.path) {
        cmd = ` Command="{Binding ${toPascalCase(node.mvvm.command.path)}}"`;
      }
      w.line(`<Button Content="${label}"${cmd}${bgAttr}${crAttr}${gAttr} />`);
      return;
    }

    if (node.kind === 'TextInput' || node.kind === 'TextArea') {
      const wm = node.content?.placeholder ? ` Watermark="${escapeXmlAttr(node.content.placeholder)}"` : '';
      const tb = node.mvvm?.bindings?.Text
        ? ` Text="{Binding ${toPascalCase(node.mvvm.bindings.Text.path)}}"`
        : '';
      w.line(`<TextBox${wm}${tb}${gAttr} />`);
      return;
    }

    if (node.kind === 'Heading' || node.kind === 'Text' || (node.children.length === 0 && getLiteralText(node))) {
      const fs = resolveNum(node.style.typography?.fontSize, ir.tokens, 15);
      const fw = Number(node.style.typography?.fontWeight ?? 400) >= 600 ? ' FontWeight="SemiBold"' : '';
      const textVal = node.mvvm?.bindings?.Text
        ? `{Binding ${toPascalCase(node.mvvm.bindings.Text.path)}}`
        : escapeXmlAttr(getLiteralText(node, ''));
      w.line(`<TextBlock Text="${textVal}" FontSize="${fs}"${fw} TextWrapping="Wrap"${gAttr} />`);
      return;
    }

    if (node.controlFlow?.repeat) {
      const colProp = toPascalCase(node.controlFlow.repeat.collectionExpr);
      w.line(`<ItemsControl ItemsSource="{Binding ${colProp}}"${gAttr} />`);
      return;
    }

    const emitPanel = (panelAttrs: string) => {
      if (isFreeformHostContainer(node)) {
        const wPx = Math.max(120, Math.round(node.layout.frame.width));
        const hPx = Math.max(80, Math.round(node.layout.frame.height));
        w.line(`<Canvas Width="${wPx}" Height="${hPx}"${panelAttrs}>`);
        w.indent();
        for (const c of node.children) {
          const m = getAbsoluteFrameMetrics(c);
          const zAttr = m.zIndex !== undefined ? ` ZIndex="${m.zIndex}"` : '';
          const cAttrs = isAbsolutePositionedNode(c, false)
            ? `Canvas.Left="${m.x}" Canvas.Top="${m.y}" Width="${m.width}" Height="${m.height}"${zAttr}`
            : '';
          renderAvaloniaNode(w, c, ir, cAttrs);
        }
        w.dedent();
        w.line('</Canvas>');
      } else if (node.layout.mode === 'GRID') {
        const cols = convertTracksToMaui(node.layout.gridTracks?.columns);
        const colCount = Math.max(1, (node.layout.gridTracks?.columns ?? ['1fr']).length);
        const rowCount = Math.max(1, Math.ceil(node.children.length / colCount));
        const rows = Array.from({ length: rowCount }, () => 'Auto').join(', ');
        w.line(`<Grid ColumnDefinitions="${cols}" RowDefinitions="${rows}"${panelAttrs}>`);
        w.indent();
        node.children.forEach((c, idx) => {
          renderAvaloniaNode(w, c, ir, `Grid.Row="${Math.floor(idx / colCount)}" Grid.Column="${idx % colCount}"`);
        });
        w.dedent();
        w.line('</Grid>');
      } else {
        const orient = node.layout.mode === 'ROW' ? ' Orientation="Horizontal"' : '';
        const sp = gap > 0 ? ` Spacing="${gap}"` : '';
        w.line(`<StackPanel${orient}${sp}${panelAttrs}>`);
        w.indent();
        for (const c of node.children) renderAvaloniaNode(w, c, ir, '');
        w.dedent();
        w.line('</StackPanel>');
      }
    };

    if ((bgHex && bgHex !== 'transparent') || node.style.base.border || rad > 0) {
      const bgAttr = bgHex && bgHex !== 'transparent' ? ` Background="${escapeXmlAttr(bgHex)}"` : '';
      const crAttr = rad > 0 ? ` CornerRadius="${rad}"` : '';
      const pdAttr = padStr ? ` Padding="${padStr}"` : '';
      const bAttr = node.style.base.border
        ? ` BorderBrush="${escapeXmlAttr(resolveColorHex(node.style.base.border.color, ir.tokens, '#e2e8f0'))}" BorderThickness="1"`
        : '';
      w.line(`<Border${bgAttr}${bAttr}${crAttr}${pdAttr}${gAttr}>`);
      w.indent();
      emitPanel('');
      w.dedent();
      w.line('</Border>');
    } else {
      emitPanel(gAttr);
    }
  });
}

export const avaloniaUiPlugin: CodegenTargetPlugin = {
  descriptor: avaloniaDescriptor,
  emitSnippet(node, ir) {
    const w = new SourceMapWriter(2);
    const snippetCanvas = isAbsolutePositionedNode(node, false)
      ? (() => {
          const m = getAbsoluteFrameMetrics(node);
          return `Canvas.Left="${m.x}" Canvas.Top="${m.y}" Width="${m.width}" Height="${m.height}"`;
        })()
      : '';
    renderAvaloniaNode(w, node, ir, snippetCanvas);
    return w.toEmittedFile(`${toPascalCase(node.name)}.axaml`, 'xml', true);
  },
  emitComponent(comp, ir, opts) {
    const mode = opts.mode ?? 'bundle';
    const w = new SourceMapWriter(2);
    w.line('<UserControl xmlns="https://github.com/avaloniaui"');
    w.line('             xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"');
    w.line('             xmlns:vm="using:StudioAvalonia.ViewModels"');
    w.line(`             x:Class="StudioAvalonia.Views.${comp.name}View"`);
    w.line(`             x:DataType="vm:${comp.name}ViewModel">`);
    w.indent();
    w.line('<ScrollViewer>');
    w.indent();
    renderAvaloniaNode(w, comp.root, ir);
    w.dedent();
    w.line('</ScrollViewer>');
    w.dedent();
    w.line('</UserControl>');

    const entryPath = `Views/${comp.name}View.axaml`;
    const files: EmittedCodeFile[] = [
      w.toEmittedFile(entryPath, 'xml', true),
      emitCommunityToolkitViewModel(comp, 'StudioAvalonia.ViewModels'),
    ];

    return {
      targetId: 'avalonia-ui',
      dialect: 'vanilla-css',
      mode,
      entryFilePath: entryPath,
      files,
      diagnostics: [],
      generatedAt: Date.now(),
    };
  },
};

// ============================================================================
// 19. ASP.NET CORE BLAZOR (`.razor` + `.razor.css`) (`blazor-razor`)
// ============================================================================

interface BlazorHandlerSpec {
  methodName: string;
  isAsync: boolean;
  bodyLines: string[];
}

function renderBlazorSubtree(
  w: SourceMapWriter,
  node: UIRNode,
  ir: UIRModule,
  opts: {
    dialect: StylingDialect;
    classMap: ReadonlyMap<string, string>;
    handlers: Map<string, BlazorHandlerSpec>;
    boundStringProps: Set<string>;
    boundBoolProps: Set<string>;
    repeats: Map<string, string[]>;
    isRoot: boolean;
  },
): void {
  const emitNodeMarkup = () => {
    const cls =
      opts.dialect === 'tailwind'
        ? buildTailwindClasses(node, ir.tokens, opts.isRoot)
        : getNodeCssClassName(node, false, opts.classMap);

    const attrs: string[] = [];
    if (cls) attrs.push(`class="${cls}"`);
    if (node.a11y?.role) attrs.push(`role="${escapeHtml(node.a11y.role)}"`);
    if (node.a11y?.ariaLabel) attrs.push(`aria-label="${escapeHtml(node.a11y.ariaLabel)}"`);

    let clickMethodAssigned = false;
    for (const inter of node.interactions) {
      if (inter.type === 'STATE_MUTATION' && inter.trigger === 'click' && !clickMethodAssigned) {
        const prop = toPascalCase(inter.targetState);
        const method = `Handle${toPascalCase(node.name, prop)}`;
        if (!opts.handlers.has(method)) {
          const mutationLine = inter.expr.includes('+ 1')
            ? `${prop}++;`
            : `${prop} = ${inter.expr};`;
          opts.handlers.set(method, {
            methodName: method,
            isAsync: false,
            bodyLines: [mutationLine],
          });
        }
        attrs.push(`@onclick="${method}"`);
        clickMethodAssigned = true;
      } else if (inter.type === 'NATIVE_IPC_CALL' && inter.trigger === 'click' && !clickMethodAssigned) {
        const method = `On${toPascalCase(inter.commandName)}Async`;
        if (!opts.handlers.has(method)) {
          const bodyLines: string[] = [];
          if (inter.resultStateTarget) {
            bodyLines.push(`${toPascalCase(inter.resultStateTarget)} = "Dispatched ${escapeDoubleQuoted(inter.commandName)}";`);
          }
          bodyLines.push(`await OnActionInvoked.InvokeAsync("${escapeDoubleQuoted(inter.commandName)}");`);
          opts.handlers.set(method, {
            methodName: method,
            isAsync: true,
            bodyLines,
          });
        }
        attrs.push(`@onclick="${method}"`);
        clickMethodAssigned = true;
      } else if (inter.type === 'MVVM_COMMAND' && inter.trigger === 'click' && !clickMethodAssigned) {
        const method = `On${toPascalCase(inter.commandName)}Async`;
        if (!opts.handlers.has(method)) {
          opts.handlers.set(method, {
            methodName: method,
            isAsync: true,
            bodyLines: [`await OnActionInvoked.InvokeAsync("${escapeDoubleQuoted(inter.commandName)}");`],
          });
        }
        attrs.push(`@onclick="${method}"`);
        clickMethodAssigned = true;
      } else if (
        (inter.type === 'SCRIPT_CALL' || inter.type === 'BLUEPRINT_EVENT') &&
        inter.trigger === 'click' &&
        !clickMethodAssigned
      ) {
        const labelKey =
          inter.type === 'SCRIPT_CALL'
            ? sanitizeHandlerIdent(inter.fnName)
            : `Blueprint_${inter.eventName}`;
        const method = `On${toPascalCase(labelKey)}Async`;
        if (!opts.handlers.has(method)) {
          opts.handlers.set(method, {
            methodName: method,
            isAsync: true,
            bodyLines: [`await OnActionInvoked.InvokeAsync("${escapeDoubleQuoted(labelKey)}");`],
          });
        }
        attrs.push(`@onclick="${method}"`);
        clickMethodAssigned = true;
      }
    }

    const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

    if (node.kind === 'ThreeViewport' || node.content?.controlType === 'three-viewport') {
      const sceneId = escapeHtml(node.content?.threeSceneId || 'default-3d-scene');
      w.line(`<div${attrStr} data-three-viewport="${sceneId}">`);
      w.indent();
      w.line(`<canvas data-three-scene="${sceneId}" style="width: 100%; height: 100%; display: block;"></canvas>`);
      w.dedent();
      w.line('</div>');
      return;
    }

    if (node.kind === 'TextInput' || node.kind === 'TextArea') {
      const bindProp = node.mvvm?.bindings?.Text?.path
        ? toPascalCase(node.mvvm.bindings.Text.path)
        : `${toPascalCase(node.name, 'SearchQuery')}Value`;
      opts.boundStringProps.add(bindProp);
      const ph = node.content?.placeholder ? ` placeholder="${escapeHtml(node.content.placeholder)}"` : '';
      if (node.kind === 'TextArea') {
        w.line(`<textarea @bind="${bindProp}" @bind:event="oninput"${ph}${attrStr}></textarea>`);
      } else {
        w.line(`<input type="text" @bind="${bindProp}" @bind:event="oninput"${ph}${attrStr} />`);
      }
      return;
    }

    if (node.kind === 'Checkbox' || node.kind === 'Switch') {
      const bindProp = `${toPascalCase(node.name, 'IsEnabled')}Checked`;
      opts.boundBoolProps.add(bindProp);
      w.line(`<input type="checkbox" @bind="${bindProp}"${attrStr} />`);
      return;
    }

    if (node.kind === 'Divider') {
      w.line(`<hr${attrStr} />`);
      return;
    }

    const tag = node.semanticTag === 'window' ? 'main' : node.semanticTag || 'div';
    const typeAttr = tag === 'button' ? ' type="button"' : '';
    const rawText = node.content?.text;
    const textExpr = isBoundValue(rawText)
      ? `@${toPascalCase(rawText.$bind)}`
      : rawText
        ? escapeHtml(rawText)
        : '';

    if (node.controlFlow?.repeat) {
      const rep = node.controlFlow.repeat;
      const colProp = toPascalCase(rep.collectionExpr);
      const itemVar = toCamelCase(rep.itemVar, 'item');
      const samples = node.children.map((c) => getLiteralText(c, 'Catalog Item')).filter(Boolean);
      opts.repeats.set(colProp, samples.length > 0 ? samples : ['Item 1', 'Item 2']);

      const itemChildCls =
        node.children.length > 0
          ? opts.dialect === 'tailwind'
            ? buildTailwindClasses(node.children[0], ir.tokens, false)
            : getNodeCssClassName(node.children[0], false, opts.classMap)
          : '';
      const liClsAttr = itemChildCls ? ` class="${itemChildCls}"` : '';

      w.line(`<${tag}${attrStr}>`);
      w.indent();
      w.line(`@foreach (var ${itemVar} in ${colProp})`);
      w.line('{');
      w.indent();
      w.line(`<li @key="${itemVar}.Id"${liClsAttr}>@${itemVar}.Label</li>`);
      w.dedent();
      w.line('}');
      w.dedent();
      w.line(`</${tag}>`);
      return;
    }

    if (node.children.length === 0) {
      w.line(`<${tag}${typeAttr}${attrStr}>${textExpr}</${tag}>`);
      return;
    }

    w.line(`<${tag}${typeAttr}${attrStr}>`);
    w.indent();
    if (textExpr) w.line(`<span>${textExpr}</span>`);
    for (const child of node.children) {
      renderBlazorSubtree(w, child, ir, { ...opts, isRoot: false });
    }
    w.dedent();
    w.line(`</${tag}>`);
  };

  w.withNode(node.canvasNodeId, () => {
    if (node.controlFlow?.conditional) {
      const condProp = toPascalCase(node.controlFlow.conditional);
      opts.boundBoolProps.add(condProp);
      w.line(`@if (${condProp})`);
      w.line('{');
      w.indent();
      emitNodeMarkup();
      w.dedent();
      w.line('}');
    } else {
      emitNodeMarkup();
    }
  });
}

export const blazorRazorPlugin: CodegenTargetPlugin = {
  descriptor: blazorDescriptor,
  emitSnippet(node, ir, opts) {
    const dialect: StylingDialect = opts.dialect === 'tailwind' ? 'tailwind' : 'vanilla-css';
    const classMap = buildCssClassMap(node);
    const w = new SourceMapWriter(4);
    renderBlazorSubtree(w, node, ir, {
      dialect,
      classMap,
      handlers: new Map(),
      boundStringProps: new Set(),
      boundBoolProps: new Set(),
      repeats: new Map(),
      isRoot: false,
    });
    return w.toEmittedFile(`${toPascalCase(node.name)}.razor`, 'razor', true);
  },
  emitComponent(comp, ir, opts) {
    const dialect: StylingDialect = opts.dialect === 'tailwind' ? 'tailwind' : 'vanilla-css';
    const mode = opts.mode ?? 'bundle';
    const classMap = buildCssClassMap(comp.root);
    const routeSlug = toKebabCase(comp.name, 'dashboard');

    const handlers = new Map<string, BlazorHandlerSpec>();
    const boundStringProps = new Set<string>();
    const boundBoolProps = new Set<string>();
    const repeats = new Map<string, string[]>();

    const w = new SourceMapWriter(4);
    w.line(`@page "/${routeSlug}"`);
    w.line('@rendermode InteractiveServer');
    w.blank();

    renderBlazorSubtree(w, comp.root, ir, {
      dialect,
      classMap,
      handlers,
      boundStringProps,
      boundBoolProps,
      repeats,
      isRoot: true,
    });

    w.blank();
    w.line('@code {');
    w.indent();

    for (const p of comp.props) {
      const pName = toPascalCase(p.name);
      const csType = p.type === 'number' ? 'int' : p.type === 'boolean' ? 'bool' : 'string';
      const defVal =
        csType === 'string'
          ? `"${escapeDoubleQuoted(String(p.defaultValue ?? ''))}"`
          : csType === 'bool'
            ? p.defaultValue
              ? 'true'
              : 'false'
            : String(Number(p.defaultValue ?? 0));
      w.line('[Parameter]');
      w.line(`public ${csType} ${pName} { get; set; } = ${defVal};`);
      w.blank();
    }

    w.line('[Parameter]');
    w.line('public EventCallback<string> OnActionInvoked { get; set; }');
    w.blank();

    const declaredStateProps = new Set<string>();
    for (const sv of comp.stateVars) {
      const sName = toPascalCase(sv.name);
      declaredStateProps.add(sName);
      if (sv.type === 'number') {
        w.line(`private int ${sName} { get; set; } = ${Math.round(Number(sv.initialValue ?? 0))};`);
      } else if (sv.type === 'boolean') {
        w.line(`private bool ${sName} { get; set; } = ${sv.initialValue ? 'true' : 'false'};`);
      } else {
        w.line(`private string ${sName} { get; set; } = "${escapeDoubleQuoted(String(sv.initialValue ?? ''))}";`);
      }
    }

    for (const strProp of boundStringProps) {
      if (!declaredStateProps.has(strProp)) {
        declaredStateProps.add(strProp);
        w.line(`private string ${strProp} { get; set; } = string.Empty;`);
      }
    }
    for (const boolProp of boundBoolProps) {
      if (!declaredStateProps.has(boolProp)) {
        declaredStateProps.add(boolProp);
        w.line(`private bool ${boolProp} { get; set; }`);
      }
    }

    if (repeats.size > 0) {
      w.blank();
      w.line('private sealed record CatalogItem(string Id, string Label);');
      for (const [colProp, samples] of repeats) {
        const itemsInit = samples
          .map((s, idx) => `new("${idx + 1}", "${escapeDoubleQuoted(s)}")`)
          .join(', ');
        w.line(`private List<CatalogItem> ${colProp} { get; } = [${itemsInit}];`);
      }
    }

    for (const h of handlers.values()) {
      w.blank();
      w.line(`private ${h.isAsync ? 'async Task' : 'void'} ${h.methodName}()`);
      w.line('{');
      w.indent();
      for (const line of h.bodyLines) {
        w.line(line);
      }
      w.dedent();
      w.line('}');
    }

    w.dedent();
    w.line('}');

    const entryPath = `Pages/${comp.name}.razor`;
    const files: EmittedCodeFile[] = [w.toEmittedFile(entryPath, 'razor', true)];

    if (dialect === 'vanilla-css') {
      const cssBuilt = buildStylesheetWithSourceMap(comp.root, ir.tokens, {
        includeTokensRoot: true,
        classMap,
        customCss: ir.customCss,
      });
      files.push({
        relativePath: `Pages/${comp.name}.razor.css`,
        language: 'css',
        code: cssBuilt.code,
        sourceMap: cssBuilt.sourceMap,
        diagnostics: [],
      });
    }

    return {
      targetId: 'blazor-razor',
      dialect,
      mode,
      entryFilePath: entryPath,
      files,
      diagnostics: [],
      generatedAt: Date.now(),
    };
  },
};

// ============================================================================
// 24. WINUI 3 / WINDOWS APP SDK (`MainWindow.xaml` + `MainWindow.xaml.cs`) (`winui3-xaml`)
// ============================================================================

interface WinUiClickSpec {
  handlerName: string;
  bodyLines: string[];
}

function resolveWinUiBrushExpr(node: UIRNode, ir: UIRModule): string {
  const fill = getPrimarySolidFill(node);
  if (!fill) return '';
  if (typeof fill === 'object' && '$token' in fill) {
    if (fill.$token.includes('surface')) {
      return '{ThemeResource CardBackgroundFillColorDefaultBrush}';
    }
    if (fill.$token.includes('muted')) {
      return '{ThemeResource CardBackgroundFillColorSecondaryBrush}';
    }
    if (fill.$token.includes('canvas')) {
      return '{ThemeResource ApplicationPageBackgroundThemeBrush}';
    }
  }
  const hex = resolveColorHex(fill, ir.tokens, '');
  return hex && hex !== 'transparent' ? escapeXmlAttr(hex) : '';
}

function renderWinUi3Node(
  w: SourceMapWriter,
  node: UIRNode,
  ir: UIRModule,
  ctx: {
    clickHandlers: Map<string, WinUiClickSpec>;
    boundProps: Map<string, string>;
    repeatCollections: Map<string, string[]>;
  },
  gridAttrs = '',
): void {
  w.withNode(node.canvasNodeId, () => {
    const gAttr = gridAttrs ? ` ${gridAttrs}` : '';
    const padStr = formatMauiPadding(node, ir.tokens);
    const gap = resolveNum(node.layout.gap, ir.tokens, 0);
    const rad = resolveRadiusNum(node, ir.tokens);

    if (node.kind === 'ThreeViewport' || node.content?.controlType === 'three-viewport') {
      const sceneId = escapeXmlAttr(node.content?.threeSceneId || 'ThreeScene');
      w.line(
        `<Border CornerRadius="${rad || 12}" Background="#0B1120"${gAttr}><TextBlock Text="3D Viewport (${sceneId})" HorizontalAlignment="Center" VerticalAlignment="Center" /></Border>`,
      );
      return;
    }

    if (node.kind === 'Button' || node.kind === 'IconButton') {
      const label = escapeXmlAttr(getLiteralText(node, node.name));
      const handlerName = `On${toPascalCase(node.name, 'Action')}Click`;
      const isPrimary = !node.style.base.border;
      const styleAttr = isPrimary ? ' Style="{StaticResource AccentButtonStyle}"' : '';
      const crAttr = rad > 0 ? ` CornerRadius="${rad}"` : '';
      const pdAttr = padStr ? ` Padding="${padStr}"` : '';

      const bodyLines: string[] = [];
      for (const inter of node.interactions) {
        if (inter.type === 'STATE_MUTATION' && inter.expr.includes('+ 1')) {
          bodyLines.push(`${toPascalCase(inter.targetState)}++;`);
        } else if (inter.type === 'NATIVE_IPC_CALL') {
          if (inter.resultStateTarget) {
            bodyLines.push(`${toPascalCase(inter.resultStateTarget)} = "Executed ${escapeDoubleQuoted(inter.commandName)}";`);
          }
        }
      }
      if (bodyLines.length === 0) {
        bodyLines.push(`System.Diagnostics.Debug.WriteLine("${escapeDoubleQuoted(handlerName)} invoked");`);
      }
      ctx.clickHandlers.set(handlerName, { handlerName, bodyLines });

      w.line(`<Button Content="${label}" Click="${handlerName}"${styleAttr}${crAttr}${pdAttr}${gAttr} />`);
      return;
    }

    if (node.kind === 'TextInput' || node.kind === 'TextArea') {
      const ph = node.content?.placeholder ? ` PlaceholderText="${escapeXmlAttr(node.content.placeholder)}"` : '';
      const propName = node.mvvm?.bindings?.Text?.path
        ? toPascalCase(node.mvvm.bindings.Text.path)
        : 'SearchQuery';
      ctx.boundProps.set(propName, '""');
      const acceptsReturn = node.kind === 'TextArea' ? ' AcceptsReturn="True"' : '';
      w.line(
        `<TextBox${ph} Text="{x:Bind ${propName}, Mode=TwoWay, UpdateSourceTrigger=PropertyChanged}"${acceptsReturn}${gAttr} />`,
      );
      return;
    }

    if (node.kind === 'Switch') {
      w.line(`<ToggleSwitch IsOn="${node.content?.checked ? 'True' : 'False'}"${gAttr} />`);
      return;
    }

    if (node.kind === 'Checkbox') {
      w.line(`<CheckBox IsChecked="${node.content?.checked ? 'True' : 'False'}"${gAttr} />`);
      return;
    }

    if (node.kind === 'Heading' || node.kind === 'Text' || (node.children.length === 0 && getLiteralText(node))) {
      const fs = resolveNum(node.style.typography?.fontSize, ir.tokens, 15);
      const fwNum = Number(node.style.typography?.fontWeight ?? 400);
      const fwAttr = fwNum >= 700 ? ' FontWeight="Bold"' : fwNum >= 600 ? ' FontWeight="SemiBold"' : '';
      const fgBrush =
        fs <= 14 && fwNum < 600
          ? '{ThemeResource TextFillColorSecondaryBrush}'
          : '{ThemeResource TextFillColorPrimaryBrush}';
      const textVal = node.mvvm?.bindings?.Text
        ? `{x:Bind ${toPascalCase(node.mvvm.bindings.Text.path)}, Mode=OneWay}`
        : escapeXmlAttr(getLiteralText(node, ''));
      if (node.mvvm?.bindings?.Text) {
        const bProp = toPascalCase(node.mvvm.bindings.Text.path);
        ctx.boundProps.set(bProp, `"${escapeDoubleQuoted(getLiteralText(node, ''))}"`);
      }
      w.line(`<TextBlock Text="${textVal}" FontSize="${fs}"${fwAttr} Foreground="${fgBrush}" TextWrapping="Wrap"${gAttr} />`);
      return;
    }

    if (node.controlFlow?.repeat) {
      const colProp = toPascalCase(node.controlFlow.repeat.collectionExpr);
      const samples = node.children.map((c) => getLiteralText(c, 'Sample Item')).filter(Boolean);
      ctx.repeatCollections.set(colProp, samples.length > 0 ? samples : ['Item 1', 'Item 2']);
      w.line(`<ListView ItemsSource="{x:Bind ${colProp}}" SelectionMode="None"${gAttr} />`);
      return;
    }

    const bgBrush = resolveWinUiBrushExpr(node, ir);
    const hasBorderOrCard = Boolean(bgBrush || node.style.base.border || rad > 0);

    const emitPanel = (placement: string) => {
      if (isFreeformHostContainer(node)) {
        const wPx = Math.max(120, Math.round(node.layout.frame.width));
        const hPx = Math.max(80, Math.round(node.layout.frame.height));
        w.line(`<Canvas Width="${wPx}" Height="${hPx}"${placement}>`);
        w.indent();
        for (const child of node.children) {
          const m = getAbsoluteFrameMetrics(child);
          const zAttr = m.zIndex !== undefined ? ` Canvas.ZIndex="${m.zIndex}"` : '';
          const cAttrs = isAbsolutePositionedNode(child, false)
            ? `Canvas.Left="${m.x}" Canvas.Top="${m.y}" Width="${m.width}" Height="${m.height}"${zAttr}`
            : '';
          renderWinUi3Node(w, child, ir, ctx, cAttrs);
        }
        w.dedent();
        w.line('</Canvas>');
      } else if (node.layout.mode === 'GRID') {
        const cols = convertTracksToMaui(node.layout.gridTracks?.columns);
        const colCount = Math.max(1, (node.layout.gridTracks?.columns ?? ['1fr']).length);
        const rowCount = Math.max(1, Math.ceil(node.children.length / colCount));
        const rows = Array.from({ length: rowCount }, () => 'Auto').join(', ');
        const sp = gap > 0 ? ` ColumnSpacing="${gap}" RowSpacing="${gap}"` : '';
        const pd = !hasBorderOrCard && padStr ? ` Padding="${padStr}"` : '';
        w.line(`<Grid ColumnDefinitions="${cols}" RowDefinitions="${rows}"${sp}${pd}${placement}>`);
        w.indent();
        node.children.forEach((child, idx) => {
          renderWinUi3Node(w, child, ir, ctx, `Grid.Row="${Math.floor(idx / colCount)}" Grid.Column="${idx % colCount}"`);
        });
        w.dedent();
        w.line('</Grid>');
      } else {
        const orient = node.layout.mode === 'ROW' ? ' Orientation="Horizontal"' : '';
        const sp = gap > 0 ? ` Spacing="${gap}"` : '';
        const pd = !hasBorderOrCard && padStr ? ` Padding="${padStr}"` : '';
        w.line(`<StackPanel${orient}${sp}${pd}${placement}>`);
        w.indent();
        for (const child of node.children) {
          renderWinUi3Node(w, child, ir, ctx, '');
        }
        w.dedent();
        w.line('</StackPanel>');
      }
    };

    if (hasBorderOrCard) {
      const bgAttr = bgBrush ? ` Background="${bgBrush}"` : '';
      const borderAttr = node.style.base.border
        ? ' BorderBrush="{ThemeResource CardStrokeColorDefaultBrush}" BorderThickness="1"'
        : '';
      const crAttr = rad > 0 ? ` CornerRadius="${rad}"` : '';
      const pdAttr = padStr ? ` Padding="${padStr}"` : '';
      w.line(`<Border${bgAttr}${borderAttr}${crAttr}${pdAttr}${gAttr}>`);
      w.indent();
      emitPanel('');
      w.dedent();
      w.line('</Border>');
    } else {
      emitPanel(gAttr);
    }
  });
}

function buildWinUiTokensDictionary(tokens: UIRTokenDictionary): string {
  const w = new SourceMapWriter(4);
  w.line('<ResourceDictionary');
  w.line('    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"');
  w.line('    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">');
  w.indent();
  w.line('<ResourceDictionary.ThemeDictionaries>');
  w.indent();
  w.line('<ResourceDictionary x:Key="Light">');
  w.indent();
  for (const [path, c] of Object.entries(tokens.colors)) {
    w.line(`<SolidColorBrush x:Key="${toPascalCase(path)}Brush" Color="${escapeXmlAttr(c.light)}" />`);
  }
  w.dedent();
  w.line('</ResourceDictionary>');
  w.line('<ResourceDictionary x:Key="Dark">');
  w.indent();
  for (const [path, c] of Object.entries(tokens.colors)) {
    w.line(`<SolidColorBrush x:Key="${toPascalCase(path)}Brush" Color="${escapeXmlAttr(c.dark ?? c.light)}" />`);
  }
  w.dedent();
  w.line('</ResourceDictionary>');
  w.dedent();
  w.line('</ResourceDictionary.ThemeDictionaries>');
  w.dedent();
  w.line('</ResourceDictionary>');
  return w.toCode();
}

export const winui3XamlPlugin: CodegenTargetPlugin = {
  descriptor: winui3Descriptor,
  emitSnippet(node, ir) {
    const w = new SourceMapWriter(4);
    const snippetCanvas = isAbsolutePositionedNode(node, false)
      ? (() => {
          const m = getAbsoluteFrameMetrics(node);
          return `Canvas.Left="${m.x}" Canvas.Top="${m.y}" Width="${m.width}" Height="${m.height}"`;
        })()
      : '';
    renderWinUi3Node(
      w,
      node,
      ir,
      {
        clickHandlers: new Map(),
        boundProps: new Map(),
        repeatCollections: new Map(),
      },
      snippetCanvas,
    );
    return w.toEmittedFile(`${toPascalCase(node.name)}.xaml`, 'xml', true);
  },
  emitComponent(comp, ir, opts) {
    const mode = opts.mode ?? 'bundle';
    const ctx = {
      clickHandlers: new Map<string, WinUiClickSpec>(),
      boundProps: new Map<string, string>(),
      repeatCollections: new Map<string, string[]>(),
    };

    const backdropTag = ir.windowChrome?.backdrop === 'acrylic' ? 'DesktopAcrylicBackdrop' : 'MicaBackdrop';
    const winTitle = ir.windowChrome?.title ?? comp.name;
    const winW = ir.windowChrome?.width ?? 1120;
    const winH = ir.windowChrome?.height ?? 820;

    const xamlWriter = new SourceMapWriter(4);
    xamlWriter.line('<Window');
    xamlWriter.line('    x:Class="StudioWinUI.MainWindow"');
    xamlWriter.line('    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"');
    xamlWriter.line('    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"');
    xamlWriter.line('    xmlns:d="http://schemas.microsoft.com/expression/blend/2008"');
    xamlWriter.line('    xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"');
    xamlWriter.line('    mc:Ignorable="d"');
    xamlWriter.line(`    Title="${escapeXmlAttr(winTitle)}">`);
    xamlWriter.indent();
    xamlWriter.line('<Window.SystemBackdrop>');
    xamlWriter.indent();
    xamlWriter.line(`<${backdropTag} />`);
    xamlWriter.dedent();
    xamlWriter.line('</Window.SystemBackdrop>');
    xamlWriter.blank();
    xamlWriter.line('<ScrollViewer Background="{ThemeResource ApplicationPageBackgroundThemeBrush}">');
    xamlWriter.indent();
    renderWinUi3Node(xamlWriter, comp.root, ir, ctx);
    xamlWriter.dedent();
    xamlWriter.line('</ScrollViewer>');
    xamlWriter.dedent();
    xamlWriter.line('</Window>');

    const csWriter = new SourceMapWriter(4);
    csWriter.line('using System.Collections.ObjectModel;');
    csWriter.line('using System.ComponentModel;');
    csWriter.line('using System.Runtime.CompilerServices;');
    csWriter.line('using Microsoft.UI.Xaml;');
    csWriter.line('using Windows.Graphics;');
    csWriter.blank();
    csWriter.line('namespace StudioWinUI;');
    csWriter.blank();
    csWriter.line('public sealed partial class MainWindow : Window, INotifyPropertyChanged');
    csWriter.line('{');
    csWriter.indent();
    csWriter.line('public event PropertyChangedEventHandler? PropertyChanged;');
    csWriter.blank();

    const declaredProps = new Set<string>();
    for (const sv of comp.stateVars) {
      const pName = toPascalCase(sv.name);
      const fName = `_${toCamelCase(pName)}`;
      declaredProps.add(pName);
      const csType = sv.type === 'number' ? 'int' : sv.type === 'boolean' ? 'bool' : 'string';
      const initVal =
        csType === 'int'
          ? String(Math.round(Number(sv.initialValue ?? 0)))
          : csType === 'bool'
            ? sv.initialValue
              ? 'true'
              : 'false'
            : `"${escapeDoubleQuoted(String(sv.initialValue ?? ''))}"`;
      csWriter.line(`private ${csType} ${fName} = ${initVal};`);
      csWriter.line(`public ${csType} ${pName}`);
      csWriter.line('{');
      csWriter.indent();
      csWriter.line(`get => ${fName};`);
      csWriter.line(`set { if (${fName} != value) { ${fName} = value; OnPropertyChanged(); } }`);
      csWriter.dedent();
      csWriter.line('}');
      csWriter.blank();
    }

    for (const [bProp, defLiteral] of ctx.boundProps) {
      if (declaredProps.has(bProp)) continue;
      declaredProps.add(bProp);
      const fName = `_${toCamelCase(bProp)}`;
      csWriter.line(`private string ${fName} = ${defLiteral};`);
      csWriter.line(`public string ${bProp}`);
      csWriter.line('{');
      csWriter.indent();
      csWriter.line(`get => ${fName};`);
      csWriter.line(`set { if (${fName} != value) { ${fName} = value; OnPropertyChanged(); } }`);
      csWriter.dedent();
      csWriter.line('}');
      csWriter.blank();
    }

    for (const [colProp, samples] of ctx.repeatCollections) {
      const items = samples.map((s) => `"${escapeDoubleQuoted(s)}"`).join(', ');
      csWriter.line(`public ObservableCollection<string> ${colProp} { get; } = new() { ${items} };`);
      csWriter.blank();
    }

    csWriter.line('public MainWindow()');
    csWriter.line('{');
    csWriter.indent();
    csWriter.line('InitializeComponent();');
    csWriter.line('ExtendsContentIntoTitleBar = true;');
    csWriter.line(`AppWindow.Resize(new SizeInt32(${winW}, ${winH}));`);
    csWriter.dedent();
    csWriter.line('}');

    for (const handler of ctx.clickHandlers.values()) {
      csWriter.blank();
      csWriter.line(`private void ${handler.handlerName}(object sender, RoutedEventArgs e)`);
      csWriter.line('{');
      csWriter.indent();
      for (const line of handler.bodyLines) {
        csWriter.line(line);
      }
      csWriter.dedent();
      csWriter.line('}');
    }

    csWriter.blank();
    csWriter.line('private void OnPropertyChanged([CallerMemberName] string? propertyName = null)');
    csWriter.line('{');
    csWriter.indent();
    csWriter.line('PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));');
    csWriter.dedent();
    csWriter.line('}');
    csWriter.dedent();
    csWriter.line('}');

    const entryPath = 'MainWindow.xaml';
    const files: EmittedCodeFile[] = [
      xamlWriter.toEmittedFile(entryPath, 'xml', true),
      csWriter.toEmittedFile('MainWindow.xaml.cs', 'csharp', false),
      {
        relativePath: 'Styles/DesignTokens.xaml',
        language: 'xml',
        code: buildWinUiTokensDictionary(ir.tokens),
        sourceMap: [],
        diagnostics: [],
      },
    ];

    return {
      targetId: 'winui3-xaml',
      dialect: 'vanilla-css',
      mode,
      entryFilePath: entryPath,
      files,
      diagnostics: [],
      generatedAt: Date.now(),
    };
  },
};
