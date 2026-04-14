import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Button, EmptyState, Table } from '../../../shared/ui';
import type { AdminUser } from '../../types';

export interface UserManagementPanelProps {
  users: AdminUser[];
  onCreate: (input: { username: string; password: string }) => Promise<boolean>;
  onChangePassword: (username: string, input: { password: string }) => Promise<boolean>;
  onDelete: (username: string) => Promise<boolean>;
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
    const succeeded = await onCreate({
      username: createState.username.trim(),
      password: createState.password
    });
    if (succeeded) {
      setCreateState({ username: '', password: '' });
    }
  }

  return (
    <section data-admin-panel="users" style={panelStyle}>
      <header style={panelHeaderStyle}>
        <div style={titleGroupStyle}>
          <span style={eyebrowStyle}>Workspace access</span>
          <div style={headingRowStyle}>
            <h3 style={titleStyle}>用户</h3>
            <span style={countStyle}>{users.length} 个账号</span>
          </div>
          <p style={descriptionStyle}>把访问控制放在更轻的工作台语境中，保持账号管理清晰、克制、可快速操作。</p>
        </div>
      </header>

      <div style={compositionStyle}>
        <form onSubmit={handleCreateSubmit} style={formStyle}>
          <div style={gridThreeStyle}>
            <label style={fieldGroupStyle}>
              <span style={fieldLabelStyle}>用户名</span>
              <input name="username" value={createState.username} onChange={handleCreateChange} style={fieldStyle} />
            </label>
            <label style={fieldGroupStyle}>
              <span style={fieldLabelStyle}>初始密码</span>
              <input name="password" type="password" value={createState.password} onChange={handleCreateChange} style={fieldStyle} />
            </label>
            <div style={submitColumnStyle}>
              <Button type="submit">创建用户</Button>
              <span style={assistStyle}>新账号创建后即可进入统一工作区。</span>
            </div>
          </div>
        </form>

        <div style={listBlockStyle}>
          <div style={listHeaderStyle}>
            <p style={listTitleStyle}>账号列表</p>
            <p style={listCaptionStyle}>账号维护保持高密度，但避免传统后台那种沉重表单堆叠。</p>
          </div>

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
                    <div style={passwordCellStyle}>
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
      </div>
    </section>
  );
}

const panelStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border-muted)',
  borderRadius: 'calc(var(--radius-lg) + 0.125rem)',
  display: 'grid',
  gap: 'var(--space-4)',
  padding: 'var(--space-4)'
} as const;

const panelHeaderStyle = {
  display: 'grid',
  gap: 'var(--space-2)'
} as const;

const titleGroupStyle = {
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

const headingRowStyle = {
  alignItems: 'center',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-2)'
} as const;

const titleStyle = {
  fontSize: '1.125rem',
  margin: 0
} as const;

const countStyle = {
  background: 'var(--color-surface-muted)',
  border: '1px solid var(--color-border-muted)',
  borderRadius: '999px',
  color: 'var(--color-text-secondary)',
  fontSize: 'var(--font-size-sm)',
  padding: 'var(--space-1) var(--space-2)'
} as const;

const descriptionStyle = {
  color: 'var(--color-text-secondary)',
  margin: 0,
  maxWidth: '44rem'
} as const;

const compositionStyle = {
  display: 'grid',
  gap: 'var(--space-4)'
} as const;

const formStyle = {
  background: 'color-mix(in srgb, var(--color-surface-muted) 72%, transparent)',
  border: '1px solid var(--color-border-muted)',
  borderRadius: 'var(--radius-md)',
  display: 'grid',
  gap: 'var(--space-3)',
  padding: 'var(--space-4)'
} as const;

const gridThreeStyle = {
  alignItems: 'end',
  display: 'grid',
  gap: 'var(--space-3)',
  gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))'
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
  backgroundColor: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-text)',
  minHeight: '2.625rem',
  padding: 'var(--space-2) var(--space-3)'
} as const;

const submitColumnStyle = {
  alignItems: 'flex-start',
  display: 'grid',
  gap: 'var(--space-2)'
} as const;

const assistStyle = {
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-sm)',
  margin: 0
} as const;

const listBlockStyle = {
  borderTop: '1px solid var(--color-border-muted)',
  display: 'grid',
  gap: 'var(--space-3)',
  paddingTop: 'var(--space-4)'
} as const;

const listHeaderStyle = {
  display: 'grid',
  gap: 'var(--space-1)'
} as const;

const listTitleStyle = {
  color: 'var(--color-text)',
  fontWeight: 'var(--font-weight-semibold)',
  margin: 0
} as const;

const listCaptionStyle = {
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-sm)',
  margin: 0
} as const;

const passwordCellStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-2)'
} as const;
