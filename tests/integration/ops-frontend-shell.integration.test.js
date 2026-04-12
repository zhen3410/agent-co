const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const TestRenderer = require('react-test-renderer');

const rootDir = path.resolve(__dirname, '../..');
const moduleCache = new Map();
const { act } = TestRenderer;

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
    if (specifier.endsWith('.css')) {
      return {};
    }

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
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function renderComponent(relativeModulePath, exportName, props = {}) {
  const mod = loadTsModule(relativeModulePath);
  let renderer;

  await act(async () => {
    renderer = TestRenderer.create(React.createElement(mod[exportName], props));
    await flushEffects();
  });

  return renderer;
}

function findByName(renderer, name) {
  return renderer.root.findByProps({ name });
}

function findByDataProp(renderer, key, value) {
  return renderer.root.findByProps({ [key]: value });
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

function createDependencyStatusPayload() {
  return {
    healthy: false,
    checkedAt: 1712870400000,
    dependencies: [
      {
        name: 'redis',
        required: true,
        healthy: true,
        detail: 'PONG in 12ms'
      },
      {
        name: 'openai',
        required: false,
        healthy: false,
        detail: 'rate limited'
      }
    ],
    logs: [
      {
        timestamp: 1712870300000,
        level: 'info',
        dependency: 'redis',
        message: 'ping ok'
      }
    ]
  };
}

function createDependencyLogPayload(overrides = {}) {
  return {
    total: 1,
    query: {
      keyword: '',
      startDate: null,
      endDate: null,
      dependency: '',
      level: '',
      limit: 500
    },
    logs: [
      {
        timestamp: 1712870300000,
        level: 'info',
        dependency: 'redis',
        message: 'ping ok'
      }
    ],
    ...overrides
  };
}

function createVerboseAgentPayload() {
  return {
    logDir: '/tmp/verbose-logs',
    agents: [
      {
        agent: 'Alice',
        logCount: 2,
        latestFile: 'alice-latest.log',
        latestUpdatedAt: 1712870400000
      },
      {
        agent: 'Bob',
        logCount: 1,
        latestFile: 'bob-latest.log',
        latestUpdatedAt: 1712870200000
      }
    ]
  };
}

function createVerboseLogsPayload(agent, logs) {
  return {
    agent,
    logs
  };
}

test('ops API client 通过共享 HTTP client 加载依赖状态、依赖日志与 verbose 日志资源', async () => {
  const { createOpsApi } = loadTsModule('frontend/src/ops/services/ops-api.ts');
  const calls = [];

  const fetchImpl = async (url, init = {}) => {
    calls.push({
      url: String(url),
      init: { ...init, headers: headersToObject(init.headers) }
    });

    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ ok: true }),
      text: async () => '{"ok":true}'
    };
  };

  const api = createOpsApi({
    baseUrl: 'https://ops.test',
    fetch: fetchImpl
  });

  await api.loadDependencyStatus();
  await api.loadDependencyLogs({
    startDate: '2026-04-01',
    endDate: '2026-04-12',
    keyword: 'redis',
    dependency: 'redis',
    level: 'error',
    limit: 100
  });
  await api.listVerboseAgents();
  await api.listVerboseLogs('Alice');
  await api.loadVerboseLogContent('alice-1.log');

  assert.deepEqual(
    calls.map((call) => call.url),
    [
      'https://ops.test/api/dependencies/status',
      'https://ops.test/api/dependencies/logs?startDate=2026-04-01&endDate=2026-04-12&keyword=redis&dependency=redis&level=error&limit=100',
      'https://ops.test/api/verbose/agents',
      'https://ops.test/api/verbose/logs?agent=Alice',
      'https://ops.test/api/verbose/log-content?file=alice-1.log'
    ]
  );

  for (const call of calls) {
    assert.equal(call.init.credentials, 'include');
    assert.equal(call.init.cache, 'no-store');
  }
});

