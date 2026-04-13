const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const TestRenderer = require('react-test-renderer');
const { createChatServerFixture } = require('./helpers/chat-server-fixture');
const { act } = TestRenderer;

const rootDir = path.resolve(__dirname, '../..');
const moduleCache = new Map();

function resolveExistingFile(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  throw new Error(`Cannot resolve module path: ${basePath}`);
}

function loadTsModule(relativePath) {
  const absolutePath = path.resolve(rootDir, relativePath);
  const resolvedPath = resolveExistingFile(absolutePath);

  if (moduleCache.has(resolvedPath)) {
    return moduleCache.get(resolvedPath);
  }

  const source = fs.readFileSync(resolvedPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true
    },
    fileName: resolvedPath
  });

  const mod = { exports: {} };
  moduleCache.set(resolvedPath, mod.exports);

  const localRequire = (specifier) => {
    if (specifier.endsWith('.css')) {
      return {};
    }

    if (specifier.startsWith('.')) {
      const childBasePath = path.resolve(path.dirname(resolvedPath), specifier);
      const childRelativePath = path.relative(rootDir, childBasePath);
      return loadTsModule(childRelativePath);
    }

    return require(specifier);
  };

  const fn = new Function('require', 'module', 'exports', '__filename', '__dirname', transpiled.outputText);
  fn(localRequire, mod, mod.exports, resolvedPath, path.dirname(resolvedPath));
  moduleCache.set(resolvedPath, mod.exports);
  return mod.exports;
}

function extractFirstJsAssetPath(html) {
  const match = html.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/i);
  assert.ok(match, 'chat shell should reference a bundled /assets/*.js entry script');
  return match[1];
}

function createSampleHistoryState() {
  return {
    messages: [
      {
        id: 'user-1',
        role: 'user',
        sender: '用户',
        text: '你好，**世界**',
        timestamp: 1
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        sender: 'Alice',
        text: '已收到 `pwd`',
        timestamp: 2
      }
    ],
    session: {
      id: 'session-1',
      name: '默认会话'
    },
    activeSessionId: 'session-1',
    chatSessions: [
      { id: 'session-1', name: '默认会话' },
      { id: 'session-2', name: '第二个会话' }
    ],
    enabledAgents: ['Alice'],
    currentAgent: 'Alice',
    agentWorkdirs: {},
    agents: []
  };
}

function createSampleTimelineRows() {
  return [
    {
      id: 'timeline-1',
      seq: 4,
      kind: 'thinking',
      status: 'started',
      eventType: 'message_thinking_started',
      actorType: 'agent',
      actorName: 'Alice',
      createdAt: '2026-04-12T00:00:00.000Z',
      groupId: 'group-1'
    },
    {
      id: 'timeline-2',
      seq: 5,
      kind: 'dispatch',
      status: 'created',
      eventType: 'dispatch_task_created',
      actorType: 'agent',
      actorName: 'Alice',
      callerAgentName: 'Alice',
      calleeAgentName: 'Bob',
      createdAt: '2026-04-12T00:00:01.000Z',
      groupId: 'group-1'
    }
  ];
}

function createSampleCallGraphProjection() {
  return {
    nodes: [
      {
        id: 'node-message-1',
        kind: 'message',
        messageId: 'message-1',
        sender: '用户',
        role: 'user',
        label: '你好',
        timestamp: 1,
        seq: 1,
        eventId: 'event-1'
      },
      {
        id: 'node-task-1',
        kind: 'task',
        taskId: 'task-1',
        label: 'task-1',
        metadata: {
          eventId: 'event-2',
          seq: 2
        }
      }
    ],
    edges: [
      {
        id: 'edge-1',
        type: 'invoke',
        source: 'node-message-1',
        target: 'node-task-1'
      }
    ]
  };
}

