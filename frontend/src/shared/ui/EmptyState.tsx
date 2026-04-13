import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <section
      aria-live="polite"
      style={{
        backgroundColor: 'var(--color-surface-muted)',
        border: '1px dashed var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        color: 'var(--color-text-muted)',
        display: 'grid',
        gap: 'var(--space-2)',
        justifyItems: 'start',
        padding: 'var(--space-6)'
      }}
    >
      <h2 style={{ color: 'var(--color-text)', margin: 0 }}>{title}</h2>
      {description ? <p style={{ margin: 0 }}>{description}</p> : null}
      {action ? <div>{action}</div> : null}
    </section>
  );
}
