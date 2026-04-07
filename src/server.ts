/**
 * server.ts
 *
 * 多 AI 智能体聊天室服务器
 */

import * as path from 'path';
import { createAuthAdminClient } from './chat/infrastructure/auth-admin-client';
import { createChatRuntime, normalizePositiveSessionSetting, ChatRuntime } from './chat/runtime/chat-runtime';
import { createChatAgentStoreRuntime } from './chat/runtime/chat-agent-store-runtime';
import { createAuthService } from './chat/application/auth-service';
import { createSessionService } from './chat/application/session-service';
import { createChatService } from './chat/application/chat-service';
import { createChatServer } from './chat/bootstrap/create-chat-server';
import { startChatServer } from './chat/bootstrap/chat-server-startup';

const PORT = Number(process.env.PORT || 3002);
const DEFAULT_USER_NAME = '用户';
const AUTH_ENABLED = process.env.BOT_ROOM_AUTH_ENABLED !== 'false';
const AUTH_ADMIN_BASE_URL = process.env.AUTH_ADMIN_BASE_URL || 'http://127.0.0.1:3003';
const SESSION_COOKIE_NAME = 'bot_room_session';
const CHAT_VISITOR_COOKIE_NAME = 'bot_room_visitor';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const AGENT_DATA_FILE = process.env.AGENT_DATA_FILE || path.join(process.cwd(), 'data', 'agents.json');
const GROUP_DATA_FILE = process.env.GROUP_DATA_FILE || path.join(path.dirname(AGENT_DATA_FILE), 'groups.json');
const VERBOSE_LOG_DIR = process.env.BOT_ROOM_VERBOSE_LOG_DIR || path.join(process.cwd(), 'logs', 'ai-cli-verbose');
const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';
const REDIS_CONFIG_KEY = 'bot-room:config';
const DEFAULT_REDIS_CHAT_SESSIONS_KEY = 'bot-room:chat:sessions:v1';
const REDIS_PERSIST_DEBOUNCE_MS = 500;
const REDIS_REQUIRED = process.env.BOT_ROOM_REDIS_REQUIRED !== 'false';
const REDIS_DISABLED = process.env.BOT_ROOM_DISABLE_REDIS === 'true';
const ENV_REDIS_CHAT_SESSIONS_KEY = (process.env.BOT_ROOM_CHAT_SESSIONS_KEY || '').trim();
const CALLBACK_AUTH_TOKEN = process.env.BOT_ROOM_CALLBACK_TOKEN || 'bot-room-callback-token';
const CALLBACK_AUTH_HEADER = 'x-bot-room-callback-token';
const RATE_LIMIT_MAX_REQUESTS = 100;
const LOGIN_RATE_LIMIT_MAX = 5;
const DEFAULT_CHAT_SESSION_ID = 'default';
const DEFAULT_CHAT_SESSION_NAME = '默认会话';
const DEFAULT_AGENT_CHAIN_MAX_HOPS = normalizePositiveSessionSetting(process.env.BOT_ROOM_AGENT_CHAIN_MAX_HOPS, 4, false) as number;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

let runtimeRef: ChatRuntime | undefined;
const agentStoreRuntime = createChatAgentStoreRuntime({
  agentDataFile: AGENT_DATA_FILE,
  isChatSessionActive: () => runtimeRef?.isChatSessionActive() ?? false
});
const { agentManager, syncAgentsFromStore } = agentStoreRuntime;

const runtime = createChatRuntime({
  redisUrl: DEFAULT_REDIS_URL,
  redisConfigKey: REDIS_CONFIG_KEY,
  defaultRedisChatSessionsKey: DEFAULT_REDIS_CHAT_SESSIONS_KEY,
  redisPersistDebounceMs: REDIS_PERSIST_DEBOUNCE_MS,
  redisRequired: REDIS_REQUIRED,
  redisDisabled: REDIS_DISABLED,
  envRedisChatSessionsKey: ENV_REDIS_CHAT_SESSIONS_KEY,
  defaultChatSessionId: DEFAULT_CHAT_SESSION_ID,
  defaultChatSessionName: DEFAULT_CHAT_SESSION_NAME,
  defaultAgentChainMaxHops: DEFAULT_AGENT_CHAIN_MAX_HOPS,
  getValidAgentNames: () => agentManager.getAgentConfigs().map(agent => agent.name)
});
runtimeRef = runtime;

const authAdminClient = createAuthAdminClient(AUTH_ADMIN_BASE_URL);
const authService = createAuthService({
  authEnabled: AUTH_ENABLED,
  sessionCookieName: SESSION_COOKIE_NAME,
  visitorCookieName: CHAT_VISITOR_COOKIE_NAME,
  sessionTtlMs: SESSION_TTL_MS,
  loginRateLimitMax: LOGIN_RATE_LIMIT_MAX
}, authAdminClient, runtime);
const sessionService = createSessionService({
  runtime,
  getAgentNames: () => agentManager.getAgentConfigs().map(agent => agent.name),
  hasAgent: (agentName) => agentManager.hasAgent(agentName)
});
const chatService = createChatService({
  port: PORT,
  defaultUserName: DEFAULT_USER_NAME,
  callbackAuthToken: CALLBACK_AUTH_TOKEN,
  sessionService,
  runtime,
  agentManager,
  syncAgentsFromStore
});
const { server, shutdown } = createChatServer({
  authService,
  chatService,
  sessionService,
  runtime,
  agentManager,
  callbackAuthToken: CALLBACK_AUTH_TOKEN,
  callbackAuthHeader: CALLBACK_AUTH_HEADER,
  verboseLogDir: VERBOSE_LOG_DIR,
  publicDir: PUBLIC_DIR,
  rateLimitMaxRequests: RATE_LIMIT_MAX_REQUESTS,
  groupDataFile: GROUP_DATA_FILE
});

process.on('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0));
});

process.on('SIGINT', () => {
  void shutdown().finally(() => process.exit(0));
});

void startChatServer({
  server,
  hydrate: () => runtime.hydrate(),
  port: PORT,
  agentDataFile: AGENT_DATA_FILE,
  listAgents: () => agentManager.getAgents(),
  authEnabled: AUTH_ENABLED,
  authAdminBaseUrl: AUTH_ADMIN_BASE_URL,
  redisDisabled: REDIS_DISABLED,
  redisUrl: DEFAULT_REDIS_URL,
  redisChatSessionsKey: ENV_REDIS_CHAT_SESSIONS_KEY || DEFAULT_REDIS_CHAT_SESSIONS_KEY,
  security: {
    nodeEnv: process.env.NODE_ENV,
    authAdminToken: process.env.AUTH_ADMIN_TOKEN,
    defaultPassword: process.env.BOT_ROOM_DEFAULT_PASSWORD
  }
}).catch((error: unknown) => {
  console.error('❌ 服务启动失败:', (error as Error).message);
  process.exit(1);
});