test('chat 服务在主入口 URL 返回首页 shell，并可访问 /chat.html 与 /assets 静态资源', async () => {
  const fixture = await createChatServerFixture();

  try {
    const homeResponse = await fetch(`http://127.0.0.1:${fixture.port}/`);
    const homeHtml = await homeResponse.text();

    assert.equal(homeResponse.status, 200);
    assert.match(homeResponse.headers.get('content-type') || '', /text\/html/i);
    assert.match(homeHtml, /<meta name="agent-co-page" content="home"\s*\/>/);

    const chatResponse = await fetch(`http://127.0.0.1:${fixture.port}/chat.html`);
    const chatHtml = await chatResponse.text();

    assert.equal(chatResponse.status, 200);
    assert.match(chatResponse.headers.get('content-type') || '', /text\/html/i);
    assert.match(chatHtml, /<meta name="agent-co-page" content="chat"\s*\/>/);

    const assetPath = extractFirstJsAssetPath(homeHtml);
    const assetResponse = await fetch(`http://127.0.0.1:${fixture.port}${assetPath}`);
    const assetBody = await assetResponse.text();

    assert.equal(assetResponse.status, 200);
    assert.match(assetResponse.headers.get('content-type') || '', /javascript/i);
    assert.ok(assetBody.length > 0, 'chat asset body should not be empty');

    const missingAssetResponse = await fetch(`http://127.0.0.1:${fixture.port}/assets/does-not-exist.js`);
    assert.equal(missingAssetResponse.status, 404);
  } finally {
    await fixture.cleanup();
  }
});

test('HomePage 渲染首页入口结构与主行动按钮', () => {
  const { HomePage } = loadTsModule('frontend/src/home/pages/HomePage.tsx');

  const html = renderToStaticMarkup(React.createElement(HomePage));

  assert.match(html, /data-home-page="shell"/);
  assert.match(html, /data-home-hero="intro"/);
  assert.match(html, /data-home-cta="primary"/);
  assert.match(html, /data-home-workflow="preview"/);
  assert.match(html, /开发者/);
  assert.match(html, /小团队/);
});

test('ChatPage 渲染聊天页壳、会话侧边栏、消息列表与输入区', () => {
  const { ChatPage } = loadTsModule('frontend/src/chat/pages/ChatPage.tsx');

  const html = renderToStaticMarkup(React.createElement(ChatPage, {
    initialState: createSampleHistoryState()
  }));

  assert.match(html, /data-chat-page="shell"/);
  assert.match(html, /data-chat-sidebar="sessions"/);
  assert.match(html, /data-chat-message-list="messages"/);
  assert.match(html, /data-chat-composer="composer"/);
  assert.match(html, /默认会话/);
  assert.match(html, /你好/);
  assert.match(html, /已收到/);
});

test('ChatPage 渲染 runtime 状态、timeline 与 call-graph 二级面板', () => {
  const { ChatPage } = loadTsModule('frontend/src/chat/pages/ChatPage.tsx');

  const html = renderToStaticMarkup(React.createElement(ChatPage, {
    initialState: createSampleHistoryState()
  }));

  assert.match(html, /data-chat-runtime-status="badge"/);
  assert.match(html, /data-chat-timeline-panel="timeline"/);
  assert.match(html, /data-chat-call-graph-panel="call-graph"/);
});

test('RuntimeStatusBadge 使用会话 sync-status 端点并渲染同步信息', async () => {
  const { RuntimeStatusBadge } = loadTsModule('frontend/src/chat/features/runtime-status/RuntimeStatusBadge.tsx');

  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        latestEventSeq: 18,
        latestTimelineSeq: 16,
        timelineRowCount: 7,
        discussionState: 'paused'
      }),
      text: async () => '{}'
    };
  };

  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(RuntimeStatusBadge, {
      sessionId: 'session-1',
      fetch: fetchImpl
    }));
  });
  await act(async () => {
    await Promise.resolve();
  });

  const rendered = JSON.stringify(renderer.toJSON());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/sessions/session-1/sync-status');
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.match(rendered, /18/);
  assert.match(rendered, /16/);
  assert.match(rendered, /7/);
});

