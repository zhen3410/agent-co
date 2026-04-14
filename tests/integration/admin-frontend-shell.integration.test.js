const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const ts = require('typescript');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const { createAuthAdminFixture } = require('./helpers/auth-admin-fixture');

const rootDir = path.resolve(__dirname, '../..');
const moduleCache = new Map();
const { act } = TestRenderer;

function extractFirstJsAssetPath(html) {
  const match = html.match(/<script[^>]+src="(\/assets\/[^\"]+\.js)"/i);
  assert.ok(match, 'admin shell should reference a bundled /assets/*.js entry script');
  return match[1];
}

function resolveExistingFile(basePath) {
  const candidates = [basePath, `${basePath}.ts`, `${basePath}.tsx`, `${basePath}.js`, path.join(basePath, 'index.ts'), path.join(basePath, 'index.tsx')];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  throw new Error(`Cannot resolve module path: ${basePath}`);
}

function loadTsModule(relativePath) {
  const absolutePath = path.resolve(rootDir, relativePath);
  const resolvedPath = resolveExistingFile(absolutePath);
  if (moduleCache.has(resolvedPath)) {
    return moduleCache.get(resolvedPath);
  }
  const source = fs.readFileSync(resolvedPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: resolvedPath
  });
  const mod = { exports: {} };
  moduleCache.set(resolvedPath, mod.exports);
  const localRequire = (specifier) => {
    if (specifier.endsWith('.css')) {
      return {};
    }
    if (specifier.startsWith('.')) {
      return loadTsModule(path.relative(rootDir, path.resolve(path.dirname(resolvedPath), specifier)));
    }
    return require(specifier);
  };
  const fn = new Function('require', 'module', 'exports', '__filename', '__dirname', transpiled.outputText);
  fn(localRequire, mod, mod.exports, resolvedPath, path.dirname(resolvedPath));
  moduleCache.set(resolvedPath, mod.exports);
  return mod.exports;
}

function collectText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(collectText).join(' ');
  return collectText(node.children || []);
}

async function flushEffects() {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

async function renderAdminPage(props = {}) {
  const { AdminPage } = loadTsModule('frontend/src/admin/pages/AdminPage.tsx');
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(AdminPage, props));
    await flushEffects();
  });
  return renderer;
}

function findByName(renderer, name) {
  return renderer.root.findByProps({ name });
}

async function changeField(renderer, name, value, checked) {
  await act(async () => {
    findByName(renderer, name).props.onChange({ target: { name, value, type: typeof checked === 'boolean' ? 'checkbox' : 'text', checked } });
    await flushEffects();
  });
}

async function submitForm(renderer, formName) {
  await act(async () => {
    renderer.root.findByProps({ 'data-admin-form': formName }).props.onSubmit({ preventDefault() {} });
    await flushEffects();
  });
}

test('admin 服务在管理入口 URL 返回 Vite 构建 shell，并可访问 /assets 静态资源', async () => {
  const fixture = await createAuthAdminFixture();
  try {
    const rootResponse = await fetch(`http://127.0.0.1:${fixture.port}/`);
    const rootHtml = await rootResponse.text();
    assert.equal(rootResponse.status, 200);
    assert.match(rootHtml, /<meta name="agent-co-page" content="admin"\s*\/>/);
    const assetPath = extractFirstJsAssetPath(rootHtml);
    const assetResponse = await fetch(`http://127.0.0.1:${fixture.port}${assetPath}`);
    assert.equal(assetResponse.status, 200);
  } finally {
    await fixture.cleanup();
  }
});

test('admin 入口 URL 在缺失前端构建产物时返回清晰错误', async () => {
  const isolatedFrontendRoot = fs.mkdtempSync(path.join(tmpdir(), 'agent-co-admin-frontend-missing-'));
  let fixture = null;
  try {
    fixture = await createAuthAdminFixture({ env: { AGENT_CO_FRONTEND_DIST_DIR: isolatedFrontendRoot } });
    const response = await fetch(`http://127.0.0.1:${fixture.port}/`);
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.match(String(body.error || ''), /前端构建产物缺失/);
    assert.match(String(body.error || ''), /admin\.html/);
  } finally {
    if (fixture) await fixture.cleanup();
    fs.rmSync(isolatedFrontendRoot, { recursive: true, force: true });
  }
});

