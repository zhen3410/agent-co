import * as http from 'http';
import { parseBody } from '../../shared/http/body';
import { sendHttpError } from '../../shared/http/errors';
import { sendJson } from '../../shared/http/json';
import { AuthService, AuthServiceError } from '../application/auth-service';
import { createAuthRequestContext } from './request-context';
import { applySetCookies, normalizeAuthLoginBody } from './auth-route-helpers';

export interface AuthRoutesDependencies {
  authService: AuthService;
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
      const authContext = createAuthRequestContext(req);
      const { username, password } = normalizeAuthLoginBody(body);
      const result = await deps.authService.login(authContext, username, password);
      applySetCookies(res, result.setCookies);
      sendJson(res, 200, { success: true, authEnabled: result.authEnabled });
    } catch (error) {
      sendHttpError(res, error, {
        invalidJsonStatus: 500,
        fallbackStatus: 500,
        mapBody: (message, currentError) => {
          if (currentError instanceof AuthServiceError && currentError.retryAfterSeconds !== undefined) {
            return { error: message, retryAfter: currentError.retryAfterSeconds };
          }

          return { error: message };
        }
      });
    }
    return true;
  }

  if (url === '/api/logout' && method === 'POST') {
    const result = deps.authService.logout(createAuthRequestContext(req));
    applySetCookies(res, result.setCookies);
    sendJson(res, 200, { success: true });
    return true;
  }

  if (url === '/api/auth-status' && method === 'GET') {
    const result = deps.authService.getAuthStatus(createAuthRequestContext(req));
    applySetCookies(res, result.setCookies);
    sendJson(res, 200, {
      authEnabled: result.authEnabled,
      authenticated: result.authenticated
    });
    return true;
  }

  return false;
}
