import type {
  CodegenTargetId,
  CodegenTargetPlugin,
  EmittedCodeFile,
  TargetDescriptor,
  UIRModule,
} from '@shared/ui-ir';
import { toKebabCase, toPascalCase } from './style-helpers';
import { angularPlugin } from './targets/angular-target';
import {
  electronTargetPlugin,
  goWailsPlugin,
  tauriV2Plugin,
} from './targets/desktop-web-targets';
import {
  avaloniaUiPlugin,
  blazorRazorPlugin,
  dotnetMauiPlugin,
  winui3XamlPlugin,
} from './targets/dotnet-targets';
import {
  flutterDartPlugin,
  jetpackComposePlugin,
  reactNativePlugin,
  swiftUiPlugin,
} from './targets/mobile-native-targets';
import {
  cppQtQmlPlugin,
  lvglCPlugin,
  unityUiToolkitPlugin,
} from './targets/native-embedded-targets';
import {
  pythonCustomTkinterPlugin,
  pythonGradioPlugin,
  pythonPySide6Plugin,
  pythonStreamlitPlugin,
  rustSlintPlugin,
} from './targets/python-rust-targets';
import {
  htmxPlugin,
  htmlVanillaPlugin,
  nextjsAppPlugin,
  reactTsxPlugin,
  svelte5Plugin,
  vue3Plugin,
} from './targets/web-targets';

export class CodegenPluginRegistry {
  private readonly plugins = new Map<CodegenTargetId, CodegenTargetPlugin>();

  register(plugin: CodegenTargetPlugin): void {
    this.plugins.set(plugin.descriptor.id, plugin);
  }

  get(targetId: CodegenTargetId): CodegenTargetPlugin | undefined {
    return this.plugins.get(targetId);
  }

  getOrThrow(targetId: CodegenTargetId): CodegenTargetPlugin {
    const found = this.plugins.get(targetId);
    if (!found) {
      throw new Error(
        `Unsupported codegen target "${targetId}". Registered targets: ${Array.from(this.plugins.keys()).join(', ')}`,
      );
    }
    return found;
  }

  listDescriptors(): TargetDescriptor[] {
    return Array.from(this.plugins.values()).map((p) => p.descriptor);
  }
}

export function createDefaultPluginRegistry(): CodegenPluginRegistry {
  const reg = new CodegenPluginRegistry();

  // Tier 1 — 10 Core Web, Mobile & Desktop Targets
  reg.register(htmlVanillaPlugin);
  reg.register(reactTsxPlugin);
  reg.register(nextjsAppPlugin);
  reg.register(htmxPlugin);
  reg.register(svelte5Plugin);
  reg.register(angularPlugin);
  reg.register(reactNativePlugin);
  reg.register(electronTargetPlugin);
  reg.register(tauriV2Plugin);
  reg.register(dotnetMauiPlugin);

  // Tier 2 — 11 High-Value Multi-Language Web, Mobile, Desktop & AI Targets
  reg.register(vue3Plugin);
  reg.register(blazorRazorPlugin);
  reg.register(flutterDartPlugin);
  reg.register(swiftUiPlugin);
  reg.register(jetpackComposePlugin);
  reg.register(avaloniaUiPlugin);
  reg.register(pythonCustomTkinterPlugin);
  reg.register(pythonGradioPlugin);
  reg.register(pythonStreamlitPlugin);
  reg.register(pythonPySide6Plugin);
  reg.register(goWailsPlugin);

  // Tier 3 — 3 Native Systems & OS Desktop Frameworks
  reg.register(rustSlintPlugin);
  reg.register(cppQtQmlPlugin);
  reg.register(winui3XamlPlugin);

  // Tier 4 — 2 Embedded MCU & Game Engine UI Frameworks
  reg.register(lvglCPlugin);
  reg.register(unityUiToolkitPlugin);

  return reg;
}

