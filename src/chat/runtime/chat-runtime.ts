import Redis from 'ioredis';
import { Message } from '../../types';
import {
  UserChatSession,
  PendingAgentDispatchTask
} from '../infrastructure/chat-session-repository';
import {
  DependencyStatusItem,
  DependencyStatusLogEntry
} from '../infrastructure/dependency-log-store';
import {
  ChatRuntime,
  ChatRuntimeConfig,
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

export type { UserChatSession, PendingAgentDispatchTask } from '../infrastructure/chat-session-repository';
export type { DependencyStatusItem, DependencyStatusLogEntry } from '../infrastructure/dependency-log-store';
export type {
  ChatRuntime,
  ChatRuntimeConfig,
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
