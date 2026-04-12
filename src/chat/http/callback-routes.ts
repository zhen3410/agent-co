import * as http from 'http';
import { parseBody } from '../../shared/http/body';
import { AppError } from '../../shared/errors/app-error';
import { APP_ERROR_CODES } from '../../shared/errors/app-error-codes';
import { sendHttpError } from '../../shared/http/errors';
import { sendJson } from '../../shared/http/json';
import { ChatService } from '../application/chat-service';
import { ChatRuntime } from '../runtime/chat-runtime';
import {
  isCallbackAuthorized,
  normalizeCallbackAgentName,
  normalizeCallbackPostMessageBody,
  normalizeCallbackSessionId
} from './callback-route-helpers';
import { Message } from '../../types';

export interface CallbackRoutesDependencies {
  chatService: ChatService;
  callbackAuthToken: string;
  callbackAuthHeader: string;
  runtime?: ChatRuntime;
}

function buildMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function sendUnauthorized(res: http.ServerResponse): void {
  sendHttpError(res, new AppError('Unauthorized', {
    code: APP_ERROR_CODES.UNAUTHORIZED
  }));
}

export async function handleCallbackRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requestUrl: URL,
  deps: CallbackRoutesDependencies
): Promise<boolean> {
  const method = req.method || 'GET';

  if (requestUrl.pathname === '/api/callbacks/post-message' && method === 'POST') {
    if (!isCallbackAuthorized(req.headers, deps.callbackAuthHeader, deps.callbackAuthToken)) {
      sendUnauthorized(res);
      return true;
    }

    try {
      const body = await parseBody<{ content?: string; invokeAgents?: string[] }>(req);
      const { content, invokeAgents } = normalizeCallbackPostMessageBody(body);
      if (!content) {
        throw new AppError('缺少 content 字段', {
          code: APP_ERROR_CODES.VALIDATION_FAILED
        });
      }

      const sessionId = normalizeCallbackSessionId(req.headers['x-agent-co-session-id']);
      const agentName = normalizeCallbackAgentName(req.headers['x-agent-co-agent']);
      if (!sessionId) {
        throw new AppError('缺少 x-agent-co-session-id 头', {
          code: APP_ERROR_CODES.VALIDATION_FAILED
        });
      }

      if (deps.runtime) {
        const callbackMessage: Message = {
          id: buildMessageId(),
          role: 'assistant',
          sender: agentName,
          text: content,
          timestamp: Date.now(),
          invokeAgents: invokeAgents && invokeAgents.length > 0 ? invokeAgents : undefined
        };
        const messageEvent = deps.runtime.appendAgentEvent(sessionId, {
          eventType: 'agent_message_created',
          actorName: agentName,
          actorId: agentName,
          payload: {
            message: callbackMessage,
            source: 'callback_post_message'
          }
        });
        for (const targetAgent of invokeAgents || []) {
          deps.runtime.appendAgentEvent(sessionId, {
            eventType: 'dispatch_task_created',
            actorName: agentName,
            actorId: agentName,
            payload: {
              taskId: buildMessageId(),
              dispatchKind: 'explicit_chained',
              callerAgentName: agentName,
              calleeAgentName: targetAgent,
              source: 'callback_post_message'
            },
            correlationId: messageEvent.eventId,
            causationId: messageEvent.eventId,
            causedByEventId: messageEvent.eventId,
            causedBySeq: messageEvent.seq
          });
        }
      }

      const result = deps.chatService.postCallbackMessage(sessionId, agentName, content, invokeAgents);
      sendJson(res, 200, result);
    } catch (error) {
      sendHttpError(res, error, { fallbackStatus: 400 });
    }
    return true;
  }

  if (requestUrl.pathname === '/api/callbacks/thread-context' && method === 'GET') {
    if (!isCallbackAuthorized(req.headers, deps.callbackAuthHeader, deps.callbackAuthToken)) {
      sendUnauthorized(res);
      return true;
    }

    const sessionId = normalizeCallbackSessionId(requestUrl.searchParams.get('sessionid'));
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
