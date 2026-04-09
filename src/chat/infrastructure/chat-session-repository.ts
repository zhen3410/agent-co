import { Message, DiscussionMode, DiscussionState, AgentDispatchKind, InvocationTask } from '../../types';

export type AgentDispatchReviewMode = 'none' | 'caller_review';

export interface AgentDispatchTask {
  agentName: string;
  prompt: string;
  includeHistory: boolean;
  dispatchKind?: AgentDispatchKind;
  taskId?: string;
  callerAgentName?: string;
  calleeAgentName?: string;
  reviewMode?: AgentDispatchReviewMode;
  deadlineAt?: number;
  invocationTaskReviewVersion?: number;
}

export interface PendingAgentDispatchTask extends AgentDispatchTask {
  dispatchKind: AgentDispatchKind;
}

export interface UserChatSession {
  id: string;
  name: string;
  history: Message[];
  currentAgent: string | null;
  enabledAgents?: string[];
  agentWorkdirs?: Record<string, string>;
  agentChainMaxHops?: number;
  agentChainMaxCallsPerAgent?: number | null;
  discussionMode?: DiscussionMode;
  discussionState?: DiscussionState;
  pendingAgentTasks?: PendingAgentDispatchTask[];
  pendingVisibleMessages?: Message[];
  invocationTasks?: InvocationTask[];
  createdAt: number;
  updatedAt: number;
}

export interface RedisPersistedState {
  version: 1;
  userChatSessions: Record<string, UserChatSession[]>;
  userActiveChatSession: Record<string, string>;
}

export interface ChatSessionRepository {
  ensureUserSessions(userKey: string, factory: () => UserChatSession): Map<string, UserChatSession>;
  getUserSessions(userKey: string): Map<string, UserChatSession> | undefined;
  setUserSessions(userKey: string, sessions: Map<string, UserChatSession>): void;
  deleteUserSessions(userKey: string): void;
  clearUserSessions(): void;
  getActiveSessionId(userKey: string): string | undefined;
  setActiveSessionId(userKey: string, sessionId: string): void;
  deleteActiveSessionId(userKey: string): void;
  clearActiveSessionIds(): void;
  serializeState(): RedisPersistedState;
  appendCallbackMessage(sessionId: string, agentName: string, message: Message): void;
  consumeCallbackMessages(sessionId: string, agentName: string): Message[];
  getSessionById(sessionId: string): UserChatSession | null;
}

function getCallbackMessageKey(sessionId: string, agentName: string): string {
  return `${sessionId}::${agentName}`;
}

export function createChatSessionRepository(): ChatSessionRepository {
  const userChatSessions = new Map<string, Map<string, UserChatSession>>();
  const userActiveChatSession = new Map<string, string>();
  const callbackMessages = new Map<string, Message[]>();

  function ensureUserSessions(userKey: string, factory: () => UserChatSession): Map<string, UserChatSession> {
    let sessions = userChatSessions.get(userKey);
    if (!sessions) {
      const session = factory();
      sessions = new Map([[session.id, session]]);
      userChatSessions.set(userKey, sessions);
      userActiveChatSession.set(userKey, session.id);
    }
    return sessions;
  }

  function getUserSessions(userKey: string): Map<string, UserChatSession> | undefined {
    return userChatSessions.get(userKey);
  }

  function setUserSessions(userKey: string, sessions: Map<string, UserChatSession>): void {
    userChatSessions.set(userKey, sessions);
  }

  function deleteUserSessions(userKey: string): void {
    userChatSessions.delete(userKey);
  }

  function clearUserSessions(): void {
    userChatSessions.clear();
  }

  function getActiveSessionId(userKey: string): string | undefined {
    return userActiveChatSession.get(userKey);
  }

  function setActiveSessionId(userKey: string, sessionId: string): void {
    userActiveChatSession.set(userKey, sessionId);
  }

  function deleteActiveSessionId(userKey: string): void {
    userActiveChatSession.delete(userKey);
  }

  function clearActiveSessionIds(): void {
    userActiveChatSession.clear();
  }

  function serializeState(): RedisPersistedState {
    const serializedSessions: Record<string, UserChatSession[]> = {};
    for (const [userKey, sessions] of userChatSessions.entries()) {
      serializedSessions[userKey] = Array.from(sessions.values());
    }

    const serializedActive: Record<string, string> = {};
    for (const [userKey, sessionId] of userActiveChatSession.entries()) {
      serializedActive[userKey] = sessionId;
    }

    return {
      version: 1,
      userChatSessions: serializedSessions,
      userActiveChatSession: serializedActive
    };
  }

  function appendCallbackMessage(sessionId: string, agentName: string, message: Message): void {
    const key = getCallbackMessageKey(sessionId, agentName);
    const queue = callbackMessages.get(key) || [];
    queue.push(message);
    callbackMessages.set(key, queue);
  }

  function consumeCallbackMessages(sessionId: string, agentName: string): Message[] {
    const key = getCallbackMessageKey(sessionId, agentName);
    const queue = callbackMessages.get(key) || [];
    callbackMessages.delete(key);
    return queue;
  }

  function getSessionById(sessionId: string): UserChatSession | null {
    for (const sessions of userChatSessions.values()) {
      const found = sessions.get(sessionId);
      if (found) return found;
    }

    return null;
  }

  return {
    ensureUserSessions,
    getUserSessions,
    setUserSessions,
    deleteUserSessions,
    clearUserSessions,
    getActiveSessionId,
    setActiveSessionId,
    deleteActiveSessionId,
    clearActiveSessionIds,
    serializeState,
    appendCallbackMessage,
    consumeCallbackMessages,
    getSessionById
  };
}
