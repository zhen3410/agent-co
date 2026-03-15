/**
 * server.ts
 *
 * 多 AI 智能体聊天室服务器
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Message, AIAgentConfig, ChatRequest, RichBlock, SessionState } from './types';
import { AgentManager } from './agent-manager';
import { loadAgentStore, saveAgentStore, applyPendingAgents } from './agent-config-store';
import { callClaudeCLI, generateMockReply, ClaudeResult } from './claude-cli';
import { extractRichBlocks } from './rich-extract';
import { addBlock, consumeBlocks, getStatus as getBlockBufferStatus } from './block-buffer';
import { checkRateLimit, getClientIP } from './rate-limiter';

// ============================================
// 配置
// ============================================
const PORT = Number(process.env.PORT || 3002);
const DEFAULT_SESSION_ID = 'default';
const DEFAULT_USER_NAME = '用户';
const AUTH_ENABLED = process.env.BOT_ROOM_AUTH_ENABLED !== 'false';
const AUTH_ADMIN_BASE_URL = process.env.AUTH_ADMIN_BASE_URL || 'http://127.0.0.1:3003';
const SESSION_COOKIE_NAME = 'bot_room_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 天
const AGENT_DATA_FILE = process.env.AGENT_DATA_FILE || path.join(process.cwd(), 'data', 'agents.json');
const VERBOSE_LOG_DIR = process.env.BOT_ROOM_VERBOSE_LOG_DIR || path.join(process.cwd(), 'logs', 'claude-verbose');

// 速率限制配置
const RATE_LIMIT_MAX_REQUESTS = 100; // 每分钟最多 100 次请求
const LOGIN_RATE_LIMIT_MAX = 5; // 每分钟最多 5 次登录尝试

// ============================================
// 修复 4: 用户隔离的聊天历史
// ============================================
// 改为按用户/会话存储
const userHistories = new Map<string, Message[]>();
const userAgentStates = new Map<string, string | null>();

function getUserHistory(sessionId: string): Message[] {
  if (!userHistories.has(sessionId)) {
    userHistories.set(sessionId, []);
  }
  return userHistories.get(sessionId)!;
}

function getUserCurrentAgent(sessionId: string): string | null {
  return userAgentStates.get(sessionId) || null;
}

function setUserCurrentAgent(sessionId: string, agentName: string | null): void {
  userAgentStates.set(sessionId, agentName);
}

// 别名，供 handleSwitchAgent 使用
const setUserCurrentAgentAlias = setUserCurrentAgent;

function clearUserHistory(sessionId: string): void {
  userHistories.set(sessionId, []);
  userAgentStates.set(sessionId, null);
}

// 从请求中获取会话 ID
function getSessionIdFromRequest(req: http.IncomingMessage): string {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  if (token && authSessions.has(token)) {
    return `session:${token}`;
  }
  // 未登录用户使用 IP 作为会话标识
  return `ip:${getClientIP(req)}`;
}

// 保留旧的全局变量以兼容（但不再使用）
let chatHistory: Message[] = [];

// 会话状态管理（记住当前对话的智能体）
const sessionStates = new Map<string, SessionState>();
const authSessions = new Map<string, number>();

// AI 智能体管理器（由共享配置文件驱动）
let agentStore = loadAgentStore(AGENT_DATA_FILE);
let agentStoreMtimeMs = fs.existsSync(AGENT_DATA_FILE) ? fs.statSync(AGENT_DATA_FILE).mtimeMs : 0;
const agentManager = new AgentManager(agentStore.activeAgents);

// ============================================
// 修复 1: 生产环境安全检查
// ============================================
function performSecurityChecks(): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const warnings: string[] = [];

  // 检查 ADMIN_TOKEN
  const adminToken = process.env.AUTH_ADMIN_TOKEN;
  if (isProduction) {
    if (!adminToken) {
      console.error('❌ 生产环境必须设置 AUTH_ADMIN_TOKEN 环境变量');
      process.exit(1);
    }
    if (adminToken.length < 32) {
      console.error('❌ AUTH_ADMIN_TOKEN 长度不能少于 32 字符');
      process.exit(1);
    }
    if (adminToken === 'change-me-in-production') {
      console.error('❌ AUTH_ADMIN_TOKEN 不能使用默认值');
      process.exit(1);
    }
  } else {
    if (!adminToken || adminToken === 'change-me-in-production') {
      warnings.push('⚠️ AUTH_ADMIN_TOKEN 未设置或使用默认值（仅开发环境允许）');
    }
  }

  // 检查默认密码
  const defaultPassword = process.env.BOT_ROOM_DEFAULT_PASSWORD;
  if (isProduction && defaultPassword) {
    // 简单检查密码强度
    if (defaultPassword.length < 12) {
      console.error('❌ 生产环境 BOT_ROOM_DEFAULT_PASSWORD 长度不能少于 12 字符');
      process.exit(1);
    }
    const hasLower = /[a-z]/.test(defaultPassword);
    const hasUpper = /[A-Z]/.test(defaultPassword);
    const hasNumber = /[0-9]/.test(defaultPassword);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(defaultPassword);
    if (!(hasLower && hasUpper && hasNumber && hasSpecial)) {
      console.error('❌ 生产环境 BOT_ROOM_DEFAULT_PASSWORD 必须包含大小写字母、数字和特殊字符');
      process.exit(1);
    }
  }

  // 输出警告
  if (warnings.length > 0) {
    console.log('\n' + '='.repeat(60));
    console.log('🔒 安全检查警告');
    console.log('='.repeat(60));
    warnings.forEach(w => console.log(w));
    console.log('='.repeat(60) + '\n');
  }
}

// 启动时执行安全检查
performSecurityChecks();

function isChatSessionActive(): boolean {
  // 检查是否有任何活跃的用户会话
  for (const [sessionId, history] of Array.from(userHistories.entries())) {
    if (history.length > 0 || userAgentStates.get(sessionId)) {
      return true;
    }
  }
  return false;
}

function syncAgentsFromStore(): void {
  try {
    const mtime = fs.existsSync(AGENT_DATA_FILE) ? fs.statSync(AGENT_DATA_FILE).mtimeMs : 0;
    if (mtime <= agentStoreMtimeMs && !agentStore.pendingAgents) {
      return;
    }

    agentStore = loadAgentStore(AGENT_DATA_FILE);
    agentStoreMtimeMs = mtime;

    if (agentStore.pendingAgents && !isChatSessionActive()) {
      agentStore = applyPendingAgents(agentStore);
      saveAgentStore(AGENT_DATA_FILE, agentStore);
      agentStoreMtimeMs = fs.existsSync(AGENT_DATA_FILE) ? fs.statSync(AGENT_DATA_FILE).mtimeMs : Date.now();
      console.log('[AgentStore] 已应用等待生效的智能体配置');
    }

    agentManager.replaceAgents(agentStore.activeAgents);
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[AgentStore] 同步失败:', err.message);
  }
}

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

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};

  const entries = header.split(';').map(part => part.trim().split('='));
  const cookieMap: Record<string, string> = {};
  entries.forEach(([key, value]) => {
    if (key && value) cookieMap[key] = decodeURIComponent(value);
  });
  return cookieMap;
}

function issueSessionToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

function isAuthenticated(req: http.IncomingMessage): boolean {
  if (!AUTH_ENABLED) return true;

  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return false;

  const expiresAt = authSessions.get(token);
  if (!expiresAt) return false;

  if (Date.now() > expiresAt) {
    authSessions.delete(token);
    return false;
  }

  return true;
}

function setSessionCookie(res: http.ServerResponse, token: string): void {
  // 注意: Secure 标志只在 HTTPS 下有效，如果通过 HTTP 访问会导致 cookie 无法发送
  // 这里不设置 Secure，让反向代理(如 nginx)处理 HTTPS
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    'HttpOnly',
    'SameSite=Lax'
  ].join('; ');

  res.setHeader('Set-Cookie', attrs);
}

function clearSessionCookie(res: http.ServerResponse): void {
  const attrs = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax'
  ].join('; ');

  res.setHeader('Set-Cookie', attrs);
}

async function handleLogin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!AUTH_ENABLED) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, authEnabled: false }));
    return;
  }

  // 修复 2: 登录速率限制
  const clientIP = getClientIP(req);
  const loginLimit = checkRateLimit(`login:${clientIP}`, LOGIN_RATE_LIMIT_MAX);
  if (!loginLimit.allowed) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: '登录尝试过于频繁，请稍后再试',
      retryAfter: Math.ceil((loginLimit.resetAt - Date.now()) / 1000)
    }));
    return;
  }

  try {
    const body = await parseBody<{ username?: string; password?: string }>(req);
    const username = (body.username || '').trim().toLowerCase();

    if (!username || !body.password) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少用户名或密码' }));
      return;
    }

    const verifyResult = await verifyCredentials(username, body.password);
    if (!verifyResult.success) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: verifyResult.error || '用户名或密码错误' }));
      return;
    }

    const token = issueSessionToken();
    authSessions.set(token, Date.now() + SESSION_TTL_MS);
    setSessionCookie(res, token);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, authEnabled: true }));
  } catch (error: unknown) {
    const err = error as Error;
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

function handleLogout(req: http.IncomingMessage, res: http.ServerResponse): void {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  if (token) authSessions.delete(token);
  clearSessionCookie(res);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true }));
}

function handleAuthStatus(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    authEnabled: AUTH_ENABLED,
    authenticated: isAuthenticated(req)
  }));
}

function verifyCredentials(username: string, password: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    const targetUrl = new URL('/api/auth/verify', AUTH_ADMIN_BASE_URL);
    const payload = JSON.stringify({ username, password });

    const request = http.request({
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: targetUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 3000
    }, response => {
      let responseBody = '';
      response.on('data', chunk => (responseBody += chunk));
      response.on('end', () => {
        try {
          const data = responseBody ? JSON.parse(responseBody) as { success?: boolean; error?: string } : {};
          if (response.statusCode === 200 && data.success) {
            resolve({ success: true });
            return;
          }

          resolve({ success: false, error: data.error || '鉴权失败' });
        } catch {
          resolve({ success: false, error: '鉴权服务返回格式错误' });
        }
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error('鉴权服务超时'));
    });

    request.on('error', err => {
      reject(new Error(`鉴权服务不可用: ${err.message}`));
    });

    request.write(payload);
    request.end();
  });
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
  syncAgentsFromStore();
  const agents = agentManager.getAgentConfigs();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ agents }));
}

/**
 * 处理发送消息
 */
