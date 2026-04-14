export type AdminNoticeTone = 'success' | 'error';
export type AgentExecutionMode = 'cli' | 'api';
export type AgentCliName = 'claude' | 'codex';
export type ApplyMode = 'immediate' | 'after_chat';

export interface AdminNotice {
  tone: AdminNoticeTone;
  message: string;
}

export interface AdminUser {
  username: string;
  createdAt: number;
  updatedAt: number;
}

export interface AdminUserCreateInput {
  username: string;
  password: string;
}

export interface AdminUserPasswordInput {
  password: string;
}

export interface AdminAgent {
  name: string;
  avatar: string;
  personality: string;
  color: string;
  systemPrompt?: string;
  workdir?: string;
  executionMode?: AgentExecutionMode;
  cliName?: AgentCliName;
  apiConnectionId?: string;
  apiModel?: string;
  apiTemperature?: number;
  apiMaxTokens?: number;
}

export interface AdminAgentListResponse {
  agents: AdminAgent[];
  pendingAgents: AdminAgent[] | null;
  pendingReason: string | null;
  pendingUpdatedAt: number | null;
}

export interface AdminAgentMutationResult {
  success: true;
  applyMode: ApplyMode;
  agent: AdminAgent;
}

export interface AdminGroup {
  id: string;
  name: string;
  icon: string;
  agentNames: string[];
}

export interface AdminGroupListResponse {
  groups: AdminGroup[];
  updatedAt: number;
}

export interface AdminGroupMutationResult {
  success: true;
  group: AdminGroup;
}

export interface AdminModelConnection {
  id: string;
  name: string;
  baseURL: string;
  apiKeyMasked: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AdminModelConnectionListResponse {
  connections: AdminModelConnection[];
}

export interface AdminModelConnectionDraft {
  name: string;
  baseURL: string;
  apiKey?: string;
  enabled: boolean;
}

export interface AdminModelConnectionMutationResult {
  success: true;
  connection: AdminModelConnection;
}

export interface AdminModelConnectionTestResult {
  success: boolean;
  statusCode?: number;
  error?: string;
}

export interface AdminResources {
  users: AdminUser[];
  agents: AdminAgent[];
  pendingAgents: AdminAgent[] | null;
  pendingReason: string | null;
  pendingUpdatedAt: number | null;
  groups: AdminGroup[];
  connections: AdminModelConnection[];
}

export interface AdminApi {
  listUsers(): Promise<{ users: AdminUser[] }>;
  createUser(input: AdminUserCreateInput): Promise<{ success: true; username: string }>;
  updateUserPassword(username: string, input: AdminUserPasswordInput): Promise<{ success: true; username: string }>;
  deleteUser(username: string): Promise<{ success: true; username: string }>;
  listAgents(): Promise<AdminAgentListResponse>;
  createAgent(input: { agent: AdminAgent; applyMode?: ApplyMode }): Promise<AdminAgentMutationResult>;
  updateAgent(name: string, input: { agent: AdminAgent; applyMode?: ApplyMode }): Promise<AdminAgentMutationResult>;
  deleteAgent(name: string, applyMode?: ApplyMode): Promise<{ success: true; applyMode: ApplyMode; name: string }>;
  applyPendingAgents(): Promise<{ success: true; agents: AdminAgent[] }>;
  listGroups(): Promise<AdminGroupListResponse>;
  createGroup(input: AdminGroup): Promise<AdminGroupMutationResult>;
  updateGroup(id: string, input: Omit<AdminGroup, 'id'>): Promise<AdminGroupMutationResult>;
  deleteGroup(id: string): Promise<{ success: true; id: string }>;
  listModelConnections(): Promise<AdminModelConnectionListResponse>;
  createModelConnection(input: AdminModelConnectionDraft): Promise<AdminModelConnectionMutationResult>;
  updateModelConnection(id: string, input: AdminModelConnectionDraft): Promise<AdminModelConnectionMutationResult>;
  deleteModelConnection(id: string): Promise<{ success: true; id: string }>;
  testModelConnection(id: string): Promise<AdminModelConnectionTestResult>;
}
