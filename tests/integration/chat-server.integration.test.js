const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, chmodSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createChatServerFixture } = require('./helpers/chat-server-fixture');

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

test('支持带中文标点的 @Codex架构师 提及', async () => {
  const fixture = await createChatServerFixture();

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

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
  }
});

test('支持全角＠all 群聊提及并触发所有智能体回复', async () => {
  const fixture = await createChatServerFixture();

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

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
      PATH: `${tempDir}:${process.env.PATH || ''}`
    }
  });

  try {
    await fixture.login();
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
