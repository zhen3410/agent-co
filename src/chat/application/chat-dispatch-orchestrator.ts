import { InvocationReviewAction, Message } from '../../types';
import { AgentManager } from '../../agent-manager';
import { SessionService } from './session-service';
import { ChatRuntime, UserChatSession } from '../runtime/chat-runtime';
import { generateId } from '../runtime/chat-runtime-types';
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
        return {
          suppressMessage: true,
          pendingTasks: []
        };
      }
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

  async function executeAgentTurn(params: ExecuteAgentTurnParams): Promise<ExecuteAgentTurnResult> {
    const { userKey, session, initialTasks, stream, onThinking, onTextDelta, onMessage, shouldContinue, signal } = params;
    const queue: PendingAgentDispatchTask[] = Array.isArray(params.pendingTasks)
      ? params.pendingTasks.map(task => ({ ...task, dispatchKind: runtime.normalizeDispatchKind(task.dispatchKind) || 'initial' }))
      : initialTasks.map(task => ({ ...task, dispatchKind: runtime.normalizeDispatchKind(task.dispatchKind) || 'initial' }));
    const aiMessages: Message[] = [];
    const callCounts = new Map<string, number>();
    const { agentChainMaxHops, agentChainMaxCallsPerAgent, discussionMode } = runtime.buildSessionResponse(session);
    let chainedCalls = 0;
    let streamStopped = false;
    let sawVisibleMessage = false;
    let stopped: ExecuteAgentTurnResult['stopped'];

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
        resumeAvailable: scope === 'current_agent' && queue.length > 0
      };
    };

    while (true) {
      if (queue.length === 0) {
        if (streamStopped) {
          break;
        }

        const overdueReviewTasks = buildOverdueInvocationReviewTasks({
          userKey,
          session,
          now: Date.now()
        });
        if (overdueReviewTasks.length === 0) {
          break;
        }
        queue.push(...overdueReviewTasks);
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

      const stopMode = consumeExplicitStopMode();
      if (stopMode === 'current_agent' || stopMode === 'session') {
        if (stopMode === 'session') {
          queue.length = 0;
        }
        stopped = consumeStoppedMetadata(stopMode, task.agentName);
        streamStopped = true;
        runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} execution=${executionId || 'unknown'} agent=${task.agentName} stage=stream_stop_during_task reason=explicit_stop scope=${stopMode} visible_messages=${visibleMessages.length}`);
        break;
      }

      if (signal?.aborted && visibleMessages.length === 0) {
        queue.unshift(task);
        streamStopped = true;
        runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} execution=${executionId || 'unknown'} agent=${task.agentName} stage=stream_stop_during_task reason=client_disconnect`);
        break;
      }

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

        if (!shouldSuppressMessage) {
          sawVisibleMessage = true;
          sessionService.appendMessage(session, message);
          aiMessages.push(message);
          onMessage?.(message);
          if (stream) {
            await new Promise<void>(resolve => setImmediate(resolve));
            await new Promise<void>(resolve => setTimeout(resolve, 30));
          }
        }
        if (invocationReviewResult?.visibleMessage) {
          const visibleReviewMessage = invocationReviewResult.visibleMessage;
          sawVisibleMessage = true;
          sessionService.appendMessage(session, visibleReviewMessage);
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
          streamStopped = true;
          queue.unshift(...pendingMentionsToQueue);
          runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} execution=${executionId || 'unknown'} agent=${task.agentName} stage=stream_stop_after_message reason=client_disconnect`);
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
      const nextDiscussionState = resolvePeerDiscussionStateAfterTurn({
        discussionMode,
        sawVisibleMessage,
        hasPendingExplicitContinuation: queue.some(task => task.dispatchKind === 'explicit_chained')
      });
      if (nextDiscussionState === 'active') {
        sessionService.setDiscussionState(session, nextDiscussionState);
      } else if (nextDiscussionState === 'paused') {
        sessionService.setDiscussionState(session, nextDiscussionState);
        runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} stage=discussion_pause reason=no_explicit_continuation mode=peer`);
      }
    }

    const result: ExecuteAgentTurnResult = {
      aiMessages,
      pendingTasks: streamStopped ? queue.map(task => ({ ...task, dispatchKind: runtime.normalizeDispatchKind(task.dispatchKind) || 'initial' })) : []
    };
    if (stopped) {
      result.stopped = stopped;
    }
    return result;
  }

  return {
    collectEligibleMentions,
    executeAgentTurn
  };
}
