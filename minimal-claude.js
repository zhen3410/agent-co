#!/usr/bin/env node

const { spawn } = require('child_process');
const readline = require('readline');

// ============ 配置 ============
const HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000;  // 心跳超时：5 分钟无任何输出则终止
const HEARTBEAT_CHECK_INTERVAL_MS = 30000;   // 心跳检查间隔：30 秒
const GRACEFUL_KILL_DELAY_MS = 5000;         // SIGTERM 后等待 5 秒再 SIGKILL
const MAX_LINE_LENGTH = 10 * 1024 * 1024;    // 单行最大 10MB

// 从命令行参数获取问题
const prompt = process.argv[2];

if (!prompt) {
  console.error('用法: node minimal-claude.js "你的问题"');
  process.exit(1);
}

// 启动 Claude CLI 子进程
const child = spawn('claude', [
  '-p', prompt,
  '--output-format', 'stream-json',
  '--verbose'
], {
  stdio: ['ignore', 'pipe', 'pipe'] // stdin 忽略，stdout/stderr 管道
});

// ============ 心跳机制 ============
let lastHeartbeat = Date.now();
let killed = false;
let killTimer = null;  // SIGKILL 定时器引用

// 任何输出都视为心跳
const onHeartbeat = () => {
  lastHeartbeat = Date.now();
};

// 同时监听 stdout 和 stderr（CLI thinking 时输出到 stderr）
child.stdout.on('data', onHeartbeat);
child.stderr.on('data', onHeartbeat);

// 心跳超时检测
const heartbeatChecker = setInterval(() => {
  const elapsed = Date.now() - lastHeartbeat;
  if (elapsed > HEARTBEAT_TIMEOUT_MS && !killed) {
    console.error(`\n[心跳超时] ${Math.round(elapsed / 1000)} 秒无任何输出，正在终止...`);
    gracefulKill();
  }
}, HEARTBEAT_CHECK_INTERVAL_MS);

// ============ 两阶段关机 ============
function gracefulKill() {
  if (killed) return;
  killed = true;

  clearInterval(heartbeatChecker);

  // 第一阶段：发送 SIGTERM，让进程有机会清理
  console.error('[关机] 发送 SIGTERM...');
  child.kill('SIGTERM');

  // 第二阶段：等待 N 秒后强制 SIGKILL
  killTimer = setTimeout(() => {
    if (!child.killed) {
      console.error('[关机] 进程未响应，强制 SIGKILL');
      child.kill('SIGKILL');
    }
  }, GRACEFUL_KILL_DELAY_MS);
}

// 取消 SIGKILL 定时器（子进程已正常退出）
function cancelGracefulKill() {
  if (killTimer) {
    clearTimeout(killTimer);
    killTimer = null;
  }
}

// ============ 进程信号处理 ============
function handleExit(signal) {
  if (!killed) {
    console.error(`\n收到 ${signal} 信号，正在终止子进程...`);
    gracefulKill();
  }
}

process.on('SIGTERM', () => handleExit('SIGTERM'));
process.on('SIGINT', () => handleExit('SIGINT'));

// ============ 流式解析 ============
const rl = readline.createInterface({
  input: child.stdout,
  crlfDelay: Infinity
});

// 逐行解析 JSON 输出
rl.on('line', (line) => {
  if (!line.trim()) return; // 跳过空行

  // 安全检查：防止超大行
  if (line.length > MAX_LINE_LENGTH) {
    console.error('\n[警告] 检测到超大行数据，可能存在问题');
    return;
  }

  try {
    const event = JSON.parse(line);

    // 提取 assistant 消息中的文本
    if (event.type === 'assistant' && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'text') {
          process.stdout.write(block.text); // 直接输出，不换行
        }
      }
    }
  } catch (e) {
    // JSON 解析失败，忽略该行
  }
});

// ============ 错误处理 ============
let stderrData = '';

// 收集 stderr 用于调试
child.stderr.on('data', (data) => {
  stderrData += data;
});

// 处理进程退出
child.on('close', (code) => {
  clearInterval(heartbeatChecker);
  cancelGracefulKill();  // 子进程已退出，取消 SIGKILL 定时器

  // 非正常退出时输出 stderr 信息
  if (code !== 0 && stderrData) {
    console.error('\n[Claude CLI 错误]', stderrData.trim());
  }

  process.stdout.write('\n'); // 确保最后换行
  process.exit(code || 0);
});

// 处理子进程错误（如 claude 命令不存在）
child.on('error', (err) => {
  clearInterval(heartbeatChecker);
  cancelGracefulKill();
  console.error('无法启动 Claude CLI:', err.message);
  process.exit(1);
});
