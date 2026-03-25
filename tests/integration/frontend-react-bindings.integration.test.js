const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

test('React 页面会在收到部分回复后提供继续剩余执行入口，而不是提示手动重发', () => {
  const html = readPublicFile('public', 'index.html');

  assert.ok(html.includes('async function resumePendingChain() {'), 'should provide a resume action for interrupted chains');
  assert.ok(html.includes("fetch('/api/chat-resume', {"), 'resume action should call /api/chat-resume');
  assert.ok(html.includes('function showResumeChainNotice() {'), 'should render a dedicated resume notice');
  assert.ok(html.includes('继续剩余执行'), 'should label the resume action clearly');
  assert.ok(html.includes('本次对话已收到部分回复，连接已中断。'), 'should explain the interrupted-partial-response state');
  assert.ok(!html.includes('如需继续，请手动再发一次。'), 'should no longer instruct users to manually resend');
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

test('React 页面会将 AI 回复按 Markdown 渲染并保留用户纯文本换行', () => {
  const html = readPublicFile('public', 'index.html');
  const plainTextBody = getFunctionBody(html, 'renderPlainText');
  const markdownBody = getFunctionBody(html, 'renderMarkdown');

  assertContainsAll(plainTextBody, [
    'function renderPlainText(text) {',
    'escapeHtml(text)',
    "replace(/\\n/g, '<br>')"
  ], 'missing plain-text renderer contract');
  assertContainsAll(markdownBody, [
    'function renderMarkdown(text) {',
    "escapeHtml((text || '').replace(/\\r\\n/g, '\\n'))",
    'function formatInline(line) {',
    ".replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')",
    ".replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)/g, '<a href=\"$2\" target=\"_blank\" rel=\"noopener noreferrer\">$1</a>')"
  ], 'missing markdown renderer contract');
  assertContainsAll(html, [
    'message__text message__text--markdown',
    "${highlightMentions(renderPlainText(msg.text || ''))}",
    "${renderMarkdown(msg.text || '')}"
  ], 'missing message rendering contract');
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
