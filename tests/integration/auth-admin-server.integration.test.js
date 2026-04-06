const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createAuthAdminFixture } = require('./helpers/auth-admin-fixture');
const { createChatServerFixture } = require('./helpers/chat-server-fixture');
const {
  loadApiConnectionStore,
  isApiConnectionReferenced,
  maskApiKey,
  normalizeApiConnectionConfig,
  saveApiConnectionStore,
  toApiConnectionSummaries,
  validateApiConnectionNameUnique,
  validateApiConnectionConfig
} = require('../../dist/api-connection-store.js');
const {
  normalizeAgentConfig,
  validateAgentConfig
} = require('../../dist/agent-config-store.js');

let fixture;

beforeEach(async () => {
  fixture = await createAuthAdminFixture();
});

afterEach(async () => {
  if (fixture) {
    await fixture.cleanup();
    fixture = null;
  }
});

async function createModelTestStub(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
    }
  };
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

test('默认账号可登录，错误密码会被拒绝', async () => {
  const ok = await fixture.request('/api/auth/verify', {
    method: 'POST',
    body: { username: 'admin', password: 'Admin1234!@#' }
  });

  assert.equal(ok.status, 200);
  assert.equal(ok.body.success, true);
  assert.equal(ok.body.username, 'admin');

  const denied = await fixture.request('/api/auth/verify', {
    method: 'POST',
    body: { username: 'admin', password: 'wrong-password' }
  });

  assert.equal(denied.status, 401);
  assert.equal(denied.body.success, false);
  assert.equal(denied.body.error, '用户名或密码错误');
});

test('鉴权管理服务对非法 JSON 登录校验请求返回 400 和错误信息', async () => {
  const response = await requestRawJson(`http://127.0.0.1:${fixture.port}/api/auth/verify`, '{');
  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error, 'Invalid JSON');
});

test('管理端点要求 x-admin-token', async () => {
  const withoutToken = await fixture.request('/api/users');
  assert.equal(withoutToken.status, 401);
  assert.match(withoutToken.body.error, /未授权/);

  const withToken = await fixture.request('/api/users', {
    headers: { 'x-admin-token': fixture.adminToken }
  });
  assert.equal(withToken.status, 200);
  assert.ok(Array.isArray(withToken.body.users));
  assert.equal(withToken.body.users.length, 1);
});

test('聊天端 CORS 仍保留 credentials，而管理端不应新增 credentials', async () => {
  const chatFixture = await createChatServerFixture();

  try {
    const chatResponse = await requestRaw(`http://127.0.0.1:${chatFixture.port}/api/auth-status`, {
      method: 'OPTIONS'
    });
    assert.equal(chatResponse.status, 200);
    assert.equal(chatResponse.headers.get('access-control-allow-credentials'), 'true');

    const adminResponse = await requestRaw(`http://127.0.0.1:${fixture.port}/api/users`, {
      method: 'OPTIONS',
      headers: { 'x-admin-token': fixture.adminToken }
    });
    assert.equal(adminResponse.status, 200);
    assert.equal(adminResponse.headers.get('access-control-allow-credentials'), null);
  } finally {
    await chatFixture.cleanup();
  }
});



test('带引号的 AUTH_ADMIN_TOKEN 仍可用原始 token 访问管理端点', async () => {
  await fixture.cleanup();
  fixture = await createAuthAdminFixture({
    adminToken: 'plain-admin-token-123',
    authAdminTokenEnv: '"plain-admin-token-123"'
  });

  const withPlainToken = await fixture.request('/api/users', {
    headers: { 'x-admin-token': fixture.adminToken }
  });
  assert.equal(withPlainToken.status, 200);

  const withQuotedToken = await fixture.request('/api/users', {
    headers: { 'x-admin-token': '"plain-admin-token-123"' }
  });
  assert.equal(withQuotedToken.status, 200);
});

test('用户管理集成流程：创建、改密、登录校验、删除', async () => {
  const headers = { 'x-admin-token': fixture.adminToken };

  const create = await fixture.request('/api/users', {
    method: 'POST',
    headers,
    body: { username: 'tester', password: 'Password123!' }
  });
  assert.equal(create.status, 201);

  const list = await fixture.request('/api/users', { headers });
  assert.equal(list.status, 200);
  assert.equal(list.body.users.some(user => user.username === 'tester'), true);

  const updatePassword = await fixture.request('/api/users/tester/password', {
    method: 'PUT',
    headers,
    body: { password: 'NewPassword123!' }
  });
  assert.equal(updatePassword.status, 200);

  const oldPasswordRejected = await fixture.request('/api/auth/verify', {
    method: 'POST',
    body: { username: 'tester', password: 'Password123!' }
  });
  assert.equal(oldPasswordRejected.status, 401);

  const newPasswordAccepted = await fixture.request('/api/auth/verify', {
    method: 'POST',
    body: { username: 'tester', password: 'NewPassword123!' }
  });
  assert.equal(newPasswordAccepted.status, 200);

  const removed = await fixture.request('/api/users/tester', {
    method: 'DELETE',
    headers
  });
  assert.equal(removed.status, 200);

  const deletedUserDenied = await fixture.request('/api/auth/verify', {
    method: 'POST',
    body: { username: 'tester', password: 'NewPassword123!' }
  });
  assert.equal(deletedUserDenied.status, 401);
});

