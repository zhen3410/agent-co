import { Message, MessageCallGraph, MessageCallGraphEdge, MessageCallGraphNode, MessageCallGraphNodeSubtype } from '../../types';

const MAX_GRAPH_NODES = 12;

interface GraphBuildResult {
  nodes: MessageCallGraphNode[];
  edges: MessageCallGraphEdge[];
  truncated: boolean;
  truncatedNodeCount: number;
}

function buildMessageNodeId(messageId: string): string {
  return `message:${messageId}`;
}

function buildExecutionNodeId(taskId: string): string {
  return `execution:${taskId}`;
}

function mapMessageSubtype(message: Message): MessageCallGraphNodeSubtype {
  if (message.role === 'user') return 'user';
  return 'assistant';
}

function collectRelatedTaskIds(history: Message[], focusTaskId: string): Set<string> {
  const relatedTaskIds = new Set<string>();
  const queue = [focusTaskId];

  while (queue.length > 0) {
    const taskId = queue.shift();
    if (!taskId || relatedTaskIds.has(taskId)) continue;
    relatedTaskIds.add(taskId);

    for (const message of history) {
      if (message.taskId === taskId && message.parentTaskId && !relatedTaskIds.has(message.parentTaskId)) {
        queue.push(message.parentTaskId);
      }
      if (message.parentTaskId === taskId && message.taskId && !relatedTaskIds.has(message.taskId)) {
        queue.push(message.taskId);
      }
    }
  }

  return relatedTaskIds;
}

function detectCycleEdges(nodes: MessageCallGraphNode[], edges: MessageCallGraphEdge[]): { hasCycle: boolean; cycleCount: number; cycleEdgeIds: Set<string> } {
  const nodeIds = new Set(nodes.map(node => node.id));
  const executionEdges = edges.filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to) && edge.from.startsWith('execution:') && edge.to.startsWith('execution:'));
  const adjacency = new Map<string, string[]>();

  for (const edge of executionEdges) {
    const targets = adjacency.get(edge.from) || [];
    targets.push(edge.to);
    adjacency.set(edge.from, targets);
  }

  const cycleEdgeIds = new Set<string>();
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  let cycleCount = 0;

  function walk(nodeId: string): void {
    state.set(nodeId, 'visiting');
    stack.push(nodeId);
    const targets = adjacency.get(nodeId) || [];

    for (const targetId of targets) {
      const targetState = state.get(targetId);
      if (targetState === 'visiting') {
        cycleCount += 1;
        const cycleStart = stack.lastIndexOf(targetId);
        const cyclePath = cycleStart >= 0 ? stack.slice(cycleStart) : [targetId];
        const cycleNodeSet = new Set([...cyclePath, targetId]);
        for (const edge of executionEdges) {
          if (cycleNodeSet.has(edge.from) && cycleNodeSet.has(edge.to)) {
            cycleEdgeIds.add(edge.id);
          }
        }
        continue;
      }
      if (!targetState) {
        walk(targetId);
      }
    }

    stack.pop();
    state.set(nodeId, 'done');
  }

  for (const node of nodes) {
    if (node.kind !== 'execution') continue;
    if (!state.has(node.id)) {
      walk(node.id);
    }
  }

  return {
    hasCycle: cycleEdgeIds.size > 0,
    cycleCount,
    cycleEdgeIds
  };
}

