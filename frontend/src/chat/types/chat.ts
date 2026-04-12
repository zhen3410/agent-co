export type ChatMessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  sender: string;
  text: string;
  timestamp: number;
  messageSubtype?: string;
  reviewRawText?: string;
  reviewDisplayText?: string;
}

export interface ChatSessionSummary {
  id: string;
  name?: string;
  updatedAt?: number;
}

export interface ChatSessionDetails {
  id: string;
  name?: string;
  discussionState?: string;
  [key: string]: unknown;
}

export interface ChatHistoryResponse {
  messages: ChatMessage[];
  session: ChatSessionDetails | null;
  activeSessionId: string | null;
  chatSessions: ChatSessionSummary[];
  latestEventSeq?: number;
  enabledAgents: string[];
  currentAgent: string | null;
  agentWorkdirs: Record<string, string>;
  agents: unknown[];
}

export interface ChatSendMessageRequest {
  message: string;
}

export interface ChatSendMessageResponse {
  accepted: boolean;
  session?: ChatSessionDetails | null;
  latestEventSeq?: number;
  currentAgent?: string | null;
  notice?: string;
}

export interface ChatRealtimeMessageEnvelope {
  type: 'message';
  message: ChatMessage;
}

export interface ChatSessionEventEnvelope {
  type: 'session_event';
  sessionId?: string;
  event?: {
    seq?: number;
    eventId?: string;
    eventType?: string;
    payload?: {
      message?: ChatMessage;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

export interface ChatRealtimeSubscribedEnvelope {
  type: 'subscribed';
  sessionId?: string;
  latestSeq?: number;
}

export type ChatRealtimeEnvelope =
  | ChatRealtimeMessageEnvelope
  | ChatSessionEventEnvelope
  | ChatRealtimeSubscribedEnvelope
  | Record<string, unknown>;
