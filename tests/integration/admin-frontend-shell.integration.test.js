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
  const match = html.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/i);
  assert.ok(match, 'admin shell should reference a bundled /assets/*.js entry script');
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
  const absolutePath = path.resolve(rootDir, relativePath);
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
    if (specifier.startsWith('.')) {
      const childBasePath = path.resolve(path.dirname(resolvedPath), specifier);
      const childRelativePath = path.relative(rootDir, childBasePath);
      return loadTsModule(childRelativePath);
    }

    return require(specifier);
  };

  const fn = new Function('require', 'module', 'exports', '__filename', '__dirname', transpiled.outputText);
  fn(localRequire, mod, mod.exports, resolvedPath, path.dirname(resolvedPath));
  moduleCache.set(resolvedPath, mod.exports);
  return mod.exports;
}

function collectText(node) {
  if (!node) {
    return '';
  }

  if (typeof node === 'string') {
    return node;
  }

  if (Array.isArray(node)) {
    return node.map(collectText).join(' ');
  }

  return collectText(node.children || []);
}

function headersToObject(headers) {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  return { ...headers };
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

function findByAction(renderer, action) {
  return renderer.root.findByProps({ 'data-admin-action': action });
}

function findButtonByText(renderer, label) {
  return renderer.root.find((node) => node.type === 'button' && collectText(node.children).includes(label));
}

async function changeField(renderer, name, value) {
  await act(async () => {
    findByName(renderer, name).props.onChange({
      target: {
        name,
        value,
        checked: Boolean(value)
      }
    });
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

    const missingAssetResponse = await fetch(`http://127.0.0.1:${fixture.port}/assets/does-not-exist.js`);
    assert.equal(missingAssetResponse.status, 404);
  } finally {
    await fixture.cleanup();
  }
});

test('admin 入口 URL 在缺失前端构建产物时返回清晰错误', async () => {
  const isolatedFrontendRoot = fs.mkdtempSync(path.join(tmpdir(), 'agent-co-admin-frontend-missing-'));

  let fixture = null;
  try {
    fixture = await createAuthAdminFixture({
      env: {
        AGENT_CO_FRONTEND_DIST_DIR: isolatedFrontendRoot
      }
    });
    const response = await fetch(`http://127.0.0.1:${fixture.port}/`);
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.match(String(body.error || ''), /前端构建产物缺失/);
    assert.match(String(body.error || ''), /admin\.html/);
  } finally {
    if (fixture) {
      await fixture.cleanup();
    }
    fs.rmSync(isolatedFrontendRoot, { recursive: true, force: true });
  }
});

test('admin API client 通过共享 HTTP client 加载核心资源并附带 x-admin-token', async () => {
  const { createAdminApi } = loadTsModule('frontend/src/admin/services/admin-api.ts');
  const calls = [];

  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init: { ...init, headers: headersToObject(init.headers) } });
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ ok: true }),
      text: async () => '{"ok":true}'
    };
  };

  const api = createAdminApi({
    baseUrl: 'https://admin.test',
    getAdminToken: () => 'token-123',
    fetch: fetchImpl
  });

  await api.listUsers();
  await api.listAgents();
  await api.listGroups();
  await api.listModelConnections();

  assert.deepEqual(
    calls.map(call => call.url),
    [
      'https://admin.test/api/users',
      'https://admin.test/api/agents',
      'https://admin.test/api/groups',
      'https://admin.test/api/model-connections'
    ]
  );

  for (const call of calls) {
    assert.equal(call.init.credentials, 'include');
    assert.equal(call.init.cache, 'no-store');
    assert.equal(call.init.headers['x-admin-token'], 'token-123');
  }
});

