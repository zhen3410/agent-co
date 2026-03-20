const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('React 页面将内联事件处理函数挂载到 window，并在 load 后绑定 DOM', () => {
  const htmlPath = path.join(__dirname, '..', '..', 'public', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  const requiredExports = [
    'window.selectAgent = selectAgent;',
    'window.submitLogin = submitLogin;',
    'window.showLoginOverlay = showLoginOverlay;',
    'window.sendMessage = sendMessage;',
    'window.dismissPwaBanner = dismissPwaBanner;'
  ];

  for (const token of requiredExports) {
    assert.ok(html.includes(token), `missing binding: ${token}`);
  }

  assert.ok(html.includes('cacheDomElements();'), 'should cache DOM elements on load');
  assert.ok(html.includes('bindDomEvents();'), 'should bind DOM events on load');
  assert.ok(html.includes("window.addEventListener('load', async () => {"), 'should initialize in load callback');
  assert.ok(html.includes('<select id="sessionWorkdirSelect" className="session-workdir-select">'), 'should render session-level workdir selector');
  assert.ok(html.includes("fetch('/api/sessions/workdir', {"), 'should update session workdir through dedicated endpoint');

  assert.ok(html.includes('function showPwaInstallButton() {'), 'should guard install button rendering');
  assert.ok(html.includes('if (!pwaInstallBtnEl) return;'), 'should avoid beforeinstallprompt crash before load');
  assert.ok(html.includes('if (deferredInstallPrompt) {'), 'should render install button after load when prompt was cached');
});

test('React 页面在 /api/chat-stream 失败时会自动降级到 /api/chat，减少 iOS Load failed 可见报错', () => {
  const htmlPath = path.join(__dirname, '..', '..', 'public', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(html.includes('async function recoverViaDirectChat(text) {'), 'should provide stream failure fallback');
  assert.ok(html.includes("fetch('/api/chat', {"), 'fallback should call /api/chat');
  assert.ok(html.includes('statusEl.textContent = \'流式连接失败，尝试降级...\';'), 'should show downgrade status');
  assert.ok(html.includes('statusEl.textContent = \'已连接（已自动降级到普通模式）\';'), 'should expose downgrade success state');
});

test('React 页面会将 AI 回复按 Markdown 渲染并保留用户纯文本换行', () => {
  const htmlPath = path.join(__dirname, '..', '..', 'public', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(html.includes('function renderPlainText(text) {'), 'should provide plain text renderer');
  assert.ok(html.includes('function renderMarkdown(text) {'), 'should provide markdown renderer');
  assert.ok(html.includes('message__text message__text--markdown'), 'assistant message should use markdown class');
  assert.ok(html.includes("${highlightMentions(renderPlainText(msg.text || ''))}"), 'user message should keep plain text + mentions');
  assert.ok(html.includes("${renderMarkdown(msg.text || '')}"), 'assistant message should render markdown');
});
