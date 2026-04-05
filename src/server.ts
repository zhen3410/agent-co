/**
 * server.ts
 *
 * 多 AI 智能体聊天室服务器
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import Redis from 'ioredis';
import { Message, AIAgentConfig, ChatRequest, RichBlock, AgentInvokeResult, DiscussionMode, DiscussionState, AgentDispatchKind } from './types';
import { AgentManager } from './agent-manager';
import { loadAgentStore, saveAgentStore, applyPendingAgents } from './agent-config-store';
import { loadGroupStore } from './group-store';
import { generateMockReply } from './claude-cli';
import { invokeAgent } from './agent-invoker';
import { extractRichBlocks } from './rich-extract';
import { addBlock, getStatus as getBlockBufferStatus } from './block-buffer';
import { checkRateLimit, getClientIP } from './rate-limiter';

// ============================================
// 配置
// ============================================
const PORT = Number(process.env.PORT || 3002);
const DEFAULT_USER_NAME = '用户';
const AUTH_ENABLED = process.env.BOT_ROOM_AUTH_ENABLED !== 'false';
const AUTH_ADMIN_BASE_URL = process.env.AUTH_ADMIN_BASE_URL || 'http://127.0.0.1:3003';
const SESSION_COOKIE_NAME = 'bot_room_session';
const CHAT_VISITOR_COOKIE_NAME = 'bot_room_visitor';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 天
const AGENT_DATA_FILE = process.env.AGENT_DATA_FILE || path.join(process.cwd(), 'data', 'agents.json');
const GROUP_DATA_FILE = process.env.GROUP_DATA_FILE || path.join(path.dirname(AGENT_DATA_FILE), 'groups.json');
const VERBOSE_LOG_DIR = process.env.BOT_ROOM_VERBOSE_LOG_DIR || path.join(process.cwd(), 'logs', 'ai-cli-verbose');
const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';
const REDIS_CONFIG_KEY = 'bot-room:config';
const DEFAULT_REDIS_CHAT_SESSIONS_KEY = 'bot-room:chat:sessions:v1';
const REDIS_PERSIST_DEBOUNCE_MS = 500;
const REDIS_REQUIRED = process.env.BOT_ROOM_REDIS_REQUIRED !== 'false';
const REDIS_DISABLED = process.env.BOT_ROOM_DISABLE_REDIS === 'true';
const CALLBACK_AUTH_TOKEN = process.env.BOT_ROOM_CALLBACK_TOKEN || 'bot-room-callback-token';
const CALLBACK_AUTH_HEADER = 'x-bot-room-callback-token';
const SESSION_CHAIN_SETTINGS_MAX = 1000;
const DEFAULT_AGENT_CHAIN_MAX_HOPS = normalizePositiveSessionSetting(process.env.BOT_ROOM_AGENT_CHAIN_MAX_HOPS, 4, false) as number;

// 速率限制配置
const RATE_LIMIT_MAX_REQUESTS = 100; // 每分钟最多 100 次请求
const LOGIN_RATE_LIMIT_MAX = 5; // 每分钟最多 5 次登录尝试
const DEFAULT_CHAT_SESSION_ID = 'default';
const DEFAULT_CHAT_SESSION_NAME = '默认会话';

interface UserChatSession {
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
  createdAt: number;
  updatedAt: number;
}

interface AuthSession {
  username: string;
  expiresAt: number;
}

interface AgentDispatchTask {
  agentName: string;
  prompt: string;
  includeHistory: boolean;
}

interface PendingAgentDispatchTask extends AgentDispatchTask {
  dispatchKind: AgentDispatchKind;
}

// ============================================
// 修复 4: 用户隔离的聊天历史
// ============================================
// 改为按用户/会话存储
const userChatSessions = new Map<string, Map<string, UserChatSession>>();
const userActiveChatSession = new Map<string, string>();
const callbackMessages = new Map<string, Message[]>();
const redisClient = new Redis(DEFAULT_REDIS_URL, { lazyConnect: true });
let redisChatSessionsKey = DEFAULT_REDIS_CHAT_SESSIONS_KEY;
let persistTimer: NodeJS.Timeout | null = null;
let redisReady = false;

redisClient.on('error', (error: unknown) => {
  const err = error as Error;
  console.error('[Redis] 连接异常:', err.message);
});

interface DependencyStatusItem {
  name: string;
  required: boolean;
  healthy: boolean;
  detail: string;
}

interface DependencyStatusLogEntry {
  timestamp: number;
  level: 'info' | 'error';
  dependency: string;
  message: string;
}

const DEPENDENCY_STATUS_LOG_LIMIT = 80;
const dependencyStatusLogs: DependencyStatusLogEntry[] = [];

function appendDependencyStatusLog(entry: DependencyStatusLogEntry): void {
  dependencyStatusLogs.push(entry);
  if (dependencyStatusLogs.length > DEPENDENCY_STATUS_LOG_LIMIT) {
    dependencyStatusLogs.splice(0, dependencyStatusLogs.length - DEPENDENCY_STATUS_LOG_LIMIT);
  }
}

function appendOperationalLog(level: 'info' | 'error', dependency: string, message: string): void {
  const entry: DependencyStatusLogEntry = {
    timestamp: Date.now(),
    level,
    dependency,
    message
  };
  appendDependencyStatusLog(entry);
  const prefix = `[Ops][${dependency}]`;
  if (level === 'error') {
    console.error(`${prefix} ${message}`);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

function listDependencyStatusLogs(): DependencyStatusLogEntry[] {
  return [...dependencyStatusLogs].sort((a, b) => b.timestamp - a.timestamp);
}

interface DependencyLogQuery {
  keyword: string;
  startAt: number | null;
  endAt: number | null;
  dependency: string;
  level: 'info' | 'error' | '';
  limit: number;
}

function parseDateParamToTimestamp(value: string | null, endOfDay: boolean): number | null {
  const raw = (value || '').trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const normalized = endOfDay ? `${raw}T23:59:59.999` : `${raw}T00:00:00.000`;
    const ts = new Date(normalized).getTime();
    return Number.isFinite(ts) ? ts : null;
  }

  const ts = new Date(raw).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function parseDependencyLogQuery(url: URL): DependencyLogQuery {
  const keyword = (url.searchParams.get('keyword') || '').trim().toLowerCase();
  const dependency = (url.searchParams.get('dependency') || '').trim().toLowerCase();
  const startAt = parseDateParamToTimestamp(url.searchParams.get('startDate'), false);
  const endAt = parseDateParamToTimestamp(url.searchParams.get('endDate'), true);
  const levelRaw = (url.searchParams.get('level') || '').trim().toLowerCase();
  const level: 'info' | 'error' | '' = levelRaw === 'info' || levelRaw === 'error' ? levelRaw : '';
  const limitRaw = Number(url.searchParams.get('limit') || 500);
  const limit = Number.isFinite(limitRaw) ? Math.min(2000, Math.max(1, Math.floor(limitRaw))) : 500;

  return { keyword, startAt, endAt, dependency, level, limit };
}

function filterDependencyStatusLogs(query: DependencyLogQuery): DependencyStatusLogEntry[] {
  const allLogs = listDependencyStatusLogs();
  return allLogs.filter((log) => {
    if (query.startAt !== null && log.timestamp < query.startAt) return false;
    if (query.endAt !== null && log.timestamp > query.endAt) return false;
    if (query.dependency && log.dependency.toLowerCase() !== query.dependency) return false;
    if (query.level && log.level !== query.level) return false;
    if (!query.keyword) return true;

    const text = `${log.dependency} ${log.message} ${log.level}`.toLowerCase();
    return text.includes(query.keyword);
  }).slice(0, query.limit);
}

interface RedisPersistedState {
  version: 1;
  userChatSessions: Record<string, UserChatSession[]>;
  userActiveChatSession: Record<string, string>;
}

type NormalizedUserChatSession = UserChatSession & Required<Pick<UserChatSession, 'agentChainMaxHops' | 'agentChainMaxCallsPerAgent' | 'discussionMode' | 'discussionState'>>;
type SessionChainPatch = Partial<Pick<UserChatSession, 'agentChainMaxHops' | 'agentChainMaxCallsPerAgent' | 'discussionMode'>>;

const DEFAULT_DISCUSSION_MODE: DiscussionMode = 'classic';
const DEFAULT_DISCUSSION_STATE: DiscussionState = 'active';

function normalizePositiveSessionSetting(value: unknown, fallback: number | null, allowNull: boolean): number | null {
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

function normalizeSessionChainSettings(source?: SessionChainPatch): Required<Pick<UserChatSession, 'agentChainMaxHops' | 'agentChainMaxCallsPerAgent'>> {
  return {
    agentChainMaxHops: normalizePositiveSessionSetting(source?.agentChainMaxHops, DEFAULT_AGENT_CHAIN_MAX_HOPS, false) as number,
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
  return {
    discussionMode: normalizeDiscussionMode(source?.discussionMode),
    discussionState: normalizeDiscussionState(source?.discussionState)
  };
}

function normalizeDispatchKind(value: unknown): AgentDispatchKind {
  if (value === 'explicit_chained' || value === 'implicit_chained' || value === 'summary' || value === 'initial') {
    return value;
  }

  return value === 'chained' ? 'explicit_chained' : 'initial';
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

function buildDetailedSessionResponse(session: UserChatSession): NormalizedUserChatSession & {
  enabledAgents: string[];
  agentWorkdirs: Record<string, string>;
} {
  const normalizedSession = buildSessionResponse(session);
  return {
    ...normalizedSession,
    enabledAgents: getSessionEnabledAgents(normalizedSession),
    agentWorkdirs: normalizedSession.agentWorkdirs || {}
  };
}

async function loadRuntimeConfigFromRedis(): Promise<void> {
  if (REDIS_DISABLED) return;
  try {
    const config = await redisClient.hgetall(REDIS_CONFIG_KEY);
    const configuredKey = (config.chat_sessions_key || '').trim();
    if (configuredKey) {
      redisChatSessionsKey = configuredKey;
    }
    console.log(`[Redis] 已加载运行配置 key=${REDIS_CONFIG_KEY}, chat_sessions_key=${redisChatSessionsKey}`);
  } catch (error) {
    console.error('[Redis] 读取运行配置失败:', error);
    if (REDIS_REQUIRED) {
      throw new Error('Redis 配置读取失败，聊天服务启动失败');
    }
    console.warn('[Redis] 继续使用默认配置（非阻塞模式）');
  }
}

function serializeChatSessionsState(): RedisPersistedState {
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

async function persistChatSessionsToRedis(): Promise<void> {
  if (REDIS_DISABLED || !redisClient || !redisReady) return;

  try {
    const payload = JSON.stringify(serializeChatSessionsState());
    await redisClient.set(redisChatSessionsKey, payload);
  } catch (error) {
    console.error('[Redis] 持久化聊天会话失败:', error);
  }
}

function schedulePersistChatSessions(): void {
  if (REDIS_DISABLED || !redisClient || !redisReady) return;

  if (persistTimer) {
    clearTimeout(persistTimer);
  }

  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistChatSessionsToRedis();
  }, REDIS_PERSIST_DEBOUNCE_MS);
}

async function hydrateChatSessionsFromRedis(): Promise<void> {
  if (REDIS_DISABLED) {
    console.warn('[Redis] 已通过 BOT_ROOM_DISABLE_REDIS=true 禁用会话持久化');
    return;
  }
  if (!redisClient) return;

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

    userChatSessions.clear();
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
              .map(task => ({
                agentName: task.agentName,
                prompt: task.prompt,
                includeHistory: task.includeHistory !== false,
                dispatchKind: normalizeDispatchKind(task.dispatchKind)
              }))
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
        const fallback = createUserSession(DEFAULT_CHAT_SESSION_NAME);
        fallback.id = DEFAULT_CHAT_SESSION_ID;
        sessionMap.set(fallback.id, fallback);
      }

      userChatSessions.set(userKey, sessionMap);
    }

    userActiveChatSession.clear();
    for (const [userKey, sessionId] of Object.entries(parsed.userActiveChatSession)) {
      userActiveChatSession.set(userKey, sessionId);
    }

    console.log(`[Redis] 已恢复聊天会话数据: users=${userChatSessions.size}`);
  } catch (error) {
    redisReady = false;
    console.error('[Redis] 恢复聊天会话失败:', error);
    if (REDIS_REQUIRED) {
      throw new Error('Redis 不可用，聊天服务启动失败');
    }
    console.warn('[Redis] 将使用内存态会话（重启后丢失）');
  }
}

async function collectDependencyStatus(): Promise<DependencyStatusItem[]> {
  const result: DependencyStatusItem[] = [];

  if (REDIS_DISABLED) {
    result.push({
      name: 'redis',
      required: REDIS_REQUIRED,
      healthy: true,
      detail: 'disabled by BOT_ROOM_DISABLE_REDIS=true'
    });
    appendDependencyStatusLog({
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
      required: REDIS_REQUIRED,
      healthy,
      detail
    });
    appendDependencyStatusLog({
      timestamp: Date.now(),
      level: healthy ? 'info' : 'error',
      dependency: 'redis',
      message: detail
    });
  } catch (error) {
    const err = error as Error;
    result.push({
      name: 'redis',
      required: REDIS_REQUIRED,
      healthy: false,
      detail: err.message
    });
    appendDependencyStatusLog({
      timestamp: Date.now(),
      level: 'error',
      dependency: 'redis',
      message: err.message
    });
  }

  return result;
}

function handleGetDependenciesStatus(req: http.IncomingMessage, res: http.ServerResponse): void {
  void collectDependencyStatus().then((dependencies) => {
    const healthy = dependencies.every(item => !item.required || item.healthy);
    const logs = listDependencyStatusLogs();
    res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      healthy,
      checkedAt: Date.now(),
      dependencies,
      logs
    }));
  }).catch((error: unknown) => {
    const err = error as Error;
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });
}

function handleQueryDependenciesLogs(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  const query = parseDependencyLogQuery(url);
  if (query.startAt !== null && query.endAt !== null && query.startAt > query.endAt) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'startDate 不能晚于 endDate' }));
    return;
  }

  const logs = filterDependencyStatusLogs(query);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    total: logs.length,
    query: {
      keyword: query.keyword,
      startDate: query.startAt,
      endDate: query.endAt,
      dependency: query.dependency,
      level: query.level,
      limit: query.limit
    },
    logs
  }));
}

function normalizeSessionName(name: string | undefined): string {
  const trimmed = (name || '').trim();
  return trimmed ? trimmed.slice(0, 40) : DEFAULT_CHAT_SESSION_NAME;
}

function generateChatSessionId(): string {
  return `s_${crypto.randomBytes(6).toString('hex')}`;
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

function ensureUserSessions(userKey: string): Map<string, UserChatSession> {
  let sessions = userChatSessions.get(userKey);
  if (!sessions) {
    const defaultSession: UserChatSession = {
      id: DEFAULT_CHAT_SESSION_ID,
      name: DEFAULT_CHAT_SESSION_NAME,
      history: [],
      currentAgent: null,
      enabledAgents: [],
      agentWorkdirs: {},
      ...normalizeSessionChainSettings(),
      ...normalizeSessionDiscussionSettings(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    sessions = new Map([[defaultSession.id, defaultSession]]);
    userChatSessions.set(userKey, sessions);
    userActiveChatSession.set(userKey, defaultSession.id);
    schedulePersistChatSessions();
  }
  return sessions;
}

function buildUserKey(username: string): string {
  return `user:${username.trim().toLowerCase()}`;
}

function getUserKeyFromRequest(req: http.IncomingMessage): string {
  const visitorId = getChatVisitorIdFromRequest(req);
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  if (token) {
    const session = authSessions.get(token);
    if (session && Date.now() <= session.expiresAt) {
      return buildUserKey(session.username);
    }
  }
  if (visitorId) {
    return `visitor:${visitorId}`;
  }
  return `ip:${getClientIP(req)}`;
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
    const sourceDiscussion = normalizeSessionDiscussionSettings(sourceSession);
    existing.discussionMode = normalizeDiscussionMode(existing.discussionMode, sourceDiscussion.discussionMode);
    existing.discussionState = normalizeDiscussionState(existing.discussionState, sourceDiscussion.discussionState);
    existing.createdAt = Math.min(existing.createdAt, sourceSession.createdAt);
    existing.updatedAt = Math.max(existing.updatedAt, sourceSession.updatedAt);
    if (sourceSession.history.length > existing.history.length) {
      existing.history = sourceSession.history;
    }
  }
}

function migrateLegacySessionUserData(oldUserKey: string, newUserKey: string): void {
  if (!oldUserKey || oldUserKey === newUserKey) return;

  const legacySessions = userChatSessions.get(oldUserKey);
  if (!legacySessions) return;

  const existingSessions = userChatSessions.get(newUserKey);
  if (existingSessions) {
    mergeSessionMaps(existingSessions, legacySessions);
  } else {
    userChatSessions.set(newUserKey, legacySessions);
  }

  const legacyActiveSessionId = userActiveChatSession.get(oldUserKey);
  if (legacyActiveSessionId && ensureUserSessions(newUserKey).has(legacyActiveSessionId)) {
    userActiveChatSession.set(newUserKey, legacyActiveSessionId);
  }

  userChatSessions.delete(oldUserKey);
  userActiveChatSession.delete(oldUserKey);
  schedulePersistChatSessions();
}

function resolveChatSession(req: http.IncomingMessage): { userKey: string; session: UserChatSession } {
  const userKey = getUserKeyFromRequest(req);
  const sessions = ensureUserSessions(userKey);

  const activeSessionId = userActiveChatSession.get(userKey) || DEFAULT_CHAT_SESSION_ID;
  const activeSession = sessions.get(activeSessionId) || sessions.values().next().value;

  if (!activeSession) {
    const fallback = createUserSession(DEFAULT_CHAT_SESSION_NAME);
    fallback.id = DEFAULT_CHAT_SESSION_ID;
    sessions.set(fallback.id, fallback);
    userActiveChatSession.set(userKey, fallback.id);
    return { userKey, session: fallback };
  }

  userActiveChatSession.set(userKey, activeSession.id);
  return { userKey, session: activeSession };
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

function getAllAgentNames(): string[] {
  return agentManager.getAgentConfigs().map(agent => agent.name);
}

function sanitizeEnabledAgents(...candidateLists: Array<string[] | undefined>): string[] {
  const validAgentNames = new Set(getAllAgentNames());
  for (const candidate of candidateLists) {
    if (!Array.isArray(candidate)) continue;
    const filtered = candidate.filter(name => typeof name === 'string' && validAgentNames.has(name));
    return [...new Set(filtered)];
  }
  return getAllAgentNames();
}

function getSessionEnabledAgents(session: UserChatSession): string[] {
  const sanitized = sanitizeEnabledAgents(session.enabledAgents);
  if (!Array.isArray(session.enabledAgents) || session.enabledAgents.length !== sanitized.length) {
    session.enabledAgents = sanitized;
  }
  return sanitized;
}

function isAgentEnabledForSession(session: UserChatSession, agentName: string): boolean {
  return getSessionEnabledAgents(session).includes(agentName);
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

  session.enabledAgents = getAllAgentNames().filter(name => enabledSet.has(name));
  const currentAgentWillExpire = !enabled && session.currentAgent === agentName;
  touchSession(session);
  return {
    enabledAgents: [...session.enabledAgents],
    currentAgentWillExpire
  };
}

function collectEligibleMentions(message: string, session: UserChatSession): { mentions: string[]; ignoredMentions: string[] } {
  const allMentions = agentManager.extractMentions(message);
  const enabledSet = new Set(getSessionEnabledAgents(session));
  return {
    mentions: allMentions.filter(name => enabledSet.has(name)),
    ignoredMentions: allMentions.filter(name => !enabledSet.has(name))
  };
}

function expireDisabledCurrentAgent(userKey: string, session: UserChatSession): string | null {
  if (!session.currentAgent) return null;
  if (isAgentEnabledForSession(session, session.currentAgent)) {
    return session.currentAgent;
  }
  setUserCurrentAgent(userKey, session.id, null);
  return null;
}

function buildNoEnabledAgentsNotice(session: UserChatSession, ignoredMentions: string[] = []): string {
  if (ignoredMentions.length > 0) {
    return `${ignoredMentions.join('、')} 已停用，当前会话还没有可用智能体，请先启用上方智能体。`;
  }
  if (getSessionEnabledAgents(session).length === 0) {
    return '当前会话还没有启用智能体，请先启用上方智能体。';
  }
  return '当前会话没有可用智能体，请先启用上方智能体。';
}

function touchSession(session: UserChatSession): void {
  session.updatedAt = Date.now();
  schedulePersistChatSessions();
}

function getUserHistory(userKey: string, sessionId: string): Message[] {
  return ensureUserSessions(userKey).get(sessionId)?.history || [];
}

function getUserCurrentAgent(userKey: string, sessionId: string): string | null {
  const session = ensureUserSessions(userKey).get(sessionId);
  if (!session) return null;
  return expireDisabledCurrentAgent(userKey, session);
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

function getCallbackMessageKey(sessionId: string, agentName: string): string {
  return `${sessionId}::${agentName}`;
}

function addCallbackMessage(sessionId: string, agentName: string, content: string, invokeAgents?: string[]): Message {
  const key = getCallbackMessageKey(sessionId, agentName);
  const queue = callbackMessages.get(key) || [];
  const msg: Message = {
    id: generateId(),
    role: 'assistant',
    sender: agentName,
    text: content,
    timestamp: Date.now(),
    invokeAgents: invokeAgents && invokeAgents.length > 0 ? invokeAgents : undefined
  };
  queue.push(msg);
  callbackMessages.set(key, queue);
  return msg;
}

function consumeCallbackMessages(sessionId: string, agentName: string): Message[] {
  const key = getCallbackMessageKey(sessionId, agentName);
  const queue = callbackMessages.get(key) || [];
  callbackMessages.delete(key);
  return queue;
}

function buildAgentVisibleMessages(agentName: string, providerResult: AgentInvokeResult | null, fallbackMessage: Message | null, callbackReplies: Message[]): Message[] {
  if (callbackReplies.length > 0) {
    return callbackReplies;
  }

  if (providerResult && (providerResult.text || providerResult.blocks.length > 0)) {
    return [{
      id: generateId(),
      role: 'assistant',
      sender: agentName,
      text: providerResult.text,
      blocks: providerResult.blocks as RichBlock[],
      timestamp: Date.now()
    }];
  }

  return fallbackMessage ? [fallbackMessage] : [];
}

function shouldSurfaceCliError(message: string): boolean {
  const normalized = (message || '').toLowerCase();
  if (!normalized) return false;

  return normalized.includes('deactivated_workspace')
    || normalized.includes('payment required')
    || normalized.includes('usage limit')
    || normalized.includes('rate limit')
    || normalized.includes('too many requests')
    || normalized.includes('auth error')
    || normalized.includes('unauthorized')
    || normalized.includes('forbidden')
    || normalized.includes('402');
}

function isCliWorkspaceAuthError(message: string): boolean {
  const normalized = (message || '').toLowerCase();
  return normalized.includes('deactivated_workspace')
    || normalized.includes('payment required')
    || normalized.includes('auth error')
    || normalized.includes('unauthorized')
    || normalized.includes('forbidden')
    || normalized.includes('402');
}

function isCliUsageLimitError(message: string): boolean {
  const normalized = (message || '').toLowerCase();
  return normalized.includes('usage limit')
    || normalized.includes('rate limit')
    || normalized.includes('too many requests')
    || normalized.includes('429');
}

function buildCliErrorVisibleText(message: string): string {
  const normalized = (message || '').trim();
  if (isCliWorkspaceAuthError(normalized)) {
    return '账号或工作区异常：请检查 Codex 登录状态、套餐/额度或 workspace 是否已恢复。';
  }
  if (isCliUsageLimitError(normalized)) {
    return `调用额度已用尽：请稍后重试。${normalized ? ` 原始错误：${normalized}` : ''}`.trim();
  }
  return normalized ? `CLI 调用失败：${normalized}` : 'CLI 调用失败：智能体执行异常';
}

function isInternalToolOrchestrationLeak(text: string): boolean {
  const normalized = (text || '').toLowerCase();
  if (!normalized) return false;
  const mentionsTool = normalized.includes('bot_room_get_context') || normalized.includes('bot_room_post_message');
  const mentionsOrchestration = normalized.includes('同步到群里')
    || normalized.includes('公开聊天室')
    || normalized.includes('完整会话历史')
    || normalized.includes('拿到完整历史后')
    || normalized.includes('已按要求先调用')
    || normalized.includes('先读取会话协作技能说明');
  return mentionsTool && mentionsOrchestration;
}

function buildInternalToolLeakVisibleText(): string {
  return '协作工具调用未成功：智能体未能读取完整上下文或同步公开消息，请稍后重试。';
}

async function runAgentTask(params: {
  userKey: string;
  session: UserChatSession;
  task: AgentDispatchTask;
  stream: boolean;
  onTextDelta?: (delta: string) => void;
}): Promise<Message[]> {
  const { userKey, session, task, stream, onTextDelta } = params;
  const { agentName, prompt, includeHistory } = task;
  const agent = agentManager.getAgent(agentName);
  if (!agent) return [];

  const runtimeWorkdir = getUserAgentWorkdir(userKey, session.id, agentName) || agent.workdir;
  const runtimeAgent = runtimeWorkdir ? { ...agent, workdir: runtimeWorkdir } : agent;
  const logTag = stream ? 'ChatStream' : 'Chat';
  const isApiMode = runtimeAgent.executionMode === 'api';
  const startStage = isApiMode ? 'api_start' : 'cli_start';
  const doneStage = isApiMode ? 'api_done' : 'cli_done';
  const errorStage = isApiMode ? 'api_error' : 'cli_error';

  console.log(`[${logTag}] 调用 AI: ${agentName}`);
  appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${agentName} stage=start stream=${stream}`);
  appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${agentName} stage=${startStage} stream=${stream}`);

  const callbackEnv: Record<string, string> = {
    BOT_ROOM_API_URL: `http://127.0.0.1:${PORT}`,
    BOT_ROOM_SESSION_ID: session.id,
    BOT_ROOM_AGENT_NAME: agentName,
    BOT_ROOM_CALLBACK_TOKEN: CALLBACK_AUTH_TOKEN
  };

  let fallbackMessage: Message | null = null;
  let providerResult: AgentInvokeResult | null = null;
  try {
    const result = await invokeAgent({
      userMessage: prompt,
      agent: runtimeAgent,
      history: session.history,
      includeHistory,
      extraEnv: callbackEnv,
      onTextDelta
    });
    providerResult = result;
    appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${agentName} stage=${doneStage} text_len=${result.text.length} blocks=${result.blocks.length}`);
  } catch (error: unknown) {
    const err = error as Error;
    console.log(`[${logTag}] AI 调用失败: ${err.message}`);
    const surfaceCliError = !isApiMode && shouldSurfaceCliError(err.message);
    if (!stream && !isApiMode && !surfaceCliError) {
      console.log('[Chat] 使用模拟回复');
    }
    appendOperationalLog('error', 'chat-exec', `session=${session.id} agent=${agentName} stage=${errorStage} error=${err.message}`);
    const fallbackText = isApiMode
      ? `API 调用失败：${err.message}`
      : surfaceCliError
        ? buildCliErrorVisibleText(err.message)
        : generateMockReply(prompt, agentName);
    const extracted = extractRichBlocks(fallbackText);
    fallbackMessage = {
      id: generateId(),
      role: 'assistant',
      sender: agentName,
      text: extracted.cleanText,
      blocks: extracted.blocks,
      timestamp: Date.now()
    };
  }

  const callbackReplies = consumeCallbackMessages(session.id, agentName);
  const visibleMessages = buildAgentVisibleMessages(agentName, providerResult, fallbackMessage, callbackReplies);

  if (callbackReplies.length === 0) {
    for (const message of visibleMessages) {
      if (isInternalToolOrchestrationLeak(message.text || '')) {
        appendOperationalLog('error', 'chat-exec', `session=${session.id} agent=${agentName} stage=internal_tool_leak_filtered`);
        message.text = buildInternalToolLeakVisibleText();
        message.blocks = [];
      }
    }
  }

  if (callbackReplies.length === 0 && providerResult && (providerResult.text || providerResult.blocks.length > 0)) {
    appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${agentName} stage=direct_fallback reason=no_callback`);
  }

  if (visibleMessages.length === 0) {
    appendOperationalLog('error', 'chat-exec', `session=${session.id} agent=${agentName} stage=empty_visible_message`);
  }

  return visibleMessages;
}

async function executeAgentTurn(params: {
  userKey: string;
  session: UserChatSession;
  initialTasks: AgentDispatchTask[];
  stream: boolean;
  onThinking?: (agentName: string) => void;
  onTextDelta?: (agentName: string, delta: string) => void;
  onMessage?: (message: Message) => void;
  shouldContinue?: () => boolean;
  pendingTasks?: PendingAgentDispatchTask[];
}): Promise<{ aiMessages: Message[]; pendingTasks: PendingAgentDispatchTask[] }> {
  const { userKey, session, initialTasks, stream, onThinking, onTextDelta, onMessage, shouldContinue } = params;
  const queue: PendingAgentDispatchTask[] = Array.isArray(params.pendingTasks)
    ? params.pendingTasks.map(task => ({ ...task, dispatchKind: normalizeDispatchKind(task.dispatchKind) }))
    : initialTasks.map(task => ({ ...task, dispatchKind: 'initial' }));
  const aiMessages: Message[] = [];
  const callCounts = new Map<string, number>();
  const { agentChainMaxHops, agentChainMaxCallsPerAgent } = normalizeSessionChainSettings(session);
  const { discussionMode } = normalizeSessionDiscussionSettings(session);
  let chainedCalls = 0;
  let streamStopped = false;
  let chainLimitReached = false;
  let sawVisibleMessage = false;
  let queuedExplicitContinuationDuringTurn = false;

  const canContinue = () => shouldContinue ? shouldContinue() : true;

  while (queue.length > 0) {
    if (!canContinue()) {
      streamStopped = true;
      appendOperationalLog('info', 'chat-exec', `session=${session.id} stage=stream_stop reason=client_disconnect`);
      break;
    }

    const task = queue.shift()!;
    if (isChainedDispatchKind(task.dispatchKind) && chainedCalls >= agentChainMaxHops) {
      chainLimitReached = true;
      appendOperationalLog('info', 'chat-exec', `session=${session.id} stage=chain_stop reason=max_hops hops=${agentChainMaxHops}`);
      break;
    }

    const currentCalls = callCounts.get(task.agentName) || 0;
    if (agentChainMaxCallsPerAgent !== null && currentCalls >= agentChainMaxCallsPerAgent) {
      appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${task.agentName} stage=chain_skip reason=max_calls count=${currentCalls}`);
      continue;
    }

    callCounts.set(task.agentName, currentCalls + 1);
    if (isChainedDispatchKind(task.dispatchKind)) {
      chainedCalls += 1;
    }
    onThinking?.(task.agentName);

    const visibleMessages = await runAgentTask({
      userKey,
      session,
      task,
      stream,
      onTextDelta: onTextDelta
        ? (delta) => onTextDelta(task.agentName, delta)
        : undefined
    });

    for (const rawMessage of visibleMessages) {
      // 收集引用型 @ mentions（仅用于显示，不触发链式）
      const { mentions: referenceMentions } = collectEligibleMentions(rawMessage.text || '', session);

      // 链式触发来源：callback invokeAgents > @@ 文本解析，不再从单 @ 触发
      let chainTargets: string[];
      if (rawMessage.invokeAgents && rawMessage.invokeAgents.length > 0) {
        chainTargets = rawMessage.invokeAgents;
      } else {
        chainTargets = agentManager.extractChainInvocations(rawMessage.text || '');
      }
      const chainedMentions = chainTargets.filter(name => name !== rawMessage.sender && agentManager.hasAgent(name));

      // 当 invokeAgents 来自 callback 但文本中还没有 @@ 标记时，自动将 @AgentName 升级为 @@AgentName
      let displayText = rawMessage.text || '';
      if (rawMessage.invokeAgents && rawMessage.invokeAgents.length > 0 && !agentManager.extractChainInvocations(displayText).length) {
        for (const agentName of rawMessage.invokeAgents) {
          const escapedName = agentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          displayText = displayText.replace(new RegExp(`@${escapedName}`, 'g'), `@@${agentName}`);
        }
      }

      const message = {
        ...rawMessage,
        text: displayText,
        mentions: referenceMentions.length > 0 ? referenceMentions : undefined,
        invokeAgents: chainedMentions.length > 0 ? chainedMentions : undefined,
        dispatchKind: task.dispatchKind
      };

      sawVisibleMessage = true;
      if (chainedMentions.length > 0) {
        queuedExplicitContinuationDuringTurn = true;
      }

      session.history.push(message);
      aiMessages.push(message);
      touchSession(session);
      onMessage?.(message);
      if (stream) {
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      const pendingMentionsToQueue: PendingAgentDispatchTask[] = [];

      for (const mention of chainedMentions) {
        const queuedChainedCalls = queue.filter(item => isChainedDispatchKind(item.dispatchKind)).length;
        if (chainedCalls + queuedChainedCalls + pendingMentionsToQueue.length >= agentChainMaxHops) {
          break;
        }

        const queuedCalls = callCounts.get(mention) || 0;
        const pendingCalls = queue.filter(item => item.agentName === mention).length
          + pendingMentionsToQueue.filter(item => item.agentName === mention).length;
        if (agentChainMaxCallsPerAgent !== null && queuedCalls + pendingCalls >= agentChainMaxCallsPerAgent) {
          appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${mention} stage=chain_skip reason=max_calls_pending count=${queuedCalls} pending=${pendingCalls}`);
          continue;
        }

        pendingMentionsToQueue.push({
          agentName: mention,
          prompt: message.text || '',
          includeHistory: true,
          dispatchKind: 'explicit_chained'
        });
      }

      if (!canContinue()) {
        streamStopped = true;
        queue.unshift(...pendingMentionsToQueue);
        appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${task.agentName} stage=stream_stop_after_message reason=client_disconnect`);
        break;
      }

      queue.push(...pendingMentionsToQueue);

      if (streamStopped) {
        break;
      }
    }

    if (streamStopped) {
      break;
    }
  }

  if (!streamStopped && discussionMode === 'peer' && sawVisibleMessage && !chainLimitReached) {
    if (queuedExplicitContinuationDuringTurn) {
      session.discussionState = 'active';
    } else {
      session.discussionState = 'paused';
      appendOperationalLog('info', 'chat-exec', `session=${session.id} stage=discussion_pause reason=no_explicit_continuation mode=peer`);
    }
    touchSession(session);
  }

  return {
    aiMessages,
    pendingTasks: streamStopped ? queue.map(task => ({ ...task, dispatchKind: normalizeDispatchKind(task.dispatchKind) })) : []
  };
}

function getSessionById(sessionId: string): UserChatSession | null {
  for (const sessions of userChatSessions.values()) {
    const found = sessions.get(sessionId);
    if (found) return found;
  }

  return null;
}

function getCallbackToken(req: http.IncomingMessage): string {
  const authHeader = (req.headers.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  return String(req.headers[CALLBACK_AUTH_HEADER] || '').trim();
}

function isCallbackAuthorized(req: http.IncomingMessage): boolean {
  return getCallbackToken(req) === CALLBACK_AUTH_TOKEN;
}

function setUserCurrentAgent(userKey: string, sessionId: string, agentName: string | null): void {
  const session = ensureUserSessions(userKey).get(sessionId);
  if (!session) return;
  session.currentAgent = agentName;
  touchSession(session);
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
  userActiveChatSession.set(userKey, sessionId);
  schedulePersistChatSessions();
  return true;
}

function createChatSessionForUser(userKey: string, name?: string): UserChatSession {
  const sessions = ensureUserSessions(userKey);
  const newSession = createUserSession(name);
  sessions.set(newSession.id, newSession);
  userActiveChatSession.set(userKey, newSession.id);
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
    return { success: false, activeSessionId: userActiveChatSession.get(userKey) || DEFAULT_CHAT_SESSION_ID };
  }

  sessions.delete(sessionId);
  const currentActive = userActiveChatSession.get(userKey);
  if (currentActive === sessionId) {
    const fallback = sessions.values().next().value as UserChatSession;
    userActiveChatSession.set(userKey, fallback.id);
  }

  schedulePersistChatSessions();

  return { success: true, activeSessionId: userActiveChatSession.get(userKey) || DEFAULT_CHAT_SESSION_ID };
}

const authSessions = new Map<string, AuthSession>();

// AI 智能体管理器（由共享配置文件驱动）
let agentStore = loadAgentStore(AGENT_DATA_FILE);
let agentStoreMtimeMs = fs.existsSync(AGENT_DATA_FILE) ? fs.statSync(AGENT_DATA_FILE).mtimeMs : 0;
const agentManager = new AgentManager(agentStore.activeAgents);

// ============================================
// 修复 1: 生产环境安全检查
// ============================================
function performSecurityChecks(): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const warnings: string[] = [];

  // 检查 ADMIN_TOKEN
  const adminToken = process.env.AUTH_ADMIN_TOKEN;
  if (isProduction) {
    if (!adminToken) {
      console.error('❌ 生产环境必须设置 AUTH_ADMIN_TOKEN 环境变量');
      process.exit(1);
    }
    if (adminToken.length < 32) {
      console.error('❌ AUTH_ADMIN_TOKEN 长度不能少于 32 字符');
      process.exit(1);
    }
    if (adminToken === 'change-me-in-production') {
      console.error('❌ AUTH_ADMIN_TOKEN 不能使用默认值');
      process.exit(1);
    }
  } else {
    if (!adminToken || adminToken === 'change-me-in-production') {
      warnings.push('⚠️ AUTH_ADMIN_TOKEN 未设置或使用默认值（仅开发环境允许）');
    }
  }

  // 检查默认密码
  const defaultPassword = process.env.BOT_ROOM_DEFAULT_PASSWORD;
  if (isProduction && defaultPassword) {
    // 简单检查密码强度
    if (defaultPassword.length < 12) {
      console.error('❌ 生产环境 BOT_ROOM_DEFAULT_PASSWORD 长度不能少于 12 字符');
      process.exit(1);
    }
    const hasLower = /[a-z]/.test(defaultPassword);
    const hasUpper = /[A-Z]/.test(defaultPassword);
    const hasNumber = /[0-9]/.test(defaultPassword);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(defaultPassword);
    if (!(hasLower && hasUpper && hasNumber && hasSpecial)) {
      console.error('❌ 生产环境 BOT_ROOM_DEFAULT_PASSWORD 必须包含大小写字母、数字和特殊字符');
      process.exit(1);
    }
  }

  // 输出警告
  if (warnings.length > 0) {
    console.log('\n' + '='.repeat(60));
    console.log('🔒 安全检查警告');
    console.log('='.repeat(60));
    warnings.forEach(w => console.log(w));
    console.log('='.repeat(60) + '\n');
  }
}

// 启动时执行安全检查
performSecurityChecks();

function isChatSessionActive(): boolean {
  for (const sessions of Array.from(userChatSessions.values())) {
    for (const session of Array.from(sessions.values())) {
      if (session.history.length > 0 || session.currentAgent) {
        return true;
      }
    }
  }
  return false;
}

function syncAgentsFromStore(): void {
  try {
    const mtime = fs.existsSync(AGENT_DATA_FILE) ? fs.statSync(AGENT_DATA_FILE).mtimeMs : 0;
    if (mtime <= agentStoreMtimeMs && !agentStore.pendingAgents) {
      return;
    }

    agentStore = loadAgentStore(AGENT_DATA_FILE);
    agentStoreMtimeMs = mtime;

    if (agentStore.pendingAgents && !isChatSessionActive()) {
      agentStore = applyPendingAgents(agentStore);
      saveAgentStore(AGENT_DATA_FILE, agentStore);
      agentStoreMtimeMs = fs.existsSync(AGENT_DATA_FILE) ? fs.statSync(AGENT_DATA_FILE).mtimeMs : Date.now();
      console.log('[AgentStore] 已应用等待生效的智能体配置');
    }

    agentManager.replaceAgents(agentStore.activeAgents);
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[AgentStore] 同步失败:', err.message);
  }
}

// ============================================
// 工具函数
// ============================================

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};

  const entries = header.split(';').map(part => part.trim().split('='));
  const cookieMap: Record<string, string> = {};
  entries.forEach(([key, value]) => {
    if (key && value) cookieMap[key] = decodeURIComponent(value);
  });
  return cookieMap;
}

function issueSessionToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

function issueVisitorId(): string {
  return crypto.randomBytes(16).toString('hex');
}

function setVisitorCookie(res: http.ServerResponse, visitorId: string): void {
  const attrs = [
    `${CHAT_VISITOR_COOKIE_NAME}=${encodeURIComponent(visitorId)}`,
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    'HttpOnly',
    'SameSite=Lax'
  ].join('; ');

  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', attrs);
    return;
  }

  const values = Array.isArray(existing) ? existing : [String(existing)];
  values.push(attrs);
  res.setHeader('Set-Cookie', values);
}

function getChatVisitorIdFromRequest(req: http.IncomingMessage): string | null {
  const cookies = parseCookies(req);
  const visitorId = cookies[CHAT_VISITOR_COOKIE_NAME];
  if (!visitorId) return null;
  if (!/^[a-f0-9]{32}$/i.test(visitorId)) return null;
  return visitorId.toLowerCase();
}

function ensureVisitorId(req: http.IncomingMessage, res: http.ServerResponse): string {
  const existing = getChatVisitorIdFromRequest(req);
  if (existing) return existing;
  const visitorId = issueVisitorId();
  setVisitorCookie(res, visitorId);
  return visitorId;
}

function isAuthenticated(req: http.IncomingMessage): boolean {
  if (!AUTH_ENABLED) return true;

  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return false;

  const session = authSessions.get(token);
  if (!session) return false;

  if (Date.now() > session.expiresAt) {
    authSessions.delete(token);
    return false;
  }

  return true;
}

function setSessionCookie(res: http.ServerResponse, token: string): void {
  // 注意: Secure 标志只在 HTTPS 下有效，如果通过 HTTP 访问会导致 cookie 无法发送
  // 这里不设置 Secure，让反向代理(如 nginx)处理 HTTPS
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    'HttpOnly',
    'SameSite=Lax'
  ].join('; ');

  res.setHeader('Set-Cookie', attrs);
}

function clearSessionCookie(res: http.ServerResponse): void {
  const attrs = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax'
  ].join('; ');

  res.setHeader('Set-Cookie', attrs);
}

async function handleLogin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!AUTH_ENABLED) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, authEnabled: false }));
    return;
  }

  // 修复 2: 登录速率限制
  const clientIP = getClientIP(req);
  const loginLimit = checkRateLimit(`login:${clientIP}`, LOGIN_RATE_LIMIT_MAX);
  if (!loginLimit.allowed) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: '登录尝试过于频繁，请稍后再试',
      retryAfter: Math.ceil((loginLimit.resetAt - Date.now()) / 1000)
    }));
    return;
  }

  try {
    const body = await parseBody<{ username?: string; password?: string }>(req);
    const username = (body.username || '').trim().toLowerCase();

    if (!username || !body.password) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少用户名或密码' }));
      return;
    }

    const verifyResult = await verifyCredentials(username, body.password);
    if (!verifyResult.success) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: verifyResult.error || '用户名或密码错误' }));
      return;
    }

    const existingToken = parseCookies(req)[SESSION_COOKIE_NAME];
    const visitorId = ensureVisitorId(req, res);
    const token = issueSessionToken();
    authSessions.set(token, {
      username,
      expiresAt: Date.now() + SESSION_TTL_MS
    });
    migrateLegacySessionUserData(`visitor:${visitorId}`, buildUserKey(username));
    if (existingToken) authSessions.delete(existingToken);
    setSessionCookie(res, token);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, authEnabled: true }));
  } catch (error: unknown) {
    const err = error as Error;
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

function handleLogout(req: http.IncomingMessage, res: http.ServerResponse): void {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  const visitorId = ensureVisitorId(req, res);
  if (token) {
    const session = authSessions.get(token);
    if (session) {
      migrateLegacySessionUserData(buildUserKey(session.username), `visitor:${visitorId}`);
    }
    authSessions.delete(token);
  }
  clearSessionCookie(res);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true }));
}

function handleAuthStatus(req: http.IncomingMessage, res: http.ServerResponse): void {
  ensureVisitorId(req, res);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    authEnabled: AUTH_ENABLED,
    authenticated: isAuthenticated(req)
  }));
}

function requiresAuthentication(pathname: string): boolean {
  if (!AUTH_ENABLED) return false;

  const publicPaths = new Set([
    '/api/login',
    '/api/logout',
    '/api/auth-status',
    '/api/dependencies/status',
    '/api/callbacks/post-message',
    '/api/callbacks/thread-context'
  ]);

  return pathname.startsWith('/api/') && !publicPaths.has(pathname);
}

function verifyCredentials(username: string, password: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    const targetUrl = new URL('/api/auth/verify', AUTH_ADMIN_BASE_URL);
    const payload = JSON.stringify({ username, password });

    const request = http.request({
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: targetUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 3000
    }, response => {
      let responseBody = '';
      response.on('data', chunk => (responseBody += chunk));
      response.on('end', () => {
        try {
          const data = responseBody ? JSON.parse(responseBody) as { success?: boolean; error?: string } : {};
          if (response.statusCode === 200 && data.success) {
            resolve({ success: true });
            return;
          }

          resolve({ success: false, error: data.error || '鉴权失败' });
        } catch {
          resolve({ success: false, error: '鉴权服务返回格式错误' });
        }
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error('鉴权服务超时'));
    });

    request.on('error', err => {
      reject(new Error(`鉴权服务不可用: ${err.message}`));
    });

    request.write(payload);
    request.end();
  });
}

/**
 * 解析 JSON 请求体
 */
