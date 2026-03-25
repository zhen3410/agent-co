const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatServerFixture } = require('./helpers/chat-server-fixture');
const { withIsolatedChatSessionState, isRedisSessionStateAvailable } = require('./helpers/redis-session-state-fixture');

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
        BOT_ROOM_DISABLE_REDIS: 'false',
        BOT_ROOM_REDIS_REQUIRED: 'false'
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
