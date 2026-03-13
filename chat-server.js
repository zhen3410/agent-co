/**
 * chat-server.js
 *
 * 功能：AI 聊天服务器，支持 Rich Blocks 双路由模式
 *
 * Route A（MCP 风格 — HTTP 回调）：
 *   - POST /api/create-block 直接发送 block
 *   - BlockBuffer 暂存，消息写入时合并
 *
 * Route B（文本提取 — Fallback）：
 *   - 从 AI 回复文本中提取 ```cc_rich ... ``` 块
 *
 * 合并逻辑：
 *   - 消息写入时，Route A + Route B 的 blocks 合并
 *   - 按 block.id 去重
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');
const { extractRichBlocks } = require('./rich-extract');
const { digestHistory } = require('./rich-digest');
const blockBuffer = require('./block-buffer');

// ============================================
// 配置
// ============================================
const PORT = 3000;
const CLAUDE_TIMEOUT_MS = 60 * 1000; // Claude CLI 超时：60 秒
const DEFAULT_SESSION_ID = 'default'; // 默认会话 ID

// 系统提示词
const SYSTEM_PROMPT = `你是一个友好的 AI 助手。

你可以使用特殊格式发送富文本卡片，让回复更加美观。

格式说明：
\`\`\`cc_rich
{
  "kind": "card",
  "title": "标题",
  "body": "内容",
  "tone": "info" | "success" | "warning"
}
\`\`\`

\`\`\`cc_rich
{
  "kind": "checklist",
  "title": "标题",
  "items": [
    { "text": "任务内容", "done": false },
    { "text": "已完成的任务", "done": true }
  ]
}
\`\`\`

使用场景：
- 当你想强调某个重要信息时，使用 card（tone: info 用于提示，success 用于成功，warning 用于警告）
- 当你要列出待办事项或任务清单时，使用 checklist
- 你可以在一条消息中使用多个 cc_rich 块

普通文本和 cc_rich 块可以混合使用，让回复更加丰富。`;

// 存储聊天历史（内存中，重启后清空）
let chatHistory = [];

// ============================================
// 工具函数
// ============================================

/**
 * 解析 JSON 请求体
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
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
 * 构建完整的 prompt（包含系统提示词和历史）
 */
function buildPrompt(userMessage, history) {
  const parts = [SYSTEM_PROMPT];

  // 添加历史消息（已经过 digest 处理）
  if (history && history.length > 0) {
    parts.push('\n--- 对话历史 ---');
    for (const msg of history) {
      if (msg.role === 'user') {
        parts.push(`用户: ${msg.text || msg.content || ''}`);
      } else {
        // AI 消息用摘要格式
        const digested = digestHistory([msg]);
        if (digested) {
          parts.push(`AI: ${digested}`);
        }
      }
    }
    parts.push('--- 历史结束 ---\n');
  }

  // 添加当前用户消息
  parts.push(`用户: ${userMessage}`);
  parts.push('AI:');

  return parts.join('\n');
}

/**
 * 调用 Claude CLI
 * 参考 minimal-claude.js 实现
 */
async function callClaudeCLI(userMessage, history) {
  return new Promise((resolve, reject) => {
    // 构建完整 prompt
    const prompt = buildPrompt(userMessage, history);
    console.log('\n[Claude CLI] Prompt length:', prompt.length);

    // 启动 Claude CLI 子进程
    // 注意：需要 unset CLAUDECODE 以避免嵌套会话检测
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const child = spawn('claude', [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose'
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env
    });

    let result = '';
    let stderrData = '';
    let timeoutId = null;

    // 设置超时
    timeoutId = setTimeout(() => {
      console.error('[Claude CLI] 超时，正在终止...');
      child.kill('SIGTERM');
    }, CLAUDE_TIMEOUT_MS);

    // 收集 stderr 用于调试
    child.stderr.on('data', (data) => {
      stderrData += data;
    });

    // 逐行解析 JSON 输出
    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity
    });

    rl.on('line', (line) => {
      if (!line.trim()) return;

      try {
        const event = JSON.parse(line);

        // 提取 assistant 消息中的文本
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text') {
              result += block.text;
            }
          }
        }
      } catch (e) {
        // JSON 解析失败，忽略该行
      }
    });

    // 处理进程退出
    child.on('close', (code) => {
      clearTimeout(timeoutId);

      if (code !== 0 && !result) {
        const errorMsg = stderrData.trim() || `Exit code: ${code}`;
        reject(new Error(`Claude CLI error: ${errorMsg}`));
      } else {
        resolve(result);
      }
    });

    // 处理子进程错误
    child.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(new Error(`无法启动 Claude CLI: ${err.message}`));
    });
  });
}

