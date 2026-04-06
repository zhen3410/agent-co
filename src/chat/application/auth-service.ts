import * as http from 'http';
import * as crypto from 'crypto';
import { checkRateLimit, getClientIP } from '../../rate-limiter';
import { AuthAdminClient } from '../infrastructure/auth-admin-client';
import { ChatRuntime } from '../runtime/chat-runtime';

interface AuthSession {
  username: string;
  expiresAt: number;
}

export class AuthServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'AuthServiceError';
  }
}

export interface AuthServiceConfig {
  authEnabled: boolean;
  sessionCookieName: string;
  visitorCookieName: string;
  sessionTtlMs: number;
  loginRateLimitMax: number;
}

export interface VisitorIdentityResult {
  visitorId: string;
  setCookies: string[];
}

export interface LoginResult {
  success: true;
  authEnabled: boolean;
  setCookies: string[];
}

export interface LogoutResult {
  success: true;
  setCookies: string[];
}

export interface AuthStatusResult {
  authEnabled: boolean;
  authenticated: boolean;
  setCookies: string[];
}

export interface AuthService {
  login(req: http.IncomingMessage, username: string, password: string): Promise<LoginResult>;
  logout(req: http.IncomingMessage): LogoutResult;
  getAuthStatus(req: http.IncomingMessage): AuthStatusResult;
  ensureVisitorIdentity(req: http.IncomingMessage): VisitorIdentityResult;
  isAuthenticated(req: http.IncomingMessage): boolean;
  requiresAuthentication(pathname: string): boolean;
  getUserKeyFromRequest(req: http.IncomingMessage): string;
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

function buildUserKey(username: string): string {
  return `user:${username.trim().toLowerCase()}`;
}

function issueSessionToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

function issueVisitorId(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function createAuthService(
  config: AuthServiceConfig,
  authAdminClient: AuthAdminClient,
  runtime: Pick<ChatRuntime, 'migrateLegacySessionUserData'>
): AuthService {
  const authSessions = new Map<string, AuthSession>();
  const publicPaths = new Set([
    '/api/login',
    '/api/logout',
    '/api/auth-status',
    '/api/dependencies/status',
    '/api/callbacks/post-message',
    '/api/callbacks/thread-context'
  ]);

  function getSessionCookieValue(): string {
    return [
      `${config.sessionCookieName}=`,
      'Path=/',
      'Max-Age=0',
      'HttpOnly',
      'SameSite=Lax'
    ].join('; ');
  }

  function buildSessionCookie(token: string): string {
    return [
      `${config.sessionCookieName}=${encodeURIComponent(token)}`,
      'Path=/',
      `Max-Age=${Math.floor(config.sessionTtlMs / 1000)}`,
      'HttpOnly',
      'SameSite=Lax'
    ].join('; ');
  }

  function buildVisitorCookie(visitorId: string): string {
    return [
      `${config.visitorCookieName}=${encodeURIComponent(visitorId)}`,
      'Path=/',
      `Max-Age=${Math.floor(config.sessionTtlMs / 1000)}`,
      'HttpOnly',
      'SameSite=Lax'
    ].join('; ');
  }

  function getChatVisitorIdFromRequest(req: http.IncomingMessage): string | null {
    const cookies = parseCookies(req);
    const visitorId = cookies[config.visitorCookieName];
    if (!visitorId) return null;
    if (!/^[a-f0-9]{32}$/i.test(visitorId)) return null;
    return visitorId.toLowerCase();
  }

  function ensureVisitorIdentity(req: http.IncomingMessage): VisitorIdentityResult {
    const existing = getChatVisitorIdFromRequest(req);
    if (existing) {
      return { visitorId: existing, setCookies: [] };
    }

    const visitorId = issueVisitorId();
    return {
      visitorId,
      setCookies: [buildVisitorCookie(visitorId)]
    };
  }

  function isAuthenticated(req: http.IncomingMessage): boolean {
    if (!config.authEnabled) return true;

    const cookies = parseCookies(req);
    const token = cookies[config.sessionCookieName];
    if (!token) return false;

    const session = authSessions.get(token);
    if (!session) return false;

    if (Date.now() > session.expiresAt) {
      authSessions.delete(token);
      return false;
    }

    return true;
  }

  function getUserKeyFromRequest(req: http.IncomingMessage): string {
    const visitorId = getChatVisitorIdFromRequest(req);
    const cookies = parseCookies(req);
    const token = cookies[config.sessionCookieName];
    if (token) {
      const session = authSessions.get(token);
      if (session && Date.now() <= session.expiresAt) {
        return buildUserKey(session.username);
      }
    }
    if (visitorId) {
      return `visitor:${visitorId}`;
    }
    return `ip:${getClientIP(req)}`;
  }

  function requiresAuthentication(pathname: string): boolean {
    if (!config.authEnabled) return false;
    return pathname.startsWith('/api/') && !publicPaths.has(pathname);
  }

  async function login(req: http.IncomingMessage, usernameValue: string, password: string): Promise<LoginResult> {
    if (!config.authEnabled) {
      return {
        success: true,
        authEnabled: false,
        setCookies: []
      };
    }

    const clientIP = getClientIP(req);
    const loginLimit = checkRateLimit(`login:${clientIP}`, config.loginRateLimitMax);
    if (!loginLimit.allowed) {
      throw new AuthServiceError('登录尝试过于频繁，请稍后再试', 429, Math.ceil((loginLimit.resetAt - Date.now()) / 1000));
    }

    const username = (usernameValue || '').trim().toLowerCase();
    if (!username || !password) {
      throw new AuthServiceError('缺少用户名或密码', 400);
    }

    const verifyResult = await authAdminClient.verifyCredentials(username, password);
    if (!verifyResult.success) {
      throw new AuthServiceError(verifyResult.error || '用户名或密码错误', 401);
    }

    const cookies = parseCookies(req);
    const existingToken = cookies[config.sessionCookieName];
    const visitorIdentity = ensureVisitorIdentity(req);
    const token = issueSessionToken();
    authSessions.set(token, {
      username,
      expiresAt: Date.now() + config.sessionTtlMs
    });
    runtime.migrateLegacySessionUserData(`visitor:${visitorIdentity.visitorId}`, buildUserKey(username));
    if (existingToken) authSessions.delete(existingToken);

    return {
      success: true,
      authEnabled: true,
      setCookies: [...visitorIdentity.setCookies, buildSessionCookie(token)]
    };
  }

  function logout(req: http.IncomingMessage): LogoutResult {
    const cookies = parseCookies(req);
    const token = cookies[config.sessionCookieName];
    const visitorIdentity = ensureVisitorIdentity(req);
    if (token) {
      const session = authSessions.get(token);
      if (session) {
        runtime.migrateLegacySessionUserData(buildUserKey(session.username), `visitor:${visitorIdentity.visitorId}`);
      }
      authSessions.delete(token);
    }

    return {
      success: true,
      setCookies: [...visitorIdentity.setCookies, getSessionCookieValue()]
    };
  }

  function getAuthStatus(req: http.IncomingMessage): AuthStatusResult {
    const visitorIdentity = ensureVisitorIdentity(req);
    return {
      authEnabled: config.authEnabled,
      authenticated: isAuthenticated(req),
      setCookies: visitorIdentity.setCookies
    };
  }

  return {
    login,
    logout,
    getAuthStatus,
    ensureVisitorIdentity,
    isAuthenticated,
    requiresAuthentication,
    getUserKeyFromRequest
  };
}