test('authenticated AdminPage 渲染稳定导航，并加载 agents/groups/users/model connections 列表', async () => {
  const calls = [];
  const api = {
    async listUsers() {
      calls.push('users');
      return { users: [{ username: 'admin', createdAt: 1, updatedAt: 2 }] };
    },
    async createUser() {
      throw new Error('not used');
    },
    async updateUserPassword() {
      throw new Error('not used');
    },
    async deleteUser() {
      throw new Error('not used');
    },
    async listAgents() {
      calls.push('agents');
      return {
        agents: [{
          name: 'planner',
          avatar: '🧭',
          personality: '计划',
          color: '#111827',
          systemPrompt: 'plan',
          executionMode: 'cli',
          cliName: 'codex'
        }],
        pendingAgents: null,
        pendingReason: null,
        pendingUpdatedAt: null
      };
    },
    async createAgent() {
      throw new Error('not used');
    },
    async updateAgent() {
      throw new Error('not used');
    },
    async deleteAgent() {
      throw new Error('not used');
    },
    async applyPendingAgents() {
      throw new Error('not used');
    },
    async listGroups() {
      calls.push('groups');
      return { groups: [{ id: 'core', name: '核心组', icon: '🧩', agentNames: ['planner'] }], updatedAt: 1 };
    },
    async createGroup() {
      throw new Error('not used');
    },
    async updateGroup() {
      throw new Error('not used');
    },
    async deleteGroup() {
      throw new Error('not used');
    },
    async listModelConnections() {
      calls.push('model-connections');
      return {
        connections: [{
          id: 'conn-1',
          name: 'Primary',
          baseURL: 'https://models.example.com/v1',
          apiKeyMasked: 'sk-***',
          enabled: true,
          createdAt: 1,
          updatedAt: 2
        }]
      };
    },
    async createModelConnection() {
      throw new Error('not used');
    },
    async updateModelConnection() {
      throw new Error('not used');
    },
    async deleteModelConnection() {
      throw new Error('not used');
    },
    async testModelConnection() {
      throw new Error('not used');
    }
  };

  const renderer = await renderAdminPage({ api, initialAuthToken: 'token-123' });
  const text = collectText(renderer.toJSON());
  const navItems = renderer.root.findAll((node) => typeof node.props?.['data-admin-nav'] === 'string');
  const consoleShell = renderer.root.findByProps({ 'data-admin-page': 'console' });
  const overviewRegion = renderer.root.findByProps({ 'data-admin-region': 'overview' });
  const resourceSectionsRegion = renderer.root.findByProps({ 'data-admin-region': 'resource-sections' });

  assert.equal(new Set(calls).size, 4);
  assert.equal(consoleShell.props['data-admin-density'], 'console');
  assert.equal(overviewRegion.type, 'section');
  assert.equal(resourceSectionsRegion.type, 'section');
  assert.match(text, /agent-co admin/i);
  assert.match(text, /管理工作台/);
  assert.match(text, /planner/);
  assert.match(text, /核心组/);
  assert.match(text, /Primary/);
  assert.match(text, /admin/);
  assert.deepEqual(
    navItems.map((node) => node.props['data-admin-nav']),
    ['agents', 'groups', 'users', 'model-connections']
  );
});

test('AdminPage 在未认证时仍保留 console shell，并提供稳定的 auth 入口区域', async () => {
  const renderer = await renderAdminPage();
  const text = collectText(renderer.toJSON());
  const consoleShell = renderer.root.findByProps({ 'data-admin-page': 'console' });
  const authEntryRegion = renderer.root.findByProps({ 'data-admin-region': 'auth-entry' });

  assert.equal(consoleShell.props['data-admin-density'], 'console');
  assert.equal(authEntryRegion.type, 'section');
  assert.match(text, /管理员 Token/);
  assert.match(text, /连接后台/);
});

