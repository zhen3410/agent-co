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

function createCyclingClaudeScript(tempDir) {
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
    await post('@Bob 继续');
  } else if (agentName === 'Bob') {
    await post('@Alice 继续');
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

test('流式连接中断后不会继续执行后续被 @ 的智能体链路', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-stream-abort-'));
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
    await post('@Bob 请继续跟进');
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

test('启用超过 4 个智能体时，@所有人 仍会触发全部已启用智能体回复', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-broadcast-all-'));
  const fakeClaude = join(tempDir, 'claude');
  const fakeCodex = join(tempDir, 'codex');
  const agentDataFile = join(tempDir, 'agents.json');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash
printf '{"output_text":"%s 已收到"}\\n' "\${BOT_ROOM_AGENT_NAME:-AI}"
`, 'utf8');
  writeFileSync(fakeCodex, `#!/usr/bin/env bash
printf '{"output_text":"{\\"output_text\\":\\"%s 已收到\\"}\\n"' "\${BOT_ROOM_AGENT_NAME:-AI}"
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

test('chat-stream 客户端中途断开时会记录明确的断流日志', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-claude-stream-disconnect-log-'));
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

test('chat-resume 会继续执行流式中断后剩余的智能体链路，避免重复执行已完成节点', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-stream-resume-chain-'));
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

test('agentChainMaxCallsPerAgent 为 null 时，同智能体循环提及不会被截断', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-chain-unlimited-'));
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
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-chain-hops-'));
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
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-fake-chain-limited-'));
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
