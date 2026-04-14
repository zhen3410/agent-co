import type { AdminAgent, AdminGroup, AdminModelConnection, AdminUser } from '../types';

export interface AdminActivityFeedProps {
  pendingReason: string | null;
  pendingUpdatedAt: number | null;
  agents: AdminAgent[];
  groups: AdminGroup[];
  users: AdminUser[];
  connections: AdminModelConnection[];
}

export function AdminActivityFeed({ pendingReason, pendingUpdatedAt, agents, groups, users, connections }: AdminActivityFeedProps) {
  const recent = [
    agents[0] ? `智能体：${agents[0].name}` : null,
    groups[0] ? `分组：${groups[0].name}` : null,
    users[0] ? `用户：${users[0].username}` : null,
    connections[0] ? `连接：${connections[0].name}` : null
  ].filter(Boolean);

  return (
    <section className="admin-activity-grid">
      <article className="admin-activity-card">
        <div className="admin-activity-card__title">待处理</div>
        <div className="admin-activity-card__body">
          {pendingReason || '当前没有待生效配置'}
          {pendingUpdatedAt ? <div className="admin-activity-card__meta">{new Date(pendingUpdatedAt).toLocaleString('zh-CN')}</div> : null}
        </div>
      </article>
      <article className="admin-activity-card">
        <div className="admin-activity-card__title">最近改动</div>
        <div className="admin-activity-card__body">
          {recent.length > 0 ? recent.map((item) => <div key={item}>{item}</div>) : '暂无记录'}
        </div>
      </article>
    </section>
  );
}
