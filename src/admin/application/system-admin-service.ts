import * as fs from 'fs';
import * as path from 'path';

export interface SystemAdminService {
  listDirectories(targetPath: string): { path: string; directories: Array<{ name: string; path: string }> };
}

export class SystemAdminServiceError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'SystemAdminServiceError';
    this.statusCode = statusCode;
  }
}

export function createSystemAdminService(): SystemAdminService {
  return {
    listDirectories(targetPath: string) {
      const normalizedPath = path.resolve(targetPath || '/');
      if (!path.isAbsolute(normalizedPath)) {
        throw new SystemAdminServiceError(400, 'path 必须是绝对路径');
      }
      if (!fs.existsSync(normalizedPath) || !fs.statSync(normalizedPath).isDirectory()) {
        throw new SystemAdminServiceError(400, '目录不存在');
      }

      const directories = fs.readdirSync(normalizedPath, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => ({
          name: entry.name,
          path: path.posix.join(normalizedPath, entry.name).replace(/\\/g, '/')
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
        .slice(0, 200);

      return {
        path: normalizedPath,
        directories
      };
    }
  };
}
