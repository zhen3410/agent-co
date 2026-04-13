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

function normalizeGroupAgentNames(agentNames: string[]): string[] {
  return agentNames.map((item) => item.trim()).filter(Boolean);
}

function validateGroupMembers(group: AdminGroup, agents: AdminAgent[]): AdminGroup {
  const normalizedAgentNames = normalizeGroupAgentNames(group.agentNames);
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const name of normalizedAgentNames) {
    if (seen.has(name)) {
      duplicates.add(name);
      continue;
    }
    seen.add(name);
  }

  const knownAgents = new Set(agents.map((agent) => agent.name));
  const unknown = normalizedAgentNames.filter((name) => !knownAgents.has(name));
  if (duplicates.size > 0 || unknown.length > 0) {
    const parts: string[] = [];
    if (duplicates.size > 0) {
      parts.push(`成员中包含重复智能体: ${Array.from(duplicates).join(', ')}`);
    }
    if (unknown.length > 0) {
      parts.push(`成员中包含未知智能体: ${Array.from(new Set(unknown)).join(', ')}`);
    }
    throw new Error(parts.join('；'));
  }

  return {
    ...group,
    agentNames: normalizedAgentNames
  };
}

export function AdminPage({ api, initialAuthToken = '' }: AdminPageProps) {
  const runtimeConfig = getMergedRuntimeConfig();
  const [authToken, setAuthToken] = useState(initialAuthToken);
  const [resources, setResources] = useState<AdminResources>(EMPTY_RESOURCES);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
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
  const hasLoadedData = hasLoadedOnce
    || loadState === 'ready'
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
      setHasLoadedOnce(true);
      setLoadState('ready');
      setErrorMessage(null);
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

  async function runMutation<T>(action: () => Promise<T>, fallbackMessage: string): Promise<T> {
    setErrorMessage(null);
    try {
      return await action();
    } catch (error) {
      showError(error, fallbackMessage);
      throw error;
    }
  }

  async function handleCreateGroup(group: AdminGroup): Promise<boolean> {
    const result = await runMutation(() => {
      const nextGroup = validateGroupMembers(group, resources.agents);
      return adminApi.createGroup(nextGroup);
    }, '保存分组失败').catch(() => null);
    if (!result) {
      return false;
    }
    setResources((current) => ({
      ...current,
      groups: upsertById(current.groups, result.group)
    }));
    showSuccess(`已保存分组 ${result.group.id}`);
    return true;
  }

  async function handleUpdateGroup(id: string, group: Omit<AdminGroup, 'id'>): Promise<boolean> {
    const result = await runMutation(() => {
      const nextGroup = validateGroupMembers({ ...group, id }, resources.agents);
      return adminApi.updateGroup(id, {
        name: nextGroup.name,
        icon: nextGroup.icon,
        agentNames: nextGroup.agentNames
      });
    }, '保存分组失败').catch(() => null);
    if (!result) {
      return false;
    }
    setResources((current) => ({
      ...current,
      groups: upsertById(current.groups, result.group)
    }));
    showSuccess(`已保存分组 ${result.group.id}`);
    return true;
  }

  async function handleDeleteGroup(id: string): Promise<boolean> {
    const result = await runMutation(() => adminApi.deleteGroup(id), '删除分组失败').catch(() => null);
    if (!result) {
      return false;
    }
    setResources((current) => ({
      ...current,
      groups: current.groups.filter((group) => group.id !== id)
    }));
    showSuccess(`已删除分组 ${id}`);
    return true;
  }

  async function handleCreateConnection(draft: AdminModelConnectionDraft): Promise<boolean> {
    const result = await runMutation(() => adminApi.createModelConnection(draft), '保存连接失败').catch(() => null);
    if (!result) {
      return false;
    }
    setResources((current) => ({
      ...current,
      connections: upsertById(current.connections, result.connection)
    }));
    showSuccess(`已保存连接 ${result.connection.name}`);
    return true;
  }

  async function handleUpdateConnection(id: string, draft: AdminModelConnectionDraft): Promise<boolean> {
    const result = await runMutation(() => adminApi.updateModelConnection(id, draft), '保存连接失败').catch(() => null);
    if (!result) {
      return false;
    }
    setResources((current) => ({
      ...current,
      connections: upsertById(current.connections, result.connection)
    }));
    showSuccess(`已保存连接 ${result.connection.name}`);
    return true;
  }

  async function handleDeleteConnection(id: string): Promise<boolean> {
    const result = await runMutation(() => adminApi.deleteModelConnection(id), '删除连接失败').catch(() => null);
    if (!result) {
      return false;
    }
    setResources((current) => ({
      ...current,
      connections: current.connections.filter((connection) => connection.id !== id)
    }));
    showSuccess(`已删除连接 ${id}`);
    return true;
  }

  async function handleTestConnection(id: string): Promise<boolean> {
    const result = await runMutation(() => adminApi.testModelConnection(id), '连接测试失败').catch(() => null);
    if (!result) {
      return false;
    }
    if (result.success) {
      showSuccess(`连接 ${id} 测试成功`);
      return true;
    }

    const error = new Error(result.error || '连接测试失败');
    showError(error, '连接测试失败');
    return false;
  }

  async function handleCreateAgent(input: { agent: AdminAgent }): Promise<boolean> {
    const result = await runMutation(() => adminApi.createAgent({ agent: input.agent, applyMode: 'immediate' }), '保存智能体失败').catch(() => null);
    if (!result) {
      return false;
    }
    setResources((current) => ({
      ...current,
      agents: upsertByName(current.agents, result.agent)
    }));
    showSuccess(`已保存智能体 ${result.agent.name}`);
    return true;
  }

  async function handleUpdateAgent(name: string, input: { agent: AdminAgent }): Promise<boolean> {
    const result = await runMutation(() => adminApi.updateAgent(name, { agent: input.agent, applyMode: 'immediate' }), '保存智能体失败').catch(() => null);
    if (!result) {
      return false;
    }
    setResources((current) => ({
      ...current,
      agents: upsertByName(current.agents.filter((item) => item.name !== name), result.agent)
    }));
    showSuccess(`已保存智能体 ${result.agent.name}`);
    return true;
  }

  async function handleDeleteAgent(name: string): Promise<boolean> {
    const result = await runMutation(() => adminApi.deleteAgent(name), '删除智能体失败').catch(() => null);
    if (!result) {
      return false;
    }
    setResources((current) => ({
      ...current,
      agents: current.agents.filter((agent) => agent.name !== name)
    }));
    showSuccess(`已删除智能体 ${name}`);
    return true;
  }

  async function handleApplyPendingAgents(): Promise<boolean> {
    const result = await runMutation(() => adminApi.applyPendingAgents(), '应用待生效配置失败').catch(() => null);
    if (!result) {
      return false;
    }
    setResources((current) => ({
      ...current,
      agents: [...result.agents].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
      pendingAgents: null,
      pendingReason: null,
      pendingUpdatedAt: null
    }));
    showSuccess('已应用待生效智能体配置');
    return true;
  }

  async function handleCreateUser(input: { username: string; password: string }): Promise<boolean> {
    const result = await runMutation(() => adminApi.createUser(input), '创建用户失败').catch(() => null);
    if (!result) {
      return false;
    }
    setResources((current) => ({
      ...current,
      users: [...current.users, {
        username: result.username,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }].sort((left, right) => left.username.localeCompare(right.username, 'zh-CN'))
    }));
    showSuccess(`已创建用户 ${result.username}`);
    return true;
  }

  async function handleChangeUserPassword(username: string, input: { password: string }): Promise<boolean> {
    const result = await runMutation(() => adminApi.updateUserPassword(username, input), '更新密码失败').catch(() => null);
    if (!result) {
      return false;
    }
    setResources((current) => ({
      ...current,
      users: current.users.map((user) => user.username === username
        ? { ...user, updatedAt: Date.now() }
        : user)
    }));
    showSuccess(`已更新 ${username} 的密码`);
    return true;
  }

  async function handleDeleteUser(username: string): Promise<boolean> {
    const result = await runMutation(() => adminApi.deleteUser(username), '删除用户失败').catch(() => null);
    if (!result) {
      return false;
    }
    setResources((current) => ({
      ...current,
      users: current.users.filter((user) => user.username !== username)
    }));
    showSuccess(`已删除用户 ${username}`);
    return true;
  }

  const navigation = (
    <nav aria-label="Admin sections" style={navStyle}>
      <a href="#agents" data-admin-nav="agents" style={navLinkStyle}>智能体</a>
      <a href="#groups" data-admin-nav="groups" style={navLinkStyle}>分组</a>
      <a href="#users" data-admin-nav="users" style={navLinkStyle}>用户</a>
      <a href="#model-connections" data-admin-nav="model-connections" style={navLinkStyle}>模型连接</a>
    </nav>
  );

  const activeNotice = loadState === 'error' && errorMessage
    ? { tone: 'error' as const, message: errorMessage }
    : notice;

  const statusLabel = !canLoad
    ? '等待认证'
    : loadState === 'loading'
      ? '同步中'
      : loadState === 'error'
        ? '最近刷新失败'
        : '已连接';
  const overviewLead = !canLoad
    ? '先通过管理员 Token 进入控制平面，再继续查看各资源区段。'
    : loadState === 'loading' && !hasLoadedData
      ? '正在同步智能体、分组、用户与模型连接。'
      : loadState === 'error' && hasLoadedData
        ? '最近一次刷新失败，但当前控制台仍保留已加载内容。'
        : '统一管理智能体、分组、用户与模型连接，保持与聊天工作台一致的内容优先体验。';
  const overviewMetrics = [
    { label: '状态', value: statusLabel },
    { label: '智能体', value: String(resources.agents.length) },
    { label: '分组', value: String(resources.groups.length) },
    { label: '用户', value: String(resources.users.length) },
    { label: '连接', value: String(resources.connections.length) }
  ];

  let panelContent = null;

  if (!canLoad) {
    panelContent = <AdminTokenGate onSubmit={setAuthToken} busy={loadState === 'loading'} />;
  } else if (loadState === 'loading' && !hasLoadedData) {
    panelContent = <Spinner label="正在加载管理工作台…" />;
  } else if (loadState === 'error' && !hasLoadedData) {
    panelContent = (
      <ErrorState
        title="管理资源加载失败"
        message={errorMessage || '请检查管理员 Token 或服务状态。'}
        action={<Button onClick={() => setReloadNonce((value) => value + 1)}>重试</Button>}
      />
    );
  } else {
    panelContent = (
      <div style={panelStackStyle}>
        <section id="agents" data-admin-section="agents">
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
        <section id="groups" data-admin-section="groups">
          <GroupManagementPanel
            groups={resources.groups}
            agents={resources.agents}
            onCreate={handleCreateGroup}
            onUpdate={handleUpdateGroup}
            onDelete={handleDeleteGroup}
          />
        </section>
        <section id="users" data-admin-section="users">
          <UserManagementPanel
            users={resources.users}
            onCreate={handleCreateUser}
            onChangePassword={handleChangeUserPassword}
            onDelete={handleDeleteUser}
          />
        </section>
        <section id="model-connections" data-admin-section="model-connections">
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
      description="高密度控制台模式，保持与聊天工作区一致的设计语言。"
      navigation={navigation}
      actions={(
        <Button variant="secondary" onClick={() => setReloadNonce((value) => value + 1)}>
          刷新
        </Button>
      )}
    >
      <div data-admin-page="console" data-admin-density="console" style={consoleShellStyle}>
        <section data-admin-region="overview" style={overviewStyle}>
          <div style={overviewHeaderStyle}>
            <div style={overviewCopyStyle}>
              <span style={overviewEyebrowStyle}>Control plane · console mode</span>
              <div style={overviewTitleRowStyle}>
                <h3 style={overviewTitleStyle}>统一配置与访问控制</h3>
                <span style={overviewBadgeStyle}>{statusLabel}</span>
              </div>
              <p style={overviewLeadStyle}>{overviewLead}</p>
            </div>
            <div style={overviewMetaStyle}>
              <span style={overviewMetaItemStyle}>与聊天端统一的设计语言</span>
              <span style={overviewMetaItemStyle}>更高信息密度，但不过度后台化</span>
            </div>
          </div>
          <div style={overviewMetricsStyle}>
            {overviewMetrics.map((metric) => (
              <div key={metric.label} style={metricCardStyle}>
                <span style={metricLabelStyle}>{metric.label}</span>
                <strong style={metricValueStyle}>{metric.value}</strong>
              </div>
            ))}
          </div>
        </section>

        <section data-admin-region="resource-sections" style={resourceSectionsStyle}>
          <div style={resourceHeaderStyle}>
            <div>
              <p style={resourceTitleStyle}>资源区段</p>
              <p style={resourceLeadStyle}>表单、列表与反馈都保持轻量编排，减少传统后台面板的沉重感。</p>
            </div>
            <div style={resourceHintStyle}>按资源分区浏览 · 直接在当前控制台完成编辑</div>
          </div>

          <AdminFeatureNotice notice={activeNotice}>
            {panelContent}
          </AdminFeatureNotice>
        </section>
      </div>
    </ToolPageLayout>
  );
}

const navStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-2)'
} as const;

