import { useEffect, useMemo, useState } from 'react';
import { createHttpClient } from '../../../shared/lib/http/http-client';
import { Card, EmptyState, ErrorState, Spinner } from '../../../shared/ui';
import { getMergedRuntimeConfig } from '../../../shared/config/runtime-config';
import { useSessionEventSignal } from '../shared/useSessionEventSignal';

interface SessionSyncStatus {
  latestEventSeq: number;
  latestTimelineSeq: number | null;
  timelineRowCount: number;
  discussionState: string;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface RuntimeStatusBadgeProps {
  sessionId?: string | null;
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

function useRuntimeStatus(sessionId: string | null | undefined, fetchImpl?: typeof fetch) {
  const runtimeConfig = getMergedRuntimeConfig();
  const baseUrl = typeof runtimeConfig.apiBaseUrl === 'string' ? runtimeConfig.apiBaseUrl : undefined;
  const client = useMemo(() => {
    return createHttpClient({
      baseUrl,
      fetch: fetchImpl
    });
  }, [baseUrl, fetchImpl]);
  const signal = useSessionEventSignal(sessionId);

  const [loadState, setLoadState] = useState<LoadState>(sessionId ? 'loading' : 'idle');
  const [status, setStatus] = useState<SessionSyncStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setLoadState('idle');
      setStatus(null);
      setErrorMessage(null);
      return undefined;
    }

    let cancelled = false;
    setLoadState('loading');
    setErrorMessage(null);

    client.request(`/api/sessions/${encodeURIComponent(sessionId)}/sync-status`, {
      credentials: 'include',
      cache: 'no-store'
    })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setStatus(normalizeSyncStatus(payload));
        setLoadState('ready');
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setLoadState('error');
        setErrorMessage(normalizeErrorMessage(error));
      });

    return () => {
      cancelled = true;
    };
  }, [client, sessionId, signal]);

  return {
    loadState,
    status,
    errorMessage
  };
}

export function RuntimeStatusBadge({ sessionId = null, fetch }: RuntimeStatusBadgeProps) {
  const runtimeStatus = useRuntimeStatus(sessionId, fetch);

  return (
    <Card title="运行状态">
      <section data-chat-runtime-status="badge" style={{ display: 'grid', gap: 'var(--space-3)' }}>
        {!sessionId ? (
          <EmptyState
            title="未选择会话"
            description="请选择会话后查看同步进度。"
          />
        ) : null}

        {sessionId && runtimeStatus.loadState === 'loading' && !runtimeStatus.status ? (
          <Spinner label="正在加载同步状态…" />
        ) : null}

        {sessionId && runtimeStatus.loadState === 'error' ? (
          <ErrorState
            title="运行状态加载失败"
            message={runtimeStatus.errorMessage || '未知错误'}
          />
        ) : null}

        {sessionId && runtimeStatus.loadState === 'ready' && runtimeStatus.status ? (
          <dl style={{ display: 'grid', gap: 'var(--space-2)', margin: 0 }}>
            <div>
              <dt style={{ color: 'var(--color-text-muted)' }}>最新事件序号</dt>
              <dd style={{ margin: 0 }}>{runtimeStatus.status.latestEventSeq}</dd>
            </div>
            <div>
              <dt style={{ color: 'var(--color-text-muted)' }}>最新时间线序号</dt>
              <dd style={{ margin: 0 }}>{runtimeStatus.status.latestTimelineSeq ?? '未生成'}</dd>
            </div>
            <div>
              <dt style={{ color: 'var(--color-text-muted)' }}>时间线条目数</dt>
              <dd style={{ margin: 0 }}>{runtimeStatus.status.timelineRowCount}</dd>
            </div>
            <div>
              <dt style={{ color: 'var(--color-text-muted)' }}>讨论状态</dt>
              <dd style={{ margin: 0 }}>{toDiscussionStateLabel(runtimeStatus.status.discussionState)}</dd>
            </div>
          </dl>
        ) : null}
      </section>
    </Card>
  );
}
