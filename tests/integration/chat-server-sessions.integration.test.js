const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatServerFixture } = require('./helpers/chat-server-fixture');

test('会话 HTTP 契约：创建、选择、重命名与删除都保持 activeSessionId 和 history 一致', async () => {
  const fixture = await createChatServerFixture();

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

    const initialHistory = await fixture.request('/api/history');
    assert.equal(initialHistory.status, 200);
    assert.equal(initialHistory.body.activeSessionId, 'default');
    assert.equal(initialHistory.body.session.id, 'default');
    assert.equal(Array.isArray(initialHistory.body.chatSessions), true);

    const defaultMessage = 'default session message';
    const defaultChat = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: defaultMessage }
    });
    assert.equal(defaultChat.status, 200);

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: '这是一个很长很长很长很长很长很长很长很长很长很长的会话名称' }
    });
    assert.equal(createResponse.status, 200);
    assert.equal(createResponse.body.success, true);
    assert.ok(createResponse.body.activeSessionId);
    assert.equal(createResponse.body.activeSessionId, createResponse.body.session.id);
    assert.equal(createResponse.body.session.name.length <= 40, true);

    const secondSessionId = createResponse.body.session.id;

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
      body: { sessionId: secondSessionId }
    });
    assert.equal(selectSecond.status, 200);
    assert.equal(selectSecond.body.activeSessionId, secondSessionId);
    assert.equal(selectSecond.body.session.id, secondSessionId);

    const secondHistory = await fixture.request('/api/history');
    assert.equal(secondHistory.status, 200);
    assert.equal(secondHistory.body.activeSessionId, secondSessionId);
    assert.equal(secondHistory.body.session.id, secondSessionId);
    assert.equal(secondHistory.body.messages.some(msg => msg.text === secondMessage), true);
    assert.equal(secondHistory.body.messages.some(msg => msg.text === defaultMessage), false);

    const renameResponse = await fixture.request('/api/sessions/rename', {
      method: 'POST',
      body: { sessionId: secondSessionId, name: '重命名后的会话' }
    });
    assert.equal(renameResponse.status, 200);
    assert.equal(renameResponse.body.success, true);
    assert.equal(renameResponse.body.session.id, secondSessionId);
    assert.equal(renameResponse.body.session.name, '重命名后的会话');
    assert.equal(
      renameResponse.body.chatSessions.find(session => session.id === secondSessionId).name,
      '重命名后的会话'
    );

    const renamedHistory = await fixture.request('/api/history');
    assert.equal(renamedHistory.status, 200);
    assert.equal(renamedHistory.body.session.id, secondSessionId);
    assert.equal(renamedHistory.body.session.name, '重命名后的会话');
    assert.equal(
      renamedHistory.body.chatSessions.find(session => session.id === secondSessionId).name,
      '重命名后的会话'
    );

    const deleteActive = await fixture.request('/api/sessions/delete', {
      method: 'POST',
      body: { sessionId: secondSessionId }
    });
    assert.equal(deleteActive.status, 200);
    assert.equal(deleteActive.body.success, true);
    assert.equal(deleteActive.body.activeSessionId, 'default');
    assert.equal(deleteActive.body.session.id, 'default');
    assert.equal(deleteActive.body.messages.some(msg => msg.text === defaultMessage), true);
    assert.equal(deleteActive.body.chatSessions.some(session => session.id === secondSessionId), false);

    const fallbackHistory = await fixture.request('/api/history');
    assert.equal(fallbackHistory.status, 200);
    assert.equal(fallbackHistory.body.activeSessionId, 'default');
    assert.equal(fallbackHistory.body.session.id, 'default');
    assert.equal(fallbackHistory.body.chatSessions.some(session => session.id === secondSessionId), false);
  } finally {
    await fixture.cleanup();
  }
});
