const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createChatServerFixture } = require('./helpers/chat-server-fixture');
const { withIsolatedChatSessionState, isRedisSessionStateAvailable } = require('./helpers/redis-session-state-fixture');

const repoRoot = path.resolve(__dirname, '..', '..');
const distDir = path.join(repoRoot, 'dist');

function requireBuiltModule(...segments) {
  const modulePath = path.join(distDir, ...segments);
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function parseSetCookiePair(setCookieHeader) {
  if (!setCookieHeader) return '';
  return String(setCookieHeader).split(/,(?=\s*[^;]+=)/)[0].split(';')[0];
}

function createReviewLoopClaudeScript(tempDir, mode) {
  const fakeClaude = path.join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env node
const fs = require('node:fs');
const agentName = process.env.AGENT_CO_AGENT_NAME || 'AI';
const sessionId = process.env.AGENT_CO_SESSION_ID || '';
const apiUrl = process.env.AGENT_CO_API_URL || '';
const token = process.env.AGENT_CO_CALLBACK_TOKEN || '';
const prompt = process.argv.slice(2).join(' ');
const mode = ${JSON.stringify(mode)};
const stateFile = ${JSON.stringify(path.join(tempDir, 'review-loop-state.json'))};

function loadState() {
  if (!fs.existsSync(stateFile)) {
    return { alicePrompts: [] };
  }
  return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
}

function saveState(state) {
  fs.writeFileSync(stateFile, JSON.stringify(state), 'utf8');
}

(async () => {
  if (agentName === 'Alice') {
    const state = loadState();
    state.alicePrompts.push(prompt);
    saveState(state);
    if (mode === 'accept') {
      process.stdout.write('{"output_text":"accept: Bob 已给出可执行结果。"}\\n');
      return;
    }
  }

  process.stdout.write('{"output_text":"callback sent"}\\n');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`, 'utf8');
  chmodSync(fakeClaude, 0o755);
}

function createPendingReplyCorrectionClaudeScript(tempDir) {
  const fakeClaude = path.join(tempDir, 'claude');
  writeFileSync(fakeClaude, `#!/usr/bin/env node
const fs = require('node:fs');
const agentName = process.env.AGENT_CO_AGENT_NAME || 'AI';
const sessionId = process.env.AGENT_CO_SESSION_ID || '';
const apiUrl = process.env.AGENT_CO_API_URL || '';
const token = process.env.AGENT_CO_CALLBACK_TOKEN || '';
const prompt = process.argv.slice(2).join(' ');
const stateFile = ${JSON.stringify(path.join(tempDir, 'pending-reply-correction-state.json'))};

function readState() {
  if (!fs.existsSync(stateFile)) {
    return { prompts: {} };
  }
  return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
}

function writeState(state) {
  fs.writeFileSync(stateFile, JSON.stringify(state), 'utf8');
}

async function post(content) {
  const encodedAgentName = encodeURIComponent(agentName);
  const response = await fetch(new URL('/api/callbacks/post-message', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${token}\`,
      'Content-Type': 'application/json',
      'x-agent-co-callback-token': token,
      'x-agent-co-session-id': sessionId,
      'x-agent-co-agent': encodedAgentName
    },
    body: JSON.stringify({ content })
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

(async () => {
  const state = readState();
  state.prompts[agentName] = state.prompts[agentName] || [];
  state.prompts[agentName].push(prompt);
  writeState(state);

  if (agentName === 'Bob') {
    await post(\`Bob reply for: \${prompt}\`);
    process.stdout.write('{"output_text":"callback sent"}\\n');
    return;
  }

  if (agentName === 'Alice' && prompt.includes('accept / follow_up / retry')) {
    process.stdout.write('{"output_text":"accept: Bob 已按纠正后的 prompt 回复。"}\\n');
    return;
  }

  process.stdout.write('{"output_text":"unexpected"}\\n');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`, 'utf8');
  chmodSync(fakeClaude, 0o755);
}

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
    assert.equal(initialHistory.body.session.id, 'default');
    assert.equal(initialHistory.body.session.agentChainMaxHops > 0, true);
    assert.equal(initialHistory.body.session.agentChainMaxCallsPerAgent, null);

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
    assert.equal(selectResponse.body.session.id, newSessionId);
    assert.equal(selectResponse.body.session.agentChainMaxHops > 0, true);
    assert.equal(selectResponse.body.session.agentChainMaxCallsPerAgent, null);

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
    assert.equal(deleteDefault.body.session.id, newSessionId);
    assert.equal(deleteDefault.body.session.agentChainMaxHops > 0, true);
    assert.equal(deleteDefault.body.session.agentChainMaxCallsPerAgent, null);

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
    assert.equal(defaultHistory.body.session.id, 'default');
    assert.equal(defaultHistory.body.messages.some((msg) => msg.text === 'default session message'), true);
    assert.equal(defaultHistory.body.messages.some((msg) => msg.text === 'second session message'), false);

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

    const roots = await fixture.request('/api/system/dirs?path=/');
    assert.equal(roots.status, 200);
    assert.equal(Array.isArray(roots.body.directories), true);
    assert.equal(roots.body.directories.every(item => item.path.startsWith('/')), true);

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

test('新建会话默认不启用任何智能体，并支持按 session 切换启用状态', async () => {
  const fixture = await createChatServerFixture();

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'empty session' }
    });
    assert.equal(createResponse.status, 200);
    assert.deepEqual(createResponse.body.session.enabledAgents, []);

    const toggleOn = await fixture.request('/api/session-agents', {
      method: 'POST',
      body: { agentName: 'Alice', enabled: true }
    });
    assert.equal(toggleOn.status, 200);
    assert.deepEqual(toggleOn.body.enabledAgents, ['Alice']);
    assert.equal(toggleOn.body.currentAgentWillExpire, false);

    const toggleOff = await fixture.request('/api/session-agents', {
      method: 'POST',
      body: { agentName: 'Alice', enabled: false }
    });
    assert.equal(toggleOff.status, 200);
    assert.deepEqual(toggleOff.body.enabledAgents, []);

    const history = await fixture.request('/api/history');
    assert.equal(history.status, 200);
    assert.deepEqual(history.body.enabledAgents, []);
  } finally {
    await fixture.cleanup();
  }
});

test('已停用的智能体不能被 @，零启用会话会返回明确提示', async () => {
  const fixture = await createChatServerFixture();

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

    const zeroEnabled = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: 'hello when empty' }
    });
    assert.equal(zeroEnabled.status, 200);
    assert.equal(zeroEnabled.body.aiMessages.length, 0);
    assert.match(zeroEnabled.body.notice || '', /没有启用智能体|先启用/i);

    await fixture.request('/api/session-agents', {
      method: 'POST',
      body: { agentName: 'Bob', enabled: true }
    });

    const mentionDisabled = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Alice 你好' }
    });
    assert.equal(mentionDisabled.status, 200);
    assert.equal(mentionDisabled.body.aiMessages.length, 0);
    assert.equal(mentionDisabled.body.currentAgent, null);
    assert.match(mentionDisabled.body.notice || '', /Alice|停用|启用/i);

    const mentionEnabled = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Bob 你好' }
    });
    assert.equal(mentionEnabled.status, 200);
    assert.equal(mentionEnabled.body.aiMessages.some(msg => msg.sender === 'Bob'), true);
    assert.equal(mentionEnabled.body.currentAgent, 'Bob');
  } finally {
    await fixture.cleanup();
  }
});

