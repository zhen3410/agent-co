import * as http from 'http';
import { applyChatCorsHeaders } from '../../shared/http/cors';
import { sendJson, sendNotFound } from '../../shared/http/json';
import { handleAuthRoutes } from '../http/auth-routes';
import { handleChatRoutes } from '../http/chat-routes';
import { handleCallbackRoutes } from '../http/callback-routes';
import { handleOpsRoutes } from '../http/ops-routes';
import { AuthService } from '../application/auth-service';
import { ChatService } from '../application/chat-service';
import { SessionService } from '../application/session-service';
import { ChatRuntime } from '../runtime/chat-runtime';
import { AgentManager } from '../../agent-manager';

export interface CreateChatServerDependencies {
  authService: AuthService;
  chatService: ChatService;
  sessionService: SessionService;
  runtime: ChatRuntime;
  agentManager: AgentManager;
  callbackAuthToken: string;
  callbackAuthHeader: string;
  verboseLogDir: string;
  publicDir: string;
  rateLimitMaxRequests: number;
  groupDataFile: string;
}

function applySetCookies(res: http.ServerResponse, cookies: string[]): void {
  if (cookies.length === 0) {
    return;
  }

  const existing = res.getHeader('Set-Cookie');
  const current = existing ? (Array.isArray(existing) ? existing.map(String) : [String(existing)]) : [];
  res.setHeader('Set-Cookie', [...current, ...cookies]);
}

export function createChatServer(deps: CreateChatServerDependencies): { server: http.Server; shutdown: () => Promise<void> } {
  const server = http.createServer(async (req, res) => {
    const url = req.url || '/';
    const method = req.method || 'GET';

    applyChatCorsHeaders(res);

    if (url.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }

    if (method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (await handleAuthRoutes(req, res, { authService: deps.authService })) {
      return;
    }

    const requestUrl = new URL(url, `http://${req.headers.host || '127.0.0.1'}`);
    applySetCookies(res, deps.authService.ensureVisitorIdentity(req).setCookies);

    if (deps.authService.requiresAuthentication(requestUrl.pathname) && !deps.authService.isAuthenticated(req)) {
      sendJson(res, 401, { error: '未授权，请先登录' });
      return;
    }

    if (await handleChatRoutes(req, res, requestUrl, {
      chatService: deps.chatService,
      sessionService: deps.sessionService,
      agentManager: deps.agentManager,
      rateLimitMaxRequests: deps.rateLimitMaxRequests,
      groupDataFile: deps.groupDataFile,
      runtime: deps.runtime
    })) {
      return;
    }

    if (await handleCallbackRoutes(req, res, requestUrl, {
      chatService: deps.chatService,
      callbackAuthToken: deps.callbackAuthToken,
      callbackAuthHeader: deps.callbackAuthHeader
    })) {
      return;
    }

    if (await handleOpsRoutes(req, res, requestUrl, {
      runtime: deps.runtime,
      verboseLogDir: deps.verboseLogDir,
      publicDir: deps.publicDir
    })) {
      return;
    }

    sendNotFound(res);
  });

  return {
    server,
    shutdown: () => deps.runtime.shutdown()
  };
}
