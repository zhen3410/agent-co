import { useAdminContext } from '../app/AdminContext';

export function AdminNoticeRegion() {
  const { activeNotice } = useAdminContext();

  if (!activeNotice) {
    return null;
  }

  return (
    <div data-admin-notice="true" data-tone={activeNotice.tone} className="admin-notice-region">
      {activeNotice.message}
    </div>
  );
}
