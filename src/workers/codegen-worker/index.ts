import { parentPort as nodeWorkerParentPort } from 'node:worker_threads';
import { attachWorkerRpcHandler, type MinimalPortLike } from '@shared/worker-protocol';
import { CodegenPluginRegistry, createDefaultPluginRegistry } from './plugin-registry';
import { CodegenWorkerService, createCodegenWorkerService } from './service';

export {
  CodegenPluginRegistry,
  CodegenWorkerService,
  createCodegenWorkerService,
  createDefaultPluginRegistry,
};

function bootstrapWorkerProcess(): void {
  const electronParentPort = (process as NodeJS.Process & { parentPort?: MinimalPortLike }).parentPort;
  const activePort: MinimalPortLike | null = electronParentPort ?? (nodeWorkerParentPort as MinimalPortLike | null);
  if (!activePort) return;

  const service = createCodegenWorkerService();
  attachWorkerRpcHandler(activePort, service);

  // Also bind any transferred MessageChannelMain / MessagePort channels forwarded by Main
  activePort.on('message', (raw: any) => {
    const transferredPorts: Array<MinimalPortLike & { start?: () => void }> | undefined = raw?.ports;
    if (Array.isArray(transferredPorts) && transferredPorts.length > 0) {
      for (const port of transferredPorts) {
        port.start?.();
        attachWorkerRpcHandler(port, service);
      }
    }
  });
}

bootstrapWorkerProcess();