test('TimelinePanel 使用会话 timeline 端点并渲染事件行', async () => {
  const { TimelinePanel } = loadTsModule('frontend/src/chat/features/timeline-panel/TimelinePanel.tsx');

  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        timeline: createSampleTimelineRows()
      }),
      text: async () => '{}'
    };
  };

  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(TimelinePanel, {
      sessionId: 'session-1',
      fetch: fetchImpl
    }));
  });
  await act(async () => {
    await Promise.resolve();
  });

  const rendered = JSON.stringify(renderer.toJSON());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/sessions/session-1/timeline');
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.match(rendered, /Alice/);
  assert.match(rendered, /Bob/);
});

test('CallGraphPanel 使用会话 call-graph 端点并渲染节点与边关系', async () => {
  const { CallGraphPanel } = loadTsModule('frontend/src/chat/features/call-graph/CallGraphPanel.tsx');

  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        callGraph: createSampleCallGraphProjection()
      }),
      text: async () => '{}'
    };
  };

  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(CallGraphPanel, {
      sessionId: 'session-1',
      fetch: fetchImpl
    }));
  });
  await act(async () => {
    await Promise.resolve();
  });

  const rendered = JSON.stringify(renderer.toJSON());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/sessions/session-1/call-graph');
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.match(rendered, /message-1|你好/);
  assert.match(rendered, /task-1/);
  assert.match(rendered, /invoke/);
});

test('chat API 发送动作保持当前页面的后端请求契约', async () => {
  const { createChatApi } = loadTsModule('frontend/src/chat/services/chat-api.ts');
  const calls = [];

  const api = createChatApi({
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ accepted: true, session: { id: 'session-1' }, latestEventSeq: 1 }),
        text: async () => '{"accepted":true}'
      };
    }
  });

  const response = await api.sendMessage({ message: '新的提示词' });

  assert.equal(response.accepted, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/chat');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.equal(calls[0].init.body, JSON.stringify({ message: '新的提示词' }));
});

test('消息列表保留基础 Markdown 渲染能力', () => {
  const { ChatMessageList } = loadTsModule('frontend/src/chat/features/message-list/ChatMessageList.tsx');

  const html = renderToStaticMarkup(React.createElement(ChatMessageList, {
    messages: [
      {
        id: 'assistant-1',
        role: 'assistant',
        sender: 'Alice',
        text: '欢迎使用 **React** shell，并执行 `pwd`。',
        timestamp: 2
      }
    ]
  }));

  assert.match(html, /<strong>React<\/strong>/);
  assert.match(html, /<code>pwd<\/code>/);
});

test('chat markdown 渲染能力位于 chat 共享边界并在功能组件复用', () => {
  const markdownServicePath = path.resolve(rootDir, 'frontend/src/chat/services/chat-markdown.ts');
  const composerPath = path.resolve(rootDir, 'frontend/src/chat/features/composer/ChatComposer.tsx');
  const messageListPath = path.resolve(rootDir, 'frontend/src/chat/features/message-list/ChatMessageList.tsx');

  assert.equal(fs.existsSync(markdownServicePath), true, 'chat markdown renderer should live under chat/services');

  const composerSource = fs.readFileSync(composerPath, 'utf8');
  const messageListSource = fs.readFileSync(messageListPath, 'utf8');
  assert.match(composerSource, /from '\.\.\/\.\.\/services\/chat-markdown'/);
  assert.match(messageListSource, /from '\.\.\/\.\.\/services\/chat-markdown'/);
});

test('chat realtime URL 解析逻辑位于共享 service 边界并被 ChatPage 复用', () => {
  const realtimeUrlPath = path.resolve(rootDir, 'frontend/src/chat/services/chat-realtime-url.ts');
  const chatPagePath = path.resolve(rootDir, 'frontend/src/chat/pages/ChatPage.tsx');

  assert.equal(fs.existsSync(realtimeUrlPath), true, 'chat realtime url resolver should live under chat/services');

  const realtimeUrlSource = fs.readFileSync(realtimeUrlPath, 'utf8');
  const chatPageSource = fs.readFileSync(chatPagePath, 'utf8');

  assert.match(realtimeUrlSource, /export function resolveChatRealtimeUrl\(/);
  assert.match(chatPageSource, /from '\.\.\/services\/chat-realtime-url'/);
  assert.doesNotMatch(chatPageSource, /function resolveRealtimeUrl\(/);
});

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.closed = false;
    this.sentPayloads = [];
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    const entries = this.listeners.get(type);
    entries?.delete(listener);
  }

  send(data) {
    this.sentPayloads.push(data);
  }

  close() {
    this.closed = true;
    this.readyState = 3;
    this.emit('close', {
      code: 1000,
      reason: 'client disconnect',
      wasClean: true
    });
  }

  emit(type, event) {
    const entries = this.listeners.get(type);
    if (!entries) {
      return;
    }
    for (const listener of entries) {
      listener(event);
    }
  }

  open() {
    this.readyState = 1;
    this.emit('open', {});
  }
}

class BrowserLikeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.closed = false;
    this.sentPayloads = [];
    this.listeners = new Map();
    BrowserLikeWebSocket.instances.push(this);
  }

  static reset() {
    BrowserLikeWebSocket.instances = [];
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data) {
    this.sentPayloads.push(data);
  }

  close(code = 1000, reason = 'client disconnect') {
    this.closed = true;
    this.readyState = 3;
    this.emit('close', { code, reason, wasClean: true });
  }

  emit(type, event) {
    const entries = this.listeners.get(type);
    if (!entries) {
      return;
    }
    for (const listener of entries) {
      listener(event);
    }
  }

  open() {
    this.readyState = 1;
    this.emit('open', {});
  }
}

function countPanelEndpointCalls(calls) {
  return calls.reduce((result, call) => {
    if (typeof call.url !== 'string') {
      return result;
    }

    if (call.url.includes('/sync-status')) {
      result.syncStatus += 1;
    }
    if (call.url.includes('/timeline')) {
      result.timeline += 1;
    }
    if (call.url.includes('/call-graph')) {
      result.callGraph += 1;
    }
    return result;
  }, { syncStatus: 0, timeline: 0, callGraph: 0 });
}

function createDeferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

test('realtime 适配器可驱动消息追加并反映到可见渲染列表', () => {
  const { createChatRealtimeConnection } = loadTsModule('frontend/src/chat/services/chat-realtime.ts');
  const { ChatMessageList } = loadTsModule('frontend/src/chat/features/message-list/ChatMessageList.tsx');

  let currentMessages = [
    {
      id: 'user-1',
      role: 'user',
      sender: '用户',
      text: '先前消息',
      timestamp: 1
    }
  ];

  let latestHtml = renderToStaticMarkup(React.createElement(ChatMessageList, {
    messages: currentMessages
  }));

  assert.match(latestHtml, /先前消息/);

  let createdSocket = null;
  const connection = createChatRealtimeConnection({
    sessionId: 'session-1',
    url: 'ws://127.0.0.1:19999/api/ws/session-events',
    getMessages: () => currentMessages,
    onMessage: (nextMessages) => {
      currentMessages = nextMessages;
      latestHtml = renderToStaticMarkup(React.createElement(ChatMessageList, {
        messages: currentMessages
      }));
    },
    webSocketFactory: (url) => {
      createdSocket = new FakeSocket(url);
      return createdSocket;
    }
  });

  connection.connect();
  assert.ok(createdSocket, 'socket should be created by realtime connection');

  createdSocket.open();
  assert.equal(createdSocket.sentPayloads.length, 1, 'realtime connect should send subscribe payload');
  assert.deepEqual(JSON.parse(createdSocket.sentPayloads[0]), {
    type: 'subscribe',
    sessionId: 'session-1',
    afterSeq: 0
  });

  createdSocket.emit('message', {
    data: JSON.stringify({
      type: 'session_event',
      sessionId: 'session-1',
      event: {
        seq: 2,
        eventId: 'event-2',
        eventType: 'agent_message_created',
        payload: {
          message: {
            id: 'assistant-2',
            role: 'assistant',
            sender: 'Alice',
            text: '来自事件流的回复',
            timestamp: 2
          }
        }
      }
    })
  });
  assert.match(latestHtml, /来自事件流的回复/);

  createdSocket.emit('message', {
    data: JSON.stringify({
      type: 'message',
      message: {
        id: 'system-3',
        role: 'system',
        sender: '系统',
        text: '直接消息补丁',
        timestamp: 3
      }
    })
  });
  assert.match(latestHtml, /直接消息补丁/);

  connection.disconnect();
  assert.equal(createdSocket.closed, true);
  assert.equal(currentMessages.length, 3);
  assert.deepEqual(currentMessages.map((message) => message.id), [
    'user-1',
    'assistant-2',
    'system-3'
  ]);
});