async function handleCallbackPostMessage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!isCallbackAuthorized(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  try {
    const body = await parseBody<{ content?: string; invokeAgents?: string[] }>(req);
    const content = (body.content || '').trim();
    if (!content) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少 content 字段' }));
      return;
    }

    const sessionId = String(req.headers['x-bot-room-session-id'] || '').trim();
    const rawAgentName = String(req.headers['x-bot-room-agent'] || 'AI').trim() || 'AI';
    let agentName = rawAgentName;
    try {
      agentName = decodeURIComponent(rawAgentName);
    } catch {
      agentName = rawAgentName;
    }

    if (!sessionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少 x-bot-room-session-id 头' }));
      return;
    }

    const invokeAgents = Array.isArray(body.invokeAgents)
      ? body.invokeAgents.filter((n): n is string => typeof n === 'string' && !!n.trim())
      : undefined;
    addCallbackMessage(sessionId, agentName, content, invokeAgents);
    console.log(`
[聊天室消息][${agentName}] ${content}`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  } catch (error: unknown) {
    const err = error as Error;
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

function handleCallbackThreadContext(req: http.IncomingMessage, res: http.ServerResponse, requestUrl: URL): void {
  if (!isCallbackAuthorized(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  const sessionId = (requestUrl.searchParams.get('sessionid') || '').trim();
  if (!sessionId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '缺少 sessionid 参数' }));
    return;
  }

  const session = getSessionById(sessionId);
  if (!session) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '会话不存在' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ sessionId, messages: session.history }));
}

function parseBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ============================================
// 路由处理
// ============================================

/**
 * 处理获取智能体列表
 */
function handleGetAgents(req: http.IncomingMessage, res: http.ServerResponse): void {
  syncAgentsFromStore();
  const agents = agentManager.getAgentConfigs();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ agents }));
}

async function handleSetSessionAgent(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    syncAgentsFromStore();
    const body = await parseBody<{ sessionId?: string; agentName?: string; enabled?: boolean }>(req);
    const { userKey, session } = resolveChatSession(req);
    const sessionId = (body.sessionId || session.id).trim() || session.id;
    const agentName = (body.agentName || '').trim();

    if (!agentName || !agentManager.hasAgent(agentName)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '智能体不存在' }));
      return;
    }

    if (typeof body.enabled !== 'boolean') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'enabled 必须是布尔值' }));
      return;
    }

    const result = setSessionEnabledAgent(userKey, sessionId, agentName, body.enabled);
    if (!result) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '会话不存在' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, ...result }));
  } catch (error: unknown) {
    const err = error as Error;
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * 处理发送消息
 */
async function handleSendMessage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // 修复 2: 全局速率限制
  const clientIP = getClientIP(req);
  const rateLimit = checkRateLimit(clientIP, RATE_LIMIT_MAX_REQUESTS);
  if (!rateLimit.allowed) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: '请求过于频繁，请稍后再试',
      retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000)
    }));
    return;
  }

  try {
    syncAgentsFromStore();
    const body = await parseBody<ChatRequest & { message: string; sender?: string }>(req);
    const { message, sender: bodySender } = body;
    const sender = bodySender || DEFAULT_USER_NAME;
    if (!message) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少 message 字段' }));
      return;
    }

    const { userKey, session } = resolveChatSession(req);
    const sessionId = `${userKey}::${session.id}`;
    const userHistory = session.history;
    const currentAgent = expireDisabledCurrentAgent(userKey, session);
    session.discussionState = 'active';
    session.pendingAgentTasks = undefined;
    session.pendingVisibleMessages = undefined;

    console.log(`\n[Chat] 会话 ${sessionId.substring(0, 12)}... 用户 ${sender}: ${message}`);

    // 提取 @ 提及
    const { mentions, ignoredMentions } = collectEligibleMentions(message, session);
    console.log(`[Chat] @ 提及: ${mentions.join(', ') || '无'}`);

    // 确定要响应的智能体列表
    const agentsToRespond: string[] = [];

    if (mentions.length > 0) {
      // 有新的 @ 提及，使用这些智能体，并更新会话状态
      for (const mention of mentions) {
        agentsToRespond.push(mention);
      }
      // 只记住第一个被 @ 的智能体作为后续默认对话对象
      setUserCurrentAgent(userKey, session.id, mentions[0]);
      console.log(`[Chat] 设置当前对话智能体: ${mentions[0]}`);
    } else if (currentAgent) {
      // 没有新的 @ 提及，但有之前的对话智能体
      agentsToRespond.push(currentAgent);
      console.log(`[Chat] 继续与 ${currentAgent} 对话`);
    }

    // 创建用户消息
    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      sender,
      text: message,
      timestamp: Date.now(),
      mentions: mentions.length > 0 ? mentions : undefined
    };

    // 添加到用户历史
    userHistory.push(userMessage);
    touchSession(session);

    if (agentsToRespond.length === 0) {
      const notice = buildNoEnabledAgentsNotice(session, ignoredMentions);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        userMessage,
        aiMessages: [],
        currentAgent: getUserCurrentAgent(userKey, session.id),
        notice
      }));
      return;
    }

    session.pendingAgentTasks = undefined;
    const { aiMessages } = await executeAgentTurn({
      userKey,
      session,
      initialTasks: agentsToRespond.map(agentName => ({
        agentName,
        prompt: message,
        includeHistory: mentions.length === 0
      })),
      stream: false
    });
    const emptyVisibleNotice = aiMessages.length === 0
      ? `${agentsToRespond.join('、')} 未返回可见消息，请稍后重试或查看日志。`
      : undefined;

    // 返回响应
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      userMessage,
      aiMessages,
      currentAgent: getUserCurrentAgent(userKey, session.id),
      notice: emptyVisibleNotice || (ignoredMentions.length > 0 ? `${ignoredMentions.join('、')} 已停用，未参与本次对话。` : undefined)
    }));
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[Chat Error]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * 处理流式发送消息 (SSE)
 * 每个智能体回复完成后立即推送
 */
