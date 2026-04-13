import { createHttpClient } from '../../shared/lib/http/http-client';
import type {
  DependencyLogQuery,
  DependencyLogResponse,
  DependencyStatusResponse,
  OpsApi,
  VerboseAgentsResponse,
  VerboseLogContentResponse,
  VerboseLogListResponse
} from '../types';

export interface OpsApiOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

function appendQueryParam(params: URLSearchParams, key: string, value: string | number | null | undefined) {
  if (value === null || typeof value === 'undefined') {
    return;
  }

  const text = String(value).trim();
  if (!text) {
    return;
  }

  params.set(key, text);
}

function toDependencyLogsPath(query: DependencyLogQuery): string {
  const params = new URLSearchParams();
  appendQueryParam(params, 'startDate', query.startDate);
  appendQueryParam(params, 'endDate', query.endDate);
  appendQueryParam(params, 'keyword', query.keyword);
  appendQueryParam(params, 'dependency', query.dependency);
  appendQueryParam(params, 'level', query.level);
  appendQueryParam(params, 'limit', query.limit);
  const search = params.toString();
  return search ? `/api/dependencies/logs?${search}` : '/api/dependencies/logs';
}

export function createOpsApi(options: OpsApiOptions = {}): OpsApi {
  const client = createHttpClient({
    baseUrl: options.baseUrl,
    fetch: options.fetch
  });

  function request<T>(path: string): Promise<T> {
    return client.request<T>(path, {
      credentials: 'include',
      cache: 'no-store'
    });
  }

  return {
    loadDependencyStatus(): Promise<DependencyStatusResponse> {
      return request('/api/dependencies/status');
    },
    loadDependencyLogs(query: DependencyLogQuery): Promise<DependencyLogResponse> {
      return request(toDependencyLogsPath(query));
    },
    listVerboseAgents(): Promise<VerboseAgentsResponse> {
      return request('/api/verbose/agents');
    },
    listVerboseLogs(agent: string): Promise<VerboseLogListResponse> {
      return request(`/api/verbose/logs?agent=${encodeURIComponent(agent)}`);
    },
    loadVerboseLogContent(fileName: string): Promise<VerboseLogContentResponse> {
      return request(`/api/verbose/log-content?file=${encodeURIComponent(fileName)}`);
    }
  };
}
