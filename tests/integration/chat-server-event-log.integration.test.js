const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Readable } = require('node:stream');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createChatServerFixture } = require('./helpers/chat-server-fixture');

const repoRoot = join(__dirname, '..', '..');

function requireBuiltModule(...segments) {
  const modulePath = join(repoRoot, 'dist', ...segments);
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function createRuntimeFixture(agentNames = ['Alice', 'Bob']) {
  const { createChatRuntime } = requireBuiltModule('chat', 'runtime', 'chat-runtime.js');
  return createChatRuntime({
    redisUrl: 'redis://127.0.0.1:6379',
    redisConfigKey: 'test:event-log:config',
    defaultRedisChatSessionsKey: 'test:event-log:sessions',
    redisPersistDebounceMs: 20,
    redisRequired: false,
    redisDisabled: true,
    envRedisChatSessionsKey: '',
    defaultChatSessionId: 'default',
    defaultChatSessionName: '默认会话',
    defaultAgentChainMaxHops: 4,
    dependencyStatusLogLimit: 20,
    getValidAgentNames: () => agentNames
  });
}

function createJsonRequest({ method = 'POST', url = '/', headers = {}, body } = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const req = Readable.from(payload ? [payload] : []);
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    getHeader(name) {
      return this.headers[name];
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = { ...this.headers, ...headers };
    },
    end(chunk = '') {
      this.body = String(chunk);
    }
  };
}

function createDispatchHarness() {
  const runtime = createRuntimeFixture(['Alice', 'Bob']);
  const { createSessionService } = requireBuiltModule('chat', 'application', 'session-service.js');
  const { createChatDispatchOrchestrator } = requireBuiltModule('chat', 'application', 'chat-dispatch-orchestrator.js');
  const { AgentManager } = requireBuiltModule('agent-manager.js');

  const sessionService = createSessionService({
    runtime,
    hasAgent: (agentName) => agentName === 'Alice' || agentName === 'Bob'
  });
  const agentManager = new AgentManager([
    {
      name: 'Alice',
      avatar: '🤖',
      personality: 'Alice',
      color: '#3b82f6',
      executionMode: 'api',
      apiConnectionId: 'conn-1',
      apiModel: 'gpt-4.1-mini',
      apiTemperature: 0.3,
      apiMaxTokens: 64,
      systemPrompt: '你是 Alice'
    },
    {
      name: 'Bob',
      avatar: '🧠',
      personality: 'Bob',
      color: '#22c55e',
      executionMode: 'api',
      apiConnectionId: 'conn-1',
      apiModel: 'gpt-4.1-mini',
      apiTemperature: 0.3,
      apiMaxTokens: 64,
      systemPrompt: '你是 Bob'
    }
  ]);

  const userKey = 'integration-user';
  const session = runtime.resolveActiveSession(userKey);
  runtime.setSessionEnabledAgent(userKey, session.id, 'Alice', true);
  runtime.setSessionEnabledAgent(userKey, session.id, 'Bob', true);

  return {
    runtime,
    sessionService,
    agentManager,
    userKey,
    session,
    createOrchestrator(runAgentTask) {
      return createChatDispatchOrchestrator({
        runtime,
        sessionService,
        agentManager,
        runAgentTask
      });
    }
  };
}

function writeApiConnectionStore(tempDir, apiConnections) {
  const filePath = join(tempDir, 'api-connections.json');
  writeFileSync(filePath, JSON.stringify({ apiConnections, updatedAt: Date.now() }, null, 2), 'utf8');
  return filePath;
}

async function createDelayedOpenAICompatibleStub(delayMs = 1200) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }

    const rawBody = Buffer.concat(chunks).toString('utf8');
    requests.push({ method: req.method, url: req.url, body: rawBody ? JSON.parse(rawBody) : null });

    await new Promise(resolve => setTimeout(resolve, delayMs));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: '延迟回复'
          }
        }
      ]
    }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    requests,
    async close() {
      await new Promise((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
    }
  };
}

async function enableAgent(fixture, agentName) {
  const response = await fixture.request('/api/session-agents', {
    method: 'POST',
    body: { agentName, enabled: true }
  });
  assert.equal(response.status, 200);
}

