const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatServerFixture } = require('./helpers/chat-server-fixture');

test('未登录状态可正常进行聊天并在登出后继续保留会话', async () => {
  const fixture = await createChatServerFixture();

  try {
    const authStatus = await fixture.request('/api/auth-status');
    assert.equal(authStatus.status, 200);
    assert.equal(authStatus.body.authEnabled, true);
    assert.equal(authStatus.body.authenticated, false);

    const beforeHistory = await fixture.request('/api/history');
    assert.equal(beforeHistory.status, 200);
    assert.ok(Array.isArray(beforeHistory.body.messages));

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice 请总结一下今日任务' }
    });
    assert.equal(chatResponse.status, 200);
    assert.equal(chatResponse.body.success, true);
    assert.ok(Array.isArray(chatResponse.body.aiMessages));
    assert.ok(chatResponse.body.aiMessages.length >= 1);

    const historyAfterChat = await fixture.request('/api/history');
    assert.equal(historyAfterChat.status, 200);
    assert.ok(historyAfterChat.body.messages.length >= 2);

    const logoutResponse = await fixture.request('/api/logout', { method: 'POST' });
    assert.equal(logoutResponse.status, 200);
    assert.equal(logoutResponse.body.success, true);

    const historyAfterLogout = await fixture.request('/api/history');
    assert.equal(historyAfterLogout.status, 200);
    assert.ok(historyAfterLogout.body.messages.length >= 2);
  } finally {
    await fixture.cleanup();
  }
});

test('未登录状态下支持多智能体协作回复', async () => {
  const fixture = await createChatServerFixture();

  try {
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
