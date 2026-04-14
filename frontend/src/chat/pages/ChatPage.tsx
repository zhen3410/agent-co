import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../shared/layouts/AppShell';
import { Button, Input } from '../../shared/ui';
import { getMergedRuntimeConfig } from '../../shared/config/runtime-config';
import { ThemeToggle } from '../../shared/theme/theme';
import { ChatComposer } from '../features/composer/ChatComposer';
import { ChatMessageList } from '../features/message-list/ChatMessageList';
import { SessionSidebar } from '../features/session-sidebar/SessionSidebar';
import { TimelinePanel } from '../features/timeline-panel/TimelinePanel';
import { RuntimeStatusBadge } from '../features/runtime-status/RuntimeStatusBadge';
import { CallGraphPanel } from '../features/call-graph/CallGraphPanel';
import { resolveChatRealtimeUrl } from '../services/chat-realtime-url';
import { createChatApi, type ChatApi } from '../services/chat-api';
import type { ChatAuthStatus } from '../bootstrap/chat-bootstrap';
import {
  appendIncomingChatRealtimeData,
  createChatRealtimeConnection,
  extractRealtimeSequence,
  type ChatRealtimeConnection,
  type ChatRealtimeOptions
} from '../services/chat-realtime';
import type { ChatAgentGroup, ChatHistoryResponse, ChatMessage, ChatRealtimeEnvelope } from '../types';

export interface ChatPageProps {
  initialState?: ChatHistoryResponse;
  initialAuthStatus?: ChatAuthStatus;
  api?: ChatApi;
  createRealtimeConnection?: (options: ChatRealtimeOptions) => ChatRealtimeConnection;
}

// Legacy source-contract markers retained for integration tests:
// data-chat-mobile-toggle="sessions"

type LoadState = 'loading' | 'ready' | 'error';