test('POST /api/chat 返回 accepted 风格响应并附带 session 与 latestEventSeq', async () => {
  const fixture = await createChatServerFixture();

  try {
    const login = await fixture.login();
    assert.equal(login.status, 200);

    const response = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '第一条命令消息' }
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.accepted, true);
    assert.equal(typeof response.body.session?.id, 'string');
    assert.ok(Number.isInteger(response.body.latestEventSeq));
    assert.ok(response.body.latestEventSeq >= 1);
    assert.equal(Object.prototype.hasOwnProperty.call(response.body, 'aiMessages'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(response.body, 'userMessage'), false);

    const history = await fixture.request('/api/history');
    assert.equal(history.status, 200);
    assert.equal(history.body.messages.length, 1);
    assert.equal(history.body.messages[0].role, 'user');
    assert.equal(history.body.messages[0].text, '第一条命令消息');
  } finally {
    await fixture.cleanup();
  }
});

test('POST /api/chat 不等待可见回复，且 /api/chat-stream 已移除', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-task6-accepted-'));
  const apiStub = await createDelayedOpenAICompatibleStub(1400);
  const connectionFile = writeApiConnectionStore(tempDir, [{
    id: 'conn-1',
    name: 'Delayed Gateway',
    baseURL: apiStub.baseURL,
    apiKey: 'sk-test-delay',
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }]);
  const agentDataFile = join(tempDir, 'agents.json');
  writeFileSync(agentDataFile, JSON.stringify({
    activeAgents: [
      {
        name: 'Alice',
        avatar: '🤖',
        personality: '慢速 API 智能体',
        systemPrompt: '你是 Alice',
        color: '#3b82f6',
        executionMode: 'api',
        apiConnectionId: 'conn-1',
        apiModel: 'gpt-4.1-mini',
        apiTemperature: 0.3,
        apiMaxTokens: 64
      }
    ],
    pendingAgents: null,
    pendingReason: null,
    updatedAt: Date.now(),
    pendingUpdatedAt: null
  }, null, 2), 'utf8');

  const fixture = await createChatServerFixture({
    env: {
      AGENT_DATA_FILE: agentDataFile,
      MODEL_CONNECTION_DATA_FILE: connectionFile
    }
  });

  try {
    const login = await fixture.login();
    assert.equal(login.status, 200);
    await enableAgent(fixture, 'Alice');

    const startedAt = Date.now();
    const response = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice 这条消息不该等待完整回复' }
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(response.status, 200);
    assert.equal(response.body.accepted, true);
    assert.ok(elapsedMs < 1400, `expected /api/chat accepted response to return before the delayed upstream reply, got ${elapsedMs}ms`);

    const streamResponse = await fixture.request('/api/chat-stream', {
      method: 'POST',
      body: { message: 'stream route should be removed' }
    });
    assert.equal(streamResponse.status, 404);

    let historyHasAssistant = false;
    const waitDeadline = Date.now() + 5000;
    while (Date.now() < waitDeadline) {
      const history = await fixture.request('/api/history');
      if (history.status === 200 && history.body.messages.some(item => item.role === 'assistant' && item.sender === 'Alice')) {
        historyHasAssistant = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    assert.equal(historyHasAssistant, true, 'background execution should still append assistant message');
  } finally {
    await fixture.cleanup();
    await apiStub.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('executeAgentTurn 会写入任务编排生命周期 canonical events（含 review）', async () => {
  const harness = createDispatchHarness();
  const orchestrator = harness.createOrchestrator(async ({ task }) => {
    if ((task.dispatchKind || 'initial') === 'initial' && task.agentName === 'Alice') {
      return [{
        id: 'm-alice-initial',
        role: 'assistant',
        sender: 'Alice',
        text: '请 @@Bob 给出三步落地方案',
        timestamp: Date.now()
      }];
    }

    if (task.dispatchKind === 'explicit_chained' && task.agentName === 'Bob') {
      return [{
        id: `m-bob-${task.taskId || 'reply'}`,
        role: 'assistant',
        sender: 'Bob',
        text: '1. 建表 2. 开发接口 3. 回归验证',
        timestamp: Date.now(),
        taskId: task.taskId,
        callerAgentName: task.callerAgentName,
        calleeAgentName: task.calleeAgentName
      }];
    }

    if (task.dispatchKind === 'internal_review' && task.agentName === 'Alice') {
      return [{
        id: `m-review-${task.taskId || 'accept'}`,
        role: 'assistant',
        sender: 'Alice',
        text: 'accept: Bob 已给出可执行结果。',
        timestamp: Date.now(),
        taskId: task.taskId,
        callerAgentName: task.callerAgentName,
        calleeAgentName: task.calleeAgentName
      }];
    }

    return [];
  });

  await orchestrator.executeAgentTurn({
    userKey: harness.userKey,
    session: harness.session,
    initialTasks: [{
      agentName: 'Alice',
      prompt: '请 @@Bob 给出三步落地方案',
      includeHistory: true
    }],
    stream: false
  });

  const events = harness.runtime.listSessionEvents(harness.session.id);
  const eventTypes = new Set(events.map(event => event.eventType));

  assert.equal(eventTypes.has('message_thinking_started'), true);
  assert.equal(eventTypes.has('message_thinking_finished'), true);
  assert.equal(eventTypes.has('agent_message_created'), true);
  assert.equal(eventTypes.has('dispatch_task_created'), true);
  assert.equal(eventTypes.has('agent_review_requested'), true);
  assert.equal(eventTypes.has('agent_review_submitted'), true);
  assert.equal(eventTypes.has('dispatch_task_completed'), true);

  const completedEvent = events.find(event => event.eventType === 'dispatch_task_completed' && event.payload && event.payload.outcome === 'completed');
  assert.ok(completedEvent, '应包含 task completed 事件');
});

test('review 解析失败会写入 task failed canonical event', async () => {
  const harness = createDispatchHarness();
  const orchestrator = harness.createOrchestrator(async ({ task }) => {
    if ((task.dispatchKind || 'initial') === 'initial' && task.agentName === 'Alice') {
      return [{
        id: 'm-fail-alice',
        role: 'assistant',
        sender: 'Alice',
        text: '请 @@Bob 给出方案',
        timestamp: Date.now()
      }];
    }

    if (task.dispatchKind === 'explicit_chained' && task.agentName === 'Bob') {
      return [{
        id: `m-fail-bob-${task.taskId || 'reply'}`,
        role: 'assistant',
        sender: 'Bob',
        text: '我先占位，稍后补充。',
        timestamp: Date.now(),
        taskId: task.taskId,
        callerAgentName: task.callerAgentName,
        calleeAgentName: task.calleeAgentName
      }];
    }

    if (task.dispatchKind === 'internal_review' && task.agentName === 'Alice') {
      return [{
        id: `m-fail-review-${task.taskId || 'invalid'}`,
        role: 'assistant',
        sender: 'Alice',
        text: '这不是有效格式',
        timestamp: Date.now(),
        taskId: task.taskId,
        callerAgentName: task.callerAgentName,
        calleeAgentName: task.calleeAgentName
      }];
    }

    return [];
  });

  await orchestrator.executeAgentTurn({
    userKey: harness.userKey,
    session: harness.session,
    initialTasks: [{
      agentName: 'Alice',
      prompt: '请 @@Bob 给出方案',
      includeHistory: true
    }],
    stream: false
  });

  const events = harness.runtime.listSessionEvents(harness.session.id);
  const failedEvent = events.find(event => event.eventType === 'dispatch_task_completed' && event.payload && event.payload.outcome === 'failed');
  assert.ok(failedEvent, '应包含 task failed 事件');
});

test('callback-routes 会将 callback 消息写为 canonical events', async () => {
  const runtime = createRuntimeFixture(['Alice', 'Bob']);
  const { handleCallbackRoutes } = requireBuiltModule('chat', 'http', 'callback-routes.js');
  const userKey = 'callback-user';
  const session = runtime.resolveActiveSession(userKey);

  const req = createJsonRequest({
    method: 'POST',
    url: '/api/callbacks/post-message',
    headers: {
      authorization: 'Bearer callback-token',
      'x-agent-co-callback-token': 'callback-token',
      'x-agent-co-session-id': session.id,
      'x-agent-co-agent': 'Alice'
    },
    body: {
      content: '我已完成开发，请 @Reviewer 做 Code Review。',
      invokeAgents: ['Bob']
    }
  });
  const res = createMockResponse();

  const handled = await handleCallbackRoutes(req, res, new URL('http://127.0.0.1/api/callbacks/post-message'), {
    callbackAuthToken: 'callback-token',
    callbackAuthHeader: 'x-agent-co-callback-token',
    chatService: {
      postCallbackMessage() {
        return { status: 'ok' };
      }
    },
    runtime
  });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);

  const events = runtime.listSessionEvents(session.id);
  assert.equal(events.some(event => event.eventType === 'agent_message_created'), true);
  assert.equal(events.some(event => event.eventType === 'dispatch_task_created'), true);
});

test('GET /api/sessions/:id/events 返回事件并支持 afterSeq', async () => {
  const fixture = await createChatServerFixture();

  try {
    const login = await fixture.login();
    assert.equal(login.status, 200);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '事件日志查询测试' }
    });
    assert.equal(chatResponse.status, 200);
    const sessionId = chatResponse.body.session?.id;
    assert.equal(typeof sessionId, 'string');

    const eventsResponse = await fixture.request(`/api/sessions/${sessionId}/events`);
    assert.equal(eventsResponse.status, 200);
    const eventsBody = eventsResponse.body;
    assert.ok(eventsBody && Array.isArray(eventsBody.events));
    assert.ok(eventsBody.events.length > 0);

    const filteredResponse = await fixture.request(`/api/sessions/${sessionId}/events?afterSeq=999999999`);
    assert.equal(filteredResponse.status, 200);
    const filteredBody = filteredResponse.body;
    assert.ok(filteredBody && Array.isArray(filteredBody.events));
    assert.equal(filteredBody.events.length, 0);
  } finally {
    await fixture.cleanup();
  }
});

