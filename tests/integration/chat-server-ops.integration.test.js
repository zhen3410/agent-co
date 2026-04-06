const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createChatServerFixture } = require('./helpers/chat-server-fixture');

function sortedKeys(value) {
  return Object.keys(value).sort();
}

function createVerboseLogFixtureDir() {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-verbose-it-'));
  const verboseDir = join(tempDir, 'verbose-logs');
  mkdirSync(verboseDir, { recursive: true });

  const agentName = 'Codex架构师';
  const encodedAgentName = encodeURIComponent(agentName);
  const fileName = `2026-03-19T10-00-00-000Z-codex-${encodedAgentName}.log`;
  const fullPath = join(verboseDir, fileName);
  const content = [
    '2026-03-19T10:00:00.000Z [info] 进入中文智能体日志',
    '2026-03-19T10:00:01.000Z [info] 继续输出内容'
  ].join('\n');

  writeFileSync(fullPath, content, 'utf8');

  return {
    tempDir,
    verboseDir,
    fileName,
    agentName,
    content,
    cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

test('依赖状态与日志查询仍返回 JSON 契约并支持过滤', async () => {
  const fixture = await createChatServerFixture();

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

    const statusResponse = await fixture.request('/api/dependencies/status');
    assert.equal(statusResponse.status === 200 || statusResponse.status === 503, true);
    assert.deepEqual(sortedKeys(statusResponse.body), ['checkedAt', 'dependencies', 'healthy', 'logs']);
    assert.equal(typeof statusResponse.body.healthy, 'boolean');
    assert.equal(typeof statusResponse.body.checkedAt, 'number');
    assert.equal(Array.isArray(statusResponse.body.dependencies), true);
    assert.equal(Array.isArray(statusResponse.body.logs), true);
    assert.equal(statusResponse.body.dependencies.some(item => item.name === 'redis'), true);
    assert.equal(
      statusResponse.body.logs.every(item => typeof item.timestamp === 'number' && typeof item.dependency === 'string'),
      true
    );

    const logsResponse = await fixture.request('/api/dependencies/logs?dependency=redis&keyword=redis&level=info');
    assert.equal(logsResponse.status, 200);
    assert.deepEqual(sortedKeys(logsResponse.body), ['logs', 'query', 'total']);
    assert.equal(typeof logsResponse.body.total, 'number');
    assert.equal(logsResponse.body.query.dependency, 'redis');
    assert.equal(logsResponse.body.query.keyword, 'redis');
    assert.equal(logsResponse.body.query.level, 'info');
    assert.equal(Array.isArray(logsResponse.body.logs), true);
    assert.equal(logsResponse.body.logs.length > 0, true);
    assert.equal(logsResponse.body.logs.every(item => item.dependency === 'redis'), true);
  } finally {
    await fixture.cleanup();
  }
});

test('verbose 日志接口支持中文智能体名称并可读取文件内容', async () => {
  const verboseFixture = createVerboseLogFixtureDir();
  const fixture = await createChatServerFixture({
    env: {
      BOT_ROOM_VERBOSE_LOG_DIR: verboseFixture.verboseDir
    }
  });

  try {
    const loginResponse = await fixture.login();
    assert.equal(loginResponse.status, 200);

    const logsResponse = await fixture.request(
      `/api/verbose/logs?agent=${encodeURIComponent(verboseFixture.agentName)}`
    );
    assert.equal(logsResponse.status, 200);
    assert.deepEqual(sortedKeys(logsResponse.body), ['agent', 'logs']);
    assert.equal(logsResponse.body.agent, verboseFixture.agentName);
    assert.equal(Array.isArray(logsResponse.body.logs), true);
    assert.equal(logsResponse.body.logs.length, 1);
    assert.equal(logsResponse.body.logs[0].agent, verboseFixture.agentName);
    assert.equal(logsResponse.body.logs[0].fileName, verboseFixture.fileName);
    assert.equal(logsResponse.body.logs[0].size > 0, true);

    const contentResponse = await fixture.request(
      `/api/verbose/log-content?file=${encodeURIComponent(verboseFixture.fileName)}`
    );
    assert.equal(contentResponse.status, 200);
    assert.deepEqual(sortedKeys(contentResponse.body), ['content', 'fileName']);
    assert.equal(contentResponse.body.fileName, verboseFixture.fileName);
    assert.equal(contentResponse.body.content, verboseFixture.content);
  } finally {
    await fixture.cleanup();
    verboseFixture.cleanup();
  }
});
