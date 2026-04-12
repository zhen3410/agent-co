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

function createRuntimeStub(overrides = {}) {
  const invocationTasks = new Map((overrides.invocationTasks || []).map(task => [task.id, { ...task }]));
  const activeExecutions = new Map((overrides.activeExecutions || []).map(entry => [
    `${entry.userKey}:${entry.sessionId}`,
    { ...entry.execution }
  ]));
  const invocationLaneTasks = new Map();
  const invocationLanes = new Map();
  const createdInvocationTasks = [];
  const appendedLogs = [];
  const appendedEvents = [];
  let nextSeq = 1;

  function getLaneKey(sessionId, agentName) {
    return `${sessionId}::${agentName}`;
  }

  function applyInvocationLaneEvent(event) {
    const payload = event.payload || {};
    const queueTaskId = payload.queueTaskId;
    const agentName = payload.agentName;
    if (!queueTaskId || !agentName) return;
    const laneKey = payload.laneKey || getLaneKey(event.sessionId, agentName);
    let lane = invocationLanes.get(laneKey);
    if (!lane) {
      lane = {
        laneKey,
        sessionId: event.sessionId,
        agentName,
        runningTaskId: null,
        queuedTaskIds: [],
        version: 0,
        updatedAt: Date.now()
      };
      invocationLanes.set(laneKey, lane);
    }
    lane.version += 1;
    lane.updatedAt = Date.now();

    if (event.eventType === 'agent_invocation_enqueued') {
      if (!invocationLaneTasks.has(queueTaskId)) {
        invocationLaneTasks.set(queueTaskId, {
          queueTaskId,
          laneKey,
          sessionId: event.sessionId,
          agentName,
          status: 'queued',
          aheadCount: payload.aheadCount || 0,
          queuedAt: Date.now()
        });
        lane.queuedTaskIds.push(queueTaskId);
      }
      return;
    }

    const task = invocationLaneTasks.get(queueTaskId);
    if (!task) return;
    if (event.eventType === 'agent_invocation_started') {
      task.status = 'running';
      lane.queuedTaskIds = lane.queuedTaskIds.filter(id => id !== queueTaskId);
      lane.runningTaskId = queueTaskId;
      return;
    }
    if (event.eventType === 'agent_invocation_completed' || event.eventType === 'agent_invocation_failed' || event.eventType === 'agent_invocation_cancelled') {
      task.status = event.eventType === 'agent_invocation_completed' ? 'completed' : event.eventType === 'agent_invocation_failed' ? 'failed' : 'cancelled';
      lane.queuedTaskIds = lane.queuedTaskIds.filter(id => id !== queueTaskId);
      if (lane.runningTaskId === queueTaskId) lane.runningTaskId = null;
    }
  }

  return {
    createdInvocationTasks,
    appendedLogs,
    appendedEvents,
    runtime: {
      normalizeDispatchKind(value) {
        return value || 'initial';
      },
      isChainedDispatchKind(dispatchKind) {
        return dispatchKind === 'explicit_chained' || dispatchKind === 'implicit_chained';
      },
      buildSessionResponse() {
        return {
          agentChainMaxHops: 8,
          agentChainMaxCallsPerAgent: null,
          discussionMode: overrides.discussionMode || 'peer'
        };
      },
      appendOperationalLog(level, dependency, message) {
        appendedLogs.push({ level, dependency, message });
      },
      listInvocationTasks() {
        return Array.from(invocationTasks.values()).map(task => ({ ...task }));
      },
      updateInvocationTask(_userKey, _sessionId, taskId, patch) {
        const current = invocationTasks.get(taskId);
        if (!current) return null;
        const next = { ...current, ...patch, updatedAt: Date.now() };
        invocationTasks.set(taskId, next);
        return { ...next };
      },
      markInvocationTaskFailed(_userKey, _sessionId, taskId, reason) {
        const current = invocationTasks.get(taskId);
        if (!current) return null;
        const next = { ...current, status: 'failed', failureReason: reason, failedAt: Date.now(), updatedAt: Date.now() };
        invocationTasks.set(taskId, next);
        return { ...next };
      },
      resolveOverdueInvocationTasks() {
        return [];
      },
      createInvocationTask(_userKey, _sessionId, task) {
        createdInvocationTasks.push({ ...task });
        invocationTasks.set(task.id, { ...task });
        return { ...task };
      },
      appendAgentEvent(sessionId, draft) {
        const event = {
          eventId: `evt-${nextSeq}`,
          sessionId,
          seq: nextSeq++,
          actorType: 'agent',
          actorId: draft.actorId || null,
          actorName: draft.actorName || null,
          eventType: draft.eventType,
          payload: draft.payload || {},
          metadata: draft.metadata,
          correlationId: draft.correlationId,
          causationId: draft.causationId,
          causedByEventId: draft.causedByEventId,
          causedBySeq: draft.causedBySeq,
          createdAt: new Date().toISOString()
        };
        appendedEvents.push(event);
        applyInvocationLaneEvent(event);
        return event;
      },
      getInvocationLane(sessionId, agentName) {
        return invocationLanes.get(getLaneKey(sessionId, agentName)) || null;
      },
      getInvocationLaneTask(queueTaskId) {
        return invocationLaneTasks.get(queueTaskId) || null;
      },
      listInvocationLanes(sessionId) {
        return Array.from(invocationLanes.values()).filter(item => item.sessionId === sessionId);
      },
      getActiveExecution(userKey, sessionId) {
        return activeExecutions.get(`${userKey}:${sessionId}`) || null;
      }
    }
  };
}

