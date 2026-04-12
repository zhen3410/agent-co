const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createChatServerFixture } = require('./helpers/chat-server-fixture');

function decodeMessageData(data) {
  if (typeof data === 'string') {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  }

  return String(data);
}

function createJsonMessageCollector(socket) {
  const queue = [];
  const waiters = [];

  socket.addEventListener('message', (event) => {
    let parsed;
    try {
      parsed = JSON.parse(decodeMessageData(event.data));
    } catch {
      return;
    }

    if (waiters.length > 0) {
      const waiter = waiters.shift();
      waiter.resolve(parsed);
      return;
    }

    queue.push(parsed);
  });

  function next(timeoutMs = 2000) {
    if (queue.length > 0) {
      return Promise.resolve(queue.shift());
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = waiters.findIndex((item) => item.resolve === resolve);
        if (index >= 0) {
          waiters.splice(index, 1);
        }
        reject(new Error(`timeout waiting for websocket message in ${timeoutMs}ms`));
      }, timeoutMs);

      waiters.push({
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
      });
    });
  }

  async function waitFor(predicate, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      const message = await next(remaining);
      if (predicate(message)) {
        return message;
      }
    }
    throw new Error(`timeout waiting for websocket message predicate in ${timeoutMs}ms`);
  }

  return { next, waitFor };
}

function openWebSocket(url, options) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options);
    const handleOpen = () => {
      ws.removeEventListener('error', handleError);
      resolve(ws);
    };
    const handleError = (event) => {
      ws.removeEventListener('open', handleOpen);
      reject(event.error || new Error('websocket open failed'));
    };
    ws.addEventListener('open', handleOpen, { once: true });
    ws.addEventListener('error', handleError, { once: true });
  });
}

async function closeWebSocket(ws) {
  if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    return;
  }

  await new Promise((resolve) => {
    ws.addEventListener('close', () => resolve(), { once: true });
    ws.close();
  });
}

async function fetchTimeline(fixture, sessionId, options = {}) {
  const query = Number.isInteger(options.afterSeq)
    ? `?afterSeq=${options.afterSeq}`
    : '';
  const response = await fixture.request(`/api/sessions/${sessionId}/timeline${query}`);
  assert.equal(response.status, 200, `timeline request should succeed for session ${sessionId}`);
  const timeline = Array.isArray(response.body?.timeline) ? response.body.timeline : [];
  return timeline;
}

function getFunctionBody(source, functionName) {
  const signaturePattern = new RegExp(`(?:async\\s+)?function\\s+${functionName}\\s*\\(`);
  const match = source.match(signaturePattern);
  assert.ok(match, `should contain function: ${functionName}`);

  const startIndex = match.index;
  const openParenIndex = source.indexOf('(', startIndex);
  assert.notEqual(openParenIndex, -1, `should contain function params: ${functionName}`);
  let parenDepth = 0;
  let closeParenIndex = -1;
  for (let index = openParenIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') parenDepth += 1;
    if (char === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        closeParenIndex = index;
        break;
      }
    }
  }
  assert.notEqual(closeParenIndex, -1, `should close function params: ${functionName}`);
  const openBraceIndex = source.indexOf('{', closeParenIndex);
  assert.notEqual(openBraceIndex, -1, `should contain function body: ${functionName}`);

  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  assert.fail(`unable to extract function body: ${functionName}`);
}

function createReconnectCompensationHarness(overrides = {}) {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
  const deriveTimelineTailSeqBody = getFunctionBody(html, 'deriveTimelineTailSeq');
  const shouldFallbackBody = getFunctionBody(html, 'shouldFallbackToFullRefresh');
  const runReconnectBody = getFunctionBody(html, 'runReconnectCompensation');

  const fetchCalls = [];
  const fullRefreshCalls = [];
  const context = {
    timelineRows: [{ seq: 1 }, { seq: 2 }, { seq: 3 }, { seq: 4 }, { seq: 5 }],
    lastSeenEventSeq: 5,
    activeSessionId: 'session-a',
    activeSessionSyncNonce: 9,
    timelineRefreshState: {
      state: 'idle',
      inFlight: false,
      pending: false,
      preferIncremental: true
    },
    TIMELINE_REFRESH_STATES: {
      idle: 'idle',
      full: 'full',
      incremental: 'incremental'
    },
    refreshSyncStatus: () => {},
    scheduleTimelineRefresh: () => {},
    renderMessages: () => {},
    deriveLastSeenEventSeq: (rows) => rows.reduce((maxSeq, row) => Math.max(maxSeq, Number(row?.seq) || 0), 0),
    refreshActiveSessionTimeline: async (options = {}) => {
      fullRefreshCalls.push(options);
      return { fallback: true, options };
    },
    fetch: async (url) => {
      fetchCalls.push(url);
      return {
        ok: true,
        async json() {
          return { timeline: [{ seq: 9 }] };
        }
      };
    },
    encodeURIComponent,
    console
  };

  Object.assign(context, overrides);
  vm.createContext(context);
  vm.runInContext(`
${deriveTimelineTailSeqBody}
${shouldFallbackBody}
${runReconnectBody}
this.__runReconnectCompensation = runReconnectCompensation;
`, context);

  return {
    runReconnectCompensation: context.__runReconnectCompensation.bind(context),
    context,
    fetchCalls,
    fullRefreshCalls
  };
}

