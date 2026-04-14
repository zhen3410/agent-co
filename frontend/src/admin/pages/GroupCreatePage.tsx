import { useAdminContext } from '../app/AdminContext';
import { AdminFormPage } from '../components/AdminFormPage';
import { GroupForm } from '../features/groups/GroupForm';

export function GroupCreatePage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { resources, createGroup } = useAdminContext();
  return (
    <AdminFormPage title="新建分组">
      <GroupForm
        mode="create"
        agents={resources.agents}
        onSubmit={async (group) => {
          const succeeded = await createGroup(group);
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
