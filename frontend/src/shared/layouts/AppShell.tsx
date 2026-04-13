import type { CSSProperties, ReactNode } from 'react';

export interface AppShellProps {
  title: ReactNode;
  subtitle?: ReactNode;
  navigation?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
}

export function AppShell({ title, subtitle, navigation, actions, children, style }: AppShellProps) {
  return (
    <div
      data-layout="app-shell"
      style={{
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
        minHeight: '100vh',
        ...style
      }}
    >
      <header
        data-layout="app-shell-header"
        style={{
          alignItems: 'center',
          background: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
          display: 'grid',
          gap: 'var(--space-3)',
          gridTemplateColumns: 'minmax(0, auto) 1fr auto',
          padding: 'var(--space-3) var(--space-4)'
        }}
      >
        <div>{navigation}</div>
        <div>
          <h1 style={{ fontSize: 'var(--font-size-xl)', margin: 0 }}>{title}</h1>
          {subtitle ? <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>{subtitle}</p> : null}
        </div>
        <div style={{ justifySelf: 'end' }}>{actions}</div>
      </header>
      <main
        data-layout="app-shell-main"
        style={{
          padding: 'var(--space-4)'
        }}
      >
        {children}
      </main>
    </div>
  );
}