test('DepsMonitorPage 使用共享 tool layout 并通过 opsApi 加载依赖状态与日志', async () => {
  const calls = [];
  const api = {
    async loadDependencyStatus() {
      calls.push('status');
      return createDependencyStatusPayload();
    },
    async loadDependencyLogs(query) {
      calls.push(['logs', query]);
      return createDependencyLogPayload();
    }
  };

  const renderer = await renderComponent('frontend/src/ops/pages/DepsMonitorPage.tsx', 'DepsMonitorPage', {
    api
  });

  assert.equal(findByDataProp(renderer, 'data-ops-page', 'deps-monitor').props['data-ops-page'], 'deps-monitor');
  assert.equal(findByDataProp(renderer, 'data-layout', 'tool-page').props['data-layout'], 'tool-page');
  assert.deepEqual(calls, [
    'status',
    ['logs', {
      startDate: '',
      endDate: '',
      keyword: '',
      dependency: '',
      level: '',
      limit: 500
    }]
  ]);

  const statusRows = renderer.root.findAll((node) => node.props?.['data-dependency-row']);
  assert.equal(statusRows.length, 2);
  assert.match(collectText(renderer.toJSON()), /redis/);
  assert.match(collectText(renderer.toJSON()), /openai/);
  assert.match(collectText(renderer.toJSON()), /ping ok/);

  await act(async () => {
    renderer.unmount();
    await flushEffects();
  });
});

test('DepsMonitorPage 的过滤器与刷新控件会复用当前筛选条件', async () => {
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  let registeredInterval = null;
  let registeredDelay = null;
  const clearedIntervals = [];
  const calls = [];
  const api = {
    async loadDependencyStatus() {
      calls.push({ type: 'status' });
      return createDependencyStatusPayload();
    },
    async loadDependencyLogs(query) {
      calls.push({ type: 'logs', query });
      return createDependencyLogPayload({ query: { ...query } });
    }
  };

  global.setInterval = (fn, delay) => {
    registeredInterval = fn;
    registeredDelay = delay;
    return 77;
  };
  global.clearInterval = (intervalId) => {
    clearedIntervals.push(intervalId);
  };

  let renderer;
  try {
    renderer = await renderComponent('frontend/src/ops/pages/DepsMonitorPage.tsx', 'DepsMonitorPage', {
      api
    });

    assert.equal(typeof registeredInterval, 'function');
    assert.equal(registeredDelay, 10000);

    await changeField(renderer, 'dependency', 'redis');
    await changeField(renderer, 'keyword', 'timeout');
    await changeField(renderer, 'level', 'error');
    await changeField(renderer, 'startDate', '2026-04-10');
    await changeField(renderer, 'endDate', '2026-04-12');

    await act(async () => {
      findButtonByText(renderer, '应用筛选').props.onClick();
      await flushEffects();
    });

    assert.deepEqual(calls.at(-1), {
      type: 'logs',
      query: {
        startDate: '2026-04-10',
        endDate: '2026-04-12',
        keyword: 'timeout',
        dependency: 'redis',
        level: 'error',
        limit: 500
      }
    });

    await act(async () => {
      findByDataProp(renderer, 'data-ops-action', 'deps-refresh').props.onClick();
      await flushEffects();
    });

    assert.deepEqual(calls.slice(-2), [
      { type: 'status' },
      {
        type: 'logs',
        query: {
          startDate: '2026-04-10',
          endDate: '2026-04-12',
          keyword: 'timeout',
          dependency: 'redis',
          level: 'error',
          limit: 500
        }
      }
    ]);

    await act(async () => {
      await registeredInterval();
      await flushEffects();
    });

    assert.deepEqual(calls.slice(-2), [
      { type: 'status' },
      {
        type: 'logs',
        query: {
          startDate: '2026-04-10',
          endDate: '2026-04-12',
          keyword: 'timeout',
          dependency: 'redis',
          level: 'error',
          limit: 500
        }
      }
    ]);
  } finally {
    if (renderer) {
      await act(async () => {
        renderer.unmount();
        await flushEffects();
      });
    }
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  }

  assert.deepEqual(clearedIntervals, [77]);
});

