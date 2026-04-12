import { Card, EmptyState } from '../../../shared/ui';
import type { VerboseLogMeta } from '../../types';

export interface VerboseLogListProps {
  logs: VerboseLogMeta[];
  selectedFile: string;
  onSelect: (fileName: string) => void;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN');
}

function formatSize(size: number): string {
  return `${(size / 1024).toFixed(1)} KB`;
}

export function VerboseLogList({ logs, selectedFile, onSelect }: VerboseLogListProps) {
  return (
    <Card title="日志文件">
      {logs.length === 0 ? (
        <EmptyState title="暂无日志文件" description="当前智能体还没有产生 verbose 日志。" />
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          {logs.map((log) => {
            const active = log.fileName === selectedFile;
            return (
              <button
                key={log.fileName}
                type="button"
                data-verbose-file={log.fileName}
                onClick={() => onSelect(log.fileName)}
                style={{
                  ...itemButtonStyle,
                  borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
                  boxShadow: active ? '0 0 0 1px rgba(37, 99, 235, 0.16)' : 'none'
                }}
              >
                <strong>{log.fileName}</strong>
                <span style={metaStyle}>{log.cli || 'unknown'} · {formatSize(log.size)}</span>
                <span style={metaStyle}>{formatTime(log.updatedAt)}</span>
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
