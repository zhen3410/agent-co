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
      data-ui="table"
      className="ui-table"
    >
      {caption ? <caption className="ui-table__caption">{caption}</caption> : null}
      <thead className="ui-table__head">
        <tr className="ui-table__row">
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              className="ui-table__head-cell"
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="ui-table__body">
        {rows.map((row, rowIndex) => (
          <tr key={getRowKey(row, rowIndex)} className="ui-table__row">
            {columns.map((column) => (
              <td
                key={column.key}
                className="ui-table__cell"
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
