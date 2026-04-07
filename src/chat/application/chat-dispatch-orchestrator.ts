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

export interface ChatDispatchOrchestratorDependencies {
  runtime: ChatRuntime;
  sessionService: SessionService;
  agentManager: AgentManager;
  runAgentTask: RunAgentTask;
}

function collectImplicitPeerContinuationMentions(
  message: string,
  session: UserChatSession,
  sender: string | null | undefined,
  sessionService: SessionService
): string[] {
  const text = message || '';
  if (!text) return [];

  const continuationHints = '(?:请|继续|补充|回应|跟进|接着|展开|说明|回答|评估|接力|发表|给出|看看|确认|讲讲)';
  const handoffHints = '(?:请|让|由|烦请|麻烦)';
  const matches: string[] = [];

  for (const agentName of sessionService.getEnabledAgents(session)) {
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
            chainTargets = collectImplicitPeerContinuationMentions(rawMessage.text || '', session, rawMessage.sender, sessionService);
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
        sessionService.setDiscussionState(session, 'active');
      } else {
        sessionService.setDiscussionState(session, 'paused');
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