test('VerboseLogsPage 使用共享 tool layout 并通过 opsApi 加载智能体、日志文件与内容', async () => {
  const calls = [];
  const api = {
    async listVerboseAgents() {
      calls.push('agents');
      return createVerboseAgentPayload();
    },
    async listVerboseLogs(agent) {
      calls.push(['logs', agent]);
      if (agent === 'Alice') {
        return createVerboseLogsPayload(agent, [
          {
            agent,
            fileName: 'alice-1.log',
            cli: 'codex',
            updatedAt: 1712870400000,
            size: 2048
          }
        ]);
      }
      return createVerboseLogsPayload(agent, []);
    },
    async loadVerboseLogContent(fileName) {
      calls.push(['content', fileName]);
      return {
        fileName,
        content: '2026-04-12T00:00:00.000Z [info] hello from alice'
      };
    }
  };

  const renderer = await renderComponent('frontend/src/ops/pages/VerboseLogsPage.tsx', 'VerboseLogsPage', {
    api
  });

  assert.equal(findByDataProp(renderer, 'data-ops-page', 'verbose-logs').props['data-ops-page'], 'verbose-logs');
  assert.equal(findByDataProp(renderer, 'data-layout', 'tool-page').props['data-layout'], 'tool-page');
  assert.deepEqual(calls, [
    'agents',
    ['logs', 'Alice'],
    ['content', 'alice-1.log']
  ]);
  assert.match(collectText(renderer.toJSON()), /Alice/);
  assert.match(collectText(renderer.toJSON()), /alice-1.log/);
  assert.match(collectText(renderer.toJSON()), /hello from alice/);
});

test('VerboseLogsPage 的筛选与刷新控件会保持当前智能体选择', async () => {
  const calls = [];
  const api = {
    async listVerboseAgents() {
      calls.push({ type: 'agents' });
      return createVerboseAgentPayload();
    },
    async listVerboseLogs(agent) {
      calls.push({ type: 'logs', agent });
      if (agent === 'Bob') {
        return createVerboseLogsPayload(agent, [
          {
            agent,
            fileName: 'bob-1.log',
            cli: 'codex',
            updatedAt: 1712870500000,
            size: 1024
          }
        ]);
      }

      return createVerboseLogsPayload(agent, [
        {
          agent,
          fileName: 'alice-1.log',
          cli: 'codex',
          updatedAt: 1712870400000,
          size: 2048
        }
      ]);
    },
    async loadVerboseLogContent(fileName) {
      calls.push({ type: 'content', fileName });
      return {
        fileName,
        content: `content:${fileName}`
      };
    }
  };

  const renderer = await renderComponent('frontend/src/ops/pages/VerboseLogsPage.tsx', 'VerboseLogsPage', {
    api
  });

  await act(async () => {
    findByDataProp(renderer, 'data-verbose-agent', 'Bob').props.onClick();
    await flushEffects();
  });

  assert.deepEqual(calls.slice(-2), [
    { type: 'logs', agent: 'Bob' },
    { type: 'content', fileName: 'bob-1.log' }
  ]);
  assert.match(collectText(renderer.toJSON()), /content:bob-1.log/);

  await changeField(renderer, 'agent', 'Bob');

  await act(async () => {
    findButtonByText(renderer, '应用筛选').props.onClick();
    await flushEffects();
  });

  assert.deepEqual(calls.slice(-2), [
    { type: 'logs', agent: 'Bob' },
    { type: 'content', fileName: 'bob-1.log' }
  ]);

  await act(async () => {
    findByDataProp(renderer, 'data-ops-action', 'verbose-refresh').props.onClick();
    await flushEffects();
  });

  assert.deepEqual(calls.slice(-3), [
    { type: 'agents' },
    { type: 'logs', agent: 'Bob' },
    { type: 'content', fileName: 'bob-1.log' }
  ]);
});
