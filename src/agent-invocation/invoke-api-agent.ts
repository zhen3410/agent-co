import type { AgentInvokeResult } from '../types';
import type { InvokeAgentParams } from './agent-invoker-types';
import { loadApiAgentConnection } from './model-connection-loader';
import { resolveApiProviderCapability } from './provider-capabilities';
import { resolveApiProvider } from './provider-registry';

export async function invokeApiAgent(params: InvokeAgentParams): Promise<AgentInvokeResult> {
  const { connection } = loadApiAgentConnection(params.agent);
  const providerCapability = resolveApiProviderCapability(params.agent);
  const provider = resolveApiProvider(providerCapability);
  return provider(params, connection);
}
