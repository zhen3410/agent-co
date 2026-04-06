/**
 * server.ts
 *
 * 多 AI 智能体聊天室服务器
 */

import * as path from 'path';
import { createAuthAdminClient } from './chat/infrastructure/auth-admin-client';
import { createChatRuntime, createChatAgentStoreRuntime, normalizePositiveSessionSetting, ChatRuntime } from './chat/runtime/chat-runtime';
import { createAuthService } from './chat/application/auth-service';
import { createSessionService } from './chat/application/session-service';
import { createChatService } from './chat/application/chat-service';
import { createChatServer } from './chat/bootstrap/create-chat-server';

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

function performSecurityChecks(): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const warnings: string[] = [];
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
  } else if (!adminToken || adminToken === 'change-me-in-production') {
    warnings.push('⚠️ AUTH_ADMIN_TOKEN 未设置或使用默认值（仅开发环境允许）');
  }

  const defaultPassword = process.env.BOT_ROOM_DEFAULT_PASSWORD;
  if (isProduction && defaultPassword) {
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

  if (warnings.length > 0) {
    console.log('\n' + '='.repeat(60));
    console.log('🔒 安全检查警告');
    console.log('='.repeat(60));
    warnings.forEach(w => console.log(w));
    console.log('='.repeat(60) + '\n');
  }
}

performSecurityChecks();

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
  getUserKeyFromRequest: authService.getUserKeyFromRequest,
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

async function startServer(): Promise<void> {
  await runtime.hydrate();

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
    console.log('  POST /api/chat-summary - 手动触发 peer 讨论总结');
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
      console.log(`🧠 Redis 会话持久化已启用: url=${DEFAULT_REDIS_URL}, key=${ENV_REDIS_CHAT_SESSIONS_KEY || DEFAULT_REDIS_CHAT_SESSIONS_KEY}`);
    }
    console.log('='.repeat(60));
  });
}

process.on('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0));
});

process.on('SIGINT', () => {
  void shutdown().finally(() => process.exit(0));
});

// Static asset routes remain in create-chat-server.ts / ops-routes.ts.
// requestUrl.pathname === '/chat-markdown.js'
// serveStaticFile(res, {
// requestUrl.pathname === '/chat-composer.js'
// filePath: 'chat-markdown.js'
// filePath: 'chat-composer.js'

void startServer().catch((error: unknown) => {
  console.error('❌ 服务启动失败:', (error as Error).message);
  process.exit(1);
});
