import type { AgentInvokeResult } from '../types';
import type { CliInvokeTarget, InvokeAgentParams } from './agent-invoker-types';
import { invokeApiAgent } from './invoke-api-agent';
import { invokeCliAgent } from './invoke-cli-agent';
import { normalizeInvokeTarget } from './invoke-target';

export async function invokeAgent(params: InvokeAgentParams): Promise<AgentInvokeResult> {
  const target = normalizeInvokeTarget(params.agent);

  if (target.executionMode === 'api') {
    return invokeApiAgent(params);
  }

  return invokeCliAgent(params, target as CliInvokeTarget);
}

export type { InvokeAgentParams };
