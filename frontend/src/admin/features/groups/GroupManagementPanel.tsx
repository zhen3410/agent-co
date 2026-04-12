import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Button, Card, EmptyState, Table } from '../../../shared/ui';
import type { AdminAgent, AdminGroup } from '../../types';

export interface GroupManagementPanelProps {
  groups: AdminGroup[];
  agents: AdminAgent[];
  onCreate: (group: AdminGroup) => Promise<void>;
  onUpdate: (id: string, group: Omit<AdminGroup, 'id'>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
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
      if (editingId) {
        await onUpdate(editingId, {
          name: nextGroup.name,
          icon: nextGroup.icon,
          agentNames: nextGroup.agentNames
        });
      } else {
        await onCreate(nextGroup);
      }
      setEditingId(null);
      setFormState(EMPTY_FORM);
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <Card
      title="分组"
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
        <form data-admin-form="group-editor" onSubmit={handleSubmit} style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <span>ID</span>
              <input
                name="group-id"
                value={formState.id}
                onChange={handleChange}
                disabled={Boolean(editingId)}
                style={fieldStyle}
              />
            </label>
            <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <span>名称</span>
              <input name="group-name" value={formState.name} onChange={handleChange} style={fieldStyle} />
            </label>
            <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <span>图标</span>
              <input name="group-icon" value={formState.icon} onChange={handleChange} style={fieldStyle} />
            </label>
          </div>
          <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <span>成员智能体（逗号分隔）</span>
            <input name="group-agentNames" value={formState.agentNames} onChange={handleChange} style={fieldStyle} />
            <small style={{ color: 'var(--color-text-muted)' }}>可选：{agentHint || '当前暂无已加载智能体'}</small>
          </label>
          <div>
            <Button type="submit" disabled={Boolean(busyAction)}>
              {editingId ? '保存分组' : '创建分组'}
            </Button>
          </div>
        </form>

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
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
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
