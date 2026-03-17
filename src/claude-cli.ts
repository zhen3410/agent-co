/**
 * claude-cli.ts
 *
 * 功能：调用 Claude CLI / Codex CLI
 * 参考 minimal-claude.js 实现
 */

import { spawn } from 'child_process';
import { mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import * as readline from 'readline';
import { AIAgent, Message } from './types';
import { digestHistory } from './rich-digest';
import { extractRichBlocks } from './rich-extract';

const CLI_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_LINE_LENGTH = 10 * 1024 * 1024;
const VERBOSE_LOG_DIR = process.env.BOT_ROOM_VERBOSE_LOG_DIR || 'logs/ai-cli-verbose';

type CliKind = 'claude' | 'codex';

function createVerboseLogger(agentName: string, cli: CliKind): (channel: 'stdout' | 'stderr' | 'meta', content: string) => void {
  mkdirSync(VERBOSE_LOG_DIR, { recursive: true });
  const safeAgentName = agentName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = join(VERBOSE_LOG_DIR, `${timestamp}-${cli}-${safeAgentName}.log`);

  return (channel: 'stdout' | 'stderr' | 'meta', content: string) => {
    const line = `[${new Date().toISOString()}] [${channel}] ${content}`;
    appendFileSync(logPath, `${line}\n`, 'utf8');
  };
}

export interface ClaudeResult {
  text: string;
  blocks: Array<{ id: string; kind: string; title?: string; body?: string; tone?: string; items?: Array<{ text: string; done: boolean }> }>;
}


export interface ClaudeCallOptions {
  includeHistory?: boolean;
  extraEnv?: Record<string, string>;
}
function buildPrompt(userMessage: string, agent: AIAgent, history: Message[], includeHistory: boolean): string {
  const parts: string[] = [agent.systemPrompt];

  if (includeHistory && history && history.length > 0) {
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

  parts.push(`用户: ${userMessage}`);
  parts.push(`${agent.name}:`);

  return parts.join('\n');
}

function resolveCli(agent: AIAgent): CliKind {
  return agent.cli === 'codex' ? 'codex' : 'claude';
}

function buildCliCommand(cli: CliKind, prompt: string, extraEnv: Record<string, string>): { command: string; args: string[]; env: Record<string, string> } {
  const env = { ...process.env, ...extraEnv } as Record<string, string>;

  if (cli === 'claude') {
    delete (env as Record<string, unknown>).CLAUDECODE;
    delete (env as Record<string, unknown>).CLAUDE_SESSION_ID;
    return {
      command: 'claude',
      args: ['-p', prompt, '--output-format', 'stream-json', '--verbose'],
      env
    };
  }

  delete (env as Record<string, unknown>).CODEX_SESSION_ID;
  return {
    command: 'codex',
    args: ['exec', prompt, '--json'],
    env
  };
}

export async function callClaudeCLI(userMessage: string, agent: AIAgent, history: Message[], options: ClaudeCallOptions = {}): Promise<ClaudeResult> {
  return new Promise((resolve, reject) => {
    const prompt = buildPrompt(userMessage, agent, history, options.includeHistory !== false);
    const cli = resolveCli(agent);
    console.log(`\n[${cli.toUpperCase()} CLI] Agent: ${agent.name}, Prompt length: ${prompt.length}`);
    const logVerbose = createVerboseLogger(agent.name, cli);
    logVerbose('meta', `Prompt length: ${prompt.length}`);

    const cliCommand = buildCliCommand(cli, prompt, options.extraEnv || {});
    const child = spawn(cliCommand.command, cliCommand.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: cliCommand.env
    });

    let result = '';
    let finalResult = '';
    let stderrData = '';

    const timeoutId = setTimeout(() => {
      console.error(`[${cli.toUpperCase()} CLI] 超时，正在终止...`);
      child.kill('SIGTERM');
    }, CLI_TIMEOUT_MS);

    child.stderr?.on('data', (data) => {
      const content = data.toString();
      stderrData += content;
      logVerbose('stderr', content.trimEnd());
    });

    const rl = readline.createInterface({
      input: child.stdout!,
      crlfDelay: Infinity
    });

    rl.on('line', (line) => {
      if (!line.trim()) return;
      logVerbose('stdout', line);

      if (line.length > MAX_LINE_LENGTH) {
        console.error('\n[警告] 检测到超大行数据，可能存在问题');
        return;
      }

      try {
        const event = JSON.parse(line);
        if (typeof event.result === 'string') {
          finalResult = event.result;
        }

        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text') {
              result += block.text;
            }
          }
        } else if (typeof event.text === 'string') {
          result += event.text;
        } else if (typeof event.output_text === 'string') {
          result += event.output_text;
        }
      } catch {
        result += `${line}\n`;
      }
    });

    child.on('close', (code) => {
      clearTimeout(timeoutId);

      if (code !== 0 && !result && !finalResult) {
        const errorMsg = stderrData.trim() || `Exit code: ${code}`;
        logVerbose('meta', `Process exited with code ${code}, no usable output`);
        reject(new Error(`${cli.toUpperCase()} CLI error: ${errorMsg}`));
      } else {
        const output = (finalResult || result).trim();
        logVerbose('meta', `Process exited with code ${code}; final output length: ${output.length}`);
        const { cleanText, blocks } = extractRichBlocks(output);
        resolve({ text: cleanText, blocks });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(new Error(`无法启动 ${cli.toUpperCase()} CLI: ${err.message}`));
    });
  });
}

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
