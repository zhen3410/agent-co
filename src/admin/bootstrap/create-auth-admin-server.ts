import * as http from 'http';
import { applyAdminCorsHeaders } from '../../shared/http/cors';
import { sendJson } from '../../shared/http/json';
import { AgentAdminService } from '../application/agent-admin-service';
import { GroupAdminService } from '../application/group-admin-service';
import { ModelConnectionAdminService } from '../application/model-connection-admin-service';
import { SystemAdminService } from '../application/system-admin-service';
import { UserAdminService } from '../application/user-admin-service';
import { handleAuthAdminRoutes } from '../http/auth-admin-routes';
import { handleAuthAdminSupportRoutes } from '../http/auth-admin-support-routes';
import { AuthAdminRuntime } from '../runtime/auth-admin-runtime';

export interface CreateAuthAdminServerDependencies {
  runtime: AuthAdminRuntime;
  userAdminService: UserAdminService;
  agentAdminService: AgentAdminService;
  groupAdminService: GroupAdminService;
  modelConnectionAdminService: ModelConnectionAdminService;
  systemAdminService: SystemAdminService;
}

export function createAuthAdminServer(deps: CreateAuthAdminServerDependencies): http.Server {
  return http.createServer(async (req, res) => {
    const method = req.method || 'GET';
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `localhost:${deps.runtime.port}`}`);
    const pathname = requestUrl.pathname;

    applyAdminCorsHeaders(res);

    if (method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (method === 'GET' && pathname === '/healthz') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (await handleAuthAdminRoutes(req, res, requestUrl, {
      adminToken: deps.runtime.adminToken,
      userAdminService: deps.userAdminService,
      agentAdminService: deps.agentAdminService
    })) {
      return;
    }

    if (await handleAuthAdminSupportRoutes(req, res, requestUrl, {
      adminToken: deps.runtime.adminToken,
      groupAdminService: deps.groupAdminService,
      modelConnectionAdminService: deps.modelConnectionAdminService,
      systemAdminService: deps.systemAdminService
    })) {
      return;
    }

    sendJson(res, 404, { error: 'Not Found' });
  });
}
