import type { ReactNode } from 'react';

export interface AdminFieldGroupProps {
  title?: ReactNode;
  children?: ReactNode;
}

export function AdminFieldGroup({ title, children }: AdminFieldGroupProps) {
  return (
    <section className="admin-field-group">
      {title ? <div className="admin-field-group__title">{title}</div> : null}
      <div className="admin-field-group__body">{children}</div>
    </section>
  );
}
