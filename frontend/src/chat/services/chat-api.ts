import { createHttpClient } from '../../shared/lib/http/http-client';
import type { ChatHistoryResponse, ChatSendMessageRequest, ChatSendMessageResponse } from '../types';

export interface ChatApiOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface ChatApi {
  loadHistory(): Promise<ChatHistoryResponse>;
  sendMessage(request: ChatSendMessageRequest): Promise<ChatSendMessageResponse>;
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
    sendMessage(request: ChatSendMessageRequest): Promise<ChatSendMessageResponse> {
      return client.request<ChatSendMessageResponse>('/api/chat', {
        method: 'POST',
        credentials: 'include',
        json: {
          message: request.message
        }
      });
    }
  };
}
