const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawn } = require('node:child_process');

async function waitForHealth(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`healthz status=${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error(`Auth admin server failed to become healthy: ${String(lastError)}`);
}

function getRandomPort() {
  return Math.floor(Math.random() * 10000) + 20000;
}

async function createAuthAdminFixture(options = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-auth-it-'));
  const port = getRandomPort();
  const adminToken = options.adminToken || 'integration-test-admin-token-1234567890';
  const usersFile = join(tempDir, 'users.json');
  const agentsFile = join(tempDir, 'agents.json');


  if (options.initialAgentStore) {
    writeFileSync(agentsFile, JSON.stringify(options.initialAgentStore, null, 2), 'utf-8');
  }

  const child = spawn('node', ['dist/auth-admin-server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      AUTH_ADMIN_PORT: String(port),
      AUTH_ADMIN_TOKEN: options.authAdminTokenEnv || adminToken,
      AUTH_DATA_FILE: usersFile,
      AGENT_DATA_FILE: agentsFile,
      BOT_ROOM_DEFAULT_USER: 'admin',
      BOT_ROOM_DEFAULT_PASSWORD: 'Admin1234!@#'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  try {
    await waitForHealth(port);
  } catch (error) {
    child.kill('SIGKILL');
    throw new Error(`${error.message}\n${stderr}`);
  }

  async function request(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    let json;
    try {
      json = await response.json();
    } catch {
      json = null;
    }

    return { status: response.status, body: json };
  }

  return {
    port,
    adminToken,
    request,
    async cleanup() {
      if (!child.killed) {
        child.kill('SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 150));
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

module.exports = { createAuthAdminFixture };
