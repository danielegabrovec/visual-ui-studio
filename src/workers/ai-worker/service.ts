import type {
  AgentStreamEvent,
  ExportUnslothDatasetRequest,
  ExportUnslothDatasetResult,
  GenerateProjectWithAiRequest,
  HardwareAdvisorReport,
  LocalAIProviderKind,
  LocalAIProviderStatus,
  StartupAssistantChatRequest,
  StartupAssistantChatResult,
  UnslothModelRecommendation,
  UnslothTrainingPairDTO,
} from '@shared/ipc-contract';
import type {
  AiGeneratedProjectSeedOutput,
  AiTurnExecutionContext,
  AiTurnWorkerOutput,
  IAiWorkerService,
} from '@shared/worker-protocol';
import { AgentOrchestrator } from './agent-orchestrator';
import {
  computeHardwareAdvisorReport,
  recommendedNumCtxForTier,
  UNSLOTH_MODEL_CATALOG,
} from './hardware-advisor';
import { getBuiltinOfflineProviderStatus } from './offline-assistant';
import { LMStudioProviderClient } from './providers/lmstudio-provider';
import { OllamaProviderClient } from './providers/ollama-provider';
import { OpenAICompatProviderClient } from './providers/openai-compat-provider';
import { runGenerateProjectSeedWithAi, runStartupAssistantChat } from './startup-architect';
import { writeUnslothExportBundle } from './unsloth-exporter';

export interface AiWorkerServiceOptions {
  fetchImpl?: typeof fetch;
  ollamaBaseUrl?: string;
  lmStudioBaseUrl?: string;
  openAiCompatBaseUrl?: string;
  openAiCompatApiKey?: string;
}

export class AiWorkerService implements IAiWorkerService {
  private readonly ollamaClient: OllamaProviderClient;
  private readonly lmStudioClient: LMStudioProviderClient;
  private readonly openAiCompatClient: OpenAICompatProviderClient;
  private readonly fetchFn: typeof fetch;
  private readonly orchestrator: AgentOrchestrator;
  private readonly streamListeners = new Set<(event: AgentStreamEvent) => void>();

  constructor(opts?: AiWorkerServiceOptions) {
    const fetchFn = opts?.fetchImpl ?? globalThis.fetch;
    this.fetchFn = fetchFn;
    this.ollamaClient = new OllamaProviderClient(opts?.ollamaBaseUrl, fetchFn);
    this.lmStudioClient = new LMStudioProviderClient(opts?.lmStudioBaseUrl, fetchFn);
    this.openAiCompatClient = new OpenAICompatProviderClient(
      opts?.openAiCompatBaseUrl,
      opts?.openAiCompatApiKey,
      fetchFn,
    );
    this.orchestrator = new AgentOrchestrator([
      this.ollamaClient,
      this.lmStudioClient,
      this.openAiCompatClient,
    ]);
  }

  public onStreamEvent(listener: (event: AgentStreamEvent) => void): () => void {
    this.streamListeners.add(listener);
    return () => {
      this.streamListeners.delete(listener);
    };
  }

  private broadcastStreamEvent(event: AgentStreamEvent, perCallListener?: (e: AgentStreamEvent) => void): void {
    perCallListener?.(event);
    for (const listener of this.streamListeners) {
      listener(event);
    }
  }

  public async getHardwareReport(): Promise<HardwareAdvisorReport> {
    return computeHardwareAdvisorReport();
  }

  public async listProvidersAndModels(): Promise<LocalAIProviderStatus[]> {
    const [ollamaStatus, lmStudioStatus, openAiStatus] = await Promise.all([
      this.ollamaClient.getStatus(),
      this.lmStudioClient.getStatus(),
      this.openAiCompatClient.getStatus(),
    ]);

    return [
      ollamaStatus,
      lmStudioStatus,
      openAiStatus,
      getBuiltinOfflineProviderStatus(),
    ];
  }

  public async configureProvider(config: {
    id: LocalAIProviderKind;
    baseUrl: string;
    apiKey?: string;
  }): Promise<LocalAIProviderStatus> {
    switch (config.id) {
      case 'ollama':
        this.ollamaClient.updateConfig({ baseUrl: config.baseUrl, apiKey: config.apiKey });
        return this.ollamaClient.getStatus();
      case 'lmstudio':
        this.lmStudioClient.updateConfig({ baseUrl: config.baseUrl, apiKey: config.apiKey });
        return this.lmStudioClient.getStatus();
      case 'openai_compat':
        this.openAiCompatClient.updateConfig({ baseUrl: config.baseUrl, apiKey: config.apiKey });
        return this.openAiCompatClient.getStatus();
      case 'builtin_offline':
        return getBuiltinOfflineProviderStatus();
    }
  }

  public async getUnslothCatalog(): Promise<UnslothModelRecommendation[]> {
    return [...UNSLOTH_MODEL_CATALOG];
  }

  public async pullOllamaModel(modelRef: string): Promise<{ ok: boolean; message: string }> {
    return this.ollamaClient.pullModel(modelRef, (status, completedPercent) => {
      this.broadcastStreamEvent({
        type: 'pull_progress',
        modelRef,
        status,
        completedPercent,
      });
    });
  }

  public async askStartupAssistant(
    req: StartupAssistantChatRequest,
    onStream?: (event: AgentStreamEvent) => void,
  ): Promise<StartupAssistantChatResult> {
    return runStartupAssistantChat({
      req,
      ollamaClient: this.ollamaClient,
      lmStudioClient: this.lmStudioClient,
      openAiCompatClient: this.openAiCompatClient,
      fetchFn: this.fetchFn,
      emitStream: (ev) => this.broadcastStreamEvent(ev, onStream),
    });
  }

  public async generateProjectSeedWithAi(
    req: GenerateProjectWithAiRequest,
    onStream?: (event: AgentStreamEvent) => void,
  ): Promise<AiGeneratedProjectSeedOutput> {
    return runGenerateProjectSeedWithAi({
      req,
      ollamaClient: this.ollamaClient,
      emitStream: (ev) => this.broadcastStreamEvent(ev, onStream),
    });
  }

  public async executeAgentTurn(
    ctx: AiTurnExecutionContext,
    onStream?: (event: AgentStreamEvent) => void,
  ): Promise<AiTurnWorkerOutput> {
    const hw = computeHardwareAdvisorReport();
    const numCtx = recommendedNumCtxForTier(hw.recommendedTier);
    return this.orchestrator.executeTurn(ctx, numCtx, (ev) => {
      this.broadcastStreamEvent(ev, onStream);
    });
  }

  public async cancelAgentRun(runId: string): Promise<void> {
    this.orchestrator.cancelRun(runId);
  }

  public async exportUnslothBundleFiles(input: {
    pairs: UnslothTrainingPairDTO[];
    request: ExportUnslothDatasetRequest;
    resolvedOutputDir: string;
  }): Promise<ExportUnslothDatasetResult> {
    return writeUnslothExportBundle(input);
  }
}

export function createAiWorkerService(opts?: AiWorkerServiceOptions): AiWorkerService {
  return new AiWorkerService(opts);
}
