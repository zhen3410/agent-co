import * as crypto from 'crypto';
import { checkRateLimit } from '../../rate-limiter';
import { AppError } from '../../shared/errors/app-error';
import { APP_ERROR_CODES, AppErrorCode } from '../../shared/errors/app-error-codes';
import { AuthAdminClient } from '../infrastructure/auth-admin-client';
import { ChatRuntime } from '../runtime/chat-runtime';

interface AuthSession {
  username: string;
  expiresAt: number;
}

export class AuthServiceError extends AppError {
  constructor(
    message: string,
    code: AppErrorCode,
    statusCode?: number,
    public readonly retryAfterSeconds?: number
  ) {
    super(message, {
      code,
      statusCode
    });
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

export interface AuthRequestContext {
  cookies: Record<string, string>;
  clientIp: string;
}

export interface AuthService {
  login(context: AuthRequestContext, username: string, password: string): Promise<LoginResult>;
  logout(context: AuthRequestContext): LogoutResult;
  getAuthStatus(context: AuthRequestContext): AuthStatusResult;
  ensureVisitorIdentity(context: AuthRequestContext): VisitorIdentityResult;
  isAuthenticated(context: AuthRequestContext): boolean;
  requiresAuthentication(pathname: string): boolean;
  getUserKey(context: AuthRequestContext): string;
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

  function getChatVisitorId(context: AuthRequestContext): string | null {
    const visitorId = context.cookies[config.visitorCookieName];
    if (!visitorId) return null;
    if (!/^[a-f0-9]{32}$/i.test(visitorId)) return null;
    return visitorId.toLowerCase();
  }

  function ensureVisitorIdentity(context: AuthRequestContext): VisitorIdentityResult {
    const existing = getChatVisitorId(context);
    if (existing) {
      return { visitorId: existing, setCookies: [] };
    }

    const visitorId = issueVisitorId();
    return {
      visitorId,
      setCookies: [buildVisitorCookie(visitorId)]
    };
  }

  function isAuthenticated(context: AuthRequestContext): boolean {
    if (!config.authEnabled) return true;

    const token = context.cookies[config.sessionCookieName];
    if (!token) return false;

    const session = authSessions.get(token);
    if (!session) return false;

    if (Date.now() > session.expiresAt) {
      authSessions.delete(token);
      return false;
    }

    return true;
  }

  function getUserKey(context: AuthRequestContext): string {
    const visitorId = getChatVisitorId(context);
    const token = context.cookies[config.sessionCookieName];
    if (token) {
      const session = authSessions.get(token);
      if (session && Date.now() <= session.expiresAt) {
        return buildUserKey(session.username);
      }
    }
    if (visitorId) {
      return `visitor:${visitorId}`;
    }
    return `ip:${context.clientIp}`;
  }

  function requiresAuthentication(pathname: string): boolean {
    if (!config.authEnabled) return false;
    return pathname.startsWith('/api/') && !publicPaths.has(pathname);
  }

  async function login(context: AuthRequestContext, usernameValue: string, password: string): Promise<LoginResult> {
    if (!config.authEnabled) {
      return {
        success: true,
        authEnabled: false,
        setCookies: []
      };
    }

    const clientIP = context.clientIp;
    const loginLimit = checkRateLimit(`login:${clientIP}`, config.loginRateLimitMax);
    if (!loginLimit.allowed) {
      throw new AuthServiceError(
        '登录尝试过于频繁，请稍后再试',
        APP_ERROR_CODES.RATE_LIMITED,
        429,
        Math.ceil((loginLimit.resetAt - Date.now()) / 1000)
      );
    }

    const username = (usernameValue || '').trim().toLowerCase();
    if (!username || !password) {
      throw new AuthServiceError('缺少用户名或密码', APP_ERROR_CODES.VALIDATION_FAILED);
    }

    const verifyResult = await authAdminClient.verifyCredentials(username, password);
    if (!verifyResult.success) {
      throw new AuthServiceError(verifyResult.error || '用户名或密码错误', APP_ERROR_CODES.UNAUTHORIZED);
    }

    const existingToken = context.cookies[config.sessionCookieName];
    const visitorIdentity = ensureVisitorIdentity(context);
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

  function logout(context: AuthRequestContext): LogoutResult {
    const token = context.cookies[config.sessionCookieName];
    const visitorIdentity = ensureVisitorIdentity(context);
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

  function getAuthStatus(context: AuthRequestContext): AuthStatusResult {
    const visitorIdentity = ensureVisitorIdentity(context);
    return {
      authEnabled: config.authEnabled,
      authenticated: isAuthenticated(context),
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
    getUserKey
  };
}