async function handleChatStream(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // 速率限制
  const clientIP = getClientIP(req);
  const rateLimit = checkRateLimit(clientIP, RATE_LIMIT_MAX_REQUESTS);
  if (!rateLimit.allowed) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: '请求过于频繁，请稍后再试',
      retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000)
    }));
    return;
  }

  try {
    syncAgentsFromStore();
    const body = await parseBody<ChatRequest & { message: string; sender?: string }>(req);
    const { message, sender: bodySender } = body;
    const sender = bodySender || DEFAULT_USER_NAME;
    if (!message) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少 message 字段' }));
      return;
    }

    const { userKey, session } = resolveChatSession(req);
    const sessionId = `${userKey}::${session.id}`;
    const userHistory = session.history;
    const currentAgent = expireDisabledCurrentAgent(userKey, session);
    session.discussionState = 'active';
    session.pendingAgentTasks = undefined;
    session.pendingVisibleMessages = undefined;

    console.log(`\n[ChatStream] 会话 ${sessionId.substring(0, 12)}... 用户 ${sender}: ${message}`);

    // 提取 @ 提及
    const { mentions, ignoredMentions } = collectEligibleMentions(message, session);
    console.log(`[ChatStream] @ 提及: ${mentions.join(', ') || '无'}`);

    // 确定要响应的智能体列表
    const agentsToRespond: string[] = [];

    if (mentions.length > 0) {
      for (const mention of mentions) {
        agentsToRespond.push(mention);
      }
      setUserCurrentAgent(userKey, session.id, mentions[0]);
      console.log(`[ChatStream] 设置当前对话智能体: ${mentions[0]}`);
    } else if (currentAgent) {
      agentsToRespond.push(currentAgent);
      console.log(`[ChatStream] 继续与 ${currentAgent} 对话`);
    }

    // 创建用户消息
    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      sender,
      text: message,
      timestamp: Date.now(),
      mentions: mentions.length > 0 ? mentions : undefined
    };

    // 添加到用户历史
    userHistory.push(userMessage);
    touchSession(session);

    // 设置 SSE 响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no' // 禁用 Nginx 缓冲
    });

    let streamClosed = false;
    let streamCompleted = false;
    const undeliveredMessages: Message[] = [];
    const markStreamClosed = (source: 'req_aborted' | 'req_close' | 'res_close') => {
      if (streamClosed) {
        return;
      }
      streamClosed = true;
      if (!streamCompleted) {
        appendOperationalLog('info', 'chat-exec', `session=${session.id} stage=stream_disconnect reason=client_disconnect source=${source}`);
      }
    };
    req.on('aborted', () => markStreamClosed('req_aborted'));
    req.on('close', () => markStreamClosed('req_close'));
    res.on('close', () => markStreamClosed('res_close'));

    // 发送用户消息事件
    const sendEvent = (event: string, data: unknown) => {
      if (streamClosed || res.writableEnded || res.destroyed) {
        return false;
      }
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      // 强制刷新缓冲区，确保数据立即发送
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
      return true;
    };

    sendEvent('user_message', userMessage);

    // 如果没有智能体可以响应
    if (agentsToRespond.length === 0) {
      sendEvent('notice', { notice: buildNoEnabledAgentsNotice(session, ignoredMentions) });
      sendEvent('done', { currentAgent: getUserCurrentAgent(userKey, session.id) });
      streamCompleted = true;
      res.end();
      return;
    }

    session.pendingAgentTasks = undefined;
    const executionResult = await executeAgentTurn({
      userKey,
      session,
      initialTasks: agentsToRespond.map(agentName => ({
        agentName,
        prompt: message,
        includeHistory: mentions.length === 0
      })),
      stream: true,
      shouldContinue: () => !streamClosed && !res.writableEnded && !res.destroyed,
      onThinking: (agentName) => {
        sendEvent('agent_thinking', { agent: agentName });
      },
      onTextDelta: (agentName, delta) => {
        sendEvent('agent_delta', { agent: agentName, delta });
      },
      onMessage: (visibleMessage) => {
        const delivered = sendEvent('agent_message', visibleMessage);
        if (!delivered) {
          undeliveredMessages.push(visibleMessage);
        }
      }
    });
    session.pendingAgentTasks = executionResult.pendingTasks.length > 0
      ? executionResult.pendingTasks
      : undefined;
    session.pendingVisibleMessages = undeliveredMessages.length > 0
      ? undeliveredMessages
      : undefined;

    if (streamClosed || res.writableEnded || res.destroyed) {
      return;
    }

    if (executionResult.aiMessages.length === 0) {
      sendEvent('error', { error: `${agentsToRespond.join('、')} 未返回可见消息，请稍后重试或查看日志。` });
    }

    // 发送完成事件
    if (ignoredMentions.length > 0) {
      sendEvent('notice', { notice: `${ignoredMentions.join('、')} 已停用，未参与本次对话。` });
    }
    sendEvent('done', { currentAgent: getUserCurrentAgent(userKey, session.id) });
    streamCompleted = true;
    res.end();

  } catch (error: unknown) {
    const err = error as Error;
    console.error('[ChatStream Error]', err);
    // 如果响应头还没发送，发送错误响应
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    } else {
      // 已发送响应头，通过 SSE 发送错误
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
}