test('ChatPage 与 realtime 适配器组合后，新增消息会出现在渲染结果中', () => {
  const { appendIncomingChatRealtimeData } = loadTsModule('frontend/src/chat/services/chat-realtime.ts');
  const { ChatPage } = loadTsModule('frontend/src/chat/pages/ChatPage.tsx');
  const initialState = createSampleHistoryState();

  const nextMessages = appendIncomingChatRealtimeData(initialState.messages, {
    type: 'message',
    message: {
      id: 'assistant-next-1',
      role: 'assistant',
      sender: 'Alice',
      text: 'realtime 补充消息',
      timestamp: 3
    }
  });

  const html = renderToStaticMarkup(React.createElement(ChatPage, {
    initialState: {
      ...initialState,
      messages: nextMessages
    }
  }));

  assert.match(html, /realtime 补充消息/);
});

test('ChatPage realtime 生命周期稳定并推进 afterSeq 游标', async () => {
  const { ChatPage } = loadTsModule('frontend/src/chat/pages/ChatPage.tsx');
  const { appendIncomingChatRealtimeData } = loadTsModule('frontend/src/chat/services/chat-realtime.ts');

  const originalWindow = global.window;
  global.window = {
    location: {
      protocol: 'http:',
      host: '127.0.0.1:3000'
    }
  };

  const realtimeOptionsList = [];
  const connectionState = { connectCalls: 0, disconnectCalls: 0 };
  const api = {
    async loadHistory() {
      return createSampleHistoryState();
    },
    async sendMessage() {
      return { accepted: true };
    }
  };

  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(ChatPage, {
        initialState: {
          ...createSampleHistoryState(),
          latestEventSeq: 0
        },
        api,
        createRealtimeConnection: (options) => {
          realtimeOptionsList.push(options);
          return {
            connect() {
              connectionState.connectCalls += 1;
            },
            disconnect() {
              connectionState.disconnectCalls += 1;
            }
          };
        }
      }));
    });

    assert.equal(realtimeOptionsList.length, 1, 'should create one realtime connection for active session');
    assert.equal(connectionState.connectCalls, 1);

    const realtimeOptions = realtimeOptionsList[0];
    assert.equal(realtimeOptions.getAfterSeq(), 0);

    await act(async () => {
      realtimeOptions.onEnvelope({
        type: 'subscribed',
        sessionId: 'session-1',
        latestSeq: 8
      });
    });
    assert.equal(realtimeOptions.getAfterSeq(), 8);

    const nextMessages = appendIncomingChatRealtimeData(createSampleHistoryState().messages, {
      type: 'session_event',
      sessionId: 'session-1',
      event: {
        seq: 9,
        eventId: 'event-9',
        eventType: 'agent_message_created',
        payload: {
          message: {
            id: 'assistant-9',
            role: 'assistant',
            sender: 'Alice',
            text: 'realtime 生命周期消息',
            timestamp: 9
          }
        }
      }
    });

    await act(async () => {
      realtimeOptions.onEnvelope({
        type: 'session_event',
        sessionId: 'session-1',
        event: {
          seq: 9,
          eventId: 'event-9',
          eventType: 'agent_message_created'
        }
      });
      realtimeOptions.onMessage(nextMessages);
    });

    assert.equal(realtimeOptions.getAfterSeq(), 9);
    assert.equal(realtimeOptionsList.length, 1, 'message updates should not recreate realtime connection');
    assert.match(JSON.stringify(renderer.toJSON()), /realtime 生命周期消息/);
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    assert.equal(connectionState.disconnectCalls, 1);
    global.window = originalWindow;
  }
});

