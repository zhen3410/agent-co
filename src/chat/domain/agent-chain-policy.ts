import { DiscussionState, Message } from '../../types';

export interface ImplicitPeerContinuationTargetParams {
  message: string;
  enabledAgents: string[];
  sender?: string | null;
}

export interface ShouldRunChainedTaskParams {
  dispatchKind?: Message['dispatchKind'];
  chainedCalls: number;
  maxChainHops: number;
}

export interface ShouldSkipAgentTaskForCallLimitParams {
  currentCalls: number;
  maxCallsPerAgent: number | null;
}

export interface CanQueueContinuationTargetParams {
  chainedCalls: number;
  queuedChainedCalls: number;
  pendingTargetCount: number;
  queuedCallsForAgent: number;
  pendingCallsForAgent: number;
  maxChainHops: number;
  maxCallsPerAgent: number | null;
}

export interface WouldExceedContinuationHopLimitParams {
  chainedCalls: number;
  queuedChainedCalls: number;
  pendingTargetCount: number;
  maxChainHops: number;
}

export interface ShouldSkipQueuedAgentTaskForCallLimitParams {
  queuedCallsForAgent: number;
  pendingCallsForAgent: number;
  maxCallsPerAgent: number | null;
}

export interface ResolvePeerDiscussionStateAfterTurnParams {
  discussionMode: string;
  sawVisibleMessage: boolean;
  hasPendingExplicitContinuation: boolean;
}

export function collectImplicitPeerContinuationTargets(params: ImplicitPeerContinuationTargetParams): string[] {
  const text = params.message || '';
  if (!text) {
    return [];
  }

  const continuationHints = '(?:请|继续|补充|回应|跟进|接着|展开|说明|回答|评估|接力|发表|给出|看看|确认|讲讲)';
  const handoffHints = '(?:请|让|由|烦请|麻烦)';
  const matches: string[] = [];

  for (const agentName of params.enabledAgents) {
    if (!agentName || agentName === params.sender) {
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

export function shouldRunChainedTask(params: ShouldRunChainedTaskParams): boolean {
  if (params.dispatchKind === 'explicit_chained' || params.dispatchKind === 'implicit_chained') {
    return params.chainedCalls < params.maxChainHops;
  }

  return true;
}

export function shouldSkipAgentTaskForCallLimit(params: ShouldSkipAgentTaskForCallLimitParams): boolean {
  return params.maxCallsPerAgent !== null && params.currentCalls >= params.maxCallsPerAgent;
}

export function wouldExceedContinuationHopLimit(params: WouldExceedContinuationHopLimitParams): boolean {
  return params.chainedCalls + params.queuedChainedCalls + params.pendingTargetCount >= params.maxChainHops;
}

export function shouldSkipQueuedAgentTaskForCallLimit(params: ShouldSkipQueuedAgentTaskForCallLimitParams): boolean {
  return params.maxCallsPerAgent !== null && params.queuedCallsForAgent + params.pendingCallsForAgent >= params.maxCallsPerAgent;
}

export function canQueueContinuationTarget(params: CanQueueContinuationTargetParams): boolean {
  return !wouldExceedContinuationHopLimit(params)
    && !shouldSkipQueuedAgentTaskForCallLimit(params);
}

export function resolvePeerDiscussionStateAfterTurn(params: ResolvePeerDiscussionStateAfterTurnParams): DiscussionState | null {
  if (params.discussionMode !== 'peer' || !params.sawVisibleMessage) {
    return null;
  }

  return params.hasPendingExplicitContinuation ? 'active' : 'paused';
}
