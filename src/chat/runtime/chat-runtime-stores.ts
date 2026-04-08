import { Message } from '../../types';
import {
  ChatSessionRepository,
  RedisPersistedState,
  UserChatSession,
  createChatSessionRepository
} from '../infrastructure/chat-session-repository';
import {
  DependencyLogQuery,
  DependencyLogStore,
  DependencyStatusLogEntry,
  createDependencyLogStore
} from '../infrastructure/dependency-log-store';

export interface RuntimeSessionStore {
  ensureUserSessions(userKey: string, factory: () => UserChatSession): Map<string, UserChatSession>;
  getUserSessions(userKey: string): Map<string, UserChatSession> | undefined;
  setUserSessions(userKey: string, sessions: Map<string, UserChatSession>): void;
  deleteUserSessions(userKey: string): void;
  clearUserSessions(): void;
  getActiveSessionId(userKey: string): string | undefined;
  setActiveSessionId(userKey: string, sessionId: string): void;
  deleteActiveSessionId(userKey: string): void;
  clearActiveSessionIds(): void;
  serializeState(): RedisPersistedState;
  getSessionById(sessionId: string): UserChatSession | null;
}

export interface RuntimeCallbackMessageStore {
  appendCallbackMessage(sessionId: string, agentName: string, message: Message): void;
  consumeCallbackMessages(sessionId: string, agentName: string): Message[];
}

export interface RuntimeDependencyLogStore {
  append(entry: DependencyStatusLogEntry): void;
  appendOperationalLog(level: 'info' | 'error', dependency: string, message: string): void;
  list(): DependencyStatusLogEntry[];
  filter(query: DependencyLogQuery): DependencyStatusLogEntry[];
}

export interface ChatRuntimePersistenceStore {
  serializeState(): RedisPersistedState;
  clearUserSessions(): void;
  setUserSessions(userKey: string, sessions: Map<string, UserChatSession>): void;
  clearActiveSessionIds(): void;
  setActiveSessionId(userKey: string, sessionId: string): void;
}

interface ChatRuntimeStores {
  repository: ChatSessionRepository;
  sessionStore: RuntimeSessionStore;
  callbackMessageStore: RuntimeCallbackMessageStore;
  persistenceStore: ChatRuntimePersistenceStore;
  dependencyLogStore: RuntimeDependencyLogStore;
}

function createRuntimeSessionStore(repository: ChatSessionRepository): RuntimeSessionStore {
  return {
    ensureUserSessions: repository.ensureUserSessions,
    getUserSessions: repository.getUserSessions,
    setUserSessions: repository.setUserSessions,
    deleteUserSessions: repository.deleteUserSessions,
    clearUserSessions: repository.clearUserSessions,
    getActiveSessionId: repository.getActiveSessionId,
    setActiveSessionId: repository.setActiveSessionId,
    deleteActiveSessionId: repository.deleteActiveSessionId,
    clearActiveSessionIds: repository.clearActiveSessionIds,
    serializeState: repository.serializeState,
    getSessionById: repository.getSessionById
  };
}

function createRuntimeCallbackMessageStore(
  repository: Pick<ChatSessionRepository, 'appendCallbackMessage' | 'consumeCallbackMessages'>
): RuntimeCallbackMessageStore {
  return {
    appendCallbackMessage: repository.appendCallbackMessage,
    consumeCallbackMessages: repository.consumeCallbackMessages
  };
}

function createRuntimeDependencyLogStore(store: DependencyLogStore): RuntimeDependencyLogStore {
  return {
    append: store.append,
    appendOperationalLog: store.appendOperationalLog,
    list: store.list,
    filter: store.filter
  };
}

function createRuntimePersistenceStore(store: RuntimeSessionStore): ChatRuntimePersistenceStore {
  return {
    serializeState: store.serializeState,
    clearUserSessions: store.clearUserSessions,
    setUserSessions: store.setUserSessions,
    clearActiveSessionIds: store.clearActiveSessionIds,
    setActiveSessionId: store.setActiveSessionId
  };
}

export function createChatRuntimeStores(config: { dependencyStatusLogLimit?: number }): ChatRuntimeStores {
  const repository = createChatSessionRepository();
  const sessionStore = createRuntimeSessionStore(repository);

  return {
    repository,
    sessionStore,
    callbackMessageStore: createRuntimeCallbackMessageStore(repository),
    persistenceStore: createRuntimePersistenceStore(sessionStore),
    dependencyLogStore: createRuntimeDependencyLogStore(
      createDependencyLogStore(config.dependencyStatusLogLimit ?? 80)
    )
  };
}
