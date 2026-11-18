import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';

import { createDefaultThemes, createDefaultTokens, createStarterDemoSheet } from '@shared/default-tokens';
import type { AgentStreamEvent, UnslothTrainingPairDTO } from '@shared/ipc-contract';
import {
  attachWorkerRpcHandler,
  createWorkerRpcProxy,
  type IAiWorkerService,
  type MinimalPortLike,
} from '@shared/worker-protocol';
import {
  AiWorkerService,
  computeHardwareAdvisorReport,
  createAiWorkerService,
  UNSLOTH_MODEL_CATALOG,
} from '../src/workers/ai-worker';

function createNdjsonStreamResponse(lines: unknown[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const item of lines) {
        controller.enqueue(encoder.encode(`${JSON.stringify(item)}\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}

function createSseStreamResponse(events: unknown[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const ev of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('Domain 3 (local-ai): Local AI Gateway, Agent Orchestrator & Unsloth Integration', () => {
  it('computes hardware tiers accurately and exposes Unsloth Dynamic GGUF catalog', async () => {
    const entryHw = computeHardwareAdvisorReport({ totalRamMb: 8192, freeRamMb: 4096, cpuCores: 4 });
    const midHw = computeHardwareAdvisorReport({ totalRamMb: 16384, freeRamMb: 8192, cpuCores: 8 });
    const highHw = computeHardwareAdvisorReport({ totalRamMb: 65536, freeRamMb: 42000, cpuCores: 16 });

    expect(entryHw.recommendedTier).toBe('entry');
    expect(midHw.recommendedTier).toBe('mid');
    expect(highHw.recommendedTier).toBe('high');
    expect(midHw.vramHeadroomReservedMb).toBe(768);
    expect(midHw.recommendedCodingModel).toContain('hf.co/unsloth/');

    const service = createAiWorkerService();
    const catalog = await service.getUnslothCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(6);
    expect(catalog.length).toBe(UNSLOTH_MODEL_CATALOG.length);
    expect(catalog.some((m) => m.role === 'coding' && m.ollamaPullUri.startsWith('hf.co/unsloth/'))).toBe(true);
    expect(catalog.some((m) => m.role === 'vision')).toBe(true);
    expect(catalog.some((m) => m.role === 'reasoning')).toBe(true);
  });

  it('discovers Ollama models + live /api/ps VRAM telemetry and streams hf.co/unsloth/* pulls', async () => {
    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) {
        return new Response(
          JSON.stringify({
            models: [
              {
                name: 'hf.co/unsloth/Qwen2.5-Coder-14B-Instruct-128K-GGUF:Q4_K_M',
                size: 9_200_000_000,
                details: { family: 'qwen2', quantization_level: 'Q4_K_M' },
              },
              {
                name: 'qwen2.5-vl:7b',
                size: 5_800_000_000,
                details: { families: ['qwen2', 'clip'], quantization_level: 'Q4_K_M' },
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/api/ps')) {
        return new Response(
          JSON.stringify({
            models: [
              {
                name: 'hf.co/unsloth/Qwen2.5-Coder-14B-Instruct-128K-GGUF:Q4_K_M',
                size_vram: 8_912_896_000, // ~8500 MB
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/api/pull') && init?.method === 'POST') {
        return createNdjsonStreamResponse([
          { status: 'pulling manifest' },
          { status: 'downloading gguf', completed: 50, total: 100 },
          { status: 'verifying sha256', completed: 100, total: 100 },
        ]);
      }
      return new Response('Offline', { status: 503 });
    };

    const service = createAiWorkerService({ fetchImpl: mockFetch });
    const statuses = await service.listProvidersAndModels();
    const ollama = statuses.find((s) => s.id === 'ollama');
    const offline = statuses.find((s) => s.id === 'builtin_offline');

    expect(ollama?.online).toBe(true);
    expect(ollama?.models).toHaveLength(2);
    expect(ollama?.models[0].isUnsloth).toBe(true);
    expect(ollama?.models[0].loadedInVram).toBe(true);
    expect(ollama?.models[0].vramUsedMb).toBe(8500);
    expect(ollama?.models[1].supportsVision).toBe(true);
    expect(offline?.online).toBe(true);

    const progressEvents: AgentStreamEvent[] = [];
    const unsub = service.onStreamEvent((ev) => progressEvents.push(ev));
    const pullRes = await service.pullOllamaModel('hf.co/unsloth/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M');
    unsub();

    expect(pullRes.ok).toBe(true);
    expect(progressEvents.some((e) => e.type === 'pull_progress' && e.completedPercent === 50)).toBe(true);
    expect(progressEvents.some((e) => e.type === 'pull_progress' && e.completedPercent === 100)).toBe(true);
  });

  it('executes streaming Ollama JSON-schema agent turn, hydrates AICompactNode ops, and preserves preCheckpointId', async () => {
    const projectId = 'proj_test_1';
    const sheet = createStarterDemoSheet(projectId, 'sheet_1');
    const { darkTheme, all: themes } = createDefaultThemes(projectId);
    const tokens = createDefaultTokens(projectId, darkTheme.id);
    const initialNodeCount = Object.keys(sheet.nodes).length;

    const structuredReply = JSON.stringify({
      reply: 'Added a Promo Newsletter Card with HTMX submission inside HomeDashboardScreen.',
      ops: [
        {
          op: 'insert_tree',
          parentId: 'art_home_root',
          tree: {
            kind: 'container',
            name: 'NewsletterSignupCard',
            tag: 'form',
            direction: 'row',
            gap: 12,
            padding: 16,
            bg: '#ffffff',
            radius: 10,
            htmx: {
              method: 'hx-post',
              endpoint: '/api/newsletter/subscribe',
              hxSwap: 'outerHTML',
            },
            children: [
              {
                kind: 'control',
                name: 'SubscriberEmailInput',
                controlType: 'text-input',
                placeholder: 'Enter email for release notes...',
                widthMode: 'fill',
              },
              {
                kind: 'control',
                name: 'SubscribeSubmitBtn',
                controlType: 'button',
                text: 'Subscribe',
                bg: '#2563eb',
                textColor: '#ffffff',
              },
            ],
          },
        },
      ],
    });

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/api/chat')) {
        return createNdjsonStreamResponse([
          { message: { thinking: 'Inspecting root artboard art_home_root and creating HTMX form...' } },
          { message: { content: structuredReply.slice(0, 80) } },
          {
            message: { content: structuredReply.slice(80) },
            prompt_eval_count: 412,
            eval_count: 138,
          },
        ]);
      }
      return new Response('Not found', { status: 404 });
    };

    const service = createAiWorkerService({ fetchImpl: mockFetch });
    const streamEvents: AgentStreamEvent[] = [];

    const out = await service.executeAgentTurn(
      {
        request: {
          projectId,
          sheetId: sheet.sheetId,
          mode: 'prompt_to_ui',
          provider: 'ollama',
          modelName: 'hf.co/unsloth/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M',
          prompt: 'Add a newsletter signup form with HTMX post',
          activeTarget: 'htmx',
        },
        sheet,
        tokens,
        themes,
        preCheckpointId: 'chk_pre_ai_001',
      },
      (ev) => streamEvents.push(ev),
    );

    expect(out.usedFallbackOffline).toBe(false);
    expect(out.thinkingText).toContain('art_home_root');
    expect(out.appliedOps.length).toBe(3); // parent container + 2 child controls
    expect(Object.keys(out.updatedSheet.nodes).length).toBe(initialNodeCount + 3);
    expect(out.tokensIn).toBe(412);
    expect(out.tokensOut).toBe(138);

    const insertedForm = Object.values(out.updatedSheet.nodes).find((n) => n.name === 'NewsletterSignupCard');
    expect(insertedForm).toBeDefined();
    expect(insertedForm?.platform?.htmx?.endpoint).toBe('/api/newsletter/subscribe');

    expect(streamEvents[0]).toMatchObject({
      type: 'run_started',
      preCheckpointId: 'chk_pre_ai_001',
    });
    expect(streamEvents.some((e) => e.type === 'canvas_patched' && e.opsCount === 3)).toBe(true);
    expect(streamEvents[streamEvents.length - 1]?.type).toBe('run_completed');
  });

  it('supports LM Studio SSE streaming and gracefully falls back to Built-in Offline Assistant when daemons are down', async () => {
    const projectId = 'proj_test_2';
    const sheet = createStarterDemoSheet(projectId, 'sheet_2');
    const { all: themes } = createDefaultThemes(projectId);
    const tokens = createDefaultTokens(projectId);

    // 1. Test LM Studio SSE streaming
    const lmStudioJson = JSON.stringify({
      reply: 'Updated HeroBannerCard gap and padding via LM Studio.',
      ops: [
        {
          op: 'update_props',
          nodeId: 'nd_hero_section',
          gap: 20,
          padding: 36,
        },
      ],
    });

    const lmService = createAiWorkerService({
      fetchImpl: async (input) => {
        if (String(input).endsWith('/v1/chat/completions')) {
          return createSseStreamResponse([
            { choices: [{ delta: { reasoning_content: 'Checking HeroBannerCard...' } }] },
            { choices: [{ delta: { content: lmStudioJson } }], usage: { prompt_tokens: 200, completion_tokens: 55 } },
          ]);
        }
        return new Response('err', { status: 500 });
      },
    });

    const lmOut = await lmService.executeAgentTurn({
      request: {
        projectId,
        sheetId: sheet.sheetId,
        mode: 'surgical',
        provider: 'lmstudio',
        modelName: 'unsloth/gemma-3-12b-it',
        prompt: 'Increase spacing on Hero section',
        selectedNodeIds: ['nd_hero_section'],
      },
      sheet,
      tokens,
      themes,
      preCheckpointId: 'chk_lm_1',
    });

    expect(lmOut.usedFallbackOffline).toBe(false);
    expect(lmOut.updatedSheet.nodes['nd_hero_section'].layout.gap).toBe(20);

    // 2. Test automatic offline fallback when Ollama is unreachable
    const offlineFallbackService = createAiWorkerService({
      fetchImpl: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
      },
    });

    const fallbackOut = await offlineFallbackService.executeAgentTurn({
      request: {
        projectId,
        sheetId: sheet.sheetId,
        mode: 'prompt_to_ui',
        provider: 'ollama',
        modelName: 'qwen2.5-coder:7b',
        prompt: 'Create a secure login card with email and password',
        activeTarget: 'dotnet-maui',
      },
      sheet,
      tokens,
      themes,
      preCheckpointId: 'chk_offline_1',
    });

    expect(fallbackOut.usedFallbackOffline).toBe(true);
    expect(fallbackOut.appliedOps.length).toBeGreaterThanOrEqual(4);
    const loginNode = Object.values(fallbackOut.updatedSheet.nodes).find((n) => n.name === 'AuthLoginCard');
    expect(loginNode).toBeDefined();
  });

  it('exports ShareGPT & Alpaca Unsloth fine-tuning JSONL, Python QLoRA script, and Ollama Modelfile', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'unsloth-export-test-'));
    try {
      const service = createAiWorkerService();
      const samplePairs: UnslothTrainingPairDTO[] = [
        {
          id: 'pair_1',
          projectId: 'proj_1',
          sheetId: 'sheet_1',
          promptSummary: 'Build a responsive KPI analytics header',
          normalizedUiIrJson: '{"rootIds":["art_1"]}',
          tokensSnapshotJson: '{"color.primary.500":"#3b82f6"}',
          targetFramework: 'react-tsx',
          acceptedCodeOutput: 'export function AnalyticsHeader() { return <header>KPI</header>; }',
          qualityScore: 5,
          createdAt: Date.now(),
        },
        {
          id: 'pair_2',
          projectId: 'proj_1',
          sheetId: 'sheet_1',
          promptSummary: 'Create HTMX live search input',
          normalizedUiIrJson: '{"rootIds":["art_1"]}',
          targetFramework: 'htmx',
          acceptedCodeOutput: '<input hx-get="/api/search" hx-target="#results" />',
          qualityScore: 5,
          createdAt: Date.now(),
        },
      ];

      const shareGptRes = await service.exportUnslothBundleFiles({
        pairs: samplePairs,
        request: {
          projectId: 'proj_1',
          format: 'sharegpt',
          baseModelRepo: 'unsloth/Qwen2.5-Coder-14B-Instruct-bnb-4bit',
        },
        resolvedOutputDir: tempDir,
      });

      expect(shareGptRes.pairCount).toBe(2);
      const jsonlRaw = await readFile(shareGptRes.datasetFilePath, 'utf8');
      const lines = jsonlRaw.trim().split('\n');
      expect(lines).toHaveLength(2);
      const parsedFirst = JSON.parse(lines[0]) as { conversations: Array<{ from: string; value: string }> };
      expect(parsedFirst.conversations[0].from).toBe('system');
      expect(parsedFirst.conversations[1].from).toBe('human');
      expect(parsedFirst.conversations[2].value).toContain('AnalyticsHeader');

      const pyScript = await readFile(shareGptRes.trainScriptPath, 'utf8');
      expect(pyScript).toContain('from unsloth import FastLanguageModel');
      expect(pyScript).toContain('unsloth/Qwen2.5-Coder-14B-Instruct-bnb-4bit');
      expect(pyScript).toContain('save_pretrained_gguf');

      const modelfile = await readFile(shareGptRes.modelfilePath, 'utf8');
      expect(modelfile).toContain('FROM ./ui_studio_custom_gguf/unsloth.Q4_K_M.gguf');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('bridges RPC calls and ai-stream events cleanly over MessageChannel', async () => {
    const { port1, port2 } = new MessageChannel();
    const workerService = new AiWorkerService();

    attachWorkerRpcHandler(port1 as unknown as MinimalPortLike, workerService, (emit) => {
      workerService.onStreamEvent((ev) => emit('ai-stream', ev));
    });

    const receivedEvents: AgentStreamEvent[] = [];
    const proxy = createWorkerRpcProxy<IAiWorkerService>(
      port2 as unknown as MinimalPortLike,
      (channel, payload) => {
        if (channel === 'ai-stream') {
          receivedEvents.push(payload as AgentStreamEvent);
        }
      },
    );

    try {
      const sheet = createStarterDemoSheet('proj_rpc', 'sheet_rpc');
      const res = await proxy.executeAgentTurn({
        request: {
          projectId: 'proj_rpc',
          sheetId: sheet.sheetId,
          mode: 'surgical',
          provider: 'builtin_offline',
          modelName: 'studio-offline-architect-v1',
          prompt: 'Wrap buttons in horizontal Auto-Layout',
          selectedNodeIds: ['nd_primary_cta', 'nd_secondary_cta'],
        },
        sheet,
        tokens: [],
        themes: [],
        preCheckpointId: 'chk_rpc_99',
      });

      expect(res.appliedOps.length).toBeGreaterThan(0);
      expect(receivedEvents.some((e) => e.type === 'run_started' && e.preCheckpointId === 'chk_rpc_99')).toBe(true);
      expect(receivedEvents.some((e) => e.type === 'run_completed')).toBe(true);
    } finally {
      port1.close();
      port2.close();
    }
  });

  it('v2.1: filters out embedding-only models and ranks VRAM + coding-specialized local models ahead of :cloud and -base', async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) {
        return new Response(
          JSON.stringify({
            models: [
              { name: 'nomic-embed-text:latest', details: { family: 'nomic-bert' } },
              { name: 'mxbai-embed-large:latest', details: { family: 'bert' } },
              { name: 'all-minilm:l6-v2' },
              { name: 'bge-m3:latest' },
              { name: 'snowflake-arctic-embed:latest' },
              { name: 'gemma4:31b-cloud' },
              { name: 'qwen3-coder-next:cloud' },
              { name: 'qwen2.5-coder:1.5b-base' },
              { name: 'gemma:latest' },
              { name: 'deepseek-r1:14b' },
              { name: 'gemma4:26b' },
              { name: 'gpt-oss:20b-64k' },
              { name: 'qwen2.5-coder:14b-16k' },
              { name: 'qwen3-coder:30b' },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/api/ps')) {
        return new Response(
          JSON.stringify({
            models: [{ name: 'qwen2.5-coder:14b-16k', size_vram: 10_485_760_000 }],
          }),
          { status: 200 },
        );
      }
      return new Response('Offline', { status: 503 });
    };

    const service = createAiWorkerService({ fetchImpl: mockFetch });
    const statuses = await service.listProvidersAndModels();
    const ollama = statuses.find((s) => s.id === 'ollama')!;

    expect(ollama.online).toBe(true);
    const names = ollama.models.map((m) => m.name);

    // Zero embedding models allowed in chat/codegen list
    expect(names.some((n) => n.includes('embed'))).toBe(false);
    expect(names.some((n) => n.startsWith('all-minilm'))).toBe(false);
    expect(names.some((n) => n.startsWith('bge-'))).toBe(false);

    // Loaded-in-VRAM coding model ranks #1, followed by qwen3-coder:30b, and :cloud / -base rank at the bottom
    expect(names[0]).toBe('qwen2.5-coder:14b-16k');
    expect(names[1]).toBe('qwen3-coder:30b');
    expect(names.indexOf('gpt-oss:20b-64k')).toBeLessThan(names.indexOf('qwen2.5-coder:1.5b-base'));
    expect(names.indexOf('deepseek-r1:14b')).toBeLessThan(names.indexOf('qwen3-coder-next:cloud'));
    expect(names.indexOf('gemma4:26b')).toBeLessThan(names.indexOf('gemma4:31b-cloud'));
  });

  it('v2.1: streams Startup Assistant Chat & generates custom multi-screen projects with non-overlapping coordinates and TS handlers via Ollama', async () => {
    const customProjectJson = JSON.stringify({
      projectName: 'Clinica Dentale Sorriso Pro',
      paletteId: 'ocean-blue',
      defaultThemeMode: 'dark',
      includeThreeScene: false,
      summary: 'Gestionale appuntamenti odontoiatrici, piani di cura e preventivi pazienti.',
      screens: [
        {
          name: 'AgendaPoltrone',
          title: 'Agenda Appuntamenti & Poltrone',
          subtitle: 'Pianificazione giornaliera studi odontoiatrici e stato sale operative',
          navItems: ['Agenda', 'Pazienti', 'Preventivi', 'Richiami'],
          kpis: [
            { label: 'Appuntamenti Oggi', value: '28 Visite', trend: '4 poltrone attive' },
            { label: 'Preventivi Accettati', value: '€ 19.400', trend: '+22% questo mese' },
            { label: 'Tasso Puntualità', value: '96,5%', trend: 'Ottimo' },
          ],
          formTitle: 'Nuovo Appuntamento Rapido',
          formFields: [
            {
              name: 'nomePaziente',
              label: 'Paziente',
              controlType: 'text-input',
              placeholder: 'Es. Marco Bellini',
            },
            {
              name: 'trattamento',
              label: 'Prestazione Odontoiatrica',
              controlType: 'select',
              placeholder: 'Igiene | Conservativa | Implantologia',
            },
          ],
          primaryActionLabel: 'Conferma Appuntamento',
          primaryHandlerFn: 'onBookDentalVisit',
          secondaryActionLabel: 'Stampa Foglio Sala',
          tableTitle: 'Visite in Programma Oggi',
          tableColumns: ['Ora', 'Paziente', 'Poltrona', 'Stato'],
          tableRows: [
            ['09:30', 'Giulia Rinaldi', 'Sala 1', 'In Corso'],
            ['10:30', 'Marco Bellini', 'Sala 2', 'Confermato'],
          ],
        },
      ],
      handlersTs:
        'export function onBookDentalVisit(data?: Record<string, unknown>) {\n  return { booked: true, data };\n}\n',
    });

    let callIndex = 0;
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) {
        return new Response(
          JSON.stringify({ models: [{ name: 'qwen3-coder:30b' }, { name: 'nomic-embed-text:latest' }] }),
          { status: 200 },
        );
      }
      if (url.endsWith('/api/ps')) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      if (url.endsWith('/api/chat')) {
        callIndex++;
        if (callIndex === 1) {
          return createNdjsonStreamResponse([
            { message: { content: 'Per un gestionale odontoiatrico consiglio ' } },
            { message: { content: 'Agenda Poltrone + Scheda Paziente in Tauri v2 o React.' } },
          ]);
        }
        return createNdjsonStreamResponse([
          { message: { content: customProjectJson.slice(0, 120) } },
          { message: { content: customProjectJson.slice(120) } },
        ]);
      }
      return new Response('Not found', { status: 404 });
    };

    const service = createAiWorkerService({ fetchImpl: mockFetch });
    const chatEvents: AgentStreamEvent[] = [];
    const chatRes = await service.askStartupAssistant(
      {
        prompt: 'Come strutturo un gestionale per studio dentistico?',
        provider: 'ollama',
        runId: 'startup-chat',
      },
      (ev) => chatEvents.push(ev),
    );

    expect(chatRes.usedFallbackOffline).toBe(false);
    expect(chatRes.modelName).toBe('qwen3-coder:30b');
    expect(chatRes.reply).toContain('Agenda Poltrone');
    expect(chatEvents.some((e) => e.type === 'token_delta' && e.runId === 'startup-chat')).toBe(true);

    const genEvents: AgentStreamEvent[] = [];
    const genOut = await service.generateProjectSeedWithAi(
      {
        prompt: 'Crea un gestionale per clinica dentale con agenda poltrone e preventivi',
        primaryTarget: 'react-tsx',
        stylingPreset: 'tailwind',
        layoutMode: 'freeform',
        provider: 'ollama',
      },
      (ev) => genEvents.push(ev),
    );

    expect(genOut.usedFallbackOffline).toBe(false);
    expect(genOut.seed.projectName).toBe('Clinica Dentale Sorriso Pro');
    expect(genOut.paletteId).toBe('ocean-blue');
    expect(genEvents.some((e) => e.type === 'project_gen_status' && e.status.includes('Analisi requisiti'))).toBe(true);
    expect(genEvents.some((e) => e.type === 'project_gen_status' && e.status.includes('Costruzione schermate'))).toBe(
      true,
    );

    const primarySheet = genOut.seed.sheets[0];
    expect(primarySheet.name).toBe('AgendaPoltrone');
    expect(Object.keys(primarySheet.nodes).length).toBeGreaterThanOrEqual(12);

    // Verify top-level freeform children have non-overlapping absolute bounding boxes
    const rootArt = primarySheet.nodes[primarySheet.rootIds[0]];
    expect(rootArt.layout.mode).toBe('freeform');
    const topRects = rootArt.childIds.map((cid) => primarySheet.nodes[cid].layout.frame);
    for (let i = 0; i < topRects.length; i++) {
      for (let j = i + 1; j < topRects.length; j++) {
        const a = topRects[i];
        const b = topRects[j];
        const overlaps =
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y;
        expect(overlaps).toBe(false);
      }
    }

    const scriptVfs = genOut.seed.vfsItems.find((v) => v.entryKind === 'script_file')!;
    expect(scriptVfs.contentText).toContain('export function onBookDentalVisit');
  });
});
