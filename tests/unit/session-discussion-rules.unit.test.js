const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const distDir = path.join(repoRoot, 'dist');

function requireBuiltModule(...segments) {
  const modulePath = path.join(distDir, ...segments);
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function createRuntime(overrides = {}) {
  const touchCalls = [];
  const runtime = {
    touchSession(session) {
      touchCalls.push(session);
    },
    normalizeDiscussionMode(value) {
      return value === 'peer' ? 'peer' : 'classic';
    },
    normalizeDiscussionState(value) {
      return value === 'summarizing' || value === 'paused' ? value : 'active';
    },
    hasSummaryRequest() {
      return false;
    },
    getSessionEnabledAgents(session) {
      return Array.isArray(session.enabledAgents) ? [...session.enabledAgents] : [];
    },
    ...overrides
  };

  return { runtime, touchCalls };
}

function createSession(overrides = {}) {
  return {
    id: 'session-1',
    currentAgent: null,
    history: [],
    discussionMode: 'peer',
    discussionState: 'paused',
    pendingAgentTasks: undefined,
    pendingVisibleMessages: undefined,
    enabledAgents: [],
    ...overrides
  };
}

test('session discussion rules reset active state and pending execution before a new incoming message', () => {
  const { createSessionDiscussionService } = requireBuiltModule('chat', 'application', 'session-discussion-service.js');
  const { runtime, touchCalls } = createRuntime();
  const service = createSessionDiscussionService({ runtime });
  const session = createSession({
    discussionState: 'summarizing',
    pendingAgentTasks: [{ agentName: 'Alice', prompt: '继续', includeHistory: true }],
    pendingVisibleMessages: [{ id: 'm1', role: 'assistant', sender: 'Alice', text: 'hi', timestamp: 1 }]
  });

  service.prepareForIncomingMessage(session);

  assert.equal(session.discussionState, 'active');
  assert.equal(session.pendingAgentTasks, undefined);
  assert.equal(session.pendingVisibleMessages, undefined);
  assert.equal(touchCalls.length, 1);
});

test('session discussion rules clone and clear pending execution when resuming a chain', () => {
  const { createSessionDiscussionService } = requireBuiltModule('chat', 'application', 'session-discussion-service.js');
  const { runtime, touchCalls } = createRuntime();
  const service = createSessionDiscussionService({ runtime });
  const originalTask = { agentName: 'Alice', prompt: '继续', includeHistory: true };
  const originalMessage = { id: 'm1', role: 'assistant', sender: 'Alice', text: 'hi', timestamp: 1 };
  const session = createSession({
    pendingAgentTasks: [originalTask],
    pendingVisibleMessages: [originalMessage]
  });

  const result = service.takePendingExecution(session);

  assert.deepEqual(result, {
    pendingTasks: [originalTask],
    pendingVisibleMessages: [originalMessage]
  });
  assert.notEqual(result.pendingTasks[0], originalTask);
  assert.notEqual(result.pendingVisibleMessages[0], originalMessage);
  assert.equal(session.pendingAgentTasks, undefined);
  assert.equal(session.pendingVisibleMessages, undefined);
  assert.equal(touchCalls.length, 1);
});

test('session discussion rules restore summary continuation state with active/paused normalization', () => {
  const { createSessionDiscussionService } = requireBuiltModule('chat', 'application', 'session-discussion-service.js');
  const { runtime, touchCalls } = createRuntime();
  const service = createSessionDiscussionService({ runtime });
  const task = { agentName: 'Alice', prompt: '继续', includeHistory: true };
  const message = { id: 'm1', role: 'assistant', sender: 'Alice', text: 'hi', timestamp: 1 };
  const activeSession = createSession();
  const pausedSession = createSession();

  service.restoreSummaryContinuationState(activeSession, {
    discussionState: 'active',
    pendingAgentTasks: [task],
    pendingVisibleMessages: [message]
  });
  service.restoreSummaryContinuationState(pausedSession, {
    discussionState: 'summarizing',
    pendingAgentTasks: [task],
    pendingVisibleMessages: [message]
  });

  assert.equal(activeSession.discussionState, 'active');
  assert.equal(pausedSession.discussionState, 'paused');
  assert.notEqual(activeSession.pendingAgentTasks[0], task);
  assert.notEqual(pausedSession.pendingVisibleMessages[0], message);
  assert.equal(touchCalls.length, 2);
});

test('session discussion rules only treat peer summaries as in-progress and choose a valid summary agent', () => {
  const { createSessionDiscussionService } = requireBuiltModule('chat', 'application', 'session-discussion-service.js');
  const { runtime } = createRuntime({
    hasSummaryRequest(key) {
      return key === 'user-1::session-1';
    }
  });
  const service = createSessionDiscussionService({ runtime });
  const peerSession = createSession({
    discussionMode: 'peer',
    discussionState: 'summarizing',
    enabledAgents: ['Alice', 'Bob'],
    currentAgent: 'Bob'
  });
  const classicSession = createSession({
    discussionMode: 'classic',
    discussionState: 'summarizing',
    enabledAgents: ['Alice']
  });

  assert.equal(service.isSessionSummaryInProgress('user-1', peerSession), true);
  assert.equal(service.isSessionSummaryInProgress('user-1', classicSession), false);
  assert.equal(service.resolveManualSummaryAgent(peerSession), 'Bob');
  assert.equal(service.resolveManualSummaryAgent(createSession({ enabledAgents: ['Alice', 'Bob'] })), 'Alice');
  assert.equal(service.resolveManualSummaryAgent(createSession({ enabledAgents: [] })), null);
});

test('session discussion rules keep manual summary prompts and no-enabled-agent notices stable', () => {
  const { createSessionDiscussionService } = requireBuiltModule('chat', 'application', 'session-discussion-service.js');
  const { runtime } = createRuntime();
  const service = createSessionDiscussionService({ runtime });
  const session = createSession({
    history: [
      { id: 'u1', role: 'user', sender: '用户', text: 'hello', timestamp: 1 },
      { id: 'a1', role: 'assistant', sender: 'Alice', text: 'hi', timestamp: 2 }
    ],
    enabledAgents: []
  });

  assert.match(service.buildManualSummaryPrompt(session), /当前会话消息数：2/);
  assert.equal(
    service.buildNoEnabledAgentsNotice(session, ['Alice']),
    'Alice 已停用，当前会话还没有可用智能体，请先启用上方智能体。'
  );
  assert.equal(
    service.buildNoEnabledAgentsNotice(session),
    '当前会话还没有启用智能体，请先启用上方智能体。'
  );
  assert.equal(
    service.buildNoEnabledAgentsNotice(createSession({ enabledAgents: ['Alice'] })),
    '当前会话没有可用智能体，请先启用上方智能体。'
  );
});