test('AdminPage 的 create\/edit 操作使用一致的成功\/失败状态提示', async () => {
  const groups = [];
  const connections = [{
    id: 'conn-1',
    name: 'Primary',
    baseURL: 'https://models.example.com/v1',
    apiKeyMasked: 'sk-***',
    enabled: true,
    createdAt: 1,
    updatedAt: 2
  }];

  const api = {
    async listUsers() {
      return { users: [{ username: 'admin', createdAt: 1, updatedAt: 2 }] };
    },
    async createUser() {
      throw new Error('not used');
    },
    async updateUserPassword() {
      throw new Error('not used');
    },
    async deleteUser() {
      throw new Error('not used');
    },
    async listAgents() {
      return {
        agents: [{
          name: 'planner',
          avatar: '🧭',
          personality: '计划',
          color: '#111827',
          systemPrompt: 'plan',
          executionMode: 'cli',
          cliName: 'codex'
        }],
        pendingAgents: null,
        pendingReason: null,
        pendingUpdatedAt: null
      };
    },
    async createAgent() {
      throw new Error('not used');
    },
    async updateAgent() {
      throw new Error('not used');
    },
    async deleteAgent() {
      throw new Error('not used');
    },
    async applyPendingAgents() {
      throw new Error('not used');
    },
    async listGroups() {
      return { groups: [...groups], updatedAt: 1 };
    },
    async createGroup(input) {
      const group = {
        id: input.id,
        name: input.name,
        icon: input.icon,
        agentNames: input.agentNames
      };
      groups.push(group);
      return { success: true, group };
    },
    async updateGroup() {
      throw new Error('not used');
    },
    async deleteGroup() {
      throw new Error('not used');
    },
    async listModelConnections() {
      return { connections: [...connections] };
    },
    async createModelConnection() {
      throw new Error('not used');
    },
    async updateModelConnection() {
      throw new Error('连接测试失败');
    },
    async deleteModelConnection() {
      throw new Error('not used');
    },
    async testModelConnection() {
      throw new Error('not used');
    }
  };

  const renderer = await renderAdminPage({ api, initialAuthToken: 'token-123' });

  await changeField(renderer, 'group-id', 'core');
  await changeField(renderer, 'group-name', '核心组');
  await changeField(renderer, 'group-icon', '🧩');
  await changeField(renderer, 'group-agentNames', 'planner');
  await submitForm(renderer, 'group-editor');

  let notice = renderer.root.findByProps({ 'data-admin-notice': 'true' });
  assert.equal(notice.props['data-tone'], 'success');
  assert.match(collectText(renderer.toJSON()), /已保存分组 core/);
  assert.match(collectText(renderer.toJSON()), /核心组/);

  await act(async () => {
    findByAction(renderer, 'edit-model-connection:conn-1').props.onClick();
    await flushEffects();
  });
  await changeField(renderer, 'connection-baseURL', 'https://broken.example.com/v1');
  await submitForm(renderer, 'model-connection-editor');

  notice = renderer.root.findByProps({ 'data-admin-notice': 'true' });
  assert.equal(notice.props['data-tone'], 'error');
  assert.match(collectText(notice.children), /连接测试失败/);
});

test('编辑保存失败时保留当前草稿与编辑态，避免静默清空表单', async () => {
  const api = {
    async listUsers() {
      return { users: [{ username: 'admin', createdAt: 1, updatedAt: 2 }] };
    },
    async createUser() {
      throw new Error('not used');
    },
    async updateUserPassword() {
      throw new Error('not used');
    },
    async deleteUser() {
      throw new Error('not used');
    },
    async listAgents() {
      return {
        agents: [{
          name: 'planner',
          avatar: '🧭',
          personality: '计划',
          color: '#111827',
          systemPrompt: 'plan',
          executionMode: 'cli',
          cliName: 'codex'
        }],
        pendingAgents: null,
        pendingReason: null,
        pendingUpdatedAt: null
      };
    },
    async createAgent() {
      throw new Error('not used');
    },
    async updateAgent() {
      throw new Error('not used');
    },
    async deleteAgent() {
      throw new Error('not used');
    },
    async applyPendingAgents() {
      throw new Error('not used');
    },
    async listGroups() {
      return { groups: [], updatedAt: 1 };
    },
    async createGroup() {
      throw new Error('not used');
    },
    async updateGroup() {
      throw new Error('not used');
    },
    async deleteGroup() {
      throw new Error('not used');
    },
    async listModelConnections() {
      return {
        connections: [{
          id: 'conn-1',
          name: 'Primary',
          baseURL: 'https://models.example.com/v1',
          apiKeyMasked: 'sk-***',
          enabled: true,
          createdAt: 1,
          updatedAt: 2
        }]
      };
    },
    async createModelConnection() {
      throw new Error('not used');
    },
    async updateModelConnection() {
      throw new Error('连接更新失败');
    },
    async deleteModelConnection() {
      throw new Error('not used');
    },
    async testModelConnection() {
      throw new Error('not used');
    }
  };

  const renderer = await renderAdminPage({ api, initialAuthToken: 'token-123' });

  await act(async () => {
    findByAction(renderer, 'edit-model-connection:conn-1').props.onClick();
    await flushEffects();
  });

  await changeField(renderer, 'connection-baseURL', 'https://broken.example.com/v2');
  await submitForm(renderer, 'model-connection-editor');

  const notice = renderer.root.findByProps({ 'data-admin-notice': 'true' });
  assert.equal(notice.props['data-tone'], 'error');
  assert.match(collectText(notice.children), /连接更新失败/);
  assert.equal(findByName(renderer, 'connection-baseURL').props.value, 'https://broken.example.com/v2');
  assert.match(collectText(renderer.toJSON()), /取消编辑/);
});

