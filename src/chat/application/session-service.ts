import * as http from 'http';
import { DiscussionMode, DiscussionState, Message } from '../../types';
import { ChatRuntime, UserChatSession, PendingAgentDispatchTask, SessionChainPatch } from '../runtime/chat-runtime';

export class SessionServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'SessionServiceError';
  }
}

export interface SessionServiceDependencies {
  runtime: ChatRuntime;
  getUserKeyFromRequest(req: http.IncomingMessage): string;
  getAgentNames(): string[];
  hasAgent(agentName: string): boolean;
}

export interface SessionService {
  resolveChatSession(req: http.IncomingMessage): { userKey: string; session: UserChatSession };
  getHistory(req: http.IncomingMessage, agents: unknown[]): { messages: Message[]; agents: unknown[]; currentAgent: string | null; enabledAgents: string[]; agentWorkdirs: Record<string, string>; session: ReturnType<ChatRuntime['buildDetailedSessionResponse']>; chatSessions: ReturnType<ChatRuntime['getSessionSummaries']>; activeSessionId: string };
  clearHistory(req: http.IncomingMessage): { success: true };
  createChatSession(req: http.IncomingMessage, name?: string): { success: true; session: ReturnType<ChatRuntime['buildSessionResponse']>; enabledAgents: string[]; chatSessions: ReturnType<ChatRuntime['getSessionSummaries']>; activeSessionId: string };
  selectChatSession(req: http.IncomingMessage, sessionId: string): { success: true; messages: Message[]; currentAgent: string | null; enabledAgents: string[]; session: ReturnType<ChatRuntime['buildDetailedSessionResponse']>; activeSessionId: string; chatSessions: ReturnType<ChatRuntime['getSessionSummaries']> };
  renameChatSession(req: http.IncomingMessage, sessionId: string, name: string): { success: true; session: ReturnType<ChatRuntime['buildSessionResponse']>; chatSessions: ReturnType<ChatRuntime['getSessionSummaries']> };
  deleteChatSession(req: http.IncomingMessage, sessionId: string): { success: true; activeSessionId: string; messages: Message[]; currentAgent: string | null; enabledAgents: string[]; session: ReturnType<ChatRuntime['buildDetailedSessionResponse']>; chatSessions: ReturnType<ChatRuntime['getSessionSummaries']> };
  updateChatSession(req: http.IncomingMessage, sessionId: string, patch: unknown): { success: true; session: ReturnType<ChatRuntime['buildSessionResponse']>; enabledAgents: string[]; chatSessions: ReturnType<ChatRuntime['getSessionSummaries']>; activeSessionId: string };
  setSessionAgent(req: http.IncomingMessage, payload: { sessionId?: string; agentName: string; enabled: boolean }): { success: true; enabledAgents: string[]; currentAgentWillExpire: boolean };
  switchAgent(req: http.IncomingMessage, agentName?: string | null): { success: true; currentAgent: string | null };
  setWorkdir(req: http.IncomingMessage, agentName: string, workdir: string | null): { success: true; workdir: string };
  getSessionEnabledAgents(session: UserChatSession): string[];
  isAgentEnabledForSession(session: UserChatSession, agentName: string): boolean;
  expireDisabledCurrentAgent(userKey: string, session: UserChatSession): string | null;
  setUserCurrentAgent(userKey: string, sessionId: string, agentName: string | null): void;
  touchSession(session: UserChatSession): void;
  getUserCurrentAgent(userKey: string, sessionId: string): string | null;
  getUserAgentWorkdir(userKey: string, sessionId: string, agentName: string): string | null;
  isSessionSummaryInProgress(userKey: string, session: UserChatSession): boolean;
  snapshotSummaryContinuationState(session: UserChatSession): { discussionState: DiscussionState; pendingAgentTasks?: PendingAgentDispatchTask[]; pendingVisibleMessages?: Message[] };
  restoreSummaryContinuationState(session: UserChatSession, snapshot: { discussionState: DiscussionState; pendingAgentTasks?: PendingAgentDispatchTask[]; pendingVisibleMessages?: Message[] }): void;
  resolveManualSummaryAgent(session: UserChatSession): string | null;
  buildManualSummaryPrompt(session: UserChatSession): string;
  buildNoEnabledAgentsNotice(session: UserChatSession, ignoredMentions?: string[]): string;
}

