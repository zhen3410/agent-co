import { Card, EmptyState, ErrorState, Spinner } from '../../../shared/ui';
import type { ChatMessage } from '../../types';
import { renderMarkdownHtml } from './chat-markdown';

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
    return <ErrorState title="消息加载失败" message={errorMessage} />;
  }

  if (isLoading) {
    return (
      <Card title="消息">
        <Spinner label="正在加载消息…" />
      </Card>
    );
  }

  if (messages.length === 0) {
    return (
      <EmptyState
        title="暂无消息"
        description="发送第一条消息后，这里会显示用户与智能体的对话内容。"
      />
    );
  }

  return (
    <section data-chat-message-list="messages" style={{ display: 'grid', gap: 'var(--space-3)' }}>
      {messages.map((message) => {
        const isUser = message.role === 'user';
        const isSystem = message.role === 'system';
        return (
          <article
            key={message.id}
            style={{
              background: isUser ? 'rgba(37, 99, 235, 0.08)' : 'var(--color-surface)',
              border: `1px solid ${isSystem ? 'var(--status-warning)' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-4)'
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
              style={{ color: 'var(--color-text)' }}
              dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(message.text) }}
            />
          </article>
        );
      })}
    </section>
  );
}
