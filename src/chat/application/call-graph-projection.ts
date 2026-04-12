import {
  AgentDispatchKind,
  InvocationReviewAction,
  Message,
  MessageRole,
} from '../../types';
import {
  SessionEventEnvelope,
  SessionEventType,
} from '../domain/session-events';

export type CallGraphNodeKind = 'message' | 'task' | 'agent';

export interface CallGraphMessageNode {
  id: string;
  kind: 'message';
  messageId: string;
  sender: string;
  role: MessageRole;
  taskId?: string;
  label: string;
  timestamp: number;
  seq: number;
  eventId: string;
}

export interface CallGraphTaskNode {
  id: string;
  kind: 'task';
  taskId: string;
  label: string;
  dispatchKind?: AgentDispatchKind;
  metadata: {
    eventId: string;
    seq: number;
  };
}

export interface CallGraphAgentNode {
  id: string;
  kind: 'agent';
  agentName: string;
  label: string;
}

export type CallGraphNode =
  | CallGraphMessageNode
  | CallGraphTaskNode
  | CallGraphAgentNode;

export type CallGraphEdgeType = 'invoke' | 'review' | 'reply' | 'resume' | 'stop';

export interface CallGraphEdge {
  id: string;
  type: CallGraphEdgeType;
  source: string;
  target: string;
  metadata?: Record<string, unknown>;
}

export interface CallGraphProjection {
  nodes: CallGraphNode[];
  edges: CallGraphEdge[];
}

const MESSAGE_CREATION_EVENT_TYPES = new Set<SessionEventType>([
  'user_message_created',
  'agent_message_created',
]);

type EventPayload = Record<string, unknown> | undefined;

