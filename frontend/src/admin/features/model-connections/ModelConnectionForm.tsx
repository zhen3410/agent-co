import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Button } from '../../../shared/ui';
import { AdminFieldGroup } from '../../components/AdminFieldGroup';
import type { AdminModelConnection, AdminModelConnectionDraft } from '../../types';
import { normalizeModelConnectionDraft } from './model-connection-form';

function toFormState(connection?: AdminModelConnection) {
  return {
    name: connection?.name || '',
    baseURL: connection?.baseURL || '',
    apiKey: '',
    enabled: connection?.enabled ?? true
  };
}

export function ModelConnectionForm({
  mode,
  initialValue,
  onSubmit,
  onTest,
  onCancel
}: {
  mode: 'create' | 'edit';
  initialValue?: AdminModelConnection;
  onSubmit: (draft: AdminModelConnectionDraft) => Promise<boolean>;
  onTest?: () => void;
  onCancel?: () => void;
}) {
  const [formState, setFormState] = useState(() => toFormState(initialValue));

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const fieldName = event.target.name.replace(/^connection-/, '');
    const nextValue = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setFormState((current) => ({ ...current, [fieldName]: nextValue }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const succeeded = await onSubmit(normalizeModelConnectionDraft(formState, mode === 'edit'));
    if (succeeded && mode === 'create') {
      setFormState(toFormState());
    }
  }

  return (
    <form data-admin-form="model-connection-editor" className="admin-editor-form" onSubmit={handleSubmit}>
      <AdminFieldGroup title="连接信息">
        <div className="admin-form-grid admin-form-grid--2">
          <label className="admin-form-control"><span>连接名称</span><input name="connection-name" value={formState.name} onChange={handleChange} className="ui-input__field" /></label>
          <label className="admin-form-control"><span>Base URL</span><input name="connection-baseURL" value={formState.baseURL} onChange={handleChange} className="ui-input__field" /></label>
        </div>
        <label className="admin-form-control"><span>API Key</span><input name="connection-apiKey" type="password" value={formState.apiKey} onChange={handleChange} autoComplete="off" className="ui-input__field" placeholder={mode === 'edit' ? '留空以保留现有密钥' : 'sk-...'} /></label>
        <label className="admin-checkbox-row"><input name="connection-enabled" type="checkbox" checked={formState.enabled} onChange={handleChange} /><span>启用该连接</span></label>
      </AdminFieldGroup>
      <div className="admin-editor-actions">
        <Button type="submit">{mode === 'create' ? '创建连接' : '保存连接'}</Button>
        {onTest ? <Button variant="secondary" onClick={onTest}>测试连接</Button> : null}
        {onCancel ? <Button variant="secondary" onClick={onCancel}>返回</Button> : null}
      </div>
    </form>
  );
}
