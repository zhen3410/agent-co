import { createRealtimeClient, type RealtimeClient } from '../../shared/lib/realtime/realtime-client';
import type { ChatMessage, ChatRealtimeEnvelope } from '../types';

export interface ChatRealtimeOptions {
  sessionId: string;
  url: string;
  afterSeq?: number;
  getAfterSeq?: () => number;
  onEnvelope?: (payload: ChatRealtimeEnvelope) => void;
  onMessage: (nextMessages: ChatMessage[]) => void;
  getMessages: () => ChatMessage[];
  webSocketFactory?: (url: string) => {
    readyState?: number;
    addEventListener(type: string, listener: (event: any) => void): void;
    removeEventListener(type: string, listener: (event: any) => void): void;
    send(data: string): void;
    close(code?: number, reason?: string): void;
  };
}

export interface ChatRealtimeConnection {
  connect(): void;
  disconnect(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeMessage(input: unknown): ChatMessage | null {
  if (!isRecord(input)) {
    return null;
  }

  const id = typeof input.id === 'string' && input.id ? input.id : null;
  const role = typeof input.role === 'string' ? input.role : null;
  const sender = typeof input.sender === 'string' && input.sender ? input.sender : null;
  const text = typeof input.text === 'string' ? input.text : null;
  const timestampValue = input.timestamp;
  const timestamp = typeof timestampValue === 'number' && Number.isFinite(timestampValue)
    ? timestampValue
    : Date.now();

  if (!id || !sender || !text || (role !== 'user' && role !== 'assistant' && role !== 'system')) {
    return null;
  }

  return {
    id,
    role,
    sender,
    text,
    timestamp,
    messageSubtype: typeof input.messageSubtype === 'string' ? input.messageSubtype : undefined,
    reviewRawText: typeof input.reviewRawText === 'string' ? input.reviewRawText : undefined,
    reviewDisplayText: typeof input.reviewDisplayText === 'string' ? input.reviewDisplayText : undefined
  };
}

function extractIncomingMessage(payload: ChatRealtimeEnvelope, sessionId?: string): ChatMessage | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (payload.type === 'message') {
    return normalizeMessage(payload.message);
  }

  if (payload.type === 'session_event') {
    if (sessionId && typeof payload.sessionId === 'string' && payload.sessionId !== sessionId) {
      return null;
    }

    const event = isRecord(payload.event) ? payload.event : null;
    const eventPayload = event && isRecord(event.payload) ? event.payload : null;
    return normalizeMessage(eventPayload?.message);
  }

  return null;
}

export function extractRealtimeSequence(payload: ChatRealtimeEnvelope, sessionId?: string): number | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (payload.type === 'subscribed') {
    if (sessionId && typeof payload.sessionId === 'string' && payload.sessionId !== sessionId) {
      return null;
    }

    return typeof payload.latestSeq === 'number' && Number.isFinite(payload.latestSeq)
      ? payload.latestSeq
      : null;
  }

  if (payload.type === 'session_event') {
    if (sessionId && typeof payload.sessionId === 'string' && payload.sessionId !== sessionId) {
      return null;
    }

    const event = isRecord(payload.event) ? payload.event : null;
    const seq = event?.seq;
    return typeof seq === 'number' && Number.isFinite(seq) ? seq : null;
  }

  return null;
}

export function appendIncomingChatRealtimeData(
  messages: ChatMessage[],
  payload: ChatRealtimeEnvelope,
  sessionId?: string
): ChatMessage[] {
  const nextMessage = extractIncomingMessage(payload, sessionId);
  if (!nextMessage) {
    return messages;
  }

  if (messages.some((message) => message.id === nextMessage.id)) {
    return messages;
  }

  return [...messages, nextMessage].sort((left, right) => left.timestamp - right.timestamp);
}

export function createChatRealtimeConnection(options: ChatRealtimeOptions): ChatRealtimeConnection {
  let client: RealtimeClient | null = null;

  const resolveAfterSeq = (): number => {
    if (typeof options.getAfterSeq === 'function') {
      const fromGetter = options.getAfterSeq();
      if (typeof fromGetter === 'number' && Number.isFinite(fromGetter)) {
        return fromGetter;
      }
    }

    return options.afterSeq ?? 0;
  };

  return {
    connect(): void {
      if (client) {
        return;
      }

      client = createRealtimeClient({
        url: options.url,
        webSocketFactory: options.webSocketFactory,
        onConnect: () => {
          client?.send({
            type: 'subscribe',
            sessionId: options.sessionId,
            afterSeq: resolveAfterSeq()
          });
        },
        onMessage: (payload) => {
          const envelope = payload as ChatRealtimeEnvelope;
          options.onEnvelope?.(envelope);
          const nextMessages = appendIncomingChatRealtimeData(options.getMessages(), envelope, options.sessionId);
          if (nextMessages !== options.getMessages()) {
            options.onMessage(nextMessages);
          }
        }
      });

      client.connect();
    },
    disconnect(): void {
      client?.disconnect();
      client = null;
    }
  };
}
