import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
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
import {
  loadAgentStore
} from '../../agent-config-store';
import {
  loadGroupStore,
  saveGroupStore,
  validateGroupConfig
} from '../../group-store';
import { applyAdminCorsHeaders } from '../../shared/http/cors';
import { sendHttpError } from '../../shared/http/errors';
import { sendJson } from '../../shared/http/json';
import { serveStaticFile } from '../../shared/http/static-files';
import { parseBody } from '../../shared/http/body';
import { AgentAdminService } from '../application/agent-admin-service';
import { UserAdminService } from '../application/user-admin-service';
import { handleAuthAdminRoutes } from '../http/auth-admin-routes';
import { AuthAdminRuntime, normalizeAdminToken } from '../runtime/auth-admin-runtime';

interface GroupPathMatch {
  id: string;
}

interface ModelConnectionPathMatch {
  id: string;
  action: 'base' | 'test';
}

export interface CreateAuthAdminServerDependencies {
  runtime: AuthAdminRuntime;
  userAdminService: UserAdminService;
  agentAdminService: AgentAdminService;
  modelConnectionDataFile: string;
  groupDataFile: string;
}

function requireAdmin(req: http.IncomingMessage, res: http.ServerResponse, adminToken: string): boolean {
  const token = req.headers['x-admin-token'];
  const normalizedToken = typeof token === 'string' ? normalizeAdminToken(token) : '';
  if (!normalizedToken || normalizedToken !== adminToken) {
    sendJson(res, 401, { error: '未授权的管理请求' });
    return false;
  }
  return true;
}

function parseModelConnectionPath(pathname: string): ModelConnectionPathMatch | null {
  const testMatch = pathname.match(/^\/api\/model-connections\/([^/]+)\/test$/);
  if (testMatch) {
    return { id: decodeURIComponent(testMatch[1]), action: 'test' };
  }

  const baseMatch = pathname.match(/^\/api\/model-connections\/([^/]+)$/);
  if (baseMatch) {
    return { id: decodeURIComponent(baseMatch[1]), action: 'base' };
  }

  return null;
}

function parseGroupPath(pathname: string): GroupPathMatch | null {
  const match = pathname.match(/^\/api\/groups\/([a-zA-Z0-9_]+)$/);
  return match ? { id: match[1] } : null;
}

