import { runScriptTest, type ScriptTestInput } from './script-workbench-runtime';

self.onmessage = async (event: MessageEvent<ScriptTestInput>) => {
  const port = event.ports[0];
  if (!port) return;
  const result = await runScriptTest(event.data);
  port.postMessage(result);
  port.close();
};
