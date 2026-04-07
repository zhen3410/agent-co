import { AIAgentConfig } from '../../types';
import {
  ApplyMode,
  applyPendingAgents as applyPendingAgentStore,
  loadAgentStore,
  normalizeAgentConfig,
  saveAgentStore,
  updateAgentStore,
  validateAgentConfig
} from '../../agent-config-store';
import { buildProfessionalAgentPrompt, isProfessionalAgentName } from '../../professional-agent-prompts';
import { loadApiConnectionStore } from '../../api-connection-store';
import {
  loadGroupStore,
  removeAgentFromAllGroups,
  saveGroupStore
} from '../../group-store';

export { ApplyMode } from '../../agent-config-store';

export interface AgentAdminListResult {
  agents: AIAgentConfig[];
  pendingAgents: AIAgentConfig[] | null;
  pendingReason: string | null;
  pendingUpdatedAt: number | null;
}

export interface AgentAdminMutationResult {
  success: true;
  applyMode: ApplyMode;
  agent: AIAgentConfig;
}

export interface AgentAdminService {
  listAgents(): AgentAdminListResult;
  createAgent(input: { agent: AIAgentConfig; applyMode?: ApplyMode }): AgentAdminMutationResult;
  updateAgent(targetName: string, input: { agent: AIAgentConfig; applyMode?: ApplyMode }): AgentAdminMutationResult;
  updateAgentPrompt(targetName: string, input: { systemPrompt?: string; personality?: string; applyMode?: ApplyMode }): { success: true; applyMode: ApplyMode };
  restoreAgentPromptTemplate(targetName: string, applyMode?: ApplyMode): { success: true; applyMode: ApplyMode; systemPrompt: string };
  getAgentPromptTemplate(targetName: string): { success: true; currentPrompt: string; templatePrompt: string };
  deleteAgent(targetName: string, applyMode?: ApplyMode): { success: true; applyMode: ApplyMode; name: string };
  applyPendingAgents(): { success: true; agents: AIAgentConfig[] };
}

export interface CreateAgentAdminServiceOptions {
  agentDataFile: string;
  groupDataFile: string;
  modelConnectionDataFile: string;
}

export class AgentAdminServiceError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'AgentAdminServiceError';
    this.statusCode = statusCode;
  }
}

export function parseApplyMode(input?: string | null): ApplyMode {
  return input === 'after_chat' ? 'after_chat' : 'immediate';
}

function validateAgentConnectionReference(agent: AIAgentConfig, modelConnectionDataFile: string): string | null {
  if (agent.executionMode !== 'api' || !agent.apiConnectionId) {
    return null;
  }

  const connectionStore = loadApiConnectionStore(modelConnectionDataFile);
  const connection = connectionStore.apiConnections.find(item => item.id === agent.apiConnectionId);
  if (!connection) {
    return 'apiConnectionId 对应的连接不存在';
  }
  if (!connection.enabled) {
    return 'apiConnectionId 对应的连接已停用';
  }
  return null;
}

