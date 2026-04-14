import type { ComponentPropsWithoutRef } from 'react';

export interface SurfaceProps extends ComponentPropsWithoutRef<'section'> {
  tone?: 'default' | 'muted' | 'elevated';
}

export function Surface({ tone = 'default', className, ...props }: SurfaceProps) {
  return (
    <section
      {...props}
      data-ui="surface"
      data-tone={tone}
      className={['ui-surface', className].filter(Boolean).join(' ')}
    />
  );
}
