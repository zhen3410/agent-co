import { ChatRuntime, UserChatSession } from '../runtime/chat-runtime';
import { enrichMessagesWithCallGraphs } from '../domain/message-call-graph';
import {
  SessionDeleteResponse,
  SessionHistoryResponse,
  SessionMutationResponse,
  SessionRenameResponse,
  SessionSelectionResponse,
  SessionUserContext
} from './session-service-types';

export interface SessionQueryServiceDependencies {
  runtime: ChatRuntime;
}

export interface SessionQueryService {
  resolveChatSession(context: SessionUserContext): { userKey: string; session: UserChatSession };
  getHistory(context: SessionUserContext, agents: unknown[]): SessionHistoryResponse;
  buildMutationResponse(userKey: string, session: UserChatSession): SessionMutationResponse;
  buildSelectionResponse(userKey: string, session: UserChatSession): SessionSelectionResponse;
  buildRenameResponse(userKey: string, session: UserChatSession): SessionRenameResponse;
  buildDeleteResponse(userKey: string, session: UserChatSession): SessionDeleteResponse;
}

export function createSessionQueryService(deps: SessionQueryServiceDependencies): SessionQueryService {
  const { runtime } = deps;

  function resolveChatSession(context: SessionUserContext): { userKey: string; session: UserChatSession } {
    const { userKey } = context;
    return { userKey, session: runtime.resolveActiveSession(userKey) };
  }

  function getHistory(context: SessionUserContext, agents: unknown[]): SessionHistoryResponse {
    const { userKey, session } = resolveChatSession(context);
    const normalizedSession = runtime.buildDetailedSessionResponse(session);

    return {
      messages: enrichMessagesWithCallGraphs(normalizedSession.history),
      agents,
      currentAgent: runtime.getUserCurrentAgent(userKey, normalizedSession.id),
      enabledAgents: runtime.getSessionEnabledAgents(normalizedSession),
      agentWorkdirs: normalizedSession.agentWorkdirs || {},
      session: normalizedSession,
      chatSessions: runtime.getSessionSummaries(userKey),
      activeSessionId: normalizedSession.id
    };
  }

  function buildMutationResponse(userKey: string, session: UserChatSession): SessionMutationResponse {
    const normalizedSession = runtime.buildSessionResponse(session);
    return {
      success: true,
      session: normalizedSession,
      enabledAgents: runtime.getSessionEnabledAgents(normalizedSession),
      chatSessions: runtime.getSessionSummaries(userKey),
      activeSessionId: runtime.resolveActiveSession(userKey).id
    };
  }

  function buildSelectionResponse(userKey: string, session: UserChatSession): SessionSelectionResponse {
    const normalizedSession = runtime.buildDetailedSessionResponse(session);
    return {
      success: true,
      messages: enrichMessagesWithCallGraphs(normalizedSession.history),
      currentAgent: runtime.getUserCurrentAgent(userKey, normalizedSession.id),
      enabledAgents: runtime.getSessionEnabledAgents(normalizedSession),
      session: normalizedSession,
      activeSessionId: normalizedSession.id,
      chatSessions: runtime.getSessionSummaries(userKey)
    };
  }

  function buildRenameResponse(userKey: string, session: UserChatSession): SessionRenameResponse {
    return {
      success: true,
      session: runtime.buildSessionResponse(session),
      chatSessions: runtime.getSessionSummaries(userKey)
    };
  }

  function buildDeleteResponse(userKey: string, session: UserChatSession): SessionDeleteResponse {
    const normalizedSession = runtime.buildDetailedSessionResponse(session);
    return {
      success: true,
      activeSessionId: normalizedSession.id,
      messages: enrichMessagesWithCallGraphs(normalizedSession.history),
      currentAgent: runtime.getUserCurrentAgent(userKey, normalizedSession.id),
      enabledAgents: runtime.getSessionEnabledAgents(normalizedSession),
      session: normalizedSession,
      chatSessions: runtime.getSessionSummaries(userKey)
    };
  }

  return {
    resolveChatSession,
    getHistory,
    buildMutationResponse,
    buildSelectionResponse,
    buildRenameResponse,
    buildDeleteResponse
  };
}
