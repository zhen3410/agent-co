const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatServerFixture } = require('./helpers/chat-server-fixture');

test('会话接口支持创建、切换、重命名与删除（需先登录）', async () => {
  const fixture = await createChatServerFixture();

  try {
    const unauthorizedHistory = await fixture.request('/api/history');
    assert.equal(unauthorizedHistory.status, 401);

    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

    const initialHistory = await fixture.request('/api/history');
    assert.equal(initialHistory.status, 200);
    assert.equal(Array.isArray(initialHistory.body.chatSessions), true);
    assert.equal(initialHistory.body.chatSessions.length, 1);

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: '这是一个很长很长很长很长很长很长很长很长很长很长的会话名称' }
    });
    assert.equal(createResponse.status, 200);
    assert.equal(createResponse.body.success, true);
    assert.equal(createResponse.body.session.name.length <= 40, true);

    const newSessionId = createResponse.body.session.id;

    const selectResponse = await fixture.request('/api/sessions/select', {
      method: 'POST',
      body: { sessionId: newSessionId }
    });
    assert.equal(selectResponse.status, 200);
    assert.equal(selectResponse.body.success, true);
    assert.equal(selectResponse.body.activeSessionId, newSessionId);

    const renameResponse = await fixture.request('/api/sessions/rename', {
      method: 'POST',
      body: { sessionId: newSessionId, name: '' }
    });
    assert.equal(renameResponse.status, 200);
    assert.equal(renameResponse.body.success, true);
    assert.equal(renameResponse.body.session.name, '默认会话');

    const badSelect = await fixture.request('/api/sessions/select', {
      method: 'POST',
      body: { sessionId: 'missing-session-id' }
    });
    assert.equal(badSelect.status, 400);

    const deleteDefault = await fixture.request('/api/sessions/delete', {
      method: 'POST',
      body: { sessionId: 'default' }
    });
    assert.equal(deleteDefault.status, 200);
    assert.equal(deleteDefault.body.success, true);

    const deleteLastSession = await fixture.request('/api/sessions/delete', {
      method: 'POST',
      body: { sessionId: newSessionId }
    });
    assert.equal(deleteLastSession.status, 400);
  } finally {
    await fixture.cleanup();
  }
});

test('block 接口支持校验入参与状态查询（需先登录）', async () => {
  const fixture = await createChatServerFixture();

  try {
    const unauthorizedCreate = await fixture.request('/api/create-block', {
      method: 'POST',
      body: { sessionId: 's1' }
    });
    assert.equal(unauthorizedCreate.status, 401);

    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

    const missingBlock = await fixture.request('/api/create-block', {
      method: 'POST',
      body: { sessionId: 's1' }
    });
    assert.equal(missingBlock.status, 400);

    const createBlock = await fixture.request('/api/create-block', {
      method: 'POST',
      body: {
        sessionId: 'session-block-it',
        block: {
          kind: 'summary',
          title: '接口测试',
          content: '用于校验 block-buffer 接口行为'
        }
      }
    });

    assert.equal(createBlock.status, 200);
    assert.equal(createBlock.body.success, true);
    assert.equal(createBlock.body.block.id, 'summary:接口测试');

    const status = await fixture.request('/api/block-status');
    assert.equal(status.status, 200);
    assert.ok(status.body.totalSessions >= 1);
    const sessionStatus = status.body.sessions.find((item) => item.sessionId === 'session-block-it');
    assert.ok(sessionStatus);
    assert.equal(sessionStatus.blockCount, 1);
  } finally {
    await fixture.cleanup();
  }
});

test('切换会话后 /api/history 返回对应会话记录（需先登录）', async () => {
  const fixture = await createChatServerFixture();

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

    const seedDefault = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: 'default session message' }
    });
    assert.equal(seedDefault.status, 200);

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'session B' }
    });
    assert.equal(createResponse.status, 200);
    const secondSessionId = createResponse.body.session.id;

    const seedSecond = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: 'second session message' }
    });
    assert.equal(seedSecond.status, 200);

    const selectDefault = await fixture.request('/api/sessions/select', {
      method: 'POST',
      body: { sessionId: 'default' }
    });
    assert.equal(selectDefault.status, 200);
    assert.equal(selectDefault.body.activeSessionId, 'default');

    const defaultHistory = await fixture.request('/api/history');
    assert.equal(defaultHistory.status, 200);
    assert.equal(defaultHistory.body.activeSessionId, 'default');
    assert.equal(defaultHistory.body.messages.some((msg) => msg.text === 'default session message'), true);
    assert.equal(defaultHistory.body.messages.some((msg) => msg.text === 'second session message'), false);

    const selectSecond = await fixture.request('/api/sessions/select', {
      method: 'POST',
      body: { sessionId: secondSessionId }
    });
    assert.equal(selectSecond.status, 200);
    assert.equal(selectSecond.body.activeSessionId, secondSessionId);

    const secondHistory = await fixture.request('/api/history');
    assert.equal(secondHistory.status, 200);
    assert.equal(secondHistory.body.activeSessionId, secondSessionId);
    assert.equal(secondHistory.body.messages.some((msg) => msg.text === 'second session message'), true);
    assert.equal(secondHistory.body.messages.some((msg) => msg.text === 'default session message'), false);
  } finally {
    await fixture.cleanup();
  }
});

test('对话页支持读取并设置当前智能体工作目录', async () => {
  const fixture = await createChatServerFixture();

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

    const options = await fixture.request('/api/workdirs/options');
    assert.equal(options.status, 200);
    assert.equal(Array.isArray(options.body.options), true);

    const badSet = await fixture.request('/api/workdirs/select', {
      method: 'POST',
      body: { agentName: 'Codex架构师', workdir: './relative' }
    });
    assert.equal(badSet.status, 400);

    const setWorkdir = await fixture.request('/api/workdirs/select', {
      method: 'POST',
      body: { agentName: 'Codex架构师', workdir: '/tmp' }
    });
    assert.equal(setWorkdir.status, 200);
    assert.equal(setWorkdir.body.workdir, '/tmp');

    const history = await fixture.request('/api/history');
    assert.equal(history.status, 200);
    assert.equal(history.body.agentWorkdirs['Codex架构师'], '/tmp');
  } finally {
    await fixture.cleanup();
  }
});
