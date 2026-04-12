import { Card } from '../../../shared/ui';
import { DependencyStatusBadge } from './DependencyStatusBadge';
import type { DependencyStatusItem } from '../../types';

export interface DependencyStatusTableProps {
  dependencies: DependencyStatusItem[];
}

export function DependencyStatusTable({ dependencies }: DependencyStatusTableProps) {
  return (
    <Card title="依赖状态">
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={headCellStyle}>依赖</th>
              <th style={headCellStyle}>必需</th>
              <th style={headCellStyle}>状态</th>
              <th style={headCellStyle}>详情</th>
            </tr>
          </thead>
          <tbody>
            {dependencies.length === 0 ? (
              <tr>
                <td colSpan={4} style={emptyCellStyle}>暂无依赖状态</td>
              </tr>
            ) : dependencies.map((item) => (
              <tr key={item.name} data-dependency-row={item.name}>
                <td style={bodyCellStyle}>{item.name}</td>
                <td style={bodyCellStyle}>{item.required ? '是' : '否'}</td>
                <td style={bodyCellStyle}>
                  <DependencyStatusBadge healthy={item.healthy}>
                    {item.healthy ? '正常' : '异常'}
                  </DependencyStatusBadge>
                </td>
                <td style={{ ...bodyCellStyle, fontFamily: monoFont }}>{item.detail || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const monoFont = 'ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, Consolas, monospace';
const tableStyle = {
  borderCollapse: 'collapse' as const,
  fontSize: 'var(--font-size-sm)',
  minWidth: '100%',
  width: '100%'
};
const headCellStyle = {
  borderBottom: '1px solid var(--color-border)',
  color: 'var(--color-text-muted)',
  fontSize: '0.75rem',
  letterSpacing: '0.04em',
  padding: '0.65rem 0.75rem',
  textAlign: 'left' as const,
  textTransform: 'uppercase' as const,
  verticalAlign: 'top' as const
};
const bodyCellStyle = {
  borderBottom: '1px solid var(--color-border)',
  padding: '0.75rem',
  textAlign: 'left' as const,
  verticalAlign: 'top' as const
};
const emptyCellStyle = {
  color: 'var(--color-text-muted)',
  padding: '1rem',
  textAlign: 'center' as const
};
