import { Message } from '../../types';
import { createSessionAgentService } from './session-agent-service';
import { createSessionCommandService } from './session-command-service';
import { createSessionDiscussionService } from './session-discussion-service';
import { createSessionQueryService } from './session-query-service';
import type { DiscussionState } from '../../types';
import type { PendingAgentDispatchTask, UserChatSession } from '../runtime/chat-runtime';
import type {
  SessionService,
  SessionServiceDependencies,
  SessionUserContext,
  SummaryContinuationState
} from './session-service-types';

export type {
  SessionService,
  SessionServiceDependencies,
  SessionUserContext,
  SummaryContinuationState
} from './session-service-types';

export class SessionServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'SessionServiceError';
  }
}

function createSessionServiceError(message: string, statusCode: number): SessionServiceError {
  return new SessionServiceError(message, statusCode);
}

export function createSessionService(deps: SessionServiceDependencies): SessionService {
  const queryService = createSessionQueryService({
    runtime: deps.runtime
  });
  const commandService = createSessionCommandService({
    runtime: deps.runtime,
    queryService,
    createError: createSessionServiceError
  });
  const agentService = createSessionAgentService({
    runtime: deps.runtime,
    queryService,
    hasAgent: deps.hasAgent,
    createError: createSessionServiceError
  });
  const discussionService = createSessionDiscussionService({
    runtime: deps.runtime
  });

  function getHistory(context: SessionUserContext, agents: unknown[]) {
    return queryService.getHistory(context, agents);
  }

  function clearHistory(context: SessionUserContext): { success: true } {
    return commandService.clearHistory(context);
  }

  function createChatSession(context: SessionUserContext, name?: string) {
    return commandService.createChatSession(context, name);
  }

  function selectChatSession(context: SessionUserContext, sessionId: string) {
    return commandService.selectChatSession(context, sessionId);
  }

  function renameChatSession(context: SessionUserContext, sessionId: string, name: string) {
    return commandService.renameChatSession(context, sessionId, name);
  }

  function deleteChatSession(context: SessionUserContext, sessionId: string) {
    return commandService.deleteChatSession(context, sessionId);
  }

  function updateChatSession(context: SessionUserContext, sessionId: string, patch: unknown) {
    return commandService.updateChatSession(context, sessionId, patch);
  }

  function setSessionAgent(context: SessionUserContext, payload: { sessionId?: string; agentName: string; enabled: boolean }) {
    return agentService.setSessionAgent(context, payload);
  }

  function switchAgent(context: SessionUserContext, agentName?: string | null) {
    return agentService.switchAgent(context, agentName);
  }

  function setWorkdir(context: SessionUserContext, agentName: string, workdir: string | null) {
    return agentService.setWorkdir(context, agentName, workdir);
  }

  function getEnabledAgents(session: UserChatSession): string[] {
    return agentService.getEnabledAgents(session);
  }

  function isAgentEnabled(session: UserChatSession, agentName: string): boolean {
    return agentService.isAgentEnabled(session, agentName);
  }

  function getCurrentAgent(userKey: string, sessionId: string): string | null {
    return agentService.getCurrentAgent(userKey, sessionId);
  }

  function selectCurrentAgent(userKey: string, sessionId: string, agentName: string | null): void {
    agentService.selectCurrentAgent(userKey, sessionId, agentName);
  }

  function expireInvalidCurrentAgent(userKey: string, session: UserChatSession): string | null {
    return agentService.expireInvalidCurrentAgent(userKey, session);
  }

  function getAgentWorkdir(userKey: string, sessionId: string, agentName: string): string | null {
    return agentService.getAgentWorkdir(userKey, sessionId, agentName);
  }

  function appendMessage(session: UserChatSession, message: Message): void {
    discussionService.appendMessage(session, message);
  }

  function prepareForIncomingMessage(session: UserChatSession): void {
    discussionService.prepareForIncomingMessage(session);
  }

  function updatePendingExecution(session: UserChatSession, pendingTasks?: PendingAgentDispatchTask[], pendingVisibleMessages?: Message[]): void {
    discussionService.updatePendingExecution(session, pendingTasks, pendingVisibleMessages);
  }

  function takePendingExecution(session: UserChatSession): { pendingTasks: PendingAgentDispatchTask[]; pendingVisibleMessages: Message[] } {
    return discussionService.takePendingExecution(session);
  }

  function setDiscussionState(session: UserChatSession, discussionState: DiscussionState): void {
    discussionService.setDiscussionState(session, discussionState);
  }

  function isSessionSummaryInProgress(userKey: string, session: UserChatSession): boolean {
    return discussionService.isSessionSummaryInProgress(userKey, session);
  }

  function snapshotSummaryContinuationState(session: UserChatSession): SummaryContinuationState {
    return discussionService.snapshotSummaryContinuationState(session);
  }

  function restoreSummaryContinuationState(session: UserChatSession, snapshot: SummaryContinuationState): void {
    discussionService.restoreSummaryContinuationState(session, snapshot);
  }

  function markSummaryInProgress(session: UserChatSession): void {
    discussionService.markSummaryInProgress(session);
  }

  function resolveManualSummaryAgent(session: UserChatSession): string | null {
    return discussionService.resolveManualSummaryAgent(session);
  }

  function buildManualSummaryPrompt(session: UserChatSession): string {
    return discussionService.buildManualSummaryPrompt(session);
  }

  function buildNoEnabledAgentsNotice(session: UserChatSession, ignoredMentions: string[] = []): string {
    return discussionService.buildNoEnabledAgentsNotice(session, ignoredMentions);
  }

  return {
    resolveChatSession: queryService.resolveChatSession,
    getHistory,
    clearHistory,
    createChatSession,
    selectChatSession,
    renameChatSession,
    deleteChatSession,
    updateChatSession,
    setSessionAgent,
    switchAgent,
    setWorkdir,
    getEnabledAgents,
    isAgentEnabled,
    getCurrentAgent,
    selectCurrentAgent,
    expireInvalidCurrentAgent,
    getAgentWorkdir,
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
