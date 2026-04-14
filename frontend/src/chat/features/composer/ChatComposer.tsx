import { Button } from '../../../shared/ui';
import { useChatComposer } from './useChatComposer';

export interface ChatComposerProps {
  disabled?: boolean;
  onSubmit: (message: string) => Promise<void>;
}

const CHAT_COMPOSER_STYLES = `
  .chat-composer {
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(148, 163, 184, 0.24);
    border-radius: 999px;
    box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
    display: grid;
    gap: var(--space-2);
    max-width: 100%;
    min-width: 0;
    padding: 0.35rem;
    width: 100%;
  }

  .chat-composer__form,
  .chat-composer__field {
    display: grid;
  }

  .chat-composer__form {
    gap: var(--space-2);
  }

  .chat-composer__field {
    align-items: center;
    gap: var(--space-2);
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .chat-composer__error {
    color: var(--status-error);
    font-size: var(--font-size-sm);
    padding: 0 0.7rem 0.1rem;
  }

  .chat-composer__textarea {
    background: transparent;
    border: none;
    border-radius: 0;
    color: var(--color-text);
    font-size: 16px;
    line-height: 1.45;
    min-height: 2.75rem;
    padding: 0.55rem 0.7rem;
    resize: none;
    width: 100%;
  }

  .chat-composer__textarea::placeholder {
    color: var(--color-text-muted);
  }

  .chat-composer__textarea:focus {
    outline: none;
  }

  .chat-composer__submit {
    align-items: center;
    border-radius: 999px;
    display: inline-flex;
    height: 2.75rem;
    justify-content: center;
    min-width: 2.75rem;
    padding: 0;
    width: 2.75rem;
  }

  .chat-composer__submit-icon {
    display: inline-flex;
    font-size: 1rem;
    line-height: 1;
    transform: translateX(0.03rem);
  }

  @media (max-width: 720px) {
    .chat-composer {
      background: rgba(255, 255, 255, 0.98);
      border-radius: 999px;
      box-shadow: 0 -10px 24px rgba(15, 23, 42, 0.08);
      gap: var(--space-2);
      padding: 0.28rem;
    }

    .chat-composer__form {
      gap: var(--space-2);
    }

    .chat-composer__field {
      gap: var(--space-2);
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .chat-composer__textarea {
      min-height: 2.6rem;
      padding: 0.5rem 0.72rem;
    }
  }
`;

export function ChatComposer({ disabled = false, onSubmit }: ChatComposerProps) {
  const composer = useChatComposer({ disabled, onSubmit });

  return (
    <section
      aria-label="消息输入区"
      className="chat-composer"
    >
      <style>{CHAT_COMPOSER_STYLES}</style>
      <form data-chat-composer="composer" onSubmit={composer.submit} className="chat-composer__form">
        <label className="chat-composer__field">
          <textarea
            ref={composer.textareaRef}
            value={composer.value}
            onChange={(event) => composer.setValue(event.target.value)}
            onKeyDown={composer.handleTextareaKeyDown}
            disabled={disabled || composer.isSubmitting}
            rows={1}
            aria-label="输入消息"
            placeholder="输入消息"
            className="chat-composer__textarea"
          />
          <Button type="submit" className="chat-composer__submit" disabled={!composer.canSubmit} aria-label={composer.isSubmitting ? '发送中' : '发送消息'}>
            <span className="chat-composer__submit-icon" aria-hidden="true">➤</span>
          </Button>
        </label>
        {composer.errorMessage ? (
          <div role="alert" className="chat-composer__error">{composer.errorMessage}</div>
        ) : null}
      </form>
    </section>
  );
}