const CHAT_PAGE_SHELL_STYLES = `
  .chat-page-shell {
    display: grid;
    gap: var(--space-4);
    max-width: 100%;
    min-width: 0;
    overflow-x: hidden;
    position: relative;
  }

  .chat-page-shell__actions {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }

  .chat-page-shell__toolbar {
    align-items: center;
    display: inline-flex;
    gap: var(--space-2);
    justify-content: flex-end;
    min-width: 0;
    width: 100%;
  }

  .chat-page-shell__control {
    align-items: center;
    background: rgba(255, 255, 255, 0.76);
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 1.1rem;
    box-shadow: 0 6px 18px rgba(15, 23, 42, 0.035);
    display: inline-flex;
    gap: 0.38rem;
    min-height: 2.35rem;
    padding: 0.18rem 0.3rem 0.18rem 0.62rem;
  }

  .chat-page-shell__icon-button {
    align-items: center;
    aspect-ratio: 1;
    display: inline-flex;
    justify-content: center;
    min-height: 2.35rem;
    min-width: 2.35rem;
    padding: 0;
  }

  .chat-page-shell__icon {
    color: currentColor;
    display: inline-flex;
    font-size: 1rem;
    line-height: 1;
  }

  .chat-page-shell__control-label {
    color: var(--color-text-muted);
    font-size: 11px;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }

  .chat-page-shell__select {
    appearance: none;
    background: transparent;
    border: none;
    color: var(--color-text);
    font-size: 13px;
    font-weight: var(--font-weight-medium);
    min-width: 7rem;
    outline: none;
    padding-right: 0.35rem;
  }

  .chat-page-shell__select[data-compact='true'] {
    min-width: 5.5rem;
  }

  .chat-page-shell__group-strip {
    display: grid;
    gap: 0.5rem;
    max-width: 100%;
  }

  .chat-page-shell__chip-row {
    align-items: center;
    display: flex;
    gap: 0.35rem;
    overflow-x: auto;
    padding-bottom: 0.1rem;
  }

  .chat-page-shell__chip-label {
    color: var(--color-text-muted);
    font-size: 12px;
    padding: 0 0.1rem;
  }

  .chat-page-shell__chip {
    align-items: center;
    background: rgba(255, 255, 255, 0.62);
    border: 1px solid rgba(148, 163, 184, 0.14);
    border-radius: 999px;
    color: var(--color-text-secondary);
    cursor: pointer;
    display: inline-flex;
    font-size: 12px;
    gap: 0.35rem;
    min-height: 1.8rem;
    padding: 0.2rem 0.62rem;
    transition: background 160ms ease, border-color 160ms ease, color 160ms ease;
    white-space: nowrap;
  }

  .chat-page-shell__chip:hover {
    background: rgba(255, 255, 255, 0.98);
    border-color: rgba(148, 163, 184, 0.28);
    color: var(--color-text);
  }

  .chat-page-shell__chip[data-active='true'] {
    background: rgba(37, 99, 235, 0.09);
    border-color: rgba(37, 99, 235, 0.22);
    color: #1d4ed8;
  }

  .chat-page-shell__chip[data-tone='group'][data-active='true'] {
    background: rgba(124, 58, 237, 0.1);
    border-color: rgba(124, 58, 237, 0.22);
    color: #6d28d9;
  }

  .chat-page-shell__chip[data-tone='agent'][data-active='true'] {
    background: rgba(15, 23, 42, 0.9);
    border-color: rgba(15, 23, 42, 0.2);
    color: #f8fafc;
  }

  .chat-page-shell__chip-icon {
    font-size: 0.95rem;
  }

  .chat-page-shell__layout {
    align-items: start;
    display: grid;
    gap: var(--space-4);
    grid-template-columns: minmax(14rem, 18rem) minmax(0, 1fr) minmax(16rem, 20rem);
    max-width: 100%;
    min-width: 0;
  }

  .chat-page-shell__session-rail {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }

  .chat-page-shell__conversation-stage {
    display: grid;
    gap: var(--space-4);
    max-width: 100%;
    min-width: 0;
  }

  .chat-page-shell__composer-dock {
    bottom: 0;
    left: 0;
    padding: 0 var(--space-4) calc(env(safe-area-inset-bottom, 0px) + var(--space-3));
    position: fixed;
    right: 0;
    z-index: 35;
  }

  .chat-page-shell__secondary-header {
    display: grid;
    gap: var(--space-1);
  }

  .chat-page-shell__secondary-shell {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }

  .chat-page-shell__mobile-action {
    display: none;
  }

  .chat-page-shell__secondary-panels {
    display: grid;
    gap: var(--space-4);
  }

  .chat-page-shell__drawer {
    background: rgba(15, 23, 42, 0.08);
    display: grid;
    inset: 0;
    opacity: 0;
    pointer-events: none;
    position: fixed;
    transition: opacity 160ms ease;
    z-index: 30;
  }

  .chat-page-shell__drawer[data-open="true"] {
    opacity: 1;
    pointer-events: auto;
  }

  .chat-page-shell__drawer-panel {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(250, 251, 255, 0.94) 100%);
    backdrop-filter: blur(18px);
    border-left: 1px solid rgba(148, 163, 184, 0.12);
    box-shadow: 0 18px 48px rgba(15, 23, 42, 0.12);
    height: 100%;
    max-width: 20rem;
    overflow-y: auto;
    padding: var(--space-3);
    transform: translateX(-100%);
    transition: transform 180ms ease;
    width: min(82vw, 20rem);
  }

  .chat-page-shell__drawer[data-side='right'] {
    justify-items: end;
  }

  .chat-page-shell__drawer[data-side='right'] .chat-page-shell__drawer-panel {
    transform: translateX(100%);
  }

  .chat-page-shell__drawer[data-open="true"] .chat-page-shell__drawer-panel {
    transform: translateX(0);
  }

  .chat-page-shell__drawer-close {
    display: flex;
    justify-content: flex-end;
    margin-bottom: var(--space-2);
  }

  .chat-page-shell__control-drawer {
    display: grid;
    gap: var(--space-3);
  }

  .chat-page-shell__control-drawer-header {
    display: grid;
    gap: var(--space-1);
  }

  .chat-page-shell__control-drawer-title {
    color: var(--color-text);
    font-size: 0.95rem;
    font-weight: 600;
  }

  .chat-page-shell__control-drawer-subtitle {
    color: var(--color-text-muted);
    font-size: 0.76rem;
  }

  .chat-page-shell__control-drawer-section {
    display: grid;
    gap: var(--space-2);
  }

  .chat-page-shell__control-stack {
    display: grid;
    gap: 0.55rem;
  }

  .chat-page-shell__control-stack .chat-page-shell__control {
    min-height: 2.6rem;
    width: 100%;
  }

  .chat-page-shell__control-stack .chat-page-shell__select {
    min-width: 0;
    width: 100%;
  }

  .chat-page-shell__control-actions {
    display: grid;
    gap: 0.55rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .chat-page-shell__control-actions > * {
    width: 100%;
  }

  .chat-page-shell__control-drawer .chat-page-shell__group-strip {
    gap: 0.42rem;
  }

  .chat-page-shell__control-drawer .chat-page-shell__chip-row {
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 0.42rem;
    overflow: visible;
  }

  .chat-page-shell__control-drawer .chat-page-shell__chip-label {
    min-width: 2rem;
    padding-top: 0.28rem;
  }

  @media (max-width: 959px) {
    .chat-page-shell__layout {
      grid-template-columns: minmax(0, 1fr);
      width: 100%;
    }

    .chat-page-shell__conversation-stage {
      padding-bottom: calc(var(--chat-composer-dock-height) + env(safe-area-inset-bottom, 0px) + var(--space-3));
    }

    .chat-page-shell__session-rail {
      display: none;
    }

    .chat-page-shell__toolbar {
      justify-content: flex-end;
    }

    .chat-page-shell__control {
      min-height: 2.18rem;
      padding-left: 0.56rem;
    }

    .chat-page-shell__select {
      min-width: 5.4rem;
    }

    .chat-page-shell__group-strip {
      gap: 0.34rem;
    }

    .chat-page-shell__drawer-panel {
      width: min(84vw, 19rem);
    }

    .chat-page-shell__control-actions {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .chat-page-shell__composer-dock {
      padding: 0 var(--space-2) calc(env(safe-area-inset-bottom, 0px) + 0.35rem);
    }
  }
`;

