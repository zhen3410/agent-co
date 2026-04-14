import type { ReactNode } from 'react';

export interface AdminSectionNavItem {
  key: string;
  label: string;
  meta?: string;
  icon?: ReactNode;
  onClick?: () => void;
}

export function AdminSectionNav({ items }: { items: AdminSectionNavItem[] }) {
  return (
    <section className="admin-section-nav">
      {items.map((item) => (
        <button key={item.key} type="button" className="admin-section-nav__item" onClick={item.onClick} data-admin-nav={item.key}>
          <div className="admin-section-nav__icon">{item.icon}</div>
          <div className="admin-section-nav__content">
            <div className="admin-section-nav__label">{item.label}</div>
            {item.meta ? <div className="admin-section-nav__meta">{item.meta}</div> : null}
          </div>
          <div className="admin-section-nav__arrow">›</div>
        </button>
      ))}
    </section>
  );
}
