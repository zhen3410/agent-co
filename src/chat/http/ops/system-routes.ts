import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { AppError } from '../../../shared/errors/app-error';
import { APP_ERROR_CODES } from '../../../shared/errors/app-error-codes';
import { sendHttpError } from '../../../shared/http/errors';
import { sendJson } from '../../../shared/http/json';

function listDirectories(targetPath: string): Array<{ name: string; path: string }> {
  const normalizedPath = path.resolve(targetPath || '/');
  if (!path.isAbsolute(normalizedPath)) {
    throw new AppError('path 必须是绝对路径', {
      code: APP_ERROR_CODES.VALIDATION_FAILED
    });
  }
  if (!fs.existsSync(normalizedPath) || !fs.statSync(normalizedPath).isDirectory()) {
    throw new AppError('目录不存在', {
      code: APP_ERROR_CODES.VALIDATION_FAILED
    });
  }
  return fs.readdirSync(normalizedPath, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({
      name: entry.name,
      path: path.posix.join(normalizedPath, entry.name).replace(/\\/g, '/')
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, 200);
}

function collectWorkdirOptions(): string[] {
  const options = new Set<string>();
  for (const item of listDirectories('/')) {
    options.add(item.path);
  }
  for (const p of ['/workspace', '/root', '/tmp']) {
    try {
      if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) continue;
      options.add(p);
      for (const child of listDirectories(p)) {
        options.add(child.path);
      }
    } catch {
      // ignore
    }
  }
  return Array.from(options).sort((a, b) => a.localeCompare(b, 'zh-CN')).slice(0, 300);
}

export async function handleSystemRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requestUrl: URL
): Promise<boolean> {
  const method = req.method || 'GET';

  if (requestUrl.pathname === '/api/system/dirs' && method === 'GET') {
    try {
      const targetPath = requestUrl.searchParams.get('path') || '/';
      sendJson(res, 200, { directories: listDirectories(targetPath) });
    } catch (error) {
      sendHttpError(res, error, { fallbackStatus: 400 });
    }
    return true;
  }

  if (requestUrl.pathname === '/api/workdirs/options' && method === 'GET') {
    try {
      sendJson(res, 200, { options: collectWorkdirOptions() });
    } catch (error) {
      sendHttpError(res, error);
    }
    return true;
  }

  return false;
}
