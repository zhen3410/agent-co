#!/usr/bin/env node
/**
 * 猫咖啡馆 MCP Server - AI 用来"主动说话"的工具
 *
 * 这个 MCP Server 提供两个工具：
 * 1. cat_cafe_post_message - 主动发送消息到聊天室
 * 2. cat_cafe_get_context - 获取对话上下文
 *
 * 关键点：AI 可以"选择"何时调用这些工具，而不是被迫输出所有内容
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const http = require('http');
const { z } = require('zod');
const fs = require('fs');
const path = require('path');

// 优先从凭证文件读取，否则从环境变量读取
function loadCredentials() {
  const credentialsPath = path.join(__dirname, '.cat-cafe-credentials.json');
  try {
    if (fs.existsSync(credentialsPath)) {
      const creds = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      return {
        apiUrl: creds.apiUrl,
        invocationId: creds.invocationId,
        callbackToken: creds.callbackToken
      };
    }
  } catch (e) {
    // 文件读取失败，回退到环境变量
  }

  return {
    apiUrl: process.env.CAT_CAFE_API_URL,
    invocationId: process.env.CAT_CAFE_INVOCATION_ID,
    callbackToken: process.env.CAT_CAFE_CALLBACK_TOKEN
  };
}

const creds = loadCredentials();
const API_URL = creds.apiUrl;
const INVOCATION_ID = creds.invocationId;
const CALLBACK_TOKEN = creds.callbackToken;

// 辅助函数：发送 HTTP 请求
function httpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// 创建 MCP Server
const server = new McpServer({
  name: 'cat-cafe',
  version: '1.0.0',
});

// 工具1：发送消息到聊天室
server.tool(
  'cat_cafe_post_message',
  '把消息发送到猫咖啡馆聊天室。用于当你想主动分享内容时。你的思考过程不需要发送，只发送你希望用户看到的内容。',
  {
    content: z.string().describe('要发送到聊天室的消息内容'),
  },
  async ({ content }) => {
    if (!API_URL || !INVOCATION_ID || !CALLBACK_TOKEN) {
      return {
        content: [{ type: 'text', text: '❌ 错误：缺少环境变量配置（CAT_CAFE_API_URL, CAT_CAFE_INVOCATION_ID, CAT_CAFE_CALLBACK_TOKEN）' }],
      };
    }

    try {
      const url = new URL('/api/callbacks/post-message', API_URL);
      const result = await httpRequest({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, {
        invocationId: INVOCATION_ID,
        callbackToken: CALLBACK_TOKEN,
        content,
      });

      if (result.status === 200) {
        return {
          content: [{ type: 'text', text: '✅ 消息已成功发送到猫咖啡馆聊天室！' }],
        };
      } else {
        return {
          content: [{ type: 'text', text: `❌ 发送失败：${JSON.stringify(result.body)}` }],
        };
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: `❌ 网络错误：${error.message}` }],
      };
    }
  }
);

// 工具2：获取对话上下文
server.tool(
  'cat_cafe_get_context',
  '获取猫咖啡馆的对话历史，了解之前的聊天内容。',
  {},
  async () => {
    if (!API_URL || !INVOCATION_ID || !CALLBACK_TOKEN) {
      return {
        content: [{ type: 'text', text: '❌ 错误：缺少环境变量配置' }],
      };
    }

    try {
      const url = new URL('/api/callbacks/thread-context', API_URL);
      url.searchParams.set('invocationId', INVOCATION_ID);
      url.searchParams.set('callbackToken', CALLBACK_TOKEN);

      const result = await httpRequest({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'GET',
      });

      if (result.status === 200) {
        const context = result.body;
        const formatted = context.messages
          .map(m => `[${m.role}]: ${m.content}`)
          .join('\n');
        return {
          content: [{ type: 'text', text: `📖 对话上下文：\n${formatted}` }],
        };
      } else {
        return {
          content: [{ type: 'text', text: `❌ 获取失败：${JSON.stringify(result.body)}` }],
        };
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: `❌ 网络错误：${error.message}` }],
      };
    }
  }
);

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
