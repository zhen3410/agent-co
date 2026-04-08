# 多 Agent 聊天系统 LLM API 直连设计方案

## 1. 背景

当前系统中，agent 主要通过 CLI 方式调用大模型，运行链路为：

- `server.ts`
- `callClaudeCLI()`
- `claude/codex CLI`
- 本地 `agent-co-mcp-server` 回调上下文和发消息

这种方式已可用，但存在以下问题：

1. 模型调用依赖本地 CLI 环境  
2. 管理员无法直接为 agent 配置 API 模型  
3. 不便接入 OpenAI-compatible 网关  
4. CLI 与 API 无统一抽象，后续扩展成本高

因此，需要在保留现有 CLI 能力的同时，引入 **API 直连模式**。

## 2. 目标

### 2.1 业务目标
管理员可以为每个 agent 配置：

- 调用方式：`CLI` / `API`
- 若为 CLI：选择 `Claude` / `Codex`
- 若为 API：选择全局 API Connection，并指定模型
- 可配置常用参数：
  - `temperature`
  - `maxTokens`

### 2.2 技术目标
- 支持同一系统内 agent 混用 CLI / API
- 保持现有聊天编排、@agent 链式调度、消息展示逻辑不变
- 引入统一 provider 抽象，避免执行层继续堆条件分支
- 首版支持 **OpenAI-compatible** API

## 3. 非目标

第一版明确不做：

- API 模式下的 MCP / tools / function calling
- API streaming 输出
- 多协议专门适配
- key 加密存储
- 复杂高级参数（如 extra headers / extra body / reasoning effort）

## 4. 总体方案

采用 **Provider 抽象 + 全局 Connection 管理** 的方案。

### 4.1 配置层
分为两层：

#### 全局 API Connections
统一维护：
- `name`
- `baseURL`
- `apiKey`
- `enabled`

#### Agent 运行配置
每个 agent 配置：
- `executionMode: cli | api`
- CLI 模式：`cliName`
- API 模式：
  - `apiConnectionId`
  - `apiModel`
  - `apiTemperature`
  - `apiMaxTokens`

### 4.2 运行层
新增统一调用入口：

- `invokeAgent()`

内部按配置分发到：
- `CliProvider`
- `OpenAICompatibleProvider`

### 4.3 管理层
后台新增：
- API 连接管理卡片
- Agent 表单的 `CLI/API` 切换配置

## 5. 数据结构设计

### 5.1 Agent 配置

```ts
type AgentExecutionMode = 'cli' | 'api';
type AgentCliName = 'claude' | 'codex';

interface AIAgentConfig {
  name: string;
  avatar: string;
  personality: string;
  color: string;
  systemPrompt?: string;
  workdir?: string;

  executionMode?: AgentExecutionMode;
  cliName?: AgentCliName;

  apiConnectionId?: string;
  apiModel?: string;
  apiTemperature?: number;
  apiMaxTokens?: number;

  cli?: 'claude' | 'codex'; // 兼容旧数据
}
```

### 5.2 API Connection 配置

```ts
interface ApiConnectionConfig {
  id: string;
  name: string;
  baseURL: string;
  apiKey: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}
```

### 5.3 存储文件
- `data/agents.json`
- `data/api-connections.json`

## 6. 运行时设计

### 6.1 模块拆分

新增模块：
- `src/agent-invoker.ts`
- `src/providers/cli-provider.ts`
- `src/providers/openai-compatible-provider.ts`
- `src/api-connection-store.ts`

调整模块：
- `src/server.ts`
- `src/types.ts`
- `src/agent-config-store.ts`

### 6.2 统一返回结构

```ts
interface AgentInvokeResult {
  text: string;
  blocks: RichBlock[];
  rawText?: string;
  finishReason?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}
```

### 6.3 API 请求协议
首版统一调用：

- `POST {baseURL}/chat/completions`

请求体包含：
- `model`
- `messages`
- `temperature`
- `max_tokens`
- `stream: false`

### 6.4 Prompt 策略
首版沿用现有 prompt 拼装思路：

- `system = agent.systemPrompt`
- `user = buildPrompt(...)`

这样可最大程度保持 CLI 和 API 行为一致。

### 6.5 回调策略
- CLI 模式继续保留 MCP 回调能力
- API 模式不做 MCP/tool calling
- API 结果由服务端直接落消息

