import { DiscussionState, Message } from '../../types';
import { PendingAgentDispatchTask } from '../runtime/chat-runtime';

export interface SummaryInProgressParams {
  discussionMode: string;
  discussionState: DiscussionState;
  hasSummaryRequest: boolean;
}

export interface SelectManualSummaryAgentParams {
  enabledAgents: string[];
  currentAgent?: string | null;
}

export interface SummaryContinuationStateLike {
  discussionState: DiscussionState;
  pendingAgentTasks?: PendingAgentDispatchTask[];
  pendingVisibleMessages?: Message[];
}

export interface NormalizedSummaryContinuationState {
  discussionState: 'active' | 'paused';
  pendingAgentTasks?: PendingAgentDispatchTask[];
  pendingVisibleMessages?: Message[];
}

function clonePendingAgentTasks(pendingAgentTasks?: PendingAgentDispatchTask[]): PendingAgentDispatchTask[] | undefined {
  return pendingAgentTasks && pendingAgentTasks.length > 0
    ? pendingAgentTasks.map(task => ({ ...task }))
    : undefined;
}

function clonePendingVisibleMessages(pendingVisibleMessages?: Message[]): Message[] | undefined {
  return pendingVisibleMessages && pendingVisibleMessages.length > 0
    ? pendingVisibleMessages.map(message => ({ ...message }))
    : undefined;
}

export function canStartManualSummary(discussionMode: string): boolean {
  return discussionMode === 'peer';
}

export function isSummaryInProgress(params: SummaryInProgressParams): boolean {
  return params.discussionMode === 'peer'
    && (params.discussionState === 'summarizing' || params.hasSummaryRequest);
}

export function selectManualSummaryAgent(params: SelectManualSummaryAgentParams): string | null {
  if (params.enabledAgents.length === 0) {
    return null;
  }

  if (params.currentAgent && params.enabledAgents.includes(params.currentAgent)) {
    return params.currentAgent;
  }

  return params.enabledAgents[0] || null;
}

export function normalizeSummaryContinuationState(snapshot: SummaryContinuationStateLike): NormalizedSummaryContinuationState {
  return {
    discussionState: snapshot.discussionState === 'active' ? 'active' : 'paused',
    pendingAgentTasks: clonePendingAgentTasks(snapshot.pendingAgentTasks),
    pendingVisibleMessages: clonePendingVisibleMessages(snapshot.pendingVisibleMessages)
  };
}
