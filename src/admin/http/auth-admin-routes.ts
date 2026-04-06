import * as http from 'http';
import { parseBody } from '../../shared/http/body';
import { AIAgentConfig } from '../../types';
import { sendHttpError } from '../../shared/http/errors';
import { sendJson } from '../../shared/http/json';
import { AgentAdminService, AgentAdminServiceError, parseApplyMode } from '../application/agent-admin-service';
import { UserAdminService, UserAdminServiceError } from '../application/user-admin-service';
import { normalizeAdminToken } from '../runtime/auth-admin-runtime';

interface AgentPathMatch {
  name: string;
  action: 'base' | 'prompt' | 'restore-template' | 'template';
}

export interface AuthAdminRoutesDependencies {
  adminToken: string;
  userAdminService: UserAdminService;
  agentAdminService: AgentAdminService;
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

function parseAgentPath(pathname: string): AgentPathMatch | null {
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

export async function handleAuthAdminRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requestUrl: URL,
  deps: AuthAdminRoutesDependencies
): Promise<boolean> {
  const pathname = requestUrl.pathname;
  const method = req.method || 'GET';

  if (method === 'POST' && pathname === '/api/auth/verify') {
    try {
      const body = await parseBody<{ username?: string; password?: string }>(req);
      const user = deps.userAdminService.verifyCredentials(body.username || '', body.password || '');
      if (!user) {
        sendJson(res, 401, { success: false, error: '用户名或密码错误' });
        return true;
      }

      sendJson(res, 200, { success: true, username: user.username });
    } catch (error) {
      sendHttpError(res, error, {
        invalidJsonStatus: 400,
        fallbackStatus: 400,
        mapBody: message => ({ success: false, error: message })
      });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/users') {
    if (!requireAdmin(req, res, deps.adminToken)) {
      return true;
    }
    sendJson(res, 200, { users: deps.userAdminService.listUsers() });
    return true;
  }

  if (method === 'POST' && pathname === '/api/users') {
    if (!requireAdmin(req, res, deps.adminToken)) {
      return true;
    }
    try {
      const body = await parseBody<{ username?: string; password?: string }>(req);
      const user = deps.userAdminService.createUser(body.username || '', body.password || '');
      sendJson(res, 201, { success: true, username: user.username });
    } catch (error) {
      if (error instanceof UserAdminServiceError) {
        sendJson(res, error.statusCode, { error: error.message });
      } else {
        sendHttpError(res, error, { fallbackStatus: 400 });
      }
    }
    return true;
  }

  const userMatch = pathname.match(/^\/api\/users\/([a-zA-Z0-9_.-]+)$/);
  const passwordMatch = pathname.match(/^\/api\/users\/([a-zA-Z0-9_.-]+)\/password$/);

  if (method === 'PUT' && passwordMatch) {
    if (!requireAdmin(req, res, deps.adminToken)) {
      return true;
    }
    try {
      const body = await parseBody<{ password?: string }>(req);
      const user = deps.userAdminService.changePassword(passwordMatch[1], body.password || '');
      sendJson(res, 200, { success: true, username: user.username });
    } catch (error) {
      if (error instanceof UserAdminServiceError) {
        sendJson(res, error.statusCode, { error: error.message });
      } else {
        sendHttpError(res, error, { fallbackStatus: 400 });
      }
    }
    return true;
  }

  if (method === 'DELETE' && userMatch) {
    if (!requireAdmin(req, res, deps.adminToken)) {
      return true;
    }
    try {
      const result = deps.userAdminService.deleteUser(userMatch[1]);
      sendJson(res, 200, { success: true, username: result.username });
    } catch (error) {
      if (error instanceof UserAdminServiceError) {
        sendJson(res, error.statusCode, { error: error.message });
      } else {
        sendHttpError(res, error, { fallbackStatus: 400 });
      }
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/agents') {
    if (!requireAdmin(req, res, deps.adminToken)) {
      return true;
    }
    const result = deps.agentAdminService.listAgents();
    sendJson(res, 200, result);
    return true;
  }

  if (method === 'POST' && pathname === '/api/agents') {
    if (!requireAdmin(req, res, deps.adminToken)) {
      return true;
    }
    try {
      const body = await parseBody<{ agent?: Record<string, unknown>; applyMode?: string }>(req);
      if (!body.agent) {
        sendJson(res, 400, { error: '缺少 agent 配置' });
        return true;
      }
      const result = deps.agentAdminService.createAgent({
        agent: body.agent as unknown as AIAgentConfig,
        applyMode: parseApplyMode(body.applyMode)
      });
      sendJson(res, 201, result);
    } catch (error) {
      if (error instanceof AgentAdminServiceError) {
        sendJson(res, error.statusCode, { error: error.message });
      } else {
        sendHttpError(res, error, { fallbackStatus: 400 });
      }
    }
    return true;
  }

  if (method === 'POST' && pathname === '/api/agents/apply-pending') {
    if (!requireAdmin(req, res, deps.adminToken)) {
      return true;
    }
    const result = deps.agentAdminService.applyPendingAgents();
    sendJson(res, 200, result);
    return true;
  }

  const agentPath = parseAgentPath(pathname);
  if (!agentPath) {
    return false;
  }

  if (!requireAdmin(req, res, deps.adminToken)) {
    return true;
  }

  if (method === 'PUT' && agentPath.action === 'base') {
    try {
      const body = await parseBody<{ agent?: Record<string, unknown>; applyMode?: string }>(req);
      if (!body.agent) {
        sendJson(res, 400, { error: '缺少 agent 配置' });
        return true;
      }
      const result = deps.agentAdminService.updateAgent(agentPath.name, {
        agent: body.agent as unknown as AIAgentConfig,
        applyMode: parseApplyMode(body.applyMode)
      });
      sendJson(res, 200, result);
    } catch (error) {
      if (error instanceof AgentAdminServiceError) {
        sendJson(res, error.statusCode, { error: error.message });
      } else {
        sendHttpError(res, error, { fallbackStatus: 400 });
      }
    }
    return true;
  }

  if (method === 'PUT' && agentPath.action === 'prompt') {
    try {
      const body = await parseBody<{ systemPrompt?: string; personality?: string; applyMode?: string }>(req);
      const result = deps.agentAdminService.updateAgentPrompt(agentPath.name, {
        systemPrompt: body.systemPrompt,
        personality: body.personality,
        applyMode: parseApplyMode(body.applyMode)
      });
      sendJson(res, 200, result);
    } catch (error) {
      if (error instanceof AgentAdminServiceError) {
        sendJson(res, error.statusCode, { error: error.message });
      } else {
        sendHttpError(res, error, { fallbackStatus: 400 });
      }
    }
    return true;
  }

  if (method === 'POST' && agentPath.action === 'restore-template') {
    try {
      const body = await parseBody<{ applyMode?: string }>(req);
      const result = deps.agentAdminService.restoreAgentPromptTemplate(agentPath.name, parseApplyMode(body.applyMode));
      sendJson(res, 200, result);
    } catch (error) {
      if (error instanceof AgentAdminServiceError) {
        sendJson(res, error.statusCode, { error: error.message });
      } else {
        sendHttpError(res, error, { fallbackStatus: 400 });
      }
    }
    return true;
  }

  if (method === 'GET' && agentPath.action === 'template') {
    try {
      const result = deps.agentAdminService.getAgentPromptTemplate(agentPath.name);
      sendJson(res, 200, result);
    } catch (error) {
      if (error instanceof AgentAdminServiceError) {
        sendJson(res, error.statusCode, { error: error.message });
      } else {
        sendHttpError(res, error, { fallbackStatus: 400 });
      }
    }
    return true;
  }

  if (method === 'DELETE' && agentPath.action === 'base') {
    try {
      const result = deps.agentAdminService.deleteAgent(agentPath.name, parseApplyMode(requestUrl.searchParams.get('applyMode')));
      sendJson(res, 200, result);
    } catch (error) {
      if (error instanceof AgentAdminServiceError) {
        sendJson(res, error.statusCode, { error: error.message });
      } else {
        sendHttpError(res, error, { fallbackStatus: 400 });
      }
    }
    return true;
  }

  if (pathname.startsWith('/api/users') || pathname.startsWith('/api/agents')) {
    if (!requireAdmin(req, res, deps.adminToken)) {
      return true;
    }
  }

  return false;
}
