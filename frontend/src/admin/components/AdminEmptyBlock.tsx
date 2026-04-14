import { EmptyState } from '../../shared/ui';
import type { ReactNode } from 'react';

export interface AdminEmptyBlockProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function AdminEmptyBlock({ title, description, action }: AdminEmptyBlockProps) {
  return <EmptyState title={title} description={description} action={action} />;
}
