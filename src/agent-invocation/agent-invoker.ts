import type { AgentInvokeResult } from '../types';
import type { InvokeAgentParams } from './agent-invoker-types';
import { resolveInvocationProvider } from './provider-registry';
import { normalizeInvokeTarget } from './invoke-target';

export async function invokeAgent(params: InvokeAgentParams): Promise<AgentInvokeResult> {
  const target = normalizeInvokeTarget(params.agent);
  const provider = resolveInvocationProvider(target.executionMode);
  return provider(params);
}

export type { InvokeAgentParams };
