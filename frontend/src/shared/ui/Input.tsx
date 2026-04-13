import { useId, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  containerClassName?: string;
  containerStyle?: CSSProperties;
}

export function Input({
  id,
  label,
  hint,
  error,
  className,
  style,
  containerClassName,
  containerStyle,
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const resolvedInputClassName = ['ui-input__field', className].filter(Boolean).join(' ');
  const resolvedContainerClassName = ['ui-input', containerClassName].filter(Boolean).join(' ');

  return (
    <div data-ui="input" className={resolvedContainerClassName} style={containerStyle}>
      <label htmlFor={inputId} className="ui-input__label">
        {label}
      </label>
      <input
        {...props}
        id={inputId}
        aria-describedby={[descriptionId, errorId].filter(Boolean).join(' ') || undefined}
        aria-invalid={error ? true : undefined}
        className={resolvedInputClassName}
        style={style}
      />
      {hint ? (
        <small id={descriptionId} className="ui-input__hint">
          {hint}
        </small>
      ) : null}
      {error ? (
        <small id={errorId} className="ui-input__error">
          {error}
        </small>
      ) : null}
    </div>
  );
}