test('authenticated AdminPage 渲染轻量 dashboard，并加载四类资源导航', async () => {
  const calls = [];
  const api = {
    async listUsers() { calls.push('users'); return { users: [{ username: 'admin', createdAt: 1, updatedAt: 2 }] }; },
    async createUser() { throw new Error('not used'); },
    async updateUserPassword() { throw new Error('not used'); },
    async deleteUser() { throw new Error('not used'); },
    async listAgents() { calls.push('agents'); return { agents: [{ name: 'planner', avatar: '🧭', personality: '计划', color: '#111827', systemPrompt: 'plan', executionMode: 'cli', cliName: 'codex' }], pendingAgents: null, pendingReason: '等待应用', pendingUpdatedAt: 123 }; },
    async createAgent() { throw new Error('not used'); },
    async updateAgent() { throw new Error('not used'); },
    async deleteAgent() { throw new Error('not used'); },
    async applyPendingAgents() { throw new Error('not used'); },
    async listGroups() { calls.push('groups'); return { groups: [{ id: 'core', name: '核心组', icon: '🧩', agentNames: ['planner'] }], updatedAt: 1 }; },
    async createGroup() { throw new Error('not used'); },
    async updateGroup() { throw new Error('not used'); },
    async deleteGroup() { throw new Error('not used'); },
    async listModelConnections() { calls.push('model-connections'); return { connections: [{ id: 'conn-1', name: 'Primary', baseURL: 'https://models.example.com/v1', apiKeyMasked: 'sk-***', enabled: true, createdAt: 1, updatedAt: 2 }] }; },
    async createModelConnection() { throw new Error('not used'); },
    async updateModelConnection() { throw new Error('not used'); },
    async deleteModelConnection() { throw new Error('not used'); },
    async testModelConnection() { throw new Error('not used'); }
  };

  const renderer = await renderAdminPage({ api, initialAuthToken: 'token-123', initialPathname: '/admin' });
  const text = collectText(renderer.toJSON());
  const navItems = renderer.root.findAll((node) => typeof node.props?.['data-admin-nav'] === 'string');
  const consoleShell = renderer.root.findByProps({ 'data-admin-page': 'console' });

  assert.equal(new Set(calls).size, 4);
  assert.equal(consoleShell.props['data-admin-density'], 'console');
  assert.match(text, /管理台/);
  assert.match(text, /待处理/);
  assert.match(text, /最近改动/);
  assert.deepEqual(navItems.map((node) => node.props['data-admin-nav']), ['agents', 'groups', 'users', 'model-connections']);
});

test('AdminPage 在未认证时仍保留 console shell，并提供稳定的 auth 入口区域', async () => {
  const renderer = await renderAdminPage({ initialPathname: '/admin' });
  const text = collectText(renderer.toJSON());
  const consoleShell = renderer.root.findByProps({ 'data-admin-page': 'console' });
  const authEntryRegion = renderer.root.findByProps({ 'data-admin-region': 'auth-entry' });
  assert.equal(consoleShell.props['data-admin-density'], 'console');
  assert.equal(authEntryRegion.type, 'section');
  assert.match(text, /管理员 Token/);
  assert.match(text, /连接后台/);
});

test('编辑保存失败时保留当前草稿与编辑态，避免静默清空表单', async () => {
  const api = {
    async listUsers() { return { users: [{ username: 'admin', createdAt: 1, updatedAt: 2 }] }; },
    async createUser() { throw new Error('not used'); },
    async updateUserPassword() { throw new Error('not used'); },
    async deleteUser() { throw new Error('not used'); },
    async listAgents() { return { agents: [], pendingAgents: null, pendingReason: null, pendingUpdatedAt: null }; },
    async createAgent() { throw new Error('not used'); },
    async updateAgent() { throw new Error('not used'); },
    async deleteAgent() { throw new Error('not used'); },
    async applyPendingAgents() { throw new Error('not used'); },
    async listGroups() { return { groups: [], updatedAt: 1 }; },
    async createGroup() { throw new Error('not used'); },
    async updateGroup() { throw new Error('not used'); },
    async deleteGroup() { throw new Error('not used'); },
    async listModelConnections() { return { connections: [{ id: 'conn-1', name: 'Primary', baseURL: 'https://models.example.com/v1', apiKeyMasked: 'sk-***', enabled: true, createdAt: 1, updatedAt: 2 }] }; },
    async createModelConnection() { throw new Error('not used'); },
    async updateModelConnection() { throw new Error('连接更新失败'); },
    async deleteModelConnection() { throw new Error('not used'); },
    async testModelConnection() { throw new Error('not used'); }
  };

  const renderer = await renderAdminPage({ api, initialAuthToken: 'token-123', initialPathname: '/admin/model-connections/conn-1/edit' });
  await changeField(renderer, 'connection-baseURL', 'https://broken.example.com/v2');
  await submitForm(renderer, 'model-connection-editor');
  const notice = renderer.root.findByProps({ 'data-admin-notice': 'true' });
  assert.equal(notice.props['data-tone'], 'error');
  assert.match(collectText(notice.children), /连接更新失败/);
  assert.equal(findByName(renderer, 'connection-baseURL').props.value, 'https://broken.example.com/v2');
});

