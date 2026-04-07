/**
 * server.ts
 *
 * 多 AI 智能体聊天室服务器
 */

import { createChatApplication } from './chat/bootstrap/create-chat-application';
import { createChatEnvConfig } from './chat/bootstrap/chat-env-config';
import { createChatRuntimeDeps } from './chat/bootstrap/create-chat-runtime-deps';
import { createChatServer } from './chat/bootstrap/create-chat-server';
import { startChatServer } from './chat/bootstrap/chat-server-startup';

const config = createChatEnvConfig({
  cwd: process.cwd(),
  serverDirname: __dirname,
  env: process.env
});
const runtimeDeps = createChatRuntimeDeps(config);
const application = createChatApplication(config, runtimeDeps);
const { server, shutdown } = createChatServer({
  authService: application.authService,
  chatService: application.chatService,
  sessionService: application.sessionService,
  runtime: runtimeDeps.runtime,
  agentManager: runtimeDeps.agentManager,
  callbackAuthToken: config.callback.authToken,
  callbackAuthHeader: config.callback.authHeader,
  verboseLogDir: config.logging.verboseLogDir,
  publicDir: config.logging.publicDir,
  rateLimitMaxRequests: config.rateLimit.maxRequests,
  groupDataFile: config.dataFiles.groupDataFile
});

process.on('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0));
});

process.on('SIGINT', () => {
  void shutdown().finally(() => process.exit(0));
});

void startChatServer({
  server,
  hydrate: () => runtimeDeps.runtime.hydrate(),
  port: config.port,
  agentDataFile: config.dataFiles.agentDataFile,
  listAgents: () => runtimeDeps.agentManager.getAgents(),
  authEnabled: config.auth.enabled,
  authAdminBaseUrl: config.auth.adminBaseUrl,
  redisDisabled: config.redis.disabled,
  redisUrl: config.redis.url,
  redisChatSessionsKey: config.redis.chatSessionsKey,
  security: config.security
}).catch((error: unknown) => {
  console.error('❌ 服务启动失败:', (error as Error).message);
  process.exit(1);
});
