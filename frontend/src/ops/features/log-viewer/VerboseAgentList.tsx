import { Card, EmptyState } from '../../../shared/ui';
import type { VerboseAgentSummary } from '../../types';

export interface VerboseAgentListProps {
  agents: VerboseAgentSummary[];
  selectedAgent: string;
  onSelect: (agent: string) => void;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN');
}

export function VerboseAgentList({ agents, selectedAgent, onSelect }: VerboseAgentListProps) {
  return (
    <Card title="智能体">
      {agents.length === 0 ? (
        <EmptyState title="暂无 verbose 日志" description="当前目录中还没有 CLI 日志文件。" />
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          {agents.map((item) => {
            const active = item.agent === selectedAgent;
            return (
              <button
                key={item.agent}
                type="button"
                data-verbose-agent={item.agent}
                onClick={() => onSelect(item.agent)}
                style={{
                  ...itemButtonStyle,
                  borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
                  boxShadow: active ? '0 0 0 1px rgba(37, 99, 235, 0.16)' : 'none'
                }}
              >
                <strong>{item.agent}</strong>
                <span style={metaStyle}>{item.logCount} 个文件</span>
                <span style={metaStyle}>最新：{formatTime(item.latestUpdatedAt)}</span>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

const itemButtonStyle = {
  alignItems: 'start',
  background: 'var(--color-surface-muted)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-text)',
  cursor: 'pointer',
  display: 'grid',
  gap: '0.2rem',
  padding: '0.75rem',
  textAlign: 'left' as const
};

const metaStyle = {
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-sm)'
} as const;
