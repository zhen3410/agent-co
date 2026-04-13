import type { HTMLAttributes } from 'react';

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  tone?: 'default' | 'muted' | 'elevated';
}

export function Surface({ tone = 'default', className: _className, ...props }: SurfaceProps) {
  return <section data-ui="surface" data-tone={tone} className="ui-surface" {...props} />;
}
