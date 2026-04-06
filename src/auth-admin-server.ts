/**
 * auth-admin-server.ts
 *
 * 独立鉴权管理服务：负责用户密码管理与认证校验
 */

import * as path from 'path';
import { createAuthAdminServer } from './admin/bootstrap/create-auth-admin-server';
import { createAgentAdminService } from './admin/application/agent-admin-service';
import { createUserAdminService } from './admin/application/user-admin-service';
import { createUserStore } from './admin/infrastructure/user-store';
import { createAuthAdminRuntime, startAuthAdminServer } from './admin/runtime/auth-admin-runtime';

const PORT = Number(process.env.AUTH_ADMIN_PORT || 3003);
const DATA_FILE = process.env.AUTH_DATA_FILE || path.join(process.cwd(), 'data', 'users.json');
const DEFAULT_USER = process.env.BOT_ROOM_DEFAULT_USER || 'admin';
const DEFAULT_PASSWORD = process.env.BOT_ROOM_DEFAULT_PASSWORD || 'admin123!';
const AGENT_DATA_FILE = process.env.AGENT_DATA_FILE || path.join(process.cwd(), 'data', 'agents.json');
const MODEL_CONNECTION_DATA_FILE = process.env.MODEL_CONNECTION_DATA_FILE
  || path.join(path.dirname(AGENT_DATA_FILE), 'api-connections.json');
const GROUP_DATA_FILE = process.env.GROUP_DATA_FILE
  || path.join(path.dirname(AGENT_DATA_FILE), 'groups.json');
const PUBLIC_DIR = path.join(__dirname, '..', 'public-auth');

const runtime = createAuthAdminRuntime({
  port: PORT,
  adminToken: process.env.AUTH_ADMIN_TOKEN || 'change-me-in-production',
  dataFile: DATA_FILE,
  defaultPassword: DEFAULT_PASSWORD,
  agentDataFile: AGENT_DATA_FILE,
  nodeEnv: process.env.NODE_ENV,
  publicDir: PUBLIC_DIR
});
const userStore = createUserStore({
  dataFile: DATA_FILE,
  defaultUsername: DEFAULT_USER,
  defaultPassword: DEFAULT_PASSWORD
});
const userAdminService = createUserAdminService({ userStore });
const agentAdminService = createAgentAdminService({
  agentDataFile: AGENT_DATA_FILE,
  groupDataFile: GROUP_DATA_FILE,
  modelConnectionDataFile: MODEL_CONNECTION_DATA_FILE
});
const server = createAuthAdminServer({
  runtime,
  userAdminService,
  agentAdminService,
  modelConnectionDataFile: MODEL_CONNECTION_DATA_FILE,
  groupDataFile: GROUP_DATA_FILE
});

void startAuthAdminServer(server, runtime).catch((error: unknown) => {
  console.error('❌ 服务启动失败:', (error as Error).message);
  process.exit(1);
});
