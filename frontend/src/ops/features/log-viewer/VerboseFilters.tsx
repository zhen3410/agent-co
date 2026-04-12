import { Button } from '../../../shared/ui';
import type { VerboseAgentSummary } from '../../types';

export interface VerboseFiltersProps {
  agents: VerboseAgentSummary[];
  selectedAgent: string;
  onChange: (agent: string) => void;
  onApply: () => void;
  disabled?: boolean;
}

export function VerboseFilters({ agents, selectedAgent, onChange, onApply, disabled = false }: VerboseFiltersProps) {
  return (
    <div
      data-verbose-filters="true"
      style={{
        alignItems: 'end',
        display: 'grid',
        gap: 'var(--space-3)',
        gridTemplateColumns: 'minmax(14rem, 1fr) auto'
      }}
    >
      <label style={labelStyle}>
        <span>智能体</span>
        <select
          name="agent"
          value={selectedAgent}
          onChange={(event) => onChange(event.target.value)}
          style={selectStyle}
        >
          {agents.length === 0 ? <option value="">暂无日志</option> : null}
          {agents.map((item) => (
            <option key={item.agent} value={item.agent}>{item.agent}</option>
          ))}
        </select>
      </label>
      <div>
        <Button variant="secondary" onClick={onApply} disabled={disabled || !selectedAgent}>
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
