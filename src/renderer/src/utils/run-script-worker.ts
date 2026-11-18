import type { ScriptTestInput, ScriptTestResult } from './script-workbench-runtime';

export function runScriptWorker(input: ScriptTestInput, signal: AbortSignal): Promise<ScriptTestResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Test interrotto.', 'AbortError'));
      return;
    }
    const worker = new Worker(new URL('./script-workbench.worker.ts', import.meta.url), { type: 'module' });
    const { port1, port2 } = new MessageChannel();
    const abort = () => {
      cleanup();
      reject(new DOMException('Test interrotto.', 'AbortError'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Il test ha superato 8 secondi ed è stato interrotto.'));
    }, 8_000);
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      port1.close();
      worker.terminate();
    };
    signal.addEventListener('abort', abort, { once: true });
    port1.onmessage = (event: MessageEvent<ScriptTestResult>) => {
      cleanup();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || 'Impossibile avviare il test isolato.'));
    };
    try {
      worker.postMessage(input, [port2]);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
