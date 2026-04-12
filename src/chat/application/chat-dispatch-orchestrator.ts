import { InvocationReviewAction, Message } from '../../types';
import { AgentManager } from '../../agent-manager';
import { SessionService } from './session-service';
import { ChatRuntime, UserChatSession } from '../runtime/chat-runtime';
import { generateId } from '../runtime/chat-runtime-types';
import { buildInvocationLaneKey } from '../domain/invocation-lane';
import {
  AgentDispatchTask,
  ChatDispatchOrchestrator,
  ExecuteAgentTurnParams,
  ExecuteAgentTurnResult,
  MentionCollectionResult,
  PendingAgentDispatchTask,
  RunAgentTask
} from './chat-service-types';
import {
  canFollowUpInvocationTask,
  canRetryInvocationTask,
  canQueueContinuationTarget,
  collectImplicitPeerContinuationTargets,
  isInvocationTaskOverdue,
  INVOCATION_TASK_DEFAULT_DEADLINE_MS,
  INVOCATION_TASK_MAX_FOLLOW_UPS,
  INVOCATION_TASK_MAX_RETRIES,
  resolvePeerDiscussionStateAfterTurn,
  shouldRunChainedTask,
  shouldSkipAgentTaskForCallLimit
} from '../domain/agent-chain-policy';

export interface ChatDispatchOrchestratorDependencies {
  runtime: ChatRuntime;
  sessionService: SessionService;
  agentManager: AgentManager;
  runAgentTask: RunAgentTask;
}

