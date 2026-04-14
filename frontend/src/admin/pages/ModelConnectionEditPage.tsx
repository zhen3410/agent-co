import { useAdminContext } from '../app/AdminContext';
import { AdminFormPage } from '../components/AdminFormPage';
import { ModelConnectionForm } from '../features/model-connections/ModelConnectionForm';

export function ModelConnectionEditPage({ id, onNavigate }: { id: string; onNavigate: (path: string) => void }) {
  const { resources, updateConnection, testConnection } = useAdminContext();
  const connection = resources.connections.find((item) => item.id === id);
  if (!connection) {
    return <AdminFormPage title="未找到模型连接" description={id} />;
  }

  return (
    <AdminFormPage title={connection.name} description={connection.baseURL}>
      <ModelConnectionForm
        mode="edit"
        initialValue={connection}
        onSubmit={async (draft) => {
          const succeeded = await updateConnection(connection.id, draft);
          if (succeeded) {
            onNavigate('/admin/model-connections');
          }
          return succeeded;
        }}
        onTest={() => void testConnection(connection.id)}
        onCancel={() => onNavigate('/admin/model-connections')}
      />
    </AdminFormPage>
  );
}
