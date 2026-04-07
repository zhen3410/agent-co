import { ChatRuntime, UserChatSession } from '../runtime/chat-runtime';
import {
  SessionAgentToggleResponse,
  SessionServiceErrorFactory,
  SessionSwitchAgentResponse,
  SessionUserContext,
  SessionWorkdirResponse
} from './session-service-types';
import { SessionQueryService } from './session-query-service';

export interface SessionAgentServiceDependencies {
  runtime: ChatRuntime;
  queryService: SessionQueryService;
  hasAgent(agentName: string): boolean;
  createError: SessionServiceErrorFactory;
}

export interface SessionAgentService {
  setSessionAgent(context: SessionUserContext, payload: { sessionId?: string; agentName: string; enabled: boolean }): SessionAgentToggleResponse;
  switchAgent(context: SessionUserContext, agentName?: string | null): SessionSwitchAgentResponse;
  setWorkdir(context: SessionUserContext, agentName: string, workdir: string | null): SessionWorkdirResponse;
  getEnabledAgents(session: UserChatSession): string[];
  isAgentEnabled(session: UserChatSession, agentName: string): boolean;
  getCurrentAgent(userKey: string, sessionId: string): string | null;
  selectCurrentAgent(userKey: string, sessionId: string, agentName: string | null): void;
  expireInvalidCurrentAgent(userKey: string, session: UserChatSession): string | null;
  getAgentWorkdir(userKey: string, sessionId: string, agentName: string): string | null;
}

export function createSessionAgentService(deps: SessionAgentServiceDependencies): SessionAgentService {
  const { runtime } = deps;

  function setSessionAgent(context: SessionUserContext, payload: { sessionId?: string; agentName: string; enabled: boolean }): SessionAgentToggleResponse {
    const { userKey, session } = deps.queryService.resolveChatSession(context);
    const sessionId = (payload.sessionId || session.id).trim() || session.id;
    const agentName = (payload.agentName || '').trim();

    if (!agentName || !deps.hasAgent(agentName)) {
      throw deps.createError('智能体不存在', 400);
    }

    if (typeof payload.enabled !== 'boolean') {
      throw deps.createError('enabled 必须是布尔值', 400);
    }

    const result = runtime.setSessionEnabledAgent(userKey, sessionId, agentName, payload.enabled);
    if (!result) {
      throw deps.createError('会话不存在', 400);
    }

    return {
      success: true,
      ...result
    };
  }

  function switchAgent(context: SessionUserContext, agentName?: string | null): SessionSwitchAgentResponse {
    const { userKey, session } = deps.queryService.resolveChatSession(context);
    if (agentName && deps.hasAgent(agentName) && runtime.isAgentEnabledForSession(session, agentName)) {
      runtime.setUserCurrentAgent(userKey, session.id, agentName);
      return { success: true, currentAgent: agentName };
    }
    if (agentName && deps.hasAgent(agentName)) {
      throw deps.createError(`智能体未在当前会话启用: ${agentName}`, 400);
    }
    if (!agentName) {
      runtime.setUserCurrentAgent(userKey, session.id, null);
      return { success: true, currentAgent: null };
    }
    throw deps.createError(`未知的智能体: ${agentName}`, 400);
  }

  function setWorkdir(context: SessionUserContext, agentName: string, workdir: string | null): SessionWorkdirResponse {
    const { userKey, session } = deps.queryService.resolveChatSession(context);
    const normalizedAgentName = (agentName || '').trim();
    if (!normalizedAgentName || !deps.hasAgent(normalizedAgentName)) {
      throw deps.createError('智能体不存在', 400);
    }
    if (!workdir) {
      runtime.setUserAgentWorkdir(userKey, session.id, normalizedAgentName, null);
      return { success: true, workdir: '' };
    }
    runtime.setUserAgentWorkdir(userKey, session.id, normalizedAgentName, workdir);
    return { success: true, workdir };
  }

  function getEnabledAgents(session: UserChatSession): string[] {
    return runtime.getSessionEnabledAgents(session);
  }

  function isAgentEnabled(session: UserChatSession, agentName: string): boolean {
    return runtime.isAgentEnabledForSession(session, agentName);
  }

  function getCurrentAgent(userKey: string, sessionId: string): string | null {
    return runtime.getUserCurrentAgent(userKey, sessionId);
  }

  function selectCurrentAgent(userKey: string, sessionId: string, agentName: string | null): void {
    runtime.setUserCurrentAgent(userKey, sessionId, agentName);
  }

  function expireInvalidCurrentAgent(userKey: string, session: UserChatSession): string | null {
    return runtime.expireDisabledCurrentAgent(userKey, session);
  }

  function getAgentWorkdir(userKey: string, sessionId: string, agentName: string): string | null {
    return runtime.getUserAgentWorkdir(userKey, sessionId, agentName);
  }

  return {
    setSessionAgent,
    switchAgent,
    setWorkdir,
    getEnabledAgents,
    isAgentEnabled,
    getCurrentAgent,
    selectCurrentAgent,
    expireInvalidCurrentAgent,
    getAgentWorkdir
  };
}
