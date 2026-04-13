import { Card } from '../../../shared/ui';
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
    <aside data-chat-sidebar="sessions" style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <Card title="会话">
        <ul style={{ display: 'grid', gap: 'var(--space-2)', listStyle: 'none', margin: 0, padding: 0 }}>
          {sessions.length === 0 ? (
            <li style={{ color: 'var(--color-text-muted)' }}>暂无会话</li>
          ) : sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            return (
              <li
                key={session.id}
                style={{
                  background: isActive ? 'var(--color-surface-muted)' : 'transparent',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-2) var(--space-3)'
                }}
              >
                <div style={{ fontWeight: 'var(--font-weight-medium)' }}>{session.name || '未命名会话'}</div>
                <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                  {isActive ? '当前会话' : session.id}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="当前上下文">
        <dl style={{ display: 'grid', gap: 'var(--space-2)', margin: 0 }}>
          <div>
            <dt style={{ color: 'var(--color-text-muted)' }}>当前智能体</dt>
            <dd style={{ margin: 0 }}>{currentAgent || '自动选择'}</dd>
          </div>
          <div>
            <dt style={{ color: 'var(--color-text-muted)' }}>已启用智能体</dt>
            <dd style={{ margin: 0 }}>{enabledAgents.length > 0 ? enabledAgents.join('、') : '暂无'}</dd>
          </div>
        </dl>
      </Card>
    </aside>
  );
}
