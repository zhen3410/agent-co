import { ChatExecutionStopMode } from '../../types';
import { ActiveChatExecution, ActiveChatExecutionStopResult } from './chat-runtime-types';

export interface ChatActiveExecutionState {
  registerActiveExecution(userKey: string, sessionId: string, execution: ActiveChatExecution): ActiveChatExecution;
  getActiveExecution(userKey: string, sessionId: string): ActiveChatExecution | null;
  updateActiveExecutionAgent(userKey: string, sessionId: string, executionId: string, agentName: string | null): ActiveChatExecution | null;
  requestExecutionStop(userKey: string, sessionId: string, stopMode: Exclude<ChatExecutionStopMode, 'none'>): ActiveChatExecution | null;
  consumeExecutionStopMode(userKey: string, sessionId: string, executionId: string): ChatExecutionStopMode;
  consumeExecutionStopResult(userKey: string, sessionId: string, executionId: string): ActiveChatExecutionStopResult | null;
  clearActiveExecution(userKey: string, sessionId: string, executionId: string): boolean;
}

interface ChatActiveExecutionStateConfig {
  log(message: string): void;
}

export function createChatActiveExecutionState(config: ChatActiveExecutionStateConfig): ChatActiveExecutionState {
  const activeExecutions = new Map<string, ActiveChatExecution>();

  function getExecutionKey(userKey: string, sessionId: string): string {
    return `${userKey}::${sessionId}`;
  }

  function registerActiveExecution(userKey: string, sessionId: string, execution: ActiveChatExecution): ActiveChatExecution {
    execution.stopMode = 'none';
    execution.stopped = undefined;
    activeExecutions.set(getExecutionKey(userKey, sessionId), execution);
    config.log(`stage=register user=${userKey} session=${sessionId} execution=${execution.executionId}`);
    return execution;
  }

  function getActiveExecution(userKey: string, sessionId: string): ActiveChatExecution | null {
    return activeExecutions.get(getExecutionKey(userKey, sessionId)) || null;
  }

  function updateActiveExecutionAgent(userKey: string, sessionId: string, executionId: string, agentName: string | null): ActiveChatExecution | null {
    const activeExecution = activeExecutions.get(getExecutionKey(userKey, sessionId));
    if (!activeExecution || activeExecution.executionId !== executionId) {
      return null;
    }

    activeExecution.currentAgentName = agentName;
    return activeExecution;
  }

  function requestExecutionStop(userKey: string, sessionId: string, stopMode: Exclude<ChatExecutionStopMode, 'none'>): ActiveChatExecution | null {
    const activeExecution = activeExecutions.get(getExecutionKey(userKey, sessionId));
    if (!activeExecution) {
      return null;
    }

    activeExecution.stopMode = stopMode;
    activeExecution.stopped = {
      scope: stopMode,
      currentAgent: activeExecution.currentAgentName,
      resumeAvailable: stopMode === 'current_agent' && !!activeExecution.currentAgentName
    };
    activeExecution.abortController.abort();
    config.log(`stage=stop_requested user=${userKey} session=${sessionId} execution=${activeExecution.executionId} scope=${stopMode}`);
    return activeExecution;
  }

  function consumeExecutionStopMode(userKey: string, sessionId: string, executionId: string): ChatExecutionStopMode {
    const activeExecution = activeExecutions.get(getExecutionKey(userKey, sessionId));
    if (!activeExecution || activeExecution.executionId !== executionId) {
      return 'none';
    }

    const { stopMode } = activeExecution;
    activeExecution.stopMode = 'none';
    return stopMode;
  }

  function consumeExecutionStopResult(userKey: string, sessionId: string, executionId: string): ActiveChatExecutionStopResult | null {
    const activeExecution = activeExecutions.get(getExecutionKey(userKey, sessionId));
    if (!activeExecution || activeExecution.executionId !== executionId) {
      return null;
    }

    const stopped = activeExecution.stopped ?? null;
    activeExecution.stopped = undefined;
    return stopped;
  }

  function clearActiveExecution(userKey: string, sessionId: string, executionId: string): boolean {
    const key = getExecutionKey(userKey, sessionId);
    const activeExecution = activeExecutions.get(key);
    if (!activeExecution) {
      return false;
    }

    if (activeExecution.executionId !== executionId) {
      config.log(`stage=clear_guarded user=${userKey} session=${sessionId} stale_execution=${executionId} active_execution=${activeExecution.executionId}`);
      return false;
    }

    activeExecutions.delete(key);
    return true;
  }

  return {
    registerActiveExecution,
    getActiveExecution,
    updateActiveExecutionAgent,
    requestExecutionStop,
    consumeExecutionStopMode,
    consumeExecutionStopResult,
    clearActiveExecution
  };
}
