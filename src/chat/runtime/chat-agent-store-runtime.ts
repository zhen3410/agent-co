import * as fs from 'fs';
import { AgentManager } from '../../agent-manager';
import { loadAgentStore, saveAgentStore, applyPendingAgents } from '../../agent-config-store';

export interface ChatAgentStoreRuntimeConfig {
  agentDataFile: string;
  isChatSessionActive(): boolean;
}

export interface ChatAgentStoreRuntime {
  agentManager: AgentManager;
  syncAgentsFromStore(): void;
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