test('ChatPage 在浏览器 WebSocket 场景中仅创建单一订阅并避免初始重复 refetch', async () => {
  const { ChatPage } = loadTsModule('frontend/src/chat/pages/ChatPage.tsx');

  const originalWindow = global.window;
  const originalFetch = global.fetch;
  const originalWebSocket = global.WebSocket;
  BrowserLikeWebSocket.reset();

  const fetchCalls = [];
  const fetchImpl = async (url, init = {}) => {
    fetchCalls.push({ url: String(url), init });

    if (String(url).includes('/sync-status')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          latestEventSeq: 1,
          latestTimelineSeq: 1,
          timelineRowCount: 1,
          discussionState: 'active'
        }),
        text: async () => '{}'
      };
    }

    if (String(url).includes('/timeline')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ timeline: createSampleTimelineRows() }),
        text: async () => '{}'
      };
    }

    if (String(url).includes('/call-graph')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ callGraph: createSampleCallGraphProjection() }),
        text: async () => '{}'
      };
    }

    return {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'not found' }),
      text: async () => '{"error":"not found"}'
    };
  };

  global.window = {
    location: {
      protocol: 'http:',
      host: '127.0.0.1:3000'
    },
    WebSocket: BrowserLikeWebSocket
  };
  global.WebSocket = BrowserLikeWebSocket;
  global.fetch = fetchImpl;

  const api = {
    async loadHistory() {
      return createSampleHistoryState();
    },
    async sendMessage() {
      return { accepted: true };
    }
  };

  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(ChatPage, {
        initialState: createSampleHistoryState(),
        api
      }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    assert.equal(BrowserLikeWebSocket.instances.length, 1, 'chat page should only create one realtime websocket subscription');

    const initialCounts = countPanelEndpointCalls(fetchCalls);
    assert.deepEqual(initialCounts, {
      syncStatus: 1,
      timeline: 1,
      callGraph: 1
    });

    const socket = BrowserLikeWebSocket.instances[0];
    await act(async () => {
      socket.open();
      socket.emit('message', {
        data: JSON.stringify({
          type: 'subscribed',
          sessionId: 'session-1',
          latestSeq: 9
        })
      });
      await Promise.resolve();
    });

    const subscribedCounts = countPanelEndpointCalls(fetchCalls);
    assert.deepEqual(subscribedCounts, initialCounts, 'initial subscribe ack should not trigger duplicate panel refetch');
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    global.window = originalWindow;
    global.fetch = originalFetch;
    global.WebSocket = originalWebSocket;
    BrowserLikeWebSocket.reset();
  }
});

