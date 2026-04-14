import type { ReactNode } from 'react';
import { Table } from '../../shared/ui';

export interface AdminDataListColumn<T> {
  key: string;
  header: ReactNode;
  render: (item: T) => ReactNode;
}

export interface AdminDataListProps<T> {
  caption: ReactNode;
  items: T[];
  getItemKey: (item: T, index: number) => string;
  columns: AdminDataListColumn<T>[];
}

export function AdminDataList<T>({ caption, items, getItemKey, columns }: AdminDataListProps<T>) {
  return (
    <div className="admin-data-list" data-admin-layout="data-list">
      <div className="admin-data-list__table">
        <Table
          caption={caption}
          rows={items}
          getRowKey={getItemKey}
          columns={columns}
        />
      </div>
      <div className="admin-data-list__mobile">
        {items.map((item, index) => (
          <article key={getItemKey(item, index)} className="admin-mobile-card">
            {columns.map((column) => (
              <div key={column.key} className="admin-mobile-card__row">
                <div className="admin-mobile-card__label">{column.header}</div>
                <div className="admin-mobile-card__value">{column.render(item)}</div>
              </div>
            ))}
          </article>
        ))}
      </div>
    </div>
  );
}
