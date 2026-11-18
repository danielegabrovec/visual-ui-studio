import {
  findUIRNodeByCanvasId,
  normalizeSheetToUIRModule,
  solveFreeformToAutoLayout,
} from '@shared/layout-solver';
import type { GenerateSqlCodeRequest } from '@shared/sql-ir';
import type {
  CodegenCompileOptions,
  DesignTheme,
  DesignTokenEntry,
  NodeId,
  StylingDialect,
  TargetArtifactBundle,
  TargetDescriptor,
  UISheetDocument,
} from '@shared/ui-ir';
import type { UIPatchOp } from '@shared/ui-patch';
import type { ICodegenWorkerService } from '@shared/worker-protocol';
import {
  buildScaffoldExtraFiles,
  CodegenPluginRegistry,
  createDefaultPluginRegistry,
} from './plugin-registry';
import { generateSqlCodeBundle } from './sql-codegen';
import {
  formatScriptModulesAsEmittedFiles,
  resolveEffectiveScriptModules,
} from './targets/script-module-helpers';

export class CodegenWorkerService implements ICodegenWorkerService {
  private readonly registry: CodegenPluginRegistry;

  constructor(registry?: CodegenPluginRegistry) {
    this.registry = registry ?? createDefaultPluginRegistry();
  }

  async listTargets(): Promise<TargetDescriptor[]> {
    return this.registry.listDescriptors();
  }

  async compileSheet(input: {
    sheet: UISheetDocument;
    tokens: DesignTokenEntry[];
    themes: DesignTheme[];
    options: CodegenCompileOptions;
  }): Promise<TargetArtifactBundle> {
    const { sheet, tokens, themes, options } = input;
    const plugin = this.registry.getOrThrow(options.targetId);

    const effectiveDialect: StylingDialect =
      options.dialect && plugin.descriptor.supportedDialects.includes(options.dialect)
        ? options.dialect
        : plugin.descriptor.defaultDialect;

    const mode = options.mode ?? 'bundle';
    const resolvedScripts = resolveEffectiveScriptModules(sheet, options);

    const normalizedOptions: CodegenCompileOptions = {
      ...options,
      dialect: effectiveDialect,
      mode,
      scriptModules: resolvedScripts.modules,
    };

    let ir = normalizeSheetToUIRModule(sheet, tokens, themes, {
      autoSolveFreeform: options.autoSolveFreeform,
      componentNameOverride: options.componentNameOverride,
    });

    if (resolvedScripts.modules.length > 0) {
      ir = {
        ...ir,
        scriptModules: resolvedScripts.modules,
      };
    }

    if (resolvedScripts.discoveredIpcCommands.length > 0) {
      ir = {
        ...ir,
        components: ir.components.map((comp) => {
          const existingNames = new Set(comp.ipcCommands.map((c) => c.name));
          const mergedIpc = [...comp.ipcCommands];
          for (const extraIpc of resolvedScripts.discoveredIpcCommands) {
            if (!existingNames.has(extraIpc.name)) {
              existingNames.add(extraIpc.name);
              mergedIpc.push(extraIpc);
            }
          }
          return { ...comp, ipcCommands: mergedIpc };
        }),
      };
    }

    if (plugin.lowerIR) {
      ir = plugin.lowerIR(ir, normalizedOptions);
    }

    const entryComp = ir.components.find((c) => c.id === ir.entryComponentId) ?? ir.components[0];

    if (mode === 'snippet') {
      const targetNode =
        (options.selectedNodeId ? findUIRNodeByCanvasId(entryComp.root, options.selectedNodeId) : null) ??
        entryComp.root;
      const snippetFile = plugin.emitSnippet(targetNode, ir, normalizedOptions);
      return {
        targetId: plugin.descriptor.id,
        dialect: effectiveDialect,
        mode: 'snippet',
        entryFilePath: snippetFile.relativePath,
        files: [snippetFile],
        diagnostics: [...snippetFile.diagnostics],
        generatedAt: Date.now(),
      };
    }

    if (mode === 'scaffold' && plugin.emitProjectScaffold) {
      const customScaffold = plugin.emitProjectScaffold(ir, normalizedOptions);
      const extraScripts = formatScriptModulesAsEmittedFiles(
        ir,
        plugin.descriptor.id,
        normalizedOptions.scriptLanguage,
      ).filter((sf) => !customScaffold.files.some((f) => f.relativePath === sf.relativePath));
      return extraScripts.length > 0
        ? { ...customScaffold, files: [...customScaffold.files, ...extraScripts] }
        : customScaffold;
    }

    const bundle = plugin.emitComponent(entryComp, ir, normalizedOptions);

    if (mode === 'component' && bundle.files.length > 1) {
      // Keep primary entry file first (and essential paired template if Angular)
      const entryOnly =
        plugin.descriptor.id === 'angular'
          ? bundle.files.slice(0, 2)
          : bundle.files.filter((f) => f.isEntry || f.relativePath === bundle.entryFilePath);
      if (entryOnly.length > 0) {
        return {
          ...bundle,
          mode: 'component',
          files: entryOnly,
        };
      }
    }

    const separateScriptFiles = formatScriptModulesAsEmittedFiles(
      ir,
      plugin.descriptor.id,
      normalizedOptions.scriptLanguage,
    ).filter((sf) => !bundle.files.some((bf) => bf.relativePath === sf.relativePath));

    const mergedBundleFiles =
      separateScriptFiles.length > 0 ? [...bundle.files, ...separateScriptFiles] : bundle.files;

    if (mode === 'scaffold') {
      const extraFiles = buildScaffoldExtraFiles(plugin.descriptor.id, ir).filter(
        (ef) => !mergedBundleFiles.some((bf) => bf.relativePath === ef.relativePath),
      );
      return {
        ...bundle,
        mode: 'scaffold',
        files: [...mergedBundleFiles, ...extraFiles],
      };
    }

    return separateScriptFiles.length > 0
      ? { ...bundle, files: mergedBundleFiles }
      : bundle;
  }

  async solveFreeformLayout(input: {
    sheet: UISheetDocument;
    rootNodeId: NodeId;
  }): Promise<{ ops: UIPatchOp[]; summary: string }> {
    return solveFreeformToAutoLayout(input.sheet, input.rootNodeId);
  }

  async generateSqlCodeBundle(req: GenerateSqlCodeRequest): Promise<TargetArtifactBundle> {
    return generateSqlCodeBundle(req);
  }
}

export function createCodegenWorkerService(registry?: CodegenPluginRegistry): CodegenWorkerService {
  return new CodegenWorkerService(registry);
}
