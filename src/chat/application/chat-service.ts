import { AIAgentConfig, AgentInvokeResult, Message, RichBlock } from '../../types';
import { AgentManager } from '../../agent-manager';
import { generateMockReply } from '../../claude-cli';
import { invokeAgent } from '../../agent-invoker';
import { extractRichBlocks } from '../../rich-extract';
import { addBlock, getStatus as getBlockBufferStatus } from '../../block-buffer';
import { SessionService, SessionUserContext } from './session-service';
import { ChatRuntime, PendingAgentDispatchTask, UserChatSession } from '../runtime/chat-runtime';

export class ChatServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'ChatServiceError';
  }
}

interface AgentDispatchTask {
  agentName: string;
  prompt: string;
  includeHistory: boolean;
  dispatchKind?: Message['dispatchKind'];
}

export interface ChatServiceDependencies {
  port: number;
  defaultUserName: string;
  callbackAuthToken: string;
  sessionService: SessionService;
  runtime: ChatRuntime;
  agentManager: AgentManager;
  syncAgentsFromStore(): void;
}

export interface StreamMessageCallbacks {
  shouldContinue(): boolean;
  onUserMessage(message: Message): void;
  onThinking(agentName: string): void;
  onTextDelta(agentName: string, delta: string): void;
  onMessage(message: Message): boolean;
}

export interface ChatService {
  listAgents(): AIAgentConfig[];
  sendMessage(context: SessionUserContext, body: { message: string; sender?: string }): Promise<{ success: true; userMessage: Message; aiMessages: Message[]; currentAgent: string | null; notice?: string }>;
  streamMessage(context: SessionUserContext, body: { message: string; sender?: string }, callbacks: StreamMessageCallbacks): Promise<{ currentAgent: string | null; notice?: string; hadVisibleMessages: boolean; emptyVisibleMessage?: string }>;
  resumePendingChat(context: SessionUserContext): Promise<{ success: true; resumed: boolean; aiMessages: Message[]; currentAgent: string | null; notice?: string }>;
  summarizeChat(context: SessionUserContext, sessionId?: string): Promise<{ success: true; aiMessages: Message[]; currentAgent: string | null }>;
  createBlock(payload: { sessionId?: string; block: RichBlock }): { success: true; block: RichBlock };
  getBlockStatus(): ReturnType<typeof getBlockBufferStatus>;
  postCallbackMessage(sessionId: string, agentName: string, content: string, invokeAgents?: string[]): { status: 'ok' };
  getThreadContext(sessionId: string): { sessionId: string; messages: Message[] };
}