const navLinkStyle = {
  backgroundColor: 'var(--color-surface)',
  border: '1px solid var(--color-border-muted)',
  borderRadius: '999px',
  color: 'var(--color-text)',
  padding: 'var(--space-2) var(--space-3)',
  textDecoration: 'none'
} as const;

const consoleShellStyle = {
  display: 'grid',
  gap: 'var(--space-4)'
} as const;

const overviewStyle = {
  background: 'linear-gradient(180deg, color-mix(in srgb, var(--color-surface) 95%, var(--color-primary-soft) 5%), var(--color-surface))',
  border: '1px solid var(--color-border-muted)',
  borderRadius: 'calc(var(--radius-xl) + 0.125rem)',
  display: 'grid',
  gap: 'var(--space-4)',
  padding: 'clamp(var(--space-4), 2vw, var(--space-6))'
} as const;

const overviewHeaderStyle = {
  display: 'grid',
  gap: 'var(--space-3)',
  gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)'
} as const;

const overviewCopyStyle = {
  display: 'grid',
  gap: 'var(--space-2)'
} as const;

const overviewEyebrowStyle = {
  color: 'var(--color-text-muted)',
  fontFamily: 'var(--font-family-mono)',
  fontSize: '0.75rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase'
} as const;

const overviewTitleRowStyle = {
  alignItems: 'center',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-2)'
} as const;

