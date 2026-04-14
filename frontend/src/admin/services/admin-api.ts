import { createHttpClient } from '../../shared/lib/http/http-client';
import type {
  AdminApi,
  AdminAgent,
  AdminAgentListResponse,
  AdminGroup,
  AdminGroupListResponse,
  AdminModelConnectionDraft,
  AdminModelConnectionListResponse,
  AdminModelConnectionTestResult,
  AdminUser,
  ApplyMode
} from '../types';

export interface AdminApiOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  getAdminToken?: () => string | undefined;
}

function getAdminHeaders(getAdminToken?: () => string | undefined): Record<string, string> {
  const token = getAdminToken?.()?.trim();
  return token ? { 'x-admin-token': token } : {};
}

function createAdminRequest(options: AdminApiOptions) {
  const client = createHttpClient({
    baseUrl: options.baseUrl,
    fetch: options.fetch
  });

  return function request<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
    return client.request<T>(path, {
      method: init.method,
      json: init.json,
      credentials: 'include',
      cache: 'no-store',
      headers: getAdminHeaders(options.getAdminToken)
    });
  };
}

export function createAdminApi(options: AdminApiOptions = {}): AdminApi {
  const request = createAdminRequest(options);

  return {
    listUsers(): Promise<{ users: AdminUser[] }> {
      return request('/api/users');
    },
    createUser(input): Promise<{ success: true; username: string }> {
      return request('/api/users', { method: 'POST', json: input });
    },
    updateUserPassword(username, input): Promise<{ success: true; username: string }> {
      return request(`/api/users/${encodeURIComponent(username)}/password`, {
        method: 'PUT',
        json: input
      });
    },
    deleteUser(username): Promise<{ success: true; username: string }> {
      return request(`/api/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
    },
    listAgents(): Promise<AdminAgentListResponse> {
      return request('/api/agents');
    },
    createAgent(input: { agent: AdminAgent; applyMode?: ApplyMode }) {
      return request('/api/agents', { method: 'POST', json: input });
    },
    updateAgent(name: string, input: { agent: AdminAgent; applyMode?: ApplyMode }) {
      return request(`/api/agents/${encodeURIComponent(name)}`, { method: 'PUT', json: input });
    },
    deleteAgent(name: string, applyMode: ApplyMode = 'immediate') {
      return request(`/api/agents/${encodeURIComponent(name)}?applyMode=${encodeURIComponent(applyMode)}`, {
        method: 'DELETE'
      });
    },
    applyPendingAgents() {
      return request('/api/agents/apply-pending', { method: 'POST' });
    },
    getAgentPromptTemplate(name: string) {
      return request(`/api/agents/${encodeURIComponent(name)}/prompt/template`);
    },
    restoreAgentPromptTemplate(name: string) {
      return request(`/api/agents/${encodeURIComponent(name)}/prompt/restore-template`, {
        method: 'POST',
        json: { applyMode: 'immediate' }
      });
    },
    listGroups(): Promise<AdminGroupListResponse> {
      return request('/api/groups');
    },
    createGroup(input: AdminGroup) {
      return request('/api/groups', { method: 'POST', json: input });
    },
    updateGroup(id: string, input: Omit<AdminGroup, 'id'>) {
      return request(`/api/groups/${encodeURIComponent(id)}`, { method: 'PUT', json: input });
    },
    deleteGroup(id: string) {
      return request(`/api/groups/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    listModelConnections(): Promise<AdminModelConnectionListResponse> {
      return request('/api/model-connections');
    },
    createModelConnection(input: AdminModelConnectionDraft) {
      return request('/api/model-connections', { method: 'POST', json: input });
    },
    updateModelConnection(id: string, input: AdminModelConnectionDraft) {
      return request(`/api/model-connections/${encodeURIComponent(id)}`, { method: 'PUT', json: input });
    },
    deleteModelConnection(id: string) {
      return request(`/api/model-connections/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    testModelConnection(id: string): Promise<AdminModelConnectionTestResult> {
      return request(`/api/model-connections/${encodeURIComponent(id)}/test`, { method: 'POST' });
    }
  };
}
