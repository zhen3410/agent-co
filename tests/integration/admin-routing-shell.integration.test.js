const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthAdminFixture } = require('./helpers/auth-admin-fixture');

test('admin nested routes return the same built shell', async () => {
  const fixture = await createAuthAdminFixture();
  try {
    const urls = ['/', '/admin', '/admin/agents', '/admin/users/alice/edit'];
    const responses = await Promise.all(urls.map((pathname) => fetch(`http://127.0.0.1:${fixture.port}${pathname}`)));
    const html = await Promise.all(responses.map((response) => response.text()));
    assert.equal(responses[0].status, 200);
    assert.equal(responses[1].status, 200);
    assert.equal(responses[2].status, 200);
    assert.equal(responses[3].status, 200);
    assert.match(html[0], /<meta name="agent-co-page" content="admin"\s*\/>/);
    assert.equal(html[1], html[0]);
    assert.equal(html[2], html[0]);
    assert.equal(html[3], html[0]);
  } finally {
    await fixture.cleanup();
  }
});