test('websocket route 支持 session 订阅回放、实时事件推送、heartbeat/ping 与 unsubscribe 清理', async () => {
  const fixture = await createChatServerFixture({
    env: {
      AGENT_CO_WS_HEARTBEAT_INTERVAL_MS: '30'
    }
  });

  let ws = null;
  try {
    const login = await fixture.login();
    assert.equal(login.status, 200);

    const firstChat = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: 'ws integration first message' }
    });
    assert.equal(firstChat.status, 200);
    assert.equal(firstChat.body.accepted, true);

    const sessionId = firstChat.body.session.id;
    const wsUrl = `ws://127.0.0.1:${fixture.port}/api/ws/session-events`;
    ws = await openWebSocket(wsUrl, {
      headers: {
        Cookie: fixture.getCookieHeader()
      }
    });

    const messages = createJsonMessageCollector(ws);

    ws.send(JSON.stringify({
      type: 'subscribe',
      sessionId,
      afterSeq: 1
    }));

    let subscribed = null;
    let backfilled = null;
    const subscribeDeadline = Date.now() + 3000;
    while (Date.now() < subscribeDeadline && (!subscribed || !backfilled)) {
      const message = await messages.next(Math.max(1, subscribeDeadline - Date.now()));
      if (message.type === 'subscribed') {
        subscribed = message;
        continue;
      }
      if (
        message.type === 'session_event'
        && message.event
        && message.event.sessionId === sessionId
        && message.event.seq === 2
      ) {
        backfilled = message;
      }
    }

    assert.ok(subscribed, 'expected subscribed ack message');
    assert.equal(subscribed.sessionId, sessionId);
    assert.equal(typeof subscribed.latestSeq, 'number');
    assert.ok(backfilled, 'expected backfilled session_event seq=2');
    assert.equal(backfilled.event.eventType, 'user_message_created');

    const heartbeat = await messages.waitFor((message) => message.type === 'heartbeat', 3000);
    assert.equal(typeof heartbeat.timestamp, 'number');

    ws.send(JSON.stringify({ type: 'ping' }));
    const pong = await messages.waitFor((message) => message.type === 'pong');
    assert.equal(typeof pong.timestamp, 'number');

    const secondChat = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: 'ws integration second message' }
    });
    assert.equal(secondChat.status, 200);

    const seq3 = await messages.waitFor((message) => message.type === 'session_event' && message.event?.seq === 3, 3000);
    const seq4 = await messages.waitFor((message) => message.type === 'session_event' && message.event?.seq === 4, 3000);
    assert.equal(seq3.event.eventType, 'message_thinking_started');
    assert.equal(seq4.event.eventType, 'user_message_created');

    ws.send(JSON.stringify({ type: 'unsubscribe' }));
    const unsubscribed = await messages.waitFor((message) => message.type === 'unsubscribed');
    assert.equal(unsubscribed.success, true);

    const thirdChat = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: 'ws integration third message' }
    });
    assert.equal(thirdChat.status, 200);

    await assert.rejects(
      () => messages.waitFor((message) => message.type === 'session_event' && message.event?.seq >= 5, 450),
      /timeout waiting for websocket message/
    );
  } finally {
    if (ws) {
      await closeWebSocket(ws);
    }
    await fixture.cleanup();
  }
});

