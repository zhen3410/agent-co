/**
 * server.ts
 *
 * 多 AI 智能体聊天室服务器
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { Message, AIAgentConfig, ChatRequest, RichBlock, SessionState } from './types';
import { AgentManager } from './agent-manager';
import { callClaudeCLI, generateMockReply, ClaudeResult } from './claude-cli';
import { extractRichBlocks } from './rich-extract';
import { addBlock, consumeBlocks, getStatus as getBlockBufferStatus } from './block-buffer';

// ============================================
// 配置
// ============================================
const PORT = 3002;
const DEFAULT_SESSION_ID = 'default';
const DEFAULT_USER_NAME = '用户';

// 存储聊天历史
let chatHistory: Message[] = [];

// 会话状态管理（记住当前对话的智能体）
const sessionStates = new Map<string, SessionState>();

// AI 智能体管理器
const agentManager = new AgentManager();

// 获取或创建会话状态
function getSessionState(sessionId: string): SessionState {
  let state = sessionStates.get(sessionId);
  if (!state) {
    state = { currentAgent: null, lastActivity: Date.now() };
    sessionStates.set(sessionId, state);
  }
  return state;
}

// 设置当前对话的智能体
function setCurrentAgent(sessionId: string, agentName: string | null): void {
  const state = getSessionState(sessionId);
  state.currentAgent = agentName;
  state.lastActivity = Date.now();
}

// ============================================
// 工具函数
// ============================================

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 解析 JSON 请求体
 */
function parseBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * 合并 blocks（去重）
 */
function mergeBlocks(blocksA: RichBlock[], blocksB: RichBlock[]): RichBlock[] {
  const blockMap = new Map<string, RichBlock>();

  for (const block of blocksA) {
    if (block.id) {
      blockMap.set(block.id, block);
    } else {
      const tempId = `temp-${generateId()}`;
      blockMap.set(tempId, { ...block, id: tempId });
    }
  }

  for (const block of blocksB) {
    if (block.id) {
      blockMap.set(block.id, block);
    } else {
      const tempId = `temp-${generateId()}`;
      blockMap.set(tempId, { ...block, id: tempId });
    }
  }

  return Array.from(blockMap.values());
}

// ============================================
// 路由处理
// ============================================

/**
 * 处理获取智能体列表
 */
function handleGetAgents(req: http.IncomingMessage, res: http.ServerResponse): void {
  const agents = agentManager.getAgentConfigs();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ agents }));
}

/**
 * 处理发送消息
 */
async function handleSendMessage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await parseBody<ChatRequest & { message: string; sender?: string }>(req);
    const { message, sender: bodySender } = body;
    const sender = bodySender || DEFAULT_USER_NAME;
    if (!message) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少 message 字段' }));
      return;
    }
    const sessionId = DEFAULT_SESSION_ID;
    const sessionState = getSessionState(sessionId);

    console.log(`\n[Chat] 用户 ${sender}: ${message}`);

    // 提取 @ 提及
    const mentions = agentManager.extractMentions(message);
    console.log(`[Chat] @ 提及: ${mentions.join(', ') || '无'}`);

    // 确定要响应的智能体列表
    const agentsToRespond: string[] = [];

    if (mentions.length > 0) {
      // 有新的 @ 提及，使用这些智能体，并更新会话状态
      for (const mention of mentions) {
        agentsToRespond.push(mention);
      }
      // 只记住第一个被 @ 的智能体作为后续默认对话对象
      setCurrentAgent(sessionId, mentions[0]);
      console.log(`[Chat] 设置当前对话智能体: ${mentions[0]}`);
    } else if (sessionState.currentAgent) {
      // 没有新的 @ 提及，但有之前的对话智能体
      agentsToRespond.push(sessionState.currentAgent);
      console.log(`[Chat] 继续与 ${sessionState.currentAgent} 对话`);
    }

    // 创建用户消息
    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      sender,
      text: message,
      timestamp: Date.now(),
      mentions: mentions.length > 0 ? mentions : undefined
    };

    // 添加到历史
    chatHistory.push(userMessage);

    // 返回的 AI 消息列表
    const aiMessages: Message[] = [];

    // 调用对应的 AI 智能体
    for (const agentName of agentsToRespond) {
      const agent = agentManager.getAgent(agentName);
      if (!agent) continue;

      console.log(`[Chat] 调用 AI: ${agentName}`);

      let aiResponse: ClaudeResult;
      try {
        aiResponse = await callClaudeCLI(message, agent, chatHistory);
      } catch (error: unknown) {
        const err = error as Error;
        console.log(`[Chat] Claude CLI 不可用: ${err.message}`);
        console.log('[Chat] 使用模拟回复');
        const mockText = generateMockReply(message, agentName);
        const extracted = extractRichBlocks(mockText);
        aiResponse = { text: extracted.cleanText, blocks: extracted.blocks };
      }

      // Route B: 从文本中提取 blocks
      const { cleanText, blocks: textBlocks } = extractRichBlocks(aiResponse.text);
      console.log(`[Chat] Route B (文本提取): ${textBlocks.length} 个 blocks`);

      // Route A: 从 BlockBuffer 获取预存的 blocks
      const bufferedBlocks = consumeBlocks(sessionId);
      console.log(`[Chat] Route A (HTTP 回调): ${bufferedBlocks.length} 个 blocks`);

      // 合并 blocks
      const mergedBlocks = mergeBlocks(bufferedBlocks, textBlocks);
      console.log(`[Chat] 合并后: ${mergedBlocks.length} 个 blocks`);

      // 创建 AI 消息
      const aiMessage: Message = {
        id: generateId(),
        role: 'assistant',
        sender: agentName,
        text: cleanText,
        blocks: mergedBlocks,
        timestamp: Date.now()
      };

      chatHistory.push(aiMessage);
      aiMessages.push(aiMessage);

      console.log(`[Chat] ${agentName} 回复完成`);
    }

    // 返回响应
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      userMessage,
      aiMessages,
      currentAgent: sessionState.currentAgent
    }));
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[Chat Error]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * 处理获取历史记录
 */
