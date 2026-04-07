import { AIAgentConfig, Message, RichBlock } from '../../types';
import { AgentManager } from '../../agent-manager';
import { getStatus as getBlockBufferStatus } from '../../block-buffer';
import { SessionService, SessionUserContext } from './session-service';
import { ChatRuntime, PendingAgentDispatchTask, UserChatSession } from '../runtime/chat-runtime';

export interface AgentDispatchTask {
  agentName: string;
  prompt: string;
  includeHistory: boolean;
  dispatchKind?: Message['dispatchKind'];
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
  onUserMessage(message: Message): void;
  onThinking(agentName: string): void;
  onTextDelta(agentName: string, delta: string): void;
  onMessage(message: Message): boolean;
}

export interface ChatService {
  listAgents(): AIAgentConfig[];
  sendMessage(context: SessionUserContext, body: { message: string; sender?: string }): Promise<{ success: true; userMessage: Message; aiMessages: Message[]; currentAgent: string | null; notice?: string }>;
  streamMessage(context: SessionUserContext, body: { message: string; sender?: string }, callbacks: StreamMessageCallbacks): Promise<{ currentAgent: string | null; notice?: string; hadVisibleMessages: boolean; emptyVisibleMessage?: string }>;
  resumePendingChat(context: SessionUserContext): Promise<{ success: true; resumed: boolean; aiMessages: Message[]; currentAgent: string | null; notice?: string }>;
  summarizeChat(context: SessionUserContext, sessionId?: string): Promise<{ success: true; aiMessages: Message[]; currentAgent: string | null }>;
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
  pendingTasks?: PendingAgentDispatchTask[];
}

export interface ExecuteAgentTurnResult {
  aiMessages: Message[];
  pendingTasks: PendingAgentDispatchTask[];
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

export type ChatServiceErrorFactory = (message: string, statusCode: number) => Error;
