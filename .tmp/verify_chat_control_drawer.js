const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const logs = [];
  page.on('console', msg => logs.push(`${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => logs.push(`pageerror: ${err.message}`));
  page.setDefaultTimeout(10000);

  await page.goto('http://127.0.0.1:3002/chat.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[name="username"]');
  await page.locator('input[name="username"]').fill('ui_verify');
  await page.locator('input[name="password"]').fill('UiVerify#2026');
  await page.locator('[data-chat-login-action="submit"]').click();
  await page.waitForSelector('[data-chat-page="shell"]');
  await page.waitForTimeout(1500);

  const toggle = page.locator('[data-chat-mobile-toggle="controls"]');
  await toggle.waitFor({ state: 'visible' });
  await page.screenshot({ path: '.tmp/chat-mobile-before-drawer.png', fullPage: true });
  await toggle.click();
  await page.waitForTimeout(350);

  const drawer = page.locator('[data-chat-control-drawer="controls"][data-open="true"]');
  const panel = drawer.locator('.chat-page-shell__drawer-panel');
  await drawer.waitFor({ state: 'visible' });
  await panel.waitFor({ state: 'visible' });
  const panelBox = await panel.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(panelBox, 'panel should have bounding box');
  assert.ok(viewport, 'viewport should exist');
  assert.ok(panelBox.x > 20, `panel should be offset from left edge, x=${panelBox.x}`);
  assert.ok(panelBox.x + panelBox.width >= viewport.width - 2, 'panel right edge should align to viewport');
  assert.ok(panelBox.x + panelBox.width <= viewport.width + 2, 'panel should stay within viewport');

  for (const selector of [
    '[data-chat-toolbar-control="session-select"]',
    '[data-chat-toolbar-control="new-session"]',
    '[data-chat-toolbar-control="agent-select"]',
    '[data-chat-toggle="secondary-panels"]'
  ]) {
    await page.locator(selector).first().waitFor({ state: 'visible' });
  }

  await page.screenshot({ path: '.tmp/chat-mobile-control-drawer.png', fullPage: true });
  console.log(JSON.stringify({ ok: true, viewport, panelBox, logs: logs.slice(0, 10) }, null, 2));
  await browser.close();
})();