async function handleResumePendingChat(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    syncAgentsFromStore();
    const { userKey, session } = resolveChatSession(req);
    const pendingVisibleMessages = Array.isArray(session.pendingVisibleMessages)
      ? session.pendingVisibleMessages.map(message => ({ ...message }))
      : [];
    const pendingTasks = Array.isArray(session.pendingAgentTasks)
      ? session.pendingAgentTasks.map(task => ({ ...task }))
      : [];

    if (pendingVisibleMessages.length === 0 && pendingTasks.length === 0) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        resumed: false,
        aiMessages: [],
        currentAgent: getUserCurrentAgent(userKey, session.id),
        notice: '当前没有可继续执行的剩余链路。'
      }));
      return;
    }

    session.pendingVisibleMessages = undefined;
    session.pendingAgentTasks = undefined;
    const { aiMessages, pendingTasks: remainingTasks } = await executeAgentTurn({
      userKey,
      session,
      initialTasks: [],
      pendingTasks,
      stream: false
    });
    session.pendingAgentTasks = remainingTasks.length > 0 ? remainingTasks : undefined;
    const resumedMessages = [...pendingVisibleMessages, ...aiMessages];

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      resumed: true,
      aiMessages: resumedMessages,
      currentAgent: getUserCurrentAgent(userKey, session.id),
      notice: remainingTasks.length > 0 ? '仍有未完成链路，可再次继续执行。' : undefined
    }));
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[ChatResume Error]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * 处理获取历史记录
 */
