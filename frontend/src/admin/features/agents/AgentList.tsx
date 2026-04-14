import { Button } from '../../../shared/ui';
import { AdminDataList } from '../../components/AdminDataList';
import { AdminEntityChip } from '../../components/AdminEntityChip';
import type { AdminAgent } from '../../types';

export function AgentList({
  agents,
  onEdit,
  onDelete
}: {
  agents: AdminAgent[];
  onEdit: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  return (
    <AdminDataList
      caption="智能体列表"
      items={agents}
      getItemKey={(agent) => agent.name}
      columns={[
        { key: 'name', header: '名称', render: (agent) => <strong>{agent.avatar} {agent.name}</strong> },
        { key: 'personality', header: '个性', render: (agent) => agent.personality || '—' },
        { key: 'mode', header: '模式', render: (agent) => <AdminEntityChip>{agent.executionMode || 'cli'}</AdminEntityChip> },
        { key: 'target', header: '运行目标', render: (agent) => agent.executionMode === 'api' ? (agent.apiConnectionId || '未绑定连接') : (agent.cliName || 'codex') },
        {
          key: 'actions',
          header: '操作',
          render: (agent) => (
            <div className="admin-row-actions">
              <Button variant="secondary" data-admin-action={`edit-agent:${agent.name}`} onClick={() => onEdit(agent.name)}>编辑</Button>
              <Button variant="danger" onClick={() => onDelete(agent.name)}>删除</Button>
            </div>
          )
        }
      ]}
    />
  );
}