test('智能体配置支持延迟生效并可显式应用', async () => {
  const headers = { 'x-admin-token': fixture.adminToken };

  const before = await fixture.request('/api/agents', { headers });
  assert.equal(before.status, 200);
  const activeCount = before.body.agents.length;

  const addPending = await fixture.request('/api/agents', {
    method: 'POST',
    headers,
    body: {
      applyMode: 'after_chat',
      agent: {
        name: 'Planner',
        avatar: '🗂️',
        color: '#7c3aed',
        personality: '擅长整理需求和给出计划。'
      }
    }
  });

  assert.equal(addPending.status, 201);
  assert.equal(addPending.body.applyMode, 'after_chat');

  const mid = await fixture.request('/api/agents', { headers });
  assert.equal(mid.status, 200);
  assert.equal(mid.body.agents.length, activeCount);
  assert.equal(Array.isArray(mid.body.pendingAgents), true);
  assert.equal(mid.body.pendingAgents.some(agent => agent.name === 'Planner'), true);

  const applied = await fixture.request('/api/agents/apply-pending', {
    method: 'POST',
    headers
  });

  assert.equal(applied.status, 200);
  assert.equal(applied.body.agents.some(agent => agent.name === 'Planner'), true);

  const after = await fixture.request('/api/agents', { headers });
  assert.equal(after.status, 200);
  assert.equal(after.body.pendingAgents, null);
  assert.equal(after.body.agents.some(agent => agent.name === 'Planner'), true);
});

test('手动新增智能体时可持久化 cli 类型为 codex', async () => {
  const headers = { 'x-admin-token': fixture.adminToken };

  const create = await fixture.request('/api/agents', {
    method: 'POST',
    headers,
    body: {
      applyMode: 'immediate',
      agent: {
        name: 'Reviewer',
        avatar: '🧠',
        color: '#2563eb',
        personality: '擅长代码评审和架构建议。',
        cli: 'codex'
      }
    }
  });

  assert.equal(create.status, 201);
  assert.equal(create.body.agent.cli, 'codex');

  const list = await fixture.request('/api/agents', { headers });
  assert.equal(list.status, 200);

  const created = list.body.agents.find(agent => agent.name === 'Reviewer');
  assert.ok(created, 'should find created agent');
  assert.equal(created.cli, 'codex');
});

test('智能体支持配置 workdir，且必须为绝对路径', async () => {
  const headers = { 'x-admin-token': fixture.adminToken };

  const invalid = await fixture.request('/api/agents', {
    method: 'POST',
    headers,
    body: {
      applyMode: 'immediate',
      agent: {
        name: 'WorkdirInvalid',
        avatar: '📁',
        color: '#2563eb',
        personality: '测试 workdir 校验',
        workdir: './relative'
      }
    }
  });

  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /workdir 必须是绝对路径/);

  const valid = await fixture.request('/api/agents', {
    method: 'POST',
    headers,
    body: {
      applyMode: 'immediate',
      agent: {
        name: 'WorkdirValid',
        avatar: '📂',
        color: '#16a34a',
        personality: '测试工作目录',
        cli: 'codex',
        workdir: '/tmp'
      }
    }
  });

  assert.equal(valid.status, 201);
  assert.equal(valid.body.agent.workdir, '/tmp');

  const list = await fixture.request('/api/agents', { headers });
  const created = list.body.agents.find(agent => agent.name === 'WorkdirValid');
  assert.ok(created);
  assert.equal(created.workdir, '/tmp');
});


test('智能体列表会补齐内置智能体，并保留手动添加的智能体', async () => {
  await fixture.cleanup();
  fixture = await createAuthAdminFixture({
    initialAgentStore: {
      activeAgents: [
        {
          name: 'ManualOnly',
          avatar: '🛠️',
          color: '#0ea5e9',
          personality: '手动添加的智能体'
        }
      ],
      pendingAgents: null,
      pendingReason: null,
      updatedAt: Date.now(),
      pendingUpdatedAt: null
    }
  });

  const headers = { 'x-admin-token': fixture.adminToken };
  const list = await fixture.request('/api/agents', { headers });

  assert.equal(list.status, 200);
  const names = list.body.agents.map(agent => agent.name);
  assert.equal(names.includes('Codex架构师'), true);
  assert.equal(names.includes('Claude'), true);
  assert.equal(names.includes('ManualOnly'), true);
});

