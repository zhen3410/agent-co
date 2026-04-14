import { Button } from '../../shared/ui';
import { AdminFormPage } from '../components/AdminFormPage';

export function AdminNotFoundPage({ pathname, onNavigate }: { pathname: string; onNavigate: (path: string) => void }) {
  return (
    <AdminFormPage title="未找到页面" description={pathname} actions={<Button onClick={() => onNavigate('/admin')}>返回首页</Button>} />
  );
}
