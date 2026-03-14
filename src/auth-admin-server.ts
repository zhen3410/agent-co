/**
 * auth-admin-server.ts
 *
 * 独立鉴权管理服务：负责用户密码管理与认证校验
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { URL } from 'url';

// 引入 fs 模块的 promise 版本用于异步操作

type UserRecord = {
  username: string;
  passwordHash: string;
  salt: string;
  createdAt: number;
  updatedAt: number;
};

type UserStore = {
  users: UserRecord[];
};

const PORT = Number(process.env.AUTH_ADMIN_PORT || 3003);
const ADMIN_TOKEN = process.env.AUTH_ADMIN_TOKEN || 'change-me-in-production';
const DATA_FILE = process.env.AUTH_DATA_FILE || path.join(process.cwd(), 'data', 'users.json');
const DEFAULT_USER = process.env.BOT_ROOM_DEFAULT_USER || 'admin';
const DEFAULT_PASSWORD = process.env.BOT_ROOM_DEFAULT_PASSWORD || 'admin123!';

function parseBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
}

function createUser(username: string, password: string): UserRecord {
  const salt = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  return {
    username,
    salt,
    passwordHash: hashPassword(password, salt),
    createdAt: now,
    updatedAt: now
  };
}

function ensureDataDirExists(filePath: string): void {
  const dirPath = path.dirname(filePath);
  fs.mkdirSync(dirPath, { recursive: true });
}

function loadStore(): UserStore {
  ensureDataDirExists(DATA_FILE);

  if (!fs.existsSync(DATA_FILE)) {
    const initial: UserStore = { users: [createUser(DEFAULT_USER, DEFAULT_PASSWORD)] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    console.log(`[AuthAdmin] 初始化用户完成，默认账号: ${DEFAULT_USER}`);
    return initial;
  }

  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  const parsed = raw ? JSON.parse(raw) as UserStore : { users: [] };

  if (!Array.isArray(parsed.users)) {
    throw new Error('Invalid users.json structure');
  }

  return parsed;
}

function saveStore(store: UserStore): void {
  ensureDataDirExists(DATA_FILE);
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function requireAdmin(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const token = req.headers['x-admin-token'];
  if (typeof token !== 'string' || token !== ADMIN_TOKEN) {
    sendJson(res, 401, { error: '未授权的管理请求' });
    return false;
  }
  return true;
}

function sanitizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function validateCredInput(username: string, password: string): string | null {
  if (!username || username.length < 3 || username.length > 32) {
    return '用户名长度需在 3-32 字符之间';
  }

  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return '用户名仅支持字母、数字、_.-';
  }

  if (!password || password.length < 8) {
    return '密码长度不能少于 8 位';
  }

  return null;
}

function serveStatic(res: http.ServerResponse, filePath: string, contentType: string): void {
  const fullPath = path.join(__dirname, '..', 'public-auth', filePath);

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: 'Not Found' });
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || `localhost:${PORT}`}`);
  const pathname = parsedUrl.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');

  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Serve admin page
  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    serveStatic(res, 'admin.html', 'text/html; charset=utf-8');
    return;
  }

  if (method === 'GET' && pathname === '/healthz') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'POST' && pathname === '/api/auth/verify') {
    try {
      const body = await parseBody<{ username?: string; password?: string }>(req);
      const username = sanitizeUsername(body.username || '');
      const password = body.password || '';
      const store = loadStore();
      const user = store.users.find(entry => entry.username === username);

      if (!user) {
        sendJson(res, 401, { success: false, error: '用户名或密码错误' });
        return;
      }

      const hashed = hashPassword(password, user.salt);
      if (hashed !== user.passwordHash) {
        sendJson(res, 401, { success: false, error: '用户名或密码错误' });
        return;
      }

      sendJson(res, 200, { success: true, username: user.username });
    } catch (error: unknown) {
      const err = error as Error;
      sendJson(res, 400, { success: false, error: err.message });
    }
    return;
  }

  if (!pathname.startsWith('/api/users')) {
    sendJson(res, 404, { error: 'Not Found' });
    return;
  }

  if (!requireAdmin(req, res)) {
    return;
  }

  if (method === 'GET' && pathname === '/api/users') {
    const store = loadStore();
    sendJson(res, 200, {
      users: store.users.map(user => ({
        username: user.username,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }))
    });
    return;
  }

  if (method === 'POST' && pathname === '/api/users') {
    try {
      const body = await parseBody<{ username?: string; password?: string }>(req);
      const username = sanitizeUsername(body.username || '');
      const password = body.password || '';
      const validationError = validateCredInput(username, password);
      if (validationError) {
        sendJson(res, 400, { error: validationError });
        return;
      }

      const store = loadStore();
      if (store.users.some(user => user.username === username)) {
        sendJson(res, 409, { error: '用户名已存在' });
        return;
      }

      store.users.push(createUser(username, password));
      saveStore(store);
      sendJson(res, 201, { success: true, username });
    } catch (error: unknown) {
      const err = error as Error;
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  const userMatch = pathname.match(/^\/api\/users\/([a-zA-Z0-9_.-]+)$/);
  const pwdMatch = pathname.match(/^\/api\/users\/([a-zA-Z0-9_.-]+)\/password$/);

  if (method === 'PUT' && pwdMatch) {
    try {
      const username = sanitizeUsername(pwdMatch[1] || '');
      const body = await parseBody<{ password?: string }>(req);
      const password = body.password || '';

      if (password.length < 8) {
        sendJson(res, 400, { error: '密码长度不能少于 8 位' });
        return;
      }

      const store = loadStore();
      const user = store.users.find(entry => entry.username === username);
      if (!user) {
        sendJson(res, 404, { error: '用户不存在' });
        return;
      }

      user.salt = crypto.randomBytes(16).toString('hex');
      user.passwordHash = hashPassword(password, user.salt);
      user.updatedAt = Date.now();
      saveStore(store);
      sendJson(res, 200, { success: true, username });
    } catch (error: unknown) {
      const err = error as Error;
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  if (method === 'DELETE' && userMatch) {
    const username = sanitizeUsername(userMatch[1] || '');
    const store = loadStore();

    if (store.users.length <= 1) {
      sendJson(res, 400, { error: '至少保留一个用户，无法删除' });
      return;
    }

    const index = store.users.findIndex(entry => entry.username === username);
    if (index === -1) {
      sendJson(res, 404, { error: '用户不存在' });
      return;
    }

    store.users.splice(index, 1);
    saveStore(store);
    sendJson(res, 200, { success: true, username });
    return;
  }

  sendJson(res, 404, { error: 'Not Found' });
});

server.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('🔐 鉴权管理服务已启动');
  console.log(`📍 地址: http://localhost:${PORT}`);
  console.log(`📁 用户数据: ${DATA_FILE}`);
  console.log('');
  console.log('页面:');
  console.log('  GET    /                       管理页面');
  console.log('');
  console.log('API 端点:');
  console.log('  GET    /healthz');
  console.log('  POST   /api/auth/verify');
  console.log('  GET    /api/users               (x-admin-token)');
  console.log('  POST   /api/users               (x-admin-token)');
  console.log('  PUT    /api/users/:name/password (x-admin-token)');
  console.log('  DELETE /api/users/:name         (x-admin-token)');
  console.log('='.repeat(60));
});
