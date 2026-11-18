import React from 'react';

export interface SqlScriptEditorProps {
  label: string;
  testId: string;
  value: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  rows?: number;
  style?: React.CSSProperties;
}

export function SqlScriptEditor({ label, testId, value, onChange, onSave, rows, style }: SqlScriptEditorProps) {
  return (
    <textarea
      aria-label={label}
      data-testid={testId}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (!onSave || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) onSave();
      }}
      rows={rows}
      wrap="off"
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      className="selectable-text"
      style={{
        boxSizing: 'border-box',
        width: '100%',
        minWidth: 0,
        minHeight: 0,
        margin: 0,
        padding: 12,
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        background: 'var(--code-bg)',
        color: 'var(--text-primary)',
        fontFamily: "'JetBrains Mono', Consolas, monospace",
        fontSize: 12,
        lineHeight: 1.5,
        resize: 'vertical',
        ...style,
      }}
    />
  );
}
