import * as http from 'http';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function applySetCookies(res: http.ServerResponse, cookies: string[]): void {
  if (cookies.length === 0) {
    return;
  }

  const existing = res.getHeader('Set-Cookie');
  const current = existing ? (Array.isArray(existing) ? existing.map(String) : [String(existing)]) : [];
  res.setHeader('Set-Cookie', [...current, ...cookies]);
}

export function normalizeAuthLoginBody(body: {
  username?: unknown;
  password?: unknown;
}): { username: string; password: string } {
  return {
    username: asString(body.username),
    password: asString(body.password)
  };
}
