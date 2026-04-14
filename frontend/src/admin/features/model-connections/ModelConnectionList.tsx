import { Button } from '../../../shared/ui';
import { AdminDataList } from '../../components/AdminDataList';
import { AdminEntityChip } from '../../components/AdminEntityChip';
import type { AdminModelConnection } from '../../types';

export function ModelConnectionList({
  connections,
  onEdit,
  onDelete,
  onTest
}: {
  connections: AdminModelConnection[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
}) {
  return (
    <AdminDataList
      caption="模型连接列表"
      items={connections}
      getItemKey={(connection) => connection.id}
      columns={[
        { key: 'name', header: '名称', render: (connection) => <strong>{connection.name}</strong> },
        { key: 'baseURL', header: 'Base URL', render: (connection) => connection.baseURL },
        { key: 'status', header: '状态', render: (connection) => <AdminEntityChip>{connection.enabled ? '已启用' : '已停用'}</AdminEntityChip> },
        { key: 'key', header: '密钥', render: (connection) => connection.apiKeyMasked },
        { key: 'actions', header: '操作', render: (connection) => <div className="admin-row-actions"><Button variant="secondary" data-admin-action={`edit-model-connection:${connection.id}`} onClick={() => onEdit(connection.id)}>编辑</Button><Button variant="secondary" onClick={() => onTest(connection.id)}>测试</Button><Button variant="danger" onClick={() => onDelete(connection.id)}>删除</Button></div> }
      ]}
    />
  );
}
