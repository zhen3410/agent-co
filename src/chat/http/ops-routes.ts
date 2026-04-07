import * as http from 'http';
import { serveStaticFile } from '../../shared/http/static-files';
import { ChatRuntime } from '../runtime/chat-runtime';
import { handleDependencyRoutes } from './ops/dependency-routes';
import { handleSystemRoutes } from './ops/system-routes';
import { handleVerboseLogRoutes } from './ops/verbose-log-routes';

export interface OpsRoutesDependencies {
  runtime: ChatRuntime;
  verboseLogDir: string;
  publicDir: string;
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

  if (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html') {
    serveStaticFile(res, {
      rootDir: deps.publicDir,
      filePath: 'index.html',
      contentType: 'text/html',
      disableHtmlCache: true
    });
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

  if (requestUrl.pathname === '/chat-markdown.js') {
    serveStaticFile(res, {
      rootDir: deps.publicDir,
      filePath: 'chat-markdown.js',
      contentType: 'application/javascript'
    });
    return true;
  }

  if (requestUrl.pathname === '/chat-composer.js') {
    serveStaticFile(res, {
      rootDir: deps.publicDir,
      filePath: 'chat-composer.js',
      contentType: 'application/javascript'
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
    serveStaticFile(res, {
      rootDir: deps.publicDir,
      filePath: 'verbose-logs.html',
      contentType: 'text/html',
      disableHtmlCache: true
    });
    return true;
  }

  if (requestUrl.pathname === '/deps-monitor.html') {
    serveStaticFile(res, {
      rootDir: deps.publicDir,
      filePath: 'deps-monitor.html',
      contentType: 'text/html',
      disableHtmlCache: true
    });
    return true;
  }

  return false;
}
