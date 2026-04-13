const { existsSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createAuthAdminFixture } = require('./auth-admin-fixture');

function getRandomPort() {
  return Math.floor(Math.random() * 10000) + 30000;
}

async function waitForServer(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/auth-status`);
      if (response.ok) return;
      lastError = new Error(`status=${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 120));
  }

  throw new Error(`chat server failed to start: ${String(lastError)}`);
}

function parseSetCookie(setCookieHeader) {
  if (!setCookieHeader) return [];
  if (Array.isArray(setCookieHeader)) {
    return setCookieHeader.map(item => String(item).split(';')[0]);
  }

  return String(setCookieHeader)
    .split(/,(?=\s*[^;]+=)/)
    .map(item => item.trim().split(';')[0]);
}

let didEnsureBuild = false;

function ensureBuildArtifacts() {
  if (didEnsureBuild && existsSync(join(process.cwd(), 'dist', 'server.js'))) {
    return;
  }

  if (!existsSync(join(process.cwd(), 'dist', 'server.js'))) {
    const result = spawnSync('npm', ['run', 'build'], {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8'
    });
    if (result.status !== 0) {
      throw new Error(`failed to build integration fixtures:\n${result.stdout || ''}\n${result.stderr || ''}`);
    }
  }

  didEnsureBuild = true;
}

async function createChatServerFixture(options = {}) {
  const maxAttempts = options.maxAttempts || 5;
  const startupTimeoutMs = options.startupTimeoutMs || 10000;
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-chat-it-'));
  const agentDataFile = join(tempDir, 'agents.json');
  let authFixture = null;
  let child = null;
  let stderr = '';
  let port = getRandomPort();
  let lastStartupError = null;
  ensureBuildArtifacts();

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    port = getRandomPort();
    stderr = '';
    authFixture = await createAuthAdminFixture();
    child = spawn('node', ['dist/server.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: options.nodeEnv || 'test',
        PORT: String(port),
        AGENT_CO_AUTH_ENABLED: 'true',
        AGENT_CO_REDIS_REQUIRED: 'false',
        AGENT_CO_DISABLE_REDIS: 'true',
        AGENT_DATA_FILE: agentDataFile,
        AUTH_ADMIN_TOKEN: 'integration-test-admin-token-1234567890',
        AUTH_ADMIN_BASE_URL: `http://127.0.0.1:${authFixture.port}`,
        AGENT_CO_CLI_TIMEOUT_MS: '15000',
        AGENT_CO_CLI_HEARTBEAT_TIMEOUT_MS: '5000',
        AGENT_CO_CLI_KILL_GRACE_MS: '200',
        ...(options.env || {})
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    try {
      await waitForServer(port, startupTimeoutMs);
      lastStartupError = null;
      break;
    } catch (error) {
      lastStartupError = error;
      child.kill('SIGKILL');
      await authFixture.cleanup();
      child = null;
      authFixture = null;

      if (!String(stderr).includes('EADDRINUSE') || attempt === maxAttempts - 1) {
        rmSync(tempDir, { recursive: true, force: true });
        throw new Error(`${error.message}\n${stderr}`);
      }
    }
  }

  if (lastStartupError || !child || !authFixture) {
    rmSync(tempDir, { recursive: true, force: true });
    throw new Error(`chat server failed to start after ${maxAttempts} attempts`);
  }

  const cookieJar = new Map();

  async function request(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    const cookieHeader = Array.from(cookieJar.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    for (const cookie of parseSetCookie(response.headers.get('set-cookie'))) {
      const [pair] = cookie.split(';');
      const [name, ...rest] = pair.split('=');
      cookieJar.set(name, rest.join('='));
    }

    let text = '';
    if (response.body) {
      text = await response.text();
    }

    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    return { status: response.status, body: json, text };
  }

  async function login(username = 'admin', password = 'Admin1234!@#') {
    return request('/api/login', {
      method: 'POST',
      body: { username, password }
    });
  }

  return {
    port,
    request,
    login,
    getCookieHeader() {
      return Array.from(cookieJar.entries())
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
    },
    async cleanup() {
      if (!child.killed) {
        child.kill('SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 150));
        if (!child.killed) child.kill('SIGKILL');
      }
      await authFixture.cleanup();
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

module.exports = { createChatServerFixture };
