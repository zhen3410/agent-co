const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatServerFixture } = require('./helpers/chat-server-fixture');

function extractFirstJsAssetPath(html) {
  const match = html.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/i);
  assert.ok(match, 'chat shell should reference a bundled /assets/*.js entry script');
  return match[1];
}

test('chat 服务在主入口 URL 返回 Vite 构建 shell，并可访问 /assets 静态资源', async () => {
  const fixture = await createChatServerFixture();

  try {
    const homeResponse = await fetch(`http://127.0.0.1:${fixture.port}/`);
    const homeHtml = await homeResponse.text();

    assert.equal(homeResponse.status, 200);
    assert.match(homeResponse.headers.get('content-type') || '', /text\/html/i);
    assert.match(homeHtml, /<meta name="agent-co-page" content="chat"\s*\/>/);

    const assetPath = extractFirstJsAssetPath(homeHtml);
    const assetResponse = await fetch(`http://127.0.0.1:${fixture.port}${assetPath}`);
    const assetBody = await assetResponse.text();

    assert.equal(assetResponse.status, 200);
    assert.match(assetResponse.headers.get('content-type') || '', /javascript/i);
    assert.ok(assetBody.length > 0, 'chat asset body should not be empty');
  } finally {
    await fixture.cleanup();
  }
});
