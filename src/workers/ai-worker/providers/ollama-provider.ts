import {
  filterAndRankLocalModels,
  isEmbeddingOnlyModelName,
  type LocalAIModelInfo,
  type LocalAIProviderStatus,
} from '@shared/ipc-contract';
import {
  AGENT_RESPONSE_JSON_SCHEMA,
  inferModelCapabilitiesFromName,
  parseStructuredAgentPlan,
  stripDataUriPrefix,
  type ILocalProviderClient,
  type ProviderConfig,
  type ProviderGenerateInput,
  type ProviderGenerateOutput,
} from './types';

interface OllamaTagModel {
  name: string;
  model?: string;
  size?: number;
  details?: {
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
}

interface OllamaPsModel {
  name: string;
  model?: string;
  size?: number;
  size_vram?: number;
}

export class OllamaProviderClient implements ILocalProviderClient {
  public readonly kind = 'ollama' as const;
  private config: ProviderConfig;
  private readonly fetchFn: typeof fetch;

  constructor(initialBaseUrl = 'http://127.0.0.1:11434', fetchFn: typeof fetch = globalThis.fetch) {
    this.config = {
      id: 'ollama',
      displayName: 'Ollama (Local Daemon)',
      baseUrl: this.normalizeBaseUrl(initialBaseUrl),
    };
    this.fetchFn = fetchFn;
  }

  private normalizeBaseUrl(url: string): string {
    return url.trim().replace(/\/+$/, '') || 'http://127.0.0.1:11434';
  }

  public getConfig(): ProviderConfig {
    return { ...this.config };
  }

  public updateConfig(patch: { baseUrl?: string; apiKey?: string }): void {
    if (patch.baseUrl !== undefined) {
      this.config.baseUrl = this.normalizeBaseUrl(patch.baseUrl);
    }
    if (patch.apiKey !== undefined) {
      this.config.apiKey = patch.apiKey;
    }
  }

  public async getStatus(timeoutMs = 2200): Promise<LocalAIProviderStatus> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const [tagsResp, psResp] = await Promise.all([
        this.fetchFn(`${this.config.baseUrl}/api/tags`, {
          method: 'GET',
          signal: controller.signal,
        }),
        this.fetchFn(`${this.config.baseUrl}/api/ps`, {
          method: 'GET',
          signal: controller.signal,
        }).catch(() => null),
      ]);

      if (!tagsResp.ok) {
        return {
          id: 'ollama',
          displayName: this.config.displayName,
          baseUrl: this.config.baseUrl,
          online: false,
          latencyMs: Date.now() - started,
          error: `Ollama HTTP ${tagsResp.status}`,
          models: [],
        };
      }

      const tagsJson = (await tagsResp.json()) as { models?: OllamaTagModel[] };
      const psJson = psResp && psResp.ok ? ((await psResp.json()) as { models?: OllamaPsModel[] }) : { models: [] };

      const vramMap = new Map<string, number>();
      for (const running of psJson.models ?? []) {
        const key = running.name || running.model || '';
        if (key) {
          const vramMb = typeof running.size_vram === 'number' ? Math.round(running.size_vram / (1024 * 1024)) : 0;
          vramMap.set(key, vramMb);
        }
      }

      const rawModels: LocalAIModelInfo[] = [];
      for (const m of tagsJson.models ?? []) {
        const modelName = m.name || m.model || 'unknown';
        const families = m.details?.families ?? (m.details?.family ? [m.details.family] : []);
        if (isEmbeddingOnlyModelName(modelName, families)) {
          continue;
        }
        const loadedInVram = vramMap.has(modelName);
        rawModels.push(
          inferModelCapabilitiesFromName(modelName, 'ollama', {
            sizeBytes: m.size,
            quantization: m.details?.quantization_level,
            families,
            loadedInVram,
            vramUsedMb: vramMap.get(modelName),
          }),
        );
      }

      const models = filterAndRankLocalModels(rawModels);

