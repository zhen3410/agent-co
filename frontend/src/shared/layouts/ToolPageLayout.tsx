import type { ReactNode } from 'react';
import { AppShell } from './AppShell';

export interface ToolPageLayoutProps {
  appTitle: ReactNode;
  pageTitle: ReactNode;
  description?: ReactNode;
  navigation?: ReactNode;
  actions?: ReactNode;
  sidebar?: ReactNode;
  children?: ReactNode;
}

export function ToolPageLayout({
  appTitle,
  pageTitle,
  description,
  navigation,
  actions,
  sidebar,
  children
}: ToolPageLayoutProps) {
  return (
    <AppShell title={appTitle} navigation={navigation} actions={actions}>
      <div
        data-layout="tool-page"
        style={{
          display: 'grid',
          gap: 'var(--space-4)',
          gridTemplateColumns: sidebar ? 'minmax(14rem, 18rem) minmax(0, 1fr)' : '1fr'
        }}
      >
        {sidebar ? (
          <aside
            data-layout="tool-page-sidebar"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-3)'
            }}
          >
            {sidebar}
          </aside>
        ) : null}
        <section
          data-layout="tool-page-content"
          style={{
            display: 'grid',
            gap: 'var(--space-3)'
          }}
        >
          <header>
            <h2 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>{pageTitle}</h2>
            {description ? <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>{description}</p> : null}
          </header>
          <div>{children}</div>
        </section>
      </div>
    </AppShell>
  );
}
