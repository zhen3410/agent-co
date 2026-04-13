import type { CSSProperties, ReactNode } from 'react';

export interface SpinnerProps {
  label?: ReactNode;
  size?: number;
}

export function Spinner({ label = 'Loading…', size = 18 }: SpinnerProps) {
  const indicatorStyle: CSSProperties = {
    animation: 'spin 0.8s linear infinite',
    border: '2px solid var(--color-border)',
    borderRadius: '50%',
    borderTopColor: 'var(--color-primary)',
    display: 'inline-block',
    height: `${size}px`,
    width: `${size}px`
  };

  return (
    <span
      role="status"
      aria-live="polite"
      style={{ alignItems: 'center', color: 'var(--color-text-muted)', display: 'inline-flex', gap: 'var(--space-2)' }}
    >
      <span aria-hidden="true" style={indicatorStyle} />
      <span>{label}</span>
    </span>
  );
}
