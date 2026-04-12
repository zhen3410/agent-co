import { useCallback, useEffect, useMemo, useState } from 'react';
import { getMergedRuntimeConfig } from '../../shared/config/runtime-config';
import { ToolPageLayout } from '../../shared/layouts/ToolPageLayout';
import { Button, ErrorState, Spinner } from '../../shared/ui';
import { AgentManagementPanel } from '../features/agents/AgentManagementPanel';
import { GroupManagementPanel } from '../features/groups/GroupManagementPanel';
import { ModelConnectionManagementPanel } from '../features/model-connections/ModelConnectionManagementPanel';
import { AdminFeatureNotice } from '../features/shared/AdminFeatureNotice';
import { AdminTokenGate } from '../features/shared/AdminTokenGate';
import { UserManagementPanel } from '../features/users/UserManagementPanel';
import { createAdminApi } from '../services/admin-api';
import type { AdminApi, AdminNotice, AdminResources, AdminAgent, AdminGroup, AdminModelConnectionDraft } from '../types';

export interface AdminPageProps {
  api?: AdminApi;
  initialAuthToken?: string;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

const EMPTY_RESOURCES: AdminResources = {
  users: [],
  agents: [],
  pendingAgents: null,
  pendingReason: null,
  pendingUpdatedAt: null,
  groups: [],
  connections: []
};

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function upsertByName(items: AdminAgent[], nextItem: AdminAgent): AdminAgent[] {
  const next = items.filter((item) => item.name !== nextItem.name);
  next.push(nextItem);
  return next.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}

function upsertById<T extends { id: string }>(items: T[], nextItem: T): T[] {
  const next = items.filter((item) => item.id !== nextItem.id);
  next.push(nextItem);
  return next.sort((left, right) => left.id.localeCompare(right.id, 'zh-CN'));
}

export function AdminPage({ api, initialAuthToken = '' }: AdminPageProps) {
  const runtimeConfig = getMergedRuntimeConfig();
  const [authToken, setAuthToken] = useState(initialAuthToken);
  const [resources, setResources] = useState<AdminResources>(EMPTY_RESOURCES);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<AdminNotice | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const adminApi = useMemo(() => {
    if (api) {
      return api;
    }

    const baseUrl = typeof runtimeConfig.apiBaseUrl === 'string' ? runtimeConfig.apiBaseUrl : undefined;
    return createAdminApi({
      baseUrl,
      getAdminToken: () => authToken
    });
  }, [api, authToken, runtimeConfig.apiBaseUrl]);

  const canLoad = Boolean(api) || authToken.trim().length > 0;
  const hasLoadedData = loadState === 'ready'
    || resources.users.length > 0
    || resources.agents.length > 0
    || resources.groups.length > 0
    || resources.connections.length > 0;

  const loadResources = useCallback(async () => {
    if (!canLoad) {
      return;
    }

    setLoadState('loading');
    setErrorMessage(null);

    try {
      const [usersResult, agentsResult, groupsResult, connectionsResult] = await Promise.all([
        adminApi.listUsers(),
        adminApi.listAgents(),
        adminApi.listGroups(),
        adminApi.listModelConnections()
      ]);

      setResources({
        users: usersResult.users,
        agents: agentsResult.agents,
        pendingAgents: agentsResult.pendingAgents,
        pendingReason: agentsResult.pendingReason,
        pendingUpdatedAt: agentsResult.pendingUpdatedAt,
        groups: groupsResult.groups,
        connections: connectionsResult.connections
      });
      setLoadState('ready');
    } catch (error) {
      setLoadState('error');
      setErrorMessage(toErrorMessage(error, '加载管理资源失败'));
    }
  }, [adminApi, canLoad]);

  useEffect(() => {
    void loadResources();
  }, [loadResources, reloadNonce]);

  function showSuccess(message: string) {
    setNotice({ tone: 'success', message });
  }

  function showError(error: unknown, fallback: string) {
    setNotice({ tone: 'error', message: toErrorMessage(error, fallback) });
  }

  async function runMutation(action: () => Promise<void>) {
    setErrorMessage(null);
    await action();
  }

  async function handleCreateGroup(group: AdminGroup) {
    await runMutation(async () => {
      try {
        const result = await adminApi.createGroup(group);
        setResources((current) => ({
          ...current,
          groups: upsertById(current.groups, result.group)
        }));
        showSuccess(`已保存分组 ${result.group.id}`);
      } catch (error) {
        showError(error, '保存分组失败');
      }
    });
  }

  async function handleUpdateGroup(id: string, group: Omit<AdminGroup, 'id'>) {
    await runMutation(async () => {
      try {
        const result = await adminApi.updateGroup(id, group);
        setResources((current) => ({
          ...current,
          groups: upsertById(current.groups, result.group)
        }));
        showSuccess(`已保存分组 ${result.group.id}`);
      } catch (error) {
        showError(error, '保存分组失败');
      }
    });
  }

  async function handleDeleteGroup(id: string) {
    await runMutation(async () => {
      try {
        await adminApi.deleteGroup(id);
        setResources((current) => ({
          ...current,
          groups: current.groups.filter((group) => group.id !== id)
        }));
        showSuccess(`已删除分组 ${id}`);
      } catch (error) {
        showError(error, '删除分组失败');
      }
    });
  }

  async function handleCreateConnection(draft: AdminModelConnectionDraft) {
    await runMutation(async () => {
      try {
        const result = await adminApi.createModelConnection(draft);
        setResources((current) => ({
          ...current,
          connections: upsertById(current.connections, result.connection)
        }));
        showSuccess(`已保存连接 ${result.connection.name}`);
      } catch (error) {
        showError(error, '保存连接失败');
      }
    });
  }

  async function handleUpdateConnection(id: string, draft: AdminModelConnectionDraft) {
    await runMutation(async () => {
      try {
        const result = await adminApi.updateModelConnection(id, draft);
        setResources((current) => ({
          ...current,
          connections: upsertById(current.connections, result.connection)
        }));
        showSuccess(`已保存连接 ${result.connection.name}`);
      } catch (error) {
        showError(error, '保存连接失败');
      }
    });
  }

  async function handleDeleteConnection(id: string) {
    await runMutation(async () => {
      try {
        await adminApi.deleteModelConnection(id);
        setResources((current) => ({
          ...current,
          connections: current.connections.filter((connection) => connection.id !== id)
        }));
        showSuccess(`已删除连接 ${id}`);
      } catch (error) {
        showError(error, '删除连接失败');
      }
    });
  }

  async function handleTestConnection(id: string) {
    await runMutation(async () => {
      try {
        const result = await adminApi.testModelConnection(id);
        if (result.success) {
          showSuccess(`连接 ${id} 测试成功`);
        } else {
          showError(new Error(result.error || '连接测试失败'), '连接测试失败');
        }
      } catch (error) {
        showError(error, '连接测试失败');
      }
    });
  }

  async function handleCreateAgent(input: { agent: AdminAgent }) {
    await runMutation(async () => {
      try {
        const result = await adminApi.createAgent({ agent: input.agent, applyMode: 'immediate' });
        setResources((current) => ({
          ...current,
          agents: upsertByName(current.agents, result.agent)
        }));
        showSuccess(`已保存智能体 ${result.agent.name}`);
      } catch (error) {
        showError(error, '保存智能体失败');
      }
    });
  }

  async function handleUpdateAgent(name: string, input: { agent: AdminAgent }) {
    await runMutation(async () => {
      try {
        const result = await adminApi.updateAgent(name, { agent: input.agent, applyMode: 'immediate' });
        setResources((current) => ({
          ...current,
          agents: upsertByName(current.agents.filter((item) => item.name !== name), result.agent)
        }));
        showSuccess(`已保存智能体 ${result.agent.name}`);
      } catch (error) {
        showError(error, '保存智能体失败');
      }
    });
  }

  async function handleDeleteAgent(name: string) {
    await runMutation(async () => {
      try {
        await adminApi.deleteAgent(name);
        setResources((current) => ({
          ...current,
          agents: current.agents.filter((agent) => agent.name !== name)
        }));
        showSuccess(`已删除智能体 ${name}`);
      } catch (error) {
        showError(error, '删除智能体失败');
      }
    });
  }

  async function handleApplyPendingAgents() {
    await runMutation(async () => {
      try {
        const result = await adminApi.applyPendingAgents();
        setResources((current) => ({
          ...current,
          agents: [...result.agents].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
          pendingAgents: null,
          pendingReason: null,
          pendingUpdatedAt: null
        }));
        showSuccess('已应用待生效智能体配置');
      } catch (error) {
        showError(error, '应用待生效配置失败');
      }
    });
  }

  async function handleCreateUser(input: { username: string; password: string }) {
    await runMutation(async () => {
      try {
        const result = await adminApi.createUser(input);
        setResources((current) => ({
          ...current,
          users: [...current.users, {
            username: result.username,
            createdAt: Date.now(),
            updatedAt: Date.now()
          }].sort((left, right) => left.username.localeCompare(right.username, 'zh-CN'))
        }));
        showSuccess(`已创建用户 ${result.username}`);
      } catch (error) {
        showError(error, '创建用户失败');
      }
    });
  }

  async function handleChangeUserPassword(username: string, input: { password: string }) {
    await runMutation(async () => {
      try {
        await adminApi.updateUserPassword(username, input);
        setResources((current) => ({
          ...current,
          users: current.users.map((user) => user.username === username
            ? { ...user, updatedAt: Date.now() }
            : user)
        }));
        showSuccess(`已更新 ${username} 的密码`);
      } catch (error) {
        showError(error, '更新密码失败');
      }
    });
  }

  async function handleDeleteUser(username: string) {
    await runMutation(async () => {
      try {
        await adminApi.deleteUser(username);
        setResources((current) => ({
          ...current,
          users: current.users.filter((user) => user.username !== username)
        }));
        showSuccess(`已删除用户 ${username}`);
      } catch (error) {
        showError(error, '删除用户失败');
      }
    });
  }

  const navigation = (
    <nav aria-label="Admin sections" style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      <a href="#agents" data-admin-nav="agents" style={navLinkStyle}>智能体</a>
      <a href="#groups" data-admin-nav="groups" style={navLinkStyle}>分组</a>
      <a href="#users" data-admin-nav="users" style={navLinkStyle}>用户</a>
      <a href="#model-connections" data-admin-nav="model-connections" style={navLinkStyle}>模型连接</a>
    </nav>
  );

  let content = null;

  if (!canLoad) {
    content = <AdminTokenGate onSubmit={setAuthToken} busy={loadState === 'loading'} />;
  } else if (loadState === 'loading' && !hasLoadedData) {
    content = <Spinner label="正在加载管理工作台…" />;
  } else if (loadState === 'error' && !hasLoadedData) {
    content = (
      <ErrorState
        title="管理资源加载失败"
        message={errorMessage || '请检查管理员 Token 或服务状态。'}
        action={<Button onClick={() => setReloadNonce((value) => value + 1)}>重试</Button>}
      />
    );
  } else {
    content = (
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <section id="agents">
          <AgentManagementPanel
            agents={resources.agents}
            pendingReason={resources.pendingReason}
            pendingUpdatedAt={resources.pendingUpdatedAt}
            connections={resources.connections}
            onCreate={handleCreateAgent}
            onUpdate={handleUpdateAgent}
            onDelete={handleDeleteAgent}
            onApplyPending={handleApplyPendingAgents}
          />
        </section>
        <section id="groups">
          <GroupManagementPanel
            groups={resources.groups}
            agents={resources.agents}
            onCreate={handleCreateGroup}
            onUpdate={handleUpdateGroup}
            onDelete={handleDeleteGroup}
          />
        </section>
        <section id="users">
          <UserManagementPanel
            users={resources.users}
            onCreate={handleCreateUser}
            onChangePassword={handleChangeUserPassword}
            onDelete={handleDeleteUser}
          />
        </section>
        <section id="model-connections">
          <ModelConnectionManagementPanel
            connections={resources.connections}
            onCreate={handleCreateConnection}
            onUpdate={handleUpdateConnection}
            onDelete={handleDeleteConnection}
            onTest={handleTestConnection}
          />
        </section>
      </div>
    );
  }

  return (
    <ToolPageLayout
      appTitle="agent-co admin"
      pageTitle="管理工作台"
      description="统一管理智能体、分组、用户与模型连接。"
      navigation={navigation}
      actions={(
        <Button variant="secondary" onClick={() => setReloadNonce((value) => value + 1)}>
          刷新
        </Button>
      )}
    >
      <AdminFeatureNotice notice={notice}>
        {content}
      </AdminFeatureNotice>
    </ToolPageLayout>
  );
}

const navLinkStyle = {
  backgroundColor: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: '999px',
  color: 'var(--color-text)',
  padding: 'var(--space-2) var(--space-3)',
  textDecoration: 'none'
} as const;