test('关闭当前对话智能体后，从下一条消息开始失效', async () => {
  const fixture = await createChatServerFixture();

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

    await fixture.request('/api/session-agents', {
      method: 'POST',
      body: { agentName: 'Codex架构师', enabled: true }
    });

    const firstChat = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '@Codex架构师 第一条消息' }
    });
    assert.equal(firstChat.status, 200);
    assert.equal(firstChat.body.currentAgent, 'Codex架构师');

    const disableCurrent = await fixture.request('/api/session-agents', {
      method: 'POST',
      body: { agentName: 'Codex架构师', enabled: false }
    });
    assert.equal(disableCurrent.status, 200);
    assert.equal(disableCurrent.body.currentAgentWillExpire, true);

    const followup = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '继续' }
    });
    assert.equal(followup.status, 200);
    assert.equal(followup.body.aiMessages.length, 0);
    assert.equal(followup.body.currentAgent, null);
    assert.match(followup.body.notice || '', /没有启用智能体|先启用/i);
  } finally {
    await fixture.cleanup();
  }
});

test('聊天页智能体列表不会重新展示已删除的默认内置智能体', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'agent-co-chat-removed-default-'));
  const agentDataFile = path.join(tempDir, 'agents.json');
  writeFileSync(agentDataFile, JSON.stringify({
    activeAgents: [
      {
        name: 'Codex架构师',
        avatar: '🏗️',
        color: '#8b5cf6',
        personality: '资深架构师，强调高内聚低耦合、可维护性与工程实践。',
        cli: 'codex'
      },
      {
        name: 'Alice',
        avatar: '👩‍💻',
        color: '#22c55e',
        personality: '你是一个富有创造力的 AI 助手，喜欢用生动的语言回答问题。擅长艺术和设计。',
        cli: 'claude'
      },
      {
        name: 'Bob',
        avatar: '🧑‍💻',
        color: '#f97316',
        personality: '你是一个务实的 AI 助手，喜欢用简单直接的方式解决问题。擅长工程实践。',
        cli: 'claude'
      }
    ],
    removedDefaultAgentNames: ['Claude'],
    pendingAgents: null,
    pendingRemovedDefaultAgentNames: null,
    pendingReason: null,
    updatedAt: Date.now(),
    pendingUpdatedAt: null
  }, null, 2), 'utf8');

  const fixture = await createChatServerFixture({
    env: {
      AGENT_DATA_FILE: agentDataFile
    }
  });

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

    const agentsResponse = await fixture.request('/api/agents');
    assert.equal(agentsResponse.status, 200);
    assert.equal(agentsResponse.body.agents.some(agent => agent.name === 'Claude'), false);
    assert.equal(agentsResponse.body.agents.some(agent => agent.name === 'Codex架构师'), true);
  } finally {
    await fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('新建会话会返回链式传播设置字段，并在会话列表中可见', async () => {
  const fixture = await createChatServerFixture();

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'chain settings' }
    });

    assert.equal(createResponse.status, 200);
    assert.equal(createResponse.body.success, true);
    assert.equal(createResponse.body.session.agentChainMaxHops > 0, true);
    assert.equal(createResponse.body.session.agentChainMaxCallsPerAgent, null);

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    const summary = historyResponse.body.chatSessions.find((session) => session.id === createResponse.body.session.id);
    assert.ok(summary);
    assert.equal(summary.agentChainMaxHops, createResponse.body.session.agentChainMaxHops);
    assert.equal(summary.agentChainMaxCallsPerAgent, createResponse.body.session.agentChainMaxCallsPerAgent);
  } finally {
    await fixture.cleanup();
  }
});

test('新建会话返回默认 discussionMode 与 discussionState', async () => {
  const fixture = await createChatServerFixture();

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'discussion defaults' }
    });

    assert.equal(createResponse.status, 200);
    assert.equal(createResponse.body.session.discussionMode, 'classic');
    assert.equal(createResponse.body.session.discussionState, 'active');

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    const summary = historyResponse.body.chatSessions.find((session) => session.id === createResponse.body.session.id);
    assert.ok(summary);
    assert.equal(summary.discussionMode, 'classic');
    assert.equal(summary.discussionState, 'active');
    assert.equal(historyResponse.body.session.discussionMode, 'classic');
    assert.equal(historyResponse.body.session.discussionState, 'active');
  } finally {
    await fixture.cleanup();
  }
});

test('POST /api/sessions/update 支持切换 discussionMode', async () => {
  const fixture = await createChatServerFixture();

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'discussion mode patch' }
    });
    assert.equal(createResponse.status, 200);
    const sessionId = createResponse.body.session.id;

    const updateResponse = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId,
        patch: { discussionMode: 'peer' }
      }
    });

    assert.equal(updateResponse.status, 200);
    assert.equal(updateResponse.body.session.discussionMode, 'peer');
    assert.equal(updateResponse.body.session.discussionState, 'active');

    const historyResponse = await fixture.request('/api/history');
    assert.equal(historyResponse.status, 200);
    const summary = historyResponse.body.chatSessions.find((session) => session.id === sessionId);
    assert.ok(summary);
    assert.equal(summary.discussionMode, 'peer');
    assert.equal(summary.discussionState, 'active');
  } finally {
    await fixture.cleanup();
  }
});

test('POST /api/sessions/update 会拒绝非法 discussionMode', async () => {
  const fixture = await createChatServerFixture();

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'invalid discussion mode' }
    });
    assert.equal(createResponse.status, 200);
    const sessionId = createResponse.body.session.id;

    const invalidMode = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId,
        patch: { discussionMode: 'group' }
      }
    });
    assert.equal(invalidMode.status, 400);

    const invalidState = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId,
        patch: { discussionState: 'paused' }
      }
    });
    assert.equal(invalidState.status, 400);
  } finally {
    await fixture.cleanup();
  }
});

test('旧会话数据缺少链路字段时会自动回填默认值', { skip: !isRedisSessionStateAvailable() }, async () => {
  const legacyState = {
    version: 1,
    userChatSessions: {
      'user:admin': [{
        id: 'legacy-session',
        name: 'legacy session',
        history: [],
        currentAgent: null,
        enabledAgents: [],
        agentWorkdirs: {},
        createdAt: Date.now() - 1000,
        updatedAt: Date.now() - 1000
      }]
    },
    userActiveChatSession: {
      'user:admin': 'legacy-session'
    }
  };

  await withIsolatedChatSessionState(legacyState, async () => {
    const fixture = await createChatServerFixture({
      env: {
        AGENT_CO_DISABLE_REDIS: 'false',
        AGENT_CO_REDIS_REQUIRED: 'false'
      }
    });

    try {
      const loginResponse = await fixture.login();
      assert.equal(loginResponse.status, 200);

      const historyResponse = await fixture.request('/api/history');
      assert.equal(historyResponse.status, 200);
      const legacySession = historyResponse.body.chatSessions.find((session) => session.id === 'legacy-session');
      assert.ok(legacySession);
      assert.equal(typeof legacySession.agentChainMaxHops, 'number');
      assert.equal(legacySession.agentChainMaxHops > 0, true);
      assert.equal(legacySession.agentChainMaxCallsPerAgent, null);
      assert.equal(legacySession.discussionMode, 'classic');
      assert.equal(legacySession.discussionState, 'active');
      assert.equal(historyResponse.body.session.discussionMode, 'classic');
      assert.equal(historyResponse.body.session.discussionState, 'active');
    } finally {
      await fixture.cleanup();
    }
  });
});

