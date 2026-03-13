#!/usr/bin/env node
/**
 * 回调服务器 - 模拟"聊天室"接收 AI 的主动消息
 *
 * 核心概念：
 * - AI 的 CLI 输出是"内心独白"，默认不可见
 * - AI 通过 MCP 工具调用 HTTP callback，主动把消息发到这里
 * - 这样 AI 就有了"选择说什么"的自主权
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 生成凭证
const invocationId = crypto.randomUUID();
const callbackToken = crypto.randomUUID();

// 将凭证写入文件，供 MCP Server 读取
const credentialsPath = path.join(__dirname, '.cat-cafe-credentials.json');
fs.writeFileSync(credentialsPath, JSON.stringify({
  apiUrl: `http://localhost:3200`,
  invocationId,
  callbackToken
}, null, 2));
console.log(`\n💾 凭证已保存到: ${credentialsPath}`);

// 模拟的对话历史
const mockThreadContext = {
  messages: [
    { role: "user", content: "欢迎来到猫咖啡馆！请随意聊天。" },
    { role: "assistant", content: "喵~ 这里真舒服！" },
    { role: "user", content: "请写一首关于猫的诗" }
  ]
};

// 存储收到的消息（模拟聊天室）
const chatMessages = [];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:3200`);

  // 设置 CORS 头，方便测试
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // POST /api/callbacks/post-message - 接收 AI 发来的消息
  if (req.method === 'POST' && url.pathname === '/api/callbacks/post-message') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { invocationId: invId, callbackToken: token, content } = data;

        // 验证凭证
        if (invId !== invocationId || token !== callbackToken) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          console.log('\n❌ 收到未授权的 post-message 请求');
          return;
        }

        // 模拟"消息出现在聊天室"
        const timestamp = new Date().toISOString();
        chatMessages.push({ timestamp, content });

        console.log('\n' + '='.repeat(50));
        console.log('🐱 猫咖啡馆 - 新消息到达！');
        console.log('='.repeat(50));
        console.log(content);
        console.log('='.repeat(50) + '\n');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // GET /api/callbacks/thread-context - 返回对话上下文
  if (req.method === 'GET' && url.pathname === '/api/callbacks/thread-context') {
    const invId = url.searchParams.get('invocationId');
    const token = url.searchParams.get('callbackToken');

    // 验证凭证
    if (invId !== invocationId || token !== callbackToken) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      console.log('\n❌ 收到未授权的 thread-context 请求');
      return;
    }

    console.log('\n📖 AI 正在获取对话上下文...\n');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockThreadContext));
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

const PORT = 3200;
server.listen(PORT, () => {
  console.log('\n' + '🐱'.repeat(25));
  console.log('  猫咖啡馆回调服务器已启动！');
  console.log('🐱'.repeat(25));
  console.log('\n📋 请将以下环境变量设置给 MCP Server：\n');
  console.log(`  export CAT_CAFE_API_URL="http://localhost:${PORT}"`);
  console.log(`  export CAT_CAFE_INVOCATION_ID="${invocationId}"`);
  console.log(`  export CAT_CAFE_CALLBACK_TOKEN="${callbackToken}"`);
  console.log('\n💡 提示：这些凭证用于验证 AI 的身份');
  console.log('   - invocationId: 标识这次会话');
  console.log('   - callbackToken: 类似密码，确保只有授权的 AI 能发消息\n');
  console.log('⏳ 等待 AI 的消息...\n');
});