function handleGetHistory(req: http.IncomingMessage, res: http.ServerResponse): void {
  syncAgentsFromStore();
  const { userKey, session } = resolveChatSession(req);
  const normalizedSession = buildDetailedSessionResponse(session);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    messages: normalizedSession.history,
    agents: agentManager.getAgentConfigs(),
    currentAgent: getUserCurrentAgent(userKey, normalizedSession.id),
    enabledAgents: getSessionEnabledAgents(normalizedSession),
    agentWorkdirs: normalizedSession.agentWorkdirs || {},
    session: normalizedSession,
    chatSessions: getSessionSummaries(userKey),
    activeSessionId: normalizedSession.id
  }));
}

function listDirectories(targetPath: string): Array<{ name: string; path: string }> {
  const normalizedPath = path.resolve(targetPath || '/');
  if (!path.isAbsolute(normalizedPath)) {
    throw new Error('path 必须是绝对路径');
  }
  if (!fs.existsSync(normalizedPath) || !fs.statSync(normalizedPath).isDirectory()) {
    throw new Error('目录不存在');
  }
  return fs.readdirSync(normalizedPath, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({
      name: entry.name,
      path: path.posix.join(normalizedPath, entry.name).replace(/\\/g, '/')
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, 200);
}

function collectWorkdirOptions(): string[] {
  const options = new Set<string>();
  for (const item of listDirectories('/')) {
    options.add(item.path);
  }
  for (const p of ['/workspace', '/root', '/tmp']) {
    try {
      if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) continue;
      options.add(p);
      for (const child of listDirectories(p)) {
        options.add(child.path);
      }
    } catch {
      // ignore
    }
  }
  return Array.from(options).sort((a, b) => a.localeCompare(b, 'zh-CN')).slice(0, 300);
}

function handleGetWorkdirOptions(req: http.IncomingMessage, res: http.ServerResponse): void {
  try {
    const options = collectWorkdirOptions();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ options }));
  } catch (error: unknown) {
    const err = error as Error;
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

function handleGetSystemDirs(req: http.IncomingMessage, res: http.ServerResponse, requestUrl: URL): void {
  try {
    const targetPath = requestUrl.searchParams.get('path') || '/';
    const directories = listDirectories(targetPath);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ directories }));
  } catch (error: unknown) {
    const err = error as Error;
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleSetWorkdir(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await parseBody<{ agentName?: string; workdir?: string }>(req);
    const { userKey, session } = resolveChatSession(req);
    const agentName = (body.agentName || '').trim();
    const workdir = (body.workdir || '').trim();
    if (!agentName || !agentManager.hasAgent(agentName)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '智能体不存在' }));
      return;
    }
    if (!workdir) {
      setUserAgentWorkdir(userKey, session.id, agentName, null);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, workdir: '' }));
      return;
    }
    if (!path.isAbsolute(workdir) || !fs.existsSync(workdir) || !fs.statSync(workdir).isDirectory()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'workdir 必须是存在的绝对目录' }));
      return;
    }
    setUserAgentWorkdir(userKey, session.id, agentName, workdir);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, workdir }));
  } catch (error: unknown) {
    const err = error as Error;
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * 处理清空历史
 */
function handleClearHistory(req: http.IncomingMessage, res: http.ServerResponse): void {
  const { userKey, session } = resolveChatSession(req);
  clearUserHistory(userKey, session.id);
  syncAgentsFromStore();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true }));
}

