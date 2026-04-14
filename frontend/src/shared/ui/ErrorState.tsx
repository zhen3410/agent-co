import type { ReactNode } from 'react';

export interface ErrorStateProps {
  title?: ReactNode;
  message: ReactNode;
  action?: ReactNode;
}

export function ErrorState({ title = 'Something went wrong', message, action }: ErrorStateProps) {
  return (
    <section
      role="alert"
      data-ui="error-state"
      className="ui-error-state"
    >
      <h2 className="ui-error-state__title">{title}</h2>
      <p className="ui-error-state__message">{message}</p>
      {action ? <div className="ui-error-state__action">{action}</div> : null}
    </section>
  );
}
