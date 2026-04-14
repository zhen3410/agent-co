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
        data-has-sidebar={sidebar ? 'true' : 'false'}
        className="layout-tool-page"
      >
        {sidebar ? (
          <aside
            data-layout="tool-page-sidebar"
            className="layout-tool-page__sidebar"
          >
            {sidebar}
          </aside>
        ) : null}
        <section
          data-layout="tool-page-content"
          className="layout-tool-page__content"
        >
          <header className="layout-tool-page__header">
            <h2 className="layout-tool-page__title">{pageTitle}</h2>
            {description ? <p className="layout-tool-page__description">{description}</p> : null}
          </header>
          <div className="layout-tool-page__body">{children}</div>
        </section>
      </div>
    </AppShell>
  );
}
