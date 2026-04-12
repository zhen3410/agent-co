import { Button, Card } from '../../../shared/ui';
import { renderMarkdownHtml } from '../message-list/chat-markdown';
import { useChatComposer } from './useChatComposer';

export interface ChatComposerProps {
  disabled?: boolean;
  onSubmit: (message: string) => Promise<void>;
}

export function ChatComposer({ disabled = false, onSubmit }: ChatComposerProps) {
  const composer = useChatComposer({ disabled, onSubmit });
  const lineCount = composer.value ? composer.value.split('\n').length : 0;
  const charCount = composer.value.length;

  return (
    <Card title="输入区">
      <form data-chat-composer="composer" onSubmit={composer.submit} style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <span style={{ fontWeight: 'var(--font-weight-medium)' }}>消息</span>
          <textarea
            value={composer.value}
            onChange={(event) => composer.setValue(event.target.value)}
            disabled={disabled || composer.isSubmitting}
            rows={6}
            placeholder="输入你的消息…"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text)',
              minHeight: '9rem',
              padding: 'var(--space-3)',
              resize: 'vertical'
            }}
          />
        </label>

        <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
          {lineCount} 行 · {charCount} 字符
        </div>

        <div
          style={{
            background: 'var(--color-surface-muted)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            minHeight: '5rem',
            padding: 'var(--space-3)'
          }}
        >
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-2)' }}>
            Markdown 预览
          </div>
          {composer.value.trim() ? (
            <div dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(composer.value) }} />
          ) : (
            <div style={{ color: 'var(--color-text-muted)' }}>Markdown 预览会显示在这里</div>
          )}
        </div>

        {composer.errorMessage ? (
          <div role="alert" style={{ color: 'var(--status-error)' }}>{composer.errorMessage}</div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button type="submit" disabled={!composer.canSubmit}>
            {composer.isSubmitting ? '发送中…' : '发送'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