/**
 * 生成模拟回复（当 AI API 不可用时）
 */
function generateMockReply(userMessage) {
  const lowerMsg = userMessage.toLowerCase();

  if (lowerMsg.includes('待办') || lowerMsg.includes('todo') || lowerMsg.includes('计划')) {
    return `好的，我来帮你列一个今天的待办事项：

\`\`\`cc_rich
{
  "kind": "checklist",
  "title": "📋 今天的待办",
  "items": [
    { "text": "写第七课作业", "done": false },
    { "text": "跑一遍测试", "done": false },
    { "text": "读完第七课", "done": true },
    { "text": "回复邮件", "done": false }
  ]
}
\`\`\`

记得按时完成哦！`;
  }

  if (lowerMsg.includes('总结') || lowerMsg.includes('进展') || lowerMsg.includes('摘要')) {
    return `好的，这是昨天的进展摘要：

\`\`\`cc_rich
{
  "kind": "card",
  "title": "📊 昨天进展摘要",
  "body": "完成了 3 个功能，修了 2 个 bug，测试覆盖率 95%。",
  "tone": "info"
}
\`\`\`

继续保持！`;
  }

  if (lowerMsg.includes('警告') || lowerMsg.includes('注意') || lowerMsg.includes('问题')) {
    return `我注意到一个需要关注的问题：

\`\`\`cc_rich
{
  "kind": "card",
  "title": "⚠️ 注意事项",
  "body": "服务器负载较高，建议检查资源使用情况。",
  "tone": "warning"
}
\`\`\`

需要我帮你分析吗？`;
  }

  if (lowerMsg.includes('完成') || lowerMsg.includes('成功')) {
    return `太棒了！

\`\`\`cc_rich
{
  "kind": "card",
  "title": "✅ 操作成功",
  "body": "任务已成功完成！",
  "tone": "success"
}
\`\`\`

还有什么需要帮助的吗？`;
  }

  return `我收到了你的消息："${userMessage}"

如果你想看我展示富文本功能，可以尝试说：
- "帮我列一个今天的待办事项"
- "总结一下昨天的进展"
- "给我一个警告提示"
- "显示一个成功消息"`;
}

// ============================================
// 路由处理
// ============================================

/**
 * 处理聊天请求
 */
