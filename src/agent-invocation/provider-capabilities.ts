import type { AIAgent } from '../types';

export const CLI_PROVIDER_CAPABILITY = 'cli' as const;
export const API_PROVIDER_CAPABILITY = 'api' as const;
export const OPENAI_COMPATIBLE_API_PROVIDER_CAPABILITY = 'openai-compatible' as const;

export type InvocationProviderCapability =
  | typeof CLI_PROVIDER_CAPABILITY
  | typeof API_PROVIDER_CAPABILITY;

export type ApiProviderCapability = typeof OPENAI_COMPATIBLE_API_PROVIDER_CAPABILITY;

export function isApiProviderCapability(capability: unknown): capability is ApiProviderCapability {
  return capability === OPENAI_COMPATIBLE_API_PROVIDER_CAPABILITY;
}

export function resolveApiProviderCapability(_agent: Pick<AIAgent, 'executionMode'>): ApiProviderCapability {
  return OPENAI_COMPATIBLE_API_PROVIDER_CAPABILITY;
}