export function buildScaffoldExtraFiles(targetId: CodegenTargetId, ir: UIRModule): EmittedCodeFile[] {
  const slug = toKebabCase(ir.name, 'studio-export');
  const pascalName = toPascalCase(ir.name, 'StudioApp');
  const extras: EmittedCodeFile[] = [];

  switch (targetId) {
    case 'react-tsx':
    case 'vue3':
    case 'svelte5':
    case 'angular':
    case 'nextjs-app':
    case 'electron-target':
    case 'react-native':
      extras.push({
        relativePath: 'package.json',
        language: 'json',
        code:
          JSON.stringify(
            {
              name: slug,
              version: '0.1.0',
              private: true,
              scripts: {
                dev: targetId === 'nextjs-app' ? 'next dev' : 'vite',
                build: targetId === 'nextjs-app' ? 'next build' : 'vite build',
              },
            },
            null,
            2,
          ) + '\n',
        sourceMap: [],
        diagnostics: [],
      });
      break;

    case 'tauri-v2':
      extras.push({
        relativePath: 'src-tauri/Cargo.toml',
        language: 'toml',
        code: `[package]\nname = "${slug.replace(/-/g, '_')}"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\ntauri = { version = "2", features = [] }\nserde = { version = "1", features = ["derive"] }\nserde_json = "1"\n`,
        sourceMap: [],
        diagnostics: [],
      });
      break;

    case 'go-wails':
      extras.push({
        relativePath: 'go.mod',
        language: 'go',
        code: `module ${slug.replace(/-/g, '')}\n\ngo 1.22\n\nrequire github.com/wailsapp/wails/v2 v2.9.2\n`,
        sourceMap: [],
        diagnostics: [],
      });
      extras.push({
        relativePath: 'frontend/package.json',
        language: 'json',
        code:
          JSON.stringify(
            {
              name: `${slug}-frontend`,
              private: true,
              version: '0.1.0',
              scripts: { dev: 'vite', build: 'vite build' },
            },
            null,
            2,
          ) + '\n',
        sourceMap: [],
        diagnostics: [],
      });
      break;

    case 'rust-slint':
      extras.push({
        relativePath: 'Cargo.toml',
        language: 'toml',
        code: `[package]\nname = "${slug.replace(/-/g, '_')}"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nslint = "1.9"\n\n[build-dependencies]\nslint-build = "1.9"\n`,
        sourceMap: [],
        diagnostics: [],
      });
      break;

    case 'dotnet-maui':
    case 'avalonia-ui':
      extras.push({
        relativePath: `${pascalName}.csproj`,
        language: 'xml',
        code: `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net9.0</TargetFramework>\n    <Nullable>enable</Nullable>\n    <ImplicitUsings>enable</ImplicitUsings>\n  </PropertyGroup>\n  <ItemGroup>\n    <PackageReference Include="CommunityToolkit.Mvvm" Version="8.4.0" />\n  </ItemGroup>\n</Project>\n`,
        sourceMap: [],
        diagnostics: [],
      });
      break;

    case 'blazor-razor':
      extras.push({
        relativePath: `${pascalName}.csproj`,
        language: 'xml',
        code: `<Project Sdk="Microsoft.NET.Sdk.Web">\n  <PropertyGroup>\n    <TargetFramework>net9.0</TargetFramework>\n    <Nullable>enable</Nullable>\n    <ImplicitUsings>enable</ImplicitUsings>\n  </PropertyGroup>\n</Project>\n`,
        sourceMap: [],
        diagnostics: [],
      });
      extras.push({
        relativePath: 'Program.cs',
        language: 'csharp',
        code: `var builder = WebApplication.CreateBuilder(args);\nbuilder.Services.AddRazorComponents().AddInteractiveServerComponents();\n\nvar app = builder.Build();\napp.UseStaticFiles();\napp.UseAntiforgery();\napp.MapRazorComponents<object>().AddInteractiveServerRenderMode();\napp.Run();\n`,
        sourceMap: [],
        diagnostics: [],
      });
      break;

    case 'winui3-xaml':
      extras.push({
        relativePath: `${pascalName}.csproj`,
        language: 'xml',
        code: `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <OutputType>WinExe</OutputType>\n    <TargetFramework>net8.0-windows10.0.19041.0</TargetFramework>\n    <RootNamespace>StudioWinUI</RootNamespace>\n    <UseWinUI>true</UseWinUI>\n    <Nullable>enable</Nullable>\n  </PropertyGroup>\n  <ItemGroup>\n    <PackageReference Include="Microsoft.WindowsAppSDK" Version="1.6.241114003" />\n  </ItemGroup>\n</Project>\n`,
        sourceMap: [],
        diagnostics: [],
      });
      extras.push({
        relativePath: 'App.xaml',
        language: 'xml',
        code: `<Application\n    x:Class="StudioWinUI.App"\n    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"\n    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">\n    <Application.Resources>\n        <ResourceDictionary>\n            <ResourceDictionary.MergedDictionaries>\n                <XamlControlsResources xmlns="using:Microsoft.UI.Xaml.Controls" />\n                <ResourceDictionary Source="ms-appx:///Styles/DesignTokens.xaml" />\n            </ResourceDictionary.MergedDictionaries>\n        </ResourceDictionary>\n    </Application.Resources>\n</Application>\n`,
        sourceMap: [],
        diagnostics: [],
      });
      break;

    case 'flutter-dart':
      extras.push({
        relativePath: 'pubspec.yaml',
        language: 'yaml',
        code: `name: ${slug.replace(/-/g, '_')}\ndescription: Generated by Visual UI Studio\nversion: 0.1.0\nenvironment:\n  sdk: ">=3.4.0 <4.0.0"\ndependencies:\n  flutter:\n    sdk: flutter\n`,
        sourceMap: [],
        diagnostics: [],
      });
      break;

    case 'python-customtkinter':
    case 'python-gradio':
      extras.push({
        relativePath: 'pyproject.toml',
        language: 'toml',
        code: `[project]\nname = "${slug}"\nversion = "0.1.0"\nrequires-python = ">=3.10"\ndependencies = [\n  "${targetId === 'python-gradio' ? 'gradio>=5.0.0' : 'customtkinter>=5.2.2'}"\n]\n`,
        sourceMap: [],
        diagnostics: [],
      });
      break;

    case 'python-streamlit': {
      const primaryColor = ir.tokens.colors['color.primary.600']?.light ?? '#2563eb';
      const bgColor = ir.tokens.colors['color.bg.canvas']?.light ?? '#f8fafc';
      const secBgColor = ir.tokens.colors['color.bg.surface']?.light ?? '#ffffff';
      const textColor = ir.tokens.colors['color.text.primary']?.light ?? '#0f172a';
      extras.push({
        relativePath: 'requirements.txt',
        language: 'plaintext',
        code: 'streamlit>=1.41.0\npandas>=2.2.0\n',
        sourceMap: [],
        diagnostics: [],
      });
      extras.push({
        relativePath: '.streamlit/config.toml',
        language: 'toml',
        code: `[theme]\nprimaryColor = "${primaryColor}"\nbackgroundColor = "${bgColor}"\nsecondaryBackgroundColor = "${secBgColor}"\ntextColor = "${textColor}"\n`,
        sourceMap: [],
        diagnostics: [],
      });
      break;
    }

    case 'python-pyside6':
      extras.push({
        relativePath: 'requirements.txt',
        language: 'plaintext',
        code: 'PySide6>=6.8.0\n',
        sourceMap: [],
        diagnostics: [],
      });
      extras.push({
        relativePath: 'pyproject.toml',
        language: 'toml',
        code: `[project]\nname = "${slug}"\nversion = "0.1.0"\nrequires-python = ">=3.10"\ndependencies = [\n  "PySide6>=6.8.0"\n]\n`,
        sourceMap: [],
        diagnostics: [],
      });
      break;

    case 'cpp-qt-qml':
      extras.push({
        relativePath: 'CMakePresets.json',
        language: 'json',
        code:
          JSON.stringify(
            {
              version: 3,
              configurePresets: [
                {
                  name: 'default',
                  generator: 'Ninja',
                  binaryDir: '${sourceDir}/build',
                },
              ],
            },
            null,
            2,
          ) + '\n',
        sourceMap: [],
        diagnostics: [],
      });
      break;

    case 'lvgl-c':
      extras.push({
        relativePath: 'CMakeLists.txt',
        language: 'cmake',
        code: `idf_component_register(\n    SRCS "ui_screen.c"\n    INCLUDE_DIRS "."\n    REQUIRES lvgl\n)\n`,
        sourceMap: [],
        diagnostics: [],
      });
      extras.push({
        relativePath: 'lv_conf.h',
        language: 'c',
        code: `#ifndef LV_CONF_H\n#define LV_CONF_H\n\n#define LV_COLOR_DEPTH 16\n#define LV_USE_FLEX 1\n#define LV_USE_GRID 1\n#define LV_USE_LABEL 1\n#define LV_USE_BUTTON 1\n#define LV_USE_TEXTAREA 1\n\n#endif /* LV_CONF_H */\n`,
        sourceMap: [],
        diagnostics: [],
      });
      break;

    case 'unity-uitoolkit':
      extras.push({
        relativePath: 'Packages/manifest.json',
        language: 'json',
        code:
          JSON.stringify(
            {
              dependencies: {
                'com.unity.modules.uielements': '1.0.0',
              },
            },
            null,
            2,
          ) + '\n',
        sourceMap: [],
        diagnostics: [],
      });
      break;

    default:
      break;
  }

  extras.push({
    relativePath: 'tokens.json',
    language: 'json',
    code: JSON.stringify(ir.tokens, null, 2) + '\n',
    sourceMap: [],
    diagnostics: [],
  });

  return extras;
}
