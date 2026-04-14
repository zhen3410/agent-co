import { Button } from '../../../shared/ui';
import { AdminDataList } from '../../components/AdminDataList';
import type { AdminUser } from '../../types';

export function UserList({ users, onEdit, onDelete }: { users: AdminUser[]; onEdit: (username: string) => void; onDelete: (username: string) => void }) {
  return (
    <AdminDataList
      caption="用户列表"
      items={users}
      getItemKey={(user) => user.username}
      columns={[
        { key: 'username', header: '用户名', render: (user) => <strong>{user.username}</strong> },
        { key: 'created', header: '创建时间', render: (user) => new Date(user.createdAt).toLocaleString('zh-CN') },
        { key: 'updated', header: '更新时间', render: (user) => new Date(user.updatedAt).toLocaleString('zh-CN') },
        { key: 'actions', header: '操作', render: (user) => <div className="admin-row-actions"><Button variant="secondary" onClick={() => onEdit(user.username)}>编辑</Button><Button variant="danger" onClick={() => onDelete(user.username)}>删除</Button></div> }
      ]}
    />
  );
}
