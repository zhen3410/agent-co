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
    assert.equal(response.body.latestEventSeq, 2);
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
    assert.ok(elapsedMs < 900, `expected /api/chat accepted response <900ms, got ${elapsedMs}ms`);

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
