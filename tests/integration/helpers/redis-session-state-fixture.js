const { execFileSync } = require('node:child_process');
const { openSync, closeSync, unlinkSync, writeFileSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const REDIS_CONFIG_KEY = 'agent-co:config';
const TEST_KEY_PREFIX = 'agent-co:test:session-chain-settings';
const LOCK_FILE = join(tmpdir(), 'agent-co-session-chain-settings-lock');
const LOCK_WAIT_MS = 100;
const LOCK_TIMEOUT_MS = 10000;

function redisCli(args) {
  return execFileSync('redis-cli', args, { encoding: 'utf8' });
}

function redisCliAvailable() {
  try {
    execFileSync('redis-cli', ['--version'], { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

function redisReachable() {
  try {
    const pong = execFileSync('redis-cli', ['PING'], { encoding: 'utf8' }).trim();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

function isRedisSessionStateAvailable() {
  return redisCliAvailable() && redisReachable();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withDirectoryLock(run) {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let acquired = false;
  const lockToken = JSON.stringify({
    pid: process.pid,
    createdAt: Date.now(),
    token: `${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`
  });

  while (Date.now() < deadline) {
    try {
      const fd = openSync(LOCK_FILE, 'wx');
      writeFileSync(fd, lockToken);
      closeSync(fd);
      acquired = true;
      break;
    } catch {
      await sleep(LOCK_WAIT_MS);
    }
  }

  if (!acquired) {
    throw new Error('failed to create redis session state lock');
  }

  try {
    return await run();
  } finally {
    if (!acquired) return;
    try {
      if (readFileSync(LOCK_FILE, 'utf8') === lockToken) {
        unlinkSync(LOCK_FILE);
      }
    } catch {
      // ignore
    }
  }
}

function getChatSessionsKey() {
  const result = redisCli(['HGET', REDIS_CONFIG_KEY, 'chat_sessions_key']);
  const trimmed = result.trim();
  return trimmed || null;
}

function setChatSessionsKey(key) {
  redisCli(['HSET', REDIS_CONFIG_KEY, 'chat_sessions_key', key]);
}

function clearChatSessionsKey() {
  redisCli(['HDEL', REDIS_CONFIG_KEY, 'chat_sessions_key']);
}

function makeIsolatedSessionStateKey() {
  return `${TEST_KEY_PREFIX}:${Date.now()}:${Math.random().toString(16).slice(2)}:sessions:v1`;
}

function writeSessionState(key, state) {
  redisCli(['SET', key, JSON.stringify(state)]);
}

function deleteSessionState(key) {
  if (!key) return;
  redisCli(['DEL', key]);
}

async function withIsolatedChatSessionState(state, run) {
  if (!isRedisSessionStateAvailable()) {
    const error = new Error('redis-cli or Redis is unavailable');
    error.code = 'REDIS_UNAVAILABLE';
    throw error;
  }

  return withDirectoryLock(async () => {
    const previousKey = getChatSessionsKey();
    const key = makeIsolatedSessionStateKey();
    writeSessionState(key, state);
    setChatSessionsKey(key);

    try {
      return await run({ key, previousKey });
    } finally {
      deleteSessionState(key);
      if (previousKey) {
        setChatSessionsKey(previousKey);
      } else {
        clearChatSessionsKey();
      }
    }
  });
}

module.exports = {
  withIsolatedChatSessionState,
  isRedisSessionStateAvailable
};
