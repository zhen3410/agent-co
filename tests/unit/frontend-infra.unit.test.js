const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const rootDir = path.resolve(__dirname, '../..');
const moduleCache = new Map();

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

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = new Map();
    this.sentFrames = [];
    this.closed = false;
  }

  addEventListener(type, handler) {
    const entries = this.listeners.get(type) ?? [];
    entries.push(handler);
    this.listeners.set(type, entries);
  }

  removeEventListener(type, handler) {
    const entries = this.listeners.get(type) ?? [];
    this.listeners.set(type, entries.filter((entry) => entry !== handler));
  }

  send(payload) {
    if (this.readyState !== 1) {
      throw new Error('socket is not open');
    }
    this.sentFrames.push(payload);
  }

  close(code = 1000, reason = 'manual-close') {
    this.closed = true;
    this.readyState = 3;
    this.emit('close', { code, reason, wasClean: true });
  }

  emit(type, event = {}) {
    if (type === 'open') {
      this.readyState = 1;
    }

    const handlers = this.listeners.get(type) ?? [];
    for (const handler of handlers) {
      handler(event);
    }
  }
}

test('API client normalizes JSON success and error responses', async () => {
  const { createHttpClient, HttpClientError } = loadTsModule('frontend/src/shared/lib/http/http-client.ts');
  const calls = [];

  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });

    if (String(url).endsWith('/ok')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ ok: true, nested: { value: 7 } }),
        text: async () => '{"ok":true}'
      };
    }

    return {
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: { message: 'invalid payload', code: 'E_BAD_PAYLOAD' } }),
      text: async () => '{"error":{"message":"invalid payload"}}'
    };
  };

  const client = createHttpClient({
    baseUrl: 'https://unit.test/api',
    fetch: fetchImpl,
    headers: {
      Authorization: 'Bearer token'
    }
  });

  const okPayload = await client.request('/ok', {
    method: 'POST',
    json: { value: 1 }
  });

  assert.deepEqual(okPayload, { ok: true, nested: { value: 7 } });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://unit.test/api/ok');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer token');
  assert.equal(calls[0].init.body, JSON.stringify({ value: 1 }));

  await assert.rejects(
    async () => client.request('/error'),
    (error) => {
      assert.ok(error instanceof HttpClientError);
      assert.equal(error.status, 422);
      assert.equal(error.code, 'E_BAD_PAYLOAD');
      assert.equal(error.message, 'invalid payload');
      assert.deepEqual(error.body, { error: { message: 'invalid payload', code: 'E_BAD_PAYLOAD' } });
      return true;
    }
  );
});

test('requestJson delegates to client and preserves request options', async () => {
  const { requestJson } = loadTsModule('frontend/src/shared/lib/http/json-request.ts');

  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ url: String(url), method: init.method || 'GET' }),
      text: async () => '{}'
    };
  };

  const payload = await requestJson('https://unit.test/runtime', {
    method: 'PATCH',
    fetch: fetchImpl,
    headers: {
      'x-trace-id': 'trace-123'
    },
    json: {
      enabled: true
    }
  });

  assert.deepEqual(payload, { url: 'https://unit.test/runtime', method: 'PATCH' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers['x-trace-id'], 'trace-123');
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.equal(calls[0].init.body, JSON.stringify({ enabled: true }));
});

