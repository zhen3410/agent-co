import * as http from 'http';
import { parseBody } from '../../shared/http/body';
import { sendHttpError } from '../../shared/http/errors';
import { sendJson } from '../../shared/http/json';
import { AuthService, AuthServiceError } from '../application/auth-service';

export interface AuthRoutesDependencies {
  authService: AuthService;
}

function applySetCookies(res: http.ServerResponse, cookies: string[]): void {
  if (cookies.length === 0) {
    return;
  }

  const existing = res.getHeader('Set-Cookie');
  const current = existing ? (Array.isArray(existing) ? existing.map(String) : [String(existing)]) : [];
  res.setHeader('Set-Cookie', [...current, ...cookies]);
}

export async function handleAuthRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: AuthRoutesDependencies
): Promise<boolean> {
  const url = req.url || '/';
  const method = req.method || 'GET';

  if (url === '/api/login' && method === 'POST') {
    try {
      const body = await parseBody<{ username?: string; password?: string }>(req);
      const result = await deps.authService.login(req, body.username || '', body.password || '');
      applySetCookies(res, result.setCookies);
      sendJson(res, 200, { success: true, authEnabled: result.authEnabled });
    } catch (error) {
      if (error instanceof AuthServiceError) {
        sendJson(res, error.statusCode, error.retryAfterSeconds
          ? { error: error.message, retryAfter: error.retryAfterSeconds }
          : { error: error.message });
      } else {
        sendHttpError(res, error, {
          invalidJsonStatus: 500,
          fallbackStatus: 500
        });
      }
    }
    return true;
  }

  if (url === '/api/logout' && method === 'POST') {
    const result = deps.authService.logout(req);
    applySetCookies(res, result.setCookies);
    sendJson(res, 200, { success: true });
    return true;
  }

  if (url === '/api/auth-status' && method === 'GET') {
    const result = deps.authService.getAuthStatus(req);
    applySetCookies(res, result.setCookies);
    sendJson(res, 200, {
      authEnabled: result.authEnabled,
      authenticated: result.authenticated
    });
    return true;
  }

  return false;
}
