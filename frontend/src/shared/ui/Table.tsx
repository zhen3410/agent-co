import type { ReactNode } from 'react';

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  caption?: ReactNode;
}

export function Table<T>({ columns, rows, getRowKey, caption }: TableProps<T>) {
  return (
    <table
      style={{
        backgroundColor: 'var(--color-surface)',
        borderCollapse: 'collapse',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        width: '100%'
      }}
    >
      {caption ? <caption style={{ marginBottom: 'var(--space-2)' }}>{caption}</caption> : null}
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              style={{
                borderBottom: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                fontWeight: 'var(--font-weight-semibold)',
                padding: 'var(--space-2) var(--space-3)',
                textAlign: 'left'
              }}
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={getRowKey(row, rowIndex)}>
            {columns.map((column) => (
              <td
                key={column.key}
                style={{
                  borderBottom: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                  padding: 'var(--space-2) var(--space-3)'
                }}
              >
                {column.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
