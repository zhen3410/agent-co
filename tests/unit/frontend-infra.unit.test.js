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

  sockets[0].emit('open');
  sockets[0].emit('message', { data: JSON.stringify({ type: 'session.updated' }) });
  client.send({ type: 'client.ping' });
  sockets[0].emit('close', { code: 1000, reason: 'done', wasClean: true });

  assert.deepEqual(events, ['connect', 'message:session.updated', 'disconnect:1000']);
  assert.deepEqual(sockets[0].sentFrames, [JSON.stringify({ type: 'client.ping' })]);

  client.disconnect();
  assert.equal(sockets[0].closed, true);
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

  global.window = originalWindow;
  global.document = originalDocument;
});
