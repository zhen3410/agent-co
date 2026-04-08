import { APP_ERROR_CODES } from '../../shared/errors/app-error-codes';
import { SessionService, SessionUserContext } from './session-service';
import { ChatResumeService, ChatServiceErrorFactory, ExecuteAgentTurnResult } from './chat-service-types';
import { ExecuteAgentTurnParams } from './chat-service-types';

export interface ChatResumeServiceDependencies {
  syncAgentsFromStore(): void;
  sessionService: SessionService;
  executeAgentTurn(params: ExecuteAgentTurnParams): Promise<ExecuteAgentTurnResult>;
  createError: ChatServiceErrorFactory;
}

export function createChatResumeService(deps: ChatResumeServiceDependencies): ChatResumeService {
  return {
    async resumePendingChat(context: SessionUserContext) {
      deps.syncAgentsFromStore();
      const { userKey, session } = deps.sessionService.resolveChatSession(context);
      const summaryInProgress = deps.sessionService.isSessionSummaryInProgress(userKey, session);
      if (summaryInProgress) {
        throw deps.createError('当前会话正在生成总结，暂时不能继续执行剩余链路，请稍后再试。', {
          code: APP_ERROR_CODES.CONFLICT
        });
      }
      const { pendingVisibleMessages, pendingTasks } = deps.sessionService.takePendingExecution(session);

      if (pendingVisibleMessages.length === 0 && pendingTasks.length === 0) {
        return {
          success: true as const,
          resumed: false,
          aiMessages: [],
          currentAgent: deps.sessionService.getCurrentAgent(userKey, session.id),
          notice: '当前没有可继续执行的剩余链路。'
        };
      }

      const { aiMessages, pendingTasks: remainingTasks } = await deps.executeAgentTurn({
        userKey,
        session,
        initialTasks: [],
        pendingTasks,
        stream: false
      });
      deps.sessionService.updatePendingExecution(session, remainingTasks);
      const resumedMessages = [...pendingVisibleMessages, ...aiMessages];

      return {
        success: true as const,
        resumed: true,
        aiMessages: resumedMessages,
        currentAgent: deps.sessionService.getCurrentAgent(userKey, session.id),
        notice: remainingTasks.length > 0 ? '仍有未完成链路，可再次继续执行。' : undefined
      };
    }
  };
}
