import * as fs from 'fs';
import * as path from 'path';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

const FRONTEND_BUILD_DIR = path.join(process.cwd(), 'dist', 'frontend');

function resolveFrontendContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.ico':
      return 'image/x-icon';
    case '.webp':
      return 'image/webp';
    case '.map':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function resolveFrontendFilePath(pathname: string, entryHtmlFile: string): string | null {
  if (pathname === '/' || pathname === '/index.html' || pathname === `/${entryHtmlFile}`) {
    return entryHtmlFile;
  }

  if (pathname.startsWith('/assets/')) {
    return pathname.slice(1);
  }

  return null;
}

function buildFrontendAssetError(filePath: string): string {
  return `前端构建产物缺失: ${filePath}。请先执行 npm run build 生成 dist/frontend。`;
}

export interface FrontendAssetRequestResult {
  rootDir: string;
  filePath: string;
  contentType: string;
  disableHtmlCache: boolean;
  errorMessage: string | null;
}

export function resolveFrontendAssetRequest(pathname: string, entryHtmlFile: string): FrontendAssetRequestResult | null {
  const filePath = resolveFrontendFilePath(pathname, entryHtmlFile);
  if (!filePath) {
    return null;
  }

  const fullPath = path.join(FRONTEND_BUILD_DIR, filePath);
  if (!fs.existsSync(fullPath)) {
    return {
      rootDir: FRONTEND_BUILD_DIR,
      filePath,
      contentType: resolveFrontendContentType(filePath),
      disableHtmlCache: filePath.endsWith('.html'),
      errorMessage: buildFrontendAssetError(filePath)
    };
  }

  return {
    rootDir: FRONTEND_BUILD_DIR,
    filePath,
    contentType: resolveFrontendContentType(filePath),
    disableHtmlCache: filePath.endsWith('.html'),
    errorMessage: null
  };
}

export function buildChatRateLimitBody(resetAt: number, now = Date.now()): { error: string; retryAfter: number } {
  return {
    error: '请求过于频繁，请稍后再试',
    retryAfter: Math.ceil((resetAt - now) / 1000)
  };
}

export function normalizeBodyText(value: unknown): string {
  return asString(value);
}

export function normalizeSessionId(value: unknown): string {
  return asString(value).trim();
}

export function normalizeWorkdirSelection(body: { agentName?: unknown; workdir?: unknown }): { agentName: string; workdir: string | null } {
  const agentName = asString(body.agentName);
  const workdir = asString(body.workdir).trim();
  return {
    agentName,
    workdir: workdir || null
  };
}