export function createAgentAdminService(options: CreateAgentAdminServiceOptions): AgentAdminService {
  function listAgents(): AgentAdminListResult {
    const store = loadAgentStore(options.agentDataFile);
    return {
      agents: store.activeAgents,
      pendingAgents: store.pendingAgents,
      pendingReason: store.pendingReason,
      pendingUpdatedAt: store.pendingUpdatedAt
    };
  }

  function normalizeAndValidateAgent(agent: AIAgentConfig): AIAgentConfig {
    const normalized = normalizeAgentConfig(agent);
    const validationError = validateAgentConfig(normalized) || validateAgentConnectionReference(normalized, options.modelConnectionDataFile);
    if (validationError) {
      throw new AgentAdminServiceError(400, validationError);
    }
    return normalized;
  }

  return {
    listAgents,

    createAgent(input: { agent: AIAgentConfig; applyMode?: ApplyMode }): AgentAdminMutationResult {
      const normalized = normalizeAndValidateAgent(input.agent);
      const applyMode = parseApplyMode(input.applyMode);
      const store = loadAgentStore(options.agentDataFile);
      const next = updateAgentStore(store, applyMode, agents => {
        if (agents.some(agent => agent.name === normalized.name)) {
          throw new AgentAdminServiceError(400, '智能体名称已存在');
        }
        return [...agents, normalized];
      });
      saveAgentStore(options.agentDataFile, next);
      return { success: true, applyMode, agent: normalized };
    },

    updateAgent(targetName: string, input: { agent: AIAgentConfig; applyMode?: ApplyMode }): AgentAdminMutationResult {
      const normalized = normalizeAndValidateAgent(input.agent);
      const applyMode = parseApplyMode(input.applyMode);
      const store = loadAgentStore(options.agentDataFile);
      const next = updateAgentStore(store, applyMode, agents => {
        const index = agents.findIndex(agent => agent.name === targetName);
        if (index === -1) {
          throw new AgentAdminServiceError(400, '智能体不存在');
        }
        if (normalized.name !== targetName && agents.some(agent => agent.name === normalized.name)) {
          throw new AgentAdminServiceError(400, '新的智能体名称已存在');
        }
        const cloned = [...agents];
        cloned[index] = { ...agents[index], ...normalized };
        return cloned;
      });
      saveAgentStore(options.agentDataFile, next);
      return { success: true, applyMode, agent: normalized };
    },

    updateAgentPrompt(targetName: string, input: { systemPrompt?: string; personality?: string; applyMode?: ApplyMode }): { success: true; applyMode: ApplyMode } {
      const applyMode = parseApplyMode(input.applyMode);
      const nextPrompt = (input.systemPrompt || '').trim();
      const nextPersonality = (input.personality || '').trim();
      if (!nextPrompt && !nextPersonality) {
        throw new AgentAdminServiceError(400, '至少提供 systemPrompt 或 personality');
      }

      const store = loadAgentStore(options.agentDataFile);
      const next = updateAgentStore(store, applyMode, agents => {
        const index = agents.findIndex(agent => agent.name === targetName);
        if (index === -1) {
          throw new AgentAdminServiceError(400, '智能体不存在');
        }
        const current = agents[index];
        const updated: AIAgentConfig = {
          ...current,
          personality: nextPersonality || current.personality,
          systemPrompt: nextPrompt || current.systemPrompt
        };
        const validationError = validateAgentConfig(updated);
        if (validationError) {
          throw new AgentAdminServiceError(400, validationError);
        }
        const cloned = [...agents];
        cloned[index] = updated;
        return cloned;
      });
      saveAgentStore(options.agentDataFile, next);
      return { success: true, applyMode };
    },

    restoreAgentPromptTemplate(targetName: string, applyModeInput?: ApplyMode): { success: true; applyMode: ApplyMode; systemPrompt: string } {
      if (!isProfessionalAgentName(targetName)) {
        throw new AgentAdminServiceError(400, '该智能体暂无可恢复的共享模板提示词');
      }

      const applyMode = parseApplyMode(applyModeInput);
      const restoredPrompt = buildProfessionalAgentPrompt(targetName);
      const store = loadAgentStore(options.agentDataFile);
      const next = updateAgentStore(store, applyMode, agents => {
        const index = agents.findIndex(agent => agent.name === targetName);
        if (index === -1) {
          throw new AgentAdminServiceError(400, '智能体不存在');
        }
        const current = agents[index];
        const updated: AIAgentConfig = {
          ...current,
          systemPrompt: restoredPrompt
        };
        const validationError = validateAgentConfig(updated);
        if (validationError) {
          throw new AgentAdminServiceError(400, validationError);
        }
        const cloned = [...agents];
        cloned[index] = updated;
        return cloned;
      });
      saveAgentStore(options.agentDataFile, next);
      return { success: true, applyMode, systemPrompt: restoredPrompt };
    },

    getAgentPromptTemplate(targetName: string): { success: true; currentPrompt: string; templatePrompt: string } {
      if (!isProfessionalAgentName(targetName)) {
        throw new AgentAdminServiceError(400, '该智能体暂无可预览的共享模板提示词');
      }

      const store = loadAgentStore(options.agentDataFile);
      const current = store.activeAgents.find(agent => agent.name === targetName);
      if (!current) {
        throw new AgentAdminServiceError(404, '智能体不存在');
      }

      return {
        success: true,
        currentPrompt: current.systemPrompt || '',
        templatePrompt: buildProfessionalAgentPrompt(targetName)
      };
    },

    deleteAgent(targetName: string, applyModeInput?: ApplyMode): { success: true; applyMode: ApplyMode; name: string } {
      const applyMode = parseApplyMode(applyModeInput);
      const store = loadAgentStore(options.agentDataFile);
      const next = updateAgentStore(store, applyMode, agents => {
        if (agents.length <= 1) {
          throw new AgentAdminServiceError(400, '至少保留一个智能体，无法删除');
        }
        const filtered = agents.filter(agent => agent.name !== targetName);
        if (filtered.length === agents.length) {
          throw new AgentAdminServiceError(400, '智能体不存在');
        }
        return filtered;
      });

      const groupStore = loadGroupStore(options.groupDataFile);
      const cleanedGroupStore = removeAgentFromAllGroups(groupStore, targetName);
      if (cleanedGroupStore !== groupStore) {
        saveGroupStore(options.groupDataFile, cleanedGroupStore);
      }

      saveAgentStore(options.agentDataFile, next);
      return { success: true, applyMode, name: targetName };
    },

    applyPendingAgents(): { success: true; agents: AIAgentConfig[] } {
      const store = loadAgentStore(options.agentDataFile);
      const next = applyPendingAgentStore(store);
      saveAgentStore(options.agentDataFile, next);
      return { success: true, agents: next.activeAgents };
    }
  };
}
