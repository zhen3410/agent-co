export interface DependencyStatusItem {
  name: string;
  required: boolean;
  healthy: boolean;
  detail: string;
}

export interface DependencyStatusLogEntry {
  timestamp: number;
  level: 'info' | 'error';
  dependency: string;
  message: string;
}

export interface DependencyStatusResponse {
  healthy: boolean;
  checkedAt: number;
  dependencies: DependencyStatusItem[];
  logs: DependencyStatusLogEntry[];
}

export interface DependencyLogQuery {
  startDate: string;
  endDate: string;
  keyword: string;
  dependency: string;
  level: '' | 'info' | 'error';
  limit: number;
}

export interface DependencyLogResponse {
  total: number;
  query: {
    keyword: string;
    startDate: number | null;
    endDate: number | null;
    dependency: string;
    level: string;
    limit: number;
  };
  logs: DependencyStatusLogEntry[];
}

export interface VerboseAgentSummary {
  agent: string;
  logCount: number;
  latestFile: string;
  latestUpdatedAt: number;
}

export interface VerboseAgentsResponse {
  logDir: string;
  agents: VerboseAgentSummary[];
}

export interface VerboseLogMeta {
  fileName: string;
  cli: string;
  agent: string;
  updatedAt: number;
  size: number;
}

export interface VerboseLogListResponse {
  agent: string;
  logs: VerboseLogMeta[];
}

export interface VerboseLogContentResponse {
  fileName: string;
  content: string;
}

export interface OpsApi {
  loadDependencyStatus(): Promise<DependencyStatusResponse>;
  loadDependencyLogs(query: DependencyLogQuery): Promise<DependencyLogResponse>;
  listVerboseAgents(): Promise<VerboseAgentsResponse>;
  listVerboseLogs(agent: string): Promise<VerboseLogListResponse>;
  loadVerboseLogContent(fileName: string): Promise<VerboseLogContentResponse>;
}
