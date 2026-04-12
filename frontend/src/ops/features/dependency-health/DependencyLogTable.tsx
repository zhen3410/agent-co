import { Card } from '../../../shared/ui';
import { DependencyStatusBadge } from './DependencyStatusBadge';
import type { DependencyStatusLogEntry } from '../../types';

export interface DependencyLogTableProps {
  logs: DependencyStatusLogEntry[];
  total: number;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN');
}

export function DependencyLogTable({ logs, total }: DependencyLogTableProps) {
  return (
    <Card title="依赖日志" actions={<span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>{total} 条</span>}>
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={headCellStyle}>时间</th>
              <th style={headCellStyle}>级别</th>
              <th style={headCellStyle}>依赖</th>
              <th style={headCellStyle}>日志内容</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={4} style={emptyCellStyle}>暂无依赖日志</td>
              </tr>
            ) : logs.map((log, index) => (
              <tr key={`${log.timestamp}-${log.dependency}-${index}`}>
                <td style={{ ...bodyCellStyle, fontFamily: monoFont }}>{formatTimestamp(log.timestamp)}</td>
                <td style={bodyCellStyle}>
                  <DependencyStatusBadge healthy={log.level !== 'error'}>
                    {log.level === 'error' ? '异常' : '信息'}
                  </DependencyStatusBadge>
                </td>
                <td style={bodyCellStyle}>{log.dependency}</td>
                <td style={{ ...bodyCellStyle, fontFamily: monoFont }}>{log.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const monoFont = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
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