test('realtime client emits connect/message/disconnect lifecycle callbacks', async () => {
  const { createRealtimeClient } = loadTsModule('frontend/src/shared/lib/realtime/realtime-client.ts');

  const events = [];
  const sockets = [];
  const client = createRealtimeClient({
    url: 'wss://unit.test/ws/events',
    webSocketFactory: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    reconnectPolicy: {
      shouldReconnect: () => false,
      getDelayMs: () => 0
    },
    onConnect: () => events.push('connect'),
    onDisconnect: (detail) => events.push(`disconnect:${detail.code}`),
    onMessage: (message) => events.push(`message:${message.type}`)
  });

  client.connect();
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].url, 'wss://unit.test/ws/events');

  assert.throws(() => client.send({ type: 'client.ping' }), /open/i);

  sockets[0].emit('open');
  sockets[0].emit('message', { data: JSON.stringify({ type: 'session.updated' }) });
  client.send({ type: 'client.ping' });
  sockets[0].emit('close', { code: 1000, reason: 'done', wasClean: true });

  assert.deepEqual(events, ['connect', 'message:session.updated', 'disconnect:1000']);
  assert.deepEqual(sockets[0].sentFrames, [JSON.stringify({ type: 'client.ping' })]);

  client.disconnect();
  assert.equal(sockets[0].closed, true);
});

test('realtime reconnect attempt indexing starts at 0 and increments per retry scheduling', async () => {
  const { createRealtimeClient } = loadTsModule('frontend/src/shared/lib/realtime/realtime-client.ts');

  const attemptCalls = [];
  const sockets = [];
  const reconnectPolicy = {
    shouldReconnect: (attempt) => {
      attemptCalls.push({ kind: 'should', attempt });
      return attempt < 2;
    },
    getDelayMs: (attempt) => {
      attemptCalls.push({ kind: 'delay', attempt });
      return 0;
    }
  };

  const client = createRealtimeClient({
    url: 'wss://unit.test/ws/retry',
    reconnectPolicy,
    webSocketFactory: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    }
  });

  client.connect();
  sockets[0].emit('close', { code: 1006, reason: 'drop-1', wasClean: false });
  await new Promise((resolve) => setTimeout(resolve, 0));

  sockets[1].emit('close', { code: 1006, reason: 'drop-2', wasClean: false });
  await new Promise((resolve) => setTimeout(resolve, 0));

  sockets[2].emit('close', { code: 1006, reason: 'drop-3', wasClean: false });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(attemptCalls, [
    { kind: 'should', attempt: 0 },
    { kind: 'delay', attempt: 0 },
    { kind: 'should', attempt: 1 },
    { kind: 'delay', attempt: 1 },
    { kind: 'should', attempt: 2 }
  ]);
  assert.equal(sockets.length, 3);
});

test('reconnect policy treats first retry as attempt 0 and caps max attempts deterministically', () => {
  const { createExponentialBackoffPolicy } = loadTsModule('frontend/src/shared/lib/realtime/reconnect-policy.ts');

  const policy = createExponentialBackoffPolicy({
    baseDelayMs: 100,
    maxDelayMs: 1000,
    maxAttempts: 2,
    jitterRatio: 0,
    random: () => 0.5
  });

  assert.equal(policy.shouldReconnect(0), true);
  assert.equal(policy.shouldReconnect(1), true);
  assert.equal(policy.shouldReconnect(2), false);
  assert.equal(policy.getDelayMs(0), 100);
  assert.equal(policy.getDelayMs(1), 200);
  assert.equal(policy.getDelayMs(2), 400);
});

test('layouts render shared shell chrome and tool page slots', () => {
  const { AppShell } = loadTsModule('frontend/src/shared/layouts/AppShell.tsx');
  const { ToolPageLayout } = loadTsModule('frontend/src/shared/layouts/ToolPageLayout.tsx');

  const shellHtml = renderToStaticMarkup(
    React.createElement(AppShell, {
      title: 'Agent Console',
      subtitle: 'Control plane',
      navigation: React.createElement('a', { href: '/admin' }, 'Admin'),
      actions: React.createElement('button', { type: 'button' }, 'Refresh')
    }, React.createElement('div', { id: 'content' }, 'Shell body'))
  );

  assert.match(shellHtml, /<header[^>]*data-layout="app-shell-header"/);
  assert.match(shellHtml, /Agent Console/);
  assert.match(shellHtml, /Control plane/);
  assert.match(shellHtml, /<main[^>]*data-layout="app-shell-main"/);
  assert.match(shellHtml, /Shell body/);

  const toolHtml = renderToStaticMarkup(
    React.createElement(ToolPageLayout, {
      appTitle: 'Agent Console',
      pageTitle: 'Dependency Monitor',
      description: 'Track dependency health',
      navigation: React.createElement('a', { href: '/ops' }, 'Ops'),
      actions: React.createElement('button', { type: 'button' }, 'Run check'),
      sidebar: React.createElement('aside', null, 'Filters')
    }, React.createElement('section', null, 'Rows'))
  );

  assert.match(toolHtml, /data-layout="tool-page"/);
  assert.match(toolHtml, /Dependency Monitor/);
  assert.match(toolHtml, /Track dependency health/);
  assert.match(toolHtml, /Filters/);
  assert.match(toolHtml, /Rows/);
});

