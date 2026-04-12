import { Button, Input } from '../../../shared/ui';
import type { DependencyLogQuery } from '../../types';

export interface DependencyLogFiltersProps {
  value: DependencyLogQuery;
  onChange: (next: DependencyLogQuery) => void;
  onApply: () => void;
  disabled?: boolean;
}

export function DependencyLogFilters({ value, onChange, onApply, disabled = false }: DependencyLogFiltersProps) {
  function update<K extends keyof DependencyLogQuery>(key: K, nextValue: DependencyLogQuery[K]) {
    onChange({
      ...value,
      [key]: nextValue
    });
  }

  return (
    <div
      data-dependency-filters="true"
      style={{
        alignItems: 'end',
        display: 'grid',
        gap: 'var(--space-3)',
        gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))'
      }}
    >
      <Input id="dependency-start-date" name="startDate" type="date" label="开始日期" value={value.startDate} onChange={(event) => update('startDate', event.target.value)} />
      <Input id="dependency-end-date" name="endDate" type="date" label="结束日期" value={value.endDate} onChange={(event) => update('endDate', event.target.value)} />
      <Input id="dependency-filter" name="dependency" label="依赖" placeholder="redis / openai" value={value.dependency} onChange={(event) => update('dependency', event.target.value)} />
      <Input id="dependency-keyword" name="keyword" label="关键字" placeholder="timeout / refused" value={value.keyword} onChange={(event) => update('keyword', event.target.value)} />
      <label style={labelStyle}>
        <span>级别</span>
        <select
          name="level"
          value={value.level}
          onChange={(event) => update('level', event.target.value as DependencyLogQuery['level'])}
          style={selectStyle}
        >
          <option value="">全部</option>
          <option value="info">信息</option>
          <option value="error">异常</option>
        </select>
      </label>
      <div>
        <Button variant="secondary" onClick={onApply} disabled={disabled}>
          应用筛选
        </Button>
      </div>
    </div>
  );
}

const labelStyle = {
  color: 'var(--color-text-muted)',
  display: 'grid',
  fontSize: 'var(--font-size-sm)',
  gap: 'var(--space-1)'
} as const;

const selectStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text)',
  minHeight: '2.5rem',
  padding: '0.55rem 0.75rem'
} as const;