/**
 * 处理切换智能体
 */
function handleSwitchAgent(req: http.IncomingMessage, res: http.ServerResponse): void {
  parseBody<{ agent?: string }>(req).then(body => {
    const { userKey, session } = resolveChatSession(req);
    const agentName = body.agent;
    if (agentName && agentManager.hasAgent(agentName) && isAgentEnabledForSession(session, agentName)) {
      setUserCurrentAgent(userKey, session.id, agentName);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, currentAgent: agentName }));
    } else if (agentName && agentManager.hasAgent(agentName)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `智能体未在当前会话启用: ${agentName}` }));
    } else if (!agentName) {
      // 清除当前智能体
      setUserCurrentAgent(userKey, session.id, null);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, currentAgent: null }));
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `未知的智能体: ${agentName}` }));
    }
  }).catch(err => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });
}

async function handleCreateChatSession(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await parseBody<{ name?: string }>(req);
    const userKey = getUserKeyFromRequest(req);
    const session = buildSessionResponse(createChatSessionForUser(userKey, body.name));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      session,
      enabledAgents: getSessionEnabledAgents(session),
      chatSessions: getSessionSummaries(userKey),
      activeSessionId: session.id
    }));
  } catch (error: unknown) {
    const err = error as Error;
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleSelectChatSession(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await parseBody<{ sessionId?: string }>(req);
    const userKey = getUserKeyFromRequest(req);
    const sessionId = (body.sessionId || '').trim();

    if (!sessionId || !setActiveChatSession(userKey, sessionId)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '会话不存在' }));
      return;
    }

    const sessions = ensureUserSessions(userKey);
    const session = buildDetailedSessionResponse(sessions.get(sessionId)!);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      messages: session.history,
      currentAgent: getUserCurrentAgent(userKey, session.id),
      enabledAgents: getSessionEnabledAgents(session),
      session,
      activeSessionId: session.id,
      chatSessions: getSessionSummaries(userKey)
    }));
  } catch (error: unknown) {
    const err = error as Error;
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleRenameChatSession(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await parseBody<{ sessionId?: string; name?: string }>(req);
    const userKey = getUserKeyFromRequest(req);
    const sessionId = (body.sessionId || '').trim();
    const name = body.name || '';
    const renamed = renameChatSessionForUser(userKey, sessionId, name);

    if (!renamed) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '会话不存在' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      session: buildSessionResponse(renamed),
      chatSessions: getSessionSummaries(userKey)
    }));
  } catch (error: unknown) {
    const err = error as Error;
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleDeleteChatSession(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await parseBody<{ sessionId?: string }>(req);
    const userKey = getUserKeyFromRequest(req);
    const sessionId = (body.sessionId || '').trim();
    const result = deleteChatSessionForUser(userKey, sessionId);

    if (!result.success) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '无法删除该会话（至少需要保留一个会话）' }));
      return;
    }

    const sessions = ensureUserSessions(userKey);
    const active = buildDetailedSessionResponse(sessions.get(result.activeSessionId)!);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      activeSessionId: active.id,
      messages: active.history,
      currentAgent: getUserCurrentAgent(userKey, active.id),
      enabledAgents: getSessionEnabledAgents(active),
      session: active,
      chatSessions: getSessionSummaries(userKey)
    }));
  } catch (error: unknown) {
    const err = error as Error;
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleUpdateChatSession(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await parseBody<{ sessionId?: string; patch?: unknown }>(req);
    const userKey = getUserKeyFromRequest(req);
    const sessionId = (body.sessionId || '').trim();

    if (!sessionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'sessionId 不能为空' }));
      return;
    }

    const session = ensureUserSessions(userKey).get(sessionId);
    if (!session) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '会话不存在' }));
      return;
    }

    let patch: SessionChainPatch;
    try {
      patch = parseSessionChainPatch(body.patch);
    } catch (error: unknown) {
      const err = error as Error;
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }

    Object.assign(session, patch);
    applyNormalizedSessionChainSettings(session);
    touchSession(session);
    const normalizedSession = buildSessionResponse(session);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      session: normalizedSession,
      enabledAgents: getSessionEnabledAgents(normalizedSession),
      chatSessions: getSessionSummaries(userKey),
      activeSessionId: userActiveChatSession.get(userKey) || normalizedSession.id
    }));
  } catch (error: unknown) {
    const err = error as Error;
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * 处理创建 block (Route A)
 */
async function handleCreateBlock(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await parseBody<{ sessionId?: string; block: RichBlock }>(req);
    const { sessionId = DEFAULT_CHAT_SESSION_ID, } = body;
    const block = body.block;
    if (!block) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少 block 字段' }));
      return;
    }

    const sid = sessionId || DEFAULT_CHAT_SESSION_ID;
    const addedBlock = addBlock(sid, block);

    console.log(`[CreateBlock] Session: ${sid}, Block: ${addedBlock.id}`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, block: addedBlock }));
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[CreateBlock Error]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * 处理获取 BlockBuffer 状态
 */
function handleGetBlockStatus(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(getBlockBufferStatus()));
}


interface VerboseLogMeta {
  fileName: string;
  cli: string;
  agent: string;
  updatedAt: number;
  size: number;
}

function listVerboseLogs(): VerboseLogMeta[] {
  if (!fs.existsSync(VERBOSE_LOG_DIR)) {
    return [];
  }

  const entries = fs.readdirSync(VERBOSE_LOG_DIR, { withFileTypes: true });
  const logs: VerboseLogMeta[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.log')) {
      continue;
    }

    const match = entry.name.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-([^-]+)-(.+)\.log$/);
    const cli = match ? match[2] : 'unknown';
    const encodedAgent = match ? match[3] : 'unknown';
    let agent = encodedAgent;
    try {
      agent = decodeURIComponent(encodedAgent);
    } catch {
      agent = encodedAgent;
    }
    const fullPath = path.join(VERBOSE_LOG_DIR, entry.name);
    const stat = fs.statSync(fullPath);

    logs.push({
      fileName: entry.name,
      cli,
      agent,
      updatedAt: stat.mtimeMs,
      size: stat.size
    });
  }

  return logs.sort((a, b) => b.updatedAt - a.updatedAt);
}

function handleGetVerboseAgents(req: http.IncomingMessage, res: http.ServerResponse): void {
  const logs = listVerboseLogs();
  const summary = new Map<string, { agent: string; logCount: number; latestFile: string; latestUpdatedAt: number }>();

  for (const log of logs) {
    const existing = summary.get(log.agent);
    if (!existing) {
      summary.set(log.agent, {
        agent: log.agent,
        logCount: 1,
        latestFile: log.fileName,
        latestUpdatedAt: log.updatedAt
      });
      continue;
    }

    existing.logCount += 1;
  }

  const agents = Array.from(summary.values()).sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    logDir: VERBOSE_LOG_DIR,
    agents
  }));
}

