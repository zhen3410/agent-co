const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, chmodSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createChatServerFixture } = require('./helpers/chat-server-fixture');
const { createAuthAdminFixture } = require('./helpers/auth-admin-fixture');

async function enableAgents(fixture, agentNames) {
  for (const agentName of agentNames) {
    const response = await fixture.request('/api/session-agents', {
      method: 'POST',
      body: { agentName, enabled: true }
    });
    assert.equal(response.status, 200);
  }
}

async function createOpenAICompatibleStub(handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const jsonBody = rawBody ? JSON.parse(rawBody) : null;
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: jsonBody
    });
    await handler(req, res, jsonBody, requests);
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
        server.close(error => error ? reject(error) : resolve());
      });
    }
  };
}

function getRandomPort() {
  return Math.floor(Math.random() * 10000) + 30000;
}

async function waitForChatServer(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/auth-status`);
      if (response.ok) return;
      lastError = new Error(`status=${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 120));
  }

  throw new Error(`chat server failed to start: ${String(lastError)}`);
}

function parseSetCookie(setCookieHeader) {
  if (!setCookieHeader) return [];
  if (Array.isArray(setCookieHeader)) {
    return setCookieHeader.map(item => String(item).split(';')[0]);
  }

  return String(setCookieHeader)
    .split(/,(?=\s*[^;]+=)/)
    .map(item => item.trim().split(';')[0]);
}

function redisCli(args, options = {}) {
  const result = spawnSync('redis-cli', args, {
    encoding: 'utf8',
    ...options
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'redis-cli failed').trim());
  }
  return (result.stdout || '').trim();
}

async function ensureRedisTestServer() {
  try {
    const pong = redisCli(['PING']);
    if (pong === 'PONG') {
      return {
        async cleanup() {}
      };
    }
  } catch {}

  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-redis-it-'));
  const child = spawn('redis-server', [
    '--port', '6379',
    '--bind', '127.0.0.1',
    '--save', '',
    '--appendonly', 'no',
    '--dir', tempDir
  ], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const pong = redisCli(['PING']);
      if (pong === 'PONG') {
        return {
          async cleanup() {
            if (!child.killed) {
              child.kill('SIGTERM');
              await new Promise(resolve => setTimeout(resolve, 150));
              if (!child.killed) child.kill('SIGKILL');
            }
            rmSync(tempDir, { recursive: true, force: true });
          }
        };
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 120));
  }

  if (!child.killed) child.kill('SIGKILL');
  rmSync(tempDir, { recursive: true, force: true });
  throw new Error(`redis server failed to start${stderr ? `: ${stderr}` : ''}`);
}

