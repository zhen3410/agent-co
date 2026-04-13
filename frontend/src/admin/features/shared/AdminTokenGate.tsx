import { useState, type FormEvent } from 'react';
import { Button, Card } from '../../../shared/ui';

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
    <Card title="管理员 Token" style={{ maxWidth: '42rem' }}>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <label htmlFor="admin-token" style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <span>输入 x-admin-token 后加载管理资源</span>
          <input
            id="admin-token"
            name="admin-token"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="integration-test-admin-token-1234567890"
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text)',
              padding: 'var(--space-2) var(--space-3)'
            }}
          />
        </label>
        <div>
          <Button type="submit" disabled={busy || token.trim().length === 0}>
            {busy ? '连接中…' : '连接后台'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
