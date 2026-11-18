import React, { useId, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type {
  DesignTokenEntry,
  InteractiveStateKey,
  LayoutSpec,
  ReusableCssClass,
  StyleSpec,
  TypographySpec,
  UINode,
  UISheetDocument,
} from '@shared/ui-ir';

export interface InspectorSectionProps {
  node: UINode;
  sheet: UISheetDocument;
  tokens: DesignTokenEntry[];
  tokenMap: Record<string, string | number>;
  activeState: 'base' | InteractiveStateKey;
  editingReusableClass: ReusableCssClass | null;
  effectiveLayout: LayoutSpec;
  effectiveStyle: StyleSpec;
  effectiveTypography: TypographySpec | undefined;
  applyLayoutPatch: (patch: Partial<LayoutSpec>, label: string) => void;
  applyStylePatch: (patch: Partial<StyleSpec>, label: string) => void;
  applyTypographyPatch: (patch: Partial<TypographySpec>, label: string) => void;
}

export interface CollapsibleSectionProps {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  testId?: string;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  badge,
  defaultOpen = true,
  testId,
  rightSlot,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div className="prop-group" data-testid={testId} style={{ padding: 0, overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          padding: '7px 9px',
          background: open ? 'transparent' : 'var(--bg-panel)',
          borderBottom: open ? '1px solid var(--border-subtle)' : 'none',
          userSelect: 'none',
        }}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((v) => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: 1, padding: 0,
            border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
          }}
        >
          {open ? (
            <ChevronDown size={12} color="var(--text-muted)" />
          ) : (
            <ChevronRight size={12} color="var(--text-muted)" />
          )}
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: 'var(--text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </span>
          {badge && <span className="badge">{badge}</span>}
        </button>
        {rightSlot && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {rightSlot}
          </div>
        )}
      </div>
      <div id={contentId} hidden={!open} style={{ padding: '8px 9px' }}>{open && children}</div>
    </div>
  );
};

export function toSafeHexColor(raw: string | number | undefined, fallback = '#2563eb'): string {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{8}$/.test(trimmed)) return trimmed.slice(0, 7);
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  const rgbMatch = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    const r = Math.min(255, Math.max(0, Number(rgbMatch[1]))).toString(16).padStart(2, '0');
    const g = Math.min(255, Math.max(0, Number(rgbMatch[2]))).toString(16).padStart(2, '0');
    const b = Math.min(255, Math.max(0, Number(rgbMatch[3]))).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return fallback;
}