async function handleSendMessage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // 修复 2: 全局速率限制
  const clientIP = getClientIP(req);
  const rateLimit = checkRateLimit(clientIP, RATE_LIMIT_MAX_REQUESTS);
  if (!rateLimit.allowed) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: '请求过于频繁，请稍后再试',
      retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000)
    }));
    return;
  }

  try {
    syncAgentsFromStore();
    const body = await parseBody<ChatRequest & { message: string; sender?: string }>(req);
    const { message, sender: bodySender } = body;
    const sender = bodySender || DEFAULT_USER_NAME;
    if (!message) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少 message 字段' }));
      return;
    }

    // 修复 4: 使用用户隔离的会话
    const sessionId = getSessionIdFromRequest(req);
    const userHistory = getUserHistory(sessionId);
    const currentAgent = getUserCurrentAgent(sessionId);

    console.log(`\n[Chat] 会话 ${sessionId.substring(0, 12)}... 用户 ${sender}: ${message}`);

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
      setUserCurrentAgent(sessionId, mentions[0]);
      console.log(`[Chat] 设置当前对话智能体: ${mentions[0]}`);
    } else if (currentAgent) {
      // 没有新的 @ 提及，但有之前的对话智能体
      agentsToRespond.push(currentAgent);
      console.log(`[Chat] 继续与 ${currentAgent} 对话`);
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

    // 添加到用户历史
    userHistory.push(userMessage);

    // 返回的 AI 消息列表
    const aiMessages: Message[] = [];

    // 调用对应的 AI 智能体
    for (const agentName of agentsToRespond) {
      const agent = agentManager.getAgent(agentName);
      if (!agent) continue;

      console.log(`[Chat] 调用 AI: ${agentName}`);

      let aiResponse: ClaudeResult;
      try {
        // 使用用户隔离的历史
        aiResponse = await callClaudeCLI(message, agent, userHistory);
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

      userHistory.push(aiMessage);
      aiMessages.push(aiMessage);

      console.log(`[Chat] ${agentName} 回复完成`);
    }

    // 返回响应
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      userMessage,
      aiMessages,
      currentAgent: getUserCurrentAgent(sessionId)
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
  syncAgentsFromStore();
  // 修复 4: 使用用户隔离的历史
  const sessionId = getSessionIdFromRequest(req);
  const userHistory = getUserHistory(sessionId);
  const currentAgent = getUserCurrentAgent(sessionId);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    messages: userHistory,
    agents: agentManager.getAgentConfigs(),
    currentAgent: currentAgent
  }));
}

