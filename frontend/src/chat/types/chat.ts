export type ChatMessageRole = 'user' | 'assistant' | 'system';

export interface ChatAgent {
  name: string;
  avatar?: string;
  color?: string;
}

export interface ChatAgentGroup {
  id: string;
  name: string;
  icon: string;
  agentNames: string[];
}

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
  agents: ChatAgent[];
}

export interface ChatSendMessageRequest {
  message: string;
}

export interface ChatLoginRequest {
  username: string;
  password: string;
}

export interface ChatLoginResponse {
  success: boolean;
  authEnabled: boolean;
}

export interface ChatSendMessageResponse {
  accepted: boolean;
  session?: ChatSessionDetails | null;
  latestEventSeq?: number;
  currentAgent?: string | null;
  notice?: string;
}

export interface ChatSessionMutationResponse {
  success: true;
  session?: ChatSessionDetails | null;
  enabledAgents?: string[];
  chatSessions?: ChatSessionSummary[];
  activeSessionId?: string | null;
}

export interface ChatSessionSelectionResponse extends ChatHistoryResponse {
  success?: true;
}

export interface ChatSessionAgentToggleResponse {
  success: true;
  enabledAgents: string[];
  currentAgentWillExpire: boolean;
}

export interface ChatSwitchAgentResponse {
  success: true;
  currentAgent: string | null;
}

export interface ChatGroupsResponse {
  groups: ChatAgentGroup[];
  updatedAt: number;
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
