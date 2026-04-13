import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Button, Card, EmptyState, Table } from '../../../shared/ui';
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
    <Card
      title="模型连接"
      actions={
        editingId ? (
          <Button
            variant="secondary"
            onClick={() => {
              setEditingId(null);
              setFormState(EMPTY_FORM);
            }}
          >
            取消编辑
          </Button>
        ) : null
      }
    >
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <form data-admin-form="model-connection-editor" onSubmit={handleSubmit} style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <span>连接名称</span>
              <input name="connection-name" value={formState.name} onChange={handleChange} style={fieldStyle} />
            </label>
            <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <span>Base URL</span>
              <input name="connection-baseURL" value={formState.baseURL} onChange={handleChange} style={fieldStyle} />
            </label>
          </div>
          <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <span>API Key</span>
            <input
              name="connection-apiKey"
              type="password"
              value={formState.apiKey}
              onChange={handleChange}
              placeholder={editingId ? '留空以保留现有密钥' : 'sk-...'}
              style={fieldStyle}
            />
          </label>
          <label style={{ alignItems: 'center', display: 'flex', gap: 'var(--space-2)' }}>
            <input
              name="connection-enabled"
              type="checkbox"
              checked={formState.enabled}
              onChange={handleChange}
            />
            <span>启用该连接</span>
          </label>
          <div>
            <Button type="submit" disabled={Boolean(busyAction)}>
              {editingId ? '保存连接' : '创建连接'}
            </Button>
          </div>
        </form>

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
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
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
