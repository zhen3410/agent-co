import type { CSSProperties, ReactNode } from 'react';

export interface CardProps {
  title?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
}

export function Card({ title, actions, children, style }: CardProps) {
  return (
    <article
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: 'var(--space-4)',
        ...style
      }}
    >
      {title || actions ? (
        <header
          style={{
            alignItems: 'center',
            display: 'flex',
            gap: 'var(--space-3)',
            justifyContent: 'space-between',
            marginBottom: 'var(--space-3)'
          }}
        >
          {title ? <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>{title}</h2> : null}
          {actions}
        </header>
      ) : null}
      <div>{children}</div>
    </article>
  );
}
