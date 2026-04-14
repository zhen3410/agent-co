import { useAdminContext } from '../app/AdminContext';
import { AdminFormPage } from '../components/AdminFormPage';
import { UserForm } from '../features/users/UserForm';

export function UserEditPage({ name, onNavigate }: { name: string; onNavigate: (path: string) => void }) {
  const { resources, changeUserPassword } = useAdminContext();
  const user = resources.users.find((item) => item.username === name);
  if (!user) {
    return <AdminFormPage title="未找到用户" description={name} />;
  }

  return (
    <AdminFormPage title={user.username} description="仅在需要时更新密码。">
      <UserForm
        mode="edit"
        initialValue={{ username: user.username }}
        onSubmit={async (draft) => {
          const succeeded = await changeUserPassword(user.username, { password: draft.password || '' });
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