test('编辑模型连接时留空 API Key 会保留现有密钥，而不是发送空字符串', async () => {
  let receivedDraft = null;
  const api = {
    async listUsers() {
      return { users: [{ username: 'admin', createdAt: 1, updatedAt: 2 }] };
    },
    async createUser() {
      throw new Error('not used');
    },
    async updateUserPassword() {
      throw new Error('not used');
    },
    async deleteUser() {
      throw new Error('not used');
    },
    async listAgents() {
      return {
        agents: [],
        pendingAgents: null,
        pendingReason: null,
        pendingUpdatedAt: null
      };
    },
    async createAgent() {
      throw new Error('not used');
    },
    async updateAgent() {
      throw new Error('not used');
    },
    async deleteAgent() {
      throw new Error('not used');
    },
    async applyPendingAgents() {
      throw new Error('not used');
    },
    async listGroups() {
      return { groups: [], updatedAt: 1 };
    },
    async createGroup() {
      throw new Error('not used');
    },
    async updateGroup() {
      throw new Error('not used');
    },
    async deleteGroup() {
      throw new Error('not used');
    },
    async listModelConnections() {
      return {
        connections: [{
          id: 'conn-1',
          name: 'Primary',
          baseURL: 'https://models.example.com/v1',
          apiKeyMasked: 'sk-***',
          enabled: true,
          createdAt: 1,
          updatedAt: 2
        }]
      };
    },
    async createModelConnection() {
      throw new Error('not used');
    },
    async updateModelConnection(id, draft) {
      receivedDraft = draft;
      return {
        success: true,
        connection: {
          id,
          name: draft.name,
          baseURL: draft.baseURL,
          apiKeyMasked: 'sk-***',
          enabled: draft.enabled,
          createdAt: 1,
          updatedAt: 2
        }
      };
    },
    async deleteModelConnection() {
      throw new Error('not used');
    },
    async testModelConnection() {
      throw new Error('not used');
    }
  };

  const renderer = await renderAdminPage({ api, initialAuthToken: 'token-123' });

  await act(async () => {
    findByAction(renderer, 'edit-model-connection:conn-1').props.onClick();
    await flushEffects();
  });
  await changeField(renderer, 'connection-baseURL', 'https://updated.example.com/v1');
  await submitForm(renderer, 'model-connection-editor');

  assert.equal(receivedDraft.baseURL, 'https://updated.example.com/v1');
  assert.equal('apiKey' in receivedDraft, false);
});

