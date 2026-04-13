import * as fs from 'fs';
import * as path from 'path';

interface FrontendAssetTarget {
  filePath: string;
  required: boolean;
}

export interface FrontendAssetResolverOptions {
  entryPaths?: string[];
}

export interface ResolvedFrontendAsset {
  rootDir: string;
  filePath: string;
  contentType: string;
  disableHtmlCache: boolean;
  required: boolean;
}

export type FrontendAssetResolution =
  | { kind: 'serve'; asset: ResolvedFrontendAsset }
  | { kind: 'missing-required'; errorMessage: string }
  | { kind: 'missing-asset' };

function getFrontendBuildDir(): string {
  const customBuildDir = (process.env.AGENT_CO_FRONTEND_DIST_DIR || '').trim();
  return customBuildDir || path.join(process.cwd(), 'dist', 'frontend');
}

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

function resolveFrontendAssetTarget(
  pathname: string,
  entryHtmlFile: string,
  options: FrontendAssetResolverOptions
): FrontendAssetTarget | null {
  const entryPaths = options.entryPaths ?? ['/', '/index.html', `/${entryHtmlFile}`];
  if (entryPaths.includes(pathname)) {
    return {
      filePath: entryHtmlFile,
      required: true
    };
  }

  if (pathname.startsWith('/assets/')) {
    return {
      filePath: pathname.slice(1),
      required: false
    };
  }

  return null;
}

function buildMissingRequiredError(filePath: string): string {
  return `前端构建产物缺失: ${filePath}。请先执行 npm run build 生成 dist/frontend。`;
}

export function resolveFrontendAssetRequest(
  pathname: string,
  entryHtmlFile: string,
  options: FrontendAssetResolverOptions = {}
): FrontendAssetResolution | null {
  const target = resolveFrontendAssetTarget(pathname, entryHtmlFile, options);
  if (!target) {
    return null;
  }

  const rootDir = getFrontendBuildDir();
  const fullPath = path.join(rootDir, target.filePath);

  if (!fs.existsSync(fullPath)) {
    if (target.required) {
      return {
        kind: 'missing-required',
        errorMessage: buildMissingRequiredError(target.filePath)
      };
    }
    return { kind: 'missing-asset' };
  }

  return {
    kind: 'serve',
    asset: {
      rootDir,
      filePath: target.filePath,
      contentType: resolveFrontendContentType(target.filePath),
      disableHtmlCache: target.filePath.endsWith('.html'),
      required: target.required
    }
  };
}
