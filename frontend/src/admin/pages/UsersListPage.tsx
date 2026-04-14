import { Button } from '../../shared/ui';
import { useAdminContext } from '../app/AdminContext';
import { AdminEmptyBlock } from '../components/AdminEmptyBlock';
import { AdminListPageHeader } from '../components/AdminListPageHeader';
import { UserList } from '../features/users/UserList';

export function UsersListPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { resources, deleteUser } = useAdminContext();
  return (
    <section data-admin-page="users-list" className="admin-page-stack">
      <AdminListPageHeader title="用户" description="管理访问账号与密码更新。" actions={<Button onClick={() => onNavigate('/admin/users/new')}>新建</Button>} />
      {resources.users.length === 0 ? <AdminEmptyBlock title="暂无用户" description="创建第一个管理用户后即可在这里维护账号。" action={<Button onClick={() => onNavigate('/admin/users/new')}>新建用户</Button>} /> : <UserList users={resources.users} onEdit={(username) => onNavigate(`/admin/users/${encodeURIComponent(username)}/edit`)} onDelete={(username) => void deleteUser(username)} />}
    </section>
  );
}
