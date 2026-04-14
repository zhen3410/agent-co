import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Button } from '../../../shared/ui';
import { AdminFieldGroup } from '../../components/AdminFieldGroup';
import { normalizeUserDraft } from './user-form';

export function UserForm({
  mode,
  initialValue,
  onSubmit,
  onCancel
}: {
  mode: 'create' | 'edit';
  initialValue?: { username: string };
  onSubmit: (draft: { username: string; password?: string }) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [formState, setFormState] = useState({ username: initialValue?.username || '', password: '' });

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setFormState((current) => ({ ...current, [event.target.name.replace(/^user-/, '')]: event.target.value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const succeeded = await onSubmit(normalizeUserDraft(formState));
    if (succeeded && mode === 'create') {
      setFormState({ username: '', password: '' });
    }
  }

  return (
    <form data-admin-form="user-editor" className="admin-editor-form" onSubmit={handleSubmit}>
      <AdminFieldGroup title={mode === 'create' ? '用户信息' : '密码更新'}>
        <div className="admin-form-grid admin-form-grid--2">
          <label className="admin-form-control"><span>用户名</span><input name="user-username" value={formState.username} onChange={handleChange} disabled={mode === 'edit'} className="ui-input__field" /></label>
          <label className="admin-form-control"><span>{mode === 'create' ? '初始密码' : '新密码'}</span><input name="user-password" type="password" value={formState.password} onChange={handleChange} className="ui-input__field" /></label>
        </div>
      </AdminFieldGroup>
      <div className="admin-editor-actions">
        <Button type="submit">{mode === 'create' ? '创建用户' : '更新密码'}</Button>
        {onCancel ? <Button variant="secondary" onClick={onCancel}>返回</Button> : null}
      </div>
    </form>
  );
}
