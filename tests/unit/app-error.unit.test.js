const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const distDir = path.join(repoRoot, 'dist');

function requireBuiltModule(...segments) {
  const modulePath = path.join(distDir, ...segments);
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

test('fast test scripts build first and fast-layer tests do not self-build', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  assert.match(packageJson.scripts['test:unit'], /^npm run build && /);
  assert.match(packageJson.scripts['test:fast'], /^npm run build && /);

  for (const relativePath of [
    'tests/unit/agent-invocation.unit.test.js',
    'tests/unit/session-discussion-rules.unit.test.js',
    'tests/integration/chat-server-runtime-contract.integration.test.js',
    'tests/integration/chat-server-service-boundaries.integration.test.js',
    'tests/integration/chat-server-session-service-boundaries.integration.test.js',
    'tests/integration/chat-server-ops-boundaries.integration.test.js'
  ]) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    assert.doesNotMatch(source, /ensureBuildArtifacts/);
    assert.doesNotMatch(source, /spawnSync\((?:'|")npm(?:'|"),\s*\[(?:'|")run(?:'|"),\s*(?:'|")build(?:'|")\]\)/);
  }
});

test('typed app error modules expose a stable low-level export surface', () => {
  assert.deepEqual(
    Object.keys(requireBuiltModule('shared', 'errors', 'app-error.js')).sort(),
    ['AppError', 'isAppError']
  );
  assert.deepEqual(
    Object.keys(requireBuiltModule('shared', 'errors', 'app-error-codes.js')).sort(),
    ['APP_ERROR_CODES', 'getAppErrorCodeForStatusCode', 'getAppErrorStatusCode']
  );
  assert.deepEqual(
    Object.keys(requireBuiltModule('shared', 'http', 'error-mapper.js')).sort(),
    ['mapHttpError']
  );
});

test('AppError 提供稳定的 code/status/details 映射', () => {
  const { AppError, isAppError } = requireBuiltModule('shared', 'errors', 'app-error.js');
  const {
    APP_ERROR_CODES,
    getAppErrorCodeForStatusCode,
    getAppErrorStatusCode
  } = requireBuiltModule('shared', 'errors', 'app-error-codes.js');
  const { mapHttpError } = requireBuiltModule('shared', 'http', 'error-mapper.js');

  const error = new AppError('登录尝试过于频繁，请稍后再试', {
    code: APP_ERROR_CODES.RATE_LIMITED
  });

  assert.equal(isAppError(error), true);
  assert.equal(error.code, APP_ERROR_CODES.RATE_LIMITED);
  assert.equal(error.statusCode, 429);
  assert.equal(getAppErrorStatusCode(APP_ERROR_CODES.CONFLICT), 409);
  assert.equal(getAppErrorCodeForStatusCode(404), APP_ERROR_CODES.NOT_FOUND);
  assert.deepEqual(mapHttpError(error), {
    statusCode: 429,
    body: { error: '登录尝试过于频繁，请稍后再试' }
  });
});

test('HTTP 错误映射保留 invalid JSON 与 fallback 语义', () => {
  const { createHttpBodyParseError } = requireBuiltModule('shared', 'http', 'body.js');
  const { AppError } = requireBuiltModule('shared', 'errors', 'app-error.js');
  const { APP_ERROR_CODES } = requireBuiltModule('shared', 'errors', 'app-error-codes.js');
  const { mapHttpError } = requireBuiltModule('shared', 'http', 'error-mapper.js');

  assert.deepEqual(mapHttpError(createHttpBodyParseError(), { invalidJsonStatus: 422 }), {
    statusCode: 422,
    body: { error: 'Invalid JSON' }
  });

  assert.deepEqual(
    mapHttpError(
      new AppError('未授权，请先登录', { code: APP_ERROR_CODES.UNAUTHORIZED }),
      {
        mapBody: (message, error) => ({
          kind: 'custom',
          message,
          code: error.code
        })
      }
    ),
    {
      statusCode: 401,
      body: {
        kind: 'custom',
        message: '未授权，请先登录',
        code: APP_ERROR_CODES.UNAUTHORIZED
      }
    }
  );

  assert.deepEqual(mapHttpError(new Error('boom'), { fallbackStatus: 418 }), {
    statusCode: 418,
    body: { error: 'boom' }
  });
});

test('状态码到 AppError code 的映射是严格的，不会静默吞掉未知状态', () => {
  const { getAppErrorCodeForStatusCode } = requireBuiltModule('shared', 'errors', 'app-error-codes.js');

  assert.throws(
    () => getAppErrorCodeForStatusCode(418),
    /unsupported.*status code/i
  );
});

test('AppError 允许在保留语义 code 的前提下覆盖具体 status', () => {
  const { AppError } = requireBuiltModule('shared', 'errors', 'app-error.js');
  const { APP_ERROR_CODES } = requireBuiltModule('shared', 'errors', 'app-error-codes.js');

  const error = new AppError('上游超时', {
    code: APP_ERROR_CODES.DEPENDENCY_FAILURE,
    statusCode: 504
  });

  assert.equal(error.code, APP_ERROR_CODES.DEPENDENCY_FAILURE);
  assert.equal(error.statusCode, 504);
});

test('默认 HTTP 错误映射不会盲目暴露 AppError 的额外字段', () => {
  const { AppError } = requireBuiltModule('shared', 'errors', 'app-error.js');
  const { APP_ERROR_CODES } = requireBuiltModule('shared', 'errors', 'app-error-codes.js');
  const { mapHttpError } = requireBuiltModule('shared', 'http', 'error-mapper.js');

  const error = new AppError('bad request', {
    code: APP_ERROR_CODES.VALIDATION_FAILED,
    details: {
      debug: 'should not leak',
      retryAfter: 5
    }
  });

  assert.deepEqual(mapHttpError(error), {
    statusCode: 400,
    body: { error: 'bad request' }
  });
});
