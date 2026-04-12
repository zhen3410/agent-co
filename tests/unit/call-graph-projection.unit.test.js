const test = require('node:test');
const assert = require('node:assert/strict');

const { createSessionEvent } = require('../../dist/chat/domain/session-events.js');
const { projectCallGraph } = require('../../dist/chat/application/call-graph-projection.js');

function buildMessage(id, role, sender, text, timestamp = 1, extras = {}) {
  return {
    id,
    role,
    sender,
    text,
    timestamp,
    ...extras,
  };
}

function findEdge(edges, type, source, target) {
  return edges.find((edge) => edge.type === type && edge.source === source && edge.target === target);
}

test('projectCallGraph derives nodes and edges for dispatch, review, and message events', () => {
  const events = [
    createSessionEvent({
      sessionId: 's1',
      seq: 1,
      eventId: 'evt-user-message',
      eventType: 'user_message_created',
      actorType: 'user',
      actorName: 'Tester',
      payload: {
        message: buildMessage('message-user', 'user', 'Tester', 'start', 1),
      },
    }),
    createSessionEvent({
      sessionId: 's1',
      seq: 2,
      eventId: 'evt-dispatch-1',
      eventType: 'dispatch_task_created',
      actorType: 'system',
      causedByEventId: 'evt-user-message',
      payload: {
        taskId: 'task-1',
        dispatchKind: 'initial',
        callerAgentName: 'Dispatcher',
        calleeAgentName: 'Assistant',
      },
    }),
    createSessionEvent({
      sessionId: 's1',
      seq: 3,
      eventId: 'evt-agent-message',
      eventType: 'agent_message_created',
      actorType: 'agent',
      actorName: 'Assistant',
      causedByEventId: 'evt-user-message',
      payload: {
        message: buildMessage('message-agent-reply', 'assistant', 'Assistant', 'Reply to you', 2, {
          taskId: 'task-1',
          callerAgentName: 'Dispatcher',
          calleeAgentName: 'Assistant',
        }),
      },
    }),
    createSessionEvent({
      sessionId: 's1',
      seq: 4,
      eventId: 'evt-review-request',
      eventType: 'agent_review_requested',
      actorType: 'agent',
      actorName: 'Reviewer',
      causedByEventId: 'evt-agent-message',
      payload: {
        taskId: 'task-1',
        reviewAction: 'follow_up',
        reviewDisplayText: 'Need one more pass',
        callerAgentName: 'Dispatcher',
        calleeAgentName: 'Assistant',
      },
    }),
    createSessionEvent({
      sessionId: 's1',
      seq: 5,
      eventId: 'evt-review-submitted',
      eventType: 'agent_review_submitted',
      actorType: 'agent',
      actorName: 'Reviewer',
      payload: {
        taskId: 'task-1',
        reviewAction: 'follow_up',
      },
    }),
    createSessionEvent({
      sessionId: 's1',
      seq: 6,
      eventId: 'evt-task-complete',
      eventType: 'dispatch_task_completed',
      actorType: 'system',
      payload: {
        taskId: 'task-1',
        callerAgentName: 'Dispatcher',
        calleeAgentName: 'Assistant',
      },
    }),
    createSessionEvent({
      sessionId: 's1',
      seq: 7,
      eventId: 'evt-task-2',
      eventType: 'dispatch_task_created',
      actorType: 'system',
      causedByEventId: 'evt-agent-message',
      payload: {
        taskId: 'task-2',
        parentTaskId: 'task-1',
        dispatchKind: 'explicit_chained',
        callerAgentName: 'Dispatcher',
        calleeAgentName: 'Assistant',
      },
    }),
  ];

  const graph = projectCallGraph(events);

  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  ['message-message-user', 'message-message-agent-reply', 'task-task-1', 'task-task-2', 'agent-Dispatcher', 'agent-Assistant', 'agent-Reviewer'].forEach((expectedId) => {
    assert.ok(nodeIds.has(expectedId), `expected node ${expectedId}`);
  });

  assert.ok(
    findEdge(graph.edges, 'invoke', 'message-message-user', 'task-task-1'),
    'expected invoke edge from user message to task'
  );

  assert.ok(
    findEdge(graph.edges, 'invoke', 'agent-Dispatcher', 'task-task-1'),
    'expected invoke edge from dispatcher agent to task'
  );

  assert.ok(
    findEdge(graph.edges, 'reply', 'task-task-1', 'message-message-agent-reply'),
    'expected reply edge from task to agent message'
  );

  assert.ok(
    findEdge(graph.edges, 'reply', 'message-message-user', 'message-message-agent-reply'),
    'expected reply edge linking user message to agent reply'
  );

  const reviewRequest = findEdge(graph.edges, 'review', 'task-task-1', 'agent-Reviewer');
  assert.equal(reviewRequest?.metadata?.status, 'requested');
  assert.equal(reviewRequest?.metadata?.reviewAction, 'follow_up');

  const reviewSubmit = findEdge(graph.edges, 'review', 'agent-Reviewer', 'task-task-1');
  assert.equal(reviewSubmit?.metadata?.status, 'submitted');

  assert.ok(findEdge(graph.edges, 'stop', 'task-task-1', 'agent-Assistant'), 'expected stop edge after task completion');
  assert.ok(findEdge(graph.edges, 'resume', 'task-task-1', 'task-task-2'), 'expected resume edge between tasks');
});
