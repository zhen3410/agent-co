import { callAgentCLI } from '../claude-cli';
import type { AgentInvokeResult } from '../types';
import type { InvokeAgentParams } from '../agent-invocation/agent-invoker-types';

export async function invokeCliProvider(params: InvokeAgentParams): Promise<AgentInvokeResult> {
  const result = await callAgentCLI(
    params.userMessage,
    params.agent,
    params.history,
    {
      includeHistory: params.includeHistory,
      extraEnv: params.extraEnv,
      onTextDelta: params.onTextDelta,
      signal: params.signal
    }
  );

  return {
    text: result.text,
    blocks: result.blocks
  };
}
