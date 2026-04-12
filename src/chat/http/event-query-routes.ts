import * as http from 'http';
import { AppError } from '../../shared/errors/app-error';
import { APP_ERROR_CODES } from '../../shared/errors/app-error-codes';
import { sendHttpError } from '../../shared/http/errors';
import { sendJson } from '../../shared/http/json';
import { ChatRuntime } from '../runtime/chat-runtime';
import { normalizeSessionId } from './chat-route-helpers';

const EVENTS_REGEX = /^\/api\/sessions\/([^/]+)\/events$/;
const TIMELINE_REGEX = /^\/api\/sessions\/([^/]+)\/timeline$/;
const CALL_GRAPH_REGEX = /^\/api\/sessions\/([^/]+)\/call-graph$/;
const SYNC_STATUS_REGEX = /^\/api\/sessions\/([^/]+)\/sync-status$/;

export interface EventQueryRoutesDependencies {
  runtime: ChatRuntime;
  userKey: string;
}

export async function handleEventQueryRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requestUrl: URL,
  deps: EventQueryRoutesDependencies
): Promise<boolean> {
  if ((req.method || 'GET') !== 'GET') {
    return false;
  }

  const pathname = requestUrl.pathname;
  if (!pathname) {
    return false;
  }

  let match: RegExpMatchArray | null;

  if ((match = pathname.match(EVENTS_REGEX))) {
    await handleEvents(match[1], requestUrl, res, deps);
    return true;
  }

  if ((match = pathname.match(TIMELINE_REGEX))) {
    await handleTimeline(match[1], requestUrl, res, deps);
    return true;
  }

  if ((match = pathname.match(CALL_GRAPH_REGEX))) {
    await handleCallGraph(match[1], res, deps);
    return true;
  }

  if ((match = pathname.match(SYNC_STATUS_REGEX))) {
    await handleSyncStatus(match[1], res, deps);
    return true;
  }

  return false;
}

function resolveAuthorizedSession(deps: EventQueryRoutesDependencies, sessionId: string): string {
  const normalized = normalizeSessionId(sessionId);
  if (!normalized) {
    throw new AppError('会话 id 不能为空', {
      code: APP_ERROR_CODES.VALIDATION_FAILED
    });
  }

  const sessions = deps.runtime.ensureUserSessions(deps.userKey);
  if (!sessions.has(normalized)) {
    throw new AppError('会话不存在', {
      code: APP_ERROR_CODES.NOT_FOUND
    });
  }

  return normalized;
}

const AFTER_SEQ_ERROR_MESSAGE = 'afterSeq 必须是非负整数';

function parseAfterSeq(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new AppError(AFTER_SEQ_ERROR_MESSAGE, {
      code: APP_ERROR_CODES.VALIDATION_FAILED
    });
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    throw new AppError(AFTER_SEQ_ERROR_MESSAGE, {
      code: APP_ERROR_CODES.VALIDATION_FAILED
    });
  }

  if (!Number.isSafeInteger(parsed)) {
    throw new AppError(AFTER_SEQ_ERROR_MESSAGE, {
      code: APP_ERROR_CODES.VALIDATION_FAILED
    });
  }

  return parsed;
}

async function handleEvents(
  sessionId: string,
  requestUrl: URL,
  res: http.ServerResponse,
  deps: EventQueryRoutesDependencies
): Promise<void> {
  try {
    const normalizedSessionId = resolveAuthorizedSession(deps, sessionId);
    const afterSeq = parseAfterSeq(requestUrl.searchParams.get('afterSeq'));
    const events = deps.runtime.listSessionEvents(normalizedSessionId, afterSeq);
    sendJson(res, 200, { events });
  } catch (error) {
    sendHttpError(res, error);
  }
}

async function handleTimeline(
  sessionId: string,
  requestUrl: URL,
  res: http.ServerResponse,
  deps: EventQueryRoutesDependencies
): Promise<void> {
  try {
    const normalizedSessionId = resolveAuthorizedSession(deps, sessionId);
    const afterSeq = parseAfterSeq(requestUrl.searchParams.get('afterSeq'));
    const timeline = deps.runtime.buildSessionTimeline(normalizedSessionId, afterSeq);
    sendJson(res, 200, { timeline });
  } catch (error) {
    sendHttpError(res, error);
  }
}

async function handleCallGraph(
  sessionId: string,
  res: http.ServerResponse,
  deps: EventQueryRoutesDependencies
): Promise<void> {
  try {
    const normalizedSessionId = resolveAuthorizedSession(deps, sessionId);
    const callGraph = deps.runtime.buildSessionCallGraph(normalizedSessionId);
    sendJson(res, 200, { callGraph });
  } catch (error) {
    sendHttpError(res, error);
  }
}

async function handleSyncStatus(
  sessionId: string,
  res: http.ServerResponse,
  deps: EventQueryRoutesDependencies
): Promise<void> {
  try {
    const normalizedSessionId = resolveAuthorizedSession(deps, sessionId);
    const status = deps.runtime.buildSessionSyncStatus(normalizedSessionId);
    sendJson(res, 200, status);
  } catch (error) {
    sendHttpError(res, error);
  }
}
