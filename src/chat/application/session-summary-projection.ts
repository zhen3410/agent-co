import { Message } from '../../types';
import {
  SessionEventEnvelope,
  SessionEventType,
  isVisibleTimelineEvent,
} from '../domain/session-events';

type EventPayload = Record<string, unknown> | undefined;

export type SessionSummaryStatus = 'open' | 'closed';

export interface SessionSummarySnapshot {
  sessionId: string;
  latestSeq: number;
  eventCount: number;
  visibleMessageCount: number;
  lastVisibleMessage?: Message;
  lastEventType?: SessionEventType;
  status: SessionSummaryStatus;
}

export function projectSessionSummary(
  sessionId: string,
  events: SessionEventEnvelope[]
): SessionSummarySnapshot {
  const sortedEvents = [...events].sort((a, b) => {
    if (a.seq !== b.seq) return a.seq - b.seq;
    return a.eventId.localeCompare(b.eventId);
  });

  const eventCount = sortedEvents.length;
  const lastEvent = sortedEvents[eventCount - 1];
  const status = lastEvent?.eventType === 'session_closed' ? 'closed' : 'open';

  const visibleMessageEvents = sortedEvents.filter(
    (event) => isVisibleTimelineEvent(event) && extractMessage(event.payload)
  );
  const visibleMessageCount = visibleMessageEvents.length;
  const lastVisibleMessageEvent = visibleMessageEvents[visibleMessageEvents.length - 1];
  const lastVisibleMessage =
    lastVisibleMessageEvent && extractMessage(lastVisibleMessageEvent.payload);

  return {
    sessionId,
    latestSeq: lastEvent ? lastEvent.seq : 0,
    eventCount,
    visibleMessageCount,
    lastVisibleMessage,
    lastEventType: lastEvent?.eventType,
    status,
  };
}

function extractMessage(payload: EventPayload): Message | undefined {
  if (!payload) return undefined;
  const candidate = payload.message;
  if (candidate && typeof candidate === 'object') {
    return candidate as Message;
  }
  return undefined;
}
