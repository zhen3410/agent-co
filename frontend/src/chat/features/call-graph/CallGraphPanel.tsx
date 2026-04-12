import { useEffect, useMemo, useState } from 'react';
import { createHttpClient } from '../../../shared/lib/http/http-client';
import { Card, EmptyState, ErrorState, Spinner } from '../../../shared/ui';
import { getMergedRuntimeConfig } from '../../../shared/config/runtime-config';
import { useSessionEventSignal } from '../shared/useSessionEventSignal';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

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

function useCallGraph(sessionId: string | null | undefined, fetchImpl?: typeof fetch) {
  const runtimeConfig = getMergedRuntimeConfig();
  const baseUrl = typeof runtimeConfig.apiBaseUrl === 'string' ? runtimeConfig.apiBaseUrl : undefined;
  const client = useMemo(() => {
    return createHttpClient({
      baseUrl,
      fetch: fetchImpl
    });
  }, [baseUrl, fetchImpl]);
  const signal = useSessionEventSignal(sessionId);

  const [loadState, setLoadState] = useState<LoadState>(sessionId ? 'loading' : 'idle');
  const [graph, setGraph] = useState<CallGraphProjection>({ nodes: [], edges: [] });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setLoadState('idle');
      setGraph({ nodes: [], edges: [] });
      setErrorMessage(null);
      return undefined;
    }

    let cancelled = false;
    setLoadState('loading');
    setErrorMessage(null);

    client.request(`/api/sessions/${encodeURIComponent(sessionId)}/call-graph`, {
      credentials: 'include',
      cache: 'no-store'
    })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setGraph(normalizeCallGraph(payload));
        setLoadState('ready');
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setLoadState('error');
        setErrorMessage(normalizeErrorMessage(error));
      });

    return () => {
      cancelled = true;
    };
  }, [client, sessionId, signal]);

  return {
    loadState,
    graph,
    errorMessage
  };
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

export function CallGraphPanel({ sessionId = null, fetch }: CallGraphPanelProps) {
  const callGraph = useCallGraph(sessionId, fetch);

  return (
    <Card title="调用图谱">
      <section data-chat-call-graph-panel="call-graph" style={{ display: 'grid', gap: 'var(--space-3)' }}>
        {!sessionId ? (
          <EmptyState
            title="未选择会话"
            description="请选择会话后查看调用图。"
          />
        ) : null}

        {sessionId && callGraph.loadState === 'loading' && callGraph.graph.nodes.length === 0 ? (
          <Spinner label="正在加载调用图…" />
        ) : null}

        {sessionId && callGraph.loadState === 'error' ? (
          <ErrorState
            title="调用图加载失败"
            message={callGraph.errorMessage || '未知错误'}
          />
        ) : null}

        {sessionId && callGraph.loadState === 'ready' && callGraph.graph.nodes.length === 0 ? (
          <EmptyState
            title="暂无调用图节点"
            description="当前会话还没有形成调用链路。"
          />
        ) : null}

        {sessionId && callGraph.graph.nodes.length > 0 ? (
          <>
            <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>
              节点 {callGraph.graph.nodes.length} · 连线 {callGraph.graph.edges.length}
            </p>

            <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <strong style={{ color: 'var(--color-text)' }}>节点</strong>
              <ul style={{ display: 'grid', gap: 'var(--space-1)', margin: 0, paddingLeft: 'var(--space-4)' }}>
                {callGraph.graph.nodes.slice(0, 12).map((node) => (
                  <li key={node.id}>
                    {node.id} · {buildNodeLabel(node)}
                  </li>
                ))}
              </ul>
            </div>

            {callGraph.graph.edges.length > 0 ? (
              <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                <strong style={{ color: 'var(--color-text)' }}>连线</strong>
                <ul style={{ display: 'grid', gap: 'var(--space-1)', margin: 0, paddingLeft: 'var(--space-4)' }}>
                  {callGraph.graph.edges.slice(0, 12).map((edge) => (
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
