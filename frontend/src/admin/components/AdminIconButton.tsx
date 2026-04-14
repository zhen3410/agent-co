import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface AdminIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
}

export function AdminIconButton({ icon, label, className, ...props }: AdminIconButtonProps) {
  return (
    <button
      {...props}
      type={props.type || 'button'}
      className={['admin-icon-button', className].filter(Boolean).join(' ')}
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}
