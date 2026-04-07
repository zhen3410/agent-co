import Redis from 'ioredis';
import { PendingAgentDispatchTask, RedisPersistedState, UserChatSession } from '../infrastructure/chat-session-repository';
import { ChatRuntimeConfig, SessionChainPatch } from './chat-runtime-types';
import { ChatRuntimePersistenceStore } from './chat-runtime-stores';

interface ChatRuntimePersistenceDependencies {
  config: Pick<ChatRuntimeConfig, 'redisConfigKey' | 'defaultRedisChatSessionsKey' | 'redisPersistDebounceMs' | 'redisRequired' | 'redisDisabled' | 'envRedisChatSessionsKey'>;
  redisClient: Redis;
  store: ChatRuntimePersistenceStore;
  createDefaultSession(): UserChatSession;
  normalizeSessionName(name: string | undefined): string;
  sanitizeEnabledAgents(...candidateLists: Array<string[] | undefined>): string[];
  normalizeSessionChainSettings(source?: SessionChainPatch): Required<Pick<UserChatSession, 'agentChainMaxHops' | 'agentChainMaxCallsPerAgent'>>;
  normalizeSessionDiscussionSettings(source?: Pick<UserChatSession, 'discussionMode' | 'discussionState'>): Required<Pick<UserChatSession, 'discussionMode' | 'discussionState'>>;
  normalizeDispatchKind(value: unknown, fallback?: PendingAgentDispatchTask['dispatchKind'] | null): PendingAgentDispatchTask['dispatchKind'] | null;
}

interface ChatRuntimePersistence {
  hydrate(): Promise<void>;
  shutdown(): Promise<void>;
  getRedisChatSessionsKey(): string;
  schedulePersistChatSessions(): void;
}

