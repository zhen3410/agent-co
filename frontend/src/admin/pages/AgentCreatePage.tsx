import { useAdminContext } from '../app/AdminContext';
import { AdminFormPage } from '../components/AdminFormPage';
import { AgentForm } from '../features/agents/AgentForm';

export function AgentCreatePage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { resources, createAgent } = useAdminContext();
  return (
    <AdminFormPage title="新建智能体" description="独立页面编辑，避免控制面板堆叠。">
      <AgentForm
        mode="create"
        connections={resources.connections}
        onSubmit={async (agent) => {
          const succeeded = await createAgent({ agent });
          if (succeeded) {
            onNavigate('/admin/agents');
          }
          return succeeded;
        }}
        onCancel={() => onNavigate('/admin/agents')}
      />
    </AdminFormPage>
  );
}