test('GET /api/sessions/:id/events 拒绝 unsafe afterSeq 游标', async () => {
  const fixture = await createChatServerFixture();

  try {
    const login = await fixture.login();
    assert.equal(login.status, 200);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '安全游标测试' }
    });
    assert.equal(chatResponse.status, 200);
    const sessionId = chatResponse.body.session?.id;
    assert.equal(typeof sessionId, 'string');

    const unsafeCursor = Number.MAX_SAFE_INTEGER + 1;
    const unsafeResponse = await fixture.request(`/api/sessions/${sessionId}/events?afterSeq=${unsafeCursor}`);
    assert.equal(unsafeResponse.status, 400);
    assert.ok(typeof unsafeResponse.body?.error === 'string');
    assert.ok(unsafeResponse.body.error.includes('afterSeq'));
  } finally {
    await fixture.cleanup();
  }
});

test('GET /api/sessions/:id/timeline 返回事件时间线', async () => {
  const fixture = await createChatServerFixture();

  try {
    const login = await fixture.login();
    assert.equal(login.status, 200);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '时间线查询测试' }
    });
    assert.equal(chatResponse.status, 200);
    const sessionId = chatResponse.body.session?.id;
    assert.equal(typeof sessionId, 'string');

    const timelineResponse = await fixture.request(`/api/sessions/${sessionId}/timeline`);
    assert.equal(timelineResponse.status, 200);
    const timelineBody = timelineResponse.body;
    assert.ok(timelineBody && Array.isArray(timelineBody.timeline));
    assert.ok(timelineBody.timeline.some(row => row && row.kind === 'message'));
  } finally {
    await fixture.cleanup();
  }
});

