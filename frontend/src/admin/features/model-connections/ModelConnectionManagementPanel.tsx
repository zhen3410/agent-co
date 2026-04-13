import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Button, EmptyState, Table } from '../../../shared/ui';
import type { AdminModelConnection, AdminModelConnectionDraft } from '../../types';

export interface ModelConnectionManagementPanelProps {
  connections: AdminModelConnection[];
  onCreate: (draft: AdminModelConnectionDraft) => Promise<boolean>;
  onUpdate: (id: string, draft: AdminModelConnectionDraft) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onTest: (id: string) => Promise<boolean>;
}

interface ConnectionFormState {
  name: string;
  baseURL: string;
  apiKey: string;
  enabled: boolean;
}

const EMPTY_FORM: ConnectionFormState = {
  name: '',
  baseURL: '',
  apiKey: '',
  enabled: true
};

function toFormState(connection: AdminModelConnection): ConnectionFormState {
  return {
    name: connection.name,
    baseURL: connection.baseURL,
    apiKey: '',
    enabled: connection.enabled
  };
}

export function ModelConnectionManagementPanel({
  connections,
  onCreate,
  onUpdate,
  onDelete,
  onTest
}: ModelConnectionManagementPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [formState, setFormState] = useState<ConnectionFormState>(EMPTY_FORM);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const { name, type, checked, value } = event.target;
    const fieldName = name.replace(/^connection-/, '');
    setFormState((current) => ({
      ...current,
      [fieldName]: type === 'checkbox' ? checked : value
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draft: AdminModelConnectionDraft = {
      name: formState.name.trim(),
      baseURL: formState.baseURL.trim(),
      apiKey: formState.apiKey.trim(),
      enabled: formState.enabled
    };

    setBusyAction(editingId ? 'update' : 'create');
    try {
      const succeeded = editingId
        ? await onUpdate(editingId, draft)
        : await onCreate(draft);

      if (succeeded) {
        setEditingId(null);
        setFormState(EMPTY_FORM);
      }
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section data-admin-panel="model-connections" style={panelStyle}>
      <header style={panelHeaderStyle}>
        <div style={titleGroupStyle}>
          <span style={eyebrowStyle}>Model endpoints</span>
          <div style={headingRowStyle}>
            <h3 style={titleStyle}>模型连接</h3>
            <span style={countStyle}>{connections.length} 条连接</span>
          </div>
          <p style={descriptionStyle}>统一维护 API 入口、鉴权与启停状态，供 API 模式智能体稳定复用。</p>
        </div>
        {editingId ? (
          <Button
            variant="secondary"
            onClick={() => {
              setEditingId(null);
              setFormState(EMPTY_FORM);
            }}
          >
            取消编辑
          </Button>
        ) : null}
      </header>

      <div style={compositionStyle}>
        <form data-admin-form="model-connection-editor" onSubmit={handleSubmit} style={formStyle}>
          <div style={gridTwoStyle}>
            <label style={fieldGroupStyle}>
              <span style={fieldLabelStyle}>连接名称</span>
              <input name="connection-name" value={formState.name} onChange={handleChange} style={fieldStyle} />
            </label>
            <label style={fieldGroupStyle}>
              <span style={fieldLabelStyle}>Base URL</span>
              <input name="connection-baseURL" value={formState.baseURL} onChange={handleChange} style={fieldStyle} />
            </label>
          </div>
          <label style={fieldGroupStyle}>
            <span style={fieldLabelStyle}>API Key</span>
            <input
              name="connection-apiKey"
              type="password"
              value={formState.apiKey}
              onChange={handleChange}
              placeholder={editingId ? '留空以保留现有密钥' : 'sk-...'}
              style={fieldStyle}
            />
          </label>
          <label style={checkboxRowStyle}>
            <input
              name="connection-enabled"
              type="checkbox"
              checked={formState.enabled}
              onChange={handleChange}
            />
            <span>启用该连接</span>
          </label>
          <div style={submitRowStyle}>
            <Button type="submit" disabled={Boolean(busyAction)}>
              {editingId ? '保存连接' : '创建连接'}
            </Button>
            <span style={assistStyle}>连接信息与健康测试统一收拢在同一控制台区段。</span>
          </div>
        </form>

        <div style={listBlockStyle}>
          <div style={listHeaderStyle}>
            <p style={listTitleStyle}>已配置端点</p>
            <p style={listCaptionStyle}>偏向列表阅读，而不是堆叠多个厚重管理卡片。</p>
          </div>

          {connections.length === 0 ? (
            <EmptyState title="暂无模型连接" description="创建连接后，可供 API 模式智能体复用。" />
          ) : (
            <Table
              caption="模型连接列表"
              rows={connections}
              getRowKey={(connection) => connection.id}
              columns={[
                { key: 'name', header: '名称', render: (connection) => connection.name },
                { key: 'baseURL', header: 'Base URL', render: (connection) => connection.baseURL },
                { key: 'enabled', header: '状态', render: (connection) => connection.enabled ? '启用' : '停用' },
                { key: 'key', header: '密钥', render: (connection) => connection.apiKeyMasked },
                {
                  key: 'actions',
                  header: '操作',
                  render: (connection) => (
                    <div style={tableActionsStyle}>
                      <Button
                        variant="secondary"
                        data-admin-action={`edit-model-connection:${connection.id}`}
                        onClick={() => {
                          setEditingId(connection.id);
                          setFormState(toFormState(connection));
                        }}
                      >
                        编辑
                      </Button>
                      <Button variant="secondary" onClick={() => void onTest(connection.id)}>
                        测试
                      </Button>
                      <Button variant="danger" onClick={() => void onDelete(connection.id)}>
                        删除
                      </Button>
                    </div>
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
  alignItems: 'start',
  display: 'grid',
  gap: 'var(--space-3)',
  gridTemplateColumns: 'minmax(0, 1fr) auto'
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

const gridTwoStyle = {
  display: 'grid',
  gap: 'var(--space-3)',
  gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))'
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

const checkboxRowStyle = {
  alignItems: 'center',
  color: 'var(--color-text-secondary)',
  display: 'flex',
  gap: 'var(--space-2)'
} as const;

const submitRowStyle = {
  alignItems: 'center',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-3)'
} as const;

const assistStyle = {
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-sm)'
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

const tableActionsStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-2)'
} as const;
