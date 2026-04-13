import * as http from 'http';
import { parseBody } from '../../shared/http/body';
import { AppError } from '../../shared/errors/app-error';
import { APP_ERROR_CODES } from '../../shared/errors/app-error-codes';
import { sendHttpError } from '../../shared/http/errors';
import { sendJson } from '../../shared/http/json';
import { checkRateLimit, getClientIP } from '../../rate-limiter';
import { ChatService } from '../application/chat-service';
import { SessionService } from '../application/session-service';
import { loadGroupStore } from '../../group-store';
import { AgentManager } from '../../agent-manager';
import { RichBlock } from '../../types';
import { ChatRuntime } from '../runtime/chat-runtime';
import { serveStaticFile } from '../../shared/http/static-files';
import { resolveFrontendAssetRequest, FrontendAssetResolution } from '../../shared/http/frontend-asset-resolver';
import {
  buildChatRateLimitBody,
  normalizeBodyText,
  normalizeSessionId,
  normalizeWorkdirSelection
} from './chat-route-helpers';
import { isExistingAbsoluteDirectory } from './workdir-path';
import { handleEventQueryRoutes } from './event-query-routes';

export interface ChatRoutesDependencies {
  chatService: ChatService;
  sessionService: SessionService;
  agentManager: AgentManager;
  rateLimitMaxRequests: number;
  groupDataFile: string;
  runtime: ChatRuntime;
  userKey: string;
}

function normalizeStopScope(scope: unknown): 'current_agent' | 'session' {
  const normalized = normalizeBodyText(scope);
  if (normalized !== 'current_agent' && normalized !== 'session') {
    throw new AppError('scope 必须是 current_agent 或 session', {
      code: APP_ERROR_CODES.VALIDATION_FAILED
    });
  }
  return normalized;
}

function sendServiceError(res: http.ServerResponse, error: unknown): void {
  sendHttpError(res, error);
}

function sendRateLimitError(res: http.ServerResponse, resetAt: number): void {
  sendJson(res, 429, buildChatRateLimitBody(resetAt));
}

function serveFrontendAssetResolution(
  res: http.ServerResponse,
  resolution: FrontendAssetResolution
): void {
  if (resolution.kind === 'missing-required') {
    sendJson(res, 500, { error: resolution.errorMessage });
    return;
  }

  if (resolution.kind === 'missing-asset') {
    sendJson(res, 404, { error: 'Not Found' });
    return;
  }

  const frontendAsset = resolution.asset;
  serveStaticFile(res, {
    rootDir: frontendAsset.rootDir,
    filePath: frontendAsset.filePath,
    contentType: frontendAsset.contentType,
    disableHtmlCache: frontendAsset.disableHtmlCache,
    onNotFound: response => sendJson(response, frontendAsset.required ? 500 : 404, frontendAsset.required
      ? { error: `前端构建产物缺失: ${frontendAsset.filePath}。请先执行 npm run build 生成 dist/frontend。` }
      : { error: 'Not Found' })
  });
}

