const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { createChatServerFixture } = require('./helpers/chat-server-fixture');

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

test('chat 服务在主入口 URL 返回 Vite 构建 shell，并可访问 /assets 静态资源', async () => {
  const fixture = await createChatServerFixture();

  try {
    const homeResponse = await fetch(`http://127.0.0.1:${fixture.port}/`);
    const homeHtml = await homeResponse.text();

    assert.equal(homeResponse.status, 200);
    assert.match(homeResponse.headers.get('content-type') || '', /text\/html/i);
    assert.match(homeHtml, /<meta name="agent-co-page" content="chat"\s*\/>/);

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