test('编辑模型连接时留空 API Key 会保留现有密钥，而不是发送空字符串', async () => {
  let receivedDraft = null;
  const api = {
    async listUsers() { return { users: [{ username: 'admin', createdAt: 1, updatedAt: 2 }] }; },
    async createUser() { throw new Error('not used'); },
    async updateUserPassword() { throw new Error('not used'); },
    async deleteUser() { throw new Error('not used'); },
    async listAgents() { return { agents: [], pendingAgents: null, pendingReason: null, pendingUpdatedAt: null }; },
    async createAgent() { throw new Error('not used'); },
    async updateAgent() { throw new Error('not used'); },
    async deleteAgent() { throw new Error('not used'); },
    async applyPendingAgents() { throw new Error('not used'); },
    async listGroups() { return { groups: [], updatedAt: 1 }; },
    async createGroup() { throw new Error('not used'); },
    async updateGroup() { throw new Error('not used'); },
    async deleteGroup() { throw new Error('not used'); },
    async listModelConnections() { return { connections: [{ id: 'conn-1', name: 'Primary', baseURL: 'https://models.example.com/v1', apiKeyMasked: 'sk-***', enabled: true, createdAt: 1, updatedAt: 2 }] }; },
    async createModelConnection() { throw new Error('not used'); },
    async updateModelConnection(id, draft) { receivedDraft = { id, draft }; return { success: true, connection: { id, name: 'Primary', baseURL: draft.baseURL, apiKeyMasked: 'sk-***', enabled: draft.enabled, createdAt: 1, updatedAt: 3 } }; },
    async deleteModelConnection() { throw new Error('not used'); },
    async testModelConnection() { throw new Error('not used'); }
  };

  const renderer = await renderAdminPage({ api, initialAuthToken: 'token-123', initialPathname: '/admin/model-connections/conn-1/edit' });
  await changeField(renderer, 'connection-baseURL', 'https://models.example.com/v2');
  await submitForm(renderer, 'model-connection-editor');
  assert.deepEqual(receivedDraft, { id: 'conn-1', draft: { name: 'Primary', baseURL: 'https://models.example.com/v2', enabled: true } });
});

test('编辑 API 智能体时会保留未暴露在表单中的温度与 token 上限配置', async () => {
  let updatedPayload = null;
  const api = {
    async listUsers() { return { users: [] }; },
    async createUser() { throw new Error('not used'); },
    async updateUserPassword() { throw new Error('not used'); },
    async deleteUser() { throw new Error('not used'); },
    async listAgents() { return { agents: [{ name: 'api-bot', avatar: '🤖', personality: 'api', color: '#123456', systemPrompt: 'prompt', workdir: '/tmp/demo', executionMode: 'api', apiConnectionId: 'conn-1', apiModel: 'gpt-5', apiTemperature: 0.2, apiMaxTokens: 1024 }], pendingAgents: null, pendingReason: null, pendingUpdatedAt: null }; },
    async createAgent() { throw new Error('not used'); },
    async updateAgent(name, input) { updatedPayload = { name, input }; return { success: true, applyMode: 'immediate', agent: input.agent }; },
    async deleteAgent() { throw new Error('not used'); },
    async applyPendingAgents() { throw new Error('not used'); },
    async listGroups() { return { groups: [], updatedAt: 1 }; },
    async createGroup() { throw new Error('not used'); },
    async updateGroup() { throw new Error('not used'); },
    async deleteGroup() { throw new Error('not used'); },
    async listModelConnections() { return { connections: [{ id: 'conn-1', name: 'Primary', baseURL: 'https://models.example.com/v1', apiKeyMasked: 'sk-***', enabled: true, createdAt: 1, updatedAt: 2 }] }; },
    async createModelConnection() { throw new Error('not used'); },
    async updateModelConnection() { throw new Error('not used'); },
    async deleteModelConnection() { throw new Error('not used'); },
    async testModelConnection() { throw new Error('not used'); }
  };

  const renderer = await renderAdminPage({ api, initialAuthToken: 'token-123', initialPathname: '/admin/agents/api-bot/edit' });
  await changeField(renderer, 'agent-apiModel', 'gpt-5.1');
  await submitForm(renderer, 'agent-editor');
  assert.equal(updatedPayload.name, 'api-bot');
  assert.equal(updatedPayload.input.agent.apiTemperature, 0.2);
  assert.equal(updatedPayload.input.agent.apiMaxTokens, 1024);
  assert.equal(updatedPayload.input.agent.apiModel, 'gpt-5.1');
});