export function createChatDispatchOrchestrator(deps: ChatDispatchOrchestratorDependencies): ChatDispatchOrchestrator {
  const { runtime, sessionService, agentManager, runAgentTask } = deps;

  function appendDispatchTaskCreatedEvent(params: {
    sessionId: string;
    taskId: string;
    dispatchKind: PendingAgentDispatchTask['dispatchKind'];
    actorName: string;
    callerAgentName?: string;
    calleeAgentName?: string;
    parentTaskId?: string;
    reason?: string;
    causedByEventId?: string;
    causedBySeq?: number;
  }) {
    return runtime.appendAgentEvent(params.sessionId, {
      eventType: 'dispatch_task_created',
      actorName: params.actorName,
      actorId: params.actorName,
      payload: {
        taskId: params.taskId,
        dispatchKind: params.dispatchKind,
        callerAgentName: params.callerAgentName,
        calleeAgentName: params.calleeAgentName,
        parentTaskId: params.parentTaskId,
        reason: params.reason
      },
      correlationId: params.causedByEventId,
      causationId: params.causedByEventId,
      causedByEventId: params.causedByEventId,
      causedBySeq: params.causedBySeq
    });
  }

  function appendDispatchTaskCompletedEvent(params: {
    sessionId: string;
    taskId: string;
    actorName: string;
    callerAgentName?: string;
    calleeAgentName?: string;
    outcome: 'completed' | 'failed';
    reason?: string;
  }) {
    return runtime.appendAgentEvent(params.sessionId, {
      eventType: 'dispatch_task_completed',
      actorName: params.actorName,
      actorId: params.actorName,
      payload: {
        taskId: params.taskId,
        callerAgentName: params.callerAgentName,
        calleeAgentName: params.calleeAgentName,
        outcome: params.outcome,
        reason: params.reason
      }
    });
  }

  function appendThinkingEvent(params: {
    sessionId: string;
    taskId: string;
    agentName: string;
    dispatchKind: PendingAgentDispatchTask['dispatchKind'];
    status: 'message_thinking_started' | 'message_thinking_finished' | 'message_thinking_cancelled';
    causedByEventId?: string;
    causedBySeq?: number;
  }) {
    return runtime.appendAgentEvent(params.sessionId, {
      eventType: params.status,
      actorName: params.agentName,
      actorId: params.agentName,
      payload: {
        taskId: params.taskId,
        dispatchKind: params.dispatchKind,
        agentName: params.agentName
      },
      correlationId: params.causedByEventId,
      causationId: params.causedByEventId,
      causedByEventId: params.causedByEventId,
      causedBySeq: params.causedBySeq
    });
  }

  function appendAgentMessageCreatedEvent(params: {
    sessionId: string;
    message: Message;
    fallbackActorName: string;
    causedByEventId?: string;
    causedBySeq?: number;
  }) {
    const actorName = params.message.sender || params.fallbackActorName;
    return runtime.appendAgentEvent(params.sessionId, {
      eventType: 'agent_message_created',
      actorName,
      actorId: actorName,
      payload: {
        message: params.message
      },
      correlationId: params.causedByEventId,
      causationId: params.causedByEventId,
      causedByEventId: params.causedByEventId,
      causedBySeq: params.causedBySeq
    });
  }

  function appendDispatchRequestedEvents(params: {
    sessionId: string;
    tasks: PendingAgentDispatchTask[];
    defaultActorName: string;
    parentTaskId?: string;
    causedByEventId?: string;
    causedBySeq?: number;
  }): void {
    for (const pendingTask of params.tasks) {
      appendDispatchTaskCreatedEvent({
        sessionId: params.sessionId,
        taskId: pendingTask.taskId || generateId(),
        dispatchKind: pendingTask.dispatchKind,
        actorName: pendingTask.callerAgentName || params.defaultActorName,
        callerAgentName: pendingTask.callerAgentName || params.defaultActorName,
        calleeAgentName: pendingTask.calleeAgentName || pendingTask.agentName,
        parentTaskId: params.parentTaskId,
        reason: 'dispatch_requested',
        causedByEventId: params.causedByEventId,
        causedBySeq: params.causedBySeq
      });
    }
  }

  function resolveQueueTaskId(task: PendingAgentDispatchTask | AgentDispatchTask): string {
    const trackedTask = task as PendingAgentDispatchTask & { __queueTaskId?: string };
    if (trackedTask.__queueTaskId) {
      return trackedTask.__queueTaskId;
    }
    trackedTask.__queueTaskId = task.taskId || generateId();
    return trackedTask.__queueTaskId;
  }

  function appendInvocationQueuedEvent(sessionId: string, task: PendingAgentDispatchTask): void {
    const queueTaskId = resolveQueueTaskId(task);
    if (runtime.getInvocationLaneTask(queueTaskId)) {
      return;
    }
    const lane = runtime.getInvocationLane(sessionId, task.agentName);
    const aheadCount = (lane?.queuedTaskIds.length || 0) + (lane?.runningTaskId ? 1 : 0);
    runtime.appendAgentEvent(sessionId, {
      eventType: 'agent_invocation_enqueued',
      actorName: task.callerAgentName || task.agentName,
      actorId: task.callerAgentName || task.agentName,
      payload: {
        queueTaskId,
        laneKey: buildInvocationLaneKey(sessionId, task.agentName),
        agentName: task.agentName,
        taskId: task.taskId,
        dispatchKind: task.dispatchKind,
        callerAgentName: task.callerAgentName,
        calleeAgentName: task.calleeAgentName,
        aheadCount
      }
    });
  }

  function appendInvocationStartedEvent(sessionId: string, task: PendingAgentDispatchTask, executionId?: string): void {
    const queueTaskId = resolveQueueTaskId(task);
    const laneTask = runtime.getInvocationLaneTask(queueTaskId);
    runtime.appendAgentEvent(sessionId, {
      eventType: 'agent_invocation_started',
      actorName: task.agentName,
      actorId: task.agentName,
      payload: {
        queueTaskId,
        laneKey: buildInvocationLaneKey(sessionId, task.agentName),
        agentName: task.agentName,
        taskId: task.taskId,
        dispatchKind: task.dispatchKind,
        executionId,
        waitedMs: laneTask ? Math.max(0, Date.now() - laneTask.queuedAt) : 0
      }
    });
  }

  function appendInvocationSettledEvent(
    sessionId: string,
    task: PendingAgentDispatchTask,
    outcome: 'completed' | 'failed' | 'cancelled',
    error?: string
  ): void {
    runtime.appendAgentEvent(sessionId, {
      eventType: outcome === 'completed'
        ? 'agent_invocation_completed'
        : outcome === 'failed'
          ? 'agent_invocation_failed'
          : 'agent_invocation_cancelled',
      actorName: task.agentName,
      actorId: task.agentName,
      payload: {
        queueTaskId: resolveQueueTaskId(task),
        laneKey: buildInvocationLaneKey(sessionId, task.agentName),
        agentName: task.agentName,
        taskId: task.taskId,
        dispatchKind: task.dispatchKind,
        error
      }
    });
  }

  function groupTasksByAgent(tasks: PendingAgentDispatchTask[]): PendingAgentDispatchTask[][] {
    const grouped = new Map<string, PendingAgentDispatchTask[]>();
    const orderedAgents: string[] = [];
    for (const task of tasks) {
      if (!grouped.has(task.agentName)) {
        grouped.set(task.agentName, []);
        orderedAgents.push(task.agentName);
      }
      grouped.get(task.agentName)!.push(task);
    }
    return orderedAgents.map(agentName => grouped.get(agentName)!);
  }

  function collectEligibleMentions(message: string, session: UserChatSession): MentionCollectionResult {
    const allMentions = agentManager.extractMentions(message);
    const enabledSet = new Set(sessionService.getEnabledAgents(session));
    return {
      mentions: allMentions.filter(name => enabledSet.has(name)),
      ignoredMentions: allMentions.filter(name => !enabledSet.has(name))
    };
  }

  function buildInvocationReviewPrompt(task: {
    callerAgentName: string;
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

  function parseInvocationReviewResult(text: string): { action: InvocationReviewAction; nextPrompt: string } | null {
    const normalized = (text || '').trim();
    if (!normalized) return null;

    const match = normalized.match(/^\s*(accept|follow_up|retry)\s*(?:[:：-]\s*(.*))?$/is);
    if (!match) return null;

    const action = match[1].toLowerCase() as InvocationReviewAction;
    const nextPrompt = (match[2] || '').trim();
    if ((action === 'follow_up' || action === 'retry') && !nextPrompt) {
      return null;
    }
    return { action, nextPrompt };
  }

  function buildInternalReviewTask(params: {
    agentName: string;
    prompt: string;
    taskId: string;
    callerAgentName: string;
    calleeAgentName: string;
    deadlineAt?: number;
    invocationTaskReviewVersion?: number;
  }): PendingAgentDispatchTask {
    return {
      agentName: params.agentName,
      prompt: params.prompt,
      includeHistory: true,
      dispatchKind: 'internal_review',
      taskId: params.taskId,
      callerAgentName: params.callerAgentName,
      calleeAgentName: params.calleeAgentName,
      reviewMode: 'caller_review',
      deadlineAt: params.deadlineAt,
      invocationTaskReviewVersion: params.invocationTaskReviewVersion
    };
  }

  function buildCalleeReplyTask(params: {
    agentName: string;
    prompt: string;
    taskId: string;
    callerAgentName: string;
    calleeAgentName: string;
    deadlineAt?: number;
  }): PendingAgentDispatchTask {
    return {
      agentName: params.agentName,
      prompt: params.prompt,
      includeHistory: true,
      dispatchKind: 'explicit_chained',
      taskId: params.taskId,
      callerAgentName: params.callerAgentName,
      calleeAgentName: params.calleeAgentName,
      reviewMode: 'caller_review',
      deadlineAt: params.deadlineAt
    };
  }

  interface InvocationReviewLoopResult {
    pendingTasks: PendingAgentDispatchTask[];
    suppressMessage: boolean;
    visibleMessage?: Message;
  }

  function buildInvocationReviewVisibleMessage(params: {
    invocationTaskId: string;
    callerAgentName: string;
    calleeAgentName: string;
    review: { action: InvocationReviewAction; nextPrompt: string };
    rawText: string;
    outcome?: 'accepted' | 'queued' | 'failed_limit';
  }): Message {
    const { invocationTaskId, callerAgentName, calleeAgentName, review, rawText, outcome = 'queued' } = params;
    const actionLabel = review.action === 'accept'
      ? '接受'
      : review.action === 'follow_up'
        ? (outcome === 'failed_limit' ? '跟进失败' : '继续追问')
        : (outcome === 'failed_limit' ? '重试失败' : '要求重试');
    const reasonText = outcome === 'failed_limit'
      ? `${review.nextPrompt}（已达到上限，任务失败）`
      : review.nextPrompt || (review.action === 'accept' ? '已确认当前回复可采纳。' : '');
    const displayText = `${callerAgentName} 对 ${calleeAgentName} 的调用复核：${actionLabel}。${reasonText}`;

    return {
      id: generateId(),
      role: 'assistant',
      sender: callerAgentName,
      text: displayText,
      messageSubtype: 'invocation_review',
      reviewAction: review.action,
      reviewRawText: rawText,
      reviewDisplayText: displayText,
      timestamp: Date.now(),
      taskId: invocationTaskId,
      callerAgentName,
      calleeAgentName
    };
  }

  function transitionInvocationTaskToTimeoutReview(params: {
    userKey: string;
    sessionId: string;
    invocationTaskId: string;
    now: number;
  }): PendingAgentDispatchTask | null {
    const invocationTask = runtime.listInvocationTasks(params.userKey, params.sessionId)
      .find(item => item.id === params.invocationTaskId);
    if (!invocationTask) {
      return null;
    }

    const updatedTask = runtime.updateInvocationTask(params.userKey, params.sessionId, invocationTask.id, {
      status: 'awaiting_caller_review',
      timedOutAt: params.now,
      reviewVersion: (invocationTask.reviewVersion || 0) + 1
    });
    const promptTask = updatedTask || invocationTask;
    return buildInternalReviewTask({
      agentName: promptTask.callerAgentName,
      prompt: buildInvocationTimeoutReviewPrompt(promptTask),
      taskId: promptTask.id,
      callerAgentName: promptTask.callerAgentName,
      calleeAgentName: promptTask.calleeAgentName,
      deadlineAt: promptTask.deadlineAt,
      invocationTaskReviewVersion: promptTask.reviewVersion
    });
  }

  function buildOverdueInvocationReviewTasks(params: {
    userKey: string;
    session: UserChatSession;
    now: number;
  }): PendingAgentDispatchTask[] {
    const timedOutTasks = runtime.resolveOverdueInvocationTasks(params.userKey, params.session.id, params.now);
    const reviewTasks: PendingAgentDispatchTask[] = [];

    for (const timedOutTask of timedOutTasks) {
      if (!isInvocationTaskOverdue({
        status: 'pending_reply',
        deadlineAt: timedOutTask.deadlineAt,
        now: params.now
      })) {
        continue;
      }

      const reviewTask = transitionInvocationTaskToTimeoutReview({
        userKey: params.userKey,
        sessionId: params.session.id,
        invocationTaskId: timedOutTask.id,
        now: params.now
      });
      if (reviewTask) {
        reviewTasks.push(reviewTask);
      }
    }

    return reviewTasks;
  }

  function interceptOverdueQueuedInvocationTask(params: {
    userKey: string;
    session: UserChatSession;
    task: PendingAgentDispatchTask;
    now: number;
  }): PendingAgentDispatchTask | null {
    const { userKey, session, task, now } = params;
    if (!task.taskId || task.dispatchKind === 'internal_review' || task.reviewMode !== 'caller_review') {
      return null;
    }

    const invocationTask = runtime.listInvocationTasks(userKey, session.id)
      .find(item => item.id === task.taskId);
    if (!invocationTask || !isInvocationTaskOverdue({
      status: invocationTask.status,
      deadlineAt: invocationTask.deadlineAt,
      now
    })) {
      return null;
    }

    return transitionInvocationTaskToTimeoutReview({
      userKey,
      sessionId: session.id,
      invocationTaskId: invocationTask.id,
      now
    });
  }

  function handleInvocationReviewLoopMessage(params: {
    userKey: string;
    session: UserChatSession;
    task: PendingAgentDispatchTask;
    message: Message;
  }): InvocationReviewLoopResult | null {
    const { userKey, session, task, message } = params;
    if (task.dispatchKind === 'internal_review') {
      const invocationTask = message.taskId
        ? runtime.listInvocationTasks(userKey, session.id).find(item => item.id === message.taskId)
        : null;
      const expectedReviewVersion = typeof task.invocationTaskReviewVersion === 'number'
        ? task.invocationTaskReviewVersion
        : null;
      const reviewVersionMismatch = invocationTask
        && expectedReviewVersion !== null
        && (invocationTask.reviewVersion || 0) !== expectedReviewVersion;
      if (!invocationTask || message.sender !== task.agentName || invocationTask.status !== 'awaiting_caller_review' || reviewVersionMismatch) {
        return {
          suppressMessage: true,
          pendingTasks: []
        };
      }

      const review = parseInvocationReviewResult(message.text || '');
      if (!review) {
        runtime.markInvocationTaskFailed(userKey, session.id, invocationTask.id, 'invalid_review_result');
        appendDispatchTaskCompletedEvent({
          sessionId: session.id,
          taskId: invocationTask.id,
          actorName: invocationTask.callerAgentName,
          callerAgentName: invocationTask.callerAgentName,
          calleeAgentName: invocationTask.calleeAgentName,
          outcome: 'failed',
          reason: 'invalid_review_result'
        });
        return {
          suppressMessage: true,
          pendingTasks: []
        };
      }
      runtime.appendAgentEvent(session.id, {
        eventType: 'agent_review_submitted',
        actorName: invocationTask.callerAgentName,
        actorId: invocationTask.callerAgentName,
        payload: {
          taskId: invocationTask.id,
          reviewAction: review.action,
          reviewRawText: message.text || '',
          callerAgentName: invocationTask.callerAgentName,
          calleeAgentName: invocationTask.calleeAgentName
        }
      });
      const visibleReviewMessage = buildInvocationReviewVisibleMessage({
        invocationTaskId: invocationTask.id,
        callerAgentName: invocationTask.callerAgentName,
        calleeAgentName: invocationTask.calleeAgentName,
        review,
        rawText: message.text || '',
        outcome: review.action === 'accept' ? 'accepted' : 'queued'
      });

      if (review.action === 'accept') {
        runtime.updateInvocationTask(userKey, session.id, invocationTask.id, {
          status: 'completed',
          reviewAction: 'accept',
          completedAt: Date.now()
        });
        appendDispatchTaskCompletedEvent({
          sessionId: session.id,
          taskId: invocationTask.id,
          actorName: invocationTask.callerAgentName,
          callerAgentName: invocationTask.callerAgentName,
          calleeAgentName: invocationTask.calleeAgentName,
          outcome: 'completed'
        });
        return {
          suppressMessage: true,
          pendingTasks: [],
          visibleMessage: visibleReviewMessage
        };
      }

      const nextPrompt = review.nextPrompt;
      if (review.action === 'retry' && !canRetryInvocationTask({
        retryCount: invocationTask.retryCount,
        maxRetries: INVOCATION_TASK_MAX_RETRIES
      })) {
        runtime.markInvocationTaskFailed(userKey, session.id, invocationTask.id, 'retry_limit_exceeded');
        appendDispatchTaskCompletedEvent({
          sessionId: session.id,
          taskId: invocationTask.id,
          actorName: invocationTask.callerAgentName,
          callerAgentName: invocationTask.callerAgentName,
          calleeAgentName: invocationTask.calleeAgentName,
          outcome: 'failed',
          reason: 'retry_limit_exceeded'
        });
        return {
          suppressMessage: true,
          pendingTasks: [],
          visibleMessage: buildInvocationReviewVisibleMessage({
            invocationTaskId: invocationTask.id,
            callerAgentName: invocationTask.callerAgentName,
            calleeAgentName: invocationTask.calleeAgentName,
            review,
            rawText: message.text || '',
            outcome: 'failed_limit'
          })
        };
      }
      if (review.action === 'follow_up' && !canFollowUpInvocationTask({
        followupCount: invocationTask.followupCount,
        maxFollowUps: INVOCATION_TASK_MAX_FOLLOW_UPS
      })) {
        runtime.markInvocationTaskFailed(userKey, session.id, invocationTask.id, 'follow_up_limit_exceeded');
        appendDispatchTaskCompletedEvent({
          sessionId: session.id,
          taskId: invocationTask.id,
          actorName: invocationTask.callerAgentName,
          callerAgentName: invocationTask.callerAgentName,
          calleeAgentName: invocationTask.calleeAgentName,
          outcome: 'failed',
          reason: 'follow_up_limit_exceeded'
        });
        return {
          suppressMessage: true,
          pendingTasks: [],
          visibleMessage: buildInvocationReviewVisibleMessage({
            invocationTaskId: invocationTask.id,
            callerAgentName: invocationTask.callerAgentName,
            calleeAgentName: invocationTask.calleeAgentName,
            review,
            rawText: message.text || '',
            outcome: 'failed_limit'
          })
        };
      }

      const nextDeadlineAt = Date.now() + INVOCATION_TASK_DEFAULT_DEADLINE_MS;
      runtime.updateInvocationTask(userKey, session.id, invocationTask.id, {
        status: 'pending_reply',
        prompt: nextPrompt,
        reviewAction: review.action,
        deadlineAt: nextDeadlineAt,
        followupCount: review.action === 'follow_up' ? invocationTask.followupCount + 1 : invocationTask.followupCount,
        retryCount: review.action === 'retry' ? invocationTask.retryCount + 1 : invocationTask.retryCount
      });
      return {
        suppressMessage: true,
        visibleMessage: visibleReviewMessage,
        pendingTasks: [
          buildCalleeReplyTask({
            agentName: invocationTask.calleeAgentName,
            prompt: nextPrompt,
            taskId: invocationTask.id,
            callerAgentName: invocationTask.callerAgentName,
            calleeAgentName: invocationTask.calleeAgentName,
            deadlineAt: nextDeadlineAt
          })
        ]
      };
    }

    if (!message.taskId) {
      return null;
    }

    const invocationTask = runtime.listInvocationTasks(userKey, session.id)
      .find(item => item.id === message.taskId);
    if (!invocationTask) {
      return null;
    }

    if (message.sender === invocationTask.calleeAgentName && invocationTask.status === 'pending_reply') {
      const replyArrivedAt = Number.isFinite(message.timestamp) ? Number(message.timestamp) : Date.now();
      if (isInvocationTaskOverdue({
        status: invocationTask.status,
        deadlineAt: invocationTask.deadlineAt,
        now: replyArrivedAt
      })) {
        const timeoutReviewTask = transitionInvocationTaskToTimeoutReview({
          userKey,
          sessionId: session.id,
          invocationTaskId: invocationTask.id,
          now: replyArrivedAt
        });
        return timeoutReviewTask ? {
          suppressMessage: true,
          pendingTasks: [timeoutReviewTask]
        } : {
          suppressMessage: true,
          pendingTasks: []
        };
      }

      const reviewPrompt = buildInvocationReviewPrompt(invocationTask, message.text || '');
      const nextReviewVersion = (invocationTask.reviewVersion || 0) + 1;
      const updatedTask = runtime.updateInvocationTask(userKey, session.id, invocationTask.id, {
        status: 'awaiting_caller_review',
        lastReplyMessageId: message.id,
        reviewVersion: nextReviewVersion
      });
      const reviewTask = updatedTask || {
        ...invocationTask,
        status: 'awaiting_caller_review' as const,
        lastReplyMessageId: message.id,
        reviewVersion: nextReviewVersion
      };
      runtime.appendAgentEvent(session.id, {
        eventType: 'agent_review_requested',
        actorName: reviewTask.callerAgentName,
        actorId: reviewTask.callerAgentName,
        payload: {
          taskId: reviewTask.id,
          callerAgentName: reviewTask.callerAgentName,
          calleeAgentName: reviewTask.calleeAgentName,
          reviewMode: 'caller_review',
          reviewVersion: reviewTask.reviewVersion
        }
      });
      return {
        suppressMessage: false,
        pendingTasks: [
          buildInternalReviewTask({
            agentName: reviewTask.callerAgentName,
            prompt: reviewPrompt,
            taskId: reviewTask.id,
            callerAgentName: reviewTask.callerAgentName,
            calleeAgentName: reviewTask.calleeAgentName,
            deadlineAt: reviewTask.deadlineAt,
            invocationTaskReviewVersion: reviewTask.reviewVersion
          })
        ]
      };
    }

    return null;
  }

  async function executeLaneTurn(params: ExecuteAgentTurnParams): Promise<ExecuteAgentTurnResult> {
    const { userKey, session, initialTasks, stream, onThinking, onTextDelta, onMessage, shouldContinue, signal } = params;
    const queue: PendingAgentDispatchTask[] = Array.isArray(params.pendingTasks)
      ? params.pendingTasks.map(task => ({ ...task, dispatchKind: runtime.normalizeDispatchKind(task.dispatchKind) || 'initial' }))
      : initialTasks.map(task => ({ ...task, dispatchKind: runtime.normalizeDispatchKind(task.dispatchKind) || 'initial' }));
    const aiMessages: Message[] = [];
    const crossLanePendingTasks: PendingAgentDispatchTask[] = [];
    const callCounts = new Map<string, number>();
    const { agentChainMaxHops, agentChainMaxCallsPerAgent, discussionMode } = runtime.buildSessionResponse(session);
    let chainedCalls = 0;
    let streamStopped = false;
    let stopped: ExecuteAgentTurnResult['stopped'];

    for (const queuedTask of queue) {
      appendInvocationQueuedEvent(session.id, queuedTask);
    }

    const canContinue = () => shouldContinue ? shouldContinue() : true;
    const resolveExecutionId = (): string | null => {
      if (params.executionId) {
        return params.executionId;
      }
      return runtime.getActiveExecution(userKey, session.id)?.executionId || null;
    };
    const consumeExplicitStopMode = (): 'none' | 'current_agent' | 'session' => {
      const executionId = resolveExecutionId();
      if (!executionId) {
        return 'none';
      }
      const stopMode = runtime.consumeExecutionStopMode(userKey, session.id, executionId);
      return stopMode === 'current_agent' || stopMode === 'session' ? stopMode : 'none';
    };
    const consumeStoppedMetadata = (scope: 'current_agent' | 'session', currentAgent: string): NonNullable<ExecuteAgentTurnResult['stopped']> => {
      const executionId = resolveExecutionId();
      const stoppedResult = executionId
        ? runtime.consumeExecutionStopResult(userKey, session.id, executionId)
        : null;
      if (stoppedResult) {
        return stoppedResult;
      }

      return {
        scope,
        currentAgent,
        resumeAvailable: scope === 'current_agent' && (queue.length > 0 || crossLanePendingTasks.length > 0)
      };
    };

    while (true) {
      if (queue.length === 0) {
        break;
      }

      if (!canContinue()) {
        streamStopped = true;
        runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} stage=stream_stop reason=client_disconnect`);
        break;
      }

      const task = queue.shift()!;
      const overdueReviewTask = interceptOverdueQueuedInvocationTask({
        userKey,
        session,
        task,
        now: Date.now()
      });
      if (overdueReviewTask) {
        queue.unshift(overdueReviewTask);
        continue;
      }

      const isInternalReviewTask = task.dispatchKind === 'internal_review';
      if (!shouldRunChainedTask({
        dispatchKind: task.dispatchKind,
        chainedCalls,
        maxChainHops: agentChainMaxHops
      })) {
        runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} stage=chain_stop reason=max_hops hops=${agentChainMaxHops}`);
        break;
      }

      const currentCalls = callCounts.get(task.agentName) || 0;
      if (!isInternalReviewTask && shouldSkipAgentTaskForCallLimit({
        currentCalls,
        maxCallsPerAgent: agentChainMaxCallsPerAgent
      })) {
        runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${task.agentName} stage=chain_skip reason=max_calls count=${currentCalls}`);
        continue;
      }

      if (!isInternalReviewTask) {
        callCounts.set(task.agentName, currentCalls + 1);
      }
      if (runtime.isChainedDispatchKind(task.dispatchKind)) {
        chainedCalls += 1;
      }

      const executionId = resolveExecutionId();
      if (executionId) {
        runtime.updateActiveExecutionAgent(userKey, session.id, executionId, task.agentName);
      }
      appendInvocationStartedEvent(session.id, task, executionId || undefined);
      const taskLifecycleId = task.taskId || generateId();
      const taskStartEvent = appendDispatchTaskCreatedEvent({
        sessionId: session.id,
        taskId: taskLifecycleId,
        dispatchKind: task.dispatchKind,
        actorName: task.agentName,
        callerAgentName: task.callerAgentName || task.agentName,
        calleeAgentName: task.calleeAgentName || task.agentName,
        parentTaskId: task.taskId,
        reason: 'task_start'
      });
      const thinkingStartedEvent = appendThinkingEvent({
        sessionId: session.id,
        taskId: taskLifecycleId,
        agentName: task.agentName,
        dispatchKind: task.dispatchKind,
        status: 'message_thinking_started',
        causedByEventId: taskStartEvent.eventId,
        causedBySeq: taskStartEvent.seq
      });
      onThinking?.(task.agentName);

      const visibleMessages = await runAgentTask({
        userKey,
        session,
        task,
        stream,
        executionId: executionId || undefined,
        signal,
        onTextDelta: onTextDelta
          ? (delta) => onTextDelta(task.agentName, delta)
          : undefined
      });
      appendThinkingEvent({
        sessionId: session.id,
        taskId: taskLifecycleId,
        agentName: task.agentName,
        dispatchKind: task.dispatchKind,
        status: 'message_thinking_finished',
        causedByEventId: thinkingStartedEvent.eventId,
        causedBySeq: thinkingStartedEvent.seq
      });

      const stopMode = consumeExplicitStopMode();
      if (stopMode === 'current_agent' || stopMode === 'session') {
        appendInvocationSettledEvent(session.id, task, 'cancelled');
        if (stopMode === 'session') {
          queue.length = 0;
        }
        stopped = consumeStoppedMetadata(stopMode, task.agentName);
        streamStopped = true;
        runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} execution=${executionId || 'unknown'} agent=${task.agentName} stage=stream_stop_during_task reason=explicit_stop scope=${stopMode} visible_messages=${visibleMessages.length}`);
        break;
      }

      if (signal?.aborted && visibleMessages.length === 0) {
        appendInvocationSettledEvent(session.id, task, 'cancelled');
        appendThinkingEvent({
          sessionId: session.id,
          taskId: taskLifecycleId,
          agentName: task.agentName,
          dispatchKind: task.dispatchKind,
          status: 'message_thinking_cancelled',
          causedByEventId: thinkingStartedEvent.eventId,
          causedBySeq: thinkingStartedEvent.seq
        });
        queue.unshift(task);
        streamStopped = true;
        runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} execution=${executionId || 'unknown'} agent=${task.agentName} stage=stream_stop_during_task reason=client_disconnect`);
        break;
      }

      appendInvocationSettledEvent(session.id, task, 'completed');

      for (const rawMessage of visibleMessages) {
        const { mentions: referenceMentions } = collectEligibleMentions(rawMessage.text || '', session);
        const enabledAgents = sessionService.getEnabledAgents(session);
        const enabledSet = new Set(enabledAgents);

        let chainTargets: string[];
        if (rawMessage.invokeAgents && rawMessage.invokeAgents.length > 0) {
          chainTargets = rawMessage.invokeAgents;
        } else {
          chainTargets = agentManager.extractChainInvocations(rawMessage.text || '');
          if (chainTargets.length === 0 && discussionMode === 'peer') {
            chainTargets = collectImplicitPeerContinuationTargets({
              message: rawMessage.text || '',
              enabledAgents: sessionService.getEnabledAgents(session),
              sender: rawMessage.sender
            });
            if (chainTargets.length > 0) {
              runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${rawMessage.sender || task.agentName} stage=implicit_single_at_upgrade targets=${chainTargets.join(',')}`);
            }
          }
        }
        const chainedMentions = chainTargets.filter((name) => {
          if (name === rawMessage.sender || !agentManager.hasAgent(name)) {
            return false;
          }
          if (!enabledSet.has(name)) {
            runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${rawMessage.sender || task.agentName} stage=chain_skip reason=agent_disabled target=${name}`);
            return false;
          }
          if (discussionMode === 'peer' && task.reviewMode === 'caller_review' && task.callerAgentName === name) {
            runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${rawMessage.sender || task.agentName} stage=chain_skip reason=caller_review_back_edge target=${name}`);
            return false;
          }
          return true;
        });

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

        const message: Message = {
          ...rawMessage,
          text: displayText,
          mentions: referenceMentions.length > 0 ? referenceMentions : undefined,
          invokeAgents: chainedMentions.length > 0 ? chainedMentions : undefined,
          dispatchKind: task.dispatchKind
        };

        const invocationReviewResult = handleInvocationReviewLoopMessage({
          userKey,
          session,
          task,
          message
        });
        const shouldSuppressMessage = invocationReviewResult?.suppressMessage === true;
        let messageCreatedEvent: { eventId: string; seq: number } | null = null;
        let reviewMessageEvent: { eventId: string; seq: number } | null = null;

        if (!shouldSuppressMessage) {
          sessionService.appendMessage(session, message);
          const appendedEvent = appendAgentMessageCreatedEvent({
            sessionId: session.id,
            message,
            fallbackActorName: task.agentName,
            causedByEventId: thinkingStartedEvent.eventId,
            causedBySeq: thinkingStartedEvent.seq
          });
          messageCreatedEvent = {
            eventId: appendedEvent.eventId,
            seq: appendedEvent.seq
          };
          aiMessages.push(message);
          onMessage?.(message);
          if (stream) {
            await new Promise<void>(resolve => setImmediate(resolve));
            await new Promise<void>(resolve => setTimeout(resolve, 30));
          }
        }
        if (invocationReviewResult?.visibleMessage) {
          const visibleReviewMessage = invocationReviewResult.visibleMessage;
          sessionService.appendMessage(session, visibleReviewMessage);
          const appendedEvent = appendAgentMessageCreatedEvent({
            sessionId: session.id,
            message: visibleReviewMessage,
            fallbackActorName: task.agentName,
            causedByEventId: thinkingStartedEvent.eventId,
            causedBySeq: thinkingStartedEvent.seq
          });
          reviewMessageEvent = {
            eventId: appendedEvent.eventId,
            seq: appendedEvent.seq
          };
          aiMessages.push(visibleReviewMessage);
          onMessage?.(visibleReviewMessage);
          if (stream) {
            await new Promise<void>(resolve => setImmediate(resolve));
          }
        }

        const postMessageStopMode = consumeExplicitStopMode();
        if (postMessageStopMode === 'current_agent' || postMessageStopMode === 'session') {
          if (postMessageStopMode === 'session') {
            queue.length = 0;
          }
          stopped = consumeStoppedMetadata(postMessageStopMode, task.agentName);
          streamStopped = true;
          runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} execution=${executionId || 'unknown'} agent=${task.agentName} stage=stream_stop_post_visible_message reason=explicit_stop scope=${postMessageStopMode}`);
          break;
        }

        const pendingMentionsToQueue: PendingAgentDispatchTask[] = invocationReviewResult ? [...invocationReviewResult.pendingTasks] : [];
        const allowContinuationQueue = task.dispatchKind !== 'summary' && task.dispatchKind !== 'internal_review';

        for (const mention of allowContinuationQueue ? chainedMentions : []) {
          const queuedChainedCalls = queue.filter(item => runtime.isChainedDispatchKind(item.dispatchKind)).length;
          const queuedCalls = callCounts.get(mention) || 0;
          const pendingChainedTargetCount = pendingMentionsToQueue
            .filter(item => runtime.isChainedDispatchKind(item.dispatchKind))
            .length;
          const pendingCalls = queue
            .filter(item => item.agentName === mention && item.dispatchKind !== 'internal_review')
            .length
            + pendingMentionsToQueue
              .filter(item => item.agentName === mention && item.dispatchKind !== 'internal_review')
              .length;
          if (!canQueueContinuationTarget({
            chainedCalls,
            queuedChainedCalls,
            pendingTargetCount: pendingChainedTargetCount,
            queuedCallsForAgent: queuedCalls,
            pendingCallsForAgent: pendingCalls,
            maxChainHops: agentChainMaxHops,
            maxCallsPerAgent: agentChainMaxCallsPerAgent
          })) {
            const wouldExceedHopLimit = chainedCalls + queuedChainedCalls + pendingChainedTargetCount >= agentChainMaxHops;
            if (wouldExceedHopLimit) {
              break;
            }

            runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} agent=${mention} stage=chain_skip reason=max_calls_pending count=${queuedCalls} pending=${pendingCalls}`);
            continue;
          }

          const callerAgentName = message.sender || task.agentName;
          const taskId = generateId();
          const deadlineAt = Date.now() + INVOCATION_TASK_DEFAULT_DEADLINE_MS;
          const shouldTrackCallerReview = task.dispatchKind !== 'summary';
          const reviewMode = shouldTrackCallerReview ? 'caller_review' : 'none';

          if (shouldTrackCallerReview) {
            runtime.createInvocationTask(userKey, session.id, {
              id: taskId,
              sessionId: session.id,
              status: 'pending_reply',
              callerAgentName,
              calleeAgentName: mention,
              prompt: message.text || '',
              originalPrompt: message.text || '',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              deadlineAt,
              retryCount: 0,
              followupCount: 0
            });
          }

          pendingMentionsToQueue.push({
            agentName: mention,
            prompt: message.text || '',
            includeHistory: true,
            dispatchKind: 'explicit_chained',
            taskId: shouldTrackCallerReview ? taskId : undefined,
            callerAgentName: shouldTrackCallerReview ? callerAgentName : undefined,
            calleeAgentName: shouldTrackCallerReview ? mention : undefined,
            reviewMode,
            deadlineAt: shouldTrackCallerReview ? deadlineAt : undefined
          });
        }

        if (!canContinue()) {
          const dispatchCauseEvent = reviewMessageEvent || messageCreatedEvent;
          appendDispatchRequestedEvents({
            sessionId: session.id,
            tasks: pendingMentionsToQueue,
            defaultActorName: message.sender || task.agentName,
            parentTaskId: task.taskId,
          causedByEventId: dispatchCauseEvent?.eventId,
          causedBySeq: dispatchCauseEvent?.seq
        });
        streamStopped = true;
        for (const pendingTask of pendingMentionsToQueue.reverse()) {
          appendInvocationQueuedEvent(session.id, pendingTask);
          if (pendingTask.agentName === task.agentName) {
            queue.unshift(pendingTask);
          } else {
            crossLanePendingTasks.unshift(pendingTask);
          }
        }
        runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} execution=${executionId || 'unknown'} agent=${task.agentName} stage=stream_stop_after_message reason=client_disconnect`);
        break;
      }

        const dispatchCauseEvent = reviewMessageEvent || messageCreatedEvent;
        appendDispatchRequestedEvents({
          sessionId: session.id,
          tasks: pendingMentionsToQueue,
          defaultActorName: message.sender || task.agentName,
          parentTaskId: task.taskId,
          causedByEventId: dispatchCauseEvent?.eventId,
          causedBySeq: dispatchCauseEvent?.seq
        });
        for (const pendingTask of pendingMentionsToQueue) {
          appendInvocationQueuedEvent(session.id, pendingTask);
          if (pendingTask.agentName === task.agentName) {
            queue.push(pendingTask);
          } else {
            crossLanePendingTasks.push(pendingTask);
          }
        }

        if (streamStopped) {
          break;
        }
      }

      if (streamStopped) {
        break;
      }
    }

    const result: ExecuteAgentTurnResult = {
      aiMessages,
      pendingTasks: (streamStopped ? [...queue, ...crossLanePendingTasks] : crossLanePendingTasks)
        .map(task => ({ ...task, dispatchKind: runtime.normalizeDispatchKind(task.dispatchKind) || 'initial' }))
    };
    if (stopped) {
      result.stopped = stopped;
    }
    return result;
  }

  async function executeAgentTurn(params: ExecuteAgentTurnParams): Promise<ExecuteAgentTurnResult> {
    const { userKey, session } = params;
    const aiMessages: Message[] = [];
    const normalizedPendingTasks: PendingAgentDispatchTask[] = Array.isArray(params.pendingTasks)
      ? params.pendingTasks.map(task => ({ ...task, dispatchKind: runtime.normalizeDispatchKind(task.dispatchKind) || 'initial' }))
      : params.initialTasks.map(task => ({ ...task, dispatchKind: runtime.normalizeDispatchKind(task.dispatchKind) || 'initial' }));
    let pendingTasks = normalizedPendingTasks;
    let stopped: ExecuteAgentTurnResult['stopped'];
    let sawVisibleMessage = false;

    while (true) {
      if (pendingTasks.length === 0) {
        const overdueReviewTasks = buildOverdueInvocationReviewTasks({
          userKey,
          session,
          now: Date.now()
        });
        if (overdueReviewTasks.length === 0) {
          break;
        }
        pendingTasks = overdueReviewTasks.map(task => ({ ...task, dispatchKind: runtime.normalizeDispatchKind(task.dispatchKind) || 'initial' }));
      }

      const laneTaskGroups = params.executionId
        ? [pendingTasks]
        : groupTasksByAgent(pendingTasks);
      pendingTasks = [];
      const laneResults = await Promise.all(laneTaskGroups.map(tasks => executeLaneTurn({
        ...params,
        initialTasks: [],
        pendingTasks: tasks
      })));

      for (const laneResult of laneResults) {
        if (laneResult.aiMessages.length > 0) {
          sawVisibleMessage = true;
          aiMessages.push(...laneResult.aiMessages);
        }
        if (laneResult.pendingTasks.length > 0) {
          pendingTasks.push(...laneResult.pendingTasks);
        }
        if (!stopped && laneResult.stopped) {
          stopped = laneResult.stopped;
        }
      }

      if (stopped) {
        break;
      }
    }

    const { discussionMode } = runtime.buildSessionResponse(session);
    if (!stopped && discussionMode === 'peer' && sawVisibleMessage) {
      const nextDiscussionState = resolvePeerDiscussionStateAfterTurn({
        discussionMode,
        sawVisibleMessage,
        hasPendingExplicitContinuation: pendingTasks.some(task => task.dispatchKind === 'explicit_chained')
      });
      if (nextDiscussionState === 'active') {
        sessionService.setDiscussionState(session, nextDiscussionState);
      } else if (nextDiscussionState === 'paused') {
        sessionService.setDiscussionState(session, nextDiscussionState);
        runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} stage=discussion_pause reason=no_explicit_continuation mode=peer`);
      }
    }

    return {
      aiMessages,
      pendingTasks,
      ...(stopped ? { stopped } : {})
    };
  }

  return {
    collectEligibleMentions,
    executeAgentTurn
  };
}
