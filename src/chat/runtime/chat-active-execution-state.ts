import { ChatExecutionStopMode } from '../../types';
import { ActiveChatExecution, ActiveChatExecutionStopResult } from './chat-runtime-types';

export interface ChatActiveExecutionState {
  registerActiveExecution(sessionId: string, execution: ActiveChatExecution): ActiveChatExecution;
  getActiveExecution(sessionId: string): ActiveChatExecution | null;
  updateActiveExecutionAgent(sessionId: string, executionId: string, agentName: string | null): ActiveChatExecution | null;
  requestExecutionStop(sessionId: string, stopMode: Exclude<ChatExecutionStopMode, 'none'>): ActiveChatExecution | null;
  consumeExecutionStopMode(sessionId: string, executionId: string): ChatExecutionStopMode;
  consumeExecutionStopResult(sessionId: string, executionId: string): ActiveChatExecutionStopResult | null;
  clearActiveExecution(sessionId: string, executionId: string): boolean;
}

interface ChatActiveExecutionStateConfig {
  log(message: string): void;
}

export function createChatActiveExecutionState(config: ChatActiveExecutionStateConfig): ChatActiveExecutionState {
  const activeExecutions = new Map<string, ActiveChatExecution>();

  function registerActiveExecution(sessionId: string, execution: ActiveChatExecution): ActiveChatExecution {
    execution.stopMode = 'none';
    execution.stopped = undefined;
    activeExecutions.set(sessionId, execution);
    config.log(`stage=register session=${sessionId} execution=${execution.executionId}`);
    return execution;
  }

  function getActiveExecution(sessionId: string): ActiveChatExecution | null {
    return activeExecutions.get(sessionId) || null;
  }

  function updateActiveExecutionAgent(sessionId: string, executionId: string, agentName: string | null): ActiveChatExecution | null {
    const activeExecution = activeExecutions.get(sessionId);
    if (!activeExecution || activeExecution.executionId !== executionId) {
      return null;
    }

    activeExecution.currentAgentName = agentName;
    return activeExecution;
  }

  function requestExecutionStop(sessionId: string, stopMode: Exclude<ChatExecutionStopMode, 'none'>): ActiveChatExecution | null {
    const activeExecution = activeExecutions.get(sessionId);
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
    config.log(`stage=stop_requested session=${sessionId} execution=${activeExecution.executionId} scope=${stopMode}`);
    return activeExecution;
  }

  function consumeExecutionStopMode(sessionId: string, executionId: string): ChatExecutionStopMode {
    const activeExecution = activeExecutions.get(sessionId);
    if (!activeExecution || activeExecution.executionId !== executionId) {
      return 'none';
    }

    const { stopMode } = activeExecution;
    activeExecution.stopMode = 'none';
    return stopMode;
  }

  function consumeExecutionStopResult(sessionId: string, executionId: string): ActiveChatExecutionStopResult | null {
    const activeExecution = activeExecutions.get(sessionId);
    if (!activeExecution || activeExecution.executionId !== executionId) {
      return null;
    }

    const stopped = activeExecution.stopped ?? null;
    activeExecution.stopped = undefined;
    return stopped;
  }

  function clearActiveExecution(sessionId: string, executionId: string): boolean {
    const activeExecution = activeExecutions.get(sessionId);
    if (!activeExecution) {
      return false;
    }

    if (activeExecution.executionId !== executionId) {
      config.log(`stage=clear_guarded session=${sessionId} stale_execution=${executionId} active_execution=${activeExecution.executionId}`);
      return false;
    }

    activeExecutions.delete(sessionId);
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
