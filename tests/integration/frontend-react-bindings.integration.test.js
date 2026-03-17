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
});
