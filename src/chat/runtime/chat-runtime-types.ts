import { Message, DiscussionMode, DiscussionState, AgentDispatchKind, InvocationTask, ChatExecutionStopMode, ChatExecutionStoppedMetadata } from '../../types';
import { UserChatSession, PendingAgentDispatchTask } from '../infrastructure/chat-session-repository';
import { DependencyStatusItem, DependencyStatusLogEntry } from '../infrastructure/dependency-log-store';
import { ChatTimelineRow } from '../application/chat-timeline-projection';
import { CallGraphProjection } from '../application/call-graph-projection';
import { SessionEventEnvelope } from '../domain/session-events';
import { SessionSummarySnapshot } from '../application/session-summary-projection';
import { SessionEventWriteDraft } from '../application/session-event-service';

export type NormalizedUserChatSession = UserChatSession & Required<Pick<UserChatSession, 'agentChainMaxHops' | 'agentChainMaxCallsPerAgent' | 'discussionMode' | 'discussionState' | 'invocationTasks'>>;
export type DetailedNormalizedUserChatSession = NormalizedUserChatSession & { enabledAgents: string[]; agentWorkdirs: Record<string, string> };
export type SessionChainPatch = Partial<Pick<UserChatSession, 'agentChainMaxHops' | 'agentChainMaxCallsPerAgent' | 'discussionMode'>>;
export type InvocationTaskUpdatePatch = Partial<Omit<InvocationTask, 'id' | 'sessionId' | 'createdAt'>>;

export type ActiveChatExecutionStopResult = ChatExecutionStoppedMetadata;

export interface ActiveChatExecution {
  executionId: string;
  userKey: string;
  sessionId: string;
  currentAgentName: string | null;
  abortController: AbortController;
  stopMode: ChatExecutionStopMode;
  stopped?: ActiveChatExecutionStopResult;
}

export interface ChatSessionSummary {
  id: string;
  name: string;
  messageCount: number;
  updatedAt: number;
  createdAt: number;
  agentChainMaxHops: number;
  agentChainMaxCallsPerAgent: number | null;
  discussionMode: DiscussionMode;
  discussionState: DiscussionState;
}

export interface SummaryContinuationState {
  discussionState: DiscussionState;
  pendingAgentTasks?: PendingAgentDispatchTask[];
  pendingVisibleMessages?: Message[];
}

export interface ChatRuntimeConfig {
  redisUrl: string;
  redisConfigKey: string;
  defaultRedisChatSessionsKey: string;
  redisPersistDebounceMs: number;
  redisRequired: boolean;
  redisDisabled: boolean;
  envRedisChatSessionsKey: string;
  defaultChatSessionId: string;
  defaultChatSessionName: string;
  defaultAgentChainMaxHops: number;
  dependencyStatusLogLimit?: number;
  getValidAgentNames: () => string[];
}

