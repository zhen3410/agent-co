/**
 * group-store.ts
 *
 * 智能体分组存储和验证逻辑
 */

import * as fs from 'fs';
import * as path from 'path';

export interface AgentGroup {
  id: string;
  name: string;
  icon: string;
  agentNames: string[];
}

export interface GroupStore {
  groups: AgentGroup[];
  updatedAt: number;
}

const GROUP_DATA_FILE_DEFAULT = path.join(process.cwd(), 'data', 'groups.json');

export function ensureDataDirExists(filePath: string): void {
  const dirPath = path.dirname(filePath);
  fs.mkdirSync(dirPath, { recursive: true });
}

export function createDefaultGroupStore(): GroupStore {
  return {
    groups: [],
    updatedAt: Date.now()
  };
}

export function loadGroupStore(filePath: string = GROUP_DATA_FILE_DEFAULT): GroupStore {
  ensureDataDirExists(filePath);

  if (!fs.existsSync(filePath)) {
    const initial = createDefaultGroupStore();
    saveGroupStore(filePath, initial);
    return initial;
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = raw ? JSON.parse(raw) as Partial<GroupStore> : {};

  return {
    groups: Array.isArray(parsed.groups) ? parsed.groups : [],
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now()
  };
}

export function saveGroupStore(filePath: string, store: GroupStore): void {
  ensureDataDirExists(filePath);
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

/**
 * 验证分组 ID 格式
 * 规则：2-20 字符，仅字母数字下划线
 */
export function isValidGroupId(id: string): boolean {
  return /^[a-zA-Z0-9_]{2,20}$/.test(id);
}

/**
 * 验证 emoji 格式
 * 规则：1-2 个 emoji
 */
export function isValidEmoji(icon: string): boolean {
  // 简单的 emoji 正则，匹配常见的 emoji 范围
  const emojiRegex = /^[\p{Emoji}\p{Emoji_Presentation}\p{Emoji_Modifier}\p{Emoji_Modifier_Base}\p{Emoji_Component}]{1,2}$/u;
  return emojiRegex.test(icon);
}

/**
 * 验证分组配置
 * @param group 分组配置
 * @param existingAgentNames 当前存在的智能体名称列表
 * @returns 错误信息，null 表示验证通过
 */
export function validateGroupConfig(
  group: Partial<AgentGroup> & { id: string },
  existingAgentNames: string[]
): string | null {
  // 验证 id
  if (!group.id || !isValidGroupId(group.id)) {
    return '分组 ID 需要 2-20 个字符，仅支持字母数字下划线';
  }

  // 验证 name
  if (!group.name || group.name.length < 2 || group.name.length > 16) {
    return '分组名称需要 2-16 个字符';
  }

  // 验证 icon
  if (!group.icon || !isValidEmoji(group.icon)) {
    return '分组图标需要 1-2 个 emoji';
  }

  // 验证 agentNames
  if (!Array.isArray(group.agentNames) || group.agentNames.length === 0) {
    return '分组至少需要包含一个智能体';
  }

  const invalidNames = group.agentNames.filter(name => !existingAgentNames.includes(name));
  if (invalidNames.length > 0) {
    return `智能体不存在: ${invalidNames.join(', ')}`;
  }

  return null;
}

/**
 * 从所有分组中移除指定智能体
 * @param store 分组存储
 * @param agentName 要移除的智能体名称
 * @returns 更新后的分组存储
 */
export function removeAgentFromAllGroups(
  store: GroupStore,
  agentName: string
): GroupStore {
  let changed = false;
  const updatedGroups = store.groups.map(group => {
    const filtered = group.agentNames.filter(name => name !== agentName);
    if (filtered.length !== group.agentNames.length) {
      changed = true;
      return { ...group, agentNames: filtered };
    }
    return group;
  });

  // 移除空的分组
  const nonEmptyGroups = updatedGroups.filter(g => g.agentNames.length > 0);
  if (nonEmptyGroups.length !== updatedGroups.length) {
    changed = true;
  }

  if (!changed) {
    return store;
  }

  return {
    groups: nonEmptyGroups,
    updatedAt: Date.now()
  };
}