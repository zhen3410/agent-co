import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { AIAgentConfig, ApiConnectionConfig, ApiConnectionSummary } from './types';

export interface ApiConnectionStore {
  apiConnections: ApiConnectionConfig[];
  updatedAt: number;
}

function ensureDataDirExists(filePath: string): void {
  const dirPath = path.dirname(filePath);
  fs.mkdirSync(dirPath, { recursive: true });
}

function createDefaultApiConnectionStore(): ApiConnectionStore {
  return {
    apiConnections: [],
    updatedAt: Date.now()
  };
}

function toStringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseURL(baseURL: string): string {
  return baseURL.trim().replace(/\/+$/, '');
}

function isPositiveFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function maskApiKey(apiKey: string): string {
  const trimmed = toStringOrEmpty(apiKey);

  if (!trimmed) {
    return '';
  }

  if (trimmed.length <= 4) {
    return '*'.repeat(trimmed.length);
  }

  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}${'*'.repeat(trimmed.length - 4)}${trimmed.slice(-2)}`;
  }

  return `${trimmed.slice(0, 4)}${'*'.repeat(trimmed.length - 8)}${trimmed.slice(-4)}`;
}

export function toApiConnectionSummaries(connections: ApiConnectionConfig[]): ApiConnectionSummary[] {
  return connections.map(connection => ({
    id: connection.id,
    name: connection.name,
    baseURL: connection.baseURL,
    apiKeyMasked: maskApiKey(connection.apiKey),
    enabled: connection.enabled,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt
  }));
}

export function isApiConnectionReferenced(
  apiConnectionId: string,
  agents: AIAgentConfig[]
): boolean {
  return agents.some(agent => agent.apiConnectionId === apiConnectionId);
}

export function validateApiConnectionNameUnique(
  store: ApiConnectionStore,
  name: string,
  excludeId?: string
): string | null {
  const normalizedName = toStringOrEmpty(name);

  if (!normalizedName) {
    return '连接名称不能为空';
  }

  const duplicate = store.apiConnections.some(connection => {
    if (excludeId && connection.id === excludeId) {
      return false;
    }
    return connection.name === normalizedName;
  });

  return duplicate ? '连接名称已存在' : null;
}

export function normalizeApiConnectionConfig(input: Partial<ApiConnectionConfig> & { baseUrl?: string }): ApiConnectionConfig {
  const now = Date.now();
  const baseURL = normalizeBaseURL(
    toStringOrEmpty(input.baseURL) || toStringOrEmpty(input.baseUrl)
  );
  const id = toStringOrEmpty(input.id) || crypto.randomUUID();
  const name = toStringOrEmpty(input.name);
  const apiKey = toStringOrEmpty(input.apiKey);
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : true;
  const createdAt = typeof input.createdAt === 'number' ? input.createdAt : now;
  const updatedAt = typeof input.updatedAt === 'number' ? input.updatedAt : createdAt;

  return {
    id,
    name,
    baseURL,
    apiKey,
    enabled,
    createdAt,
    updatedAt
  };
}

export function validateApiConnectionConfig(config: ApiConnectionConfig): string | null {
  if (!toStringOrEmpty(config.id)) {
    return '连接 ID 不能为空';
  }

  if (!toStringOrEmpty(config.name)) {
    return '连接名称不能为空';
  }

  const baseURL = toStringOrEmpty(config.baseURL);
  if (!baseURL) {
    return 'baseURL 不能为空';
  }

  try {
    const parsed = new URL(baseURL);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'baseURL 必须是合法 URL';
    }
  } catch {
    return 'baseURL 必须是合法 URL';
  }

  if (!toStringOrEmpty(config.apiKey)) {
    return 'apiKey 不能为空';
  }

  if (typeof config.enabled !== 'boolean') {
    return 'enabled 必须是布尔值';
  }

  if (typeof config.createdAt !== 'number' || !Number.isFinite(config.createdAt) || config.createdAt <= 0) {
    return 'createdAt 非法';
  }

  if (typeof config.updatedAt !== 'number' || !Number.isFinite(config.updatedAt) || config.updatedAt <= 0) {
    return 'updatedAt 非法';
  }

  return null;
}

function normalizeLoadedApiConnection(value: unknown): ApiConnectionConfig | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const normalized = normalizeApiConnectionConfig(value as Partial<ApiConnectionConfig> & { baseUrl?: string });
  return validateApiConnectionConfig(normalized) ? null : normalized;
}

export function loadApiConnectionStore(filePath: string): ApiConnectionStore {
  ensureDataDirExists(filePath);

  if (!fs.existsSync(filePath)) {
    const initial = createDefaultApiConnectionStore();
    saveApiConnectionStore(filePath, initial);
    return initial;
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = raw ? JSON.parse(raw) as Partial<ApiConnectionStore> & { connections?: unknown } : {};
  const source = Array.isArray(parsed.apiConnections)
    ? parsed.apiConnections
    : Array.isArray(parsed.connections)
      ? parsed.connections
      : [];

  const apiConnections = source
    .map(normalizeLoadedApiConnection)
    .filter((item): item is ApiConnectionConfig => Boolean(item));

  return {
    apiConnections,
    updatedAt: isPositiveFiniteTimestamp(parsed.updatedAt) ? parsed.updatedAt : Date.now()
  };
}

export function saveApiConnectionStore(filePath: string, store: ApiConnectionStore): void {
  ensureDataDirExists(filePath);
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
}
