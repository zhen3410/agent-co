import type { ReactNode } from 'react';

export function AdminHomeHero({ title, subtitle, aside }: { title: ReactNode; subtitle?: ReactNode; aside?: ReactNode }) {
  return (
    <section className="admin-home-hero">
      <div>
        <div className="admin-home-hero__eyebrow">admin console</div>
        <h2 className="admin-home-hero__title">{title}</h2>
        {subtitle ? <p className="admin-home-hero__subtitle">{subtitle}</p> : null}
      </div>
      {aside ? <div className="admin-home-hero__aside">{aside}</div> : null}
    </section>
  );
}
