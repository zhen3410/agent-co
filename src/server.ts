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
import { Message, AIAgentConfig, ChatRequest, RichBlock } from './types';
import { AgentManager } from './agent-manager';
import { loadAgentStore, saveAgentStore, applyPendingAgents } from './agent-config-store';
import { callClaudeCLI, generateMockReply, ClaudeResult } from './claude-cli';
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
const VERBOSE_LOG_DIR = process.env.BOT_ROOM_VERBOSE_LOG_DIR || path.join(process.cwd(), 'logs', 'ai-cli-verbose');
const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';
const REDIS_CONFIG_KEY = 'bot-room:config';
const DEFAULT_REDIS_CHAT_SESSIONS_KEY = 'bot-room:chat:sessions:v1';
const REDIS_PERSIST_DEBOUNCE_MS = 500;
const REDIS_REQUIRED = process.env.BOT_ROOM_REDIS_REQUIRED !== 'false';
const CALLBACK_AUTH_TOKEN = process.env.BOT_ROOM_CALLBACK_TOKEN || 'bot-room-callback-token';
const CALLBACK_AUTH_HEADER = 'x-bot-room-callback-token';

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
  workdir: string | null;
  createdAt: number;
  updatedAt: number;
}

interface AuthSession {
  username: string;
  expiresAt: number;
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

async function loadRuntimeConfigFromRedis(): Promise<void> {
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
  if (!redisClient || !redisReady) return;

  try {
    const payload = JSON.stringify(serializeChatSessionsState());
    await redisClient.set(redisChatSessionsKey, payload);
  } catch (error) {
    console.error('[Redis] 持久化聊天会话失败:', error);
  }
}

function schedulePersistChatSessions(): void {
  if (!redisClient || !redisReady) return;

  if (persistTimer) {
    clearTimeout(persistTimer);
  }

  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistChatSessionsToRedis();
  }, REDIS_PERSIST_DEBOUNCE_MS);
}