test('管理端可按层级读取当前环境目录用于工作目录下拉', async () => {
  const headers = { 'x-admin-token': fixture.adminToken };

  const roots = await fixture.request('/api/system/dirs?path=/', { headers });
  assert.equal(roots.status, 200);
  assert.equal(Array.isArray(roots.body.directories), true);
  assert.equal(roots.body.directories.length > 0, true);
  assert.equal(roots.body.directories.every(item => item.path.startsWith('/')), true);

  const workspaceChildren = await fixture.request('/api/system/dirs?path=/tmp', { headers });
  assert.equal(workspaceChildren.status, 200);
  assert.equal(Array.isArray(workspaceChildren.body.directories), true);

  const invalid = await fixture.request('/api/system/dirs?path=./relative', { headers });
  assert.equal(invalid.status, 400);
});

test('管理端可将专业智能体提示词恢复为共享模板默认值', async () => {
  const headers = { 'x-admin-token': fixture.adminToken };
  const agentName = 'Codex架构师';

  const customPrompt = '这是后台手动修改过的临时提示词';
  const update = await fixture.request(`/api/agents/${encodeURIComponent(agentName)}/prompt`, {
    method: 'PUT',
    headers,
    body: {
      systemPrompt: customPrompt,
      applyMode: 'immediate'
    }
  });
  assert.equal(update.status, 200);

  const restore = await fixture.request(`/api/agents/${encodeURIComponent(agentName)}/prompt/restore-template`, {
    method: 'POST',
    headers,
    body: {
      applyMode: 'immediate'
    }
  });
  assert.equal(restore.status, 200);

  const list = await fixture.request('/api/agents', { headers });
  assert.equal(list.status, 200);
  const agent = list.body.agents.find(item => item.name === agentName);
  assert.ok(agent);
  assert.notEqual(agent.systemPrompt, customPrompt);
  assert.match(agent.systemPrompt, /公开聊天室/);
  assert.match(agent.systemPrompt, /职责：/);
  assert.match(agent.systemPrompt, /边界：/);
  assert.match(agent.systemPrompt, /输出：/);
});

test('管理端可预览专业智能体的模板默认提示词而不覆盖当前配置', async () => {
  const headers = { 'x-admin-token': fixture.adminToken };
  const agentName = 'Codex架构师';

  const before = await fixture.request('/api/agents', { headers });
  assert.equal(before.status, 200);
  const current = before.body.agents.find(item => item.name === agentName);
  assert.ok(current);

  const preview = await fixture.request(`/api/agents/${encodeURIComponent(agentName)}/prompt/template`, {
    headers
  });
  assert.equal(preview.status, 200);
  assert.equal(typeof preview.body.currentPrompt, 'string');
  assert.equal(typeof preview.body.templatePrompt, 'string');
  assert.equal(preview.body.currentPrompt, current.systemPrompt);
  assert.match(preview.body.templatePrompt, /公开聊天室/);
  assert.match(preview.body.templatePrompt, /职责：/);

  const after = await fixture.request('/api/agents', { headers });
  const unchanged = after.body.agents.find(item => item.name === agentName);
  assert.ok(unchanged);
  assert.equal(unchanged.systemPrompt, current.systemPrompt, 'preview should not overwrite the stored prompt');
});

test('GET /api/model-connections 返回空列表，并在创建后返回已有列表', async () => {
  const headers = { 'x-admin-token': fixture.adminToken };

  const empty = await fixture.request('/api/model-connections', { headers });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.connections, []);

  const created = await fixture.request('/api/model-connections', {
    method: 'POST',
    headers,
    body: {
      name: 'OpenAI Gateway',
      baseURL: 'https://api.example.com/v1/',
      apiKey: 'sk-test-1234567890abcdef',
      enabled: true
    }
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.connection.name, 'OpenAI Gateway');
  assert.equal(created.body.connection.baseURL, 'https://api.example.com/v1');
  assert.equal(created.body.connection.apiKey, undefined);
  assert.match(created.body.connection.apiKeyMasked, /\*/);

  const listed = await fixture.request('/api/model-connections', { headers });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.connections.length, 1);
  assert.equal(listed.body.connections[0].name, 'OpenAI Gateway');
  assert.equal(listed.body.connections[0].apiKey, undefined);
  assert.match(listed.body.connections[0].apiKeyMasked, /\*/);
});

test('POST/PUT /api/model-connections 可创建和更新且不回显明文 key', async () => {
  const headers = { 'x-admin-token': fixture.adminToken };

  const create = await fixture.request('/api/model-connections', {
    method: 'POST',
    headers,
    body: {
      name: 'Primary Gateway',
      baseURL: 'https://api.example.com/v1',
      apiKey: 'sk-create-1234567890abcdef',
      enabled: true
    }
  });

  assert.equal(create.status, 201);
  const connectionId = create.body.connection.id;
  assert.ok(connectionId);
  assert.equal(create.body.connection.apiKey, undefined);
  assert.notEqual(create.body.connection.apiKeyMasked, 'sk-create-1234567890abcdef');

  const update = await fixture.request(`/api/model-connections/${connectionId}`, {
    method: 'PUT',
    headers,
    body: {
      name: 'Updated Gateway',
      baseURL: 'https://api.example.com/v2/',
      apiKey: 'sk-update-abcdef1234567890',
      enabled: false
    }
  });

  assert.equal(update.status, 200);
  assert.equal(update.body.connection.id, connectionId);
  assert.equal(update.body.connection.name, 'Updated Gateway');
  assert.equal(update.body.connection.baseURL, 'https://api.example.com/v2');
  assert.equal(update.body.connection.enabled, false);
  assert.equal(update.body.connection.apiKey, undefined);
  assert.notEqual(update.body.connection.apiKeyMasked, 'sk-update-abcdef1234567890');

  const listed = await fixture.request('/api/model-connections', { headers });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.connections[0].name, 'Updated Gateway');
  assert.equal(listed.body.connections[0].baseURL, 'https://api.example.com/v2');
  assert.equal(listed.body.connections[0].enabled, false);
  assert.equal(listed.body.connections[0].apiKey, undefined);
});