/**
 * 处理清空历史
 */
function handleClearHistory(req: http.IncomingMessage, res: http.ServerResponse): void {
  // 修复 4: 清空用户自己的历史
  const sessionId = getSessionIdFromRequest(req);
  clearUserHistory(sessionId);
  syncAgentsFromStore();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true }));
}

/**
 * 处理切换智能体
 */
function handleSwitchAgent(req: http.IncomingMessage, res: http.ServerResponse): void {
  parseBody<{ agent?: string }>(req).then(body => {
    // 修复 4: 使用用户隔离的状态
    const sessionId = getSessionIdFromRequest(req);
    const agentName = body.agent;
    if (agentName && agentManager.hasAgent(agentName)) {
      setUserCurrentAgent(sessionId, agentName);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, currentAgent: agentName }));
    } else if (!agentName) {
      // 清除当前智能体
      setUserCurrentAgent(sessionId, null);
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


interface VerboseLogMeta {
  fileName: string;
  agent: string;
  updatedAt: number;
  size: number;
}

function listVerboseLogs(): VerboseLogMeta[] {
  if (!fs.existsSync(VERBOSE_LOG_DIR)) {
    return [];
  }

  const entries = fs.readdirSync(VERBOSE_LOG_DIR, { withFileTypes: true });
  const logs: VerboseLogMeta[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.log')) {
      continue;
    }

    const match = entry.name.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-(.+)\.log$/);
    const agent = match ? match[2] : 'unknown';
    const fullPath = path.join(VERBOSE_LOG_DIR, entry.name);
    const stat = fs.statSync(fullPath);

    logs.push({
      fileName: entry.name,
      agent,
      updatedAt: stat.mtimeMs,
      size: stat.size
    });
  }

  return logs.sort((a, b) => b.updatedAt - a.updatedAt);
}

