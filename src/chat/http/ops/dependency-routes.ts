import * as http from 'http';
import { AppError } from '../../../shared/errors/app-error';
import { APP_ERROR_CODES } from '../../../shared/errors/app-error-codes';
import { sendHttpError } from '../../../shared/http/errors';
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
      sendHttpError(res, error);
    }
    return true;
  }

  if (requestUrl.pathname === '/api/dependencies/logs' && method === 'GET') {
    const query = parseDependencyLogQuery(requestUrl);
    if (query.startAt !== null && query.endAt !== null && query.startAt > query.endAt) {
      sendHttpError(res, new AppError('startDate 不能晚于 endDate', {
        code: APP_ERROR_CODES.VALIDATION_FAILED
      }));
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
