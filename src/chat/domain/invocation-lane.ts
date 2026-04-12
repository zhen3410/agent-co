export type InvocationLaneTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface InvocationLaneTaskSnapshot {
  queueTaskId: string;
  laneKey: string;
  sessionId: string;
  agentName: string;
  taskId?: string;
  dispatchKind?: string;
  callerAgentName?: string;
  calleeAgentName?: string;
  status: InvocationLaneTaskStatus;
  aheadCount: number;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  executionId?: string;
  error?: string;
}

export interface InvocationLaneStateSnapshot {
  laneKey: string;
  sessionId: string;
  agentName: string;
  runningTaskId: string | null;
  queuedTaskIds: string[];
  version: number;
  updatedAt: number;
}

export function buildInvocationLaneKey(sessionId: string, agentName: string): string {
  return `${sessionId}::${agentName}`;
}
