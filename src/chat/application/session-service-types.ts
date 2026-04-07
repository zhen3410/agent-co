import { DiscussionState, Message } from '../../types';
import { AppErrorCode } from '../../shared/errors/app-error-codes';
import { ChatRuntime, PendingAgentDispatchTask, UserChatSession } from '../runtime/chat-runtime';

export interface SessionServiceDependencies {
  runtime: ChatRuntime;
  hasAgent(agentName: string): boolean;
}

export interface SessionUserContext {
  userKey: string;
}

export interface SummaryContinuationState {
  discussionState: DiscussionState;
  pendingAgentTasks?: PendingAgentDispatchTask[];
  pendingVisibleMessages?: Message[];
}

export interface SessionHistoryResponse {
  messages: Message[];
  agents: unknown[];
  currentAgent: string | null;
  enabledAgents: string[];
  agentWorkdirs: Record<string, string>;
  session: ReturnType<ChatRuntime['buildDetailedSessionResponse']>;
  chatSessions: ReturnType<ChatRuntime['getSessionSummaries']>;
  activeSessionId: string;
}

export interface SessionSelectionResponse {
  success: true;
  messages: Message[];
  currentAgent: string | null;
  enabledAgents: string[];
  session: ReturnType<ChatRuntime['buildDetailedSessionResponse']>;
  activeSessionId: string;
  chatSessions: ReturnType<ChatRuntime['getSessionSummaries']>;
}

export interface SessionMutationResponse {
  success: true;
  session: ReturnType<ChatRuntime['buildSessionResponse']>;
  enabledAgents: string[];
  chatSessions: ReturnType<ChatRuntime['getSessionSummaries']>;
  activeSessionId: string;
}

export interface SessionRenameResponse {
  success: true;
  session: ReturnType<ChatRuntime['buildSessionResponse']>;
  chatSessions: ReturnType<ChatRuntime['getSessionSummaries']>;
}

export interface SessionDeleteResponse {
  success: true;
  activeSessionId: string;
  messages: Message[];
  currentAgent: string | null;
  enabledAgents: string[];
  session: ReturnType<ChatRuntime['buildDetailedSessionResponse']>;
  chatSessions: ReturnType<ChatRuntime['getSessionSummaries']>;
}

export interface SessionAgentToggleResponse {
  success: true;
  enabledAgents: string[];
  currentAgentWillExpire: boolean;
}

export interface SessionSwitchAgentResponse {
  success: true;
  currentAgent: string | null;
}

export interface SessionWorkdirResponse {
  success: true;
  workdir: string;
}

export interface SessionService {
  resolveChatSession(context: SessionUserContext): { userKey: string; session: UserChatSession };
  getHistory(context: SessionUserContext, agents: unknown[]): SessionHistoryResponse;
  clearHistory(context: SessionUserContext): { success: true };
  createChatSession(context: SessionUserContext, name?: string): SessionMutationResponse;
  selectChatSession(context: SessionUserContext, sessionId: string): SessionSelectionResponse;
  renameChatSession(context: SessionUserContext, sessionId: string, name: string): SessionRenameResponse;
  deleteChatSession(context: SessionUserContext, sessionId: string): SessionDeleteResponse;
  updateChatSession(context: SessionUserContext, sessionId: string, patch: unknown): SessionMutationResponse;
  setSessionAgent(context: SessionUserContext, payload: { sessionId?: string; agentName: string; enabled: boolean }): SessionAgentToggleResponse;
  switchAgent(context: SessionUserContext, agentName?: string | null): SessionSwitchAgentResponse;
  setWorkdir(context: SessionUserContext, agentName: string, workdir: string | null): SessionWorkdirResponse;
  getEnabledAgents(session: UserChatSession): string[];
  isAgentEnabled(session: UserChatSession, agentName: string): boolean;
  getCurrentAgent(userKey: string, sessionId: string): string | null;
  selectCurrentAgent(userKey: string, sessionId: string, agentName: string | null): void;
  expireInvalidCurrentAgent(userKey: string, session: UserChatSession): string | null;
  getAgentWorkdir(userKey: string, sessionId: string, agentName: string): string | null;
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

export interface SessionServiceErrorDescriptor {
  code: AppErrorCode;
  statusCode?: number;
}

export type SessionServiceErrorFactory = (message: string, error: SessionServiceErrorDescriptor) => Error;
