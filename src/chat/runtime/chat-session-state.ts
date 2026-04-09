import { DiscussionMode, DiscussionState, InvocationTask, InvocationTaskStatus, Message } from '../../types';
import { ChatSessionRepository, PendingAgentDispatchTask, UserChatSession } from '../infrastructure/chat-session-repository';
import {
  ChatRuntimeConfig,
  ChatSessionSummary,
  DetailedNormalizedUserChatSession,
  InvocationTaskUpdatePatch,
  NormalizedUserChatSession,
  SessionChainPatch,
  generateChatSessionId,
  normalizePositiveSessionSetting
} from './chat-runtime-types';
import {
  normalizeInvocationTaskRecord,
  TIMEOUT_ELIGIBLE_INVOCATION_TASK_STATUSES
} from './invocation-task-normalization';

const ACTIVE_INVOCATION_TASK_STATUSES = new Set<InvocationTaskStatus>([
  'pending_reply',
  'awaiting_caller_review'
]);

interface ChatSessionStateDependencies {
  config: Pick<ChatRuntimeConfig, 'defaultChatSessionId' | 'defaultChatSessionName' | 'getValidAgentNames'>;
  repository: ChatSessionRepository;
  schedulePersistChatSessions(): void;
  touchSession(session: UserChatSession): void;
  normalizeSessionChainSettings(source?: SessionChainPatch): Required<Pick<UserChatSession, 'agentChainMaxHops' | 'agentChainMaxCallsPerAgent'>>;
  normalizeSessionDiscussionSettings(source?: Pick<UserChatSession, 'discussionMode' | 'discussionState'>): Required<Pick<UserChatSession, 'discussionMode' | 'discussionState'>>;
  applyNormalizedSessionChainSettings<T extends UserChatSession>(session: T): T & Required<Pick<UserChatSession, 'agentChainMaxHops' | 'agentChainMaxCallsPerAgent'>>;
  applyNormalizedSessionDiscussionSettings<T extends UserChatSession>(session: T): T & Required<Pick<UserChatSession, 'discussionMode' | 'discussionState'>>;
}

interface ChatSessionState {
  createUserSession(name?: string): UserChatSession;
  createDefaultSession(): UserChatSession;
  normalizeSessionName(name: string | undefined): string;
  sanitizeEnabledAgents(...candidateLists: Array<string[] | undefined>): string[];
  ensureUserSessions(userKey: string): Map<string, UserChatSession>;
  resolveActiveSession(userKey: string): UserChatSession;
  getSessionSummaries(userKey: string): ChatSessionSummary[];
  getUserHistory(userKey: string, sessionId: string): Message[];
  getUserCurrentAgent(userKey: string, sessionId: string): string | null;
  setUserCurrentAgent(userKey: string, sessionId: string, agentName: string | null): void;
  clearUserHistory(userKey: string, sessionId: string): void;
  setActiveChatSession(userKey: string, sessionId: string): boolean;
  createChatSessionForUser(userKey: string, name?: string): UserChatSession;
  renameChatSessionForUser(userKey: string, sessionId: string, name: string): UserChatSession | null;
  deleteChatSessionForUser(userKey: string, sessionId: string): { success: boolean; activeSessionId: string };
  migrateLegacySessionUserData(oldUserKey: string, newUserKey: string): void;
  isChatSessionActive(): boolean;
  getSessionById(sessionId: string): UserChatSession | null;
  getUserAgentWorkdir(userKey: string, sessionId: string, agentName: string): string | null;
  setUserAgentWorkdir(userKey: string, sessionId: string, agentName: string, workdir: string | null): void;
  getSessionEnabledAgents(session: UserChatSession): string[];
  isAgentEnabledForSession(session: UserChatSession, agentName: string): boolean;
  setSessionEnabledAgent(userKey: string, sessionId: string, agentName: string, enabled: boolean): { enabledAgents: string[]; currentAgentWillExpire: boolean } | null;
  expireDisabledCurrentAgent(userKey: string, session: UserChatSession): string | null;
  createInvocationTask(userKey: string, sessionId: string, task: InvocationTask): InvocationTask | null;
  updateInvocationTask(userKey: string, sessionId: string, taskId: string, patch: InvocationTaskUpdatePatch): InvocationTask | null;
  listInvocationTasks(userKey: string, sessionId: string): InvocationTask[];
  listActiveInvocationTasks(userKey: string, sessionId: string): InvocationTask[];
  resolveOverdueInvocationTasks(userKey: string, sessionId: string, now?: number): InvocationTask[];
  markInvocationTaskCompleted(userKey: string, sessionId: string, taskId: string): InvocationTask | null;
  markInvocationTaskFailed(userKey: string, sessionId: string, taskId: string, reason?: string): InvocationTask | null;
  buildSessionResponse(session: UserChatSession): NormalizedUserChatSession;
  buildDetailedSessionResponse(session: UserChatSession): DetailedNormalizedUserChatSession;
  parseSessionChainPatch(patch: unknown): SessionChainPatch;
}

