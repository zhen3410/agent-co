import * as fs from 'fs';
import * as path from 'path';
import { AIAgentConfig } from './types';
import { DEFAULT_AGENTS } from './agent-manager';

export type ApplyMode = 'immediate' | 'after_chat';

export interface AgentStore {
  activeAgents: AIAgentConfig[];
  pendingAgents: AIAgentConfig[] | null;
  pendingReason: string | null;
  updatedAt: number;
  pendingUpdatedAt: number | null;
}

export function ensureDataDirExists(filePath: string): void {
  const dirPath = path.dirname(filePath);
  fs.mkdirSync(dirPath, { recursive: true });
}

export function createDefaultAgentStore(): AgentStore {
  return {
    activeAgents: [...DEFAULT_AGENTS],
    pendingAgents: null,
    pendingReason: null,
    updatedAt: Date.now(),
    pendingUpdatedAt: null
  };
}

export function loadAgentStore(filePath: string): AgentStore {
  ensureDataDirExists(filePath);

  if (!fs.existsSync(filePath)) {
    const initial = createDefaultAgentStore();
    saveAgentStore(filePath, initial);
    return initial;
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = raw ? JSON.parse(raw) as Partial<AgentStore> : {};

  const activeAgents = Array.isArray(parsed.activeAgents) && parsed.activeAgents.length > 0
    ? parsed.activeAgents
    : [...DEFAULT_AGENTS];

  return {
    activeAgents,
    pendingAgents: Array.isArray(parsed.pendingAgents) ? parsed.pendingAgents : null,
    pendingReason: typeof parsed.pendingReason === 'string' ? parsed.pendingReason : null,
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    pendingUpdatedAt: typeof parsed.pendingUpdatedAt === 'number' ? parsed.pendingUpdatedAt : null
  };
}

export function saveAgentStore(filePath: string, store: AgentStore): void {
  ensureDataDirExists(filePath);
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

export function validateAgentConfig(config: AIAgentConfig): string | null {
  if (!config.name || config.name.trim().length < 2 || config.name.trim().length > 32) {
    return '智能体名称长度需在 2-32 字符之间';
  }

  if (!config.avatar || config.avatar.trim().length > 10) {
    return '请提供头像（建议 1 个 emoji）';
  }

  if (!config.color || !/^#([0-9a-fA-F]{6})$/.test(config.color)) {
    return '颜色必须是 6 位十六进制格式，例如 #22c55e';
  }

  const hasPersonality = typeof config.personality === 'string' && config.personality.trim().length > 0;
  const hasPrompt = typeof config.systemPrompt === 'string' && config.systemPrompt.trim().length > 0;

  if (!hasPersonality && !hasPrompt) {
    return '请至少填写 personality 或 systemPrompt';
  }

  return null;
}

export function normalizeAgentConfig(config: AIAgentConfig): AIAgentConfig {
  return {
    ...config,
    name: config.name.trim(),
    avatar: config.avatar.trim(),
    color: config.color.trim(),
    personality: (config.personality || '').trim(),
    systemPrompt: (config.systemPrompt || '').trim() || undefined
  };
}

export function updateAgentStore(
  store: AgentStore,
  applyMode: ApplyMode,
  updater: (agents: AIAgentConfig[]) => AIAgentConfig[]
): AgentStore {
  const baseAgents = applyMode === 'after_chat'
    ? (store.pendingAgents ? [...store.pendingAgents] : [...store.activeAgents])
    : [...store.activeAgents];

  const nextAgents = updater(baseAgents);

  if (applyMode === 'after_chat') {
    return {
      ...store,
      pendingAgents: nextAgents,
      pendingReason: '等待当前会话结束后生效',
      pendingUpdatedAt: Date.now()
    };
  }

  return {
    activeAgents: nextAgents,
    pendingAgents: null,
    pendingReason: null,
    updatedAt: Date.now(),
    pendingUpdatedAt: null
  };
}

export function applyPendingAgents(store: AgentStore): AgentStore {
  if (!store.pendingAgents) return store;

  return {
    activeAgents: [...store.pendingAgents],
    pendingAgents: null,
    pendingReason: null,
    updatedAt: Date.now(),
    pendingUpdatedAt: null
  };
}
