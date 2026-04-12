import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../shared/layouts/AppShell';
import { Button } from '../../shared/ui';
import { getMergedRuntimeConfig } from '../../shared/config/runtime-config';
import { ChatComposer } from '../features/composer/ChatComposer';
import { ChatMessageList } from '../features/message-list/ChatMessageList';
import { SessionSidebar } from '../features/session-sidebar/SessionSidebar';
import { createChatApi, type ChatApi } from '../services/chat-api';
import { appendIncomingChatRealtimeData, createChatRealtimeConnection } from '../services/chat-realtime';
import type { ChatHistoryResponse, ChatMessage } from '../types';

export interface ChatPageProps {
  initialState?: ChatHistoryResponse;
  api?: ChatApi;
}

type LoadState = 'loading' | 'ready' | 'error';

function createOptimisticUserMessage(text: string): ChatMessage {
  return {
    id: `optimistic-${Date.now()}`,
    role: 'user',
    sender: '用户',
    text,
    timestamp: Date.now()
  };
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

function normalizeHistoryState(state: ChatHistoryResponse): ChatHistoryResponse {
  return {
    messages: Array.isArray(state.messages) ? state.messages : [],
    session: state.session ?? null,
    activeSessionId: state.activeSessionId ?? state.session?.id ?? null,
    chatSessions: Array.isArray(state.chatSessions) ? state.chatSessions : [],
    enabledAgents: Array.isArray(state.enabledAgents) ? state.enabledAgents : [],
    currentAgent: state.currentAgent ?? null,
    agentWorkdirs: state.agentWorkdirs ?? {},
    agents: Array.isArray(state.agents) ? state.agents : []
  };
}

export function ChatPage({ initialState, api }: ChatPageProps) {
  const runtimeConfig = getMergedRuntimeConfig();
  const chatApi = useMemo(() => {
    if (api) {
      return api;
    }

    const baseUrl = typeof runtimeConfig.apiBaseUrl === 'string' ? runtimeConfig.apiBaseUrl : undefined;
    return createChatApi({ baseUrl });
  }, [api, runtimeConfig.apiBaseUrl]);

  const [historyState, setHistoryState] = useState<ChatHistoryResponse | null>(initialState ? normalizeHistoryState(initialState) : null);
  const [loadState, setLoadState] = useState<LoadState>(initialState ? 'ready' : 'loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    if (initialState) {
      return undefined;
    }

    setLoadState('loading');
    setErrorMessage(null);

    chatApi.loadHistory()
      .then((response) => {
        if (cancelled) {
          return;
        }
        setHistoryState(normalizeHistoryState(response));
        setLoadState('ready');
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setLoadState('error');
        setErrorMessage(error instanceof Error ? error.message : '加载会话失败');
      });

    return () => {
      cancelled = true;
    };
  }, [chatApi, initialState, reloadNonce]);

  useEffect(() => {
    if (!historyState?.activeSessionId || typeof window === 'undefined') {
      return undefined;
    }

    const connection = createChatRealtimeConnection({
      sessionId: historyState.activeSessionId,
      url: resolveRealtimeUrl(),
      getMessages: () => historyState.messages,
      onMessage: (nextMessages) => {
        setHistoryState((current) => {
          if (!current) {
            return current;
          }
          return {
            ...current,
            messages: nextMessages
          };
        });
      }
    });

    connection.connect();
    return () => {
      connection.disconnect();
    };
  }, [historyState?.activeSessionId, historyState?.messages]);

  const handleSubmit = async (message: string): Promise<void> => {
    const optimistic = createOptimisticUserMessage(message);
    setHistoryState((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        messages: [...current.messages, optimistic]
      };
    });

    try {
      await chatApi.sendMessage({ message });
      const nextHistory = await chatApi.loadHistory();
      setHistoryState(normalizeHistoryState(nextHistory));
      setLoadState('ready');
      setErrorMessage(null);
    } catch (error) {
      const nextError = error instanceof Error ? error.message : '发送失败';
      setErrorMessage(nextError);
      setHistoryState((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          messages: appendIncomingChatRealtimeData(current.messages, {
            type: 'message',
            message: {
              id: `system-${Date.now()}`,
              role: 'system',
              sender: '系统',
              text: `❌ ${nextError}`,
              timestamp: Date.now()
            }
          })
        };
      });
      throw error;
    }
  };

  const safeState = historyState ?? {
    messages: [],
    session: null,
    activeSessionId: null,
    chatSessions: [],
    enabledAgents: [],
    currentAgent: null,
    agentWorkdirs: {},
    agents: []
  };

  return (
    <AppShell
      title="agent-co chat"
      subtitle={safeState.session?.name || '当前会话'}
      actions={
        <Button variant="secondary" onClick={() => setReloadNonce((value) => value + 1)}>
          刷新
        </Button>
      }
    >
      <section
        data-chat-page="shell"
        style={{
          display: 'grid',
          gap: 'var(--space-4)',
          gridTemplateColumns: 'minmax(16rem, 20rem) minmax(0, 1fr)'
        }}
      >
        <SessionSidebar
          sessions={safeState.chatSessions}
          activeSessionId={safeState.activeSessionId}
          currentAgent={safeState.currentAgent}
          enabledAgents={safeState.enabledAgents}
        />

        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <ChatMessageList
            messages={safeState.messages}
            isLoading={loadState === 'loading'}
            errorMessage={loadState === 'error' ? errorMessage : null}
          />
          <ChatComposer
            disabled={loadState !== 'ready'}
            onSubmit={handleSubmit}
          />
        </div>
      </section>
    </AppShell>
  );
}