test('会话状态可持久化待复核的 agent 调用任务', { skip: !isRedisSessionStateAvailable() }, async () => {
  const now = Date.now();
  const legacyState = {
    version: 1,
    userChatSessions: {
      'user:admin': [{
        id: 'review-session',
        name: 'review session',
        history: [{
          id: 'm-user',
          role: 'user',
          sender: '用户',
          text: '@Alice 帮我检查 Bob 的回答',
          timestamp: now - 2000
        }, {
          id: 'm-assistant',
          role: 'assistant',
          sender: 'Alice',
          text: '我将先调用 Bob，然后复核结果。',
          timestamp: now - 1500,
          taskId: 'task-1',
          callerAgentName: 'Alice',
          calleeAgentName: 'Bob'
        }, {
          id: 'm-review',
          role: 'assistant',
          sender: 'Alice',
          text: 'follow_up: 需要 Bob 给出具体步骤。',
          timestamp: now - 1000,
          taskId: 'task-1',
          parentTaskId: 'task-1',
          reviewAction: 'follow_up',
          callerAgentName: 'Alice',
          calleeAgentName: 'Bob'
        }],
        currentAgent: 'Alice',
        enabledAgents: ['Alice', 'Bob'],
        agentWorkdirs: {},
        invocationTasks: [{
          id: 'task-1',
          status: 'pending_reply',
          sessionId: 'review-session',
          callerAgentName: 'Alice',
          calleeAgentName: 'Bob',
          prompt: '请给出具体步骤',
          createdAt: now - 1500,
          updatedAt: now - 1000,
          deadlineAt: now + 5 * 60 * 1000,
          retryCount: 0,
          followupCount: 1
        }],
        createdAt: now - 3000,
        updatedAt: now - 500
      }]
    },
    userActiveChatSession: {
      'user:admin': 'review-session'
    }
  };

  await withIsolatedChatSessionState(legacyState, async () => {
    const fixture = await createChatServerFixture({
      env: {
        AGENT_CO_DISABLE_REDIS: 'false',
        AGENT_CO_REDIS_REQUIRED: 'false'
      }
    });

    try {
      const loginResponse = await fixture.login();
      assert.equal(loginResponse.status, 200);

      const historyResponse = await fixture.request('/api/history');
      assert.equal(historyResponse.status, 200);
      assert.equal(historyResponse.body.session.id, 'review-session');
      assert.equal(Array.isArray(historyResponse.body.messages), true);
      assert.equal(historyResponse.body.messages.length, 3);
      assert.equal(historyResponse.body.messages[1].taskId, 'task-1');
      assert.equal(historyResponse.body.messages[2].reviewAction, 'follow_up');
      assert.equal(Array.isArray(historyResponse.body.session.invocationTasks), true);
      assert.equal(historyResponse.body.session.invocationTasks.length, 1);
      assert.equal(historyResponse.body.session.invocationTasks[0].id, 'task-1');
      assert.equal(historyResponse.body.session.invocationTasks[0].status, 'pending_reply');
      assert.equal(historyResponse.body.session.invocationTasks[0].callerAgentName, 'Alice');
      assert.equal(historyResponse.body.session.invocationTasks[0].calleeAgentName, 'Bob');
    } finally {
      await fixture.cleanup();
    }
  });
});

test('旧会话缺少 invocationTasks 字段时仍可正常恢复', { skip: !isRedisSessionStateAvailable() }, async () => {
  const now = Date.now();
  const legacyState = {
    version: 1,
    userChatSessions: {
      'user:admin': [{
        id: 'legacy-no-invocation-tasks',
        name: 'legacy no invocation tasks',
        history: [{
          id: 'legacy-message',
          role: 'assistant',
          sender: 'Alice',
          text: '旧会话消息',
          timestamp: now - 1000
        }],
        currentAgent: 'Alice',
        enabledAgents: ['Alice'],
        agentWorkdirs: {},
        createdAt: now - 2000,
        updatedAt: now - 500
      }]
    },
    userActiveChatSession: {
      'user:admin': 'legacy-no-invocation-tasks'
    }
  };

  await withIsolatedChatSessionState(legacyState, async () => {
    const fixture = await createChatServerFixture({
      env: {
        AGENT_CO_DISABLE_REDIS: 'false',
        AGENT_CO_REDIS_REQUIRED: 'false'
      }
    });

    try {
      const loginResponse = await fixture.login();
      assert.equal(loginResponse.status, 200);

      const historyResponse = await fixture.request('/api/history');
      assert.equal(historyResponse.status, 200);
      assert.equal(historyResponse.body.session.id, 'legacy-no-invocation-tasks');
      assert.equal(historyResponse.body.messages.length, 1);
      assert.equal(Array.isArray(historyResponse.body.session.invocationTasks), true);
      assert.equal(historyResponse.body.session.invocationTasks.length, 0);
    } finally {
      await fixture.cleanup();
    }
  });
});

test('会话状态序列化会写出 invocationTasks 字段', () => {
  const { createChatSessionRepository } = requireBuiltModule('chat', 'infrastructure', 'chat-session-repository.js');
  const repository = createChatSessionRepository();
  const now = Date.now();
  const session = {
    id: 'serialize-session',
    name: 'serialize session',
    history: [],
    currentAgent: null,
    enabledAgents: ['Alice', 'Bob'],
    agentWorkdirs: {},
    invocationTasks: [{
      id: 'task-write-1',
      sessionId: 'serialize-session',
      status: 'pending_reply',
      callerAgentName: 'Alice',
      calleeAgentName: 'Bob',
      prompt: '请继续完善输出',
      createdAt: now - 1000,
      updatedAt: now - 500,
      deadlineAt: now + 60000,
      retryCount: 0,
      followupCount: 1
    }],
    createdAt: now - 2000,
    updatedAt: now
  };

  repository.setUserSessions('user:admin', new Map([[session.id, session]]));
  repository.setActiveSessionId('user:admin', session.id);

  const serialized = repository.serializeState();
  assert.equal(Array.isArray(serialized.userChatSessions['user:admin']), true);
  assert.equal(serialized.userChatSessions['user:admin'].length, 1);
  assert.equal(Array.isArray(serialized.userChatSessions['user:admin'][0].invocationTasks), true);
  assert.equal(serialized.userChatSessions['user:admin'][0].invocationTasks.length, 1);
  assert.equal(serialized.userChatSessions['user:admin'][0].invocationTasks[0].id, 'task-write-1');
  assert.equal(serialized.userChatSessions['user:admin'][0].invocationTasks[0].status, 'pending_reply');
});

test('runtime invocationTasks 归一化遵循会话上下文语义', () => {
  const { createChatSessionRepository } = requireBuiltModule('chat', 'infrastructure', 'chat-session-repository.js');
  const { createChatSessionState } = requireBuiltModule('chat', 'runtime', 'chat-session-state.js');
  const repository = createChatSessionRepository();
  const sessionState = createChatSessionState({
    config: {
      defaultChatSessionId: 'default',
      defaultChatSessionName: '默认会话',
      getValidAgentNames: () => ['Alice', 'Bob']
    },
    repository,
    schedulePersistChatSessions: () => {},
    touchSession: (session) => {
      session.updatedAt = Date.now();
    },
    normalizeSessionChainSettings: () => ({
      agentChainMaxHops: 8,
      agentChainMaxCallsPerAgent: null
    }),
    normalizeSessionDiscussionSettings: () => ({
      discussionMode: 'classic',
      discussionState: 'active'
    }),
    applyNormalizedSessionChainSettings: (session) => {
      session.agentChainMaxHops = 8;
      session.agentChainMaxCallsPerAgent = null;
      return session;
    },
    applyNormalizedSessionDiscussionSettings: (session) => {
      session.discussionMode = 'classic';
      session.discussionState = 'active';
      return session;
    }
  });

  sessionState.ensureUserSessions('user:admin');
  const now = Date.now();

  const created = sessionState.createInvocationTask('user:admin', 'default', {
    id: 'task-semantics-1',
    sessionId: 'other-session',
    status: 'awaiting_caller_review',
    callerAgentName: 'Alice',
    calleeAgentName: 'Bob',
    prompt: '请继续',
    createdAt: now - 1000,
    updatedAt: now - 900,
    deadlineAt: now - 10,
    retryCount: 0,
    followupCount: 0
  });

  assert.ok(created);
  assert.equal(created.sessionId, 'default');
  const activeTasks = sessionState.listActiveInvocationTasks('user:admin', 'default');
  assert.equal(activeTasks.length, 1);
  assert.equal(activeTasks[0].status, 'awaiting_caller_review');

  const timedOut = sessionState.resolveOverdueInvocationTasks('user:admin', 'default', now);
  assert.equal(timedOut.length, 0);
});

