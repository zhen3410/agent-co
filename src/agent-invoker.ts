import type { AIAgent, AgentInvokeResult, Message } from './types';
import { invokeCliProvider } from './providers/cli-provider';

export interface InvokeAgentParams {
  userMessage: string;
  agent: AIAgent;
  history: Message[];
  includeHistory: boolean;
  extraEnv?: Record<string, string>;
}

function resolveExecutionMode(agent: AIAgent): 'cli' | 'api' {
  if (agent.executionMode === 'api') {
    return 'api';
  }

  return 'cli';
}

export async function invokeAgent(params: InvokeAgentParams): Promise<AgentInvokeResult> {
  const executionMode = resolveExecutionMode(params.agent);

  if (executionMode === 'api') {
    throw new Error('API provider not implemented yet');
  }

  return invokeCliProvider(params);
}
