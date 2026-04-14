import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Button, EmptyState, Table } from '../../../shared/ui';
import type { AdminAgent, AdminGroup } from '../../types';

export interface GroupManagementPanelProps {
  groups: AdminGroup[];
  agents: AdminAgent[];
  onCreate: (group: AdminGroup) => Promise<boolean>;
  onUpdate: (id: string, group: Omit<AdminGroup, 'id'>) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}

interface GroupFormState {
  id: string;
  name: string;
  icon: string;
  agentNames: string;
}

const EMPTY_FORM: GroupFormState = {
  id: '',
  name: '',
  icon: '',
  agentNames: ''
};

function toFormState(group: AdminGroup): GroupFormState {
  return {
    id: group.id,
    name: group.name,
    icon: group.icon,
    agentNames: group.agentNames.join(', ')
  };
}

function parseAgentNames(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export function GroupManagementPanel({ groups, agents, onCreate, onUpdate, onDelete }: GroupManagementPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formState, setFormState] = useState<GroupFormState>(EMPTY_FORM);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const agentHint = useMemo(() => agents.map((agent) => agent.name).join(', '), [agents]);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const { name, value } = event.target;
    const fieldName = name.replace(/^group-/, '');
    setFormState((current) => ({
      ...current,
      [fieldName]: value
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextGroup: AdminGroup = {
      id: formState.id.trim(),
      name: formState.name.trim(),
      icon: formState.icon.trim(),
      agentNames: parseAgentNames(formState.agentNames)
    };

    setBusyAction(editingId ? 'update' : 'create');
    try {
      const succeeded = editingId
        ? await onUpdate(editingId, {
          name: nextGroup.name,
          icon: nextGroup.icon,
          agentNames: nextGroup.agentNames
        })
        : await onCreate(nextGroup);

      if (succeeded) {
        setEditingId(null);
        setFormState(EMPTY_FORM);
      }
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section data-admin-panel="groups" style={panelStyle}>
      <header style={panelHeaderStyle}>
        <div style={titleGroupStyle}>
          <span style={eyebrowStyle}>Group topology</span>
          <div style={headingRowStyle}>
            <h3 style={titleStyle}>分组</h3>
            <span style={countStyle}>{groups.length} 个编排单元</span>
          </div>
          <p style={descriptionStyle}>用轻量分段方式维护协作编组，让成员关系与运行职责清晰可读。</p>
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
        <form data-admin-form="group-editor" onSubmit={handleSubmit} style={formStyle}>
          <div style={gridThreeStyle}>
            <label style={fieldGroupStyle}>
              <span style={fieldLabelStyle}>ID</span>
              <input
                name="group-id"
                value={formState.id}
                onChange={handleChange}
                disabled={Boolean(editingId)}
                style={fieldStyle}
              />
            </label>
            <label style={fieldGroupStyle}>
              <span style={fieldLabelStyle}>名称</span>
              <input name="group-name" value={formState.name} onChange={handleChange} style={fieldStyle} />
            </label>
            <label style={fieldGroupStyle}>
              <span style={fieldLabelStyle}>图标</span>
              <input name="group-icon" value={formState.icon} onChange={handleChange} style={fieldStyle} />
            </label>
          </div>
          <label style={fieldGroupStyle}>
            <span style={fieldLabelStyle}>成员智能体（逗号分隔）</span>
            <input name="group-agentNames" value={formState.agentNames} onChange={handleChange} style={fieldStyle} />
            <small style={hintStyle}>可选：{agentHint || '当前暂无已加载智能体'}</small>
          </label>
          <div style={submitRowStyle}>
            <Button type="submit" disabled={Boolean(busyAction)}>
              {editingId ? '保存分组' : '创建分组'}
            </Button>
            <span style={assistStyle}>适合维护小团队的固定协作编组与职责边界。</span>
          </div>
        </form>

        <div style={listBlockStyle}>
          <div style={listHeaderStyle}>
            <p style={listTitleStyle}>分组视图</p>
            <p style={listCaptionStyle}>列表作为控制台的主阅读面，不再使用一叠厚卡片分散注意力。</p>
          </div>

          {groups.length === 0 ? (
            <EmptyState title="暂无分组" description="创建分组后可在这里维护成员关系。" />
          ) : (
            <Table
              caption="分组列表"
              rows={groups}
              getRowKey={(group) => group.id}
              columns={[
                { key: 'id', header: 'ID', render: (group) => group.id },
                { key: 'name', header: '名称', render: (group) => `${group.icon} ${group.name}` },
                { key: 'members', header: '成员', render: (group) => group.agentNames.join(', ') || '—' },
                {
                  key: 'actions',
                  header: '操作',
                  render: (group) => (
                    <div style={tableActionsStyle}>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setEditingId(group.id);
                          setFormState(toFormState(group));
                        }}
                      >
                        编辑
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => {
                          void onDelete(group.id);
                        }}
                      >
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

const gridThreeStyle = {
  display: 'grid',
  gap: 'var(--space-3)',
  gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))'
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

const hintStyle = {
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-sm)'
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
