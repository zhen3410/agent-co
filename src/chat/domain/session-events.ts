import { randomBytes } from 'node:crypto';

export const SESSION_EVENT_TYPES = [
  'session_created',
  'session_metadata_updated',
  'session_closed',
  'user_message_created',
  'user_message_updated',
  'agent_message_created',
  'agent_message_updated',
  'message_thinking_started',
  'message_thinking_finished',
  'message_thinking_cancelled',
  'dispatch_task_created',
  'dispatch_task_completed',
  'agent_review_requested',
  'agent_review_submitted',
  'agent_invocation_enqueued',
  'agent_invocation_started',
  'agent_invocation_completed',
  'agent_invocation_failed',
  'agent_invocation_cancelled',
  'invocation_lane_drained',
] as const;

export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number];

export const SESSION_EVENT_ACTOR_TYPES = ['user', 'agent', 'system'] as const;
export type SessionEventActorType = (typeof SESSION_EVENT_ACTOR_TYPES)[number];

export interface SessionEventCorrelation {
  correlationId?: string;
  causationId?: string;
  causedByEventId?: string;
  causedBySeq?: number;
}

export interface SessionEventEnvelope extends SessionEventCorrelation {
  sessionId: string;
  seq: number;
  eventId: string;
  eventType: SessionEventType;
  actorType: SessionEventActorType;
  actorId?: string;
  actorName?: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, string | number>;
  createdAt: string;
}

export interface SessionEventDraft extends SessionEventCorrelation {
  sessionId: string;
  seq: number;
  eventType: SessionEventType;
  actorType: SessionEventActorType;
  actorId?: string;
  actorName?: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, string | number>;
  eventId?: string;
  createdAt?: string;
}

const VISIBLE_EVENT_TYPES: ReadonlySet<SessionEventType> = new Set([
  'user_message_created',
  'user_message_updated',
  'agent_message_created',
  'agent_message_updated',
]);

function generateEventId(sessionId: string, seq: number): string {
  const suffix = randomBytes(4).toString('hex');
  return `${sessionId}:${seq}:${suffix}`;
}

function assertIsSessionEventType(value: string): asserts value is SessionEventType {
  if (!SESSION_EVENT_TYPES.includes(value as SessionEventType)) {
    throw new Error(`Unsupported eventType: ${value}`);
  }
}

function assertIsActorType(value: string): asserts value is SessionEventActorType {
  if (!SESSION_EVENT_ACTOR_TYPES.includes(value as SessionEventActorType)) {
    throw new Error(`Unsupported actorType: ${value}`);
  }
}

export function createSessionEvent(draft: SessionEventDraft): SessionEventEnvelope {
  if (!draft.sessionId) {
    throw new Error('sessionId is required');
  }

  if (!Number.isInteger(draft.seq) || draft.seq < 0) {
    throw new Error('seq must be a non-negative integer');
  }

  assertIsSessionEventType(draft.eventType);
  assertIsActorType(draft.actorType);

  const createdAt = draft.createdAt ?? new Date().toISOString();
  const payload = draft.payload ? { ...draft.payload } : {};

  return {
    sessionId: draft.sessionId,
    seq: draft.seq,
    eventId: draft.eventId ?? generateEventId(draft.sessionId, draft.seq),
    eventType: draft.eventType,
    actorType: draft.actorType,
    actorId: draft.actorId,
    actorName: draft.actorName,
    payload,
    metadata: draft.metadata,
    createdAt,
    correlationId: draft.correlationId,
    causationId: draft.causationId,
    causedByEventId: draft.causedByEventId,
    causedBySeq: draft.causedBySeq,
  };
}

export function isSessionEventType(value: string): value is SessionEventType {
  return SESSION_EVENT_TYPES.includes(value as SessionEventType);
}

export function isVisibleTimelineEvent(event: SessionEventEnvelope): boolean {
  return VISIBLE_EVENT_TYPES.has(event.eventType);
}