      return {
        id: 'ollama',
        displayName: this.config.displayName,
        baseUrl: this.config.baseUrl,
        online: true,
        latencyMs: Date.now() - started,
        models,
      };
    } catch (err) {
      return {
        id: 'ollama',
        displayName: this.config.displayName,
        baseUrl: this.config.baseUrl,
        online: false,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
        models: [],
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Pulls a standard Ollama tag OR a direct Unsloth HuggingFace GGUF URI
   * e.g. `hf.co/unsloth/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M`.
   */
  public async pullModel(
    modelRef: string,
    onProgress?: (status: string, completedPercent?: number) => void,
  ): Promise<{ ok: boolean; message: string }> {
    const trimmed = modelRef.trim();
    if (!trimmed) {
      return { ok: false, message: 'Model reference cannot be empty.' };
    }

    try {
      const resp = await this.fetchFn(`${this.config.baseUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: trimmed, stream: true }),
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        return {
          ok: false,
          message: `Ollama pull failed (HTTP ${resp.status}): ${errBody || resp.statusText}`,
        };
      }

      if (!resp.body) {
        return { ok: true, message: `Pulled ${trimmed}` };
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastStatus = 'downloading';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          try {
            const evt = JSON.parse(line) as {
              status?: string;
              completed?: number;
              total?: number;
              error?: string;
            };
            if (evt.error) {
              return { ok: false, message: `Ollama pull error: ${evt.error}` };
            }
            if (evt.status) {
              lastStatus = evt.status;
              const pct =
                typeof evt.completed === 'number' && typeof evt.total === 'number' && evt.total > 0
                  ? Math.min(100, Math.round((evt.completed / evt.total) * 100))
                  : undefined;
              onProgress?.(evt.status, pct);
            }
          } catch {
            // Ignore malformed NDJSON chunk
          }
        }
      }

      onProgress?.('success', 100);
      return { ok: true, message: `Model ${trimmed} ready (${lastStatus}).` };
    } catch (err) {
      return {
        ok: false,
        message: `Cannot reach Ollama at ${this.config.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  public async generatePlan(input: ProviderGenerateInput): Promise<ProviderGenerateOutput> {
    const userMessage: Record<string, unknown> = {
      role: 'user',
      content: input.userPrompt,
    };

    if (input.visionImageBase64) {
      const { rawBase64 } = stripDataUriPrefix(input.visionImageBase64);
      userMessage.images = [rawBase64];
    }

    const body = {
      model: input.modelName,
      stream: true,
      format: AGENT_RESPONSE_JSON_SCHEMA,
      keep_alive: '10m',
      options: {
        temperature: input.temperature ?? 0.15,
        num_ctx: input.numCtx ?? 16384,
      },
      messages: [
        { role: 'system', content: input.systemPrompt },
        userMessage,
      ],
    };

    const resp = await this.fetchFn(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: input.abortSignal,
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`Ollama chat failed (HTTP ${resp.status}): ${detail || resp.statusText}`);
    }

    let fullContent = '';
    let fullThinking = '';
    let tokensIn: number | undefined;
    let tokensOut: number | undefined;

    if (resp.body) {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          const chunk = JSON.parse(line) as {
            message?: { content?: string; thinking?: string };
            prompt_eval_count?: number;
            eval_count?: number;
            error?: string;
          };
          if (chunk.error) {
            throw new Error(`Ollama stream error: ${chunk.error}`);
          }
          if (chunk.message?.thinking) {
            fullThinking += chunk.message.thinking;
            input.onTokenDelta?.(chunk.message.thinking, true);
          }
          if (chunk.message?.content) {
            fullContent += chunk.message.content;
            input.onTokenDelta?.(chunk.message.content, false);
          }
          if (typeof chunk.prompt_eval_count === 'number') tokensIn = chunk.prompt_eval_count;
          if (typeof chunk.eval_count === 'number') tokensOut = chunk.eval_count;
        }
      }

      if (buffer.trim()) {
        const tail = JSON.parse(buffer.trim()) as {
          message?: { content?: string; thinking?: string };
          prompt_eval_count?: number;
          eval_count?: number;
        };
        if (tail.message?.thinking) fullThinking += tail.message.thinking;
        if (tail.message?.content) fullContent += tail.message.content;
        if (typeof tail.prompt_eval_count === 'number') tokensIn = tail.prompt_eval_count;
        if (typeof tail.eval_count === 'number') tokensOut = tail.eval_count;
      }
    } else {
      const single = (await resp.json()) as {
        message?: { content?: string; thinking?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };
      fullContent = single.message?.content ?? '';
      fullThinking = single.message?.thinking ?? '';
      tokensIn = single.prompt_eval_count;
      tokensOut = single.eval_count;
    }

    const plan = parseStructuredAgentPlan(fullContent, fullThinking || undefined);
    return {
      plan,
      rawText: fullContent,
      tokensIn,
      tokensOut,
    };
  }

  public async streamChat(input: {
    modelName: string;
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    format?: Record<string, unknown> | 'json';
    temperature?: number;
    numCtx?: number;
    abortSignal?: AbortSignal;
    onTokenDelta?: (delta: string, isThinking?: boolean) => void;
  }): Promise<{
    content: string;
    thinking?: string;
    tokensIn?: number;
    tokensOut?: number;
  }> {
    const body: Record<string, unknown> = {
      model: input.modelName,
      stream: true,
      keep_alive: '10m',
      options: {
        temperature: input.temperature ?? 0.25,
        num_ctx: input.numCtx ?? 16384,
      },
      messages: input.messages,
    };
    if (input.format !== undefined) {
      body.format = input.format;
    }

    const resp = await this.fetchFn(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: input.abortSignal,
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`Ollama chat failed (HTTP ${resp.status}): ${detail || resp.statusText}`);
    }

    let fullContent = '';
    let fullThinking = '';
    let tokensIn: number | undefined;
    let tokensOut: number | undefined;

    if (resp.body) {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          const chunk = JSON.parse(line) as {
            message?: { content?: string; thinking?: string };
            prompt_eval_count?: number;
            eval_count?: number;
            error?: string;
          };
          if (chunk.error) {
            throw new Error(`Ollama stream error: ${chunk.error}`);
          }
          if (chunk.message?.thinking) {
            fullThinking += chunk.message.thinking;
            input.onTokenDelta?.(chunk.message.thinking, true);
          }
          if (chunk.message?.content) {
            fullContent += chunk.message.content;
            input.onTokenDelta?.(chunk.message.content, false);
          }
          if (typeof chunk.prompt_eval_count === 'number') tokensIn = chunk.prompt_eval_count;
          if (typeof chunk.eval_count === 'number') tokensOut = chunk.eval_count;
        }
      }

      if (buffer.trim()) {
        try {
          const tail = JSON.parse(buffer.trim()) as {
            message?: { content?: string; thinking?: string };
            prompt_eval_count?: number;
            eval_count?: number;
          };
          if (tail.message?.thinking) {
            fullThinking += tail.message.thinking;
            input.onTokenDelta?.(tail.message.thinking, true);
          }
          if (tail.message?.content) {
            fullContent += tail.message.content;
            input.onTokenDelta?.(tail.message.content, false);
          }
          if (typeof tail.prompt_eval_count === 'number') tokensIn = tail.prompt_eval_count;
          if (typeof tail.eval_count === 'number') tokensOut = tail.eval_count;
        } catch {
          // ignore trailing partial chunk
        }
      }
    } else {
      const single = (await resp.json()) as {
        message?: { content?: string; thinking?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };
      fullContent = single.message?.content ?? '';
      fullThinking = single.message?.thinking ?? '';
      if (fullThinking) input.onTokenDelta?.(fullThinking, true);
      if (fullContent) input.onTokenDelta?.(fullContent, false);
      tokensIn = single.prompt_eval_count;
      tokensOut = single.eval_count;
    }

    // Also strip inline <think>...</think> blocks if model emitted reasoning inside content
    let extractedThinking = fullThinking;
    const cleanedContent = fullContent.replace(/<think>([\s\S]*?)<\/think>/gi, (_m, inner) => {
      if (typeof inner === 'string' && inner.trim()) {
        extractedThinking = [extractedThinking, inner.trim()].filter(Boolean).join('\n\n');
      }
      return '';
    });

    return {
      content: cleanedContent.trim(),
      thinking: extractedThinking || undefined,
      tokensIn,
      tokensOut,
    };
  }
}