const overviewTitleStyle = {
  fontSize: 'clamp(1.35rem, 2vw, 1.85rem)',
  lineHeight: 1.15,
  margin: 0
} as const;

const overviewBadgeStyle = {
  background: 'var(--color-surface-muted)',
  border: '1px solid var(--color-border-muted)',
  borderRadius: '999px',
  color: 'var(--color-text-secondary)',
  fontSize: 'var(--font-size-sm)',
  padding: 'var(--space-1) var(--space-3)'
} as const;

const overviewLeadStyle = {
  color: 'var(--color-text-secondary)',
  margin: 0,
  maxWidth: '46rem'
} as const;

const overviewMetaStyle = {
  alignContent: 'start',
  display: 'grid',
  gap: 'var(--space-2)',
  justifyItems: 'start'
} as const;

const overviewMetaItemStyle = {
  background: 'var(--color-surface-muted)',
  border: '1px solid var(--color-border-muted)',
  borderRadius: '999px',
  color: 'var(--color-text-secondary)',
  fontSize: 'var(--font-size-sm)',
  padding: 'var(--space-2) var(--space-3)'
} as const;

const overviewMetricsStyle = {
  display: 'grid',
  gap: 'var(--space-3)',
  gridTemplateColumns: 'repeat(auto-fit, minmax(7.5rem, 1fr))'
} as const;

