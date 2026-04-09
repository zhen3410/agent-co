import Redis from 'ioredis';
import { InvocationTask, Message } from '../../types';
import {
  UserChatSession,
  PendingAgentDispatchTask
} from '../infrastructure/chat-session-repository';
import {
  DependencyStatusItem,
  DependencyStatusLogEntry
} from '../infrastructure/dependency-log-store';
import {
  ActiveChatExecution,
  ActiveChatExecutionStopResult,
  ChatRuntime,
  ChatRuntimeConfig,
  InvocationTaskUpdatePatch,
  NormalizedUserChatSession,
  SessionChainPatch,
  generateId,
  normalizePositiveSessionSetting
} from './chat-runtime-types';
import { createChatSessionState } from './chat-session-state';
import { createChatDiscussionState } from './chat-discussion-state';
import { createChatRuntimePersistence } from './chat-runtime-persistence';
import { createChatRuntimeDependencies } from './chat-runtime-dependencies';
import { createChatRuntimeStores } from './chat-runtime-stores';
import { createChatActiveExecutionState } from './chat-active-execution-state';

export type { UserChatSession, PendingAgentDispatchTask } from '../infrastructure/chat-session-repository';
export type { DependencyStatusItem, DependencyStatusLogEntry } from '../infrastructure/dependency-log-store';
export type {
  ChatRuntime,
  ChatRuntimeConfig,
  InvocationTaskUpdatePatch,
  NormalizedUserChatSession,
  SessionChainPatch
} from './chat-runtime-types';
export { normalizePositiveSessionSetting } from './chat-runtime-types';

