import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Button, Card, EmptyState, Table } from '../../../shared/ui';
import type { AdminAgent, AdminModelConnection, ApplyMode } from '../../types';

export interface AgentManagementPanelProps {
  agents: AdminAgent[];
  pendingReason: string | null;
  pendingUpdatedAt: number | null;
  connections: AdminModelConnection[];
  onCreate: (input: { agent: AdminAgent; applyMode?: ApplyMode }) => Promise<void>;
  onUpdate: (name: string, input: { agent: AdminAgent; applyMode?: ApplyMode }) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
  onApplyPending: () => Promise<void>;
}

interface AgentFormState {
  name: string;
  avatar: string;
  personality: string;
  color: string;
  systemPrompt: string;
  workdir: string;
  executionMode: 'cli' | 'api';
  cliName: 'codex' | 'claude';
  apiConnectionId: string;
  apiModel: string;
}

const EMPTY_FORM: AgentFormState = {
  name: '',
  avatar: '🤖',
  personality: '',
  color: '#2563eb',
  systemPrompt: '',
  workdir: '',
  executionMode: 'cli',
  cliName: 'codex',
  apiConnectionId: '',
  apiModel: ''
};

function toFormState(agent: AdminAgent): AgentFormState {
  return {
    name: agent.name,
    avatar: agent.avatar,
    personality: agent.personality,
    color: agent.color,
    systemPrompt: agent.systemPrompt || '',
    workdir: agent.workdir || '',
    executionMode: agent.executionMode || 'cli',
    cliName: agent.cliName || 'codex',
    apiConnectionId: agent.apiConnectionId || '',
    apiModel: agent.apiModel || ''
  };
}

export function AgentManagementPanel({
  agents,
  pendingReason,
  pendingUpdatedAt,
  connections,
  onCreate,
  onUpdate,
  onDelete,
  onApplyPending
}: AgentManagementPanelProps) {
  const [editingName, setEditingName] = useState<string | null>(null);
  const [formState, setFormState] = useState<AgentFormState>(EMPTY_FORM);

  function handleChange(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = event.target;
    const fieldName = name.replace(/^agent-/, '');
    setFormState((current) => ({
      ...current,
      [fieldName]: value
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const agent: AdminAgent = {
      name: formState.name.trim(),
      avatar: formState.avatar.trim(),
      personality: formState.personality.trim(),
      color: formState.color.trim(),
      systemPrompt: formState.systemPrompt.trim(),
      workdir: formState.workdir.trim(),
      executionMode: formState.executionMode,
      cliName: formState.executionMode === 'cli' ? formState.cliName : undefined,
      apiConnectionId: formState.executionMode === 'api' ? formState.apiConnectionId || undefined : undefined,
      apiModel: formState.executionMode === 'api' ? formState.apiModel || undefined : undefined
    };

    if (editingName) {
      await onUpdate(editingName, { agent, applyMode: 'immediate' });
    } else {
      await onCreate({ agent, applyMode: 'immediate' });
    }

    setEditingName(null);
    setFormState(EMPTY_FORM);
  }

  return (
    <Card
      title="智能体"
      actions={
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {pendingReason ? (
            <Button variant="secondary" onClick={() => void onApplyPending()}>
              应用待生效配置
            </Button>
          ) : null}
          {editingName ? (
            <Button
              variant="secondary"
              onClick={() => {
                setEditingName(null);
                setFormState(EMPTY_FORM);
              }}
            >
              取消编辑
            </Button>
          ) : null}
        </div>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {pendingReason ? (
          <div style={{ color: 'var(--color-text-muted)' }}>
            待生效原因：{pendingReason}
            {pendingUpdatedAt ? `（${new Date(pendingUpdatedAt).toLocaleString('zh-CN')}）` : ''}
          </div>
        ) : null}

        <form data-admin-form="agent-editor" onSubmit={handleSubmit} style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
            <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <span>名称</span>
              <input name="agent-name" value={formState.name} onChange={handleChange} disabled={Boolean(editingName)} style={fieldStyle} />
            </label>
            <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <span>头像</span>
              <input name="agent-avatar" value={formState.avatar} onChange={handleChange} style={fieldStyle} />
            </label>
            <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <span>颜色</span>
              <input name="agent-color" value={formState.color} onChange={handleChange} style={fieldStyle} />
            </label>
            <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <span>执行模式</span>
              <select name="agent-executionMode" value={formState.executionMode} onChange={handleChange} style={fieldStyle}>
                <option value="cli">CLI</option>
                <option value="api">API</option>
              </select>
            </label>
          </div>
          <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <span>个性说明</span>
            <input name="agent-personality" value={formState.personality} onChange={handleChange} style={fieldStyle} />
          </label>
          <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <span>系统提示词</span>
            <textarea name="agent-systemPrompt" value={formState.systemPrompt} onChange={handleChange} rows={4} style={fieldStyle} />
          </label>
          <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <span>Workdir</span>
              <input name="agent-workdir" value={formState.workdir} onChange={handleChange} style={fieldStyle} />
            </label>
            <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <span>CLI</span>
              <select name="agent-cliName" value={formState.cliName} onChange={handleChange} disabled={formState.executionMode !== 'cli'} style={fieldStyle}>
                <option value="codex">codex</option>
                <option value="claude">claude</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <span>模型连接</span>
              <select
                name="agent-apiConnectionId"
                value={formState.apiConnectionId}
                onChange={handleChange}
                disabled={formState.executionMode !== 'api'}
                style={fieldStyle}
              >
                <option value="">选择连接</option>
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>{connection.name}</option>
                ))}
              </select>
            </label>
          </div>
          {formState.executionMode === 'api' ? (
            <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <span>API Model</span>
              <input name="agent-apiModel" value={formState.apiModel} onChange={handleChange} style={fieldStyle} />
            </label>
          ) : null}
          <div>
            <Button type="submit">{editingName ? '保存智能体' : '创建智能体'}</Button>
          </div>
        </form>

        {agents.length === 0 ? (
          <EmptyState title="暂无智能体" description="创建后可分配到分组或切换为 API 模式。" />
        ) : (
          <Table
            caption="智能体列表"
            rows={agents}
            getRowKey={(agent) => agent.name}
            columns={[
              { key: 'name', header: '名称', render: (agent) => `${agent.avatar} ${agent.name}` },
              { key: 'personality', header: '个性', render: (agent) => agent.personality },
              { key: 'mode', header: '模式', render: (agent) => agent.executionMode || 'cli' },
              { key: 'target', header: '运行目标', render: (agent) => agent.executionMode === 'api' ? (agent.apiConnectionId || '未绑定连接') : (agent.cliName || 'codex') },
              {
                key: 'actions',
                header: '操作',
                render: (agent) => (
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <Button variant="secondary" onClick={() => {
                      setEditingName(agent.name);
                      setFormState(toFormState(agent));
                    }}>
                      编辑
                    </Button>
                    <Button variant="danger" onClick={() => void onDelete(agent.name)}>
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