async function hydrateChatSessionsFromRedis(): Promise<void> {
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
          workdir: normalizeSessionWorkdir(session.workdir) || null,
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

function normalizeSessionWorkdir(workdir: string | undefined | null): string | null {
  const trimmed = (workdir || '').trim();
  if (!trimmed) return null;
  if (!path.isAbsolute(trimmed)) return null;
  if (trimmed.includes('\0')) return null;
  return trimmed;
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
    workdir: null,
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
      workdir: null,
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
      target.set(sessionId, sourceSession);
      continue;
    }

    existing.name = existing.name || sourceSession.name;
    existing.currentAgent = existing.currentAgent || sourceSession.currentAgent;
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

function getSessionSummaries(userKey: string): Array<{ id: string; name: string; messageCount: number; updatedAt: number; createdAt: number; workdir: string | null }> {
  const sessions = ensureUserSessions(userKey);
  return Array.from(sessions.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(session => ({
      id: session.id,
      name: session.name,
      messageCount: session.history.length,
      updatedAt: session.updatedAt,
      createdAt: session.createdAt,
      workdir: session.workdir || null
    }));
}

function touchSession(session: UserChatSession): void {
  session.updatedAt = Date.now();
  schedulePersistChatSessions();
}

function getUserHistory(userKey: string, sessionId: string): Message[] {
  return ensureUserSessions(userKey).get(sessionId)?.history || [];
}

function getUserCurrentAgent(userKey: string, sessionId: string): string | null {
  return ensureUserSessions(userKey).get(sessionId)?.currentAgent || null;
}

function getCallbackMessageKey(sessionId: string, agentName: string): string {
  return `${sessionId}::${agentName}`;
}

function addCallbackMessage(sessionId: string, agentName: string, content: string): Message {
  const key = getCallbackMessageKey(sessionId, agentName);
  const queue = callbackMessages.get(key) || [];
  const msg: Message = {
    id: generateId(),
    role: 'assistant',
    sender: agentName,
    text: content,
    timestamp: Date.now()
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

function setChatSessionWorkdirForUser(userKey: string, sessionId: string, workdir?: string | null): UserChatSession | null {
  const session = ensureUserSessions(userKey).get(sessionId);
  if (!session) return null;
  session.workdir = normalizeSessionWorkdir(workdir) || null;
  touchSession(session);
  return session;
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
    const body = await parseBody<{ content?: string }>(req);
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

    addCallbackMessage(sessionId, agentName, content);
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
    const currentAgent = session.currentAgent;

    console.log(`\n[Chat] 会话 ${sessionId.substring(0, 12)}... 用户 ${sender}: ${message}`);

    // 提取 @ 提及
    const mentions = agentManager.extractMentions(message);
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

    // 返回的 AI 消息列表
    const aiMessages: Message[] = [];

    // 调用对应的 AI 智能体
    for (const agentName of agentsToRespond) {
      const agent = agentManager.getAgent(agentName);
      if (!agent) continue;

      console.log(`[Chat] 调用 AI: ${agentName}`);
      appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${agentName} stage=start stream=false`);

      const includeHistory = mentions.length === 0;
      const callbackEnv: Record<string, string> = {
        BOT_ROOM_API_URL: `http://127.0.0.1:${PORT}`,
        BOT_ROOM_SESSION_ID: session.id,
        BOT_ROOM_AGENT_NAME: agentName,
        BOT_ROOM_CALLBACK_TOKEN: CALLBACK_AUTH_TOKEN
      };

      let fallbackMessage: Message | null = null;
      let cliResult: ClaudeResult | null = null;
      try {
        const result = await callClaudeCLI(message, agent, userHistory, {
          includeHistory,
          extraEnv: callbackEnv,
          workdir: session.workdir || undefined
        });
        cliResult = result;
        appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${agentName} stage=cli_done text_len=${result.text.length} blocks=${result.blocks.length}`);
      } catch (error: unknown) {
        const err = error as Error;
        console.log(`[Chat] AI CLI 不可用: ${err.message}`);
        console.log('[Chat] 使用模拟回复');
        appendOperationalLog('error', 'chat-exec', `session=${session.id} agent=${agentName} stage=cli_error error=${err.message}`);
        const mockText = generateMockReply(message, agentName);
        const extracted = extractRichBlocks(mockText);
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
      for (const reply of callbackReplies) {
        userHistory.push(reply);
        aiMessages.push(reply);
      }

      if (callbackReplies.length === 0 && cliResult && (cliResult.text || cliResult.blocks.length > 0)) {
        const directMessage: Message = {
          id: generateId(),
          role: 'assistant',
          sender: agentName,
          text: cliResult.text,
          blocks: cliResult.blocks as RichBlock[],
          timestamp: Date.now()
        };
        userHistory.push(directMessage);
        aiMessages.push(directMessage);
        appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${agentName} stage=direct_fallback reason=no_callback`);
      }

      if (callbackReplies.length === 0 && fallbackMessage) {
        userHistory.push(fallbackMessage);
        aiMessages.push(fallbackMessage);
      }

      touchSession(session);
      if (callbackReplies.length === 0 && !fallbackMessage && (!cliResult || (!cliResult.text && cliResult.blocks.length === 0))) {
        appendOperationalLog('error', 'chat-exec', `session=${session.id} agent=${agentName} stage=empty_visible_message`);
      }
      console.log(`[Chat] ${agentName} 回复完成，可见消息=${callbackReplies.length}${fallbackMessage && callbackReplies.length === 0 ? ' (fallback)' : ''}`);
    }

    // 返回响应
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      userMessage,
      aiMessages,
      currentAgent: getUserCurrentAgent(userKey, session.id)
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
    const currentAgent = session.currentAgent;

    console.log(`\n[ChatStream] 会话 ${sessionId.substring(0, 12)}... 用户 ${sender}: ${message}`);

    // 提取 @ 提及
    const mentions = agentManager.extractMentions(message);
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

    // 发送用户消息事件
    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      // 强制刷新缓冲区，确保数据立即发送
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
    };

    sendEvent('user_message', userMessage);

    // 如果没有智能体可以响应
    if (agentsToRespond.length === 0) {
      sendEvent('done', { currentAgent: null });
      res.end();
      return;
    }

    // 先发送所有智能体的思考事件
    for (const agentName of agentsToRespond) {
      sendEvent('agent_thinking', { agent: agentName });
    }

    // 并发调用所有智能体，完成后立即推送
    const agentPromises = agentsToRespond.map(async (agentName) => {
      const agent = agentManager.getAgent(agentName);
      if (!agent) return null;

      console.log(`[ChatStream] 并发调用 AI: ${agentName}`);
      appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${agentName} stage=start stream=true`);

      const includeHistory = mentions.length === 0;
      const callbackEnv: Record<string, string> = {
        BOT_ROOM_API_URL: `http://127.0.0.1:${PORT}`,
        BOT_ROOM_SESSION_ID: session.id,
        BOT_ROOM_AGENT_NAME: agentName,
        BOT_ROOM_CALLBACK_TOKEN: CALLBACK_AUTH_TOKEN
      };

      let fallbackMessage: Message | null = null;
      let cliResult: ClaudeResult | null = null;
      try {
        const result = await callClaudeCLI(message, agent, userHistory, {
          includeHistory,
          extraEnv: callbackEnv,
          workdir: session.workdir || undefined
        });
        cliResult = result;
        appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${agentName} stage=cli_done text_len=${result.text.length} blocks=${result.blocks.length}`);
      } catch (error: unknown) {
        const err = error as Error;
        console.log(`[ChatStream] AI CLI 不可用: ${err.message}`);
        appendOperationalLog('error', 'chat-exec', `session=${session.id} agent=${agentName} stage=cli_error error=${err.message}`);
        const mockText = generateMockReply(message, agentName);
        const extracted = extractRichBlocks(mockText);
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
      const visibleMessages = callbackReplies.length > 0
        ? callbackReplies
        : (cliResult && (cliResult.text || cliResult.blocks.length > 0)
          ? [{
            id: generateId(),
            role: 'assistant' as const,
            sender: agentName,
            text: cliResult.text,
            blocks: cliResult.blocks as RichBlock[],
            timestamp: Date.now()
          }]
          : (fallbackMessage ? [fallbackMessage] : []));

      if (callbackReplies.length === 0 && cliResult && (cliResult.text || cliResult.blocks.length > 0)) {
        appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${agentName} stage=direct_fallback reason=no_callback`);
      }

      for (const visibleMessage of visibleMessages) {
        userHistory.push(visibleMessage);
        touchSession(session);
        sendEvent('agent_message', visibleMessage);
      }

      if (visibleMessages.length === 0) {
        appendOperationalLog('error', 'chat-exec', `session=${session.id} agent=${agentName} stage=empty_visible_message`);
      }
      console.log(`[ChatStream] ${agentName} 回复已推送: ${visibleMessages.length}`);

      return visibleMessages;
    });

    // 等待所有智能体完成
    await Promise.all(agentPromises);

    // 发送完成事件
    sendEvent('done', { currentAgent: getUserCurrentAgent(userKey, session.id) });
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