function createSessionServiceStub() {
  const appendedMessages = [];
  let discussionState = null;
  return {
    appendedMessages,
    getEnabledAgents(session) {
      return session.enabledAgents || [];
    },
    appendMessage(_session, message) {
      appendedMessages.push({ ...message });
    },
    setDiscussionState(_session, nextState) {
      discussionState = nextState;
    },
    getDiscussionState() {
      return discussionState;
    }
  };
}

function createAgentManagerStub() {
  return {
    extractMentions() {
      return [];
    },
    extractChainInvocations(text) {
      return [];
    },
    hasAgent(name) {
      return ['Alice', 'Bob', 'Carol'].includes(name);
    }
  };
}

test('stale internal review 在 reviewVersion 不匹配时会被忽略而不会打坏任务状态', async () => {
  const { createChatDispatchOrchestrator } = requireBuiltModule('chat', 'application', 'chat-dispatch-orchestrator.js');
  const { runtime } = createRuntimeStub({
    invocationTasks: [{
      id: 'task-1',
      sessionId: 'default',
      status: 'awaiting_caller_review',
      callerAgentName: 'Alice',
      calleeAgentName: 'Bob',
      prompt: '请 Bob 给方案',
      originalPrompt: '请 Bob 给方案',
      createdAt: Date.now() - 1000,
      updatedAt: Date.now() - 500,
      retryCount: 0,
      followupCount: 0,
      reviewVersion: 2
    }]
  });
  const sessionService = createSessionServiceStub();
  const orchestrator = createChatDispatchOrchestrator({
    runtime,
    sessionService,
    agentManager: createAgentManagerStub(),
    async runAgentTask() {
      return [{
        id: 'review-msg-1',
        role: 'assistant',
        sender: 'Alice',
        text: 'accept: 这是旧 review，理论上应被忽略',
        taskId: 'task-1',
        timestamp: Date.now()
      }];
    }
  });

  const result = await orchestrator.executeAgentTurn({
    userKey: 'user-1',
    session: { id: 'default', enabledAgents: ['Alice', 'Bob'], history: [] },
    initialTasks: [],
    pendingTasks: [{
      agentName: 'Alice',
      prompt: '旧 review prompt',
      includeHistory: true,
      dispatchKind: 'internal_review',
      taskId: 'task-1',
      callerAgentName: 'Alice',
      calleeAgentName: 'Bob',
      reviewMode: 'caller_review',
      invocationTaskReviewVersion: 1
    }],
    stream: false
  });

  assert.equal(result.aiMessages.length, 0);
  assert.equal(result.pendingTasks.length, 0);
  const [task] = runtime.listInvocationTasks('user-1', 'default');
  assert.equal(task.status, 'awaiting_caller_review');
  assert.equal(task.reviewVersion, 2);
  assert.equal(task.failureReason, undefined);
});

test('caller_review 被调用者回复 invoke 回原 caller 时不会创建反向 invocationTask', async () => {
  const { createChatDispatchOrchestrator } = requireBuiltModule('chat', 'application', 'chat-dispatch-orchestrator.js');
  const { runtime, createdInvocationTasks } = createRuntimeStub({
    invocationTasks: [{
      id: 'task-1',
      sessionId: 'default',
      status: 'pending_reply',
      callerAgentName: 'Alice',
      calleeAgentName: 'Bob',
      prompt: '请 @@Bob 给出方案',
      originalPrompt: '请 @@Bob 给出方案',
      createdAt: Date.now() - 1000,
      updatedAt: Date.now() - 500,
      retryCount: 0,
      followupCount: 0,
      reviewVersion: 0
    }]
  });
  const sessionService = createSessionServiceStub();
  const orchestrator = createChatDispatchOrchestrator({
    runtime,
    sessionService,
    agentManager: createAgentManagerStub(),
    async runAgentTask({ task }) {
      if (task.dispatchKind === 'internal_review') {
        return [{
          id: 'alice-review-1',
          role: 'assistant',
          sender: 'Alice',
          text: 'accept: Bob 的方案可接受',
          taskId: 'task-1',
          timestamp: Date.now()
        }];
      }
      return [{
        id: 'bob-msg-1',
        role: 'assistant',
        sender: 'Bob',
        text: '方案如下，我想请 @@Alice 最终拍板。',
        invokeAgents: ['Alice'],
        taskId: 'task-1',
        callerAgentName: 'Alice',
        calleeAgentName: 'Bob',
        timestamp: Date.now()
      }];
    }
  });

  const result = await orchestrator.executeAgentTurn({
    userKey: 'user-1',
    session: { id: 'default', enabledAgents: ['Alice', 'Bob'], history: [] },
    initialTasks: [],
    pendingTasks: [{
      agentName: 'Bob',
      prompt: '请 @@Bob 给出方案',
      includeHistory: true,
      dispatchKind: 'explicit_chained',
      taskId: 'task-1',
      callerAgentName: 'Alice',
      calleeAgentName: 'Bob',
      reviewMode: 'caller_review'
    }],
    stream: false
  });

  const visibleMessages = result.aiMessages.filter(item => item.messageSubtype !== 'invocation_review');
  assert.equal(visibleMessages.length, 1);
  assert.equal(visibleMessages[0].sender, 'Bob');
  assert.equal(visibleMessages[0].invokeAgents, undefined);
  assert.equal(createdInvocationTasks.length, 0);
  assert.equal(result.pendingTasks.length, 0);
  const [task] = runtime.listInvocationTasks('user-1', 'default');
  assert.equal(task.status, 'completed');
});

