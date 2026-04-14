const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createAuthAdminFixture } = require('./helpers/auth-admin-fixture');

const repoRoot = path.resolve(__dirname, '..', '..');
const frontendDistDir = path.join(repoRoot, 'dist', 'frontend');

function readBuiltFrontendFile(fileName) {
  return fs.readFileSync(path.join(frontendDistDir, fileName), 'utf8');
}

function readSourceFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('admin shell entrypoints now serve the built frontend page for nested admin routes', async () => {
  const builtAdminHtml = readBuiltFrontendFile('admin.html');
  assert.match(builtAdminHtml, /<meta name="agent-co-page" content="admin"\s*\/>/);

  const fixture = await createAuthAdminFixture();
  try {
    const rootResponse = await fetch(`http://127.0.0.1:${fixture.port}/admin`);
    const nestedResponse = await fetch(`http://127.0.0.1:${fixture.port}/admin/agents`);
    const editResponse = await fetch(`http://127.0.0.1:${fixture.port}/admin/users/demo/edit`);
    const rootHtml = await rootResponse.text();
    const nestedHtml = await nestedResponse.text();
    const editHtml = await editResponse.text();

    assert.equal(rootResponse.status, 200);
    assert.equal(nestedResponse.status, 200);
    assert.equal(editResponse.status, 200);
    assert.equal(nestedHtml, rootHtml);
    assert.equal(editHtml, rootHtml);
  } finally {
    await fixture.cleanup();
  }
});

test('admin React source now routes through AdminApp instead of stacked workspace sections', () => {
  const adminPageSource = readSourceFile('frontend/src/admin/pages/AdminPage.tsx');
  const adminAppSource = readSourceFile('frontend/src/admin/app/AdminApp.tsx');
  const routesSource = readSourceFile('frontend/src/admin/app/admin-routes.ts');

  assert.match(adminPageSource, /return <AdminApp/);
  assert.ok(!adminPageSource.includes('<section id="agents"'));
  assert.match(adminAppSource, /AdminDashboardPage/);
  assert.match(adminAppSource, /AgentsListPage/);
  assert.match(adminAppSource, /ModelConnectionEditPage/);
  assert.match(routesSource, /\/admin\/agents\/new/);
  assert.match(routesSource, /\/admin\/model-connections\//);
  assert.ok(!adminAppSource.includes('public-auth/admin.html'));
  assert.ok(!adminAppSource.includes('restore-template'));
});
