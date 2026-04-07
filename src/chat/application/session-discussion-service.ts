import { DiscussionState, Message } from '../../types';
import { ChatRuntime, PendingAgentDispatchTask, UserChatSession } from '../runtime/chat-runtime';
import { SummaryContinuationState } from './session-service-types';

export interface SessionDiscussionServiceDependencies {
  runtime: ChatRuntime;
}

export interface SessionDiscussionService {
  appendMessage(session: UserChatSession, message: Message): void;
  prepareForIncomingMessage(session: UserChatSession): void;
  updatePendingExecution(session: UserChatSession, pendingTasks?: PendingAgentDispatchTask[], pendingVisibleMessages?: Message[]): void;
  takePendingExecution(session: UserChatSession): { pendingTasks: PendingAgentDispatchTask[]; pendingVisibleMessages: Message[] };
  setDiscussionState(session: UserChatSession, discussionState: DiscussionState): void;
  isSessionSummaryInProgress(userKey: string, session: UserChatSession): boolean;
  snapshotSummaryContinuationState(session: UserChatSession): SummaryContinuationState;
  restoreSummaryContinuationState(session: UserChatSession, snapshot: SummaryContinuationState): void;
  markSummaryInProgress(session: UserChatSession): void;
  resolveManualSummaryAgent(session: UserChatSession): string | null;
  buildManualSummaryPrompt(session: UserChatSession): string;
  buildNoEnabledAgentsNotice(session: UserChatSession, ignoredMentions?: string[]): string;
}

export function createSessionDiscussionService(deps: SessionDiscussionServiceDependencies): SessionDiscussionService {
  const { runtime } = deps;

  function appendMessage(session: UserChatSession, message: Message): void {
    session.history.push(message);
    runtime.touchSession(session);
  }

  function prepareForIncomingMessage(session: UserChatSession): void {
    session.discussionState = 'active';
    session.pendingAgentTasks = undefined;
    session.pendingVisibleMessages = undefined;
    runtime.touchSession(session);
  }

  function updatePendingExecution(session: UserChatSession, pendingTasks?: PendingAgentDispatchTask[], pendingVisibleMessages?: Message[]): void {
    session.pendingAgentTasks = pendingTasks && pendingTasks.length > 0
      ? pendingTasks.map(task => ({ ...task }))
      : undefined;
    session.pendingVisibleMessages = pendingVisibleMessages && pendingVisibleMessages.length > 0
      ? pendingVisibleMessages.map(message => ({ ...message }))
      : undefined;
    runtime.touchSession(session);
  }

  function takePendingExecution(session: UserChatSession): { pendingTasks: PendingAgentDispatchTask[]; pendingVisibleMessages: Message[] } {
    const pendingVisibleMessages = Array.isArray(session.pendingVisibleMessages)
      ? session.pendingVisibleMessages.map(message => ({ ...message }))
      : [];
    const pendingTasks = Array.isArray(session.pendingAgentTasks)
      ? session.pendingAgentTasks.map(task => ({ ...task }))
      : [];

    if (pendingVisibleMessages.length === 0 && pendingTasks.length === 0) {
      return {
        pendingTasks,
        pendingVisibleMessages
      };
    }

    session.pendingVisibleMessages = undefined;
    session.pendingAgentTasks = undefined;
    runtime.touchSession(session);

    return {
      pendingTasks,
      pendingVisibleMessages
    };
  }

  function setDiscussionState(session: UserChatSession, discussionState: DiscussionState): void {
    session.discussionState = discussionState;
    runtime.touchSession(session);
  }

  function isSessionSummaryInProgress(userKey: string, session: UserChatSession): boolean {
    return runtime.normalizeDiscussionMode(session.discussionMode) === 'peer'
      && (runtime.normalizeDiscussionState(session.discussionState) === 'summarizing'
        || runtime.hasSummaryRequest(`${userKey}::${session.id}`));
  }

  function snapshotSummaryContinuationState(session: UserChatSession): SummaryContinuationState {
    return {
      discussionState: runtime.normalizeDiscussionState(session.discussionState),
      pendingAgentTasks: Array.isArray(session.pendingAgentTasks)
        ? session.pendingAgentTasks.map(task => ({ ...task }))
        : undefined,
      pendingVisibleMessages: Array.isArray(session.pendingVisibleMessages)
        ? session.pendingVisibleMessages.map(message => ({ ...message }))
        : undefined
    };
  }

  function restoreSummaryContinuationState(session: UserChatSession, snapshot: SummaryContinuationState): void {
    session.pendingAgentTasks = snapshot.pendingAgentTasks && snapshot.pendingAgentTasks.length > 0
      ? snapshot.pendingAgentTasks.map(task => ({ ...task }))
      : undefined;
    session.pendingVisibleMessages = snapshot.pendingVisibleMessages && snapshot.pendingVisibleMessages.length > 0
      ? snapshot.pendingVisibleMessages.map(message => ({ ...message }))
      : undefined;
    session.discussionState = snapshot.discussionState === 'active' ? 'active' : 'paused';
    runtime.touchSession(session);
  }

  function markSummaryInProgress(session: UserChatSession): void {
    session.discussionState = 'summarizing';
    session.pendingAgentTasks = undefined;
    session.pendingVisibleMessages = undefined;
    runtime.touchSession(session);
  }

  function resolveManualSummaryAgent(session: UserChatSession): string | null {
    const enabledAgents = runtime.getSessionEnabledAgents(session);
    if (enabledAgents.length === 0) {
      return null;
    }

    if (session.currentAgent && enabledAgents.includes(session.currentAgent)) {
      return session.currentAgent;
    }

    return enabledAgents[0] || null;
  }

  function buildManualSummaryPrompt(session: UserChatSession): string {
    const messageCount = Array.isArray(session.history) ? session.history.length : 0;
    return [
      '请基于当前对话生成一份简明总结。',
      '要求：',
      '1. 提炼主要观点、分歧与当前结论；',
      '2. 若结论未完全收敛，请明确说明；',
      '3. 不要继续点名其他智能体，不要恢复讨论链路；',
      `4. 当前会话消息数：${messageCount}。`
    ].join('\n');
  }

  function buildNoEnabledAgentsNotice(session: UserChatSession, ignoredMentions: string[] = []): string {
    if (ignoredMentions.length > 0) {
      return `${ignoredMentions.join('、')} 已停用，当前会话还没有可用智能体，请先启用上方智能体。`;
    }
    if (runtime.getSessionEnabledAgents(session).length === 0) {
      return '当前会话还没有启用智能体，请先启用上方智能体。';
    }
    return '当前会话没有可用智能体，请先启用上方智能体。';
  }

  return {
    appendMessage,
    prepareForIncomingMessage,
    updatePendingExecution,
    takePendingExecution,
    setDiscussionState,
    isSessionSummaryInProgress,
    snapshotSummaryContinuationState,
    restoreSummaryContinuationState,
    markSummaryInProgress,
    resolveManualSummaryAgent,
    buildManualSummaryPrompt,
    buildNoEnabledAgentsNotice
  };
}
