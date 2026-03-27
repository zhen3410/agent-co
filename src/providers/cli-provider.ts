import { callAgentCLI } from '../claude-cli';
import type { AgentInvokeResult } from '../types';
import type { InvokeAgentParams } from '../agent-invoker';

export async function invokeCliProvider(params: InvokeAgentParams): Promise<AgentInvokeResult> {
  const result = await callAgentCLI(
    params.userMessage,
    params.agent,
    params.history,
    {
      includeHistory: params.includeHistory,
      extraEnv: params.extraEnv
    }
  );

  return {
    text: result.text,
    blocks: result.blocks
  };
}
