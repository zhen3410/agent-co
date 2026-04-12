const test = require('node:test');
const assert = require('node:assert/strict');

const { createSessionEvent } = require('../../dist/chat/domain/session-events.js');
const { projectChatTimeline } = require('../../dist/chat/application/chat-timeline-projection.js');

function buildMessage(id, role, sender, text, timestamp = 1) {
  return {
    id,
    role,
    sender,
    text,
    timestamp,
  };
}

test('projectChatTimeline maps events into timeline rows with rich metadata', () => {
  const events = [
    createSessionEvent({
      sessionId: 's1',
      seq: 3,
      eventType: 'dispatch_task_created',
      actorType: 'system',
      actorName: 'Dispatcher',
      correlationId: 'group-123',
      metadata: { reason: 'auto' },
      payload: {
        taskId: 'task-1',
        dispatchKind: 'initial',
        callerAgentName: 'Dispatcher',
        calleeAgentName: 'Assistant',
      },
    }),
    createSessionEvent({
      sessionId: 's1',
      seq: 4,
      eventType: 'agent_review_requested',
      actorType: 'agent',
      actorName: 'Reviewer',
      payload: {
        taskId: 'task-1',
        reviewAction: 'follow_up',
        reviewDisplayText: '继续确认某些细节',
        reviewRawText: 'raw details',
        callerAgentName: 'Dispatcher',
        calleeAgentName: 'Assistant',
      },
    }),
    createSessionEvent({
      sessionId: 's1',
      seq: 1,
      eventType: 'user_message_created',
      actorType: 'user',
      actorName: 'Tester',
      correlationId: 'group-123',
      metadata: { source: 'cli' },
      payload: {
        message: buildMessage('m1', 'user', 'Tester', 'hello timeline'),
      },
    }),
    createSessionEvent({
      sessionId: 's1',
      seq: 2,
      eventType: 'message_thinking_started',
      actorType: 'agent',
      actorName: 'Assistant',
      payload: {
        taskId: 'task-1',
        messageId: 'm2',
      },
    }),
    createSessionEvent({
      sessionId: 's1',
      seq: 5,
      eventType: 'agent_message_created',
      actorType: 'agent',
      actorName: 'Assistant',
      payload: {
        message: buildMessage('m3', 'assistant', 'Assistant', '回复内容'),
      },
    }),
  ];

  const timeline = projectChatTimeline(events);
  assert.deepEqual(timeline.map(row => row.seq), [1, 2, 3, 4, 5]);

  const [userMessage, thinking, dispatch, review, agentMessage] = timeline;
  assert.equal(userMessage.kind, 'message');
  assert.equal(userMessage.message.text, 'hello timeline');
  assert.equal(userMessage.actorName, 'Tester');
  assert.equal(userMessage.metadata?.source, 'cli');
  assert.equal(userMessage.groupId, 'group-123');
  assert.equal(userMessage.isUpdate, false);

  assert.equal(thinking.kind, 'thinking');
  assert.equal(thinking.status, 'started');
  assert.equal(thinking.taskId, 'task-1');
  assert.equal(thinking.messageId, 'm2');

  assert.equal(dispatch.kind, 'dispatch');
  assert.equal(dispatch.status, 'created');
  assert.equal(dispatch.taskId, 'task-1');
  assert.equal(dispatch.dispatchKind, 'initial');
  assert.equal(dispatch.callerAgentName, 'Dispatcher');
  assert.equal(dispatch.calleeAgentName, 'Assistant');

  assert.equal(review.kind, 'review');
  assert.equal(review.status, 'requested');
  assert.equal(review.reviewAction, 'follow_up');
  assert.equal(review.reviewDisplayText, '继续确认某些细节');
  assert.equal(review.reviewRawText, 'raw details');
  assert.equal(review.callerAgentName, 'Dispatcher');
  assert.equal(review.calleeAgentName, 'Assistant');

  assert.equal(agentMessage.kind, 'message');
  assert.equal(agentMessage.message.sender, 'Assistant');
});

test('projectChatTimeline derives groupId from correlation, causation, causedBy, and defaults to eventType', () => {
  const events = [
    createSessionEvent({
      sessionId: 's1',
      seq: 6,
      eventType: 'dispatch_task_created',
      actorType: 'system',
      correlationId: 'corr-a',
      payload: {},
    }),
    createSessionEvent({
      sessionId: 's1',
      seq: 7,
      eventType: 'dispatch_task_completed',
      actorType: 'system',
      causationId: 'cause-b',
      payload: {},
    }),
    createSessionEvent({
      sessionId: 's1',
      seq: 8,
      eventType: 'agent_review_requested',
      actorType: 'agent',
      causedByEventId: 'evt-c',
      payload: {},
    }),
    createSessionEvent({
      sessionId: 's1',
      seq: 9,
      eventType: 'agent_review_submitted',
      actorType: 'agent',
      payload: {},
    }),
  ];

  const timeline = projectChatTimeline(events);
  assert.equal(timeline[0].groupId, 'corr-a');
  assert.equal(timeline[1].groupId, 'cause-b');
  assert.equal(timeline[2].groupId, 'evt-c');
  assert.equal(timeline[3].groupId, 'agent_review_submitted');
});
