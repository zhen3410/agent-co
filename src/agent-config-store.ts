import * as fs from 'fs';
import * as path from 'path';
import { AIAgentConfig } from './types';
import { DEFAULT_AGENTS } from './agent-manager';

export type ApplyMode = 'immediate' | 'after_chat';

export interface AgentStore {
  activeAgents: AIAgentConfig[];
  removedDefaultAgentNames: string[];
  pendingAgents: AIAgentConfig[] | null;
  pendingRemovedDefaultAgentNames: string[] | null;
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
    removedDefaultAgentNames: [],
    pendingAgents: null,
    pendingRemovedDefaultAgentNames: null,
    pendingReason: null,
    updatedAt: Date.now(),
    pendingUpdatedAt: null
  };
}

function normalizeRemovedDefaultAgentNames(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const allowed = new Set(DEFAULT_AGENTS.map(agent => agent.name));
  return input
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(value => value && allowed.has(value));
}

function collectRemovedDefaultAgentNames(agents: AIAgentConfig[]): string[] {
  const existingNames = new Set(agents.map(agent => agent.name));
  return DEFAULT_AGENTS
    .map(agent => agent.name)
    .filter(name => !existingNames.has(name));
}

function mergeWithDefaultAgents(agents: AIAgentConfig[], removedDefaultAgentNames: string[] = []): AIAgentConfig[] {
  const merged = new Map<string, AIAgentConfig>();
  const removedNames = new Set(removedDefaultAgentNames);

  for (const agent of DEFAULT_AGENTS) {
    if (removedNames.has(agent.name)) {
      continue;
    }
    merged.set(agent.name, { ...agent });
  }

  for (const agent of agents) {
    if (!agent || typeof agent.name !== 'string' || !agent.name.trim()) {
      continue;
    }
    merged.set(agent.name, agent);
  }

  return Array.from(merged.values());
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
  const removedDefaultAgentNames = normalizeRemovedDefaultAgentNames(parsed.removedDefaultAgentNames);
  const pendingRemovedDefaultAgentNames = normalizeRemovedDefaultAgentNames(parsed.pendingRemovedDefaultAgentNames);

  const activeAgents = Array.isArray(parsed.activeAgents) && parsed.activeAgents.length > 0
    ? mergeWithDefaultAgents(parsed.activeAgents, removedDefaultAgentNames)
    : [...DEFAULT_AGENTS];

  const pendingAgents = Array.isArray(parsed.pendingAgents) && parsed.pendingAgents.length > 0
    ? mergeWithDefaultAgents(parsed.pendingAgents, pendingRemovedDefaultAgentNames)
    : null;

  return {
    activeAgents,
    removedDefaultAgentNames,
    pendingAgents,
    pendingRemovedDefaultAgentNames: pendingAgents ? pendingRemovedDefaultAgentNames : null,
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

  const executionMode = config.executionMode || (config.cli ? 'cli' : undefined);
  const cliName = config.cliName || config.cli;

  if (executionMode && executionMode !== 'cli' && executionMode !== 'api') {
    return 'executionMode 仅支持 cli 或 api';
  }

  if (executionMode === 'cli' && !cliName) {
    return 'executionMode=cli 时必须提供 cliName';
  }

  if (executionMode === 'api') {
    if (!config.apiConnectionId || !config.apiConnectionId.trim()) {
      return 'executionMode=api 时必须提供 apiConnectionId';
    }
    if (!config.apiModel || !config.apiModel.trim()) {
      return 'executionMode=api 时必须提供 apiModel';
    }
  } else if (cliName && cliName !== 'claude' && cliName !== 'codex') {
    return 'cliName 仅支持 claude 或 codex';
  }

  if (config.apiTemperature !== undefined) {
    if (typeof config.apiTemperature !== 'number' || !Number.isFinite(config.apiTemperature) || config.apiTemperature < 0 || config.apiTemperature > 2) {
      return 'apiTemperature 必须在 0~2 之间';
    }
  }

  if (config.apiMaxTokens !== undefined) {
    if (!Number.isInteger(config.apiMaxTokens) || config.apiMaxTokens <= 0) {
      return 'apiMaxTokens 必须是正整数';
    }
  }

  if (config.workdir) {
    if (!path.isAbsolute(config.workdir)) {
      return 'workdir 必须是绝对路径';
    }
    if (config.workdir.includes('\0')) {
      return 'workdir 非法';
    }
  }

  const hasPersonality = typeof config.personality === 'string' && config.personality.trim().length > 0;
  const hasPrompt = typeof config.systemPrompt === 'string' && config.systemPrompt.trim().length > 0;

  if (!hasPersonality && !hasPrompt) {
    return '请至少填写 personality 或 systemPrompt';
  }

  return null;
}

export function normalizeAgentConfig(config: AIAgentConfig): AIAgentConfig {
  const normalizedCli = config.cli === 'codex' || config.cli === 'claude' ? config.cli : undefined;
  const normalizedCliName = config.cliName === 'codex' || config.cliName === 'claude'
    ? config.cliName
    : normalizedCli;
  const normalizedExecutionMode = config.executionMode === 'cli' || config.executionMode === 'api'
    ? config.executionMode
    : (normalizedCliName ? 'cli' : undefined);

  if (normalizedExecutionMode === 'api') {
    return {
      ...config,
      name: config.name.trim(),
      avatar: config.avatar.trim(),
      color: config.color.trim(),
      personality: (config.personality || '').trim(),
      systemPrompt: (config.systemPrompt || '').trim() || undefined,
      executionMode: 'api',
      cliName: undefined,
      cli: undefined,
      apiConnectionId: (config.apiConnectionId || '').trim() || undefined,
      apiModel: (config.apiModel || '').trim() || undefined,
      apiTemperature: config.apiTemperature,
      apiMaxTokens: config.apiMaxTokens,
      workdir: (config.workdir || '').trim() || undefined
    };
  }

  const cliModeCliName = normalizedCliName || undefined;

  return {
    ...config,
    name: config.name.trim(),
    avatar: config.avatar.trim(),
    color: config.color.trim(),
    personality: (config.personality || '').trim(),
    systemPrompt: (config.systemPrompt || '').trim() || undefined,
    executionMode: normalizedExecutionMode,
    cliName: cliModeCliName,
    cli: cliModeCliName,
    apiConnectionId: undefined,
    apiModel: undefined,
    apiTemperature: undefined,
    apiMaxTokens: undefined,
    workdir: (config.workdir || '').trim() || undefined
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
      pendingRemovedDefaultAgentNames: collectRemovedDefaultAgentNames(nextAgents),
      pendingReason: '等待当前会话结束后生效',
      pendingUpdatedAt: Date.now()
    };
  }

  return {
    activeAgents: nextAgents,
    removedDefaultAgentNames: collectRemovedDefaultAgentNames(nextAgents),
    pendingAgents: null,
    pendingRemovedDefaultAgentNames: null,
    pendingReason: null,
    updatedAt: Date.now(),
    pendingUpdatedAt: null
  };
}

export function applyPendingAgents(store: AgentStore): AgentStore {
  if (!store.pendingAgents) return store;

  return {
    activeAgents: [...store.pendingAgents],
    removedDefaultAgentNames: [...(store.pendingRemovedDefaultAgentNames || [])],
    pendingAgents: null,
    pendingRemovedDefaultAgentNames: null,
    pendingReason: null,
    updatedAt: Date.now(),
    pendingUpdatedAt: null
  };
}
