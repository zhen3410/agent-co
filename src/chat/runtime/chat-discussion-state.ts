import { AgentDispatchKind, DiscussionMode, DiscussionState, Message } from '../../types';
import { PendingAgentDispatchTask, UserChatSession } from '../infrastructure/chat-session-repository';
import {
  ChatRuntimeConfig,
  SessionChainPatch,
  SummaryContinuationState,
  DEFAULT_DISCUSSION_MODE,
  DEFAULT_DISCUSSION_STATE,
  normalizePositiveSessionSetting
} from './chat-runtime-types';

interface ChatDiscussionStateDependencies {
  config: Pick<ChatRuntimeConfig, 'defaultAgentChainMaxHops'>;
  touchSession(session: UserChatSession): void;
}

interface ChatDiscussionState {
  normalizeSessionChainSettings(source?: SessionChainPatch): Required<Pick<UserChatSession, 'agentChainMaxHops' | 'agentChainMaxCallsPerAgent'>>;
  normalizeSessionDiscussionSettings(source?: Pick<UserChatSession, 'discussionMode' | 'discussionState'>): Required<Pick<UserChatSession, 'discussionMode' | 'discussionState'>>;
  normalizeDiscussionMode(value: unknown, fallback?: DiscussionMode): DiscussionMode;
  normalizeDiscussionState(value: unknown, fallback?: DiscussionState): DiscussionState;
  normalizeDispatchKind(value: unknown, fallback?: AgentDispatchKind | null): AgentDispatchKind | null;
  isChainedDispatchKind(dispatchKind: AgentDispatchKind): boolean;
  applyNormalizedSessionDiscussionSettings<T extends UserChatSession>(session: T): T & Required<Pick<UserChatSession, 'discussionMode' | 'discussionState'>>;
  applyNormalizedSessionChainSettings<T extends UserChatSession>(session: T): T & Required<Pick<UserChatSession, 'agentChainMaxHops' | 'agentChainMaxCallsPerAgent'>>;
  beginSummaryRequest(key: string): boolean;
  endSummaryRequest(key: string): void;
  hasSummaryRequest(key: string): boolean;
  appendMessage(session: UserChatSession, message: Message): void;
  prepareForIncomingMessage(session: UserChatSession): void;
  updatePendingExecution(session: UserChatSession, pendingTasks?: PendingAgentDispatchTask[], pendingVisibleMessages?: Message[]): void;
  takePendingExecution(session: UserChatSession): { pendingTasks: PendingAgentDispatchTask[]; pendingVisibleMessages: Message[] };
  setDiscussionState(session: UserChatSession, discussionState: DiscussionState): void;
  snapshotSummaryContinuationState(session: UserChatSession): SummaryContinuationState;
  restoreSummaryContinuationState(session: UserChatSession, snapshot: SummaryContinuationState): void;
  markSummaryInProgress(session: UserChatSession): void;
}

