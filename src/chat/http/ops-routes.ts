import * as http from 'http';
import { serveStaticFile } from '../../shared/http/static-files';
import { sendJson } from '../../shared/http/json';
import { resolveFrontendAssetRequest, FrontendAssetResolution } from '../../shared/http/frontend-asset-resolver';
import { ChatRuntime } from '../runtime/chat-runtime';
import { handleDependencyRoutes } from './ops/dependency-routes';
import { handleSystemRoutes } from './ops/system-routes';
import { handleVerboseLogRoutes } from './ops/verbose-log-routes';

export interface OpsRoutesDependencies {
  runtime: ChatRuntime;
  verboseLogDir: string;
  publicDir: string;
}

function serveFrontendAssetResolution(
  res: http.ServerResponse,
  resolution: FrontendAssetResolution
): void {
  if (resolution.kind === 'missing-required') {
    sendJson(res, 500, { error: resolution.errorMessage });
    return;
  }

  if (resolution.kind === 'missing-asset') {
    sendJson(res, 404, { error: 'Not Found' });
    return;
  }

  const frontendAsset = resolution.asset;
  serveStaticFile(res, {
    rootDir: frontendAsset.rootDir,
    filePath: frontendAsset.filePath,
    contentType: frontendAsset.contentType,
    disableHtmlCache: frontendAsset.disableHtmlCache,
    onNotFound: response => sendJson(response, frontendAsset.required ? 500 : 404, frontendAsset.required
      ? { error: `前端构建产物缺失: ${frontendAsset.filePath}。请先执行 npm run build 生成 dist/frontend。` }
      : { error: 'Not Found' })
  });
}

export async function handleOpsRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requestUrl: URL,
  deps: OpsRoutesDependencies
): Promise<boolean> {
  if (await handleDependencyRoutes(req, res, requestUrl, { runtime: deps.runtime })) {
    return true;
  }

  if (await handleSystemRoutes(req, res, requestUrl)) {
    return true;
  }

  if (await handleVerboseLogRoutes(req, res, requestUrl, { verboseLogDir: deps.verboseLogDir })) {
    return true;
  }

  if (requestUrl.pathname === '/styles.css') {
    serveStaticFile(res, {
      rootDir: deps.publicDir,
      filePath: 'styles.css',
      contentType: 'text/css'
    });
    return true;
  }

  if (requestUrl.pathname === '/manifest.json') {
    serveStaticFile(res, {
      rootDir: deps.publicDir,
      filePath: 'manifest.json',
      contentType: 'application/manifest+json'
    });
    return true;
  }

  if (requestUrl.pathname === '/service-worker.js') {
    serveStaticFile(res, {
      rootDir: deps.publicDir,
      filePath: 'service-worker.js',
      contentType: 'application/javascript'
    });
    return true;
  }

  if (requestUrl.pathname === '/icon.svg') {
    serveStaticFile(res, {
      rootDir: deps.publicDir,
      filePath: 'icon.svg',
      contentType: 'image/svg+xml'
    });
    return true;
  }

  if (requestUrl.pathname === '/verbose-logs.html') {
    serveFrontendAssetResolution(res, resolveFrontendAssetRequest(requestUrl.pathname, 'verbose-logs.html')!);
    return true;
  }

  if (requestUrl.pathname === '/deps-monitor.html') {
    serveFrontendAssetResolution(res, resolveFrontendAssetRequest(requestUrl.pathname, 'deps-monitor.html')!);
    return true;
  }

  return false;
}
