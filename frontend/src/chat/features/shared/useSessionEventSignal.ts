import { useEffect, useState } from 'react';
import { getMergedRuntimeConfig } from '../../../shared/config/runtime-config';
import { createRealtimeClient, type RealtimeClient } from '../../../shared/lib/realtime/realtime-client';

interface SessionEnvelope {
  type?: unknown;
  sessionId?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveRealtimeUrl(): string {
  if (typeof window === 'undefined') {
    return '/api/ws/session-events';
  }

  const config = getMergedRuntimeConfig();
  const configured = typeof config.realtimeBaseUrl === 'string' ? config.realtimeBaseUrl : '';
  if (configured) {
    if (/^wss?:\/\//i.test(configured)) {
      return configured;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (configured.startsWith('/')) {
      return `${protocol}//${window.location.host}${configured}`;
    }
    return `${protocol}//${window.location.host}/${configured}`;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/ws/session-events`;
}

export function useSessionEventSignal(sessionId: string | null | undefined): number {
  const [signal, setSignal] = useState(0);

  useEffect(() => {
    if (!sessionId || typeof window === 'undefined') {
      return undefined;
    }

    const webSocketFactory = typeof window.WebSocket === 'function'
      ? (url: string) => new window.WebSocket(url)
      : (typeof WebSocket === 'function' ? (url: string) => new WebSocket(url) : null);

    if (!webSocketFactory) {
      return undefined;
    }

    let client: RealtimeClient | null = null;

    const bumpSignal = (): void => {
      setSignal((value) => value + 1);
    };

    client = createRealtimeClient({
      url: resolveRealtimeUrl(),
      webSocketFactory,
      onConnect: () => {
        try {
          client?.send({
            type: 'subscribe',
            sessionId,
            afterSeq: 0
          });
        } catch {
          // ignore send failures during reconnect races
        }
      },
      onMessage: (payload: unknown) => {
        if (!isRecord(payload)) {
          return;
        }

        const envelope = payload as SessionEnvelope;
        const envelopeType = typeof envelope.type === 'string' ? envelope.type : null;
        const envelopeSessionId = typeof envelope.sessionId === 'string' ? envelope.sessionId : null;

        if (envelopeType === 'session_event' && (!envelopeSessionId || envelopeSessionId === sessionId)) {
          bumpSignal();
          return;
        }

        if (envelopeType === 'subscribed' && envelopeSessionId === sessionId) {
          bumpSignal();
        }
      }
    });

    client.connect();
    return () => {
      client?.disconnect();
    };
  }, [sessionId]);

  return signal;
}
