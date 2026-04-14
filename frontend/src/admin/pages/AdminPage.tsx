import { AdminApp, type AdminAppProps } from '../app/AdminApp';

export type AdminPageProps = AdminAppProps;

export function AdminPage(props: AdminPageProps) {
  return <AdminApp {...props} />;
}
