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
          <span style={eyebrowStyle}>Control plane access</span>
          <h3 id="admin-token-gate-title" style={titleStyle}>管理员 Token</h3>
          <p style={leadStyle}>输入 x-admin-token 后进入统一控制台，继续管理智能体、用户与模型连接。</p>
        </div>
        <div style={metaListStyle}>
          <span style={metaItemStyle}>workspace 风格入口</span>
          <span style={metaItemStyle}>轻量鉴权，不打断后续配置流</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={formStyle}>
        <label htmlFor="admin-token" style={fieldGroupStyle}>
          <span style={fieldLabelStyle}>输入 x-admin-token 后加载管理资源</span>
          <input
            id="admin-token"
            name="admin-token"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="integration-test-admin-token-1234567890"
            style={fieldStyle}
          />
        </label>
        <div style={actionsStyle}>
          <Button type="submit" disabled={busy || token.trim().length === 0}>
            {busy ? '连接中…' : '连接后台'}
          </Button>
          <span style={assistStyle}>仅用于当前管理会话，不会改变现有资源配置。</span>
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

const eyebrowStyle = {
  color: 'var(--color-text-muted)',
  fontFamily: 'var(--font-family-mono)',
  fontSize: '0.75rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase'
} as const;

const titleStyle = {
  fontSize: 'clamp(1.35rem, 2vw, 1.8rem)',
  lineHeight: 1.15,
  margin: 0
} as const;

const leadStyle = {
  color: 'var(--color-text-secondary)',
  margin: 0,
  maxWidth: '40rem'
} as const;

const metaListStyle = {
  alignContent: 'start',
  display: 'grid',
  gap: 'var(--space-2)',
  justifyItems: 'start'
} as const;

const metaItemStyle = {
  background: 'var(--color-surface-muted)',
  border: '1px solid var(--color-border-muted)',
  borderRadius: '999px',
  color: 'var(--color-text-secondary)',
  fontSize: 'var(--font-size-sm)',
  padding: 'var(--space-2) var(--space-3)'
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

const fieldLabelStyle = {
  color: 'var(--color-text)',
  fontWeight: 'var(--font-weight-medium)'
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

const assistStyle = {
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-sm)'
} as const;
