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

function createSessionState() {
  const { createChatSessionRepository } = requireBuiltModule('chat', 'infrastructure', 'chat-session-repository.js');
  const { createChatSessionState } = requireBuiltModule('chat', 'runtime', 'chat-session-state.js');
  const repository = createChatSessionRepository();
  return createChatSessionState({
    config: {
      defaultChatSessionId: 'default',
      defaultChatSessionName: '默认会话',
      getValidAgentNames: () => ['Alice', 'Bob']
    },
    repository,
    schedulePersistChatSessions: () => {},
    touchSession: (session) => {
      session.updatedAt = Date.now();
    },
    normalizeSessionChainSettings: () => ({
      agentChainMaxHops: 8,
      agentChainMaxCallsPerAgent: null
    }),
    normalizeSessionDiscussionSettings: () => ({
      discussionMode: 'classic',
      discussionState: 'active'
    }),
    applyNormalizedSessionChainSettings: (session) => {
      session.agentChainMaxHops = 8;
      session.agentChainMaxCallsPerAgent = null;
      return session;
    },
    applyNormalizedSessionDiscussionSettings: (session) => {
      session.discussionMode = 'classic';
      session.discussionState = 'active';
      return session;
    }
  });
}

test('invocation task 默认携带 reviewVersion，且 completed 终态不会再回退为 failed', () => {
  const sessionState = createSessionState();
  sessionState.ensureUserSessions('user:admin');
  const now = Date.now();

  const created = sessionState.createInvocationTask('user:admin', 'default', {
    id: 'task-1',
    sessionId: 'default',
    status: 'pending_reply',
    callerAgentName: 'Alice',
    calleeAgentName: 'Bob',
    prompt: '请 Bob 给方案',
    originalPrompt: '请 Bob 给方案',
    createdAt: now - 1000,
    updatedAt: now - 500,
    retryCount: 0,
    followupCount: 0
  });

  assert.equal(created.reviewVersion, 0);

  const completed = sessionState.markInvocationTaskCompleted('user:admin', 'default', 'task-1');
  assert.equal(completed.status, 'completed');

  const failed = sessionState.markInvocationTaskFailed('user:admin', 'default', 'task-1', 'should_be_ignored');
  assert.equal(failed.status, 'completed');
  assert.equal(failed.failureReason, undefined);

  const [task] = sessionState.listInvocationTasks('user:admin', 'default');
  assert.equal(task.status, 'completed');
  assert.equal(task.failureReason, undefined);
});