async function createRedisBackedChatServerFixture(options = {}) {
  const redisHandle = await ensureRedisTestServer();
  const redisKey = `bot-room:chat:sessions:test:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  const previousRedisKey = redisCli(['HGET', 'bot-room:config', 'chat_sessions_key']);
  redisCli(['HSET', 'bot-room:config', 'chat_sessions_key', redisKey]);
  if (options.redisState) {
    redisCli(['SET', redisKey, JSON.stringify(options.redisState)]);
  } else {
    redisCli(['DEL', redisKey]);
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-chat-redis-it-'));
  const agentDataFile = join(tempDir, 'agents.json');
  const authFixture = await createAuthAdminFixture();
  const port = getRandomPort();
  const child = spawn('node', ['dist/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      BOT_ROOM_AUTH_ENABLED: 'true',
      BOT_ROOM_REDIS_REQUIRED: 'false',
      BOT_ROOM_DISABLE_REDIS: 'false',
      AGENT_DATA_FILE: agentDataFile,
      AUTH_ADMIN_TOKEN: 'integration-test-admin-token-1234567890',
      AUTH_ADMIN_BASE_URL: `http://127.0.0.1:${authFixture.port}`,
      BOT_ROOM_CLI_TIMEOUT_MS: '15000',
      BOT_ROOM_CLI_HEARTBEAT_TIMEOUT_MS: '5000',
      BOT_ROOM_CLI_KILL_GRACE_MS: '200',
      ...(options.env || {})
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  try {
    await waitForChatServer(port);
  } catch (error) {
    if (!child.killed) child.kill('SIGKILL');
    await authFixture.cleanup();
    if (previousRedisKey) {
      redisCli(['HSET', 'bot-room:config', 'chat_sessions_key', previousRedisKey]);
    } else {
      redisCli(['HDEL', 'bot-room:config', 'chat_sessions_key']);
    }
    redisCli(['DEL', redisKey]);
    await redisHandle.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
    throw new Error(`${error.message}\n${stderr}`);
  }

  const cookieJar = new Map();

  async function request(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    const cookieHeader = Array.from(cookieJar.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    for (const cookie of parseSetCookie(response.headers.get('set-cookie'))) {
      const [pair] = cookie.split(';');
      const [name, ...rest] = pair.split('=');
      cookieJar.set(name, rest.join('='));
    }

    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {}
    }

    return { status: response.status, body: json, text };
  }

  return {
    request,
    async login(username = 'admin', password = 'Admin1234!@#') {
      return request('/api/login', {
        method: 'POST',
        body: { username, password }
      });
    },
    async cleanup() {
      if (!child.killed) {
        child.kill('SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 150));
        if (!child.killed) child.kill('SIGKILL');
      }
      await authFixture.cleanup();
      if (previousRedisKey) {
        redisCli(['HSET', 'bot-room:config', 'chat_sessions_key', previousRedisKey]);
      } else {
        redisCli(['HDEL', 'bot-room:config', 'chat_sessions_key']);
      }
      redisCli(['DEL', redisKey]);
      await redisHandle.cleanup();
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function writeApiConnectionStore(tempDir, apiConnections) {
  const filePath = join(tempDir, 'api-connections.json');
  writeFileSync(filePath, JSON.stringify({ apiConnections, updatedAt: Date.now() }, null, 2), 'utf8');
  return filePath;
}


function createExplicitThenStopClaudeScript(tempDir) {
  const fakeClaude = join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
node - <<'EOF'
const agentName = process.env.BOT_ROOM_AGENT_NAME || 'AI';
const sessionId = process.env.BOT_ROOM_SESSION_ID || '';
const apiUrl = process.env.BOT_ROOM_API_URL || '';
const token = process.env.BOT_ROOM_CALLBACK_TOKEN || '';

async function post(content, invokeAgents) {
  const encodedAgentName = encodeURIComponent(agentName);
  const response = await fetch(new URL('/api/callbacks/post-message', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${token}\`,
      'Content-Type': 'application/json',
      'x-bot-room-callback-token': token,
      'x-bot-room-session-id': sessionId,
      'x-bot-room-agent': encodedAgentName
    },
    body: JSON.stringify({ content, invokeAgents })
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

(async () => {
  if (agentName === 'Alice') {
    await post('请 @@Bob 接力补充结论', ['Bob']);
  } else if (agentName === 'Bob') {
    await post('Bob 已补充结论，本轮不再继续');
  } else {
    await post(\`\${agentName} 已完成\`);
  }
  process.stdout.write('{"output_text":"callback sent"}\\n');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
EOF
`, 'utf8');
  chmodSync(fakeClaude, 0o755);
}

function createSingleReplyClaudeScript(tempDir) {
  const fakeClaude = join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
node - <<'EOF'
const agentName = process.env.BOT_ROOM_AGENT_NAME || 'AI';
const sessionId = process.env.BOT_ROOM_SESSION_ID || '';
const apiUrl = process.env.BOT_ROOM_API_URL || '';
const token = process.env.BOT_ROOM_CALLBACK_TOKEN || '';

async function post(content, invokeAgents) {
  const encodedAgentName = encodeURIComponent(agentName);
  const response = await fetch(new URL('/api/callbacks/post-message', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${token}\`,
      'Content-Type': 'application/json',
      'x-bot-room-callback-token': token,
      'x-bot-room-session-id': sessionId,
      'x-bot-room-agent': encodedAgentName
    },
    body: JSON.stringify({ content, invokeAgents })
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

(async () => {
  await post(\`\${agentName} 已给出阶段性意见，本轮不继续点名\`);
  process.stdout.write('{"output_text":"callback sent"}\\n');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
EOF
`, 'utf8');
  chmodSync(fakeClaude, 0o755);
}

function createManualSummaryClaudeScript(tempDir, options = {}) {
  const fakeClaude = join(tempDir, 'claude');
  const delayMs = Number(options.delayMs || 0);
  const summaryInvokeAgents = options.summaryInvokeAgents || null;
  const summaryText = options.summaryText || 'Alice 总结：当前讨论已暂停，结论如下。';
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
node - <<'EOF'
const agentName = process.env.BOT_ROOM_AGENT_NAME || 'AI';
const sessionId = process.env.BOT_ROOM_SESSION_ID || '';
const apiUrl = process.env.BOT_ROOM_API_URL || '';
const token = process.env.BOT_ROOM_CALLBACK_TOKEN || '';
const dispatchKind = process.env.BOT_ROOM_DISPATCH_KIND || 'initial';

async function post(content, invokeAgents) {
  const encodedAgentName = encodeURIComponent(agentName);
  const response = await fetch(new URL('/api/callbacks/post-message', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${token}\`,
      'Content-Type': 'application/json',
      'x-bot-room-callback-token': token,
      'x-bot-room-session-id': sessionId,
      'x-bot-room-agent': encodedAgentName
    },
    body: JSON.stringify({ content, invokeAgents })
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

async function sleep(ms) {
  if (!ms) return;
  await new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  if (dispatchKind === 'summary') {
    await sleep(${delayMs});
    await post(${JSON.stringify(summaryText)}, ${summaryInvokeAgents ? JSON.stringify(summaryInvokeAgents) : 'undefined'});
  } else {
    await post(\`\${agentName} 已给出阶段性意见，本轮不继续点名\`);
  }
  process.stdout.write('{"output_text":"callback sent"}\\n');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
EOF
`, 'utf8');
  chmodSync(fakeClaude, 0o755);
}

function createMultiVisiblePartialChainClaudeScript(tempDir) {
  const fakeClaude = join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
node - <<'EOF'
const agentName = process.env.BOT_ROOM_AGENT_NAME || 'AI';
const sessionId = process.env.BOT_ROOM_SESSION_ID || '';
const apiUrl = process.env.BOT_ROOM_API_URL || '';
const token = process.env.BOT_ROOM_CALLBACK_TOKEN || '';

async function post(content, invokeAgents) {
  const encodedAgentName = encodeURIComponent(agentName);
  const response = await fetch(new URL('/api/callbacks/post-message', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${token}\`,
      'Content-Type': 'application/json',
      'x-bot-room-callback-token': token,
      'x-bot-room-session-id': sessionId,
      'x-bot-room-agent': encodedAgentName
    },
    body: JSON.stringify({ content, invokeAgents })
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

(async () => {
  if (agentName === 'Alice') {
    await post('请 @@Bob 接力补充', ['Bob']);
    await post('Alice 额外补充一句，但不再继续点名');
  } else if (agentName === 'Bob') {
    process.stdout.write('{"output_text":""}\\n');
    return;
  } else {
    await post(\`\${agentName} 已完成\`);
  }
  process.stdout.write('{"output_text":"callback sent"}\\n');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
EOF
`, 'utf8');
  chmodSync(fakeClaude, 0o755);
}

function createCyclingClaudeScript(tempDir) {
  const fakeClaude = join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
node - <<'EOF'
const agentName = process.env.BOT_ROOM_AGENT_NAME || 'AI';
const sessionId = process.env.BOT_ROOM_SESSION_ID || '';
const apiUrl = process.env.BOT_ROOM_API_URL || '';
const token = process.env.BOT_ROOM_CALLBACK_TOKEN || '';

async function post(content, invokeAgents) {
  const encodedAgentName = encodeURIComponent(agentName);
  const response = await fetch(new URL('/api/callbacks/post-message', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${token}\`,
      'Content-Type': 'application/json',
      'x-bot-room-callback-token': token,
      'x-bot-room-session-id': sessionId,
      'x-bot-room-agent': encodedAgentName
    },
    body: JSON.stringify({ content, invokeAgents })
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

(async () => {
  if (agentName === 'Alice') {
    await post('继续', ['Bob']);
  } else if (agentName === 'Bob') {
    await post('继续', ['Alice']);
  } else {
    await post(\`\${agentName} 已完成\`);
  }
  process.stdout.write('{"output_text":"callback sent"}\\n');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
EOF
`, 'utf8');
  chmodSync(fakeClaude, 0o755);
}

test('统一 agent 调用入口会通过 CLI provider 返回结果', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-agent-invoker-cli-'));
  const fakeClaude = join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
printf '%s\n' '{"output_text":"CLI provider reply"}'
`, 'utf8');
  chmodSync(fakeClaude, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${tempDir}:${originalPath || ''}`;

  try {
    const { invokeAgent } = require('../../dist/agent-invoker.js');
    const result = await invokeAgent({
      userMessage: '你好',
      agent: {
        name: 'Alice',
        avatar: '🤖',
        systemPrompt: '你是 Alice',
        color: '#fff',
        executionMode: 'cli',
        cliName: 'claude'
      },
      history: [],
      includeHistory: true
    });

    assert.equal(result.text, 'CLI provider reply');
    assert.deepEqual(result.blocks, []);
  } finally {
    process.env.PATH = originalPath;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

async function waitForCondition(check, timeoutMs = 3000, intervalMs = 80) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await check();
    if (lastValue) {
      return lastValue;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error('condition not met before timeout');
}

test('统一 agent 调用入口在 api 模式下会调用 OpenAI-compatible provider 并解析结果', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-agent-invoker-api-success-'));
  const stub = await createOpenAICompatibleStub((req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/chat/completions');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-test',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'API provider reply\n\n```cc_rich\n{"kind":"card","title":"摘要","body":"已完成","tone":"success"}\n```'
          }
        }
      ],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 7,
        total_tokens: 19
      }
    }));
  });

  const connectionFile = writeApiConnectionStore(tempDir, [{
    id: 'conn-1',
    name: 'Gateway',
    baseURL: stub.baseURL,
    apiKey: 'sk-test-123',
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }]);

  const originalConnectionFile = process.env.MODEL_CONNECTION_DATA_FILE;

  try {
    process.env.MODEL_CONNECTION_DATA_FILE = connectionFile;
    const { invokeAgent } = require('../../dist/agent-invoker.js');
    const result = await invokeAgent({
      userMessage: '你好',
      agent: {
        name: 'Alice',
        avatar: '🤖',
        systemPrompt: '你是 Alice',
        color: '#fff',
        executionMode: 'api',
        apiConnectionId: 'conn-1',
        apiModel: 'gpt-4.1',
        apiTemperature: 0.7,
        apiMaxTokens: 2000
      },
      history: [
        {
          id: 'm1',
          role: 'assistant',
          sender: 'Alice',
          text: '上一轮回复',
          timestamp: Date.now() - 1000
        }
      ],
      includeHistory: true
    });

    assert.equal(result.text, 'API provider reply');
    assert.match(result.rawText || '', /cc_rich/);
    assert.equal(result.finishReason, 'stop');
    assert.deepEqual(result.usage, {
      inputTokens: 12,
      outputTokens: 7,
      totalTokens: 19
    });
    assert.deepEqual(result.blocks, [{
      id: 'card:摘要',
      kind: 'card',
      title: '摘要',
      body: '已完成',
      tone: 'success'
    }]);

    assert.equal(stub.requests.length, 1);
    assert.equal(stub.requests[0].headers.authorization, 'Bearer sk-test-123');
    assert.deepEqual(stub.requests[0].body, {
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: '你是 Alice' },
        { role: 'assistant', content: '上一轮回复' },
        { role: 'user', content: '你好' }
      ],
      temperature: 0.7,
      max_tokens: 2000,
      stream: false
    });
  } finally {
    process.env.MODEL_CONNECTION_DATA_FILE = originalConnectionFile;
    await stub.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('统一 agent 调用入口在 api 模式下支持流式增量，并忽略 reasoning_content', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-agent-invoker-api-stream-'));
  const stub = await createOpenAICompatibleStub((req, res) => {
    assert.equal(req.method, 'POST');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"先思考"}}]}\n\n');
    res.write('data: {"choices":[{"index":0,"delta":{"content":"你好"}}]}\n\n');
    res.write('data: {"choices":[{"index":0,"delta":{"content":"，世界"}}]}\n\n');
    res.write('data: {"choices":[{"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":9,"completion_tokens":4,"total_tokens":13}}\n\n');
    res.end('data: [DONE]\n\n');
  });

  const connectionFile = writeApiConnectionStore(tempDir, [{
    id: 'conn-1',
    name: 'Gateway',
    baseURL: stub.baseURL,
    apiKey: 'sk-test-123',
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }]);
  const originalConnectionFile = process.env.MODEL_CONNECTION_DATA_FILE;

  try {
    process.env.MODEL_CONNECTION_DATA_FILE = connectionFile;
    const { invokeAgent } = require('../../dist/agent-invoker.js');
    const deltas = [];
    const result = await invokeAgent({
      userMessage: '你好',
      agent: {
        name: 'Alice',
        avatar: '🤖',
        systemPrompt: '你是 Alice',
        color: '#fff',
        executionMode: 'api',
        apiConnectionId: 'conn-1',
        apiModel: 'glm-5.1',
        apiTemperature: 0.3,
        apiMaxTokens: 2048
      },
      history: [],
      includeHistory: true,
      onTextDelta: (delta) => {
        deltas.push(delta);
      }
    });

    assert.equal(result.text, '你好，世界');
    assert.equal(result.rawText, '你好，世界');
    assert.equal(result.finishReason, 'stop');
    assert.deepEqual(result.usage, {
      inputTokens: 9,
      outputTokens: 4,
      totalTokens: 13
    });
    assert.deepEqual(deltas, ['你好', '，世界']);
    assert.equal(stub.requests[0].body.stream, true);
  } finally {
    process.env.MODEL_CONNECTION_DATA_FILE = originalConnectionFile;
    await stub.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('统一 agent 调用入口在 api 模式下构造 history 时不会重复附加当前用户消息，且会过滤失败回退文本', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-agent-invoker-api-history-filter-'));
  const stub = await createOpenAICompatibleStub((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{
        index: 0,
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: '收到'
        }
      }]
    }));
  });

  const connectionFile = writeApiConnectionStore(tempDir, [{
    id: 'conn-1',
    name: 'Gateway',
    baseURL: stub.baseURL,
    apiKey: 'sk-test-123',
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }]);
  const originalConnectionFile = process.env.MODEL_CONNECTION_DATA_FILE;

  try {
    process.env.MODEL_CONNECTION_DATA_FILE = connectionFile;
    const { invokeAgent } = require('../../dist/agent-invoker.js');
    await invokeAgent({
      userMessage: '你读取到的会话记录是什么',
      agent: {
        name: 'Alice',
        avatar: '🤖',
        systemPrompt: '你是 Alice',
        color: '#fff',
        executionMode: 'api',
        apiConnectionId: 'conn-1',
        apiModel: 'gpt-4.1',
        apiTemperature: 0.3,
        apiMaxTokens: 2048
      },
      history: [
        {
          id: 'u1',
          role: 'user',
          sender: '用户',
          text: '@智谱专家 hi',
          timestamp: Date.now() - 5000
        },
        {
          id: 'a1',
          role: 'assistant',
          sender: '智谱专家',
          text: '你好。我是智谱专家。',
          timestamp: Date.now() - 4000
        },
        {
          id: 'a2',
          role: 'assistant',
          sender: '智谱专家',
          text: 'API 调用失败：API provider 返回了不兼容的响应：缺少 choices[0].message.content',
          timestamp: Date.now() - 3000
        },
        {
          id: 'u2',
          role: 'user',
          sender: '用户',
          text: '你读取到的会话记录是什么',
          timestamp: Date.now() - 2000
        }
      ],
      includeHistory: true
    });

    assert.deepEqual(stub.requests[0].body.messages, [
      { role: 'system', content: '你是 Alice' },
      { role: 'user', content: '@智谱专家 hi' },
      { role: 'assistant', content: '你好。我是智谱专家。' },
      { role: 'user', content: '你读取到的会话记录是什么' }
    ]);
  } finally {
    process.env.MODEL_CONNECTION_DATA_FILE = originalConnectionFile;
    await stub.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('统一 agent 调用入口在 api 模式下会对 401/403 返回明确错误', async () => {
  for (const statusCode of [401, 403]) {
    const tempDir = mkdtempSync(join(tmpdir(), `bot-room-agent-invoker-api-auth-${statusCode}-`));
    const stub = await createOpenAICompatibleStub((req, res) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `auth failed ${statusCode}` } }));
    });
    const connectionFile = writeApiConnectionStore(tempDir, [{
      id: 'conn-1',
      name: 'Gateway',
      baseURL: stub.baseURL,
      apiKey: 'sk-test-123',
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }]);
    const originalConnectionFile = process.env.MODEL_CONNECTION_DATA_FILE;

    try {
      process.env.MODEL_CONNECTION_DATA_FILE = connectionFile;
      const { invokeAgent } = require('../../dist/agent-invoker.js');
      await assert.rejects(
        () => invokeAgent({
          userMessage: '你好',
          agent: {
            name: 'Alice',
            avatar: '🤖',
            systemPrompt: '你是 Alice',
            color: '#fff',
            executionMode: 'api',
            apiConnectionId: 'conn-1',
            apiModel: 'gpt-4.1'
          },
          history: [],
          includeHistory: true
        }),
        new RegExp(`API provider 鉴权失败.*${statusCode}.*auth failed ${statusCode}`)
      );
    } finally {
      process.env.MODEL_CONNECTION_DATA_FILE = originalConnectionFile;
      await stub.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test('统一 agent 调用入口在 api 模式下会对 429/500 返回明确错误', async () => {
  for (const statusCode of [429, 500]) {
    const tempDir = mkdtempSync(join(tmpdir(), `bot-room-agent-invoker-api-upstream-${statusCode}-`));
    const stub = await createOpenAICompatibleStub((req, res) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `upstream failed ${statusCode}` } }));
    });
    const connectionFile = writeApiConnectionStore(tempDir, [{
      id: 'conn-1',
      name: 'Gateway',
      baseURL: stub.baseURL,
      apiKey: 'sk-test-123',
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }]);
    const originalConnectionFile = process.env.MODEL_CONNECTION_DATA_FILE;

    try {
      process.env.MODEL_CONNECTION_DATA_FILE = connectionFile;
      const { invokeAgent } = require('../../dist/agent-invoker.js');
      await assert.rejects(
        () => invokeAgent({
          userMessage: '你好',
          agent: {
            name: 'Alice',
            avatar: '🤖',
            systemPrompt: '你是 Alice',
            color: '#fff',
            executionMode: 'api',
            apiConnectionId: 'conn-1',
            apiModel: 'gpt-4.1'
          },
          history: [],
          includeHistory: true
        }),
        new RegExp(`API provider 请求失败.*${statusCode}.*upstream failed ${statusCode}`)
      );
    } finally {
      process.env.MODEL_CONNECTION_DATA_FILE = originalConnectionFile;
      await stub.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test('统一 agent 调用入口在 api 模式下会对不兼容响应返回可诊断错误', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-agent-invoker-api-invalid-body-'));
  const stub = await createOpenAICompatibleStub((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant' } }] }));
  });
  const connectionFile = writeApiConnectionStore(tempDir, [{
    id: 'conn-1',
    name: 'Gateway',
    baseURL: stub.baseURL,
    apiKey: 'sk-test-123',
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }]);
  const originalConnectionFile = process.env.MODEL_CONNECTION_DATA_FILE;

  try {
    process.env.MODEL_CONNECTION_DATA_FILE = connectionFile;
    const { invokeAgent } = require('../../dist/agent-invoker.js');
    await assert.rejects(
      () => invokeAgent({
        userMessage: '你好',
        agent: {
          name: 'Alice',
          avatar: '🤖',
          systemPrompt: '你是 Alice',
          color: '#fff',
          executionMode: 'api',
          apiConnectionId: 'conn-1',
          apiModel: 'gpt-4.1'
        },
        history: [],
        includeHistory: true
      }),
      /API provider 返回了不兼容的响应：缺少 choices\[0\]\.message\.content/
    );
  } finally {
    process.env.MODEL_CONNECTION_DATA_FILE = originalConnectionFile;
    await stub.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('统一 agent 调用入口在 api 模式下会对空 content 且 length 截断返回 apiMaxTokens 过低提示', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-agent-invoker-api-empty-content-length-'));
  const stub = await createOpenAICompatibleStub((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{
        finish_reason: 'length',
        message: {
          role: 'assistant',
          content: '',
          reasoning_content: '这是一段推理内容，但最终答案还没来得及输出。'
        }
      }]
    }));
  });
  const connectionFile = writeApiConnectionStore(tempDir, [{
    id: 'conn-1',
    name: 'Gateway',
    baseURL: stub.baseURL,
    apiKey: 'sk-test-123',
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }]);
  const originalConnectionFile = process.env.MODEL_CONNECTION_DATA_FILE;

  try {
    process.env.MODEL_CONNECTION_DATA_FILE = connectionFile;
    const { invokeAgent } = require('../../dist/agent-invoker.js');
    await assert.rejects(
      () => invokeAgent({
        userMessage: '你好',
        agent: {
          name: 'Alice',
          avatar: '🤖',
          systemPrompt: '你是 Alice',
          color: '#fff',
          executionMode: 'api',
          apiConnectionId: 'conn-1',
          apiModel: 'gpt-4.1',
          apiMaxTokens: 64
        },
        history: [],
        includeHistory: true
      }),
      /API provider 输出被截断.*message\.content 为空.*apiMaxTokens 过低/
    );
  } finally {
    process.env.MODEL_CONNECTION_DATA_FILE = originalConnectionFile;
    await stub.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('统一 agent 调用入口在 api 模式下会对缺少连接配置返回明确错误', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-agent-invoker-api-missing-connection-'));
  const connectionFile = writeApiConnectionStore(tempDir, []);
  const originalConnectionFile = process.env.MODEL_CONNECTION_DATA_FILE;

  try {
    process.env.MODEL_CONNECTION_DATA_FILE = connectionFile;
    const { invokeAgent } = require('../../dist/agent-invoker.js');
    await assert.rejects(
      () => invokeAgent({
        userMessage: '你好',
        agent: {
          name: 'Alice',
          avatar: '🤖',
          systemPrompt: '你是 Alice',
          color: '#fff',
          executionMode: 'api',
          apiConnectionId: 'conn-1',
          apiModel: 'gpt-4.1'
        },
        history: [],
        includeHistory: true
      }),
      /找不到 API 连接配置：conn-1/
    );
  } finally {
    process.env.MODEL_CONNECTION_DATA_FILE = originalConnectionFile;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('统一 agent 调用入口会优先按 cliName 路由到 Codex CLI', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-agent-invoker-codex-'));
  const fakeClaude = join(tempDir, 'claude');
  const fakeCodex = join(tempDir, 'codex');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
printf '%s\n' '{"output_text":"CLAUDE path should not be used"}'
`, 'utf8');
  writeFileSync(fakeCodex, `#!/usr/bin/env bash
printf '%s\n' '{"output_text":"CODEX provider reply"}'
`, 'utf8');
  chmodSync(fakeClaude, 0o755);
  chmodSync(fakeCodex, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${tempDir}:${originalPath || ''}`;

  try {
    const { invokeAgent } = require('../../dist/agent-invoker.js');
    const result = await invokeAgent({
      userMessage: '你好',
      agent: {
        name: 'Alice',
        avatar: '🤖',
        systemPrompt: '你是 Alice',
        color: '#fff',
        executionMode: 'cli',
        cliName: 'codex',
        cli: 'claude'
      },
      history: [],
      includeHistory: true
    });

    assert.equal(result.text, 'CODEX provider reply');
  } finally {
    process.env.PATH = originalPath;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('聊天主链在 API 模式下会通过统一 invoker 调用 OpenAI-compatible provider', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-chat-api-agent-'));
  const connectionStub = await createOpenAICompatibleStub((req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/chat/completions');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'API 聊天主链回复'
          }
        }
      ]
    }));
  });
  const connectionFile = writeApiConnectionStore(tempDir, [{
    id: 'conn-1',
    name: 'Gateway',
    baseURL: connectionStub.baseURL,
    apiKey: 'sk-test-123',
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
        personality: 'API 智能体',
        systemPrompt: '你是 API Alice',
        color: '#3b82f6',
        executionMode: 'api',
        apiConnectionId: 'conn-1',
        apiModel: 'gpt-4.1-mini',
        apiTemperature: 0.3,
        apiMaxTokens: 512
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
      MODEL_CONNECTION_DATA_FILE: connectionFile,
      BOT_ROOM_VERBOSE_LOG_DIR: join(tempDir, 'verbose-logs')
    }
  });

  try {
    await fixture.login();
    await enableAgents(fixture, ['Alice']);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice 请走 API 模式回复' }
    });

    assert.equal(chatResponse.status, 200);
    assert.equal(chatResponse.body.success, true);
    assert.deepEqual(
      chatResponse.body.aiMessages.map(item => [item.sender, item.text]),
      [['Alice', 'API 聊天主链回复']]
    );
    assert.equal(connectionStub.requests.length, 1);
    assert.equal(connectionStub.requests[0].body.model, 'gpt-4.1-mini');

    const logsResponse = await fixture.request('/api/dependencies/logs?dependency=chat-exec&keyword=Alice');
    assert.equal(logsResponse.status, 200);
    const messages = logsResponse.body.logs.map(item => item.message);
    assert.ok(messages.some(msg => msg.includes('stage=api_start')));
    assert.ok(messages.some(msg => msg.includes('stage=api_done')));
    assert.ok(!messages.some(msg => msg.includes('stage=cli_done')));
  } finally {
    await fixture.cleanup();
    await connectionStub.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('chat-stream 在 API 模式下会先推送 agent_delta，再推送最终 agent_message', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-chat-stream-api-agent-'));
  const connectionStub = await createOpenAICompatibleStub((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"index":0,"delta":{"content":"流式"}}]}\n\n');
    res.write('data: {"choices":[{"index":0,"delta":{"content":"回复"}}]}\n\n');
    res.write('data: {"choices":[{"index":0,"finish_reason":"stop"}]}\n\n');
    res.end('data: [DONE]\n\n');
  });
  const connectionFile = writeApiConnectionStore(tempDir, [{
    id: 'conn-1',
    name: 'Gateway',
    baseURL: connectionStub.baseURL,
    apiKey: 'sk-test-123',
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
        personality: 'API 智能体',
        systemPrompt: '你是 API Alice',
        color: '#3b82f6',
        executionMode: 'api',
        apiConnectionId: 'conn-1',
        apiModel: 'glm-5.1',
        apiTemperature: 0.3,
        apiMaxTokens: 2048
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
      MODEL_CONNECTION_DATA_FILE: connectionFile,
      BOT_ROOM_VERBOSE_LOG_DIR: join(tempDir, 'verbose-logs')
    }
  });

  try {
    await fixture.login();
    await enableAgents(fixture, ['Alice']);

    const streamResponse = await fixture.request('/api/chat-stream', {
      method: 'POST',
      body: { message: '@Alice 请走 API 流式回复' }
    });

    assert.equal(streamResponse.status, 200);
    assert.ok(streamResponse.text.includes('event: agent_thinking'));
    assert.ok(streamResponse.text.includes('event: agent_delta'));
    assert.ok(streamResponse.text.includes('"delta":"流式"'));
    assert.ok(streamResponse.text.includes('"delta":"回复"'));
    assert.ok(streamResponse.text.includes('event: agent_message'));
    assert.ok(streamResponse.text.includes('"text":"流式回复"'));
    assert.ok(streamResponse.text.includes('event: done'));
  } finally {
    await fixture.cleanup();
    await connectionStub.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('未登录时聊天相关接口会返回 401，登录后可正常聊天', async () => {
  const fixture = await createChatServerFixture();

  try {
    const authStatus = await fixture.request('/api/auth-status');
    assert.equal(authStatus.status, 200);
    assert.equal(authStatus.body.authEnabled, true);
    assert.equal(authStatus.body.authenticated, false);

    const beforeLoginHistory = await fixture.request('/api/history');
    assert.equal(beforeLoginHistory.status, 401);

    const beforeLoginChat = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice 请总结一下今日任务' }
    });
    assert.equal(beforeLoginChat.status, 401);

    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);
    assert.equal(loginResponse.body.success, true);

    const historyAfterLogin = await fixture.request('/api/history');
    assert.equal(historyAfterLogin.status, 200);
    assert.ok(Array.isArray(historyAfterLogin.body.messages));

    await enableAgents(fixture, ['Alice']);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice 请总结一下今日任务' }
    });
    assert.equal(chatResponse.status, 200);
    assert.equal(chatResponse.body.success, true);
    assert.ok(Array.isArray(chatResponse.body.aiMessages));
    assert.ok(chatResponse.body.aiMessages.length >= 1);
  } finally {
    await fixture.cleanup();
  }
});

