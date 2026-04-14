import { AdminActivityFeed } from '../components/AdminActivityFeed';
import { AdminHomeHero } from '../components/AdminHomeHero';
import { AdminSectionNav } from '../components/AdminSectionNav';
import { AdminStatStrip } from '../components/AdminStatStrip';
import { useAdminContext } from '../app/AdminContext';

export function AdminDashboardPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { resources, loadState } = useAdminContext();
  const statusLabel = loadState === 'loading' ? '同步中' : loadState === 'error' ? '最近刷新失败' : '已连接';

  return (
    <div data-admin-page="dashboard" className="admin-dashboard">
      <AdminHomeHero title="管理台" subtitle="轻量概览、快速导航、待处理信息集中展示。" aside={<div className="admin-home-status">{statusLabel}</div>} />
      <AdminStatStrip items={[
        { key: 'status', label: '状态', value: statusLabel },
        { key: 'agents', label: '智能体', value: String(resources.agents.length) },
        { key: 'groups', label: '分组', value: String(resources.groups.length) },
        { key: 'users', label: '用户', value: String(resources.users.length) },
        { key: 'connections', label: '连接', value: String(resources.connections.length) }
      ]} />
      <AdminSectionNav items={[
        { key: 'agents', label: '智能体', meta: `${resources.agents.length} 项`, icon: '🤖', onClick: () => onNavigate('/admin/agents') },
        { key: 'groups', label: '分组', meta: `${resources.groups.length} 项`, icon: '🧩', onClick: () => onNavigate('/admin/groups') },
        { key: 'users', label: '用户', meta: `${resources.users.length} 项`, icon: '👤', onClick: () => onNavigate('/admin/users') },
        { key: 'model-connections', label: '模型连接', meta: `${resources.connections.length} 项`, icon: '🔌', onClick: () => onNavigate('/admin/model-connections') }
      ]} />
      <AdminActivityFeed
        pendingReason={resources.pendingReason}
        pendingUpdatedAt={resources.pendingUpdatedAt}
        agents={resources.agents}
        groups={resources.groups}
        users={resources.users}
        connections={resources.connections}
      />
    </div>
  );
}
