import * as fs from 'fs';
import Redis from 'ioredis';
import { AgentManager } from '../../agent-manager';
import { loadAgentStore, saveAgentStore, applyPendingAgents } from '../../agent-config-store';
import { Message, DiscussionMode, DiscussionState, AgentDispatchKind } from '../../types';
import {
  createChatSessionRepository,
  UserChatSession,
  PendingAgentDispatchTask,
  RedisPersistedState
} from '../infrastructure/chat-session-repository';
import {
  createDependencyLogStore,
  DependencyLogStore,
  DependencyStatusItem,
  DependencyStatusLogEntry
} from '../infrastructure/dependency-log-store';

export { UserChatSession, PendingAgentDispatchTask } from '../infrastructure/chat-session-repository';
export type { DependencyStatusItem, DependencyStatusLogEntry } from '../infrastructure/dependency-log-store';

export type NormalizedUserChatSession = UserChatSession & Required<Pick<UserChatSession, 'agentChainMaxHops' | 'agentChainMaxCallsPerAgent' | 'discussionMode' | 'discussionState'>>;
export type SessionChainPatch = Partial<Pick<UserChatSession, 'agentChainMaxHops' | 'agentChainMaxCallsPerAgent' | 'discussionMode'>>;

export interface ChatRuntimeConfig {
  redisUrl: string;
  redisConfigKey: string;
  defaultRedisChatSessionsKey: string;
  redisPersistDebounceMs: number;
  redisRequired: boolean;
  redisDisabled: boolean;
  envRedisChatSessionsKey: string;
  defaultChatSessionId: string;
  defaultChatSessionName: string;
  defaultAgentChainMaxHops: number;
  dependencyStatusLogLimit?: number;
  getValidAgentNames: () => string[];
}

export interface ChatAgentStoreRuntimeConfig {
  agentDataFile: string;
  isChatSessionActive(): boolean;
}

export interface ChatAgentStoreRuntime {
  agentManager: AgentManager;
  syncAgentsFromStore(): void;
}

export interface ChatRuntime {
  hydrate(): Promise<void>;
  shutdown(): Promise<void>;
  getRedisChatSessionsKey(): string;
  touchSession(session: UserChatSession): void;
  createUserSession(name?: string): UserChatSession;
  ensureUserSessions(userKey: string): Map<string, UserChatSession>;
  resolveActiveSession(userKey: string): UserChatSession;
  getSessionSummaries(userKey: string): Array<{ id: string; name: string; messageCount: number; updatedAt: number; createdAt: number; agentChainMaxHops: number; agentChainMaxCallsPerAgent: number | null; discussionMode: DiscussionMode; discussionState: DiscussionState }>;
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
  addCallbackMessage(sessionId: string, agentName: string, content: string, invokeAgents?: string[]): Message;
  consumeCallbackMessages(sessionId: string, agentName: string): Message[];
  listDependencyStatusLogs(): DependencyStatusLogEntry[];
  appendOperationalLog(level: 'info' | 'error', dependency: string, message: string): void;
  collectDependencyStatus(): Promise<DependencyStatusItem[]>;
  getUserAgentWorkdir(userKey: string, sessionId: string, agentName: string): string | null;
  setUserAgentWorkdir(userKey: string, sessionId: string, agentName: string, workdir: string | null): void;
  getSessionEnabledAgents(session: UserChatSession): string[];
  isAgentEnabledForSession(session: UserChatSession, agentName: string): boolean;
  setSessionEnabledAgent(userKey: string, sessionId: string, agentName: string, enabled: boolean): { enabledAgents: string[]; currentAgentWillExpire: boolean } | null;
  expireDisabledCurrentAgent(userKey: string, session: UserChatSession): string | null;
  buildSessionResponse(session: UserChatSession): NormalizedUserChatSession;
  buildDetailedSessionResponse(session: UserChatSession): NormalizedUserChatSession & { enabledAgents: string[]; agentWorkdirs: Record<string, string> };
  parseSessionChainPatch(patch: unknown): SessionChainPatch;
  beginSummaryRequest(key: string): boolean;
  endSummaryRequest(key: string): void;
  hasSummaryRequest(key: string): boolean;
  normalizeDiscussionMode(value: unknown, fallback?: DiscussionMode): DiscussionMode;
  normalizeDiscussionState(value: unknown, fallback?: DiscussionState): DiscussionState;
  normalizeDispatchKind(value: unknown, fallback?: AgentDispatchKind | null): AgentDispatchKind | null;
  isChainedDispatchKind(dispatchKind: AgentDispatchKind): boolean;
  applyNormalizedSessionDiscussionSettings<T extends UserChatSession>(session: T): T & Required<Pick<UserChatSession, 'discussionMode' | 'discussionState'>>;
  applyNormalizedSessionChainSettings<T extends UserChatSession>(session: T): T & Required<Pick<UserChatSession, 'agentChainMaxHops' | 'agentChainMaxCallsPerAgent'>>;
}

