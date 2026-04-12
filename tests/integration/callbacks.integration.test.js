const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatServerFixture } = require('./helpers/chat-server-fixture');
const { waitForTimelineMessages } = require('./helpers/timeline-assertions');

const CALLBACK_TOKEN = 'agent-co-callback-token';

async function enableAgents(fixture, agentNames) {
  for (const agentName of agentNames) {
    const response = await fixture.request('/api/session-agents', {
      method: 'POST',
      body: { agentName, enabled: true }
    });
    assert.equal(response.status, 200);
  }
}

test('callback 接口未鉴权返回 401', async () => {
  const fixture = await createChatServerFixture();
  try {
    const postResponse = await fixture.request('/api/callbacks/post-message', {
      method: 'POST',
      body: { content: 'hello' }
    });
    assert.equal(postResponse.status, 401);
    assert.equal(postResponse.body.error, 'Unauthorized');

    const contextResponse = await fixture.request('/api/callbacks/thread-context?sessionid=default');
    assert.equal(contextResponse.status, 401);
    assert.equal(contextResponse.body.error, 'Unauthorized');
  } finally {
    await fixture.cleanup();
  }
});

test('callback thread-context 返回会话历史', async () => {
  const fixture = await createChatServerFixture();
  try {
    await fixture.login();
    await enableAgents(fixture, ['Alice']);
    await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice 你好' }
    });

    const history = await fixture.request('/api/history');
    const sessionId = history.body.activeSessionId;

    const contextResponse = await fixture.request(`/api/callbacks/thread-context?sessionid=${encodeURIComponent(sessionId)}`, {
      headers: {
        Authorization: `Bearer ${CALLBACK_TOKEN}`,
        'x-agent-co-callback-token': CALLBACK_TOKEN
      }
    });

    assert.equal(contextResponse.status, 200);
    assert.equal(contextResponse.body.sessionId, sessionId);
    assert.ok(Array.isArray(contextResponse.body.messages));
    assert.ok(contextResponse.body.messages.length >= 1);
  } finally {
    await fixture.cleanup();
  }
});

test('callback post-message 的消息可被对应智能体消费并出现在聊天响应中', async () => {
  const fixture = await createChatServerFixture();
  try {
    await fixture.login();
    await enableAgents(fixture, ['Alice']);
    const history = await fixture.request('/api/history');
    const sessionId = history.body.activeSessionId;

    const postResponse = await fixture.request('/api/callbacks/post-message', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CALLBACK_TOKEN}`,
        'x-agent-co-callback-token': CALLBACK_TOKEN,
        'x-agent-co-session-id': sessionId,
        'x-agent-co-agent': 'Alice'
      },
      body: { content: '我完成开发了，请 @Reviewer 做 Code Review。' }
    });
    assert.equal(postResponse.status, 200);
    assert.equal(postResponse.body.status, 'ok');

    const chatResponse = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice 继续' }
    });

    assert.equal(chatResponse.status, 200);
    const texts = (await waitForTimelineMessages(
      fixture,
      sessionId,
      messages => messages.some(item => item.text === '我完成开发了，请 @Reviewer 做 Code Review。')
    )).map(item => item.text);
    assert.ok(texts.includes('我完成开发了，请 @Reviewer 做 Code Review。'));
  } finally {
    await fixture.cleanup();
  }
});
