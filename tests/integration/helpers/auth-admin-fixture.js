const { existsSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

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

let didEnsureBuild = false;

function ensureBuildArtifacts() {
  if (didEnsureBuild) {
    return;
  }

  if (!existsSync(join(process.cwd(), 'dist', 'auth-admin-server.js'))) {
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

async function createAuthAdminFixture(options = {}) {
  const maxAttempts = options.maxAttempts || 5;
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-co-auth-it-'));
  const adminToken = options.adminToken || 'integration-test-admin-token-1234567890';
  const usersFile = join(tempDir, 'users.json');
  const agentsFile = join(tempDir, 'agents.json');


  if (options.initialAgentStore) {
    writeFileSync(agentsFile, JSON.stringify(options.initialAgentStore, null, 2), 'utf-8');
  }

  let port = getRandomPort();
  let child = null;
  let stderr = '';
  let lastStartupError = null;
  ensureBuildArtifacts();

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    port = getRandomPort();
    stderr = '';
    child = spawn('node', ['dist/auth-admin-server.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        AUTH_ADMIN_PORT: String(port),
        AUTH_ADMIN_TOKEN: options.authAdminTokenEnv || adminToken,
        AUTH_DATA_FILE: usersFile,
        AGENT_DATA_FILE: agentsFile,
        AGENT_CO_DEFAULT_USER: 'admin',
        AGENT_CO_DEFAULT_PASSWORD: 'Admin1234!@#'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    try {
      await waitForHealth(port);
      lastStartupError = null;
      break;
    } catch (error) {
      lastStartupError = error;
      child.kill('SIGKILL');
      child = null;
      if (!String(stderr).includes('EADDRINUSE') || attempt === maxAttempts - 1) {
        rmSync(tempDir, { recursive: true, force: true });
        throw new Error(`${error.message}\n${stderr}`);
      }
    }
  }

  if (lastStartupError || !child) {
    rmSync(tempDir, { recursive: true, force: true });
    throw new Error(`auth admin server failed to start after ${maxAttempts} attempts`);
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
