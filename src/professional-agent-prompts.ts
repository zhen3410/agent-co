import promptTemplate from './professional-agent-prompts.json';

type ProfessionalAgentName = keyof typeof promptTemplate.agents;

export const PROFESSIONAL_AGENT_PROMPT_TEMPLATE = promptTemplate;
export const PROFESSIONAL_AGENT_NAMES = Object.keys(promptTemplate.agents) as ProfessionalAgentName[];

export function isProfessionalAgentName(name: string): name is ProfessionalAgentName {
  return Object.prototype.hasOwnProperty.call(promptTemplate.agents, name);
}

export function buildProfessionalAgentPrompt(name: ProfessionalAgentName): string {
  const entry = promptTemplate.agents[name];
  return [
    promptTemplate.shared,
    `职责：${entry.duties}`,
    `边界：${entry.boundaries}`,
    `输出：${entry.output}`
  ].join('');
}
