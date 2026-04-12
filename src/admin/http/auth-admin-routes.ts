import * as http from 'http';
import { parseBody } from '../../shared/http/body';
import { AIAgentConfig } from '../../types';
import { sendHttpError } from '../../shared/http/errors';
import { sendJson } from '../../shared/http/json';
import { serveStaticFile } from '../../shared/http/static-files';
import { AgentAdminService, AgentAdminServiceError, parseApplyMode } from '../application/agent-admin-service';
import { UserAdminService, UserAdminServiceError } from '../application/user-admin-service';
import { requireAdmin } from './admin-auth';
import { resolveFrontendAssetRequest } from '../../chat/http/chat-route-helpers';

interface AgentPathMatch {
  name: string;
  action: 'base' | 'prompt' | 'restore-template' | 'template';
}

export interface AuthAdminRoutesDependencies {
  adminToken: string;
  userAdminService: UserAdminService;
  agentAdminService: AgentAdminService;
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

  if (method === 'GET') {
    const frontendAsset = resolveFrontendAssetRequest(pathname, 'admin.html');
    if (frontendAsset) {
      if (frontendAsset.errorMessage) {
        sendJson(res, 500, { error: frontendAsset.errorMessage });
        return true;
      }
      serveStaticFile(res, {
        rootDir: frontendAsset.rootDir,
        filePath: frontendAsset.filePath,
        contentType: frontendAsset.contentType,
        disableHtmlCache: frontendAsset.disableHtmlCache,
        onNotFound: response => sendJson(response, 500, {
          error: `前端构建产物缺失: ${frontendAsset.filePath}。请先执行 npm run build 生成 dist/frontend。`
        })
      });
      return true;
    }
  }

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
    sendJson(res, 200, deps.agentAdminService.listAgents());
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
    sendJson(res, 200, deps.agentAdminService.applyPendingAgents());
    return true;
  }

  const agentPath = parseAgentPath(pathname);
  if (!agentPath) {
    if (pathname.startsWith('/api/users') || pathname.startsWith('/api/agents')) {
      if (!requireAdmin(req, res, deps.adminToken)) {
        return true;
      }
    }
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
      sendJson(res, 200, deps.agentAdminService.getAgentPromptTemplate(agentPath.name));
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

  return false;
}
