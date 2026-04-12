function deriveTimelineTailSeq(rows = timelineRows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }
  const tailSeq = Number(rows[rows.length - 1] && rows[rows.length - 1].seq);
  if (!Number.isSafeInteger(tailSeq) || tailSeq < 0) {
    return null;
  }
  return tailSeq;
}

function shouldFallbackToFullRefresh({ targetSessionId, activeSyncNonce, afterSeqCursor, incrementalTimeline, renderedTailSeq }) {
  if (targetSessionId !== activeSessionId || activeSyncNonce !== activeSessionSyncNonce) {
    return true;
  }

  if (!Array.isArray(incrementalTimeline)) {
    return true;
  }

  if (incrementalTimeline.length === 0) {
    return false;
  }

  const firstSeq = Number(incrementalTimeline[0] && incrementalTimeline[0].seq);
  if (!Number.isSafeInteger(firstSeq) || firstSeq < 0) {
    return true;
  }
  if (Number.isSafeInteger(afterSeqCursor) && firstSeq > (afterSeqCursor + 1)) {
    return true;
  }

  return incrementalTimeline.some((row) => {
    const rowSeq = Number(row && row.seq);
    if (!Number.isSafeInteger(rowSeq) || rowSeq < 0) {
      return true;
    }
    if (Number.isSafeInteger(afterSeqCursor) && rowSeq <= afterSeqCursor) {
      return true;
    }
    if (Number.isSafeInteger(renderedTailSeq) && rowSeq <= renderedTailSeq) {
      return true;
    }
    return false;
  });
}

async function runReconnectCompensation({ targetSessionId, activeSyncNonce, afterSeqCursor }) {
  if (!targetSessionId || targetSessionId !== activeSessionId || activeSyncNonce !== activeSessionSyncNonce) {
    return false;
  }
  if (timelineRefreshState.inFlight) {
    markRefreshPending();
    return false;
  }

  timelineRefreshState.state = TIMELINE_REFRESH_STATES.incremental;
  timelineRefreshState.inFlight = true;
  timelineRefreshState.pending = false;
  refreshSyncStatus();

  try {
    const incrementalResponse = await fetch(
      `/api/sessions/${encodeURIComponent(targetSessionId)}/timeline?afterSeq=${encodeURIComponent(afterSeqCursor)}`,
      {
        credentials: 'include',
        cache: 'no-store'
      }
    );
    const data = await incrementalResponse.json().catch(() => ({}));
    if (!incrementalResponse.ok) {
      throw new Error(data.error || '加载时间线失败');
    }

    const incrementalTimeline = Array.isArray(data.timeline) ? data.timeline : [];
    const renderedTailSeq = deriveTimelineTailSeq(timelineRows);
    if (shouldFallbackToFullRefresh({
      targetSessionId,
      activeSyncNonce,
      afterSeqCursor,
      incrementalTimeline,
      renderedTailSeq
    })) {
      timelineRefreshState.preferIncremental = false;
      timelineRefreshState.inFlight = false;
      timelineRefreshState.state = TIMELINE_REFRESH_STATES.idle;
      return refreshActiveSessionTimeline({ ensureSocket: false, mode: TIMELINE_REFRESH_STATES.full });
    }

    if (targetSessionId !== activeSessionId || activeSyncNonce !== activeSessionSyncNonce) {
      return false;
    }

    if (incrementalTimeline.length > 0) {
      timelineRows = timelineRows.concat(incrementalTimeline);
      lastSeenEventSeq = deriveLastSeenEventSeq(timelineRows);
      renderMessages();
    }
    timelineRefreshState.preferIncremental = false;
    clearStatusNotice();
    return true;
  } catch (error) {
    console.error('增量补偿失败，回退全量时间线:', error);
    timelineRefreshState.preferIncremental = false;
    timelineRefreshState.inFlight = false;
    timelineRefreshState.state = TIMELINE_REFRESH_STATES.idle;
    return refreshActiveSessionTimeline({ ensureSocket: false, mode: TIMELINE_REFRESH_STATES.full });
  } finally {
    timelineRefreshState.inFlight = false;
    if (timelineRefreshState.state === TIMELINE_REFRESH_STATES.incremental) {
      timelineRefreshState.state = TIMELINE_REFRESH_STATES.idle;
    }
    if (timelineRefreshState.pending) {
      timelineRefreshState.pending = false;
      scheduleTimelineRefresh({ immediate: true });
    }
    refreshSyncStatus();
  }
}
