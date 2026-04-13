const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { createAuthAdminFixture } = require('./helpers/auth-admin-fixture');

const repoRoot = path.resolve(__dirname, '..', '..');
const frontendDistDir = path.join(repoRoot, 'dist', 'frontend');
const moduleCache = new Map();

function readBuiltFrontendFile(fileName) {
  return fs.readFileSync(path.join(frontendDistDir, fileName), 'utf8');
}

function readSourceFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function extractFirstJsAssetPath(html, messagePrefix) {
  const match = html.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/i);
  assert.ok(match, `${messagePrefix}: should reference a bundled /assets/*.js entry script`);
  return match[1];
}

function resolveExistingFile(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  throw new Error(`Cannot resolve module path: ${basePath}`);
}

function loadTsModule(relativePath) {
  const absolutePath = path.resolve(repoRoot, relativePath);
  const resolvedPath = resolveExistingFile(absolutePath);

  if (moduleCache.has(resolvedPath)) {
    return moduleCache.get(resolvedPath);
  }

  const source = fs.readFileSync(resolvedPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true
    },
    fileName: resolvedPath
  });

  const mod = { exports: {} };
  moduleCache.set(resolvedPath, mod.exports);

  const localRequire = (specifier) => {
    if (specifier.endsWith('.css')) {
      return {};
    }

    if (specifier.startsWith('.')) {
      const childBasePath = path.resolve(path.dirname(resolvedPath), specifier);
      const childRelativePath = path.relative(repoRoot, childBasePath);
      return loadTsModule(childRelativePath);
    }

    return require(specifier);
  };

  const fn = new Function('require', 'module', 'exports', '__filename', '__dirname', transpiled.outputText);
  fn(localRequire, mod, mod.exports, resolvedPath, path.dirname(resolvedPath));
  moduleCache.set(resolvedPath, mod.exports);
  return mod.exports;
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

test('admin shell entrypoints now serve the built frontend page instead of removed public-auth html', async () => {
  const builtAdminHtml = readBuiltFrontendFile('admin.html');
  assert.match(builtAdminHtml, /<meta name="agent-co-page" content="admin"\s*\/>/);

  const fixture = await createAuthAdminFixture();

  try {
    const rootResponse = await fetch(`http://127.0.0.1:${fixture.port}/`);
    const indexResponse = await fetch(`http://127.0.0.1:${fixture.port}/index.html`);
    const adminResponse = await fetch(`http://127.0.0.1:${fixture.port}/admin.html`);

    const rootHtml = await rootResponse.text();
    const indexHtml = await indexResponse.text();
    const adminHtml = await adminResponse.text();

    assert.equal(rootResponse.status, 200);
    assert.equal(indexResponse.status, 200);
    assert.equal(adminResponse.status, 200);
    assert.match(rootHtml, /<meta name="agent-co-page" content="admin"\s*\/>/);
    assert.equal(indexHtml, rootHtml, 'admin /index.html should serve the same built shell as /');
    assert.equal(adminHtml, rootHtml, 'admin /admin.html should serve the same built shell as /');

    const adminAssetPath = extractFirstJsAssetPath(rootHtml, 'served admin shell');
    const assetResponse = await fetch(`http://127.0.0.1:${fixture.port}${adminAssetPath}`);
    const assetBody = await assetResponse.text();

    assert.equal(assetResponse.status, 200);
    assert.ok(assetBody.length > 0, 'admin shell asset should not be empty');
  } finally {
    await fixture.cleanup();
  }
});

test('AgentManagementPanel renders the current prompt, workdir, CLI/API, and model-connection controls in the React admin workspace', () => {
  const { AgentManagementPanel } = loadTsModule('frontend/src/admin/features/agents/AgentManagementPanel.tsx');

  const html = renderToStaticMarkup(React.createElement(AgentManagementPanel, {
    agents: [
      {
        name: 'Alice',
        avatar: '🤖',
        personality: 'helper',
        color: '#2563eb',
        systemPrompt: 'You are Alice.',
        workdir: '/workspace/demo',
        executionMode: 'api',
        apiConnectionId: 'primary',
        apiModel: 'gpt-5'
      }
    ],
    pendingReason: null,
    pendingUpdatedAt: null,
    connections: [
      {
        id: 'primary',
        name: 'Primary OpenAI',
        baseURL: 'https://api.example.test',
        apiKeyMasked: 'sk-***',
        enabled: true
      }
    ],
    onCreate: async () => true,
    onUpdate: async () => true,
    onDelete: async () => true,
    onApplyPending: async () => true
  }));

  assert.match(html, /data-admin-form="agent-editor"/);
  assert.match(html, /name="agent-systemPrompt"/);
  assert.match(html, /name="agent-workdir"/);
  assert.match(html, /name="agent-executionMode"/);
  assert.match(html, /name="agent-cliName"/);
  assert.match(html, /name="agent-apiConnectionId"/);
  assert.match(html, /系统提示词/);
  assert.match(html, /Workdir/);
  assert.match(html, /模型连接/);
  assert.match(html, /智能体列表/);
  assert.match(html, /Alice/);
});

test('admin React source keeps agent, group, and model-connection management wired through the current contracts', () => {
  const adminPageSource = readSourceFile('frontend/src/admin/pages/AdminPage.tsx');
  const adminApiSource = readSourceFile('frontend/src/admin/services/admin-api.ts');
  const agentPanelSource = readSourceFile('frontend/src/admin/features/agents/AgentManagementPanel.tsx');

  assertContainsAll(adminPageSource, [
    '<section id="agents">',
    '<section id="groups">',
    '<section id="model-connections">',
    'GroupManagementPanel',
    'ModelConnectionManagementPanel'
  ], 'admin page should keep the current workspace sections');

  assertContainsAll(agentPanelSource, [
    'systemPrompt: formState.systemPrompt.trim()',
    'workdir: formState.workdir.trim()',
    "executionMode: formState.executionMode",
    "apiConnectionId: formState.executionMode === 'api' ? formState.apiConnectionId || undefined : undefined",
    "apiModel: formState.executionMode === 'api' ? formState.apiModel || undefined : undefined"
  ], 'agent management panel should submit the current agent management contract');

  assertContainsAll(adminApiSource, [
    "return request('/api/agents'",
    "return request('/api/groups'",
    "return request('/api/model-connections'"
  ], 'admin API client should target the current management endpoints');

  assertOmitsAll(
    `${adminPageSource}\n${adminApiSource}\n${agentPanelSource}`,
    ['public-auth/admin.html', 'restore-template', 'prompt/template'],
    'admin React sources should not depend on retired legacy admin page contracts'
  );
});
