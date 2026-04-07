const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createChatServerFixture } = require('./helpers/chat-server-fixture');

function createVerboseLogFixtureDir() {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-error-contracts-'));
  const verboseDir = join(tempDir, 'verbose-logs');
  mkdirSync(verboseDir, { recursive: true });

  const fileName = '2026-03-19T10-00-00-000Z-codex-Agent.log';
  writeFileSync(join(verboseDir, fileName), 'hello', 'utf8');

  return {
    tempDir,
    verboseDir,
    fileName,
    cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

async function createErrorContractsFixture() {
  const verboseFixture = createVerboseLogFixtureDir();
  const fixture = await createChatServerFixture({
    env: {
      BOT_ROOM_VERBOSE_LOG_DIR: verboseFixture.verboseDir
    }
  });

  return {
    fixture,
    async cleanup() {
      await fixture.cleanup();
      verboseFixture.cleanup();
    }
  };
}

test('聊天接口的未授权错误契约保持稳定', async () => {
  const setup = await createErrorContractsFixture();

  try {
    const unauthorizedChat = await setup.fixture.request('/api/chat', {
      method: 'POST',
      body: { message: 'hello' }
    });

    assert.equal(unauthorizedChat.status, 401);
    assert.deepEqual(unauthorizedChat.body, { error: '未授权，请先登录' });
  } finally {
    await setup.cleanup();
  }
});

test('登录接口的验证错误契约保持稳定', async () => {
  const setup = await createErrorContractsFixture();

  try {
    const loginValidation = await setup.fixture.request('/api/login', {
      method: 'POST',
      body: { username: '', password: '' }
    });

    assert.equal(loginValidation.status, 400);
    assert.deepEqual(loginValidation.body, { error: '缺少用户名或密码' });
  } finally {
    await setup.cleanup();
  }
});

test('聊天接口的请求体验证错误契约保持稳定', async () => {
  const setup = await createErrorContractsFixture();

  try {
    const loginResponse = await setup.fixture.login();
    assert.equal(loginResponse.status, 200);

    const chatValidation = await setup.fixture.request('/api/chat', {
      method: 'POST',
      body: { message: '' }
    });

    assert.equal(chatValidation.status, 400);
    assert.deepEqual(chatValidation.body, { error: '缺少 message 字段' });
  } finally {
    await setup.cleanup();
  }
});

test('callback 接口的鉴权与验证错误契约保持稳定', async () => {
  const setup = await createErrorContractsFixture();

  try {
    const callbackUnauthorized = await setup.fixture.request('/api/callbacks/post-message', {
      method: 'POST',
      body: { content: 'hello' }
    });
    assert.equal(callbackUnauthorized.status, 401);
    assert.deepEqual(callbackUnauthorized.body, { error: 'Unauthorized' });

    const loginResponse = await setup.fixture.login();
    assert.equal(loginResponse.status, 200);

    const callbackMissingHeader = await setup.fixture.request('/api/callbacks/post-message', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bot-room-callback-token',
        'x-bot-room-callback-token': 'bot-room-callback-token',
        'x-bot-room-agent': 'Alice'
      },
      body: { content: 'hello' }
    });
    assert.equal(callbackMissingHeader.status, 400);
    assert.deepEqual(callbackMissingHeader.body, { error: '缺少 x-bot-room-session-id 头' });
  } finally {
    await setup.cleanup();
  }
});

test('callback thread-context 的 not-found 错误契约保持稳定', async () => {
  const setup = await createErrorContractsFixture();

  try {
    const loginResponse = await setup.fixture.login();
    assert.equal(loginResponse.status, 200);

    const callbackMissingSession = await setup.fixture.request('/api/callbacks/thread-context?sessionid=missing', {
      headers: {
        Authorization: 'Bearer bot-room-callback-token',
        'x-bot-room-callback-token': 'bot-room-callback-token'
      }
    });

    assert.equal(callbackMissingSession.status, 404);
    assert.deepEqual(callbackMissingSession.body, { error: '会话不存在' });
  } finally {
    await setup.cleanup();
  }
});

test('依赖日志接口的验证错误契约保持稳定', async () => {
  const setup = await createErrorContractsFixture();

  try {
    const loginResponse = await setup.fixture.login();
    assert.equal(loginResponse.status, 200);

    const dependencyRange = await setup.fixture.request('/api/dependencies/logs?startDate=2026-04-08&endDate=2026-04-07');

    assert.equal(dependencyRange.status, 400);
    assert.deepEqual(dependencyRange.body, { error: 'startDate 不能晚于 endDate' });
  } finally {
    await setup.cleanup();
  }
});

test('system dirs 接口保持原有目录不存在契约', async () => {
  const setup = await createErrorContractsFixture();

  try {
    const loginResponse = await setup.fixture.login();
    assert.equal(loginResponse.status, 200);

    const missingDir = await setup.fixture.request('/api/system/dirs?path=/definitely-not-existing-bot-room-dir');

    assert.equal(missingDir.status, 400);
    assert.deepEqual(missingDir.body, { error: '目录不存在' });
  } finally {
    await setup.cleanup();
  }
});

test('verbose log 接口的验证错误契约保持稳定', async () => {
  const setup = await createErrorContractsFixture();

  try {
    const loginResponse = await setup.fixture.login();
    assert.equal(loginResponse.status, 200);

    const verboseInvalidFile = await setup.fixture.request('/api/verbose/log-content?file=../bad.log');

    assert.equal(verboseInvalidFile.status, 400);
    assert.deepEqual(verboseInvalidFile.body, { error: '非法 file 参数' });
  } finally {
    await setup.cleanup();
  }
});

test('verbose log 接口的 not-found 错误契约保持稳定', async () => {
  const setup = await createErrorContractsFixture();

  try {
    const loginResponse = await setup.fixture.login();
    assert.equal(loginResponse.status, 200);

    const verboseMissingFile = await setup.fixture.request('/api/verbose/log-content?file=missing.log');

    assert.equal(verboseMissingFile.status, 404);
    assert.deepEqual(verboseMissingFile.body, { error: '日志文件不存在' });
  } finally {
    await setup.cleanup();
  }
});
