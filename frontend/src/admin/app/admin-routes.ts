export type AdminRoute =
  | { section: 'dashboard'; view: 'home' }
  | { section: 'agents'; view: 'list' }
  | { section: 'agents'; view: 'create' }
  | { section: 'agents'; view: 'edit'; params: { name: string } }
  | { section: 'groups'; view: 'list' }
  | { section: 'groups'; view: 'create' }
  | { section: 'groups'; view: 'edit'; params: { id: string } }
  | { section: 'users'; view: 'list' }
  | { section: 'users'; view: 'create' }
  | { section: 'users'; view: 'edit'; params: { name: string } }
  | { section: 'model-connections'; view: 'list' }
  | { section: 'model-connections'; view: 'create' }
  | { section: 'model-connections'; view: 'edit'; params: { id: string } }
  | { section: 'not-found'; view: '404'; pathname: string };

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function matchAdminRoute(pathname: string): AdminRoute {
  const normalized = pathname.replace(/\/+$/, '') || '/';

  if (normalized === '/' || normalized === '/admin' || normalized === '/admin.html' || normalized === '/index.html') {
    return { section: 'dashboard', view: 'home' };
  }

  const segments = normalized.split('/').filter(Boolean);
  if (segments[0] !== 'admin') {
    return { section: 'not-found', view: '404', pathname };
  }

  const section = segments[1];
  const entityId = segments[2] ? decodeSegment(segments[2]) : undefined;
  const action = segments[3];

  if (section === 'agents') {
    if (segments.length === 2) {
      return { section: 'agents', view: 'list' };
    }
    if (segments.length === 3 && segments[2] === 'new') {
      return { section: 'agents', view: 'create' };
    }
    if (segments.length === 4 && entityId && action === 'edit') {
      return { section: 'agents', view: 'edit', params: { name: entityId } };
    }
  }

  if (section === 'groups') {
    if (segments.length === 2) {
      return { section: 'groups', view: 'list' };
    }
    if (segments.length === 3 && segments[2] === 'new') {
      return { section: 'groups', view: 'create' };
    }
    if (segments.length === 4 && entityId && action === 'edit') {
      return { section: 'groups', view: 'edit', params: { id: entityId } };
    }
  }

  if (section === 'users') {
    if (segments.length === 2) {
      return { section: 'users', view: 'list' };
    }
    if (segments.length === 3 && segments[2] === 'new') {
      return { section: 'users', view: 'create' };
    }
    if (segments.length === 4 && entityId && action === 'edit') {
      return { section: 'users', view: 'edit', params: { name: entityId } };
    }
  }

  if (section === 'model-connections') {
    if (segments.length === 2) {
      return { section: 'model-connections', view: 'list' };
    }
    if (segments.length === 3 && segments[2] === 'new') {
      return { section: 'model-connections', view: 'create' };
    }
    if (segments.length === 4 && entityId && action === 'edit') {
      return { section: 'model-connections', view: 'edit', params: { id: entityId } };
    }
  }

  return { section: 'not-found', view: '404', pathname };
}

export function buildAdminPath(route: Exclude<AdminRoute, { section: 'not-found' }>): string {
  switch (route.section) {
    case 'dashboard':
      return '/admin';
    case 'agents':
      return route.view === 'list'
        ? '/admin/agents'
        : route.view === 'create'
          ? '/admin/agents/new'
          : `/admin/agents/${encodeURIComponent(route.params.name)}/edit`;
    case 'groups':
      return route.view === 'list'
        ? '/admin/groups'
        : route.view === 'create'
          ? '/admin/groups/new'
          : `/admin/groups/${encodeURIComponent(route.params.id)}/edit`;
    case 'users':
      return route.view === 'list'
        ? '/admin/users'
        : route.view === 'create'
          ? '/admin/users/new'
          : `/admin/users/${encodeURIComponent(route.params.name)}/edit`;
    case 'model-connections':
      return route.view === 'list'
        ? '/admin/model-connections'
        : route.view === 'create'
          ? '/admin/model-connections/new'
          : `/admin/model-connections/${encodeURIComponent(route.params.id)}/edit`;
  }
}

export function getAdminRouteLabel(route: AdminRoute): string {
  switch (route.section) {
    case 'dashboard':
      return '管理台';
    case 'agents':
      return route.view === 'list' ? '智能体' : route.view === 'create' ? '新建智能体' : '编辑智能体';
    case 'groups':
      return route.view === 'list' ? '分组' : route.view === 'create' ? '新建分组' : '编辑分组';
    case 'users':
      return route.view === 'list' ? '用户' : route.view === 'create' ? '新建用户' : '编辑用户';
    case 'model-connections':
      return route.view === 'list' ? '模型连接' : route.view === 'create' ? '新建模型连接' : '编辑模型连接';
    case 'not-found':
      return '未找到页面';
  }
}
