import { Card, EmptyState } from '../../../shared/ui';

export interface VerboseLogContentProps {
  fileName: string;
  content: string;
}

export function VerboseLogContent({ fileName, content }: VerboseLogContentProps) {
  return (
    <Card title="日志内容" actions={fileName ? <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>{fileName}</span> : null}>
      {fileName ? (
        <pre
          data-verbose-content="true"
          style={{
            background: '#0f172a',
            borderRadius: 'var(--radius-md)',
            color: '#e2e8f0',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: '0.8125rem',
            margin: 0,
            maxHeight: '42rem',
            minHeight: '18rem',
            overflow: 'auto',
            padding: 'var(--space-3)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}
        >
          {content || '(空文件)'}
        </pre>
      ) : (
        <EmptyState title="请选择日志文件" description="左侧选择智能体和日志文件后，即可查看 CLI verbose 输出。" />
      )}
    </Card>
  );
}
