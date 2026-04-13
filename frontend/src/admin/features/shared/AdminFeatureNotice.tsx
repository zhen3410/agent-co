import type { ReactNode } from 'react';
import type { AdminNotice } from '../../types';

export interface AdminFeatureNoticeProps {
  notice: AdminNotice | null;
  children?: ReactNode;
}

export function AdminFeatureNotice({ notice, children }: AdminFeatureNoticeProps) {
  return (
    <>
      {notice ? (
        <section
          aria-live="polite"
          role={notice.tone === 'error' ? 'alert' : 'status'}
          data-admin-notice="true"
          data-tone={notice.tone}
          style={{
            background: notice.tone === 'success' ? 'rgba(22, 163, 74, 0.1)' : 'rgba(220, 38, 38, 0.08)',
            border: `1px solid ${notice.tone === 'success' ? 'var(--status-success)' : 'var(--status-error)'}`,
            borderRadius: 'var(--radius-md)',
            color: notice.tone === 'success' ? 'var(--status-success)' : 'var(--status-error)',
            marginBottom: 'var(--space-4)',
            padding: 'var(--space-3)'
          }}
        >
          {notice.message}
        </section>
      ) : null}
      {children}
    </>
  );
}
