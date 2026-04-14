const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createChatServerFixture } = require('./helpers/chat-server-fixture');

const repoRoot = path.resolve(__dirname, '..', '..');
const frontendDistDir = path.join(repoRoot, 'dist', 'frontend');
const frontendManifestPath = path.join(frontendDistDir, '.vite', 'manifest.json');

function readBuiltFrontendFile(fileName) {
  return fs.readFileSync(path.join(frontendDistDir, fileName), 'utf8');
}

function readSourceFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readFrontendManifest() {
  return JSON.parse(fs.readFileSync(frontendManifestPath, 'utf8'));
}

function extractFirstJsAssetPath(html, messagePrefix) {
  const match = html.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/i);
  assert.ok(match, `${messagePrefix}: should reference a bundled /assets/*.js entry script`);
  return match[1];
}

function assertContainsAll(source, snippets, messagePrefix = 'missing snippet') {
  for (const snippet of snippets) {
    assert.ok(source.includes(snippet), `${messagePrefix}: ${snippet}`);
  }
}

function assertOmitsAll(source, snippets, messagePrefix = 'unexpected snippet') {
  for (const snippet of snippets) {
    assert.ok(!source.includes(snippet), `${messagePrefix}: ${snippet}`);
  }
}

test('chat and home shell entrypoints now serve the built frontend pages and retire legacy shared script endpoints', async () => {
  const builtChatHtml = readBuiltFrontendFile('chat.html');
  assert.match(builtChatHtml, /<meta name="agent-co-page" content="chat"\s*\/>/);
  assertOmitsAll(builtChatHtml, ['/chat-markdown.js', '/chat-composer.js'], 'built chat html should not reference retired legacy scripts');

  const fixture = await createChatServerFixture();

  try {
    const rootResponse = await fixture.request('/');
    const indexResponse = await fixture.request('/index.html');
    const chatResponse = await fixture.request('/chat.html');

    assert.equal(rootResponse.status, 200);
    assert.equal(indexResponse.status, 200);
    assert.equal(chatResponse.status, 200);
    assert.match(rootResponse.text, /<meta name="agent-co-page" content="home"\s*\/>/);
    assert.equal(indexResponse.text, rootResponse.text, '/index.html should serve the same built home shell as /');
    assert.match(chatResponse.text, /<meta name="agent-co-page" content="chat"\s*\/>/);
    assertOmitsAll(chatResponse.text, ['/chat-markdown.js', '/chat-composer.js'], 'served chat shell should not reference retired legacy scripts');

    const chatAssetPath = extractFirstJsAssetPath(chatResponse.text, 'served chat shell');
    const assetResponse = await fixture.request(chatAssetPath);
    assert.equal(assetResponse.status, 200);
    assert.ok(assetResponse.text.length > 0, 'chat shell asset should not be empty');

    const markdownResponse = await fixture.request('/chat-markdown.js');
    const composerResponse = await fixture.request('/chat-composer.js');
    assert.equal(markdownResponse.status, 404, 'retired /chat-markdown.js should no longer be served');
    assert.equal(composerResponse.status, 404, 'retired /chat-composer.js should no longer be served');
  } finally {
    await fixture.cleanup();
  }
});

test('chat frontend bindings now live in modular React entrypoint and services rather than removed public scripts', () => {
  const chatPageSource = readSourceFile('frontend/src/chat/pages/ChatPage.tsx');
  const chatMainSource = readSourceFile('frontend/src/entries/chat-main.tsx');
  const chatApiSource = readSourceFile('frontend/src/chat/services/chat-api.ts');
  const chatRealtimeSource = readSourceFile('frontend/src/chat/services/chat-realtime.ts');

  assertContainsAll(chatPageSource, [
    "import { ChatComposer } from '../features/composer/ChatComposer';",
    "import { ChatMessageList } from '../features/message-list/ChatMessageList';",
    "import { SessionSidebar } from '../features/session-sidebar/SessionSidebar';",
    "import { resolveChatRealtimeUrl } from '../services/chat-realtime-url';",
    'createChatRealtimeConnection',
    'chatApi.loadHistory()',
    'chatApi.sendMessage({ message })',
    'data-chat-layout="conversation-first"',
    'data-chat-region="conversation-stage"',
    'data-chat-region="composer-dock"',
    'data-chat-mobile-drawer="sessions"',
    'data-chat-mobile-toggle="sessions"',
    'data-chat-desktop-only="session-rail"',
    'data-chat-mobile-toggle="secondary-panels"',
    'data-chat-mobile-secondary="panels"',
    '@media (max-width: 959px)'
  ], 'chat page should compose the React frontend modules');

  assertContainsAll(chatMainSource, [
    "loadInitialChatAuthStatus",
    "'/api/auth-status'",
    'initialAuthStatus={authStatus}'
  ], 'chat entrypoint should bootstrap auth status before mounting the chat page');

  assertContainsAll(chatApiSource, [
    "return client.request<ChatHistoryResponse>('/api/history'",
    "return client.request<ChatSendMessageResponse>('/api/chat'"
  ], 'chat API should target the current HTTP endpoints');

  assertContainsAll(chatRealtimeSource, [
    "type: 'subscribe'",
    'sessionId: options.sessionId',
    'afterSeq: resolveAfterSeq()'
  ], 'chat realtime service should subscribe through the websocket session-events contract');

  assertOmitsAll(
    `${chatPageSource}\n${chatApiSource}\n${chatRealtimeSource}`,
    ['/chat-markdown.js', '/chat-composer.js', 'public/index.html'],
    'chat React sources should not reference retired legacy frontend assets'
  );
});

test('built chat asset preserves the current shell contract without resurrecting retired legacy assets', () => {
  const manifest = readFrontendManifest();
  const chatManifestEntry = manifest['chat.html'];
  assert.ok(chatManifestEntry, 'frontend manifest should include chat.html');

  const chatAssetSource = fs.readFileSync(path.join(frontendDistDir, chatManifestEntry.file), 'utf8');

  assertContainsAll(chatAssetSource, [
    '/api/auth-status',
    '/api/history',
    '/api/chat',
    '/api/ws/session-events',
    '/api/sessions/',
    '/timeline',
    '/sync-status',
    '/call-graph'
  ], 'built chat asset should keep the active route/data contracts');

  assertOmitsAll(chatAssetSource, ['/chat-markdown.js', '/chat-composer.js'], 'built chat asset should not reference retired legacy scripts');
});
