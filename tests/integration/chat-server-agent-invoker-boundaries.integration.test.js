const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mkdtempSync, writeFileSync, chmodSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');

const repoRoot = path.resolve(__dirname, '..', '..');
const distDir = path.join(repoRoot, 'dist');

function requireBuiltModule(...segments) {
  const modulePath = path.join(distDir, ...segments);
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

test('compiled façade keeps the stable runtime export surface over the dedicated subsystem', () => {
  const facadeModule = requireBuiltModule('agent-invoker.js');
  const internalModule = requireBuiltModule('agent-invocation', 'agent-invoker.js');

  assert.deepEqual(Object.keys(facadeModule).sort(), ['invokeAgent']);
  assert.deepEqual(Object.keys(internalModule).sort(), ['invokeAgent']);
  assert.equal(typeof facadeModule.invokeAgent, 'function');
  assert.equal(typeof internalModule.invokeAgent, 'function');
});

test('compiled façade and internal invoker keep the same cli-routing behavior', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'bot-room-agent-invoker-boundary-'));
  const fakeClaude = path.join(tempDir, 'claude');
  const fakeCodex = path.join(tempDir, 'codex');
  writeFileSync(fakeClaude, `#!/usr/bin/env bash\nprintf '%s\\n' '{"output_text":"CLAUDE path should not be used"}'\n`, 'utf8');
  writeFileSync(fakeCodex, `#!/usr/bin/env bash\nprintf '%s\\n' '{"output_text":"CODEX provider reply"}'\n`, 'utf8');
  chmodSync(fakeClaude, 0o755);
  chmodSync(fakeCodex, 0o755);

  const facadeModule = requireBuiltModule('agent-invoker.js');
  const internalModule = requireBuiltModule('agent-invocation', 'agent-invoker.js');
  const originalPath = process.env.PATH;
  process.env.PATH = `${tempDir}:${originalPath || ''}`;

  const params = {
    userMessage: '你好',
    agent: {
      name: 'Alice',
      avatar: '🤖',
      systemPrompt: '你是 Alice',
      color: '#fff',
      executionMode: 'cli',
      cliName: 'codex',
      cli: 'claude'
    },
    history: [],
    includeHistory: true
  };

  try {
    assert.equal(typeof facadeModule.invokeAgent, 'function');
    assert.equal(typeof internalModule.invokeAgent, 'function');

    const [facadeResult, internalResult] = await Promise.all([
      facadeModule.invokeAgent(params),
      internalModule.invokeAgent(params)
    ]);

    assert.equal(facadeResult.text, 'CODEX provider reply');
    assert.deepEqual(internalResult, facadeResult);
  } finally {
    process.env.PATH = originalPath;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('compiled façade and internal invoker keep the same api-path failure behavior', async () => {
  const facadeModule = requireBuiltModule('agent-invoker.js');
  const internalModule = requireBuiltModule('agent-invocation', 'agent-invoker.js');
  const tempDir = mkdtempSync(path.join(tmpdir(), 'bot-room-agent-invoker-api-boundary-'));
  const connectionFile = path.join(tempDir, 'api-connections.json');
  writeFileSync(connectionFile, JSON.stringify({ apiConnections: [], updatedAt: 1 }, null, 2), 'utf8');

  const originalConnectionFile = process.env.MODEL_CONNECTION_DATA_FILE;
  process.env.MODEL_CONNECTION_DATA_FILE = connectionFile;

  const params = {
    userMessage: '你好',
    agent: {
      name: 'Alice',
      avatar: '🤖',
      systemPrompt: '你是 Alice',
      color: '#fff',
      executionMode: 'api',
      apiConnectionId: 'missing-conn',
      apiModel: 'gpt-4.1'
    },
    history: [],
    includeHistory: true
  };

  try {
    await assert.rejects(
      () => facadeModule.invokeAgent(params),
      /找不到 API 连接配置：missing-conn/
    );
    await assert.rejects(
      () => internalModule.invokeAgent(params),
      /找不到 API 连接配置：missing-conn/
    );
  } finally {
    process.env.MODEL_CONNECTION_DATA_FILE = originalConnectionFile;
    rmSync(tempDir, { recursive: true, force: true });
  }
});