function buildGraph(history: Message[], focusMessage: Message): GraphBuildResult | null {
  if (!focusMessage.taskId) return null;

  const relatedTaskIds = collectRelatedTaskIds(history, focusMessage.taskId);
  const relatedMessages = history.filter(message => Boolean(message.taskId) && relatedTaskIds.has(message.taskId as string));
  if (relatedMessages.length === 0) return null;

  const nodeMap = new Map<string, MessageCallGraphNode>();
  const edgeMap = new Map<string, MessageCallGraphEdge>();

  for (const message of relatedMessages) {
    const messageNodeId = buildMessageNodeId(message.id);
    nodeMap.set(messageNodeId, {
      id: messageNodeId,
      kind: 'message',
      subtype: mapMessageSubtype(message),
      label: message.sender || (message.role === 'user' ? '用户消息' : '智能体消息'),
      actorName: message.sender,
      timestamp: message.timestamp,
      isFocus: message.id === focusMessage.id
    });

    if (!message.taskId) continue;
    const executionNodeId = buildExecutionNodeId(message.taskId);
    if (!nodeMap.has(executionNodeId)) {
      nodeMap.set(executionNodeId, {
        id: executionNodeId,
        kind: 'execution',
        subtype: 'agent_run',
        label: message.callerAgentName && message.calleeAgentName
          ? `${message.callerAgentName} → ${message.calleeAgentName}`
          : (message.calleeAgentName || message.sender || message.taskId),
        actorName: message.calleeAgentName || message.sender,
        status: 'completed',
        timestamp: message.timestamp
      });
    }

    edgeMap.set(`${executionNodeId}->${messageNodeId}:emit`, {
      id: `${executionNodeId}->${messageNodeId}:emit`,
      from: executionNodeId,
      to: messageNodeId,
      type: 'emit',
      status: 'completed'
    });

    if (message.parentTaskId && relatedTaskIds.has(message.parentTaskId)) {
      const parentNodeId = buildExecutionNodeId(message.parentTaskId);
      if (!nodeMap.has(parentNodeId)) {
        nodeMap.set(parentNodeId, {
          id: parentNodeId,
          kind: 'execution',
          subtype: 'agent_run',
          label: message.callerAgentName || message.parentTaskId,
          actorName: message.callerAgentName,
          status: 'completed'
        });
      }
      edgeMap.set(`${parentNodeId}->${executionNodeId}:spawn`, {
        id: `${parentNodeId}->${executionNodeId}:spawn`,
        from: parentNodeId,
        to: executionNodeId,
        type: 'spawn',
        status: 'completed'
      });
    }
  }

  const nodes = Array.from(nodeMap.values()).sort((left, right) => {
    const leftTime = left.timestamp || 0;
    const rightTime = right.timestamp || 0;
    return leftTime - rightTime || left.id.localeCompare(right.id);
  });
  const edges = Array.from(edgeMap.values()).sort((left, right) => left.id.localeCompare(right.id));
  const truncated = nodes.length > MAX_GRAPH_NODES;
  const keptNodeIds = new Set(nodes.slice(0, MAX_GRAPH_NODES).map(node => node.id));

  return {
    nodes: truncated ? nodes.filter(node => keptNodeIds.has(node.id)) : nodes,
    edges: truncated ? edges.filter(edge => keptNodeIds.has(edge.from) && keptNodeIds.has(edge.to)) : edges,
    truncated,
    truncatedNodeCount: truncated ? nodes.length - MAX_GRAPH_NODES : 0
  };
}

export function buildMessageCallGraph(history: Message[], focusMessage: Message): MessageCallGraph | null {
  const graph = buildGraph(history, focusMessage);
  if (!graph) return null;

  const cycleInfo = detectCycleEdges(graph.nodes, graph.edges);
  const edges = graph.edges.map(edge => ({
    ...edge,
    isCycleEdge: cycleInfo.cycleEdgeIds.has(edge.id),
    type: cycleInfo.cycleEdgeIds.has(edge.id) ? 'loopback' : edge.type
  }));
  const participantNames = Array.from(new Set(graph.nodes
    .map(node => node.actorName)
    .filter((name): name is string => Boolean(name)))).sort();
  const focusNodeId = buildMessageNodeId(focusMessage.id);
  const focusNode = graph.nodes.find(node => node.id === focusNodeId);

  return {
    version: 1,
    focusNodeId,
    hasCycle: cycleInfo.hasCycle,
    truncated: graph.truncated,
    summary: {
      nodeCount: graph.nodes.length,
      edgeCount: edges.length,
      cycleCount: cycleInfo.cycleCount,
      participantNames,
      focusKind: 'message',
      focusLabel: focusNode?.label || focusMessage.sender || focusMessage.id,
      truncatedNodeCount: graph.truncated ? graph.truncatedNodeCount : undefined
    },
    nodes: graph.nodes,
    edges
  };
}

export function enrichMessagesWithCallGraphs(history: Message[]): Message[] {
  return history.map(message => {
    const callGraph = buildMessageCallGraph(history, message);
    return callGraph ? { ...message, callGraph } : { ...message, callGraph: undefined };
  });
}