test('mobile shell and message styles keep header sticky and preserve readable sizing', () => {
  const baseCss = fs.readFileSync(path.resolve(rootDir, 'frontend/src/shared/styles/base.css'), 'utf8');
  const tokensCss = fs.readFileSync(path.resolve(rootDir, 'frontend/src/shared/styles/tokens.css'), 'utf8');
  const messageListSource = fs.readFileSync(path.resolve(rootDir, 'frontend/src/chat/features/message-list/ChatMessageList.tsx'), 'utf8');
  const composerSource = fs.readFileSync(path.resolve(rootDir, 'frontend/src/chat/features/composer/ChatComposer.tsx'), 'utf8');
  const chatPageSource = fs.readFileSync(path.resolve(rootDir, 'frontend/src/chat/pages/ChatPage.tsx'), 'utf8');

  assert.match(baseCss, /\.layout-app-shell__header\s*\{[\s\S]*position:\s*fixed;/);
  assert.match(baseCss, /\.layout-app-shell__header\s*\{[\s\S]*top:\s*0;/);
  assert.match(tokensCss, /--app-shell-header-height:\s*5\.5rem/);
  assert.match(tokensCss, /--chat-composer-dock-height:\s*6\.5rem/);
  assert.match(baseCss, /-webkit-text-size-adjust:\s*100%/);
  assert.match(baseCss, /text-size-adjust:\s*100%/);
  assert.match(baseCss, /html,\s*body\s*\{[\s\S]*overflow-x:\s*hidden;/);
  assert.match(baseCss, /#root\s*\{[\s\S]*overflow-x:\s*hidden;/);
  assert.doesNotMatch(baseCss, /\.layout-app-shell\s*\{[\s\S]*overflow-x:\s*hidden;/);
  assert.match(baseCss, /@media \(max-width: 720px\)[\s\S]*\.layout-app-shell__header\s*\{[\s\S]*padding:/);
  assert.match(baseCss, /@media \(max-width: 720px\)[\s\S]*\.layout-app-shell__header\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto/);
  assert.match(baseCss, /@media \(max-width: 720px\)[\s\S]*\.layout-app-shell__actions\s*\{[\s\S]*justify-self:\s*end;/);
  assert.match(baseCss, /@media \(max-width: 720px\)[\s\S]*\.layout-app-shell__main\s*\{[\s\S]*padding:\s*calc\(var\(--app-shell-header-height\) \+ 0\.35rem\)\s*var\(--space-3\)\s*var\(--space-2\)/);
  assert.match(baseCss, /@media \(max-width: 720px\)[\s\S]*\.ui-empty-state\s*\{[\s\S]*padding:/);
  assert.match(messageListSource, /font-size:\s*16px|fontSize:\s*'16px'|fontSize:\s*16/);
  assert.match(messageListSource, /@media \(max-width: 720px\)[\s\S]*padding:\s*var\(--space-1\)\s*0\s*calc\(var\(--chat-composer-dock-height\) \+ env\(safe-area-inset-bottom,\s*0px\) \+ var\(--space-4\)\)/);
  assert.match(messageListSource, /\.chat-message-list\s*\{[\s\S]*overflow-x:\s*hidden;/);
  assert.match(messageListSource, /\.chat-message-list__bubble\s*\{[\s\S]*max-width:\s*min\(32rem,\s*calc\(100% - 3\.5rem\)\)/);
  assert.match(messageListSource, /\.chat-message-list__item\[data-tone='assistant'\]\s*\.chat-message-list__bubble\s*\{[\s\S]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.98\)/);
  assert.match(messageListSource, /\.chat-message-list__item\[data-tone='user'\]\s*\.chat-message-list__meta\s*\{[\s\S]*display:\s*none;/);
  assert.match(messageListSource, /\.chat-message-list__avatar\s*\{/);
  assert.match(messageListSource, /className="chat-message-list__avatar" data-tone="user"/);
  assert.match(messageListSource, /@media \(max-width: 720px\)[\s\S]*\.chat-message-list__bubble\s*\{[\s\S]*max-width:\s*min\(calc\(100% - 2\.75rem\),\s*19rem\)/);
  assert.match(messageListSource, /\.chat-message-list__body\s*\{[\s\S]*overflow-wrap:\s*anywhere;/);
  assert.match(messageListSource, /\.chat-message-list__body h1,[\s\S]*\.chat-message-list__body h2,[\s\S]*\.chat-message-list__body h3/);
  assert.match(messageListSource, /\.chat-message-list__body code\s*\{[\s\S]*background:/);
  assert.match(composerSource, /font-size:\s*16px|fontSize:\s*'16px'|fontSize:\s*16/);
  assert.match(composerSource, /@media \(max-width: 720px\)[\s\S]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.98\)/);
  assert.match(composerSource, /@media \(max-width: 720px\)[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(chatPageSource, /\.chat-page-shell__composer-dock\s*\{[\s\S]*position:\s*fixed;/);
  assert.match(chatPageSource, /@media \(max-width: 959px\)[\s\S]*\.chat-page-shell__conversation-stage\s*\{[\s\S]*padding-bottom:\s*calc\(var\(--chat-composer-dock-height\) \+ env\(safe-area-inset-bottom,\s*0px\) \+ var\(--space-3\)\)/);
  assert.match(chatPageSource, /@media \(max-width: 959px\)[\s\S]*\.chat-page-shell__composer-dock\s*\{[\s\S]*padding:\s*0\s*var\(--space-2\)\s*calc\(env\(safe-area-inset-bottom,\s*0px\) \+ 0\.35rem\)/);
  assert.match(chatPageSource, /\.chat-page-shell__layout\s*\{[\s\S]*max-width:\s*100%/);
});

test('runtime config helpers read bootstrap config from window and script tags', () => {
  const runtimeModulePath = path.join(rootDir, 'frontend/src/shared/config/runtime-config.ts');
  const source = fs.readFileSync(runtimeModulePath, 'utf8');

  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true
    },
    fileName: runtimeModulePath
  });

  const mod = { exports: {} };
  const fn = new Function('require', 'module', 'exports', '__filename', '__dirname', transpiled.outputText);
  fn(require, mod, mod.exports, runtimeModulePath, path.dirname(runtimeModulePath));

  const { getRuntimeConfig, getPageBootstrapConfig } = mod.exports;

  const originalWindow = global.window;
  const originalDocument = global.document;

  try {
    global.window = {
      __AGENT_CO_RUNTIME_CONFIG__: {
        apiBaseUrl: '/api',
        realtimeBaseUrl: '/api/ws',
        page: 'chat'
      }
    };

    global.document = {
      getElementById: () => ({
        textContent: JSON.stringify({
          apiBaseUrl: '/api-from-script',
          page: 'admin',
          featureFlags: {
            showOps: true
          }
        })
      })
    };

    const runtimeConfig = getRuntimeConfig();
    assert.equal(runtimeConfig.apiBaseUrl, '/api');
    assert.equal(runtimeConfig.realtimeBaseUrl, '/api/ws');
    assert.equal(runtimeConfig.page, 'chat');

    const bootstrapConfig = getPageBootstrapConfig();
    assert.equal(bootstrapConfig.apiBaseUrl, '/api-from-script');
    assert.equal(bootstrapConfig.page, 'admin');
    assert.deepEqual(bootstrapConfig.featureFlags, { showOps: true });
  } finally {
    global.window = originalWindow;
    global.document = originalDocument;
  }
});

test('runtime config helpers reject array and non-plain object payloads', () => {
  const runtimeModulePath = path.join(rootDir, 'frontend/src/shared/config/runtime-config.ts');
  const source = fs.readFileSync(runtimeModulePath, 'utf8');

  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true
    },
    fileName: runtimeModulePath
  });

  const mod = { exports: {} };
  const fn = new Function('require', 'module', 'exports', '__filename', '__dirname', transpiled.outputText);
  fn(require, mod, mod.exports, runtimeModulePath, path.dirname(runtimeModulePath));

  const { getRuntimeConfig, getPageBootstrapConfig } = mod.exports;
  const originalWindow = global.window;
  const originalDocument = global.document;

  try {
    global.window = {
      __AGENT_CO_RUNTIME_CONFIG__: []
    };
    global.document = {
      getElementById: () => ({
        textContent: JSON.stringify([])
      })
    };

    assert.deepEqual(getRuntimeConfig(), {});
    assert.deepEqual(getPageBootstrapConfig(), {});
  } finally {
    global.window = originalWindow;
    global.document = originalDocument;
  }
});

test('admin URL resolver prefers explicit runtime config and otherwise falls back to default auth-admin port semantics', () => {
  const { resolveAdminPageUrl } = loadTsModule('frontend/src/shared/config/admin-url.ts');

  assert.equal(
    resolveAdminPageUrl({
      config: {
        adminBaseUrl: 'https://admin.example.com/ops'
      },
      location: {
        href: 'https://chat.example.com/chat.html',
        origin: 'https://chat.example.com',
        protocol: 'https:',
        hostname: 'chat.example.com',
        port: ''
      }
    }),
    'https://admin.example.com/ops/admin.html'
  );

  assert.equal(
    resolveAdminPageUrl({
      location: {
        href: 'http://127.0.0.1:3002/chat.html',
        origin: 'http://127.0.0.1:3002',
        protocol: 'http:',
        hostname: '127.0.0.1',
        port: '3002'
      }
    }),
    'http://127.0.0.1:3003/admin.html'
  );

  assert.equal(
    resolveAdminPageUrl({
      location: {
        href: 'http://myhost:3002/chat.html',
        origin: 'http://myhost:3002',
        protocol: 'http:',
        hostname: 'myhost',
        port: '3002'
      }
    }),
    'http://myhost:3003/admin.html'
  );

  assert.equal(
    resolveAdminPageUrl({
      location: {
        href: 'https://chat.example.com:8443/chat.html',
        origin: 'https://chat.example.com:8443',
        protocol: 'https:',
        hostname: 'chat.example.com',
        port: '8443'
      }
    }),
    'https://chat.example.com:8443/admin.html'
  );
});

test('chat bootstrap auth loader requests auth-status and falls back to auth-disabled behavior when unavailable', async () => {
  const { loadInitialChatAuthStatus } = loadTsModule('frontend/src/chat/bootstrap/chat-bootstrap.tsx');
  const calls = [];

  const authStatus = await loadInitialChatAuthStatus({
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        json: async () => ({
          authEnabled: true,
          authenticated: false
        })
      };
    }
  });

  assert.deepEqual(authStatus, {
    authEnabled: true,
    authenticated: false
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/auth-status');
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.cache, 'no-store');

  const fallbackStatus = await loadInitialChatAuthStatus({
    runtimeConfig: {
      apiBaseUrl: 'https://chat.example.com'
    },
    fetchImpl: async () => {
      throw new Error('network unavailable');
    }
  });

  assert.deepEqual(fallbackStatus, {
    authEnabled: false,
    authenticated: true
  });
});

test('chat composer height sizing uses tighter bounds on mobile and larger bounds on desktop', () => {
  const { getChatComposerTextareaHeight } = loadTsModule('frontend/src/chat/features/composer/useChatComposer.ts');

  assert.equal(getChatComposerTextareaHeight({ scrollHeight: 20, viewportWidth: 390 }), 44);
  assert.equal(getChatComposerTextareaHeight({ scrollHeight: 500, viewportWidth: 390 }), 88);
  assert.equal(getChatComposerTextareaHeight({ scrollHeight: 40, viewportWidth: 1280 }), 44);
  assert.equal(getChatComposerTextareaHeight({ scrollHeight: 500, viewportWidth: 1280 }), 120);
});

test('theme runtime resolves system preference, applies document theme, and persists manual selections', () => {
  const {
    THEME_STORAGE_KEY,
    getNextThemeChoice,
    resolveThemeChoice,
    resolveAppliedTheme,
    applyThemeToDocument,
    persistThemeChoice
  } = loadTsModule('frontend/src/shared/theme/theme.tsx');

  assert.equal(resolveThemeChoice('dark'), 'dark');
  assert.equal(resolveThemeChoice('unexpected'), 'system');
  assert.equal(resolveAppliedTheme('system', true), 'dark');
  assert.equal(resolveAppliedTheme('system', false), 'light');
  assert.equal(resolveAppliedTheme('light', true), 'light');
  assert.equal(getNextThemeChoice('system'), 'light');
  assert.equal(getNextThemeChoice('light'), 'dark');
  assert.equal(getNextThemeChoice('dark'), 'system');

  const documentElement = {
    dataset: {}
  };

  applyThemeToDocument({
    documentElement
  }, {
    choice: 'system',
    theme: 'dark'
  });

  assert.equal(documentElement.dataset.theme, 'dark');
  assert.equal(documentElement.dataset.themeChoice, 'system');

  const storage = {
    values: new Map(),
    setItem(key, value) {
      this.values.set(key, value);
    },
    removeItem(key) {
      this.values.delete(key);
    }
  };

  persistThemeChoice(storage, 'dark');
  assert.equal(storage.values.get(THEME_STORAGE_KEY), 'dark');

  persistThemeChoice(storage, 'system');
  assert.equal(storage.values.has(THEME_STORAGE_KEY), false);
});


test('admin API 客户端为默认提示词预览与恢复使用真实后端协议', async () => {
  const { createAdminApi } = loadTsModule('frontend/src/admin/services/admin-api.ts');
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/prompt/template')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true, currentPrompt: '当前提示词', templatePrompt: '默认模板内容' }),
        text: async () => '{}'
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true, applyMode: 'immediate', systemPrompt: '默认模板内容' }),
      text: async () => '{}'
    };
  };

  const api = createAdminApi({
    baseUrl: 'https://unit.test',
    fetch: fetchImpl,
    getAdminToken: () => 'token-123'
  });

  const preview = await api.getAgentPromptTemplate('Codex架构师');
  const restore = await api.restoreAgentPromptTemplate('Codex架构师');

  assert.equal(preview.templatePrompt, '默认模板内容');
  assert.equal(restore.systemPrompt, '默认模板内容');
  assert.equal(calls[0].url, 'https://unit.test/api/agents/Codex%E6%9E%B6%E6%9E%84%E5%B8%88/prompt/template');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers['x-admin-token'], 'token-123');
  assert.equal(calls[1].url, 'https://unit.test/api/agents/Codex%E6%9E%B6%E6%9E%84%E5%B8%88/prompt/restore-template');
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].init.headers['content-type'], 'application/json');
  assert.equal(calls[1].init.body, JSON.stringify({ applyMode: 'immediate' }));
});