async function handleChat(req, res) {
  try {
    const body = await parseBody(req);
    const { message, history, sessionId } = body;

    if (!message) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少 message 字段' }));
      return;
    }

    // 使用传入的 sessionId 或默认值
    const sid = sessionId || DEFAULT_SESSION_ID;
    console.log('\n[Chat] Session:', sid);
    console.log('[Chat] User:', message);

    // 调用 Claude CLI（如果失败则使用模拟回复）
    let aiResponse;
    try {
      aiResponse = await callClaudeCLI(message, history);
    } catch (error) {
      console.log('[Chat] Claude CLI 不可用:', error.message);
      console.log('[Chat] 使用模拟回复');
      aiResponse = generateMockReply(message);
    }

    console.log('[Chat] AI Raw:', aiResponse.substring(0, 100) + '...');

    // ============================================
    // 双路由合并逻辑
    // ============================================

    // Route B: 从 AI 文本中提取 blocks
    const { cleanText, blocks: textBlocks } = extractRichBlocks(aiResponse);
    console.log('[Chat] Route B (文本提取):', textBlocks.length, '个 blocks');

    // Route A: 从 BlockBuffer 获取预存的 blocks
    const bufferedBlocks = blockBuffer.consumeBlocks(sid);
    console.log('[Chat] Route A (HTTP 回调):', bufferedBlocks.length, '个 blocks');

    // 合并 blocks（去重）
    const mergedBlocks = mergeBlocks(bufferedBlocks, textBlocks);
    console.log('[Chat] 合并后:', mergedBlocks.length, '个 blocks');

    // 构建响应
    const response = {
      text: cleanText,
      blocks: mergedBlocks,
      sessionId: sid,
      routeInfo: {
        routeA: bufferedBlocks.length,
        routeB: textBlocks.length,
        merged: mergedBlocks.length
      }
    };

    // 更新历史
    chatHistory.push({ role: 'user', text: message, sessionId: sid });
    chatHistory.push({ role: 'assistant', text: cleanText, blocks: mergedBlocks, sessionId: sid });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));

  } catch (error) {
    console.error('[Chat Error]', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * 合并 blocks（去重）
 * @param {Array} blocksA - Route A 的 blocks
 * @param {Array} blocksB - Route B 的 blocks
 * @returns {Array} 合并后的 blocks
 */
function mergeBlocks(blocksA, blocksB) {
  const blockMap = new Map();

  // 先添加 Route A 的 blocks（优先级较低，可能被覆盖）
  for (const block of blocksA) {
    if (block.id) {
      blockMap.set(block.id, block);
    } else {
      // 没有 id 的 block 用随机 id
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      blockMap.set(tempId, { ...block, id: tempId });
    }
  }

  // 再添加 Route B 的 blocks（优先级较高，会覆盖同名）
  for (const block of blocksB) {
    if (block.id) {
      blockMap.set(block.id, block);
    } else {
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      blockMap.set(tempId, { ...block, id: tempId });
    }
  }

  return Array.from(blockMap.values());
}

/**
 * 处理 Route A: 创建 block（MCP 风格 HTTP 回调）
 */
async function handleCreateBlock(req, res) {
  try {
    const body = await parseBody(req);
    const { sessionId, block } = body;

    if (!block) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少 block 字段' }));
      return;
    }

    // 使用传入的 sessionId 或默认值
    const sid = sessionId || DEFAULT_SESSION_ID;

    // 添加 block 到缓冲区
    const addedBlock = blockBuffer.addBlock(sid, block);

    console.log('[CreateBlock] Session:', sid);
    console.log('[CreateBlock] Block added:', addedBlock.id);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      block: addedBlock,
      sessionId: sid
    }));

  } catch (error) {
    console.error('[CreateBlock Error]', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * 获取 BlockBuffer 状态
 */
function handleBlockStatus(req, res) {
  const status = blockBuffer.getStatus();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(status));
}

/**
 * 获取历史记录
 */
function handleHistory(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(chatHistory));
}

/**
 * 清空历史
 */
function handleClear(req, res) {
  chatHistory = [];
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true }));
}

/**
 * 提供静态文件
 */
function serveStatic(req, res, filePath, contentType) {
  const fullPath = path.join(__dirname, filePath);

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
  const url = req.url;
  const method = req.method;

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
  if (url === '/chat' && method === 'POST') {
    await handleChat(req, res);
  } else if (url === '/api/create-block' && method === 'POST') {
    // Route A: MCP 风格 HTTP 回调
    await handleCreateBlock(req, res);
  } else if (url === '/api/block-status' && method === 'GET') {
    // 调试：查看 BlockBuffer 状态
    handleBlockStatus(req, res);
  } else if (url === '/history' && method === 'GET') {
    handleHistory(req, res);
  } else if (url === '/clear' && method === 'POST') {
    handleClear(req, res);
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
  console.log('='.repeat(50));
  console.log('🚀 AI 聊天服务器已启动（双路由模式）');
  console.log('='.repeat(50));
  console.log(`📍 地址: http://localhost:${PORT}`);
  console.log(`🤖 AI 后端: Claude CLI`);
  console.log(`⏱️  超时: ${CLAUDE_TIMEOUT_MS / 1000}秒`);
  console.log('');
  console.log('API 端点:');
  console.log('  POST /chat              - 发送聊天消息（合并 Route A + B）');
  console.log('  POST /api/create-block  - Route A: 直接创建 block');
  console.log('  GET  /api/block-status  - 查看 BlockBuffer 状态');
  console.log('  GET  /history           - 获取历史记录');
  console.log('  POST /clear             - 清空历史');
  console.log('');
  console.log('双路由模式:');
  console.log('  Route A (HTTP 回调): POST /api/create-block → BlockBuffer');
  console.log('  Route B (文本提取): 从 AI 回复提取 cc_rich 块');
  console.log('  合并: 消息写入时合并，按 block.id 去重');
  console.log('');
  console.log('💡 提示: 如果 Claude CLI 不可用，会自动使用模拟回复');
  console.log('='.repeat(50));
});