test('会话 pause/resume 后待处理 invocationTasks 仍会保留', { skip: !isRedisSessionStateAvailable() }, async () => {
  const now = Date.now();
  const legacyState = {
    version: 1,
    userChatSessions: {
      'user:admin': [{
        id: 'paused-review-session',
        name: 'paused review session',
        history: [{
          id: 'origin',
          role: 'assistant',
          sender: 'Alice',
          text: '@@Bob 请补充实现步骤',
          timestamp: now - 5000,
          taskId: 'task-resume-1',
          callerAgentName: 'Alice',
          calleeAgentName: 'Bob'
        }],
        currentAgent: 'Alice',
        enabledAgents: ['Alice', 'Bob'],
        agentWorkdirs: {},
        discussionMode: 'peer',
        discussionState: 'paused',
        pendingAgentTasks: [],
        pendingVisibleMessages: [{
          id: 'buffered-visible-1',
          role: 'assistant',
          sender: 'Bob',
          text: '这是暂停期间缓冲的可见消息',
          timestamp: now - 1000,
          taskId: 'task-resume-1',
          callerAgentName: 'Alice',
          calleeAgentName: 'Bob'
        }],
        invocationTasks: [{
          id: 'task-resume-1',
          sessionId: 'paused-review-session',
          status: 'pending_reply',
          callerAgentName: 'Alice',
          calleeAgentName: 'Bob',
          prompt: '请补充实现步骤',
          createdAt: now - 4000,
          updatedAt: now - 1200,
          deadlineAt: now + 60 * 1000,
          retryCount: 0,
          followupCount: 0
        }],
        createdAt: now - 6000,
        updatedAt: now - 800
      }]
    },
    userActiveChatSession: {
      'user:admin': 'paused-review-session'
    }
  };

  await withIsolatedChatSessionState(legacyState, async () => {
    const fixture = await createChatServerFixture({
      env: {
        AGENT_CO_DISABLE_REDIS: 'false',
        AGENT_CO_REDIS_REQUIRED: 'false'
      }
    });

    try {
      const loginResponse = await fixture.login();
      assert.equal(loginResponse.status, 200);

      const beforeResume = await fixture.request('/api/history');
      assert.equal(beforeResume.status, 200);
      assert.equal(beforeResume.body.session.discussionState, 'paused');
      assert.equal(Array.isArray(beforeResume.body.session.invocationTasks), true);
      assert.equal(beforeResume.body.session.invocationTasks.length, 1);
      assert.equal(beforeResume.body.session.invocationTasks[0].id, 'task-resume-1');

      const resumeResponse = await fixture.request('/api/chat-resume', {
        method: 'POST'
      });
      assert.equal(resumeResponse.status, 200);
      assert.equal(resumeResponse.body.success, true);
      assert.equal(resumeResponse.body.resumed, true);
      assert.equal(Array.isArray(resumeResponse.body.aiMessages), true);
      assert.equal(resumeResponse.body.aiMessages.length, 1);
      assert.equal(resumeResponse.body.aiMessages[0].id, 'buffered-visible-1');

      const afterResume = await fixture.request('/api/history');
      assert.equal(afterResume.status, 200);
      assert.equal(Array.isArray(afterResume.body.session.invocationTasks), true);
      assert.equal(afterResume.body.session.invocationTasks.length, 1);
      assert.equal(afterResume.body.session.invocationTasks[0].id, 'task-resume-1');
      assert.equal(afterResume.body.session.invocationTasks[0].status, 'awaiting_caller_review');
      assert.equal(afterResume.body.session.invocationTasks[0].lastReplyMessageId, 'buffered-visible-1');
      assert.equal(Array.isArray(afterResume.body.session.pendingAgentTasks), true);
      assert.equal(afterResume.body.session.pendingAgentTasks.length, 1);
      assert.equal(afterResume.body.session.pendingAgentTasks[0].dispatchKind, 'internal_review');
      assert.equal(afterResume.body.session.pendingAgentTasks[0].taskId, 'task-resume-1');
      assert.equal(afterResume.body.session.pendingAgentTasks[0].agentName, 'Alice');
    } finally {
      await fixture.cleanup();
    }
  });
});

