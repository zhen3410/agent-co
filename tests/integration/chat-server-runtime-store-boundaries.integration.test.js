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

test('chat-runtime-stores 模块暴露克制的组合根 helper', () => {
  const storesModule = requireBuiltModule('chat', 'runtime', 'chat-runtime-stores.js');
  assert.deepEqual(Object.keys(storesModule).sort(), ['createChatRuntimeStores']);
  assert.equal(typeof storesModule.createChatRuntimeStores, 'function');
});

test('chat-runtime-stores 将 session / callback / persistence / dependency stores 分离为显式边界', () => {
  const { createChatRuntimeStores } = requireBuiltModule('chat', 'runtime', 'chat-runtime-stores.js');
  const stores = createChatRuntimeStores({ dependencyStatusLogLimit: 5 });

  assert.deepEqual(Object.keys(stores.sessionStore).sort(), [
    'clearActiveSessionIds',
    'clearUserSessions',
    'deleteActiveSessionId',
    'deleteUserSessions',
    'ensureUserSessions',
    'getActiveSessionId',
    'getSessionById',
    'getUserSessions',
    'serializeState',
    'setActiveSessionId',
    'setUserSessions'
  ]);
  assert.deepEqual(Object.keys(stores.callbackMessageStore).sort(), [
    'appendCallbackMessage',
    'consumeCallbackMessages'
  ]);
  assert.deepEqual(Object.keys(stores.persistenceStore).sort(), [
    'clearActiveSessionIds',
    'clearUserSessions',
    'serializeState',
    'setActiveSessionId',
    'setUserSessions'
  ]);
  assert.deepEqual(Object.keys(stores.dependencyLogStore).sort(), [
    'append',
    'appendOperationalLog',
    'filter',
    'list'
  ]);
});

test('callback message queue 不会泄漏到 Redis session snapshot 语义中', () => {
  const { createChatRuntimeStores } = requireBuiltModule('chat', 'runtime', 'chat-runtime-stores.js');
  const stores = createChatRuntimeStores({ dependencyStatusLogLimit: 5 });
  const session = {
    id: 'session-1',
    name: 'Session 1',
    history: [],
    currentAgent: null,
    createdAt: 1,
    updatedAt: 1
  };

  stores.sessionStore.ensureUserSessions('user-1', () => session);
  stores.callbackMessageStore.appendCallbackMessage('session-1', 'Alice', {
    id: 'msg-1',
    role: 'assistant',
    sender: 'Alice',
    text: 'hello',
    timestamp: 2
  });

  const snapshot = stores.persistenceStore.serializeState();

  assert.equal(snapshot.version, 1);
  assert.deepEqual(snapshot.userActiveChatSession, { 'user-1': 'session-1' });
  assert.equal(snapshot.userChatSessions['user-1'].length, 1);
  assert.equal(snapshot.userChatSessions['user-1'][0].id, 'session-1');
  assert.equal(JSON.stringify(snapshot).includes('msg-1'), false);
});

test('dependency log store 保持独立于 session snapshot store', () => {
  const { createChatRuntimeStores } = requireBuiltModule('chat', 'runtime', 'chat-runtime-stores.js');
  const stores = createChatRuntimeStores({ dependencyStatusLogLimit: 2 });

  stores.dependencyLogStore.append({
    timestamp: 1,
    level: 'info',
    dependency: 'redis',
    message: 'healthy'
  });

  assert.deepEqual(stores.dependencyLogStore.list(), [{
    timestamp: 1,
    level: 'info',
    dependency: 'redis',
    message: 'healthy'
  }]);
  assert.deepEqual(stores.persistenceStore.serializeState(), {
    version: 1,
    userChatSessions: {},
    userActiveChatSession: {}
  });
});
