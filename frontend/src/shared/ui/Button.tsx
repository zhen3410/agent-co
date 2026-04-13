import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = 'primary', className, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      data-ui="button"
      data-variant={variant}
      className={['ui-button', className].filter(Boolean).join(' ')}
    />
  );
}