test('中断后仅存于 invocationTasks 的 caller review 任务仍可恢复，且不会重复已完成任务', { skip: !isRedisSessionStateAvailable() }, async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'agent-co-review-resume-regression-'));
  createReviewLoopClaudeScript(tempDir, 'accept');
  const now = Date.now();
  const legacyState = {
    version: 1,
    userChatSessions: {
      'user:admin': [{
        id: 'resume-review-only-session',
        name: 'resume review only session',
        history: [{
          id: 'm-user',
          role: 'user',
          sender: '用户',
          text: '@Alice 发起复核',
          timestamp: now - 5000
        }, {
          id: 'm-alice',
          role: 'assistant',
          sender: 'Alice',
          text: '请 @@Bob 给出结果',
          timestamp: now - 4500,
          taskId: 'task-pending-review',
          callerAgentName: 'Alice',
          calleeAgentName: 'Bob'
        }, {
          id: 'm-bob-pending',
          role: 'assistant',
          sender: 'Bob',
          text: 'Bob 已给出待复核结果',
          timestamp: now - 4200,
          taskId: 'task-pending-review',
          callerAgentName: 'Alice',
          calleeAgentName: 'Bob'
        }, {
          id: 'm-alice-completed',
          role: 'assistant',
          sender: 'Alice',
          text: '请 @@Bob 给出历史结果',
          timestamp: now - 4000,
          taskId: 'task-completed-review',
          callerAgentName: 'Alice',
          calleeAgentName: 'Bob'
        }, {
          id: 'm-bob-completed',
          role: 'assistant',
          sender: 'Bob',
          text: 'Bob 已给出已完成结果',
          timestamp: now - 3800,
          taskId: 'task-completed-review',
          callerAgentName: 'Alice',
          calleeAgentName: 'Bob'
        }],
        currentAgent: 'Alice',
        enabledAgents: ['Alice', 'Bob'],
        agentWorkdirs: {},
        pendingVisibleMessages: [],
        invocationTasks: [{
          id: 'task-pending-review',
          sessionId: 'resume-review-only-session',
          status: 'awaiting_caller_review',
          callerAgentName: 'Alice',
          calleeAgentName: 'Bob',
          prompt: '请 @@Bob 给出结果',
          originalPrompt: '请 @@Bob 给出结果',
          createdAt: now - 4500,
          updatedAt: now - 4200,
          deadlineAt: now + 60 * 1000,
          retryCount: 0,
          followupCount: 0,
          lastReplyMessageId: 'm-bob-pending'
        }, {
          id: 'task-completed-review',
          sessionId: 'resume-review-only-session',
          status: 'completed',
          callerAgentName: 'Alice',
          calleeAgentName: 'Bob',
          prompt: '请 @@Bob 给出历史结果',
          originalPrompt: '请 @@Bob 给出历史结果',
          createdAt: now - 4000,
          updatedAt: now - 3600,
          deadlineAt: now + 60 * 1000,
          retryCount: 0,
          followupCount: 0,
          reviewAction: 'accept',
          completedAt: now - 3600,
          lastReplyMessageId: 'm-bob-completed'
        }],
        discussionMode: 'classic',
        discussionState: 'active',
        createdAt: now - 6000,
        updatedAt: now - 3000
      }]
    },
    userActiveChatSession: {
      'user:admin': 'resume-review-only-session'
    }
  };

  await withIsolatedChatSessionState(legacyState, async () => {
    const fixture = await createChatServerFixture({
      env: {
        PATH: `${tempDir}:${process.env.PATH || ''}`,
        AGENT_CO_DISABLE_REDIS: 'false',
        AGENT_CO_REDIS_REQUIRED: 'false'
      }
    });

    try {
      const loginResponse = await fixture.login();
      assert.equal(loginResponse.status, 200);

      const resumeResponse = await fixture.request('/api/chat-resume', {
        method: 'POST'
      });
      assert.equal(resumeResponse.status, 200);
      assert.equal(resumeResponse.body.success, true);
      assert.equal(resumeResponse.body.resumed, true);
      assert.deepEqual(
        resumeResponse.body.aiMessages.map(item => [item.sender, item.messageSubtype || null, item.reviewAction || null, item.text]),
        [
          ['Alice', 'invocation_review', 'accept', 'Alice 对 Bob 的调用复核：接受。Bob 已给出可执行结果。']
        ]
      );

      const historyResponse = await fixture.request('/api/history');
      assert.equal(historyResponse.status, 200);
      assert.equal(Array.isArray(historyResponse.body.session.pendingAgentTasks), false);
      const pendingTask = historyResponse.body.session.invocationTasks.find(item => item.id === 'task-pending-review');
      assert.ok(pendingTask);
      assert.equal(pendingTask.status, 'completed');
      assert.equal(pendingTask.reviewAction, 'accept');
      const completedTask = historyResponse.body.session.invocationTasks.find(item => item.id === 'task-completed-review');
      assert.ok(completedTask);
      assert.equal(completedTask.status, 'completed');
      assert.equal(completedTask.reviewAction, 'accept');

      const promptState = JSON.parse(readFileSync(path.join(tempDir, 'review-loop-state.json'), 'utf8'));
      assert.equal(promptState.alicePrompts.length, 1);
      assert.match(promptState.alicePrompts[0], /你正在复核 Bob 对委派任务的回复/);
      assert.match(promptState.alicePrompts[0], /原始委派请求：请 @@Bob 给出结果/);
      assert.match(promptState.alicePrompts[0], /Bob 的回复：Bob 已给出待复核结果/);
    } finally {
      await fixture.cleanup();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

test('中断后仅存于 invocationTasks 的 timeout caller review 任务仍可恢复', { skip: !isRedisSessionStateAvailable() }, async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'agent-co-timeout-review-resume-'));
  createReviewLoopClaudeScript(tempDir, 'accept');
  const now = Date.now();
  const legacyState = {
    version: 1,
    userChatSessions: {
      'user:admin': [{
        id: 'resume-timeout-review-session',
        name: 'resume timeout review session',
        history: [{
          id: 'm-user',
          role: 'user',
          sender: '用户',
          text: '@Alice 发起超时复核',
          timestamp: now - 5000
        }, {
          id: 'm-alice',
          role: 'assistant',
          sender: 'Alice',
          text: '请 @@Bob 给出结果',
          timestamp: now - 4500,
          taskId: 'task-timeout-review',
          callerAgentName: 'Alice',
          calleeAgentName: 'Bob'
        }],
        currentAgent: 'Alice',
        enabledAgents: ['Alice', 'Bob'],
        agentWorkdirs: {},
        pendingAgentTasks: [{
          agentName: 'Alice',
          prompt: '过期的 caller review prompt，应由 invocationTasks 重建',
          includeHistory: true,
          dispatchKind: 'internal_review',
          taskId: 'task-timeout-review',
          callerAgentName: 'Alice',
          calleeAgentName: 'Bob',
          reviewMode: 'caller_review',
          deadlineAt: now + 60 * 1000
        }],
        pendingVisibleMessages: [],
        invocationTasks: [{
          id: 'task-timeout-review',
          sessionId: 'resume-timeout-review-session',
          status: 'awaiting_caller_review',
          callerAgentName: 'Alice',
          calleeAgentName: 'Bob',
          prompt: '请 @@Bob 给出结果',
          originalPrompt: '请 @@Bob 给出结果',
          createdAt: now - 4500,
          updatedAt: now - 4200,
          deadlineAt: now + 60 * 1000,
          retryCount: 0,
          followupCount: 0,
          timedOutAt: now - 4100
        }],
        discussionMode: 'classic',
        discussionState: 'active',
        createdAt: now - 6000,
        updatedAt: now - 3000
      }]
    },
    userActiveChatSession: {
      'user:admin': 'resume-timeout-review-session'
    }
  };

  await withIsolatedChatSessionState(legacyState, async () => {
    const fixture = await createChatServerFixture({
      env: {
        PATH: `${tempDir}:${process.env.PATH || ''}`,
        AGENT_CO_DISABLE_REDIS: 'false',
        AGENT_CO_REDIS_REQUIRED: 'false'
      }
    });

    try {
      const loginResponse = await fixture.login();
      assert.equal(loginResponse.status, 200);

      const resumeResponse = await fixture.request('/api/chat-resume', {
        method: 'POST'
      });
      assert.equal(resumeResponse.status, 200);
      assert.equal(resumeResponse.body.success, true);
      assert.equal(resumeResponse.body.resumed, true);
      assert.deepEqual(
        resumeResponse.body.aiMessages.map(item => [item.sender, item.messageSubtype || null, item.reviewAction || null, item.text]),
        [
          ['Alice', 'invocation_review', 'accept', 'Alice 对 Bob 的调用复核：接受。Bob 已给出可执行结果。']
        ]
      );

      const historyResponse = await fixture.request('/api/history');
      assert.equal(historyResponse.status, 200);
      assert.equal(Array.isArray(historyResponse.body.session.pendingAgentTasks), false);
      const task = historyResponse.body.session.invocationTasks.find(item => item.id === 'task-timeout-review');
      assert.ok(task);
      assert.equal(task.status, 'completed');
      assert.equal(task.reviewAction, 'accept');
      assert.equal(typeof task.timedOutAt, 'number');

      const promptState = JSON.parse(readFileSync(path.join(tempDir, 'review-loop-state.json'), 'utf8'));
      assert.equal(promptState.alicePrompts.length, 1);
      assert.match(promptState.alicePrompts[0], /Bob 未在截止时间前回复/);
      assert.match(promptState.alicePrompts[0], /原始委派请求：请 @@Bob 给出结果/);
    } finally {
      await fixture.cleanup();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

test('中断后 stale pending_reply caller review payload 会按 invocationTasks 纠正后再恢复', { skip: !isRedisSessionStateAvailable() }, async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'agent-co-pending-reply-correction-'));
  createPendingReplyCorrectionClaudeScript(tempDir);
  const now = Date.now();
  const legacyState = {
    version: 1,
    userChatSessions: {
      'user:admin': [{
        id: 'resume-pending-reply-correction-session',
        name: 'resume pending reply correction session',
        history: [{
          id: 'm-user',
          role: 'user',
          sender: '用户',
          text: '@Alice 发起追问',
          timestamp: now - 5000
        }, {
          id: 'm-alice',
          role: 'assistant',
          sender: 'Alice',
          text: '请 @@Bob 回答纠正后的问题',
          timestamp: now - 4500,
          taskId: 'task-pending-reply-correction',
          callerAgentName: 'Alice',
          calleeAgentName: 'Bob'
        }],
        currentAgent: 'Alice',
        enabledAgents: ['Alice', 'Bob'],
        agentWorkdirs: {},
        pendingAgentTasks: [{
          agentName: 'Alice',
          prompt: 'stale internal review payload',
          includeHistory: true,
          dispatchKind: 'internal_review',
          taskId: 'task-pending-reply-correction',
          callerAgentName: 'Alice',
          calleeAgentName: 'Bob',
          reviewMode: 'caller_review',
          deadlineAt: now + 60 * 1000
        }],
        pendingVisibleMessages: [],
        invocationTasks: [{
          id: 'task-pending-reply-correction',
          sessionId: 'resume-pending-reply-correction-session',
          status: 'pending_reply',
          callerAgentName: 'Alice',
          calleeAgentName: 'Bob',
          prompt: 'canonical pending prompt',
          originalPrompt: '请 @@Bob 回答纠正后的问题',
          createdAt: now - 4500,
          updatedAt: now - 4200,
          deadlineAt: now + 60 * 1000,
          retryCount: 0,
          followupCount: 1
        }],
        discussionMode: 'classic',
        discussionState: 'active',
        createdAt: now - 6000,
        updatedAt: now - 3000
      }]
    },
    userActiveChatSession: {
      'user:admin': 'resume-pending-reply-correction-session'
    }
  };

  await withIsolatedChatSessionState(legacyState, async () => {
    const fixture = await createChatServerFixture({
      env: {
        PATH: `${tempDir}:${process.env.PATH || ''}`,
        AGENT_CO_DISABLE_REDIS: 'false',
        AGENT_CO_REDIS_REQUIRED: 'false'
      }
    });

    try {
      const loginResponse = await fixture.login();
      assert.equal(loginResponse.status, 200);

      const resumeResponse = await fixture.request('/api/chat-resume', {
        method: 'POST'
      });
      assert.equal(resumeResponse.status, 200);
      assert.equal(resumeResponse.body.success, true);
      assert.equal(resumeResponse.body.resumed, true);
      assert.equal(resumeResponse.body.aiMessages.length, 2);
      assert.equal(resumeResponse.body.aiMessages[0].sender, 'Bob');
      assert.match(resumeResponse.body.aiMessages[0].text, /canonical pending prompt/);
      assert.equal(resumeResponse.body.aiMessages[1].sender, 'Alice');
      assert.equal(resumeResponse.body.aiMessages[1].messageSubtype, 'invocation_review');
      assert.equal(resumeResponse.body.aiMessages[1].reviewAction, 'accept');

      const historyResponse = await fixture.request('/api/history');
      assert.equal(historyResponse.status, 200);
      assert.equal(Array.isArray(historyResponse.body.session.pendingAgentTasks), false);
      const task = historyResponse.body.session.invocationTasks.find(item => item.id === 'task-pending-reply-correction');
      assert.ok(task);
      assert.equal(task.status, 'completed');
      assert.equal(task.reviewAction, 'accept');

      const state = JSON.parse(readFileSync(path.join(tempDir, 'pending-reply-correction-state.json'), 'utf8'));
      assert.equal(state.prompts.Bob.length, 1);
      assert.match(state.prompts.Bob[0], /canonical pending prompt/);
      assert.equal(Array.isArray(state.prompts.Alice), true);
      assert.equal(state.prompts.Alice.some(item => item.includes('stale internal review payload')), false);
    } finally {
      await fixture.cleanup();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

test('中断后若 pending_reply 已有缓冲可见回复，则 resume 不会重复执行被调用者', { skip: !isRedisSessionStateAvailable() }, async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'agent-co-buffered-reply-no-rerun-'));
  createPendingReplyCorrectionClaudeScript(tempDir);
  const now = Date.now();
  const legacyState = {
    version: 1,
    userChatSessions: {
      'user:admin': [{
        id: 'resume-buffered-reply-session',
        name: 'resume buffered reply session',
        history: [{
          id: 'm-user',
          role: 'user',
          sender: '用户',
          text: '@Alice 发起追问',
          timestamp: now - 5000
        }, {
          id: 'm-alice',
          role: 'assistant',
          sender: 'Alice',
          text: '请 @@Bob 回答缓冲中的问题',
          timestamp: now - 4500,
          taskId: 'task-buffered-reply',
          callerAgentName: 'Alice',
          calleeAgentName: 'Bob'
        }],
        currentAgent: 'Alice',
        enabledAgents: ['Alice', 'Bob'],
        agentWorkdirs: {},
        pendingAgentTasks: [{
          agentName: 'Bob',
          prompt: 'stale rerun payload',
          includeHistory: true,
          dispatchKind: 'explicit_chained',
          taskId: 'task-buffered-reply',
          callerAgentName: 'Alice',
          calleeAgentName: 'Bob',
          reviewMode: 'caller_review',
          deadlineAt: now + 60 * 1000
        }],
        pendingVisibleMessages: [{
          id: 'm-bob-buffered',
          role: 'assistant',
          sender: 'Bob',
          text: 'buffered visible reply',
          timestamp: now - 4200,
          taskId: 'task-buffered-reply',
          callerAgentName: 'Alice',
          calleeAgentName: 'Bob'
        }],
        invocationTasks: [{
          id: 'task-buffered-reply',
          sessionId: 'resume-buffered-reply-session',
          status: 'pending_reply',
          callerAgentName: 'Alice',
          calleeAgentName: 'Bob',
          prompt: 'canonical buffered prompt',
          originalPrompt: '请 @@Bob 回答缓冲中的问题',
          createdAt: now - 4500,
          updatedAt: now - 4200,
          deadlineAt: now + 60 * 1000,
          retryCount: 0,
          followupCount: 1
        }],
        discussionMode: 'classic',
        discussionState: 'active',
        createdAt: now - 6000,
        updatedAt: now - 3000
      }]
    },
    userActiveChatSession: {
      'user:admin': 'resume-buffered-reply-session'
    }
  };

  await withIsolatedChatSessionState(legacyState, async () => {
    const fixture = await createChatServerFixture({
      env: {
        PATH: `${tempDir}:${process.env.PATH || ''}`,
        AGENT_CO_DISABLE_REDIS: 'false',
        AGENT_CO_REDIS_REQUIRED: 'false'
      }
    });

    try {
      const loginResponse = await fixture.login();
      assert.equal(loginResponse.status, 200);

      const resumeResponse = await fixture.request('/api/chat-resume', {
        method: 'POST'
      });
      assert.equal(resumeResponse.status, 200);
      assert.equal(resumeResponse.body.success, true);
      assert.equal(resumeResponse.body.resumed, true);
      assert.deepEqual(
        resumeResponse.body.aiMessages.map(item => [item.sender, item.messageSubtype || null, item.reviewAction || null, item.text]),
        [
          ['Bob', null, null, 'buffered visible reply'],
          ['Alice', 'invocation_review', 'accept', 'Alice 对 Bob 的调用复核：接受。Bob 已按纠正后的 prompt 回复。']
        ]
      );

      const historyResponse = await fixture.request('/api/history');
      assert.equal(historyResponse.status, 200);
      assert.equal(Array.isArray(historyResponse.body.session.pendingAgentTasks), false);
      assert.equal(
        historyResponse.body.messages.filter(item => item.sender === 'Bob' && item.taskId === 'task-buffered-reply').length,
        0
      );
      const task = historyResponse.body.session.invocationTasks.find(item => item.id === 'task-buffered-reply');
      assert.ok(task);
      assert.equal(task.status, 'completed');
      assert.equal(task.reviewAction, 'accept');
      assert.equal(task.lastReplyMessageId, 'm-bob-buffered');

      const state = JSON.parse(readFileSync(path.join(tempDir, 'pending-reply-correction-state.json'), 'utf8'));
      assert.equal(state.prompts.Bob, undefined);
      assert.equal(state.prompts.Alice.length, 1);
      assert.match(state.prompts.Alice[0], /buffered visible reply/);
    } finally {
      await fixture.cleanup();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

test('pendingAgentTasks 的调用复核元数据可持久化恢复', { skip: !isRedisSessionStateAvailable() }, async () => {
  const now = Date.now();
  const legacyState = {
    version: 1,
    userChatSessions: {
      'user:admin': [{
        id: 'pending-task-metadata-session',
        name: 'pending task metadata session',
        history: [{
          id: 'seed-user',
          role: 'user',
          sender: '用户',
          text: '@Alice 发起链式调用',
          timestamp: now - 2000
        }],
        currentAgent: 'Alice',
        enabledAgents: ['Alice', 'Bob'],
        agentWorkdirs: {},
        discussionMode: 'peer',
        discussionState: 'active',
        pendingAgentTasks: [{
          agentName: 'Bob',
          prompt: '@@Bob 请继续补充结论',
          includeHistory: true,
          dispatchKind: 'explicit_chained',
          taskId: 'task-persist-1',
          callerAgentName: 'Alice',
          reviewMode: 'caller_review',
          deadlineAt: now + 60 * 1000
        }],
        pendingVisibleMessages: [],
        invocationTasks: [{
          id: 'task-persist-1',
          sessionId: 'pending-task-metadata-session',
          status: 'pending_reply',
          callerAgentName: 'Alice',
          calleeAgentName: 'Bob',
          prompt: '@@Bob 请继续补充结论',
          createdAt: now - 1500,
          updatedAt: now - 800,
          deadlineAt: now + 60 * 1000,
          retryCount: 0,
          followupCount: 0
        }],
        createdAt: now - 4000,
        updatedAt: now - 500
      }]
    },
    userActiveChatSession: {
      'user:admin': 'pending-task-metadata-session'
    }
  };

  await withIsolatedChatSessionState(legacyState, async () => {
    const fixture = await createChatServerFixture({
      env: {
        AGENT_CO_DISABLE_REDIS: 'false',
        AGENT_CO_REDIS_REQUIRED: 'false'
      }
    });

    try {
      const loginResponse = await fixture.login();
      assert.equal(loginResponse.status, 200);

      const historyResponse = await fixture.request('/api/history');
      assert.equal(historyResponse.status, 200);
      assert.equal(Array.isArray(historyResponse.body.session.pendingAgentTasks), true);
      assert.equal(historyResponse.body.session.pendingAgentTasks.length, 1);
      const [pendingTask] = historyResponse.body.session.pendingAgentTasks;
      assert.equal(pendingTask.agentName, 'Bob');
      assert.equal(pendingTask.taskId, 'task-persist-1');
      assert.equal(pendingTask.callerAgentName, 'Alice');
      assert.equal(pendingTask.reviewMode, 'caller_review');
      assert.equal(typeof pendingTask.deadlineAt, 'number');
      assert.equal(Number.isFinite(pendingTask.deadlineAt), true);
    } finally {
      await fixture.cleanup();
    }
  });
});

test('登录迁移不会用访客默认 discussion 字段覆盖已有用户会话', { skip: !isRedisSessionStateAvailable() }, async () => {
  const visitorId = '0123456789abcdef0123456789abcdef';
  const legacyState = {
    version: 1,
    userChatSessions: {
      [`visitor:${visitorId}`]: [{
        id: 'default',
        name: '默认会话',
        history: [],
        currentAgent: null,
        enabledAgents: [],
        agentWorkdirs: {},
        discussionMode: 'classic',
        discussionState: 'active',
        createdAt: Date.now() - 2000,
        updatedAt: Date.now() - 2000
      }],
      'user:admin': [{
        id: 'default',
        name: '默认会话',
        history: [],
        currentAgent: null,
        enabledAgents: [],
        agentWorkdirs: {},
        discussionMode: 'peer',
        discussionState: 'paused',
        createdAt: Date.now() - 1000,
        updatedAt: Date.now() - 1000
      }]
    },
    userActiveChatSession: {
      [`visitor:${visitorId}`]: 'default',
      'user:admin': 'default'
    }
  };

  await withIsolatedChatSessionState(legacyState, async () => {
    const fixture = await createChatServerFixture({
      env: {
        AGENT_CO_DISABLE_REDIS: 'false',
        AGENT_CO_REDIS_REQUIRED: 'false'
      }
    });

    try {
      const loginResponse = await fixture.request('/api/login', {
        method: 'POST',
        headers: {
          Cookie: `agent_co_visitor=${visitorId}`
        },
        body: { username: 'admin', password: 'Admin1234!@#' }
      });
      assert.equal(loginResponse.status, 200);

      const secondLoginResponse = await fixture.request('/api/login', {
        method: 'POST',
        headers: {
          Cookie: `agent_co_visitor=${visitorId}`
        },
        body: { username: 'admin', password: 'Admin1234!@#' }
      });
      assert.equal(secondLoginResponse.status, 200);

      const historyResponse = await fixture.request('/api/history');
      assert.equal(historyResponse.status, 200);
      assert.equal(historyResponse.body.session.discussionMode, 'peer');
      assert.equal(historyResponse.body.session.discussionState, 'paused');

      const summary = historyResponse.body.chatSessions.find((session) => session.id === 'default');
      assert.ok(summary);
      assert.equal(summary.discussionMode, 'peer');
      assert.equal(summary.discussionState, 'paused');
    } finally {
      await fixture.cleanup();
    }
  });
});

test('退出登录迁移不会让较旧的访客 discussion 字段覆盖较新的已登录会话', { skip: !isRedisSessionStateAvailable() }, async () => {
  const visitorId = 'fedcba9876543210fedcba9876543210';
  const legacyState = {
    version: 1,
    userChatSessions: {
      [`visitor:${visitorId}`]: [{
        id: 'default',
        name: '默认会话',
        history: [],
        currentAgent: null,
        enabledAgents: [],
        agentWorkdirs: {},
        discussionMode: 'classic',
        discussionState: 'active',
        createdAt: Date.now() - 2000,
        updatedAt: Date.now() - 2000
      }],
      'user:admin': [{
        id: 'default',
        name: '默认会话',
        history: [],
        currentAgent: null,
        enabledAgents: [],
        agentWorkdirs: {},
        discussionMode: 'peer',
        discussionState: 'paused',
        createdAt: Date.now() - 1000,
        updatedAt: Date.now() - 500
      }]
    },
    userActiveChatSession: {
      [`visitor:${visitorId}`]: 'default',
      'user:admin': 'default'
    }
  };

  await withIsolatedChatSessionState(legacyState, async () => {
    const fixture = await createChatServerFixture({
      env: {
        AGENT_CO_DISABLE_REDIS: 'false',
        AGENT_CO_REDIS_REQUIRED: 'false'
      }
    });

    try {
      const firstLoginResponse = await fetch(`http://127.0.0.1:${fixture.port}/api/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent_co_visitor=${visitorId}`
        },
        body: JSON.stringify({ username: 'admin', password: 'Admin1234!@#' })
      });
      assert.equal(firstLoginResponse.status, 200);
      const firstSessionCookie = parseSetCookiePair(firstLoginResponse.headers.get('set-cookie'));

      const logoutResponse = await fetch(`http://127.0.0.1:${fixture.port}/api/logout`, {
        method: 'POST',
        headers: {
          Cookie: `${firstSessionCookie}; agent_co_visitor=${visitorId}`
        }
      });
      assert.equal(logoutResponse.status, 200);

      const secondLoginResponse = await fetch(`http://127.0.0.1:${fixture.port}/api/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent_co_visitor=${visitorId}`
        },
        body: JSON.stringify({ username: 'admin', password: 'Admin1234!@#' })
      });
      assert.equal(secondLoginResponse.status, 200);
      const secondSessionCookie = parseSetCookiePair(secondLoginResponse.headers.get('set-cookie'));

      const historyResponse = await fetch(`http://127.0.0.1:${fixture.port}/api/history`, {
        headers: {
          Cookie: `${secondSessionCookie}; agent_co_visitor=${visitorId}`
        }
      });
      assert.equal(historyResponse.status, 200);
      const historyBody = await historyResponse.json();
      assert.equal(historyBody.session.discussionMode, 'peer');
      assert.equal(historyBody.session.discussionState, 'paused');

      const summary = historyBody.chatSessions.find((session) => session.id === 'default');
      assert.ok(summary);
      assert.equal(summary.discussionMode, 'peer');
      assert.equal(summary.discussionState, 'paused');
    } finally {
      await fixture.cleanup();
    }
  });
});

test('POST /api/sessions/update 支持更新单个或两个链路字段，并将超限值钳制到 1000', async () => {
  const fixture = await createChatServerFixture();

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'chain settings patch' }
    });
    assert.equal(createResponse.status, 200);
    const sessionId = createResponse.body.session.id;

    const updateHopsOnly = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId,
        patch: { agentChainMaxHops: 12 }
      }
    });
    assert.equal(updateHopsOnly.status, 200);
    assert.equal(updateHopsOnly.body.session.agentChainMaxHops, 12);
    assert.equal(updateHopsOnly.body.session.agentChainMaxCallsPerAgent, null);

    const updateBoth = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId,
        patch: {
          agentChainMaxHops: 2001,
          agentChainMaxCallsPerAgent: 3000
        }
      }
    });
    assert.equal(updateBoth.status, 200);
    assert.equal(updateBoth.body.session.agentChainMaxHops, 1000);
    assert.equal(updateBoth.body.session.agentChainMaxCallsPerAgent, 1000);
  } finally {
    await fixture.cleanup();
  }
});