export function createChatSessionState(deps: ChatSessionStateDependencies): ChatSessionState {
  function normalizeSessionName(name: string | undefined): string {
    const trimmed = (name || '').trim();
    return trimmed ? trimmed.slice(0, 40) : deps.config.defaultChatSessionName;
  }

  function createUserSession(name?: string): UserChatSession {
    const now = Date.now();
    return {
      id: generateChatSessionId(),
      name: normalizeSessionName(name),
      history: [],
      currentAgent: null,
      enabledAgents: [],
      agentWorkdirs: {},
      invocationTasks: [],
      ...deps.normalizeSessionChainSettings(),
      ...deps.normalizeSessionDiscussionSettings(),
      createdAt: now,
      updatedAt: now
    };
  }

  function createDefaultSession(): UserChatSession {
    const session = createUserSession(deps.config.defaultChatSessionName);
    session.id = deps.config.defaultChatSessionId;
    return session;
  }

  function ensureUserSessions(userKey: string): Map<string, UserChatSession> {
    const existed = deps.repository.getUserSessions(userKey);
    const sessions = deps.repository.ensureUserSessions(userKey, createDefaultSession);
    if (!existed) {
      deps.schedulePersistChatSessions();
    }
    return sessions;
  }

  function sanitizeEnabledAgents(...candidateLists: Array<string[] | undefined>): string[] {
    const validAgentNames = new Set(deps.config.getValidAgentNames());
    for (const candidate of candidateLists) {
      if (!Array.isArray(candidate)) continue;
      const filtered = candidate.filter(name => typeof name === 'string' && validAgentNames.has(name));
      return [...new Set(filtered)];
    }
    return deps.config.getValidAgentNames();
  }

  function normalizeInvocationTask(task: unknown, sessionId: string): InvocationTask | null {
    return normalizeInvocationTaskRecord(task, sessionId);
  }

  function normalizeInvocationTasks(session: UserChatSession): InvocationTask[] {
    const source = Array.isArray(session.invocationTasks) ? session.invocationTasks : [];
    const normalized = source
      .map(task => normalizeInvocationTask(task, session.id))
      .filter((task): task is InvocationTask => task !== null);
    session.invocationTasks = normalized;
    return normalized;
  }

  function cloneInvocationTask(task: InvocationTask): InvocationTask {
    return { ...task };
  }

  function isInvocationTaskTerminalStatus(status: InvocationTask['status']): boolean {
    return status === 'completed' || status === 'failed';
  }

  function buildSessionResponse(session: UserChatSession): NormalizedUserChatSession {
    const normalized = deps.normalizeSessionChainSettings(session);
    const discussion = deps.normalizeSessionDiscussionSettings(session);
    return {
      ...session,
      history: Array.isArray(session.history) ? [...session.history] : [],
      enabledAgents: Array.isArray(session.enabledAgents) ? [...session.enabledAgents] : undefined,
      agentWorkdirs: session.agentWorkdirs ? { ...session.agentWorkdirs } : {},
      pendingAgentTasks: Array.isArray(session.pendingAgentTasks)
        ? session.pendingAgentTasks.map(task => ({ ...task }))
        : undefined,
      pendingVisibleMessages: Array.isArray(session.pendingVisibleMessages)
        ? session.pendingVisibleMessages.map(message => ({ ...message }))
        : undefined,
      invocationTasks: normalizeInvocationTasks(session).map(cloneInvocationTask),
      agentChainMaxHops: normalized.agentChainMaxHops,
      agentChainMaxCallsPerAgent: normalized.agentChainMaxCallsPerAgent,
      discussionMode: discussion.discussionMode,
      discussionState: discussion.discussionState
    };
  }

  function getSessionEnabledAgents(session: UserChatSession): string[] {
    const sanitized = sanitizeEnabledAgents(session.enabledAgents);
    if (!Array.isArray(session.enabledAgents) || session.enabledAgents.length !== sanitized.length) {
      session.enabledAgents = sanitized;
    }
    return sanitized;
  }

  function buildDetailedSessionResponse(session: UserChatSession): DetailedNormalizedUserChatSession {
    const normalizedSession = buildSessionResponse(session);
    return {
      ...normalizedSession,
      enabledAgents: getSessionEnabledAgents(normalizedSession),
      agentWorkdirs: normalizedSession.agentWorkdirs || {}
    };
  }

  function isAgentEnabledForSession(session: UserChatSession, agentName: string): boolean {
    return getSessionEnabledAgents(session).includes(agentName);
  }

  function setUserCurrentAgent(userKey: string, sessionId: string, agentName: string | null): void {
    const session = ensureUserSessions(userKey).get(sessionId);
    if (!session) return;
    session.currentAgent = agentName;
    deps.touchSession(session);
  }

  function expireDisabledCurrentAgent(userKey: string, session: UserChatSession): string | null {
    if (!session.currentAgent) return null;
    if (isAgentEnabledForSession(session, session.currentAgent)) {
      return session.currentAgent;
    }
    setUserCurrentAgent(userKey, session.id, null);
    return null;
  }

  function getUserCurrentAgent(userKey: string, sessionId: string): string | null {
    const session = ensureUserSessions(userKey).get(sessionId);
    if (!session) return null;
    return expireDisabledCurrentAgent(userKey, session);
  }

  function setSessionEnabledAgent(userKey: string, sessionId: string, agentName: string, enabled: boolean): { enabledAgents: string[]; currentAgentWillExpire: boolean } | null {
    const session = ensureUserSessions(userKey).get(sessionId);
    if (!session) return null;

    const enabledSet = new Set(getSessionEnabledAgents(session));
    if (enabled) {
      enabledSet.add(agentName);
    } else {
      enabledSet.delete(agentName);
    }

    session.enabledAgents = deps.config.getValidAgentNames().filter(name => enabledSet.has(name));
    const currentAgentWillExpire = !enabled && session.currentAgent === agentName;
    deps.touchSession(session);
    return {
      enabledAgents: [...session.enabledAgents],
      currentAgentWillExpire
    };
  }

  function resolveActiveSession(userKey: string): UserChatSession {
    const sessions = ensureUserSessions(userKey);
    const activeSessionId = deps.repository.getActiveSessionId(userKey) || deps.config.defaultChatSessionId;
    const activeSession = sessions.get(activeSessionId) || sessions.values().next().value;

    if (!activeSession) {
      const fallback = createDefaultSession();
      sessions.set(fallback.id, fallback);
      deps.repository.setActiveSessionId(userKey, fallback.id);
      return fallback;
    }

    normalizeInvocationTasks(activeSession);
    deps.repository.setActiveSessionId(userKey, activeSession.id);
    return activeSession;
  }

  function getSessionSummaries(userKey: string): ChatSessionSummary[] {
    const sessions = ensureUserSessions(userKey);
    return Array.from(sessions.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((session) => {
        normalizeInvocationTasks(session);
        const normalized = deps.normalizeSessionChainSettings(session);
        const discussion = deps.normalizeSessionDiscussionSettings(session);
        return {
          id: session.id,
          name: session.name,
          messageCount: session.history.length,
          updatedAt: session.updatedAt,
          createdAt: session.createdAt,
          agentChainMaxHops: normalized.agentChainMaxHops,
          agentChainMaxCallsPerAgent: normalized.agentChainMaxCallsPerAgent,
          discussionMode: discussion.discussionMode,
          discussionState: discussion.discussionState
        };
      });
  }

  function getUserHistory(userKey: string, sessionId: string): Message[] {
    const session = ensureUserSessions(userKey).get(sessionId);
    if (!session) return [];
    normalizeInvocationTasks(session);
    return session.history || [];
  }

  function clearUserHistory(userKey: string, sessionId: string): void {
    const session = ensureUserSessions(userKey).get(sessionId);
    if (!session) return;
    session.history = [];
    session.currentAgent = null;
    deps.touchSession(session);
  }

  function setActiveChatSession(userKey: string, sessionId: string): boolean {
    const sessions = ensureUserSessions(userKey);
    if (!sessions.has(sessionId)) return false;
    deps.repository.setActiveSessionId(userKey, sessionId);
    deps.schedulePersistChatSessions();
    return true;
  }

  function createChatSessionForUser(userKey: string, name?: string): UserChatSession {
    const sessions = ensureUserSessions(userKey);
    const newSession = createUserSession(name);
    sessions.set(newSession.id, newSession);
    deps.repository.setActiveSessionId(userKey, newSession.id);
    deps.schedulePersistChatSessions();
    return newSession;
  }

  function renameChatSessionForUser(userKey: string, sessionId: string, name: string): UserChatSession | null {
    const session = ensureUserSessions(userKey).get(sessionId);
    if (!session) return null;
    session.name = normalizeSessionName(name);
    deps.touchSession(session);
    return session;
  }

  function deleteChatSessionForUser(userKey: string, sessionId: string): { success: boolean; activeSessionId: string } {
    const sessions = ensureUserSessions(userKey);
    if (sessions.size <= 1 || !sessions.has(sessionId)) {
      return { success: false, activeSessionId: deps.repository.getActiveSessionId(userKey) || deps.config.defaultChatSessionId };
    }

    sessions.delete(sessionId);
    const currentActive = deps.repository.getActiveSessionId(userKey);
    if (currentActive === sessionId) {
      const fallback = sessions.values().next().value as UserChatSession;
      deps.repository.setActiveSessionId(userKey, fallback.id);
    }

    deps.schedulePersistChatSessions();

    return { success: true, activeSessionId: deps.repository.getActiveSessionId(userKey) || deps.config.defaultChatSessionId };
  }

  function getUserAgentWorkdir(userKey: string, sessionId: string, agentName: string): string | null {
    const value = ensureUserSessions(userKey).get(sessionId)?.agentWorkdirs?.[agentName];
    return value && value.trim() ? value : null;
  }

  function setUserAgentWorkdir(userKey: string, sessionId: string, agentName: string, workdir: string | null): void {
    const session = ensureUserSessions(userKey).get(sessionId);
    if (!session) return;
    session.agentWorkdirs = session.agentWorkdirs || {};
    if (!workdir) {
      delete session.agentWorkdirs[agentName];
    } else {
      session.agentWorkdirs[agentName] = workdir;
    }
    deps.touchSession(session);
  }

  function mergeSessionMaps(target: Map<string, UserChatSession>, source: Map<string, UserChatSession>): void {
    for (const [sessionId, sourceSession] of source.entries()) {
      const existing = target.get(sessionId);
      if (!existing) {
        target.set(sessionId, deps.applyNormalizedSessionDiscussionSettings(deps.applyNormalizedSessionChainSettings(sourceSession)));
        continue;
      }

      existing.name = existing.name || sourceSession.name;
      existing.currentAgent = existing.currentAgent || sourceSession.currentAgent;
      existing.enabledAgents = sanitizeEnabledAgents(sourceSession.enabledAgents, existing.enabledAgents);
      existing.agentWorkdirs = { ...(sourceSession.agentWorkdirs || {}), ...(existing.agentWorkdirs || {}) };
      const normalized = deps.normalizeSessionChainSettings(sourceSession);
      existing.agentChainMaxHops = normalized.agentChainMaxHops;
      existing.agentChainMaxCallsPerAgent = normalized.agentChainMaxCallsPerAgent;
      const mergedDiscussion = deps.normalizeSessionDiscussionSettings(
        sourceSession.updatedAt > existing.updatedAt
          ? sourceSession
          : existing
      );
      existing.discussionMode = mergedDiscussion.discussionMode;
      existing.discussionState = mergedDiscussion.discussionState;
      existing.createdAt = Math.min(existing.createdAt, sourceSession.createdAt);
      existing.updatedAt = Math.max(existing.updatedAt, sourceSession.updatedAt);
      if (sourceSession.history.length > existing.history.length) {
        existing.history = sourceSession.history;
      }
      const targetInvocationTasks = normalizeInvocationTasks(existing);
      const sourceInvocationTasks = normalizeInvocationTasks(sourceSession);
      const mergedInvocationTasks = new Map<string, InvocationTask>();
      for (const task of sourceInvocationTasks) {
        mergedInvocationTasks.set(task.id, task);
      }
      for (const task of targetInvocationTasks) {
        const current = mergedInvocationTasks.get(task.id);
        if (!current || task.updatedAt >= current.updatedAt) {
          mergedInvocationTasks.set(task.id, task);
        }
      }
      existing.invocationTasks = Array.from(mergedInvocationTasks.values());
    }
  }

  function createInvocationTask(userKey: string, sessionId: string, task: InvocationTask): InvocationTask | null {
    const session = ensureUserSessions(userKey).get(sessionId);
    if (!session) return null;

    const normalizedTask = normalizeInvocationTask(task, sessionId);
    if (!normalizedTask) return null;

    const tasks = normalizeInvocationTasks(session);
    const existingTaskIndex = tasks.findIndex(item => item.id === normalizedTask.id);
    if (existingTaskIndex >= 0) {
      tasks[existingTaskIndex] = {
        ...tasks[existingTaskIndex],
        ...normalizedTask,
        sessionId,
        reviewVersion: typeof normalizedTask.reviewVersion === 'number'
          ? normalizedTask.reviewVersion
          : tasks[existingTaskIndex].reviewVersion ?? 0,
        updatedAt: Date.now()
      };
      deps.touchSession(session);
      return cloneInvocationTask(tasks[existingTaskIndex]);
    }

    tasks.push({
      ...normalizedTask,
      sessionId,
      reviewVersion: normalizedTask.reviewVersion ?? 0,
      createdAt: normalizedTask.createdAt || Date.now(),
      updatedAt: normalizedTask.updatedAt || Date.now()
    });
    deps.touchSession(session);
    return cloneInvocationTask(tasks[tasks.length - 1]);
  }

  function updateInvocationTask(userKey: string, sessionId: string, taskId: string, patch: InvocationTaskUpdatePatch): InvocationTask | null {
    const session = ensureUserSessions(userKey).get(sessionId);
    if (!session) return null;

    const tasks = normalizeInvocationTasks(session);
    const index = tasks.findIndex(task => task.id === taskId);
    if (index < 0) return null;

    const currentTask = tasks[index];
    const requestedStatus = typeof patch.status === 'string' ? patch.status : currentTask.status;
    if (isInvocationTaskTerminalStatus(currentTask.status) && requestedStatus !== currentTask.status) {
      return cloneInvocationTask(currentTask);
    }

    const nextTask = normalizeInvocationTask({
      ...currentTask,
      ...patch,
      id: currentTask.id,
      sessionId: currentTask.sessionId,
      createdAt: currentTask.createdAt,
      reviewVersion: typeof patch.reviewVersion === 'number'
        ? patch.reviewVersion
        : currentTask.reviewVersion ?? 0,
      updatedAt: Date.now()
    }, sessionId);
    if (!nextTask) return null;

    tasks[index] = nextTask;
    deps.touchSession(session);
    return cloneInvocationTask(nextTask);
  }

  function listInvocationTasks(userKey: string, sessionId: string): InvocationTask[] {
    const session = ensureUserSessions(userKey).get(sessionId);
    if (!session) return [];
    return normalizeInvocationTasks(session).map(cloneInvocationTask);
  }

  function listActiveInvocationTasks(userKey: string, sessionId: string): InvocationTask[] {
    return listInvocationTasks(userKey, sessionId).filter(task => ACTIVE_INVOCATION_TASK_STATUSES.has(task.status));
  }

  function resolveOverdueInvocationTasks(userKey: string, sessionId: string, now = Date.now()): InvocationTask[] {
    const session = ensureUserSessions(userKey).get(sessionId);
    if (!session) return [];

    const tasks = normalizeInvocationTasks(session);
    const timedOutTasks: InvocationTask[] = [];
    for (const task of tasks) {
      if (!TIMEOUT_ELIGIBLE_INVOCATION_TASK_STATUSES.has(task.status)) continue;
      if (!task.deadlineAt || task.deadlineAt > now) continue;
      task.status = 'timed_out';
      task.timedOutAt = now;
      task.updatedAt = now;
      timedOutTasks.push(cloneInvocationTask(task));
    }

    if (timedOutTasks.length > 0) {
      deps.touchSession(session);
    }

    return timedOutTasks;
  }

  function markInvocationTaskCompleted(userKey: string, sessionId: string, taskId: string): InvocationTask | null {
    return updateInvocationTask(userKey, sessionId, taskId, {
      status: 'completed',
      completedAt: Date.now()
    });
  }

  function markInvocationTaskFailed(userKey: string, sessionId: string, taskId: string, reason?: string): InvocationTask | null {
    return updateInvocationTask(userKey, sessionId, taskId, {
      status: 'failed',
      failedAt: Date.now(),
      failureReason: reason
    });
  }

  function migrateLegacySessionUserData(oldUserKey: string, newUserKey: string): void {
    if (!oldUserKey || oldUserKey === newUserKey) return;

    const legacySessions = deps.repository.getUserSessions(oldUserKey);
    if (!legacySessions) return;

    const existingSessions = deps.repository.getUserSessions(newUserKey);
    if (existingSessions) {
      mergeSessionMaps(existingSessions, legacySessions);
    } else {
      deps.repository.setUserSessions(newUserKey, legacySessions);
    }

    const legacyActiveSessionId = deps.repository.getActiveSessionId(oldUserKey);
    if (legacyActiveSessionId && ensureUserSessions(newUserKey).has(legacyActiveSessionId)) {
      deps.repository.setActiveSessionId(newUserKey, legacyActiveSessionId);
    }

    deps.repository.deleteUserSessions(oldUserKey);
    deps.repository.deleteActiveSessionId(oldUserKey);
    deps.schedulePersistChatSessions();
  }

  function isChatSessionActive(): boolean {
    const state = deps.repository.serializeState();
    for (const sessions of Object.values(state.userChatSessions)) {
      for (const session of sessions) {
        if (session.history.length > 0 || session.currentAgent) {
          return true;
        }
      }
    }
    return false;
  }

  function parseSessionChainPatch(patch: unknown): SessionChainPatch {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('patch 必须是对象');
    }

    const entries = Object.entries(patch as Record<string, unknown>);
    if (entries.length === 0) {
      throw new Error('patch 不能为空');
    }

    const allowedFields = new Set(['agentChainMaxHops', 'agentChainMaxCallsPerAgent', 'discussionMode']);
    const normalizedPatch: SessionChainPatch = {};

    for (const [key, value] of entries) {
      if (!allowedFields.has(key)) {
        throw new Error(`不支持的 session 字段: ${key}`);
      }

      if (key === 'agentChainMaxHops') {
        const normalized = normalizePositiveSessionSetting(value, null, false);
        if (normalized === null) {
          throw new Error('agentChainMaxHops 必须是 1 到 1000 的整数');
        }
        normalizedPatch.agentChainMaxHops = normalized;
        continue;
      }

      if (key === 'discussionMode') {
        if (value !== 'classic' && value !== 'peer') {
          throw new Error("discussionMode 必须是 'classic' 或 'peer'");
        }
        normalizedPatch.discussionMode = value;
        continue;
      }

      if (value === null) {
        normalizedPatch.agentChainMaxCallsPerAgent = null;
        continue;
      }

      const normalized = normalizePositiveSessionSetting(value, null, false);
      if (normalized === null) {
        throw new Error('agentChainMaxCallsPerAgent 必须是 null 或 1 到 1000 的整数');
      }
      normalizedPatch.agentChainMaxCallsPerAgent = normalized;
    }

    return normalizedPatch;
  }

  return {
    createUserSession,
    createDefaultSession,
    normalizeSessionName,
    sanitizeEnabledAgents,
    ensureUserSessions,
    resolveActiveSession,
    getSessionSummaries,
    getUserHistory,
    getUserCurrentAgent,
    setUserCurrentAgent,
    clearUserHistory,
    setActiveChatSession,
    createChatSessionForUser,
    renameChatSessionForUser,
    deleteChatSessionForUser,
    migrateLegacySessionUserData,
    isChatSessionActive,
    getSessionById: deps.repository.getSessionById,
    getUserAgentWorkdir,
    setUserAgentWorkdir,
    getSessionEnabledAgents,
    isAgentEnabledForSession,
    setSessionEnabledAgent,
    expireDisabledCurrentAgent,
    createInvocationTask,
    updateInvocationTask,
    listInvocationTasks,
    listActiveInvocationTasks,
    resolveOverdueInvocationTasks,
    markInvocationTaskCompleted,
    markInvocationTaskFailed,
    buildSessionResponse,
    buildDetailedSessionResponse,
    parseSessionChainPatch
  };
}
