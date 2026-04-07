import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import {
  isAllowedCredentialedBaseURL,
  isApiConnectionReferenced,
  loadApiConnectionStore,
  normalizeApiConnectionConfig,
  saveApiConnectionStore,
  toApiConnectionSummaries,
  validateApiConnectionConfig,
  validateApiConnectionNameUnique
} from '../../api-connection-store';
import { loadAgentStore } from '../../agent-config-store';
import { ApiConnectionConfig } from '../../types';

export interface ModelConnectionAdminService {
  listConnections(): { connections: ReturnType<typeof toApiConnectionSummaries> };
  createConnection(input: { name?: string; baseURL?: string; baseUrl?: string; apiKey?: string; enabled?: boolean }): { success: true; connection: Record<string, unknown> };
  updateConnection(id: string, input: { id?: string; name?: string; baseURL?: string; baseUrl?: string; apiKey?: string; enabled?: boolean }): { success: true; connection: Record<string, unknown> };
  deleteConnection(id: string): { success: true; id: string };
  testConnection(id: string): Promise<{ success: boolean; statusCode?: number; error?: string; httpStatus: number }>;
}

export class ModelConnectionAdminServiceError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'ModelConnectionAdminServiceError';
    this.statusCode = statusCode;
  }
}

export interface CreateModelConnectionAdminServiceOptions {
  modelConnectionDataFile: string;
  agentDataFile: string;
}

function serializeModelConnection(connection: ApiConnectionConfig, apiKeyMasked: string): Record<string, unknown> {
  return {
    id: connection.id,
    name: connection.name,
    baseURL: connection.baseURL,
    apiKeyMasked,
    enabled: connection.enabled,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt
  };
}

function buildUpstreamErrorSummary(statusCode?: number): string {
  if (!statusCode) {
    return '连接测试失败';
  }

  const reason = http.STATUS_CODES[statusCode];
  return reason
    ? `上游服务返回 ${statusCode} ${reason}`
    : `上游服务返回状态码 ${statusCode}`;
}

function probeModelConnection(baseURL: string, apiKey: string): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  return new Promise(resolve => {
    let endpoint: URL;
    try {
      endpoint = new URL('/models', `${baseURL.replace(/\/+$/, '')}/`);
    } catch {
      resolve({ success: false, error: 'baseURL 必须是合法 URL' });
      return;
    }

    if (!isAllowedCredentialedBaseURL(endpoint.toString())) {
      resolve({
        success: false,
        error: 'baseURL 仅支持 https，若使用 http 则必须为 localhost、127.0.0.1 或 ::1'
      });
      return;
    }

    const transport = endpoint.protocol === 'https:' ? https : http;
    const request = transport.request(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`
      }
    }, response => {
      response.on('data', () => undefined);
      response.on('end', () => {
        const statusCode = response.statusCode || 0;
        if (statusCode >= 200 && statusCode < 300) {
          resolve({ success: true, statusCode });
          return;
        }
        resolve({ success: false, statusCode, error: buildUpstreamErrorSummary(statusCode) });
      });
    });

    request.on('error', error => {
      const summary = error.message.includes('超时') ? '连接测试超时' : '连接测试失败';
      resolve({ success: false, error: summary });
    });
    request.setTimeout(5000, () => {
      request.destroy(new Error('连接测试超时'));
    });
    request.end();
  });
}

export function createModelConnectionAdminService(options: CreateModelConnectionAdminServiceOptions): ModelConnectionAdminService {
  return {
    listConnections() {
      const store = loadApiConnectionStore(options.modelConnectionDataFile);
      return { connections: toApiConnectionSummaries(store.apiConnections) };
    },

    createConnection(input) {
      const store = loadApiConnectionStore(options.modelConnectionDataFile);
      const normalized = normalizeApiConnectionConfig({ ...input, id: undefined });
      const validationError = validateApiConnectionConfig(normalized)
        || validateApiConnectionNameUnique(store, normalized.name);
      if (validationError) {
        throw new ModelConnectionAdminServiceError(400, validationError);
      }

      saveApiConnectionStore(options.modelConnectionDataFile, {
        ...store,
        apiConnections: [...store.apiConnections, normalized],
        updatedAt: Date.now()
      });

      return {
        success: true as const,
        connection: serializeModelConnection(normalized, toApiConnectionSummaries([normalized])[0].apiKeyMasked)
      };
    },

    updateConnection(id, input) {
      const store = loadApiConnectionStore(options.modelConnectionDataFile);
      const current = store.apiConnections.find(connection => connection.id === id);
      if (!current) {
        throw new ModelConnectionAdminServiceError(404, '连接不存在');
      }

      const normalized = normalizeApiConnectionConfig({
        ...current,
        ...input,
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: Date.now()
      });
      const validationError = validateApiConnectionConfig(normalized)
        || validateApiConnectionNameUnique(store, normalized.name, current.id);
      if (validationError) {
        throw new ModelConnectionAdminServiceError(400, validationError);
      }

      saveApiConnectionStore(options.modelConnectionDataFile, {
        ...store,
        apiConnections: store.apiConnections.map(connection => connection.id === current.id ? normalized : connection),
        updatedAt: Date.now()
      });

      return {
        success: true as const,
        connection: serializeModelConnection(normalized, toApiConnectionSummaries([normalized])[0].apiKeyMasked)
      };
    },

    deleteConnection(id) {
      const store = loadApiConnectionStore(options.modelConnectionDataFile);
      const current = store.apiConnections.find(connection => connection.id === id);
      if (!current) {
        throw new ModelConnectionAdminServiceError(404, '连接不存在');
      }

      const agentStore = loadAgentStore(options.agentDataFile);
      const referencedAgents = [...agentStore.activeAgents, ...(agentStore.pendingAgents || [])];
      if (isApiConnectionReferenced(current.id, referencedAgents)) {
        throw new ModelConnectionAdminServiceError(409, '该连接仍被智能体引用，无法删除');
      }

      saveApiConnectionStore(options.modelConnectionDataFile, {
        ...store,
        apiConnections: store.apiConnections.filter(connection => connection.id !== current.id),
        updatedAt: Date.now()
      });

      return { success: true as const, id: current.id };
    },

    async testConnection(id) {
      const store = loadApiConnectionStore(options.modelConnectionDataFile);
      const current = store.apiConnections.find(connection => connection.id === id);
      if (!current) {
        throw new ModelConnectionAdminServiceError(404, '连接不存在');
      }

      const result = await probeModelConnection(current.baseURL, current.apiKey);
      return {
        ...result,
        httpStatus: result.success
          ? 200
          : (result.statusCode && result.statusCode < 500 ? 400 : 502)
      };
    }
  };
}