function handleGetHistory(req: http.IncomingMessage, res: http.ServerResponse): void {
  const sessionState = getSessionState(DEFAULT_SESSION_ID);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    messages: chatHistory,
    agents: agentManager.getAgentConfigs(),
    currentAgent: sessionState.currentAgent
  }));
}

/**
 * 处理清空历史
 */
function handleClearHistory(req: http.IncomingMessage, res: http.ServerResponse): void {
  chatHistory = [];
  // 同时重置当前对话智能体
  setCurrentAgent(DEFAULT_SESSION_ID, null);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true }));
}

/**
 * 处理切换智能体
 */
function handleSwitchAgent(req: http.IncomingMessage, res: http.ServerResponse): void {
  parseBody<{ agent?: string }>(req).then(body => {
    const agentName = body.agent;
    if (agentName && agentManager.hasAgent(agentName)) {
      setCurrentAgent(DEFAULT_SESSION_ID, agentName);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, currentAgent: agentName }));
    } else if (!agentName) {
      // 清除当前智能体
      setCurrentAgent(DEFAULT_SESSION_ID, null);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, currentAgent: null }));
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `未知的智能体: ${agentName}` }));
    }
  }).catch(err => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });
}

/**
 * 处理创建 block (Route A)
 */
async function handleCreateBlock(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await parseBody<{ sessionId?: string; block: RichBlock }>(req);
    const { sessionId = DEFAULT_SESSION_ID, } = body;
    const block = body.block;
    if (!block) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少 block 字段' }));
      return;
    }

    const sid = sessionId || DEFAULT_SESSION_ID;
    const addedBlock = addBlock(sid, block);

    console.log(`[CreateBlock] Session: ${sid}, Block: ${addedBlock.id}`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, block: addedBlock }));
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[CreateBlock Error]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * 处理获取 BlockBuffer 状态
 */
function handleGetBlockStatus(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(getBlockBufferStatus()));
}

/**
 * 提供静态文件
 */
function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, filePath: string, contentType: string): void {
  const fullPath = path.join(__dirname, '..', 'public', filePath);

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// ============================================
// 服务器入口
// ============================================

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  const method = req.method || 'GET';

  // CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 路由
  if (url === '/api/agents' && method === 'GET') {
    handleGetAgents(req, res);
  } else if (url === '/api/chat' && method === 'POST') {
    await handleSendMessage(req, res);
  } else if (url === '/api/history' && method === 'GET') {
    handleGetHistory(req, res);
  } else if (url === '/api/clear' && method === 'POST') {
    handleClearHistory(req, res);
  } else if (url === '/api/create-block' && method === 'POST') {
    await handleCreateBlock(req, res);
  } else if (url === '/api/block-status' && method === 'GET') {
    handleGetBlockStatus(req, res);
  } else if (url === '/' || url === '/index.html') {
    serveStatic(req, res, 'index.html', 'text/html');
  } else if (url === '/styles.css') {
    serveStatic(req, res, 'styles.css', 'text/css');
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('🚀 多 AI 智能体聊天室已启动');
  console.log('='.repeat(60));
  console.log(`📍 地址: http://localhost:${PORT}`);
  console.log('');
  console.log('可用的 AI 智能体:');
  agentManager.getAgents().forEach(agent => {
    console.log(`  - ${agent.avatar} ${agent.name}`);
  });
  console.log('');
  console.log('API 端点:');
  console.log('  GET  /api/agents       - 获取智能体列表');
  console.log('  POST /api/chat        - 发送消息');
  console.log('  GET  /api/history    - 获取历史记录');
  console.log('  POST /api/clear      - 清空历史');
  console.log('  POST /api/create-block - Route A: 创建 block');
  console.log('  GET  /api/block-status - 查看 BlockBuffer 状态');
  console.log('');
  console.log('使用方式:');
  console.log('  - 输入 @Claude 可以召唤 Claude');
  console.log('  - 输入 @Alice 可以召唤 Alice');
  console.log('  - 输入 @Bob 可以召唤 Bob');
  console.log('');
  console.log('💡 提示: 如果 Claude CLI 不可用,会自动使用模拟回复');
  console.log('='.repeat(60));
});
