const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const distDir = path.join(repoRoot, 'dist');

function requireBuiltModule(...segments) {
  const modulePath = path.join(distDir, ...segments);
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

test('provider registry and capabilities expose a narrow public seam', () => {
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
});

test('provider registry supports registration, lookup, and duplicate-registration protection', () => {
  const {
    CLI_PROVIDER_CAPABILITY,
    OPENAI_COMPATIBLE_API_PROVIDER_CAPABILITY,
    resolveApiProviderCapability
  } = requireBuiltModule('agent-invocation', 'provider-capabilities.js');
  const {
    createInvocationProviderRegistry,
    createApiProviderRegistry,
    resolveInvocationProvider,
    resolveApiProvider
  } = requireBuiltModule('agent-invocation', 'provider-registry.js');

  const cliProvider = resolveInvocationProvider(CLI_PROVIDER_CAPABILITY);
  const apiProvider = resolveApiProvider(OPENAI_COMPATIBLE_API_PROVIDER_CAPABILITY);
  assert.equal(typeof cliProvider, 'function');
  assert.equal(typeof apiProvider, 'function');
  assert.equal(resolveApiProviderCapability({ executionMode: 'api' }), OPENAI_COMPATIBLE_API_PROVIDER_CAPABILITY);

  const invocationRegistry = createInvocationProviderRegistry();
  const apiRegistry = createApiProviderRegistry();
  const invocationHandler = async () => ({ text: 'ok' });
  const apiHandler = async () => ({ text: 'ok' });

  invocationRegistry.register(CLI_PROVIDER_CAPABILITY, invocationHandler);
  apiRegistry.register(OPENAI_COMPATIBLE_API_PROVIDER_CAPABILITY, apiHandler);

  assert.equal(invocationRegistry.resolve(CLI_PROVIDER_CAPABILITY), invocationHandler);
  assert.equal(apiRegistry.resolve(OPENAI_COMPATIBLE_API_PROVIDER_CAPABILITY), apiHandler);
  assert.throws(
    () => invocationRegistry.register(CLI_PROVIDER_CAPABILITY, invocationHandler),
    /invocation provider 已存在/
  );
  assert.throws(
    () => apiRegistry.register(OPENAI_COMPATIBLE_API_PROVIDER_CAPABILITY, apiHandler),
    /API provider 已存在/
  );
});
