/**
 * auth-admin-server.ts
 *
 * 独立鉴权管理服务：负责用户密码管理与认证校验
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import { URL } from 'url';
import { AIAgentConfig } from './types';
import {
  isAllowedCredentialedBaseURL,
  isApiConnectionReferenced,
  loadApiConnectionStore,
  normalizeApiConnectionConfig,
  saveApiConnectionStore,
  toApiConnectionSummaries,
  validateApiConnectionConfig,
  validateApiConnectionNameUnique
} from './api-connection-store';
import {
  ApplyMode,
  applyPendingAgents,
  loadAgentStore,
  normalizeAgentConfig,
  saveAgentStore,
  updateAgentStore,
  validateAgentConfig
} from './agent-config-store';
import { buildProfessionalAgentPrompt, isProfessionalAgentName } from './professional-agent-prompts';
import {
  loadGroupStore,
  removeAgentFromAllGroups,
  saveGroupStore,
  validateGroupConfig
} from './group-store';

type UserRecord = {
  username: string;
  passwordHash: string;
  salt: string;
  createdAt: number;
  updatedAt: number;
};

type UserStore = {
  users: UserRecord[];
};

const PORT = Number(process.env.AUTH_ADMIN_PORT || 3003);
function normalizeAdminToken(rawToken?: string): string {
  const trimmed = (rawToken || '').trim();
  if (!trimmed) return '';

  const isWrappedByQuote =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));

  return isWrappedByQuote ? trimmed.slice(1, -1).trim() : trimmed;
}

const ADMIN_TOKEN = normalizeAdminToken(process.env.AUTH_ADMIN_TOKEN) || 'change-me-in-production';
const DATA_FILE = process.env.AUTH_DATA_FILE || path.join(process.cwd(), 'data', 'users.json');
const DEFAULT_USER = process.env.BOT_ROOM_DEFAULT_USER || 'admin';
const DEFAULT_PASSWORD = process.env.BOT_ROOM_DEFAULT_PASSWORD || 'admin123!';
const AGENT_DATA_FILE = process.env.AGENT_DATA_FILE || path.join(process.cwd(), 'data', 'agents.json');
const MODEL_CONNECTION_DATA_FILE = process.env.MODEL_CONNECTION_DATA_FILE
  || path.join(path.dirname(AGENT_DATA_FILE), 'api-connections.json');
const GROUP_DATA_FILE = process.env.GROUP_DATA_FILE
  || path.join(path.dirname(AGENT_DATA_FILE), 'groups.json');

// ============================================
// 修复 1: 生产环境安全检查
// ============================================
function performSecurityChecks(): void {
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    // 检查 ADMIN_TOKEN
    if (!ADMIN_TOKEN || ADMIN_TOKEN === 'change-me-in-production') {
      console.error('❌ 生产环境必须设置 AUTH_ADMIN_TOKEN 环境变量');
      process.exit(1);
    }
    if (ADMIN_TOKEN.length < 32) {
      console.error('❌ AUTH_ADMIN_TOKEN 长度不能少于 32 字符');
      process.exit(1);
    }

    // 检查默认密码
    if (DEFAULT_PASSWORD.length < 12) {
      console.error('❌ 生产环境 BOT_ROOM_DEFAULT_PASSWORD 长度不能少于 12 字符');
      process.exit(1);
    }
    const hasLower = /[a-z]/.test(DEFAULT_PASSWORD);
    const hasUpper = /[A-Z]/.test(DEFAULT_PASSWORD);
    const hasNumber = /[0-9]/.test(DEFAULT_PASSWORD);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(DEFAULT_PASSWORD);
    if (!(hasLower && hasUpper && hasNumber && hasSpecial)) {
      console.error('❌ 生产环境 BOT_ROOM_DEFAULT_PASSWORD 必须包含大小写字母、数字和特殊字符');
      process.exit(1);
    }
  } else {
    // 开发环境警告
    const warnings: string[] = [];
    if (!ADMIN_TOKEN || ADMIN_TOKEN === 'change-me-in-production') {
      warnings.push('⚠️ AUTH_ADMIN_TOKEN 未设置或使用默认值');
    }
    if (DEFAULT_PASSWORD.length < 12) {
      warnings.push('⚠️ BOT_ROOM_DEFAULT_PASSWORD 长度不足');
    }
    if (warnings.length > 0) {
      console.log('\n' + '='.repeat(60));
      console.log('🔒 安全检查警告（开发环境）');
      console.log('='.repeat(60));
      warnings.forEach(w => console.log(w));
      console.log('='.repeat(60) + '\n');
    }
  }
}

// 启动时执行安全检查
performSecurityChecks();

function parseBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
}

function createUser(username: string, password: string): UserRecord {
  const salt = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  return {
    username,
    salt,
    passwordHash: hashPassword(password, salt),
    createdAt: now,
    updatedAt: now
  };
}

function ensureDataDirExists(filePath: string): void {
  const dirPath = path.dirname(filePath);
  fs.mkdirSync(dirPath, { recursive: true });
}

function loadStore(): UserStore {
  ensureDataDirExists(DATA_FILE);

  if (!fs.existsSync(DATA_FILE)) {
    const initial: UserStore = { users: [createUser(DEFAULT_USER, DEFAULT_PASSWORD)] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    console.log(`[AuthAdmin] 初始化用户完成，默认账号: ${DEFAULT_USER}`);
    return initial;
  }

  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  const parsed = raw ? JSON.parse(raw) as UserStore : { users: [] };

  if (!Array.isArray(parsed.users)) {
    throw new Error('Invalid users.json structure');
  }

  return parsed;
}

function saveStore(store: UserStore): void {
  ensureDataDirExists(DATA_FILE);
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function requireAdmin(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const token = req.headers['x-admin-token'];
  const normalizedToken = typeof token === 'string' ? normalizeAdminToken(token) : '';
  if (!normalizedToken || normalizedToken !== ADMIN_TOKEN) {
    sendJson(res, 401, { error: '未授权的管理请求' });
    return false;
  }
  return true;
}

function sanitizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function validateCredInput(username: string, password: string): string | null {
  if (!username || username.length < 3 || username.length > 32) {
    return '用户名长度需在 3-32 字符之间';
  }

  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return '用户名仅支持字母、数字、_.-';
  }

  if (!password || password.length < 8) {
    return '密码长度不能少于 8 位';
  }

  return null;
}


function parseApplyMode(input?: string | null): ApplyMode {
  return input === 'after_chat' ? 'after_chat' : 'immediate';
}

function parseAgentPath(pathname: string): { name: string; action: 'base' | 'prompt' | 'restore-template' | 'template' } | null {
  const templateMatch = pathname.match(/^\/api\/agents\/([^/]+)\/prompt\/template$/);
  if (templateMatch) {
    return { name: decodeURIComponent(templateMatch[1]), action: 'template' };
  }

  const restoreMatch = pathname.match(/^\/api\/agents\/([^/]+)\/prompt\/restore-template$/);
  if (restoreMatch) {
    return { name: decodeURIComponent(restoreMatch[1]), action: 'restore-template' };
  }

  const promptMatch = pathname.match(/^\/api\/agents\/([^/]+)\/prompt$/);
  if (promptMatch) {
    return { name: decodeURIComponent(promptMatch[1]), action: 'prompt' };
  }

  const baseMatch = pathname.match(/^\/api\/agents\/([^/]+)$/);
  if (baseMatch) {
    return { name: decodeURIComponent(baseMatch[1]), action: 'base' };
  }

  return null;
}

function parseModelConnectionPath(pathname: string): { id: string; action: 'base' | 'test' } | null {
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

function parseGroupPath(pathname: string): { id: string } | null {
  const match = pathname.match(/^\/api\/groups\/([a-zA-Z0-9_]+)$/);
  if (match) {
    return { id: match[1] };
  }
  return null;
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

function validateAgentConnectionReference(agent: AIAgentConfig): string | null {
  if (agent.executionMode !== 'api' || !agent.apiConnectionId) {
    return null;
  }

  const connectionStore = loadApiConnectionStore(MODEL_CONNECTION_DATA_FILE);
  const connection = connectionStore.apiConnections.find(item => item.id === agent.apiConnectionId);
  if (!connection) {
    return 'apiConnectionId 对应的连接不存在';
  }
  if (!connection.enabled) {
    return 'apiConnectionId 对应的连接已停用';
  }
  return null;
}

function serveStatic(res: http.ServerResponse, filePath: string, contentType: string): void {
  const fullPath = path.join(__dirname, '..', 'public-auth', filePath);

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: 'Not Found' });
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
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

  const entries = fs.readdirSync(normalizedPath, { withFileTypes: true });
  const directories = entries
    .filter(entry => entry.isDirectory())
    .map(entry => ({
      name: entry.name,
      path: path.posix.join(normalizedPath, entry.name).replace(/\\/g, '/')
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, 200);

  return directories;
}

const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || `localhost:${PORT}`}`);
  const pathname = parsedUrl.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');

  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Serve admin page
  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    serveStatic(res, 'admin.html', 'text/html; charset=utf-8');
    return;
  }

  if (method === 'GET' && pathname === '/healthz') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'POST' && pathname === '/api/auth/verify') {
    try {
      const body = await parseBody<{ username?: string; password?: string }>(req);
      const username = sanitizeUsername(body.username || '');
      const password = body.password || '';
      const store = loadStore();
      const user = store.users.find(entry => entry.username === username);

      if (!user) {
        sendJson(res, 401, { success: false, error: '用户名或密码错误' });
        return;
      }

      const hashed = hashPassword(password, user.salt);
      if (hashed !== user.passwordHash) {
        sendJson(res, 401, { success: false, error: '用户名或密码错误' });
        return;
      }

      sendJson(res, 200, { success: true, username: user.username });
    } catch (error: unknown) {
      const err = error as Error;
      sendJson(res, 400, { success: false, error: err.message });
    }
    return;
  }

  // ============================================
  // 分组管理 API
  // ============================================

  if (method === 'GET' && pathname === '/api/groups') {
    if (!requireAdmin(req, res)) return;
    const store = loadGroupStore(GROUP_DATA_FILE);
    sendJson(res, 200, { groups: store.groups, updatedAt: store.updatedAt });
    return;
  }

  if (method === 'POST' && pathname === '/api/groups') {
    if (!requireAdmin(req, res)) return;
    try {
      const body = await parseBody<{ id?: string; name?: string; icon?: string; agentNames?: string[] }>(req);
      if (!body.id || !body.name || !body.icon || !body.agentNames) {
        sendJson(res, 400, { error: '缺少必要字段' });
        return;
      }

      const agentStore = loadAgentStore(AGENT_DATA_FILE);
      const existingAgentNames = agentStore.activeAgents.map(a => a.name);
      const group = { id: body.id, name: body.name, icon: body.icon, agentNames: body.agentNames };
      const validationError = validateGroupConfig(group, existingAgentNames);
      if (validationError) {
        sendJson(res, 400, { error: validationError });
        return;
      }

      const groupStore = loadGroupStore(GROUP_DATA_FILE);
      if (groupStore.groups.some(g => g.id === group.id)) {
        sendJson(res, 409, { error: '分组 ID 已存在' });
        return;
      }

      const nextStore = {
        groups: [...groupStore.groups, group],
        updatedAt: Date.now()
      };
      saveGroupStore(GROUP_DATA_FILE, nextStore);
      sendJson(res, 201, { success: true, group });
    } catch (error: unknown) {
      const err = error as Error;
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  const groupPath = parseGroupPath(pathname);
  if (groupPath && method === 'PUT') {
    if (!requireAdmin(req, res)) return;
    try {
      const body = await parseBody<{ name?: string; icon?: string; agentNames?: string[] }>(req);
      const groupStore = loadGroupStore(GROUP_DATA_FILE);
      const index = groupStore.groups.findIndex(g => g.id === groupPath.id);
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

      const agentStore = loadAgentStore(AGENT_DATA_FILE);
      const existingAgentNames = agentStore.activeAgents.map(a => a.name);
      const validationError = validateGroupConfig(updated, existingAgentNames);
      if (validationError) {
        sendJson(res, 400, { error: validationError });
        return;
      }

      const nextStore = {
        groups: groupStore.groups.map((g, i) => i === index ? updated : g),
        updatedAt: Date.now()
      };
      saveGroupStore(GROUP_DATA_FILE, nextStore);
      sendJson(res, 200, { success: true, group: updated });
    } catch (error: unknown) {
      const err = error as Error;
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  if (groupPath && method === 'DELETE') {
    if (!requireAdmin(req, res)) return;
    const groupStore = loadGroupStore(GROUP_DATA_FILE);
    const index = groupStore.groups.findIndex(g => g.id === groupPath.id);
    if (index === -1) {
      sendJson(res, 404, { error: '分组不存在' });
      return;
    }

    const deleted = groupStore.groups[index];
    const nextStore = {
      groups: groupStore.groups.filter((_, i) => i !== index),
      updatedAt: Date.now()
    };
    saveGroupStore(GROUP_DATA_FILE, nextStore);
    sendJson(res, 200, { success: true, id: deleted.id });
    return;
  }

  if (!pathname.startsWith('/api/users')
    && !pathname.startsWith('/api/agents')
    && !pathname.startsWith('/api/model-connections')
    && !pathname.startsWith('/api/groups')) {
    if (method === 'GET' && pathname === '/api/system/dirs') {
      if (!requireAdmin(req, res)) return;
      try {
        const targetPath = (parsedUrl.searchParams.get('path') || '/').trim() || '/';
        const directories = listDirectories(targetPath);
        sendJson(res, 200, { path: path.resolve(targetPath), directories });
      } catch (error: unknown) {
        const err = error as Error;
        sendJson(res, 400, { error: err.message });
      }
      return;
    }
    sendJson(res, 404, { error: 'Not Found' });
    return;
  }

  if (!requireAdmin(req, res)) {
    return;
  }

  if (method === 'GET' && pathname === '/api/agents') {
    const store = loadAgentStore(AGENT_DATA_FILE);
    sendJson(res, 200, {
      agents: store.activeAgents,
      pendingAgents: store.pendingAgents,
      pendingReason: store.pendingReason,
      pendingUpdatedAt: store.pendingUpdatedAt
    });
    return;
  }

  if (method === 'POST' && pathname === '/api/agents') {
    try {
      const body = await parseBody<{ agent?: AIAgentConfig; applyMode?: ApplyMode }>(req);
      if (!body.agent) {
        sendJson(res, 400, { error: '缺少 agent 配置' });
        return;
      }
      const applyMode = parseApplyMode(body.applyMode);
      const normalized = normalizeAgentConfig(body.agent);
      const validationError = validateAgentConfig(normalized);
      if (validationError) {
        sendJson(res, 400, { error: validationError });
        return;
      }
      const connectionError = validateAgentConnectionReference(normalized);
      if (connectionError) {
        sendJson(res, 400, { error: connectionError });
        return;
      }

      const store = loadAgentStore(AGENT_DATA_FILE);
      const next = updateAgentStore(store, applyMode, agents => {
        if (agents.some(agent => agent.name === normalized.name)) {
          throw new Error('智能体名称已存在');
        }
        return [...agents, normalized];
      });
      saveAgentStore(AGENT_DATA_FILE, next);
      sendJson(res, 201, { success: true, applyMode, agent: normalized });
    } catch (error: unknown) {
      const err = error as Error;
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  if (method === 'POST' && pathname === '/api/agents/apply-pending') {
    const store = loadAgentStore(AGENT_DATA_FILE);
    const next = applyPendingAgents(store);
    saveAgentStore(AGENT_DATA_FILE, next);
    sendJson(res, 200, { success: true, agents: next.activeAgents });
    return;
  }

  if (method === 'GET' && pathname === '/api/model-connections') {
    const store = loadApiConnectionStore(MODEL_CONNECTION_DATA_FILE);
    sendJson(res, 200, {
      connections: toApiConnectionSummaries(store.apiConnections)
    });
    return;
  }

  if (method === 'POST' && pathname === '/api/model-connections') {
    try {
      const body = await parseBody<{
        name?: string;
        baseURL?: string;
        baseUrl?: string;
        apiKey?: string;
        enabled?: boolean;
      }>(req);
      const store = loadApiConnectionStore(MODEL_CONNECTION_DATA_FILE);
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

      const next = {
        ...store,
        apiConnections: [...store.apiConnections, normalized],
        updatedAt: Date.now()
      };
      saveApiConnectionStore(MODEL_CONNECTION_DATA_FILE, next);
      sendJson(res, 201, {
        success: true,
        connection: serializeModelConnection(normalized, toApiConnectionSummaries([normalized])[0].apiKeyMasked)
      });
    } catch (error: unknown) {
      const err = error as Error;
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  const modelConnectionPath = parseModelConnectionPath(pathname);
  if (modelConnectionPath && method === 'PUT' && modelConnectionPath.action === 'base') {
    try {
      const body = await parseBody<{
        id?: string;
        name?: string;
        baseURL?: string;
        baseUrl?: string;
        apiKey?: string;
        enabled?: boolean;
      }>(req);
      const store = loadApiConnectionStore(MODEL_CONNECTION_DATA_FILE);
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

      const next = {
        ...store,
        apiConnections: store.apiConnections.map(connection => (
          connection.id === current.id ? normalized : connection
        )),
        updatedAt: Date.now()
      };
      saveApiConnectionStore(MODEL_CONNECTION_DATA_FILE, next);
      sendJson(res, 200, {
        success: true,
        connection: serializeModelConnection(normalized, toApiConnectionSummaries([normalized])[0].apiKeyMasked)
      });
    } catch (error: unknown) {
      const err = error as Error;
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  if (modelConnectionPath && method === 'DELETE' && modelConnectionPath.action === 'base') {
    const store = loadApiConnectionStore(MODEL_CONNECTION_DATA_FILE);
    const current = store.apiConnections.find(connection => connection.id === modelConnectionPath.id);
    if (!current) {
      sendJson(res, 404, { error: '连接不存在' });
      return;
    }

    const agentStore = loadAgentStore(AGENT_DATA_FILE);
    const referencedAgents = [
      ...agentStore.activeAgents,
      ...(agentStore.pendingAgents || [])
    ];
    if (isApiConnectionReferenced(current.id, referencedAgents)) {
      sendJson(res, 409, { error: '该连接仍被智能体引用，无法删除' });
      return;
    }

    const next = {
      ...store,
      apiConnections: store.apiConnections.filter(connection => connection.id !== current.id),
      updatedAt: Date.now()
    };
    saveApiConnectionStore(MODEL_CONNECTION_DATA_FILE, next);
    sendJson(res, 200, { success: true, id: current.id });
    return;
  }

  if (modelConnectionPath && method === 'POST' && modelConnectionPath.action === 'test') {
    const store = loadApiConnectionStore(MODEL_CONNECTION_DATA_FILE);
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

  const agentPath = parseAgentPath(pathname);
  if (agentPath && method === 'PUT' && agentPath.action === 'base') {
    try {
      const targetName = agentPath.name;
      const body = await parseBody<{ agent?: AIAgentConfig; applyMode?: ApplyMode }>(req);
      if (!body.agent) {
        sendJson(res, 400, { error: '缺少 agent 配置' });
        return;
      }
      const applyMode = parseApplyMode(body.applyMode);
      const normalized = normalizeAgentConfig(body.agent);
      const validationError = validateAgentConfig(normalized);
      if (validationError) {
        sendJson(res, 400, { error: validationError });
        return;
      }
      const connectionError = validateAgentConnectionReference(normalized);
      if (connectionError) {
        sendJson(res, 400, { error: connectionError });
        return;
      }

      const store = loadAgentStore(AGENT_DATA_FILE);
      const next = updateAgentStore(store, applyMode, agents => {
        const index = agents.findIndex(agent => agent.name === targetName);
        if (index === -1) {
          throw new Error('智能体不存在');
        }
        if (normalized.name !== targetName && agents.some(agent => agent.name === normalized.name)) {
          throw new Error('新的智能体名称已存在');
        }
        const cloned = [...agents];
        cloned[index] = { ...agents[index], ...normalized };
        return cloned;
      });
      saveAgentStore(AGENT_DATA_FILE, next);
      sendJson(res, 200, { success: true, applyMode, agent: normalized });
    } catch (error: unknown) {
      const err = error as Error;
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  if (agentPath && method === 'PUT' && agentPath.action === 'prompt') {
    try {
      const targetName = agentPath.name;
      const body = await parseBody<{ systemPrompt?: string; personality?: string; applyMode?: ApplyMode }>(req);
      const applyMode = parseApplyMode(body.applyMode);
      const nextPrompt = (body.systemPrompt || '').trim();
      const nextPersonality = (body.personality || '').trim();

      if (!nextPrompt && !nextPersonality) {
        sendJson(res, 400, { error: '至少提供 systemPrompt 或 personality' });
        return;
      }

      const store = loadAgentStore(AGENT_DATA_FILE);
      const next = updateAgentStore(store, applyMode, agents => {
        const index = agents.findIndex(agent => agent.name === targetName);
        if (index === -1) {
          throw new Error('智能体不存在');
        }
        const current = agents[index];
        const updated: AIAgentConfig = {
          ...current,
          personality: nextPersonality || current.personality,
          systemPrompt: nextPrompt || current.systemPrompt
        };
        const validationError = validateAgentConfig(updated);
        if (validationError) {
          throw new Error(validationError);
        }
        const cloned = [...agents];
        cloned[index] = updated;
        return cloned;
      });
      saveAgentStore(AGENT_DATA_FILE, next);
      sendJson(res, 200, { success: true, applyMode });
    } catch (error: unknown) {
      const err = error as Error;
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  if (agentPath && method === 'POST' && agentPath.action === 'restore-template') {
    try {
      const targetName = agentPath.name;
      if (!isProfessionalAgentName(targetName)) {
        sendJson(res, 400, { error: '该智能体暂无可恢复的共享模板提示词' });
        return;
      }

      const body = await parseBody<{ applyMode?: ApplyMode }>(req);
      const applyMode = parseApplyMode(body.applyMode);
      const restoredPrompt = buildProfessionalAgentPrompt(targetName);

      const store = loadAgentStore(AGENT_DATA_FILE);
      const next = updateAgentStore(store, applyMode, agents => {
        const index = agents.findIndex(agent => agent.name === targetName);
        if (index === -1) {
          throw new Error('智能体不存在');
        }
        const current = agents[index];
        const updated: AIAgentConfig = {
          ...current,
          systemPrompt: restoredPrompt
        };
        const validationError = validateAgentConfig(updated);
        if (validationError) {
          throw new Error(validationError);
        }
        const cloned = [...agents];
        cloned[index] = updated;
        return cloned;
      });
      saveAgentStore(AGENT_DATA_FILE, next);
      sendJson(res, 200, { success: true, applyMode, systemPrompt: restoredPrompt });
    } catch (error: unknown) {
      const err = error as Error;
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  if (agentPath && method === 'GET' && agentPath.action === 'template') {
    try {
      const targetName = agentPath.name;
      if (!isProfessionalAgentName(targetName)) {
        sendJson(res, 400, { error: '该智能体暂无可预览的共享模板提示词' });
        return;
      }

      const store = loadAgentStore(AGENT_DATA_FILE);
      const current = store.activeAgents.find(agent => agent.name === targetName);
      if (!current) {
        sendJson(res, 404, { error: '智能体不存在' });
        return;
      }

      const templatePrompt = buildProfessionalAgentPrompt(targetName);
      sendJson(res, 200, {
        success: true,
        currentPrompt: current.systemPrompt || '',
        templatePrompt
      });
    } catch (error: unknown) {
      const err = error as Error;
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  if (agentPath && method === 'DELETE' && agentPath.action === 'base') {
    try {
      const applyMode = parseApplyMode(parsedUrl.searchParams.get('applyMode'));
      const targetName = agentPath.name;
      const store = loadAgentStore(AGENT_DATA_FILE);
      const next = updateAgentStore(store, applyMode, agents => {
        if (agents.length <= 1) {
          throw new Error('至少保留一个智能体，无法删除');
        }
        const filtered = agents.filter(agent => agent.name !== targetName);
        if (filtered.length === agents.length) {
          throw new Error('智能体不存在');
        }
        return filtered;
      });

      // 级联清理分组引用
      const groupStore = loadGroupStore(GROUP_DATA_FILE);
      const cleanedGroupStore = removeAgentFromAllGroups(groupStore, targetName);
      if (cleanedGroupStore.groups.length !== groupStore.groups.length ||
          cleanedGroupStore.updatedAt !== groupStore.updatedAt) {
        saveGroupStore(GROUP_DATA_FILE, cleanedGroupStore);
      }

      saveAgentStore(AGENT_DATA_FILE, next);
      sendJson(res, 200, { success: true, applyMode, name: targetName });
    } catch (error: unknown) {
      const err = error as Error;
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  if (method === 'GET' && pathname === '/api/users') {
    const store = loadStore();
    sendJson(res, 200, {
      users: store.users.map(user => ({
        username: user.username,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }))
    });
    return;
  }

  if (method === 'POST' && pathname === '/api/users') {
    try {
      const body = await parseBody<{ username?: string; password?: string }>(req);
      const username = sanitizeUsername(body.username || '');
      const password = body.password || '';
      const validationError = validateCredInput(username, password);
      if (validationError) {
        sendJson(res, 400, { error: validationError });
        return;
      }

      const store = loadStore();
      if (store.users.some(user => user.username === username)) {
        sendJson(res, 409, { error: '用户名已存在' });
        return;
      }

      store.users.push(createUser(username, password));
      saveStore(store);
      sendJson(res, 201, { success: true, username });
    } catch (error: unknown) {
      const err = error as Error;
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  const userMatch = pathname.match(/^\/api\/users\/([a-zA-Z0-9_.-]+)$/);
  const pwdMatch = pathname.match(/^\/api\/users\/([a-zA-Z0-9_.-]+)\/password$/);

  if (method === 'PUT' && pwdMatch) {
    try {
      const username = sanitizeUsername(pwdMatch[1] || '');
      const body = await parseBody<{ password?: string }>(req);
      const password = body.password || '';

      if (password.length < 8) {
        sendJson(res, 400, { error: '密码长度不能少于 8 位' });
        return;
      }

      const store = loadStore();
      const user = store.users.find(entry => entry.username === username);
      if (!user) {
        sendJson(res, 404, { error: '用户不存在' });
        return;
      }

      user.salt = crypto.randomBytes(16).toString('hex');
      user.passwordHash = hashPassword(password, user.salt);
      user.updatedAt = Date.now();
      saveStore(store);
      sendJson(res, 200, { success: true, username });
    } catch (error: unknown) {
      const err = error as Error;
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  if (method === 'DELETE' && userMatch) {
    const username = sanitizeUsername(userMatch[1] || '');
    const store = loadStore();

    if (store.users.length <= 1) {
      sendJson(res, 400, { error: '至少保留一个用户，无法删除' });
      return;
    }

    const index = store.users.findIndex(entry => entry.username === username);
    if (index === -1) {
      sendJson(res, 404, { error: '用户不存在' });
      return;
    }

    store.users.splice(index, 1);
    saveStore(store);
    sendJson(res, 200, { success: true, username });
    return;
  }

  sendJson(res, 404, { error: 'Not Found' });
});

server.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('🔐 鉴权管理服务已启动');
  console.log(`📍 地址: http://localhost:${PORT}`);
  console.log(`📁 用户数据: ${DATA_FILE}`);
  console.log(`📁 智能体数据: ${AGENT_DATA_FILE}`);
  console.log('');
  console.log('页面:');
  console.log('  GET    /                       管理页面');
  console.log('');
  console.log('API 端点:');
  console.log('  GET    /healthz');
  console.log('  POST   /api/auth/verify');
  console.log('  GET    /api/users               (x-admin-token)');
  console.log('  POST   /api/users               (x-admin-token)');
  console.log('  PUT    /api/users/:name/password (x-admin-token)');
  console.log('  DELETE /api/users/:name         (x-admin-token)');
  console.log('  GET    /api/agents              (x-admin-token)');
  console.log('  POST   /api/agents              (x-admin-token)');
  console.log('  PUT    /api/agents/:name        (x-admin-token)');
  console.log('  PUT    /api/agents/:name/prompt (x-admin-token)');
  console.log('  DELETE /api/agents/:name        (x-admin-token)');
  console.log('  POST   /api/agents/apply-pending (x-admin-token)');
  console.log('  GET    /api/groups             (x-admin-token)');
  console.log('  POST   /api/groups             (x-admin-token)');
  console.log('  PUT    /api/groups/:id         (x-admin-token)');
  console.log('  DELETE /api/groups/:id         (x-admin-token)');
  console.log('='.repeat(60));
});