test('登录后支持多智能体协作回复', async () => {
  const fixture = await createChatServerFixture();

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);
    await enableAgents(fixture, ['Alice', 'Bob']);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice @Bob 你们协作给出一个两步计划' }
    });

    assert.equal(chatResponse.status, 200);
    assert.equal(chatResponse.body.success, true);
    assert.ok(Array.isArray(chatResponse.body.aiMessages));

    const senders = new Set(chatResponse.body.aiMessages.map(item => item.sender));
    assert.ok(senders.has('Alice'));
    assert.ok(senders.has('Bob'));
  } finally {
    await fixture.cleanup();
  }
});

test('智能体 callback 消息中的 invokeAgents 参数会触发链式调用', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-claude-chain-'));
  const fakeClaude = join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
node - <<'EOF'
const agentName = process.env.BOT_ROOM_AGENT_NAME || 'AI';
const sessionId = process.env.BOT_ROOM_SESSION_ID || '';
const apiUrl = process.env.BOT_ROOM_API_URL || '';
const token = process.env.BOT_ROOM_CALLBACK_TOKEN || '';

async function post(content, invokeAgents) {
  const encodedAgentName = encodeURIComponent(agentName);
  const response = await fetch(new URL('/api/callbacks/post-message', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${token}\`,
      'Content-Type': 'application/json',
      'x-bot-room-callback-token': token,
      'x-bot-room-session-id': sessionId,
      'x-bot-room-agent': encodedAgentName
    },
    body: JSON.stringify({ content, invokeAgents })
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

(async () => {
  if (agentName === 'Alice') {
    await post('请 @Bob 补充工程实现建议', ['Bob']);
  } else if (agentName === 'Bob') {
    await post('Bob 已收到 Alice 的邀请，并补充了工程实现建议');
  } else {
    await post(\`\${agentName} 未命中测试分支\`);
  }
  process.stdout.write('{"output_text":"callback sent"}\\n');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
EOF
`, 'utf8');
  chmodSync(fakeClaude, 0o755);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();
    await enableAgents(fixture, ['Alice', 'Bob']);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice 发起协作' }
    });

    assert.equal(chatResponse.status, 200);
    assert.equal(chatResponse.body.success, true);
    assert.deepEqual(
      chatResponse.body.aiMessages.map(item => [item.sender, item.text]),
      [
        ['Alice', '请 @@Bob 补充工程实现建议'],
        ['Bob', 'Bob 已收到 Alice 的邀请，并补充了工程实现建议']
      ]
    );
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('流式连接中断后不会继续执行后续被 @ 的智能体链路', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-stream-abort-'));
  const fakeClaude = join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
node - <<'EOF'
const agentName = process.env.BOT_ROOM_AGENT_NAME || 'AI';
const sessionId = process.env.BOT_ROOM_SESSION_ID || '';
const apiUrl = process.env.BOT_ROOM_API_URL || '';
const token = process.env.BOT_ROOM_CALLBACK_TOKEN || '';

async function post(content, invokeAgents) {
  const encodedAgentName = encodeURIComponent(agentName);
  const response = await fetch(new URL('/api/callbacks/post-message', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${token}\`,
      'Content-Type': 'application/json',
      'x-bot-room-callback-token': token,
      'x-bot-room-session-id': sessionId,
      'x-bot-room-agent': encodedAgentName
    },
    body: JSON.stringify({ content, invokeAgents })
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

(async () => {
  if (agentName === 'Alice') {
    await post('请 @Bob 继续跟进', ['Bob']);
  } else if (agentName === 'Bob') {
    await post('Bob 不应该在断流后继续执行');
  } else {
    await post(\`\${agentName} 未命中测试分支\`);
  }
  await new Promise(resolve => setTimeout(resolve, 120));
  process.stdout.write('{"output_text":"callback sent"}\\n');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
EOF
`, 'utf8');
  chmodSync(fakeClaude, 0o755);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();
    await enableAgents(fixture, ['Alice', 'Bob']);

    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${fixture.port}/api/chat-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: fixture.getCookieHeader()
      },
      body: JSON.stringify({ message: '@Alice 发起协作' }),
      signal: controller.signal
    });

    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let thinkingSeen = false;

    const thinkingDeadline = Date.now() + 5000;
    while (!thinkingSeen) {
      assert.ok(Date.now() < thinkingDeadline, 'stream should emit Alice thinking before timeout');
      const { done, value } = await reader.read();
      assert.equal(done, false, 'stream should emit thinking event before closing');
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let eventType = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const payload = JSON.parse(line.slice(6));
          if (eventType === 'agent_thinking' && payload.agent === 'Alice') {
            thinkingSeen = true;
            break;
          }
          eventType = '';
        }
      }
    }

    controller.abort();
    await reader.cancel().catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 500));

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    const assistantSenders = historyResponse.body.messages
      .filter(item => item.role === 'assistant')
      .map(item => item.sender);

    assert.ok(assistantSenders.includes('Alice'), 'current in-flight agent may still finish');
    assert.ok(!assistantSenders.includes('Bob'), 'disconnect should stop chained Bob execution');
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('支持带中文标点的 @Codex架构师 提及', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-codex-mention-'));
  const fakeCodex = join(tempDir, 'codex');
  writeFileSync(fakeCodex, `#!/usr/bin/env bash
printf '{"output_text":"中文标点 mention ok"}\n'
`, 'utf8');
  chmodSync(fakeCodex, 0o755);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);
    await enableAgents(fixture, ['Codex架构师']);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Codex架构师，帮我做一个两层架构设计' }
    });

    assert.equal(chatResponse.status, 200);
    assert.equal(chatResponse.body.success, true);
    assert.ok(Array.isArray(chatResponse.body.aiMessages));

    const senders = new Set(chatResponse.body.aiMessages.map(item => item.sender));
    assert.ok(senders.has('Codex架构师'));
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('支持全角＠all 群聊提及并触发所有智能体回复', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-fullwidth-all-'));
  const fakeClaude = join(tempDir, 'claude');
  const fakeCodex = join(tempDir, 'codex');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
agent_name="\${BOT_ROOM_AGENT_NAME:-Claude}"
printf '{"type":"assistant","message":{"content":[{"type":"text","text":"'"$agent_name"' ok"}]}}\n'
`, 'utf8');
  writeFileSync(fakeCodex, `#!/usr/bin/env bash
printf '{"output_text":"Codex架构师 ok"}\n'
`, 'utf8');
  chmodSync(fakeClaude, 0o755);
  chmodSync(fakeCodex, 0o755);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);
    await enableAgents(fixture, ['Claude', 'Codex架构师', 'Alice', 'Bob']);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '＠all 请每位同学给一句建议' }
    });

    assert.equal(chatResponse.status, 200);
    assert.equal(chatResponse.body.success, true);
    assert.ok(Array.isArray(chatResponse.body.aiMessages));

    const senders = new Set(chatResponse.body.aiMessages.map(item => item.sender));
    assert.ok(senders.has('Claude'));
    assert.ok(senders.has('Codex架构师'));
    assert.ok(senders.has('Alice'));
    assert.ok(senders.has('Bob'));
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('启用超过 4 个智能体时，@所有人 仍会触发全部已启用智能体回复', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-broadcast-all-'));
  const fakeClaude = join(tempDir, 'claude');
  const fakeCodex = join(tempDir, 'codex');
  const agentDataFile = join(tempDir, 'agents.json');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
printf '{"output_text":"%s 已收到"}\\n' "\${BOT_ROOM_AGENT_NAME:-AI}"
`, 'utf8');
  writeFileSync(fakeCodex, `#!/usr/bin/env bash
printf '{"output_text":"{\\"output_text\\":\\"%s 已收到\\"}\\n"' "\${BOT_ROOM_AGENT_NAME:-AI}"
`, 'utf8');
  writeFileSync(agentDataFile, JSON.stringify({
    activeAgents: [
      { name: 'Codex架构师', avatar: '🏗️', personality: '架构师', color: '#8b5cf6', cli: 'codex' },
      { name: 'BACKEND', avatar: '🧩', personality: '后端工程师', color: '#0f766e', cli: 'codex' },
      { name: 'FRONTEND', avatar: '🖼️', personality: '前端工程师', color: '#2563eb', cli: 'codex' },
      { name: 'QA', avatar: '🧪', personality: '测试工程师', color: '#dc2626', cli: 'claude' },
      { name: 'OPS', avatar: '🛠️', personality: '运维工程师', color: '#7c3aed', cli: 'claude' },
      { name: 'SECURITY', avatar: '🔐', personality: '安全工程师', color: '#b45309', cli: 'claude' },
      { name: 'PERF', avatar: '⚡', personality: '性能工程师', color: '#059669', cli: 'claude' }
    ],
    pendingAgents: null,
    pendingReason: null,
    updatedAt: Date.now(),
    pendingUpdatedAt: null
  }, null, 2), 'utf8');
  chmodSync(fakeClaude, 0o755);
  chmodSync(fakeCodex, 0o755);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`,
      AGENT_DATA_FILE: agentDataFile
    }
  });

  try {
    await fixture.login();
    const enabledAgents = ['Codex架构师', 'BACKEND', 'FRONTEND', 'QA', 'OPS', 'SECURITY', 'PERF'];
    await enableAgents(fixture, enabledAgents);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@所有人 收到消息请回复' }
    });

    assert.equal(chatResponse.status, 200);
    assert.equal(chatResponse.body.success, true);

    const senders = new Set(chatResponse.body.aiMessages.map(item => item.sender));
    assert.deepEqual([...senders].sort(), [...enabledAgents].sort());
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Codex 架构师在未回调时会回退展示 CLI 直接输出，并记录关键运维日志', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-codex-'));
  const fakeCodex = join(tempDir, 'codex');
  writeFileSync(fakeCodex, `#!/usr/bin/env bash
