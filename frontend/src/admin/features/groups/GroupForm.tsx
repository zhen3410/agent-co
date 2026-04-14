import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Button } from '../../../shared/ui';
import { AdminFieldGroup } from '../../components/AdminFieldGroup';
import type { AdminAgent, AdminGroup } from '../../types';
import { normalizeGroupDraft } from './group-form';

function toFormState(group?: AdminGroup) {
  return {
    id: group?.id || '',
    name: group?.name || '',
    icon: group?.icon || '',
    agentNames: group?.agentNames.join(', ') || ''
  };
}

export function GroupForm({
  mode,
  initialValue,
  agents,
  onSubmit,
  onCancel
}: {
  mode: 'create' | 'edit';
  initialValue?: AdminGroup;
  agents: AdminAgent[];
  onSubmit: (group: AdminGroup) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [formState, setFormState] = useState(() => toFormState(initialValue));
  const agentHint = useMemo(() => agents.map((agent) => agent.name).join(', '), [agents]);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const fieldName = event.target.name.replace(/^group-/, '');
    setFormState((current) => ({ ...current, [fieldName]: event.target.value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const succeeded = await onSubmit(normalizeGroupDraft(formState, agents.map((agent) => agent.name)));
    if (succeeded && mode === 'create') {
      setFormState(toFormState());
    }
  }

  return (
    <form data-admin-form="group-editor" className="admin-editor-form" onSubmit={handleSubmit}>
      <AdminFieldGroup title="分组信息">
        <div className="admin-form-grid admin-form-grid--3">
          <label className="admin-form-control"><span>ID</span><input name="group-id" value={formState.id} onChange={handleChange} disabled={mode === 'edit'} className="ui-input__field" /></label>
          <label className="admin-form-control"><span>名称</span><input name="group-name" value={formState.name} onChange={handleChange} className="ui-input__field" /></label>
          <label className="admin-form-control"><span>图标</span><input name="group-icon" value={formState.icon} onChange={handleChange} className="ui-input__field" /></label>
        </div>
        <label className="admin-form-control"><span>成员智能体（逗号分隔）</span><input name="group-agentNames" value={formState.agentNames} onChange={handleChange} className="ui-input__field" /></label>
        <div className="admin-form-hint">可选：{agentHint || '当前暂无已加载智能体'}</div>
      </AdminFieldGroup>
      <div className="admin-editor-actions">
        <Button type="submit">{mode === 'create' ? '创建分组' : '保存分组'}</Button>
        {onCancel ? <Button variant="secondary" onClick={onCancel}>返回</Button> : null}
      </div>
    </form>
  );
}
