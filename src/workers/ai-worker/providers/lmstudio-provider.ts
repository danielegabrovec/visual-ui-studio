import type { LocalAIModelInfo, LocalAIProviderStatus } from '@shared/ipc-contract';
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

interface LMStudioV1Model {
  id: string;
  object?: string;
}

interface LMStudioV0Model {
  id: string;
  type?: 'llm' | 'vlm' | 'embeddings';
  state?: 'loaded' | 'not-loaded';
  quantization?: string;
  max_context_length?: number;
}

export class LMStudioProviderClient implements ILocalProviderClient {
  public readonly kind = 'lmstudio' as const;
  private config: ProviderConfig;
  private readonly fetchFn: typeof fetch;

  constructor(initialBaseUrl = 'http://127.0.0.1:1234/v1', fetchFn: typeof fetch = globalThis.fetch) {
    this.config = {
      id: 'lmstudio',
      displayName: 'LM Studio (OpenAI / GGUF Server)',
      baseUrl: this.normalizeBaseUrl(initialBaseUrl),
    };
    this.fetchFn = fetchFn;
  }

  private normalizeBaseUrl(url: string): string {
    const clean = url.trim().replace(/\/+$/, '');
    if (!clean) return 'http://127.0.0.1:1234/v1';
    return clean.endsWith('/v1') ? clean : `${clean}/v1`;
  }

  private getRootOriginUrl(): string {
    return this.config.baseUrl.replace(/\/v1$/, '');
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
      const [v1Resp, v0Resp] = await Promise.all([
        this.fetchFn(`${this.config.baseUrl}/models`, {
          method: 'GET',
          headers: this.buildHeaders(),
          signal: controller.signal,
        }),
        this.fetchFn(`${this.getRootOriginUrl()}/api/v0/models`, {
          method: 'GET',
          headers: this.buildHeaders(),
          signal: controller.signal,
        }).catch(() => null),
      ]);

      if (!v1Resp.ok) {
        return {
          id: 'lmstudio',
          displayName: this.config.displayName,
          baseUrl: this.config.baseUrl,
          online: false,
          latencyMs: Date.now() - started,
          error: `LM Studio HTTP ${v1Resp.status}`,
          models: [],
        };
      }

      const v1Data = (await v1Resp.json()) as { data?: LMStudioV1Model[] };
      const v0Data = v0Resp && v0Resp.ok ? ((await v0Resp.json()) as { data?: LMStudioV0Model[] }) : { data: [] };

      const v0Map = new Map<string, LMStudioV0Model>();
      for (const m0 of v0Data.data ?? []) {
        v0Map.set(m0.id, m0);
      }

      const models: LocalAIModelInfo[] = (v1Data.data ?? []).map((m) => {
        const meta = v0Map.get(m.id);
        const inferred = inferModelCapabilitiesFromName(m.id, 'lmstudio', {
          quantization: meta?.quantization,
          loadedInVram: meta ? meta.state === 'loaded' : true,
        });
        if (meta?.type === 'vlm') {
          inferred.supportsVision = true;
        }
        return inferred;
      });

      return {
        id: 'lmstudio',
        displayName: this.config.displayName,
        baseUrl: this.config.baseUrl,
        online: true,
        latencyMs: Date.now() - started,
        models,
      };
    } catch (err) {
      return {
        id: 'lmstudio',
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

    const payload = {
      model: input.modelName,
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
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: userContent },
      ],
    };

    const resp = await this.fetchFn(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(payload),
      signal: input.abortSignal,
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`LM Studio completion failed (HTTP ${resp.status}): ${detail || resp.statusText}`);
    }

    return consumeOpenAISseStream(resp, input.onTokenDelta);
  }
}

export async function consumeOpenAISseStream(
  resp: Response,
  onTokenDelta?: (delta: string, isThinking?: boolean) => void,
): Promise<ProviderGenerateOutput> {
  let fullContent = '';
  let fullThinking = '';
  let tokensIn: number | undefined;
  let tokensOut: number | undefined;

  const contentType = resp.headers.get('content-type') ?? '';
  if (!resp.body || contentType.includes('application/json')) {
    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    fullContent = json.choices?.[0]?.message?.content ?? '';
    fullThinking = json.choices?.[0]?.message?.reasoning_content ?? '';
    tokensIn = json.usage?.prompt_tokens;
    tokensOut = json.usage?.completion_tokens;
    if (fullThinking) onTokenDelta?.(fullThinking, true);
    if (fullContent) onTokenDelta?.(fullContent, false);
  } else {
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
        if (!line || !line.startsWith('data:')) continue;
        const dataStr = line.slice(5).trim();
        if (dataStr === '[DONE]') continue;

        try {
          const evt = JSON.parse(dataStr) as {
            choices?: Array<{
              delta?: { content?: string; reasoning_content?: string };
              message?: { content?: string };
            }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const delta = evt.choices?.[0]?.delta;
          if (delta?.reasoning_content) {
            fullThinking += delta.reasoning_content;
            onTokenDelta?.(delta.reasoning_content, true);
          }
          if (delta?.content) {
            fullContent += delta.content;
            onTokenDelta?.(delta.content, false);
          } else if (evt.choices?.[0]?.message?.content) {
            fullContent += evt.choices[0].message.content;
          }
          if (evt.usage?.prompt_tokens !== undefined) tokensIn = evt.usage.prompt_tokens;
          if (evt.usage?.completion_tokens !== undefined) tokensOut = evt.usage.completion_tokens;
        } catch {
          // Ignore keepalive or partial comment lines
        }
      }
    }
  }

  const plan = parseStructuredAgentPlan(fullContent, fullThinking || undefined);
  return {
    plan,
    rawText: fullContent,
    tokensIn,
    tokensOut,
  };
}
