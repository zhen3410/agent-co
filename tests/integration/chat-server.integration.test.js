const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, chmodSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createChatServerFixture } = require('./helpers/chat-server-fixture');

async function enableAgents(fixture, agentNames) {
  for (const agentName of agentNames) {
    const response = await fixture.request('/api/session-agents', {
      method: 'POST',
      body: { agentName, enabled: true }
    });
    assert.equal(response.status, 200);
  }
}

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

test('智能体 callback 消息中的 @ 提及会自动触发下一个智能体回复', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-claude-chain-'));
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
    await post('@Bob 请补充工程实现建议');
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
        ['Alice', '@Bob 请补充工程实现建议'],
        ['Bob', 'Bob 已收到 Alice 的邀请，并补充了工程实现建议']
      ]
    );
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('支持带中文标点的 @Codex架构师 提及', async () => {
  const fixture = await createChatServerFixture();

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
  }
});

test('支持全角＠all 群聊提及并触发所有智能体回复', async () => {
  const fixture = await createChatServerFixture();

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

test('chat-stream 会继续推送由智能体 @ 触发的后续智能体消息', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-claude-stream-chain-'));
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
    await post('@Bob 请流式继续');
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
