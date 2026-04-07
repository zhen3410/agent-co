const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatServerFixture } = require('./helpers/chat-server-fixture');

async function loginWithDefaultSession(fixture) {
  const loginResponse = await fixture.login();
  assert.equal(loginResponse.status, 200);

  const historyResponse = await fixture.request('/api/history');
  assert.equal(historyResponse.status, 200);
  assert.equal(historyResponse.body.activeSessionId, 'default');
  assert.equal(historyResponse.body.session.id, 'default');
  assert.equal(Array.isArray(historyResponse.body.chatSessions), true);

  return historyResponse;
}

async function createSession(fixture, name) {
  const response = await fixture.request('/api/sessions', {
    method: 'POST',
    body: { name }
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.ok(response.body.activeSessionId);

  return response.body;
}

test('会话创建与选择会保持 activeSessionId 和 history 隔离', async () => {
  const fixture = await createChatServerFixture();

  try {
    await loginWithDefaultSession(fixture);

    const defaultMessage = 'default session message';
    const defaultChat = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: defaultMessage }
    });
    assert.equal(defaultChat.status, 200);

    const created = await createSession(
      fixture,
      '这是一个很长很长很长很长很长很长很长很长很长很长的会话名称'
    );
    assert.notEqual(created.activeSessionId, 'default');
    assert.equal(created.activeSessionId, created.session.id);
    assert.equal(created.session.name.length <= 40, true);

    const secondMessage = 'second session message';
    const secondChat = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: secondMessage }
    });
    assert.equal(secondChat.status, 200);

    const selectDefault = await fixture.request('/api/sessions/select', {
      method: 'POST',
      body: { sessionId: 'default' }
    });
    assert.equal(selectDefault.status, 200);
    assert.equal(selectDefault.body.activeSessionId, 'default');
    assert.equal(selectDefault.body.session.id, 'default');

    const defaultHistory = await fixture.request('/api/history');
    assert.equal(defaultHistory.status, 200);
    assert.equal(defaultHistory.body.activeSessionId, 'default');
    assert.equal(defaultHistory.body.session.id, 'default');
    assert.equal(defaultHistory.body.messages.some(msg => msg.text === defaultMessage), true);
    assert.equal(defaultHistory.body.messages.some(msg => msg.text === secondMessage), false);

    const selectSecond = await fixture.request('/api/sessions/select', {
      method: 'POST',
      body: { sessionId: created.session.id }
    });
    assert.equal(selectSecond.status, 200);
    assert.equal(selectSecond.body.activeSessionId, created.session.id);
    assert.equal(selectSecond.body.session.id, created.session.id);

    const secondHistory = await fixture.request('/api/history');
    assert.equal(secondHistory.status, 200);
    assert.equal(secondHistory.body.activeSessionId, created.session.id);
    assert.equal(secondHistory.body.session.id, created.session.id);
    assert.equal(secondHistory.body.messages.some(msg => msg.text === secondMessage), true);
    assert.equal(secondHistory.body.messages.some(msg => msg.text === defaultMessage), false);
  } finally {
    await fixture.cleanup();
  }
});

test('会话重命名会反映在 session 与 summary payloads 中', async () => {
  const fixture = await createChatServerFixture();

  try {
    await loginWithDefaultSession(fixture);

    const created = await createSession(fixture, 'rename target');
    const renamedName = '重命名后的会话';

    const renameResponse = await fixture.request('/api/sessions/rename', {
      method: 'POST',
      body: { sessionId: created.session.id, name: renamedName }
    });
    assert.equal(renameResponse.status, 200);
    assert.equal(renameResponse.body.success, true);
    assert.equal(renameResponse.body.session.id, created.session.id);
    assert.equal(renameResponse.body.session.name, renamedName);
    assert.equal(
      renameResponse.body.chatSessions.find(session => session.id === created.session.id).name,
      renamedName
    );

    const history = await fixture.request('/api/history');
    assert.equal(history.status, 200);
    assert.equal(history.body.session.id, created.session.id);
    assert.equal(history.body.session.name, renamedName);
    assert.equal(
      history.body.chatSessions.find(session => session.id === created.session.id).name,
      renamedName
    );
  } finally {
    await fixture.cleanup();
  }
});

test('删除当前活跃会话后会回退到剩余有效会话', async () => {
  const fixture = await createChatServerFixture();

  try {
    await loginWithDefaultSession(fixture);

    const created = await createSession(fixture, 'delete target');
    const selectTarget = await fixture.request('/api/sessions/select', {
      method: 'POST',
      body: { sessionId: created.session.id }
    });
    assert.equal(selectTarget.status, 200);
    assert.equal(selectTarget.body.activeSessionId, created.session.id);

    const deleteActive = await fixture.request('/api/sessions/delete', {
      method: 'POST',
      body: { sessionId: created.session.id }
    });
    assert.equal(deleteActive.status, 200);
    assert.equal(deleteActive.body.success, true);
    assert.equal(deleteActive.body.activeSessionId, 'default');
    assert.equal(deleteActive.body.session.id, 'default');
    assert.equal(deleteActive.body.chatSessions.some(session => session.id === created.session.id), false);

    const fallbackHistory = await fixture.request('/api/history');
    assert.equal(fallbackHistory.status, 200);
    assert.equal(fallbackHistory.body.activeSessionId, 'default');
    assert.equal(fallbackHistory.body.session.id, 'default');
    assert.equal(fallbackHistory.body.chatSessions.some(session => session.id === created.session.id), false);
  } finally {
    await fixture.cleanup();
  }
});
