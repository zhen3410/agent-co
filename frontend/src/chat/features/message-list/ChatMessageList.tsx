import { EmptyState, ErrorState, Spinner } from '../../../shared/ui';
import type { ChatMessage } from '../../types';
import { renderMarkdownHtml } from '../../services/chat-markdown';

const CHAT_MESSAGE_LIST_STYLES = `
  .chat-message-list {
    display: grid;
    gap: var(--space-3);
    max-width: 100%;
    min-width: 0;
    overflow-x: hidden;
    padding: var(--space-2) 0;
    width: 100%;
  }

  .chat-message-list__item {
    display: flex;
    flex-direction: column;
    max-width: 100%;
    min-width: 0;
    padding: 0;
  }

  .chat-message-list__row {
    align-items: flex-end;
    display: flex;
    gap: 0.55rem;
    max-width: 100%;
    min-width: 0;
  }

  .chat-message-list__item[data-align='end'] .chat-message-list__row {
    justify-content: flex-end;
  }

  .chat-message-list__item[data-align='start'] .chat-message-list__row {
    justify-content: flex-start;
  }

  .chat-message-list__avatar {
    align-items: center;
    align-self: flex-start;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(244, 247, 251, 0.98) 100%);
    border: 1px solid rgba(203, 213, 225, 0.88);
    border-radius: 0.9rem;
    color: #475569;
    display: inline-flex;
    flex: 0 0 auto;
    font-size: 12px;
    font-weight: 700;
    height: 2rem;
    justify-content: center;
    letter-spacing: 0.02em;
    margin-top: 0.1rem;
    width: 2rem;
  }

  .chat-message-list__avatar[data-tone='user'] {
    background: linear-gradient(180deg, rgba(149, 236, 105, 0.98) 0%, rgba(143, 232, 98, 0.98) 100%);
    border-color: rgba(116, 201, 70, 0.42);
    color: #166534;
  }

  .chat-message-list__avatar[data-tone='review'] {
    background: linear-gradient(180deg, rgba(255, 248, 235, 0.98) 0%, rgba(255, 243, 214, 0.96) 100%);
    border-color: rgba(245, 158, 11, 0.24);
    color: #b45309;
  }

  .chat-message-list__item[data-align='end'] {
    align-items: flex-end;
  }

  .chat-message-list__item[data-align='start'] {
    align-items: flex-start;
  }

  .chat-message-list__meta {
    align-items: center;
    color: var(--color-text-muted);
    display: flex;
    flex-wrap: wrap;
    font-size: var(--font-size-sm);
    gap: var(--space-2);
    margin-bottom: 0.4rem;
    max-width: min(32rem, calc(100% - 3.5rem));
    padding: 0 0.15rem;
  }

  .chat-message-list__item[data-align='end'] .chat-message-list__meta {
    justify-content: flex-end;
  }

  .chat-message-list__item[data-tone='user'] .chat-message-list__meta {
    display: none;
  }

  .chat-message-list__bubble {
    backdrop-filter: blur(8px);
    border: 1px solid rgba(203, 213, 225, 0.92);
    border-radius: 1.1rem;
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.04);
    color: var(--color-text);
    max-width: min(32rem, calc(100% - 3.5rem));
    min-width: 0;
    overflow: hidden;
    padding: 0.8rem 0.92rem;
    width: fit-content;
  }

  .chat-message-list__bubble::after {
    border: 0.55rem solid transparent;
    content: '';
    height: 0;
    position: absolute;
    top: 1rem;
    width: 0;
  }

  .chat-message-list__item[data-tone='assistant'] .chat-message-list__bubble {
    background: rgba(255, 255, 255, 0.98);
    border-color: rgba(203, 213, 225, 0.96);
    border-bottom-left-radius: 0.4rem;
    position: relative;
  }

  .chat-message-list__item[data-tone='assistant'] .chat-message-list__bubble::after {
    border-right-color: rgba(255, 255, 255, 0.98);
    left: -1rem;
  }

  .chat-message-list__item[data-tone='user'] .chat-message-list__bubble {
    background: linear-gradient(180deg, rgba(149, 236, 105, 0.98) 0%, rgba(143, 232, 98, 0.98) 100%);
    border-color: rgba(116, 201, 70, 0.45);
    border-bottom-right-radius: 0.4rem;
    color: #1f2937;
    position: relative;
  }

  .chat-message-list__item[data-tone='user'] .chat-message-list__bubble::after {
    border-left-color: rgba(145, 234, 101, 0.98);
    right: -1rem;
  }

  .chat-message-list__item[data-tone='review'] .chat-message-list__bubble {
    background: linear-gradient(180deg, rgba(255, 248, 235, 0.98) 0%, rgba(255, 243, 214, 0.96) 100%);
    border-color: rgba(245, 158, 11, 0.26);
    border-bottom-left-radius: 0.4rem;
    box-shadow: 0 12px 26px rgba(245, 158, 11, 0.12);
    position: relative;
  }

  .chat-message-list__item[data-tone='review'] .chat-message-list__bubble::after {
    border-right-color: rgba(255, 248, 235, 0.98);
    left: -1rem;
  }

  .chat-message-list__item[data-tone='system'] .chat-message-list__bubble {
    background: rgba(248, 250, 252, 0.96);
    border-color: rgba(148, 163, 184, 0.24);
    border-bottom-left-radius: 0.4rem;
    box-shadow: none;
    position: relative;
  }

  .chat-message-list__item[data-tone='system'] .chat-message-list__bubble::after {
    border-right-color: rgba(248, 250, 252, 0.92);
    left: -1rem;
  }

  .chat-message-list__kind {
    align-items: center;
    background: rgba(148, 163, 184, 0.12);
    border-radius: 999px;
    color: var(--color-text-muted);
    display: inline-flex;
    font-size: 11px;
    font-weight: var(--font-weight-semibold);
    letter-spacing: 0.04em;
    padding: 0.1rem 0.45rem;
    text-transform: uppercase;
  }

  .chat-message-list__item[data-tone='review'] .chat-message-list__kind {
    background: rgba(245, 158, 11, 0.16);
    color: #b45309;
  }

  .chat-message-list__item[data-tone='user'] .chat-message-list__kind {
    background: rgba(17, 24, 39, 0.08);
    color: #475569;
  }

  .chat-message-list__body {
    font-size: 16px;
    line-height: 1.7;
    max-width: 72ch;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .chat-message-list__item[data-tone='user'] .chat-message-list__body,
  .chat-message-list__item[data-tone='user'] .chat-message-list__meta,
  .chat-message-list__item[data-tone='user'] .chat-message-list__meta strong {
    color: #1f2937;
  }

  .chat-message-list__item[data-tone='review'] .chat-message-list__meta strong {
    color: #92400e;
  }

  .chat-message-list__item[data-tone='system'] .chat-message-list__meta {
    color: var(--color-text-tertiary);
  }

  .chat-message-list__body > * {
    max-width: 100%;
  }

  .chat-message-list__body > :first-child {
    margin-top: 0;
  }

  .chat-message-list__body > :last-child {
    margin-bottom: 0;
  }

  .chat-message-list__body h1,
  .chat-message-list__body h2,
  .chat-message-list__body h3 {
    color: var(--color-text);
    font-weight: var(--font-weight-semibold);
    line-height: 1.3;
    margin: var(--space-4) 0 var(--space-2);
  }

  .chat-message-list__body h1 {
    font-size: 1.45rem;
  }

  .chat-message-list__body h2 {
    font-size: 1.25rem;
  }

  .chat-message-list__body h3 {
    font-size: 1.1rem;
  }

  .chat-message-list__body p {
    margin: var(--space-2) 0;
  }

  .chat-message-list__review-banner {
    align-items: center;
    color: #b45309;
    display: inline-flex;
    font-size: 12px;
    font-weight: var(--font-weight-semibold);
    gap: 0.35rem;
    margin-bottom: 0.5rem;
  }

  .chat-message-list__body ul,
  .chat-message-list__body ol {
    display: grid;
    gap: var(--space-2);
    margin: var(--space-3) 0;
    padding-inline-start: 1.4rem;
  }

  .chat-message-list__body li::marker {
    color: var(--color-text-muted);
  }

  .chat-message-list__body strong {
    color: var(--color-text);
    font-weight: var(--font-weight-semibold);
  }

  .chat-message-list__item[data-tone='user'] .chat-message-list__body strong,
  .chat-message-list__item[data-tone='user'] .chat-message-list__body h1,
  .chat-message-list__item[data-tone='user'] .chat-message-list__body h2,
  .chat-message-list__item[data-tone='user'] .chat-message-list__body h3,
  .chat-message-list__item[data-tone='user'] .chat-message-list__body a {
    color: #111827;
  }

  .chat-message-list__body em {
    font-style: italic;
  }

  .chat-message-list__body a {
    word-break: break-word;
  }

  .chat-message-list__body pre,
  .chat-message-list__body code {
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .chat-message-list__body code {
    background: rgba(148, 163, 184, 0.14);
    border-radius: 0.35rem;
    font-size: 0.92em;
    padding: 0.08rem 0.35rem;
  }

  .chat-message-list__item[data-tone='user'] .chat-message-list__body code {
    background: rgba(17, 24, 39, 0.08);
  }

  .chat-message-list__body pre {
    background: rgba(15, 23, 42, 0.04);
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: var(--radius-md);
    margin: var(--space-3) 0;
    padding: var(--space-3);
  }

  .chat-message-list__body pre code {
    background: transparent;
    padding: 0;
  }

  .chat-message-list__item[data-tone='user'] .chat-message-list__body pre {
    background: rgba(255, 255, 255, 0.36);
    border-color: rgba(17, 24, 39, 0.08);
  }

  .chat-message-list__body blockquote {
    margin: var(--space-3) 0;
  }

  .chat-message-list__body table {
    border-collapse: collapse;
    display: block;
    margin: var(--space-3) 0;
    max-width: 100%;
    overflow-x: auto;
    width: 100%;
  }

  .chat-message-list__body thead,
  .chat-message-list__body tbody,
  .chat-message-list__body tr {
    width: 100%;
  }

  .chat-message-list__body th,
  .chat-message-list__body td {
    border: 1px solid rgba(148, 163, 184, 0.24);
    padding: 0.55rem 0.65rem;
    text-align: left;
    vertical-align: top;
  }

  .chat-message-list__body th {
    background: rgba(148, 163, 184, 0.08);
    font-weight: var(--font-weight-semibold);
  }

  .chat-message-list__item[data-tone='review'] .chat-message-list__body th {
    background: rgba(245, 158, 11, 0.12);
  }

  @media (max-width: 720px) {
    .chat-message-list {
      padding: var(--space-1) 0 calc(var(--chat-composer-dock-height) + env(safe-area-inset-bottom, 0px) + var(--space-4));
    }

    .chat-message-list__meta {
      max-width: min(calc(100% - 2.75rem), 19rem);
    }

    .chat-message-list__bubble {
      max-width: min(calc(100% - 2.75rem), 19rem);
      padding: 0.72rem 0.82rem;
    }

    .chat-message-list__bubble::after {
      display: none;
    }

    .chat-message-list__avatar {
      height: 1.85rem;
      width: 1.85rem;
    }

    .chat-message-list__meta {
      align-items: flex-start;
      flex-direction: column;
      font-size: 14px;
      gap: var(--space-1);
      margin-bottom: 0.35rem;
    }

    .chat-message-list__body {
      font-size: 15px;
      max-width: 100%;
      word-break: break-word;
    }
  }
`;

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

