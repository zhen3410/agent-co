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
  getAgentNames(): string[];
  hasAgent(agentName: string): boolean;
}

export interface SessionUserContext {
  userKey: string;
}

export interface SummaryContinuationState {
  discussionState: DiscussionState;
  pendingAgentTasks?: PendingAgentDispatchTask[];
  pendingVisibleMessages?: Message[];
}

export interface SessionService {
  resolveChatSession(context: SessionUserContext): { userKey: string; session: UserChatSession };
  getHistory(context: SessionUserContext, agents: unknown[]): { messages: Message[]; agents: unknown[]; currentAgent: string | null; enabledAgents: string[]; agentWorkdirs: Record<string, string>; session: ReturnType<ChatRuntime['buildDetailedSessionResponse']>; chatSessions: ReturnType<ChatRuntime['getSessionSummaries']>; activeSessionId: string };
  clearHistory(context: SessionUserContext): { success: true };
  createChatSession(context: SessionUserContext, name?: string): { success: true; session: ReturnType<ChatRuntime['buildSessionResponse']>; enabledAgents: string[]; chatSessions: ReturnType<ChatRuntime['getSessionSummaries']>; activeSessionId: string };
  selectChatSession(context: SessionUserContext, sessionId: string): { success: true; messages: Message[]; currentAgent: string | null; enabledAgents: string[]; session: ReturnType<ChatRuntime['buildDetailedSessionResponse']>; activeSessionId: string; chatSessions: ReturnType<ChatRuntime['getSessionSummaries']> };
  renameChatSession(context: SessionUserContext, sessionId: string, name: string): { success: true; session: ReturnType<ChatRuntime['buildSessionResponse']>; chatSessions: ReturnType<ChatRuntime['getSessionSummaries']> };
  deleteChatSession(context: SessionUserContext, sessionId: string): { success: true; activeSessionId: string; messages: Message[]; currentAgent: string | null; enabledAgents: string[]; session: ReturnType<ChatRuntime['buildDetailedSessionResponse']>; chatSessions: ReturnType<ChatRuntime['getSessionSummaries']> };
  updateChatSession(context: SessionUserContext, sessionId: string, patch: unknown): { success: true; session: ReturnType<ChatRuntime['buildSessionResponse']>; enabledAgents: string[]; chatSessions: ReturnType<ChatRuntime['getSessionSummaries']>; activeSessionId: string };
  setSessionAgent(context: SessionUserContext, payload: { sessionId?: string; agentName: string; enabled: boolean }): { success: true; enabledAgents: string[]; currentAgentWillExpire: boolean };
  switchAgent(context: SessionUserContext, agentName?: string | null): { success: true; currentAgent: string | null };
  setWorkdir(context: SessionUserContext, agentName: string, workdir: string | null): { success: true; workdir: string };
  getEnabledAgents(session: UserChatSession): string[];
  isAgentEnabled(session: UserChatSession, agentName: string): boolean;
  getCurrentAgent(userKey: string, sessionId: string): string | null;
  selectCurrentAgent(userKey: string, sessionId: string, agentName: string | null): void;
  expireInvalidCurrentAgent(userKey: string, session: UserChatSession): string | null;
  getAgentWorkdir(userKey: string, sessionId: string, agentName: string): string | null;
  appendMessage(session: UserChatSession, message: Message): void;
  prepareForIncomingMessage(session: UserChatSession): void;
  updatePendingExecution(session: UserChatSession, pendingTasks?: PendingAgentDispatchTask[], pendingVisibleMessages?: Message[]): void;
  takePendingExecution(session: UserChatSession): { pendingTasks: PendingAgentDispatchTask[]; pendingVisibleMessages: Message[] };
  setDiscussionState(session: UserChatSession, discussionState: DiscussionState): void;
  isSessionSummaryInProgress(userKey: string, session: UserChatSession): boolean;
  snapshotSummaryContinuationState(session: UserChatSession): SummaryContinuationState;
  restoreSummaryContinuationState(session: UserChatSession, snapshot: SummaryContinuationState): void;
  markSummaryInProgress(session: UserChatSession): void;
  resolveManualSummaryAgent(session: UserChatSession): string | null;
  buildManualSummaryPrompt(session: UserChatSession): string;
  buildNoEnabledAgentsNotice(session: UserChatSession, ignoredMentions?: string[]): string;
}

