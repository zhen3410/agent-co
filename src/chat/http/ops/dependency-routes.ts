import * as http from 'http';
import { sendJson } from '../../../shared/http/json';
import { parseDependencyLogQuery } from '../../infrastructure/dependency-log-store';
import { ChatRuntime } from '../../runtime/chat-runtime';

export interface DependencyRoutesDependencies {
  runtime: ChatRuntime;
}

export async function handleDependencyRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requestUrl: URL,
  deps: DependencyRoutesDependencies
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

  return false;
}
