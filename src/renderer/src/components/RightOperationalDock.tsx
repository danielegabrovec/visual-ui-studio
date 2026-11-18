import React from 'react';
import { Bot, Columns2, SlidersHorizontal } from 'lucide-react';
import { useStudioStore } from '@renderer/state/studio-store';
import { AgenticCodingPanel } from './AgenticCodingPanel';
import { PropertyInspectorPanel } from './PropertyInspectorPanel';

export const RightOperationalDock: React.FC<{ width: number }> = ({ width }) => {
  const rightPanelMode = useStudioStore((s) => s.rightPanelMode);
  const setRightPanelMode = useStudioStore((s) => s.setRightPanelMode);

  return (
    <aside
      className="right-operational-dock"
      style={{ width: Math.max(300, width) }}
      data-testid="right-operational-dock"
      aria-label="Agentic Coding e Precision Property Inspector"
    >
      {/* Segmented Header Switch: [ 🤖 Agent AI | 🎛️ Proprietà | ⧉ Split ] */}
      <div className="dock-header">
        <div
          className="segmented-group"
          role="group"
          aria-label="Modalità pannello destro"
          data-testid="right-dock-mode-switch"
          style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}
        >
          <button
            type="button"
            aria-pressed={rightPanelMode === 'agent'}
            className={`segmented-item ${rightPanelMode === 'agent' ? 'active' : ''}`}
            data-testid="right-mode-agent"
            onClick={() => setRightPanelMode('agent')}
          >
            <Bot size={12} />
            <span>🤖 Agent AI</span>
          </button>
          <button
            type="button"
            aria-pressed={rightPanelMode === 'inspector'}
            className={`segmented-item ${rightPanelMode === 'inspector' ? 'active' : ''}`}
            data-testid="right-mode-inspector"
            onClick={() => setRightPanelMode('inspector')}
          >
            <SlidersHorizontal size={12} />
            <span>🎛️ Proprietà</span>
          </button>
          <button
            type="button"
            aria-pressed={rightPanelMode === 'split'}
            className={`segmented-item ${rightPanelMode === 'split' ? 'active' : ''}`}
            data-testid="right-mode-split"
            onClick={() => setRightPanelMode('split')}
          >
            <Columns2 size={12} />
            <span>⧉ Split</span>
          </button>
        </div>
      </div>

      {/* Panel Content */}
      {rightPanelMode === 'agent' && <AgenticCodingPanel />}
      {rightPanelMode === 'inspector' && <PropertyInspectorPanel />}
      {rightPanelMode === 'split' && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: '1 1 52%', minHeight: 0, display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border-strong)' }}>
            <AgenticCodingPanel />
          </div>
          <div style={{ flex: '1 1 48%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <PropertyInspectorPanel />
          </div>
        </div>
      )}
    </aside>
  );
};
