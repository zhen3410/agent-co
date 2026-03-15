/**
 * claude-cli.ts
 *
 * 功能：调用 Claude CLI
 * 参考 minimal-claude.js 实现
 */

import { spawn } from 'child_process';
import { mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import * as readline from 'readline';
import { AIAgent, Message } from './types';
import { digestHistory } from './rich-digest';

import { extractRichBlocks } from './rich-extract';

// 配置
const CLAUDE_TIMEOUT_MS = 30 * 60 * 1000; // Claude CLI 超时：30 分钟
const MAX_LINE_LENGTH = 10 * 1024 * 1024; // 单行最大 10MB
const VERBOSE_LOG_DIR = process.env.BOT_ROOM_VERBOSE_LOG_DIR || 'logs/claude-verbose';

function createVerboseLogger(agentName: string): (channel: 'stdout' | 'stderr' | 'meta', content: string) => void {
  mkdirSync(VERBOSE_LOG_DIR, { recursive: true });
  const safeAgentName = agentName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = join(VERBOSE_LOG_DIR, `${timestamp}-${safeAgentName}.log`);

  return (channel: 'stdout' | 'stderr' | 'meta', content: string) => {
    const line = `[${new Date().toISOString()}] [${channel}] ${content}`;
    appendFileSync(logPath, `${line}\n`, 'utf8');
  };
}

export interface ClaudeResult {
  text: string;
  blocks: Array<{ id: string; kind: string; title?: string; body?: string; tone?: string; items?: Array<{ text: string; done: boolean }> }>;
}

/**
 * 构建完整的 prompt（包含系统提示词和历史）
 */
function buildPrompt(userMessage: string, agent: AIAgent, history: Message[]): string {
  const parts: string[] = [agent.systemPrompt];

  // 添加历史消息
  if (history && history.length > 0) {
    parts.push('\n--- 对话历史 ---');
    for (const msg of history) {
      const sender = msg.sender || (msg.role === 'user' ? '用户' : 'AI');
      if (msg.role === 'user') {
        parts.push(`${sender}: ${msg.text || ''}`);
      } else {
        const digested = digestHistory([msg]);
        if (digested) {
          parts.push(`${sender}: ${digested}`);
        }
      }
    }
    parts.push('--- 历史结束 ---\n');
  }

  // 添加当前用户消息
  parts.push(`用户: ${userMessage}`);
  parts.push(`${agent.name}:`);

  return parts.join('\n');
}

/**
 * 调用 Claude CLI
 */
export async function callClaudeCLI(
  userMessage: string,
  agent: AIAgent,
  history: Message[]
): Promise<ClaudeResult> {
  return new Promise((resolve, reject) => {
    const prompt = buildPrompt(userMessage, agent, history);
    console.log(`\n[Claude CLI] Agent: ${agent.name}, Prompt length: ${prompt.length}`);
    const logVerbose = createVerboseLogger(agent.name);
    logVerbose('meta', `Prompt length: ${prompt.length}`);

    // 启动 Claude CLI 子进程
    // 注意: 需要 unset CLAUDECODE 以避免嵌套会话检测
    const env = { ...process.env };
    delete (env as Record<string, unknown>).CLAUDECODE;

    delete (env as Record<string, unknown>).CLAUDE_SESSION_ID;

    const child = spawn('claude', [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose'
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env as Record<string, string>
    });

    let result = '';
    let finalResult = '';
    let stderrData = '';
    let timeoutId: NodeJS.Timeout | null;

    // 设置超时
    timeoutId = setTimeout(() => {
      console.error('[Claude CLI] 超时，正在终止...');
      child.kill('SIGTERM');
    }, CLAUDE_TIMEOUT_MS);

    // 收集 stderr 用于调试
    child.stderr?.on('data', (data) => {
      const content = data.toString();
      stderrData += content;
      logVerbose('stderr', content.trimEnd());
    });

    // 逐行解析 JSON 输出
    const rl = readline.createInterface({
      input: child.stdout!,
      crlfDelay: Infinity
    });

    rl.on('line', (line) => {
      if (!line.trim()) return;
      logVerbose('stdout', line);

      // 安全检查: 防止超大行
      if (line.length > MAX_LINE_LENGTH) {
        console.error('\n[警告] 检测到超大行数据，可能存在问题');
        return;
      }

      try {
        const event = JSON.parse(line);

        if (event.type === 'result' && typeof event.result === 'string') {
          finalResult = event.result;
        }

        // 提取 assistant 消息中的文本
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text') {
              result += block.text;
            }
          }
        }
      } catch (e) {
        // JSON 解析失败,忽略该行
      }
    });

    // 处理进程退出
    child.on('close', (code) => {
      clearTimeout(timeoutId as NodeJS.Timeout);

      if (code !== 0 && !result) {
        const errorMsg = stderrData.trim() || `Exit code: ${code}`;
        logVerbose('meta', `Process exited with code ${code}, no usable output`);
        reject(new Error(`Claude CLI error: ${errorMsg}`));
      } else {
        const output = finalResult || result;
        logVerbose('meta', `Process exited with code ${code}; final output length: ${output.length}`);
        // 提取 rich blocks
        const { cleanText, blocks } = extractRichBlocks(output);
        resolve({ text: cleanText, blocks });
      }
    });

    // 处理子进程错误
    child.on('error', (err) => {
      clearTimeout(timeoutId as NodeJS.Timeout);
      reject(new Error(`无法启动 Claude CLI: ${err.message}`));
    });
  });
}

/**
 * 生成模拟回复（当 AI API 不可用时)
 */
export function generateMockReply(userMessage: string, agentName: string): string {
  const lowerMsg = userMessage.toLowerCase();

  if (lowerMsg.includes('待办') || lowerMsg.includes('todo') || lowerMsg.includes('计划')) {
    return `好的,我来帮你列一个今天的待办事项：

\`\`\`cc_rich
{
  "kind": "checklist",
  "title": "📋 今天的待办",
  "items": [
    { "text": "完成任务一", "done": false },
    { "text": "完成任务二", "done": false },
    { "text": "已完成事项", "done": true }
  ]
}
\`\`\`

记得按时完成哦！`;
  }

  if (lowerMsg.includes('总结') || lowerMsg.includes('进展') || lowerMsg.includes('摘要')) {
    return `好的,这是进展摘要:

\`\`\`cc_rich
{
  "kind": "card",
  "title": "📊 进展摘要",
  "body": "完成了多个任务,进展顺利。",
  "tone": "info"
}
\`\`\`

继续保持!`;
  }

  if (lowerMsg.includes('警告') || lowerMsg.includes('注意') || lowerMsg.includes('问题')) {
    return `我注意到一个需要关注的问题:

\`\`\`cc_rich
{
  "kind": "card",
  "title": "⚠️ 注意事项",
  "body": "请检查相关资源使用情况。",
  "tone": "warning"
}
\`\`\`

需要我帮你分析吗?`;
  }

  if (lowerMsg.includes('完成') || lowerMsg.includes('成功')) {
    return `太棒了!

\`\`\`cc_rich
{
  "kind": "card",
  "title": "✅ 操作成功",
  "body": "任务已成功完成!",
  "tone": "success"
}
\`\`\`

还有什么需要帮助的吗?`;
  }

  return `我是 ${agentName},我收到了你的消息: "${userMessage}"

如果你想看我展示富文本功能,可以尝试说:
- "帮我列一个今天的待办事项"
- "总结一下进展"
- "给我一个警告提示"
- "显示一个成功消息"`;
}
