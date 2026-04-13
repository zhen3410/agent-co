import { Button } from '../../../shared/ui';
import { renderMarkdownHtml } from '../../services/chat-markdown';
import { useChatComposer } from './useChatComposer';

export interface ChatComposerProps {
  disabled?: boolean;
  onSubmit: (message: string) => Promise<void>;
}

export function ChatComposer({ disabled = false, onSubmit }: ChatComposerProps) {
  const composer = useChatComposer({ disabled, onSubmit });
  const lineCount = composer.value ? composer.value.split('\n').length : 1;
  const charCount = composer.value.length;

  return (
    <section
      aria-label="消息输入区"
      style={{
        background: 'rgba(255, 255, 255, 0.9)',
        border: '1px solid rgba(148, 163, 184, 0.24)',
        borderRadius: 'calc(var(--radius-lg) + 4px)',
        boxShadow: '0 20px 48px rgba(15, 23, 42, 0.06)',
        display: 'grid',
        gap: 'var(--space-4)',
        padding: 'var(--space-4)'
      }}
    >
      <form data-chat-composer="composer" onSubmit={composer.submit} style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <header style={{ alignItems: 'flex-start', display: 'flex', gap: 'var(--space-3)', justifyContent: 'space-between' }}>
          <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
            <strong style={{ color: 'var(--color-text)', fontSize: 'var(--font-size-base)' }}>继续当前对话</strong>
            <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
              支持 Markdown，使用 Ctrl/⌘ + Enter 发送。
            </span>
          </div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', textAlign: 'right' }}>
            <div>{lineCount} 行</div>
            <div>{charCount} 字符</div>
          </div>
        </header>

        <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' }}>
            消息
          </span>
          <textarea
            ref={composer.textareaRef}
            value={composer.value}
            onChange={(event) => composer.setValue(event.target.value)}
            onKeyDown={composer.handleTextareaKeyDown}
            disabled={disabled || composer.isSubmitting}
            rows={6}
            aria-label="输入消息"
            placeholder="输入你的消息、计划或下一步操作…"
            style={{
              background: 'rgba(248, 250, 252, 0.92)',
              border: '1px solid rgba(148, 163, 184, 0.28)',
              borderRadius: 'var(--radius-lg)',
              color: 'var(--color-text)',
              minHeight: '9rem',
              padding: 'var(--space-4)',
              resize: 'none',
              width: '100%'
            }}
          />
        </label>

        <section
          aria-label="Markdown 预览"
          style={{
            background: 'rgba(248, 250, 252, 0.72)',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            borderRadius: 'var(--radius-lg)',
            display: 'grid',
            gap: 'var(--space-2)',
            minHeight: '4.5rem',
            padding: 'var(--space-3)'
          }}
        >
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>实时预览</div>
          {composer.value.trim() ? (
            <div dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(composer.value) }} />
          ) : (
            <div style={{ color: 'var(--color-text-muted)' }}>输入内容后，这里会显示排版后的消息。</div>
          )}
        </section>

        <footer style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', justifyContent: 'space-between' }}>
          {composer.errorMessage ? (
            <div role="alert" style={{ color: 'var(--status-error)', fontSize: 'var(--font-size-sm)' }}>{composer.errorMessage}</div>
          ) : (
            <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
              发送后会保持当前会话与实时同步状态。
            </span>
          )}

          <Button type="submit" disabled={!composer.canSubmit}>
            {composer.isSubmitting ? '发送中…' : '发送消息'}
          </Button>
        </footer>
      </form>
    </section>
  );
}