export function createChatRuntime(config: ChatRuntimeConfig): ChatRuntime {
  const {
    repository,
    callbackMessageStore,
    persistenceStore,
    dependencyLogStore
  } = createChatRuntimeStores(config);
  const redisClient = new Redis(config.redisUrl, { lazyConnect: true });

  let persistence!: ReturnType<typeof createChatRuntimePersistence>;

  function touchSession(session: UserChatSession): void {
    session.updatedAt = Date.now();
    persistence.schedulePersistChatSessions();
  }

  const discussionState = createChatDiscussionState({
    config,
    touchSession
  });

  const sessionState = createChatSessionState({
    config,
    repository,
    schedulePersistChatSessions: () => persistence.schedulePersistChatSessions(),
    touchSession,
    normalizeSessionChainSettings: discussionState.normalizeSessionChainSettings,
    normalizeSessionDiscussionSettings: discussionState.normalizeSessionDiscussionSettings,
    applyNormalizedSessionChainSettings: discussionState.applyNormalizedSessionChainSettings,
    applyNormalizedSessionDiscussionSettings: discussionState.applyNormalizedSessionDiscussionSettings
  });

  persistence = createChatRuntimePersistence({
    config,
    redisClient,
    store: persistenceStore,
    createDefaultSession: sessionState.createDefaultSession,
    normalizeSessionName: sessionState.normalizeSessionName,
    sanitizeEnabledAgents: sessionState.sanitizeEnabledAgents,
    normalizeSessionChainSettings: discussionState.normalizeSessionChainSettings,
    normalizeSessionDiscussionSettings: discussionState.normalizeSessionDiscussionSettings,
    normalizeDispatchKind: discussionState.normalizeDispatchKind
  });

  const runtimeDependencies = createChatRuntimeDependencies({
    config,
    redisClient,
    dependencyLogs: dependencyLogStore
  });
  const activeExecutionState = createChatActiveExecutionState({
    log: (message: string) => dependencyLogStore.appendOperationalLog('info', 'chat-exec', message)
  });

  function addCallbackMessage(sessionId: string, agentName: string, content: string, invokeAgents?: string[]) {
    const msg: Message = {
      id: generateId(),
      role: 'assistant',
      sender: agentName,
      text: content,
      timestamp: Date.now(),
      invokeAgents: invokeAgents && invokeAgents.length > 0 ? invokeAgents : undefined
    };
    callbackMessageStore.appendCallbackMessage(sessionId, agentName, msg);
    return msg;
  }

  function consumeCallbackMessages(sessionId: string, agentName: string): Message[] {
    return callbackMessageStore.consumeCallbackMessages(sessionId, agentName);
  }

  function createInvocationTask(userKey: string, sessionId: string, task: InvocationTask): InvocationTask | null {
    return sessionState.createInvocationTask(userKey, sessionId, task);
  }

  function updateInvocationTask(userKey: string, sessionId: string, taskId: string, patch: InvocationTaskUpdatePatch): InvocationTask | null {
    return sessionState.updateInvocationTask(userKey, sessionId, taskId, patch);
  }

  function listInvocationTasks(userKey: string, sessionId: string): InvocationTask[] {
    return sessionState.listInvocationTasks(userKey, sessionId);
  }

  function listActiveInvocationTasks(userKey: string, sessionId: string): InvocationTask[] {
    return sessionState.listActiveInvocationTasks(userKey, sessionId);
  }

  function resolveOverdueInvocationTasks(userKey: string, sessionId: string, now?: number): InvocationTask[] {
    return sessionState.resolveOverdueInvocationTasks(userKey, sessionId, now);
  }

  function markInvocationTaskCompleted(userKey: string, sessionId: string, taskId: string): InvocationTask | null {
    return sessionState.markInvocationTaskCompleted(userKey, sessionId, taskId);
  }

  function markInvocationTaskFailed(userKey: string, sessionId: string, taskId: string, reason?: string): InvocationTask | null {
    return sessionState.markInvocationTaskFailed(userKey, sessionId, taskId, reason);
  }

  function registerActiveExecution(userKey: string, sessionId: string, execution: ActiveChatExecution): ActiveChatExecution {
    return activeExecutionState.registerActiveExecution(userKey, sessionId, execution);
  }

  function getActiveExecution(userKey: string, sessionId: string): ActiveChatExecution | null {
    return activeExecutionState.getActiveExecution(userKey, sessionId);
  }

  function updateActiveExecutionAgent(userKey: string, sessionId: string, executionId: string, agentName: string | null): ActiveChatExecution | null {
    return activeExecutionState.updateActiveExecutionAgent(userKey, sessionId, executionId, agentName);
  }

  function requestExecutionStop(userKey: string, sessionId: string, stopMode: ActiveChatExecutionStopResult['scope']): ActiveChatExecution | null {
    return activeExecutionState.requestExecutionStop(userKey, sessionId, stopMode);
  }

  function consumeExecutionStopMode(userKey: string, sessionId: string, executionId: string): ActiveChatExecution['stopMode'] {
    return activeExecutionState.consumeExecutionStopMode(userKey, sessionId, executionId);
  }

  function consumeExecutionStopResult(userKey: string, sessionId: string, executionId: string): ActiveChatExecutionStopResult | null {
    return activeExecutionState.consumeExecutionStopResult(userKey, sessionId, executionId) ?? null;
  }

  function clearActiveExecution(userKey: string, sessionId: string, executionId: string): boolean {
    return activeExecutionState.clearActiveExecution(userKey, sessionId, executionId);
  }

  return {
    hydrate: persistence.hydrate,
    shutdown: persistence.shutdown,
    getRedisChatSessionsKey: persistence.getRedisChatSessionsKey,
    touchSession,
    createUserSession: sessionState.createUserSession,
    ensureUserSessions: sessionState.ensureUserSessions,
    resolveActiveSession: sessionState.resolveActiveSession,
    getSessionSummaries: sessionState.getSessionSummaries,
    getUserHistory: sessionState.getUserHistory,
    getUserCurrentAgent: sessionState.getUserCurrentAgent,
    setUserCurrentAgent: sessionState.setUserCurrentAgent,
    clearUserHistory: sessionState.clearUserHistory,
    setActiveChatSession: sessionState.setActiveChatSession,
    createChatSessionForUser: sessionState.createChatSessionForUser,
    renameChatSessionForUser: sessionState.renameChatSessionForUser,
    deleteChatSessionForUser: sessionState.deleteChatSessionForUser,
    migrateLegacySessionUserData: sessionState.migrateLegacySessionUserData,
    isChatSessionActive: sessionState.isChatSessionActive,
    getSessionById: sessionState.getSessionById,
    addCallbackMessage,
    consumeCallbackMessages,
    listDependencyStatusLogs: runtimeDependencies.listDependencyStatusLogs,
    appendOperationalLog: runtimeDependencies.appendOperationalLog,
    collectDependencyStatus: runtimeDependencies.collectDependencyStatus,
    getUserAgentWorkdir: sessionState.getUserAgentWorkdir,
    setUserAgentWorkdir: sessionState.setUserAgentWorkdir,
    getSessionEnabledAgents: sessionState.getSessionEnabledAgents,
    isAgentEnabledForSession: sessionState.isAgentEnabledForSession,
    setSessionEnabledAgent: sessionState.setSessionEnabledAgent,
    expireDisabledCurrentAgent: sessionState.expireDisabledCurrentAgent,
    createInvocationTask,
    updateInvocationTask,
    listInvocationTasks,
    listActiveInvocationTasks,
    resolveOverdueInvocationTasks,
    markInvocationTaskCompleted,
    markInvocationTaskFailed,
    registerActiveExecution,
    getActiveExecution,
    updateActiveExecutionAgent,
    requestExecutionStop,
    consumeExecutionStopMode,
    consumeExecutionStopResult,
    clearActiveExecution,
    buildSessionResponse: sessionState.buildSessionResponse,
    buildDetailedSessionResponse: sessionState.buildDetailedSessionResponse,
    parseSessionChainPatch: sessionState.parseSessionChainPatch,
    beginSummaryRequest: discussionState.beginSummaryRequest,
    endSummaryRequest: discussionState.endSummaryRequest,
    hasSummaryRequest: discussionState.hasSummaryRequest,
    normalizeDiscussionMode: discussionState.normalizeDiscussionMode,
    normalizeDiscussionState: discussionState.normalizeDiscussionState,
    normalizeDispatchKind: discussionState.normalizeDispatchKind,
    isChainedDispatchKind: discussionState.isChainedDispatchKind,
    applyNormalizedSessionDiscussionSettings: discussionState.applyNormalizedSessionDiscussionSettings,
    applyNormalizedSessionChainSettings: discussionState.applyNormalizedSessionChainSettings
  };
}
