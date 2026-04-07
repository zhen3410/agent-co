import type { AgentInvokeResult } from '../types';
import { invokeCliProvider } from '../providers/cli-provider';
import type { CliInvokeTarget, InvokeAgentParams } from './agent-invoker-types';

export function buildCliInvokeParams(params: InvokeAgentParams, target: CliInvokeTarget): InvokeAgentParams {
  return {
    ...params,
    agent: {
      ...params.agent,
      executionMode: 'cli',
      cliName: target.cliName,
      cli: target.cliName
    }
  };
}

export async function invokeCliAgent(
  params: InvokeAgentParams,
  target: CliInvokeTarget
): Promise<AgentInvokeResult> {
  return invokeCliProvider(buildCliInvokeParams(params, target));
}
