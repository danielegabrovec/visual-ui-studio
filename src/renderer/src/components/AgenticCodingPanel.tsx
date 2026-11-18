import React, { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Cpu,
  History,
  ImagePlus,
  Package,
  RefreshCw,
  Send,
  Sparkles,
  Wrench,
} from 'lucide-react';
import type { AgentExecutionMode, LocalAIProviderKind } from '@shared/ipc-contract';
import { useStudioStore } from '@renderer/state/studio-store';

const PROVIDER_LABELS: Record<LocalAIProviderKind, string> = {
  ollama: 'Ollama (:11434)',
  lmstudio: 'LM Studio (:1234)',
  openai_compat: 'OpenAI-Compat / llama.cpp',
  builtin_offline: 'Offline Built-in Synthesizer',
};

const MODE_OPTIONS: Array<{ id: AgentExecutionMode; label: string }> = [
  { id: 'prompt_to_ui', label: 'Prompt -> UI' },
  { id: 'vision_to_ui', label: 'Vision -> UI' },
  { id: 'surgical', label: 'Co-Pilot Chirurgico' },
  { id: 'refactor', label: 'Refactor Codice' },
];

export const AgenticCodingPanel: React.FC = () => {
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const activeSheetId = useStudioStore((s) => s.activeSheetId);
  const sheetDocuments = useStudioStore((s) => s.sheetDocuments);
  const selectedNodeIds = useStudioStore((s) => s.selectedNodeIds);
  const globalTarget = useStudioStore((s) => s.globalTarget);
  const hardwareReport = useStudioStore((s) => s.hardwareReport);
  const providers = useStudioStore((s) => s.providers);
  const activeProvider = useStudioStore((s) => s.activeProvider);
  const activeModel = useStudioStore((s) => s.activeModel);
  const agentMode = useStudioStore((s) => s.agentMode);
  const messages = useStudioStore((s) => s.messages);
  const streamingRun = useStudioStore((s) => s.streamingRun);
  const isRunningAgent = useStudioStore((s) => s.isRunningAgent);
  const visionImageBase64 = useStudioStore((s) => s.visionImageBase64);
  const aiPromptFocusTick = useStudioStore((s) => s.aiPromptFocusTick);

  const refreshAiProviders = useStudioStore((s) => s.refreshAiProviders);
  const setActiveProvider = useStudioStore((s) => s.setActiveProvider);
  const setActiveModel = useStudioStore((s) => s.setActiveModel);
  const setAgentMode = useStudioStore((s) => s.setAgentMode);
  const setVisionImageBase64 = useStudioStore((s) => s.setVisionImageBase64);
  const sendAgentPrompt = useStudioStore((s) => s.sendAgentPrompt);
  const restoreAiCheckpoint = useStudioStore((s) => s.restoreAiCheckpoint);
  const setUnslothModalOpen = useStudioStore((s) => s.setUnslothModalOpen);

  const [promptDraft, setPromptDraft] = useState('');

  const activeSheet = sheetDocuments[activeSheetId];
  const selectedNode = activeSheet && selectedNodeIds[0] ? activeSheet.nodes[selectedNodeIds[0]] : null;
  const currentProvObj = providers.find((p) => p.id === activeProvider);

  useEffect(() => {
    if (aiPromptFocusTick > 0 && promptInputRef.current) {
      promptInputRef.current.focus();
    }
  }, [aiPromptFocusTick]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages.length, streamingRun?.text]);

  const handleImageUpload = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setVisionImageBase64(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!promptDraft.trim() || isRunningAgent) return;
    const text = promptDraft;
    setPromptDraft('');
    void sendAgentPrompt(text);
  };

  const ramGb = hardwareReport ? Math.round(hardwareReport.totalSystemRamMb / 1024) : 16;

  return (
    <div className="agent-panel" data-testid="agentic-coding-panel">
      {/* Provider, Model, Hardware Fit Badge & Unsloth Hub */}
      <div
        style={{
          padding: '8px 10px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          background: 'var(--bg-panel)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span
            title={currentProvObj?.online ? 'Daemon Online' : 'Offline — uso sintetizzatore locale integrato'}
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: currentProvObj?.online ? 'var(--accent-emerald)' : 'var(--accent-amber)',
              flexShrink: 0,
            }}
          />
          <select
            className="studio-select"
            data-testid="ai-provider-select"
            style={{ flex: 1, height: 25, fontSize: 11.5 }}
            value={activeProvider}
            onChange={(e) => setActiveProvider(e.target.value as LocalAIProviderKind)}
          >
            {(['ollama', 'lmstudio', 'openai_compat', 'builtin_offline'] as LocalAIProviderKind[]).map((pid) => (
              <option key={pid} value={pid}>
                {PROVIDER_LABELS[pid]}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="studio-btn sm"
            data-testid="btn-refresh-ai"
            onClick={() => void refreshAiProviders()}
            title="Aggiorna provider locali e stato VRAM"
          >
            <RefreshCw size={12} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {currentProvObj && currentProvObj.models.length > 0 ? (
            <select
              className="studio-select"
              data-testid="ai-model-select"
              style={{ flex: 1, height: 25, fontSize: 11.5 }}
              value={activeModel}
              onChange={(e) => setActiveModel(e.target.value)}
            >
              {currentProvObj.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} {m.vramUsedMb ? `(${Math.round(m.vramUsedMb / 1024)}GB VRAM)` : ''}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="studio-input"
              data-testid="ai-model-input"
              style={{ flex: 1, height: 25, fontSize: 11.5 }}
              value={activeModel}
              onChange={(e) => setActiveModel(e.target.value)}
              placeholder="Modello (es. qwen2.5-coder:7b)"
            />
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 5, flexWrap: 'wrap' }}>
          <span
            className="badge green"
            data-testid="hardware-vram-badge"
            title={hardwareReport?.adviceSummary ?? 'Hardware Advisor'}
          >
            <Cpu size={11} />
            <span>
              RAM {ramGb}GB • Tier {hardwareReport?.recommendedTier?.toUpperCase() ?? 'MID'}
            </span>
          </span>

          <button
            type="button"
            className="studio-btn sm violet"
            data-testid="btn-open-unsloth"
            onClick={() => setUnslothModalOpen(true)}
          >
            <Package size={12} />
            <span>📦 Unsloth Hub &amp; Dataset</span>
          </button>
        </div>

        {/* Context Pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          <span className="badge blue">@Foglio: {activeSheet?.name ?? '—'}</span>
          <span className="badge violet">@Nodo: {selectedNode ? selectedNode.name : 'Artboard'}</span>
          <span className="badge">@Target: {globalTarget}</span>
        </div>

        {/* 4 Execution Mode Pills */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
          {MODE_OPTIONS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`studio-btn sm ${agentMode === m.id ? 'active' : ''}`}
              data-testid={`ai-mode-${m.id}`}
              onClick={() => setAgentMode(m.id)}
            >
              <span>{m.label}</span>
            </button>
          ))}
        </div>

        {/* Vision -> UI Dropzone / Paste */}
        {agentMode === 'vision_to_ui' && (
          <div
            style={{
              padding: 8,
              borderRadius: 7,
              border: '1px dashed var(--border-strong)',
              background: 'var(--bg-input)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11 }}>
              <ImagePlus size={14} color="var(--accent-violet)" />
              <span>{visionImageBase64 ? 'Immagine allegata ✓' : 'Carica o Incolla Screenshot UI'}</span>
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => handleImageUpload(e.target.files?.[0] ?? null)}
              />
            </label>
            {visionImageBase64 && (
              <button type="button" className="studio-btn sm" onClick={() => setVisionImageBase64(null)}>
                Rimuovi
              </button>
            )}
          </div>
        )}
      </div>

      {/* Chat & Tool-Execution Stream */}
      <div ref={chatScrollRef} className="agent-chat-scroll" data-testid="ai-chat-feed">
        {messages.length === 0 && !streamingRun && (
          <div
            style={{
              padding: 10,
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-panel-elevated)',
              display: 'flex',
              flexDirection: 'column',
              gap: 7,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
              <Bot size={15} color="var(--accent-primary)" />
              <span>Local Agentic UI Architect</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
              Genera interfacce Auto-Layout, collega attributi HTMX o ViewModel MVVM con checkpoint SQLite automatici.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {[
                'Aggiungi sezione Pricing a 3 colonne con CTA',
                'Crea card filtro ordini con barra HTMX live',
                'Aggiungi form profilo con Switch e Salva',
              ].map((starter) => (
                <button
                  key={starter}
                  type="button"
                  className="studio-btn sm"
                  onClick={() => void sendAgentPrompt(starter)}
                >
                  <Sparkles size={11} color="var(--accent-violet)" />
                  <span>{starter}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`chat-bubble ${msg.role === 'user' ? 'user' : 'assistant'}`}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4 }}>
              {msg.role === 'user' ? 'TU' : '🤖 STUDIO AGENT'}
            </div>

            {msg.thinkingText && (
              <details style={{ marginBottom: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
                <summary style={{ cursor: 'pointer' }}>Ragionamento architetturale</summary>
                <div style={{ paddingTop: 4 }}>{msg.thinkingText}</div>
              </details>
            )}

            <div style={{ whiteSpace: 'pre-wrap' }}>{msg.contentText}</div>

            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 7 }}>
                {msg.toolCalls.map((tc) => (
                  <div
                    key={tc.id}
                    className="badge blue"
                    data-testid={`tool-badge-${tc.toolName}`}
                    style={{ justifyContent: 'space-between', padding: '4px 7px', width: '100%' }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Wrench size={11} /> {tc.toolName}
                    </span>
                    <span>{tc.resultSummary}</span>
                  </div>
                ))}
              </div>
            )}

            {msg.preCheckpointId && (
              <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="studio-btn sm"
                  data-testid="btn-restore-checkpoint"
                  onClick={() => void restoreAiCheckpoint(msg.preCheckpointId!)}
                >
                  <History size={12} />
                  <span>⏪ Ripristina Checkpoint</span>
                </button>
              </div>
            )}
          </div>
        ))}

        {streamingRun && (
          <div className="chat-bubble assistant">
            <div style={{ fontSize: 10.5, color: 'var(--accent-primary)', fontWeight: 700, marginBottom: 4 }}>
              ⚡ Sintesi UI-IR in corso...
            </div>
            {streamingRun.text && <div style={{ whiteSpace: 'pre-wrap' }}>{streamingRun.text}</div>}
            {streamingRun.toolCalls.map((tc) => (
              <div key={tc.id} className="badge violet" style={{ marginTop: 4 }}>
                <Wrench size={11} /> {tc.toolName}: {tc.status}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Prompt Composer */}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: 8,
          borderTop: '1px solid var(--border-subtle)',
          background: 'var(--bg-header)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <textarea
          ref={promptInputRef}
          className="studio-textarea"
          data-testid="ai-prompt-input"
          rows={2}
          placeholder="Descrivi la UI da generare o modificare sul foglio attivo..."
          value={promptDraft}
          onPaste={(e) => {
            const item = Array.from(e.clipboardData.items).find((it) => it.type.startsWith('image/'));
            if (item) {
              setAgentMode('vision_to_ui');
              handleImageUpload(item.getAsFile());
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          onChange={(e) => setPromptDraft(e.target.value)}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
            Checkpoint SQLite pre-modifica attivo
          </span>
          <button
            type="submit"
            className="studio-btn sm primary"
            data-testid="btn-send-ai-prompt"
            disabled={isRunningAgent || !promptDraft.trim()}
          >
            <Send size={12} />
            <span>{isRunningAgent ? 'Generazione...' : 'Genera UI ✨'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