export interface ChatRuntime {
  hydrate(): Promise<void>;
  shutdown(): Promise<void>;
  getRedisChatSessionsKey(): string;
  touchSession(session: UserChatSession): void;
  createUserSession(name?: string): UserChatSession;
  ensureUserSessions(userKey: string): Map<string, UserChatSession>;
  resolveActiveSession(userKey: string): UserChatSession;
  getSessionSummaries(userKey: string): ChatSessionSummary[];
  getUserHistory(userKey: string, sessionId: string): Message[];
  getUserCurrentAgent(userKey: string, sessionId: string): string | null;
  setUserCurrentAgent(userKey: string, sessionId: string, agentName: string | null): void;
  clearUserHistory(userKey: string, sessionId: string): void;
  setActiveChatSession(userKey: string, sessionId: string): boolean;
  createChatSessionForUser(userKey: string, name?: string): UserChatSession;
  renameChatSessionForUser(userKey: string, sessionId: string, name: string): UserChatSession | null;
  deleteChatSessionForUser(userKey: string, sessionId: string): { success: boolean; activeSessionId: string };
  migrateLegacySessionUserData(oldUserKey: string, newUserKey: string): void;
  isChatSessionActive(): boolean;
  getSessionById(sessionId: string): UserChatSession | null;
  addCallbackMessage(sessionId: string, agentName: string, content: string, invokeAgents?: string[]): Message;
  consumeCallbackMessages(sessionId: string, agentName: string): Message[];
  listDependencyStatusLogs(): DependencyStatusLogEntry[];
  appendOperationalLog(level: 'info' | 'error', dependency: string, message: string): void;
  collectDependencyStatus(): Promise<DependencyStatusItem[]>;
  getUserAgentWorkdir(userKey: string, sessionId: string, agentName: string): string | null;
  setUserAgentWorkdir(userKey: string, sessionId: string, agentName: string, workdir: string | null): void;
  getSessionEnabledAgents(session: UserChatSession): string[];
  isAgentEnabledForSession(session: UserChatSession, agentName: string): boolean;
  setSessionEnabledAgent(userKey: string, sessionId: string, agentName: string, enabled: boolean): { enabledAgents: string[]; currentAgentWillExpire: boolean } | null;
  expireDisabledCurrentAgent(userKey: string, session: UserChatSession): string | null;
  createInvocationTask(userKey: string, sessionId: string, task: InvocationTask): InvocationTask | null;
  updateInvocationTask(userKey: string, sessionId: string, taskId: string, patch: InvocationTaskUpdatePatch): InvocationTask | null;
  listInvocationTasks(userKey: string, sessionId: string): InvocationTask[];
  listActiveInvocationTasks(userKey: string, sessionId: string): InvocationTask[];
  resolveOverdueInvocationTasks(userKey: string, sessionId: string, now?: number): InvocationTask[];
  markInvocationTaskCompleted(userKey: string, sessionId: string, taskId: string): InvocationTask | null;
  markInvocationTaskFailed(userKey: string, sessionId: string, taskId: string, reason?: string): InvocationTask | null;
  registerActiveExecution(userKey: string, sessionId: string, execution: ActiveChatExecution): ActiveChatExecution;
  getActiveExecution(userKey: string, sessionId: string): ActiveChatExecution | null;
  updateActiveExecutionAgent(userKey: string, sessionId: string, executionId: string, agentName: string | null): ActiveChatExecution | null;
  requestExecutionStop(userKey: string, sessionId: string, stopMode: Exclude<ChatExecutionStopMode, 'none'>): ActiveChatExecution | null;
  consumeExecutionStopMode(userKey: string, sessionId: string, executionId: string): ChatExecutionStopMode;
  consumeExecutionStopResult(userKey: string, sessionId: string, executionId: string): ActiveChatExecutionStopResult | null;
  clearActiveExecution(userKey: string, sessionId: string, executionId: string): boolean;
  appendCommandEvent(sessionId: string, draft: SessionEventWriteDraft): SessionEventEnvelope;
  appendUserEvent(sessionId: string, draft: SessionEventWriteDraft): SessionEventEnvelope;
  appendAgentEvent(sessionId: string, draft: SessionEventWriteDraft): SessionEventEnvelope;
  appendSystemEvent(sessionId: string, draft: SessionEventWriteDraft): SessionEventEnvelope;
  listSessionEvents(sessionId: string, afterSeq?: number): SessionEventEnvelope[];
  buildSessionTimeline(sessionId: string): ChatTimelineRow[];
  buildSessionCallGraph(sessionId: string): CallGraphProjection;
  buildSessionSummary(sessionId: string): SessionSummarySnapshot;
  buildSessionResponse(session: UserChatSession): NormalizedUserChatSession;
  buildDetailedSessionResponse(session: UserChatSession): DetailedNormalizedUserChatSession;
  parseSessionChainPatch(patch: unknown): SessionChainPatch;
  beginSummaryRequest(key: string): boolean;
  endSummaryRequest(key: string): void;
  hasSummaryRequest(key: string): boolean;
  normalizeDiscussionMode(value: unknown, fallback?: DiscussionMode): DiscussionMode;
  normalizeDiscussionState(value: unknown, fallback?: DiscussionState): DiscussionState;
  normalizeDispatchKind(value: unknown, fallback?: AgentDispatchKind | null): AgentDispatchKind | null;
  isChainedDispatchKind(dispatchKind: AgentDispatchKind): boolean;
  applyNormalizedSessionDiscussionSettings<T extends UserChatSession>(session: T): T & Required<Pick<UserChatSession, 'discussionMode' | 'discussionState'>>;
  applyNormalizedSessionChainSettings<T extends UserChatSession>(session: T): T & Required<Pick<UserChatSession, 'agentChainMaxHops' | 'agentChainMaxCallsPerAgent'>>;
}

export const SESSION_CHAIN_SETTINGS_MAX = 1000;
export const DEFAULT_DISCUSSION_MODE: DiscussionMode = 'classic';
export const DEFAULT_DISCUSSION_STATE: DiscussionState = 'active';

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function generateChatSessionId(): string {
  const crypto = require('crypto') as typeof import('crypto');
  return `s_${crypto.randomBytes(6).toString('hex')}`;
}

export function normalizePositiveSessionSetting(value: unknown, fallback: number | null, allowNull: boolean): number | null {
  if (value === null) {
    return allowNull ? null : fallback;
  }

  if (typeof value === 'undefined') {
    return fallback;
  }

  let parsed: number;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || !/^-?\d+$/.test(trimmed)) {
      return fallback;
    }
    parsed = Number(trimmed);
  } else if (typeof value === 'number') {
    parsed = value;
  } else {
    return fallback;
  }

  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(SESSION_CHAIN_SETTINGS_MAX, parsed);
}
