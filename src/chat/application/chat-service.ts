import { Message, RichBlock } from '../../types';
import { addBlock, getStatus as getBlockBufferStatus } from '../../block-buffer';
import { AppErrorOptions } from '../../shared/errors/app-error';
import { AppError } from '../../shared/errors/app-error';
import { APP_ERROR_CODES, AppErrorCode } from '../../shared/errors/app-error-codes';
import { createChatAgentExecution } from './chat-agent-execution';
import { createChatDispatchOrchestrator } from './chat-dispatch-orchestrator';
import { createChatResumeService } from './chat-resume-service';
import { createChatSummaryService } from './chat-summary-service';
import type { ChatRuntime } from '../runtime/chat-runtime';
import type {
  ActiveExecutionRegistration,
  ChatService,
  ChatServiceDependencies,
  StopExecutionRequest
} from './chat-service-types';

export type { ChatService, ChatServiceDependencies } from './chat-service-types';

export class ChatServiceError extends AppError {
  constructor(message: string, code: AppErrorCode, statusCode?: number) {
    super(message, { code, statusCode });
    this.name = 'ChatServiceError';
  }
}

function buildMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function createChatServiceError(message: string, error: Pick<AppErrorOptions, 'code' | 'statusCode'>): ChatServiceError {
  return new ChatServiceError(message, error.code, error.statusCode);
}

function buildSendContext(runtime: ChatRuntime, userKey: string, sessionId: string): string {
  return `${userKey}::${sessionId}`;
}

function registerChatExecution(runtime: ChatRuntime, userKey: string, sessionId: string): ActiveExecutionRegistration {
  const executionId = buildMessageId();
  const abortController = new AbortController();
  runtime.registerActiveExecution(userKey, sessionId, {
    executionId,
    userKey,
    sessionId,
    currentAgentName: null,
    abortController,
    stopMode: 'none'
  });

  return {
    executionId,
    abortController,
    clear: () => {
      runtime.clearActiveExecution(userKey, sessionId, executionId);
    }
  };
}