test('POST /api/sessions/update 支持仅更新 agentChainMaxCallsPerAgent 而不修改 agentChainMaxHops', async () => {
  const fixture = await createChatServerFixture();

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'calls-only patch' }
    });
    assert.equal(createResponse.status, 200);
    const sessionId = createResponse.body.session.id;
    const originalHops = createResponse.body.session.agentChainMaxHops;

    const updateCallsOnly = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId,
        patch: { agentChainMaxCallsPerAgent: 3 }
      }
    });
    assert.equal(updateCallsOnly.status, 200);
    assert.equal(updateCallsOnly.body.session.agentChainMaxCallsPerAgent, 3);
    assert.equal(updateCallsOnly.body.session.agentChainMaxHops, originalHops);
  } finally {
    await fixture.cleanup();
  }
});

test('POST /api/sessions/update 会拒绝无效的链路设置', async () => {
  const fixture = await createChatServerFixture();

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'invalid chain settings' }
    });
    assert.equal(createResponse.status, 200);
    const sessionId = createResponse.body.session.id;

    const invalidHops = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId,
        patch: { agentChainMaxHops: 0 }
      }
    });
    assert.equal(invalidHops.status, 400);

    const invalidCalls = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId,
        patch: { agentChainMaxCallsPerAgent: 0 }
      }
    });
    assert.equal(invalidCalls.status, 400);

    const emptyPatch = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId,
        patch: {}
      }
    });
    assert.equal(emptyPatch.status, 400);
  } finally {
    await fixture.cleanup();
  }
});