test('GET /api/sessions/:id/timeline 支持 afterSeq 增量查询并拒绝非法游标', async () => {
  const fixture = await createChatServerFixture();

  try {
    const login = await fixture.login();
    assert.equal(login.status, 200);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '时间线增量查询测试' }
    });
    assert.equal(chatResponse.status, 200);
    const sessionId = chatResponse.body.session?.id;
    assert.equal(typeof sessionId, 'string');

    const fullTimelineResponse = await fixture.request(`/api/sessions/${sessionId}/timeline`);
    assert.equal(fullTimelineResponse.status, 200);
    const fullTimeline = fullTimelineResponse.body?.timeline;
    assert.ok(Array.isArray(fullTimeline));
    assert.ok(fullTimeline.length > 0);

    const afterSeq = fullTimeline[0].seq;
    const incrementalResponse = await fixture.request(`/api/sessions/${sessionId}/timeline?afterSeq=${afterSeq}`);
    assert.equal(incrementalResponse.status, 200);
    const incrementalTimeline = incrementalResponse.body?.timeline;
    assert.ok(Array.isArray(incrementalTimeline));
    assert.equal(incrementalTimeline.every(row => row.seq > afterSeq), true);

    const unsafeCursor = Number.MAX_SAFE_INTEGER + 1;
    const unsafeResponse = await fixture.request(`/api/sessions/${sessionId}/timeline?afterSeq=${unsafeCursor}`);
    assert.equal(unsafeResponse.status, 400);
    assert.ok(typeof unsafeResponse.body?.error === 'string');
    assert.ok(unsafeResponse.body.error.includes('afterSeq'));
  } finally {
    await fixture.cleanup();
  }
});

