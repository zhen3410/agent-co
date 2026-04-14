import { useAdminContext } from '../app/AdminContext';
import { AdminFormPage } from '../components/AdminFormPage';
import { ModelConnectionForm } from '../features/model-connections/ModelConnectionForm';

export function ModelConnectionCreatePage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { createConnection } = useAdminContext();
  return (
    <AdminFormPage title="新建模型连接">
      <ModelConnectionForm
        mode="create"
        onSubmit={async (draft) => {
          const succeeded = await createConnection(draft);
          if (succeeded) {
            onNavigate('/admin/model-connections');
          }
          return succeeded;
        }}
        onCancel={() => onNavigate('/admin/model-connections')}
      />
    </AdminFormPage>
  );
}
