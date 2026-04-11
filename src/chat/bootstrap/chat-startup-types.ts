import * as http from 'http';
import { AIAgent } from '../../types';

export interface ChatServerSecurityConfig {
  nodeEnv: string | undefined;
  authAdminToken: string | undefined;
  defaultPassword: string | undefined;
}

export interface ChatStartupBannerConfig {
  port: number;
  host: string;
  agentDataFile: string;
  listAgents(): AIAgent[];
  authEnabled: boolean;
  authAdminBaseUrl: string;
  redisDisabled: boolean;
  redisUrl: string;
  redisChatSessionsKey: string;
}

export interface ChatServerStartupConfig extends ChatStartupBannerConfig {
  server: http.Server;
  hydrate(): Promise<void>;
  security: ChatServerSecurityConfig;
}
