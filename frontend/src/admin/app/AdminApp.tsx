import { AdminNoticeRegion } from '../components/AdminNoticeRegion';
import { AdminDashboardPage } from '../pages/AdminDashboardPage';
import { AgentsListPage } from '../pages/AgentsListPage';
import { AgentCreatePage } from '../pages/AgentCreatePage';
import { AgentEditPage } from '../pages/AgentEditPage';
import { GroupsListPage } from '../pages/GroupsListPage';
import { GroupCreatePage } from '../pages/GroupCreatePage';
import { GroupEditPage } from '../pages/GroupEditPage';
import { UsersListPage } from '../pages/UsersListPage';
import { UserCreatePage } from '../pages/UserCreatePage';
import { UserEditPage } from '../pages/UserEditPage';
import { ModelConnectionsListPage } from '../pages/ModelConnectionsListPage';
import { ModelConnectionCreatePage } from '../pages/ModelConnectionCreatePage';
import { ModelConnectionEditPage } from '../pages/ModelConnectionEditPage';
import { AdminNotFoundPage } from '../pages/AdminNotFoundPage';
import type { AdminApi } from '../types';
import { AdminContextProvider } from './AdminContext';
import { AdminLayout } from './AdminLayout';
import { useAdminRouter } from './admin-router';

export interface AdminAppProps {
  api?: AdminApi;
  initialAuthToken?: string;
  initialPathname?: string;
}

function AdminRouteView({ pathname, route, onNavigate }: { pathname: string; route: ReturnType<typeof useAdminRouter>['route']; onNavigate: (path: string) => void }) {
  switch (route.section) {
    case 'dashboard':
      return <AdminDashboardPage onNavigate={onNavigate} />;
    case 'agents':
      return route.view === 'list'
        ? <AgentsListPage onNavigate={onNavigate} />
        : route.view === 'create'
          ? <AgentCreatePage onNavigate={onNavigate} />
          : <AgentEditPage name={route.params.name} onNavigate={onNavigate} />;
    case 'groups':
      return route.view === 'list'
        ? <GroupsListPage onNavigate={onNavigate} />
        : route.view === 'create'
          ? <GroupCreatePage onNavigate={onNavigate} />
          : <GroupEditPage id={route.params.id} onNavigate={onNavigate} />;
    case 'users':
      return route.view === 'list'
        ? <UsersListPage onNavigate={onNavigate} />
        : route.view === 'create'
          ? <UserCreatePage onNavigate={onNavigate} />
          : <UserEditPage name={route.params.name} onNavigate={onNavigate} />;
    case 'model-connections':
      return route.view === 'list'
        ? <ModelConnectionsListPage onNavigate={onNavigate} />
        : route.view === 'create'
          ? <ModelConnectionCreatePage onNavigate={onNavigate} />
          : <ModelConnectionEditPage id={route.params.id} onNavigate={onNavigate} />;
    case 'not-found':
      return <AdminNotFoundPage pathname={pathname} onNavigate={onNavigate} />;
  }
}

export function AdminApp({ api, initialAuthToken = '', initialPathname }: AdminAppProps) {
  const { pathname, route, navigate } = useAdminRouter(initialPathname);

  return (
    <AdminContextProvider api={api} initialAuthToken={initialAuthToken}>
      <AdminLayout route={route} onNavigate={navigate}>
        <AdminRouteView pathname={pathname} route={route} onNavigate={navigate} />
      </AdminLayout>
      <AdminNoticeRegion />
    </AdminContextProvider>
  );
}
