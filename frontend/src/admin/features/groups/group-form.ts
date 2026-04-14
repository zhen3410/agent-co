import type { AdminGroup } from '../../types';

export interface GroupDraftInput {
  id: string;
  name: string;
  icon: string;
  agentNames: string | string[];
}

export function normalizeGroupDraft(input: GroupDraftInput, knownAgentNames: string[]): AdminGroup {
  const members = Array.isArray(input.agentNames)
    ? input.agentNames.map((item) => item.trim()).filter(Boolean)
    : input.agentNames.split(',').map((item) => item.trim()).filter(Boolean);
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const member of members) {
    if (seen.has(member)) {
      duplicates.add(member);
    }
    seen.add(member);
  }

  const unknown = members.filter((member) => !knownAgentNames.includes(member));
  if (duplicates.size > 0 || unknown.length > 0) {
    const parts: string[] = [];
    if (duplicates.size > 0) {
      parts.push(`成员中包含重复智能体: ${Array.from(duplicates).join(', ')}`);
    }
    if (unknown.length > 0) {
      parts.push(`成员中包含未知智能体: ${Array.from(new Set(unknown)).join(', ')}`);
    }
    throw new Error(parts.join('；'));
  }

  return {
    id: input.id.trim(),
    name: input.name.trim(),
    icon: input.icon.trim(),
    agentNames: members
  };
}
