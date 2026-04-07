import * as http from 'http';
import { parseBody } from '../../shared/http/body';
import { AppError } from '../../shared/errors/app-error';
import { APP_ERROR_CODES } from '../../shared/errors/app-error-codes';
import { sendHttpError } from '../../shared/http/errors';
import { sendJson } from '../../shared/http/json';
import { ChatService } from '../application/chat-service';

export interface CallbackRoutesDependencies {
  chatService: ChatService;
  callbackAuthToken: string;
  callbackAuthHeader: string;
}

function getCallbackToken(req: http.IncomingMessage, headerName: string): string {
  const authHeader = (req.headers.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  return String(req.headers[headerName] || '').trim();
}

function isCallbackAuthorized(req: http.IncomingMessage, deps: CallbackRoutesDependencies): boolean {
  return getCallbackToken(req, deps.callbackAuthHeader) === deps.callbackAuthToken;
}

export async function handleCallbackRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requestUrl: URL,
  deps: CallbackRoutesDependencies
): Promise<boolean> {
  const method = req.method || 'GET';

  if (requestUrl.pathname === '/api/callbacks/post-message' && method === 'POST') {
    if (!isCallbackAuthorized(req, deps)) {
      sendHttpError(res, new AppError('Unauthorized', {
        code: APP_ERROR_CODES.UNAUTHORIZED
      }));
      return true;
    }

    try {
      const body = await parseBody<{ content?: string; invokeAgents?: string[] }>(req);
      const content = (body.content || '').trim();
      if (!content) {
        throw new AppError('缺少 content 字段', {
          code: APP_ERROR_CODES.VALIDATION_FAILED
        });
      }

      const sessionId = String(req.headers['x-bot-room-session-id'] || '').trim();
      const rawAgentName = String(req.headers['x-bot-room-agent'] || 'AI').trim() || 'AI';
      let agentName = rawAgentName;
      try {
        agentName = decodeURIComponent(rawAgentName);
      } catch {
        agentName = rawAgentName;
      }

      if (!sessionId) {
        throw new AppError('缺少 x-bot-room-session-id 头', {
          code: APP_ERROR_CODES.VALIDATION_FAILED
        });
      }

      const invokeAgents = Array.isArray(body.invokeAgents)
        ? body.invokeAgents.filter((name): name is string => typeof name === 'string' && !!name.trim())
        : undefined;
      const result = deps.chatService.postCallbackMessage(sessionId, agentName, content, invokeAgents);
      sendJson(res, 200, result);
    } catch (error) {
      sendHttpError(res, error, { fallbackStatus: 400 });
    }
    return true;
  }

  if (requestUrl.pathname === '/api/callbacks/thread-context' && method === 'GET') {
    if (!isCallbackAuthorized(req, deps)) {
      sendHttpError(res, new AppError('Unauthorized', {
        code: APP_ERROR_CODES.UNAUTHORIZED
      }));
      return true;
    }

    const sessionId = (requestUrl.searchParams.get('sessionid') || '').trim();
    if (!sessionId) {
      sendHttpError(res, new AppError('缺少 sessionid 参数', {
        code: APP_ERROR_CODES.VALIDATION_FAILED
      }));
      return true;
    }

    try {
      sendJson(res, 200, deps.chatService.getThreadContext(sessionId));
    } catch (error) {
      sendHttpError(res, error);
    }
    return true;
  }

  return false;
}