test('POST /api/model-connections 会忽略客户端提供的 id，避免产生歧义或重复 ID', async () => {
  const headers = { 'x-admin-token': fixture.adminToken };

  const first = await fixture.request('/api/model-connections', {
    method: 'POST',
    headers,
    body: {
      id: 'client-supplied-id',
      name: 'Client ID Gateway A',
      baseURL: 'https://api.example.com/v1',
      apiKey: 'sk-client-a-1234567890abcdef',
      enabled: true
    }
  });
  assert.equal(first.status, 201);
  assert.notEqual(first.body.connection.id, 'client-supplied-id');

  const second = await fixture.request('/api/model-connections', {
    method: 'POST',
    headers,
    body: {
      id: 'client-supplied-id',
      name: 'Client ID Gateway B',
      baseURL: 'https://api.example.com/v2',
      apiKey: 'sk-client-b-1234567890abcdef',
      enabled: true
    }
  });
  assert.equal(second.status, 201);
  assert.notEqual(second.body.connection.id, 'client-supplied-id');
  assert.notEqual(second.body.connection.id, first.body.connection.id);

  const update = await fixture.request(`/api/model-connections/${first.body.connection.id}`, {
    method: 'PUT',
    headers,
    body: {
      id: second.body.connection.id,
      name: 'Client ID Gateway A Updated',
      baseURL: 'https://api.example.com/v3',
      apiKey: 'sk-client-a-updated-1234567890',
      enabled: false
    }
  });
  assert.equal(update.status, 200);
  assert.equal(update.body.connection.id, first.body.connection.id);
});

test('DELETE /api/model-connections/:id 在未被引用时成功删除', async () => {
  const headers = { 'x-admin-token': fixture.adminToken };

  const create = await fixture.request('/api/model-connections', {
    method: 'POST',
    headers,
    body: {
      name: 'Disposable Gateway',
      baseURL: 'https://api.example.com/v1',
      apiKey: 'sk-delete-1234567890abcdef',
      enabled: true
    }
  });

  const connectionId = create.body.connection.id;
  const removed = await fixture.request(`/api/model-connections/${connectionId}`, {
    method: 'DELETE',
    headers
  });

  assert.equal(removed.status, 200);
  assert.equal(removed.body.id, connectionId);

  const listed = await fixture.request('/api/model-connections', { headers });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.connections, []);
});

test('DELETE /api/model-connections/:id 在被 agent 引用时返回冲突', async () => {
  const headers = { 'x-admin-token': fixture.adminToken };

  const createConnection = await fixture.request('/api/model-connections', {
    method: 'POST',
    headers,
    body: {
      name: 'Referenced Gateway',
      baseURL: 'https://api.example.com/v1',
      apiKey: 'sk-ref-1234567890abcdef',
      enabled: true
    }
  });
  const connectionId = createConnection.body.connection.id;

  const createAgent = await fixture.request('/api/agents', {
    method: 'POST',
    headers,
    body: {
      applyMode: 'immediate',
      agent: {
        name: 'ApiRunner',
        avatar: '🤖',
        color: '#2563eb',
        personality: '通过 API 调用模型',
        executionMode: 'api',
        apiConnectionId: connectionId,
        apiModel: 'gpt-4o-mini',
        apiTemperature: 0.4,
        apiMaxTokens: 512
      }
    }
  });
  assert.equal(createAgent.status, 201);

  const removed = await fixture.request(`/api/model-connections/${connectionId}`, {
    method: 'DELETE',
    headers
  });

  assert.ok([400, 409].includes(removed.status));
  assert.match(removed.body.error, /引用|使用|删除/);
});

