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
    'window.applyAgentWorkdir = applyAgentWorkdir;',
    'window.dismissPwaBanner = dismissPwaBanner;'
  ];

  for (const token of requiredExports) {
    assert.ok(html.includes(token), `missing binding: ${token}`);
  }

  assert.ok(html.includes('cacheDomElements();'), 'should cache DOM elements on load');
  assert.ok(html.includes('bindDomEvents();'), 'should bind DOM events on load');
  assert.ok(html.includes("window.addEventListener('load', async () => {"), 'should initialize in load callback');
  assert.ok(html.includes('id="agentWorkdirRoot"'), 'should render workdir root selector in chat page');
  assert.ok(html.includes('id="agentWorkdirLevel2"'), 'should render workdir level2 selector in chat page');
  assert.ok(html.includes('id="agentWorkdirLevel3"'), 'should render workdir level3 selector in chat page');
  assert.ok(html.includes('id="chatWorkdirPreview"'), 'should render workdir preview in chat page');
  assert.ok(html.includes("fetch(`/api/system/dirs${query}`"), 'should load hierarchy workdir options from server');
  assert.ok(html.indexOf('id="workdirBar"') < html.indexOf('id="currentAgentBar"'), 'should place workdir bar above current agent bar');
  assert.ok(html.includes('id="agentZeroState"'), 'should render zero-enabled agent guidance block');
  assert.ok(html.includes('className="utility-rail"'), 'should render desktop utility rail for compact navigation');
  assert.ok(html.includes('id="contextPanel"'), 'should render desktop context panel');
  assert.ok(html.includes('id="mobileControlSheetBackdrop"'), 'should render mobile control hub backdrop');
  assert.ok(html.includes('id="sessionSearchInput"'), 'should render session search input for faster navigation');
  assert.ok(html.includes('id="recentSessions"'), 'should render recent session shortcuts');
  assert.ok(html.includes('class="agent-tag__toggle"'), 'should render inline session agent toggle');
  assert.ok(html.includes('启用本会话可参与对话的智能体，并管理当前聚焦对象。'), 'should explain that toggles live inside the agents context section');
  assert.ok(!html.includes('id="agentQuickSwitches"'), 'should not duplicate agent toggles in the main chat shell');
  assert.ok(html.includes("fetch('/api/session-agents', {"), 'should call session agent toggle API');
  assert.ok(html.includes("enabledAgents.has(agent.name)"), 'should compute enabled state from session-scoped set');
  assert.ok(html.includes('agent-tag--disabled'), 'should render disabled agent styling hook');
  assert.ok(html.includes('currentAgentWillExpire'), 'should handle pending current-agent expiry hint');
  assert.ok(html.includes('window.toggleContextPanel = toggleContextPanel;'), 'should expose desktop context panel toggle for inline handlers');
  assert.ok(html.includes('window.openMobileControlHub = openMobileControlHub;'), 'should expose mobile control hub opener for inline handlers');
  assert.ok(html.includes('function updateSessionSearch() {'), 'should provide session filtering logic');
  assert.ok(html.includes('function renderRecentSessions() {'), 'should provide recent sessions quick actions');

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

test('聊天页顶部控制栏保持吸顶，避免被长消息列表顶出视口', () => {
  const cssPath = path.join(__dirname, '..', '..', 'public', 'styles.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  assert.ok(css.includes('.header {'), 'should define header styles');
  assert.ok(css.includes('position: sticky;'), 'header should stick to the top of the viewport');
  assert.ok(css.includes('top: 0;'), 'sticky header should anchor to viewport top');
  assert.ok(css.includes('z-index: 10;'), 'sticky header should stay above the message list');
});

test('聊天输入框支持多行自适应增高，并保留 Enter 发送与 Shift+Enter 换行', () => {
  const htmlPath = path.join(__dirname, '..', '..', 'public', 'index.html');
  const cssPath = path.join(__dirname, '..', '..', 'public', 'styles.css');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');

  assert.ok(html.includes('<textarea'), 'should render a textarea for chat input');
  assert.ok(html.includes('id="userInput"'), 'should keep the existing chat input id');
  assert.ok(html.includes('function resizeUserInput() {'), 'should define auto-resize logic');
  assert.ok(html.includes("userInputEl.style.height = 'auto';"), 'should reset height before measuring');
  assert.ok(html.includes('userInputEl.style.height = `${Math.min(userInputEl.scrollHeight, 160)}px`;'), 'should cap the auto-resize height');
  assert.ok(html.includes('resizeUserInput();'), 'should resize after input mutations');
  assert.ok(html.includes("if (e.key === 'Enter' && !e.shiftKey) {"), 'should keep Enter as submit');
  assert.ok(css.includes('resize: none;'), 'should disable manual textarea resizing');
  assert.ok(css.includes('max-height: 160px;'), 'should cap textarea growth in CSS as well');
  assert.ok(css.includes('overflow-y: auto;'), 'should scroll internally after reaching max height');
});