export function createChatService(deps: ChatServiceDependencies): ChatService {
  const { sessionService, runtime, agentManager } = deps;
  const agentExecution = createChatAgentExecution({
    port: deps.port,
    callbackAuthToken: deps.callbackAuthToken,
    runtime,
    sessionService,
    agentManager
  });
  const dispatchOrchestrator = createChatDispatchOrchestrator({
    runtime,
    sessionService,
    agentManager,
    runAgentTask: agentExecution.runAgentTask
  });
  const resumeService = createChatResumeService({
    syncAgentsFromStore: deps.syncAgentsFromStore,
    runtime,
    sessionService,
    executeAgentTurn: dispatchOrchestrator.executeAgentTurn,
    registerActiveExecution: (userKey, sessionId) => registerChatExecution(runtime, userKey, sessionId),
    createError: createChatServiceError
  });
  const summaryService = createChatSummaryService({
    syncAgentsFromStore: deps.syncAgentsFromStore,
    runtime,
    sessionService,
    executeAgentTurn: dispatchOrchestrator.executeAgentTurn,
    createError: createChatServiceError
  });

  function listAgents() {
    deps.syncAgentsFromStore();
    return agentManager.getAgentConfigs();
  }

  async function sendMessage(context: { userKey: string }, body: { message: string; sender?: string }) {
    deps.syncAgentsFromStore();
    const { message, sender: bodySender } = body;
    const sender = bodySender || deps.defaultUserName;
    if (!message) {
      throw new ChatServiceError('缺少 message 字段', APP_ERROR_CODES.VALIDATION_FAILED);
    }

    const { userKey, session } = sessionService.resolveChatSession(context);
    if (sessionService.isSessionSummaryInProgress(userKey, session)) {
      throw new ChatServiceError('当前会话正在生成总结，暂时不能发送新消息，请稍后再试。', APP_ERROR_CODES.CONFLICT);
    }
    const sessionId = buildSendContext(runtime, userKey, session.id);
    const currentAgent = sessionService.expireInvalidCurrentAgent(userKey, session);
    sessionService.prepareForIncomingMessage(session);

    console.log(`\n[Chat] 会话 ${sessionId.substring(0, 12)}... 用户 ${sender}: ${message}`);

    const { mentions, ignoredMentions } = dispatchOrchestrator.collectEligibleMentions(message, session);
    console.log(`[Chat] @ 提及: ${mentions.join(', ') || '无'}`);

    const agentsToRespond: string[] = [];
    if (mentions.length > 0) {
      agentsToRespond.push(...mentions);
      sessionService.selectCurrentAgent(userKey, session.id, mentions[0]);
      console.log(`[Chat] 设置当前对话智能体: ${mentions[0]}`);
    } else if (currentAgent) {
      agentsToRespond.push(currentAgent);
      console.log(`[Chat] 继续与 ${currentAgent} 对话`);
    }

    const userMessage: Message = {
      id: buildMessageId(),
      role: 'user',
      sender,
      text: message,
      timestamp: Date.now(),
      mentions: mentions.length > 0 ? mentions : undefined
    };

    sessionService.appendMessage(session, userMessage);
    const commandEvent = runtime.appendCommandEvent(session.id, {
      eventType: 'message_thinking_started',
      actorName: 'chat-service',
      actorId: userKey,
      payload: {
        command: 'chat.send',
        message: {
          id: userMessage.id,
          sender,
          text: message
        },
        mentions,
        agentsToRespond
      }
    });
    const userEvent = runtime.appendUserEvent(session.id, {
      eventType: 'user_message_created',
      actorId: userKey,
      actorName: sender,
      payload: {
        message: userMessage
      },
      correlationId: commandEvent.eventId,
      causationId: commandEvent.eventId,
      causedByEventId: commandEvent.eventId,
      causedBySeq: commandEvent.seq
    });

    const acceptedResponse = {
      success: true as const,
      accepted: true as const,
      session: runtime.buildSessionResponse(session),
      currentAgent: sessionService.getCurrentAgent(userKey, session.id),
      latestEventSeq: userEvent.seq,
      commandEventSeq: commandEvent.seq,
      userEventSeq: userEvent.seq
    };

    if (agentsToRespond.length === 0) {
      return {
        ...acceptedResponse,
        notice: sessionService.buildNoEnabledAgentsNotice(session, ignoredMentions)
      };
    }

    void dispatchOrchestrator.executeAgentTurn({
      userKey,
      session,
      initialTasks: agentsToRespond.map(agentName => ({
        agentName,
        prompt: message,
        includeHistory: mentions.length === 0
      })),
      stream: false
    }).catch((error) => {
      console.error('[Chat] 异步命令执行失败:', error);
    });

    return {
      ...acceptedResponse,
      notice: ignoredMentions.length > 0 ? `${ignoredMentions.join('、')} 已停用，未参与本次对话。` : undefined
    };
  }

  function createBlock(payload: { sessionId?: string; block: RichBlock }) {
    const { sessionId = 'default', block } = payload;
    if (!block) {
      throw new ChatServiceError('缺少 block 字段', APP_ERROR_CODES.VALIDATION_FAILED);
    }

    const sid = sessionId || 'default';
    const addedBlock = addBlock(sid, block);
    console.log(`[CreateBlock] Session: ${sid}, Block: ${addedBlock.id}`);
    return { success: true as const, block: addedBlock };
  }

  function getBlockStatus() {
    return getBlockBufferStatus();
  }

  function postCallbackMessage(sessionId: string, agentName: string, content: string, invokeAgents?: string[]) {
    runtime.addCallbackMessage(sessionId, agentName, content, invokeAgents);
    console.log(`\n[聊天室消息][${agentName}] ${content}`);
    return { status: 'ok' as const };
  }

  function getThreadContext(sessionId: string) {
    const session = runtime.getSessionById(sessionId);
    if (!session) {
      throw new ChatServiceError('会话不存在', APP_ERROR_CODES.NOT_FOUND);
    }

    return { sessionId, messages: session.history };
  }

  async function stopExecution(
    context: { userKey: string },
    request: StopExecutionRequest
  ): Promise<{ success: true; stopped: boolean; scope: StopExecutionRequest['scope'] }> {
    if (request.scope !== 'current_agent' && request.scope !== 'session') {
      throw new ChatServiceError('scope 必须是 current_agent 或 session', APP_ERROR_CODES.VALIDATION_FAILED);
    }

    const { userKey } = context;
    const targetSessionId = (() => {
      const requestedSessionId = request.sessionId?.trim();
      if (!requestedSessionId) {
        return sessionService.resolveChatSession(context).session.id;
      }

      const targetSession = runtime.ensureUserSessions(userKey).get(requestedSessionId);
      if (!targetSession) {
        throw new ChatServiceError('会话不存在', APP_ERROR_CODES.NOT_FOUND);
      }
      return targetSession.id;
    })();
    const stoppedExecution = runtime.requestExecutionStop(userKey, targetSessionId, request.scope);
    return {
      success: true as const,
      stopped: Boolean(stoppedExecution),
      scope: request.scope
    };
  }

  return {
    listAgents,
    sendMessage,
    resumePendingChat: resumeService.resumePendingChat,
    summarizeChat: summaryService.summarizeChat,
    createBlock,
    getBlockStatus,
    postCallbackMessage,
    getThreadContext,
    stopExecution
  };
}