test('POST /api/model-connections/:id/test 可返回测试成功和失败', async () => {
  const headers = { 'x-admin-token': fixture.adminToken };
  const okStub = await createModelTestStub((req, res) => {
    assert.equal(req.url, '/models');
    assert.equal(req.headers.authorization, 'Bearer sk-test-ok-1234567890');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [] }));
  });

  const failStub = await createModelTestStub((req, res) => {
    assert.equal(req.url, '/models');
    assert.equal(req.headers.authorization, 'Bearer sk-test-fail-1234567890');
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'bad api key' } }));
  });

  try {
    const okConnection = await fixture.request('/api/model-connections', {
      method: 'POST',
      headers,
      body: {
        name: 'OK Gateway',
        baseURL: okStub.baseURL,
        apiKey: 'sk-test-ok-1234567890',
        enabled: true
      }
    });
    const failConnection = await fixture.request('/api/model-connections', {
      method: 'POST',
      headers,
      body: {
        name: 'Fail Gateway',
        baseURL: failStub.baseURL,
        apiKey: 'sk-test-fail-1234567890',
        enabled: true
      }
    });

    const okTest = await fixture.request(`/api/model-connections/${okConnection.body.connection.id}/test`, {
      method: 'POST',
      headers
    });
    assert.equal(okTest.status, 200);
    assert.equal(okTest.body.success, true);

    const failTest = await fixture.request(`/api/model-connections/${failConnection.body.connection.id}/test`, {
      method: 'POST',
      headers
    });
    assert.ok([400, 502].includes(failTest.status));
    assert.equal(failTest.body.success, false);
    assert.equal(failTest.body.statusCode, 401);
    assert.match(failTest.body.error, /bad api key|401/i);
  } finally {
    await okStub.close();
    await failStub.close();
  }
});

test('POST /api/model-connections 会拒绝非本地明文 http baseURL，但允许 localhost 测试桩', async () => {
  const headers = { 'x-admin-token': fixture.adminToken };

  const externalHttp = await fixture.request('/api/model-connections', {
    method: 'POST',
    headers,
    body: {
      name: 'Insecure Gateway',
      baseURL: 'http://example.com/v1',
      apiKey: 'sk-insecure-1234567890abcdef',
      enabled: true
    }
  });
  assert.equal(externalHttp.status, 400);
  assert.match(externalHttp.body.error, /https|localhost|127\.0\.0\.1|::1|本地/i);

  const localStub = await createModelTestStub((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [] }));
  });

  try {
    const localHttp = await fixture.request('/api/model-connections', {
      method: 'POST',
      headers,
      body: {
        name: 'Local Gateway',
        baseURL: localStub.baseURL,
        apiKey: 'sk-local-1234567890abcdef',
        enabled: true
      }
    });
    assert.equal(localHttp.status, 201);
  } finally {
    await localStub.close();
  }
});

test('POST /api/model-connections/:id/test 会对上游错误做脱敏摘要，不透传敏感响应体', async () => {
  const headers = { 'x-admin-token': fixture.adminToken };
  const leakStub = await createModelTestStub((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        message: 'bad api key: sk-live-secret-should-not-leak'
      },
      details: 'tenant=prod-secret'
    }));
  });

  try {
    const create = await fixture.request('/api/model-connections', {
      method: 'POST',
      headers,
      body: {
        name: 'Leak Test Gateway',
        baseURL: leakStub.baseURL,
        apiKey: 'sk-leak-1234567890abcdef',
        enabled: true
      }
    });
    assert.equal(create.status, 201);

    const tested = await fixture.request(`/api/model-connections/${create.body.connection.id}/test`, {
      method: 'POST',
      headers
    });

    assert.ok([400, 502].includes(tested.status));
    assert.equal(tested.body.success, false);
    assert.equal(tested.body.statusCode, 401);
    assert.match(tested.body.error, /401|Unauthorized|请求失败/i);
    assert.doesNotMatch(tested.body.error, /sk-live-secret-should-not-leak/);
    assert.doesNotMatch(tested.body.error, /tenant=prod-secret/);
    assert.doesNotMatch(JSON.stringify(tested.body), /sk-live-secret-should-not-leak/);
  } finally {
    await leakStub.close();
  }
});

test('agent 的 POST/PUT 接口接受 API 模式字段', async () => {
  const headers = { 'x-admin-token': fixture.adminToken };

  const connection = await fixture.request('/api/model-connections', {
    method: 'POST',
    headers,
    body: {
      name: 'Agent API Gateway',
      baseURL: 'https://api.example.com/v1',
      apiKey: 'sk-agent-1234567890abcdef',
      enabled: true
    }
  });
  const connectionId = connection.body.connection.id;

  const create = await fixture.request('/api/agents', {
    method: 'POST',
    headers,
    body: {
      applyMode: 'immediate',
      agent: {
        name: 'ApiModeAgent',
        avatar: '🛰️',
        color: '#7c3aed',
        personality: '使用 API 模式运行',
        executionMode: 'api',
        apiConnectionId: connectionId,
        apiModel: 'gpt-4o-mini',
        apiTemperature: 0.8,
        apiMaxTokens: 1024
      }
    }
  });

  assert.equal(create.status, 201);
  assert.equal(create.body.agent.executionMode, 'api');
  assert.equal(create.body.agent.apiConnectionId, connectionId);
  assert.equal(create.body.agent.apiModel, 'gpt-4o-mini');
  assert.equal(create.body.agent.apiTemperature, 0.8);
  assert.equal(create.body.agent.apiMaxTokens, 1024);
  assert.equal(create.body.agent.cli, undefined);
  assert.equal(create.body.agent.cliName, undefined);

  const update = await fixture.request('/api/agents/ApiModeAgent', {
    method: 'PUT',
    headers,
    body: {
      applyMode: 'immediate',
      agent: {
        name: 'ApiModeAgent',
        avatar: '🛰️',
        color: '#7c3aed',
        personality: '更新 API 模式参数',
        executionMode: 'api',
        apiConnectionId: connectionId,
        apiModel: 'gpt-4.1-mini',
        apiTemperature: 1.1,
        apiMaxTokens: 2048
      }
    }
  });

  assert.equal(update.status, 200);
  assert.equal(update.body.agent.executionMode, 'api');
  assert.equal(update.body.agent.apiModel, 'gpt-4.1-mini');
  assert.equal(update.body.agent.apiTemperature, 1.1);
  assert.equal(update.body.agent.apiMaxTokens, 2048);

  const list = await fixture.request('/api/agents', { headers });
  const updated = list.body.agents.find(agent => agent.name === 'ApiModeAgent');
  assert.ok(updated);
  assert.equal(updated.executionMode, 'api');
  assert.equal(updated.apiConnectionId, connectionId);
  assert.equal(updated.apiModel, 'gpt-4.1-mini');
  assert.equal(updated.apiTemperature, 1.1);
  assert.equal(updated.apiMaxTokens, 2048);
});

