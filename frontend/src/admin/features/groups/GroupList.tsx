import { Button } from '../../../shared/ui';
import { AdminDataList } from '../../components/AdminDataList';
import { AdminEntityChip } from '../../components/AdminEntityChip';
import type { AdminGroup } from '../../types';

export function GroupList({ groups, onEdit, onDelete }: { groups: AdminGroup[]; onEdit: (id: string) => void; onDelete: (id: string) => void }) {
  return (
    <AdminDataList
      caption="分组列表"
      items={groups}
      getItemKey={(group) => group.id}
      columns={[
        { key: 'id', header: 'ID', render: (group) => <AdminEntityChip>{group.id}</AdminEntityChip> },
        { key: 'name', header: '名称', render: (group) => <strong>{group.icon} {group.name}</strong> },
        { key: 'members', header: '成员', render: (group) => group.agentNames.join(', ') || '—' },
        { key: 'actions', header: '操作', render: (group) => <div className="admin-row-actions"><Button variant="secondary" onClick={() => onEdit(group.id)}>编辑</Button><Button variant="danger" onClick={() => onDelete(group.id)}>删除</Button></div> }
      ]}
    />
  );
}
