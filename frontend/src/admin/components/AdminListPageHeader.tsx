import type { ReactNode } from 'react';

export interface AdminListPageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}

export function AdminListPageHeader({ title, description, meta, actions }: AdminListPageHeaderProps) {
  return (
    <header className="admin-page-header" data-admin-layout="list-page">
      <div>
        <h2 className="admin-page-title">{title}</h2>
        {description ? <p className="admin-page-description">{description}</p> : null}
        {meta ? <div className="admin-page-meta">{meta}</div> : null}
      </div>
      {actions ? <div className="admin-page-actions">{actions}</div> : null}
    </header>
  );
}
