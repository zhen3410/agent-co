const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createAuthAdminFixture } = require('./helpers/auth-admin-fixture');

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
