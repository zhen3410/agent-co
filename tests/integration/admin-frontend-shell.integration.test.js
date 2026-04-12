const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthAdminFixture } = require('./helpers/auth-admin-fixture');

function extractFirstJsAssetPath(html) {
  const match = html.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/i);
  assert.ok(match, 'admin shell should reference a bundled /assets/*.js entry script');
  return match[1];
}

test('admin 服务在管理入口 URL 返回 Vite 构建 shell，并可访问 /assets 静态资源', async () => {
  const fixture = await createAuthAdminFixture();

  try {
    const adminResponse = await fetch(`http://127.0.0.1:${fixture.port}/admin.html`);
    const adminHtml = await adminResponse.text();

    assert.equal(adminResponse.status, 200);
    assert.match(adminResponse.headers.get('content-type') || '', /text\/html/i);
    assert.match(adminHtml, /<meta name="agent-co-page" content="admin"\s*\/>/);

    const assetPath = extractFirstJsAssetPath(adminHtml);
    const assetResponse = await fetch(`http://127.0.0.1:${fixture.port}${assetPath}`);
    const assetBody = await assetResponse.text();

    assert.equal(assetResponse.status, 200);
    assert.match(assetResponse.headers.get('content-type') || '', /javascript/i);
    assert.ok(assetBody.length > 0, 'admin asset body should not be empty');
  } finally {
    await fixture.cleanup();
  }
});
