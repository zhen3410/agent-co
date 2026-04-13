import type { CSSProperties, ReactNode } from 'react';

export interface CardProps {
  title?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
}

export function Card({ title, actions, children, style }: CardProps) {
  return (
    <article
      data-ui="card"
      className="ui-card"
      style={style}
    >
      {title || actions ? (
        <header className="ui-card__header">
          {title ? <h2 className="ui-card__title">{title}</h2> : null}
          {actions ? <div className="ui-card__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="ui-card__body">{children}</div>
    </article>
  );
}
