export interface AdminStatItem {
  key: string;
  label: string;
  value: string;
}

export function AdminStatStrip({ items }: { items: AdminStatItem[] }) {
  return (
    <section className="admin-stat-strip">
      {items.map((item) => (
        <div key={item.key} className="admin-stat-strip__item">
          <div className="admin-stat-strip__label">{item.label}</div>
          <div className="admin-stat-strip__value">{item.value}</div>
        </div>
      ))}
    </section>
  );
}