test('GET /api/sessions/:id/sync-status 返回会话同步观测信息（含空会话契约）', async () => {
  const fixture = await createChatServerFixture();

  try {
    const login = await fixture.login();
    assert.equal(login.status, 200);

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'empty-sync-session' }
    });
    assert.equal(createResponse.status, 200);
    const emptySessionId = createResponse.body?.session?.id;
    assert.equal(typeof emptySessionId, 'string');

    const emptySync = await fixture.request(`/api/sessions/${emptySessionId}/sync-status`);
    assert.equal(emptySync.status, 200);
    assert.equal(emptySync.body?.latestEventSeq, 0);
    assert.equal(emptySync.body?.latestTimelineSeq, null);
    assert.equal(emptySync.body?.timelineRowCount, 0);
    assert.ok(typeof emptySync.body?.discussionState === 'string');

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: 'sync status populated session' }
    });
    assert.equal(chatResponse.status, 200);
    const populatedSessionId = chatResponse.body.session?.id;
    assert.equal(typeof populatedSessionId, 'string');

    const populatedSync = await fixture.request(`/api/sessions/${populatedSessionId}/sync-status`);
    assert.equal(populatedSync.status, 200);
    assert.ok(Number.isInteger(populatedSync.body?.latestEventSeq));
    assert.ok(populatedSync.body.latestEventSeq >= 1);
    assert.ok(
      populatedSync.body.latestTimelineSeq === null ||
      Number.isInteger(populatedSync.body.latestTimelineSeq)
    );
    assert.ok(Number.isInteger(populatedSync.body?.timelineRowCount));
    assert.ok(populatedSync.body.timelineRowCount >= 0);
    assert.ok(typeof populatedSync.body?.discussionState === 'string');
  } finally {
    await fixture.cleanup();
  }
});

test('GET /api/sessions/:id/sync-status 延续现有会话查询路由的鉴权与不存在会话语义', async () => {
  const fixture = await createChatServerFixture();

  try {
    const unauthorized = await fixture.request('/api/sessions/default/sync-status');
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(unauthorized.body, { error: '未授权，请先登录' });

    const login = await fixture.login();
    assert.equal(login.status, 200);

    const missing = await fixture.request('/api/sessions/not-found/sync-status');
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { error: '会话不存在' });
  } finally {
    await fixture.cleanup();
  }
});

test('GET /api/sessions/:id/call-graph 返回调用图', async () => {
  const fixture = await createChatServerFixture();

  try {
    const login = await fixture.login();
    assert.equal(login.status, 200);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '调用图查询测试' }
    });
    assert.equal(chatResponse.status, 200);
    const sessionId = chatResponse.body.session?.id;
    assert.equal(typeof sessionId, 'string');

    const graphResponse = await fixture.request(`/api/sessions/${sessionId}/call-graph`);
    assert.equal(graphResponse.status, 200);
    const callGraphBody = graphResponse.body;
    assert.ok(callGraphBody && callGraphBody.callGraph);
    assert.ok(Array.isArray(callGraphBody.callGraph.nodes));
    assert.ok(Array.isArray(callGraphBody.callGraph.edges));
    assert.ok(callGraphBody.callGraph.nodes.length > 0);
  } finally {
    await fixture.cleanup();
  }
});
