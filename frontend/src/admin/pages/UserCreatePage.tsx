import { useAdminContext } from '../app/AdminContext';
import { AdminFormPage } from '../components/AdminFormPage';
import { UserForm } from '../features/users/UserForm';

export function UserCreatePage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { createUser } = useAdminContext();
  return (
    <AdminFormPage title="新建用户">
      <UserForm
        mode="create"
        onSubmit={async (draft) => {
          const succeeded = await createUser({ username: draft.username, password: draft.password || '' });
          if (succeeded) {
            onNavigate('/admin/users');
          }
          return succeeded;
        }}
        onCancel={() => onNavigate('/admin/users')}
      />
    </AdminFormPage>
  );
}
