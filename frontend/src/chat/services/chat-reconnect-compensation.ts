export interface TimelineRowLike {
  seq?: number | null;
}

export interface TimelineRefreshState {
  state: string;
  inFlight: boolean;
  pending: boolean;
  preferIncremental: boolean;
}

export interface ReconnectCompensationContext<TTimelineRow extends TimelineRowLike = TimelineRowLike> {
  timelineRows: TTimelineRow[];
  lastSeenEventSeq: number;
  activeSessionId: string | null;
  activeSessionSyncNonce: number;
  timelineRefreshState: TimelineRefreshState;
  timelineRefreshStates: {
    idle: string;
    full: string;
    incremental: string;
  };
  refreshSyncStatus: () => void;
  scheduleTimelineRefresh: () => void;
  renderMessages: (rows: TTimelineRow[]) => void;
  deriveLastSeenEventSeq: (rows: TTimelineRow[]) => number;
  refreshActiveSessionTimeline: (options?: { mode?: string }) => Promise<unknown>;
  fetchImpl: typeof fetch;
}

export function deriveTimelineTailSeq<TTimelineRow extends TimelineRowLike>(rows: TTimelineRow[]): number {
  return rows.reduce((maxSeq, row) => Math.max(maxSeq, Number(row?.seq) || 0), 0);
}

export function shouldFallbackToFullRefresh(options: {
  targetSessionId: string;
  activeSessionId: string | null;
  activeSyncNonce: number;
  currentSyncNonce: number;
  afterSeqCursor: number;
  incrementalTimeline: TimelineRowLike[];
  renderedTailSeq: number;
}): boolean {
  if (options.targetSessionId !== options.activeSessionId) {
    return false;
  }

  if (options.activeSyncNonce !== options.currentSyncNonce) {
    return false;
  }

  if (!Array.isArray(options.incrementalTimeline) || options.incrementalTimeline.length === 0) {
    return false;
  }

  const firstSeq = Number(options.incrementalTimeline[0]?.seq) || 0;
  if (firstSeq > (options.afterSeqCursor + 1)) {
    return true;
  }

  const renderedSeq = Number(options.renderedTailSeq) || 0;
  return renderedSeq > options.afterSeqCursor && firstSeq > (renderedSeq + 1);
}

export async function runReconnectCompensation<TTimelineRow extends TimelineRowLike>(
  context: ReconnectCompensationContext<TTimelineRow>,
  options: {
    targetSessionId: string;
    activeSyncNonce: number;
    afterSeqCursor: number;
  }
): Promise<void> {
  const {
    timelineRefreshState,
    timelineRefreshStates,
    activeSessionId,
    activeSessionSyncNonce,
    fetchImpl
  } = context;

  context.refreshSyncStatus();

  if (timelineRefreshState.inFlight) {
    timelineRefreshState.pending = true;
    return;
  }

  timelineRefreshState.state = timelineRefreshStates.incremental;
  timelineRefreshState.inFlight = true;
  timelineRefreshState.pending = false;

  try {
    const response = await fetchImpl(
      `/api/sessions/${encodeURIComponent(options.targetSessionId)}/timeline?afterSeq=${encodeURIComponent(String(options.afterSeqCursor))}`
    );

    if (!response.ok) {
      timelineRefreshState.preferIncremental = false;
      await context.refreshActiveSessionTimeline({ mode: timelineRefreshStates.full });
      return;
    }

    const body = await response.json() as { timeline?: TTimelineRow[] };
    const incrementalTimeline = Array.isArray(body.timeline) ? body.timeline : [];
    const renderedTailSeq = deriveTimelineTailSeq(context.timelineRows);

    if (shouldFallbackToFullRefresh({
      targetSessionId: options.targetSessionId,
      activeSessionId,
      activeSyncNonce: options.activeSyncNonce,
      currentSyncNonce: activeSessionSyncNonce,
      afterSeqCursor: options.afterSeqCursor,
      incrementalTimeline,
      renderedTailSeq
    })) {
      timelineRefreshState.preferIncremental = false;
      timelineRefreshState.inFlight = false;
      timelineRefreshState.state = timelineRefreshStates.idle;
      await context.refreshActiveSessionTimeline({ mode: timelineRefreshStates.full });
      return;
    }

    if (incrementalTimeline.length > 0) {
      context.timelineRows = [...context.timelineRows, ...incrementalTimeline];
      context.renderMessages(context.timelineRows);
      context.lastSeenEventSeq = context.deriveLastSeenEventSeq(context.timelineRows);
    }
  } catch {
    timelineRefreshState.preferIncremental = false;
    await context.refreshActiveSessionTimeline({ mode: timelineRefreshStates.full });
  } finally {
    timelineRefreshState.inFlight = false;
    if (timelineRefreshState.state === timelineRefreshStates.incremental) {
      timelineRefreshState.state = timelineRefreshStates.idle;
    }
    if (timelineRefreshState.pending) {
      timelineRefreshState.pending = false;
      context.scheduleTimelineRefresh();
    }
  }
}