export async function handleChatRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requestUrl: URL,
  deps: ChatRoutesDependencies
): Promise<boolean> {
  const method = req.method || 'GET';

  if (method === 'GET') {
    const homeResolution = resolveFrontendAssetRequest(requestUrl.pathname, 'index.html', {
      entryPaths: ['/', '/index.html']
    });
    if (homeResolution) {
      serveFrontendAssetResolution(res, homeResolution);
      return true;
    }

    const chatResolution = resolveFrontendAssetRequest(requestUrl.pathname, 'chat.html', {
      entryPaths: ['/chat.html']
    });
    if (chatResolution) {
      serveFrontendAssetResolution(res, chatResolution);
      return true;
    }
  }

  if (await handleEventQueryRoutes(req, res, requestUrl, { runtime: deps.runtime, userKey: deps.userKey })) {
    return true;
  }

  if (requestUrl.pathname === '/api/agents' && method === 'GET') {
    sendJson(res, 200, { agents: deps.chatService.listAgents() });
    return true;
  }

  if (requestUrl.pathname === '/api/groups' && method === 'GET') {
    try {
      const store = loadGroupStore(deps.groupDataFile);
      sendJson(res, 200, { groups: store.groups, updatedAt: store.updatedAt });
    } catch (error) {
      sendJson(res, 500, { error: (error as Error).message });
    }
    return true;
  }

  if (requestUrl.pathname === '/api/chat' && method === 'POST') {
    const clientIP = getClientIP(req);
    const rateLimit = checkRateLimit(clientIP, deps.rateLimitMaxRequests);
    if (!rateLimit.allowed) {
      sendRateLimitError(res, rateLimit.resetAt);
      return true;
    }

    try {
      const body = await parseBody<{ message: string; sender?: string }>(req);
      sendJson(res, 200, await deps.chatService.sendMessage({ userKey: deps.userKey }, body));
    } catch (error) {
      sendServiceError(res, error);
    }
    return true;
  }

  if (requestUrl.pathname === '/api/chat-resume' && method === 'POST') {
    try {
      sendJson(res, 200, await deps.chatService.resumePendingChat({ userKey: deps.userKey }));
    } catch (error) {
      sendServiceError(res, error);
    }
    return true;
  }

  if (requestUrl.pathname === '/api/chat-stop' && method === 'POST') {
    try {
      const body = await parseBody<{ sessionId?: string; scope?: unknown }>(req);
      const sessionId = typeof body.sessionId === 'undefined'
        ? undefined
        : normalizeSessionId(body.sessionId);
      sendJson(res, 200, await deps.chatService.stopExecution(
        { userKey: deps.userKey },
        {
          sessionId,
          scope: normalizeStopScope(body.scope)
        }
      ));
    } catch (error) {
      sendServiceError(res, error);
    }
    return true;
  }

  if (requestUrl.pathname === '/api/chat-summary' && method === 'POST') {
    try {
      const body = await parseBody<{ sessionId?: string }>(req);
      sendJson(res, 200, await deps.chatService.summarizeChat({ userKey: deps.userKey }, body.sessionId));
    } catch (error) {
      sendServiceError(res, error);
    }
    return true;
  }

  if (requestUrl.pathname === '/api/history' && method === 'GET') {
    sendJson(res, 200, deps.sessionService.getHistory({ userKey: deps.userKey }, deps.agentManager.getAgentConfigs()));
    return true;
  }

  if (requestUrl.pathname === '/api/clear' && method === 'POST') {
    sendJson(res, 200, deps.sessionService.clearHistory({ userKey: deps.userKey }));
    return true;
  }

  if (requestUrl.pathname === '/api/sessions' && method === 'POST') {
    try {
      const body = await parseBody<{ name?: string }>(req);
      sendJson(res, 200, deps.sessionService.createChatSession({ userKey: deps.userKey }, body.name));
    } catch (error) {
      sendServiceError(res, error);
    }
    return true;
  }

  if (requestUrl.pathname === '/api/sessions/select' && method === 'POST') {
    try {
      const body = await parseBody<{ sessionId?: string }>(req);
      sendJson(res, 200, deps.sessionService.selectChatSession({ userKey: deps.userKey }, normalizeSessionId(body.sessionId)));
    } catch (error) {
      sendServiceError(res, error);
    }
    return true;
  }

  if (requestUrl.pathname === '/api/sessions/update' && method === 'POST') {
    try {
      const body = await parseBody<{ sessionId?: string; patch?: unknown }>(req);
      sendJson(res, 200, deps.sessionService.updateChatSession({ userKey: deps.userKey }, normalizeSessionId(body.sessionId), body.patch));
    } catch (error) {
      sendServiceError(res, error);
    }
    return true;
  }

  if (requestUrl.pathname === '/api/sessions/rename' && method === 'POST') {
    try {
      const body = await parseBody<{ sessionId?: string; name?: string }>(req);
      sendJson(res, 200, deps.sessionService.renameChatSession({ userKey: deps.userKey }, normalizeSessionId(body.sessionId), normalizeBodyText(body.name)));
    } catch (error) {
      sendServiceError(res, error);
    }
    return true;
  }

  if (requestUrl.pathname === '/api/sessions/delete' && method === 'POST') {
    try {
      const body = await parseBody<{ sessionId?: string }>(req);
      sendJson(res, 200, deps.sessionService.deleteChatSession({ userKey: deps.userKey }, normalizeSessionId(body.sessionId)));
    } catch (error) {
      sendServiceError(res, error);
    }
    return true;
  }

  if (requestUrl.pathname === '/api/create-block' && method === 'POST') {
    try {
      const body = await parseBody<{ sessionId?: string; block: RichBlock }>(req);
      sendJson(res, 200, deps.chatService.createBlock(body));
    } catch (error) {
      sendServiceError(res, error);
    }
    return true;
  }

  if (requestUrl.pathname === '/api/block-status' && method === 'GET') {
    sendJson(res, 200, deps.chatService.getBlockStatus());
    return true;
  }

  if (requestUrl.pathname === '/api/session-agents' && method === 'POST') {
    try {
      const body = await parseBody<{ sessionId?: string; agentName?: string; enabled?: boolean }>(req);
      sendJson(res, 200, deps.sessionService.setSessionAgent({ userKey: deps.userKey }, {
        sessionId: body.sessionId,
        agentName: normalizeBodyText(body.agentName),
        enabled: body.enabled as boolean
      }));
    } catch (error) {
      sendServiceError(res, error);
    }
    return true;
  }

  if (requestUrl.pathname === '/api/workdirs/select' && method === 'POST') {
    try {
      const body = await parseBody<{ agentName?: string; workdir?: string }>(req);
      const { agentName, workdir } = normalizeWorkdirSelection(body);
      if (!workdir) {
        sendJson(res, 200, deps.sessionService.setWorkdir({ userKey: deps.userKey }, agentName, null));
        return true;
      }
      if (!isExistingAbsoluteDirectory(workdir)) {
        throw new AppError('workdir 必须是存在的绝对目录', {
          code: APP_ERROR_CODES.VALIDATION_FAILED
        });
      }
      sendJson(res, 200, deps.sessionService.setWorkdir({ userKey: deps.userKey }, agentName, workdir));
    } catch (error) {
      sendServiceError(res, error);
    }
    return true;
  }

  return false;
}