test('POST /api/sessions/update 会拒绝不支持的 patch 字段', async () => {
  const fixture = await createChatServerFixture();

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'unsupported patch field' }
    });
    assert.equal(createResponse.status, 200);
    const sessionId = createResponse.body.session.id;

    const response = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId,
        patch: { unsupportedField: 1 }
      }
    });
    assert.equal(response.status, 400);
  } finally {
    await fixture.cleanup();
  }
});

test('POST /api/sessions/update 会在 sessionId 不存在时返回 400', async () => {
  const fixture = await createChatServerFixture();

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

    const response = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId: 'missing-session-id',
        patch: { agentChainMaxHops: 2 }
      }
    });
    assert.equal(response.status, 400);
  } finally {
    await fixture.cleanup();
  }
});

test('POST /api/sessions/update 会拒绝空字符串、负数、小数和非数字输入', async () => {
  const fixture = await createChatServerFixture();

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

    const createResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'invalid value variants' }
    });
    assert.equal(createResponse.status, 200);
    const sessionId = createResponse.body.session.id;

    const invalidCases = [
      { patch: { agentChainMaxHops: '' } },
      { patch: { agentChainMaxHops: -1 } },
      { patch: { agentChainMaxHops: 1.5 } },
      { patch: { agentChainMaxHops: 'abc' } },
      { patch: { agentChainMaxCallsPerAgent: '' } },
      { patch: { agentChainMaxCallsPerAgent: -2 } },
      { patch: { agentChainMaxCallsPerAgent: 2.5 } },
      { patch: { agentChainMaxCallsPerAgent: 'xyz' } }
    ];

    for (const body of invalidCases) {
      const response = await fixture.request('/api/sessions/update', {
        method: 'POST',
        body: {
          sessionId,
          ...body
        }
      });
      assert.equal(response.status, 400);
    }
  } finally {
    await fixture.cleanup();
  }
});

