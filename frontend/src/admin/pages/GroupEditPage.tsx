import { useAdminContext } from '../app/AdminContext';
import { AdminFormPage } from '../components/AdminFormPage';
import { GroupForm } from '../features/groups/GroupForm';

export function GroupEditPage({ id, onNavigate }: { id: string; onNavigate: (path: string) => void }) {
  const { resources, updateGroup } = useAdminContext();
  const group = resources.groups.find((item) => item.id === id);
  if (!group) {
    return <AdminFormPage title="未找到分组" description={id} />;
  }

  return (
    <AdminFormPage title={group.name}>
      <GroupForm
        mode="edit"
        initialValue={group}
        agents={resources.agents}
        onSubmit={async (nextGroup) => {
          const succeeded = await updateGroup(group.id, { name: nextGroup.name, icon: nextGroup.icon, agentNames: nextGroup.agentNames });
          if (succeeded) {
            onNavigate('/admin/groups');
          }
          return succeeded;
        }}
        onCancel={() => onNavigate('/admin/groups')}
      />
    </AdminFormPage>
  );
}
