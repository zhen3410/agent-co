import type { CSSProperties } from 'react';

export interface DependencyStatusBadgeProps {
  healthy: boolean;
  children: string;
}

export function DependencyStatusBadge({ healthy, children }: DependencyStatusBadgeProps) {
  return (
    <span
      data-dependency-badge={healthy ? 'healthy' : 'unhealthy'}
      style={{
        ...badgeStyle,
        background: healthy ? 'rgba(5, 150, 105, 0.12)' : 'rgba(220, 38, 38, 0.12)',
        color: healthy ? 'var(--status-success)' : 'var(--status-error)'
      }}
    >
      {children}
    </span>
  );
}

const badgeStyle: CSSProperties = {
  alignItems: 'center',
  borderRadius: '999px',
  display: 'inline-flex',
  fontSize: '0.75rem',
  fontWeight: 600,
  gap: '0.25rem',
  padding: '0.2rem 0.55rem'
};
