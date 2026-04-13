import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}

export function Input({ id, label, hint, error, style, ...props }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
      <label htmlFor={inputId} style={{ fontWeight: 'var(--font-weight-medium)' }}>
        {label}
      </label>
      <input
        {...props}
        id={inputId}
        aria-describedby={[descriptionId, errorId].filter(Boolean).join(' ') || undefined}
        aria-invalid={error ? true : undefined}
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--color-text)',
          padding: 'var(--space-2) var(--space-3)',
          ...style
        }}
      />
      {hint ? (
        <small id={descriptionId} style={{ color: 'var(--color-text-muted)' }}>
          {hint}
        </small>
      ) : null}
      {error ? (
        <small id={errorId} style={{ color: 'var(--status-error)' }}>
          {error}
        </small>
      ) : null}
    </div>
  );
}
