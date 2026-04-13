import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Button, EmptyState, Table } from '../../../shared/ui';
import type { AdminAgent, AdminModelConnection, ApplyMode } from '../../types';

export interface AgentManagementPanelProps {
  agents: AdminAgent[];
  pendingReason: string | null;
  pendingUpdatedAt: number | null;
  connections: AdminModelConnection[];
  onCreate: (input: { agent: AdminAgent; applyMode?: ApplyMode }) => Promise<boolean>;
  onUpdate: (name: string, input: { agent: AdminAgent; applyMode?: ApplyMode }) => Promise<boolean>;
  onDelete: (name: string) => Promise<boolean>;
  onApplyPending: () => Promise<boolean>;
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

    const succeeded = editingName
      ? await onUpdate(editingName, { agent, applyMode: 'immediate' })
      : await onCreate({ agent, applyMode: 'immediate' });

    if (succeeded) {
      setEditingName(null);
      setFormState(EMPTY_FORM);
    }
  }

  return (
    <section data-admin-panel="agents" style={panelStyle}>
      <header style={panelHeaderStyle}>
        <div style={titleGroupStyle}>
          <span style={eyebrowStyle}>Agent registry</span>
          <div style={headingRowStyle}>
            <h3 style={titleStyle}>智能体</h3>
            <span style={countStyle}>{agents.length} 个已加载</span>
          </div>
          <p style={descriptionStyle}>维护角色设定、执行方式与运行目标，让聊天工作台与控制平面使用同一套语义。</p>
        </div>
        <div style={actionsRowStyle}>
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
      </header>

      {pendingReason ? (
        <div style={pendingStyle}>
          <strong>待生效原因：</strong>
          <span>{pendingReason}</span>
          {pendingUpdatedAt ? <span style={pendingTimeStyle}>{new Date(pendingUpdatedAt).toLocaleString('zh-CN')}</span> : null}
        </div>
      ) : null}

      <div style={compositionStyle}>
        <form data-admin-form="agent-editor" onSubmit={handleSubmit} style={formStyle}>
          <div style={gridFourStyle}>
            <label style={fieldGroupStyle}>
              <span style={fieldLabelStyle}>名称</span>
              <input name="agent-name" value={formState.name} onChange={handleChange} disabled={Boolean(editingName)} style={fieldStyle} />
            </label>
            <label style={fieldGroupStyle}>
              <span style={fieldLabelStyle}>头像</span>
              <input name="agent-avatar" value={formState.avatar} onChange={handleChange} style={fieldStyle} />
            </label>
            <label style={fieldGroupStyle}>
              <span style={fieldLabelStyle}>颜色</span>
              <input name="agent-color" value={formState.color} onChange={handleChange} style={fieldStyle} />
            </label>
            <label style={fieldGroupStyle}>
              <span style={fieldLabelStyle}>执行模式</span>
              <select name="agent-executionMode" value={formState.executionMode} onChange={handleChange} style={fieldStyle}>
                <option value="cli">CLI</option>
                <option value="api">API</option>
              </select>
            </label>
          </div>

          <label style={fieldGroupStyle}>
            <span style={fieldLabelStyle}>个性说明</span>
            <input name="agent-personality" value={formState.personality} onChange={handleChange} style={fieldStyle} />
          </label>

          <label style={fieldGroupStyle}>
            <span style={fieldLabelStyle}>系统提示词</span>
            <textarea name="agent-systemPrompt" value={formState.systemPrompt} onChange={handleChange} rows={4} style={textareaStyle} />
          </label>

          <div style={gridThreeStyle}>
            <label style={fieldGroupStyle}>
              <span style={fieldLabelStyle}>Workdir</span>
              <input name="agent-workdir" value={formState.workdir} onChange={handleChange} style={fieldStyle} />
            </label>
            <label style={fieldGroupStyle}>
              <span style={fieldLabelStyle}>CLI</span>
              <select name="agent-cliName" value={formState.cliName} onChange={handleChange} disabled={formState.executionMode !== 'cli'} style={fieldStyle}>
                <option value="codex">codex</option>
                <option value="claude">claude</option>
              </select>
            </label>
            <label style={fieldGroupStyle}>
              <span style={fieldLabelStyle}>模型连接</span>
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
            <label style={fieldGroupStyle}>
              <span style={fieldLabelStyle}>API Model</span>
              <input name="agent-apiModel" value={formState.apiModel} onChange={handleChange} style={fieldStyle} />
            </label>
          ) : null}

          <div style={submitRowStyle}>
            <Button type="submit">{editingName ? '保存智能体' : '创建智能体'}</Button>
            <span style={assistStyle}>统一支持 CLI 与 API 两种执行路径。</span>
          </div>
        </form>

        <div style={listBlockStyle}>
          <div style={listHeaderStyle}>
            <div>
              <p style={listTitleStyle}>当前智能体</p>
              <p style={listCaptionStyle}>保持更高信息密度，但用轻边框和稳定排版代替厚重卡片。</p>
            </div>
          </div>

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
                    <div style={tableActionsStyle}>
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
  maxWidth: '46rem'
} as const;

const actionsRowStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-2)',
  justifyContent: 'flex-end'
} as const;

const pendingStyle = {
  alignItems: 'center',
  background: 'var(--color-surface-muted)',
  border: '1px solid var(--color-border-muted)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-text-secondary)',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-2)',
  padding: 'var(--space-3)'
} as const;

const pendingTimeStyle = {
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-sm)'
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

const gridFourStyle = {
  display: 'grid',
  gap: 'var(--space-3)',
  gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))'
} as const;

const gridThreeStyle = {
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

const textareaStyle = {
  ...fieldStyle,
  minHeight: '7rem',
  paddingBlock: 'var(--space-3)',
  resize: 'vertical'
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
