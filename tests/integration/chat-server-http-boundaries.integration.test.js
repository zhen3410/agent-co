const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Readable } = require('node:stream');

const repoRoot = path.resolve(__dirname, '..', '..');

function requireBuiltModule(...segments) {
  const modulePath = path.join(repoRoot, 'dist', ...segments);
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function createJsonRequest({ method = 'POST', url = '/', headers = {}, body } = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const req = Readable.from(payload ? [payload] : []);
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    getHeader(name) {
      return this.headers[name];
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = { ...this.headers, ...headers };
    },
    end(chunk = '') {
      this.body = String(chunk);
    }
  };
}

function parseJsonResponse(res) {
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    body: res.body ? JSON.parse(res.body) : null
  };
}

test('HTTP route modules 保持稳定的 handler export surface', () => {
  assert.deepEqual(
    Object.keys(requireBuiltModule('chat', 'http', 'chat-routes.js')).sort(),
    ['handleChatRoutes']
  );
  assert.deepEqual(
    Object.keys(requireBuiltModule('chat', 'http', 'callback-routes.js')).sort(),
    ['handleCallbackRoutes']
  );
  assert.deepEqual(
    Object.keys(requireBuiltModule('chat', 'http', 'auth-routes.js')).sort(),
    ['handleAuthRoutes']
  );
});

test('chat-route-helpers 暴露精简 helper 且保持现有 normalize 语义', () => {
  const helpers = requireBuiltModule('chat', 'http', 'chat-route-helpers.js');

  assert.deepEqual(Object.keys(helpers).sort(), [
    'buildChatRateLimitBody',
    'normalizeBodyText',
    'normalizeSessionId',
    'normalizeWorkdirSelection'
  ]);

  assert.deepEqual(helpers.buildChatRateLimitBody(101000, 100000), {
    error: '请求过于频繁，请稍后再试',
    retryAfter: 1
  });
  assert.equal(helpers.normalizeBodyText('  Alice  '), '  Alice  ');
  assert.equal(helpers.normalizeBodyText(42), '');
  assert.equal(helpers.normalizeSessionId('  session-1  '), 'session-1');
  assert.equal(helpers.normalizeSessionId({ trim() { return 'oops'; } }), '');
  assert.deepEqual(helpers.normalizeWorkdirSelection({ agentName: '  Alice  ', workdir: '   ' }), {
    agentName: '  Alice  ',
    workdir: null
  });
});

test('callback-route-helpers 暴露 token / header / body parsing helpers', () => {
  const helpers = requireBuiltModule('chat', 'http', 'callback-route-helpers.js');

  assert.deepEqual(Object.keys(helpers).sort(), [
    'getCallbackToken',
    'isCallbackAuthorized',
    'normalizeCallbackAgentName',
    'normalizeCallbackPostMessageBody',
    'normalizeCallbackSessionId'
  ]);

  const headers = {
    authorization: ['  Bearer callback-token  '],
    'x-agent-co-callback-token': ['fallback-token']
  };

  assert.equal(helpers.getCallbackToken(headers, 'x-agent-co-callback-token'), 'callback-token');
  assert.equal(helpers.isCallbackAuthorized(headers, 'x-agent-co-callback-token', 'callback-token'), true);
  assert.equal(helpers.normalizeCallbackSessionId('  session-1  '), 'session-1');
  assert.equal(helpers.normalizeCallbackAgentName('Alice%20Bob'), 'Alice Bob');
  assert.deepEqual(helpers.normalizeCallbackPostMessageBody({
    content: '  我完成开发了，请 @Reviewer 做 Code Review。  ',
    invokeAgents: [' Alice ', '', 3, 'Bob']
  }), {
    content: '我完成开发了，请 @Reviewer 做 Code Review。',
    invokeAgents: [' Alice ', 'Bob']
  });
});

