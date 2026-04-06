import { loadAgentStore } from '../../agent-config-store';
import { loadGroupStore, saveGroupStore, validateGroupConfig, AgentGroup } from '../../group-store';

export interface GroupAdminService {
  listGroups(): { groups: AgentGroup[]; updatedAt: number };
  createGroup(input: { id?: string; name?: string; icon?: string; agentNames?: string[] }): { success: true; group: AgentGroup };
  updateGroup(id: string, input: { name?: string; icon?: string; agentNames?: string[] }): { success: true; group: AgentGroup };
  deleteGroup(id: string): { success: true; id: string };
}

export class GroupAdminServiceError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'GroupAdminServiceError';
    this.statusCode = statusCode;
  }
}

export interface CreateGroupAdminServiceOptions {
  groupDataFile: string;
  agentDataFile: string;
}

export function createGroupAdminService(options: CreateGroupAdminServiceOptions): GroupAdminService {
  function getExistingAgentNames(): string[] {
    return loadAgentStore(options.agentDataFile).activeAgents.map(agent => agent.name);
  }

  return {
    listGroups() {
      const store = loadGroupStore(options.groupDataFile);
      return { groups: store.groups, updatedAt: store.updatedAt };
    },

    createGroup(input) {
      if (!input.id || !input.name || !input.icon || !input.agentNames) {
        throw new GroupAdminServiceError(400, '缺少必要字段');
      }

      const group: AgentGroup = {
        id: input.id,
        name: input.name,
        icon: input.icon,
        agentNames: input.agentNames
      };
      const validationError = validateGroupConfig(group, getExistingAgentNames());
      if (validationError) {
        throw new GroupAdminServiceError(400, validationError);
      }

      const store = loadGroupStore(options.groupDataFile);
      if (store.groups.some(item => item.id === group.id)) {
        throw new GroupAdminServiceError(409, '分组 ID 已存在');
      }

      saveGroupStore(options.groupDataFile, {
        groups: [...store.groups, group],
        updatedAt: Date.now()
      });

      return { success: true as const, group };
    },

    updateGroup(id, input) {
      const store = loadGroupStore(options.groupDataFile);
      const index = store.groups.findIndex(group => group.id === id);
      if (index === -1) {
        throw new GroupAdminServiceError(404, '分组不存在');
      }

      const current = store.groups[index];
      const updated: AgentGroup = {
        id: current.id,
        name: input.name ?? current.name,
        icon: input.icon ?? current.icon,
        agentNames: input.agentNames ?? current.agentNames
      };

      const validationError = validateGroupConfig(updated, getExistingAgentNames());
      if (validationError) {
        throw new GroupAdminServiceError(400, validationError);
      }

      saveGroupStore(options.groupDataFile, {
        groups: store.groups.map((group, currentIndex) => currentIndex === index ? updated : group),
        updatedAt: Date.now()
      });

      return { success: true as const, group: updated };
    },

    deleteGroup(id) {
      const store = loadGroupStore(options.groupDataFile);
      const index = store.groups.findIndex(group => group.id === id);
      if (index === -1) {
        throw new GroupAdminServiceError(404, '分组不存在');
      }

      const deleted = store.groups[index];
      saveGroupStore(options.groupDataFile, {
        groups: store.groups.filter((_, currentIndex) => currentIndex !== index),
        updatedAt: Date.now()
      });

      return { success: true as const, id: deleted.id };
    }
  };
}