## 7. 后端接口设计

### 7.1 API Connections
新增接口：

- `GET /api/model-connections`
- `POST /api/model-connections`
- `PUT /api/model-connections/:id`
- `DELETE /api/model-connections/:id`
- `POST /api/model-connections/:id/test`

说明：
- 列表返回 key 的掩码值
- 删除前检查是否有 agent 引用
- `test` 接口用于验证连接是否可用

### 7.2 Agent 接口
保留原有：
- `GET /api/agents`
- `POST /api/agents`
- `PUT /api/agents/:name`
- `DELETE /api/agents/:name`

仅扩展 agent 字段。

## 8. 管理后台设计

### 8.1 API 连接管理
新增“API 连接管理”区域，支持：
- 新增
- 编辑
- 删除
- 测试连接
- 查看掩码 key

字段：
- 名称
- Base URL
- API Key
- 启用状态

### 8.2 Agent 表单
新增：
- 运行方式：`CLI / API`

当选择 `CLI`：
- 显示 `cliName`
- 显示 `workdir`

当选择 `API`：
- 显示 `connection`
- 显示 `model`
- 显示 `temperature`
- 显示 `maxTokens`
- workdir 隐藏或提示仅 CLI 生效

### 8.3 Agent 列表
显示运行摘要：

- CLI：`CLI / Claude`
- API：`API / 连接名 / 模型 / 参数`

## 9. 校验与兼容

### 9.1 兼容旧数据
若旧配置中只有 `cli`：
- 自动映射为 `executionMode='cli'`
- `cliName=cli`

### 9.2 校验规则

#### CLI 模式
- `cliName` 必填
- 必须为 `claude | codex`

#### API 模式
- `apiConnectionId` 必填
- `apiModel` 必填
- `apiTemperature` 可选，范围建议 `0~2`
- `apiMaxTokens` 可选，需为正整数

#### Connection
- `name` 唯一
- `baseURL` 必须合法
- `apiKey` 必填
- 被引用时禁止删除

## 10. 错误处理

### CLI 模式
沿用当前 fallback 逻辑。

### API 模式
不使用 mock 伪造正常回复。

- 配置错误：返回明确配置错误提示
- 运行时错误：返回明确失败提示
- 同时记录 operational log / verbose log

## 11. 可观测性

### operational log
增加：
- `stage=api_start`
- `stage=api_done`
- `stage=api_error`

字段建议：
- `connectionId`
- `model`
- `status`
- `durationMs`

### verbose log
记录：
- 请求 URL（脱敏）
- 模型
- 参数摘要
- 响应摘要

禁止记录：
- `apiKey`

## 12. 实施计划

### Phase 1：配置与接口
- 扩展 `types.ts`
- 扩展 `agent-config-store.ts`
- 新增 `api-connection-store.ts`
- 在 `auth-admin-server.ts` 中增加 connection CRUD

### Phase 2：运行时改造
- 新增 `agent-invoker.ts`
- 新增 `openai-compatible-provider.ts`
- 封装 CLI provider
- `server.ts` 改为统一调用入口

### Phase 3：管理后台
- 修改 `public-auth/admin.html`
- 增加 connection 管理 UI
- 增加 agent 的 CLI/API 配置 UI

### Phase 4：测试
补充：
- connection CRUD 测试
- agent 配置校验测试
- API provider 测试
- CLI/API 混跑集成测试

## 13. 风险与取舍

### 风险 1：OpenAI-compatible 实现差异
不同服务对 `/chat/completions` 兼容度存在差异。  
**取舍**：第一版只提供基础兼容，不承诺覆盖所有变体。

### 风险 2：API 模式能力弱于 CLI 模式
API 模式首版无 MCP/tool 调用能力。  
**取舍**：先解决 API 直连和可配置性，再考虑高级能力。

### 风险 3：API Key 明文存储
`api-connections.json` 存在敏感信息。  
**取舍**：首版沿用当前本地配置风格，后续再演进加密/外部密钥管理。

## 14. 结论

本方案在不破坏现有 CLI 能力的前提下，为系统引入了面向未来的统一 LLM 调用抽象，并支持管理员按 agent 维度配置 CLI/API 与模型，适合作为第一版落地方案。
