import * as http from 'http';
import { AppError } from '../../shared/errors/app-error';
import { APP_ERROR_CODES } from '../../shared/errors/app-error-codes';
import { applyChatCorsHeaders } from '../../shared/http/cors';
import { sendHttpError } from '../../shared/http/errors';
import { sendNotFound } from '../../shared/http/json';
import { handleAuthRoutes } from '../http/auth-routes';
import { handleChatRoutes } from '../http/chat-routes';
import { handleCallbackRoutes } from '../http/callback-routes';
import { handleOpsRoutes } from '../http/ops-routes';
import { createWsRoutes } from '../http/ws-routes';
import { AuthService } from '../application/auth-service';
import { ChatService } from '../application/chat-service';
import { SessionService } from '../application/session-service';
import { ChatRuntime } from '../runtime/chat-runtime';
import { createWsHub } from '../runtime/ws-hub';
import { AgentManager } from '../../agent-manager';
import { createAuthRequestContext } from '../http/request-context';

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

function rejectUpgrade(socket: import('net').Socket, statusLine: string): void {
  if (!socket.writable || socket.destroyed) {
    socket.destroy();
    return;
  }

  socket.write(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function createChatServer(deps: CreateChatServerDependencies): { server: http.Server; shutdown: () => Promise<void> } {
  const wsHub = createWsHub({
    listSessionEvents: deps.runtime.listSessionEvents
  });

  const originalAppendCommandEvent = deps.runtime.appendCommandEvent;
  const originalAppendUserEvent = deps.runtime.appendUserEvent;
  const originalAppendAgentEvent = deps.runtime.appendAgentEvent;
  const originalAppendSystemEvent = deps.runtime.appendSystemEvent;

  deps.runtime.appendCommandEvent = (sessionId, draft) => {
    const event = originalAppendCommandEvent(sessionId, draft);
    wsHub.publish(event);
    return event;
  };
  deps.runtime.appendUserEvent = (sessionId, draft) => {
    const event = originalAppendUserEvent(sessionId, draft);
    wsHub.publish(event);
    return event;
  };
  deps.runtime.appendAgentEvent = (sessionId, draft) => {
    const event = originalAppendAgentEvent(sessionId, draft);
    wsHub.publish(event);
    return event;
  };
  deps.runtime.appendSystemEvent = (sessionId, draft) => {
    const event = originalAppendSystemEvent(sessionId, draft);
    wsHub.publish(event);
    return event;
  };

  const wsRoutes = createWsRoutes({
    hub: wsHub,
    hasSessionAccess: (userKey, sessionId) => deps.runtime.ensureUserSessions(userKey).has(sessionId)
  });

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
    const authContext = createAuthRequestContext(req);
    applySetCookies(res, deps.authService.ensureVisitorIdentity(authContext).setCookies);

    if (deps.authService.requiresAuthentication(requestUrl.pathname) && !deps.authService.isAuthenticated(authContext)) {
      sendHttpError(res, new AppError('未授权，请先登录', {
        code: APP_ERROR_CODES.UNAUTHORIZED
      }));
      return;
    }

    const userKey = deps.authService.getUserKey(authContext);

    if (await handleChatRoutes(req, res, requestUrl, {
      chatService: deps.chatService,
      sessionService: deps.sessionService,
      agentManager: deps.agentManager,
      rateLimitMaxRequests: deps.rateLimitMaxRequests,
      groupDataFile: deps.groupDataFile,
      runtime: deps.runtime,
      userKey
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

  server.on('upgrade', (req, socket, head) => {
    const upgradeSocket = socket as import('net').Socket;
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (requestUrl.pathname !== wsRoutes.path) {
      upgradeSocket.destroy();
      return;
    }

    const authContext = createAuthRequestContext(req);
    if (deps.authService.requiresAuthentication(requestUrl.pathname) && !deps.authService.isAuthenticated(authContext)) {
      rejectUpgrade(upgradeSocket, '401 Unauthorized');
      return;
    }

    try {
      const userKey = deps.authService.getUserKey(authContext);
      const handled = wsRoutes.handleUpgrade(req, upgradeSocket, head, { userKey });
      if (!handled) {
        rejectUpgrade(upgradeSocket, '404 Not Found');
      }
    } catch {
      upgradeSocket.destroy();
    }
  });

  return {
    server,
    shutdown: async () => {
      wsRoutes.shutdown();
      wsHub.close();
      deps.runtime.appendCommandEvent = originalAppendCommandEvent;
      deps.runtime.appendUserEvent = originalAppendUserEvent;
      deps.runtime.appendAgentEvent = originalAppendAgentEvent;
      deps.runtime.appendSystemEvent = originalAppendSystemEvent;
      await deps.runtime.shutdown();
    }
  };
}