export function createSessionService(deps: SessionServiceDependencies): SessionService {
  const { runtime } = deps;

  function resolveChatSession(context: SessionUserContext): { userKey: string; session: UserChatSession } {
    const { userKey } = context;
    return { userKey, session: runtime.resolveActiveSession(userKey) };
  }

  function getHistory(context: SessionUserContext, agents: unknown[]) {
    const { userKey, session } = resolveChatSession(context);
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

  function clearHistory(context: SessionUserContext): { success: true } {
    const { userKey, session } = resolveChatSession(context);
    runtime.clearUserHistory(userKey, session.id);
    return { success: true };
  }

  function createChatSession(context: SessionUserContext, name?: string) {
    const { userKey } = context;
    const session = runtime.buildSessionResponse(runtime.createChatSessionForUser(userKey, name));
    return {
      success: true as const,
      session,
      enabledAgents: runtime.getSessionEnabledAgents(session),
      chatSessions: runtime.getSessionSummaries(userKey),
      activeSessionId: session.id
    };
  }

  function selectChatSession(context: SessionUserContext, sessionId: string) {
    const { userKey } = context;
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

  function renameChatSession(context: SessionUserContext, sessionId: string, name: string) {
    const { userKey } = context;
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

  function deleteChatSession(context: SessionUserContext, sessionId: string) {
    const { userKey } = context;
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

  function updateChatSession(context: SessionUserContext, sessionId: string, patch: unknown) {
    const { userKey } = context;
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

  function setSessionAgent(context: SessionUserContext, payload: { sessionId?: string; agentName: string; enabled: boolean }) {
    const { userKey, session } = resolveChatSession(context);
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

  function switchAgent(context: SessionUserContext, agentName?: string | null) {
    const { userKey, session } = resolveChatSession(context);
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

  function setWorkdir(context: SessionUserContext, agentName: string, workdir: string | null) {
    const { userKey, session } = resolveChatSession(context);
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

  function appendMessage(session: UserChatSession, message: Message): void {
    session.history.push(message);
    runtime.touchSession(session);
  }

  function prepareForIncomingMessage(session: UserChatSession): void {
    session.discussionState = 'active';
    session.pendingAgentTasks = undefined;
    session.pendingVisibleMessages = undefined;
    runtime.touchSession(session);
  }

  function updatePendingExecution(session: UserChatSession, pendingTasks?: PendingAgentDispatchTask[], pendingVisibleMessages?: Message[]): void {
    session.pendingAgentTasks = pendingTasks && pendingTasks.length > 0
      ? pendingTasks.map(task => ({ ...task }))
      : undefined;
    session.pendingVisibleMessages = pendingVisibleMessages && pendingVisibleMessages.length > 0
      ? pendingVisibleMessages.map(message => ({ ...message }))
      : undefined;
    runtime.touchSession(session);
  }

  function takePendingExecution(session: UserChatSession): { pendingTasks: PendingAgentDispatchTask[]; pendingVisibleMessages: Message[] } {
    const pendingVisibleMessages = Array.isArray(session.pendingVisibleMessages)
      ? session.pendingVisibleMessages.map(message => ({ ...message }))
      : [];
    const pendingTasks = Array.isArray(session.pendingAgentTasks)
      ? session.pendingAgentTasks.map(task => ({ ...task }))
      : [];

    if (pendingVisibleMessages.length === 0 && pendingTasks.length === 0) {
      return {
        pendingTasks,
        pendingVisibleMessages
      };
    }

    session.pendingVisibleMessages = undefined;
    session.pendingAgentTasks = undefined;
    runtime.touchSession(session);

    return {
      pendingTasks,
      pendingVisibleMessages
    };
  }

  function setDiscussionState(session: UserChatSession, discussionState: DiscussionState): void {
    session.discussionState = discussionState;
    runtime.touchSession(session);
  }

  function isSessionSummaryInProgress(userKey: string, session: UserChatSession): boolean {
    return runtime.normalizeDiscussionMode(session.discussionMode) === 'peer'
      && (runtime.normalizeDiscussionState(session.discussionState) === 'summarizing'
        || runtime.hasSummaryRequest(`${userKey}::${session.id}`));
  }

  function snapshotSummaryContinuationState(session: UserChatSession): SummaryContinuationState {
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

  function restoreSummaryContinuationState(session: UserChatSession, snapshot: SummaryContinuationState): void {
    session.pendingAgentTasks = snapshot.pendingAgentTasks && snapshot.pendingAgentTasks.length > 0
      ? snapshot.pendingAgentTasks.map(task => ({ ...task }))
      : undefined;
    session.pendingVisibleMessages = snapshot.pendingVisibleMessages && snapshot.pendingVisibleMessages.length > 0
      ? snapshot.pendingVisibleMessages.map(message => ({ ...message }))
      : undefined;
    session.discussionState = snapshot.discussionState === 'active' ? 'active' : 'paused';
    runtime.touchSession(session);
  }

  function markSummaryInProgress(session: UserChatSession): void {
    session.discussionState = 'summarizing';
    session.pendingAgentTasks = undefined;
    session.pendingVisibleMessages = undefined;
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
    getEnabledAgents,
    isAgentEnabled,
    getCurrentAgent,
    selectCurrentAgent,
    expireInvalidCurrentAgent,
    getAgentWorkdir,
    appendMessage,
    prepareForIncomingMessage,
    updatePendingExecution,
    takePendingExecution,
    setDiscussionState,
    isSessionSummaryInProgress,
    snapshotSummaryContinuationState,
    restoreSummaryContinuationState,
    markSummaryInProgress,
    resolveManualSummaryAgent,
    buildManualSummaryPrompt,
    buildNoEnabledAgentsNotice
  };
}
