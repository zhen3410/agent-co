import { InvocationTask, Message } from '../../types';
import { APP_ERROR_CODES } from '../../shared/errors/app-error-codes';
import { SessionService, SessionUserContext } from './session-service';
import {
  ActiveExecutionRegistration,
  ChatResumeService,
  ChatServiceErrorFactory,
  ExecuteAgentTurnParams,
  ExecuteAgentTurnResult,
  PendingAgentDispatchTask
} from './chat-service-types';
import { ChatRuntime } from '../runtime/chat-runtime';

export interface ChatResumeServiceDependencies {
  syncAgentsFromStore(): void;
  runtime: ChatRuntime;
  sessionService: SessionService;
  executeAgentTurn(params: ExecuteAgentTurnParams): Promise<ExecuteAgentTurnResult>;
  registerActiveExecution(userKey: string, sessionId: string): ActiveExecutionRegistration;
  createError: ChatServiceErrorFactory;
}

interface ReconciledPendingInvocationReviewTasks {
  immediateTasks: PendingAgentDispatchTask[];
  deferredTasks: PendingAgentDispatchTask[];
}

export function createChatResumeService(deps: ChatResumeServiceDependencies): ChatResumeService {
  function buildInvocationReviewPrompt(task: {
    calleeAgentName: string;
    originalPrompt: string;
  }, replyText: string): string {
    return [
      `你正在复核 ${task.calleeAgentName} 对委派任务的回复。`,
      `原始委派请求：${task.originalPrompt}`,
      `${task.calleeAgentName} 的回复：${replyText || '(空回复)'}`,
      '只允许输出以下三种格式之一：',
      'accept: <接受原因>',
      'follow_up: <下一条具体追问>',
      'retry: <要求对方重做的具体要求>',
      '关键词必须是 accept / follow_up / retry。'
    ].join('\n');
  }

  function buildInvocationTimeoutReviewPrompt(task: {
    calleeAgentName: string;
    originalPrompt: string;
  }): string {
    return [
      `你正在复核 ${task.calleeAgentName} 对委派任务的回复。`,
      `原始委派请求：${task.originalPrompt}`,
      `${task.calleeAgentName} 未在截止时间前回复，请只允许输出以下三种格式之一：`,
      'accept: <接受原因>',
      'follow_up: <下一条具体追问>',
      'retry: <要求对方重做的具体要求>',
      '关键词必须是 accept / follow_up / retry。'
    ].join('\n');
  }

  function findInvocationReplyMessage(messages: Message[], task: InvocationTask): Message | null {
    if (task.lastReplyMessageId) {
      const matched = messages.find(message => message.id === task.lastReplyMessageId);
      if (matched) {
        return matched;
      }
    }

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.taskId === task.id && message.sender === task.calleeAgentName) {
        return message;
      }
    }

    return null;
  }

  function buildAwaitingCallerReviewTask(messages: Message[], invocationTask: InvocationTask): PendingAgentDispatchTask | null {
    if (Number.isFinite(Number(invocationTask.timedOutAt)) && Number(invocationTask.timedOutAt) > 0) {
      return {
        agentName: invocationTask.callerAgentName,
        prompt: buildInvocationTimeoutReviewPrompt(invocationTask),
        includeHistory: true,
        dispatchKind: 'internal_review',
        taskId: invocationTask.id,
        callerAgentName: invocationTask.callerAgentName,
        calleeAgentName: invocationTask.calleeAgentName,
        reviewMode: 'caller_review',
        deadlineAt: invocationTask.deadlineAt,
        invocationTaskReviewVersion: invocationTask.reviewVersion
      };
    }

    const replyMessage = findInvocationReplyMessage(messages, invocationTask);
    if (!replyMessage) {
      return null;
    }

    return {
      agentName: invocationTask.callerAgentName,
      prompt: buildInvocationReviewPrompt(invocationTask, replyMessage.text || ''),
      includeHistory: true,
      dispatchKind: 'internal_review',
      taskId: invocationTask.id,
      callerAgentName: invocationTask.callerAgentName,
      calleeAgentName: invocationTask.calleeAgentName,
      reviewMode: 'caller_review',
      deadlineAt: invocationTask.deadlineAt,
      invocationTaskReviewVersion: invocationTask.reviewVersion
    };
  }

  function buildPendingReplyTask(invocationTask: InvocationTask): PendingAgentDispatchTask {
    return {
      agentName: invocationTask.calleeAgentName,
      prompt: invocationTask.prompt,
      includeHistory: true,
      dispatchKind: 'explicit_chained',
      taskId: invocationTask.id,
      callerAgentName: invocationTask.callerAgentName,
      calleeAgentName: invocationTask.calleeAgentName,
      reviewMode: 'caller_review',
      deadlineAt: invocationTask.deadlineAt
    };
  }

  function findBufferedInvocationReplyMessage(pendingVisibleMessages: Message[], invocationTask: InvocationTask): Message | null {
    for (const message of pendingVisibleMessages) {
      if (message.taskId === invocationTask.id && message.sender === invocationTask.calleeAgentName) {
        return message;
      }
    }
    return null;
  }

  function reconcilePendingInvocationReviewTasks(params: {
    userKey: string;
    sessionId: string;
    history: Message[];
    invocationTasks?: InvocationTask[];
    pendingTasks: PendingAgentDispatchTask[];
    pendingVisibleMessages: Message[];
  }): ReconciledPendingInvocationReviewTasks {
    const {
      userKey,
      sessionId,
      history,
      invocationTasks,
      pendingTasks,
      pendingVisibleMessages
    } = params;
    const invocationTaskMap = new Map(
      (Array.isArray(invocationTasks) ? invocationTasks : []).map(task => [task.id, task])
    );
    const serializedCallerReviewTasks = new Map(
      pendingTasks
        .filter((task) => task.reviewMode === 'caller_review' && typeof task.taskId === 'string' && task.taskId.length > 0)
        .map((task) => [task.taskId as string, { ...task }])
    );
    const immediateTasks = pendingTasks.filter((task) => task.reviewMode !== 'caller_review');
    const deferredTasks: PendingAgentDispatchTask[] = [];
    const reviewMessages = [...history, ...pendingVisibleMessages];
    const serializedCallerReviewTaskIds = new Set(
      serializedCallerReviewTasks.keys()
    );

    for (const invocationTask of invocationTaskMap.values()) {
      if (invocationTask.status === 'pending_reply') {
        const bufferedReply = findBufferedInvocationReplyMessage(pendingVisibleMessages, invocationTask);
        if (bufferedReply) {
          const updatedTask = deps.runtime.updateInvocationTask(userKey, sessionId, invocationTask.id, {
            status: 'awaiting_caller_review',
            lastReplyMessageId: bufferedReply.id,
            reviewVersion: (invocationTask.reviewVersion || 0) + 1
          }) || {
            ...invocationTask,
            status: 'awaiting_caller_review' as const,
            lastReplyMessageId: bufferedReply.id,
            reviewVersion: (invocationTask.reviewVersion || 0) + 1
          };
          const rebuiltTask = buildAwaitingCallerReviewTask(reviewMessages, updatedTask);
          if (rebuiltTask) {
            if (serializedCallerReviewTaskIds.has(invocationTask.id)) {
              immediateTasks.push(rebuiltTask);
            } else {
              deferredTasks.push(rebuiltTask);
            }
          }
          continue;
        }
        immediateTasks.push(buildPendingReplyTask(invocationTask));
        continue;
      }

      if (invocationTask.status === 'awaiting_caller_review') {
        const rebuiltTask = buildAwaitingCallerReviewTask(reviewMessages, invocationTask);
        if (rebuiltTask) {
          immediateTasks.push(rebuiltTask);
        } else {
          const serializedTask = serializedCallerReviewTasks.get(invocationTask.id);
          if (serializedTask) {
            immediateTasks.push(serializedTask);
          }
        }
      }
    }

    return {
      immediateTasks,
      deferredTasks
    };
  }

  return {
    async resumePendingChat(context: SessionUserContext) {
      deps.syncAgentsFromStore();
      const { userKey, session } = deps.sessionService.resolveChatSession(context);
      const summaryInProgress = deps.sessionService.isSessionSummaryInProgress(userKey, session);
      if (summaryInProgress) {
        throw deps.createError('当前会话正在生成总结，暂时不能继续执行剩余链路，请稍后再试。', {
          code: APP_ERROR_CODES.CONFLICT
        });
      }
      const { pendingVisibleMessages, pendingTasks } = deps.sessionService.takePendingExecution(session);
      const reconciled = reconcilePendingInvocationReviewTasks({
        userKey,
        sessionId: session.id,
        history: session.history,
        invocationTasks: session.invocationTasks,
        pendingTasks,
        pendingVisibleMessages
      });
      const reconciledPendingTasks = reconciled.immediateTasks;

      if (pendingVisibleMessages.length === 0 && reconciledPendingTasks.length === 0 && reconciled.deferredTasks.length === 0) {
        return {
          success: true as const,
          resumed: false,
          aiMessages: [],
          currentAgent: deps.sessionService.getCurrentAgent(userKey, session.id),
          notice: '当前没有可继续执行的剩余链路。'
        };
      }

      const execution = deps.registerActiveExecution(userKey, session.id);
      let executionResult: ExecuteAgentTurnResult;
      try {
        executionResult = await deps.executeAgentTurn({
          userKey,
          session,
          executionId: execution.executionId,
          initialTasks: [],
          pendingTasks: reconciledPendingTasks,
          stream: false,
          signal: execution.abortController.signal
        });
      } finally {
        execution.clear();
      }

      const shouldPersistDeferredAndRemaining = executionResult.stopped?.scope !== 'session';
      const pendingTasksToPersist = shouldPersistDeferredAndRemaining
        ? [...reconciled.deferredTasks, ...executionResult.pendingTasks]
        : [];
      deps.sessionService.updatePendingExecution(session, pendingTasksToPersist);
      const resumedMessages = [...pendingVisibleMessages, ...executionResult.aiMessages];

      return {
        success: true as const,
        resumed: true,
        aiMessages: resumedMessages,
        currentAgent: deps.sessionService.getCurrentAgent(userKey, session.id),
        notice: pendingTasksToPersist.length > 0 ? '仍有未完成链路，可再次继续执行。' : undefined
      };
    }
  };
}
