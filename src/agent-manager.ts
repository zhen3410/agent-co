/**
 * agent-manager.ts
 *
 * 功能：管理多个 AI 智能体
 */

import { AIAgent, AIAgentConfig, Message } from './types';

// 预设的智能体配置
const DEFAULT_AGENTS: AIAgentConfig[] = [
  {
    name: 'Claude',
    avatar: '🤖',
    personality: '你是一个友好的 AI 助手，回答简洁准确。擅长技术问题和编程。',
    color: '#3b82f6'
  },
  {
    name: 'Alice',
    avatar: '👩‍💻',
    personality: '你是一个富有创造力的 AI 助手，喜欢用生动的语言回答问题。擅长艺术和设计。',
    color: '#22c55e'
  },
  {
    name: 'Bob',
    avatar: '🧑‍💻',
    personality: '你是一个务实的 AI 助手，喜欢用简单直接的方式解决问题。擅长工程实践。',
    color: '#f97316'
  }
];

/**
 * AI 智能体管理器
 */
export class AgentManager {
  private agents: Map<string, AIAgent> = new Map();
  private agentConfigs: Map<string, AIAgentConfig> = new Map();

  constructor(customAgents?: AIAgentConfig[]) {
    // 初始化默认智能体
    for (const config of DEFAULT_AGENTS) {
      this.addAgent(config);
    }
    // 添加自定义智能体
    if (customAgents) {
      for (const config of customAgents) {
        this.addAgent(config);
      }
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
      color: config.color
    };
    this.agents.set(config.name, agent);
    this.agentConfigs.set(config.name, config);
    console.log(`[AgentManager] 添加智能体: ${config.name}`);
  }

  /**
   * 构建系统提示词
   */
  private buildSystemPrompt(config: AIAgentConfig): string {
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

  /**
   * 获取所有智能体
   */
  getAgents(): AIAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * 获取智能体配置
   */
  getAgentConfigs(): AIAgentConfig[] {
    return Array.from(this.agentConfigs.values());
  }

  /**
   * 根据名字获取智能体
   */
  getAgent(name: string): AIAgent | undefined {
    return this.agents.get(name);
  }

  /**
   * 检查智能体是否存在
   */
  hasAgent(name: string): boolean {
    return this.agents.has(name);
  }

  /**
   * 从消息中提取 @ 提及
   */
  extractMentions(text: string): string[] {
    const mentionRegex = /@([^\s@]+)/g;
    const mentions: string[] = [];
    let match;

    while ((match = mentionRegex.exec(text)) !== null) {
      const mentionName = match[1].trim();
      if (!mentionName) continue;

      if (mentionName === 'all' || mentionName === '所有人') {
        mentions.push(...this.agentConfigs.keys());
        continue;
      }

      if (this.hasAgent(mentionName)) {
        mentions.push(mentionName);
      }
    }

    // 去重
    return [...new Set(mentions)];
  }

  /**
   * 获取被 @ 的智能体列表
   */
  getMentionedAgents(text: string): AIAgent[] {
    const mentions = this.extractMentions(text);
    const agents: AIAgent[] = [];
    for (const name of mentions) {
      const agent = this.getAgent(name);
      if (agent) {
        agents.push(agent);
      }
    }
    return agents;
  }

  /**
   * 移除智能体
   */
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
