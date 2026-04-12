import { AgentDispatchKind, InvocationReviewAction, Message } from '../../types';
import {
  SessionEventActorType,
  SessionEventEnvelope,
  SessionEventType,
} from '../domain/session-events';

export type ChatTimelineRowKind = 'message' | 'thinking' | 'dispatch' | 'review';

type OptionalEventPayload = Record<string, unknown> | undefined;

type ThinkingStatus = 'started' | 'finished' | 'cancelled';
type DispatchStatus = 'created' | 'completed';
type ReviewStatus = 'requested' | 'submitted';

export interface ChatTimelineRowBase {
  id: string;
  seq: number;
  eventType: SessionEventType;
  actorType: SessionEventActorType;
  actorName?: string;
  createdAt: string;
  metadata?: Record<string, string | number>;
  payload?: OptionalEventPayload;
  correlationId?: string;
  causationId?: string;
  causedByEventId?: string;
  causedBySeq?: number;
  groupId: string;
}

export interface ChatTimelineMessageRow extends ChatTimelineRowBase {
  kind: 'message';
  messageId: string;
  message: Message;
  isUpdate: boolean;
}

export interface ChatTimelineThinkingRow extends ChatTimelineRowBase {
  kind: 'thinking';
  status: ThinkingStatus;
  taskId?: string;
  messageId?: string;
}

export interface ChatTimelineDispatchRow extends ChatTimelineRowBase {
  kind: 'dispatch';
  status: DispatchStatus;
  taskId?: string;
  dispatchKind?: AgentDispatchKind;
  callerAgentName?: string;
  calleeAgentName?: string;
}

export interface ChatTimelineReviewRow extends ChatTimelineRowBase {
  kind: 'review';
  status: ReviewStatus;
  taskId?: string;
  reviewAction?: InvocationReviewAction;
  reviewRawText?: string;
  reviewDisplayText?: string;
  callerAgentName?: string;
  calleeAgentName?: string;
}

export type ChatTimelineRow =
  | ChatTimelineMessageRow
  | ChatTimelineThinkingRow
  | ChatTimelineDispatchRow
  | ChatTimelineReviewRow;

const MESSAGE_EVENT_TYPES = new Set<SessionEventType>([
  'user_message_created',
  'agent_message_created',
  'user_message_updated',
  'agent_message_updated',
]);

const THINKING_STATUS_MAP: Partial<Record<SessionEventType, ThinkingStatus>> = {
  message_thinking_started: 'started',
  message_thinking_finished: 'finished',
  message_thinking_cancelled: 'cancelled',
};

const DISPATCH_STATUS_MAP: Partial<Record<SessionEventType, DispatchStatus>> = {
  dispatch_task_created: 'created',
  dispatch_task_completed: 'completed',
};

const REVIEW_STATUS_MAP: Partial<Record<SessionEventType, ReviewStatus>> = {
  agent_review_requested: 'requested',
  agent_review_submitted: 'submitted',
};

export function projectChatTimeline(events: SessionEventEnvelope[]): ChatTimelineRow[] {
  const sortedEvents = [...events].sort((a, b) => {
    if (a.seq !== b.seq) return a.seq - b.seq;
    return a.eventId.localeCompare(b.eventId);
  });

  const timeline: ChatTimelineRow[] = [];
  for (const event of sortedEvents) {
    const row = mapEventToRow(event);
    if (row) {
      timeline.push(row);
    }
  }

  return timeline;
}

export function filterTimelineRowsAfterSeq(
  timeline: ChatTimelineRow[],
  afterSeq?: number
): ChatTimelineRow[] {
  if (typeof afterSeq !== 'number') {
    return timeline;
  }
  return timeline.filter(row => row.seq > afterSeq);
}

function mapEventToRow(event: SessionEventEnvelope): ChatTimelineRow | null {
  if (MESSAGE_EVENT_TYPES.has(event.eventType)) {
    return buildMessageRow(event);
  }

  const thinkingStatus = THINKING_STATUS_MAP[event.eventType];
  if (thinkingStatus) {
    return buildThinkingRow(event, thinkingStatus);
  }

  const dispatchStatus = DISPATCH_STATUS_MAP[event.eventType];
  if (dispatchStatus) {
    return buildDispatchRow(event, dispatchStatus);
  }

  const reviewStatus = REVIEW_STATUS_MAP[event.eventType];
  if (reviewStatus) {
    return buildReviewRow(event, reviewStatus);
  }

  return null;
}

function buildMessageRow(event: SessionEventEnvelope): ChatTimelineMessageRow | null {
  const message = extractMessage(event.payload);
  if (!message || !message.id) return null;

  return {
    ...buildRowBase(event),
    kind: 'message',
    messageId: message.id,
    message,
    isUpdate: event.eventType === 'agent_message_updated' || event.eventType === 'user_message_updated',
  };
}

function buildThinkingRow(event: SessionEventEnvelope, status: ThinkingStatus): ChatTimelineThinkingRow {
  const payload = event.payload;

  return {
    ...buildRowBase(event),
    kind: 'thinking',
    status,
    taskId: readString(payload, 'taskId'),
    messageId: readString(payload, 'messageId'),
  };
}

function buildDispatchRow(event: SessionEventEnvelope, status: DispatchStatus): ChatTimelineDispatchRow {
  const payload = event.payload;

  return {
    ...buildRowBase(event),
    kind: 'dispatch',
    status,
    taskId: readString(payload, 'taskId'),
    dispatchKind: readString(payload, 'dispatchKind') as AgentDispatchKind | undefined,
    callerAgentName: readString(payload, 'callerAgentName'),
    calleeAgentName: readString(payload, 'calleeAgentName'),
  };
}

function buildReviewRow(event: SessionEventEnvelope, status: ReviewStatus): ChatTimelineReviewRow {
  const payload = event.payload;

  return {
    ...buildRowBase(event),
    kind: 'review',
    status,
    taskId: readString(payload, 'taskId'),
    reviewAction: readString(payload, 'reviewAction') as InvocationReviewAction | undefined,
    reviewRawText: readString(payload, 'reviewRawText'),
    reviewDisplayText: readString(payload, 'reviewDisplayText'),
    callerAgentName: readString(payload, 'callerAgentName'),
    calleeAgentName: readString(payload, 'calleeAgentName'),
  };
}

function buildRowBase(event: SessionEventEnvelope): ChatTimelineRowBase {
  return {
    id: event.eventId,
    seq: event.seq,
    eventType: event.eventType,
    actorType: event.actorType,
    actorName: event.actorName ?? undefined,
    createdAt: event.createdAt,
    metadata: event.metadata,
    payload: event.payload,
    correlationId: event.correlationId,
    causationId: event.causationId,
    causedByEventId: event.causedByEventId,
    causedBySeq: event.causedBySeq,
    groupId: deriveGroupId(event),
  };
}

function deriveGroupId(event: SessionEventEnvelope): string {
  return (
    event.correlationId ||
    event.causationId ||
    event.causedByEventId ||
    event.eventType
  );
}

function extractMessage(payload: OptionalEventPayload): Message | undefined {
  if (!payload) return undefined;
  const candidate = payload.message;
  if (candidate && typeof candidate === 'object') {
    return candidate as Message;
  }
  return undefined;
}

function readString(payload: OptionalEventPayload, key: string): string | undefined {
  if (!payload) return undefined;
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}
