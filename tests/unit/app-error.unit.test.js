const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const distDir = path.join(repoRoot, 'dist');

function ensureBuildArtifacts() {
  if (fs.existsSync(path.join(distDir, 'shared', 'errors', 'app-error.js'))) {
    return;
  }

  const result = spawnSync('npm', ['run', 'build'], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(`failed to build unit test artifacts:\n${result.stdout || ''}\n${result.stderr || ''}`);
  }
}

test('AppError 提供稳定的 code/status/details 映射', () => {
  ensureBuildArtifacts();

  const { AppError, isAppError } = require(path.join(distDir, 'shared', 'errors', 'app-error.js'));
  const {
    APP_ERROR_CODES,
    getAppErrorCodeForStatusCode,
    getAppErrorStatusCode
  } = require(path.join(distDir, 'shared', 'errors', 'app-error-codes.js'));
  const { mapHttpError } = require(path.join(distDir, 'shared', 'http', 'error-mapper.js'));

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
  ensureBuildArtifacts();

  const { createHttpBodyParseError } = require(path.join(distDir, 'shared', 'http', 'body.js'));
  const { AppError } = require(path.join(distDir, 'shared', 'errors', 'app-error.js'));
  const { APP_ERROR_CODES } = require(path.join(distDir, 'shared', 'errors', 'app-error-codes.js'));
  const { mapHttpError } = require(path.join(distDir, 'shared', 'http', 'error-mapper.js'));

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
  ensureBuildArtifacts();

  const { getAppErrorCodeForStatusCode } = require(path.join(distDir, 'shared', 'errors', 'app-error-codes.js'));

  assert.throws(
    () => getAppErrorCodeForStatusCode(418),
    /unsupported.*status code/i
  );
});

test('默认 HTTP 错误映射不会盲目暴露 AppError 的额外字段', () => {
  ensureBuildArtifacts();

  const { AppError } = require(path.join(distDir, 'shared', 'errors', 'app-error.js'));
  const { APP_ERROR_CODES } = require(path.join(distDir, 'shared', 'errors', 'app-error-codes.js'));
  const { mapHttpError } = require(path.join(distDir, 'shared', 'http', 'error-mapper.js'));

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