export function createChatRuntimePersistence(deps: ChatRuntimePersistenceDependencies): ChatRuntimePersistence {
  let redisChatSessionsKey = deps.config.defaultRedisChatSessionsKey;
  let persistTimer: NodeJS.Timeout | null = null;
  let redisReady = false;

  deps.redisClient.on('error', (error: unknown) => {
    const err = error as Error;
    console.error('[Redis] 连接异常:', err.message);
  });

  function isTestRedisChatSessionsKey(key: string): boolean {
    return key.startsWith('bot-room:chat:sessions:test:')
      || key.startsWith('bot-room:test:session-chain-settings:');
  }

  async function loadRuntimeConfigFromRedis(): Promise<void> {
    if (deps.config.redisDisabled) return;
    try {
      if (deps.config.envRedisChatSessionsKey) {
        redisChatSessionsKey = deps.config.envRedisChatSessionsKey;
        console.log(`[Redis] 已使用环境变量指定 chat_sessions_key=${redisChatSessionsKey}`);
        return;
      }

      const runtimeConfig = await deps.redisClient.hgetall(deps.config.redisConfigKey);
      const configuredKey = (runtimeConfig.chat_sessions_key || '').trim();
      if (configuredKey) {
        if (process.env.NODE_ENV !== 'test' && isTestRedisChatSessionsKey(configuredKey)) {
          console.warn(`[Redis] 检测到残留测试 chat_sessions_key=${configuredKey}，当前 NODE_ENV=${process.env.NODE_ENV || 'development'}，已回退默认 key=${deps.config.defaultRedisChatSessionsKey}`);
        } else {
          redisChatSessionsKey = configuredKey;
        }
      }
      console.log(`[Redis] 已加载运行配置 key=${deps.config.redisConfigKey}, chat_sessions_key=${redisChatSessionsKey}`);
    } catch (error) {
      console.error('[Redis] 读取运行配置失败:', error);
      if (deps.config.redisRequired) {
        throw new Error('Redis 配置读取失败，聊天服务启动失败');
      }
      console.warn('[Redis] 继续使用默认配置（非阻塞模式）');
    }
  }

  async function persistChatSessionsToRedis(): Promise<void> {
    if (deps.config.redisDisabled || !redisReady) return;

    try {
      const payload = JSON.stringify(deps.store.serializeState());
      await deps.redisClient.set(redisChatSessionsKey, payload);
    } catch (error) {
      console.error('[Redis] 持久化聊天会话失败:', error);
    }
  }

  function schedulePersistChatSessions(): void {
    if (deps.config.redisDisabled || !redisReady) return;

    if (persistTimer) {
      clearTimeout(persistTimer);
    }

    persistTimer = setTimeout(() => {
      persistTimer = null;
      void persistChatSessionsToRedis();
    }, deps.config.redisPersistDebounceMs);
  }

  async function hydrate(): Promise<void> {
    if (deps.config.redisDisabled) {
      console.warn('[Redis] 已通过 BOT_ROOM_DISABLE_REDIS=true 禁用会话持久化');
      return;
    }

    try {
      await deps.redisClient.connect();
      redisReady = true;
      await loadRuntimeConfigFromRedis();
      const raw = await deps.redisClient.get(redisChatSessionsKey);
      if (!raw) {
        console.log(`[Redis] 未发现历史会话缓存 key=${redisChatSessionsKey}`);
        return;
      }

      const parsed = JSON.parse(raw) as RedisPersistedState;
      if (parsed.version !== 1 || !parsed.userChatSessions || !parsed.userActiveChatSession) {
        console.warn('[Redis] 会话缓存结构不兼容，跳过恢复');
        return;
      }

      deps.store.clearUserSessions();
      for (const [userKey, sessions] of Object.entries(parsed.userChatSessions)) {
        const sessionMap = new Map<string, UserChatSession>();
        for (const session of sessions) {
          if (!session?.id) continue;
          sessionMap.set(session.id, {
            id: session.id,
            name: deps.normalizeSessionName(session.name),
            history: Array.isArray(session.history) ? session.history : [],
            currentAgent: session.currentAgent || null,
            enabledAgents: deps.sanitizeEnabledAgents(session.enabledAgents),
            agentWorkdirs: session.agentWorkdirs && typeof session.agentWorkdirs === 'object'
              ? session.agentWorkdirs
              : {},
            pendingAgentTasks: Array.isArray(session.pendingAgentTasks)
              ? session.pendingAgentTasks
                .filter(task => task && typeof task.agentName === 'string' && typeof task.prompt === 'string')
                .map(task => {
                  const dispatchKind = deps.normalizeDispatchKind(task.dispatchKind, null);
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
            ...deps.normalizeSessionChainSettings(session),
            ...deps.normalizeSessionDiscussionSettings(session),
            createdAt: Number(session.createdAt) || Date.now(),
            updatedAt: Number(session.updatedAt) || Date.now()
          });
        }

        if (sessionMap.size === 0) {
          const fallback = deps.createDefaultSession();
          sessionMap.set(fallback.id, fallback);
        }

        deps.store.setUserSessions(userKey, sessionMap);
      }

      deps.store.clearActiveSessionIds();
      for (const [userKey, sessionId] of Object.entries(parsed.userActiveChatSession)) {
        deps.store.setActiveSessionId(userKey, sessionId);
      }

      console.log(`[Redis] 已恢复聊天会话数据: users=${Object.keys(parsed.userChatSessions).length}`);
    } catch (error) {
      redisReady = false;
      console.error('[Redis] 恢复聊天会话失败:', error);
      if (deps.config.redisRequired) {
        throw new Error('Redis 不可用，聊天服务启动失败');
      }
      console.warn('[Redis] 将使用内存态会话（重启后丢失）');
    }
  }

  async function shutdown(): Promise<void> {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    await persistChatSessionsToRedis();
    if (!deps.config.redisDisabled && redisReady) {
      await deps.redisClient.quit();
    }
  }

  function getRedisChatSessionsKey(): string {
    return redisChatSessionsKey;
  }

  return {
    hydrate,
    shutdown,
    getRedisChatSessionsKey,
    schedulePersistChatSessions
  };
}
