const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createChatServerFixture } = require('./helpers/chat-server-fixture');

function readPublicFile(...parts) {
  return fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');
}

function countMatches(source, pattern) {
  return (source.match(pattern) || []).length;
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

function getFunctionBody(source, functionName) {
  const signaturePattern = new RegExp(`(?:async\\s+)?function\\s+${functionName}\\s*\\(`);
  const match = source.match(signaturePattern);
  assert.ok(match, `should contain function: ${functionName}`);

  const startIndex = match.index;
  const openBraceIndex = source.indexOf('{', startIndex);
  assert.notEqual(openBraceIndex, -1, `should contain function body: ${functionName}`);

  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  assert.fail(`unable to extract function body: ${functionName}`);
}

function getArrowComponentBody(source, componentName) {
  const signaturePattern = new RegExp(`const\\s+${componentName}\\s*=\\s*\\([^)]*\\)\\s*=>`);
  const match = source.match(signaturePattern);
  assert.ok(match, `should contain component: ${componentName}`);

  const startIndex = match.index;
  const arrowIndex = source.indexOf('=>', startIndex);
  const openBraceIndex = source.indexOf('{', arrowIndex);
  assert.notEqual(openBraceIndex, -1, `should contain component body: ${componentName}`);

  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  assert.fail(`unable to extract component body: ${componentName}`);
}

test('React 页面将内联事件处理函数挂载到 window，并在 load 后绑定 DOM', () => {
  const html = readPublicFile('public', 'index.html');

  assertContainsAll(html, [
    'window.selectAgent = selectAgent;',
    'window.submitLogin = submitLogin;',
    'window.showLoginOverlay = showLoginOverlay;',
    'window.sendMessage = sendMessage;',
    'window.applyAgentWorkdir = applyAgentWorkdir;',
    'window.dismissPwaBanner = dismissPwaBanner;',
    'cacheDomElements();',
    'bindDomEvents();'
  ], 'missing window/dom bootstrap contract');
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
  assertOmitsAll(html, ['id="agentQuickSwitches"'], 'should not duplicate legacy agent quick-switch markup');
  assert.ok(html.includes("fetch('/api/session-agents', {"), 'should call session agent toggle API');
  assert.ok(html.includes("enabledAgents.has(agent.name)"), 'should compute enabled state from session-scoped set');
  assert.ok(html.includes('agent-tag--disabled'), 'should render disabled agent styling hook');
  assert.ok(html.includes('currentAgentWillExpire'), 'should handle pending current-agent expiry hint');
  assert.ok(html.includes('window.toggleContextPanel = toggleContextPanel;'), 'should expose desktop context panel toggle for inline handlers');
  assert.ok(html.includes('window.openMobileControlHub = openMobileControlHub;'), 'should expose mobile control hub opener for inline handlers');
  assert.ok(html.includes('function updateSessionSearch() {'), 'should provide session filtering logic');
  assert.ok(html.includes('function renderRecentSessions() {'), 'should provide recent sessions quick actions');

  assertContainsAll(html, [
    'function showPwaInstallButton() {',
    'if (!pwaInstallBtnEl) return;',
    'if (deferredInstallPrompt) {'
  ], 'missing PWA install guard behavior');
  assertContainsAll(html, [
    "navigator.serviceWorker.register('/service-worker.js')",
    'registration.update();',
    "navigator.serviceWorker.addEventListener('controllerchange', () => {",
    'window.location.reload();'
  ], 'missing service worker refresh contract');
});

test('PWA service worker 不应长期缓存 HTML 与 CSS 旧版本，避免界面修复无法及时生效', () => {
  const serviceWorker = readPublicFile('public', 'service-worker.js');
  const shellBranchStart = serviceWorker.indexOf('if (APP_SHELL_PATHS.has(requestUrl.pathname)) {');
  const shellBranchEnd = serviceWorker.indexOf('\n\n      if (cached) return cached;', shellBranchStart);
  const shellBranch = serviceWorker.slice(shellBranchStart, shellBranchEnd);

  assert.ok(serviceWorker.includes("const CACHE_NAME = 'agent-co-pwa-v2';"), 'should bump cache version when changing shell caching policy');
  assert.ok(serviceWorker.includes("const APP_SHELL_PATHS = new Set(['/', '/index.html', '/styles.css', '/manifest.json', '/icon.svg']);"), 'should track app shell paths explicitly');
  assert.ok(serviceWorker.includes('if (APP_SHELL_PATHS.has(requestUrl.pathname)) {'), 'should special-case app shell assets');
  assert.ok(shellBranch.includes('return fetch(event.request)'), 'should refresh app shell from network first');
  assert.ok(shellBranch.includes('return cached || fetch(event.request);'), 'should only fall back to cache when network fetch fails');
  assert.ok(!shellBranch.includes('if (cached) return cached;'), 'should not use cache-first strategy for shell assets');
});

test('React 页面仅在流式连接尚未收到 AI 可见回复时才降级到 /api/chat，避免重复执行同一条消息', () => {
  const html = readPublicFile('public', 'index.html');

  assert.ok(html.includes('async function recoverViaDirectChat(text) {'), 'should provide stream failure fallback');
  assert.ok(html.includes("fetch('/api/chat', {"), 'fallback should call /api/chat');
  assert.ok(html.includes('statusEl.textContent = \'流式连接失败，尝试降级...\';'), 'should show downgrade status');
  assert.ok(html.includes('statusEl.textContent = \'已连接（已自动降级到普通模式）\';'), 'should expose downgrade success state');
  assert.ok(html.includes('let streamReceivedAgentMessage = false;'), 'should track whether stream already delivered a visible AI message');
  assert.ok(html.includes('streamReceivedAgentMessage = true;'), 'should mark visible agent messages before fallback logic');
  assert.ok(html.includes('if (!streamReceivedAgentMessage) {'), 'should only downgrade before visible AI output arrives');
});

test('React 页面在流式收到 error 事件或空回复结束时会明确提示失败，而不是静默停留', () => {
  const html = readPublicFile('public', 'index.html');

  assert.ok(html.includes("statusEl.textContent = '连接失败';"), 'should expose a failure status when stream reports an error');
  assert.ok(html.includes('let streamReceivedError = false;'), 'should track terminal stream errors');
  assert.ok(html.includes('streamReceivedError = true;'), 'should mark error events explicitly');
  assert.ok(html.includes('if (!streamReceivedAgentMessage && !streamReceivedError) {'), 'should detect silent empty stream completions');
  assert.ok(html.includes('text: \'❌ 智能体未返回可见消息，请稍后重试或查看日志\''), 'should show an explicit empty-stream failure message');
  assert.ok(html.includes('function normalizeStreamErrorMessage(error) {'), 'should normalize raw stream errors for users');
  assert.ok(html.includes('账号或工作区异常'), 'should surface a friendly workspace/account hint');
  assert.ok(html.includes('请检查 Codex 登录状态、套餐/额度或 workspace 是否已恢复'), 'should include an actionable recovery hint');
});

test('React 页面会在收到部分回复后提供继续剩余执行入口，而不是提示手动重发', () => {
  const html = readPublicFile('public', 'index.html');

  assert.ok(html.includes('async function resumePendingChain() {'), 'should provide a resume action for interrupted chains');
  assert.ok(html.includes("fetch('/api/chat-resume', {"), 'resume action should call /api/chat-resume');
  assert.ok(html.includes('function showResumeChainNotice() {'), 'should render a dedicated resume notice');
  assert.ok(html.includes('继续剩余执行'), 'should label the resume action clearly');
  assert.ok(html.includes('本次对话已收到部分回复，连接已中断。'), 'should explain the interrupted-partial-response state');
  assert.ok(!html.includes('如需继续，请手动再发一次。'), 'should no longer instruct users to manually resend');
});

test('前端流式界面提供停止当前智能体和停止本次执行按钮', () => {
  const html = readPublicFile('public', 'index.html');
  const css = readPublicFile('public', 'styles.css');
  const requestChatStopBody = getFunctionBody(html, 'requestChatStop');
  const syncStopActionsBody = getFunctionBody(html, 'syncStopActionButtons');

  assertContainsAll(html, [
    'id="stopCurrentBtn"',
    'id="stopSessionBtn"',
    'stop-current',
    'stop-session',
    "window.requestChatStop && window.requestChatStop('current')",
    "window.requestChatStop && window.requestChatStop('session')"
  ], 'missing stop action controls');

  assertContainsAll(requestChatStopBody, [
    "fetch('/api/chat-stop', {",
    'body: JSON.stringify({ scope })',
    'credentials: \'include\'',
    'isStopRequestInFlight = true;',
    'isStopRequestInFlight = false;'
  ], 'missing stop request binding');

  assertContainsAll(syncStopActionsBody, [
    'const showStopActions = isLoading;',
    'const stopDisabled = !showStopActions || isStopRequestInFlight;',
    "el.style.display = showStopActions ? 'inline-flex' : 'none';",
    'el.disabled = stopDisabled;'
  ], 'missing stop action display/disable contract');

  assertContainsAll(css, [
    '.btn-stop-action {',
    '.btn-stop-action:hover:not(:disabled) {',
    '.btn-stop-action:disabled {'
  ], 'missing stop action styles');
});

test('前端会处理 execution_stopped 事件并更新恢复提示', () => {
  const html = readPublicFile('public', 'index.html');
  const sendMessageBody = getFunctionBody(html, 'sendMessage');

  assertContainsAll(sendMessageBody, [
    'let streamStoppedByUser = false;',
    'let streamResumeAvailable = false;',
    "eventType === 'execution_stopped'",
    'streamStoppedByUser = true;',
    'streamResumeAvailable = data.resumeAvailable === true;',
    "statusEl.textContent = streamResumeAvailable ? '执行已停止，可继续剩余执行' : '执行已停止';",
    'if (streamResumeAvailable) {',
    'showResumeChainNotice();',
    'clearResumeChainNotice();',
    'if (!streamReceivedAgentMessage && !streamReceivedError) {',
    'if (!streamStoppedByUser && !streamReceivedAgentDelta) {',
    'if (!streamStoppedByUser) {'
  ], 'missing execution_stopped binding contract');
});

test('管理后台为智能体提示词提供恢复模板默认值入口，且保留手动编辑能力', () => {
  const html = readPublicFile('public-auth', 'admin.html');

  assert.ok(html.includes("onclick=\"restoreTemplatePrompt('"), 'should render restore-template action for agent prompt cards');
  assert.ok(html.includes("fetch(`/api/agents/${encodeURIComponent(name)}/prompt/restore-template`"), 'should call restore-template API');
  assert.ok(html.includes('恢复模板提示词'), 'should label the restore-template action clearly');
});

test('管理后台为专业智能体提示词提供模板预览入口', () => {
  const html = readPublicFile('public-auth', 'admin.html');

  assert.ok(html.includes("onclick=\"previewTemplatePrompt('"), 'should render preview-template action for agent prompt cards');
  assert.ok(html.includes("fetch(`/api/agents/${encodeURIComponent(name)}/prompt/template`"), 'should call template-preview API');
  assert.ok(html.includes('预览模板提示词'), 'should label the preview-template action clearly');
  assert.ok(html.includes('showPromptPreview('), 'should display a prompt preview view');
  assert.ok(html.includes('id="promptPreviewModal"'), 'should render a dedicated prompt preview modal');
  assert.ok(html.includes('id="promptPreviewTitle"'), 'should expose a modal title target for the preview');
  assert.ok(html.includes('id="promptPreviewCurrent"'), 'should expose current prompt preview target');
  assert.ok(html.includes('id="promptPreviewTemplate"'), 'should expose template prompt preview target');
  assert.ok(html.includes('prompt-preview-compare'), 'should render a side-by-side comparison layout');
  assert.ok(html.includes('当前提示词'), 'should label current prompt column');
  assert.ok(html.includes('模板默认值'), 'should label template prompt column');
  assert.ok(html.includes('closePromptPreviewModal()'), 'should allow closing the prompt preview modal');
  assert.ok(!html.includes('window.alert('), 'should use an in-page modal instead of alert for preview');
});

test('React 页面会为用户与 AI 回复统一使用 Markdown 渲染模块，并引入独立 composer/markdown 脚本', async () => {
  const html = readPublicFile('public', 'index.html');
  const fixture = await createChatServerFixture();

  try {
    const home = await fixture.request('/');
    const markdownScript = await fixture.request('/chat-markdown.js');
    const composerScript = await fixture.request('/chat-composer.js');

    assert.equal(home.status, 200, 'should serve chat page');
    assertContainsAll(home.text, [
      '<script src="/chat-markdown.js"></script>',
      '<script src="/chat-composer.js"></script>'
    ], 'missing shared script tags in served chat page');

    assert.equal(markdownScript.status, 200, 'should serve /chat-markdown.js');
    assert.equal(composerScript.status, 200, 'should serve /chat-composer.js');
    assert.ok(markdownScript.text.includes('window.ChatMarkdown'), 'served markdown asset should expose ChatMarkdown');
    assert.ok(composerScript.text.includes('window.ChatComposer'), 'served composer asset should expose ChatComposer');

    assert.ok(!home.text.includes('function renderMarkdown(text) {'), 'chat page should not inline legacy markdown renderer');
    assert.ok(!home.text.includes('highlightMentions(renderPlainText('), 'chat page should not fall back to legacy plain-text renderer');
  } finally {
    await fixture.cleanup();
  }
});

test('聊天输入区升级为桌面双栏预览与移动端编辑/预览切换结构', () => {
  const html = readPublicFile('public', 'index.html');

  assertContainsAll(html, [
    'className="composer-toolbar"',
    'className="composer-body"',
    'className="composer-editor"',
    'className="composer-preview"',
    'id="composerPreview"',
    'className="composer-mobile-tabs"',
    'data-tab="edit"',
    'data-tab="preview"',
    'window.ChatComposer.initComposer'
  ], 'missing composer preview structure');
});

test('Markdown 与 composer 独立模块包含第二轮增强能力：代码复制、滚动同步与更完整语法', () => {
  const markdown = readPublicFile('public', 'chat-markdown.js');
  const composer = readPublicFile('public', 'chat-composer.js');
  const css = readPublicFile('public', 'styles.css');

  assertContainsAll(markdown, [
    'copy-code-btn',
    'code-block',
    'task-list-item',
    '<table>',
    'navigator.clipboard.writeText'
  ], 'missing markdown enhancement contract');

  assertContainsAll(composer, [
    'function syncComposerScroll()',
    "previewEl.scrollTop = ratio * previewScrollable",
    "inputEl.addEventListener('scroll', syncComposerScroll);"
  ], 'missing composer scroll sync contract');

  assertContainsAll(css, [
    '.code-block {',
    '.copy-code-btn {',
    '.copy-code-btn.is-copied {'
  ], 'missing code copy styling contract');
});

test('第三轮增强提供预览状态层、代码语言标签与表格可读性样式', () => {
  const html = readPublicFile('public', 'index.html');
  const markdown = readPublicFile('public', 'chat-markdown.js');
  const composer = readPublicFile('public', 'chat-composer.js');
  const css = readPublicFile('public', 'styles.css');

  assertContainsAll(html, [
    'composer-preview__header',
    'composerPreviewStatus',
    '支持 Markdown 语法，Enter 发送，Shift+Enter 换行'
  ], 'missing preview status shell');

  assertContainsAll(markdown, [
    'code-block__lang',
    "code.getAttribute('data-language')",
    "button.setAttribute('data-copy-code'"
  ], 'missing code language label contract');

  assertContainsAll(composer, [
    'function updatePreviewStatus()',
    "statusEl.textContent = `${lineCount} 行 · ${charCount} 字符`",
    'updatePreviewStatus();'
  ], 'missing preview status logic');

  assertContainsAll(css, [
    '.composer-preview__header {',
    '.composer-preview__meta {',
    '.code-block__lang {',
    '.message__text--markdown table tbody tr:nth-child(even) {'
  ], 'missing preview/code/table polish styles');
});

test('第四轮增强提供更顺手的工具栏插入、复制降级与移动端预览适配', () => {
  const composer = readPublicFile('public', 'chat-composer.js');
  const markdown = readPublicFile('public', 'chat-markdown.js');
  const css = readPublicFile('public', 'styles.css');

  assertContainsAll(composer, [
    "case 'ordered-list':",
    "case 'blockquote':",
    "wrapSelection('```",
    'function replaceCurrentLinePrefix('
  ], 'missing richer toolbar editing contract');

  assertContainsAll(markdown, [
    "document.execCommand('copy')",
    'textarea.setAttribute(\'readonly\'',
    '复制失败'
  ], 'missing clipboard fallback contract');

  assertContainsAll(css, [
    '@media (max-width: 960px) {',
    '.composer-preview__header {',
    '.composer-preview__meta {'
  ], 'missing mobile preview polish contract');
});

test('第五轮增强提供轻量代码高亮结构和桌面端双向滚动同步', () => {
  const markdown = readPublicFile('public', 'chat-markdown.js');
  const composer = readPublicFile('public', 'chat-composer.js');
  const css = readPublicFile('public', 'styles.css');

  assertContainsAll(markdown, [
    'function highlightCodeSyntax(',
    'token token--keyword',
    'token token--string',
    'token token--comment'
  ], 'missing lightweight syntax highlight contract');

  assertContainsAll(composer, [
    'let syncingScroll = false;',
    'function syncPreviewFromInputScroll()',
    'function syncInputFromPreviewScroll()',
    "previewBodyEl.addEventListener('scroll', syncInputFromPreviewScroll);"
  ], 'missing bidirectional scroll sync contract');

  assertContainsAll(css, [
    '.token--keyword {',
    '.token--string {',
    '.token--comment {'
  ], 'missing syntax highlight styles');
});

test('移动端改为控制栏右侧抽屉与编辑区底部抽屉，且二者互斥不再挤压聊天区', () => {
  const html = readPublicFile('public', 'index.html');
  const css = readPublicFile('public', 'styles.css');
  const composer = readPublicFile('public', 'chat-composer.js');
  const openMobileControlHubBody = getFunctionBody(html, 'openMobileControlHub');
  const closeMobileControlHubBody = getFunctionBody(html, 'closeMobileControlHub');

  assertContainsAll(html, [
    'id="mobileComposerDrawerBackdrop"',
    'className="mobile-composer-drawer-backdrop"',
    'className="input-area mobile-composer-drawer"',
    'className="mobile-composer-trigger"'
  ], 'missing mobile dual-drawer shell');

  assertContainsAll(openMobileControlHubBody, [
    'window.closeMobileComposerDrawer();',
    "document.body.classList.add('sheet-open');"
  ], 'missing drawer exclusivity when opening mobile control hub');

  assertContainsAll(closeMobileControlHubBody, [
    "document.body.classList.remove('sheet-open');"
  ], 'missing mobile control close contract');

  assertContainsAll(composer, [
    'function openMobileComposerDrawer()',
    'function closeMobileComposerDrawer(',
    'window.closeMobileControlHub();',
    "document.body.classList.add('composer-drawer-open');",
    "document.body.classList.remove('composer-drawer-open');",
    'window.openMobileComposerDrawer = openMobileComposerDrawer;',
    'window.closeMobileComposerDrawer = closeMobileComposerDrawer;'
  ], 'missing mobile composer drawer behavior');

  assertContainsAll(css, [
    '.mobile-control-sheet-backdrop {',
    'justify-content: flex-end;',
    '.mobile-control-sheet {',
    'height: 100%;',
    'border-radius: 28px 0 0 28px;',
    '.mobile-composer-drawer-backdrop {',
    'align-items: flex-end;',
    '.mobile-composer-drawer {',
    'transform: translateY(calc(100% + 20px));',
    '.mobile-composer-trigger {',
    '@media (max-width: 960px) {',
    '.input-area {',
    'display: none;'
  ], 'missing mobile dual-drawer styles');
});

test('移动端双抽屉第二轮 polish：统一关闭入口、Esc 关闭与显式开启动画类', () => {
  const html = readPublicFile('public', 'index.html');
  const css = readPublicFile('public', 'styles.css');
  const composer = readPublicFile('public', 'chat-composer.js');
  const bindDomEventsBody = getFunctionBody(html, 'bindDomEvents');
  const openMobileControlHubBody = getFunctionBody(html, 'openMobileControlHub');
  const closeMobileControlHubBody = getFunctionBody(html, 'closeMobileControlHub');

  assertContainsAll(html, [
    'function closeMobileOverlays() {',
    'window.closeMobileOverlays = closeMobileOverlays;'
  ], 'missing unified mobile overlay close contract');

  assertContainsAll(bindDomEventsBody, [
    "if (event.key === 'Escape') {",
    'closeMobileOverlays();'
  ], 'missing escape-to-close mobile overlays contract');

  assertContainsAll(openMobileControlHubBody, [
    "mobileControlSheetBackdropEl.classList.add('is-open');"
  ], 'missing mobile control open animation class');

  assertContainsAll(closeMobileControlHubBody, [
    "mobileControlSheetBackdropEl.classList.remove('is-open');"
  ], 'missing mobile control close animation class');

  assertContainsAll(composer, [
    "drawerBackdropEl.classList.add('is-open');",
    "drawerBackdropEl.classList.remove('is-open');"
  ], 'missing mobile composer drawer animation class contract');

  assertContainsAll(css, [
    '.mobile-control-sheet-backdrop.is-open {',
    '.mobile-control-sheet-backdrop.is-open .mobile-control-sheet {',
    '.mobile-composer-drawer-backdrop.is-open {',
    '.mobile-composer-trigger.is-hidden {'
  ], 'missing animated drawer state styles');
});

test('移动端双抽屉第三轮 polish：提供底部触发条，并在打开编辑抽屉时回到编辑态', () => {
  const html = readPublicFile('public', 'index.html');
  const composer = readPublicFile('public', 'chat-composer.js');
  const css = readPublicFile('public', 'styles.css');

  assertContainsAll(html, [
    'className="mobile-composer-triggerbar"',
    'className="mobile-composer-triggerbar__hint"',
    'Markdown / @智能体'
  ], 'missing mobile trigger bar shell');

  assertContainsAll(composer, [
    "mode = 'edit';",
    'updatePanels();',
    "document.querySelectorAll('.mobile-composer-trigger, .mobile-composer-triggerbar')"
  ], 'missing reset-to-edit and shared trigger handling contract');

  assertContainsAll(css, [
    '.mobile-composer-triggerbar {',
    '.mobile-composer-triggerbar__hint {',
    '.mobile-composer-triggerbar.is-hidden {'
  ], 'missing trigger bar styles');
});

test('移动端编辑抽屉打开时会把焦点稳妥交给 textarea，并让触发控件彻底退出交互层', () => {
  const composer = readPublicFile('public', 'chat-composer.js');
  const css = readPublicFile('public', 'styles.css');

  assertContainsAll(composer, [
    'document.activeElement',
    'document.activeElement.blur()',
    'window.requestAnimationFrame(() => {',
    "inputEl.focus({ preventScroll: true });"
  ], 'missing stable mobile focus handoff contract');

  assertContainsAll(css, [
    '.mobile-composer-trigger.is-hidden {',
    'display: none;',
    '.mobile-composer-triggerbar.is-hidden {',
    'display: none;'
  ], 'missing hidden trigger removal contract');
});

test('移动端消息列表为底部写消息触发条预留安全滚动空间，避免最后一条消息被遮挡', () => {
  const css = readPublicFile('public', 'styles.css');
  const mobileStart = css.indexOf('@media (max-width: 960px) {');
  const mobileCss = css.slice(mobileStart);

  assertContainsAll(mobileCss, [
    '.messages-shell {',
    'padding: 0 12px calc(96px + env(safe-area-inset-bottom));',
    '.messages {',
    'padding-bottom: calc(112px + env(safe-area-inset-bottom));'
  ], 'missing mobile bottom safe-scroll spacing contract');
});

test('移动端底部写消息触发条压缩自身高度，进一步把首屏空间让给消息区', () => {
  const css = readPublicFile('public', 'styles.css');
  const triggerRuleStart = css.indexOf('.mobile-composer-triggerbar {');
  const triggerRule = css.slice(triggerRuleStart, css.indexOf('}', triggerRuleStart) + 1);
  const hintRuleStart = css.indexOf('.mobile-composer-triggerbar__hint {');
  const hintRule = css.slice(hintRuleStart, css.indexOf('}', hintRuleStart) + 1);

  assertContainsAll(triggerRule, [
    '.mobile-composer-triggerbar {',
    'bottom: calc(14px + env(safe-area-inset-bottom));',
    'gap: 10px;',
    'padding: 10px 14px;'
  ], 'missing compact mobile trigger bar shell contract');

  assertContainsAll(hintRule, [
    '.mobile-composer-triggerbar__hint {',
    'font-size: 11px;'
  ], 'missing compact mobile trigger bar hint contract');
});

test('移动端控制中心新增日志 tab，并提供 CLI 与运维日志入口', () => {
  const html = readPublicFile('public', 'index.html');
  const css = readPublicFile('public', 'styles.css');

  assertContainsAll(html, [
    "window.setContextTab && window.setContextTab('logs')",
    'data-tab="logs"',
    '>日志</button>',
    'className="context-section context-section--mobile" data-section="logs"',
    'className="mobile-log-links"',
    "window.open('/verbose-logs.html', '_blank')",
    "window.open('/deps-monitor.html', '_blank')"
  ], 'missing mobile logs tab contract');

  assertContainsAll(css, [
    '.mobile-log-links {',
    '.mobile-log-links .btn-session {'
  ], 'missing mobile logs tab styles');
});

test('移动端顶部控制栏可切换到单行极简模式，仅保留标题、状态与控制入口', () => {
  const html = readPublicFile('public', 'index.html');
  const css = readPublicFile('public', 'styles.css');
  const mobileStart = css.indexOf('@media (max-width: 960px) {');
  const mobileCss = css.slice(mobileStart);

  assertContainsAll(html, [
    'className="header-title"',
    'className="header-session-pill header-session-pill--mobile-hidden"',
    'className="btn-clear btn-mobile-session"',
    'className="btn-clear btn-desktop-context"',
    'className="btn-clear btn-header-secondary" id="loginBtnHeader"',
    'className="btn-clear btn-header-secondary" id="logoutBtn"'
  ], 'missing mobile minimal header structure contract');

  assertContainsAll(mobileCss, [
    '.header {',
    'flex-direction: row;',
    'align-items: center;',
    'justify-content: space-between;',
    '.header-main {',
    'flex: 1;',
    '.header-actions {',
    'width: auto;',
    '.header-kicker,',
    '.header-subtitle,',
    '.header-session-pill--mobile-hidden {',
    'display: none;',
    '.btn-header-secondary,',
    '.btn-desktop-context {',
    'display: none;',
    '.btn-mobile-session {',
    'display: inline-flex;',
    '.header-actions .status {',
    'display: inline-flex;'
  ], 'missing single-line mobile header contract');
});

test('移动端顶部控制栏压缩纵向占用，优先把空间留给消息区', () => {
  const css = readPublicFile('public', 'styles.css');
  const mobileStart = css.indexOf('@media (max-width: 960px) {');
  const mobileCss = css.slice(mobileStart);

  assertContainsAll(mobileCss, [
    '.header {',
    'padding: 10px 12px 8px;',
    '.header-main {',
    'gap: 8px;',
    '.header h1 {',
    'font-size: 18px;',
    '.header-actions {',
    'gap: 6px;',
    '.header-kicker,',
    '.header-subtitle,',
    '.header-session-pill--mobile-hidden {',
    'display: none;'
  ], 'missing compact mobile header contract');
});

test('聊天页顶部控制栏保持吸顶，避免被长消息列表顶出视口', () => {
  const css = readPublicFile('public', 'styles.css');
  const headerRule = css.slice(css.indexOf('.header {'), css.indexOf('}', css.indexOf('.header {')) + 1);

  assertContainsAll(headerRule, [
    '.header {',
    'position: sticky;',
    'top: 0;',
    'z-index: 10;'
  ], 'missing sticky header contract');
});

test('桌面端将滚动限制在消息区和右侧控制面板内，避免顶部栏与侧边栏被长会话带走', () => {
  const css = readPublicFile('public', 'styles.css');
  const containerRule = css.slice(css.indexOf('.container {'), css.indexOf('}', css.indexOf('.container {')) + 1);
  const utilityRailRule = css.slice(css.indexOf('.utility-rail {'), css.indexOf('}', css.indexOf('.utility-rail {')) + 1);
  const mainLayoutRule = css.slice(css.indexOf('.main-layout {'), css.indexOf('}', css.indexOf('.main-layout {')) + 1);
  const contextPanelStart = css.indexOf('.context-panel {', css.indexOf('.context-panel {') + 1);
  const contextPanelRule = css.slice(contextPanelStart, css.indexOf('}', contextPanelStart) + 1);

  assertContainsAll(containerRule, [
    '.container {',
    'height: 100vh;',
    'height: 100dvh;'
  ], 'missing desktop fixed-controls container contract');
  assertContainsAll(mainLayoutRule, [
    '.main-layout {',
    'height: 100%;'
  ], 'missing desktop fixed-controls main layout contract');
  assertContainsAll(utilityRailRule, [
    '.utility-rail {',
    'position: sticky;',
    'top: 18px;'
  ], 'missing desktop fixed-controls utility rail contract');
  assertContainsAll(contextPanelRule, [
    '.context-panel {',
    'height: calc(100vh - 36px);',
    'height: calc(100dvh - 36px);',
    'overflow-y: auto;'
  ], 'missing desktop fixed-controls layout contract');
});

test('桌面端右侧控制面板的标题与标签栏保持吸顶，长列表滚动时仍可快速切换', () => {
  const css = readPublicFile('public', 'styles.css');
  const headerStart = css.indexOf('.context-panel__header {');
  const headerRule = css.slice(headerStart, css.indexOf('}', headerStart) + 1);
  const tabsStart = css.indexOf('.context-panel__tabs {');
  const tabsRule = css.slice(tabsStart, css.indexOf('}', tabsStart) + 1);

  assertContainsAll(headerRule, [
    '.context-panel__header {',
    'position: sticky;',
    'top: 0;',
    'z-index: 2;'
  ], 'missing sticky context panel header contract');
  assertContainsAll(tabsRule, [
    '.context-panel__tabs {',
    'position: sticky;',
    'top: 75px;',
    'z-index: 2;'
  ], 'missing sticky context panel tabs contract');
});

test('聊天输入框支持多行自适应增高，并保留 Enter 发送与 Shift+Enter 换行', () => {
  const html = readPublicFile('public', 'index.html');
  const css = readPublicFile('public', 'styles.css');
  const resizeBody = getFunctionBody(html, 'resizeUserInput');
  const bindDomEventsBody = getFunctionBody(html, 'bindDomEvents');

  assertContainsAll(html, [
    '<textarea',
    'id="userInput"'
  ], 'missing chat textarea contract');
  assertContainsAll(resizeBody, [
    "userInputEl.style.height = 'auto';",
    'userInputEl.style.height = `${Math.min(userInputEl.scrollHeight, 160)}px`;',
    'Math.min(userInputEl.scrollHeight, 160)'
  ], 'missing textarea resize behavior');
  assertContainsAll(bindDomEventsBody, [
    'resizeUserInput();',
    "if (e.key === 'Enter' && !e.shiftKey) {"
  ], 'missing textarea keyboard/input binding');
  assertContainsAll(css, [
    'resize: none;',
    'max-height: 160px;',
    'overflow-y: auto;'
  ], 'missing textarea CSS contract');
});

test('React 页面会通过共享的当前会话设置组件渲染链路配置并绑定更新控件', () => {
  const html = readPublicFile('public', 'index.html');
  const sessionSettingsCardBody = getArrowComponentBody(html, 'SessionSettingsCard');
  const saveBody = getFunctionBody(html, 'saveSessionSettings');

  assert.equal(countMatches(html, /<SessionSettingsCard\s+variant="desktop"\s*\/>/g), 1, 'desktop sessions panel should render the shared settings component once');
  assert.equal(countMatches(html, /<SessionSettingsCard\s+variant="mobile"\s*\/>/g), 1, 'mobile sessions panel should render the shared settings component once');
  assert.match(sessionSettingsCardBody, /data-session-settings-variant=\{variant\}/, 'shared settings component should expose a stable variant marker');
  assert.match(sessionSettingsCardBody, /data-session-setting="agentChainMaxHops"/, 'shared settings component should expose hop-count inputs via stable setting markers');
  assert.match(sessionSettingsCardBody, /data-session-setting="agentChainMaxCallsPerAgent"/, 'shared settings component should expose same-agent limit inputs via stable setting markers');
  assert.match(sessionSettingsCardBody, /data-session-setting="agentChainMaxCallsUnlimited"/, 'shared settings component should expose the unlimited toggle via a stable setting marker');
  assert.match(sessionSettingsCardBody, /data-session-setting-save="agentChainMaxHops"/, 'shared settings component should expose save control markers for hop limit');
  assert.match(sessionSettingsCardBody, /data-session-setting-save="agentChainMaxCallsPerAgent"/, 'shared settings component should expose save control markers for same-agent limit');
  assert.match(saveBody, /fetch\('\/api\/sessions\/update', \{/, 'should submit session settings via the update API');
});

test('React 页面为 invocation_review 消息提供独立渲染分支，并保留普通消息渲染路径', () => {
  const html = readPublicFile('public', 'index.html');

  assertContainsAll(html, [
    'function renderMessage(msg, options = {}) {',
    "const isInvocationReview = msg.messageSubtype === 'invocation_review';",
    'if (isInvocationReview) {',
    'renderInvocationReviewMessageContent(msg, colorStyle)',
    'const renderedMarkdown = window.ChatMarkdown.renderMarkdownHtml(msg.text || \'\''
  ], 'missing invocation_review render branch contract');
});

test('React 页面会把 invocation_review 消息渲染为结构化卡片，并提供可展开原始评审文本', () => {
  const html = readPublicFile('public', 'index.html');
  const renderReviewBody = getFunctionBody(html, 'renderInvocationReviewMessageContent');

  assertContainsAll(renderReviewBody, [
    'reviewAction',
    'reviewDisplayText',
    'callerAgentName',
    'calleeAgentName',
    'reviewRawText',
    'data-review-action=',
    'invocation-review-card',
    '<details class="invocation-review-raw"',
    '展开/收起原始评审文本'
  ], 'missing invocation_review structured-card contract');
});

test('React 页面按后端 reviewAction 枚举映射评审状态标签（accept/follow_up/retry）', () => {
  const html = readPublicFile('public', 'index.html');
  const actionMetaBody = getFunctionBody(html, 'getInvocationReviewActionMeta');

  assertContainsAll(actionMetaBody, [
    "case 'accept':",
    '已接受',
    "case 'follow_up':",
    '需跟进',
    "case 'retry':",
    '需重试'
  ], 'missing backend reviewAction mapping contract');
});

test('React 页面为消息调用图提供摘要、展开面板与分组详情渲染钩子', () => {
  const html = readPublicFile('public', 'index.html');
  const summaryBody = getFunctionBody(html, 'renderMessageGraphSummary');
  const panelBody = getFunctionBody(html, 'renderMessageGraphPanel');

  assertContainsAll(html, [
    'renderMessageGraphSummary(',
    'renderMessageGraphPanel('
  ], 'missing call-graph rendering hook in message cards');
  assertContainsAll(summaryBody, [
    'message__graph-summary',
    'message__graph-badge',
    'data-action="toggle-call-graph"',
    '调用图',
    '含环'
  ], 'missing call-graph summary contract');
  assertContainsAll(panelBody, [
    'message__graph-panel',
    'message__graph-meta',
    'message__graph-details',
    'renderGraphDetailGroups(callGraph)',
    '查看结构详情'
  ], 'missing call-graph panel contract');
});

test('React 页面通过事件代理支持消息调用图单开展开/收起', () => {
  const html = readPublicFile('public', 'index.html');

  assertContainsAll(html, [
    'messagesEl.addEventListener(\'click\'',
    'data-action="toggle-call-graph"',
    'message__graph-panel',
    'panel.setAttribute(\'hidden\', \'\');',
    'target.textContent = \'收起\';'
  ], 'missing delegated call-graph toggle contract');
});

test('React 页面在调用图面板提供迷你图 canvas/svg 渲染入口', () => {
  const html = readPublicFile('public', 'index.html');
  const panelBody = getFunctionBody(html, 'renderMessageGraphPanel');
  const svgBody = getFunctionBody(html, 'renderMessageGraphSvg');

  assertContainsAll(html, [
    'renderMessageGraphCanvas(',
    'renderMessageGraphSvg(',
    'message__graph-canvas-wrap',
    'message__graph-toolbar',
    'message__graph-btn',
    'message__graph-svg',
    'data-node-id'
  ], 'missing mini-graph canvas/svg markup contract inside call-graph panel');
  assert.ok(html.includes('data-graph-mode="${graphMode}"'), 'should mark canvas with graph mode attribute');
  assert.ok(html.includes('disabled aria-disabled="true"'), 'toolbar buttons should be explicitly unavailable for now');

  assertContainsAll(panelBody, [
    'renderMessageGraphCanvas(',
    'message__graph-mini'
  ], 'missing mini-graph wiring inside renderMessageGraphPanel');
  assert.ok(html.includes('message__graph-edge--loopback'), 'should render loopback class on mini-graph edge paths');
  assert.ok(svgBody.includes('viewBoxWidth'), 'svg helper should use computed viewBox width');
  assert.ok(svgBody.includes('viewBoxHeight'), 'svg helper should use computed viewBox height');
  assert.ok(svgBody.includes('data-message-id'), 'svg helper should expose the message id attribute');
  assert.ok(svgBody.includes('data-graph-mode="${graphMode}"'), 'svg helper should carry the graph mode attribute');
  assert.ok(svgBody.includes('data-graph-node-role="'), 'svg nodes should expose the role hook for future styling');
  const offsetMatches = svgBody.match(/NODE_CENTER_OFFSET/g) || [];
  assert.ok(offsetMatches.length >= 2, 'svg helper should use NODE_CENTER_OFFSET for both edges and nodes');
});

test('迷你图样式包含 loopback 线条', () => {
  const css = readPublicFile('public', 'styles.css');
  assert.ok(css.includes('.message__graph-edge--loopback'), 'should style .message__graph-edge--loopback');
});

test('迷你图 canvas 与工具栏样式存在', () => {
  const css = readPublicFile('public', 'styles.css');
  assert.ok(css.includes('.message__graph-canvas-wrap {'), 'should style .message__graph-canvas-wrap');
  assert.ok(css.includes('.message__graph-toolbar {'), 'should style .message__graph-toolbar');
  assert.ok(css.includes('.message__graph-btn {'), 'should style .message__graph-btn');
});

test('React 页面在迷你图工具栏提供展开与重置操作', () => {
  const html = readPublicFile('public', 'index.html');

  assertContainsAll(html, [
    'data-action="expand-call-graph"',
    'data-action="reset-call-graph-view"'
  ], 'missing expand/reset toolbar contract for mini-graph');
});

test('React 页面为调用图迷你图提供纯布局 helper 合约', () => {
  const html = readPublicFile('public', 'index.html');
  const selectBody = getFunctionBody(html, 'selectCoreGraph');
  const assignBody = getFunctionBody(html, 'assignGraphDepths');
  const layoutBody = getFunctionBody(html, 'layoutGraphNodes');
  const edgeBody = getFunctionBody(html, 'buildGraphEdgePaths');

  assertContainsAll(selectBody, [
    'nodeIndex',
    'MINI_GRAPH_CORE_LIMIT',
    'focusNodeId',
    'neighborMap',
    'enqueue'
  ], 'missing selectCoreGraph focus/core limit contract');

  assertContainsAll(assignBody, [
    'const incoming',
    'depthMap',
    'depth += 1',
    'column:'
  ], 'missing assignGraphDepths column/depth contract');

  assertContainsAll(layoutBody, [
    'spacingX',
    'spacingY',
    'layoutNodes',
    'columnHeights'
  ], 'missing layoutGraphNodes spacing contract');

  assertContainsAll(edgeBody, [
    'loopback',
    'edge.isCycleEdge',
    'M${',
    'L${'
  ], 'missing buildGraphEdgePaths path/loop contract');
});

test('selectCoreGraph 构建焦点邻居核心图', () => {
  const html = readPublicFile('public', 'index.html');
  const selectBody = getFunctionBody(html, 'selectCoreGraph');
  const safeSelectBody = selectBody.replace('function selectCoreGraph', 'function selectCoreGraphFn');
  const selectCoreGraph = eval(`const MINI_GRAPH_CORE_LIMIT = 8; ${safeSelectBody}; selectCoreGraphFn;`);
  const callGraph = {
    focusNodeId: 'node:focus',
    nodes: [
      { id: 'node:focus', label: 'focus' },
      { id: 'node:a', label: 'A' },
      { id: 'node:b', label: 'B' },
      { id: 'node:c', label: 'C' },
      { id: 'node:d', label: 'D' }
    ],
    edges: [
      { id: 'edge:1', from: 'node:focus', to: 'node:a' },
      { id: 'edge:2', from: 'node:b', to: 'node:focus' },
      { id: 'edge:3', from: 'node:focus', to: 'node:c' },
      { id: 'edge:4', from: 'node:d', to: 'node:b' }
    ]
  };

  const core = selectCoreGraph(callGraph);
  assert.ok(core);
  assert.equal(core.focusNodeId, 'node:focus');
  assert.equal(core.nodes[0].id, 'node:focus');
  assert.ok(core.nodes.some(node => node.id === 'node:a'));
  assert.ok(core.nodes.some(node => node.id === 'node:b'));
  assert.ok(core.nodes.some(node => node.id === 'node:c'));
  assert.ok(core.edges.every(edge => core.nodes.some(node => node.id === edge.from) && core.nodes.some(node => node.id === edge.to)));
});

test('React 页面会在当前会话设置中支持“不限制”语义并从会话数据同步状态', () => {
  const html = readPublicFile('public', 'index.html');
  const sessionSettingsCardBody = getArrowComponentBody(html, 'SessionSettingsCard');
  const renderBody = getFunctionBody(html, 'renderSessionSettings');
  const loadHistoryBody = getFunctionBody(html, 'loadHistory');

  assert.ok(sessionSettingsCardBody.includes('不限制'), 'should render the unlimited toggle label inside the settings block');
  assert.ok(sessionSettingsCardBody.includes('data-session-setting-row="agentChainMaxCallsPerAgent"'), 'should keep the bounded/unbounded same-agent limit row under a stable marker');
  assertContainsAll(renderBody, [
    'const isUnlimited = agentChainMaxCallsPerAgent === null;',
    'el.hidden = isUnlimited;'
  ], 'missing unlimited render-state behavior');
  assertContainsAll(loadHistoryBody, [
    'chatSessions = data.chatSessions || [];',
    'activeSessionId = data.activeSessionId || null;',
    'syncSessionSettingsState(data.session || null);'
  ], 'missing history hydration for session settings');
});

test('React 页面会在移动端会话面板中复用同一当前会话设置组件', () => {
  const html = readPublicFile('public', 'index.html');
  const sessionSettingsCardBody = getArrowComponentBody(html, 'SessionSettingsCard');

  assert.equal(countMatches(html, /<SessionSettingsCard\s+variant="mobile"\s*\/>/g), 1, 'mobile sessions panel should render the shared settings component once');
  assert.match(sessionSettingsCardBody, /data-session-setting-action="saveAgentChainMaxHops"/, 'shared settings component should expose a stable save marker for the hop control');
  assert.match(sessionSettingsCardBody, /data-session-setting-action="saveAgentChainMaxCallsPerAgent"/, 'shared settings component should expose a stable save marker for the same-agent control');
});

test('React 页面会在当前会话设置中暴露讨论模式控制，并从历史记录同步讨论状态', () => {
  const html = readPublicFile('public', 'index.html');
  const sessionSettingsCardBody = getArrowComponentBody(html, 'SessionSettingsCard');
  const syncBody = getFunctionBody(html, 'syncSessionSettingsState');
  const loadHistoryBody = getFunctionBody(html, 'loadHistory');

  assert.match(sessionSettingsCardBody, /data-session-setting="discussionMode"/, 'shared settings component should expose a stable marker for discussion mode');
  assertContainsAll(sessionSettingsCardBody, [
    '经典链式',
    '对等讨论'
  ], 'missing discussion mode labels');
  assertContainsAll(syncBody, [
    "discussionMode = session && session.discussionMode === 'peer' ? 'peer' : 'classic';",
    "discussionState = session && typeof session.discussionState === 'string' ? session.discussionState : 'active';"
  ], 'missing discussion mode/state sync behavior');
  assertContainsAll(loadHistoryBody, [
    'chatSessions = data.chatSessions || [];',
    'activeSessionId = data.activeSessionId || null;',
    'syncSessionSettingsState(data.session || null);'
  ], 'missing history hydration path for discussion state');
});

test('React 页面会在对等讨论暂停时渲染暂停卡片，并将摘要按钮绑定到 /api/chat-summary', () => {
  const html = readPublicFile('public', 'index.html');
  const renderBody = getFunctionBody(html, 'renderMessages');
  const pauseCardBody = getFunctionBody(html, 'renderDiscussionPauseCard');
  const summaryBody = getFunctionBody(html, 'requestDiscussionSummary');
  const loadHistoryBody = getFunctionBody(html, 'loadHistory');

  assert.ok(renderBody.includes("discussionMode === 'peer' && discussionState === 'paused'"), 'should gate pause-card rendering on peer paused sessions');
  assert.ok(renderBody.includes("if (history.length === 0 && enabledAgents.size === 0 && !(discussionMode === 'peer' && discussionState === 'paused')) {"), 'should not early-return past the pause card for empty paused peer sessions');
  assert.ok(renderBody.includes("if (history.length === 0 && !(discussionMode === 'peer' && discussionState === 'paused')) {"), 'should not append the generic welcome state for empty paused peer sessions');
  assert.ok(pauseCardBody.includes('data-session-pause-card'), 'should expose a stable pause-card marker');
  assertContainsAll(pauseCardBody, [
    '讨论已暂停',
    '生成摘要',
    'window.requestDiscussionSummary && window.requestDiscussionSummary()'
  ], 'missing paused discussion card contract');
  assertContainsAll(summaryBody, [
    "fetch('/api/chat-summary', {",
    'sessionId: activeSessionId',
    "const historyLoaded = await loadHistory();",
    "if (!historyLoaded) {",
    "throw new Error('刷新会话状态失败');"
  ], 'missing discussion summary binding');
  assertContainsAll(loadHistoryBody, [
    'return true;',
    'return false;'
  ], 'missing explicit history refresh success/failure contract');
});

test('React 页面在会话设置保存失败时会回滚到服务端会话状态并弹出错误提示', () => {
  const html = readPublicFile('public', 'index.html');
  const saveBody = getFunctionBody(html, 'saveSessionSettings');
  const unlimitedToggleBody = getFunctionBody(html, 'handleAgentChainUnlimitedToggle');
  const syncBody = getFunctionBody(html, 'syncSessionSettingsState');

  assertContainsAll(saveBody, [
    'syncSessionSettingsState(data.session);',
    'await loadHistory();',
    "setSessionSettingsFeedback(error.message || '保存失败', 'error');",
    "alert(error.message || '保存失败');"
  ], 'missing save rollback behavior');
  assert.ok(unlimitedToggleBody.includes('renderSessionSettings();'), 'failed or deferred unlimited-toggle flow should restore row visibility from shared state');
  assert.ok(syncBody.includes("setSessionSettingsFeedback('');"), 'session sync should clear stale success and error feedback');
});

test('React 页面会使用同步后的会话设置状态保存，避免在桌面和移动端之间串用旧输入值', () => {
  const html = readPublicFile('public', 'index.html');
  const sessionSettingsCardBody = getArrowComponentBody(html, 'SessionSettingsCard');
  const hopsSaveBody = getFunctionBody(html, 'saveAgentChainMaxHops');
  const callsSaveBody = getFunctionBody(html, 'saveAgentChainMaxCallsPerAgent');

  assert.match(sessionSettingsCardBody, /data-session-setting-action="saveAgentChainMaxHops"/, 'should expose a stable action marker for hop-limit saves');
  assert.match(sessionSettingsCardBody, /data-session-setting-action="saveAgentChainMaxCallsPerAgent"/, 'should expose a stable action marker for same-agent-limit saves');
  assertContainsAll(hopsSaveBody, ["parsePositiveIntegerSetting(agentChainMaxHops, '最多传播轮数')"], 'missing synchronized hop save behavior');
  assertContainsAll(callsSaveBody, ["parsePositiveIntegerSetting(agentChainMaxCallsPerAgent, '单个智能体最多调用次数')"], 'missing synchronized same-agent save behavior');
  assertOmitsAll(hopsSaveBody, ['.find('], 'hop-limit saves should not scan duplicated inputs');
  assertOmitsAll(callsSaveBody, ['.find('], 'same-agent-limit saves should not scan duplicated inputs');
});

test('React 页面会用触发变更的复选框显式状态处理“不限制”切换，避免扫描重复控件', () => {
  const html = readPublicFile('public', 'index.html');
  const bindDomEventsBody = getFunctionBody(html, 'bindDomEvents');
  const unlimitedToggleBody = getFunctionBody(html, 'handleAgentChainUnlimitedToggle');

  assert.ok(bindDomEventsBody.includes('handleAgentChainUnlimitedToggle(el.checked)'), 'checkbox bindings should pass the explicit checked state through the DOM event binder');
  assert.doesNotMatch(html, /onChange=\{\(event\)\s*=>\s*window\.handleAgentChainUnlimitedToggle/, 'should not duplicate the unlimited toggle binding inline');
  assert.ok(unlimitedToggleBody.includes('function handleAgentChainUnlimitedToggle(isUnlimited)'), 'unlimited toggle handler should accept explicit toggle state');
  assertOmitsAll(unlimitedToggleBody, ['agentChainMaxCallsUnlimitedInputEls.some('], 'unlimited toggle handler should not scan duplicate checkboxes');
});
