import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { sendJson } from '../../../shared/http/json';

interface VerboseLogMeta {
  fileName: string;
  cli: string;
  agent: string;
  updatedAt: number;
  size: number;
}

export interface VerboseLogRoutesDependencies {
  verboseLogDir: string;
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

export async function handleVerboseLogRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requestUrl: URL,
  deps: VerboseLogRoutesDependencies
): Promise<boolean> {
  const method = req.method || 'GET';

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

  return false;
}
