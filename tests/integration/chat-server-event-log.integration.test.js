const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createChatServerFixture } = require('./helpers/chat-server-fixture');

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