function handleGetVerboseLogs(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  const agent = (url.searchParams.get('agent') || '').trim();
  if (!agent) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '缺少 agent 参数' }));
    return;
  }

  const logs = listVerboseLogs().filter(item => item.agent === agent);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ agent, logs }));
}

function handleGetVerboseLogContent(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  const fileName = (url.searchParams.get('file') || '').trim();
  if (!fileName) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '缺少 file 参数' }));
    return;
  }

  if (fileName.includes('/') || fileName.includes('\\') || !fileName.endsWith('.log')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '非法 file 参数' }));
    return;
  }

  const fullPath = path.join(VERBOSE_LOG_DIR, fileName);
  if (!fs.existsSync(fullPath)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '日志文件不存在' }));
    return;
  }

  const content = fs.readFileSync(fullPath, 'utf8');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ fileName, content }));
}

/**
 * 提供静态文件
 */
function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, filePath: string, contentType: string): void {
  const fullPath = path.join(__dirname, '..', 'public', filePath);

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    // 对 HTML 文件禁用缓存，确保用户总是获取最新版本
    const headers: http.OutgoingHttpHeaders = { 'Content-Type': contentType };
    if (contentType === 'text/html') {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

// ============================================
// 服务器入口
// ============================================

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  const method = req.method || 'GET';

  // CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-bot-room-callback-token, x-bot-room-session-id, x-bot-room-agent');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (url.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }

  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (url === '/api/login' && method === 'POST') {
    await handleLogin(req, res);
    return;
  }

  if (url === '/api/logout' && method === 'POST') {
    handleLogout(req, res);
    return;
  }

  if (url === '/api/auth-status' && method === 'GET') {
    handleAuthStatus(req, res);
    return;
  }

  const requestUrl = new URL(url, `http://${req.headers.host || '127.0.0.1'}`);
  ensureVisitorId(req, res);

  if (requiresAuthentication(requestUrl.pathname) && !isAuthenticated(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '未授权，请先登录' }));
    return;
  }

  // 路由
  if (requestUrl.pathname === '/api/agents' && method === 'GET') {
    handleGetAgents(req, res);
  } else if (requestUrl.pathname === '/api/groups' && method === 'GET') {
    try {
      const store = loadGroupStore(GROUP_DATA_FILE);
      res.end(JSON.stringify({ groups: store.groups, updatedAt: store.updatedAt }));
    } catch (error: unknown) {
      const err = error as Error;
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (requestUrl.pathname === '/api/chat' && method === 'POST') {
    await handleSendMessage(req, res);
  } else if (requestUrl.pathname === '/api/chat-stream' && method === 'POST') {
    await handleChatStream(req, res);
  } else if (requestUrl.pathname === '/api/chat-resume' && method === 'POST') {
    await handleResumePendingChat(req, res);
  } else if (requestUrl.pathname === '/api/history' && method === 'GET') {
    handleGetHistory(req, res);
  } else if (requestUrl.pathname === '/api/clear' && method === 'POST') {
    handleClearHistory(req, res);
  } else if (requestUrl.pathname === '/api/sessions' && method === 'POST') {
    await handleCreateChatSession(req, res);
  } else if (requestUrl.pathname === '/api/sessions/select' && method === 'POST') {
    await handleSelectChatSession(req, res);
  } else if (requestUrl.pathname === '/api/sessions/update' && method === 'POST') {
    await handleUpdateChatSession(req, res);
  } else if (requestUrl.pathname === '/api/sessions/rename' && method === 'POST') {
    await handleRenameChatSession(req, res);
  } else if (requestUrl.pathname === '/api/sessions/delete' && method === 'POST') {
    await handleDeleteChatSession(req, res);
  } else if (requestUrl.pathname === '/api/create-block' && method === 'POST') {
    await handleCreateBlock(req, res);
  } else if (requestUrl.pathname === '/api/block-status' && method === 'GET') {
    handleGetBlockStatus(req, res);
  } else if (requestUrl.pathname === '/api/callbacks/post-message' && method === 'POST') {
    await handleCallbackPostMessage(req, res);
  } else if (requestUrl.pathname === '/api/callbacks/thread-context' && method === 'GET') {
    handleCallbackThreadContext(req, res, requestUrl);
  } else if (requestUrl.pathname === '/api/dependencies/status' && method === 'GET') {
    handleGetDependenciesStatus(req, res);
  } else if (requestUrl.pathname === '/api/dependencies/logs' && method === 'GET') {
    handleQueryDependenciesLogs(req, res, requestUrl);
  } else if (requestUrl.pathname === '/api/system/dirs' && method === 'GET') {
    handleGetSystemDirs(req, res, requestUrl);
  } else if (requestUrl.pathname === '/api/workdirs/options' && method === 'GET') {
    handleGetWorkdirOptions(req, res);
  } else if (requestUrl.pathname === '/api/workdirs/select' && method === 'POST') {
    await handleSetWorkdir(req, res);
  } else if (requestUrl.pathname === '/api/session-agents' && method === 'POST') {
    await handleSetSessionAgent(req, res);
  } else if (requestUrl.pathname === '/api/verbose/agents' && method === 'GET') {
    handleGetVerboseAgents(req, res);
  } else if (requestUrl.pathname === '/api/verbose/logs' && method === 'GET') {
    handleGetVerboseLogs(req, res, requestUrl);
  } else if (requestUrl.pathname === '/api/verbose/log-content' && method === 'GET') {
    handleGetVerboseLogContent(req, res, requestUrl);
  } else if (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html') {
    serveStatic(req, res, 'index.html', 'text/html');
  } else if (requestUrl.pathname === '/styles.css') {
    serveStatic(req, res, 'styles.css', 'text/css');
  } else if (requestUrl.pathname === '/chat-markdown.js') {
    serveStatic(req, res, 'chat-markdown.js', 'application/javascript');
  } else if (requestUrl.pathname === '/chat-composer.js') {
    serveStatic(req, res, 'chat-composer.js', 'application/javascript');
  } else if (requestUrl.pathname === '/manifest.json') {
    serveStatic(req, res, 'manifest.json', 'application/manifest+json');
  } else if (requestUrl.pathname === '/service-worker.js') {
    serveStatic(req, res, 'service-worker.js', 'application/javascript');
  } else if (requestUrl.pathname === '/icon.svg') {
    serveStatic(req, res, 'icon.svg', 'image/svg+xml');
  } else if (requestUrl.pathname === '/verbose-logs.html') {
    serveStatic(req, res, 'verbose-logs.html', 'text/html');
  } else if (requestUrl.pathname === '/deps-monitor.html') {
    serveStatic(req, res, 'deps-monitor.html', 'text/html');
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

async function startServer(): Promise<void> {
  await hydrateChatSessionsFromRedis();

  server.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('🚀 多 AI 智能体聊天室已启动');
  console.log('='.repeat(60));
  console.log(`📍 地址: http://localhost:${PORT}`);
  console.log('');
  console.log(`📁 智能体配置: ${AGENT_DATA_FILE}`);
  console.log('可用的 AI 智能体:');
  agentManager.getAgents().forEach(agent => {
    console.log(`  - ${agent.avatar} ${agent.name}`);
  });
  console.log('');
  console.log('API 端点:');
  console.log('  GET  /api/agents       - 获取智能体列表');
  console.log('  POST /api/chat        - 发送消息');
  console.log('  POST /api/chat-resume - 继续执行中断后剩余链路');
  console.log('  GET  /api/history    - 获取历史记录');
  console.log('  POST /api/clear      - 清空历史');
  console.log('  POST /api/login      - 登录鉴权');
  console.log('  POST /api/logout     - 登出');
  console.log('  GET  /api/auth-status - 鉴权状态');
  console.log('  POST /api/create-block - Route A: 创建 block');
  console.log('  GET  /api/block-status - 查看 BlockBuffer 状态');
  console.log('  GET  /api/dependencies/status - 查看依赖服务状态');
  console.log('  POST /api/callbacks/post-message - AI 主动发送聊天室消息');
  console.log('  GET  /api/callbacks/thread-context?sessionid=xxx - 获取会话历史');
  console.log('  GET  /api/verbose/agents - 查看 verbose 日志智能体列表');
  console.log('  GET  /api/dependencies/logs?startDate=2026-03-01&endDate=2026-03-18&keyword=timeout - 查询依赖日志');
  console.log('  GET  /api/verbose/logs?agent=xxx - 查看智能体日志文件列表');
  console.log('  GET  /api/verbose/log-content?file=xxx.log - 查看日志文件内容');
  console.log('');
  console.log('使用方式:');
  console.log('  - 输入 @Claude 可以召唤 Claude');
  console.log('  - 输入 @Codex架构师 可以召唤 Codex 架构师');
  console.log('  - 输入 @Alice 可以召唤 Alice');
  console.log('  - 输入 @Bob 可以召唤 Bob');
  console.log('');
  console.log('💡 提示: 如果 Claude/Codex CLI 不可用,会自动使用模拟回复');
  if (AUTH_ENABLED) {
    console.log(`🔐 鉴权已启用: 依赖独立鉴权服务 ${AUTH_ADMIN_BASE_URL}`);
  } else {
    console.log('🔓 鉴权未启用: 设置 BOT_ROOM_AUTH_ENABLED=false');
  }
  if (REDIS_DISABLED) {
    console.log('🧠 Redis 会话持久化已禁用: BOT_ROOM_DISABLE_REDIS=true');
  } else {
    console.log(`🧠 Redis 会话持久化已启用: url=${DEFAULT_REDIS_URL}, key=${redisChatSessionsKey}`);
  }
  console.log('='.repeat(60));
  });
}

async function shutdown(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  await persistChatSessionsToRedis();
  if (!REDIS_DISABLED && redisReady) {
    await redisClient.quit();
  }
}

process.on('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0));
});

process.on('SIGINT', () => {
  void shutdown().finally(() => process.exit(0));
});

void startServer().catch((error: unknown) => {
  const err = error as Error;
  console.error('❌ 服务启动失败:', err.message);
  process.exit(1);
});
