import { createAuthService, AuthService } from '../application/auth-service';
import { createChatService, ChatService } from '../application/chat-service';
import { createSessionService, SessionService } from '../application/session-service';
import { createAuthAdminClient } from '../infrastructure/auth-admin-client';
import type { ChatEnvConfig } from './chat-env-config';
import type { ChatRuntimeDeps } from './create-chat-runtime-deps';

export interface ChatApplication {
  authService: AuthService;
  sessionService: SessionService;
  chatService: ChatService;
}

export function createChatApplication(
  config: Pick<ChatEnvConfig, 'port' | 'defaultUserName' | 'auth' | 'callback'>,
  runtimeDeps: ChatRuntimeDeps
): ChatApplication {
  const authAdminClient = createAuthAdminClient(config.auth.adminBaseUrl);
  const authService = createAuthService({
    authEnabled: config.auth.enabled,
    sessionCookieName: config.auth.sessionCookieName,
    visitorCookieName: config.auth.visitorCookieName,
    sessionTtlMs: config.auth.sessionTtlMs,
    loginRateLimitMax: config.auth.loginRateLimitMax
  }, authAdminClient, runtimeDeps.runtime);
  const sessionService = createSessionService({
    runtime: runtimeDeps.runtime,
    hasAgent: (agentName) => runtimeDeps.agentManager.hasAgent(agentName)
  });
  const chatService = createChatService({
    port: config.port,
    defaultUserName: config.defaultUserName,
    callbackAuthToken: config.callback.authToken,
    sessionService,
    runtime: runtimeDeps.runtime,
    agentManager: runtimeDeps.agentManager,
    syncAgentsFromStore: runtimeDeps.syncAgentsFromStore
  });

  return {
    authService,
    sessionService,
    chatService
  };
}
