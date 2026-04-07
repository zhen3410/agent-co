import type { AgentInvokeResult } from '../types';
import { invokeCliAgent } from './invoke-cli-agent';
import { invokeApiAgent } from './invoke-api-agent';
import { normalizeInvokeTarget } from './invoke-target';
import {
  API_PROVIDER_CAPABILITY,
  CLI_PROVIDER_CAPABILITY,
  OPENAI_COMPATIBLE_API_PROVIDER_CAPABILITY,
  isApiProviderCapability,
  type ApiProviderCapability,
  type InvocationProviderCapability
} from './provider-capabilities';
import { invokeOpenAICompatibleProvider } from '../providers/openai-compatible-provider';
import type { CliInvokeTarget, InvokeAgentParams } from './agent-invoker-types';

type InvocationProvider = (params: InvokeAgentParams) => Promise<AgentInvokeResult>;
type ApiProvider = typeof invokeOpenAICompatibleProvider;

interface ProviderRegistry<TKey extends string, TProvider> {
  register(capability: TKey, provider: TProvider): void;
  resolve(capability: TKey): TProvider;
}

function createProviderRegistry<TKey extends string, TProvider>(
  registryName: string,
  entries: Array<readonly [TKey, TProvider]>
): ProviderRegistry<TKey, TProvider> {
  const providers = new Map<TKey, TProvider>();

  function register(capability: TKey, provider: TProvider): void {
    if (providers.has(capability)) {
      throw new Error(`${registryName} provider 已存在：${capability}`);
    }
    providers.set(capability, provider);
  }

  function resolve(capability: TKey): TProvider {
    const provider = providers.get(capability);
    if (!provider) {
      throw new Error(`不支持的 ${registryName} provider capability：${String(capability)}`);
    }
    return provider;
  }

  for (const [capability, provider] of entries) {
    register(capability, provider);
  }

  return {
    register,
    resolve
  };
}

export function createInvocationProviderRegistry(
  entries: Array<readonly [InvocationProviderCapability, InvocationProvider]> = []
): ProviderRegistry<InvocationProviderCapability, InvocationProvider> {
  return createProviderRegistry('invocation', entries);
}

export function createApiProviderRegistry(
  entries: Array<readonly [ApiProviderCapability, ApiProvider]> = []
): ProviderRegistry<ApiProviderCapability, ApiProvider> {
  return createProviderRegistry('API', entries);
}

function resolveCliProviderTarget(params: InvokeAgentParams): CliInvokeTarget {
  const target = normalizeInvokeTarget(params.agent);
  if (target.executionMode !== 'cli') {
    throw new Error(`CLI provider 仅支持 cli execution mode：${target.executionMode}`);
  }
  return target;
}

const invocationProviderRegistry = createInvocationProviderRegistry([
  [
    CLI_PROVIDER_CAPABILITY,
    (params) => invokeCliAgent(params, resolveCliProviderTarget(params))
  ],
  [API_PROVIDER_CAPABILITY, invokeApiAgent]
]);

const apiProviderRegistry = createApiProviderRegistry([
  [OPENAI_COMPATIBLE_API_PROVIDER_CAPABILITY, invokeOpenAICompatibleProvider]
]);

export function resolveInvocationProvider(capability: InvocationProviderCapability): InvocationProvider {
  return invocationProviderRegistry.resolve(capability);
}

export function resolveApiProvider(
  capability: ApiProviderCapability = OPENAI_COMPATIBLE_API_PROVIDER_CAPABILITY
): ApiProvider {
  if (!isApiProviderCapability(capability)) {
    throw new Error(`不支持的 API provider capability：${String(capability)}`);
  }

  return apiProviderRegistry.resolve(capability);
}
