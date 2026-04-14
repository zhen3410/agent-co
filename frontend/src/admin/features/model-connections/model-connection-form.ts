import type { AdminModelConnectionDraft } from '../../types';

export interface ModelConnectionDraftInput {
  name: string;
  baseURL: string;
  apiKey?: string;
  enabled: boolean;
}

export function normalizeModelConnectionDraft(input: ModelConnectionDraftInput, preserveEmptyApiKey = false): AdminModelConnectionDraft {
  const draft: AdminModelConnectionDraft = {
    name: input.name.trim(),
    baseURL: input.baseURL.trim(),
    enabled: input.enabled
  };
  const trimmedApiKey = input.apiKey?.trim() || '';
  if (trimmedApiKey.length > 0 || !preserveEmptyApiKey) {
    draft.apiKey = trimmedApiKey;
  }
  return draft;
}
