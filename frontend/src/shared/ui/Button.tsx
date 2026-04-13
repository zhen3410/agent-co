import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = 'primary', className: _className, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      data-ui="button"
      data-variant={variant}
      {...props}
      className="ui-button"
    />
  );
}
