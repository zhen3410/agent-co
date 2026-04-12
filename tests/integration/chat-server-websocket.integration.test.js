const test = require('node:test');
const assert = require('node:assert/strict');
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

test('websocket 重连后可通过 afterSeq 获得增量补偿，并返回推进后的 latestSeq', async () => {
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
    assert.ok(lastSeenEventSeq >= Number(reconnectSubscribed.latestSeq), 'incremental compensation should catch the client up to the latest acknowledged seq');
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
