import type { ButtonHTMLAttributes, CSSProperties } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const variantStyles: Record<ButtonVariant, CSSProperties> = {
  primary: {
    backgroundColor: 'var(--color-primary)',
    color: 'var(--color-primary-contrast)',
    borderColor: 'var(--color-primary)'
  },
  secondary: {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    borderColor: 'var(--color-border)'
  },
  danger: {
    backgroundColor: 'var(--status-error)',
    color: 'var(--color-primary-contrast)',
    borderColor: 'var(--status-error)'
  }
};

export function Button({ variant = 'primary', style, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      style={{
        borderRadius: 'var(--radius-md)',
        borderStyle: 'solid',
        borderWidth: '1px',
        boxShadow: 'var(--shadow-sm)',
        cursor: 'pointer',
        fontWeight: 'var(--font-weight-medium)',
        padding: 'var(--space-2) var(--space-4)',
        ...variantStyles[variant],
        ...style
      }}
    />
  );
}
