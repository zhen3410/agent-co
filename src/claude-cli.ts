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
import { AIAgent, Message, RichBlock } from './types';
import { digestHistory } from './rich-digest';
import { extractRichBlocks } from './rich-extract';

function readDurationFromEnv(name: string, fallbackMs: number): number {
  const raw = process.env[name];
  if (!raw) return fallbackMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

const CLI_TIMEOUT_MS = readDurationFromEnv('BOT_ROOM_CLI_TIMEOUT_MS', 30 * 60 * 1000);
const CLI_HEARTBEAT_TIMEOUT_MS = readDurationFromEnv('BOT_ROOM_CLI_HEARTBEAT_TIMEOUT_MS', 3 * 60 * 1000);
const CLI_KILL_GRACE_MS = readDurationFromEnv('BOT_ROOM_CLI_KILL_GRACE_MS', 5000);
const MAX_LINE_LENGTH = 10 * 1024 * 1024;
const VERBOSE_LOG_DIR = process.env.BOT_ROOM_VERBOSE_LOG_DIR || 'logs/ai-cli-verbose';

type CliKind = 'claude' | 'codex';
type McpConfig = { mcpConfig: string; allowedTools: string };
const CODEX_MCP_SERVER_NAME = 'botroom';
const CLAUDE_MCP_SERVER_NAME = 'bot-room';

function createVerboseLogger(agentName: string, cli: CliKind): (channel: 'stdout' | 'stderr' | 'meta', content: string) => void {
  mkdirSync(VERBOSE_LOG_DIR, { recursive: true });
  const safeAgentName = encodeURIComponent(agentName);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = join(VERBOSE_LOG_DIR, `${timestamp}-${cli}-${safeAgentName}.log`);

  return (channel: 'stdout' | 'stderr' | 'meta', content: string) => {
    const line = `[${new Date().toISOString()}] [${channel}] ${content}`;
    appendFileSync(logPath, `${line}\n`, 'utf8');
  };
}

export interface ClaudeResult {
  text: string;
  blocks: RichBlock[];
}


export interface ClaudeCallOptions {
  includeHistory?: boolean;
  extraEnv?: Record<string, string>;
}

export type CliCallOptions = ClaudeCallOptions;
export type CliCallResult = ClaudeResult;

function collectTextFromValue(value: unknown, inAssistantContext = false): string[] {
  if (!value) return [];

  if (typeof value === 'string') {
    return inAssistantContext && value ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(item => collectTextFromValue(item, inAssistantContext));
  }

  if (typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  const chunks: string[] = [];
  const assistantRole = typeof record.role === 'string' ? record.role === 'assistant' : false;
  const assistantType = typeof record.type === 'string' ? record.type === 'assistant' : false;
  const isAssistantContext = inAssistantContext || assistantRole || assistantType;
  const content = Array.isArray(record.content) ? record.content : null;

  if (typeof record.output_text === 'string' && record.output_text) {
    chunks.push(record.output_text);
  }

  if ((isAssistantContext || record.type === 'output_text') && typeof record.text === 'string' && record.text) {
    chunks.push(record.text);
  }

  if (record.type === 'agent_message' && typeof record.text === 'string' && record.text) {
    chunks.push(record.text);
  }

  for (const key of ['result', 'delta'] as const) {
    if ((isAssistantContext || record.type === 'output_text') && typeof record[key] === 'string' && record[key]) {
      chunks.push(record[key] as string);
    }
  }

  if (record.type === 'output_text' && typeof record.text === 'string') {
    return chunks;
  }

  if (record.type === 'message' && content) {
    return chunks.concat(content.flatMap(item => collectTextFromValue(item, isAssistantContext)));
  }

  if (record.message) {
    chunks.push(...collectTextFromValue(record.message, isAssistantContext));
  }

  if (record.item) {
    chunks.push(...collectTextFromValue(record.item, isAssistantContext));
  }

  if (record.payload) {
    chunks.push(...collectTextFromValue(record.payload, isAssistantContext));
  }

  if (content) {
    for (const item of content) {
      chunks.push(...collectTextFromValue(item, isAssistantContext));
    }
  }

  return chunks;
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

  if (!includeHistory) {
    parts.push('你当前只收到了用户最新一条消息。请先调用 bot_room_get_context 获取完整会话历史，再继续处理任务。');
    parts.push('当你需要向聊天室展示内容时，调用 bot_room_post_message 发送最终可见消息。');
    parts.push('不要把思考过程直接输出给用户。');
  }

  parts.push(`用户: ${userMessage}`);
  parts.push(`${agent.name}:`);

  return parts.join('\n');
}

function resolveCli(agent: AIAgent): CliKind {
  if (agent.cliName === 'codex' || agent.cliName === 'claude') {
    return agent.cliName;
  }

  return agent.cli === 'codex' ? 'codex' : 'claude';
}


function buildMcpConfig(extraEnv: Record<string, string>): McpConfig | null {
  const apiUrl = extraEnv.BOT_ROOM_API_URL;
  const sessionId = extraEnv.BOT_ROOM_SESSION_ID;
  if (!apiUrl || !sessionId) {
    return null;
  }

  const callbackToken = extraEnv.BOT_ROOM_CALLBACK_TOKEN || process.env.BOT_ROOM_CALLBACK_TOKEN || 'bot-room-callback-token';
  const agentName = extraEnv.BOT_ROOM_AGENT_NAME || process.env.BOT_ROOM_AGENT_NAME || 'AI';
  const mcpServerScript = join(process.cwd(), 'dist', 'bot-room-mcp-server.js');

  const mcpConfig = JSON.stringify({
    mcpServers: {
      [CLAUDE_MCP_SERVER_NAME]: {
        command: 'node',
        args: [mcpServerScript],
        env: {
          BOT_ROOM_API_URL: apiUrl,
          BOT_ROOM_SESSION_ID: sessionId,
          BOT_ROOM_CALLBACK_TOKEN: callbackToken,
          BOT_ROOM_AGENT_NAME: agentName
        }
      }
    }
  });

  return {
    mcpConfig,
    allowedTools: `mcp__${CLAUDE_MCP_SERVER_NAME}__bot_room_post_message,mcp__${CLAUDE_MCP_SERVER_NAME}__bot_room_get_context`
  };
}

function buildCliCommand(cli: CliKind, prompt: string, extraEnv: Record<string, string>, workdir?: string): { command: string; args: string[]; env: Record<string, string> } {
  const env = { ...process.env, ...extraEnv } as Record<string, string>;
  const mcp = buildMcpConfig(extraEnv);
  const codexMcpKey = `mcp_servers.${CODEX_MCP_SERVER_NAME}`;
  const codexMcpEnv = {
    BOT_ROOM_API_URL: extraEnv.BOT_ROOM_API_URL,
    BOT_ROOM_SESSION_ID: extraEnv.BOT_ROOM_SESSION_ID,
    BOT_ROOM_CALLBACK_TOKEN: extraEnv.BOT_ROOM_CALLBACK_TOKEN || process.env.BOT_ROOM_CALLBACK_TOKEN || 'bot-room-callback-token',
    BOT_ROOM_AGENT_NAME: extraEnv.BOT_ROOM_AGENT_NAME || process.env.BOT_ROOM_AGENT_NAME || 'AI'
  };
  const codexMcpEnvToml = `{ ${Object.entries(codexMcpEnv)
    .map(([key, value]) => `${key}=${JSON.stringify(value ?? '')}`)
    .join(', ')} }`;

  if (cli === 'claude') {
    delete (env as Record<string, unknown>).CLAUDECODE;
    delete (env as Record<string, unknown>).CLAUDE_SESSION_ID;

    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
    if (mcp) {
      args.push('--mcp-config', mcp.mcpConfig, '--allowedTools', mcp.allowedTools);
    }

    return {
      command: 'claude',
      args,
      env
    };
  }

  delete (env as Record<string, unknown>).CODEX_SESSION_ID;
  const args = ['exec', prompt, '--json'];
  args.push('-c', `approval_policy="never"`);
  if (mcp) {
    args.push(
      '-c',
      `${codexMcpKey}.command="node"`,
      '-c',
      `${codexMcpKey}.args=${JSON.stringify([join(process.cwd(), 'dist', 'bot-room-mcp-server.js')])}`,
      '-c',
      `${codexMcpKey}.env=${codexMcpEnvToml}`,
      '-c',
      `tools.allowed=${JSON.stringify([
        `mcp__${CODEX_MCP_SERVER_NAME}__bot_room_post_message`,
        `mcp__${CODEX_MCP_SERVER_NAME}__bot_room_get_context`
      ])}`
    );
  }
  return {
    command: 'codex',
    args,
    env
  };
}

export async function callClaudeCLI(userMessage: string, agent: AIAgent, history: Message[], options: ClaudeCallOptions = {}): Promise<ClaudeResult> {
  return new Promise((resolve, reject) => {
    const cli = resolveCli(agent);
    const prompt = buildPrompt(userMessage, agent, history, options.includeHistory !== false)
      + (cli === 'codex' && options.includeHistory === false
        ? `\n在 Codex 环境中，这两个工具通常显示为 functions.mcp__${CODEX_MCP_SERVER_NAME}__bot_room_get_context 和 functions.mcp__${CODEX_MCP_SERVER_NAME}__bot_room_post_message。`
        : '');
    console.log(`\n[${cli.toUpperCase()} CLI] Agent: ${agent.name}, Prompt length: ${prompt.length}`);
    const logVerbose = createVerboseLogger(agent.name, cli);
    logVerbose('meta', `Prompt length: ${prompt.length}`);

    const requestedWorkdir = agent.workdir && agent.workdir.trim() ? agent.workdir.trim() : undefined;
    const cliCommand = buildCliCommand(cli, prompt, options.extraEnv || {}, requestedWorkdir);
    const child = spawn(cliCommand.command, cliCommand.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: cliCommand.env,
      cwd: requestedWorkdir || process.cwd()
    });

    let result = '';
    let finalResult = '';
    let stderrData = '';
    let lastHeartbeat = Date.now();
    let isTerminating = false;

    const onHeartbeat = () => {
      lastHeartbeat = Date.now();
    };

    const gracefulKill = (reason: string) => {
      if (isTerminating) return;
      isTerminating = true;
      logVerbose('meta', reason);
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          logVerbose('meta', 'SIGTERM 后进程未退出，发送 SIGKILL');
          child.kill('SIGKILL');
        }
      }, CLI_KILL_GRACE_MS);
    };

    const timeoutId = setTimeout(() => {
      console.error(`[${cli.toUpperCase()} CLI] 超时，正在终止...`);
      gracefulKill(`超过总超时 ${CLI_TIMEOUT_MS}ms，终止子进程`);
    }, CLI_TIMEOUT_MS);
    const heartbeatId = setInterval(() => {
      const elapsed = Date.now() - lastHeartbeat;
      if (elapsed > CLI_HEARTBEAT_TIMEOUT_MS) {
        console.error(`[${cli.toUpperCase()} CLI] 心跳超时 ${elapsed}ms，正在终止...`);
        gracefulKill(`心跳超时 ${elapsed}ms，无任何输出`);
      }
    }, 30000);

    child.stderr?.on('data', (data) => {
      onHeartbeat();
      const content = data.toString();
      stderrData += content;
      logVerbose('stderr', content.trimEnd());
    });
    child.stdout?.on('data', onHeartbeat);

    const rl = readline.createInterface({
      input: child.stdout!,
      crlfDelay: Infinity
    });

    rl.on('line', (line) => {
      if (!line.trim()) return;
      onHeartbeat();
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

        const extractedTexts = collectTextFromValue(event);
        if (extractedTexts.length > 0) {
          result += extractedTexts.join('');
        }
      } catch {
        result += `${line}\n`;
      }
    });

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      clearInterval(heartbeatId);

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
      clearInterval(heartbeatId);
      reject(new Error(`无法启动 ${cli.toUpperCase()} CLI: ${err.message}`));
    });
  });
}

export async function callAgentCLI(
  userMessage: string,
  agent: AIAgent,
  history: Message[],
  options: CliCallOptions = {}
): Promise<CliCallResult> {
  return callClaudeCLI(userMessage, agent, history, options);
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
