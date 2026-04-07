/**
 * types.ts
 *
 * 类型定义文件
 */

// ============================================
// Rich Block 类型
// ============================================

export type Tone = 'info' | 'success' | 'warning';

export interface CardBlock {
  id: string;
  kind: 'card';
  title: string;
  body: string;
  tone: Tone;
}

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface ChecklistBlock {
  id: string;
  kind: 'checklist';
  title: string;
  items: ChecklistItem[];
}

export type RichBlock = CardBlock | ChecklistBlock;

// ============================================
// Agent 执行与连接类型
// ============================================

export type AgentExecutionMode = 'cli' | 'api';
export type AgentCliName = 'claude' | 'codex';
export type DiscussionMode = 'classic' | 'peer';
export type DiscussionState = 'active' | 'paused' | 'summarizing';
export type AgentDispatchKind = 'initial' | 'explicit_chained' | 'implicit_chained' | 'summary';
export type DiscussionIntent = 'question' | 'challenge' | 'rebuttal' | 'evidence' | 'proposal';
export type DiscussionTriggerReason =
  | 'explicit_mention'
  | 'factual_conflict'
  | 'logical_conflict'
  | 'role_boundary'
  | 'strong_relevant_objection';

export interface ApiConnectionConfig {
  id: string;
  name: string;
  baseURL: string;
  apiKey: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ApiConnectionSummary {
  id: string;
  name: string;
  baseURL: string;
  apiKeyMasked: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

// ============================================
// 消息类型
// ============================================

export type MessageRole = 'user' | 'assistant';

export interface Message {
  id: string;
  role: MessageRole;
  sender: string;  // 用户名或 AI 名字
  text: string;
  blocks?: RichBlock[];
  timestamp: number;
  mentions?: string[];  // 被 @ 的智能体名字列表
  invokeAgents?: string[];  // 显式声明需要链式调用的智能体（来自 callback invokeAgents 或 @@ 语法）
  dispatchKind?: AgentDispatchKind;
  discussionIntent?: DiscussionIntent;
  triggerReason?: DiscussionTriggerReason;
}

// ============================================
// AI Agent 类型
// ============================================

interface AIAgentBase {
  name: string;
  avatar: string;
  systemPrompt: string;
  color: string;  // 用于前端显示
  workdir?: string;
}

export interface AIAgent extends AIAgentBase {
  executionMode?: AgentExecutionMode;
  cliName?: AgentCliName;
  apiConnectionId?: string;
  apiModel?: string;
  apiTemperature?: number;
  apiMaxTokens?: number;
  cli?: AgentCliName;  // legacy
}

interface AIAgentConfigBase {
  name: string;
  avatar: string;
  personality: string;
  color: string;
  systemPrompt?: string;
  workdir?: string;
}

export interface AIAgentConfig extends AIAgentConfigBase {
  executionMode?: AgentExecutionMode;
  cliName?: AgentCliName;
  apiConnectionId?: string;
  apiModel?: string;
  apiTemperature?: number;
  apiMaxTokens?: number;
  cli?: AgentCliName;  // legacy
}

export interface AgentInvokeResult {
  text: string;
  blocks: RichBlock[];
  rawText?: string;
  finishReason?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

// ============================================
// API 请求/响应类型
// ============================================

export interface ChatRequest {
  message: string;
  sender: string;
  sessionId?: string;
  currentAgent?: string;  // 当前对话的智能体
}

export interface ChatResponse {
  messages: Message[];
  sessionId: string;
  currentAgent?: string;  // 更新当前智能体
  notice?: string;
}

export interface HistoryResponse {
  messages: Message[];
  agents: AIAgentConfig[];
  currentAgent?: string;  // 当前对话的智能体
  enabledAgents?: string[];
  agentWorkdirs?: Record<string, string>;
  session?: ChatSession;
  chatSessions?: ChatSessionSummary[];
  activeSessionId?: string;
}

export interface SessionState {
  currentAgent: string | null;  // 当前对话的智能体
  enabledAgents?: string[];
  lastActivity: number;
  discussionMode?: DiscussionMode;
  discussionState?: DiscussionState;
}

// ============================================
// BlockBuffer 类型
// ============================================

export interface SessionData {
  blocks: RichBlock[];
  createdAt: number;
}

export interface ChatSessionSummary {
  id: string;
  name: string;
  messageCount: number;
  updatedAt: number;
  createdAt: number;
  agentChainMaxHops: number;
  agentChainMaxCallsPerAgent: number | null;
  discussionMode: DiscussionMode;
  discussionState: DiscussionState;
}

export interface ChatSession extends ChatSessionSummary {
  history: Message[];
  currentAgent: string | null;
  enabledAgents: string[];
  agentWorkdirs: Record<string, string>;
}

// ============================================
// 服务器配置
// ============================================

export interface ServerConfig {
  port: number;
  claudeTimeoutMs: number;
  sessionTimeoutMs: number;
}
