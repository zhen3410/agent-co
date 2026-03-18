const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawn } = require('node:child_process');
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

async function createChatServerFixture(options = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-chat-it-'));
  const port = getRandomPort();
  const agentDataFile = join(tempDir, 'agents.json');
  const authFixture = await createAuthAdminFixture();

  const child = spawn('node', ['dist/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      BOT_ROOM_AUTH_ENABLED: 'true',
      BOT_ROOM_REDIS_REQUIRED: 'false',
      AGENT_DATA_FILE: agentDataFile,
      AUTH_ADMIN_TOKEN: 'integration-test-admin-token-1234567890',
      AUTH_ADMIN_BASE_URL: `http://127.0.0.1:${authFixture.port}`,
      ...(options.env || {})
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  try {
    await waitForServer(port);
  } catch (error) {
    child.kill('SIGKILL');
    await authFixture.cleanup();
    throw new Error(`${error.message}\n${stderr}`);
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
