import { useAdminContext } from '../app/AdminContext';
import { AdminFormPage } from '../components/AdminFormPage';
import { AgentForm } from '../features/agents/AgentForm';

export function AgentEditPage({ name, onNavigate }: { name: string; onNavigate: (path: string) => void }) {
  const { resources, updateAgent, previewAgentPromptTemplate, restoreAgentPromptTemplate } = useAdminContext();
  const agent = resources.agents.find((item) => item.name === name);
  if (!agent) {
    return <AdminFormPage title="未找到智能体" description={name} />;
  }

  return (
    <AdminFormPage title={agent.name} description="编辑智能体配置。">
      <AgentForm
        mode="edit"
        initialValue={agent}
        connections={resources.connections}
        onSubmit={async (nextAgent) => {
          const succeeded = await updateAgent(agent.name, { agent: nextAgent });
          if (succeeded) {
            onNavigate('/admin/agents');
          }
          return succeeded;
        }}
        onPreviewDefaultPrompt={async () => {
          const result = await previewAgentPromptTemplate(agent.name);
          return result?.templatePrompt || null;
        }}
        onRestoreDefaultPrompt={() => restoreAgentPromptTemplate(agent.name)}
        onCancel={() => onNavigate('/admin/agents')}
      />
    </AdminFormPage>
  );
}