printf '{"output_text":"这是 Codex 直接回复（无回调）"}\\n'
`, 'utf8');
  chmodSync(fakeCodex, 0o755);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`,
      BOT_ROOM_VERBOSE_LOG_DIR: join(tempDir, 'verbose-logs')
    }
  });

  try {
    await fixture.login();
    await enableAgents(fixture, ['Codex架构师']);
    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Codex架构师 请直接给出一句建议' }
    });

    assert.equal(chatResponse.status, 200);
    const codexMessage = chatResponse.body.aiMessages.find(item => item.sender === 'Codex架构师');
    assert.ok(codexMessage, 'should include Codex visible message');
    assert.equal(codexMessage.text, '这是 Codex 直接回复（无回调）');

    const logsResponse = await fixture.request('/api/dependencies/logs?dependency=chat-exec&keyword=Codex%E6%9E%B6%E6%9E%84%E5%B8%88');
    assert.equal(logsResponse.status, 200);
    const messages = logsResponse.body.logs.map(item => item.message);
    assert.ok(messages.some(msg => msg.includes('stage=start')));
    assert.ok(messages.some(msg => msg.includes('stage=cli_done')));
    assert.ok(messages.some(msg => msg.includes('stage=direct_fallback')));
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Codex CLI 鉴权失效时，/api/chat 会直接返回真实失败信息而不是模拟回复', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-codex-auth-error-'));
  const fakeCodex = join(tempDir, 'codex');
  writeFileSync(fakeCodex, `#!/usr/bin/env bash
printf 'unexpected status 402 Payment Required: {"detail":{"code":"deactivated_workspace"}}\\n' >&2
exit 1
`, 'utf8');
  chmodSync(fakeCodex, 0o755);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();
    await enableAgents(fixture, ['Codex架构师']);
    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Codex架构师 请给一句建议' }
    });

    assert.equal(chatResponse.status, 200);
    const codexMessage = chatResponse.body.aiMessages.find(item => item.sender === 'Codex架构师');
    assert.ok(codexMessage, 'should include a visible failure message');
    assert.match(codexMessage.text, /账号或工作区异常/u);
    assert.match(codexMessage.text, /请检查 Codex/u);
    assert.doesNotMatch(codexMessage.text, /我收到了你的消息/u);
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Codex CLI usage limit 时，/api/chat 会直接返回额度提示而不是模拟回复', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-codex-usage-limit-'));
  const fakeCodex = join(tempDir, 'codex');
  writeFileSync(fakeCodex, `#!/usr/bin/env bash
printf "You've hit your usage limit. To get more access now, send a request to your admin or try again at Apr 4th, 2026 3:05 AM.\\n" >&2
exit 1
`, 'utf8');
  chmodSync(fakeCodex, 0o755);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();
    await enableAgents(fixture, ['Codex架构师']);
    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Codex架构师 请给一句建议' }
    });

    assert.equal(chatResponse.status, 200);
    const codexMessage = chatResponse.body.aiMessages.find(item => item.sender === 'Codex架构师');
    assert.ok(codexMessage, 'should include a visible failure message');
    assert.match(codexMessage.text, /额度|usage limit|稍后重试/u);
    assert.doesNotMatch(codexMessage.text, /我收到了你的消息/u);
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('verbose 日志列表能正确显示中文智能体名 Codex架构师', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-codex-verbose-'));
  const fakeCodex = join(tempDir, 'codex');
  writeFileSync(fakeCodex, `#!/usr/bin/env bash
printf '{"output_text":"verbose log test"}\\n'
`, 'utf8');
  chmodSync(fakeCodex, 0o755);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();
    await enableAgents(fixture, ['Codex架构师']);
    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Codex架构师 产生日志' }
    });

    assert.equal(chatResponse.status, 200);
    const agentsResponse = await fixture.request('/api/verbose/agents');
    assert.equal(agentsResponse.status, 200);
    assert.ok(Array.isArray(agentsResponse.body.agents));
    assert.ok(agentsResponse.body.agents.some(item => item.agent === 'Codex架构师'));
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('chat-stream 会在 Codex 无回调时推送 agent_message，避免前端一直停留在思考中', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-codex-stream-'));
  const fakeCodex = join(tempDir, 'codex');
  writeFileSync(fakeCodex, `#!/usr/bin/env bash
printf '{"output_text":"SSE 直出回复"}\\n'
`, 'utf8');
  chmodSync(fakeCodex, 0o755);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();
    await enableAgents(fixture, ['Codex架构师']);
    const streamResponse = await fixture.request('/api/chat-stream', {
      method: 'POST',
      body: { message: '@Codex架构师 走流式' }
    });

    assert.equal(streamResponse.status, 200);
    assert.ok(streamResponse.text.includes('event: agent_thinking'));
    assert.ok(streamResponse.text.includes('event: agent_message'));
    assert.ok(streamResponse.text.includes('SSE 直出回复'));
    assert.ok(streamResponse.text.includes('event: done'));
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('chat-stream 在智能体没有任何可见消息时会推送 error 事件，避免前端静默结束', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-codex-empty-stream-'));
  const fakeCodex = join(tempDir, 'codex');
  writeFileSync(fakeCodex, `#!/usr/bin/env bash
printf '{"type":"turn.completed"}\\n'
`, 'utf8');
  chmodSync(fakeCodex, 0o755);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();
    await enableAgents(fixture, ['Codex架构师']);
    const streamResponse = await fixture.request('/api/chat-stream', {
      method: 'POST',
      body: { message: '@Codex架构师 走流式但不给可见消息' }
    });

    assert.equal(streamResponse.status, 200);
    assert.ok(streamResponse.text.includes('event: agent_thinking'));
    assert.ok(streamResponse.text.includes('event: error'));
    assert.ok(streamResponse.text.includes('未返回可见消息'));
    assert.ok(streamResponse.text.includes('event: done'));
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Codex 直出包含 bot_room 工具编排痕迹时，不应把内部协作过程直接展示给用户', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-codex-internal-leak-'));
  const fakeCodex = join(tempDir, 'codex');
  writeFileSync(fakeCodex, `#!/usr/bin/env bash
printf '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"先读取会话协作技能说明并拉取聊天室上下文。已按要求先调用 ` + "\"`bot_room_get_context`" + ` 获取完整会话历史，又尝试用 ` + "\"`bot_room_post_message`" + ` 往群里同步结论。"}}\\n'
`, 'utf8');
  chmodSync(fakeCodex, 0o755);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();
    await enableAgents(fixture, ['Codex架构师']);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Codex架构师 你的想法呢' }
    });

    assert.equal(chatResponse.status, 200);
    const codexMessage = chatResponse.body.aiMessages.find(item => item.sender === 'Codex架构师');
    assert.ok(codexMessage, 'should include a visible fallback message');
    assert.match(codexMessage.text, /协作工具调用未成功/u);
    assert.doesNotMatch(codexMessage.text, /bot_room_get_context/u);
    assert.doesNotMatch(codexMessage.text, /bot_room_post_message/u);
    assert.doesNotMatch(codexMessage.text, /先读取会话协作技能说明/u);
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('chat-stream 会继续推送由智能体 @ 触发的后续智能体消息', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-claude-stream-chain-'));
  const fakeClaude = join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
node - <<'EOF'
const agentName = process.env.BOT_ROOM_AGENT_NAME || 'AI';
const sessionId = process.env.BOT_ROOM_SESSION_ID || '';
const apiUrl = process.env.BOT_ROOM_API_URL || '';
const token = process.env.BOT_ROOM_CALLBACK_TOKEN || '';

async function post(content, invokeAgents) {
  const encodedAgentName = encodeURIComponent(agentName);
  const response = await fetch(new URL('/api/callbacks/post-message', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${token}\`,
      'Content-Type': 'application/json',
      'x-bot-room-callback-token': token,
      'x-bot-room-session-id': sessionId,
      'x-bot-room-agent': encodedAgentName
    },
    body: JSON.stringify({ content, invokeAgents })
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

(async () => {
  if (agentName === 'Alice') {
    await post('请流式继续', ['Bob']);
  } else if (agentName === 'Bob') {
    await post('Bob 流式补充完成');
  }
  process.stdout.write('{"output_text":"callback sent"}\\n');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
EOF
`, 'utf8');
  chmodSync(fakeClaude, 0o755);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();
    await enableAgents(fixture, ['Alice', 'Bob']);

    const streamResponse = await fixture.request('/api/chat-stream', {
      method: 'POST',
      body: { message: '@Alice 开始流式协作' }
    });

    assert.equal(streamResponse.status, 200);
    assert.ok(streamResponse.text.includes('event: agent_thinking'));
    assert.ok(streamResponse.text.includes('"agent":"Alice"'));
    assert.ok(streamResponse.text.includes('"agent":"Bob"'));
    assert.ok(streamResponse.text.includes('"sender":"Alice"'));
    assert.ok(streamResponse.text.includes('"sender":"Bob"'));
    assert.ok(streamResponse.text.includes('Bob 流式补充完成'));
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('chat-stream 客户端中途断开时会记录明确的断流日志', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-claude-stream-disconnect-log-'));
  const fakeClaude = join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
sleep 2
printf '{"output_text":"late reply"}\\n'
`, 'utf8');
  chmodSync(fakeClaude, 0o755);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();
    await enableAgents(fixture, ['Claude']);

    const abortController = new AbortController();
    const streamResponse = await fetch(`http://127.0.0.1:${fixture.port}/api/chat-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: fixture.getCookieHeader()
      },
      body: JSON.stringify({ message: '@Claude 触发断流日志验证' }),
      signal: abortController.signal
    });

    await new Promise(resolve => setTimeout(resolve, 150));
    abortController.abort();
    await streamResponse.body?.cancel().catch(() => {});

    await new Promise(resolve => setTimeout(resolve, 1600));

    const logsResponse = await fixture.request('/api/dependencies/logs?dependency=chat-exec&keyword=stream_disconnect');
    assert.equal(logsResponse.status, 200);
    const messages = logsResponse.body.logs.map(item => item.message);
    assert.ok(messages.some(msg => msg.includes('stage=stream_disconnect')));
    assert.ok(messages.some(msg => msg.includes('reason=client_disconnect')));
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('chat-resume 会继续执行流式中断后剩余的智能体链路，避免重复执行已完成节点', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-stream-resume-chain-'));
  const fakeClaude = join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
node - <<'EOF'
const agentName = process.env.BOT_ROOM_AGENT_NAME || 'AI';
const sessionId = process.env.BOT_ROOM_SESSION_ID || '';
const apiUrl = process.env.BOT_ROOM_API_URL || '';
const token = process.env.BOT_ROOM_CALLBACK_TOKEN || '';

async function post(content) {
  const encodedAgentName = encodeURIComponent(agentName);
  const response = await fetch(new URL('/api/callbacks/post-message', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${token}\`,
      'Content-Type': 'application/json',
      'x-bot-room-callback-token': token,
      'x-bot-room-session-id': sessionId,
      'x-bot-room-agent': encodedAgentName
    },
    body: JSON.stringify({ content })
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

(async () => {
  if (agentName === 'Alice') {
    await post('Alice 已完成首段');
  } else if (agentName === 'Bob') {
    await new Promise(resolve => setTimeout(resolve, 1200));
    await post('Bob 已继续完成剩余链路');
  }
  process.stdout.write('{"output_text":"callback sent"}\\n');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
EOF
`, 'utf8');
  chmodSync(fakeClaude, 0o755);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();
    await enableAgents(fixture, ['Alice', 'Bob']);

    const abortController = new AbortController();
    const response = await fetch(`http://127.0.0.1:${fixture.port}/api/chat-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: fixture.getCookieHeader()
      },
      body: JSON.stringify({ message: '@Alice @Bob 开始后中断，再恢复剩余链路' }),
      signal: abortController.signal
    });

    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let streamText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      streamText += decoder.decode(value, { stream: true });
      if (streamText.includes('"sender":"Alice"')) {
        abortController.abort();
        break;
      }
    }

    await new Promise(resolve => setTimeout(resolve, 1600));

    const resumeResponse = await fixture.request('/api/chat-resume', {
      method: 'POST',
      body: {}
    });

    assert.equal(resumeResponse.status, 200);
    assert.equal(resumeResponse.body.success, true);
    assert.equal(resumeResponse.body.resumed, true);
    assert.ok(Array.isArray(resumeResponse.body.aiMessages));
    assert.equal(resumeResponse.body.aiMessages.length, 1);
    assert.equal(resumeResponse.body.aiMessages[0].sender, 'Bob');
    assert.equal(resumeResponse.body.aiMessages[0].text, 'Bob 已继续完成剩余链路');

    const secondResumeResponse = await fixture.request('/api/chat-resume', {
      method: 'POST',
      body: {}
    });
    assert.equal(secondResumeResponse.status, 200);
    assert.equal(secondResumeResponse.body.success, true);
    assert.equal(secondResumeResponse.body.resumed, false);
    assert.equal(secondResumeResponse.body.aiMessages.length, 0);

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    const senders = historyResponse.body.messages.map(item => item.sender);
    assert.deepEqual(senders, ['用户', 'Alice', 'Bob']);
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Codex 架构师可通过 callback 接口回传中文智能体名消息，避免因 header 编码问题丢失可见消息', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-codex-callback-'));
  const fakeCodex = join(tempDir, 'codex');
  writeFileSync(fakeCodex, `#!/usr/bin/env bash
node - <<'EOF'
const agentName = process.env.BOT_ROOM_AGENT_NAME || 'AI';
const sessionId = process.env.BOT_ROOM_SESSION_ID || '';
const apiUrl = process.env.BOT_ROOM_API_URL || '';
const token = process.env.BOT_ROOM_CALLBACK_TOKEN || '';

(async () => {
  const contextUrl = new URL('/api/callbacks/thread-context', apiUrl);
  contextUrl.searchParams.set('sessionid', sessionId);
  const encodedAgentName = encodeURIComponent(agentName);

  await fetch(contextUrl, {
    headers: {
      Authorization: \`Bearer \${token}\`,
      'x-bot-room-callback-token': token,
      'x-bot-room-session-id': sessionId,
      'x-bot-room-agent': encodedAgentName
    }
  });

  await fetch(new URL('/api/callbacks/post-message', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${token}\`,
      'Content-Type': 'application/json',
      'x-bot-room-callback-token': token,
      'x-bot-room-session-id': sessionId,
      'x-bot-room-agent': encodedAgentName
    },
    body: JSON.stringify({ content: '已通过 MCP 回调' })
  });

  process.stdout.write('{"output_text":"callback sent"}\\n');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
EOF
`, 'utf8');
  chmodSync(fakeCodex, 0o755);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();
    await enableAgents(fixture, ['Codex架构师']);
    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Codex架构师 请通过 callback 回复' }
    });

    assert.equal(chatResponse.status, 200);
    const codexMessage = chatResponse.body.aiMessages.find(item => item.sender === 'Codex架构师');
    assert.ok(codexMessage, 'should include Codex callback message');
    assert.equal(codexMessage.text, '已通过 MCP 回调');

    const logsResponse = await fixture.request('/api/dependencies/logs?dependency=chat-exec&keyword=Codex%E6%9E%B6%E6%9E%84%E5%B8%88');
    assert.equal(logsResponse.status, 200);
    const messages = logsResponse.body.logs.map(item => item.message);
    assert.ok(messages.some(msg => msg.includes('stage=start')));
    assert.ok(messages.some(msg => msg.includes('stage=cli_done')));
    assert.ok(!messages.some(msg => msg.includes('stage=empty_visible_message')));
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});


test('peer 模式下无显式继续对象时会将讨论标记为 paused', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-peer-paused-'));
  createSingleReplyClaudeScript(tempDir);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'peer paused discussion' }
    });
    assert.equal(createResponse.status, 200);
    await enableAgents(fixture, ['Alice']);

    const updateResponse = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId: createResponse.body.session.id,
        patch: {
          discussionMode: 'peer'
        }
      }
    });
    assert.equal(updateResponse.status, 200);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice 请先发表看法' }
    });

    assert.equal(chatResponse.status, 200);
    assert.deepEqual(chatResponse.body.aiMessages.map(item => item.sender), ['Alice']);

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    assert.equal(historyResponse.body.session.discussionMode, 'peer');
    assert.equal(historyResponse.body.session.discussionState, 'paused');
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('peer 模式下若最终已无待继续讨论则会标记为 paused，即使本轮较早消息曾显式继续', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-peer-multi-visible-'));
  createMultiVisiblePartialChainClaudeScript(tempDir);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'peer multi visible discussion' }
    });
    assert.equal(createResponse.status, 200);
    await enableAgents(fixture, ['Alice', 'Bob']);

    const updateResponse = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId: createResponse.body.session.id,
        patch: {
          discussionMode: 'peer'
        }
      }
    });
    assert.equal(updateResponse.status, 200);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice 请开始' }
    });

    assert.equal(chatResponse.status, 200);
    assert.deepEqual(chatResponse.body.aiMessages.map(item => item.sender), ['Alice', 'Alice']);
    assert.deepEqual(chatResponse.body.aiMessages[0].invokeAgents, ['Bob']);
    assert.equal(chatResponse.body.aiMessages[1].invokeAgents, undefined);

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    assert.equal(historyResponse.body.session.discussionMode, 'peer');
    assert.equal(historyResponse.body.session.discussionState, 'paused');
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('peer 模式下显式继续若因队列限制未实际入队则会标记为 paused', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-peer-blocked-chain-'));
  createExplicitThenStopClaudeScript(tempDir);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'peer blocked continuation discussion' }
    });
    assert.equal(createResponse.status, 200);
    await enableAgents(fixture, ['Alice', 'Bob']);

    const updateResponse = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId: createResponse.body.session.id,
        patch: {
          discussionMode: 'peer',
          agentChainMaxCallsPerAgent: 1
        }
      }
    });
    assert.equal(updateResponse.status, 200);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice @Bob 请开始' }
    });

    assert.equal(chatResponse.status, 200);
    assert.deepEqual(chatResponse.body.aiMessages.map(item => item.sender), ['Alice', 'Bob']);
    assert.deepEqual(chatResponse.body.aiMessages[0].invokeAgents, ['Bob']);
    assert.equal(chatResponse.body.aiMessages[1].invokeAgents, undefined);

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    assert.equal(historyResponse.body.session.discussionMode, 'peer');
    assert.equal(historyResponse.body.session.discussionState, 'paused');
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('legacy chained pending task 在恢复执行时会被兼容映射并继续执行', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-legacy-chained-resume-'));
  const fakeClaude = join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
node - <<'EOF'
const agentName = process.env.BOT_ROOM_AGENT_NAME || 'AI';
process.stdout.write(JSON.stringify({ output_text: \`\${agentName} resumed from legacy chained\` }) + '\\n');
EOF
`, 'utf8');
  chmodSync(fakeClaude, 0o755);

  const now = Date.now();
  const fixture = await createRedisBackedChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    },
    redisState: {
      version: 1,
      userChatSessions: {
        'user:admin': [
          {
            id: 'default',
            name: '默认会话',
            history: [
              {
                id: 'user-1',
                role: 'user',
                sender: '用户',
                text: '@Bob 请继续',
                timestamp: now - 1000
              }
            ],
            currentAgent: 'Bob',
            enabledAgents: ['Bob'],
            agentWorkdirs: {},
            pendingAgentTasks: [
              {
                agentName: 'Bob',
                prompt: '@Bob 请继续',
                includeHistory: true,
                dispatchKind: 'chained'
              }
            ],
            createdAt: now - 1000,
            updatedAt: now
          }
        ]
      },
      userActiveChatSession: {
        'user:admin': 'default'
      }
    }
  });

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

    const resumeResponse = await fixture.request('/api/chat-resume', {
      method: 'POST',
      body: {}
    });

    assert.equal(resumeResponse.status, 200);
    assert.equal(resumeResponse.body.success, true);
    assert.equal(resumeResponse.body.resumed, true);
    assert.deepEqual(resumeResponse.body.aiMessages.map(item => item.sender), ['Bob']);
    assert.equal(resumeResponse.body.aiMessages[0].text, 'Bob resumed from legacy chained');

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    assert.deepEqual(historyResponse.body.messages.map(item => item.sender), ['用户', 'Bob']);
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('classic 模式下原有链式传播行为保持不变', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-classic-chain-'));
  createExplicitThenStopClaudeScript(tempDir);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'classic chain discussion' }
    });
    assert.equal(createResponse.status, 200);
    await enableAgents(fixture, ['Alice', 'Bob']);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice 请开始讨论' }
    });

    assert.equal(chatResponse.status, 200);
    assert.deepEqual(chatResponse.body.aiMessages.map(item => item.sender), ['Alice', 'Bob']);

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    assert.equal(historyResponse.body.session.discussionMode, 'classic');
    assert.equal(historyResponse.body.session.discussionState, 'active');
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('peer 模式下可手动触发生成总结', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-peer-manual-summary-'));
  createManualSummaryClaudeScript(tempDir, {
    delayMs: 700,
    summaryText: 'Alice 总结：讨论已暂停，当前结论已收敛。'
  });

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'peer manual summary discussion' }
    });
    assert.equal(createResponse.status, 200);
    await enableAgents(fixture, ['Alice']);

    const updateResponse = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId: createResponse.body.session.id,
        patch: {
          discussionMode: 'peer'
        }
      }
    });
    assert.equal(updateResponse.status, 200);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice 请先发表看法' }
    });
    assert.equal(chatResponse.status, 200);

    const pausedHistoryResponse = await fixture.request('/api/history');
    assert.equal(pausedHistoryResponse.status, 200);
    assert.equal(pausedHistoryResponse.body.session.discussionState, 'paused');

    const summaryRequest = fetch(`http://127.0.0.1:${fixture.port}/api/chat-summary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: fixture.getCookieHeader()
      },
      body: JSON.stringify({})
    });

    await waitForCondition(async () => {
      const historyResponse = await fixture.request('/api/history');
      if (historyResponse.body.session.discussionState === 'summarizing') {
        return historyResponse;
      }
      return null;
    }, 4000, 100);

    const summaryResponse = await summaryRequest;
    assert.equal(summaryResponse.status, 200);
    const summaryBody = await summaryResponse.json();
    assert.equal(summaryBody.success, true);
    assert.deepEqual(summaryBody.aiMessages.map(item => item.sender), ['Alice']);
    assert.equal(summaryBody.aiMessages[0].dispatchKind, 'summary');
    assert.match(summaryBody.aiMessages[0].text, /总结/);

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    assert.equal(historyResponse.body.session.discussionMode, 'peer');
    assert.equal(historyResponse.body.session.discussionState, 'paused');
    assert.equal(historyResponse.body.messages.at(-1).dispatchKind, 'summary');
    assert.match(historyResponse.body.messages.at(-1).text, /总结/);
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('peer 模式下生成总结完成后会恢复原有 active 讨论状态', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-peer-summary-restore-active-'));
  createManualSummaryClaudeScript(tempDir, {
    summaryText: 'Alice 总结：当前仍有待继续的讨论分支。'
  });

  const now = Date.now();
  const fixture = await createRedisBackedChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    },
    redisState: {
      version: 1,
      userChatSessions: {
        'user:admin': [
          {
            id: 'default',
            name: '默认会话',
            history: [
              {
                id: 'user-1',
                role: 'user',
                sender: '用户',
                text: '@Alice 先总结一下当前进展',
                timestamp: now - 1000
              }
            ],
            currentAgent: 'Alice',
            enabledAgents: ['Alice', 'Bob'],
            agentWorkdirs: {},
            pendingAgentTasks: [
              {
                agentName: 'Bob',
                prompt: '@@Bob 请继续补充',
                includeHistory: true,
                dispatchKind: 'explicit_chained'
              }
            ],
            pendingVisibleMessages: [
              {
                id: 'pending-visible-1',
                role: 'assistant',
                sender: 'Alice',
                text: 'Alice 之前已有一条待客户端接收的可见消息',
                timestamp: now - 500,
                dispatchKind: 'explicit_chained'
              }
            ],
            discussionMode: 'peer',
            discussionState: 'active',
            createdAt: now - 2000,
            updatedAt: now - 100
          }
        ]
      },
      userActiveChatSession: {
        'user:admin': 'default'
      }
    }
  });

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);
    await enableAgents(fixture, ['Alice', 'Bob']);

    const summaryResponse = await fixture.request('/api/chat-summary', {
      method: 'POST',
      body: {}
    });
    assert.equal(summaryResponse.status, 200);
    assert.equal(summaryResponse.body.aiMessages[0].dispatchKind, 'summary');
    assert.match(summaryResponse.body.aiMessages[0].text, /总结/);

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    assert.equal(historyResponse.body.session.discussionMode, 'peer');
    assert.equal(historyResponse.body.session.discussionState, 'active');
    assert.deepEqual(historyResponse.body.session.pendingAgentTasks, [
      {
        agentName: 'Bob',
        prompt: '@@Bob 请继续补充',
        includeHistory: true,
        dispatchKind: 'explicit_chained'
      }
    ]);
    assert.deepEqual(historyResponse.body.session.pendingVisibleMessages, [
      {
        id: 'pending-visible-1',
        role: 'assistant',
        sender: 'Alice',
        text: 'Alice 之前已有一条待客户端接收的可见消息',
        timestamp: now - 500,
        dispatchKind: 'explicit_chained'
      }
    ]);
    assert.equal(historyResponse.body.messages.at(-1).dispatchKind, 'summary');
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('生成总结不会隐式恢复普通链式传播', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-peer-summary-no-chain-'));
  createManualSummaryClaudeScript(tempDir, {
    summaryText: 'Alice 总结后尝试 @@Bob 继续讨论，但不应恢复普通链式传播。',
    summaryInvokeAgents: ['Bob']
  });

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'peer summary no chain discussion' }
    });
    assert.equal(createResponse.status, 200);
    await enableAgents(fixture, ['Alice', 'Bob']);

    const updateResponse = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId: createResponse.body.session.id,
        patch: {
          discussionMode: 'peer'
        }
      }
    });
    assert.equal(updateResponse.status, 200);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice 请先发表看法' }
    });
    assert.equal(chatResponse.status, 200);

    const summaryResponse = await fixture.request('/api/chat-summary', {
      method: 'POST',
      body: {}
    });
    assert.equal(summaryResponse.status, 200);
    assert.deepEqual(summaryResponse.body.aiMessages.map(item => item.sender), ['Alice']);
    assert.equal(summaryResponse.body.aiMessages[0].dispatchKind, 'summary');
    assert.deepEqual(summaryResponse.body.aiMessages[0].invokeAgents, ['Bob']);

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    assert.deepEqual(historyResponse.body.messages.map(item => item.sender), ['用户', 'Alice', 'Alice']);
    assert.equal(historyResponse.body.session.discussionState, 'paused');
    assert.equal(historyResponse.body.session.pendingAgentTasks, undefined);
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('agentChainMaxCallsPerAgent 为 null 时，同智能体循环提及不会被截断', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-chain-unlimited-'));
  createCyclingClaudeScript(tempDir);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'unlimited chain' }
    });
    assert.equal(createResponse.status, 200);
    await enableAgents(fixture, ['Alice', 'Bob']);

    const updateResponse = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId: createResponse.body.session.id,
        patch: {
          agentChainMaxHops: 4,
          agentChainMaxCallsPerAgent: null
        }
      }
    });
    assert.equal(updateResponse.status, 200);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice 开始循环协作' }
    });

    assert.equal(chatResponse.status, 200);
    assert.deepEqual(chatResponse.body.aiMessages.map(item => item.sender), ['Alice', 'Bob', 'Alice', 'Bob', 'Alice']);
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('当前会话的 agentChainMaxHops 会限制链式传播轮数', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-chain-hops-'));
  createCyclingClaudeScript(tempDir);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'hop-limited chain' }
    });
    assert.equal(createResponse.status, 200);
    await enableAgents(fixture, ['Alice', 'Bob']);

    const updateResponse = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId: createResponse.body.session.id,
        patch: {
          agentChainMaxHops: 2,
          agentChainMaxCallsPerAgent: null
        }
      }
    });
    assert.equal(updateResponse.status, 200);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice 开始受限链式协作' }
    });

    assert.equal(chatResponse.status, 200);
    assert.deepEqual(chatResponse.body.aiMessages.map(item => item.sender), ['Alice', 'Bob', 'Alice']);
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('agentChainMaxCallsPerAgent 为正整数时，会限制重复同智能体调用', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-chain-limited-'));
  createCyclingClaudeScript(tempDir);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'limited chain' }
    });
    assert.equal(createResponse.status, 200);
    await enableAgents(fixture, ['Alice', 'Bob']);

    const updateResponse = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId: createResponse.body.session.id,
        patch: {
          agentChainMaxHops: 4,
          agentChainMaxCallsPerAgent: 1
        }
      }
    });
    assert.equal(updateResponse.status, 200);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice 开始循环协作' }
    });

    assert.equal(chatResponse.status, 200);
    assert.deepEqual(chatResponse.body.aiMessages.map(item => item.sender), ['Alice', 'Bob']);
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
