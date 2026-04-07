import { Message } from '../../types';
import { AgentManager } from '../../agent-manager';
import { SessionService } from './session-service';
import { ChatRuntime, PendingAgentDispatchTask, UserChatSession } from '../runtime/chat-runtime';
import {
  AgentDispatchTask,
  ChatDispatchOrchestrator,
  ExecuteAgentTurnParams,
  ExecuteAgentTurnResult,
  MentionCollectionResult,
  RunAgentTask
} from './chat-service-types';
import {
  canQueueContinuationTarget,
  collectImplicitPeerContinuationTargets,
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

  async function executeAgentTurn(params: ExecuteAgentTurnParams): Promise<ExecuteAgentTurnResult> {
    const { userKey, session, initialTasks, stream, onThinking, onTextDelta, onMessage, shouldContinue } = params;
    const queue: PendingAgentDispatchTask[] = Array.isArray(params.pendingTasks)
      ? params.pendingTasks.map(task => ({ ...task, dispatchKind: runtime.normalizeDispatchKind(task.dispatchKind) || 'initial' }))
      : initialTasks.map(task => ({ ...task, dispatchKind: runtime.normalizeDispatchKind(task.dispatchKind) || 'initial' }));
    const aiMessages: Message[] = [];
    const callCounts = new Map<string, number>();
    const { agentChainMaxHops, agentChainMaxCallsPerAgent, discussionMode } = runtime.buildSessionResponse(session);
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
      if (!shouldRunChainedTask({
        dispatchKind: task.dispatchKind,
        chainedCalls,
        maxChainHops: agentChainMaxHops
      })) {
        runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} stage=chain_stop reason=max_hops hops=${agentChainMaxHops}`);
        break;
      }

      const currentCalls = callCounts.get(task.agentName) || 0;
      if (shouldSkipAgentTaskForCallLimit({
        currentCalls,
        maxCallsPerAgent: agentChainMaxCallsPerAgent
      })) {
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

        const message: Message = {
          ...rawMessage,
          text: displayText,
          mentions: referenceMentions.length > 0 ? referenceMentions : undefined,
          invokeAgents: chainedMentions.length > 0 ? chainedMentions : undefined,
          dispatchKind: task.dispatchKind
        };

        sawVisibleMessage = true;
        sessionService.appendMessage(session, message);
        aiMessages.push(message);
        onMessage?.(message);
        if (stream) {
          await new Promise<void>(resolve => setImmediate(resolve));
        }

        const pendingMentionsToQueue: PendingAgentDispatchTask[] = [];
        const allowContinuationQueue = task.dispatchKind !== 'summary';

        for (const mention of allowContinuationQueue ? chainedMentions : []) {
          const queuedChainedCalls = queue.filter(item => runtime.isChainedDispatchKind(item.dispatchKind)).length;
          const queuedCalls = callCounts.get(mention) || 0;
          const pendingCalls = queue.filter(item => item.agentName === mention).length
            + pendingMentionsToQueue.filter(item => item.agentName === mention).length;
          if (!canQueueContinuationTarget({
            chainedCalls,
            queuedChainedCalls,
            pendingTargetCount: pendingMentionsToQueue.length,
            queuedCallsForAgent: queuedCalls,
            pendingCallsForAgent: pendingCalls,
            maxChainHops: agentChainMaxHops,
            maxCallsPerAgent: agentChainMaxCallsPerAgent
          })) {
            const wouldExceedHopLimit = chainedCalls + queuedChainedCalls + pendingMentionsToQueue.length >= agentChainMaxHops;
            if (wouldExceedHopLimit) {
              break;
            }

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

    return {
      aiMessages,
      pendingTasks: streamStopped ? queue.map(task => ({ ...task, dispatchKind: runtime.normalizeDispatchKind(task.dispatchKind) || 'initial' })) : []
    };
  }

  return {
    collectEligibleMentions,
    executeAgentTurn
  };
}
