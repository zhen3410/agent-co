const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createChatServerFixture } = require('./helpers/chat-server-fixture');
const { createAuthAdminFixture } = require('./helpers/auth-admin-fixture');

const repoRoot = join(__dirname, '..', '..');
const distDir = join(repoRoot, 'dist');

function requireBuiltRuntimeModule() {
  const modulePath = join(distDir, 'chat', 'runtime', 'chat-runtime.js');
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function createRuntimeFixture() {
  const { createChatRuntime } = requireBuiltRuntimeModule();
  return createChatRuntime({
    redisUrl: 'redis://127.0.0.1:6379',
    redisConfigKey: 'test:runtime:config',
    defaultRedisChatSessionsKey: 'test:runtime:sessions',
    redisPersistDebounceMs: 100,
    redisRequired: false,
    redisDisabled: true,
    envRedisChatSessionsKey: '',
    defaultChatSessionId: 'default',
    defaultChatSessionName: '默认会话',
    defaultAgentChainMaxHops: 3,
    dependencyStatusLogLimit: 20,
    getValidAgentNames: () => ['Alice', 'Bob']
  });
}

async function enableAgents(fixture, agentNames) {
  for (const agentName of agentNames) {
    const response = await fixture.request('/api/session-agents', {
      method: 'POST',
      body: { agentName, enabled: true }
    });
    assert.equal(response.status, 200);
  }
}

async function requestRawJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });

  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  return { status: response.status, body: json, text };
}

