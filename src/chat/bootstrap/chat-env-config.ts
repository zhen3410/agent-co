import * as path from 'path';
import { normalizePositiveSessionSetting } from '../runtime/chat-runtime';

export interface CreateChatEnvConfigOptions {
  cwd: string;
  serverDirname: string;
  env: NodeJS.ProcessEnv;
}

export interface ChatEnvConfig {
  port: number;
  defaultUserName: string;
  auth: {
    enabled: boolean;
    adminBaseUrl: string;
    sessionCookieName: string;
    visitorCookieName: string;
    sessionTtlMs: number;
    loginRateLimitMax: number;
  };
  dataFiles: {
    agentDataFile: string;
    groupDataFile: string;
  };
  logging: {
    verboseLogDir: string;
    publicDir: string;
  };
  redis: {
    url: string;
    configKey: string;
    defaultChatSessionsKey: string;
    persistDebounceMs: number;
    required: boolean;
    disabled: boolean;
    envChatSessionsKey: string;
    chatSessionsKey: string;
  };
  callback: {
    authToken: string;
    authHeader: string;
  };
  rateLimit: {
    maxRequests: number;
  };
  chatDefaults: {
    sessionId: string;
    sessionName: string;
    agentChainMaxHops: number;
  };
  security: {
    nodeEnv: string | undefined;
    authAdminToken: string | undefined;
    defaultPassword: string | undefined;
  };
}

export function createChatEnvConfig(options: CreateChatEnvConfigOptions): ChatEnvConfig {
  const { cwd, env, serverDirname } = options;
  const agentDataFile = env.AGENT_DATA_FILE || path.join(cwd, 'data', 'agents.json');
  const groupDataFile = env.GROUP_DATA_FILE || path.join(path.dirname(agentDataFile), 'groups.json');
  const defaultChatSessionsKey = 'bot-room:chat:sessions:v1';
  const envChatSessionsKey = (env.BOT_ROOM_CHAT_SESSIONS_KEY || '').trim();

  return {
    port: Number(env.PORT || 3002),
    defaultUserName: '用户',
    auth: {
      enabled: env.BOT_ROOM_AUTH_ENABLED !== 'false',
      adminBaseUrl: env.AUTH_ADMIN_BASE_URL || 'http://127.0.0.1:3003',
      sessionCookieName: 'bot_room_session',
      visitorCookieName: 'bot_room_visitor',
      sessionTtlMs: 1000 * 60 * 60 * 24 * 7,
      loginRateLimitMax: 5
    },
    dataFiles: {
      agentDataFile,
      groupDataFile
    },
    logging: {
      verboseLogDir: env.BOT_ROOM_VERBOSE_LOG_DIR || path.join(cwd, 'logs', 'ai-cli-verbose'),
      publicDir: path.join(serverDirname, '..', 'public')
    },
    redis: {
      url: 'redis://127.0.0.1:6379',
      configKey: 'bot-room:config',
      defaultChatSessionsKey,
      persistDebounceMs: 500,
      required: env.BOT_ROOM_REDIS_REQUIRED !== 'false',
      disabled: env.BOT_ROOM_DISABLE_REDIS === 'true',
      envChatSessionsKey,
      chatSessionsKey: envChatSessionsKey || defaultChatSessionsKey
    },
    callback: {
      authToken: env.BOT_ROOM_CALLBACK_TOKEN || 'bot-room-callback-token',
      authHeader: 'x-bot-room-callback-token'
    },
    rateLimit: {
      maxRequests: 100
    },
    chatDefaults: {
      sessionId: 'default',
      sessionName: '默认会话',
      agentChainMaxHops: normalizePositiveSessionSetting(env.BOT_ROOM_AGENT_CHAIN_MAX_HOPS, 4, false) as number
    },
    security: {
      nodeEnv: env.NODE_ENV,
      authAdminToken: env.AUTH_ADMIN_TOKEN,
      defaultPassword: env.BOT_ROOM_DEFAULT_PASSWORD
    }
  };
}