test('websocket 重连后先尝试 afterSeq 增量补偿，并在增量序列跳跃时通过客户端路径回退全量时间线', async () => {
  const fixture = await createChatServerFixture();
  let ws = null;
  let reconnectWs = null;

  try {
    const login = await fixture.login();
    assert.equal(login.status, 200);

    const firstChat = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: 'ws reconnect compensation first message' }
    });
    assert.equal(firstChat.status, 200);
    const sessionId = firstChat.body?.session?.id;
    assert.ok(sessionId, 'should create a first active session');

    const baseTimeline = await fetchTimeline(fixture, sessionId);
    let lastSeenEventSeq = Math.max(0, ...baseTimeline.map((row) => Number(row?.seq) || 0));

    ws = await openWebSocket(`ws://127.0.0.1:${fixture.port}/api/ws/session-events`, {
      headers: { Cookie: fixture.getCookieHeader() }
    });
    const firstMessages = createJsonMessageCollector(ws);
    ws.send(JSON.stringify({ type: 'subscribe', sessionId, afterSeq: lastSeenEventSeq }));
    await firstMessages.waitFor((message) => message.type === 'subscribed' && message.sessionId === sessionId, 3000);

    await closeWebSocket(ws);
    ws = null;

    const secondChat = await fixture.request('/api/chat', {
      method: 'POST',
      body: { message: 'ws reconnect compensation second message' }
    });
    assert.equal(secondChat.status, 200);

    reconnectWs = await openWebSocket(`ws://127.0.0.1:${fixture.port}/api/ws/session-events`, {
      headers: { Cookie: fixture.getCookieHeader() }
    });
    const reconnectMessages = createJsonMessageCollector(reconnectWs);
    reconnectWs.send(JSON.stringify({ type: 'subscribe', sessionId, afterSeq: lastSeenEventSeq }));

    const reconnectSubscribed = await reconnectMessages.waitFor(
      (message) => message.type === 'subscribed' && message.sessionId === sessionId,
      3000
    );
    assert.ok(
      Number(reconnectSubscribed.latestSeq) > lastSeenEventSeq,
      'reconnect subscribe ack should advance latestSeq beyond previous afterSeq cursor'
    );

    const incrementalCompensation = await fetchTimeline(fixture, sessionId, { afterSeq: lastSeenEventSeq });
    assert.ok(incrementalCompensation.length > 0, 'incremental compensation should return new rows');
    assert.equal(
      incrementalCompensation.every((row) => Number(row?.seq) > lastSeenEventSeq),
      true,
      'incremental compensation should only include rows after last seen seq'
    );
    assert.ok(
      Number(incrementalCompensation[0]?.seq) <= (lastSeenEventSeq + 1),
      'incremental compensation first seq should not jump above lastSeenEventSeq + 1'
    );
    lastSeenEventSeq = Math.max(lastSeenEventSeq, ...incrementalCompensation.map((row) => Number(row?.seq) || 0));

    const harness = createReconnectCompensationHarness({
      activeSessionId: sessionId,
      lastSeenEventSeq,
      timelineRows: await fetchTimeline(fixture, sessionId)
    });
    harness.context.fetch = async (url) => {
      harness.fetchCalls.push(url);
      return {
        ok: true,
        async json() {
          return {
            timeline: [{ seq: lastSeenEventSeq + 3, sessionId }]
          };
        }
      };
    };

    await harness.runReconnectCompensation({
      targetSessionId: sessionId,
      activeSyncNonce: harness.context.activeSessionSyncNonce,
      afterSeqCursor: lastSeenEventSeq
    });

    assert.equal(harness.fetchCalls.length, 1, 'client compensation path should attempt incremental fetch first');
    assert.ok(
      harness.fetchCalls[0].includes(`/api/sessions/${encodeURIComponent(sessionId)}/timeline?afterSeq=`),
      'incremental compensation should use active session timeline endpoint with afterSeq cursor'
    );
    assert.equal(harness.fullRefreshCalls.length, 1, 'seq-gap inconsistency should trigger full refresh fallback in real client path');
    assert.equal(
      harness.fullRefreshCalls[0]?.mode,
      harness.context.TIMELINE_REFRESH_STATES.full,
      'fallback should request full timeline mode'
    );
  } finally {
    if (ws) {
      await closeWebSocket(ws);
    }
    if (reconnectWs) {
      await closeWebSocket(reconnectWs);
    }
    await fixture.cleanup();
  }
});