test('编辑 API 智能体时会保留未暴露在表单中的温度与 token 上限配置', async () => {
  let receivedAgent = null;
  const api = {
    async listUsers() {
      return { users: [{ username: 'admin', createdAt: 1, updatedAt: 2 }] };
    },
    async createUser() {
      throw new Error('not used');
    },
    async updateUserPassword() {
      throw new Error('not used');
    },
    async deleteUser() {
      throw new Error('not used');
    },
    async listAgents() {
      return {
        agents: [{
          name: 'planner',
          avatar: '🧭',
          personality: '计划',
          color: '#111827',
          systemPrompt: 'plan',
          executionMode: 'api',
          apiConnectionId: 'conn-1',
          apiModel: 'gpt-test',
          apiTemperature: 0.35,
          apiMaxTokens: 4096
        }],
        pendingAgents: null,
        pendingReason: null,
        pendingUpdatedAt: null
      };
    },
    async createAgent() {
      throw new Error('not used');
    },
    async updateAgent(name, input) {
      receivedAgent = input.agent;
      return {
        success: true,
        applyMode: 'immediate',
        agent: input.agent
      };
    },
    async deleteAgent() {
      throw new Error('not used');
    },
    async applyPendingAgents() {
      throw new Error('not used');
    },
    async listGroups() {
      return { groups: [], updatedAt: 1 };
    },
    async createGroup() {
      throw new Error('not used');
    },
    async updateGroup() {
      throw new Error('not used');
    },
    async deleteGroup() {
      throw new Error('not used');
    },
    async listModelConnections() {
      return {
        connections: [{
          id: 'conn-1',
          name: 'Primary',
          baseURL: 'https://models.example.com/v1',
          apiKeyMasked: 'sk-***',
          enabled: true,
          createdAt: 1,
          updatedAt: 2
        }]
      };
    },
    async createModelConnection() {
      throw new Error('not used');
    },
    async updateModelConnection() {
      throw new Error('not used');
    },
    async deleteModelConnection() {
      throw new Error('not used');
    },
    async testModelConnection() {
      throw new Error('not used');
    }
  };

  const renderer = await renderAdminPage({ api, initialAuthToken: 'token-123' });
  const agentPanel = renderer.root.findByProps({ 'data-admin-panel': 'agents' });

  await act(async () => {
    agentPanel.findAll((node) => node.type === 'button' && collectText(node.children).includes('编辑'))[0].props.onClick();
    await flushEffects();
  });
  await changeField(renderer, 'agent-personality', '更新后的计划');
  await submitForm(renderer, 'agent-editor');

  assert.equal(receivedAgent.personality, '更新后的计划');
  assert.equal(receivedAgent.apiTemperature, 0.35);
  assert.equal(receivedAgent.apiMaxTokens, 4096);
});

