import { useMemo } from 'react';
import { createHttpClient } from '../../../shared/lib/http/http-client';
import { EmptyState, ErrorState, Spinner } from '../../../shared/ui';
import { getMergedRuntimeConfig } from '../../../shared/config/runtime-config';
import { useSessionPanelResource } from '../shared/useSessionPanelResource';

type TimelineRowKind = 'message' | 'thinking' | 'dispatch' | 'review';

interface TimelineMessagePayload {
  id?: string;
  sender?: string;
  text?: string;
}

interface TimelineRow {
  id: string;
  seq: number;
  kind: TimelineRowKind;
  status?: string;
  actorName?: string;
  callerAgentName?: string;
  calleeAgentName?: string;
  reviewDisplayText?: string;
  message?: TimelineMessagePayload;
}

export interface TimelinePanelProps {
  sessionId?: string | null;
  refreshSignal?: number;
  fetch?: typeof fetch;
}

function normalizeTimelineRows(payload: unknown): TimelineRow[] {
  const source = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const timeline = Array.isArray(source.timeline) ? source.timeline : [];

  return timeline
    .filter((row) => row && typeof row === 'object')
    .map((row, index) => {
      const sourceRow = row as Record<string, unknown>;
      const message = sourceRow.message && typeof sourceRow.message === 'object'
        ? sourceRow.message as Record<string, unknown>
        : null;

      const rowId = typeof sourceRow.id === 'string' && sourceRow.id
        ? sourceRow.id
        : `timeline-${index}`;

      const seq = typeof sourceRow.seq === 'number' && Number.isFinite(sourceRow.seq)
        ? sourceRow.seq
        : index;

      const kind = sourceRow.kind === 'thinking' || sourceRow.kind === 'dispatch' || sourceRow.kind === 'review'
        ? sourceRow.kind
        : 'message';

      return {
        id: rowId,
        seq,
        kind,
        status: typeof sourceRow.status === 'string' ? sourceRow.status : undefined,
        actorName: typeof sourceRow.actorName === 'string' ? sourceRow.actorName : undefined,
        callerAgentName: typeof sourceRow.callerAgentName === 'string' ? sourceRow.callerAgentName : undefined,
        calleeAgentName: typeof sourceRow.calleeAgentName === 'string' ? sourceRow.calleeAgentName : undefined,
        reviewDisplayText: typeof sourceRow.reviewDisplayText === 'string' ? sourceRow.reviewDisplayText : undefined,
        message: message ? {
          id: typeof message.id === 'string' ? message.id : undefined,
          sender: typeof message.sender === 'string' ? message.sender : undefined,
          text: typeof message.text === 'string' ? message.text : undefined
        } : undefined
      };
    });
}

function describeTimelineRow(row: TimelineRow): string {
  if (row.kind === 'thinking') {
    if (row.status === 'started') {
      return `${row.actorName || '系统'} 开始思考`;
    }
    if (row.status === 'finished') {
      return `${row.actorName || '系统'} 思考完成`;
    }
    return `${row.actorName || '系统'} 思考取消`;
  }

  if (row.kind === 'dispatch') {
    const caller = row.callerAgentName || row.actorName || '系统';
    const callee = row.calleeAgentName || '未知智能体';
    const statusText = row.status === 'completed' ? '已完成' : '已创建';
    return `${caller} → ${callee}（${statusText}）`;
  }

  if (row.kind === 'review') {
    return row.reviewDisplayText || `${row.actorName || '系统'} 评审更新`;
  }

  const sender = row.message?.sender || row.actorName || '消息';
  const text = row.message?.text || '';
  return `${sender}${text ? `: ${text}` : ''}`;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return '加载时间线失败';
}

function useTimelineRows(_sessionId: string | null | undefined, fetchImpl?: typeof fetch) {
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

export function TimelinePanel({ sessionId = null, refreshSignal = 0, fetch }: TimelinePanelProps) {
  const client = useTimelineRows(sessionId, fetch);
  const timeline = useSessionPanelResource<TimelineRow[]>({
    sessionId,
    refreshSignal,
    initialData: [],
    load: (targetSessionId, signal) => {
      return client.request(`/api/sessions/${encodeURIComponent(targetSessionId)}/timeline`, {
        credentials: 'include',
        cache: 'no-store',
        signal
      }).then((payload) => normalizeTimelineRows(payload));
    },
    normalizeErrorMessage
  });

  return (
    <section
      aria-label="会话时间线"
      style={{
        background: 'rgba(248, 250, 252, 0.8)',
        border: '1px solid rgba(148, 163, 184, 0.16)',
        borderRadius: 'calc(var(--radius-lg) + 2px)',
        display: 'grid',
        gap: 'var(--space-3)',
        padding: 'var(--space-4)'
      }}
    >
      <header style={{ display: 'grid', gap: 'var(--space-1)' }}>
        <strong style={{ color: 'var(--color-text)' }}>会话时间线</strong>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
          用简洁事件流补充主对话，不抢占主舞台。
        </span>
      </header>

      <section data-chat-timeline-panel="timeline" style={{ display: 'grid', gap: 'var(--space-3)' }}>
        {!sessionId ? (
          <EmptyState
            title="未选择会话"
            description="请选择会话后查看时间线。"
          />
        ) : null}

        {sessionId && timeline.loadState === 'loading' && timeline.data.length === 0 ? (
          <Spinner label="正在加载时间线…" />
        ) : null}

        {sessionId && timeline.loadState === 'error' ? (
          <ErrorState
            title="时间线加载失败"
            message={timeline.errorMessage || '未知错误'}
          />
        ) : null}

        {sessionId && timeline.loadState === 'ready' && timeline.data.length === 0 ? (
          <EmptyState
            title="暂无时间线事件"
            description="当前会话还没有可展示的事件。"
          />
        ) : null}

        {sessionId && timeline.data.length > 0 ? (
          <ol style={{ display: 'grid', gap: 'var(--space-2)', margin: 0, paddingLeft: 'var(--space-4)' }}>
            {timeline.data.slice(-12).reverse().map((row) => (
              <li key={row.id} style={{ color: 'var(--color-text)' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>#{row.seq} </span>
                <span>{describeTimelineRow(row)}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </section>
    </section>
  );
}
