import type { AIAgent, AgentCliName } from '../types';
import type { NormalizedInvokeTarget } from './agent-invoker-types';

export function normalizeCliName(agent: Pick<AIAgent, 'cliName' | 'cli'>): AgentCliName | undefined {
  if (agent.cliName === 'claude' || agent.cliName === 'codex') {
    return agent.cliName;
  }

  if (agent.cli === 'claude' || agent.cli === 'codex') {
    return agent.cli;
  }

  return undefined;
}

export function normalizeInvokeTarget(agent: AIAgent): NormalizedInvokeTarget {
  if (agent.executionMode === 'api') {
    return { executionMode: 'api' };
  }

  return {
    executionMode: 'cli',
    cliName: normalizeCliName(agent) || 'claude'
  };
}
