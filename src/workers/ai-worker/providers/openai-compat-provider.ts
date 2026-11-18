import type { LocalAIModelInfo, LocalAIProviderStatus } from '@shared/ipc-contract';
import { consumeOpenAISseStream } from './lmstudio-provider';
import {
  AGENT_RESPONSE_JSON_SCHEMA,
  inferModelCapabilitiesFromName,
  stripDataUriPrefix,
  type ILocalProviderClient,
  type ProviderConfig,
  type ProviderGenerateInput,
  type ProviderGenerateOutput,
} from './types';

export class OpenAICompatProviderClient implements ILocalProviderClient {
  public readonly kind = 'openai_compat' as const;
  private config: ProviderConfig;
  private readonly fetchFn: typeof fetch;

  constructor(
    initialBaseUrl = 'http://127.0.0.1:8080/v1',
    apiKey?: string,
    fetchFn: typeof fetch = globalThis.fetch,
  ) {
    this.config = {
      id: 'openai_compat',
      displayName: 'OpenAI-Compatible (llama.cpp / vLLM / Jan)',
      baseUrl: this.normalizeBaseUrl(initialBaseUrl),
      apiKey,
    };
    this.fetchFn = fetchFn;
  }

  private normalizeBaseUrl(url: string): string {
    const clean = url.trim().replace(/\/+$/, '');
    if (!clean) return 'http://127.0.0.1:8080/v1';
    return clean;
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

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  public async getStatus(timeoutMs = 2200): Promise<LocalAIProviderStatus> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await this.fetchFn(`${this.config.baseUrl}/models`, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: controller.signal,
      });

      if (!resp.ok) {
        return {
          id: 'openai_compat',
          displayName: this.config.displayName,
          baseUrl: this.config.baseUrl,
          online: false,
          latencyMs: Date.now() - started,
          error: `Endpoint HTTP ${resp.status}`,
          models: [],
        };
      }

      const json = (await resp.json()) as { data?: Array<{ id: string }> };
      const models: LocalAIModelInfo[] = (json.data ?? []).map((item) =>
        inferModelCapabilitiesFromName(item.id, 'openai_compat', { loadedInVram: true }),
      );

      if (models.length === 0) {
        models.push(
          inferModelCapabilitiesFromName('local-gguf-default', 'openai_compat', { loadedInVram: true }),
        );
      }

      return {
        id: 'openai_compat',
        displayName: this.config.displayName,
        baseUrl: this.config.baseUrl,
        online: true,
        latencyMs: Date.now() - started,
        models,
      };
    } catch (err) {
      return {
        id: 'openai_compat',
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

  public async generatePlan(input: ProviderGenerateInput): Promise<ProviderGenerateOutput> {
    const userContent: unknown = input.visionImageBase64
      ? [
          { type: 'text', text: input.userPrompt },
          {
            type: 'image_url',
            image_url: { url: stripDataUriPrefix(input.visionImageBase64).dataUri },
          },
        ]
      : input.userPrompt;

    const baseMessages = [
      { role: 'system', content: input.systemPrompt },
      { role: 'user', content: userContent },
    ];

    const primaryBody = {
      model: input.modelName || 'local-gguf-default',
      stream: true,
      temperature: input.temperature ?? 0.15,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'studio_agent_turn',
          strict: false,
          schema: AGENT_RESPONSE_JSON_SCHEMA,
        },
      },
      messages: baseMessages,
    };

    let resp = await this.fetchFn(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(primaryBody),
      signal: input.abortSignal,
    });

    // Fallback to json_object if a custom OpenAI-compatible server doesn't implement json_schema
    if (resp.status === 400 || resp.status === 422) {
      const fallbackBody = {
        model: input.modelName || 'local-gguf-default',
        stream: true,
        temperature: input.temperature ?? 0.15,
        response_format: { type: 'json_object' },
        messages: baseMessages,
      };
      resp = await this.fetchFn(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(fallbackBody),
        signal: input.abortSignal,
      });
    }

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`OpenAI-compatible endpoint failed (HTTP ${resp.status}): ${detail || resp.statusText}`);
    }

    return consumeOpenAISseStream(resp, input.onTokenDelta);
  }
}
