/**
 * agent-manager.ts
 *
 * 功能：管理多个 AI 智能体
 */

import { AIAgent, AIAgentConfig } from './types';

const CODEX_ARCHITECT_PROMPT = `你是 Codex，一名经验丰富的软件架构师与工程教练。

你的核心目标：
1. 给出可落地、可维护、可扩展的方案。
2. 始终坚持高内聚、低耦合、单一职责、明确边界。
3. 优先考虑长期维护成本，而不仅是短期实现速度。

回答要求：
- 先澄清问题背景与约束，再给方案。
- 方案默认包含：架构分层、关键模块职责、接口边界、数据流、异常处理、测试策略。
- 面对实现问题时，给出「最小可行实现（MVP）」和「演进路线」。
- 对潜在风险（性能、并发、安全、可观测性）做显式提示。
- 如果需求不完整，先列出假设，并给出需要确认的问题清单。

输出风格：
- 结构化、简洁、专业。
- 对复杂主题优先使用分点和小标题。
- 在结论前给出权衡（trade-off），说明为什么这样设计。`;

// 预设的智能体配置
export const DEFAULT_AGENTS: AIAgentConfig[] = [
  {
    name: 'Claude',
    avatar: '🤖',
    personality: '你是一个友好的 AI 助手，回答简洁准确。擅长技术问题和编程。',
    color: '#3b82f6',
    cli: 'claude'
  },
  {
    name: 'Codex架构师',
    avatar: '🏗️',
    personality: '资深架构师，强调高内聚低耦合、可维护性与工程实践。',
    color: '#8b5cf6',
    cli: 'codex',
    systemPrompt: CODEX_ARCHITECT_PROMPT
  },
  {
    name: 'Alice',
    avatar: '👩‍💻',
    personality: '你是一个富有创造力的 AI 助手，喜欢用生动的语言回答问题。擅长艺术和设计。',
    color: '#22c55e',
    cli: 'claude'
  },
  {
    name: 'Bob',
    avatar: '🧑‍💻',
    personality: '你是一个务实的 AI 助手，喜欢用简单直接的方式解决问题。擅长工程实践。',
    color: '#f97316',
    cli: 'claude'
  }
];

/**
 * AI 智能体管理器
 */
export class AgentManager {
  private agents: Map<string, AIAgent> = new Map();
  private agentConfigs: Map<string, AIAgentConfig> = new Map();

  private normalizeMentionToken(token: string): string {
    return token
      .trim()
      .replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '')
      .toLowerCase();
  }

  constructor(customAgents?: AIAgentConfig[]) {
    const initialAgents = customAgents && customAgents.length > 0 ? customAgents : DEFAULT_AGENTS;
    this.replaceAgents(initialAgents);
  }

  replaceAgents(configs: AIAgentConfig[]): void {
    this.agents.clear();
    this.agentConfigs.clear();

    for (const config of configs) {
      this.addAgent(config);
    }
  }

  /**
   * 添加智能体
   */
  addAgent(config: AIAgentConfig): void {
    const systemPrompt = this.buildSystemPrompt(config);
    const agent: AIAgent = {
      name: config.name,
      avatar: config.avatar,
      systemPrompt,
      color: config.color,
      cli: config.cli || 'claude'
    };
    this.agents.set(config.name, agent);
    this.agentConfigs.set(config.name, config);
    console.log(`[AgentManager] 添加智能体: ${config.name}`);
  }

  /**
   * 构建系统提示词
   */
  private buildSystemPrompt(config: AIAgentConfig): string {
    if (config.systemPrompt && config.systemPrompt.trim()) {
      return config.systemPrompt.trim();
    }

    return `你是 ${config.name}，一个 AI 助手。

你的性格: ${config.personality}

你可以使用特殊格式发送富文本卡片，让回复更加美观。

格式说明：
\`\`\`cc_rich
{
  "kind": "card",
  "title": "标题",
  "body": "内容",
  "tone": "info" | "success" | "warning"
}
\`\`\`

\`\`\`cc_rich
{
  "kind": "checklist",
  "title": "标题",
  "items": [
    { "text": "任务内容", "done": false },
    { "text": "已完成的任务", "done": true }
  ]
}
\`\`\`

使用场景：
- 当你想强调某个重要信息时，使用 card（tone: info 用于提示， success 用于成功, warning 用于警告）
- 当你要列出待办事项或任务清单时,使用 checklist
- 你可以在一条消息中使用多个 cc_rich 块

普通文本和 cc_rich 块可以混合使用,让回复更加丰富。`;
  }

  getAgents(): AIAgent[] {
    return Array.from(this.agents.values());
  }

  getAgentConfigs(): AIAgentConfig[] {
    return Array.from(this.agentConfigs.values());
  }

  getAgent(name: string): AIAgent | undefined {
    return this.agents.get(name);
  }

  hasAgent(name: string): boolean {
    return this.agents.has(name);
  }

  extractMentions(text: string): string[] {
    const mentionRegex = /[@＠]([^\s@＠，。！？、,:：；;]+)/g;
    const mentions: string[] = [];
    const normalizedAgentNames = new Map<string, string>();
    for (const agentName of this.agentConfigs.keys()) {
      normalizedAgentNames.set(this.normalizeMentionToken(agentName), agentName);
    }
    let match;

    while ((match = mentionRegex.exec(text)) !== null) {
      const mentionName = this.normalizeMentionToken(match[1] || '');
      if (!mentionName) {
        continue;
      }

      if (mentionName === 'all' || mentionName === 'everyone' || mentionName === '所有人') {
        mentions.push(...this.agentConfigs.keys());
        continue;
      }

      const matchedName = normalizedAgentNames.get(mentionName);
      if (matchedName) {
        mentions.push(matchedName);
      }
    }

    return [...new Set(mentions)];
  }

  removeAgent(name: string): boolean {
    if (this.agents.has(name)) {
      this.agents.delete(name);
      this.agentConfigs.delete(name);
      console.log(`[AgentManager] 移除智能体: ${name}`);
      return true;
    }
    return false;
  }
}
