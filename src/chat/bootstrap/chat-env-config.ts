import * as path from 'path';
import { normalizePositiveSessionSetting } from '../runtime/chat-runtime';

export interface CreateChatEnvConfigOptions {
  cwd: string;
  serverDirname: string;
  env: NodeJS.ProcessEnv;
}

export interface ChatEnvConfig {
  port: number;
  host: string;
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
  const defaultChatSessionsKey = 'agent-co:chat:sessions:v1';
  const envChatSessionsKey = (env.AGENT_CO_CHAT_SESSIONS_KEY || '').trim();

  return {
    port: Number(env.PORT || 3002),
    host: env.HOST || '127.0.0.1',
    defaultUserName: '用户',
    auth: {
      enabled: env.AGENT_CO_AUTH_ENABLED !== 'false',
      adminBaseUrl: env.AUTH_ADMIN_BASE_URL || 'http://127.0.0.1:3003',
      sessionCookieName: 'agent_co_session',
      visitorCookieName: 'agent_co_visitor',
      sessionTtlMs: 1000 * 60 * 60 * 24 * 7,
      loginRateLimitMax: 5
    },
    dataFiles: {
      agentDataFile,
      groupDataFile
    },
    logging: {
      verboseLogDir: env.AGENT_CO_VERBOSE_LOG_DIR || path.join(cwd, 'logs', 'ai-cli-verbose'),
      publicDir: path.join(serverDirname, '..', 'public')
    },
    redis: {
      url: env.REDIS_URL || 'redis://127.0.0.1:6379',
      configKey: 'agent-co:config',
      defaultChatSessionsKey,
      persistDebounceMs: 500,
      required: env.AGENT_CO_REDIS_REQUIRED !== 'false',
      disabled: env.AGENT_CO_DISABLE_REDIS === 'true',
      envChatSessionsKey,
      chatSessionsKey: envChatSessionsKey || defaultChatSessionsKey
    },
    callback: {
      authToken: env.AGENT_CO_CALLBACK_TOKEN || 'agent-co-callback-token',
      authHeader: 'x-agent-co-callback-token'
    },
    rateLimit: {
      maxRequests: 100
    },
    chatDefaults: {
      sessionId: 'default',
      sessionName: '默认会话',
      agentChainMaxHops: normalizePositiveSessionSetting(env.AGENT_CO_AGENT_CHAIN_MAX_HOPS, 4, false) as number
    },
    security: {
      nodeEnv: env.NODE_ENV,
      authAdminToken: env.AUTH_ADMIN_TOKEN,
      defaultPassword: env.AGENT_CO_DEFAULT_PASSWORD
    }
  };
}
