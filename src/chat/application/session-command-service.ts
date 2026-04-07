import { ChatRuntime, SessionChainPatch } from '../runtime/chat-runtime';
import {
  SessionDeleteResponse,
  SessionMutationResponse,
  SessionRenameResponse,
  SessionServiceErrorFactory,
  SessionUserContext
} from './session-service-types';
import { SessionQueryService } from './session-query-service';

export interface SessionCommandServiceDependencies {
  runtime: ChatRuntime;
  queryService: SessionQueryService;
  createError: SessionServiceErrorFactory;
}

export interface SessionCommandService {
  clearHistory(context: SessionUserContext): { success: true };
  createChatSession(context: SessionUserContext, name?: string): SessionMutationResponse;
  selectChatSession(context: SessionUserContext, sessionId: string): ReturnType<SessionQueryService['buildSelectionResponse']>;
  renameChatSession(context: SessionUserContext, sessionId: string, name: string): SessionRenameResponse;
  deleteChatSession(context: SessionUserContext, sessionId: string): SessionDeleteResponse;
  updateChatSession(context: SessionUserContext, sessionId: string, patch: unknown): SessionMutationResponse;
}

export function createSessionCommandService(deps: SessionCommandServiceDependencies): SessionCommandService {
  const { runtime, queryService } = deps;

  function clearHistory(context: SessionUserContext): { success: true } {
    const { userKey, session } = queryService.resolveChatSession(context);
    runtime.clearUserHistory(userKey, session.id);
    return { success: true };
  }

  function createChatSession(context: SessionUserContext, name?: string): SessionMutationResponse {
    const { userKey } = context;
    return queryService.buildMutationResponse(userKey, runtime.createChatSessionForUser(userKey, name));
  }

  function selectChatSession(context: SessionUserContext, sessionId: string) {
    const { userKey } = context;
    if (!sessionId || !runtime.setActiveChatSession(userKey, sessionId)) {
      throw deps.createError('会话不存在', 400);
    }

    return queryService.buildSelectionResponse(userKey, runtime.ensureUserSessions(userKey).get(sessionId)!);
  }

  function renameChatSession(context: SessionUserContext, sessionId: string, name: string): SessionRenameResponse {
    const { userKey } = context;
    const renamed = runtime.renameChatSessionForUser(userKey, sessionId, name);
    if (!renamed) {
      throw deps.createError('会话不存在', 400);
    }

    return queryService.buildRenameResponse(userKey, renamed);
  }

  function deleteChatSession(context: SessionUserContext, sessionId: string): SessionDeleteResponse {
    const { userKey } = context;
    const result = runtime.deleteChatSessionForUser(userKey, sessionId);
    if (!result.success) {
      throw deps.createError('无法删除该会话（至少需要保留一个会话）', 400);
    }

    return queryService.buildDeleteResponse(userKey, runtime.ensureUserSessions(userKey).get(result.activeSessionId)!);
  }

  function updateChatSession(context: SessionUserContext, sessionId: string, patch: unknown): SessionMutationResponse {
    const { userKey } = context;
    if (!sessionId) {
      throw deps.createError('sessionId 不能为空', 400);
    }

    const session = runtime.ensureUserSessions(userKey).get(sessionId);
    if (!session) {
      throw deps.createError('会话不存在', 400);
    }

    let parsedPatch: SessionChainPatch;
    try {
      parsedPatch = runtime.parseSessionChainPatch(patch);
    } catch (error) {
      throw deps.createError((error as Error).message, 400);
    }

    Object.assign(session, parsedPatch);
    runtime.applyNormalizedSessionChainSettings(session);
    runtime.applyNormalizedSessionDiscussionSettings(session);
    runtime.touchSession(session);
    return queryService.buildMutationResponse(userKey, session);
  }

  return {
    clearHistory,
    createChatSession,
    selectChatSession,
    renameChatSession,
    deleteChatSession,
    updateChatSession
  };
}
