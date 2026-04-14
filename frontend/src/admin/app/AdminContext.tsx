import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getMergedRuntimeConfig } from '../../shared/config/runtime-config';
import { createAdminApi } from '../services/admin-api';
import type {
  AdminAgent,
  AdminApi,
  AdminGroup,
  AdminModelConnectionDraft,
  AdminNotice,
  AdminResources,
  AdminUser
} from '../types';

export interface AdminContextProps {
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

interface AdminContextValue {
  authToken: string;
  setAuthToken: (token: string) => void;
  isTokenEditorVisible: boolean;
  openTokenEditor: () => void;
  canLoad: boolean;
  showTokenGate: boolean;
  loadState: LoadState;
  hasLoadedData: boolean;
  errorMessage: string | null;
  resources: AdminResources;
  activeNotice: AdminNotice | null;
  refresh: () => void;
  createGroup: (group: AdminGroup) => Promise<boolean>;
  updateGroup: (id: string, group: Omit<AdminGroup, 'id'>) => Promise<boolean>;
  deleteGroup: (id: string) => Promise<boolean>;
  createConnection: (draft: AdminModelConnectionDraft) => Promise<boolean>;
  updateConnection: (id: string, draft: AdminModelConnectionDraft) => Promise<boolean>;
  deleteConnection: (id: string) => Promise<boolean>;
  testConnection: (id: string) => Promise<boolean>;
  createAgent: (input: { agent: AdminAgent }) => Promise<boolean>;
  updateAgent: (name: string, input: { agent: AdminAgent }) => Promise<boolean>;
  deleteAgent: (name: string) => Promise<boolean>;
  applyPendingAgents: () => Promise<boolean>;
  createUser: (input: { username: string; password: string }) => Promise<boolean>;
  changeUserPassword: (username: string, input: { password: string }) => Promise<boolean>;
  deleteUser: (username: string) => Promise<boolean>;
}

const AdminContext = createContext<AdminContextValue | null>(null);

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

export function AdminContextProvider({ api, initialAuthToken = '', children }: AdminContextProps & { children: ReactNode }) {
  const runtimeConfig = getMergedRuntimeConfig();
  const [authToken, setAuthTokenState] = useState(initialAuthToken);
  const [isTokenEditorVisible, setIsTokenEditorVisible] = useState(false);
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

  function refresh() {
    setReloadNonce((value) => value + 1);
  }

  function showSuccess(message: string) {
    setNotice({ tone: 'success', message });
  }

  function showError(error: unknown, fallback: string) {
    setNotice({ tone: 'error', message: toErrorMessage(error, fallback) });
  }

  function openTokenEditor() {
    setIsTokenEditorVisible(true);
    setNotice(null);
    setErrorMessage(null);
  }

  function setAuthToken(token: string) {
    setIsTokenEditorVisible(false);
    setNotice(null);
    setErrorMessage(null);
    setAuthTokenState(token);
    setReloadNonce((value) => value + 1);
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

  async function createGroup(group: AdminGroup): Promise<boolean> {
    const result = await runMutation(() => {
      const nextGroup = validateGroupMembers(group, resources.agents);
      return adminApi.createGroup(nextGroup);
    }, '保存分组失败').catch(() => null);
    if (!result) {
      return false;
    }
    setResources((current) => ({ ...current, groups: upsertById(current.groups, result.group) }));
    showSuccess(`已保存分组 ${result.group.id}`);
    return true;
  }

  async function updateGroup(id: string, group: Omit<AdminGroup, 'id'>): Promise<boolean> {
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
    setResources((current) => ({ ...current, groups: upsertById(current.groups, result.group) }));
    showSuccess(`已保存分组 ${result.group.id}`);
    return true;
  }

  async function deleteGroup(id: string): Promise<boolean> {
    const result = await runMutation(() => adminApi.deleteGroup(id), '删除分组失败').catch(() => null);
    if (!result) {
      return false;
    }
    setResources((current) => ({ ...current, groups: current.groups.filter((group) => group.id !== id) }));
    showSuccess(`已删除分组 ${id}`);
    return true;
  }

  async function createConnection(draft: AdminModelConnectionDraft): Promise<boolean> {
    const result = await runMutation(() => adminApi.createModelConnection(draft), '保存连接失败').catch(() => null);
    if (!result) {
      return false;
    }
    setResources((current) => ({ ...current, connections: upsertById(current.connections, result.connection) }));
    showSuccess(`已保存连接 ${result.connection.name}`);
    return true;
  }

  async function updateConnection(id: string, draft: AdminModelConnectionDraft): Promise<boolean> {
    const result = await runMutation(() => adminApi.updateModelConnection(id, draft), '保存连接失败').catch(() => null);
    if (!result) {
      return false;
    }
    setResources((current) => ({ ...current, connections: upsertById(current.connections, result.connection) }));
    showSuccess(`已保存连接 ${result.connection.name}`);
    return true;
  }

  async function deleteConnection(id: string): Promise<boolean> {
    const result = await runMutation(() => adminApi.deleteModelConnection(id), '删除连接失败').catch(() => null);
    if (!result) {
      return false;
    }
    setResources((current) => ({ ...current, connections: current.connections.filter((connection) => connection.id !== id) }));
    showSuccess(`已删除连接 ${id}`);
    return true;
  }

  async function testConnection(id: string): Promise<boolean> {
    const result = await runMutation(() => adminApi.testModelConnection(id), '连接测试失败').catch(() => null);
    if (!result) {
      return false;
    }
    if (result.success) {
      showSuccess(`连接 ${id} 测试成功`);
      return true;
    }
    showError(new Error(result.error || '连接测试失败'), '连接测试失败');
    return false;
  }

  async function createAgent(input: { agent: AdminAgent }): Promise<boolean> {
    const result = await runMutation(() => adminApi.createAgent({ agent: input.agent, applyMode: 'immediate' }), '保存智能体失败').catch(() => null);
    if (!result) {
      return false;
    }
    setResources((current) => ({ ...current, agents: upsertByName(current.agents, result.agent) }));
    showSuccess(`已保存智能体 ${result.agent.name}`);
    return true;
  }

  async function updateAgent(name: string, input: { agent: AdminAgent }): Promise<boolean> {
    const result = await runMutation(() => adminApi.updateAgent(name, { agent: input.agent, applyMode: 'immediate' }), '保存智能体失败').catch(() => null);
    if (!result) {
      return false;
    }
    setResources((current) => ({ ...current, agents: upsertByName(current.agents.filter((item) => item.name !== name), result.agent) }));
    showSuccess(`已保存智能体 ${result.agent.name}`);
    return true;
  }

  async function deleteAgent(name: string): Promise<boolean> {
    const result = await runMutation(() => adminApi.deleteAgent(name), '删除智能体失败').catch(() => null);
    if (!result) {
      return false;
    }
    setResources((current) => ({ ...current, agents: current.agents.filter((agent) => agent.name !== name) }));
    showSuccess(`已删除智能体 ${name}`);
    return true;
  }

  async function applyPendingAgents(): Promise<boolean> {
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

  async function createUser(input: { username: string; password: string }): Promise<boolean> {
    const result = await runMutation(() => adminApi.createUser(input), '创建用户失败').catch(() => null);
    if (!result) {
      return false;
    }
    setResources((current) => ({
      ...current,
      users: [...current.users, { username: result.username, createdAt: Date.now(), updatedAt: Date.now() }]
        .sort((left, right) => left.username.localeCompare(right.username, 'zh-CN'))
    }));
    showSuccess(`已创建用户 ${result.username}`);
    return true;
  }

  async function changeUserPassword(username: string, input: { password: string }): Promise<boolean> {
    const result = await runMutation(() => adminApi.updateUserPassword(username, input), '更新密码失败').catch(() => null);
    if (!result) {
      return false;
    }
    setResources((current) => ({
      ...current,
      users: current.users.map((user: AdminUser) => user.username === username ? { ...user, updatedAt: Date.now() } : user)
    }));
    showSuccess(`已更新 ${username} 的密码`);
    return true;
  }

  async function deleteUser(username: string): Promise<boolean> {
    const result = await runMutation(() => adminApi.deleteUser(username), '删除用户失败').catch(() => null);
    if (!result) {
      return false;
    }
    setResources((current) => ({ ...current, users: current.users.filter((user) => user.username !== username) }));
    showSuccess(`已删除用户 ${username}`);
    return true;
  }

  const activeNotice = loadState === 'error' && errorMessage
    ? { tone: 'error' as const, message: errorMessage }
    : notice;
  const showTokenGate = !api && (!canLoad || isTokenEditorVisible);

  const value = useMemo<AdminContextValue>(() => ({
    authToken,
    setAuthToken,
    isTokenEditorVisible,
    openTokenEditor,
    canLoad,
    showTokenGate,
    loadState,
    hasLoadedData,
    errorMessage,
    resources,
    activeNotice,
    refresh,
    createGroup,
    updateGroup,
    deleteGroup,
    createConnection,
    updateConnection,
    deleteConnection,
    testConnection,
    createAgent,
    updateAgent,
    deleteAgent,
    applyPendingAgents,
    createUser,
    changeUserPassword,
    deleteUser
  }), [
    authToken,
    isTokenEditorVisible,
    canLoad,
    showTokenGate,
    loadState,
    hasLoadedData,
    errorMessage,
    resources,
    activeNotice
  ]);

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdminContext(): AdminContextValue {
  const value = useContext(AdminContext);
  if (!value) {
    throw new Error('AdminContext is not available');
  }
  return value;
}
