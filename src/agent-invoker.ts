import * as path from 'path';
import type { AIAgent, AgentCliName, AgentExecutionMode, AgentInvokeResult, Message } from './types';
import { loadApiConnectionStore } from './api-connection-store';
import { invokeCliProvider } from './providers/cli-provider';
import { invokeOpenAICompatibleProvider } from './providers/openai-compatible-provider';

export interface InvokeAgentParams {
  userMessage: string;
  agent: AIAgent;
  history: Message[];
  includeHistory: boolean;
  extraEnv?: Record<string, string>;
  onTextDelta?: (delta: string) => void;
}

interface NormalizedInvokeTarget {
  executionMode: AgentExecutionMode;
  cliName?: AgentCliName;
}

function normalizeCliName(agent: AIAgent): AgentCliName | undefined {
  if (agent.cliName === 'claude' || agent.cliName === 'codex') {
    return agent.cliName;
  }

  if (agent.cli === 'claude' || agent.cli === 'codex') {
    return agent.cli;
  }

  return undefined;
}

function normalizeInvokeTarget(agent: AIAgent): NormalizedInvokeTarget {
  if (agent.executionMode === 'api') {
    return { executionMode: 'api' };
  }

  return {
    executionMode: 'cli',
    cliName: normalizeCliName(agent) || 'claude'
  };
}

function resolveModelConnectionDataFile(): string {
  const agentDataFile = process.env.AGENT_DATA_FILE || path.join(process.cwd(), 'data', 'agents.json');
  return process.env.MODEL_CONNECTION_DATA_FILE || path.join(path.dirname(agentDataFile), 'api-connections.json');
}

export async function invokeAgent(params: InvokeAgentParams): Promise<AgentInvokeResult> {
  const target = normalizeInvokeTarget(params.agent);

  if (target.executionMode === 'api') {
    const apiConnectionId = params.agent.apiConnectionId?.trim();
    if (!apiConnectionId) {
      throw new Error(`Agent ${params.agent.name} 缺少 apiConnectionId 配置`);
    }
    if (!params.agent.apiModel?.trim()) {
      throw new Error(`Agent ${params.agent.name} 缺少 apiModel 配置`);
    }

    const store = loadApiConnectionStore(resolveModelConnectionDataFile());
    const connection = store.apiConnections.find(item => item.id === apiConnectionId);

    if (!connection) {
      throw new Error(`找不到 API 连接配置：${apiConnectionId}`);
    }

    if (!connection.enabled) {
      throw new Error(`API 连接已停用：${apiConnectionId}`);
    }

    return invokeOpenAICompatibleProvider(params, connection);
  }

  return invokeCliProvider({
    ...params,
    agent: {
      ...params.agent,
      executionMode: 'cli',
      cliName: target.cliName,
      cli: target.cliName
    }
  });
}
