import { Button } from '../../shared/ui';
import { useAdminContext } from '../app/AdminContext';
import { AdminEmptyBlock } from '../components/AdminEmptyBlock';
import { AdminListPageHeader } from '../components/AdminListPageHeader';
import { GroupList } from '../features/groups/GroupList';

export function GroupsListPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { resources, deleteGroup } = useAdminContext();
  return (
    <section data-admin-page="groups-list" className="admin-page-stack">
      <AdminListPageHeader title="分组" description="维护小团队协作编组与成员关系。" actions={<Button onClick={() => onNavigate('/admin/groups/new')}>新建</Button>} />
      {resources.groups.length === 0 ? <AdminEmptyBlock title="暂无分组" description="创建分组后可在这里维护成员关系。" action={<Button onClick={() => onNavigate('/admin/groups/new')}>新建分组</Button>} /> : <GroupList groups={resources.groups} onEdit={(id) => onNavigate(`/admin/groups/${encodeURIComponent(id)}/edit`)} onDelete={(id) => void deleteGroup(id)} />}
    </section>
  );
}
