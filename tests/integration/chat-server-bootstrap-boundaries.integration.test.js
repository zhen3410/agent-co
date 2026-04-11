const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..', '..');
const distBootstrapDir = path.join(repoRoot, 'dist', 'chat', 'bootstrap');
const serverPath = path.join(repoRoot, 'src', 'server.ts');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function parseTs(filePath) {
  return ts.createSourceFile(filePath, read(filePath), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function ensureBuildArtifacts() {
  const startupDistPath = path.join(distBootstrapDir, 'chat-server-startup.js');
  if (fs.existsSync(startupDistPath)) {
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

function collectImportSpecifiers(filePath) {
  const sourceFile = parseTs(filePath);
  const imports = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.push(statement.moduleSpecifier.text);
    }
  }

  return imports;
}

test('server entrypoint stays above low-level runtime/application/infrastructure assembly', () => {
  const imports = collectImportSpecifiers(serverPath);

  assert.equal(imports.some(specifier => specifier.startsWith('./chat/bootstrap/')), true);
  assert.equal(imports.some(specifier => specifier.includes('/application/')), false);
  assert.equal(imports.some(specifier => specifier.includes('/runtime/')), false);
  assert.equal(imports.some(specifier => specifier.includes('/infrastructure/')), false);
});

test('compiled startup helpers expose the bootstrap boundary API', () => {
  ensureBuildArtifacts();

  const startupModule = require(path.join(distBootstrapDir, 'chat-server-startup.js'));
  const securityModule = require(path.join(distBootstrapDir, 'chat-startup-security.js'));
  const bannerModule = require(path.join(distBootstrapDir, 'chat-startup-banner.js'));
  const envConfigModule = require(path.join(distBootstrapDir, 'chat-env-config.js'));

  assert.equal(typeof startupModule.startChatServer, 'function');
  assert.equal(typeof securityModule.performChatStartupSecurityChecks, 'function');
  assert.equal(typeof securityModule.analyzeChatStartupSecurity, 'function');
  assert.equal(typeof bannerModule.logChatStartupBanner, 'function');
  assert.equal(typeof envConfigModule.createChatEnvConfig, 'function');
});

test('chat env config defaults use agent-co identifiers', () => {
  ensureBuildArtifacts();
  const envConfigModule = require(path.join(distBootstrapDir, 'chat-env-config.js'));
  const config = envConfigModule.createChatEnvConfig({
    cwd: repoRoot,
    serverDirname: path.join(repoRoot, 'dist'),
    env: {}
  });

  assert.equal(config.redis.configKey, 'agent-co:config');
  assert.equal(config.redis.defaultChatSessionsKey, 'agent-co:chat:sessions:v1');
  assert.equal(config.callback.authHeader, 'x-agent-co-callback-token');
  assert.equal(config.callback.authToken, 'agent-co-callback-token');
});

test('chat env config prefers REDIS_URL when provided', () => {
  ensureBuildArtifacts();
  const envConfigModule = require(path.join(distBootstrapDir, 'chat-env-config.js'));
  const config = envConfigModule.createChatEnvConfig({
    cwd: repoRoot,
    serverDirname: path.join(repoRoot, 'dist'),
    env: {
      REDIS_URL: 'redis://redis:6379'
    }
  });

  assert.equal(config.redis.url, 'redis://redis:6379');
});

test('chat env config prefers HOST when provided', () => {
  ensureBuildArtifacts();
  const envConfigModule = require(path.join(distBootstrapDir, 'chat-env-config.js'));
  const config = envConfigModule.createChatEnvConfig({
    cwd: repoRoot,
    serverDirname: path.join(repoRoot, 'dist'),
    env: {
      HOST: '0.0.0.0'
    }
  });

  assert.equal(config.host, '0.0.0.0');
});

test('compiled startup security helper exposes pure analysis with stable warning/error behavior', () => {
  ensureBuildArtifacts();
  const securityModule = require(path.join(distBootstrapDir, 'chat-startup-security.js'));

  assert.deepEqual(
    securityModule.analyzeChatStartupSecurity({
      nodeEnv: 'development',
      authAdminToken: undefined,
      defaultPassword: undefined
    }),
    {
      errors: [],
      warnings: ['⚠️ AUTH_ADMIN_TOKEN 未设置或使用默认值（仅开发环境允许）']
    }
  );

  assert.deepEqual(
    securityModule.analyzeChatStartupSecurity({
      nodeEnv: 'production',
      authAdminToken: undefined,
      defaultPassword: undefined
    }),
    {
      errors: ['❌ 生产环境必须设置 AUTH_ADMIN_TOKEN 环境变量'],
      warnings: []
    }
  );
});
