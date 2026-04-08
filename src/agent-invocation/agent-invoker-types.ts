import type {
  AIAgent,
  AgentCliName,
  AgentExecutionMode,
  AgentInvokeResult,
  ApiConnectionConfig,
  Message
} from '../types';

export interface InvokeAgentParams {
  userMessage: string;
  agent: AIAgent;
  history: Message[];
  includeHistory: boolean;
  extraEnv?: Record<string, string>;
  onTextDelta?: (delta: string) => void;
}

export interface ApiInvokeTarget {
  executionMode: Extract<AgentExecutionMode, 'api'>;
}

export interface CliInvokeTarget {
  executionMode: Extract<AgentExecutionMode, 'cli'>;
  cliName: AgentCliName;
}

export type NormalizedInvokeTarget = ApiInvokeTarget | CliInvokeTarget;

export interface ModelConnectionFileOptions {
  cwd?: string;
  agentDataFile?: string;
  modelConnectionDataFile?: string;
}

export interface LoadedApiAgentConnection {
  filePath: string;
  connection: ApiConnectionConfig;
}

export type { AgentInvokeResult };
