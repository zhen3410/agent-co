import { useMemo } from 'react';
import { createHttpClient } from '../../../shared/lib/http/http-client';
import { EmptyState, ErrorState, Spinner } from '../../../shared/ui';
import { getMergedRuntimeConfig } from '../../../shared/config/runtime-config';
import { useSessionPanelResource } from '../shared/useSessionPanelResource';

interface SessionSyncStatus {
  latestEventSeq: number;
  latestTimelineSeq: number | null;
  timelineRowCount: number;
  discussionState: string;
}

export interface RuntimeStatusBadgeProps {
  sessionId?: string | null;
  refreshSignal?: number;
  fetch?: typeof fetch;
}

function normalizeSyncStatus(payload: unknown): SessionSyncStatus {
  const source = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};

  const latestEventSeq = typeof source.latestEventSeq === 'number' && Number.isFinite(source.latestEventSeq)
    ? source.latestEventSeq
    : 0;

  const latestTimelineSeq = typeof source.latestTimelineSeq === 'number' && Number.isFinite(source.latestTimelineSeq)
    ? source.latestTimelineSeq
    : null;

  const timelineRowCount = typeof source.timelineRowCount === 'number' && Number.isFinite(source.timelineRowCount)
    ? source.timelineRowCount
    : 0;

  const discussionState = typeof source.discussionState === 'string' && source.discussionState
    ? source.discussionState
    : 'unknown';

  return {
    latestEventSeq,
    latestTimelineSeq,
    timelineRowCount,
    discussionState
  };
}

function toDiscussionStateLabel(state: string): string {
  if (state === 'active') {
    return '讨论中';
  }
  if (state === 'paused') {
    return '已暂停';
  }
  return state;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return '加载运行状态失败';
}

function useRuntimeStatus(_sessionId: string | null | undefined, fetchImpl?: typeof fetch) {
  const runtimeConfig = getMergedRuntimeConfig();
  const baseUrl = typeof runtimeConfig.apiBaseUrl === 'string' ? runtimeConfig.apiBaseUrl : undefined;
  const client = useMemo(() => {
    return createHttpClient({
      baseUrl,
      fetch: fetchImpl
    });
  }, [baseUrl, fetchImpl]);
  return client;
}

export function RuntimeStatusBadge({ sessionId = null, refreshSignal = 0, fetch }: RuntimeStatusBadgeProps) {
  const client = useRuntimeStatus(sessionId, fetch);
  const runtimeStatus = useSessionPanelResource<SessionSyncStatus | null>({
    sessionId,
    refreshSignal,
    initialData: null,
    load: (targetSessionId, signal) => {
      return client.request(`/api/sessions/${encodeURIComponent(targetSessionId)}/sync-status`, {
        credentials: 'include',
        cache: 'no-store',
        signal
      }).then((payload) => normalizeSyncStatus(payload));
    },
    normalizeErrorMessage
  });

  return (
    <section
      aria-label="运行状态"
      style={{
        background: 'rgba(248, 250, 252, 0.8)',
        border: '1px solid rgba(148, 163, 184, 0.16)',
        borderRadius: 'calc(var(--radius-lg) + 2px)',
        display: 'grid',
        gap: 'var(--space-3)',
        padding: 'var(--space-4)'
      }}
    >
      <header>
        <strong style={{ color: 'var(--color-text)' }}>运行状态</strong>
      </header>

      <section data-chat-runtime-status="badge" style={{ display: 'grid', gap: 'var(--space-3)' }}>
        {!sessionId ? (
          <EmptyState
            title="未选择会话"
            description=""
          />
        ) : null}

        {sessionId && runtimeStatus.loadState === 'loading' && !runtimeStatus.data ? (
          <Spinner label="正在加载同步状态…" />
        ) : null}

        {sessionId && runtimeStatus.loadState === 'error' ? (
          <ErrorState
            title="运行状态加载失败"
            message={runtimeStatus.errorMessage || '未知错误'}
          />
        ) : null}

        {sessionId && runtimeStatus.loadState === 'ready' && runtimeStatus.data ? (
          <dl style={{ display: 'grid', gap: 'var(--space-2)', margin: 0 }}>
            <div>
              <dt style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>最新事件序号</dt>
              <dd style={{ margin: 'var(--space-1) 0 0' }}>{runtimeStatus.data.latestEventSeq}</dd>
            </div>
            <div>
              <dt style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>最新时间线序号</dt>
              <dd style={{ margin: 'var(--space-1) 0 0' }}>{runtimeStatus.data.latestTimelineSeq ?? '未生成'}</dd>
            </div>
            <div>
              <dt style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>时间线条目数</dt>
              <dd style={{ margin: 'var(--space-1) 0 0' }}>{runtimeStatus.data.timelineRowCount}</dd>
            </div>
            <div>
              <dt style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>讨论状态</dt>
              <dd style={{ margin: 'var(--space-1) 0 0' }}>{toDiscussionStateLabel(runtimeStatus.data.discussionState)}</dd>
            </div>
          </dl>
        ) : null}
      </section>
    </section>
  );
}
