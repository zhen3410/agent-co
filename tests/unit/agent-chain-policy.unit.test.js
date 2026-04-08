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

test('agent-chain-policy extracts implicit peer continuation targets from handoff and continue prompts', () => {
  const { collectImplicitPeerContinuationTargets } = requireBuiltModule('chat', 'domain', 'agent-chain-policy.js');

  assert.deepEqual(
    collectImplicitPeerContinuationTargets({
      message: '请 @Bob 继续',
      enabledAgents: ['Alice', 'Bob', 'Carol'],
      sender: 'Alice'
    }),
    ['Bob']
  );

  assert.deepEqual(
    collectImplicitPeerContinuationTargets({
      message: '@Carol 继续补充一下',
      enabledAgents: ['Alice', 'Bob', 'Carol'],
      sender: 'Alice'
    }),
    ['Carol']
  );

  assert.deepEqual(
    collectImplicitPeerContinuationTargets({
      message: '请 @Alice 继续',
      enabledAgents: ['Alice', 'Bob'],
      sender: 'Alice'
    }),
    []
  );
});

test('agent-chain-policy enforces hop and per-agent call limits for task execution and queueing', () => {
  const {
    shouldRunChainedTask,
    shouldSkipAgentTaskForCallLimit,
    canQueueContinuationTarget
  } = requireBuiltModule('chat', 'domain', 'agent-chain-policy.js');

  assert.equal(
    shouldRunChainedTask({
      dispatchKind: 'explicit_chained',
      chainedCalls: 2,
      maxChainHops: 2
    }),
    false
  );
  assert.equal(
    shouldRunChainedTask({
      dispatchKind: 'initial',
      chainedCalls: 2,
      maxChainHops: 2
    }),
    true
  );

  assert.equal(
    shouldSkipAgentTaskForCallLimit({
      currentCalls: 3,
      maxCallsPerAgent: 3
    }),
    true
  );
  assert.equal(
    shouldSkipAgentTaskForCallLimit({
      currentCalls: 3,
      maxCallsPerAgent: null
    }),
    false
  );

  assert.equal(
    canQueueContinuationTarget({
      chainedCalls: 1,
      queuedChainedCalls: 0,
      pendingTargetCount: 0,
      queuedCallsForAgent: 1,
      pendingCallsForAgent: 1,
      maxChainHops: 2,
      maxCallsPerAgent: 3
    }),
    true
  );
  assert.equal(
    canQueueContinuationTarget({
      chainedCalls: 2,
      queuedChainedCalls: 0,
      pendingTargetCount: 0,
      queuedCallsForAgent: 1,
      pendingCallsForAgent: 1,
      maxChainHops: 2,
      maxCallsPerAgent: 3
    }),
    false
  );
  assert.equal(
    canQueueContinuationTarget({
      chainedCalls: 1,
      queuedChainedCalls: 0,
      pendingTargetCount: 0,
      queuedCallsForAgent: 2,
      pendingCallsForAgent: 1,
      maxChainHops: 3,
      maxCallsPerAgent: 3
    }),
    false
  );
});

test('agent-chain-policy resolves peer discussion pause decisions after a visible turn', () => {
  const { resolvePeerDiscussionStateAfterTurn } = requireBuiltModule('chat', 'domain', 'agent-chain-policy.js');

  assert.equal(
    resolvePeerDiscussionStateAfterTurn({
      discussionMode: 'peer',
      sawVisibleMessage: true,
      hasPendingExplicitContinuation: false
    }),
    'paused'
  );
  assert.equal(
    resolvePeerDiscussionStateAfterTurn({
      discussionMode: 'peer',
      sawVisibleMessage: true,
      hasPendingExplicitContinuation: true
    }),
    'active'
  );
  assert.equal(
    resolvePeerDiscussionStateAfterTurn({
      discussionMode: 'classic',
      sawVisibleMessage: true,
      hasPendingExplicitContinuation: false
    }),
    null
  );
});

test('agent-chain-policy exposes timeout, retry, and follow_up helpers with explicit caps', () => {
  const {
    isInvocationTaskOverdue,
    canRetryInvocationTask,
    canFollowUpInvocationTask
  } = requireBuiltModule('chat', 'domain', 'agent-chain-policy.js');

  assert.equal(
    isInvocationTaskOverdue({
      status: 'pending_reply',
      deadlineAt: 100,
      now: 100
    }),
    true
  );
  assert.equal(
    isInvocationTaskOverdue({
      status: 'awaiting_caller_review',
      deadlineAt: 100,
      now: 101
    }),
    false
  );
  assert.equal(
    isInvocationTaskOverdue({
      status: 'pending_reply',
      deadlineAt: 120,
      now: 101
    }),
    false
  );
  assert.equal(
    isInvocationTaskOverdue({
      status: 'pending_reply',
      deadlineAt: undefined,
      now: 101
    }),
    false
  );
  assert.equal(
    isInvocationTaskOverdue({
      status: 'failed',
      deadlineAt: 100,
      now: 101
    }),
    false
  );

  assert.equal(
    canRetryInvocationTask({
      retryCount: 0,
      maxRetries: 1
    }),
    true
  );
  assert.equal(
    canRetryInvocationTask({
      retryCount: 1,
      maxRetries: 1
    }),
    false
  );

  assert.equal(
    canFollowUpInvocationTask({
      followupCount: 1,
      maxFollowUps: 2
    }),
    true
  );
  assert.equal(
    canFollowUpInvocationTask({
      followupCount: 2,
      maxFollowUps: 2
    }),
    false
  );
});
