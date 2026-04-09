import { AIAgentConfig, ChatExecutionStopMode, Message, RichBlock } from '../../types';
import { AgentManager } from '../../agent-manager';
import { getStatus as getBlockBufferStatus } from '../../block-buffer';
import { AppErrorCode } from '../../shared/errors/app-error-codes';
import { SessionService, SessionUserContext } from './session-service';
import { ChatRuntime, PendingAgentDispatchTask as RuntimePendingAgentDispatchTask, UserChatSession } from '../runtime/chat-runtime';

export type AgentDispatchReviewMode = 'none' | 'caller_review';
export interface StopExecutionRequest {
  sessionId?: string;
  scope: Exclude<ChatExecutionStopMode, 'none'>;
}

export interface StoppedExecutionMetadata {
  scope: Exclude<ChatExecutionStopMode, 'none'>;
  currentAgent: string | null;
  resumeAvailable: boolean;
}

export interface AgentDispatchTask {
  agentName: string;
  prompt: string;
  includeHistory: boolean;
  dispatchKind?: Message['dispatchKind'];
  taskId?: string;
  callerAgentName?: string;
  calleeAgentName?: string;
  reviewMode?: AgentDispatchReviewMode;
  deadlineAt?: number;
  invocationTaskReviewVersion?: number;
}

export interface PendingAgentDispatchTask extends RuntimePendingAgentDispatchTask {
  taskId?: string;
  callerAgentName?: string;
  calleeAgentName?: string;
  reviewMode?: AgentDispatchReviewMode;
  deadlineAt?: number;
  invocationTaskReviewVersion?: number;
}

export interface ChatServiceDependencies {
  port: number;
  defaultUserName: string;
  callbackAuthToken: string;
  sessionService: SessionService;
  runtime: ChatRuntime;
  agentManager: AgentManager;
  syncAgentsFromStore(): void;
}

export interface StreamMessageCallbacks {
  shouldContinue(): boolean;
  signal?: AbortSignal;
  onUserMessage(message: Message): void;
  onThinking(agentName: string): void;
  onTextDelta(agentName: string, delta: string): void;
  onMessage(message: Message): boolean;
}

export interface ChatService {
  listAgents(): AIAgentConfig[];
  sendMessage(context: SessionUserContext, body: { message: string; sender?: string }): Promise<{ success: true; userMessage: Message; aiMessages: Message[]; currentAgent: string | null; notice?: string }>;
  streamMessage(context: SessionUserContext, body: { message: string; sender?: string }, callbacks: StreamMessageCallbacks): Promise<{ currentAgent: string | null; notice?: string; hadVisibleMessages: boolean; emptyVisibleMessage?: string; stopped?: StoppedExecutionMetadata }>;
  resumePendingChat(context: SessionUserContext): Promise<{ success: true; resumed: boolean; aiMessages: Message[]; currentAgent: string | null; notice?: string }>;
  summarizeChat(context: SessionUserContext, sessionId?: string): Promise<{ success: true; aiMessages: Message[]; currentAgent: string | null }>;
  stopExecution(context: SessionUserContext, request: StopExecutionRequest): Promise<{ success: true; stopped: StoppedExecutionMetadata }>;
  createBlock(payload: { sessionId?: string; block: RichBlock }): { success: true; block: RichBlock };
  getBlockStatus(): ReturnType<typeof getBlockBufferStatus>;
  postCallbackMessage(sessionId: string, agentName: string, content: string, invokeAgents?: string[]): { status: 'ok' };
  getThreadContext(sessionId: string): { sessionId: string; messages: Message[] };
}

export interface MentionCollectionResult {
  mentions: string[];
  ignoredMentions: string[];
}

export interface RunAgentTaskParams {
  userKey: string;
  session: UserChatSession;
  task: AgentDispatchTask;
  stream: boolean;
  onTextDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

export type RunAgentTask = (params: RunAgentTaskParams) => Promise<Message[]>;

export interface ExecuteAgentTurnParams {
  userKey: string;
  session: UserChatSession;
  initialTasks: AgentDispatchTask[];
  stream: boolean;
  onThinking?: (agentName: string) => void;
  onTextDelta?: (agentName: string, delta: string) => void;
  onMessage?: (message: Message) => void;
  shouldContinue?: () => boolean;
  signal?: AbortSignal;
  pendingTasks?: PendingAgentDispatchTask[];
}

export interface ExecuteAgentTurnResult {
  aiMessages: Message[];
  pendingTasks: PendingAgentDispatchTask[];
  stopped?: StoppedExecutionMetadata;
}

export interface ChatDispatchOrchestrator {
  collectEligibleMentions(message: string, session: UserChatSession): MentionCollectionResult;
  executeAgentTurn(params: ExecuteAgentTurnParams): Promise<ExecuteAgentTurnResult>;
}

export interface ChatSummaryService {
  summarizeChat(context: SessionUserContext, requestedSessionId?: string): Promise<{ success: true; aiMessages: Message[]; currentAgent: string | null }>;
}

export interface ChatResumeService {
  resumePendingChat(context: SessionUserContext): Promise<{ success: true; resumed: boolean; aiMessages: Message[]; currentAgent: string | null; notice?: string }>;
}

export interface ChatServiceErrorDescriptor {
  code: AppErrorCode;
  statusCode?: number;
}

export type ChatServiceErrorFactory = (message: string, error: ChatServiceErrorDescriptor) => Error;