test('ChatPage 二级面板在事件突发时避免重叠请求并合并为有限重拉取', async () => {
  const { ChatPage } = loadTsModule('frontend/src/chat/pages/ChatPage.tsx');

  const originalWindow = global.window;
  const originalFetch = global.fetch;
  const originalWebSocket = global.WebSocket;
  BrowserLikeWebSocket.reset();

  const stats = {
    syncStatus: { count: 0, inFlight: 0, maxInFlight: 0, deferred: [] },
    timeline: { count: 0, inFlight: 0, maxInFlight: 0, deferred: [] },
    callGraph: { count: 0, inFlight: 0, maxInFlight: 0, deferred: [] }
  };

  const createPayloadByType = (type) => {
    if (type === 'syncStatus') {
      return {
        latestEventSeq: 2,
        latestTimelineSeq: 2,
        timelineRowCount: 2,
        discussionState: 'active'
      };
    }
    if (type === 'timeline') {
      return { timeline: createSampleTimelineRows() };
    }
    return { callGraph: createSampleCallGraphProjection() };
  };

  const fetchImpl = (url) => {
    const normalized = String(url);
    let statKey = null;
    if (normalized.includes('/sync-status')) {
      statKey = 'syncStatus';
    } else if (normalized.includes('/timeline')) {
      statKey = 'timeline';
    } else if (normalized.includes('/call-graph')) {
      statKey = 'callGraph';
    }

    if (!statKey) {
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'not found' }),
        text: async () => '{"error":"not found"}'
      });
    }

    const stat = stats[statKey];
    stat.count += 1;
    stat.inFlight += 1;
    stat.maxInFlight = Math.max(stat.maxInFlight, stat.inFlight);
    const deferred = createDeferred();
    stat.deferred.push(deferred);

    return deferred.promise.then(() => {
      stat.inFlight -= 1;
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => createPayloadByType(statKey),
        text: async () => '{}'
      };
    });
  };

  global.window = {
    location: {
      protocol: 'http:',
      host: '127.0.0.1:3000'
    },
    WebSocket: BrowserLikeWebSocket
  };
  global.WebSocket = BrowserLikeWebSocket;
  global.fetch = fetchImpl;

  const api = {
    async loadHistory() {
      return createSampleHistoryState();
    },
    async sendMessage() {
      return { accepted: true };
    }
  };

  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(ChatPage, {
        initialState: createSampleHistoryState(),
        api
      }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    assert.equal(BrowserLikeWebSocket.instances.length, 1);
    const socket = BrowserLikeWebSocket.instances[0];
    socket.open();

    for (let index = 0; index < 6; index += 1) {
      socket.emit('message', {
        data: JSON.stringify({
          type: 'session_event',
          sessionId: 'session-1',
          event: { seq: 10 + index, eventId: `event-${index}`, eventType: 'dispatch_task_created' }
        })
      });
    }

    assert.equal(stats.syncStatus.maxInFlight <= 1, true);
    assert.equal(stats.timeline.maxInFlight <= 1, true);
    assert.equal(stats.callGraph.maxInFlight <= 1, true);

    const resolveAll = async () => {
      for (const stat of Object.values(stats)) {
        const pending = [...stat.deferred];
        stat.deferred.length = 0;
        for (const deferred of pending) {
          deferred.resolve();
        }
      }
      await Promise.resolve();
    };

    await act(async () => {
      await resolveAll();
    });
    await act(async () => {
      await Promise.resolve();
    });

    assert.equal(stats.syncStatus.count <= 2, true, 'sync-status refetches should be deduped under burst');
    assert.equal(stats.timeline.count <= 2, true, 'timeline refetches should be deduped under burst');
    assert.equal(stats.callGraph.count <= 2, true, 'call-graph refetches should be deduped under burst');
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    global.window = originalWindow;
    global.fetch = originalFetch;
    global.WebSocket = originalWebSocket;
    BrowserLikeWebSocket.reset();
  }
});

test('ChatPage 在存在 initialState 时仍可通过刷新动作重新拉取 history', async () => {
  const { ChatPage } = loadTsModule('frontend/src/chat/pages/ChatPage.tsx');
  const { HttpClientError } = loadTsModule('frontend/src/shared/lib/http/http-client.ts');

  const originalWindow = global.window;
  global.window = {
    location: {
      protocol: 'http:',
      host: '127.0.0.1:3000'
    }
  };

  const refreshedState = {
    ...createSampleHistoryState(),
    messages: [
      ...createSampleHistoryState().messages,
      {
        id: 'assistant-refresh-1',
        role: 'assistant',
        sender: 'Alice',
        text: '刷新后的会话内容',
        timestamp: 10
      }
    ]
  };

  let loadHistoryCalls = 0;
  const api = {
    async loadHistory() {
      loadHistoryCalls += 1;
      return refreshedState;
    },
    async sendMessage() {
      throw new HttpClientError({
        message: 'should not send in refresh test',
        status: 500,
        statusText: 'Internal Server Error',
        body: null,
        url: '/api/chat',
        method: 'POST'
      });
    }
  };

  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(ChatPage, {
        initialState: createSampleHistoryState(),
        api,
        createRealtimeConnection: () => ({
          connect() {},
          disconnect() {}
        })
      }));
    });

    assert.equal(loadHistoryCalls, 0, 'initial render should use bootstrap state');
    assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /刷新后的会话内容/);

    const refreshButton = renderer.root.find((node) => {
      return node.type === 'button' && Array.isArray(node.children) && node.children.includes('刷新');
    });

    await act(async () => {
      refreshButton.props.onClick();
    });

    assert.equal(loadHistoryCalls, 1, 'refresh click should trigger history reload even with initialState');
    assert.match(JSON.stringify(renderer.toJSON()), /刷新后的会话内容/);
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    global.window = originalWindow;
  }
});
