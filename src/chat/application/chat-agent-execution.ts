import { AgentInvokeResult, Message, RichBlock } from '../../types';
import { invokeAgent } from '../../agent-invoker';
import { extractRichBlocks } from '../../rich-extract';
import type { RunAgentTask, RunAgentTaskParams } from './chat-service-types';
import type { ChatRuntime, UserChatSession } from '../runtime/chat-runtime';
import type { SessionService } from './session-service';
import type { AgentManager } from '../../agent-manager';

export interface ChatAgentExecutionDependencies {
  port: number;
  callbackAuthToken: string;
  runtime: ChatRuntime;
  sessionService: SessionService;
  agentManager: AgentManager;
}

function buildMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function buildAgentVisibleMessages(agentName: string, providerResult: AgentInvokeResult | null, fallbackMessage: Message | null, callbackReplies: Message[]): Message[] {
  if (callbackReplies.length > 0) {
    return callbackReplies;
  }

  if (providerResult && (providerResult.text || providerResult.blocks.length > 0)) {
    return [{
      id: buildMessageId(),
      role: 'assistant',
      sender: agentName,
      text: providerResult.text,
      blocks: providerResult.blocks as RichBlock[],
      timestamp: Date.now()
    }];
  }

  return fallbackMessage ? [fallbackMessage] : [];
}

function isCliWorkspaceAuthError(message: string): boolean {
  const normalized = (message || '').toLowerCase();
  return normalized.includes('deactivated_workspace')
    || normalized.includes('payment required')
    || normalized.includes('auth error')
    || normalized.includes('unauthorized')
    || normalized.includes('forbidden')
    || normalized.includes('402');
}

function isCliUsageLimitError(message: string): boolean {
  const normalized = (message || '').toLowerCase();
  return normalized.includes('usage limit')
    || normalized.includes('rate limit')
    || normalized.includes('too many requests')
    || normalized.includes('429');
}

function buildCliErrorVisibleText(message: string): string {
  const normalized = (message || '').trim();
  if (isCliWorkspaceAuthError(normalized)) {
    return '账号或工作区异常：请检查 Codex 登录状态、套餐/额度或 workspace 是否已恢复。';
  }
  if (isCliUsageLimitError(normalized)) {
    return `调用额度已用尽：请稍后重试。${normalized ? ` 原始错误：${normalized}` : ''}`.trim();
  }
  return normalized ? `CLI 调用失败：${normalized}` : 'CLI 调用失败：智能体执行异常';
}

function isInternalToolOrchestrationLeak(text: string): boolean {
  const normalized = (text || '').toLowerCase();
  if (!normalized) return false;
  const mentionsTool = normalized.includes('agent_co_get_context') || normalized.includes('agent_co_post_message');
  const mentionsOrchestration = normalized.includes('同步到群里')
    || normalized.includes('公开聊天室')
    || normalized.includes('完整会话历史')
    || normalized.includes('拿到完整历史后')
    || normalized.includes('已按要求先调用')
    || normalized.includes('先读取会话协作技能说明');
  return mentionsTool && mentionsOrchestration;
}

function buildInternalToolLeakVisibleText(): string {
  return '协作工具调用未成功：智能体未能读取完整上下文或同步公开消息，请稍后重试。';
}

function buildFallbackMessage(agentName: string, fallbackText: string): Message {
  const extracted = extractRichBlocks(fallbackText);
  return {
    id: buildMessageId(),
    role: 'assistant',
    sender: agentName,
    text: extracted.cleanText,
    blocks: extracted.blocks,
    timestamp: Date.now()
  };
}

function applyTaskMetadataToVisibleMessages(task: RunAgentTaskParams['task'], visibleMessages: Message[]): Message[] {
  if (!task.taskId || !task.callerAgentName) {
    return visibleMessages;
  }

  const calleeAgentName = task.calleeAgentName || task.agentName;
  return visibleMessages.map(message => ({
    ...message,
    taskId: task.taskId,
    callerAgentName: task.callerAgentName,
    calleeAgentName
  }));
}

