import * as http from 'http';
import { parseBody } from '../../shared/http/body';
import { sendHttpError } from '../../shared/http/errors';
import { sendJson } from '../../shared/http/json';
import { GroupAdminService, GroupAdminServiceError } from '../application/group-admin-service';
import { ModelConnectionAdminService, ModelConnectionAdminServiceError } from '../application/model-connection-admin-service';
import { SystemAdminService, SystemAdminServiceError } from '../application/system-admin-service';
import { requireAdmin } from './admin-auth';

interface GroupPathMatch {
  id: string;
}

interface ModelConnectionPathMatch {
  id: string;
  action: 'base' | 'test';
}

export interface AuthAdminSupportRoutesDependencies {
  adminToken: string;
  groupAdminService: GroupAdminService;
  modelConnectionAdminService: ModelConnectionAdminService;
  systemAdminService: SystemAdminService;
}

function parseGroupPath(pathname: string): GroupPathMatch | null {
  const match = pathname.match(/^\/api\/groups\/([a-zA-Z0-9_]+)$/);
  return match ? { id: match[1] } : null;
}

function parseModelConnectionPath(pathname: string): ModelConnectionPathMatch | null {
  const testMatch = pathname.match(/^\/api\/model-connections\/([^/]+)\/test$/);
  if (testMatch) {
    return { id: decodeURIComponent(testMatch[1]), action: 'test' };
  }

  const baseMatch = pathname.match(/^\/api\/model-connections\/([^/]+)$/);
  if (baseMatch) {
    return { id: decodeURIComponent(baseMatch[1]), action: 'base' };
  }

  return null;
}

export async function handleAuthAdminSupportRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requestUrl: URL,
  deps: AuthAdminSupportRoutesDependencies
): Promise<boolean> {
  const pathname = requestUrl.pathname;
  const method = req.method || 'GET';

  if (method === 'GET' && pathname === '/api/groups') {
    if (!requireAdmin(req, res, deps.adminToken)) {
      return true;
    }
    sendJson(res, 200, deps.groupAdminService.listGroups());
    return true;
  }

  if (method === 'POST' && pathname === '/api/groups') {
    if (!requireAdmin(req, res, deps.adminToken)) {
      return true;
    }
    try {
      const body = await parseBody<{ id?: string; name?: string; icon?: string; agentNames?: string[] }>(req);
      sendJson(res, 201, deps.groupAdminService.createGroup(body));
    } catch (error) {
      if (error instanceof GroupAdminServiceError) {
        sendJson(res, error.statusCode, { error: error.message });
      } else {
        sendHttpError(res, error, { fallbackStatus: 400 });
      }
    }
    return true;
  }

  const groupPath = parseGroupPath(pathname);
  if (groupPath && method === 'PUT') {
    if (!requireAdmin(req, res, deps.adminToken)) {
      return true;
    }
    try {
      const body = await parseBody<{ name?: string; icon?: string; agentNames?: string[] }>(req);
      sendJson(res, 200, deps.groupAdminService.updateGroup(groupPath.id, body));
    } catch (error) {
      if (error instanceof GroupAdminServiceError) {
        sendJson(res, error.statusCode, { error: error.message });
      } else {
        sendHttpError(res, error, { fallbackStatus: 400 });
      }
    }
    return true;
  }

  if (groupPath && method === 'DELETE') {
    if (!requireAdmin(req, res, deps.adminToken)) {
      return true;
    }
    try {
      sendJson(res, 200, deps.groupAdminService.deleteGroup(groupPath.id));
    } catch (error) {
      if (error instanceof GroupAdminServiceError) {
        sendJson(res, error.statusCode, { error: error.message });
      } else {
        sendHttpError(res, error, { fallbackStatus: 400 });
      }
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/model-connections') {
    if (!requireAdmin(req, res, deps.adminToken)) {
      return true;
    }
    sendJson(res, 200, deps.modelConnectionAdminService.listConnections());
    return true;
  }

  if (method === 'POST' && pathname === '/api/model-connections') {
    if (!requireAdmin(req, res, deps.adminToken)) {
      return true;
    }
    try {
      const body = await parseBody<{ name?: string; baseURL?: string; baseUrl?: string; apiKey?: string; enabled?: boolean }>(req);
      sendJson(res, 201, deps.modelConnectionAdminService.createConnection(body));
    } catch (error) {
      if (error instanceof ModelConnectionAdminServiceError) {
        sendJson(res, error.statusCode, { error: error.message });
      } else {
        sendHttpError(res, error, { fallbackStatus: 400 });
      }
    }
    return true;
  }

  const modelConnectionPath = parseModelConnectionPath(pathname);
  if (modelConnectionPath && method === 'PUT' && modelConnectionPath.action === 'base') {
    if (!requireAdmin(req, res, deps.adminToken)) {
      return true;
    }
    try {
      const body = await parseBody<{ id?: string; name?: string; baseURL?: string; baseUrl?: string; apiKey?: string; enabled?: boolean }>(req);
      sendJson(res, 200, deps.modelConnectionAdminService.updateConnection(modelConnectionPath.id, body));
    } catch (error) {
      if (error instanceof ModelConnectionAdminServiceError) {
        sendJson(res, error.statusCode, { error: error.message });
      } else {
        sendHttpError(res, error, { fallbackStatus: 400 });
      }
    }
    return true;
  }

  if (modelConnectionPath && method === 'DELETE' && modelConnectionPath.action === 'base') {
    if (!requireAdmin(req, res, deps.adminToken)) {
      return true;
    }
    try {
      sendJson(res, 200, deps.modelConnectionAdminService.deleteConnection(modelConnectionPath.id));
    } catch (error) {
      if (error instanceof ModelConnectionAdminServiceError) {
        sendJson(res, error.statusCode, { error: error.message });
      } else {
        sendHttpError(res, error, { fallbackStatus: 400 });
      }
    }
    return true;
  }

  if (modelConnectionPath && method === 'POST' && modelConnectionPath.action === 'test') {
    if (!requireAdmin(req, res, deps.adminToken)) {
      return true;
    }
    try {
      const result = await deps.modelConnectionAdminService.testConnection(modelConnectionPath.id);
      sendJson(res, result.httpStatus, {
        success: result.success,
        statusCode: result.statusCode,
        error: result.error
      });
    } catch (error) {
      if (error instanceof ModelConnectionAdminServiceError) {
        sendJson(res, error.statusCode, { error: error.message });
      } else {
        sendHttpError(res, error, { fallbackStatus: 400 });
      }
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/system/dirs') {
    if (!requireAdmin(req, res, deps.adminToken)) {
      return true;
    }
    try {
      const targetPath = (requestUrl.searchParams.get('path') || '/').trim() || '/';
      sendJson(res, 200, deps.systemAdminService.listDirectories(targetPath));
    } catch (error) {
      if (error instanceof SystemAdminServiceError) {
        sendJson(res, error.statusCode, { error: error.message });
      } else {
        sendHttpError(res, error, { fallbackStatus: 400 });
      }
    }
    return true;
  }

  if (pathname.startsWith('/api/groups') || pathname.startsWith('/api/model-connections') || pathname.startsWith('/api/system/dirs')) {
    if (!requireAdmin(req, res, deps.adminToken)) {
      return true;
    }
  }

  return false;
}