export function projectCallGraph(events: SessionEventEnvelope[]): CallGraphProjection {
  const sortedEvents = [...events].sort((a, b) => {
    if (a.seq !== b.seq) return a.seq - b.seq;
    return a.eventId.localeCompare(b.eventId);
  });

  const messageNodeByEventId = new Map<string, string>();
  const messageNodeByCorrelationId = new Map<string, string>();
  const taskNodeByTaskId = new Map<string, string>();
  const agentNodeByName = new Map<string, string>();
  const eventBySeq = new Map<string, SessionEventEnvelope>();
  const nodes: CallGraphNode[] = [];
  const edges: CallGraphEdge[] = [];
  const seenNodeIds = new Set<string>();
  let edgeCounter = 0;

  for (const event of sortedEvents) {
    const seqKey = `${event.sessionId}:${event.seq}`;
    eventBySeq.set(seqKey, event);

    if (MESSAGE_CREATION_EVENT_TYPES.has(event.eventType)) {
      handleMessageEvent(event);
      continue;
    }

    switch (event.eventType) {
      case 'dispatch_task_created':
        handleDispatchCreated(event);
        break;
      case 'dispatch_task_completed':
        handleDispatchCompleted(event);
        break;
      case 'agent_review_requested':
        handleReviewRequested(event);
        break;
      case 'agent_review_submitted':
        handleReviewSubmitted(event);
        break;
      default:
        break;
    }
  }

  return { nodes, edges };

  function handleMessageEvent(event: SessionEventEnvelope): void {
    const message = extractMessage(event.payload);
    if (!message || !message.id) return;

    const nodeId = ensureMessageNode(message, event);
    messageNodeByEventId.set(event.eventId, nodeId);
    if (event.correlationId) {
      messageNodeByCorrelationId.set(event.correlationId, nodeId);
    }

    const targetMessageId = resolveMessageNodeIdForEvent(event);
    if (targetMessageId && targetMessageId !== nodeId) {
      addEdge('reply', targetMessageId, nodeId, { eventId: event.eventId });
    }

    if (typeof message.taskId === 'string' && message.taskId.trim()) {
      const taskNodeId = ensureTaskNode(message.taskId, event, event.payload);
      if (taskNodeId) {
        addEdge('reply', taskNodeId, nodeId, { eventId: event.eventId });
      }
    }

    if (event.actorType === 'agent' && event.actorName) {
      ensureAgentNode(event.actorName);
    }
  }

  function handleDispatchCreated(event: SessionEventEnvelope): void {
    const payload = event.payload;
    const taskId = readString(payload, 'taskId');
    if (!taskId) return;

    const taskNodeId = ensureTaskNode(taskId, event, payload);
    if (!taskNodeId) return;

    const caller = readString(payload, 'callerAgentName');
    const callee = readString(payload, 'calleeAgentName');
    const dispatchKind = readDispatchKind(payload);

    const fromMessageId = resolveMessageNodeIdForEvent(event);
    if (fromMessageId) {
      addEdge('invoke', fromMessageId, taskNodeId, {
        eventId: event.eventId,
        dispatchKind,
        role: 'message',
      });
    }

    const callerNodeId = ensureAgentNode(caller);
    if (callerNodeId) {
      addEdge('invoke', callerNodeId, taskNodeId, {
        eventId: event.eventId,
        role: 'caller',
        dispatchKind,
      });
    }

    ensureAgentNode(callee);

    const parentTaskId = readString(payload, 'parentTaskId');
    if (parentTaskId) {
      const parentNodeId = ensureTaskNode(parentTaskId, event, payload);
      if (parentNodeId && parentNodeId !== taskNodeId) {
        addEdge('resume', parentNodeId, taskNodeId, {
          eventId: event.eventId,
          dispatchKind,
        });
      }
    }
  }

  function handleDispatchCompleted(event: SessionEventEnvelope): void {
    const payload = event.payload;
    const taskId = readString(payload, 'taskId');
    if (!taskId) return;

    const taskNodeId = ensureTaskNode(taskId, event, payload);
    if (!taskNodeId) return;

    const callee = readString(payload, 'calleeAgentName');
    const calleeNodeId = ensureAgentNode(callee);
    if (calleeNodeId) {
      addEdge('stop', taskNodeId, calleeNodeId, { eventId: event.eventId });
    }
  }

  function handleReviewRequested(event: SessionEventEnvelope): void {
    const payload = event.payload;
    const taskId = readString(payload, 'taskId');
    if (!taskId) return;

    const taskNodeId = ensureTaskNode(taskId, event, payload);
    if (!taskNodeId) return;

    ensureAgentNode(readString(payload, 'callerAgentName'));
    ensureAgentNode(readString(payload, 'calleeAgentName'));

    const reviewer = event.actorName || readString(payload, 'calleeAgentName');
    const reviewerNodeId = ensureAgentNode(reviewer);
    if (reviewerNodeId) {
      addEdge('review', taskNodeId, reviewerNodeId, {
        eventId: event.eventId,
        status: 'requested',
        reviewAction: readReviewAction(payload),
        reviewDisplayText: readString(payload, 'reviewDisplayText'),
      });
    }
  }

  function handleReviewSubmitted(event: SessionEventEnvelope): void {
    const payload = event.payload;
    const taskId = readString(payload, 'taskId');
    if (!taskId) return;

    const taskNodeId = ensureTaskNode(taskId, event, payload);
    if (!taskNodeId) return;

    ensureAgentNode(readString(payload, 'callerAgentName'));
    ensureAgentNode(readString(payload, 'calleeAgentName'));

    const reviewer = event.actorName || readString(payload, 'callerAgentName');
    const reviewerNodeId = ensureAgentNode(reviewer);
    if (reviewerNodeId) {
      addEdge('review', reviewerNodeId, taskNodeId, {
        eventId: event.eventId,
        status: 'submitted',
        reviewAction: readReviewAction(payload),
      });
    }
  }

  function resolveMessageNodeIdForEvent(event: SessionEventEnvelope): string | undefined {
    if (event.causedByEventId) {
      const nodeId = messageNodeByEventId.get(event.causedByEventId);
      if (nodeId) return nodeId;
    }

    if (event.causationId) {
      const nodeId = messageNodeByEventId.get(event.causationId);
      if (nodeId) return nodeId;
    }

    if (event.correlationId) {
      const nodeId = messageNodeByCorrelationId.get(event.correlationId);
      if (nodeId) return nodeId;
    }

    if (typeof event.causedBySeq === 'number') {
      const key = `${event.sessionId}:${event.causedBySeq}`;
      const causeEvent = eventBySeq.get(key);
      if (causeEvent) {
        return messageNodeByEventId.get(causeEvent.eventId);
      }
    }

    return undefined;
  }

  function ensureMessageNode(message: Message, event: SessionEventEnvelope): string {
    const messageId = message.id.trim();
    if (!messageId) return '';

    const nodeId = `message-${messageId}`;
    if (seenNodeIds.has(nodeId)) {
      return nodeId;
    }

    const label = message.text?.trim() || message.sender || messageId;
    const node: CallGraphMessageNode = {
      id: nodeId,
      kind: 'message',
      messageId,
      sender: message.sender || 'unknown',
      role: message.role,
      taskId: typeof message.taskId === 'string' && message.taskId.trim() ? message.taskId : undefined,
      label,
      timestamp: typeof message.timestamp === 'number' ? message.timestamp : event.seq,
      seq: event.seq,
      eventId: event.eventId,
    };

    addNode(node);
    return nodeId;
  }

  function ensureTaskNode(taskId: string, event: SessionEventEnvelope, payload: EventPayload): string {
    const trimmed = taskId.trim();
    if (!trimmed) return '';

    const existing = taskNodeByTaskId.get(trimmed);
    if (existing) return existing;

    const nodeId = `task-${trimmed}`;
    const node: CallGraphTaskNode = {
      id: nodeId,
      kind: 'task',
      taskId: trimmed,
      label: trimmed,
      dispatchKind: readDispatchKind(payload),
      metadata: {
        eventId: event.eventId,
        seq: event.seq,
      },
    };

    addNode(node);
    taskNodeByTaskId.set(trimmed, nodeId);
    return nodeId;
  }

  function ensureAgentNode(name: string | undefined): string | undefined {
    const normalized = typeof name === 'string' ? name.trim() : undefined;
    if (!normalized) return undefined;

    const existing = agentNodeByName.get(normalized);
    if (existing) return existing;

    const nodeId = `agent-${normalized}`;
    const node: CallGraphAgentNode = {
      id: nodeId,
      kind: 'agent',
      agentName: normalized,
      label: normalized,
    };

    addNode(node);
    agentNodeByName.set(normalized, nodeId);
    return nodeId;
  }

  function addNode(node: CallGraphNode): void {
    if (seenNodeIds.has(node.id)) return;
    seenNodeIds.add(node.id);
    nodes.push(node);
  }

  function addEdge(
    type: CallGraphEdgeType,
    source: string,
    target: string,
    metadata?: Record<string, unknown>
  ): void {
    if (!source || !target) return;
    const edge: CallGraphEdge = {
      id: `edge-${edgeCounter++}-${type}-${source}-${target}`,
      type,
      source,
      target,
      metadata,
    };

    edges.push(edge);
  }
}

function extractMessage(payload: EventPayload): Message | undefined {
  if (!payload) return undefined;
  const candidate = payload.message;
  if (candidate && typeof candidate === 'object') {
    return candidate as Message;
  }
  return undefined;
}

function readString(payload: EventPayload, key: string): string | undefined {
  if (!payload) return undefined;
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readDispatchKind(payload: EventPayload): AgentDispatchKind | undefined {
  const value = readString(payload, 'dispatchKind');
  return value as AgentDispatchKind | undefined;
}

function readReviewAction(payload: EventPayload): InvocationReviewAction | undefined {
  const value = readString(payload, 'reviewAction');
  return value as InvocationReviewAction | undefined;
}
