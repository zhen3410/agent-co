import { createHttpClient } from '../../shared/lib/http/http-client';
import type {
  ChatHistoryResponse,
  ChatSessionAgentToggleResponse,
  ChatGroupsResponse,
  ChatSessionMutationResponse,
  ChatSessionSelectionResponse,
  ChatSwitchAgentResponse,
  ChatLoginRequest,
  ChatLoginResponse,
  ChatSendMessageRequest,
  ChatSendMessageResponse
} from '../types';

export interface ChatApiOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface ChatApi {
  loadHistory(): Promise<ChatHistoryResponse>;
  login(request: ChatLoginRequest): Promise<ChatLoginResponse>;
  sendMessage(request: ChatSendMessageRequest): Promise<ChatSendMessageResponse>;
  createSession(name?: string): Promise<ChatSessionMutationResponse>;
  selectSession(sessionId: string): Promise<ChatSessionSelectionResponse>;
  setSessionAgent(sessionId: string, agentName: string, enabled: boolean): Promise<ChatSessionAgentToggleResponse>;
  switchAgent(agentName: string | null): Promise<ChatSwitchAgentResponse>;
  listGroups(): Promise<ChatGroupsResponse>;
}

export function createChatApi(options: ChatApiOptions = {}): ChatApi {
  const client = createHttpClient({
    baseUrl: options.baseUrl,
    fetch: options.fetch
  });

  return {
    loadHistory(): Promise<ChatHistoryResponse> {
      return client.request<ChatHistoryResponse>('/api/history', {
        credentials: 'include',
        cache: 'no-store'
      });
    },
    login(request: ChatLoginRequest): Promise<ChatLoginResponse> {
      return client.request<ChatLoginResponse>('/api/login', {
        method: 'POST',
        credentials: 'include',
        json: {
          username: request.username,
          password: request.password
        }
      });
    },
    sendMessage(request: ChatSendMessageRequest): Promise<ChatSendMessageResponse> {
      return client.request<ChatSendMessageResponse>('/api/chat', {
        method: 'POST',
        credentials: 'include',
        json: {
          message: request.message
        }
      });
    },
    createSession(name?: string): Promise<ChatSessionMutationResponse> {
      return client.request<ChatSessionMutationResponse>('/api/sessions', {
        method: 'POST',
        credentials: 'include',
        json: name ? { name } : {}
      });
    },
    selectSession(sessionId: string): Promise<ChatSessionSelectionResponse> {
      return client.request<ChatSessionSelectionResponse>('/api/sessions/select', {
        method: 'POST',
        credentials: 'include',
        json: { sessionId }
      });
    },
    setSessionAgent(sessionId: string, agentName: string, enabled: boolean): Promise<ChatSessionAgentToggleResponse> {
      return client.request<ChatSessionAgentToggleResponse>('/api/session-agents', {
        method: 'POST',
        credentials: 'include',
        json: { sessionId, agentName, enabled }
      });
    },
    switchAgent(agentName: string | null): Promise<ChatSwitchAgentResponse> {
      return client.request<ChatSwitchAgentResponse>('/api/agents/switch', {
        method: 'POST',
        credentials: 'include',
        json: { agentName }
      });
    },
    listGroups(): Promise<ChatGroupsResponse> {
      return client.request<ChatGroupsResponse>('/api/groups', {
        credentials: 'include',
        cache: 'no-store'
      });
    }
  };
}