test('管理员 Token 失效后可在当前页切换 Token 并重新加载，同时 token 输入禁用自动填充', async () => {
  const originalFetch = global.fetch;

  function jsonResponse(status, payload, statusText = 'OK') {
    return new Response(JSON.stringify(payload), {
      status,
      statusText,
      headers: { 'content-type': 'application/json' }
    });
  }

  global.fetch = async (url, init = {}) => {
    const headers = headersToObject(init.headers);
    const token = headers['x-admin-token'];
    const pathname = new URL(String(url), 'http://127.0.0.1').pathname;

    if (token === 'bad-token') {
      return jsonResponse(401, { error: { message: '管理员 Token 已失效' } }, 'Unauthorized');
    }

    switch (pathname) {
      case '/api/users':
        return jsonResponse(200, { users: [{ username: 'admin', createdAt: 1, updatedAt: 2 }] });
      case '/api/agents':
        return jsonResponse(200, {
          agents: [{
            name: 'planner',
            avatar: '🧭',
            personality: '计划',
            color: '#111827',
            systemPrompt: 'plan',
            executionMode: 'cli',
            cliName: 'codex'
          }],
          pendingAgents: null,
          pendingReason: null,
          pendingUpdatedAt: null
        });
      case '/api/groups':
        return jsonResponse(200, { groups: [], updatedAt: 1 });
      case '/api/model-connections':
        return jsonResponse(200, { connections: [] });
      default:
        throw new Error(`unexpected path: ${pathname}`);
    }
  };

  try {
    const renderer = await renderAdminPage({ initialAuthToken: 'bad-token' });

    let text = collectText(renderer.toJSON());
    assert.match(text, /管理员 Token 已失效/);
    assert.match(text, /更换 Token/);

    await act(async () => {
      renderer.root.findAll((node) => node.type === 'button' && collectText(node.children).includes('更换 Token'))[0].props.onClick();
      await flushEffects();
    });

    const tokenField = findByName(renderer, 'admin-token');
    assert.equal(tokenField.props.autoComplete, 'off');
    assert.equal(tokenField.props.spellCheck, false);
    assert.match(String(tokenField.props.placeholder || ''), /x-admin-token/i);

    await changeField(renderer, 'admin-token', 'good-token');
    await act(async () => {
      renderer.root.findAllByType('form')[0].props.onSubmit({ preventDefault() {} });
      await flushEffects();
    });

    text = collectText(renderer.toJSON());
    assert.match(text, /planner/);
    assert.doesNotMatch(text, /管理员 Token 已失效/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('已加载旧数据后刷新失败仍会显式暴露错误，同时保留旧列表内容', async () => {
  let loadUsersCalls = 0;
  const api = {
    async listUsers() {
      loadUsersCalls += 1;
      if (loadUsersCalls === 1) {
        return { users: [{ username: 'admin', createdAt: 1, updatedAt: 2 }] };
      }
      throw new Error('刷新用户列表失败');
    },
    async createUser() {
      throw new Error('not used');
    },
    async updateUserPassword() {
      throw new Error('not used');
    },
    async deleteUser() {
      throw new Error('not used');
    },
    async listAgents() {
      return {
        agents: [{
          name: 'planner',
          avatar: '🧭',
          personality: '计划',
          color: '#111827',
          systemPrompt: 'plan',
          executionMode: 'cli',
          cliName: 'codex'
        }],
        pendingAgents: null,
        pendingReason: null,
        pendingUpdatedAt: null
      };
    },
    async createAgent() {
      throw new Error('not used');
    },
    async updateAgent() {
      throw new Error('not used');
    },
    async deleteAgent() {
      throw new Error('not used');
    },
    async applyPendingAgents() {
      throw new Error('not used');
    },
    async listGroups() {
      return { groups: [{ id: 'core', name: '核心组', icon: '🧩', agentNames: ['planner'] }], updatedAt: 1 };
    },
    async createGroup() {
      throw new Error('not used');
    },
    async updateGroup() {
      throw new Error('not used');
    },
    async deleteGroup() {
      throw new Error('not used');
    },
    async listModelConnections() {
      return {
        connections: [{
          id: 'conn-1',
          name: 'Primary',
          baseURL: 'https://models.example.com/v1',
          apiKeyMasked: 'sk-***',
          enabled: true,
          createdAt: 1,
          updatedAt: 2
        }]
      };
    },
    async createModelConnection() {
      throw new Error('not used');
    },
    async updateModelConnection() {
      throw new Error('not used');
    },
    async deleteModelConnection() {
      throw new Error('not used');
    },
    async testModelConnection() {
      throw new Error('not used');
    }
  };

  const renderer = await renderAdminPage({ api, initialAuthToken: 'token-123' });
  assert.match(collectText(renderer.toJSON()), /planner/);

  await act(async () => {
    findButtonByText(renderer, '刷新').props.onClick();
    await flushEffects();
  });

  const text = collectText(renderer.toJSON());
  assert.match(text, /planner/);
  assert.match(text, /刷新用户列表失败/);
});

test('首次成功加载为空状态后刷新失败，仍保留 admin shell 与空面板并显示刷新错误', async () => {
  let loadUsersCalls = 0;
  const api = {
    async listUsers() {
      loadUsersCalls += 1;
      if (loadUsersCalls === 1) {
        return { users: [] };
      }
      throw new Error('空列表刷新失败');
    },
    async createUser() {
      throw new Error('not used');
    },
    async updateUserPassword() {
      throw new Error('not used');
    },
    async deleteUser() {
      throw new Error('not used');
    },
    async listAgents() {
      return {
        agents: [],
        pendingAgents: null,
        pendingReason: null,
        pendingUpdatedAt: null
      };
    },
    async createAgent() {
      throw new Error('not used');
    },
    async updateAgent() {
      throw new Error('not used');
    },
    async deleteAgent() {
      throw new Error('not used');
    },
    async applyPendingAgents() {
      throw new Error('not used');
    },
    async listGroups() {
      return { groups: [], updatedAt: 1 };
    },
    async createGroup() {
      throw new Error('not used');
    },
    async updateGroup() {
      throw new Error('not used');
    },
    async deleteGroup() {
      throw new Error('not used');
    },
    async listModelConnections() {
      return { connections: [] };
    },
    async createModelConnection() {
      throw new Error('not used');
    },
    async updateModelConnection() {
      throw new Error('not used');
    },
    async deleteModelConnection() {
      throw new Error('not used');
    },
    async testModelConnection() {
      throw new Error('not used');
    }
  };

  const renderer = await renderAdminPage({ api, initialAuthToken: 'token-123' });
  let text = collectText(renderer.toJSON());
  assert.match(text, /暂无智能体/);
  assert.match(text, /暂无分组/);
  assert.match(text, /暂无模型连接/);

  await act(async () => {
    findButtonByText(renderer, '刷新').props.onClick();
    await flushEffects();
  });

  text = collectText(renderer.toJSON());
  assert.match(text, /agent-co admin/);
  assert.match(text, /暂无智能体/);
  assert.match(text, /暂无分组/);
  assert.match(text, /暂无模型连接/);
  assert.match(text, /空列表刷新失败/);
  assert.doesNotMatch(text, /管理资源加载失败/);
});

test('分组成员输入会拒绝重复项与未知智能体，避免提交明显无效的数据', async () => {
  let createGroupCalls = 0;
  const api = {
    async listUsers() {
      return { users: [{ username: 'admin', createdAt: 1, updatedAt: 2 }] };
    },
    async createUser() {
      throw new Error('not used');
    },
    async updateUserPassword() {
      throw new Error('not used');
    },
    async deleteUser() {
      throw new Error('not used');
    },
    async listAgents() {
      return {
        agents: [{
          name: 'planner',
          avatar: '🧭',
          personality: '计划',
          color: '#111827',
          systemPrompt: 'plan',
          executionMode: 'cli',
          cliName: 'codex'
        }],
        pendingAgents: null,
        pendingReason: null,
        pendingUpdatedAt: null
      };
    },
    async createAgent() {
      throw new Error('not used');
    },
    async updateAgent() {
      throw new Error('not used');
    },
    async deleteAgent() {
      throw new Error('not used');
    },
    async applyPendingAgents() {
      throw new Error('not used');
    },
    async listGroups() {
      return { groups: [], updatedAt: 1 };
    },
    async createGroup() {
      createGroupCalls += 1;
      return { success: true, group: { id: 'core', name: '核心组', icon: '🧩', agentNames: ['planner'] } };
    },
    async updateGroup() {
      throw new Error('not used');
    },
    async deleteGroup() {
      throw new Error('not used');
    },
    async listModelConnections() {
      return { connections: [] };
    },
    async createModelConnection() {
      throw new Error('not used');
    },
    async updateModelConnection() {
      throw new Error('not used');
    },
    async deleteModelConnection() {
      throw new Error('not used');
    },
    async testModelConnection() {
      throw new Error('not used');
    }
  };

  const renderer = await renderAdminPage({ api, initialAuthToken: 'token-123' });

  await changeField(renderer, 'group-id', 'core');
  await changeField(renderer, 'group-name', '核心组');
  await changeField(renderer, 'group-icon', '🧩');
  await changeField(renderer, 'group-agentNames', ' planner, planner , ghost ');
  await submitForm(renderer, 'group-editor');

  const notice = renderer.root.findByProps({ 'data-admin-notice': 'true' });
  assert.equal(createGroupCalls, 0);
  assert.equal(notice.props['data-tone'], 'error');
  assert.match(collectText(notice.children), /重复|未知/);
  assert.equal(findByName(renderer, 'group-agentNames').props.value, ' planner, planner , ghost ');
});