function handleGetVerboseAgents(req: http.IncomingMessage, res: http.ServerResponse): void {
  const logs = listVerboseLogs();
  const summary = new Map<string, { agent: string; logCount: number; latestFile: string; latestUpdatedAt: number }>();

  for (const log of logs) {
    const existing = summary.get(log.agent);
    if (!existing) {
      summary.set(log.agent, {
        agent: log.agent,
        logCount: 1,
        latestFile: log.fileName,
        latestUpdatedAt: log.updatedAt
      });
      continue;
    }

    existing.logCount += 1;
  }

  const agents = Array.from(summary.values()).sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    logDir: VERBOSE_LOG_DIR,
    agents
  }));
}

function handleGetVerboseLogs(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  const agent = (url.searchParams.get('agent') || '').trim();
  if (!agent) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '缺少 agent 参数' }));
    return;
  }

  const logs = listVerboseLogs().filter(item => item.agent === agent);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ agent, logs }));
}

function handleGetVerboseLogContent(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  const fileName = (url.searchParams.get('file') || '').trim();
  if (!fileName) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '缺少 file 参数' }));
    return;
  }

  if (fileName.includes('/') || fileName.includes('\\') || !fileName.endsWith('.log')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '非法 file 参数' }));
    return;
  }

  const fullPath = path.join(VERBOSE_LOG_DIR, fileName);
  if (!fs.existsSync(fullPath)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '日志文件不存在' }));
    return;
  }

  const content = fs.readFileSync(fullPath, 'utf8');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ fileName, content }));
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
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (url === '/api/login' && method === 'POST') {
    await handleLogin(req, res);
    return;
  }

  if (url === '/api/logout' && method === 'POST') {
    handleLogout(req, res);
    return;
  }

  if (url === '/api/auth-status' && method === 'GET') {
    handleAuthStatus(req, res);
    return;
  }

  const requestUrl = new URL(url, `http://${req.headers.host || '127.0.0.1'}`);

  const publicPaths = new Set([
    '/',
    '/index.html',
    '/styles.css',
    '/manifest.json',
    '/service-worker.js',
    '/icon.svg',
    '/verbose-logs.html'
  ]);

  if (AUTH_ENABLED && !publicPaths.has(requestUrl.pathname) && !isAuthenticated(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '未授权，请先登录' }));
    return;
  }

  // 路由
  if (requestUrl.pathname === '/api/agents' && method === 'GET') {
    handleGetAgents(req, res);
  } else if (requestUrl.pathname === '/api/chat' && method === 'POST') {
    await handleSendMessage(req, res);
  } else if (requestUrl.pathname === '/api/history' && method === 'GET') {
    handleGetHistory(req, res);
  } else if (requestUrl.pathname === '/api/clear' && method === 'POST') {
    handleClearHistory(req, res);
  } else if (requestUrl.pathname === '/api/create-block' && method === 'POST') {
    await handleCreateBlock(req, res);
  } else if (requestUrl.pathname === '/api/block-status' && method === 'GET') {
    handleGetBlockStatus(req, res);
  } else if (requestUrl.pathname === '/api/verbose/agents' && method === 'GET') {
    handleGetVerboseAgents(req, res);
  } else if (requestUrl.pathname === '/api/verbose/logs' && method === 'GET') {
    handleGetVerboseLogs(req, res, requestUrl);
  } else if (requestUrl.pathname === '/api/verbose/log-content' && method === 'GET') {
    handleGetVerboseLogContent(req, res, requestUrl);
  } else if (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html') {
    serveStatic(req, res, 'index.html', 'text/html');
  } else if (requestUrl.pathname === '/styles.css') {
    serveStatic(req, res, 'styles.css', 'text/css');
  } else if (requestUrl.pathname === '/manifest.json') {
    serveStatic(req, res, 'manifest.json', 'application/manifest+json');
  } else if (requestUrl.pathname === '/service-worker.js') {
    serveStatic(req, res, 'service-worker.js', 'application/javascript');
  } else if (requestUrl.pathname === '/icon.svg') {
    serveStatic(req, res, 'icon.svg', 'image/svg+xml');
  } else if (requestUrl.pathname === '/verbose-logs.html') {
    serveStatic(req, res, 'verbose-logs.html', 'text/html');
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
  console.log(`📁 智能体配置: ${AGENT_DATA_FILE}`);
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
  console.log('  POST /api/login      - 登录鉴权');
  console.log('  POST /api/logout     - 登出');
  console.log('  GET  /api/auth-status - 鉴权状态');
  console.log('  POST /api/create-block - Route A: 创建 block');
  console.log('  GET  /api/block-status - 查看 BlockBuffer 状态');
  console.log('  GET  /api/verbose/agents - 查看 verbose 日志智能体列表');
  console.log('  GET  /api/verbose/logs?agent=xxx - 查看智能体日志文件列表');
  console.log('  GET  /api/verbose/log-content?file=xxx.log - 查看日志文件内容');
  console.log('');
  console.log('使用方式:');
  console.log('  - 输入 @Claude 可以召唤 Claude');
  console.log('  - 输入 @Alice 可以召唤 Alice');
  console.log('  - 输入 @Bob 可以召唤 Bob');
  console.log('');
  console.log('💡 提示: 如果 Claude CLI 不可用,会自动使用模拟回复');
  if (AUTH_ENABLED) {
    console.log(`🔐 鉴权已启用: 依赖独立鉴权服务 ${AUTH_ADMIN_BASE_URL}`);
  } else {
    console.log('🔓 鉴权未启用: 设置 BOT_ROOM_AUTH_ENABLED=false');
  }
  console.log('='.repeat(60));
});
