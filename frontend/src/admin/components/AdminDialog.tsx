import type { ReactNode } from 'react';
import { Button } from '../../shared/ui';

export function AdminDialog({
  dialogId,
  title,
  children,
  onClose
}: {
  dialogId: string;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      data-admin-overlay={dialogId}
      style={overlayStyle}
      onClick={onClose}
    >
      <section
        data-admin-dialog={dialogId}
        style={dialogStyle}
        onClick={(event) => event.stopPropagation()}
      >
        <header style={headerStyle}>
          <strong>{title}</strong>
          <Button
            variant="secondary"
            data-admin-action={`close-${dialogId}`}
            onClick={onClose}
          >
            关闭
          </Button>
        </header>
        <div style={contentStyle}>{children}</div>
      </section>
    </div>
  );
}

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.32)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
  zIndex: 1000
} as const;

const dialogStyle = {
  width: 'min(880px, 100%)',
  maxHeight: 'min(80vh, 900px)',
  overflow: 'hidden',
  borderRadius: '20px',
  border: '1px solid var(--color-border-muted)',
  background: 'var(--color-surface)',
  boxShadow: '0 24px 64px rgba(15, 23, 42, 0.18)',
  display: 'grid',
  gridTemplateRows: 'auto minmax(0, 1fr)'
} as const;

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  padding: '18px 20px',
  borderBottom: '1px solid var(--color-border-muted)'
} as const;

const contentStyle = {
  overflow: 'auto',
  padding: '20px'
} as const;
