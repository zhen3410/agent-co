import { buildInvocationLaneKey, InvocationLaneStateSnapshot, InvocationLaneTaskSnapshot } from '../domain/invocation-lane';
import { SessionEventEnvelope } from '../domain/session-events';

export interface ChatInvocationLaneState {
  applyEvent(event: SessionEventEnvelope): void;
  getLane(laneKey: string): InvocationLaneStateSnapshot | null;
  getLaneBySessionAgent(sessionId: string, agentName: string): InvocationLaneStateSnapshot | null;
  getTask(queueTaskId: string): InvocationLaneTaskSnapshot | null;
  listLanes(sessionId: string): InvocationLaneStateSnapshot[];
}

function cloneLane(lane: InvocationLaneStateSnapshot | null): InvocationLaneStateSnapshot | null {
  return lane ? { ...lane, queuedTaskIds: [...lane.queuedTaskIds] } : null;
}

function cloneTask(task: InvocationLaneTaskSnapshot | null): InvocationLaneTaskSnapshot | null {
  return task ? { ...task } : null;
}

export function createChatInvocationLaneState(): ChatInvocationLaneState {
  const lanes = new Map<string, InvocationLaneStateSnapshot>();
  const tasks = new Map<string, InvocationLaneTaskSnapshot>();
  const sessionLaneKeys = new Map<string, Set<string>>();

  function ensureLane(sessionId: string, laneKey: string, agentName: string, updatedAt: number): InvocationLaneStateSnapshot {
    let lane = lanes.get(laneKey);
    if (!lane) {
      lane = {
        laneKey,
        sessionId,
        agentName,
        runningTaskId: null,
        queuedTaskIds: [],
        version: 0,
        updatedAt
      };
      lanes.set(laneKey, lane);
      const keys = sessionLaneKeys.get(sessionId) || new Set<string>();
      keys.add(laneKey);
      sessionLaneKeys.set(sessionId, keys);
    }
    lane.updatedAt = updatedAt;
    lane.version += 1;
    return lane;
  }

  function applyEvent(event: SessionEventEnvelope): void {
    const payload = event.payload || {};
    const queueTaskId = typeof payload.queueTaskId === 'string' ? payload.queueTaskId : null;
    const agentName = typeof payload.agentName === 'string' ? payload.agentName : null;
    const laneKey = typeof payload.laneKey === 'string'
      ? payload.laneKey
      : queueTaskId && agentName
        ? buildInvocationLaneKey(event.sessionId, agentName)
        : null;
    const timestamp = Date.parse(event.createdAt || '') || Date.now();

    if (!queueTaskId || !laneKey || !agentName) {
      return;
    }

    if (event.eventType === 'agent_invocation_enqueued') {
      const lane = ensureLane(event.sessionId, laneKey, agentName, timestamp);
      if (!tasks.has(queueTaskId)) {
        tasks.set(queueTaskId, {
          queueTaskId,
          laneKey,
          sessionId: event.sessionId,
          agentName,
          taskId: typeof payload.taskId === 'string' ? payload.taskId : undefined,
          dispatchKind: typeof payload.dispatchKind === 'string' ? payload.dispatchKind : undefined,
          callerAgentName: typeof payload.callerAgentName === 'string' ? payload.callerAgentName : undefined,
          calleeAgentName: typeof payload.calleeAgentName === 'string' ? payload.calleeAgentName : undefined,
          status: 'queued',
          aheadCount: Number.isFinite(Number(payload.aheadCount)) ? Number(payload.aheadCount) : lane.queuedTaskIds.length,
          queuedAt: timestamp
        });
        lane.queuedTaskIds.push(queueTaskId);
      }
      return;
    }

    const lane = ensureLane(event.sessionId, laneKey, agentName, timestamp);
    const task = tasks.get(queueTaskId);
    if (!task) {
      return;
    }

    if (event.eventType === 'agent_invocation_started') {
      task.status = 'running';
      task.executionId = typeof payload.executionId === 'string' ? payload.executionId : task.executionId;
      task.startedAt = timestamp;
      lane.queuedTaskIds = lane.queuedTaskIds.filter(id => id !== queueTaskId);
      lane.runningTaskId = queueTaskId;
      return;
    }

    if (event.eventType === 'agent_invocation_completed' || event.eventType === 'agent_invocation_failed' || event.eventType === 'agent_invocation_cancelled') {
      task.status = event.eventType === 'agent_invocation_completed'
        ? 'completed'
        : event.eventType === 'agent_invocation_failed'
          ? 'failed'
          : 'cancelled';
      task.finishedAt = timestamp;
      task.error = typeof payload.error === 'string' ? payload.error : task.error;
      lane.queuedTaskIds = lane.queuedTaskIds.filter(id => id !== queueTaskId);
      if (lane.runningTaskId === queueTaskId) {
        lane.runningTaskId = null;
      }
    }
  }

  return {
    applyEvent,
    getLane(laneKey: string) {
      return cloneLane(lanes.get(laneKey) || null);
    },
    getLaneBySessionAgent(sessionId: string, agentName: string) {
      return cloneLane(lanes.get(buildInvocationLaneKey(sessionId, agentName)) || null);
    },
    getTask(queueTaskId: string) {
      return cloneTask(tasks.get(queueTaskId) || null);
    },
    listLanes(sessionId: string) {
      return Array.from(sessionLaneKeys.get(sessionId) || []).map(key => cloneLane(lanes.get(key) || null)).filter(Boolean) as InvocationLaneStateSnapshot[];
    }
  };
}