export function createChatAgentExecution(deps: ChatAgentExecutionDependencies): { runAgentTask: RunAgentTask } {
  const { runtime, sessionService, agentManager } = deps;

  const runAgentTask: RunAgentTask = async (params) => {
    const { userKey, session, task, stream, onTextDelta, signal } = params;
    const { agentName, prompt, includeHistory } = task;
    const agent = agentManager.getAgent(agentName);
    if (!agent) return [];

    const runtimeWorkdir = sessionService.getAgentWorkdir(userKey, session.id, agentName) || agent.workdir;
    const runtimeAgent = runtimeWorkdir ? { ...agent, workdir: runtimeWorkdir } : agent;
    const logTag = stream ? 'ChatStream' : 'Chat';
    const isApiMode = runtimeAgent.executionMode === 'api';
    const startStage = isApiMode ? 'api_start' : 'cli_start';
    const doneStage = isApiMode ? 'api_done' : 'cli_done';
    const errorStage = isApiMode ? 'api_error' : 'cli_error';

    console.log(`[${logTag}] 调用 AI: ${agentName}`);
    runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${agentName} stage=start stream=${stream}`);
    runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${agentName} stage=${startStage} stream=${stream}`);

    const callbackEnv: Record<string, string> = {
      AGENT_CO_API_URL: `http://127.0.0.1:${deps.port}`,
      AGENT_CO_SESSION_ID: session.id,
      AGENT_CO_AGENT_NAME: agentName,
      AGENT_CO_CALLBACK_TOKEN: deps.callbackAuthToken,
      AGENT_CO_DISPATCH_KIND: runtime.normalizeDispatchKind(task.dispatchKind) || 'initial'
    };

    let fallbackMessage: Message | null = null;
    let providerResult: AgentInvokeResult | null = null;
    try {
      const result = await invokeAgent({
        userMessage: prompt,
        agent: runtimeAgent,
        history: session.history,
        includeHistory,
        extraEnv: callbackEnv,
        onTextDelta,
        signal
      });
      providerResult = result;
      runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${agentName} stage=${doneStage} text_len=${result.text.length} blocks=${result.blocks.length}`);
    } catch (error: unknown) {
      const err = error as Error;
      console.log(`[${logTag}] AI 调用失败: ${err.message}`);
      runtime.appendOperationalLog('error', 'chat-exec', `session=${session.id} agent=${agentName} stage=${errorStage} error=${err.message}`);
      const fallbackText = isApiMode
        ? `API 调用失败：${err.message}`
        : buildCliErrorVisibleText(err.message);
      fallbackMessage = buildFallbackMessage(agentName, fallbackText);
    }

    const callbackReplies = runtime.consumeCallbackMessages(session.id, agentName);
    const visibleMessages = applyTaskMetadataToVisibleMessages(
      task,
      buildAgentVisibleMessages(agentName, providerResult, fallbackMessage, callbackReplies)
    );

    if (callbackReplies.length === 0) {
      for (const message of visibleMessages) {
        if (isInternalToolOrchestrationLeak(message.text || '')) {
          runtime.appendOperationalLog('error', 'chat-exec', `session=${session.id} agent=${agentName} stage=internal_tool_leak_filtered`);
          message.text = buildInternalToolLeakVisibleText();
          message.blocks = [];
        }
      }
    }

    if (callbackReplies.length === 0 && providerResult && (providerResult.text || providerResult.blocks.length > 0)) {
      runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${agentName} stage=direct_fallback reason=no_callback`);
    }

    if (visibleMessages.length === 0) {
      runtime.appendOperationalLog('error', 'chat-exec', `session=${session.id} agent=${agentName} stage=empty_visible_message`);
    }

    return visibleMessages;
  };

  return {
    runAgentTask
  };
}
