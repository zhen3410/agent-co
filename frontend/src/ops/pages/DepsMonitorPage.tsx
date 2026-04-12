import { useCallback, useEffect, useMemo, useState } from 'react';
import { getMergedRuntimeConfig } from '../../shared/config/runtime-config';
import { ToolPageLayout } from '../../shared/layouts/ToolPageLayout';
import { Button, Card, ErrorState, Spinner } from '../../shared/ui';
import { createOpsApi } from '../services/ops-api';
import type { DependencyLogQuery, DependencyLogResponse, DependencyStatusResponse, OpsApi } from '../types';
import {
  DependencyLogFilters,
  DependencyLogTable,
  DependencyStatusSummary,
  DependencyStatusTable
} from '../features/dependency-health';

export interface DepsMonitorPageProps {
  api?: OpsApi;
}

const DEFAULT_FILTERS: DependencyLogQuery = {
  startDate: '',
  endDate: '',
  keyword: '',
  dependency: '',
  level: '',
  limit: 500
};

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function DepsMonitorPage({ api }: DepsMonitorPageProps) {
  const runtimeConfig = getMergedRuntimeConfig();
  const opsApi = useMemo(() => {
    if (api) {
      return api;
    }

    const baseUrl = typeof runtimeConfig.apiBaseUrl === 'string' ? runtimeConfig.apiBaseUrl : undefined;
    return createOpsApi({ baseUrl });
  }, [api, runtimeConfig.apiBaseUrl]);
  const [filters, setFilters] = useState<DependencyLogQuery>(DEFAULT_FILTERS);
  const [status, setStatus] = useState<DependencyStatusResponse | null>(null);
  const [logResult, setLogResult] = useState<DependencyLogResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadLogs = useCallback(async (query: DependencyLogQuery) => {
    const response = await opsApi.loadDependencyLogs(query);
    setLogResult(response);
    return response;
  }, [opsApi]);

  const refreshAll = useCallback(async (query: DependencyLogQuery) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const nextStatus = await opsApi.loadDependencyStatus();
      setStatus(nextStatus);
      await loadLogs(query);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, '加载依赖监控失败'));
    } finally {
      setIsLoading(false);
    }
  }, [loadLogs, opsApi]);

  useEffect(() => {
    void refreshAll(DEFAULT_FILTERS);
  }, [refreshAll]);

  const navigation = (
    <nav aria-label="Ops tools" style={navStyle}>
      <a href="/deps-monitor.html" data-ops-nav="deps-monitor" style={navLinkStyle}>依赖监控</a>
      <a href="/verbose-logs.html" data-ops-nav="verbose-logs" style={navLinkStyle}>Verbose 日志</a>
    </nav>
  );

  const content = !status && isLoading
    ? <Spinner label="正在加载依赖监控…" />
    : errorMessage && !status && !logResult
      ? (
        <ErrorState
          title="依赖监控加载失败"
          message={errorMessage}
          action={<Button onClick={() => void refreshAll(filters)}>重试</Button>}
        />
      )
      : (
        <div data-ops-page="deps-monitor" style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {errorMessage ? (
            <ErrorState
              title="最近一次刷新失败"
              message={errorMessage}
              action={<Button onClick={() => void refreshAll(filters)}>重试</Button>}
            />
          ) : null}
          <DependencyStatusSummary status={status} />
          <DependencyStatusTable dependencies={status?.dependencies ?? []} />
          <Card title="日志筛选">
            <DependencyLogFilters value={filters} onChange={setFilters} onApply={() => void loadLogs(filters)} disabled={isLoading} />
          </Card>
          {isLoading && status ? <Spinner label="正在刷新依赖监控…" /> : null}
          <DependencyLogTable logs={logResult?.logs ?? []} total={logResult?.total ?? 0} />
        </div>
      );

  return (
    <ToolPageLayout
      appTitle="agent-co ops"
      pageTitle="依赖健康监控"
      description="统一展示依赖检查结果与最近运维日志，支持高密度排障阅读。"
      navigation={navigation}
      actions={(
        <Button variant="secondary" data-ops-action="deps-refresh" onClick={() => void refreshAll(filters)}>
          刷新
        </Button>
      )}
    >
      {content}
    </ToolPageLayout>
  );
}

const navStyle = {
  display: 'flex',
  flexWrap: 'wrap' as const,
  gap: 'var(--space-2)'
};

const navLinkStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: '999px',
  color: 'var(--color-text)',
  padding: 'var(--space-2) var(--space-3)',
  textDecoration: 'none'
} as const;