test('auth-route-helpers 保持 cookie 追加与登录 body normalize 契约', () => {
  const helpers = requireBuiltModule('chat', 'http', 'auth-route-helpers.js');

  assert.deepEqual(Object.keys(helpers).sort(), [
    'applySetCookies',
    'normalizeAuthLoginBody'
  ]);

  const res = createMockResponse();
  res.setHeader('Set-Cookie', ['existing=1']);
  helpers.applySetCookies(res, ['new=2', 'next=3']);
  assert.deepEqual(res.getHeader('Set-Cookie'), ['existing=1', 'new=2', 'next=3']);
  assert.deepEqual(helpers.normalizeAuthLoginBody({ username: '  Alice  ', password: 'secret' }), {
    username: '  Alice  ',
    password: 'secret'
  });
  assert.deepEqual(helpers.normalizeAuthLoginBody({ username: 1, password: null }), {
    username: '',
    password: ''
  });
});

test('auth-routes 继续保持登录响应与 Set-Cookie 追加契约', async () => {
  const { handleAuthRoutes } = requireBuiltModule('chat', 'http', 'auth-routes.js');
  const req = createJsonRequest({
    url: '/api/login',
    body: { username: '  Alice  ', password: 'secret' }
  });
  req.headers.cookie = 'existing=1';
  const res = createMockResponse();
  res.setHeader('Set-Cookie', ['existing-cookie=1']);

  let captured;
  const handled = await handleAuthRoutes(req, res, {
    authService: {
      async login(context, username, password) {
        captured = { context, username, password };
        return { setCookies: ['session=abc'], authEnabled: true };
      }
    }
  });

  assert.equal(handled, true);
  assert.equal(captured.username, '  Alice  ');
  assert.equal(captured.password, 'secret');
  assert.deepEqual(captured.context.cookies, { existing: '1' });
  assert.deepEqual(parseJsonResponse(res), {
    statusCode: 200,
    headers: {
      'Set-Cookie': ['existing-cookie=1', 'session=abc'],
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: { success: true, authEnabled: true }
  });
});

test('callback-routes 保持 bearer 优先级、agent decode 与缺少 session 头错误契约', async () => {
  const { handleCallbackRoutes } = requireBuiltModule('chat', 'http', 'callback-routes.js');

  const successReq = createJsonRequest({
    url: '/api/callbacks/post-message',
    headers: {
      authorization: 'Bearer callback-token',
      'x-agent-co-callback-token': 'wrong-token',
      'x-agent-co-session-id': '  session-1  ',
      'x-agent-co-agent': 'Alice%20Bob'
    },
    body: {
      content: '  hello  ',
      invokeAgents: ['Alice', '', 1, 'Bob']
    }
  });
  const successRes = createMockResponse();
  let callbackCall;
  const successHandled = await handleCallbackRoutes(
    successReq,
    successRes,
    new URL('http://127.0.0.1/api/callbacks/post-message'),
    {
      callbackAuthToken: 'callback-token',
      callbackAuthHeader: 'x-agent-co-callback-token',
      chatService: {
        postCallbackMessage(sessionId, agentName, content, invokeAgents) {
          callbackCall = { sessionId, agentName, content, invokeAgents };
          return { success: true };
        }
      }
    }
  );

  assert.equal(successHandled, true);
  assert.deepEqual(callbackCall, {
    sessionId: 'session-1',
    agentName: 'Alice Bob',
    content: 'hello',
    invokeAgents: ['Alice', 'Bob']
  });
  assert.deepEqual(parseJsonResponse(successRes), {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: { success: true }
  });

  const failureReq = createJsonRequest({
    url: '/api/callbacks/post-message',
    headers: {
      authorization: 'Bearer callback-token',
      'x-agent-co-callback-token': 'callback-token',
      'x-agent-co-agent': 'Alice'
    },
    body: { content: 'hello' }
  });
  const failureRes = createMockResponse();
  const failureHandled = await handleCallbackRoutes(
    failureReq,
    failureRes,
    new URL('http://127.0.0.1/api/callbacks/post-message'),
    {
      callbackAuthToken: 'callback-token',
      callbackAuthHeader: 'x-agent-co-callback-token',
      chatService: {
        postCallbackMessage() {
          throw new Error('should not reach');
        }
      }
    }
  );

  assert.equal(failureHandled, true);
  assert.deepEqual(parseJsonResponse(failureRes), {
    statusCode: 400,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: { error: '缺少 x-agent-co-session-id 头' }
  });
});

test('chat-routes 保持 rate-limit、sessionId trim 与空 workdir 契约', async () => {
  const { handleChatRoutes } = requireBuiltModule('chat', 'http', 'chat-routes.js');

  const baseDeps = {
    userKey: 'user-1',
    rateLimitMaxRequests: 1,
    groupDataFile: path.join(repoRoot, 'data', 'groups.json'),
    runtime: {},
    agentManager: { getAgentConfigs() { return []; } },
    chatService: { listAgents() { return []; }, getBlockStatus() { return {}; }, createBlock() { return {}; } },
    sessionService: {
      getHistory() { return []; },
      clearHistory() { return { success: true }; },
      createChatSession() { return { success: true }; },
      renameChatSession() { return { success: true }; },
      deleteChatSession() { return { success: true }; },
      updateChatSession() { return { success: true }; },
      setSessionAgent() { return { success: true }; },
      resolveChatSession() { return { session: { id: 'session-1' } }; },
      setWorkdir() { return { success: true }; }
    }
  };

  const rateLimitedReq1 = createJsonRequest({
    url: '/api/chat',
    headers: { 'x-forwarded-for': 'task13-rate-limit-ip' },
    body: { message: 'hello' }
  });
  const rateLimitedRes1 = createMockResponse();
  await handleChatRoutes(rateLimitedReq1, rateLimitedRes1, new URL('http://127.0.0.1/api/chat'), {
    ...baseDeps,
    chatService: {
      ...baseDeps.chatService,
      async sendMessage() {
        return { success: true };
      }
    }
  });

  const rateLimitedReq2 = createJsonRequest({
    url: '/api/chat',
    headers: { 'x-forwarded-for': 'task13-rate-limit-ip' },
    body: { message: 'hello again' }
  });
  const rateLimitedRes2 = createMockResponse();
  const rateHandled = await handleChatRoutes(rateLimitedReq2, rateLimitedRes2, new URL('http://127.0.0.1/api/chat'), {
    ...baseDeps,
    chatService: {
      ...baseDeps.chatService,
      async sendMessage() {
        return { success: true };
      }
    }
  });

  assert.equal(rateHandled, true);
  assert.equal(rateLimitedRes2.statusCode, 429);
  assert.equal(parseJsonResponse(rateLimitedRes2).body.error, '请求过于频繁，请稍后再试');
  assert.equal(typeof parseJsonResponse(rateLimitedRes2).body.retryAfter, 'number');

  let selectedSessionId = null;
  const selectReq = createJsonRequest({
    url: '/api/sessions/select',
    body: { sessionId: '  session-42  ' }
  });
  const selectRes = createMockResponse();
  const selectHandled = await handleChatRoutes(selectReq, selectRes, new URL('http://127.0.0.1/api/sessions/select'), {
    ...baseDeps,
    sessionService: {
      ...baseDeps.sessionService,
      selectChatSession(_context, sessionId) {
        selectedSessionId = sessionId;
        return { success: true, sessionId };
      }
    }
  });

  assert.equal(selectHandled, true);
  assert.equal(selectedSessionId, 'session-42');
  assert.deepEqual(parseJsonResponse(selectRes).body, { success: true, sessionId: 'session-42' });

  let workdirCall = null;
  const workdirReq = createJsonRequest({
    url: '/api/workdirs/select',
    body: { agentName: '  Alice  ', workdir: '   ' }
  });
  const workdirRes = createMockResponse();
  const workdirHandled = await handleChatRoutes(workdirReq, workdirRes, new URL('http://127.0.0.1/api/workdirs/select'), {
    ...baseDeps,
    sessionService: {
      ...baseDeps.sessionService,
      setWorkdir(_context, agentName, workdir) {
        workdirCall = { agentName, workdir };
        return { success: true, agentName, workdir };
      }
    }
  });

  assert.equal(workdirHandled, true);
  assert.deepEqual(workdirCall, { agentName: '  Alice  ', workdir: null });
  assert.deepEqual(parseJsonResponse(workdirRes).body, { success: true, agentName: '  Alice  ', workdir: null });
});
