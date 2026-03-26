import type { AIAgent, AgentCliName, AgentExecutionMode, AgentInvokeResult, Message } from './types';
import { invokeCliProvider } from './providers/cli-provider';

export interface InvokeAgentParams {
  userMessage: string;
  agent: AIAgent;
  history: Message[];
  includeHistory: boolean;
  extraEnv?: Record<string, string>;
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

export async function invokeAgent(params: InvokeAgentParams): Promise<AgentInvokeResult> {
  const target = normalizeInvokeTarget(params.agent);

  if (target.executionMode === 'api') {
    throw new Error('API provider not implemented yet');
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
