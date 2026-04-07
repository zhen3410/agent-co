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

test('discussion-policy decides peer summary eligibility, in-progress state, and manual agent selection', () => {
  const {
    canStartManualSummary,
    isSummaryInProgress,
    selectManualSummaryAgent
  } = requireBuiltModule('chat', 'domain', 'discussion-policy.js');

  assert.equal(canStartManualSummary('peer'), true);
  assert.equal(canStartManualSummary('classic'), false);

  assert.equal(
    isSummaryInProgress({
      discussionMode: 'peer',
      discussionState: 'summarizing',
      hasSummaryRequest: false
    }),
    true
  );
  assert.equal(
    isSummaryInProgress({
      discussionMode: 'peer',
      discussionState: 'active',
      hasSummaryRequest: true
    }),
    true
  );
  assert.equal(
    isSummaryInProgress({
      discussionMode: 'classic',
      discussionState: 'summarizing',
      hasSummaryRequest: true
    }),
    false
  );

  assert.equal(
    selectManualSummaryAgent({
      enabledAgents: ['Alice', 'Bob'],
      currentAgent: 'Bob'
    }),
    'Bob'
  );
  assert.equal(
    selectManualSummaryAgent({
      enabledAgents: ['Alice', 'Bob'],
      currentAgent: 'Mallory'
    }),
    'Alice'
  );
  assert.equal(
    selectManualSummaryAgent({
      enabledAgents: [],
      currentAgent: 'Alice'
    }),
    null
  );
});

test('discussion-policy normalizes summary continuation state without mutating the snapshot', () => {
  const { normalizeSummaryContinuationState } = requireBuiltModule('chat', 'domain', 'discussion-policy.js');
  const task = { agentName: 'Alice', prompt: '继续', includeHistory: true };
  const message = { id: 'm1', role: 'assistant', sender: 'Alice', text: 'hi', timestamp: 1 };
  const snapshot = {
    discussionState: 'summarizing',
    pendingAgentTasks: [task],
    pendingVisibleMessages: [message]
  };

  const normalized = normalizeSummaryContinuationState(snapshot);

  assert.deepEqual(normalized, {
    discussionState: 'paused',
    pendingAgentTasks: [task],
    pendingVisibleMessages: [message]
  });
  assert.notEqual(normalized.pendingAgentTasks[0], task);
  assert.notEqual(normalized.pendingVisibleMessages[0], message);
  assert.deepEqual(snapshot, {
    discussionState: 'summarizing',
    pendingAgentTasks: [task],
    pendingVisibleMessages: [message]
  });
});
