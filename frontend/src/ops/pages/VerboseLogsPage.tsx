import { useCallback, useEffect, useMemo, useState } from 'react';
import { getMergedRuntimeConfig } from '../../shared/config/runtime-config';
import { ToolPageLayout } from '../../shared/layouts/ToolPageLayout';
import { Button, Card, ErrorState, Spinner } from '../../shared/ui';
import { createOpsApi } from '../services/ops-api';
import type { OpsApi, VerboseAgentSummary, VerboseLogMeta } from '../types';
import {
  VerboseAgentList,
  VerboseFilters,
  VerboseLogContent,
  VerboseLogList
} from '../features/log-viewer';

export interface VerboseLogsPageProps {
  api?: OpsApi;
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function VerboseLogsPage({ api }: VerboseLogsPageProps) {
  const runtimeConfig = getMergedRuntimeConfig();
  const opsApi = useMemo(() => {
    if (api) {
      return api;
    }

    const baseUrl = typeof runtimeConfig.apiBaseUrl === 'string' ? runtimeConfig.apiBaseUrl : undefined;
    return createOpsApi({ baseUrl });
  }, [api, runtimeConfig.apiBaseUrl]);
  const [agents, setAgents] = useState<VerboseAgentSummary[]>([]);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [logs, setLogs] = useState<VerboseLogMeta[]>([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadLogContent = useCallback(async (fileName: string) => {
    if (!fileName) {
      setSelectedFile('');
      setContent('');
      return;
    }

    const response = await opsApi.loadVerboseLogContent(fileName);
    setSelectedFile(response.fileName);
    setContent(response.content);
  }, [opsApi]);

  const loadLogsForAgent = useCallback(async (agent: string, preferredFileName?: string) => {
    if (!agent) {
      setLogs([]);
      setSelectedFile('');
      setContent('');
      return;
    }

    const response = await opsApi.listVerboseLogs(agent);
    setSelectedAgent(agent);
    setLogs(response.logs);
    const nextFile = response.logs.find((item) => item.fileName === preferredFileName)?.fileName ?? response.logs[0]?.fileName ?? '';
    await loadLogContent(nextFile);
  }, [loadLogContent, opsApi]);

  const handleSelectAgent = useCallback(async (agent: string) => {
    setSelectedAgent(agent);
    setSelectedFile('');
    setContent('');
    await loadLogsForAgent(agent, '');
  }, [loadLogsForAgent]);

  const refreshAll = useCallback(async (preferredAgent?: string) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const agentResponse = await opsApi.listVerboseAgents();
      setAgents(agentResponse.agents);
      const nextAgent = preferredAgent
        || selectedAgent
        || agentResponse.agents[0]?.agent
        || '';
      setSelectedAgent(nextAgent);
      await loadLogsForAgent(nextAgent, selectedFile);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, '加载 verbose 日志失败'));
    } finally {
      setIsLoading(false);
    }
  }, [loadLogsForAgent, opsApi, selectedAgent, selectedFile]);

  useEffect(() => {
    void refreshAll();
  }, []);

  const navigation = (
    <nav aria-label="Ops tools" style={navStyle}>
      <a href="/deps-monitor.html" data-ops-nav="deps-monitor" style={navLinkStyle}>依赖监控</a>
      <a href="/verbose-logs.html" data-ops-nav="verbose-logs" style={navLinkStyle}>Verbose 日志</a>
    </nav>
  );

  const contentNode = agents.length === 0 && isLoading
    ? <Spinner label="正在加载 verbose 日志…" />
    : errorMessage && agents.length === 0
      ? (
        <ErrorState
          title="Verbose 日志加载失败"
          message={errorMessage}
          action={<Button onClick={() => void refreshAll(selectedAgent)}>重试</Button>}
        />
      )
      : (
        <div data-ops-page="verbose-logs" style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {errorMessage ? (
            <ErrorState
              title="最近一次刷新失败"
              message={errorMessage}
              action={<Button onClick={() => void refreshAll(selectedAgent)}>重试</Button>}
            />
          ) : null}
          <Card title="筛选条件">
            <VerboseFilters
              agents={agents}
              selectedAgent={selectedAgent}
              onChange={setSelectedAgent}
              onApply={() => void loadLogsForAgent(selectedAgent)}
              disabled={isLoading}
            />
          </Card>
          {isLoading && agents.length > 0 ? <Spinner label="正在刷新 verbose 日志…" /> : null}
          <div
            style={{
              display: 'grid',
              gap: 'var(--space-4)',
              gridTemplateColumns: 'minmax(16rem, 20rem) minmax(16rem, 22rem) minmax(0, 1fr)'
            }}
          >
            <VerboseAgentList agents={agents} selectedAgent={selectedAgent} onSelect={(agent) => void handleSelectAgent(agent)} />
            <VerboseLogList logs={logs} selectedFile={selectedFile} onSelect={(fileName) => void loadLogContent(fileName)} />
            <VerboseLogContent fileName={selectedFile} content={content} />
          </div>
        </div>
      );

  return (
    <ToolPageLayout
      appTitle="agent-co ops"
      pageTitle="CLI Verbose 日志"
      description="查看智能体 CLI 子进程输出、错误信息与最近日志文件。"
      navigation={navigation}
      actions={(
        <Button variant="secondary" data-ops-action="verbose-refresh" onClick={() => void refreshAll(selectedAgent)}>
          刷新
        </Button>
      )}
    >
      {contentNode}
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
