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
            ...noticeStyle,
            background: notice.tone === 'success' ? 'rgba(5, 150, 105, 0.08)' : 'rgba(220, 38, 38, 0.06)',
            borderColor: notice.tone === 'success' ? 'rgba(5, 150, 105, 0.2)' : 'rgba(220, 38, 38, 0.18)'
          }}
        >
          <div style={noticeHeaderStyle}>
            <span style={{ ...noticePillStyle, color: notice.tone === 'success' ? 'var(--status-success)' : 'var(--status-error)' }}>
              {notice.tone === 'success' ? 'Console update' : 'Console attention'}
            </span>
            <span style={noticeMetaStyle}>{notice.tone === 'success' ? '配置已同步' : '需要处理'}</span>
          </div>
          <div style={{ color: notice.tone === 'success' ? 'var(--status-success)' : 'var(--status-error)' }}>
            {notice.message}
          </div>
        </section>
      ) : null}
      {children}
    </>
  );
}

const noticeStyle = {
  border: '1px solid var(--color-border-muted)',
  borderRadius: 'calc(var(--radius-lg) + 0.125rem)',
  display: 'grid',
  gap: 'var(--space-2)',
  marginBottom: 'var(--space-4)',
  padding: 'var(--space-3) var(--space-4)'
} as const;

const noticeHeaderStyle = {
  alignItems: 'center',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-2)',
  justifyContent: 'space-between'
} as const;

const noticePillStyle = {
  fontFamily: 'var(--font-family-mono)',
  fontSize: '0.75rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase'
} as const;

const noticeMetaStyle = {
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-sm)'
} as const;