async function requestRaw(url, options = {}) {
  const response = await fetch(url, options);
  return {
    status: response.status,
    headers: response.headers,
    text: await response.text()
  };
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

test('server.ts 保持为组合根，不再承载 agent store 可变逻辑', () => {
  const serverSource = readFileSync(join(__dirname, '..', '..', 'src', 'server.ts'), 'utf8');

  assert.equal(serverSource.includes('let agentStore ='), false);
  assert.equal(serverSource.includes('let agentStoreMtimeMs ='), false);
  assert.equal(serverSource.includes('function syncAgentsFromStore'), false);
  assert.equal(serverSource.includes('applyPendingAgents('), false);
  assert.equal(serverSource.includes('saveAgentStore('), false);
});

test('server.ts 保持为精简组合根，不再承载安全检查和启动横幅逻辑', () => {
  const serverSource = readFileSync(join(__dirname, '..', '..', 'src', 'server.ts'), 'utf8');

  assert.equal(serverSource.includes('function performSecurityChecks'), false);
  assert.equal(serverSource.includes('performSecurityChecks();'), false);
  assert.equal(serverSource.includes('🚀 多 AI 智能体聊天室已启动'), false);
  assert.equal(serverSource.includes('API 端点:'), false);
});

test('chat 应用服务对外接口不再直接耦合 IncomingMessage', () => {
  const authServiceSource = readFileSync(join(__dirname, '..', '..', 'src', 'chat', 'application', 'auth-service.ts'), 'utf8');
  const sessionServiceSource = readFileSync(join(__dirname, '..', '..', 'src', 'chat', 'application', 'session-service.ts'), 'utf8');
  const chatServiceSource = readFileSync(join(__dirname, '..', '..', 'src', 'chat', 'application', 'chat-service.ts'), 'utf8');

  assert.equal(authServiceSource.includes('http.IncomingMessage'), false);
  assert.equal(sessionServiceSource.includes('http.IncomingMessage'), false);
  assert.equal(chatServiceSource.includes('http.IncomingMessage'), false);
});

test('agent store runtime 从 chat-runtime.ts 中分离为独立模块', () => {
  const chatRuntimeSource = readFileSync(join(__dirname, '..', '..', 'src', 'chat', 'runtime', 'chat-runtime.ts'), 'utf8');
  const agentStoreRuntimeSource = readFileSync(join(__dirname, '..', '..', 'src', 'chat', 'runtime', 'chat-agent-store-runtime.ts'), 'utf8');

  assert.equal(chatRuntimeSource.includes('createChatAgentStoreRuntime'), false);
  assert.equal(agentStoreRuntimeSource.includes('createChatAgentStoreRuntime'), true);
});

test('chat service 不再直接改写 session 内部字段', () => {
  const chatServiceSource = readFileSync(join(__dirname, '..', '..', 'src', 'chat', 'application', 'chat-service.ts'), 'utf8');

  assert.equal(chatServiceSource.includes('session.history.push('), false);
  assert.equal(chatServiceSource.includes('session.pendingAgentTasks ='), false);
  assert.equal(chatServiceSource.includes('session.pendingVisibleMessages ='), false);
  assert.equal(/session\.discussionState\s*=\s*[^=]/.test(chatServiceSource), false);
});

test('chat routes 将 SSE 传输细节抽离到独立 helper', () => {
  const chatRoutesSource = readFileSync(join(__dirname, '..', '..', 'src', 'chat', 'http', 'chat-routes.ts'), 'utf8');
  const sseHelperSource = readFileSync(join(__dirname, '..', '..', 'src', 'chat', 'http', 'chat-sse.ts'), 'utf8');

  assert.equal(chatRoutesSource.includes('text/event-stream'), false);
  assert.equal(chatRoutesSource.includes('X-Accel-Buffering'), false);
  assert.equal(chatRoutesSource.includes('event: ${event}'), false);
  assert.equal(sseHelperSource.includes('text/event-stream'), true);
});

test('活动执行状态可记录停止范围并触发 abort', () => {
  const runtime = createRuntimeFixture();
  const controller = new AbortController();
  const userKey = 'user-1';
  const sessionId = 'session-active-1';
  const executionId = 'exec-1';

  runtime.registerActiveExecution(userKey, sessionId, {
    executionId,
    userKey,
    sessionId,
    currentAgentName: null,
    abortController: controller,
    stopMode: 'none'
  });

  assert.equal(runtime.getActiveExecution(userKey, sessionId)?.executionId, executionId);

  const updated = runtime.updateActiveExecutionAgent(userKey, sessionId, executionId, 'Alice');
  assert.equal(updated?.currentAgentName, 'Alice');

  const stopRequested = runtime.requestExecutionStop(userKey, sessionId, 'session');
  assert.equal(stopRequested?.stopMode, 'session');
  assert.equal(controller.signal.aborted, true);
  assert.equal(runtime.consumeExecutionStopMode(userKey, sessionId, executionId), 'session');
  assert.equal(runtime.consumeExecutionStopMode(userKey, sessionId, executionId), 'none');
  assert.deepEqual(runtime.consumeExecutionStopResult(userKey, sessionId, executionId), {
    scope: 'session',
    currentAgent: 'Alice',
    resumeAvailable: false
  });
});

test('旧 executionId 不能清理新活动执行', () => {
  const runtime = createRuntimeFixture();
  const userKey = 'user-1';
  const sessionId = 'session-active-2';

  runtime.registerActiveExecution(userKey, sessionId, {
    executionId: 'exec-old',
    userKey,
    sessionId,
    currentAgentName: 'Alice',
    abortController: new AbortController(),
    stopMode: 'none'
  });
  runtime.registerActiveExecution(userKey, sessionId, {
    executionId: 'exec-new',
    userKey,
    sessionId,
    currentAgentName: 'Bob',
    abortController: new AbortController(),
    stopMode: 'none'
  });

  assert.equal(runtime.clearActiveExecution(userKey, sessionId, 'exec-old'), false);
  assert.equal(runtime.getActiveExecution(userKey, sessionId)?.executionId, 'exec-new');
  assert.equal(runtime.clearActiveExecution(userKey, sessionId, 'exec-new'), true);
  assert.equal(runtime.getActiveExecution(userKey, sessionId), null);
});

test('不同用户共享默认 sessionId 时活动执行状态互不覆盖', () => {
  const runtime = createRuntimeFixture();
  const sessionId = 'default';
  const userA = 'user-A';
  const userB = 'user-B';

  runtime.registerActiveExecution(userA, sessionId, {
    executionId: 'exec-a',
    userKey: userA,
    sessionId,
    currentAgentName: 'Alice',
    abortController: new AbortController(),
    stopMode: 'none'
  });
  runtime.registerActiveExecution(userB, sessionId, {
    executionId: 'exec-b',
    userKey: userB,
    sessionId,
    currentAgentName: 'Bob',
    abortController: new AbortController(),
    stopMode: 'none'
  });

  assert.equal(runtime.getActiveExecution(userA, sessionId)?.executionId, 'exec-a');
  assert.equal(runtime.getActiveExecution(userB, sessionId)?.executionId, 'exec-b');

  runtime.requestExecutionStop(userA, sessionId, 'session');
  assert.equal(runtime.consumeExecutionStopMode(userA, sessionId, 'exec-a'), 'session');
  assert.equal(runtime.consumeExecutionStopMode(userB, sessionId, 'exec-b'), 'none');
});

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

  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-redis-it-'));
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
  const redisKey = `agent-co:chat:sessions:test:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  if (options.redisState) {
    redisCli(['SET', redisKey, JSON.stringify(options.redisState)]);
  } else {
    redisCli(['DEL', redisKey]);
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-chat-redis-it-'));
  const agentDataFile = join(tempDir, 'agents.json');
  const authFixture = await createAuthAdminFixture();
  const port = getRandomPort();
  const child = spawn('node', ['dist/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
        PORT: String(port),
        AGENT_CO_AUTH_ENABLED: 'true',
        AGENT_CO_REDIS_REQUIRED: 'false',
        AGENT_CO_DISABLE_REDIS: 'false',
        AGENT_CO_CHAT_SESSIONS_KEY: redisKey,
        AGENT_DATA_FILE: agentDataFile,
        AUTH_ADMIN_TOKEN: 'integration-test-admin-token-1234567890',
        AUTH_ADMIN_BASE_URL: `http://127.0.0.1:${authFixture.port}`,
      AGENT_CO_CLI_TIMEOUT_MS: '15000',
      AGENT_CO_CLI_HEARTBEAT_TIMEOUT_MS: '5000',
      AGENT_CO_CLI_KILL_GRACE_MS: '200',
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
const agentName = process.env.AGENT_CO_AGENT_NAME || 'AI';
const sessionId = process.env.AGENT_CO_SESSION_ID || '';
const apiUrl = process.env.AGENT_CO_API_URL || '';
const token = process.env.AGENT_CO_CALLBACK_TOKEN || '';

async function post(content, invokeAgents) {
  const encodedAgentName = encodeURIComponent(agentName);
  const response = await fetch(new URL('/api/callbacks/post-message', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${token}\`,
      'Content-Type': 'application/json',
      'x-agent-co-callback-token': token,
      'x-agent-co-session-id': sessionId,
      'x-agent-co-agent': encodedAgentName
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
const agentName = process.env.AGENT_CO_AGENT_NAME || 'AI';
const sessionId = process.env.AGENT_CO_SESSION_ID || '';
const apiUrl = process.env.AGENT_CO_API_URL || '';
const token = process.env.AGENT_CO_CALLBACK_TOKEN || '';

async function post(content, invokeAgents) {
  const encodedAgentName = encodeURIComponent(agentName);
  const response = await fetch(new URL('/api/callbacks/post-message', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${token}\`,
      'Content-Type': 'application/json',
      'x-agent-co-callback-token': token,
      'x-agent-co-session-id': sessionId,
      'x-agent-co-agent': encodedAgentName
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

function createReviewLoopClaudeScript(tempDir, mode) {
  const fakeClaude = join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env node
const fs = require('node:fs');
const agentName = process.env.AGENT_CO_AGENT_NAME || 'AI';
const sessionId = process.env.AGENT_CO_SESSION_ID || '';
const apiUrl = process.env.AGENT_CO_API_URL || '';
const token = process.env.AGENT_CO_CALLBACK_TOKEN || '';
const prompt = process.argv.slice(2).join(' ');
const mode = ${JSON.stringify(mode)};
const stateFile = ${JSON.stringify(join(tempDir, 'review-loop-state.json'))};

function loadState() {
  if (!fs.existsSync(stateFile)) {
    return { bobCalls: 0, alicePrompts: [] };
  }
  return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
}

function saveState(state) {
  fs.writeFileSync(stateFile, JSON.stringify(state), 'utf8');
}

async function post(content, invokeAgents) {
  const encodedAgentName = encodeURIComponent(agentName);
  const response = await fetch(new URL('/api/callbacks/post-message', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${token}\`,
      'Content-Type': 'application/json',
      'x-agent-co-callback-token': token,
      'x-agent-co-session-id': sessionId,
      'x-agent-co-agent': encodedAgentName
    },
    body: JSON.stringify({ content, invokeAgents })
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

(async () => {
  if (agentName === 'Alice') {
    const state = loadState();
    state.alicePrompts.push(prompt);
    saveState(state);

    if (prompt.includes('accept / follow_up / retry') || prompt.includes('accept/follow_up/retry')) {
      if (mode === 'accept') {
        process.stdout.write('{"output_text":"accept: Bob 已给出可执行的三步方案。"}\\n');
      } else if (mode === 'late_reply_times_out') {
        if (prompt.includes('未在截止时间前回复')) {
          process.stdout.write('{"output_text":"accept: Bob 已超时，本轮按超时处理。"}\\n');
        } else {
          process.stdout.write('{"output_text":"accept: Bob 的回复可接受。"}\\n');
        }
      } else if (mode === 'timeout_retry_then_accept') {
        if (prompt.includes('未在截止时间前回复')) {
          process.stdout.write('{"output_text":"retry: 请 Bob 立即重新给出完整的三步落地方案。"}\\n');
        } else {
          process.stdout.write('{"output_text":"accept: Bob 已在重试后给出可执行的三步方案。"}\\n');
        }
      } else if (mode === 'follow_up_then_accept') {
        if (prompt.includes('Bob 的回复：收到，我稍后处理。')) {
          process.stdout.write('{"output_text":"follow_up: 请 Bob 补充具体步骤和验收方式。"}\\n');
        } else {
          process.stdout.write('{"output_text":"accept: Bob 已按追问补充了具体步骤。"}\\n');
        }
      } else if (mode === 'retry_cap_exceeded') {
        if (prompt.includes('未在截止时间前回复')) {
          process.stdout.write('{"output_text":"retry: 请 Bob 重新完整回答。"}\\n');
        } else {
          process.stdout.write('{"output_text":"follow_up: 请 Bob 补充验收细节。"}\\n');
        }
      } else if (mode === 'empty_follow_up_leak') {
        await post('Alice 的内部复核不应泄漏到历史');
        process.stdout.write('{"output_text":"follow_up:"}\\n');
      } else if (mode === 'accept_with_visible_callback') {
        await post('Alice 的内部 accept 不应泄漏到历史');
        process.stdout.write('{"output_text":"accept: Bob 已给出可执行的三步方案。"}\\n');
      } else {
        process.stdout.write('{"output_text":"follow_up: 请 Bob 补充具体步骤和验收方式。"}\\n');
      }
      return;
    }

    await post('请 @@Bob 给出三步落地方案', ['Bob']);
    process.stdout.write('{"output_text":"callback sent"}\\n');
    return;
  }

  if (agentName === 'Bob') {
    if (mode === 'accept') {
      await post('1. 建表并补索引。2. 实现服务与接口。3. 增加集成测试覆盖主链路。');
      process.stdout.write('{"output_text":"callback sent"}\\n');
    } else if (mode === 'late_reply_times_out') {
      const state = loadState();
      state.bobCalls += 1;
      saveState(state);
      await new Promise(resolve => setTimeout(resolve, 2300));
      await post('迟到回复：1. 建表。2. 实现接口。3. 增加集成测试。');
      process.stdout.write('{"output_text":"callback sent"}\\n');
    } else if (mode === 'timeout_retry_then_accept') {
      const state = loadState();
      state.bobCalls += 1;
      saveState(state);
      await post('重试结果：1. 建表。2. 实现接口。3. 增加集成测试。');
      process.stdout.write('{"output_text":"callback sent"}\\n');
    } else if (mode === 'follow_up_then_accept') {
      const state = loadState();
      state.bobCalls += 1;
      saveState(state);
      if (state.bobCalls === 1) {
        await post('收到，我稍后处理。');
      } else {
        await post('补充步骤：1. 建表。2. 实现接口。3. 增加验收测试。');
      }
      process.stdout.write('{"output_text":"callback sent"}\\n');
    } else {
      const state = loadState();
      state.bobCalls += 1;
      saveState(state);
      if (state.bobCalls === 1) {
        await post('收到，我稍后处理。');
        process.stdout.write('{"output_text":"callback sent"}\\n');
      }
    }
    return;
  }

  process.stdout.write(\`{"output_text":"\${agentName} 未命中测试分支"}\\n\`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`, 'utf8');
  chmodSync(fakeClaude, 0o755);
}

function createManualSummaryClaudeScript(tempDir, options = {}) {
  const fakeClaude = join(tempDir, 'claude');
  const delayMs = Number(options.delayMs || 0);
  const summaryInvokeAgents = options.summaryInvokeAgents || null;
  const summaryText = options.summaryText || 'Alice 总结：当前讨论已暂停，结论如下。';
  const stateFile = options.stateFile || null;
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
node - <<'EOF'
const fs = require('node:fs');
const agentName = process.env.AGENT_CO_AGENT_NAME || 'AI';
const sessionId = process.env.AGENT_CO_SESSION_ID || '';
const apiUrl = process.env.AGENT_CO_API_URL || '';
const token = process.env.AGENT_CO_CALLBACK_TOKEN || '';
const dispatchKind = process.env.AGENT_CO_DISPATCH_KIND || 'initial';
const stateFile = ${JSON.stringify(stateFile)};

function readState() {
  if (!stateFile || !fs.existsSync(stateFile)) {
    return { totalCalls: 0, summaryCalls: 0, agents: {} };
  }
  return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
}

function writeState(state) {
  if (!stateFile) return;
  fs.writeFileSync(stateFile, JSON.stringify(state), 'utf8');
}

async function post(content, invokeAgents) {
  const encodedAgentName = encodeURIComponent(agentName);
  const response = await fetch(new URL('/api/callbacks/post-message', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${token}\`,
      'Content-Type': 'application/json',
      'x-agent-co-callback-token': token,
      'x-agent-co-session-id': sessionId,
      'x-agent-co-agent': encodedAgentName
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
  const state = readState();
  state.totalCalls += 1;
  if (dispatchKind === 'summary') {
    state.summaryCalls += 1;
  }
  state.agents[agentName] = state.agents[agentName] || { totalCalls: 0, summaryCalls: 0 };
  state.agents[agentName].totalCalls += 1;
  if (dispatchKind === 'summary') {
    state.agents[agentName].summaryCalls += 1;
  }
  writeState(state);

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
const agentName = process.env.AGENT_CO_AGENT_NAME || 'AI';
const sessionId = process.env.AGENT_CO_SESSION_ID || '';
const apiUrl = process.env.AGENT_CO_API_URL || '';
const token = process.env.AGENT_CO_CALLBACK_TOKEN || '';

async function post(content, invokeAgents) {
  const encodedAgentName = encodeURIComponent(agentName);
  const response = await fetch(new URL('/api/callbacks/post-message', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${token}\`,
      'Content-Type': 'application/json',
      'x-agent-co-callback-token': token,
      'x-agent-co-session-id': sessionId,
      'x-agent-co-agent': encodedAgentName
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
const agentName = process.env.AGENT_CO_AGENT_NAME || 'AI';
const sessionId = process.env.AGENT_CO_SESSION_ID || '';
const apiUrl = process.env.AGENT_CO_API_URL || '';
const token = process.env.AGENT_CO_CALLBACK_TOKEN || '';

async function post(content, invokeAgents) {
  const encodedAgentName = encodeURIComponent(agentName);
  const response = await fetch(new URL('/api/callbacks/post-message', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${token}\`,
      'Content-Type': 'application/json',
      'x-agent-co-callback-token': token,
      'x-agent-co-session-id': sessionId,
      'x-agent-co-agent': encodedAgentName
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

function createSingleAtContinuationClaudeScript(tempDir) {
  const fakeClaude = join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
node - <<'EOF'
const agentName = process.env.AGENT_CO_AGENT_NAME || 'AI';
if (agentName === 'Alice') {
  process.stdout.write(JSON.stringify({ output_text: '@Bob 请从增长视角继续补充。' }) + '\\n');
} else if (agentName === 'Bob') {
  process.stdout.write(JSON.stringify({ output_text: 'Bob 已收到 Alice 的点名并继续补充。' }) + '\\n');
} else {
  process.stdout.write(JSON.stringify({ output_text: \`\${agentName} 默认回复\` }) + '\\n');
}
EOF
`, 'utf8');
  chmodSync(fakeClaude, 0o755);
}

function createSingleAtReferenceOnlyClaudeScript(tempDir) {
  const fakeClaude = join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
node - <<'EOF'
const agentName = process.env.AGENT_CO_AGENT_NAME || 'AI';
if (agentName === 'Alice') {
  process.stdout.write(JSON.stringify({ output_text: '我同意 @Bob 刚才提到的增长判断。' }) + '\\n');
} else if (agentName === 'Bob') {
  process.stdout.write(JSON.stringify({ output_text: 'Bob 不应因普通引用被继续触发。' }) + '\\n');
} else {
  process.stdout.write(JSON.stringify({ output_text: \`\${agentName} 默认回复\` }) + '\\n');
}
EOF
`, 'utf8');
  chmodSync(fakeClaude, 0o755);
}

function createAllMentionClaudeScript(tempDir) {
  const fakeClaude = join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
node - <<'EOF'
const agentName = process.env.AGENT_CO_AGENT_NAME || 'AI';
if (agentName === 'Alice') {
  process.stdout.write(JSON.stringify({ output_text: '我建议 @所有人 稍后一起看下这个方向。' }) + '\\n');
} else {
  process.stdout.write(JSON.stringify({ output_text: \`\${agentName} 不应因 @所有人 被隐式继续触发\` }) + '\\n');
}
EOF
`, 'utf8');
  chmodSync(fakeClaude, 0o755);
}

test('统一 agent 调用入口会通过 CLI provider 返回结果', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-agent-invoker-cli-'));
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
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-agent-invoker-api-success-'));
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
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-agent-invoker-api-stream-'));
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
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-agent-invoker-api-history-filter-'));
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
    const tempDir = mkdtempSync(join(tmpdir(), `agent-co-agent-invoker-api-auth-${statusCode}-`));
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
    const tempDir = mkdtempSync(join(tmpdir(), `agent-co-agent-invoker-api-upstream-${statusCode}-`));
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
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-agent-invoker-api-invalid-body-'));
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
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-agent-invoker-api-empty-content-length-'));
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
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-agent-invoker-api-missing-connection-'));
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
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-agent-invoker-codex-'));
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
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-chat-api-agent-'));
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
      AGENT_CO_VERBOSE_LOG_DIR: join(tempDir, 'verbose-logs')
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

test('依赖状态接口继续返回可解析的 JSON 结构', async () => {
  const fixture = await createChatServerFixture();

  try {
    const response = await fixture.request('/api/dependencies/status');
    assert.equal(response.status === 200 || response.status === 503, true);
    assert.equal(typeof response.body.healthy, 'boolean');
    assert.equal(typeof response.body.checkedAt, 'number');
    assert.equal(Array.isArray(response.body.dependencies), true);
    assert.equal(Array.isArray(response.body.logs), true);
    assert.equal(response.body.dependencies.some(item => item.name === 'redis'), true);
  } finally {
    await fixture.cleanup();
  }
});

test('chat-stream 在 API 模式下会先推送 agent_delta，再推送最终 agent_message', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-chat-stream-api-agent-'));
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
      AGENT_CO_VERBOSE_LOG_DIR: join(tempDir, 'verbose-logs')
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

test('聊天服务对非法 JSON 登录请求返回 500 和错误信息', async () => {
  const fixture = await createChatServerFixture();

  try {
    const response = await requestRawJson(`http://127.0.0.1:${fixture.port}/api/login`, '{');
    assert.equal(response.status, 500);
    assert.equal(response.body.error, 'Invalid JSON');
  } finally {
    await fixture.cleanup();
  }
});

test('聊天服务保持原始的 404 兜底响应', async () => {
  const fixture = await createChatServerFixture();

  try {
    const response = await requestRaw(`http://127.0.0.1:${fixture.port}/missing-route`);
    assert.equal(response.status, 404);
    assert.equal(response.text, 'Not Found');
    assert.equal(response.headers.get('content-type'), null);
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
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-claude-chain-'));
  const fakeClaude = join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
node - <<'EOF'
const agentName = process.env.AGENT_CO_AGENT_NAME || 'AI';
const sessionId = process.env.AGENT_CO_SESSION_ID || '';
const apiUrl = process.env.AGENT_CO_API_URL || '';
const token = process.env.AGENT_CO_CALLBACK_TOKEN || '';

async function post(content, invokeAgents) {
  const encodedAgentName = encodeURIComponent(agentName);
  const response = await fetch(new URL('/api/callbacks/post-message', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${token}\`,
      'Content-Type': 'application/json',
      'x-agent-co-callback-token': token,
      'x-agent-co-session-id': sessionId,
      'x-agent-co-agent': encodedAgentName
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

test('agent 间调用会默认创建待复核任务', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-invocation-task-create-'));
  createReviewLoopClaudeScript(tempDir, 'accept');

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
      body: { message: '@Alice 发起调用并触发 Bob' }
    });

    assert.equal(chatResponse.status, 200);
    assert.equal(chatResponse.body.success, true);
    assert.deepEqual(
      chatResponse.body.aiMessages.map(item => item.sender),
      ['Alice', 'Bob']
    );

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    assert.equal(Array.isArray(historyResponse.body.session.invocationTasks), true);
    assert.equal(historyResponse.body.session.invocationTasks.length, 1);

    const [task] = historyResponse.body.session.invocationTasks;
    assert.equal(typeof task.id, 'string');
    assert.equal(task.id.length > 0, true);
    assert.equal(task.status, 'completed');
    assert.equal(task.reviewAction, 'accept');
    assert.equal(task.callerAgentName, 'Alice');
    assert.equal(task.calleeAgentName, 'Bob');
    assert.equal(typeof task.deadlineAt, 'number');
    assert.equal(Number.isFinite(task.deadlineAt), true);
    assert.equal(task.retryCount, 0);
    assert.equal(task.followupCount, 0);
    assert.equal(typeof task.lastReplyMessageId, 'string');
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('用户直接 @agent 不会创建调用者复核任务', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-invocation-task-user-no-review-'));
  createSingleReplyClaudeScript(tempDir);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();
    await enableAgents(fixture, ['Alice']);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice 这是用户发起的消息' }
    });

    assert.equal(chatResponse.status, 200);
    assert.equal(chatResponse.body.success, true);
    assert.deepEqual(
      chatResponse.body.aiMessages.map(item => item.sender),
      ['Alice']
    );

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    assert.equal(Array.isArray(historyResponse.body.session.invocationTasks), true);
    assert.equal(historyResponse.body.session.invocationTasks.length, 0);
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('被调用者回复会回传给调用者做 accept 复核', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-review-loop-accept-'));
  createReviewLoopClaudeScript(tempDir, 'accept');

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
      body: { message: '@Alice 发起调用并要求 Bob 给出落地方案' }
    });

    assert.equal(chatResponse.status, 200);
    assert.equal(chatResponse.body.success, true);

    const historyResponse = await waitForCondition(async () => {
      const history = await fixture.request('/api/history');
      const task = history.body?.session?.invocationTasks?.find(item => item.reviewAction === 'accept' && item.status === 'completed');
      return task ? history : null;
    }, 4000, 100);

    const assistantMessages = historyResponse.body.messages.filter(item => item.role === 'assistant');
    assert.deepEqual(
      assistantMessages.map(item => [item.sender, item.text]),
      [
        ['Alice', '请 @@Bob 给出三步落地方案'],
        ['Bob', '1. 建表并补索引。2. 实现服务与接口。3. 增加集成测试覆盖主链路。']
      ]
    );

    const bobReply = assistantMessages[1];
    assert.equal(typeof bobReply.taskId, 'string');
    assert.equal(bobReply.callerAgentName, 'Alice');
    assert.equal(bobReply.calleeAgentName, 'Bob');
    assert.equal(historyResponse.body.messages.some(item => item.reviewAction === 'accept'), false);

    const task = historyResponse.body.session.invocationTasks.find(item => item.id === bobReply.taskId);
    assert.ok(task);
    assert.equal(task.status, 'completed');
    assert.equal(task.reviewAction, 'accept');
    assert.equal(task.lastReplyMessageId, bobReply.id);
    assert.equal(typeof task.completedAt, 'number');
    assert.equal(task.originalPrompt, '请 @@Bob 给出三步落地方案');

    const promptState = JSON.parse(readFileSync(join(tempDir, 'review-loop-state.json'), 'utf8'));
    assert.equal(Array.isArray(promptState.alicePrompts), true);
    assert.equal(promptState.alicePrompts.length >= 2, true);
    const reviewPrompt = promptState.alicePrompts.find(item => item.includes('accept / follow_up / retry'));
    assert.equal(typeof reviewPrompt, 'string');
    assert.match(reviewPrompt, /原始委派请求：请 @@Bob 给出三步落地方案/);
    assert.match(reviewPrompt, /Bob 的回复：1\. 建表并补索引。2\. 实现服务与接口。3\. 增加集成测试覆盖主链路。/);
    assert.match(reviewPrompt, /accept: <接受原因>/);
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('被调用者敷衍回复后会进入 follow_up 并完成第二轮复核', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-review-loop-follow-up-'));
  createReviewLoopClaudeScript(tempDir, 'follow_up_then_accept');

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
      body: { message: '@Alice 发起调用并要求 Bob 给出落地方案' }
    });

    assert.equal(chatResponse.status, 200);
    assert.equal(chatResponse.body.success, true);

    const historyResponse = await waitForCondition(async () => {
      const history = await fixture.request('/api/history');
      const task = history.body?.session?.invocationTasks?.find(item => item.reviewAction === 'accept' && item.status === 'completed');
      return task ? history : null;
    }, 4000, 100);

    const assistantMessages = historyResponse.body.messages.filter(item => item.role === 'assistant');
    assert.deepEqual(
      assistantMessages.map(item => [item.sender, item.text]),
      [
        ['Alice', '请 @@Bob 给出三步落地方案'],
        ['Bob', '收到，我稍后处理。'],
        ['Bob', '补充步骤：1. 建表。2. 实现接口。3. 增加验收测试。']
      ]
    );

    const firstBobReply = assistantMessages[1];
    const secondBobReply = assistantMessages[2];
    assert.equal(typeof firstBobReply.taskId, 'string');
    assert.equal(secondBobReply.taskId, firstBobReply.taskId);
    assert.equal(historyResponse.body.messages.some(item => item.reviewAction === 'follow_up'), false);
    assert.equal(historyResponse.body.messages.some(item => item.reviewAction === 'accept'), false);

    const task = historyResponse.body.session.invocationTasks.find(item => item.id === firstBobReply.taskId);
    assert.ok(task);
    assert.equal(task.status, 'completed');
    assert.equal(task.reviewAction, 'accept');
    assert.equal(task.prompt, '请 Bob 补充具体步骤和验收方式。');
    assert.equal(task.originalPrompt, '请 @@Bob 给出三步落地方案');
    assert.equal(task.followupCount, 1);
    assert.equal(task.retryCount, 0);
    assert.equal(task.lastReplyMessageId, secondBobReply.id);

    const promptState = JSON.parse(readFileSync(join(tempDir, 'review-loop-state.json'), 'utf8'));
    assert.equal(Array.isArray(promptState.alicePrompts), true);
    assert.equal(promptState.alicePrompts.length >= 3, true);
    const reviewPrompts = promptState.alicePrompts.filter(item => item.includes('accept / follow_up / retry'));
    assert.equal(reviewPrompts.length >= 2, true);
    assert.match(reviewPrompts[0], /原始委派请求：请 @@Bob 给出三步落地方案/);
    assert.match(reviewPrompts[0], /Bob 的回复：收到，我稍后处理。/);
    assert.match(reviewPrompts[1], /原始委派请求：请 @@Bob 给出三步落地方案/);
    assert.match(reviewPrompts[1], /Bob 的回复：补充步骤：1\. 建表。2\. 实现接口。3\. 增加验收测试。/);
    assert.equal(historyResponse.body.messages.some(item => (item.text || '').includes('accept / follow_up / retry')), false);
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('内部 caller review 不会被 agentChainMaxCallsPerAgent 限制拦截', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-review-loop-call-limit-'));
  createReviewLoopClaudeScript(tempDir, 'accept');

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();
    await enableAgents(fixture, ['Alice', 'Bob']);

    const historyBefore = await fixture.request('/api/history');
    assert.equal(historyBefore.status, 200);

    const updateResponse = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId: historyBefore.body.session.id,
        patch: {
          agentChainMaxHops: 2,
          agentChainMaxCallsPerAgent: 1
        }
      }
    });
    assert.equal(updateResponse.status, 200);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice 发起调用并要求 Bob 给出落地方案' }
    });
    assert.equal(chatResponse.status, 200);
    assert.equal(chatResponse.body.success, true);

    const historyResponse = await waitForCondition(async () => {
      const history = await fixture.request('/api/history');
      const task = history.body?.session?.invocationTasks?.find(item => item.reviewAction === 'accept' && item.status === 'completed');
      return task ? history : null;
    }, 4000, 100);

    assert.deepEqual(
      historyResponse.body.messages.filter(item => item.role === 'assistant').map(item => item.sender),
      ['Alice', 'Bob']
    );

    const promptState = JSON.parse(readFileSync(join(tempDir, 'review-loop-state.json'), 'utf8'));
    const reviewPrompt = promptState.alicePrompts.find(item => item.includes('accept / follow_up / retry'));
    assert.equal(typeof reviewPrompt, 'string');
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('reviewer 输出空 follow_up 且伴随 callback 可见消息时会 fail-closed', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-review-loop-empty-follow-up-'));
  createReviewLoopClaudeScript(tempDir, 'empty_follow_up_leak');

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
      body: { message: '@Alice 发起调用并要求 Bob 给出落地方案' }
    });
    assert.equal(chatResponse.status, 200);
    assert.equal(chatResponse.body.success, true);

    const historyResponse = await waitForCondition(async () => {
      const history = await fixture.request('/api/history');
      const task = history.body?.session?.invocationTasks?.find(item => item.status === 'failed' && item.failureReason === 'invalid_review_result');
      return task ? history : null;
    }, 4000, 100);

    assert.deepEqual(
      historyResponse.body.messages.filter(item => item.role === 'assistant').map(item => [item.sender, item.text]),
      [
        ['Alice', '请 @@Bob 给出三步落地方案'],
        ['Bob', '收到，我稍后处理。']
      ]
    );
    assert.equal(historyResponse.body.messages.some(item => (item.text || '').includes('Alice 的内部复核不应泄漏到历史')), false);

    const task = historyResponse.body.session.invocationTasks[0];
    assert.equal(task.status, 'failed');
    assert.equal(task.failureReason, 'invalid_review_result');
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('缺少 invocationTask 的内部 review resume 不会泄漏可见消息', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-review-loop-missing-task-'));
  createReviewLoopClaudeScript(tempDir, 'accept_with_visible_callback');
  const now = Date.now();

  const fixture = await createRedisBackedChatServerFixture({
    redisState: {
      version: 1,
      userChatSessions: {
        'user:admin': [{
          id: 'default',
          name: '默认会话',
          history: [{
            id: 'm-user',
            role: 'user',
            sender: '用户',
            text: '@Alice 发起调用并要求 Bob 给出落地方案',
            timestamp: now - 3000
          }, {
            id: 'm-alice',
            role: 'assistant',
            sender: 'Alice',
            text: '请 @@Bob 给出三步落地方案',
            timestamp: now - 2500
          }, {
            id: 'm-bob',
            role: 'assistant',
            sender: 'Bob',
            text: '1. 建表并补索引。2. 实现服务与接口。3. 增加集成测试覆盖主链路。',
            timestamp: now - 2000,
            taskId: 'missing-task',
            callerAgentName: 'Alice',
            calleeAgentName: 'Bob'
          }],
          currentAgent: 'Alice',
          enabledAgents: ['Alice', 'Bob'],
          agentWorkdirs: {},
          pendingAgentTasks: [{
            agentName: 'Alice',
            prompt: '你正在复核 Bob 对委派任务的回复。\n原始委派请求：请 @@Bob 给出三步落地方案\nBob 的回复：1. 建表并补索引。2. 实现服务与接口。3. 增加集成测试覆盖主链路。\n只允许输出以下三种格式之一：\naccept: <接受原因>\nfollow_up: <下一条具体追问>\nretry: <要求对方重做的具体要求>\n关键词必须是 accept / follow_up / retry。',
            includeHistory: true,
            dispatchKind: 'internal_review',
            taskId: 'missing-task',
            callerAgentName: 'Alice',
            calleeAgentName: 'Bob',
            reviewMode: 'caller_review',
            deadlineAt: now + 5 * 60 * 1000
          }],
          pendingVisibleMessages: [],
          invocationTasks: [],
          agentChainMaxHops: 4,
          agentChainMaxCallsPerAgent: 1,
          discussionMode: 'classic',
          discussionState: 'active',
          createdAt: now - 4000,
          updatedAt: now - 1000
        }]
      },
      userActiveChatSession: {
        'user:admin': 'default'
      }
    },
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();

    const resumeResponse = await fixture.request('/api/chat-resume', {
      method: 'POST',
      body: {}
    });
    assert.equal(resumeResponse.status, 200);
    assert.equal(resumeResponse.body.success, true);
    assert.equal(resumeResponse.body.resumed, false);
    assert.deepEqual(resumeResponse.body.aiMessages, []);

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    assert.equal(historyResponse.body.messages.some(item => (item.text || '').includes('Alice 的内部 accept 不应泄漏到历史')), false);
    assert.equal(Array.isArray(historyResponse.body.session.pendingAgentTasks), false);
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('被调用者超时未回复后会走同一 caller review 路径并允许一次 retry', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-review-loop-timeout-retry-'));
  createReviewLoopClaudeScript(tempDir, 'timeout_retry_then_accept');
  const now = Date.now();

  const fixture = await createRedisBackedChatServerFixture({
    redisState: {
      version: 1,
      userChatSessions: {
        'user:admin': [{
          id: 'default',
          name: '默认会话',
          history: [{
            id: 'm-user',
            role: 'user',
            sender: '用户',
            text: '@Alice 发起调用并要求 Bob 给出落地方案',
            timestamp: now - 4000
          }, {
            id: 'm-alice',
            role: 'assistant',
            sender: 'Alice',
            text: '请 @@Bob 给出三步落地方案',
            timestamp: now - 3500
          }],
          currentAgent: 'Alice',
          enabledAgents: ['Alice', 'Bob'],
          agentWorkdirs: {},
          pendingAgentTasks: [{
            agentName: 'Bob',
            prompt: '请 @@Bob 给出三步落地方案',
            includeHistory: true,
            dispatchKind: 'explicit_chained',
            taskId: 'timeout-task',
            callerAgentName: 'Alice',
            calleeAgentName: 'Bob',
            reviewMode: 'caller_review',
            deadlineAt: now - 1000
          }],
          pendingVisibleMessages: [],
          invocationTasks: [{
            id: 'timeout-task',
            sessionId: 'default',
            status: 'pending_reply',
            callerAgentName: 'Alice',
            calleeAgentName: 'Bob',
            prompt: '请 @@Bob 给出三步落地方案',
            originalPrompt: '请 @@Bob 给出三步落地方案',
            createdAt: now - 3500,
            updatedAt: now - 3500,
            deadlineAt: now - 1000,
            retryCount: 0,
            followupCount: 0
          }],
          agentChainMaxHops: 8,
          agentChainMaxCallsPerAgent: null,
          discussionMode: 'classic',
          discussionState: 'active',
          createdAt: now - 5000,
          updatedAt: now - 1000
        }]
      },
      userActiveChatSession: {
        'user:admin': 'default'
      }
    },
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();

    const resumeResponse = await fixture.request('/api/chat-resume', {
      method: 'POST',
      body: {}
    });

    assert.equal(resumeResponse.status, 200);
    assert.equal(resumeResponse.body.success, true);
    assert.equal(resumeResponse.body.resumed, true);
    assert.deepEqual(
      resumeResponse.body.aiMessages.map(item => [item.sender, item.text]),
      [
        ['Bob', '重试结果：1. 建表。2. 实现接口。3. 增加集成测试。']
      ]
    );

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);

    const task = historyResponse.body.session.invocationTasks.find(item => item.id === 'timeout-task');
    assert.ok(task);
    assert.equal(task.status, 'completed');
    assert.equal(task.reviewAction, 'accept');
    assert.equal(task.retryCount, 1);
    assert.equal(task.followupCount, 0);
    assert.equal(task.originalPrompt, '请 @@Bob 给出三步落地方案');
    assert.equal(task.prompt, '请 Bob 立即重新给出完整的三步落地方案。');

    const promptState = JSON.parse(readFileSync(join(tempDir, 'review-loop-state.json'), 'utf8'));
    assert.equal(promptState.bobCalls, 1);
    assert.deepEqual(
      historyResponse.body.messages.filter(item => item.role === 'assistant').map(item => [item.sender, item.text]),
      [
        ['Alice', '请 @@Bob 给出三步落地方案'],
        ['Bob', '重试结果：1. 建表。2. 实现接口。3. 增加集成测试。']
      ]
    );
    const timeoutReviewPrompt = promptState.alicePrompts.find(item => item.includes('未在截止时间前回复'));
    assert.equal(typeof timeoutReviewPrompt, 'string');
    assert.match(timeoutReviewPrompt, /原始委派请求：请 @@Bob 给出三步落地方案/);
    assert.match(timeoutReviewPrompt, /Bob 未在截止时间前回复/);
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('被调用者按时开始但超时后才回复时会走 timeout review 而不是正常回复复核', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-review-loop-late-reply-timeout-'));
  createReviewLoopClaudeScript(tempDir, 'late_reply_times_out');
  const now = Date.now();

  const fixture = await createRedisBackedChatServerFixture({
    redisState: {
      version: 1,
      userChatSessions: {
        'user:admin': [{
          id: 'default',
          name: '默认会话',
          history: [{
            id: 'm-user',
            role: 'user',
            sender: '用户',
            text: '@Alice 发起调用并要求 Bob 给出落地方案',
            timestamp: now - 4000
          }, {
            id: 'm-alice',
            role: 'assistant',
            sender: 'Alice',
            text: '请 @@Bob 给出三步落地方案',
            timestamp: now - 3500
          }],
          currentAgent: 'Alice',
          enabledAgents: ['Alice', 'Bob'],
          agentWorkdirs: {},
          pendingAgentTasks: [{
            agentName: 'Bob',
            prompt: '请 @@Bob 给出三步落地方案',
            includeHistory: true,
            dispatchKind: 'explicit_chained',
            taskId: 'late-timeout-task',
            callerAgentName: 'Alice',
            calleeAgentName: 'Bob',
            reviewMode: 'caller_review',
            deadlineAt: now + 1800
          }],
          pendingVisibleMessages: [],
          invocationTasks: [{
            id: 'late-timeout-task',
            sessionId: 'default',
            status: 'pending_reply',
            callerAgentName: 'Alice',
            calleeAgentName: 'Bob',
            prompt: '请 @@Bob 给出三步落地方案',
            originalPrompt: '请 @@Bob 给出三步落地方案',
            createdAt: now - 3500,
            updatedAt: now - 3500,
            deadlineAt: now + 1800,
            retryCount: 0,
            followupCount: 0
          }],
          agentChainMaxHops: 8,
          agentChainMaxCallsPerAgent: null,
          discussionMode: 'classic',
          discussionState: 'active',
          createdAt: now - 5000,
          updatedAt: now - 1000
        }]
      },
      userActiveChatSession: {
        'user:admin': 'default'
      }
    },
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();

    const resumeResponse = await fixture.request('/api/chat-resume', {
      method: 'POST',
      body: {}
    });

    assert.equal(resumeResponse.status, 200);
    assert.equal(resumeResponse.body.success, true);
    assert.equal(resumeResponse.body.resumed, true);
    assert.deepEqual(resumeResponse.body.aiMessages, []);

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    assert.deepEqual(
      historyResponse.body.messages.filter(item => item.role === 'assistant').map(item => [item.sender, item.text]),
      [
        ['Alice', '请 @@Bob 给出三步落地方案']
      ]
    );

    const task = historyResponse.body.session.invocationTasks.find(item => item.id === 'late-timeout-task');
    assert.ok(task);
    assert.equal(task.status, 'completed');
    assert.equal(task.reviewAction, 'accept');
    assert.equal(task.lastReplyMessageId, undefined);

    const promptState = JSON.parse(readFileSync(join(tempDir, 'review-loop-state.json'), 'utf8'));
    assert.equal(promptState.bobCalls, 1);
    assert.equal(promptState.alicePrompts.some(item => item.includes('未在截止时间前回复')), true);
    assert.equal(promptState.alicePrompts.some(item => item.includes('Bob 的回复：迟到回复')), false);
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('超出 retry 或 follow_up 上限会将任务标记为 failed 且停止循环', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-review-loop-cap-failed-'));
  createReviewLoopClaudeScript(tempDir, 'retry_cap_exceeded');
  const now = Date.now();

  const fixture = await createRedisBackedChatServerFixture({
    redisState: {
      version: 1,
      userChatSessions: {
        'user:admin': [{
          id: 'default',
          name: '默认会话',
          history: [{
            id: 'm-user',
            role: 'user',
            sender: '用户',
            text: '@Alice 发起调用并要求 Bob 给出落地方案',
            timestamp: now - 4000
          }, {
            id: 'm-alice',
            role: 'assistant',
            sender: 'Alice',
            text: '请 @@Bob 给出三步落地方案',
            timestamp: now - 3500
          }],
          currentAgent: 'Alice',
          enabledAgents: ['Alice', 'Bob'],
          agentWorkdirs: {},
          pendingAgentTasks: [{
            agentName: 'Alice',
            prompt: '你正在复核 Bob 对委派任务的回复。\n原始委派请求：请 @@Bob 给出三步落地方案\nBob 未在截止时间前回复，请只允许输出以下三种格式之一：\naccept: <接受原因>\nfollow_up: <下一条具体追问>\nretry: <要求对方重做的具体要求>\n关键词必须是 accept / follow_up / retry。',
            includeHistory: true,
            dispatchKind: 'internal_review',
            taskId: 'retry-cap-task',
            callerAgentName: 'Alice',
            calleeAgentName: 'Bob',
            reviewMode: 'caller_review',
            deadlineAt: now + 5 * 60 * 1000
          }, {
            agentName: 'Alice',
            prompt: '你正在复核 Bob 对委派任务的回复。\n原始委派请求：请 @@Bob 给出三步落地方案\nBob 的回复：收到，我稍后处理。\n只允许输出以下三种格式之一：\naccept: <接受原因>\nfollow_up: <下一条具体追问>\nretry: <要求对方重做的具体要求>\n关键词必须是 accept / follow_up / retry。',
            includeHistory: true,
            dispatchKind: 'internal_review',
            taskId: 'follow-up-cap-task',
            callerAgentName: 'Alice',
            calleeAgentName: 'Bob',
            reviewMode: 'caller_review',
            deadlineAt: now + 5 * 60 * 1000
          }],
          pendingVisibleMessages: [],
          invocationTasks: [{
            id: 'retry-cap-task',
            sessionId: 'default',
            status: 'awaiting_caller_review',
            callerAgentName: 'Alice',
            calleeAgentName: 'Bob',
            prompt: '请 Bob 重新完整回答。',
            originalPrompt: '请 @@Bob 给出三步落地方案',
            createdAt: now - 3500,
            updatedAt: now - 3500,
            deadlineAt: now + 5 * 60 * 1000,
            retryCount: 1,
            followupCount: 0
          }, {
            id: 'follow-up-cap-task',
            sessionId: 'default',
            status: 'awaiting_caller_review',
            callerAgentName: 'Alice',
            calleeAgentName: 'Bob',
            prompt: '请 Bob 补充验收细节。',
            originalPrompt: '请 @@Bob 给出三步落地方案',
            createdAt: now - 3500,
            updatedAt: now - 3500,
            deadlineAt: now + 5 * 60 * 1000,
            retryCount: 0,
            followupCount: 2
          }],
          agentChainMaxHops: 8,
          agentChainMaxCallsPerAgent: null,
          discussionMode: 'classic',
          discussionState: 'active',
          createdAt: now - 5000,
          updatedAt: now - 1000
        }]
      },
      userActiveChatSession: {
        'user:admin': 'default'
      }
    },
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();

    const resumeResponse = await fixture.request('/api/chat-resume', {
      method: 'POST',
      body: {}
    });

    assert.equal(resumeResponse.status, 200);
    assert.equal(resumeResponse.body.success, true);
    assert.equal(resumeResponse.body.resumed, true);
    assert.deepEqual(resumeResponse.body.aiMessages, []);

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    assert.equal(Array.isArray(historyResponse.body.session.pendingAgentTasks), false);

    const retryTask = historyResponse.body.session.invocationTasks.find(item => item.id === 'retry-cap-task');
    assert.ok(retryTask);
    assert.equal(retryTask.status, 'failed');

    const followUpTask = historyResponse.body.session.invocationTasks.find(item => item.id === 'follow-up-cap-task');
    assert.ok(followUpTask);
    assert.equal(followUpTask.status, 'failed');

    assert.equal(
      historyResponse.body.session.invocationTasks.some(item => item.calleeAgentName === 'Bob' && item.status === 'pending_reply'),
      false
    );
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('流式连接中断后不会继续执行后续被 @ 的智能体链路', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-stream-abort-'));
  const fakeClaude = join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
node - <<'EOF'
const agentName = process.env.AGENT_CO_AGENT_NAME || 'AI';
const sessionId = process.env.AGENT_CO_SESSION_ID || '';
const apiUrl = process.env.AGENT_CO_API_URL || '';
const token = process.env.AGENT_CO_CALLBACK_TOKEN || '';

async function post(content, invokeAgents) {
  const encodedAgentName = encodeURIComponent(agentName);
  const response = await fetch(new URL('/api/callbacks/post-message', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${token}\`,
      'Content-Type': 'application/json',
      'x-agent-co-callback-token': token,
      'x-agent-co-session-id': sessionId,
      'x-agent-co-agent': encodedAgentName
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

test('流式中断后待执行链路会保留调用复核元数据', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-stream-pending-task-metadata-'));
  const fakeClaude = join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
node - <<'EOF'
const agentName = process.env.AGENT_CO_AGENT_NAME || 'AI';
const sessionId = process.env.AGENT_CO_SESSION_ID || '';
const apiUrl = process.env.AGENT_CO_API_URL || '';
const token = process.env.AGENT_CO_CALLBACK_TOKEN || '';

async function post(content, invokeAgents) {
  const encodedAgentName = encodeURIComponent(agentName);
  const response = await fetch(new URL('/api/callbacks/post-message', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${token}\`,
      'Content-Type': 'application/json',
      'x-agent-co-callback-token': token,
      'x-agent-co-session-id': sessionId,
      'x-agent-co-agent': encodedAgentName
    },
    body: JSON.stringify({ content, invokeAgents })
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  if (agentName === 'Alice') {
    await post('请 @@Bob 接力补充结论', ['Bob']);
    await sleep(200);
  } else if (agentName === 'Bob') {
    await sleep(2000);
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
      body: JSON.stringify({ message: '@Alice 发起协作并在首条回复后断开' }),
      signal: controller.signal
    });
    assert.equal(response.status, 200);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let aliceThinkingSeen = false;

    const deadline = Date.now() + 5000;
    while (!aliceThinkingSeen) {
      assert.ok(Date.now() < deadline, 'stream should emit Alice thinking before timeout');
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
            aliceThinkingSeen = true;
            break;
          }
          eventType = '';
        }
      }
    }

    controller.abort();
    await reader.cancel().catch(() => {});

    const historyWithPending = await waitForCondition(async () => {
      const history = await fixture.request('/api/history');
      if (!Array.isArray(history.body?.session?.pendingAgentTasks)) return null;
      if (history.body.session.pendingAgentTasks.length === 0) return null;
      return history;
    }, 6000, 120);

    const [pendingTask] = historyWithPending.body.session.pendingAgentTasks;
    assert.equal(pendingTask.agentName, 'Bob');
    assert.equal(typeof pendingTask.taskId, 'string');
    assert.equal(pendingTask.taskId.length > 0, true);
    assert.equal(pendingTask.callerAgentName, 'Alice');
    assert.equal(pendingTask.reviewMode, 'caller_review');
    assert.equal(typeof pendingTask.deadlineAt, 'number');
    assert.equal(Number.isFinite(pendingTask.deadlineAt), true);

    assert.equal(Array.isArray(historyWithPending.body.session.invocationTasks), true);
    assert.equal(historyWithPending.body.session.invocationTasks.length >= 1, true);
    const matchedTask = historyWithPending.body.session.invocationTasks.find(item => item.id === pendingTask.taskId);
    assert.ok(matchedTask);
    assert.equal(matchedTask.callerAgentName, 'Alice');
    assert.equal(matchedTask.calleeAgentName, 'Bob');
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('支持带中文标点的 @Codex架构师 提及', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-codex-mention-'));
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
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-fullwidth-all-'));
  const fakeClaude = join(tempDir, 'claude');
  const fakeCodex = join(tempDir, 'codex');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
agent_name="\${AGENT_CO_AGENT_NAME:-Claude}"
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
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-broadcast-all-'));
  const fakeClaude = join(tempDir, 'claude');
  const fakeCodex = join(tempDir, 'codex');
  const agentDataFile = join(tempDir, 'agents.json');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
printf '{"output_text":"%s 已收到"}\\n' "\${AGENT_CO_AGENT_NAME:-AI}"
`, 'utf8');
  writeFileSync(fakeCodex, `#!/usr/bin/env bash
printf '{"output_text":"{\\"output_text\\":\\"%s 已收到\\"}\\n"' "\${AGENT_CO_AGENT_NAME:-AI}"
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
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-codex-'));
  const fakeCodex = join(tempDir, 'codex');
  writeFileSync(fakeCodex, `#!/usr/bin/env bash
printf '{"output_text":"这是 Codex 直接回复（无回调）"}\\n'
`, 'utf8');
  chmodSync(fakeCodex, 0o755);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`,
      AGENT_CO_VERBOSE_LOG_DIR: join(tempDir, 'verbose-logs')
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
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-codex-auth-error-'));
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
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-codex-usage-limit-'));
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
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-codex-verbose-'));
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
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-codex-stream-'));
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
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-codex-empty-stream-'));
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

test('Codex 直出包含 agent_co 工具编排痕迹时，不应把内部协作过程直接展示给用户', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-codex-internal-leak-'));
  const fakeCodex = join(tempDir, 'codex');
  writeFileSync(fakeCodex, `#!/usr/bin/env bash
printf '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"先读取会话协作技能说明并拉取聊天室上下文。已按要求先调用 ` + "\"`agent_co_get_context`" + ` 获取完整会话历史，又尝试用 ` + "\"`agent_co_post_message`" + ` 往群里同步结论。"}}\\n'
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
    assert.doesNotMatch(codexMessage.text, /agent_co_get_context/u);
    assert.doesNotMatch(codexMessage.text, /agent_co_post_message/u);
    assert.doesNotMatch(codexMessage.text, /先读取会话协作技能说明/u);
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('chat-stream 会继续推送由智能体 @ 触发的后续智能体消息', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-claude-stream-chain-'));
  const fakeClaude = join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
node - <<'EOF'
const agentName = process.env.AGENT_CO_AGENT_NAME || 'AI';
const sessionId = process.env.AGENT_CO_SESSION_ID || '';
const apiUrl = process.env.AGENT_CO_API_URL || '';
const token = process.env.AGENT_CO_CALLBACK_TOKEN || '';

async function post(content, invokeAgents) {
  const encodedAgentName = encodeURIComponent(agentName);
  const response = await fetch(new URL('/api/callbacks/post-message', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${token}\`,
      'Content-Type': 'application/json',
      'x-agent-co-callback-token': token,
      'x-agent-co-session-id': sessionId,
      'x-agent-co-agent': encodedAgentName
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
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-claude-stream-disconnect-log-'));
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

test('chat-stream 会在长时间无可见输出时持续推送 heartbeat，避免连接空闲断开', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-claude-stream-heartbeat-'));
  const fakeClaude = join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
sleep 1
printf '{"output_text":"late reply"}\\n'
`, 'utf8');
  chmodSync(fakeClaude, 0o755);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`,
      AGENT_CO_SSE_HEARTBEAT_INTERVAL_MS: '100'
    }
  });

  try {
    await fixture.login();
    await enableAgents(fixture, ['Claude']);

    const streamResponse = await fixture.request('/api/chat-stream', {
      method: 'POST',
      body: { message: '@Claude 触发 heartbeat' }
    });

    assert.equal(streamResponse.status, 200);
    assert.ok(streamResponse.text.includes('event: heartbeat'));
    assert.ok(streamResponse.text.includes('event: agent_message'));
    assert.ok(streamResponse.text.includes('late reply'));
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('chat-stream 客户端中途断开时会取消当前正在执行的智能体，避免断流后继续落库', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-claude-stream-abort-current-'));
  const fakeClaude = join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
sleep 2
printf '{"output_text":"late reply should not persist"}\\n'
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
      body: JSON.stringify({ message: '@Claude 当前执行也要在断流后取消' }),
      signal: abortController.signal
    });

    assert.equal(streamResponse.status, 200);
    const reader = streamResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let thinkingSeen = false;

    const thinkingDeadline = Date.now() + 5000;
    while (!thinkingSeen) {
      assert.ok(Date.now() < thinkingDeadline, 'stream should emit Claude thinking before timeout');
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
          if (eventType === 'agent_thinking' && payload.agent === 'Claude') {
            thinkingSeen = true;
            break;
          }
          eventType = '';
        }
      }
    }

    abortController.abort();
    await reader.cancel().catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 2400));

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    const assistantMessages = historyResponse.body.messages
      .filter(item => item.role === 'assistant')
      .map(item => item.text);

    assert.ok(!assistantMessages.includes('late reply should not persist'));
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('chat-resume 会继续执行流式中断后剩余的智能体链路，避免重复执行已完成节点', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-stream-resume-chain-'));
  const fakeClaude = join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
node - <<'EOF'
const agentName = process.env.AGENT_CO_AGENT_NAME || 'AI';
const sessionId = process.env.AGENT_CO_SESSION_ID || '';
const apiUrl = process.env.AGENT_CO_API_URL || '';
const token = process.env.AGENT_CO_CALLBACK_TOKEN || '';

async function post(content) {
  const encodedAgentName = encodeURIComponent(agentName);
  const response = await fetch(new URL('/api/callbacks/post-message', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${token}\`,
      'Content-Type': 'application/json',
      'x-agent-co-callback-token': token,
      'x-agent-co-session-id': sessionId,
      'x-agent-co-agent': encodedAgentName
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
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-codex-callback-'));
  const fakeCodex = join(tempDir, 'codex');
  writeFileSync(fakeCodex, `#!/usr/bin/env bash
node - <<'EOF'
const agentName = process.env.AGENT_CO_AGENT_NAME || 'AI';
const sessionId = process.env.AGENT_CO_SESSION_ID || '';
const apiUrl = process.env.AGENT_CO_API_URL || '';
const token = process.env.AGENT_CO_CALLBACK_TOKEN || '';

(async () => {
  const contextUrl = new URL('/api/callbacks/thread-context', apiUrl);
  contextUrl.searchParams.set('sessionid', sessionId);
  const encodedAgentName = encodeURIComponent(agentName);

  await fetch(contextUrl, {
    headers: {
      Authorization: \`Bearer \${token}\`,
      'x-agent-co-callback-token': token,
      'x-agent-co-session-id': sessionId,
      'x-agent-co-agent': encodedAgentName
    }
  });

  await fetch(new URL('/api/callbacks/post-message', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${token}\`,
      'Content-Type': 'application/json',
      'x-agent-co-callback-token': token,
      'x-agent-co-session-id': sessionId,
      'x-agent-co-agent': encodedAgentName
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
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-peer-paused-'));
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
    assert.equal(Array.isArray(historyResponse.body.session.invocationTasks), true);
    assert.equal(historyResponse.body.session.invocationTasks.length, 0);
    assert.equal(historyResponse.body.session.pendingAgentTasks, undefined);
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('peer 会话切回 classic 时会将 discussionState 归一化为 active', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-peer-to-classic-'));
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
      body: { name: 'peer to classic normalization' }
    });
    assert.equal(createResponse.status, 200);
    await enableAgents(fixture, ['Alice']);

    const sessionId = createResponse.body.session.id;
    const peerResponse = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId,
        patch: {
          discussionMode: 'peer'
        }
      }
    });
    assert.equal(peerResponse.status, 200);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice 请先发表看法' }
    });
    assert.equal(chatResponse.status, 200);

    const pausedHistoryResponse = await fixture.request('/api/history');
    assert.equal(pausedHistoryResponse.status, 200);
    assert.equal(pausedHistoryResponse.body.session.discussionState, 'paused');

    const classicResponse = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId,
        patch: {
          discussionMode: 'classic'
        }
      }
    });
    assert.equal(classicResponse.status, 200);
    assert.equal(classicResponse.body.session.discussionMode, 'classic');
    assert.equal(classicResponse.body.session.discussionState, 'active');

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    assert.equal(historyResponse.body.session.discussionMode, 'classic');
    assert.equal(historyResponse.body.session.discussionState, 'active');
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('peer 模式下若最终已无待继续讨论则会标记为 paused，即使本轮较早消息曾显式继续', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-peer-multi-visible-'));
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
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-peer-blocked-chain-'));
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

test('peer 模式下单 @ 点名会兼容升级为继续传播', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-peer-single-at-upgrade-'));
  createSingleAtContinuationClaudeScript(tempDir);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'peer single at upgrade discussion' }
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
      body: { message: '@Alice 请开始讨论' }
    });

    assert.equal(chatResponse.status, 200);
    assert.deepEqual(chatResponse.body.aiMessages.map(item => item.sender), ['Alice', 'Bob']);
    assert.deepEqual(chatResponse.body.aiMessages[0].invokeAgents, ['Bob']);
    assert.match(chatResponse.body.aiMessages[0].text, /@@Bob/);

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    assert.equal(historyResponse.body.session.discussionMode, 'peer');
    assert.equal(historyResponse.body.session.discussionState, 'paused');
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('peer 模式下普通引用型单 @ 不会被兼容升级为继续传播', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-peer-single-at-reference-only-'));
  createSingleAtReferenceOnlyClaudeScript(tempDir);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'peer single at reference only discussion' }
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
      body: { message: '@Alice 请开始讨论' }
    });

    assert.equal(chatResponse.status, 200);
    assert.deepEqual(chatResponse.body.aiMessages.map(item => item.sender), ['Alice']);
    assert.equal(chatResponse.body.aiMessages[0].invokeAgents, undefined);
    assert.doesNotMatch(chatResponse.body.aiMessages[0].text, /@@Bob/);

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    assert.equal(historyResponse.body.session.discussionState, 'paused');
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('peer 模式下 @所有人 不会被兼容升级为继续传播', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-peer-all-no-upgrade-'));
  createAllMentionClaudeScript(tempDir);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'peer all no upgrade discussion' }
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
      body: { message: '@Alice 请开始讨论' }
    });

    assert.equal(chatResponse.status, 200);
    assert.deepEqual(chatResponse.body.aiMessages.map(item => item.sender), ['Alice']);
    assert.equal(chatResponse.body.aiMessages[0].invokeAgents, undefined);
    assert.doesNotMatch(chatResponse.body.aiMessages[0].text, /@@/);

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    assert.equal(historyResponse.body.session.discussionState, 'paused');
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('legacy chained pending task 在恢复执行时会被兼容映射并继续执行', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-legacy-chained-resume-'));
  const fakeClaude = join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
node - <<'EOF'
const agentName = process.env.AGENT_CO_AGENT_NAME || 'AI';
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
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-classic-chain-'));
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

test('classic 模式下单 @ 点名不会兼容升级为继续传播', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-classic-single-at-no-upgrade-'));
  createSingleAtContinuationClaudeScript(tempDir);

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'classic single at no upgrade discussion' }
    });
    assert.equal(createResponse.status, 200);
    await enableAgents(fixture, ['Alice', 'Bob']);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice 请开始讨论' }
    });

    assert.equal(chatResponse.status, 200);
    assert.deepEqual(chatResponse.body.aiMessages.map(item => item.sender), ['Alice']);
    assert.equal(chatResponse.body.aiMessages[0].invokeAgents, undefined);

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    assert.equal(historyResponse.body.session.discussionMode, 'classic');
    assert.equal(historyResponse.body.session.discussionState, 'active');
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('classic 模式下 callback invokeAgents 指向未启用 agent 时会被过滤', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-classic-chain-disabled-target-'));
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
      body: { name: 'classic disabled chained target discussion' }
    });
    assert.equal(createResponse.status, 200);
    await enableAgents(fixture, ['Alice']);

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice 请开始讨论' }
    });

    assert.equal(chatResponse.status, 200);
    assert.deepEqual(chatResponse.body.aiMessages.map(item => item.sender), ['Alice']);
    assert.equal(chatResponse.body.aiMessages[0].invokeAgents, undefined);

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    assert.deepEqual(historyResponse.body.messages.map(item => item.sender), ['用户', 'Alice']);
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('peer 模式下可手动触发生成总结', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-peer-manual-summary-'));
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

test('peer 模式下生成总结支持按 sessionId 指向非当前活跃会话', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-peer-summary-session-id-'));
  createManualSummaryClaudeScript(tempDir, {
    summaryText: 'Alice 总结：这是指定会话的总结。'
  });

  const fixture = await createChatServerFixture({
    env: {
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();

    const targetSessionResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'peer summary target session' }
    });
    assert.equal(targetSessionResponse.status, 200);
    const targetSessionId = targetSessionResponse.body.session.id;
    await enableAgents(fixture, ['Alice']);

    const peerResponse = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId: targetSessionId,
        patch: {
          discussionMode: 'peer'
        }
      }
    });
    assert.equal(peerResponse.status, 200);

    const targetChatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice 请先发表看法' }
    });
    assert.equal(targetChatResponse.status, 200);

    const otherSessionResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'active classic session' }
    });
    assert.equal(otherSessionResponse.status, 200);
    const otherSessionId = otherSessionResponse.body.session.id;

    const activeHistoryBeforeSummary = await fixture.request('/api/history');
    assert.equal(activeHistoryBeforeSummary.status, 200);
    assert.equal(activeHistoryBeforeSummary.body.session.id, otherSessionId);
    assert.equal(activeHistoryBeforeSummary.body.session.discussionMode, 'classic');

    const summaryResponse = await fixture.request('/api/chat-summary', {
      method: 'POST',
      body: { sessionId: targetSessionId }
    });
    assert.equal(summaryResponse.status, 200);
    assert.deepEqual(summaryResponse.body.aiMessages.map(item => item.sender), ['Alice']);
    assert.equal(summaryResponse.body.aiMessages[0].dispatchKind, 'summary');
    assert.match(summaryResponse.body.aiMessages[0].text, /指定会话的总结/);

    const stillActiveHistory = await fixture.request('/api/history');
    assert.equal(stillActiveHistory.status, 200);
    assert.equal(stillActiveHistory.body.session.id, otherSessionId);
    assert.equal(stillActiveHistory.body.session.discussionMode, 'classic');

    const selectTargetResponse = await fixture.request('/api/sessions/select', {
      method: 'POST',
      body: { sessionId: targetSessionId }
    });
    assert.equal(selectTargetResponse.status, 200);
    assert.equal(selectTargetResponse.body.session.id, targetSessionId);
    assert.equal(selectTargetResponse.body.session.discussionMode, 'peer');
    assert.equal(selectTargetResponse.body.session.discussionState, 'paused');
    assert.equal(selectTargetResponse.body.messages.at(-1).dispatchKind, 'summary');
    assert.match(selectTargetResponse.body.messages.at(-1).text, /指定会话的总结/);
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('peer 模式下生成总结完成后会恢复原有 active 讨论状态', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-peer-summary-restore-active-'));
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

test('peer 模式下重复触发生成总结会被拒绝且不破坏原有讨论状态', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-peer-summary-duplicate-'));
  createManualSummaryClaudeScript(tempDir, {
    delayMs: 700,
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
                text: '@Alice 请总结当前进展',
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

    const firstSummaryRequest = fixture.request('/api/chat-summary', {
      method: 'POST',
      body: {}
    });

    await waitForCondition(async () => {
      const historyResponse = await fixture.request('/api/history');
      if (historyResponse.body.session.discussionState === 'summarizing') {
        return historyResponse;
      }
      return null;
    }, 4000, 100);

    const secondSummaryResponse = await fixture.request('/api/chat-summary', {
      method: 'POST',
      body: {}
    });
    assert.equal(secondSummaryResponse.status, 409);
    assert.match(secondSummaryResponse.body.error, /总结.*进行中|已有.*总结/);

    const firstSummaryResponse = await firstSummaryRequest;
    assert.equal(firstSummaryResponse.status, 200);
    assert.equal(firstSummaryResponse.body.aiMessages[0].dispatchKind, 'summary');

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
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
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('peer 模式下生成总结期间会拒绝新的聊天请求且不破坏原有讨论状态', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-peer-summary-chat-block-'));
  createManualSummaryClaudeScript(tempDir, {
    delayMs: 700,
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
                text: '@Alice 请总结当前进展',
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

    const firstSummaryRequest = fixture.request('/api/chat-summary', {
      method: 'POST',
      body: {}
    });

    await waitForCondition(async () => {
      const historyResponse = await fixture.request('/api/history');
      if (historyResponse.body.session.discussionState === 'summarizing') {
        return historyResponse;
      }
      return null;
    }, 4000, 100);

    const chatDuringSummaryResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Bob 现在继续讨论' }
    });
    assert.equal(chatDuringSummaryResponse.status, 409);
    assert.match(chatDuringSummaryResponse.body.error, /总结.*进行中|正在生成总结/);

    const firstSummaryResponse = await firstSummaryRequest;
    assert.equal(firstSummaryResponse.status, 200);
    assert.equal(firstSummaryResponse.body.aiMessages[0].dispatchKind, 'summary');

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    assert.deepEqual(historyResponse.body.messages.map(item => item.text), [
      '@Alice 请总结当前进展',
      'Alice 总结：当前仍有待继续的讨论分支。'
    ]);
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
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('非 test 环境启动时会忽略 Redis 中残留的测试 chat_sessions_key 并回退正式 key', async () => {
  const previousDefaultState = redisCli(['GET', 'agent-co:chat:sessions:v1']);
  const previousConfiguredKey = redisCli(['HGET', 'agent-co:config', 'chat_sessions_key']);
  const now = Date.now();
  const testRedisKey = `agent-co:chat:sessions:test:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  const productionState = {
    version: 1,
    userChatSessions: {
      'user:admin': [
        {
          id: 'default',
          name: '正式恢复会话',
          history: [
            {
              id: 'prod-msg-1',
              role: 'user',
              sender: '用户',
              text: '这是一条正式会话消息',
              timestamp: now - 1000
            }
          ],
          currentAgent: null,
          enabledAgents: [],
          agentWorkdirs: {},
          createdAt: now - 1000,
          updatedAt: now
        }
      ]
    },
    userActiveChatSession: {
      'user:admin': 'default'
    }
  };

  redisCli(['SET', 'agent-co:chat:sessions:v1', JSON.stringify(productionState)]);
  redisCli(['SET', testRedisKey, JSON.stringify({
    version: 1,
    userChatSessions: {
      'user:admin': [
        {
          id: 'default',
          name: '测试污染会话',
          history: [],
          currentAgent: null,
          enabledAgents: [],
          agentWorkdirs: {},
          createdAt: now - 500,
          updatedAt: now - 500
        }
      ]
    },
    userActiveChatSession: {
      'user:admin': 'default'
    }
  })]);
  redisCli(['HSET', 'agent-co:config', 'chat_sessions_key', testRedisKey]);

  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-prod-ignore-test-key-'));
  const agentDataFile = join(tempDir, 'agents.json');
  const authFixture = await createAuthAdminFixture();
  const port = getRandomPort();
  const child = spawn('node', ['dist/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      AGENT_CO_AUTH_ENABLED: 'true',
      AGENT_CO_REDIS_REQUIRED: 'false',
      AGENT_CO_DISABLE_REDIS: 'false',
      AGENT_DATA_FILE: agentDataFile,
      AUTH_ADMIN_TOKEN: 'integration-test-admin-token-1234567890',
      AUTH_ADMIN_BASE_URL: `http://127.0.0.1:${authFixture.port}`,
      AGENT_CO_CLI_TIMEOUT_MS: '15000',
      AGENT_CO_CLI_HEARTBEAT_TIMEOUT_MS: '5000',
      AGENT_CO_CLI_KILL_GRACE_MS: '200'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  try {
    await waitForChatServer(port);

    const loginResponse = await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username: 'admin', password: 'Admin1234!@#' })
    });
    const loginText = await loginResponse.text();
    assert.equal(loginResponse.status, 200, loginText);

    const cookies = parseSetCookie(loginResponse.headers.get('set-cookie')).join('; ');
    const historyResponse = await fetch(`http://127.0.0.1:${port}/api/history`, {
      headers: {
        Cookie: cookies
      }
    });
    const historyText = await historyResponse.text();
    assert.equal(historyResponse.status, 200, historyText);
    const historyBody = JSON.parse(historyText);

    assert.equal(historyBody.session.name, '正式恢复会话');
    assert.equal(historyBody.messages.length, 1);
    assert.ok(historyBody.chatSessions.some(item => item.name === '正式恢复会话'));
    assert.ok(!historyBody.chatSessions.some(item => item.name === '测试污染会话'));
  } finally {
    if (!child.killed) {
      child.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 150));
      if (!child.killed) child.kill('SIGKILL');
    }
    await authFixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
    redisCli(['DEL', testRedisKey]);
    if (previousConfiguredKey) {
      redisCli(['HSET', 'agent-co:config', 'chat_sessions_key', previousConfiguredKey]);
    } else {
      redisCli(['HDEL', 'agent-co:config', 'chat_sessions_key']);
    }
    if (previousDefaultState) {
      redisCli(['SET', 'agent-co:chat:sessions:v1', previousDefaultState]);
    } else {
      redisCli(['DEL', 'agent-co:chat:sessions:v1']);
    }
  }
});

test('生成总结不会隐式恢复普通链式传播', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-peer-summary-no-chain-'));
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
    assert.equal(Array.isArray(historyResponse.body.session.invocationTasks), true);
    assert.equal(historyResponse.body.session.invocationTasks.length, 0);
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('summary 模式仍会绕过 caller review，即使输出里携带 invokeAgents', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-summary-bypass-review-'));
  const stateFile = join(tempDir, 'summary-bypass-state.json');
  createManualSummaryClaudeScript(tempDir, {
    summaryText: 'Alice 总结：这里会提到 @@Bob，但 summary 不应进入 caller review。',
    summaryInvokeAgents: ['Bob'],
    stateFile
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
      body: { name: 'summary bypass caller review' }
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
      body: { message: '@Alice 请先给出一轮意见' }
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
    assert.equal(Array.isArray(historyResponse.body.session.invocationTasks), true);
    assert.equal(historyResponse.body.session.invocationTasks.length, 0);
    assert.equal(historyResponse.body.session.pendingAgentTasks, undefined);
    assert.equal(historyResponse.body.session.discussionState, 'paused');

    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.equal(state.agents.Alice.totalCalls >= 2, true);
    assert.equal(state.agents.Alice.summaryCalls, 1);
    assert.equal(state.agents.Bob, undefined);
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('agentChainMaxCallsPerAgent 为 null 时，同智能体循环提及不会被截断', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-chain-unlimited-'));
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
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-chain-hops-'));
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
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-fake-chain-limited-'));
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
