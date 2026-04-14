import { Button } from '../../shared/ui';
import { useAdminContext } from '../app/AdminContext';
import { AdminEmptyBlock } from '../components/AdminEmptyBlock';
import { AdminListPageHeader } from '../components/AdminListPageHeader';
import { ModelConnectionList } from '../features/model-connections/ModelConnectionList';

export function ModelConnectionsListPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { resources, deleteConnection, testConnection } = useAdminContext();
  return (
    <section data-admin-page="model-connections-list" className="admin-page-stack">
      <AdminListPageHeader title="模型连接" description="统一维护 API 入口、鉴权与启停状态。" actions={<Button onClick={() => onNavigate('/admin/model-connections/new')}>新建</Button>} />
      {resources.connections.length === 0 ? <AdminEmptyBlock title="暂无模型连接" description="创建连接后，可供 API 模式智能体复用。" action={<Button onClick={() => onNavigate('/admin/model-connections/new')}>新建连接</Button>} /> : <ModelConnectionList connections={resources.connections} onEdit={(id) => onNavigate(`/admin/model-connections/${encodeURIComponent(id)}/edit`)} onDelete={(id) => void deleteConnection(id)} onTest={(id) => void testConnection(id)} />}
    </section>
  );
}