test('API connection 存储辅助函数会规范化输入并脱敏 apiKey', () => {
  const normalized = normalizeApiConnectionConfig({
    name: '  OpenAI Gateway  ',
    baseURL: ' https://api.example.com/v1/ ',
    apiKey: 'sk-test-1234567890abcdef',
    enabled: true
  });

  assert.equal(normalized.name, 'OpenAI Gateway');
  assert.equal(normalized.baseURL, 'https://api.example.com/v1');
  assert.equal(normalized.apiKey, 'sk-test-1234567890abcdef');
  assert.equal(normalized.enabled, true);
  assert.equal(validateApiConnectionConfig(normalized), null);

  const masked = maskApiKey(normalized.apiKey);
  assert.notEqual(masked, normalized.apiKey);
  assert.match(masked, /\*/);
});

test('API connection 验证会拒绝非法 baseURL', () => {
  const error = validateApiConnectionConfig({
    id: 'conn-1',
    name: 'Gateway',
    baseURL: 'not-a-url',
    apiKey: 'secret',
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  assert.equal(typeof error, 'string');
  assert.match(error, /URL|合法/);
});

test('API connection store 可以保存并重新读取', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-api-conn-'));
  const filePath = join(tempDir, 'api-connections.json');

  try {
    const initial = loadApiConnectionStore(filePath);
    assert.equal(initial.apiConnections.length, 0);

    const store = {
      apiConnections: [
        normalizeApiConnectionConfig({
          id: 'conn-1',
          name: 'Gateway',
          baseURL: 'https://api.example.com/v1/',
          apiKey: 'sk-test-1234567890abcdef',
          enabled: true,
          createdAt: 1,
          updatedAt: 2
        })
      ],
      updatedAt: 123
    };

    saveApiConnectionStore(filePath, store);

    const loaded = loadApiConnectionStore(filePath);
    assert.equal(loaded.updatedAt, 123);
    assert.equal(loaded.apiConnections.length, 1);
    assert.equal(loaded.apiConnections[0].name, 'Gateway');
    assert.equal(loaded.apiConnections[0].baseURL, 'https://api.example.com/v1');
    assert.equal(loaded.apiConnections[0].apiKey, 'sk-test-1234567890abcdef');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('API connection store 在读取非法 updatedAt 时会回退为当前时间', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-api-conn-'));
  const filePath = join(tempDir, 'api-connections.json');

  try {
    writeFileSync(filePath, JSON.stringify({
      apiConnections: [],
      updatedAt: -1
    }), 'utf-8');

    const loaded = loadApiConnectionStore(filePath);
    assert.ok(loaded.updatedAt > 0);
    assert.notEqual(loaded.updatedAt, -1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('API connection summary 转换会脱敏 apiKey', () => {
  const store = {
    apiConnections: [
      normalizeApiConnectionConfig({
        id: 'conn-1',
        name: 'Gateway',
        baseURL: 'https://api.example.com/v1/',
        apiKey: 'sk-test-1234567890abcdef',
        enabled: true,
        createdAt: 1,
        updatedAt: 2
      })
    ],
    updatedAt: 123
  };

  const summaries = toApiConnectionSummaries(store.apiConnections);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].name, 'Gateway');
  assert.equal(summaries[0].baseURL, 'https://api.example.com/v1');
  assert.equal(summaries[0].apiKeyMasked, maskApiKey('sk-test-1234567890abcdef'));
  assert.notEqual(summaries[0].apiKeyMasked, 'sk-test-1234567890abcdef');
});

test('API connection 名称重复时会被识别为不可创建', () => {
  const store = {
    apiConnections: [
      normalizeApiConnectionConfig({
        id: 'conn-1',
        name: 'Gateway',
        baseURL: 'https://api.example.com/v1/',
        apiKey: 'sk-test-1234567890abcdef',
        enabled: true,
        createdAt: 1,
        updatedAt: 2
      })
    ],
    updatedAt: 123
  };

  assert.equal(validateApiConnectionNameUnique(store, 'Gateway'), '连接名称已存在');
  assert.equal(validateApiConnectionNameUnique(store, 'Gateway', 'conn-1'), null);
});

test('API connection 被 agent 引用时会被识别为不可删除', () => {
  const agents = [
    normalizeAgentConfig({
      name: 'ApiAgent',
      avatar: '🤖',
      color: '#123456',
      personality: 'API 运行模式',
      executionMode: 'api',
      apiConnectionId: 'conn-1',
      apiModel: 'gpt-4o-mini'
    }),
    normalizeAgentConfig({
      name: 'CliAgent',
      avatar: '🤖',
      color: '#123456',
      personality: 'CLI 运行模式',
      cli: 'codex'
    })
  ];

  assert.equal(isApiConnectionReferenced('conn-1', agents), true);
  assert.equal(isApiConnectionReferenced('conn-2', agents), false);
});

test('agent 配置会把旧 cli 字段映射为 cli 运行模式', () => {
  const normalized = normalizeAgentConfig({
    name: 'LegacyAgent',
    avatar: '🤖',
    color: '#123456',
    personality: '兼容旧配置',
    cli: 'codex'
  });

  assert.equal(normalized.executionMode, 'cli');
  assert.equal(normalized.cliName, 'codex');
  assert.equal(normalized.cli, 'codex');
  assert.equal(normalized.apiConnectionId, undefined);
  assert.equal(normalized.apiModel, undefined);
  assert.equal(normalized.apiTemperature, undefined);
  assert.equal(normalized.apiMaxTokens, undefined);
  assert.equal(validateAgentConfig(normalized), null);
});

test('agent 配置在 API 模式下会清空 CLI 元数据并保留 API 字段', () => {
  const normalized = normalizeAgentConfig({
    name: 'ApiAgent',
    avatar: '🤖',
    color: '#123456',
    personality: 'API 运行模式',
    executionMode: 'api',
    cli: 'codex',
    cliName: 'claude',
    apiConnectionId: 'conn-1',
    apiModel: 'gpt-4o-mini',
    apiTemperature: 1.2,
    apiMaxTokens: 2048
  });

  assert.equal(normalized.executionMode, 'api');
  assert.equal(normalized.cli, undefined);
  assert.equal(normalized.cliName, undefined);
  assert.equal(normalized.apiConnectionId, 'conn-1');
  assert.equal(normalized.apiModel, 'gpt-4o-mini');
  assert.equal(normalized.apiTemperature, 1.2);
  assert.equal(normalized.apiMaxTokens, 2048);
  assert.equal(validateAgentConfig(normalized), null);
});

test('agent 配置在 CLI 模式下会清空 API 字段', () => {
  const normalized = normalizeAgentConfig({
    name: 'CliAgent',
    avatar: '🤖',
    color: '#123456',
    personality: 'CLI 运行模式',
    executionMode: 'cli',
    cliName: 'codex',
    apiConnectionId: 'conn-1',
    apiModel: 'gpt-4o-mini',
    apiTemperature: 1.2,
    apiMaxTokens: 2048
  });

  assert.equal(normalized.executionMode, 'cli');
  assert.equal(normalized.cliName, 'codex');
  assert.equal(normalized.cli, 'codex');
  assert.equal(normalized.apiConnectionId, undefined);
  assert.equal(normalized.apiModel, undefined);
  assert.equal(normalized.apiTemperature, undefined);
  assert.equal(normalized.apiMaxTokens, undefined);
  assert.equal(validateAgentConfig(normalized), null);
});

test('agent 配置在 API 模式下缺少 connection 或 model 时会失败', () => {
  const error = validateAgentConfig(normalizeAgentConfig({
    name: 'ApiAgent',
    avatar: '🤖',
    color: '#123456',
    personality: 'API 运行模式',
    executionMode: 'api'
  }));

  assert.equal(typeof error, 'string');
  assert.match(error, /apiConnectionId|apiModel|API/);
});

test('agent 配置会拒绝超出范围的 apiTemperature', () => {
  const error = validateAgentConfig(normalizeAgentConfig({
    name: 'ApiTemperature',
    avatar: '🤖',
    color: '#123456',
    personality: 'API 运行模式',
    executionMode: 'api',
    apiConnectionId: 'conn-1',
    apiModel: 'gpt-4o-mini',
    apiTemperature: 3
  }));

  assert.equal(error, 'apiTemperature 必须在 0~2 之间');
});

test('agent 配置会拒绝非正整数 apiMaxTokens', () => {
  const error = validateAgentConfig(normalizeAgentConfig({
    name: 'ApiMaxTokens',
    avatar: '🤖',
    color: '#123456',
    personality: 'API 运行模式',
    executionMode: 'api',
    apiConnectionId: 'conn-1',
    apiModel: 'gpt-4o-mini',
    apiMaxTokens: 0
  }));

  assert.equal(error, 'apiMaxTokens 必须是正整数');
});


test('user admin service 通过 store 保持用户名规范化与凭据校验一致', () => {
  const { createUserStore } = require('../../dist/admin/infrastructure/user-store.js');
  const { createUserAdminService } = require('../../dist/admin/application/user-admin-service.js');

  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-user-store-'));
  const usersFile = join(tempDir, 'users.json');

  try {
    const userStore = createUserStore({
      dataFile: usersFile,
      defaultUsername: 'Admin',
      defaultPassword: 'Admin1234!@#'
    });
    const service = createUserAdminService({ userStore });

    const created = service.createUser(' Mixed.User ', 'Password123!');
    assert.equal(created.username, 'mixed.user');

    const listed = service.listUsers();
    assert.equal(listed.some(user => user.username === 'mixed.user'), true);

    const verified = service.verifyCredentials(' MIXED.USER ', 'Password123!');
    assert.ok(verified);
    assert.equal(verified.username, 'mixed.user');

    const denied = service.verifyCredentials('mixed.user', 'wrong-password');
    assert.equal(denied, null);

    const persisted = JSON.parse(readFileSync(usersFile, 'utf-8'));
    assert.equal(persisted.users.some(user => user.username === 'mixed.user'), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('agent admin service 支持延迟生效、显式应用并在删除时清理分组引用', () => {
  const { createAgentAdminService, parseApplyMode } = require('../../dist/admin/application/agent-admin-service.js');
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-agent-service-'));
  const agentsFile = join(tempDir, 'agents.json');
  const groupsFile = join(tempDir, 'groups.json');
  const connectionsFile = join(tempDir, 'api-connections.json');

  writeFileSync(groupsFile, JSON.stringify({
    groups: [
      { id: 'core', name: '核心组', icon: '🧩', agentNames: ['Codex架构师'] }
    ],
    updatedAt: Date.now()
  }, null, 2), 'utf-8');

  try {
    const service = createAgentAdminService({
      agentDataFile: agentsFile,
      groupDataFile: groupsFile,
      modelConnectionDataFile: connectionsFile
    });

    assert.equal(parseApplyMode('after_chat'), 'after_chat');
    assert.equal(parseApplyMode('unexpected'), 'immediate');

    const pending = service.createAgent({
      applyMode: 'after_chat',
      agent: {
        name: 'Planner',
        avatar: '🗂️',
        color: '#7c3aed',
        personality: '擅长整理需求和给出计划。'
      }
    });
    assert.equal(pending.applyMode, 'after_chat');

    const beforeApply = service.listAgents();
    assert.equal(beforeApply.agents.some(agent => agent.name === 'Planner'), false);
    assert.equal(beforeApply.pendingAgents.some(agent => agent.name === 'Planner'), true);

    const applied = service.applyPendingAgents();
    assert.equal(applied.agents.some(agent => agent.name === 'Planner'), true);

    const deleted = service.deleteAgent('Codex架构师', 'immediate');
    assert.equal(deleted.name, 'Codex架构师');

    const groups = JSON.parse(readFileSync(groupsFile, 'utf-8'));
    assert.deepEqual(groups.groups, []);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});


test('auth admin runtime 会在 token 规范化后对空白值回退默认 token', () => {
  const { createAuthAdminRuntime } = require('../../dist/admin/runtime/auth-admin-runtime.js');

  const runtimeFromWhitespace = createAuthAdminRuntime({
    port: 3003,
    adminToken: '   ',
    dataFile: '/tmp/users.json',
    defaultPassword: 'Admin1234!@#',
    agentDataFile: '/tmp/agents.json',
    nodeEnv: 'test',
    publicDir: '/tmp/public-auth'
  });
  assert.equal(runtimeFromWhitespace.adminToken, 'change-me-in-production');

  const runtimeFromQuotedEmpty = createAuthAdminRuntime({
    port: 3003,
    adminToken: ' "" ',
    dataFile: '/tmp/users.json',
    defaultPassword: 'Admin1234!@#',
    agentDataFile: '/tmp/agents.json',
    nodeEnv: 'test',
    publicDir: '/tmp/public-auth'
  });
  assert.equal(runtimeFromQuotedEmpty.adminToken, 'change-me-in-production');
});


test('user store 初始引导会按原样持久化配置的默认用户名', () => {
  const { createUserStore } = require('../../dist/admin/infrastructure/user-store.js');

  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-user-bootstrap-'));
  const usersFile = join(tempDir, 'users.json');

  try {
    const userStore = createUserStore({
      dataFile: usersFile,
      defaultUsername: ' AdminRoot ',
      defaultPassword: 'Admin1234!@#'
    });

    const users = userStore.listUsers();
    assert.equal(users.length, 1);
    assert.equal(users[0].username, ' AdminRoot ');

    const persisted = JSON.parse(readFileSync(usersFile, 'utf-8'));
    assert.equal(persisted.users[0].username, ' AdminRoot ');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
