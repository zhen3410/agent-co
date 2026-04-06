import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { serveStaticFile } from '../../shared/http/static-files';
import { sendJson, sendNotFound } from '../../shared/http/json';
import { parseDependencyLogQuery } from '../infrastructure/dependency-log-store';
import { ChatRuntime } from '../runtime/chat-runtime';

interface VerboseLogMeta {
  fileName: string;
  cli: string;
  agent: string;
  updatedAt: number;
  size: number;
}

export interface OpsRoutesDependencies {
  runtime: ChatRuntime;
  verboseLogDir: string;
  publicDir: string;
}

function listDirectories(targetPath: string): Array<{ name: string; path: string }> {
  const normalizedPath = path.resolve(targetPath || '/');
  if (!path.isAbsolute(normalizedPath)) {
    throw new Error('path 必须是绝对路径');
  }
  if (!fs.existsSync(normalizedPath) || !fs.statSync(normalizedPath).isDirectory()) {
    throw new Error('目录不存在');
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

function listVerboseLogs(verboseLogDir: string): VerboseLogMeta[] {
  if (!fs.existsSync(verboseLogDir)) {
    return [];
  }

  const entries = fs.readdirSync(verboseLogDir, { withFileTypes: true });
  const logs: VerboseLogMeta[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.log')) {
      continue;
    }

    const match = entry.name.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-([^-]+)-(.+)\.log$/);
    const cli = match ? match[2] : 'unknown';
    const encodedAgent = match ? match[3] : 'unknown';
    let agent = encodedAgent;
    try {
      agent = decodeURIComponent(encodedAgent);
    } catch {
      agent = encodedAgent;
    }
    const fullPath = path.join(verboseLogDir, entry.name);
    const stat = fs.statSync(fullPath);

    logs.push({
      fileName: entry.name,
      cli,
      agent,
      updatedAt: stat.mtimeMs,
      size: stat.size
    });
  }

  return logs.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function handleOpsRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requestUrl: URL,
  deps: OpsRoutesDependencies
): Promise<boolean> {
  const method = req.method || 'GET';

  if (requestUrl.pathname === '/api/dependencies/status' && method === 'GET') {
    try {
      const dependencies = await deps.runtime.collectDependencyStatus();
      const healthy = dependencies.every(item => !item.required || item.healthy);
      sendJson(res, healthy ? 200 : 503, {
        healthy,
        checkedAt: Date.now(),
        dependencies,
        logs: deps.runtime.listDependencyStatusLogs()
      });
    } catch (error) {
      sendJson(res, 500, { error: (error as Error).message });
    }
    return true;
  }

  if (requestUrl.pathname === '/api/dependencies/logs' && method === 'GET') {
    const query = parseDependencyLogQuery(requestUrl);
    if (query.startAt !== null && query.endAt !== null && query.startAt > query.endAt) {
      sendJson(res, 400, { error: 'startDate 不能晚于 endDate' });
      return true;
    }

    const logs = deps.runtime.listDependencyStatusLogs().filter((log) => {
      if (query.startAt !== null && log.timestamp < query.startAt) return false;
      if (query.endAt !== null && log.timestamp > query.endAt) return false;
      if (query.dependency && log.dependency.toLowerCase() !== query.dependency) return false;
      if (query.level && log.level !== query.level) return false;
      if (!query.keyword) return true;
      const text = `${log.dependency} ${log.message} ${log.level}`.toLowerCase();
      return text.includes(query.keyword);
    }).slice(0, query.limit);

    sendJson(res, 200, {
      total: logs.length,
      query: {
        keyword: query.keyword,
        startDate: query.startAt,
        endDate: query.endAt,
        dependency: query.dependency,
        level: query.level,
        limit: query.limit
      },
      logs
    });
    return true;
  }

  if (requestUrl.pathname === '/api/system/dirs' && method === 'GET') {
    try {
      const targetPath = requestUrl.searchParams.get('path') || '/';
      sendJson(res, 200, { directories: listDirectories(targetPath) });
    } catch (error) {
      sendJson(res, 400, { error: (error as Error).message });
    }
    return true;
  }

  if (requestUrl.pathname === '/api/workdirs/options' && method === 'GET') {
    try {
      sendJson(res, 200, { options: collectWorkdirOptions() });
    } catch (error) {
      sendJson(res, 500, { error: (error as Error).message });
    }
    return true;
  }

  if (requestUrl.pathname === '/api/verbose/agents' && method === 'GET') {
    const logs = listVerboseLogs(deps.verboseLogDir);
    const summary = new Map<string, { agent: string; logCount: number; latestFile: string; latestUpdatedAt: number }>();

    for (const log of logs) {
      const existing = summary.get(log.agent);
      if (!existing) {
        summary.set(log.agent, {
          agent: log.agent,
          logCount: 1,
          latestFile: log.fileName,
          latestUpdatedAt: log.updatedAt
        });
        continue;
      }

      existing.logCount += 1;
    }

    const agents = Array.from(summary.values()).sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt);
    sendJson(res, 200, { logDir: deps.verboseLogDir, agents });
    return true;
  }

  if (requestUrl.pathname === '/api/verbose/logs' && method === 'GET') {
    const agent = (requestUrl.searchParams.get('agent') || '').trim();
    if (!agent) {
      sendJson(res, 400, { error: '缺少 agent 参数' });
      return true;
    }

    sendJson(res, 200, { agent, logs: listVerboseLogs(deps.verboseLogDir).filter(item => item.agent === agent) });
    return true;
  }

  if (requestUrl.pathname === '/api/verbose/log-content' && method === 'GET') {
    const fileName = (requestUrl.searchParams.get('file') || '').trim();
    if (!fileName) {
      sendJson(res, 400, { error: '缺少 file 参数' });
      return true;
    }
    if (fileName.includes('/') || fileName.includes('\\') || !fileName.endsWith('.log')) {
      sendJson(res, 400, { error: '非法 file 参数' });
      return true;
    }

    const fullPath = path.join(deps.verboseLogDir, fileName);
    if (!fs.existsSync(fullPath)) {
      sendJson(res, 404, { error: '日志文件不存在' });
      return true;
    }

    sendJson(res, 200, { fileName, content: fs.readFileSync(fullPath, 'utf8') });
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
