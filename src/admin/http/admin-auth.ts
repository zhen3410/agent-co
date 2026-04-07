import * as http from 'http';
import { sendJson } from '../../shared/http/json';
import { normalizeAdminToken } from '../runtime/auth-admin-runtime';

export function requireAdmin(req: http.IncomingMessage, res: http.ServerResponse, adminToken: string): boolean {
  const token = req.headers['x-admin-token'];
  const normalizedToken = typeof token === 'string' ? normalizeAdminToken(token) : '';
  if (!normalizedToken || normalizedToken !== adminToken) {
    sendJson(res, 401, { error: '未授权的管理请求' });
    return false;
  }
  return true;
}
