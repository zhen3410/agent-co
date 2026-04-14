import type { CSSProperties, ReactNode } from 'react';

export interface SpinnerProps {
  label?: ReactNode;
  size?: number;
}

export function Spinner({ label = 'Loading…', size = 18 }: SpinnerProps) {
  const indicatorStyle: CSSProperties = {
    animation: 'spin 0.8s linear infinite',
    height: `${size}px`,
    width: `${size}px`
  };

  return (
    <span
      role="status"
      aria-live="polite"
      data-ui="spinner"
      className="ui-spinner"
    >
      <span aria-hidden="true" className="ui-spinner__indicator" style={indicatorStyle} />
      <span className="ui-spinner__label">{label}</span>
    </span>
  );
}
