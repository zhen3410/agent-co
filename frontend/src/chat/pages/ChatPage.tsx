import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../shared/layouts/AppShell';
import { Button } from '../../shared/ui';
import { getMergedRuntimeConfig } from '../../shared/config/runtime-config';
import { ChatComposer } from '../features/composer/ChatComposer';
import { ChatMessageList } from '../features/message-list/ChatMessageList';
import { SessionSidebar } from '../features/session-sidebar/SessionSidebar';
import { TimelinePanel } from '../features/timeline-panel/TimelinePanel';
import { RuntimeStatusBadge } from '../features/runtime-status/RuntimeStatusBadge';
import { CallGraphPanel } from '../features/call-graph/CallGraphPanel';
import { resolveChatRealtimeUrl } from '../services/chat-realtime-url';
import { createChatApi, type ChatApi } from '../services/chat-api';
import {
  appendIncomingChatRealtimeData,
  createChatRealtimeConnection,
  extractRealtimeSequence,
  type ChatRealtimeConnection,
  type ChatRealtimeOptions
} from '../services/chat-realtime';
import type { ChatHistoryResponse, ChatMessage, ChatRealtimeEnvelope } from '../types';

export interface ChatPageProps {
  initialState?: ChatHistoryResponse;
  api?: ChatApi;
  createRealtimeConnection?: (options: ChatRealtimeOptions) => ChatRealtimeConnection;
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

function normalizeHistoryState(state: ChatHistoryResponse): ChatHistoryResponse {
  return {
    messages: Array.isArray(state.messages) ? state.messages : [],
    session: state.session ?? null,
    activeSessionId: state.activeSessionId ?? state.session?.id ?? null,
    chatSessions: Array.isArray(state.chatSessions) ? state.chatSessions : [],
    latestEventSeq: typeof state.latestEventSeq === 'number' && Number.isFinite(state.latestEventSeq)
      ? state.latestEventSeq
      : undefined,
    enabledAgents: Array.isArray(state.enabledAgents) ? state.enabledAgents : [],
    currentAgent: state.currentAgent ?? null,
    agentWorkdirs: state.agentWorkdirs ?? {},
    agents: Array.isArray(state.agents) ? state.agents : []
  };
}

export function ChatPage({ initialState, api, createRealtimeConnection }: ChatPageProps) {
  const runtimeConfig = getMergedRuntimeConfig();
  const chatApi = useMemo(() => {
    if (api) {
      return api;
    }

    const baseUrl = typeof runtimeConfig.apiBaseUrl === 'string' ? runtimeConfig.apiBaseUrl : undefined;
    return createChatApi({ baseUrl });
  }, [api, runtimeConfig.apiBaseUrl]);
  const realtimeConnectionFactory = useMemo(() => {
    return createRealtimeConnection ?? createChatRealtimeConnection;
  }, [createRealtimeConnection]);

  const [historyState, setHistoryState] = useState<ChatHistoryResponse | null>(initialState ? normalizeHistoryState(initialState) : null);
  const [loadState, setLoadState] = useState<LoadState>(initialState ? 'ready' : 'loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [panelRefreshSignal, setPanelRefreshSignal] = useState(0);
  const messagesRef = useRef<ChatMessage[]>(historyState?.messages ?? []);
  const realtimeSeqRef = useRef<number>(typeof initialState?.latestEventSeq === 'number' ? initialState.latestEventSeq : 0);
  const realtimeSessionIdRef = useRef<string | null>(historyState?.activeSessionId ?? null);
  const realtimeSubscribedRef = useRef(false);

  const notifyPanelsToRefresh = useCallback(() => {
    setPanelRefreshSignal((current) => current + 1);
  }, []);

  const applyHistoryState = useCallback((nextState: ChatHistoryResponse) => {
    const normalized = normalizeHistoryState(nextState);
    const nextSessionId = normalized.activeSessionId ?? null;
    const nextLatestSeq = typeof normalized.latestEventSeq === 'number' ? normalized.latestEventSeq : null;

    if (realtimeSessionIdRef.current !== nextSessionId) {
      realtimeSessionIdRef.current = nextSessionId;
      realtimeSeqRef.current = nextLatestSeq ?? 0;
      realtimeSubscribedRef.current = false;
    } else if (nextLatestSeq !== null && nextLatestSeq > realtimeSeqRef.current) {
      realtimeSeqRef.current = nextLatestSeq;
    }

    messagesRef.current = normalized.messages;
    setHistoryState(normalized);
    setLoadState('ready');
    setErrorMessage(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (initialState && reloadNonce === 0) {
      applyHistoryState(initialState);
      return undefined;
    }

    setLoadState('loading');
    setErrorMessage(null);

    chatApi.loadHistory()
      .then((response) => {
        if (cancelled) {
          return;
        }
        applyHistoryState(response);
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
  }, [applyHistoryState, chatApi, initialState, reloadNonce]);

  useEffect(() => {
    const activeSessionId = historyState?.activeSessionId;
    if (!activeSessionId || typeof window === 'undefined') {
      return undefined;
    }

    realtimeSessionIdRef.current = activeSessionId;
    realtimeSubscribedRef.current = false;
    const connection = realtimeConnectionFactory({
      sessionId: activeSessionId,
      url: resolveChatRealtimeUrl(),
      getAfterSeq: () => realtimeSeqRef.current,
      getMessages: () => messagesRef.current,
      onEnvelope: (payload) => {
        const sequence = extractRealtimeSequence(payload, activeSessionId);
        if (sequence !== null && sequence > realtimeSeqRef.current) {
          realtimeSeqRef.current = sequence;
        }

        const envelope = payload as ChatRealtimeEnvelope;
        if (envelope.type === 'subscribed') {
          if (realtimeSubscribedRef.current) {
            notifyPanelsToRefresh();
          } else {
            realtimeSubscribedRef.current = true;
          }
          return;
        }

        if (envelope.type === 'session_event') {
          notifyPanelsToRefresh();
        }
      },
      onMessage: (nextMessages) => {
        messagesRef.current = nextMessages;
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
  }, [historyState?.activeSessionId, notifyPanelsToRefresh, realtimeConnectionFactory]);

  const handleSubmit = async (message: string): Promise<void> => {
    const optimistic = createOptimisticUserMessage(message);
    setHistoryState((current) => {
      if (!current) {
        return current;
      }
      const nextState = {
        ...current,
        messages: [...current.messages, optimistic]
      };
      messagesRef.current = nextState.messages;
      return nextState;
    });

    try {
      const sendResult = await chatApi.sendMessage({ message });
      if (typeof sendResult.latestEventSeq === 'number' && sendResult.latestEventSeq > realtimeSeqRef.current) {
        realtimeSeqRef.current = sendResult.latestEventSeq;
      }
      const nextHistory = await chatApi.loadHistory();
      applyHistoryState(nextHistory);
    } catch (error) {
      const nextError = error instanceof Error ? error.message : '发送失败';
      setErrorMessage(nextError);
      setHistoryState((current) => {
        if (!current) {
          return current;
        }
        const nextMessages = appendIncomingChatRealtimeData(current.messages, {
          type: 'message',
          message: {
            id: `system-${Date.now()}`,
            role: 'system',
            sender: '系统',
            text: `❌ ${nextError}`,
            timestamp: Date.now()
          }
        });
        messagesRef.current = nextMessages;
        return {
          ...current,
          messages: nextMessages
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
          gridTemplateColumns: 'minmax(16rem, 20rem) minmax(0, 1fr) minmax(18rem, 24rem)'
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

        <aside style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <RuntimeStatusBadge
            sessionId={safeState.activeSessionId}
            refreshSignal={panelRefreshSignal}
          />
          <TimelinePanel
            sessionId={safeState.activeSessionId}
            refreshSignal={panelRefreshSignal}
          />
          <CallGraphPanel
            sessionId={safeState.activeSessionId}
            refreshSignal={panelRefreshSignal}
          />
        </aside>
      </section>
    </AppShell>
  );
}
