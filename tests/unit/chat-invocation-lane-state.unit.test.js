const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const distDir = path.join(repoRoot, 'dist');

function requireBuiltModule(...segments) {
  const modulePath = path.join(distDir, ...segments);
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

test('invocation lane state 按 session+agent 维护 FIFO 队列并投影运行态', () => {
  const { createChatInvocationLaneState } = requireBuiltModule('chat', 'runtime', 'chat-invocation-lane-state.js');
  const state = createChatInvocationLaneState();

  state.applyEvent({
    eventType: 'agent_invocation_enqueued',
    sessionId: 's1',
    seq: 1,
    eventId: 'evt-1',
    actorType: 'agent',
    actorName: 'Alice',
    payload: {
      queueTaskId: 'q1',
      laneKey: 's1::Alice',
      agentName: 'Alice',
      aheadCount: 0
    },
    createdAt: new Date().toISOString()
  });
  state.applyEvent({
    eventType: 'agent_invocation_enqueued',
    sessionId: 's1',
    seq: 2,
    eventId: 'evt-2',
    actorType: 'agent',
    actorName: 'Alice',
    payload: {
      queueTaskId: 'q2',
      laneKey: 's1::Alice',
      agentName: 'Alice',
      aheadCount: 1
    },
    createdAt: new Date().toISOString()
  });
  state.applyEvent({
    eventType: 'agent_invocation_started',
    sessionId: 's1',
    seq: 3,
    eventId: 'evt-3',
    actorType: 'agent',
    actorName: 'Alice',
    payload: {
      queueTaskId: 'q1',
      laneKey: 's1::Alice',
      agentName: 'Alice',
      executionId: 'exec-1'
    },
    createdAt: new Date().toISOString()
  });

  const lane = state.getLane('s1::Alice');
  assert.equal(lane.runningTaskId, 'q1');
  assert.deepEqual(lane.queuedTaskIds, ['q2']);
  assert.equal(state.getTask('q2').aheadCount, 1);

  state.applyEvent({
    eventType: 'agent_invocation_completed',
    sessionId: 's1',
    seq: 4,
    eventId: 'evt-4',
    actorType: 'agent',
    actorName: 'Alice',
    payload: {
      queueTaskId: 'q1',
      laneKey: 's1::Alice',
      agentName: 'Alice'
    },
    createdAt: new Date().toISOString()
  });

  assert.equal(state.getLane('s1::Alice').runningTaskId, null);
  assert.equal(state.getTask('q1').status, 'completed');
  assert.equal(state.getTask('q2').status, 'queued');
});

test('invocation lane state 会为不同 agent 分离 lane', () => {
  const { createChatInvocationLaneState } = requireBuiltModule('chat', 'runtime', 'chat-invocation-lane-state.js');
  const state = createChatInvocationLaneState();

  for (const [seq, laneKey, taskId, agentName] of [
    [1, 's1::Alice', 'q1', 'Alice'],
    [2, 's1::Bob', 'q2', 'Bob']
  ]) {
    state.applyEvent({
      eventType: 'agent_invocation_enqueued',
      sessionId: 's1',
      seq,
      eventId: `evt-${seq}`,
      actorType: 'agent',
      actorName: agentName,
      payload: {
        queueTaskId: taskId,
        laneKey,
        agentName,
        aheadCount: 0
      },
      createdAt: new Date().toISOString()
    });
    state.applyEvent({
      eventType: 'agent_invocation_started',
      sessionId: 's1',
      seq: seq + 10,
      eventId: `evt-${seq + 10}`,
      actorType: 'agent',
      actorName: agentName,
      payload: {
        queueTaskId: taskId,
        laneKey,
        agentName,
        executionId: `exec-${taskId}`
      },
      createdAt: new Date().toISOString()
    });
  }

  assert.equal(state.getLane('s1::Alice').runningTaskId, 'q1');
  assert.equal(state.getLane('s1::Bob').runningTaskId, 'q2');
});
