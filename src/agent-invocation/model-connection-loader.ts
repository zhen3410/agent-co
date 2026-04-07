import * as path from 'path';
import { loadApiConnectionStore } from '../api-connection-store';
import type { AIAgent } from '../types';
import type {
  LoadedApiAgentConnection,
  ModelConnectionFileOptions
} from './agent-invoker-types';

export function resolveModelConnectionDataFile(options: ModelConnectionFileOptions = {}): string {
  const cwd = options.cwd || process.cwd();
  const agentDataFile = options.agentDataFile || process.env.AGENT_DATA_FILE || path.join(cwd, 'data', 'agents.json');

  return options.modelConnectionDataFile
    || process.env.MODEL_CONNECTION_DATA_FILE
    || path.join(path.dirname(agentDataFile), 'api-connections.json');
}

export function loadApiAgentConnection(
  agent: AIAgent,
  options: ModelConnectionFileOptions = {}
): LoadedApiAgentConnection {
  const apiConnectionId = agent.apiConnectionId?.trim();
  if (!apiConnectionId) {
    throw new Error(`Agent ${agent.name} 缺少 apiConnectionId 配置`);
  }

  if (!agent.apiModel?.trim()) {
    throw new Error(`Agent ${agent.name} 缺少 apiModel 配置`);
  }

  const filePath = resolveModelConnectionDataFile(options);
  const store = loadApiConnectionStore(filePath);
  const connection = store.apiConnections.find(item => item.id === apiConnectionId);

  if (!connection) {
    throw new Error(`找不到 API 连接配置：${apiConnectionId}`);
  }

  if (!connection.enabled) {
    throw new Error(`API 连接已停用：${apiConnectionId}`);
  }

  return {
    filePath,
    connection
  };
}
