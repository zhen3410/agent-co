import type { ReactNode } from 'react';
import { AppShell } from '../../shared/layouts/AppShell';
import { Button, ErrorState, Spinner } from '../../shared/ui';
import { AdminIconButton } from '../components/AdminIconButton';
import { AdminTokenGate } from '../features/shared/AdminTokenGate';
import { useAdminContext } from './AdminContext';
import { buildAdminPath, type AdminRoute } from './admin-routes';

export function AdminLayout({ route, onNavigate, children }: { route: AdminRoute; onNavigate: (path: string) => void; children: ReactNode }) {
  const { showTokenGate, setAuthToken, loadState, hasLoadedData, errorMessage, refresh, openTokenEditor } = useAdminContext();
  const showBack = route.section !== 'dashboard';

  return (
    <AppShell
      title="agent-co admin"
      subtitle="轻量管理控制台"
      navigation={showBack ? <AdminIconButton icon="←" label="返回首页" onClick={() => onNavigate('/admin')} /> : undefined}
      actions={(
        <>
          <AdminIconButton icon="↻" label="刷新" onClick={refresh} />
          <AdminIconButton icon="⌘" label="切换 Token" onClick={openTokenEditor} />
        </>
      )}
    >
      <div data-admin-page="console" data-admin-density="console" className="admin-shell">
        {showTokenGate ? (
          <AdminTokenGate onSubmit={setAuthToken} busy={loadState === 'loading'} />
        ) : loadState === 'loading' && !hasLoadedData ? (
          <div className="admin-shell__state"><Spinner label="正在加载管理工作台…" /></div>
        ) : loadState === 'error' && !hasLoadedData ? (
          <ErrorState title="管理资源加载失败" message={errorMessage || '请检查管理员 Token 或服务状态。'} action={<div className="admin-row-actions"><Button onClick={refresh}>重试</Button><Button variant="secondary" onClick={openTokenEditor}>更换 Token</Button></div>} />
        ) : (
          <div className="admin-shell__content">{children}</div>
        )}
      </div>
    </AppShell>
  );
}
