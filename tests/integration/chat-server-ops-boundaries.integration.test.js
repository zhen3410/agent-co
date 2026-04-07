const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');

function ensureBuildArtifacts() {
  const opsRoutesDistPath = path.join(repoRoot, 'dist', 'chat', 'http', 'ops-routes.js');
  if (existsSync(opsRoutesDistPath)) {
    return;
  }

  const result = spawnSync('npm', ['run', 'build'], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(`failed to build boundary test artifacts:\n${result.stdout || ''}\n${result.stderr || ''}`);
  }
}

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk = '') {
      this.body = String(chunk);
    }
  };
}

function parseJsonResponse(res) {
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    body: res.body ? JSON.parse(res.body) : null
  };
}

test('依赖路由 helper 返回依赖状态 JSON 契约', async () => {
  ensureBuildArtifacts();
  const { handleDependencyRoutes } = require(path.join(repoRoot, 'dist', 'chat', 'http', 'ops', 'dependency-routes.js'));
  const res = createMockResponse();

  const handled = await handleDependencyRoutes(
    { method: 'GET' },
    res,
    new URL('http://127.0.0.1/api/dependencies/status'),
    {
      runtime: {
        async collectDependencyStatus() {
          return [{ name: 'redis', required: true, healthy: true, detail: 'PONG' }];
        },
        listDependencyStatusLogs() {
          return [{ timestamp: 1, level: 'info', dependency: 'redis', message: 'PONG' }];
        }
      }
    }
  );

  const response = parseJsonResponse(res);
  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.healthy, true);
  assert.deepEqual(response.body.dependencies, [{ name: 'redis', required: true, healthy: true, detail: 'PONG' }]);
  assert.deepEqual(response.body.logs, [{ timestamp: 1, level: 'info', dependency: 'redis', message: 'PONG' }]);
});

test('系统路由 helper 返回 workdir 选项数组', async () => {
  ensureBuildArtifacts();
  const { handleSystemRoutes } = require(path.join(repoRoot, 'dist', 'chat', 'http', 'ops', 'system-routes.js'));
  const res = createMockResponse();

  const handled = await handleSystemRoutes(
    { method: 'GET' },
    res,
    new URL('http://127.0.0.1/api/workdirs/options')
  );

  const response = parseJsonResponse(res);
  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(Array.isArray(response.body.options), true);
  assert.equal(response.body.options.length > 0, true);
});

test('verbose log 路由 helper 能返回指定 agent 的日志列表', async () => {
  ensureBuildArtifacts();
  const { handleVerboseLogRoutes } = require(path.join(repoRoot, 'dist', 'chat', 'http', 'ops', 'verbose-log-routes.js'));
  const tempDir = mkdtempSync(path.join(tmpdir(), 'ops-boundary-logs-'));
  try {
    writeFileSync(
      path.join(tempDir, '2026-04-07T00-00-00-000Z-codex-Codex%E6%9E%B6%E6%9E%84%E5%B8%88.log'),
      'hello',
      'utf8'
    );

    const res = createMockResponse();
    const handled = await handleVerboseLogRoutes(
      { method: 'GET' },
      res,
      new URL('http://127.0.0.1/api/verbose/logs?agent=Codex架构师'),
      { verboseLogDir: tempDir }
    );

    const response = parseJsonResponse(res);
    assert.equal(handled, true);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.agent, 'Codex架构师');
    assert.equal(response.body.logs.length, 1);
    assert.equal(response.body.logs[0].agent, 'Codex架构师');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ops-routes 继续委托 JSON/ops 路由并对未知路径返回 false', async () => {
  ensureBuildArtifacts();
  const { handleOpsRoutes } = require(path.join(repoRoot, 'dist', 'chat', 'http', 'ops-routes.js'));

  const handledRes = createMockResponse();
  const handled = await handleOpsRoutes(
    { method: 'GET' },
    handledRes,
    new URL('http://127.0.0.1/api/dependencies/status'),
    {
      runtime: {
        async collectDependencyStatus() {
          return [{ name: 'redis', required: false, healthy: true, detail: 'disabled' }];
        },
        listDependencyStatusLogs() {
          return [];
        }
      },
      verboseLogDir: mkdtempSync(path.join(tmpdir(), 'ops-boundary-delegate-')),
      publicDir: path.join(repoRoot, 'public')
    }
  );
  assert.equal(handled, true);
  assert.equal(parseJsonResponse(handledRes).body.healthy, true);

  const missRes = createMockResponse();
  const missed = await handleOpsRoutes(
    { method: 'GET' },
    missRes,
    new URL('http://127.0.0.1/not-handled'),
    {
      runtime: {
        async collectDependencyStatus() {
          return [];
        },
        listDependencyStatusLogs() {
          return [];
        }
      },
      verboseLogDir: path.join(repoRoot, 'logs'),
      publicDir: path.join(repoRoot, 'public')
    }
  );
  assert.equal(missed, false);
});