export function createChatService(deps: ChatServiceDependencies): ChatService {
  const { sessionService, runtime, agentManager } = deps;

  function listAgents(): AIAgentConfig[] {
    deps.syncAgentsFromStore();
    return agentManager.getAgentConfigs();
  }

  function collectEligibleMentions(message: string, session: UserChatSession): { mentions: string[]; ignoredMentions: string[] } {
    const allMentions = agentManager.extractMentions(message);
    const enabledSet = new Set(sessionService.getSessionEnabledAgents(session));
    return {
      mentions: allMentions.filter(name => enabledSet.has(name)),
      ignoredMentions: allMentions.filter(name => !enabledSet.has(name))
    };
  }

  function collectImplicitPeerContinuationMentions(message: string, session: UserChatSession, sender?: string | null): string[] {
    const text = message || '';
    if (!text) return [];

    const continuationHints = '(?:请|继续|补充|回应|跟进|接着|展开|说明|回答|评估|接力|发表|给出|看看|确认|讲讲)';
    const handoffHints = '(?:请|让|由|烦请|麻烦)';
    const matches: string[] = [];

    for (const agentName of sessionService.getSessionEnabledAgents(session)) {
      if (!agentName || agentName === sender) {
        continue;
      }

      const escapedName = agentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const directHandoffPattern = new RegExp(`${handoffHints}\\s*@${escapedName}(?=\\s|$|[，。！？、,:：；;])`, 'u');
      const mentionThenContinuePattern = new RegExp(`@${escapedName}\\s*(?=${continuationHints})`, 'u');

      if (directHandoffPattern.test(text) || mentionThenContinuePattern.test(text)) {
        matches.push(agentName);
      }
    }

    return matches;
  }

  function buildAgentVisibleMessages(agentName: string, providerResult: AgentInvokeResult | null, fallbackMessage: Message | null, callbackReplies: Message[]): Message[] {
    if (callbackReplies.length > 0) {
      return callbackReplies;
    }

    if (providerResult && (providerResult.text || providerResult.blocks.length > 0)) {
      return [{
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: 'assistant',
        sender: agentName,
        text: providerResult.text,
        blocks: providerResult.blocks as RichBlock[],
        timestamp: Date.now()
      }];
    }

    return fallbackMessage ? [fallbackMessage] : [];
  }

  function shouldSurfaceCliError(message: string): boolean {
    const normalized = (message || '').toLowerCase();
    if (!normalized) return false;

    return normalized.includes('deactivated_workspace')
      || normalized.includes('payment required')
      || normalized.includes('usage limit')
      || normalized.includes('rate limit')
      || normalized.includes('too many requests')
      || normalized.includes('auth error')
      || normalized.includes('unauthorized')
      || normalized.includes('forbidden')
      || normalized.includes('402');
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
    const mentionsTool = normalized.includes('bot_room_get_context') || normalized.includes('bot_room_post_message');
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

  async function runAgentTask(params: {
    userKey: string;
    session: UserChatSession;
    task: AgentDispatchTask;
    stream: boolean;
    onTextDelta?: (delta: string) => void;
  }): Promise<Message[]> {
    const { userKey, session, task, stream, onTextDelta } = params;
    const { agentName, prompt, includeHistory } = task;
    const agent = agentManager.getAgent(agentName);
    if (!agent) return [];

    const runtimeWorkdir = sessionService.getUserAgentWorkdir(userKey, session.id, agentName) || agent.workdir;
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
      BOT_ROOM_API_URL: `http://127.0.0.1:${deps.port}`,
      BOT_ROOM_SESSION_ID: session.id,
      BOT_ROOM_AGENT_NAME: agentName,
      BOT_ROOM_CALLBACK_TOKEN: deps.callbackAuthToken,
      BOT_ROOM_DISPATCH_KIND: runtime.normalizeDispatchKind(task.dispatchKind) || 'initial'
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
        onTextDelta
      });
      providerResult = result;
      runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${agentName} stage=${doneStage} text_len=${result.text.length} blocks=${result.blocks.length}`);
    } catch (error: unknown) {
      const err = error as Error;
      console.log(`[${logTag}] AI 调用失败: ${err.message}`);
      const surfaceCliError = !isApiMode && shouldSurfaceCliError(err.message);
      if (!stream && !isApiMode && !surfaceCliError) {
        console.log('[Chat] 使用模拟回复');
      }
      runtime.appendOperationalLog('error', 'chat-exec', `session=${session.id} agent=${agentName} stage=${errorStage} error=${err.message}`);
      const fallbackText = isApiMode
        ? `API 调用失败：${err.message}`
        : surfaceCliError
          ? buildCliErrorVisibleText(err.message)
          : generateMockReply(prompt, agentName);
      const extracted = extractRichBlocks(fallbackText);
      fallbackMessage = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: 'assistant',
        sender: agentName,
        text: extracted.cleanText,
        blocks: extracted.blocks,
        timestamp: Date.now()
      };
    }

    const callbackReplies = runtime.consumeCallbackMessages(session.id, agentName);
    const visibleMessages = buildAgentVisibleMessages(agentName, providerResult, fallbackMessage, callbackReplies);

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
  }

  async function executeAgentTurn(params: {
    userKey: string;
    session: UserChatSession;
    initialTasks: AgentDispatchTask[];
    stream: boolean;
    onThinking?: (agentName: string) => void;
    onTextDelta?: (agentName: string, delta: string) => void;
    onMessage?: (message: Message) => void;
    shouldContinue?: () => boolean;
    pendingTasks?: PendingAgentDispatchTask[];
  }): Promise<{ aiMessages: Message[]; pendingTasks: PendingAgentDispatchTask[] }> {
    const { userKey, session, initialTasks, stream, onThinking, onTextDelta, onMessage, shouldContinue } = params;
    const queue: PendingAgentDispatchTask[] = Array.isArray(params.pendingTasks)
      ? params.pendingTasks.map(task => ({ ...task, dispatchKind: runtime.normalizeDispatchKind(task.dispatchKind) || 'initial' }))
      : initialTasks.map(task => ({ ...task, dispatchKind: runtime.normalizeDispatchKind(task.dispatchKind) || 'initial' }));
    const aiMessages: Message[] = [];
    const callCounts = new Map<string, number>();
    const { agentChainMaxHops, agentChainMaxCallsPerAgent } = runtime.buildSessionResponse(session);
    const { discussionMode } = runtime.buildSessionResponse(session);
    let chainedCalls = 0;
    let streamStopped = false;
    let sawVisibleMessage = false;

    const canContinue = () => shouldContinue ? shouldContinue() : true;

    while (queue.length > 0) {
      if (!canContinue()) {
        streamStopped = true;
        runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} stage=stream_stop reason=client_disconnect`);
        break;
      }

      const task = queue.shift()!;
      if (runtime.isChainedDispatchKind(task.dispatchKind) && chainedCalls >= agentChainMaxHops) {
        runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} stage=chain_stop reason=max_hops hops=${agentChainMaxHops}`);
        break;
      }

      const currentCalls = callCounts.get(task.agentName) || 0;
      if (agentChainMaxCallsPerAgent !== null && currentCalls >= agentChainMaxCallsPerAgent) {
        runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${task.agentName} stage=chain_skip reason=max_calls count=${currentCalls}`);
        continue;
      }

      callCounts.set(task.agentName, currentCalls + 1);
      if (runtime.isChainedDispatchKind(task.dispatchKind)) {
        chainedCalls += 1;
      }
      onThinking?.(task.agentName);

      const visibleMessages = await runAgentTask({
        userKey,
        session,
        task,
        stream,
        onTextDelta: onTextDelta
          ? (delta) => onTextDelta(task.agentName, delta)
          : undefined
      });

      for (const rawMessage of visibleMessages) {
        const { mentions: referenceMentions } = collectEligibleMentions(rawMessage.text || '', session);

        let chainTargets: string[];
        if (rawMessage.invokeAgents && rawMessage.invokeAgents.length > 0) {
          chainTargets = rawMessage.invokeAgents;
        } else {
          chainTargets = agentManager.extractChainInvocations(rawMessage.text || '');
          if (chainTargets.length === 0 && discussionMode === 'peer') {
            chainTargets = collectImplicitPeerContinuationMentions(rawMessage.text || '', session, rawMessage.sender);
            if (chainTargets.length > 0) {
              runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${rawMessage.sender || task.agentName} stage=implicit_single_at_upgrade targets=${chainTargets.join(',')}`);
            }
          }
        }
        const chainedMentions = chainTargets.filter(name => name !== rawMessage.sender && agentManager.hasAgent(name));

        let displayText = rawMessage.text || '';
        if (rawMessage.invokeAgents && rawMessage.invokeAgents.length > 0 && !agentManager.extractChainInvocations(displayText).length) {
          for (const agentName of rawMessage.invokeAgents) {
            const escapedName = agentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            displayText = displayText.replace(new RegExp(`@${escapedName}`, 'g'), `@@${agentName}`);
          }
        }
        if (discussionMode === 'peer' && chainTargets.length > 0 && !agentManager.extractChainInvocations(displayText).length) {
          for (const agentName of chainTargets) {
            const escapedName = agentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            displayText = displayText.replace(new RegExp(`@${escapedName}`, 'g'), `@@${agentName}`);
          }
        }

        const message = {
          ...rawMessage,
          text: displayText,
          mentions: referenceMentions.length > 0 ? referenceMentions : undefined,
          invokeAgents: chainedMentions.length > 0 ? chainedMentions : undefined,
          dispatchKind: task.dispatchKind
        };

        sawVisibleMessage = true;
        session.history.push(message);
        aiMessages.push(message);
        sessionService.touchSession(session);
        onMessage?.(message);
        if (stream) {
          await new Promise<void>(resolve => setImmediate(resolve));
        }
        const pendingMentionsToQueue: PendingAgentDispatchTask[] = [];
        const allowContinuationQueue = task.dispatchKind !== 'summary';

        for (const mention of allowContinuationQueue ? chainedMentions : []) {
          const queuedChainedCalls = queue.filter(item => runtime.isChainedDispatchKind(item.dispatchKind)).length;
          if (chainedCalls + queuedChainedCalls + pendingMentionsToQueue.length >= agentChainMaxHops) {
            break;
          }

          const queuedCalls = callCounts.get(mention) || 0;
          const pendingCalls = queue.filter(item => item.agentName === mention).length
            + pendingMentionsToQueue.filter(item => item.agentName === mention).length;
          if (agentChainMaxCallsPerAgent !== null && queuedCalls + pendingCalls >= agentChainMaxCallsPerAgent) {
            runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${mention} stage=chain_skip reason=max_calls_pending count=${queuedCalls} pending=${pendingCalls}`);
            continue;
          }

          pendingMentionsToQueue.push({
            agentName: mention,
            prompt: message.text || '',
            includeHistory: true,
            dispatchKind: 'explicit_chained'
          });
        }

        if (!canContinue()) {
          streamStopped = true;
          queue.unshift(...pendingMentionsToQueue);
          runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${task.agentName} stage=stream_stop_after_message reason=client_disconnect`);
          break;
        }

        queue.push(...pendingMentionsToQueue);

        if (streamStopped) {
          break;
        }
      }

      if (streamStopped) {
        break;
      }
    }

    if (!streamStopped && discussionMode === 'peer' && sawVisibleMessage) {
      const hasPendingExplicitContinuation = queue.some(task => task.dispatchKind === 'explicit_chained');
      if (hasPendingExplicitContinuation) {
        session.discussionState = 'active';
      } else {
        session.discussionState = 'paused';
        runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} stage=discussion_pause reason=no_explicit_continuation mode=peer`);
      }
      sessionService.touchSession(session);
    }

    return {
      aiMessages,
      pendingTasks: streamStopped ? queue.map(task => ({ ...task, dispatchKind: runtime.normalizeDispatchKind(task.dispatchKind) || 'initial' })) : []
    };
  }

  async function sendMessage(context: SessionUserContext, body: { message: string; sender?: string }): Promise<{ success: true; userMessage: Message; aiMessages: Message[]; currentAgent: string | null; notice?: string }> {
    deps.syncAgentsFromStore();
    const { message, sender: bodySender } = body;
    const sender = bodySender || deps.defaultUserName;
    if (!message) {
      throw new ChatServiceError('缺少 message 字段', 400);
    }

    const { userKey, session } = sessionService.resolveChatSession(context);
    if (sessionService.isSessionSummaryInProgress(userKey, session)) {
      throw new ChatServiceError('当前会话正在生成总结，暂时不能发送新消息，请稍后再试。', 409);
    }
    const sessionId = `${userKey}::${session.id}`;
    const currentAgent = sessionService.expireDisabledCurrentAgent(userKey, session);
    session.discussionState = 'active';
    session.pendingAgentTasks = undefined;
    session.pendingVisibleMessages = undefined;

    console.log(`\n[Chat] 会话 ${sessionId.substring(0, 12)}... 用户 ${sender}: ${message}`);

    const { mentions, ignoredMentions } = collectEligibleMentions(message, session);
    console.log(`[Chat] @ 提及: ${mentions.join(', ') || '无'}`);

    const agentsToRespond: string[] = [];

    if (mentions.length > 0) {
      for (const mention of mentions) {
        agentsToRespond.push(mention);
      }
      sessionService.setUserCurrentAgent(userKey, session.id, mentions[0]);
      console.log(`[Chat] 设置当前对话智能体: ${mentions[0]}`);
    } else if (currentAgent) {
      agentsToRespond.push(currentAgent);
      console.log(`[Chat] 继续与 ${currentAgent} 对话`);
    }

    const userMessage: Message = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      sender,
      text: message,
      timestamp: Date.now(),
      mentions: mentions.length > 0 ? mentions : undefined
    };

    session.history.push(userMessage);
    sessionService.touchSession(session);

    if (agentsToRespond.length === 0) {
      return {
        success: true,
        userMessage,
        aiMessages: [],
        currentAgent: sessionService.getUserCurrentAgent(userKey, session.id),
        notice: sessionService.buildNoEnabledAgentsNotice(session, ignoredMentions)
      };
    }

    session.pendingAgentTasks = undefined;
    const { aiMessages } = await executeAgentTurn({
      userKey,
      session,
      initialTasks: agentsToRespond.map(agentName => ({
        agentName,
        prompt: message,
        includeHistory: mentions.length === 0
      })),
      stream: false
    });
    const emptyVisibleNotice = aiMessages.length === 0
      ? `${agentsToRespond.join('、')} 未返回可见消息，请稍后重试或查看日志。`
      : undefined;

    return {
      success: true,
      userMessage,
      aiMessages,
      currentAgent: sessionService.getUserCurrentAgent(userKey, session.id),
      notice: emptyVisibleNotice || (ignoredMentions.length > 0 ? `${ignoredMentions.join('、')} 已停用，未参与本次对话。` : undefined)
    };
  }

  async function streamMessage(context: SessionUserContext, body: { message: string; sender?: string }, callbacks: StreamMessageCallbacks): Promise<{ currentAgent: string | null; notice?: string; hadVisibleMessages: boolean; emptyVisibleMessage?: string }> {
    deps.syncAgentsFromStore();
    const { message, sender: bodySender } = body;
    const sender = bodySender || deps.defaultUserName;
    if (!message) {
      throw new ChatServiceError('缺少 message 字段', 400);
    }

    const { userKey, session } = sessionService.resolveChatSession(context);
    if (sessionService.isSessionSummaryInProgress(userKey, session)) {
      throw new ChatServiceError('当前会话正在生成总结，暂时不能发送新消息，请稍后再试。', 409);
    }
    const sessionId = `${userKey}::${session.id}`;
    const currentAgent = sessionService.expireDisabledCurrentAgent(userKey, session);
    session.discussionState = 'active';
    session.pendingAgentTasks = undefined;
    session.pendingVisibleMessages = undefined;

    console.log(`\n[ChatStream] 会话 ${sessionId.substring(0, 12)}... 用户 ${sender}: ${message}`);
    const { mentions, ignoredMentions } = collectEligibleMentions(message, session);
    console.log(`[ChatStream] @ 提及: ${mentions.join(', ') || '无'}`);

    const agentsToRespond: string[] = [];
    if (mentions.length > 0) {
      for (const mention of mentions) {
        agentsToRespond.push(mention);
      }
      sessionService.setUserCurrentAgent(userKey, session.id, mentions[0]);
      console.log(`[ChatStream] 设置当前对话智能体: ${mentions[0]}`);
    } else if (currentAgent) {
      agentsToRespond.push(currentAgent);
      console.log(`[ChatStream] 继续与 ${currentAgent} 对话`);
    }

    const userMessage: Message = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      sender,
      text: message,
      timestamp: Date.now(),
      mentions: mentions.length > 0 ? mentions : undefined
    };
    session.history.push(userMessage);
    sessionService.touchSession(session);
    callbacks.onUserMessage(userMessage);

    if (agentsToRespond.length === 0) {
      return {
        currentAgent: sessionService.getUserCurrentAgent(userKey, session.id),
        notice: sessionService.buildNoEnabledAgentsNotice(session, ignoredMentions),
        hadVisibleMessages: false
      };
    }

    const undeliveredMessages: Message[] = [];
    session.pendingAgentTasks = undefined;
    const executionResult = await executeAgentTurn({
      userKey,
      session,
      initialTasks: agentsToRespond.map(agentName => ({
        agentName,
        prompt: message,
        includeHistory: mentions.length === 0
      })),
      stream: true,
      shouldContinue: callbacks.shouldContinue,
      onThinking: callbacks.onThinking,
      onTextDelta: callbacks.onTextDelta,
      onMessage: (visibleMessage) => {
        const delivered = callbacks.onMessage(visibleMessage);
        if (!delivered) {
          undeliveredMessages.push(visibleMessage);
        }
      }
    });
    session.pendingAgentTasks = executionResult.pendingTasks.length > 0 ? executionResult.pendingTasks : undefined;
    session.pendingVisibleMessages = undeliveredMessages.length > 0 ? undeliveredMessages : undefined;

    return {
      currentAgent: sessionService.getUserCurrentAgent(userKey, session.id),
      notice: ignoredMentions.length > 0 ? `${ignoredMentions.join('、')} 已停用，未参与本次对话。` : undefined,
      hadVisibleMessages: executionResult.aiMessages.length > 0,
      emptyVisibleMessage: executionResult.aiMessages.length === 0
        ? `${agentsToRespond.join('、')} 未返回可见消息，请稍后重试或查看日志。`
        : undefined
    };
  }

  async function resumePendingChat(context: SessionUserContext): Promise<{ success: true; resumed: boolean; aiMessages: Message[]; currentAgent: string | null; notice?: string }> {
    deps.syncAgentsFromStore();
    const { userKey, session } = sessionService.resolveChatSession(context);
    if (sessionService.isSessionSummaryInProgress(userKey, session)) {
      throw new ChatServiceError('当前会话正在生成总结，暂时不能继续执行剩余链路，请稍后再试。', 409);
    }
    const pendingVisibleMessages = Array.isArray(session.pendingVisibleMessages)
      ? session.pendingVisibleMessages.map(message => ({ ...message }))
      : [];
    const pendingTasks = Array.isArray(session.pendingAgentTasks)
      ? session.pendingAgentTasks.map(task => ({ ...task }))
      : [];

    if (pendingVisibleMessages.length === 0 && pendingTasks.length === 0) {
      return {
        success: true,
        resumed: false,
        aiMessages: [],
        currentAgent: sessionService.getUserCurrentAgent(userKey, session.id),
        notice: '当前没有可继续执行的剩余链路。'
      };
    }

    session.pendingVisibleMessages = undefined;
    session.pendingAgentTasks = undefined;
    const { aiMessages, pendingTasks: remainingTasks } = await executeAgentTurn({
      userKey,
      session,
      initialTasks: [],
      pendingTasks,
      stream: false
    });
    session.pendingAgentTasks = remainingTasks.length > 0 ? remainingTasks : undefined;
    const resumedMessages = [...pendingVisibleMessages, ...aiMessages];

    return {
      success: true,
      resumed: true,
      aiMessages: resumedMessages,
      currentAgent: sessionService.getUserCurrentAgent(userKey, session.id),
      notice: remainingTasks.length > 0 ? '仍有未完成链路，可再次继续执行。' : undefined
    };
  }

  async function summarizeChat(context: SessionUserContext, requestedSessionId?: string): Promise<{ success: true; aiMessages: Message[]; currentAgent: string | null }> {
    deps.syncAgentsFromStore();
    const { userKey } = context;
    const sessions = runtime.ensureUserSessions(userKey);
    const activeSessionId = runtime.resolveActiveSession(userKey).id;
    const resolvedSessionId = (requestedSessionId || '').trim() || activeSessionId;
    const session = sessions.get(resolvedSessionId) || (!(requestedSessionId || '').trim() ? sessions.get(activeSessionId) || sessions.values().next().value : null);
    if (!session) {
      throw new ChatServiceError('会话不存在', 400);
    }

    if (runtime.normalizeDiscussionMode(session.discussionMode) !== 'peer') {
      throw new ChatServiceError('仅 peer 模式支持手动生成总结', 400);
    }

    const summaryAgent = sessionService.resolveManualSummaryAgent(session);
    if (!summaryAgent) {
      throw new ChatServiceError('当前会话没有可用于生成总结的智能体', 400);
    }

    const summaryLockKey = `${userKey}::${session.id}`;
    if (!runtime.beginSummaryRequest(summaryLockKey)) {
      throw new ChatServiceError('当前会话已有总结任务进行中，请稍后再试。', 409);
    }

    const preSummaryState = sessionService.snapshotSummaryContinuationState(session);
    try {
      session.discussionState = 'summarizing';
      session.pendingAgentTasks = undefined;
      session.pendingVisibleMessages = undefined;
      sessionService.touchSession(session);
      runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} stage=discussion_summary_start agent=${summaryAgent}`);

      const { aiMessages } = await executeAgentTurn({
        userKey,
        session,
        initialTasks: [{
          agentName: summaryAgent,
          prompt: sessionService.buildManualSummaryPrompt(session),
          includeHistory: true,
          dispatchKind: 'summary'
        }],
        stream: false
      });

      sessionService.restoreSummaryContinuationState(session, preSummaryState);
      runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} stage=discussion_summary_done agent=${summaryAgent} messages=${aiMessages.length}`);

      return {
        success: true,
        aiMessages,
        currentAgent: sessionService.getUserCurrentAgent(userKey, session.id)
      };
    } catch (error) {
      if (runtime.normalizeDiscussionMode(session.discussionMode) === 'peer' && session.discussionState === 'summarizing') {
        sessionService.restoreSummaryContinuationState(session, preSummaryState);
      }
      throw error;
    } finally {
      runtime.endSummaryRequest(summaryLockKey);
    }
  }

  function createBlock(payload: { sessionId?: string; block: RichBlock }): { success: true; block: RichBlock } {
    const { sessionId = 'default', block } = payload;
    if (!block) {
      throw new ChatServiceError('缺少 block 字段', 400);
    }

    const sid = sessionId || 'default';
    const addedBlock = addBlock(sid, block);
    console.log(`[CreateBlock] Session: ${sid}, Block: ${addedBlock.id}`);
    return { success: true, block: addedBlock };
  }

  function getBlockStatus(): ReturnType<typeof getBlockBufferStatus> {
    return getBlockBufferStatus();
  }

  function postCallbackMessage(sessionId: string, agentName: string, content: string, invokeAgents?: string[]): { status: 'ok' } {
    runtime.addCallbackMessage(sessionId, agentName, content, invokeAgents);
    console.log(`\n[聊天室消息][${agentName}] ${content}`);
    return { status: 'ok' };
  }

  function getThreadContext(sessionId: string): { sessionId: string; messages: Message[] } {
    const session = runtime.getSessionById(sessionId);
    if (!session) {
      throw new ChatServiceError('会话不存在', 404);
    }

    return { sessionId, messages: session.history };
  }

  return {
    listAgents,
    sendMessage,
    streamMessage,
    resumePendingChat,
    summarizeChat,
    createBlock,
    getBlockStatus,
    postCallbackMessage,
    getThreadContext
  };
}
