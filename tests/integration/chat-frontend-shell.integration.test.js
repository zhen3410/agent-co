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

test('realtime 适配器可以把传入事件和消息追加到当前可见列表', () => {
  const { appendIncomingChatRealtimeData } = loadTsModule('frontend/src/chat/services/chat-realtime.ts');

  const initialMessages = [
    {
      id: 'user-1',
      role: 'user',
      sender: '用户',
      text: '先前消息',
      timestamp: 1
    }
  ];

  const fromEvent = appendIncomingChatRealtimeData(initialMessages, {
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
  });

  assert.equal(fromEvent.length, 2);
  assert.equal(fromEvent[1].text, '来自事件流的回复');

  const fromDirectMessage = appendIncomingChatRealtimeData(fromEvent, {
    type: 'message',
    message: {
      id: 'system-3',
      role: 'system',
      sender: '系统',
      text: '直接消息补丁',
      timestamp: 3
    }
  });

  assert.equal(fromDirectMessage.length, 3);
  assert.equal(fromDirectMessage[2].role, 'system');
  assert.equal(fromDirectMessage[2].text, '直接消息补丁');
});