export function createChatDiscussionState(deps: ChatDiscussionStateDependencies): ChatDiscussionState {
  const summaryRequestsInProgress = new Set<string>();

  function normalizeSessionChainSettings(source?: SessionChainPatch): Required<Pick<UserChatSession, 'agentChainMaxHops' | 'agentChainMaxCallsPerAgent'>> {
    return {
      agentChainMaxHops: normalizePositiveSessionSetting(source?.agentChainMaxHops, deps.config.defaultAgentChainMaxHops, false) as number,
      agentChainMaxCallsPerAgent: normalizePositiveSessionSetting(source?.agentChainMaxCallsPerAgent, null, true)
    };
  }

  function normalizeDiscussionMode(value: unknown, fallback: DiscussionMode = DEFAULT_DISCUSSION_MODE): DiscussionMode {
    return value === 'peer' || value === 'classic' ? value : fallback;
  }

  function normalizeDiscussionState(value: unknown, fallback: DiscussionState = DEFAULT_DISCUSSION_STATE): DiscussionState {
    return value === 'paused' || value === 'summarizing' || value === 'active' ? value : fallback;
  }

  function normalizeSessionDiscussionSettings(source?: Pick<UserChatSession, 'discussionMode' | 'discussionState'>): Required<Pick<UserChatSession, 'discussionMode' | 'discussionState'>> {
    const discussionMode = normalizeDiscussionMode(source?.discussionMode);
    return {
      discussionMode,
      discussionState: discussionMode === 'peer'
        ? normalizeDiscussionState(source?.discussionState)
        : 'active'
    };
  }

  function normalizeDispatchKind(value: unknown, fallback: AgentDispatchKind | null = 'initial'): AgentDispatchKind | null {
    if (value === 'explicit_chained' || value === 'implicit_chained' || value === 'summary' || value === 'initial') {
      return value;
    }

    return value === 'chained' ? 'explicit_chained' : fallback;
  }

  function isChainedDispatchKind(dispatchKind: AgentDispatchKind): boolean {
    return dispatchKind === 'explicit_chained' || dispatchKind === 'implicit_chained';
  }

  function applyNormalizedSessionChainSettings<T extends UserChatSession>(session: T): T & Required<Pick<UserChatSession, 'agentChainMaxHops' | 'agentChainMaxCallsPerAgent'>> {
    const normalized = normalizeSessionChainSettings(session);
    session.agentChainMaxHops = normalized.agentChainMaxHops;
    session.agentChainMaxCallsPerAgent = normalized.agentChainMaxCallsPerAgent;
    return session as T & Required<Pick<UserChatSession, 'agentChainMaxHops' | 'agentChainMaxCallsPerAgent'>>;
  }

  function applyNormalizedSessionDiscussionSettings<T extends UserChatSession>(session: T): T & Required<Pick<UserChatSession, 'discussionMode' | 'discussionState'>> {
    const normalized = normalizeSessionDiscussionSettings(session);
    session.discussionMode = normalized.discussionMode;
    session.discussionState = normalized.discussionState;
    return session as T & Required<Pick<UserChatSession, 'discussionMode' | 'discussionState'>>;
  }

  function beginSummaryRequest(key: string): boolean {
    if (summaryRequestsInProgress.has(key)) {
      return false;
    }
    summaryRequestsInProgress.add(key);
    return true;
  }

  function endSummaryRequest(key: string): void {
    summaryRequestsInProgress.delete(key);
  }

  function hasSummaryRequest(key: string): boolean {
    return summaryRequestsInProgress.has(key);
  }

  function appendMessage(session: UserChatSession, message: Message): void {
    session.history.push(message);
    deps.touchSession(session);
  }

  function prepareForIncomingMessage(session: UserChatSession): void {
    session.discussionState = 'active';
    session.pendingAgentTasks = undefined;
    session.pendingVisibleMessages = undefined;
    deps.touchSession(session);
  }

  function updatePendingExecution(session: UserChatSession, pendingTasks?: PendingAgentDispatchTask[], pendingVisibleMessages?: Message[]): void {
    session.pendingAgentTasks = pendingTasks && pendingTasks.length > 0
      ? pendingTasks.map(task => ({ ...task }))
      : undefined;
    session.pendingVisibleMessages = pendingVisibleMessages && pendingVisibleMessages.length > 0
      ? pendingVisibleMessages.map(message => ({ ...message }))
      : undefined;
    deps.touchSession(session);
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
    deps.touchSession(session);

    return {
      pendingTasks,
      pendingVisibleMessages
    };
  }

  function setDiscussionState(session: UserChatSession, discussionState: DiscussionState): void {
    session.discussionState = discussionState;
    deps.touchSession(session);
  }

  function snapshotSummaryContinuationState(session: UserChatSession): SummaryContinuationState {
    return {
      discussionState: normalizeDiscussionState(session.discussionState),
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
    deps.touchSession(session);
  }

  function markSummaryInProgress(session: UserChatSession): void {
    session.discussionState = 'summarizing';
    session.pendingAgentTasks = undefined;
    session.pendingVisibleMessages = undefined;
    deps.touchSession(session);
  }

  return {
    normalizeSessionChainSettings,
    normalizeSessionDiscussionSettings,
    normalizeDiscussionMode,
    normalizeDiscussionState,
    normalizeDispatchKind,
    isChainedDispatchKind,
    applyNormalizedSessionDiscussionSettings,
    applyNormalizedSessionChainSettings,
    beginSummaryRequest,
    endSummaryRequest,
    hasSummaryRequest,
    appendMessage,
    prepareForIncomingMessage,
    updatePendingExecution,
    takePendingExecution,
    setDiscussionState,
    snapshotSummaryContinuationState,
    restoreSummaryContinuationState,
    markSummaryInProgress
  };
}
