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
      className="layout-app-shell"
      style={style}
    >
      <header
        data-layout="app-shell-header"
        className="layout-app-shell__header"
      >
        <div className="layout-app-shell__nav">{navigation}</div>
        <div className="layout-app-shell__titles">
          <h1 className="layout-app-shell__title">{title}</h1>
          {subtitle ? <p className="layout-app-shell__subtitle">{subtitle}</p> : null}
        </div>
        <div className="layout-app-shell__actions">{actions}</div>
      </header>
      <main
        data-layout="app-shell-main"
        className="layout-app-shell__main"
      >
        {children}
      </main>
    </div>
  );
}