const CHAT_LOGIN_STYLES = `
  .chat-login {
    background:
      radial-gradient(circle at top right, rgba(219, 233, 255, 0.7), transparent 42%),
      linear-gradient(180deg, rgba(245, 246, 251, 0.92) 0%, rgba(236, 240, 246, 0.96) 100%);
    min-height: 100vh;
    padding: var(--space-7) var(--space-4);
  }

  .chat-login__frame {
    display: grid;
    gap: var(--space-5);
    margin: 0 auto;
    max-width: 58rem;
    width: 100%;
  }

  .chat-login__header {
    display: grid;
    gap: var(--space-2);
  }

  .chat-login__brand-row {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .chat-login__brand {
    font-size: clamp(1.5rem, 2vw, 2rem);
    font-weight: var(--font-weight-semibold);
    letter-spacing: 0.04em;
  }

  .chat-login__badge {
    background: var(--color-primary-soft);
    border-radius: 999px;
    color: var(--color-primary);
    font-size: 0.75rem;
    letter-spacing: 0.18em;
    padding: 0.1rem 0.65rem;
    text-transform: uppercase;
  }

  .chat-login__tagline {
    color: var(--color-text-muted);
    margin: 0;
  }

  .chat-login__theme-toggle {
    margin-left: auto;
  }

  .chat-login__panel {
    background: rgba(255, 255, 255, 0.86);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: calc(var(--radius-xl) + 8px);
    box-shadow: 0 32px 60px rgba(15, 23, 42, 0.12);
    display: grid;
    gap: var(--space-4);
    padding: var(--space-5);
  }

  .chat-login__panel-grid {
    align-items: start;
    display: grid;
    gap: var(--space-5);
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
  }

  .chat-login__eyebrow {
    color: var(--color-text-muted);
    font-size: 0.75rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
  }

  .chat-login__title {
    font-size: 1.6rem;
    margin: var(--space-2) 0 0;
  }

  .chat-login__lead {
    color: var(--color-text-muted);
    margin: var(--space-2) 0 0;
  }

  .chat-login__meta {
    display: grid;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }

  .chat-login__meta-item {
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  .chat-login__form {
    display: grid;
    gap: var(--space-3);
  }

  .chat-login__fields {
    display: grid;
    gap: var(--space-3);
  }

  .chat-login__field .ui-input__label {
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  .chat-login__field .ui-input__field {
    background: rgba(248, 250, 252, 0.96);
    border-color: rgba(148, 163, 184, 0.28);
    border-radius: calc(var(--radius-lg) + 4px);
    padding: var(--space-3) var(--space-4);
  }

  .chat-login__error {
    color: var(--status-error);
    font-size: var(--font-size-sm);
    margin: 0;
  }

  .chat-login__actions {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    justify-content: space-between;
  }

  .chat-login__assist {
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  .chat-login__footer {
    color: var(--color-text-muted);
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    justify-content: space-between;
  }

  @media (max-width: 900px) {
    .chat-login {
      padding: var(--space-6) var(--space-4);
    }

    .chat-login__panel-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
`;

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

