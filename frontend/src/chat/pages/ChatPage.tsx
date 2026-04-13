import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../shared/layouts/AppShell';
import { Button, Input } from '../../shared/ui';
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
  initialAuthStatus?: AuthStatus;
  api?: ChatApi;
  createRealtimeConnection?: (options: ChatRealtimeOptions) => ChatRealtimeConnection;
}

type LoadState = 'loading' | 'ready' | 'error';
type AuthStatus = { authEnabled: boolean; authenticated: boolean };

const CHAT_PAGE_SHELL_STYLES = `
  .chat-page-shell {
    display: grid;
    gap: var(--space-4);
    position: relative;
  }

  .chat-page-shell__actions {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .chat-page-shell__layout {
    align-items: start;
    display: grid;
    gap: var(--space-4);
    grid-template-columns: minmax(14rem, 18rem) minmax(0, 1fr) minmax(16rem, 20rem);
  }

  .chat-page-shell__session-rail {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }

  .chat-page-shell__conversation-stage {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }

  .chat-page-shell__composer-dock {
    bottom: 0;
    position: sticky;
    z-index: 5;
  }

  .chat-page-shell__secondary-shell {
    align-content: start;
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }

  .chat-page-shell__secondary-header {
    display: grid;
    gap: var(--space-1);
  }

  .chat-page-shell__secondary-header-copy {
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    margin: 0;
  }

  .chat-page-shell__mobile-secondary-trigger,
  .chat-page-shell__mobile-action {
    display: none;
  }

  .chat-page-shell__secondary-panels {
    display: grid;
    gap: var(--space-4);
  }

  .chat-page-shell__drawer {
    background: rgba(15, 23, 42, 0.12);
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
    background: var(--color-surface, #ffffff);
    box-shadow: 0 24px 64px rgba(15, 23, 42, 0.18);
    height: 100%;
    max-width: 22rem;
    overflow-y: auto;
    padding: var(--space-4);
    transform: translateX(-100%);
    transition: transform 180ms ease;
    width: min(88vw, 22rem);
  }

  .chat-page-shell__drawer[data-open="true"] .chat-page-shell__drawer-panel {
    transform: translateX(0);
  }

  .chat-page-shell__drawer-close {
    display: flex;
    justify-content: flex-end;
    margin-bottom: var(--space-3);
  }

  @media (max-width: 959px) {
    .chat-page-shell__layout {
      grid-template-columns: minmax(0, 1fr);
    }

    .chat-page-shell__session-rail {
      display: none;
    }

    .chat-page-shell__mobile-action {
      display: inline-flex;
    }

    .chat-page-shell__secondary-shell {
      background: rgba(248, 250, 252, 0.72);
      border: 1px solid rgba(148, 163, 184, 0.16);
      border-radius: calc(var(--radius-lg) + 2px);
      padding: var(--space-3);
    }

    .chat-page-shell__mobile-secondary-trigger {
      display: inline-flex;
      justify-content: center;
      width: fit-content;
    }

    .chat-page-shell__secondary-shell[data-mobile-expanded="false"] .chat-page-shell__secondary-panels {
      display: none;
    }

    .chat-page-shell__composer-dock {
      bottom: calc(env(safe-area-inset-bottom, 0px));
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
  const [loadState, setLoadState] = useState<LoadState>(initialState ? 'ready' : 'loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [panelRefreshSignal, setPanelRefreshSignal] = useState(0);
  const [isSessionDrawerOpen, setIsSessionDrawerOpen] = useState(false);
  const [isMobileSecondaryOpen, setIsMobileSecondaryOpen] = useState(false);
  const messagesRef = useRef<ChatMessage[]>(historyState?.messages ?? []);
  const realtimeSeqRef = useRef<number>(typeof initialState?.latestEventSeq === 'number' ? initialState.latestEventSeq : 0);
  const realtimeSessionIdRef = useRef<string | null>(historyState?.activeSessionId ?? null);
  const realtimeSubscribedRef = useRef(false);
  const isLoginGateVisible = Boolean(initialAuthStatus?.authEnabled && !initialAuthStatus?.authenticated);

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

  if (isLoginGateVisible) {
    return (
      <div data-chat-page="login" className="chat-login">
        <style>{CHAT_LOGIN_STYLES}</style>
        <div className="chat-login__frame">
          <header className="chat-login__header">
            <div className="chat-login__brand-row">
              <span className="chat-login__brand">agent-co</span>
              <span className="chat-login__badge">workspace</span>
            </div>
            <p className="chat-login__tagline">协作式 AI 工作台入口 · 登录后继续你的会话与执行记录。</p>
          </header>

          <section data-chat-login="panel" className="chat-login__panel">
            <div className="chat-login__panel-grid">
              <div>
                <span className="chat-login__eyebrow">Workspace Entry</span>
                <h2 className="chat-login__title">进入工作台</h2>
                <p className="chat-login__lead">登录后继续你的会话、执行状态与协作节奏。</p>
                <div className="chat-login__meta">
                  <div className="chat-login__meta-item">集中查看任务对话与运行时间线。</div>
                  <div className="chat-login__meta-item">账号统一管理，确保工作区资源安全。</div>
                </div>
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
                  />
                  <Input
                    label="密码"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    containerClassName="chat-login__field"
                  />
                </div>
                <div className="chat-login__actions">
                  <Button type="button" data-chat-login-action="submit" disabled>
                    进入工作台
                  </Button>
                  <span className="chat-login__assist">认证入口由统一登录服务提供，请联系管理员开通账号。</span>
                </div>
              </div>
            </div>
          </section>

          <footer className="chat-login__footer">
            <span>安全会话由 agent-co 统一管理。</span>
            <span>登录后可继续未完成的工作流。</span>
          </footer>
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
  const sessionTitle = safeState.session?.name || '当前会话';
  const messageCountLabel = safeState.messages.length > 0 ? `${safeState.messages.length} 条消息` : '等待第一条消息';

  return (
    <AppShell
      title="agent-co chat"
      subtitle={sessionTitle}
      actions={
        <div className="chat-page-shell__actions">
          <Button
            variant="secondary"
            className="chat-page-shell__mobile-action"
            aria-controls="chat-session-drawer"
            aria-expanded={isSessionDrawerOpen}
            data-chat-mobile-toggle="sessions"
            onClick={() => setIsSessionDrawerOpen((current) => !current)}
          >
            会话
          </Button>
          <Button variant="secondary" onClick={() => setReloadNonce((value) => value + 1)}>
            刷新
          </Button>
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
            <section
              aria-label="当前会话概览"
              style={{
                background: 'rgba(248, 250, 252, 0.76)',
                border: '1px solid rgba(148, 163, 184, 0.16)',
                borderRadius: 'calc(var(--radius-lg) + 4px)',
                display: 'grid',
                gap: 'var(--space-2)',
                padding: 'var(--space-4)'
              }}
            >
              <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', justifyContent: 'space-between' }}>
                <strong style={{ color: 'var(--color-text)', fontSize: 'var(--font-size-lg)' }}>{sessionTitle}</strong>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>{messageCountLabel}</span>
              </div>
              <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>
                主舞台聚焦消息流与输入区；运行状态与执行细节保留在右侧次级面板。
              </p>
            </section>

            <ChatMessageList
              messages={safeState.messages}
              isLoading={loadState === 'loading'}
              errorMessage={loadState === 'error' ? errorMessage : null}
            />

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

          <aside
            data-chat-region="secondary-panels"
            data-chat-mobile-secondary="panels"
            data-mobile-expanded={isMobileSecondaryOpen}
            className="chat-page-shell__secondary-shell"
          >
            <header className="chat-page-shell__secondary-header">
              <strong style={{ color: 'var(--color-text)' }}>运行详情</strong>
              <p className="chat-page-shell__secondary-header-copy">
                运行状态、时间线与调用图在移动端收纳为次级区域。
              </p>
              <Button
                variant="secondary"
                className="chat-page-shell__mobile-secondary-trigger"
                aria-controls="chat-mobile-secondary-panels"
                aria-expanded={isMobileSecondaryOpen}
                data-chat-mobile-toggle="secondary-panels"
                onClick={() => setIsMobileSecondaryOpen((current) => !current)}
              >
                {isMobileSecondaryOpen ? '收起运行详情' : '查看运行详情'}
              </Button>
            </header>

            <div id="chat-mobile-secondary-panels" className="chat-page-shell__secondary-panels">
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
          </aside>
        </section>
      </section>
    </AppShell>
  );
}
