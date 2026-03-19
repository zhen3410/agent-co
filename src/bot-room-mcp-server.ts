import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_URL = process.env.BOT_ROOM_API_URL;
const CALLBACK_TOKEN = process.env.BOT_ROOM_CALLBACK_TOKEN || 'bot-room-callback-token';
const SESSION_ID = process.env.BOT_ROOM_SESSION_ID;
const AGENT_NAME = process.env.BOT_ROOM_AGENT_NAME || 'AI';

function encodeHeaderValue(value: string): string {
  return encodeURIComponent(value);
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${CALLBACK_TOKEN}`,
    'x-bot-room-callback-token': CALLBACK_TOKEN,
    'x-bot-room-session-id': SESSION_ID || '',
    'x-bot-room-agent': encodeHeaderValue(AGENT_NAME)
  };
}

function ensureConfig(): string | null {
  if (!API_URL) return '缺少 BOT_ROOM_API_URL 环境变量';
  if (!SESSION_ID) return '缺少 BOT_ROOM_SESSION_ID 环境变量';
  return null;
}

const server = new McpServer({
  name: 'bot-room-callbacks',
  version: '1.0.0'
});

server.tool(
  'bot_room_post_message',
  '将消息主动发送到聊天室。仅发送希望用户看到的最终输出。',
  {
    content: z.string().min(1).describe('要发送到聊天室的文本内容')
  },
  async ({ content }) => {
    const configError = ensureConfig();
    if (configError) {
      return { content: [{ type: 'text', text: `❌ ${configError}` }] };
    }

    try {
      const response = await fetch(new URL('/api/callbacks/post-message', API_URL), {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content })
      });

      const text = await response.text();
      if (!response.ok) {
        return { content: [{ type: 'text', text: `❌ 发送失败(${response.status}): ${text}` }] };
      }

      return { content: [{ type: 'text', text: '✅ 消息已发送到聊天室' }] };
    } catch (error: unknown) {
      const err = error as Error;
      return { content: [{ type: 'text', text: `❌ 网络错误: ${err.message}` }] };
    }
  }
);

server.tool(
  'bot_room_get_context',
  '获取当前 session 的会话历史。',
  {},
  async () => {
    const configError = ensureConfig();
    if (configError) {
      return { content: [{ type: 'text', text: `❌ ${configError}` }] };
    }

    try {
      const target = new URL('/api/callbacks/thread-context', API_URL);
      target.searchParams.set('sessionid', SESSION_ID!);
      const response = await fetch(target, {
        headers: authHeaders()
      });
      const text = await response.text();

      if (!response.ok) {
        return { content: [{ type: 'text', text: `❌ 获取失败(${response.status}): ${text}` }] };
      }

      return { content: [{ type: 'text', text }] };
    } catch (error: unknown) {
      const err = error as Error;
      return { content: [{ type: 'text', text: `❌ 网络错误: ${err.message}` }] };
    }
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

void main();
