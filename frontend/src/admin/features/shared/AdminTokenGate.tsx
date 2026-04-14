import { useState, type FormEvent } from 'react';
import { Button } from '../../../shared/ui';

export interface AdminTokenGateProps {
  onSubmit: (token: string) => void;
  busy?: boolean;
}

export function AdminTokenGate({ onSubmit, busy = false }: AdminTokenGateProps) {
  const [token, setToken] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(token.trim());
  }

  return (
    <section
      data-admin-region="auth-entry"
      data-admin-auth="token-gate"
      aria-labelledby="admin-token-gate-title"
      style={panelStyle}
    >
      <div style={headerStyle}>
        <div style={headerCopyStyle}>
          <h3 id="admin-token-gate-title" style={titleStyle}>管理员 Token</h3>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={formStyle}>
        <label htmlFor="admin-token" style={fieldGroupStyle}>
          <input
            id="admin-token"
            name="admin-token"
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="x-admin-token-••••••"
            style={fieldStyle}
          />
        </label>
        <div style={actionsStyle}>
          <Button type="submit" disabled={busy || token.trim().length === 0}>
            {busy ? '连接中…' : '连接后台'}
          </Button>
        </div>
      </form>
    </section>
  );
}

const panelStyle = {
  background: 'linear-gradient(180deg, color-mix(in srgb, var(--color-surface) 92%, var(--color-primary-soft) 8%), var(--color-surface))',
  border: '1px solid var(--color-border-muted)',
  borderRadius: 'calc(var(--radius-lg) + 0.25rem)',
  boxShadow: 'var(--shadow-sm)',
  display: 'grid',
  gap: 'var(--space-4)',
  padding: 'clamp(var(--space-4), 2vw, var(--space-6))'
} as const;

const headerStyle = {
  display: 'grid',
  gap: 'var(--space-3)',
  gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)'
} as const;

const headerCopyStyle = {
  display: 'grid',
  gap: 'var(--space-2)'
} as const;

const titleStyle = {
  fontSize: 'clamp(1.35rem, 2vw, 1.8rem)',
  lineHeight: 1.15,
  margin: 0
} as const;

const formStyle = {
  borderTop: '1px solid var(--color-border-muted)',
  display: 'grid',
  gap: 'var(--space-3)',
  paddingTop: 'var(--space-4)'
} as const;

const fieldGroupStyle = {
  display: 'grid',
  gap: 'var(--space-2)'
} as const;

const fieldStyle = {
  backgroundColor: 'var(--color-surface-muted)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-text)',
  minHeight: '2.75rem',
  padding: 'var(--space-3) var(--space-3)'
} as const;

const actionsStyle = {
  alignItems: 'center',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-3)'
} as const;