test('切换会话后，链路设置在各会话之间保持隔离', async () => {
  const fixture = await createChatServerFixture();

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

    const sessionAResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'session A' }
    });
    assert.equal(sessionAResponse.status, 200);
    const sessionAId = sessionAResponse.body.session.id;

    const sessionBResponse = await fixture.request('/api/sessions', {
      method: 'POST',
      body: { name: 'session B' }
    });
    assert.equal(sessionBResponse.status, 200);
    const sessionBId = sessionBResponse.body.session.id;

    const updateA = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId: sessionAId,
        patch: {
          agentChainMaxHops: 7,
          agentChainMaxCallsPerAgent: null
        }
      }
    });
    assert.equal(updateA.status, 200);

    const updateB = await fixture.request('/api/sessions/update', {
      method: 'POST',
      body: {
        sessionId: sessionBId,
        patch: {
          agentChainMaxHops: 3,
          agentChainMaxCallsPerAgent: 2
        }
      }
    });
    assert.equal(updateB.status, 200);

    const selectA = await fixture.request('/api/sessions/select', {
      method: 'POST',
      body: { sessionId: sessionAId }
    });
    assert.equal(selectA.status, 200);

    const historyA = await fixture.request('/api/history');
    assert.equal(historyA.status, 200);
    assert.equal(historyA.body.activeSessionId, sessionAId);
    assert.equal(historyA.body.chatSessions.find((session) => session.id === sessionAId).agentChainMaxHops, 7);
    assert.equal(historyA.body.chatSessions.find((session) => session.id === sessionBId).agentChainMaxCallsPerAgent, 2);

    const selectB = await fixture.request('/api/sessions/select', {
      method: 'POST',
      body: { sessionId: sessionBId }
    });
    assert.equal(selectB.status, 200);

    const historyB = await fixture.request('/api/history');
    assert.equal(historyB.status, 200);
    assert.equal(historyB.body.activeSessionId, sessionBId);
    assert.equal(historyB.body.chatSessions.find((session) => session.id === sessionAId).agentChainMaxCallsPerAgent, null);
    assert.equal(historyB.body.chatSessions.find((session) => session.id === sessionBId).agentChainMaxHops, 3);
  } finally {
    await fixture.cleanup();
  }
});
