import * as http from 'http';
import { getClientIP } from '../../rate-limiter';
import { AuthRequestContext } from '../application/auth-service';

export function parseCookies(cookieHeader: string | string[] | undefined): Record<string, string> {
  const headerValue = Array.isArray(cookieHeader) ? cookieHeader.join(';') : cookieHeader;
  if (!headerValue) {
    return {};
  }

  const entries = headerValue.split(';').map(part => part.trim().split('='));
  const cookieMap: Record<string, string> = {};
  entries.forEach(([key, value]) => {
    if (key && value) {
      cookieMap[key] = decodeURIComponent(value);
    }
  });
  return cookieMap;
}

export function createAuthRequestContext(req: http.IncomingMessage): AuthRequestContext {
  return {
    cookies: parseCookies(req.headers.cookie),
    clientIp: getClientIP(req)
  };
}