function serializeModelConnection(connection: {
  id: string;
  name: string;
  baseURL: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}, apiKeyMasked: string): Record<string, unknown> {
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

function testModelConnection(baseURL: string, apiKey: string): Promise<{ success: boolean; statusCode?: number; error?: string }> {
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
      let body = '';
      response.on('data', chunk => {
        body += chunk.toString();
      });
      response.on('end', () => {
        const statusCode = response.statusCode || 0;
        if (statusCode >= 200 && statusCode < 300) {
          resolve({ success: true, statusCode });
          return;
        }
        resolve({
          success: false,
          statusCode,
          error: buildUpstreamErrorSummary(statusCode)
        });
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

function listDirectories(targetPath: string): Array<{ name: string; path: string }> {
  const normalizedPath = path.resolve(targetPath || '/');
  if (!path.isAbsolute(normalizedPath)) {
    throw new Error('path 必须是绝对路径');
  }
  if (!fs.existsSync(normalizedPath) || !fs.statSync(normalizedPath).isDirectory()) {
    throw new Error('目录不存在');
  }

  return fs.readdirSync(normalizedPath, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({
      name: entry.name,
      path: path.posix.join(normalizedPath, entry.name).replace(/\\/g, '/')
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, 200);
}

export function createAuthAdminServer(deps: CreateAuthAdminServerDependencies): http.Server {
  return http.createServer(async (req, res) => {
    const method = req.method || 'GET';
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `localhost:${deps.runtime.port}`}`);
    const pathname = requestUrl.pathname;

    applyAdminCorsHeaders(res);

    if (method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      serveStaticFile(res, {
        rootDir: deps.runtime.publicDir,
        filePath: 'admin.html',
        contentType: 'text/html; charset=utf-8',
        onNotFound: response => sendJson(response, 404, { error: 'Not Found' })
      });
      return;
    }

    if (method === 'GET' && pathname === '/healthz') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (await handleAuthAdminRoutes(req, res, requestUrl, {
      adminToken: deps.runtime.adminToken,
      userAdminService: deps.userAdminService,
      agentAdminService: deps.agentAdminService
    })) {
      return;
    }

    if (method === 'GET' && pathname === '/api/groups') {
      if (!requireAdmin(req, res, deps.runtime.adminToken)) {
        return;
      }
      const store = loadGroupStore(deps.groupDataFile);
      sendJson(res, 200, { groups: store.groups, updatedAt: store.updatedAt });
      return;
    }

    if (method === 'POST' && pathname === '/api/groups') {
      if (!requireAdmin(req, res, deps.runtime.adminToken)) {
        return;
      }
      try {
        const body = await parseBody<{ id?: string; name?: string; icon?: string; agentNames?: string[] }>(req);
        if (!body.id || !body.name || !body.icon || !body.agentNames) {
          sendJson(res, 400, { error: '缺少必要字段' });
          return;
        }

        const agentStore = loadAgentStore(deps.runtime.agentDataFile);
        const existingAgentNames = agentStore.activeAgents.map(agent => agent.name);
        const group = { id: body.id, name: body.name, icon: body.icon, agentNames: body.agentNames };
        const validationError = validateGroupConfig(group, existingAgentNames);
        if (validationError) {
          sendJson(res, 400, { error: validationError });
          return;
        }

        const groupStore = loadGroupStore(deps.groupDataFile);
        if (groupStore.groups.some(item => item.id === group.id)) {
          sendJson(res, 409, { error: '分组 ID 已存在' });
          return;
        }

        saveGroupStore(deps.groupDataFile, {
          groups: [...groupStore.groups, group],
          updatedAt: Date.now()
        });
        sendJson(res, 201, { success: true, group });
      } catch (error) {
        sendHttpError(res, error, { fallbackStatus: 400 });
      }
      return;
    }

    const groupPath = parseGroupPath(pathname);
    if (groupPath && method === 'PUT') {
      if (!requireAdmin(req, res, deps.runtime.adminToken)) {
        return;
      }
      try {
        const body = await parseBody<{ name?: string; icon?: string; agentNames?: string[] }>(req);
        const groupStore = loadGroupStore(deps.groupDataFile);
        const index = groupStore.groups.findIndex(group => group.id === groupPath.id);
        if (index === -1) {
          sendJson(res, 404, { error: '分组不存在' });
          return;
        }

        const current = groupStore.groups[index];
        const updated = {
          id: current.id,
          name: body.name ?? current.name,
          icon: body.icon ?? current.icon,
          agentNames: body.agentNames ?? current.agentNames
        };

        const agentStore = loadAgentStore(deps.runtime.agentDataFile);
        const existingAgentNames = agentStore.activeAgents.map(agent => agent.name);
        const validationError = validateGroupConfig(updated, existingAgentNames);
        if (validationError) {
          sendJson(res, 400, { error: validationError });
          return;
        }

        saveGroupStore(deps.groupDataFile, {
          groups: groupStore.groups.map((group, currentIndex) => currentIndex === index ? updated : group),
          updatedAt: Date.now()
        });
        sendJson(res, 200, { success: true, group: updated });
      } catch (error) {
        sendHttpError(res, error, { fallbackStatus: 400 });
      }
      return;
    }

    if (groupPath && method === 'DELETE') {
      if (!requireAdmin(req, res, deps.runtime.adminToken)) {
        return;
      }
      const groupStore = loadGroupStore(deps.groupDataFile);
      const index = groupStore.groups.findIndex(group => group.id === groupPath.id);
      if (index === -1) {
        sendJson(res, 404, { error: '分组不存在' });
        return;
      }

      const deleted = groupStore.groups[index];
      saveGroupStore(deps.groupDataFile, {
        groups: groupStore.groups.filter((_, currentIndex) => currentIndex !== index),
        updatedAt: Date.now()
      });
      sendJson(res, 200, { success: true, id: deleted.id });
      return;
    }

    if (method === 'GET' && pathname === '/api/model-connections') {
      if (!requireAdmin(req, res, deps.runtime.adminToken)) {
        return;
      }
      const store = loadApiConnectionStore(deps.modelConnectionDataFile);
      sendJson(res, 200, { connections: toApiConnectionSummaries(store.apiConnections) });
      return;
    }

    if (method === 'POST' && pathname === '/api/model-connections') {
      if (!requireAdmin(req, res, deps.runtime.adminToken)) {
        return;
      }
      try {
        const body = await parseBody<{
          name?: string;
          baseURL?: string;
          baseUrl?: string;
          apiKey?: string;
          enabled?: boolean;
        }>(req);
        const store = loadApiConnectionStore(deps.modelConnectionDataFile);
        const normalized = normalizeApiConnectionConfig({
          ...body,
          id: undefined
        });
        const validationError = validateApiConnectionConfig(normalized)
          || validateApiConnectionNameUnique(store, normalized.name);
        if (validationError) {
          sendJson(res, 400, { error: validationError });
          return;
        }

        saveApiConnectionStore(deps.modelConnectionDataFile, {
          ...store,
          apiConnections: [...store.apiConnections, normalized],
          updatedAt: Date.now()
        });
        sendJson(res, 201, {
          success: true,
          connection: serializeModelConnection(normalized, toApiConnectionSummaries([normalized])[0].apiKeyMasked)
        });
      } catch (error) {
        sendHttpError(res, error, { fallbackStatus: 400 });
      }
      return;
    }

    const modelConnectionPath = parseModelConnectionPath(pathname);
    if (modelConnectionPath && method === 'PUT' && modelConnectionPath.action === 'base') {
      if (!requireAdmin(req, res, deps.runtime.adminToken)) {
        return;
      }
      try {
        const body = await parseBody<{
          id?: string;
          name?: string;
          baseURL?: string;
          baseUrl?: string;
          apiKey?: string;
          enabled?: boolean;
        }>(req);
        const store = loadApiConnectionStore(deps.modelConnectionDataFile);
        const current = store.apiConnections.find(connection => connection.id === modelConnectionPath.id);
        if (!current) {
          sendJson(res, 404, { error: '连接不存在' });
          return;
        }

        const normalized = normalizeApiConnectionConfig({
          ...current,
          ...body,
          id: current.id,
          createdAt: current.createdAt,
          updatedAt: Date.now()
        });
        const validationError = validateApiConnectionConfig(normalized)
          || validateApiConnectionNameUnique(store, normalized.name, current.id);
        if (validationError) {
          sendJson(res, 400, { error: validationError });
          return;
        }

        saveApiConnectionStore(deps.modelConnectionDataFile, {
          ...store,
          apiConnections: store.apiConnections.map(connection => (
            connection.id === current.id ? normalized : connection
          )),
          updatedAt: Date.now()
        });
        sendJson(res, 200, {
          success: true,
          connection: serializeModelConnection(normalized, toApiConnectionSummaries([normalized])[0].apiKeyMasked)
        });
      } catch (error) {
        sendHttpError(res, error, { fallbackStatus: 400 });
      }
      return;
    }

    if (modelConnectionPath && method === 'DELETE' && modelConnectionPath.action === 'base') {
      if (!requireAdmin(req, res, deps.runtime.adminToken)) {
        return;
      }
      const store = loadApiConnectionStore(deps.modelConnectionDataFile);
      const current = store.apiConnections.find(connection => connection.id === modelConnectionPath.id);
      if (!current) {
        sendJson(res, 404, { error: '连接不存在' });
        return;
      }

      const agentStore = loadAgentStore(deps.runtime.agentDataFile);
      const referencedAgents = [
        ...agentStore.activeAgents,
        ...(agentStore.pendingAgents || [])
      ];
      if (isApiConnectionReferenced(current.id, referencedAgents)) {
        sendJson(res, 409, { error: '该连接仍被智能体引用，无法删除' });
        return;
      }

      saveApiConnectionStore(deps.modelConnectionDataFile, {
        ...store,
        apiConnections: store.apiConnections.filter(connection => connection.id !== current.id),
        updatedAt: Date.now()
      });
      sendJson(res, 200, { success: true, id: current.id });
      return;
    }

    if (modelConnectionPath && method === 'POST' && modelConnectionPath.action === 'test') {
      if (!requireAdmin(req, res, deps.runtime.adminToken)) {
        return;
      }
      const store = loadApiConnectionStore(deps.modelConnectionDataFile);
      const current = store.apiConnections.find(connection => connection.id === modelConnectionPath.id);
      if (!current) {
        sendJson(res, 404, { error: '连接不存在' });
        return;
      }

      const result = await testModelConnection(current.baseURL, current.apiKey);
      if (result.success) {
        sendJson(res, 200, {
          success: true,
          statusCode: result.statusCode
        });
        return;
      }

      sendJson(res, result.statusCode && result.statusCode < 500 ? 400 : 502, {
        success: false,
        statusCode: result.statusCode,
        error: result.error || '连接测试失败'
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/system/dirs') {
      if (!requireAdmin(req, res, deps.runtime.adminToken)) {
        return;
      }
      try {
        const targetPath = (requestUrl.searchParams.get('path') || '/').trim() || '/';
        sendJson(res, 200, {
          path: path.resolve(targetPath),
          directories: listDirectories(targetPath)
        });
      } catch (error) {
        sendJson(res, 400, { error: (error as Error).message });
      }
      return;
    }

    if (pathname.startsWith('/api/groups') || pathname.startsWith('/api/model-connections')) {
      if (!requireAdmin(req, res, deps.runtime.adminToken)) {
        return;
      }
    }

    sendJson(res, 404, { error: 'Not Found' });
  });
}