function resolveMessageTone(message: ChatMessage): 'user' | 'assistant' | 'review' | 'system' {
  if (message.messageSubtype === 'invocation_review') {
    return 'review';
  }
  if (message.role === 'user') {
    return 'user';
  }
  if (message.role === 'system') {
    return 'system';
  }
  return 'assistant';
}

function resolveMessageKindLabel(message: ChatMessage): string {
  if (message.messageSubtype === 'invocation_review') {
    return 'review';
  }
  if (message.role === 'user') {
    return 'user';
  }
  if (message.role === 'system') {
    return 'system';
  }
  return 'agent';
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
      className="chat-message-list"
    >
      <style>{CHAT_MESSAGE_LIST_STYLES}</style>
      {messages.map((message) => {
        const tone = resolveMessageTone(message);
        const align = tone === 'user' ? 'end' : 'start';
        const renderedText = tone === 'review'
          ? (message.reviewDisplayText || message.text)
          : message.text;
        return (
          <article
            key={message.id}
            aria-label={`${message.sender} 的消息`}
            className="chat-message-list__item"
            data-align={align}
            data-tone={tone}
          >
            <header className="chat-message-list__meta">
              <strong style={{ color: 'var(--color-text)' }}>{message.sender}</strong>
              <span className="chat-message-list__kind">{resolveMessageKindLabel(message)}</span>
              <span>{resolveRoleLabel(message.role)} · {formatTimestamp(message.timestamp)}</span>
            </header>
                <div className="chat-message-list__row">
                  {tone === 'user' ? null : (
                    <div className="chat-message-list__avatar" aria-hidden="true">
                      {(message.sender || '?').trim().slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="chat-message-list__bubble">
                {tone === 'review' ? (
                  <div className="chat-message-list__review-banner">
                    <span aria-hidden="true">✦</span>
                    <span>review</span>
                  </div>
                ) : null}
                <div
                  className="chat-message-list__body"
                  dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(renderedText) }}
                    />
                  </div>
                  {tone === 'user' ? (
                    <div className="chat-message-list__avatar" data-tone="user" aria-hidden="true">
                      {(message.sender || '我').trim().slice(0, 1).toUpperCase()}
                    </div>
                  ) : null}
                </div>
          </article>
        );
      })}
    </section>
  );
}
