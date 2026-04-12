import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Button, Card, EmptyState, Table } from '../../../shared/ui';
import type { AdminUser } from '../../types';

export interface UserManagementPanelProps {
  users: AdminUser[];
  onCreate: (input: { username: string; password: string }) => Promise<void>;
  onChangePassword: (username: string, input: { password: string }) => Promise<void>;
  onDelete: (username: string) => Promise<void>;
}

export function UserManagementPanel({ users, onCreate, onChangePassword, onDelete }: UserManagementPanelProps) {
  const [createState, setCreateState] = useState({ username: '', password: '' });
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});

  function handleCreateChange(event: ChangeEvent<HTMLInputElement>) {
    const { name, value } = event.target;
    setCreateState((current) => ({ ...current, [name]: value }));
  }

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onCreate({
      username: createState.username.trim(),
      password: createState.password
    });
    setCreateState({ username: '', password: '' });
  }

  return (
    <Card title="用户">
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <form onSubmit={handleCreateSubmit} style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <span>用户名</span>
            <input name="username" value={createState.username} onChange={handleCreateChange} style={fieldStyle} />
          </label>
          <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <span>初始密码</span>
            <input name="password" type="password" value={createState.password} onChange={handleCreateChange} style={fieldStyle} />
          </label>
          <div style={{ alignSelf: 'end' }}>
            <Button type="submit">创建用户</Button>
          </div>
        </form>

        {users.length === 0 ? (
          <EmptyState title="暂无用户" description="创建第一个管理用户后即可在这里维护账号。" />
        ) : (
          <Table
            caption="用户列表"
            rows={users}
            getRowKey={(user) => user.username}
            columns={[
              { key: 'username', header: '用户名', render: (user) => user.username },
              { key: 'created', header: '创建时间', render: (user) => new Date(user.createdAt).toLocaleString('zh-CN') },
              {
                key: 'password',
                header: '密码',
                render: (user) => (
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <input
                      type="password"
                      value={passwordDrafts[user.username] || ''}
                      onChange={(event) => setPasswordDrafts((current) => ({
                        ...current,
                        [user.username]: event.target.value
                      }))}
                      placeholder="新密码"
                      style={fieldStyle}
                    />
                    <Button
                      variant="secondary"
                      onClick={() => void onChangePassword(user.username, { password: passwordDrafts[user.username] || '' })}
                    >
                      改密
                    </Button>
                  </div>
                )
              },
              {
                key: 'actions',
                header: '操作',
                render: (user) => (
                  <Button variant="danger" onClick={() => void onDelete(user.username)}>
                    删除
                  </Button>
                )
              }
            ]}
          />
        )}
      </div>
    </Card>
  );
}

const fieldStyle = {
  backgroundColor: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-text)',
  padding: 'var(--space-2) var(--space-3)'
};
