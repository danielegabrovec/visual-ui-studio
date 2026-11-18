import { parentPort as nodeThreadParentPort } from 'node:worker_threads';
import { attachWorkerRpcHandler, type MinimalPortLike } from '@shared/worker-protocol';
import { AiWorkerService, createAiWorkerService } from './service';

export { AiWorkerService, createAiWorkerService } from './service';
export { computeHardwareAdvisorReport, UNSLOTH_MODEL_CATALOG } from './hardware-advisor';
export { writeUnslothExportBundle } from './unsloth-exporter';
export { OllamaProviderClient } from './providers/ollama-provider';
export { LMStudioProviderClient } from './providers/lmstudio-provider';
export { OpenAICompatProviderClient } from './providers/openai-compat-provider';
export {
  buildDomainSmartBlueprint,
  compileAiBlueprintToWizardSeed,
  sanitizeAiBlueprint,
} from './startup-architect';

const electronParentPort = (process as NodeJS.Process & { parentPort?: MinimalPortLike }).parentPort;
const activePort: MinimalPortLike | null = electronParentPort ?? (nodeThreadParentPort as MinimalPortLike | null);

if (activePort) {
  const service = new AiWorkerService();
  attachWorkerRpcHandler(activePort, service, (emit) => {
    service.onStreamEvent((event) => {
      emit('ai-stream', event);
    });
  });
}
