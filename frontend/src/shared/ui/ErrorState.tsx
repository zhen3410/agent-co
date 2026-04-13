import type { ReactNode } from 'react';

export interface ErrorStateProps {
  title?: ReactNode;
  message: ReactNode;
  action?: ReactNode;
}

export function ErrorState({ title = 'Something went wrong', message, action }: ErrorStateProps) {
  return (
    <section
      role="alert"
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--status-error)',
        borderRadius: 'var(--radius-lg)',
        color: 'var(--status-error)',
        display: 'grid',
        gap: 'var(--space-2)',
        padding: 'var(--space-4)'
      }}
    >
      <h2 style={{ margin: 0 }}>{title}</h2>
      <p style={{ margin: 0 }}>{message}</p>
      {action ? <div>{action}</div> : null}
    </section>
  );
}
