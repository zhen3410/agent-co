import { AgentManager } from '../../agent-manager';
import { createChatAgentStoreRuntime } from '../runtime/chat-agent-store-runtime';
import { createChatRuntime, ChatRuntime } from '../runtime/chat-runtime';
import type { ChatEnvConfig } from './chat-env-config';

export interface ChatRuntimeDeps {
  runtime: ChatRuntime;
  agentManager: AgentManager;
  syncAgentsFromStore(): void;
}

export function createChatRuntimeDeps(config: Pick<ChatEnvConfig, 'dataFiles' | 'redis' | 'chatDefaults'>): ChatRuntimeDeps {
  let runtimeRef: ChatRuntime | undefined;
  const agentStoreRuntime = createChatAgentStoreRuntime({
    agentDataFile: config.dataFiles.agentDataFile,
    isChatSessionActive: () => runtimeRef?.isChatSessionActive() ?? false
  });
  const { agentManager, syncAgentsFromStore } = agentStoreRuntime;

  const runtime = createChatRuntime({
    redisUrl: config.redis.url,
    redisConfigKey: config.redis.configKey,
    defaultRedisChatSessionsKey: config.redis.defaultChatSessionsKey,
    redisPersistDebounceMs: config.redis.persistDebounceMs,
    redisRequired: config.redis.required,
    redisDisabled: config.redis.disabled,
    envRedisChatSessionsKey: config.redis.envChatSessionsKey,
    defaultChatSessionId: config.chatDefaults.sessionId,
    defaultChatSessionName: config.chatDefaults.sessionName,
    defaultAgentChainMaxHops: config.chatDefaults.agentChainMaxHops,
    getValidAgentNames: () => agentManager.getAgentConfigs().map(agent => agent.name)
  });
  runtimeRef = runtime;

  return {
    runtime,
    agentManager,
    syncAgentsFromStore
  };
}
