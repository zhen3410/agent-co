import type { ReactNode } from 'react';

export interface AdminFormPageProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

export function AdminFormPage({ title, description, actions, children }: AdminFormPageProps) {
  return (
    <section data-admin-layout="form-page" className="admin-form-page">
      <header className="admin-page-header">
        <div>
          <h2 className="admin-page-title">{title}</h2>
          {description ? <p className="admin-page-description">{description}</p> : null}
        </div>
        {actions ? <div className="admin-page-actions">{actions}</div> : null}
      </header>
      <div className="admin-form-page__body">{children}</div>
    </section>
  );
}