const SESSION_CHAIN_SETTINGS_MAX = 1000;
const DEFAULT_DISCUSSION_MODE: DiscussionMode = 'classic';
const DEFAULT_DISCUSSION_STATE: DiscussionState = 'active';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function generateChatSessionId(): string {
  const crypto = require('crypto') as typeof import('crypto');
  return `s_${crypto.randomBytes(6).toString('hex')}`;
}

export function normalizePositiveSessionSetting(value: unknown, fallback: number | null, allowNull: boolean): number | null {
  if (value === null) {
    return allowNull ? null : fallback;
  }

  if (typeof value === 'undefined') {
    return fallback;
  }

  let parsed: number;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || !/^-?\d+$/.test(trimmed)) {
      return fallback;
    }
    parsed = Number(trimmed);
  } else if (typeof value === 'number') {
    parsed = value;
  } else {
    return fallback;
  }

  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(SESSION_CHAIN_SETTINGS_MAX, parsed);
}

export function createChatRuntime(config: ChatRuntimeConfig): ChatRuntime {
  const repository = createChatSessionRepository();
  const dependencyLogs: DependencyLogStore = createDependencyLogStore(config.dependencyStatusLogLimit ?? 80);
  const summaryRequestsInProgress = new Set<string>();
  const redisClient = new Redis(config.redisUrl, { lazyConnect: true });
  let redisChatSessionsKey = config.defaultRedisChatSessionsKey;
  let persistTimer: NodeJS.Timeout | null = null;
  let redisReady = false;

  redisClient.on('error', (error: unknown) => {
    const err = error as Error;
    console.error('[Redis] 连接异常:', err.message);
  });

  function normalizeSessionChainSettings(source?: SessionChainPatch): Required<Pick<UserChatSession, 'agentChainMaxHops' | 'agentChainMaxCallsPerAgent'>> {
    return {
      agentChainMaxHops: normalizePositiveSessionSetting(source?.agentChainMaxHops, config.defaultAgentChainMaxHops, false) as number,
      agentChainMaxCallsPerAgent: normalizePositiveSessionSetting(source?.agentChainMaxCallsPerAgent, null, true)
    };
  }

  function normalizeDiscussionMode(value: unknown, fallback: DiscussionMode = DEFAULT_DISCUSSION_MODE): DiscussionMode {
    return value === 'peer' || value === 'classic' ? value : fallback;
  }

  function normalizeDiscussionState(value: unknown, fallback: DiscussionState = DEFAULT_DISCUSSION_STATE): DiscussionState {
    return value === 'paused' || value === 'summarizing' || value === 'active' ? value : fallback;
  }

  function normalizeSessionDiscussionSettings(source?: Pick<UserChatSession, 'discussionMode' | 'discussionState'>): Required<Pick<UserChatSession, 'discussionMode' | 'discussionState'>> {
    const discussionMode = normalizeDiscussionMode(source?.discussionMode);
    return {
      discussionMode,
      discussionState: discussionMode === 'peer'
        ? normalizeDiscussionState(source?.discussionState)
        : 'active'
    };
  }

  function normalizeDispatchKind(value: unknown, fallback: AgentDispatchKind | null = 'initial'): AgentDispatchKind | null {
    if (value === 'explicit_chained' || value === 'implicit_chained' || value === 'summary' || value === 'initial') {
      return value;
    }

    return value === 'chained' ? 'explicit_chained' : fallback;
  }

  function isChainedDispatchKind(dispatchKind: AgentDispatchKind): boolean {
    return dispatchKind === 'explicit_chained' || dispatchKind === 'implicit_chained';
  }

  function applyNormalizedSessionChainSettings<T extends UserChatSession>(session: T): T & Required<Pick<UserChatSession, 'agentChainMaxHops' | 'agentChainMaxCallsPerAgent'>> {
    const normalized = normalizeSessionChainSettings(session);
    session.agentChainMaxHops = normalized.agentChainMaxHops;
    session.agentChainMaxCallsPerAgent = normalized.agentChainMaxCallsPerAgent;
    return session as T & Required<Pick<UserChatSession, 'agentChainMaxHops' | 'agentChainMaxCallsPerAgent'>>;
  }

  function applyNormalizedSessionDiscussionSettings<T extends UserChatSession>(session: T): T & Required<Pick<UserChatSession, 'discussionMode' | 'discussionState'>> {
    const normalized = normalizeSessionDiscussionSettings(session);
    session.discussionMode = normalized.discussionMode;
    session.discussionState = normalized.discussionState;
    return session as T & Required<Pick<UserChatSession, 'discussionMode' | 'discussionState'>>;
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

  function normalizeSessionName(name: string | undefined): string {
    const trimmed = (name || '').trim();
    return trimmed ? trimmed.slice(0, 40) : config.defaultChatSessionName;
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
      ...normalizeSessionChainSettings(),
      ...normalizeSessionDiscussionSettings(),
      createdAt: now,
      updatedAt: now
    };
  }

  function createDefaultSession(): UserChatSession {
    const session = createUserSession(config.defaultChatSessionName);
    session.id = config.defaultChatSessionId;
    return session;
  }

  function schedulePersistChatSessions(): void {
    if (config.redisDisabled || !redisReady) return;

    if (persistTimer) {
      clearTimeout(persistTimer);
    }

    persistTimer = setTimeout(() => {
      persistTimer = null;
      void persistChatSessionsToRedis();
    }, config.redisPersistDebounceMs);
  }

  function touchSession(session: UserChatSession): void {
    session.updatedAt = Date.now();
    schedulePersistChatSessions();
  }

  function ensureUserSessions(userKey: string): Map<string, UserChatSession> {
    const existed = repository.getUserSessions(userKey);
    const sessions = repository.ensureUserSessions(userKey, createDefaultSession);
    if (!existed) {
      schedulePersistChatSessions();
    }
    return sessions;
  }

  function sanitizeEnabledAgents(...candidateLists: Array<string[] | undefined>): string[] {
    const validAgentNames = new Set(config.getValidAgentNames());
    for (const candidate of candidateLists) {
      if (!Array.isArray(candidate)) continue;
      const filtered = candidate.filter(name => typeof name === 'string' && validAgentNames.has(name));
      return [...new Set(filtered)];
    }
    return config.getValidAgentNames();
  }

  function buildSessionResponse(session: UserChatSession): NormalizedUserChatSession {
    const normalized = normalizeSessionChainSettings(session);
    const discussion = normalizeSessionDiscussionSettings(session);
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

  function buildDetailedSessionResponse(session: UserChatSession): NormalizedUserChatSession & { enabledAgents: string[]; agentWorkdirs: Record<string, string> } {
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
    touchSession(session);
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

    session.enabledAgents = config.getValidAgentNames().filter(name => enabledSet.has(name));
    const currentAgentWillExpire = !enabled && session.currentAgent === agentName;
    touchSession(session);
    return {
      enabledAgents: [...session.enabledAgents],
      currentAgentWillExpire
    };
  }

  function resolveActiveSession(userKey: string): UserChatSession {
    const sessions = ensureUserSessions(userKey);
    const activeSessionId = repository.getActiveSessionId(userKey) || config.defaultChatSessionId;
    const activeSession = sessions.get(activeSessionId) || sessions.values().next().value;

    if (!activeSession) {
      const fallback = createDefaultSession();
      sessions.set(fallback.id, fallback);
      repository.setActiveSessionId(userKey, fallback.id);
      return fallback;
    }

    repository.setActiveSessionId(userKey, activeSession.id);
    return activeSession;
  }

  function getSessionSummaries(userKey: string): Array<{ id: string; name: string; messageCount: number; updatedAt: number; createdAt: number; agentChainMaxHops: number; agentChainMaxCallsPerAgent: number | null; discussionMode: DiscussionMode; discussionState: DiscussionState }> {
    const sessions = ensureUserSessions(userKey);
    return Array.from(sessions.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((session) => {
        const normalized = normalizeSessionChainSettings(session);
        const discussion = normalizeSessionDiscussionSettings(session);
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
    return ensureUserSessions(userKey).get(sessionId)?.history || [];
  }

  function clearUserHistory(userKey: string, sessionId: string): void {
    const session = ensureUserSessions(userKey).get(sessionId);
    if (!session) return;
    session.history = [];
    session.currentAgent = null;
    touchSession(session);
  }

  function setActiveChatSession(userKey: string, sessionId: string): boolean {
    const sessions = ensureUserSessions(userKey);
    if (!sessions.has(sessionId)) return false;
    repository.setActiveSessionId(userKey, sessionId);
    schedulePersistChatSessions();
    return true;
  }

  function createChatSessionForUser(userKey: string, name?: string): UserChatSession {
    const sessions = ensureUserSessions(userKey);
    const newSession = createUserSession(name);
    sessions.set(newSession.id, newSession);
    repository.setActiveSessionId(userKey, newSession.id);
    schedulePersistChatSessions();
    return newSession;
  }

  function renameChatSessionForUser(userKey: string, sessionId: string, name: string): UserChatSession | null {
    const session = ensureUserSessions(userKey).get(sessionId);
    if (!session) return null;
    session.name = normalizeSessionName(name);
    touchSession(session);
    return session;
  }

  function deleteChatSessionForUser(userKey: string, sessionId: string): { success: boolean; activeSessionId: string } {
    const sessions = ensureUserSessions(userKey);
    if (sessions.size <= 1 || !sessions.has(sessionId)) {
      return { success: false, activeSessionId: repository.getActiveSessionId(userKey) || config.defaultChatSessionId };
    }

    sessions.delete(sessionId);
    const currentActive = repository.getActiveSessionId(userKey);
    if (currentActive === sessionId) {
      const fallback = sessions.values().next().value as UserChatSession;
      repository.setActiveSessionId(userKey, fallback.id);
    }

    schedulePersistChatSessions();

    return { success: true, activeSessionId: repository.getActiveSessionId(userKey) || config.defaultChatSessionId };
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
    touchSession(session);
  }

  function mergeSessionMaps(target: Map<string, UserChatSession>, source: Map<string, UserChatSession>): void {
    for (const [sessionId, sourceSession] of source.entries()) {
      const existing = target.get(sessionId);
      if (!existing) {
        target.set(sessionId, applyNormalizedSessionDiscussionSettings(applyNormalizedSessionChainSettings(sourceSession)));
        continue;
      }

      existing.name = existing.name || sourceSession.name;
      existing.currentAgent = existing.currentAgent || sourceSession.currentAgent;
      existing.enabledAgents = sanitizeEnabledAgents(sourceSession.enabledAgents, existing.enabledAgents);
      existing.agentWorkdirs = { ...(sourceSession.agentWorkdirs || {}), ...(existing.agentWorkdirs || {}) };
      const normalized = normalizeSessionChainSettings(sourceSession);
      existing.agentChainMaxHops = normalized.agentChainMaxHops;
      existing.agentChainMaxCallsPerAgent = normalized.agentChainMaxCallsPerAgent;
      const mergedDiscussion = normalizeSessionDiscussionSettings(
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
    }
  }

  function migrateLegacySessionUserData(oldUserKey: string, newUserKey: string): void {
    if (!oldUserKey || oldUserKey === newUserKey) return;

    const legacySessions = repository.getUserSessions(oldUserKey);
    if (!legacySessions) return;

    const existingSessions = repository.getUserSessions(newUserKey);
    if (existingSessions) {
      mergeSessionMaps(existingSessions, legacySessions);
    } else {
      repository.setUserSessions(newUserKey, legacySessions);
    }

    const legacyActiveSessionId = repository.getActiveSessionId(oldUserKey);
    if (legacyActiveSessionId && ensureUserSessions(newUserKey).has(legacyActiveSessionId)) {
      repository.setActiveSessionId(newUserKey, legacyActiveSessionId);
    }

    repository.deleteUserSessions(oldUserKey);
    repository.deleteActiveSessionId(oldUserKey);
    schedulePersistChatSessions();
  }

  function addCallbackMessage(sessionId: string, agentName: string, content: string, invokeAgents?: string[]): Message {
    const msg: Message = {
      id: generateId(),
      role: 'assistant',
      sender: agentName,
      text: content,
      timestamp: Date.now(),
      invokeAgents: invokeAgents && invokeAgents.length > 0 ? invokeAgents : undefined
    };
    repository.appendCallbackMessage(sessionId, agentName, msg);
    return msg;
  }

  function consumeCallbackMessages(sessionId: string, agentName: string): Message[] {
    return repository.consumeCallbackMessages(sessionId, agentName);
  }

  function listDependencyStatusLogs(): DependencyStatusLogEntry[] {
    return dependencyLogs.list();
  }

  function appendOperationalLog(level: 'info' | 'error', dependency: string, message: string): void {
    dependencyLogs.appendOperationalLog(level, dependency, message);
  }

  function isTestRedisChatSessionsKey(key: string): boolean {
    return key.startsWith('bot-room:chat:sessions:test:')
      || key.startsWith('bot-room:test:session-chain-settings:');
  }

  async function loadRuntimeConfigFromRedis(): Promise<void> {
    if (config.redisDisabled) return;
    try {
      if (config.envRedisChatSessionsKey) {
        redisChatSessionsKey = config.envRedisChatSessionsKey;
        console.log(`[Redis] 已使用环境变量指定 chat_sessions_key=${redisChatSessionsKey}`);
        return;
      }

      const runtimeConfig = await redisClient.hgetall(config.redisConfigKey);
      const configuredKey = (runtimeConfig.chat_sessions_key || '').trim();
      if (configuredKey) {
        if (process.env.NODE_ENV !== 'test' && isTestRedisChatSessionsKey(configuredKey)) {
          console.warn(`[Redis] 检测到残留测试 chat_sessions_key=${configuredKey}，当前 NODE_ENV=${process.env.NODE_ENV || 'development'}，已回退默认 key=${config.defaultRedisChatSessionsKey}`);
        } else {
          redisChatSessionsKey = configuredKey;
        }
      }
      console.log(`[Redis] 已加载运行配置 key=${config.redisConfigKey}, chat_sessions_key=${redisChatSessionsKey}`);
    } catch (error) {
      console.error('[Redis] 读取运行配置失败:', error);
      if (config.redisRequired) {
        throw new Error('Redis 配置读取失败，聊天服务启动失败');
      }
      console.warn('[Redis] 继续使用默认配置（非阻塞模式）');
    }
  }

  async function persistChatSessionsToRedis(): Promise<void> {
    if (config.redisDisabled || !redisReady) return;

    try {
      const payload = JSON.stringify(repository.serializeState());
      await redisClient.set(redisChatSessionsKey, payload);
    } catch (error) {
      console.error('[Redis] 持久化聊天会话失败:', error);
    }
  }

  async function hydrate(): Promise<void> {
    if (config.redisDisabled) {
      console.warn('[Redis] 已通过 BOT_ROOM_DISABLE_REDIS=true 禁用会话持久化');
      return;
    }

    try {
      await redisClient.connect();
      redisReady = true;
      await loadRuntimeConfigFromRedis();
      const raw = await redisClient.get(redisChatSessionsKey);
      if (!raw) {
        console.log(`[Redis] 未发现历史会话缓存 key=${redisChatSessionsKey}`);
        return;
      }

      const parsed = JSON.parse(raw) as RedisPersistedState;
      if (parsed.version !== 1 || !parsed.userChatSessions || !parsed.userActiveChatSession) {
        console.warn('[Redis] 会话缓存结构不兼容，跳过恢复');
        return;
      }

      repository.clearUserSessions();
      for (const [userKey, sessions] of Object.entries(parsed.userChatSessions)) {
        const sessionMap = new Map<string, UserChatSession>();
        for (const session of sessions) {
          if (!session?.id) continue;
          sessionMap.set(session.id, {
            id: session.id,
            name: normalizeSessionName(session.name),
            history: Array.isArray(session.history) ? session.history : [],
            currentAgent: session.currentAgent || null,
            enabledAgents: sanitizeEnabledAgents(session.enabledAgents),
            agentWorkdirs: session.agentWorkdirs && typeof session.agentWorkdirs === 'object'
              ? session.agentWorkdirs
              : {},
            pendingAgentTasks: Array.isArray(session.pendingAgentTasks)
              ? session.pendingAgentTasks
                .filter(task => task && typeof task.agentName === 'string' && typeof task.prompt === 'string')
                .map(task => {
                  const dispatchKind = normalizeDispatchKind(task.dispatchKind, null);
                  if (!dispatchKind) {
                    return null;
                  }
                  return {
                    agentName: task.agentName,
                    prompt: task.prompt,
                    includeHistory: task.includeHistory !== false,
                    dispatchKind
                  };
                })
                .filter((task): task is PendingAgentDispatchTask => task !== null)
              : undefined,
            pendingVisibleMessages: Array.isArray(session.pendingVisibleMessages)
              ? session.pendingVisibleMessages.filter(message => message && typeof message.id === 'string')
              : undefined,
            ...normalizeSessionChainSettings(session),
            ...normalizeSessionDiscussionSettings(session),
            createdAt: Number(session.createdAt) || Date.now(),
            updatedAt: Number(session.updatedAt) || Date.now()
          });
        }

        if (sessionMap.size === 0) {
          const fallback = createDefaultSession();
          sessionMap.set(fallback.id, fallback);
        }

        repository.setUserSessions(userKey, sessionMap);
      }

      repository.clearActiveSessionIds();
      for (const [userKey, sessionId] of Object.entries(parsed.userActiveChatSession)) {
        repository.setActiveSessionId(userKey, sessionId);
      }

      console.log(`[Redis] 已恢复聊天会话数据: users=${Object.keys(parsed.userChatSessions).length}`);
    } catch (error) {
      redisReady = false;
      console.error('[Redis] 恢复聊天会话失败:', error);
      if (config.redisRequired) {
        throw new Error('Redis 不可用，聊天服务启动失败');
      }
      console.warn('[Redis] 将使用内存态会话（重启后丢失）');
    }
  }

  async function collectDependencyStatus(): Promise<DependencyStatusItem[]> {
    const result: DependencyStatusItem[] = [];

    if (config.redisDisabled) {
      result.push({
        name: 'redis',
        required: config.redisRequired,
        healthy: true,
        detail: 'disabled by BOT_ROOM_DISABLE_REDIS=true'
      });
      dependencyLogs.append({
        timestamp: Date.now(),
        level: 'info',
        dependency: 'redis',
        message: 'disabled by BOT_ROOM_DISABLE_REDIS=true'
      });
      return result;
    }

    try {
      const pong = await redisClient.ping();
      const healthy = pong === 'PONG';
      const detail = healthy ? 'PONG' : `返回异常: ${pong}`;
      result.push({
        name: 'redis',
        required: config.redisRequired,
        healthy,
        detail
      });
      dependencyLogs.append({
        timestamp: Date.now(),
        level: healthy ? 'info' : 'error',
        dependency: 'redis',
        message: detail
      });
    } catch (error) {
      const err = error as Error;
      result.push({
        name: 'redis',
        required: config.redisRequired,
        healthy: false,
        detail: err.message
      });
      dependencyLogs.append({
        timestamp: Date.now(),
        level: 'error',
        dependency: 'redis',
        message: err.message
      });
    }

    return result;
  }

  function isChatSessionActive(): boolean {
    const state = repository.serializeState();
    for (const sessions of Object.values(state.userChatSessions)) {
      for (const session of sessions) {
        if (session.history.length > 0 || session.currentAgent) {
          return true;
        }
      }
    }
    return false;
  }

  async function shutdown(): Promise<void> {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    await persistChatSessionsToRedis();
    if (!config.redisDisabled && redisReady) {
      await redisClient.quit();
    }
  }

  function beginSummaryRequest(key: string): boolean {
    if (summaryRequestsInProgress.has(key)) {
      return false;
    }
    summaryRequestsInProgress.add(key);
    return true;
  }

  function endSummaryRequest(key: string): void {
    summaryRequestsInProgress.delete(key);
  }

  function hasSummaryRequest(key: string): boolean {
    return summaryRequestsInProgress.has(key);
  }

  function getRedisChatSessionsKey(): string {
    return redisChatSessionsKey;
  }

  return {
    hydrate,
    shutdown,
    getRedisChatSessionsKey,
    touchSession,
    createUserSession,
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
    getSessionById: repository.getSessionById,
    addCallbackMessage,
    consumeCallbackMessages,
    listDependencyStatusLogs,
    appendOperationalLog,
    collectDependencyStatus,
    getUserAgentWorkdir,
    setUserAgentWorkdir,
    getSessionEnabledAgents,
    isAgentEnabledForSession,
    setSessionEnabledAgent,
    expireDisabledCurrentAgent,
    buildSessionResponse,
    buildDetailedSessionResponse,
    parseSessionChainPatch,
    beginSummaryRequest,
    endSummaryRequest,
    hasSummaryRequest,
    normalizeDiscussionMode,
    normalizeDiscussionState,
    normalizeDispatchKind,
    isChainedDispatchKind,
    applyNormalizedSessionDiscussionSettings,
    applyNormalizedSessionChainSettings
  };
}

export function createChatAgentStoreRuntime(config: ChatAgentStoreRuntimeConfig): ChatAgentStoreRuntime {
  let agentStore = loadAgentStore(config.agentDataFile);
  let agentStoreMtimeMs = fs.existsSync(config.agentDataFile) ? fs.statSync(config.agentDataFile).mtimeMs : 0;
  const agentManager = new AgentManager(agentStore.activeAgents);

  function syncAgentsFromStore(): void {
    try {
      const mtime = fs.existsSync(config.agentDataFile) ? fs.statSync(config.agentDataFile).mtimeMs : 0;
      if (mtime <= agentStoreMtimeMs && !agentStore.pendingAgents) {
        return;
      }

      agentStore = loadAgentStore(config.agentDataFile);
      agentStoreMtimeMs = mtime;

      if (agentStore.pendingAgents && !config.isChatSessionActive()) {
        agentStore = applyPendingAgents(agentStore);
        saveAgentStore(config.agentDataFile, agentStore);
        agentStoreMtimeMs = fs.existsSync(config.agentDataFile) ? fs.statSync(config.agentDataFile).mtimeMs : Date.now();
        console.log('[AgentStore] 已应用等待生效的智能体配置');
      }

      agentManager.replaceAgents(agentStore.activeAgents);
    } catch (error: unknown) {
      console.error('[AgentStore] 同步失败:', (error as Error).message);
    }
  }

  return {
    agentManager,
    syncAgentsFromStore
  };
}