const metricCardStyle = {
  background: 'color-mix(in srgb, var(--color-surface-muted) 72%, transparent)',
  border: '1px solid var(--color-border-muted)',
  borderRadius: 'var(--radius-md)',
  display: 'grid',
  gap: 'var(--space-1)',
  padding: 'var(--space-3)'
} as const;

const metricLabelStyle = {
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-sm)'
} as const;

const metricValueStyle = {
  color: 'var(--color-text)',
  fontSize: '1.125rem',
  fontWeight: 'var(--font-weight-semibold)'
} as const;

const resourceSectionsStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border-muted)',
  borderRadius: 'calc(var(--radius-lg) + 0.125rem)',
  display: 'grid',
  gap: 'var(--space-4)',
  padding: 'var(--space-4)'
} as const;

const resourceHeaderStyle = {
  alignItems: 'end',
  borderBottom: '1px solid var(--color-border-muted)',
  display: 'grid',
  gap: 'var(--space-3)',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  paddingBottom: 'var(--space-3)'
} as const;

const resourceTitleStyle = {
  color: 'var(--color-text)',
  fontWeight: 'var(--font-weight-semibold)',
  margin: 0
} as const;

const resourceLeadStyle = {
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-sm)',
  margin: 'var(--space-1) 0 0'
} as const;

const resourceHintStyle = {
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-sm)'
} as const;

const panelStackStyle = {
  display: 'grid',
  gap: 'var(--space-4)'
} as const;