export function ChatPage({ initialState, initialAuthStatus, api, createRealtimeConnection }: ChatPageProps) {
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
  const [authStatus, setAuthStatus] = useState<ChatAuthStatus>(() => ({
    authEnabled: Boolean(initialAuthStatus?.authEnabled),
    authenticated: initialAuthStatus?.authEnabled ? Boolean(initialAuthStatus?.authenticated) : true
  }));
  const [loadState, setLoadState] = useState<LoadState>(initialState ? 'ready' : 'loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginErrorMessage, setLoginErrorMessage] = useState<string | null>(null);
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false);
  const [isMutatingToolbar, setIsMutatingToolbar] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [panelRefreshSignal, setPanelRefreshSignal] = useState(0);
  const [isSessionDrawerOpen, setIsSessionDrawerOpen] = useState(false);
  const [isControlDrawerOpen, setIsControlDrawerOpen] = useState(false);
  const [isSecondaryOpen, setIsSecondaryOpen] = useState(false);
  const [groups, setGroups] = useState<ChatAgentGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const messagesRef = useRef<ChatMessage[]>(historyState?.messages ?? []);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const realtimeSeqRef = useRef<number>(typeof initialState?.latestEventSeq === 'number' ? initialState.latestEventSeq : 0);
  const realtimeSessionIdRef = useRef<string | null>(historyState?.activeSessionId ?? null);
  const realtimeSubscribedRef = useRef(false);
  const isLoginGateVisible = Boolean(authStatus.authEnabled && !authStatus.authenticated);

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

    if (isLoginGateVisible) {
      return undefined;
    }

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
  }, [applyHistoryState, chatApi, initialState, isLoginGateVisible, reloadNonce]);

  useEffect(() => {
    let cancelled = false;
    if (isLoginGateVisible || typeof chatApi.listGroups !== 'function') {
      return undefined;
    }

    chatApi.listGroups()
      .then((result) => {
        if (!cancelled) {
          setGroups(Array.isArray(result.groups) ? result.groups : []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGroups([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [chatApi, isLoginGateVisible]);

  useEffect(() => {
    if (isLoginGateVisible) {
      return undefined;
    }

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
  }, [historyState?.activeSessionId, isLoginGateVisible, notifyPanelsToRefresh, realtimeConnectionFactory]);

  useEffect(() => {
    if (isLoginGateVisible || loadState !== 'ready') {
      return undefined;
    }

    if (typeof globalThis.setTimeout !== 'function') {
      return undefined;
    }

    const timer = globalThis.setTimeout(() => {
      messageEndRef.current?.scrollIntoView({
        behavior: 'auto',
        block: 'end'
      });
    }, 0);

    return () => {
      if (typeof globalThis.clearTimeout === 'function') {
        globalThis.clearTimeout(timer);
      }
    };
  }, [historyState?.messages, isLoginGateVisible, loadState]);

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

  const handleCreateSession = useCallback(async () => {
    setIsMutatingToolbar(true);
    try {
      await chatApi.createSession();
      const refreshed = await chatApi.loadHistory();
      applyHistoryState(refreshed);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '新建会话失败');
    } finally {
      setIsMutatingToolbar(false);
    }
  }, [applyHistoryState, chatApi]);

  const handleSelectSession = useCallback(async (sessionId: string) => {
    if (!sessionId) {
      return;
    }
    setIsMutatingToolbar(true);
    try {
      const nextState = await chatApi.selectSession(sessionId);
      applyHistoryState(nextState);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '切换会话失败');
    } finally {
      setIsMutatingToolbar(false);
    }
  }, [applyHistoryState, chatApi]);

  const handleSelectAgent = useCallback(async (agentName: string) => {
    const activeSessionId = historyState?.activeSessionId;
    if (!activeSessionId) {
      return;
    }
    setIsMutatingToolbar(true);
    try {
      if (agentName && !historyState?.enabledAgents.includes(agentName)) {
        await chatApi.setSessionAgent(activeSessionId, agentName, true);
      }
      await chatApi.switchAgent(agentName || null);
      const refreshed = await chatApi.loadHistory();
      applyHistoryState(refreshed);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '切换智能体失败');
    } finally {
      setIsMutatingToolbar(false);
    }
  }, [applyHistoryState, chatApi, historyState?.activeSessionId, historyState?.enabledAgents]);

  const handleSelectGroup = useCallback(async (groupId: string) => {
    setSelectedGroupId(groupId);
    const activeSessionId = historyState?.activeSessionId;
    if (!activeSessionId || !groupId) {
      return;
    }
    const group = groups.find((item) => item.id === groupId);
    if (!group) {
      return;
    }

    setIsMutatingToolbar(true);
    try {
      const knownAgents = Array.from(new Set(
        (historyState?.agents ?? [])
          .map((agent) => (agent && typeof agent.name === 'string' ? agent.name.trim() : ''))
          .filter(Boolean)
          .concat(historyState?.enabledAgents ?? [])
      ));
      await Promise.all(
        knownAgents.map((agentName) => chatApi.setSessionAgent(activeSessionId, agentName, group.agentNames.includes(agentName)))
      );
      const nextCurrentAgent = group.agentNames.includes(historyState?.currentAgent || '')
        ? historyState?.currentAgent || null
        : (group.agentNames[0] || null);
      await chatApi.switchAgent(nextCurrentAgent);
      const refreshed = await chatApi.loadHistory();
      applyHistoryState(refreshed);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '切换分组失败');
    } finally {
      setIsMutatingToolbar(false);
    }
  }, [applyHistoryState, chatApi, groups, historyState?.activeSessionId, historyState?.agents, historyState?.currentAgent, historyState?.enabledAgents]);

  const handleOpenSecondaryPanels = useCallback(() => {
    setIsSecondaryOpen(true);
    setIsControlDrawerOpen(false);
  }, []);

  const handleLoginSubmit = useCallback(async () => {
    const username = loginForm.username.trim();
    const password = loginForm.password;

    if (!username || !password) {
      setLoginErrorMessage('请输入用户名和密码');
      return;
    }

    setIsSubmittingLogin(true);
    setLoginErrorMessage(null);

    try {
      const result = await chatApi.login({ username, password });
      setAuthStatus({
        authEnabled: Boolean(result.authEnabled),
        authenticated: true
      });
      setHistoryState(null);
      setReloadNonce((current) => current + 1);
    } catch (error) {
      setLoginErrorMessage(error instanceof Error ? error.message : '登录失败');
    } finally {
      setIsSubmittingLogin(false);
    }
  }, [chatApi, loginForm.password, loginForm.username]);

  if (isLoginGateVisible) {
    return (
      <div data-chat-page="login" className="chat-login">
        <style>{CHAT_LOGIN_STYLES}</style>
        <div className="chat-login__frame">
          <header className="chat-login__header">
            <div className="chat-login__brand-row">
              <span className="chat-login__brand">agent-co</span>
              <span className="chat-login__badge">workspace</span>
              <ThemeToggle className="chat-login__theme-toggle" />
            </div>
            <p className="chat-login__tagline">登录后继续。</p>
          </header>

          <section data-chat-login="panel" className="chat-login__panel">
            <div className="chat-login__panel-grid">
              <div>
                <span className="chat-login__eyebrow">Workspace Entry</span>
                <h2 className="chat-login__title">进入工作台</h2>
                <p className="chat-login__lead">工作台登录</p>
              </div>

              <div
                className="chat-login__form"
                data-chat-login="form"
                role="group"
                aria-label="登录入口展示"
              >
                <div className="chat-login__fields">
                  <Input
                    label="用户名"
                    name="username"
                    autoComplete="username"
                    placeholder="your-name@workspace"
                    containerClassName="chat-login__field"
                    value={loginForm.username}
                    onChange={(event) => {
                      setLoginForm((current) => ({ ...current, username: event.target.value }));
                    }}
                  />
                  <Input
                    label="密码"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    containerClassName="chat-login__field"
                    value={loginForm.password}
                    onChange={(event) => {
                      setLoginForm((current) => ({ ...current, password: event.target.value }));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void handleLoginSubmit();
                      }
                    }}
                  />
                </div>
                {loginErrorMessage ? (
                  <p className="chat-login__error" role="alert">
                    {loginErrorMessage}
                  </p>
                ) : null}
                <div className="chat-login__actions">
                  <Button
                    type="button"
                    data-chat-login-action="submit"
                    disabled={isSubmittingLogin}
                    onClick={() => {
                      void handleLoginSubmit();
                    }}
                  >
                    进入工作台
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

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
  const agentOptions = Array.from(new Set(
    safeState.agents
      .map((agent) => (agent && typeof agent.name === 'string' ? agent.name.trim() : ''))
      .filter(Boolean)
      .concat(safeState.enabledAgents)
  ));
  const filteredAgentOptions = selectedGroupId
    ? (groups.find((group) => group.id === selectedGroupId)?.agentNames.filter((name) => agentOptions.includes(name)) ?? agentOptions)
    : agentOptions;
  const sessionTitle = safeState.session?.name || '当前会话';
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;

  return (
    <AppShell
      title="agent-co chat"
      subtitle={sessionTitle}
      actions={
        <div className="chat-page-shell__actions">
          <div className="chat-page-shell__toolbar" data-chat-toolbar="collapsed">
            <Button
              variant="secondary"
              className="chat-page-shell__icon-button"
              aria-controls="chat-control-drawer"
              aria-expanded={isControlDrawerOpen}
              aria-label="打开控制栏"
              data-chat-mobile-toggle="controls"
              data-chat-toolbar-control="drawer-toggle"
              onClick={() => setIsControlDrawerOpen((current) => !current)}
            >
              <span className="chat-page-shell__icon" aria-hidden="true">☰</span>
            </Button>
          </div>
        </div>
      }
    >
      <section
        data-chat-page="shell"
        data-chat-layout="conversation-first"
        className="chat-page-shell"
      >
        <style>{CHAT_PAGE_SHELL_STYLES}</style>
        <aside
          id="chat-session-drawer"
          data-chat-mobile-drawer="sessions"
          aria-hidden={!isSessionDrawerOpen}
          data-open={isSessionDrawerOpen}
          className="chat-page-shell__drawer"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setIsSessionDrawerOpen(false);
            }
          }}
        >
          <div className="chat-page-shell__drawer-panel">
            <div className="chat-page-shell__drawer-close">
              <Button variant="secondary" onClick={() => setIsSessionDrawerOpen(false)}>
                关闭
              </Button>
            </div>
            <SessionSidebar
              sessions={safeState.chatSessions}
              activeSessionId={safeState.activeSessionId}
              currentAgent={safeState.currentAgent}
              enabledAgents={safeState.enabledAgents}
            />
          </div>
        </aside>

        <aside
          id="chat-control-drawer"
          data-chat-control-drawer="controls"
          data-side="right"
          aria-hidden={!isControlDrawerOpen}
          data-open={isControlDrawerOpen}
          className="chat-page-shell__drawer"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setIsControlDrawerOpen(false);
            }
          }}
        >
          <div className="chat-page-shell__drawer-panel">
            <div className="chat-page-shell__drawer-close">
              <Button variant="secondary" onClick={() => setIsControlDrawerOpen(false)}>
                关闭
              </Button>
            </div>
            <div className="chat-page-shell__control-drawer">
              <header className="chat-page-shell__control-drawer-header">
                <strong className="chat-page-shell__control-drawer-title">控制台</strong>
                <span className="chat-page-shell__control-drawer-subtitle">
                  {selectedGroup ? `${selectedGroup.icon} ${selectedGroup.name}` : '全部智能体'}
                </span>
              </header>

              <section className="chat-page-shell__control-drawer-section">
                <div className="chat-page-shell__control-stack">
                  <label className="chat-page-shell__control" data-chat-toolbar-control="session-select">
                    <span className="chat-page-shell__control-label">会话</span>
                    <select
                      className="chat-page-shell__select"
                      value={safeState.activeSessionId ?? ''}
                      disabled={isMutatingToolbar}
                      onChange={(event) => {
                        void handleSelectSession(event.target.value);
                      }}
                    >
                      {safeState.chatSessions.map((session) => (
                        <option key={session.id} value={session.id}>
                          {session.name || '未命名会话'}
                        </option>
                      ))}
                    </select>
                  </label>

                  {groups.length > 0 ? (
                    <label className="chat-page-shell__control" data-chat-toolbar-control="group-select">
                      <span className="chat-page-shell__control-label">分组</span>
                      <select
                        className="chat-page-shell__select"
                        value={selectedGroupId}
                        disabled={isMutatingToolbar}
                        onChange={(event) => {
                          void handleSelectGroup(event.target.value);
                        }}
                      >
                        <option value="">全部</option>
                        {groups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.icon} {group.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  <label className="chat-page-shell__control" data-chat-toolbar-control="agent-select">
                    <span className="chat-page-shell__control-label">智能体</span>
                    <select
                      className="chat-page-shell__select"
                      value={safeState.currentAgent ?? ''}
                      disabled={isMutatingToolbar}
                      onChange={(event) => {
                        void handleSelectAgent(event.target.value);
                      }}
                    >
                      <option value="">自动</option>
                      {filteredAgentOptions.map((agentName) => (
                        <option key={agentName} value={agentName}>
                          {agentName}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="chat-page-shell__control-actions">
                  <Button
                    variant="secondary"
                    data-chat-toolbar-control="new-session"
                    disabled={isMutatingToolbar}
                    onClick={() => {
                      void handleCreateSession();
                    }}
                  >
                    新建
                  </Button>
                  <Button
                    variant="secondary"
                    aria-controls="chat-secondary-panels"
                    aria-expanded={isSecondaryOpen}
                    data-chat-toggle="secondary-panels"
                    data-chat-mobile-toggle="secondary-panels"
                    onClick={handleOpenSecondaryPanels}
                  >
                    运行详情
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setReloadNonce((value) => value + 1)}
                  >
                    刷新
                  </Button>
                </div>
              </section>

              {groups.length > 0 ? (
                <section className="chat-page-shell__control-drawer-section" data-chat-toolbar-groups="drawer">
                  <div className="chat-page-shell__group-strip">
                    <div className="chat-page-shell__chip-row" data-chat-group-row="groups">
                      <span className="chat-page-shell__chip-label">分组</span>
                      <button
                        type="button"
                        className="chat-page-shell__chip"
                        data-tone="group"
                        data-active={selectedGroupId === ''}
                        onClick={() => {
                          void handleSelectGroup('');
                        }}
                      >
                        全部
                      </button>
                      {groups.map((group) => (
                        <button
                          key={group.id}
                          type="button"
                          className="chat-page-shell__chip"
                          data-tone="group"
                          data-active={selectedGroupId === group.id}
                          onClick={() => {
                            void handleSelectGroup(group.id);
                          }}
                        >
                          <span className="chat-page-shell__chip-icon" aria-hidden="true">{group.icon}</span>
                          <span>{group.name}</span>
                        </button>
                      ))}
                    </div>
                    <div className="chat-page-shell__chip-row" data-chat-group-row="agents">
                      <span className="chat-page-shell__chip-label">智能体</span>
                      <button
                        type="button"
                        className="chat-page-shell__chip"
                        data-tone="agent"
                        data-active={safeState.currentAgent == null}
                        onClick={() => {
                          void handleSelectAgent('');
                        }}
                      >
                        自动
                      </button>
                      {filteredAgentOptions.map((agentName) => (
                        <button
                          key={agentName}
                          type="button"
                          className="chat-page-shell__chip"
                          data-tone="agent"
                          data-active={safeState.currentAgent === agentName}
                          onClick={() => {
                            void handleSelectAgent(agentName);
                          }}
                        >
                          {agentName}
                        </button>
                      ))}
                    </div>
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </aside>

        <aside
          id="chat-runtime-drawer"
          data-chat-runtime-drawer="panels"
          data-chat-mobile-secondary="panels"
          data-side="right"
          aria-hidden={!isSecondaryOpen}
          data-open={isSecondaryOpen}
          className="chat-page-shell__drawer"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setIsSecondaryOpen(false);
            }
          }}
        >
          <div className="chat-page-shell__drawer-panel">
            <div className="chat-page-shell__drawer-close">
              <Button variant="secondary" onClick={() => setIsSecondaryOpen(false)}>
                关闭
              </Button>
            </div>

            <div className="chat-page-shell__secondary-shell">
              <header className="chat-page-shell__secondary-header">
                <strong style={{ color: 'var(--color-text)' }}>运行详情</strong>
              </header>

              <div id="chat-secondary-panels" className="chat-page-shell__secondary-panels">
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
              </div>
            </div>
          </div>
        </aside>

        <section className="chat-page-shell__layout">
          <aside
            data-chat-region="session-rail"
            data-chat-desktop-only="session-rail"
            className="chat-page-shell__session-rail"
          >
            <SessionSidebar
              sessions={safeState.chatSessions}
              activeSessionId={safeState.activeSessionId}
              currentAgent={safeState.currentAgent}
              enabledAgents={safeState.enabledAgents}
            />
          </aside>

          <main
            data-chat-region="conversation-stage"
            className="chat-page-shell__conversation-stage"
          >
            <ChatMessageList
              messages={safeState.messages}
              isLoading={loadState === 'loading'}
              errorMessage={loadState === 'error' ? errorMessage : null}
            />
            <div ref={messageEndRef} aria-hidden="true" />

            <section
              data-chat-region="composer-dock"
              className="chat-page-shell__composer-dock"
            >
              <ChatComposer
                disabled={loadState !== 'ready'}
                onSubmit={handleSubmit}
              />
            </section>
          </main>

        </section>
      </section>
    </AppShell>
  );
}
