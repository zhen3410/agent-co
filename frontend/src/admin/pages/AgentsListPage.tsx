import { Button } from '../../shared/ui';
import { useAdminContext } from '../app/AdminContext';
import { AdminEmptyBlock } from '../components/AdminEmptyBlock';
import { AdminListPageHeader } from '../components/AdminListPageHeader';
import { AgentList } from '../features/agents/AgentList';

export function AgentsListPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { resources, deleteAgent, applyPendingAgents } = useAdminContext();

  return (
    <section data-admin-page="agents-list" className="admin-page-stack">
      <AdminListPageHeader
        title="智能体"
        description="维护角色设定、执行方式与运行目标。"
        meta={resources.pendingReason ? `待生效：${resources.pendingReason}` : undefined}
        actions={<div className="admin-row-actions"><Button onClick={() => onNavigate('/admin/agents/new')} data-admin-action="create-agent">新建</Button>{resources.pendingReason ? <Button variant="secondary" onClick={() => void applyPendingAgents()}>应用待生效配置</Button> : null}</div>}
      />
      {resources.agents.length === 0 ? <AdminEmptyBlock title="暂无智能体" description="创建后可分配到分组或切换为 API 模式。" action={<Button onClick={() => onNavigate('/admin/agents/new')}>新建智能体</Button>} /> : <AgentList agents={resources.agents} onEdit={(name) => onNavigate(`/admin/agents/${encodeURIComponent(name)}/edit`)} onDelete={(name) => void deleteAgent(name)} />}
    </section>
  );
}
