import { ChatRuntime } from '../runtime/chat-runtime';
import { APP_ERROR_CODES } from '../../shared/errors/app-error-codes';
import { SessionService, SessionUserContext } from './session-service';
import { ChatServiceErrorFactory, ChatSummaryService, ExecuteAgentTurnParams, ExecuteAgentTurnResult } from './chat-service-types';
import { canStartManualSummary } from '../domain/discussion-policy';

export interface ChatSummaryServiceDependencies {
  syncAgentsFromStore(): void;
  runtime: ChatRuntime;
  sessionService: SessionService;
  executeAgentTurn(params: ExecuteAgentTurnParams): Promise<ExecuteAgentTurnResult>;
  createError: ChatServiceErrorFactory;
}

export function createChatSummaryService(deps: ChatSummaryServiceDependencies): ChatSummaryService {
  return {
    async summarizeChat(context: SessionUserContext, requestedSessionId?: string) {
      deps.syncAgentsFromStore();
      const { userKey } = context;
      const sessions = deps.runtime.ensureUserSessions(userKey);
      const activeSessionId = deps.runtime.resolveActiveSession(userKey).id;
      const resolvedSessionId = (requestedSessionId || '').trim() || activeSessionId;
      const session = sessions.get(resolvedSessionId)
        || (!(requestedSessionId || '').trim() ? sessions.get(activeSessionId) || sessions.values().next().value : null);
      if (!session) {
        throw deps.createError('会话不存在', {
          code: APP_ERROR_CODES.VALIDATION_FAILED
        });
      }

      const discussionMode = deps.runtime.normalizeDiscussionMode(session.discussionMode);
      if (!canStartManualSummary(discussionMode)) {
        throw deps.createError('仅 peer 模式支持手动生成总结', {
          code: APP_ERROR_CODES.VALIDATION_FAILED
        });
      }

      const summaryAgent = deps.sessionService.resolveManualSummaryAgent(session);
      if (!summaryAgent) {
        throw deps.createError('当前会话没有可用于生成总结的智能体', {
          code: APP_ERROR_CODES.VALIDATION_FAILED
        });
      }

      const summaryLockKey = `${userKey}::${session.id}`;
      if (!deps.runtime.beginSummaryRequest(summaryLockKey)) {
        throw deps.createError('当前会话已有总结任务进行中，请稍后再试。', {
          code: APP_ERROR_CODES.CONFLICT
        });
      }

      const preSummaryState = deps.sessionService.snapshotSummaryContinuationState(session);
      try {
        deps.sessionService.markSummaryInProgress(session);
        deps.runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} stage=discussion_summary_start agent=${summaryAgent}`);

        const { aiMessages } = await deps.executeAgentTurn({
          userKey,
          session,
          initialTasks: [{
            agentName: summaryAgent,
            prompt: deps.sessionService.buildManualSummaryPrompt(session),
            includeHistory: true,
            dispatchKind: 'summary'
          }],
          stream: false
        });

        deps.sessionService.restoreSummaryContinuationState(session, preSummaryState);
        deps.runtime.appendOperationalLog('info', 'chat-exec', `session=${session.id} stage=discussion_summary_done agent=${summaryAgent} messages=${aiMessages.length}`);

        return {
          success: true as const,
          aiMessages,
          currentAgent: deps.sessionService.getCurrentAgent(userKey, session.id)
        };
      } catch (error) {
        if (deps.runtime.normalizeDiscussionMode(session.discussionMode) === 'peer' && session.discussionState === 'summarizing') {
          deps.sessionService.restoreSummaryContinuationState(session, preSummaryState);
        }
        throw error;
      } finally {
        deps.runtime.endSummaryRequest(summaryLockKey);
      }
    }
  };
}