export function createSessionService(deps: SessionServiceDependencies): SessionService {
  const { runtime } = deps;

  function resolveChatSession(req: http.IncomingMessage): { userKey: string; session: UserChatSession } {
    const userKey = deps.getUserKeyFromRequest(req);
    return { userKey, session: runtime.resolveActiveSession(userKey) };
  }

  function getHistory(req: http.IncomingMessage, agents: unknown[]) {
    const { userKey, session } = resolveChatSession(req);
    const normalizedSession = runtime.buildDetailedSessionResponse(session);

    return {
      messages: normalizedSession.history,
      agents,
      currentAgent: runtime.getUserCurrentAgent(userKey, normalizedSession.id),
      enabledAgents: runtime.getSessionEnabledAgents(normalizedSession),
      agentWorkdirs: normalizedSession.agentWorkdirs || {},
      session: normalizedSession,
      chatSessions: runtime.getSessionSummaries(userKey),
      activeSessionId: normalizedSession.id
    };
  }

  function clearHistory(req: http.IncomingMessage): { success: true } {
    const { userKey, session } = resolveChatSession(req);
    runtime.clearUserHistory(userKey, session.id);
    return { success: true };
  }

  function createChatSession(req: http.IncomingMessage, name?: string) {
    const userKey = deps.getUserKeyFromRequest(req);
    const session = runtime.buildSessionResponse(runtime.createChatSessionForUser(userKey, name));
    return {
      success: true as const,
      session,
      enabledAgents: runtime.getSessionEnabledAgents(session),
      chatSessions: runtime.getSessionSummaries(userKey),
      activeSessionId: session.id
    };
  }

  function selectChatSession(req: http.IncomingMessage, sessionId: string) {
    const userKey = deps.getUserKeyFromRequest(req);
    if (!sessionId || !runtime.setActiveChatSession(userKey, sessionId)) {
      throw new SessionServiceError('会话不存在', 400);
    }

    const session = runtime.buildDetailedSessionResponse(runtime.ensureUserSessions(userKey).get(sessionId)!);
    return {
      success: true as const,
      messages: session.history,
      currentAgent: runtime.getUserCurrentAgent(userKey, session.id),
      enabledAgents: runtime.getSessionEnabledAgents(session),
      session,
      activeSessionId: session.id,
      chatSessions: runtime.getSessionSummaries(userKey)
    };
  }

  function renameChatSession(req: http.IncomingMessage, sessionId: string, name: string) {
    const userKey = deps.getUserKeyFromRequest(req);
    const renamed = runtime.renameChatSessionForUser(userKey, sessionId, name);
    if (!renamed) {
      throw new SessionServiceError('会话不存在', 400);
    }

    return {
      success: true as const,
      session: runtime.buildSessionResponse(renamed),
      chatSessions: runtime.getSessionSummaries(userKey)
    };
  }

  function deleteChatSession(req: http.IncomingMessage, sessionId: string) {
    const userKey = deps.getUserKeyFromRequest(req);
    const result = runtime.deleteChatSessionForUser(userKey, sessionId);
    if (!result.success) {
      throw new SessionServiceError('无法删除该会话（至少需要保留一个会话）', 400);
    }

    const active = runtime.buildDetailedSessionResponse(runtime.ensureUserSessions(userKey).get(result.activeSessionId)!);
    return {
      success: true as const,
      activeSessionId: active.id,
      messages: active.history,
      currentAgent: runtime.getUserCurrentAgent(userKey, active.id),
      enabledAgents: runtime.getSessionEnabledAgents(active),
      session: active,
      chatSessions: runtime.getSessionSummaries(userKey)
    };
  }

  function updateChatSession(req: http.IncomingMessage, sessionId: string, patch: unknown) {
    const userKey = deps.getUserKeyFromRequest(req);
    if (!sessionId) {
      throw new SessionServiceError('sessionId 不能为空', 400);
    }

    const session = runtime.ensureUserSessions(userKey).get(sessionId);
    if (!session) {
      throw new SessionServiceError('会话不存在', 400);
    }

    let parsedPatch: SessionChainPatch;
    try {
      parsedPatch = runtime.parseSessionChainPatch(patch);
    } catch (error) {
      throw new SessionServiceError((error as Error).message, 400);
    }

    Object.assign(session, parsedPatch);
    runtime.applyNormalizedSessionChainSettings(session);
    runtime.applyNormalizedSessionDiscussionSettings(session);
    runtime.touchSession(session);
    const normalizedSession = runtime.buildSessionResponse(session);

    return {
      success: true as const,
      session: normalizedSession,
      enabledAgents: runtime.getSessionEnabledAgents(normalizedSession),
      chatSessions: runtime.getSessionSummaries(userKey),
      activeSessionId: runtime.resolveActiveSession(userKey).id
    };
  }

  function setSessionAgent(req: http.IncomingMessage, payload: { sessionId?: string; agentName: string; enabled: boolean }) {
    const { userKey, session } = resolveChatSession(req);
    const sessionId = (payload.sessionId || session.id).trim() || session.id;
    const agentName = (payload.agentName || '').trim();

    if (!agentName || !deps.hasAgent(agentName)) {
      throw new SessionServiceError('智能体不存在', 400);
    }

    if (typeof payload.enabled !== 'boolean') {
      throw new SessionServiceError('enabled 必须是布尔值', 400);
    }

    const result = runtime.setSessionEnabledAgent(userKey, sessionId, agentName, payload.enabled);
    if (!result) {
      throw new SessionServiceError('会话不存在', 400);
    }

    return {
      success: true as const,
      ...result
    };
  }

  function switchAgent(req: http.IncomingMessage, agentName?: string | null) {
    const { userKey, session } = resolveChatSession(req);
    if (agentName && deps.hasAgent(agentName) && runtime.isAgentEnabledForSession(session, agentName)) {
      runtime.setUserCurrentAgent(userKey, session.id, agentName);
      return { success: true as const, currentAgent: agentName };
    }
    if (agentName && deps.hasAgent(agentName)) {
      throw new SessionServiceError(`智能体未在当前会话启用: ${agentName}`, 400);
    }
    if (!agentName) {
      runtime.setUserCurrentAgent(userKey, session.id, null);
      return { success: true as const, currentAgent: null };
    }
    throw new SessionServiceError(`未知的智能体: ${agentName}`, 400);
  }

  function setWorkdir(req: http.IncomingMessage, agentName: string, workdir: string | null) {
    const { userKey, session } = resolveChatSession(req);
    const normalizedAgentName = (agentName || '').trim();
    if (!normalizedAgentName || !deps.hasAgent(normalizedAgentName)) {
      throw new SessionServiceError('智能体不存在', 400);
    }
    if (!workdir) {
      runtime.setUserAgentWorkdir(userKey, session.id, normalizedAgentName, null);
      return { success: true as const, workdir: '' };
    }
    runtime.setUserAgentWorkdir(userKey, session.id, normalizedAgentName, workdir);
    return { success: true as const, workdir };
  }

  function isSessionSummaryInProgress(userKey: string, session: UserChatSession): boolean {
    return runtime.normalizeDiscussionMode(session.discussionMode) === 'peer'
      && (runtime.normalizeDiscussionState(session.discussionState) === 'summarizing'
        || runtime.hasSummaryRequest(`${userKey}::${session.id}`));
  }

  function snapshotSummaryContinuationState(session: UserChatSession): { discussionState: DiscussionState; pendingAgentTasks?: PendingAgentDispatchTask[]; pendingVisibleMessages?: Message[] } {
    return {
      discussionState: runtime.normalizeDiscussionState(session.discussionState),
      pendingAgentTasks: Array.isArray(session.pendingAgentTasks)
        ? session.pendingAgentTasks.map(task => ({ ...task }))
        : undefined,
      pendingVisibleMessages: Array.isArray(session.pendingVisibleMessages)
        ? session.pendingVisibleMessages.map(message => ({ ...message }))
        : undefined
    };
  }

  function restoreSummaryContinuationState(session: UserChatSession, snapshot: { discussionState: DiscussionState; pendingAgentTasks?: PendingAgentDispatchTask[]; pendingVisibleMessages?: Message[] }): void {
    session.pendingAgentTasks = snapshot.pendingAgentTasks && snapshot.pendingAgentTasks.length > 0
      ? snapshot.pendingAgentTasks.map(task => ({ ...task }))
      : undefined;
    session.pendingVisibleMessages = snapshot.pendingVisibleMessages && snapshot.pendingVisibleMessages.length > 0
      ? snapshot.pendingVisibleMessages.map(message => ({ ...message }))
      : undefined;
    session.discussionState = snapshot.discussionState === 'active' ? 'active' : 'paused';
    runtime.touchSession(session);
  }

  function resolveManualSummaryAgent(session: UserChatSession): string | null {
    const enabledAgents = runtime.getSessionEnabledAgents(session);
    if (enabledAgents.length === 0) {
      return null;
    }

    if (session.currentAgent && enabledAgents.includes(session.currentAgent)) {
      return session.currentAgent;
    }

    return enabledAgents[0] || null;
  }

  function buildManualSummaryPrompt(session: UserChatSession): string {
    const messageCount = Array.isArray(session.history) ? session.history.length : 0;
    return [
      '请基于当前对话生成一份简明总结。',
      '要求：',
      '1. 提炼主要观点、分歧与当前结论；',
      '2. 若结论未完全收敛，请明确说明；',
      '3. 不要继续点名其他智能体，不要恢复讨论链路；',
      `4. 当前会话消息数：${messageCount}。`
    ].join('\n');
  }

  function buildNoEnabledAgentsNotice(session: UserChatSession, ignoredMentions: string[] = []): string {
    if (ignoredMentions.length > 0) {
      return `${ignoredMentions.join('、')} 已停用，当前会话还没有可用智能体，请先启用上方智能体。`;
    }
    if (runtime.getSessionEnabledAgents(session).length === 0) {
      return '当前会话还没有启用智能体，请先启用上方智能体。';
    }
    return '当前会话没有可用智能体，请先启用上方智能体。';
  }

  return {
    resolveChatSession,
    getHistory,
    clearHistory,
    createChatSession,
    selectChatSession,
    renameChatSession,
    deleteChatSession,
    updateChatSession,
    setSessionAgent,
    switchAgent,
    setWorkdir,
    getSessionEnabledAgents: runtime.getSessionEnabledAgents,
    isAgentEnabledForSession: runtime.isAgentEnabledForSession,
    expireDisabledCurrentAgent: runtime.expireDisabledCurrentAgent,
    setUserCurrentAgent: runtime.setUserCurrentAgent,
    touchSession: runtime.touchSession,
    getUserCurrentAgent: runtime.getUserCurrentAgent,
    getUserAgentWorkdir: runtime.getUserAgentWorkdir,
    isSessionSummaryInProgress,
    snapshotSummaryContinuationState,
    restoreSummaryContinuationState,
    resolveManualSummaryAgent,
    buildManualSummaryPrompt,
    buildNoEnabledAgentsNotice
  };
}
