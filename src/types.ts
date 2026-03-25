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
}

// ============================================
// AI Agent 类型
// ============================================

export interface AIAgent {
  name: string;
  avatar: string;
  systemPrompt: string;
  color: string;  // 用于前端显示
  cli?: 'claude' | 'codex';
  workdir?: string;
}

export interface AIAgentConfig {
  name: string;
  avatar: string;
  personality: string;
  color: string;
  systemPrompt?: string;
  cli?: 'claude' | 'codex';
  workdir?: string;
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
