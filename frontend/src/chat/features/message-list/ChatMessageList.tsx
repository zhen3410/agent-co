import { EmptyState, ErrorState, Spinner } from '../../../shared/ui';
import type { ChatMessage } from '../../types';
import { renderMarkdownHtml } from '../../services/chat-markdown';

export interface ChatMessageListProps {
  messages: ChatMessage[];
  isLoading?: boolean;
  errorMessage?: string | null;
}

function formatTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp)) {
    return '';
  }

  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function resolveRoleLabel(role: ChatMessage['role']): string {
  if (role === 'user') {
    return '用户';
  }
  if (role === 'assistant') {
    return '助手';
  }
  return '系统';
}

export function ChatMessageList({ messages, isLoading = false, errorMessage = null }: ChatMessageListProps) {
  if (errorMessage) {
    return (
      <section
        data-chat-message-list="messages"
        aria-label="消息列表"
        style={{
          border: '1px solid rgba(148, 163, 184, 0.2)',
          borderRadius: 'calc(var(--radius-lg) + 6px)',
          padding: 'var(--space-4)'
        }}
      >
        <ErrorState title="消息加载失败" message={errorMessage} />
      </section>
    );
  }

  if (isLoading) {
    return (
      <section
        data-chat-message-list="messages"
        aria-label="消息列表"
        style={{
          border: '1px solid rgba(148, 163, 184, 0.2)',
          borderRadius: 'calc(var(--radius-lg) + 6px)',
          padding: 'var(--space-4)'
        }}
      >
        <Spinner label="正在加载消息…" />
      </section>
    );
  }

  if (messages.length === 0) {
    return (
      <section
        data-chat-message-list="messages"
        aria-label="消息列表"
        style={{
          border: '1px solid rgba(148, 163, 184, 0.2)',
          borderRadius: 'calc(var(--radius-lg) + 6px)',
          padding: 'var(--space-4)'
        }}
      >
        <EmptyState
          title="暂无消息"
          description="发送第一条消息后，这里会显示用户与智能体的对话内容。"
        />
      </section>
    );
  }

  return (
    <section
      data-chat-message-list="messages"
      aria-label="消息列表"
      style={{
        background: 'rgba(255, 255, 255, 0.82)',
        border: '1px solid rgba(148, 163, 184, 0.18)',
        borderRadius: 'calc(var(--radius-lg) + 8px)',
        display: 'grid',
        gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-4)'
      }}
    >
      {messages.map((message) => {
        const isUser = message.role === 'user';
        const isSystem = message.role === 'system';
        return (
          <article
            key={message.id}
            aria-label={`${message.sender} 的消息`}
            style={{
              background: isUser ? 'rgba(37, 99, 235, 0.05)' : 'transparent',
              border: 'none',
              borderBottom: '1px solid rgba(148, 163, 184, 0.18)',
              borderLeft: isSystem ? '2px solid var(--status-warning)' : isUser ? '2px solid rgba(37, 99, 235, 0.32)' : '2px solid transparent',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-4) var(--space-3)'
            }}
          >
            <header
              style={{
                alignItems: 'center',
                color: 'var(--color-text-muted)',
                display: 'flex',
                fontSize: 'var(--font-size-sm)',
                justifyContent: 'space-between',
                marginBottom: 'var(--space-2)'
              }}
            >
              <strong style={{ color: 'var(--color-text)' }}>{message.sender}</strong>
              <span>{resolveRoleLabel(message.role)} · {formatTimestamp(message.timestamp)}</span>
            </header>
            <div
              style={{
                color: 'var(--color-text)',
                lineHeight: 1.7,
                maxWidth: '72ch'
              }}
              dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(message.text) }}
            />
          </article>
        );
      })}
    </section>
  );
}