test('显式 invokeAgents 会过滤掉当前会话未启用的 agent', async () => {
  const { createChatDispatchOrchestrator } = requireBuiltModule('chat', 'application', 'chat-dispatch-orchestrator.js');
  const { runtime, createdInvocationTasks } = createRuntimeStub();
  const sessionService = createSessionServiceStub();
  const orchestrator = createChatDispatchOrchestrator({
    runtime,
    sessionService,
    agentManager: createAgentManagerStub(),
    async runAgentTask({ task }) {
      if (task.agentName !== 'Alice') {
        return [];
      }
      return [{
        id: 'alice-msg-1',
        role: 'assistant',
        sender: 'Alice',
        text: '请 Bob 和 Carol 一起继续。',
        invokeAgents: ['Bob', 'Carol'],
        timestamp: Date.now()
      }];
    }
  });

  const result = await orchestrator.executeAgentTurn({
    userKey: 'user-1',
    session: { id: 'default', enabledAgents: ['Alice', 'Bob'], history: [] },
    initialTasks: [{
      agentName: 'Alice',
      prompt: '@Alice 请开始',
      includeHistory: true,
      dispatchKind: 'initial'
    }],
    stream: false
  });

  assert.equal(result.aiMessages.length, 1);
  assert.deepEqual(result.aiMessages[0].invokeAgents, ['Bob']);
  assert.equal(createdInvocationTasks.length, 1);
  assert.equal(createdInvocationTasks[0].calleeAgentName, 'Bob');
  assert.deepEqual(result.pendingTasks.map(task => task.agentName), []);
});

test('executeAgentTurn 对不同 agent 并行执行、对同一 agent 串行排队，并写入 lane 事件', async () => {
  const { createChatDispatchOrchestrator } = requireBuiltModule('chat', 'application', 'chat-dispatch-orchestrator.js');
  const { runtime, appendedEvents } = createRuntimeStub();
  const sessionService = createSessionServiceStub();
  const timeline = [];

  const orchestrator = createChatDispatchOrchestrator({
    runtime,
    sessionService,
    agentManager: createAgentManagerStub(),
    async runAgentTask({ task }) {
      timeline.push(`${task.prompt}:start`);
      await new Promise(resolve => setTimeout(resolve, 60));
      timeline.push(`${task.prompt}:end`);
      return [{
        id: `${task.prompt}-msg`,
        role: 'assistant',
        sender: task.agentName,
        text: task.prompt,
        timestamp: Date.now()
      }];
    }
  });

  const startedAt = Date.now();
  const result = await orchestrator.executeAgentTurn({
    userKey: 'user-1',
    session: { id: 'default', enabledAgents: ['Alice', 'Bob'], history: [] },
    initialTasks: [
      { agentName: 'Alice', prompt: 'alice-1', includeHistory: false },
      { agentName: 'Bob', prompt: 'bob-1', includeHistory: false },
      { agentName: 'Alice', prompt: 'alice-2', includeHistory: false }
    ],
    stream: false
  });
  const duration = Date.now() - startedAt;

  assert.equal(result.aiMessages.length, 3);
  assert.ok(duration < 170, `expected parallel round scheduling, got ${duration}ms`);
  assert.ok(timeline.indexOf('alice-2:start') > timeline.indexOf('alice-1:end'));
  assert.ok(timeline.indexOf('bob-1:start') < timeline.indexOf('alice-1:end'));
  assert.deepEqual(sessionService.appendedMessages.map(item => item.sender), ['Alice', 'Alice', 'Bob']);

  const eventTypes = appendedEvents.map(event => event.eventType);
  assert.ok(eventTypes.includes('agent_invocation_enqueued'));
  assert.ok(eventTypes.includes('agent_invocation_started'));
  assert.ok(eventTypes.includes('agent_invocation_completed'));
});