/**
 * 处理获取历史记录
 */
function handleGetHistory(req: http.IncomingMessage, res: http.ServerResponse): void {
  syncAgentsFromStore();
  const { userKey, session } = resolveChatSession(req);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    messages: session.history,
    agents: agentManager.getAgentConfigs(),
    currentAgent: session.currentAgent,
    chatSessions: getSessionSummaries(userKey),
    activeSessionId: session.id
  }));
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
    if (agentName && agentManager.hasAgent(agentName)) {
      setUserCurrentAgent(userKey, session.id, agentName);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, currentAgent: agentName }));
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
    const body = await parseBody<{ name?: string; workdir?: string }>(req);
    const userKey = getUserKeyFromRequest(req);
    const session = createChatSessionForUser(userKey, body.name);
    if (body.workdir) {
      session.workdir = normalizeSessionWorkdir(body.workdir);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      session,
      chatSessions: getSessionSummaries(userKey),
      activeSessionId: session.id
    }));
  } catch (error: unknown) {
    const err = error as Error;
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleSetSessionWorkdir(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await parseBody<{ sessionId?: string; workdir?: string }>(req);
    const userKey = getUserKeyFromRequest(req);
    const sessionId = (body.sessionId || '').trim();
    if (!sessionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少 sessionId' }));
      return;
    }

    const normalized = normalizeSessionWorkdir(body.workdir);
    if ((body.workdir || '').trim() && !normalized) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'workdir 必须是绝对路径' }));
      return;
    }

    const updated = setChatSessionWorkdirForUser(userKey, sessionId, normalized);
    if (!updated) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '会话不存在' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      session: { id: updated.id, workdir: updated.workdir },
      chatSessions: getSessionSummaries(userKey)
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
    const session = sessions.get(sessionId)!;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      messages: session.history,
      currentAgent: session.currentAgent,
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
      session: renamed,
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
    const active = sessions.get(result.activeSessionId)!;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      activeSessionId: active.id,
      messages: active.history,
      currentAgent: active.currentAgent,
      chatSessions: getSessionSummaries(userKey)
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
  } else if (requestUrl.pathname === '/api/chat' && method === 'POST') {
    await handleSendMessage(req, res);
  } else if (requestUrl.pathname === '/api/chat-stream' && method === 'POST') {
    await handleChatStream(req, res);
  } else if (requestUrl.pathname === '/api/history' && method === 'GET') {
    handleGetHistory(req, res);
  } else if (requestUrl.pathname === '/api/clear' && method === 'POST') {
    handleClearHistory(req, res);
  } else if (requestUrl.pathname === '/api/sessions' && method === 'POST') {
    await handleCreateChatSession(req, res);
  } else if (requestUrl.pathname === '/api/sessions/select' && method === 'POST') {
    await handleSelectChatSession(req, res);
  } else if (requestUrl.pathname === '/api/sessions/workdir' && method === 'POST') {
    await handleSetSessionWorkdir(req, res);
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
  console.log(`🧠 Redis 会话持久化已启用: url=${DEFAULT_REDIS_URL}, key=${redisChatSessionsKey}`);
  console.log('='.repeat(60));
  });
}

async function shutdown(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  await persistChatSessionsToRedis();
  if (redisReady) {
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
