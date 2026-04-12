import { Card } from '../../../shared/ui';
import { DependencyStatusBadge } from './DependencyStatusBadge';
import type { DependencyStatusResponse } from '../../types';

export interface DependencyStatusSummaryProps {
  status: DependencyStatusResponse | null;
}

function formatTimestamp(timestamp: number | null | undefined): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return '尚未检查';
  }

  return new Date(timestamp).toLocaleString('zh-CN');
}

export function DependencyStatusSummary({ status }: DependencyStatusSummaryProps) {
  const total = status?.dependencies.length ?? 0;
  const unhealthyCount = status?.dependencies.filter((item) => !item.healthy && item.required).length ?? 0;

  return (
    <Card title="运行概览">
      <div data-dependency-summary="overview" style={{ display: 'grid', gap: 'var(--space-2)' }}>
        <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <DependencyStatusBadge healthy={Boolean(status?.healthy)}>
            {status?.healthy ? '整体正常' : '存在异常'}
          </DependencyStatusBadge>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
            最近检查：{formatTimestamp(status?.checkedAt)}
          </span>
        </div>
        <div
          style={{
            display: 'grid',
            gap: 'var(--space-2)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))'
          }}
        >
          <SummaryMetric label="依赖总数" value={String(total)} />
          <SummaryMetric label="必需异常" value={String(unhealthyCount)} tone={unhealthyCount > 0 ? 'error' : 'success'} />
          <SummaryMetric label="最近日志" value={String(status?.logs.length ?? 0)} />
        </div>
      </div>
    </Card>
  );
}

function SummaryMetric({
  label,
  value,
  tone = 'neutral'
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'success' | 'error';
}) {
  const color = tone === 'success'
    ? 'var(--status-success)'
    : tone === 'error'
      ? 'var(--status-error)'
      : 'var(--color-text)';

  return (
    <div
      style={{
        background: 'var(--color-surface-muted)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3)'
      }}
    >
      <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>{label}</div>
      <div style={{ color, fontSize: '1.4rem', fontWeight: 600 }}>{value}</div>
    </div>
  );
}
