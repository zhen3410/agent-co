import { InvocationReviewAction, InvocationTask, InvocationTaskStatus } from '../../types';

const VALID_INVOCATION_TASK_STATUSES = new Set<InvocationTaskStatus>([
  'pending_reply',
  'awaiting_caller_review',
  'completed',
  'failed',
  'timed_out'
]);

const VALID_INVOCATION_REVIEW_ACTIONS = new Set<InvocationReviewAction>([
  'accept',
  'follow_up',
  'retry'
]);

export const TIMEOUT_ELIGIBLE_INVOCATION_TASK_STATUSES = new Set<InvocationTaskStatus>([
  'pending_reply'
]);

function normalizeInvocationTaskStatus(value: unknown): InvocationTaskStatus {
  if (typeof value === 'string' && VALID_INVOCATION_TASK_STATUSES.has(value as InvocationTaskStatus)) {
    return value as InvocationTaskStatus;
  }
  return 'pending_reply';
}

function normalizeInvocationReviewAction(value: unknown): InvocationReviewAction | undefined {
  if (typeof value === 'string' && VALID_INVOCATION_REVIEW_ACTIONS.has(value as InvocationReviewAction)) {
    return value as InvocationReviewAction;
  }
  return undefined;
}

export function normalizeInvocationTaskRecord(rawTask: unknown, sessionId: string): InvocationTask | null {
  if (!rawTask || typeof rawTask !== 'object' || Array.isArray(rawTask)) {
    return null;
  }

  const task = rawTask as Partial<InvocationTask>;
  if (typeof task.id !== 'string' || !task.id.trim()) return null;
  if (typeof task.callerAgentName !== 'string' || !task.callerAgentName.trim()) return null;
  if (typeof task.calleeAgentName !== 'string' || !task.calleeAgentName.trim()) return null;
  if (typeof task.prompt !== 'string') return null;
  if (typeof task.originalPrompt !== 'undefined' && typeof task.originalPrompt !== 'string') return null;

  const createdAt = Number(task.createdAt);
  const updatedAt = Number(task.updatedAt);
  const normalizedCreatedAt = Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now();
  const normalizedUpdatedAt = Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : normalizedCreatedAt;
  const deadlineAt = Number(task.deadlineAt);
  const retryCount = Number(task.retryCount);
  const followupCount = Number(task.followupCount);

  return {
    id: task.id,
    sessionId,
    status: normalizeInvocationTaskStatus(task.status),
    callerAgentName: task.callerAgentName,
    calleeAgentName: task.calleeAgentName,
    prompt: task.prompt,
    originalPrompt: typeof task.originalPrompt === 'string' ? task.originalPrompt : task.prompt,
    createdAt: normalizedCreatedAt,
    updatedAt: normalizedUpdatedAt,
    deadlineAt: Number.isFinite(deadlineAt) && deadlineAt > 0 ? deadlineAt : undefined,
    retryCount: Number.isFinite(retryCount) && retryCount >= 0 ? Math.floor(retryCount) : 0,
    followupCount: Number.isFinite(followupCount) && followupCount >= 0 ? Math.floor(followupCount) : 0,
    parentTaskId: typeof task.parentTaskId === 'string' && task.parentTaskId.trim() ? task.parentTaskId : undefined,
    reviewAction: normalizeInvocationReviewAction(task.reviewAction),
    lastReplyMessageId: typeof task.lastReplyMessageId === 'string' && task.lastReplyMessageId.trim() ? task.lastReplyMessageId : undefined,
    completedAt: Number.isFinite(Number(task.completedAt)) ? Number(task.completedAt) : undefined,
    failedAt: Number.isFinite(Number(task.failedAt)) ? Number(task.failedAt) : undefined,
    timedOutAt: Number.isFinite(Number(task.timedOutAt)) ? Number(task.timedOutAt) : undefined,
    failureReason: typeof task.failureReason === 'string' ? task.failureReason : undefined
  };
}
