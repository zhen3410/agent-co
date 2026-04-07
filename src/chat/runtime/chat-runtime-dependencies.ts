import Redis from 'ioredis';
import { DependencyLogStore, DependencyStatusItem, DependencyStatusLogEntry } from '../infrastructure/dependency-log-store';
import { ChatRuntimeConfig } from './chat-runtime-types';

interface ChatRuntimeDependenciesConfig extends Pick<ChatRuntimeConfig, 'redisDisabled' | 'redisRequired'> {}

interface ChatRuntimeDependenciesDependencies {
  config: ChatRuntimeDependenciesConfig;
  redisClient: Redis;
  dependencyLogs: DependencyLogStore;
}

interface ChatRuntimeDependencies {
  listDependencyStatusLogs(): DependencyStatusLogEntry[];
  appendOperationalLog(level: 'info' | 'error', dependency: string, message: string): void;
  collectDependencyStatus(): Promise<DependencyStatusItem[]>;
}

export function createChatRuntimeDependencies(deps: ChatRuntimeDependenciesDependencies): ChatRuntimeDependencies {
  function listDependencyStatusLogs(): DependencyStatusLogEntry[] {
    return deps.dependencyLogs.list();
  }

  function appendOperationalLog(level: 'info' | 'error', dependency: string, message: string): void {
    deps.dependencyLogs.appendOperationalLog(level, dependency, message);
  }

  async function collectDependencyStatus(): Promise<DependencyStatusItem[]> {
    const result: DependencyStatusItem[] = [];

    if (deps.config.redisDisabled) {
      result.push({
        name: 'redis',
        required: deps.config.redisRequired,
        healthy: true,
        detail: 'disabled by BOT_ROOM_DISABLE_REDIS=true'
      });
      deps.dependencyLogs.append({
        timestamp: Date.now(),
        level: 'info',
        dependency: 'redis',
        message: 'disabled by BOT_ROOM_DISABLE_REDIS=true'
      });
      return result;
    }

    try {
      const pong = await deps.redisClient.ping();
      const healthy = pong === 'PONG';
      const detail = healthy ? 'PONG' : `返回异常: ${pong}`;
      result.push({
        name: 'redis',
        required: deps.config.redisRequired,
        healthy,
        detail
      });
      deps.dependencyLogs.append({
        timestamp: Date.now(),
        level: healthy ? 'info' : 'error',
        dependency: 'redis',
        message: detail
      });
    } catch (error) {
      const err = error as Error;
      result.push({
        name: 'redis',
        required: deps.config.redisRequired,
        healthy: false,
        detail: err.message
      });
      deps.dependencyLogs.append({
        timestamp: Date.now(),
        level: 'error',
        dependency: 'redis',
        message: err.message
      });
    }

    return result;
  }

  return {
    listDependencyStatusLogs,
    appendOperationalLog,
    collectDependencyStatus
  };
}
