import type { AdminAgent } from '../../types';

export interface AgentDraftInput {
  name: string;
  avatar: string;
  personality: string;
  color: string;
  systemPrompt: string;
  workdir: string;
  executionMode: 'cli' | 'api';
  cliName: 'codex' | 'claude';
  apiConnectionId: string;
  apiModel: string;
}

export function normalizeAgentDraft(input: AgentDraftInput, existing?: Partial<AdminAgent>): AdminAgent {
  return {
    name: input.name.trim(),
    avatar: input.avatar.trim() || '🤖',
    personality: input.personality.trim(),
    color: input.color.trim() || '#2563eb',
    systemPrompt: input.systemPrompt.trim(),
    workdir: input.workdir.trim(),
    executionMode: input.executionMode,
    cliName: input.executionMode === 'cli' ? input.cliName : undefined,
    apiConnectionId: input.executionMode === 'api' ? input.apiConnectionId.trim() || undefined : undefined,
    apiModel: input.executionMode === 'api' ? input.apiModel.trim() || undefined : undefined,
    apiTemperature: input.executionMode === 'api' ? existing?.apiTemperature : undefined,
    apiMaxTokens: input.executionMode === 'api' ? existing?.apiMaxTokens : undefined
  };
}
