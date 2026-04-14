import type { ChatSessionSummary } from '../../types';

export interface SessionSidebarProps {
  sessions: ChatSessionSummary[];
  activeSessionId?: string | null;
  currentAgent?: string | null;
  enabledAgents?: string[];
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  currentAgent = null,
  enabledAgents = []
}: SessionSidebarProps) {
  return (
    <aside
      data-chat-sidebar="sessions"
      aria-label="会话与上下文"
      style={{ display: 'grid', gap: 'var(--space-4)' }}
    >
      <section
        style={{
          background: 'rgba(248, 250, 252, 0.88)',
          border: '1px solid rgba(148, 163, 184, 0.18)',
          borderRadius: 'calc(var(--radius-lg) + 2px)',
          display: 'grid',
          gap: 'var(--space-3)',
          padding: 'var(--space-4)'
        }}
      >
        <header style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <strong style={{ color: 'var(--color-text)' }}>会话</strong>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
            导航保持次级，只在切换上下文时使用。
          </span>
        </header>

        <ul style={{ display: 'grid', gap: 'var(--space-2)', listStyle: 'none', margin: 0, padding: 0 }}>
          {sessions.length === 0 ? (
            <li style={{ color: 'var(--color-text-muted)' }}>暂无会话</li>
          ) : sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            return (
              <li
                key={session.id}
                style={{
                  background: isActive ? 'rgba(37, 99, 235, 0.06)' : 'transparent',
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-3)'
                }}
              >
                <div style={{ fontWeight: 'var(--font-weight-medium)' }}>{session.name || '未命名会话'}</div>
                <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', marginTop: 'var(--space-1)' }}>
                  {isActive ? '当前会话' : session.id}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section
        style={{
          background: 'rgba(248, 250, 252, 0.72)',
          border: '1px solid rgba(148, 163, 184, 0.16)',
          borderRadius: 'calc(var(--radius-lg) + 2px)',
          display: 'grid',
          gap: 'var(--space-3)',
          padding: 'var(--space-4)'
        }}
      >
        <header style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <strong style={{ color: 'var(--color-text)' }}>当前上下文</strong>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
            智能体与会话信息在这里轻量呈现。
          </span>
        </header>

        <dl style={{ display: 'grid', gap: 'var(--space-3)', margin: 0 }}>
          <div>
            <dt style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>当前智能体</dt>
            <dd style={{ margin: 'var(--space-1) 0 0' }}>{currentAgent || '自动选择'}</dd>
          </div>
          <div>
            <dt style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>已启用智能体</dt>
            <dd style={{ margin: 'var(--space-1) 0 0' }}>{enabledAgents.length > 0 ? enabledAgents.join('、') : '暂无'}</dd>
          </div>
        </dl>
      </section>
    </aside>
  );
}
