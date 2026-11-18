import React, { useState } from 'react';
import { Copy, Cpu, Database, Download, FileCode2, Package, Plus, Sparkles, X } from 'lucide-react';
import { useStudioStore } from '@renderer/state/studio-store';

export const UnslothHubModal: React.FC = () => {
  const isOpen = useStudioStore((s) => s.isUnslothModalOpen);
  const hardwareReport = useStudioStore((s) => s.hardwareReport);
  const unslothCatalog = useStudioStore((s) => s.unslothCatalog);
  const unslothPairs = useStudioStore((s) => s.unslothPairs);
  const pullProgress = useStudioStore((s) => s.pullProgress);
  const lastUnslothExport = useStudioStore((s) => s.lastUnslothExport);

  const setUnslothModalOpen = useStudioStore((s) => s.setUnslothModalOpen);
  const pullUnslothModel = useStudioStore((s) => s.pullUnslothModel);
  const recordGoldenPairFromActiveSheet = useStudioStore((s) => s.recordGoldenPairFromActiveSheet);
  const exportUnslothBundle = useStudioStore((s) => s.exportUnslothBundle);
  const pushToast = useStudioStore((s) => s.pushToast);

  const [tab, setTab] = useState<'models' | 'dataset'>('models');
  const [format, setFormat] = useState<'sharegpt' | 'alpaca'>('sharegpt');
  const [baseModelRepo, setBaseModelRepo] = useState('unsloth/Qwen2.5-Coder-7B-Instruct-bnb-4bit');

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={() => setUnslothModalOpen(false)}>
      <div
        className="modal-card"
        data-testid="unsloth-hub-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-header)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Package size={16} color="var(--accent-violet)" />
            <strong style={{ fontSize: 14 }}>Unsloth Local LLM Hub &amp; LoRA Dataset Exporter</strong>
          </div>
          <button
            type="button"
            className="studio-btn sm"
            data-testid="btn-close-unsloth"
            onClick={() => setUnslothModalOpen(false)}
          >
            <X size={13} />
          </button>
        </div>

        {/* Sub-Tabs */}
        <div
          style={{
            padding: '8px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div className="segmented-group">
            <button
              type="button"
              className={`segmented-item ${tab === 'models' ? 'active' : ''}`}
              data-testid="unsloth-tab-models"
              onClick={() => setTab('models')}
            >
              <Cpu size={12} />
              <span>Modelli Unsloth GGUF (Ollama Pull)</span>
            </button>
            <button
              type="button"
              className={`segmented-item ${tab === 'dataset' ? 'active' : ''}`}
              data-testid="unsloth-tab-dataset"
              onClick={() => setTab('dataset')}
            >
              <Database size={12} />
              <span>Dataset JSONL &amp; train_unsloth_lora.py ({unslothPairs.length})</span>
            </button>
          </div>

          {hardwareReport && (
            <span className="badge green">
              Hardware: {Math.round(hardwareReport.totalSystemRamMb / 1024)}GB RAM • Tier {hardwareReport.recommendedTier.toUpperCase()}
            </span>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          {tab === 'models' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {hardwareReport && (
                <div
                  style={{
                    padding: '9px 12px',
                    borderRadius: 8,
                    background: 'var(--accent-soft)',
                    border: '1px solid rgba(59,130,246,0.35)',
                    fontSize: 12,
                  }}
                >
                  💡 <strong>Hardware Advisor:</strong> {hardwareReport.adviceSummary}
                </div>
              )}

              {pullProgress && (
                <div
                  style={{
                    padding: 10,
                    borderRadius: 8,
                    border: '1px solid var(--accent-violet)',
                    background: 'var(--accent-violet-soft)',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 12 }}>{pullProgress.modelRef}</div>
                  <div style={{ fontSize: 11, marginTop: 3 }}>
                    {pullProgress.status} {pullProgress.percent !== undefined ? `(${pullProgress.percent}%)` : ''}
                  </div>
                </div>
              )}

              {unslothCatalog.map((rec) => (
                <div
                  key={rec.id}
                  style={{
                    padding: 12,
                    borderRadius: 9,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-panel-elevated)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 13 }}>{rec.displayName}</strong>
                      <span className="badge violet">{rec.quantization}</span>
                      <span className="badge blue">~{rec.estimatedVramGb} GB VRAM</span>
                      <span className="badge">{rec.role.toUpperCase()}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 4 }}>
                      {rec.description}
                    </div>
                    <code style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                      ollama run {rec.ollamaPullUri}
                    </code>
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      type="button"
                      className="studio-btn sm"
                      onClick={() => {
                        void navigator.clipboard?.writeText(`ollama run ${rec.ollamaPullUri}`);
                        pushToast('info', `Comando CLI copiato: ollama run ${rec.ollamaPullUri}`);
                      }}
                      title="Copia comando CLI"
                    >
                      <Copy size={12} />
                    </button>
                    <button
                      type="button"
                      className="studio-btn sm primary"
                      data-testid={`btn-pull-unsloth-${rec.id}`}
                      onClick={() => void pullUnslothModel(rec.ollamaPullUri)}
                    >
                      <Download size={12} />
                      <span>1-Click Pull</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div
                style={{
                  padding: 12,
                  borderRadius: 9,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-panel-elevated)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong style={{ fontSize: 13 }}>Esporta Pipeline QLoRA Unsloth da SQLite</strong>
                    <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                      Genera dataset JSONL (Prompt + UI-IR -&gt; Codice Target), script Python <code>train_unsloth_lora.py</code> e <code>Modelfile</code>.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="studio-btn sm"
                    data-testid="btn-record-golden-pair"
                    onClick={() => void recordGoldenPairFromActiveSheet()}
                  >
                    <Plus size={12} />
                    <span>+ Registra Foglio Attivo ({unslothPairs.length})</span>
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 8 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
                    <span>Formato Dataset</span>
                    <select
                      className="studio-select"
                      value={format}
                      onChange={(e) => setFormat(e.target.value as 'sharegpt' | 'alpaca')}
                    >
                      <option value="sharegpt">ShareGPT (Consigliato)</option>
                      <option value="alpaca">Alpaca Instruct</option>
                    </select>
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
                    <span>Base Model Unsloth 4-bit</span>
                    <select
                      className="studio-select"
                      value={baseModelRepo}
                      onChange={(e) => setBaseModelRepo(e.target.value)}
                    >
                      <option value="unsloth/Qwen2.5-Coder-7B-Instruct-bnb-4bit">
                        unsloth/Qwen2.5-Coder-7B-Instruct-bnb-4bit
                      </option>
                      <option value="unsloth/Qwen2.5-Coder-14B-Instruct-bnb-4bit">
                        unsloth/Qwen2.5-Coder-14B-Instruct-bnb-4bit
                      </option>
                      <option value="unsloth/Qwen2.5-VL-7B-Instruct-bnb-4bit">
                        unsloth/Qwen2.5-VL-7B-Instruct-bnb-4bit
                      </option>
                    </select>
                  </label>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="studio-btn primary"
                    data-testid="btn-export-unsloth-dataset"
                    onClick={() => void exportUnslothBundle(format, baseModelRepo)}
                  >
                    <Sparkles size={13} />
                    <span>🚀 Esporta JSONL + train_unsloth_lora.py</span>
                  </button>
                </div>
              </div>

              {lastUnslothExport && (
                <div
                  data-testid="unsloth-export-result"
                  style={{
                    padding: 12,
                    borderRadius: 9,
                    border: '1px solid var(--accent-emerald)',
                    background: 'var(--accent-emerald-soft)',
                    fontSize: 11.5,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <strong>✅ Esportazione Completata ({lastUnslothExport.pairCount} coppie di training):</strong>
                  <div>
                    <FileCode2 size={12} style={{ verticalAlign: 'middle' }} /> Dataset:{' '}
                    <code>{lastUnslothExport.datasetFilePath}</code>
                  </div>
                  <div>
                    <FileCode2 size={12} style={{ verticalAlign: 'middle' }} /> Script LoRA:{' '}
                    <code>{lastUnslothExport.trainScriptPath}</code>
                  </div>
                  <div>
                    <FileCode2 size={12} style={{ verticalAlign: 'middle' }} /> Ollama Modelfile:{' '}
                    <code>{lastUnslothExport.modelfilePath}</code>
                  </div>
                </div>
              )}

              {unslothPairs.length > 0 && (
                <div>
                  <div className="palette-category-title">Esempi Golden Registrati ({unslothPairs.length})</div>
                  {unslothPairs.slice(0, 8).map((p) => (
                    <div
                      key={p.id}
                      style={{
                        padding: '7px 10px',
                        borderBottom: '1px solid var(--border-subtle)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 11.5,
                      }}
                    >
                      <span>{p.promptSummary}</span>
                      <span className="badge blue">{p.targetFramework}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
