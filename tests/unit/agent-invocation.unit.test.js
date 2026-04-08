const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');

const repoRoot = path.resolve(__dirname, '..', '..');
const distDir = path.join(repoRoot, 'dist');

function requireBuiltModule(...segments) {
  const modulePath = path.join(distDir, ...segments);
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

test('agent invocation low-level modules expose a stable export surface', () => {
  assert.deepEqual(
    Object.keys(requireBuiltModule('agent-invocation', 'invoke-target.js')).sort(),
    ['normalizeCliName', 'normalizeInvokeTarget']
  );
  assert.deepEqual(
    Object.keys(requireBuiltModule('agent-invocation', 'provider-capabilities.js')).sort(),
    [
      'API_PROVIDER_CAPABILITY',
      'CLI_PROVIDER_CAPABILITY',
      'OPENAI_COMPATIBLE_API_PROVIDER_CAPABILITY',
      'isApiProviderCapability',
      'resolveApiProviderCapability'
    ]
  );
  assert.deepEqual(
    Object.keys(requireBuiltModule('agent-invocation', 'provider-registry.js')).sort(),
    ['createApiProviderRegistry', 'createInvocationProviderRegistry', 'resolveApiProvider', 'resolveInvocationProvider']
  );
  assert.deepEqual(
    Object.keys(requireBuiltModule('agent-invocation', 'model-connection-loader.js')).sort(),
    ['loadApiAgentConnection', 'resolveModelConnectionDataFile']
  );
  assert.deepEqual(
    Object.keys(requireBuiltModule('agent-invocation', 'invoke-cli-agent.js')).sort(),
    ['buildCliInvokeParams', 'invokeCliAgent']
  );
});

test('invoke target normalization keeps api mode and prefers cliName over legacy cli', () => {
  const { normalizeCliName, normalizeInvokeTarget } = requireBuiltModule('agent-invocation', 'invoke-target.js');

  assert.equal(normalizeCliName({ cliName: 'codex', cli: 'claude' }), 'codex');
  assert.deepEqual(
    normalizeInvokeTarget({
      name: 'API Agent',
      avatar: '🤖',
      systemPrompt: 'system',
      color: '#fff',
      executionMode: 'api',
      cliName: 'codex'
    }),
    { executionMode: 'api' }
  );
  assert.deepEqual(
    normalizeInvokeTarget({
      name: 'CLI Agent',
      avatar: '🤖',
      systemPrompt: 'system',
      color: '#fff',
      executionMode: 'cli',
      cliName: 'codex',
      cli: 'claude'
    }),
    { executionMode: 'cli', cliName: 'codex' }
  );
});

test('invoke target normalization defaults unknown cli configuration to claude', () => {
  const { normalizeCliName, normalizeInvokeTarget } = requireBuiltModule('agent-invocation', 'invoke-target.js');

  assert.equal(normalizeCliName({ cliName: 'other', cli: 'nope' }), undefined);
  assert.deepEqual(
    normalizeInvokeTarget({
      name: 'CLI Agent',
      avatar: '🤖',
      systemPrompt: 'system',
      color: '#fff'
    }),
    { executionMode: 'cli', cliName: 'claude' }
  );
});

test('CLI invocation params follow the shared normalized target instead of recomputing routing', () => {
  const { buildCliInvokeParams } = requireBuiltModule('agent-invocation', 'invoke-cli-agent.js');

  assert.deepEqual(
    buildCliInvokeParams(
      {
        userMessage: 'hi',
        agent: {
          name: 'CLI Agent',
          avatar: '🤖',
          systemPrompt: 'system',
          color: '#fff',
          executionMode: 'cli',
          cliName: 'claude',
          cli: 'claude'
        },
        history: [],
        includeHistory: true
      },
      {
        executionMode: 'cli',
        cliName: 'codex'
      }
    ).agent,
    {
      name: 'CLI Agent',
      avatar: '🤖',
      systemPrompt: 'system',
      color: '#fff',
      executionMode: 'cli',
      cliName: 'codex',
      cli: 'codex'
    }
  );
});

test('model connection file resolution honors explicit file and agent-data sibling defaults', () => {
  const { resolveModelConnectionDataFile } = requireBuiltModule('agent-invocation', 'model-connection-loader.js');

  assert.equal(
    resolveModelConnectionDataFile({
      cwd: '/workspace/chat',
      modelConnectionDataFile: '/tmp/custom-connections.json',
      agentDataFile: '/tmp/ignored-agents.json'
    }),
    '/tmp/custom-connections.json'
  );

  assert.equal(
    resolveModelConnectionDataFile({
      cwd: '/workspace/chat',
      agentDataFile: '/workspace/chat/runtime/agents.json'
    }),
    '/workspace/chat/runtime/api-connections.json'
  );

  assert.equal(
    resolveModelConnectionDataFile({ cwd: '/workspace/chat' }),
    '/workspace/chat/data/api-connections.json'
  );
});

test('API connection loading reports stable lookup failures', () => {
  const { loadApiAgentConnection } = requireBuiltModule('agent-invocation', 'model-connection-loader.js');
  const tempDir = mkdtempSync(path.join(tmpdir(), 'agent-co-agent-invocation-unit-'));
  const connectionFile = path.join(tempDir, 'api-connections.json');

  try {
    writeFileSync(connectionFile, JSON.stringify({
      apiConnections: [
        {
          id: 'disabled-conn',
          name: 'Disabled',
          baseURL: 'https://api.example.com/v1',
          apiKey: 'secret',
          enabled: false,
          createdAt: 1,
          updatedAt: 1
        }
      ],
      updatedAt: 1
    }, null, 2), 'utf8');

    assert.throws(
      () => loadApiAgentConnection({
        name: 'Alice',
        avatar: '🤖',
        systemPrompt: '你是 Alice',
        color: '#fff',
        executionMode: 'api',
        apiModel: 'gpt-4.1'
      }, {
        modelConnectionDataFile: connectionFile
      }),
      /Agent Alice 缺少 apiConnectionId 配置/
    );

    assert.throws(
      () => loadApiAgentConnection({
        name: 'Alice',
        avatar: '🤖',
        systemPrompt: '你是 Alice',
        color: '#fff',
        executionMode: 'api',
        apiConnectionId: 'missing-conn',
        apiModel: 'gpt-4.1'
      }, {
        modelConnectionDataFile: connectionFile
      }),
      /找不到 API 连接配置：missing-conn/
    );

    assert.throws(
      () => loadApiAgentConnection({
        name: 'Alice',
        avatar: '🤖',
        systemPrompt: '你是 Alice',
        color: '#fff',
        executionMode: 'api',
        apiConnectionId: 'disabled-conn',
        apiModel: 'gpt-4.1'
      }, {
        modelConnectionDataFile: connectionFile
      }),
      /API 连接已停用：disabled-conn/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
