import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Button } from '../../../shared/ui';
import { AdminDialog } from '../../components/AdminDialog';
import { AdminFieldGroup } from '../../components/AdminFieldGroup';
import type { AdminAgent, AdminModelConnection } from '../../types';
import { normalizeAgentDraft } from './agent-form';

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

function toFormState(agent?: AdminAgent): AgentFormState {
  return {
    name: agent?.name || '',
    avatar: agent?.avatar || '🤖',
    personality: agent?.personality || '',
    color: agent?.color || '#2563eb',
    systemPrompt: agent?.systemPrompt || '',
    workdir: agent?.workdir || '',
    executionMode: agent?.executionMode || 'cli',
    cliName: agent?.cliName || 'codex',
    apiConnectionId: agent?.apiConnectionId || '',
    apiModel: agent?.apiModel || ''
  };
}

export interface AgentFormProps {
  mode: 'create' | 'edit';
  initialValue?: AdminAgent;
  connections: AdminModelConnection[];
  onSubmit: (agent: AdminAgent) => Promise<boolean>;
  onCancel?: () => void;
  onPreviewDefaultPrompt?: () => Promise<string | null>;
  onRestoreDefaultPrompt?: () => Promise<string | null>;
}

export function AgentForm({ mode, initialValue, connections, onSubmit, onCancel, onPreviewDefaultPrompt, onRestoreDefaultPrompt }: AgentFormProps) {
  const [formState, setFormState] = useState<AgentFormState>(() => toFormState(initialValue));
  const [previewPrompt, setPreviewPrompt] = useState<string>('');

  function handleChange(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = event.target;
    const fieldName = name.replace(/^agent-/, '');
    setFormState((current) => ({ ...current, [fieldName]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const succeeded = await onSubmit(normalizeAgentDraft(formState, initialValue));
    if (succeeded && mode === 'create') {
      setFormState(toFormState());
      setPreviewPrompt('');
    }
  }

  async function handlePreviewDefaultPrompt() {
    if (!onPreviewDefaultPrompt) {
      return;
    }
    const prompt = await onPreviewDefaultPrompt();
    if (typeof prompt === 'string') {
      setPreviewPrompt(prompt);
    }
  }

  async function handleRestoreDefaultPrompt() {
    if (!onRestoreDefaultPrompt) {
      return;
    }
    const prompt = await onRestoreDefaultPrompt();
    if (typeof prompt === 'string') {
      setPreviewPrompt(prompt);
      setFormState((current) => ({ ...current, systemPrompt: prompt }));
    }
  }

  return (
    <>
      {previewPrompt ? (
        <AdminDialog dialogId="agent-prompt-preview" title="默认提示词" onClose={() => setPreviewPrompt('')}>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{previewPrompt}</pre>
        </AdminDialog>
      ) : null}
      <form data-admin-form="agent-editor" className="admin-editor-form" onSubmit={handleSubmit}>
        <AdminFieldGroup title="基础信息">
          <div className="admin-form-grid admin-form-grid--3">
            <label className="admin-form-control"><span>名称</span><input name="agent-name" value={formState.name} onChange={handleChange} disabled={mode === 'edit'} className="ui-input__field" /></label>
            <label className="admin-form-control"><span>头像</span><input name="agent-avatar" value={formState.avatar} onChange={handleChange} className="ui-input__field" /></label>
            <label className="admin-form-control"><span>颜色</span><input name="agent-color" value={formState.color} onChange={handleChange} className="ui-input__field" /></label>
          </div>
          <label className="admin-form-control"><span>个性说明</span><input name="agent-personality" value={formState.personality} onChange={handleChange} className="ui-input__field" /></label>
        </AdminFieldGroup>
        <AdminFieldGroup title="执行配置">
          <div className="admin-form-grid admin-form-grid--3">
            <label className="admin-form-control"><span>执行模式</span><select name="agent-executionMode" value={formState.executionMode} onChange={handleChange} className="ui-input__field"><option value="cli">CLI</option><option value="api">API</option></select></label>
            <label className="admin-form-control"><span>CLI</span><select name="agent-cliName" value={formState.cliName} onChange={handleChange} disabled={formState.executionMode !== 'cli'} className="ui-input__field"><option value="codex">codex</option><option value="claude">claude</option></select></label>
            <label className="admin-form-control"><span>Workdir</span><input name="agent-workdir" value={formState.workdir} onChange={handleChange} className="ui-input__field" /></label>
          </div>
          <div className="admin-row-actions">
            <Button variant="secondary" data-admin-action="preview-agent-template" onClick={() => void handlePreviewDefaultPrompt()}>预览</Button>
            <Button variant="secondary" data-admin-action="restore-agent-template" onClick={() => void handleRestoreDefaultPrompt()}>恢复</Button>
          </div>
          <label className="admin-form-control"><span>系统提示词</span><textarea name="agent-systemPrompt" value={formState.systemPrompt} onChange={handleChange} rows={8} className="admin-textarea" /></label>
          {formState.executionMode === 'api' ? (
            <div className="admin-form-grid admin-form-grid--2">
              <label className="admin-form-control"><span>模型连接</span><select name="agent-apiConnectionId" value={formState.apiConnectionId} onChange={handleChange} className="ui-input__field"><option value="">选择连接</option>{connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></label>
              <label className="admin-form-control"><span>API Model</span><input name="agent-apiModel" value={formState.apiModel} onChange={handleChange} className="ui-input__field" /></label>
            </div>
          ) : null}
        </AdminFieldGroup>
        <div className="admin-editor-actions">
          <Button type="submit">{mode === 'create' ? '创建智能体' : '保存智能体'}</Button>
          {onCancel ? <Button variant="secondary" onClick={onCancel}>返回</Button> : null}
        </div>
      </form>
    </>
  );
}
