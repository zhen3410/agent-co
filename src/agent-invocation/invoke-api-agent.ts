import type { AgentInvokeResult } from '../types';
import { invokeOpenAICompatibleProvider } from '../providers/openai-compatible-provider';
import type { InvokeAgentParams } from './agent-invoker-types';
import { loadApiAgentConnection } from './model-connection-loader';

export async function invokeApiAgent(params: InvokeAgentParams): Promise<AgentInvokeResult> {
  const { connection } = loadApiAgentConnection(params.agent);
  return invokeOpenAICompatibleProvider(params, connection);
}
