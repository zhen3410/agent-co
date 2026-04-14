const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);

  await page.goto('http://127.0.0.1:3002/chat.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[name="username"]');
  await page.locator('input[name="username"]').fill('ui_verify');
  await page.locator('input[name="password"]').fill('UiVerify#2026');
  await page.locator('[data-chat-login-action="submit"]').click();
  await page.waitForSelector('[data-chat-page="shell"]');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: '.tmp/chat-mobile-before-drawer-refined.png', fullPage: true });

  await page.locator('[data-chat-mobile-toggle="controls"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: '.tmp/chat-mobile-control-drawer-refined.png', fullPage: true });

  const panel = page.locator('[data-chat-control-drawer="controls"] .chat-page-shell__drawer-panel');
  const panelBox = await panel.boundingBox();
  console.log(JSON.stringify({ panelBox }, null, 2));
  await browser.close();
})();
