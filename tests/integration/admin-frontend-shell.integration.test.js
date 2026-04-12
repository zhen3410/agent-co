const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createAuthAdminFixture } = require('./helpers/auth-admin-fixture');

function extractFirstJsAssetPath(html) {
  const match = html.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/i);
  assert.ok(match, 'admin shell should reference a bundled /assets/*.js entry script');
  return match[1];
}

test('admin 服务在管理入口 URL 返回 Vite 构建 shell，并可访问 /assets 静态资源', async () => {
  const fixture = await createAuthAdminFixture();

  try {
    const rootResponse = await fetch(`http://127.0.0.1:${fixture.port}/`);
    const rootHtml = await rootResponse.text();

    assert.equal(rootResponse.status, 200);
    assert.match(rootResponse.headers.get('content-type') || '', /text\/html/i);
    assert.match(rootHtml, /<meta name="agent-co-page" content="admin"\s*\/>/);

    const indexResponse = await fetch(`http://127.0.0.1:${fixture.port}/index.html`);
    const indexHtml = await indexResponse.text();

    assert.equal(indexResponse.status, 200);
    assert.match(indexResponse.headers.get('content-type') || '', /text\/html/i);
    assert.match(indexHtml, /<meta name="agent-co-page" content="admin"\s*\/>/);
    assert.equal(indexHtml, rootHtml, 'admin / and /index.html should serve the same built shell');

    const assetPath = extractFirstJsAssetPath(rootHtml);
    const assetResponse = await fetch(`http://127.0.0.1:${fixture.port}${assetPath}`);
    const assetBody = await assetResponse.text();

    assert.equal(assetResponse.status, 200);
    assert.match(assetResponse.headers.get('content-type') || '', /javascript/i);
    assert.ok(assetBody.length > 0, 'admin asset body should not be empty');
  } finally {
    await fixture.cleanup();
  }
});

test('admin 入口 URL 在缺失前端构建产物时返回清晰错误', async () => {
  const adminShellPath = path.join(process.cwd(), 'dist', 'frontend', 'admin.html');
  const backupPath = `${adminShellPath}.bak.integration`;
  fs.renameSync(adminShellPath, backupPath);

  let fixture = null;
  try {
    fixture = await createAuthAdminFixture();
    const response = await fetch(`http://127.0.0.1:${fixture.port}/`);
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.match(String(body.error || ''), /前端构建产物缺失/);
    assert.match(String(body.error || ''), /admin\.html/);
  } finally {
    if (fixture) {
      await fixture.cleanup();
    }
    fs.renameSync(backupPath, adminShellPath);
  }
});
