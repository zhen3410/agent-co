const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const distDir = path.join(repoRoot, 'dist');

function requireBuiltRuntimeModule() {
  const modulePath = path.join(distDir, 'chat', 'runtime', 'chat-runtime.js');
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

test('chat-runtime 模块保持稳定且克制的 value export surface', () => {
  const runtimeModule = requireBuiltRuntimeModule();

  assert.deepEqual(
    Object.keys(runtimeModule).sort(),
    ['createChatRuntime', 'normalizePositiveSessionSetting'],
    'chat-runtime 应只暴露稳定的 runtime value exports'
  );
});

test('chat-runtime contract 保持 session 设置归一化行为稳定', () => {
  const { normalizePositiveSessionSetting } = requireBuiltRuntimeModule();

  assert.equal(normalizePositiveSessionSetting(undefined, 4, false), 4);
  assert.equal(normalizePositiveSessionSetting('8', 4, false), 8);
  assert.equal(normalizePositiveSessionSetting('0', 4, false), 4);
  assert.equal(normalizePositiveSessionSetting(null, 4, true), null);
  assert.equal(normalizePositiveSessionSetting(5000, 4, false), 1000);
});
