import { useMemo } from 'react';
import { createHttpClient } from '../../../shared/lib/http/http-client';
import { Card, EmptyState, ErrorState, Spinner } from '../../../shared/ui';
import { getMergedRuntimeConfig } from '../../../shared/config/runtime-config';
import { useSessionPanelResource } from '../shared/useSessionPanelResource';

interface CallGraphNode {
  id: string;
  kind: string;
  label?: string;
  messageId?: string;
  taskId?: string;
}

interface CallGraphEdge {
  id: string;
  type: string;
  source: string;
  target: string;
}

interface CallGraphProjection {
  nodes: CallGraphNode[];
  edges: CallGraphEdge[];
}

export interface CallGraphPanelProps {
  sessionId?: string | null;
  refreshSignal?: number;
  fetch?: typeof fetch;
}

function normalizeCallGraph(payload: unknown): CallGraphProjection {
  const source = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const rawProjection = source.callGraph && typeof source.callGraph === 'object'
    ? source.callGraph as Record<string, unknown>
    : {};

  const nodes = Array.isArray(rawProjection.nodes)
    ? rawProjection.nodes
      .filter((node) => node && typeof node === 'object')
      .map((node, index) => {
        const sourceNode = node as Record<string, unknown>;
        return {
          id: typeof sourceNode.id === 'string' ? sourceNode.id : `node-${index}`,
          kind: typeof sourceNode.kind === 'string' ? sourceNode.kind : 'unknown',
          label: typeof sourceNode.label === 'string' ? sourceNode.label : undefined,
          messageId: typeof sourceNode.messageId === 'string' ? sourceNode.messageId : undefined,
          taskId: typeof sourceNode.taskId === 'string' ? sourceNode.taskId : undefined
        };
      })
    : [];

  const edges = Array.isArray(rawProjection.edges)
    ? rawProjection.edges
      .filter((edge) => edge && typeof edge === 'object')
      .map((edge, index) => {
        const sourceEdge = edge as Record<string, unknown>;
        return {
          id: typeof sourceEdge.id === 'string' ? sourceEdge.id : `edge-${index}`,
          type: typeof sourceEdge.type === 'string' ? sourceEdge.type : 'unknown',
          source: typeof sourceEdge.source === 'string' ? sourceEdge.source : 'unknown',
          target: typeof sourceEdge.target === 'string' ? sourceEdge.target : 'unknown'
        };
      })
    : [];

  return {
    nodes,
    edges
  };
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return '加载调用图失败';
}

function useCallGraph(_sessionId: string | null | undefined, fetchImpl?: typeof fetch) {
  const runtimeConfig = getMergedRuntimeConfig();
  const baseUrl = typeof runtimeConfig.apiBaseUrl === 'string' ? runtimeConfig.apiBaseUrl : undefined;
  const client = useMemo(() => {
    return createHttpClient({
      baseUrl,
      fetch: fetchImpl
    });
  }, [baseUrl, fetchImpl]);
  return client;
}

function buildNodeLabel(node: CallGraphNode): string {
  if (node.label) {
    return node.label;
  }
  if (node.messageId) {
    return node.messageId;
  }
  if (node.taskId) {
    return node.taskId;
  }
  return node.id;
}

export function CallGraphPanel({ sessionId = null, refreshSignal = 0, fetch }: CallGraphPanelProps) {
  const client = useCallGraph(sessionId, fetch);
  const callGraph = useSessionPanelResource<CallGraphProjection>({
    sessionId,
    refreshSignal,
    initialData: { nodes: [], edges: [] },
    load: (targetSessionId, signal) => {
      return client.request(`/api/sessions/${encodeURIComponent(targetSessionId)}/call-graph`, {
        credentials: 'include',
        cache: 'no-store',
        signal
      }).then((payload) => normalizeCallGraph(payload));
    },
    normalizeErrorMessage
  });

  return (
    <Card title="调用图谱">
      <section data-chat-call-graph-panel="call-graph" style={{ display: 'grid', gap: 'var(--space-3)' }}>
        {!sessionId ? (
          <EmptyState
            title="未选择会话"
            description="请选择会话后查看调用图。"
          />
        ) : null}

        {sessionId && callGraph.loadState === 'loading' && callGraph.data.nodes.length === 0 ? (
          <Spinner label="正在加载调用图…" />
        ) : null}

        {sessionId && callGraph.loadState === 'error' ? (
          <ErrorState
            title="调用图加载失败"
            message={callGraph.errorMessage || '未知错误'}
          />
        ) : null}

        {sessionId && callGraph.loadState === 'ready' && callGraph.data.nodes.length === 0 ? (
          <EmptyState
            title="暂无调用图节点"
            description="当前会话还没有形成调用链路。"
          />
        ) : null}

        {sessionId && callGraph.data.nodes.length > 0 ? (
          <>
            <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>
              节点 {callGraph.data.nodes.length} · 连线 {callGraph.data.edges.length}
            </p>

            <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <strong style={{ color: 'var(--color-text)' }}>节点</strong>
              <ul style={{ display: 'grid', gap: 'var(--space-1)', margin: 0, paddingLeft: 'var(--space-4)' }}>
                {callGraph.data.nodes.slice(0, 12).map((node) => (
                  <li key={node.id}>
                    {node.id} · {buildNodeLabel(node)}
                  </li>
                ))}
              </ul>
            </div>

            {callGraph.data.edges.length > 0 ? (
              <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                <strong style={{ color: 'var(--color-text)' }}>连线</strong>
                <ul style={{ display: 'grid', gap: 'var(--space-1)', margin: 0, paddingLeft: 'var(--space-4)' }}>
                  {callGraph.data.edges.slice(0, 12).map((edge) => (
                    <li key={edge.id}>
                      {edge.type} · {edge.source} → {edge.target}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </Card>
  );
}
