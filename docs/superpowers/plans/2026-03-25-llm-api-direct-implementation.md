# LLM API 直连 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为多 agent 聊天系统增加可按 agent 配置的 API 直连能力，支持管理员选择 CLI/API、全局 OpenAI-compatible connection、模型、temperature 与 maxTokens。

**Architecture:** 在现有 CLI 调用链之外引入统一的 agent 调用入口与 provider 抽象。配置层拆成 agent 运行配置与全局 API connection 两层；运行层按 agent 的 executionMode 分发到 CLI provider 或 OpenAI-compatible provider；管理后台新增 connection 管理区和 agent 表单切换逻辑。

**Tech Stack:** TypeScript、Node.js 内置 http/fetch、现有自定义管理后台 HTML/JS、Node test runner (`node:test`)

---

## File Map

### Existing files to modify
- `src/types.ts` — 扩展 agent 执行方式、API connection、统一调用结果等类型
- `src/agent-config-store.ts` — agent 新字段校验、normalize、旧 `cli` 字段兼容迁移
- `src/auth-admin-server.ts` — 新增 API connection CRUD/test 接口，并让 agent 接口接受新字段
- `src/server.ts` — `runAgentTask()` 从直接调 CLI 改为统一调 `invokeAgent()`
- `src/claude-cli.ts` — 复用现有 CLI 调用逻辑，必要时导出更中性的 provider 结果
- `public-auth/admin.html` — 新增 API connection 管理 UI，扩展 agent 表单与列表展示
- `tests/integration/auth-admin-server.integration.test.js` — 覆盖 connection CRUD 与 agent 新字段
- `tests/integration/admin-page-agent-prompt.integration.test.js` — 覆盖后台页面新增字段与交互元素
- `tests/integration/chat-server.integration.test.js` — 覆盖 API provider 直连与 CLI/API 混跑
- `tests/integration/helpers/chat-server-fixture.js` — 如需注入 API connection 文件路径或测试桩服务地址

### New files to create
- `src/api-connection-store.ts` — API connection 的加载、保存、校验、脱敏、删除引用检查辅助
- `src/agent-invoker.ts` — 统一调用入口
- `src/providers/cli-provider.ts` — 对现有 CLI 逻辑的 provider 封装
- `src/providers/openai-compatible-provider.ts` — OpenAI-compatible `/chat/completions` 调用
- `tests/integration/openai-compatible-provider.integration.test.js` 或并入现有 chat 集成测试 — API provider 行为覆盖
- `data/api-connections.json` — 运行时生成，不提交真实密钥

---

### Task 1: 扩展核心类型并定义新配置结构

**Files:**
- Modify: `src/types.ts`
- Test: `tests/integration/auth-admin-server.integration.test.js`

- [ ] **Step 1: 在 `src/types.ts` 中增加执行方式与 connection 类型**

```ts
export type AgentExecutionMode = 'cli' | 'api';
export type AgentCliName = 'claude' | 'codex';

export interface ApiConnectionConfig {
  id: string;
  name: string;
  baseURL: string;
  apiKey: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ApiConnectionSummary {
  id: string;
  name: string;
  baseURL: string;
  apiKeyMasked: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 2: 扩展 `AIAgent` 与 `AIAgentConfig`**

```ts
executionMode?: AgentExecutionMode;
cliName?: AgentCliName;
apiConnectionId?: string;
apiModel?: string;
apiTemperature?: number;
apiMaxTokens?: number;
cli?: 'claude' | 'codex'; // legacy
```

- [ ] **Step 3: 增加统一 provider 结果类型**

```ts
export interface AgentInvokeResult {
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

- [ ] **Step 4: 构建以验证类型改动后的编译错误范围**

Run: `npm run build`
Expected: 失败，提示依赖这些新类型的文件尚未适配

- [x] **Step 5: 提交**

```bash
git add src/types.ts
git commit -m "refactor: extend agent and api connection types"
```

### Task 2: 实现 API connection 存储与校验

**Files:**
- Create: `src/api-connection-store.ts`
- Modify: `src/agent-config-store.ts`
- Test: `tests/integration/auth-admin-server.integration.test.js`

- [ ] **Step 1: 为 connection store 写失败用例或集成断言草稿**

在 `auth-admin-server.integration.test.js` 预留以下行为：
- 创建 connection 成功
- 重名失败
- 非法 URL 失败
- 返回列表时 key 被脱敏
- 被 agent 引用时删除失败

- [ ] **Step 2: 新建 `src/api-connection-store.ts` 实现基础能力**

至少提供：
- `loadApiConnectionStore(filePath)`
- `saveApiConnectionStore(filePath, store)`
- `validateApiConnectionConfig(config)`
- `normalizeApiConnectionConfig(input)`
- `maskApiKey(apiKey)`

- [ ] **Step 3: 在 `src/agent-config-store.ts` 增加 agent 新字段 normalize 与校验**

关键逻辑：
- 若无 `executionMode` 且有旧 `cli`，自动映射为 `cli`
- `executionMode='cli'` 时要求 `cliName`
- `executionMode='api'` 时要求 `apiConnectionId` 与 `apiModel`
- `apiTemperature` 校验 `0~2`
- `apiMaxTokens` 校验正整数

- [ ] **Step 4: 再次构建**

Run: `npm run build`
Expected: 仍失败，但 store 与类型相关错误明显减少

- [ ] **Step 5: 提交**

```bash
git add src/api-connection-store.ts src/agent-config-store.ts
git commit -m "feat: add api connection store and agent execution validation"
```

### Task 3: 扩展管理端后端接口以支持 connection CRUD/test

**Files:**
- Modify: `src/auth-admin-server.ts`
- Modify: `src/types.ts`（如需补充请求/响应类型）
- Test: `tests/integration/auth-admin-server.integration.test.js`

- [ ] **Step 1: 先写/扩展集成测试**

新增行为测试：
- `GET /api/model-connections` 返回空/已有列表
- `POST /api/model-connections` 可创建
- `PUT /api/model-connections/:id` 可更新且不回显明文 key
- `DELETE /api/model-connections/:id` 在未引用时成功
- `DELETE /api/model-connections/:id` 在被 agent 引用时返回 400/409
- `POST /api/model-connections/:id/test` 对测试桩返回成功/失败
- agent 的 `POST /api/agents` / `PUT /api/agents/:name` 接受 API 模式字段

- [ ] **Step 2: 在 `src/auth-admin-server.ts` 增加 connection 路由解析与鉴权处理**

实现路由：
- `GET /api/model-connections`
- `POST /api/model-connections`
- `PUT /api/model-connections/:id`
- `DELETE /api/model-connections/:id`
- `POST /api/model-connections/:id/test`

- [ ] **Step 3: 实现测试连接逻辑**

推荐逻辑：
1. `GET {baseURL}/models`
2. 若返回 2xx 则成功
3. 失败时返回状态码、错误摘要

不要在日志中打印明文 `apiKey`。

- [ ] **Step 4: 适配 agent 接口新字段透传与校验报错**

确保管理接口保存与读取 `executionMode` / `cliName` / `api*` 字段。

- [ ] **Step 5: 运行相关测试**

Run: `npm test -- tests/integration/auth-admin-server.integration.test.js`
Expected: 新增 connection 与 agent 配置测试通过

- [x] **Step 6: 提交**

```bash
git add src/auth-admin-server.ts tests/integration/auth-admin-server.integration.test.js
git commit -m "feat: add admin api for model connections"
```

### Task 4: 引入统一 agent 调用入口与 CLI provider 封装

**Files:**
- Create: `src/agent-invoker.ts`
- Create: `src/providers/cli-provider.ts`
- Modify: `src/claude-cli.ts`
- Test: `tests/integration/chat-server.integration.test.js`

- [ ] **Step 1: 定义 provider 调用接口**

```ts
export interface InvokeAgentParams {
  userMessage: string;
  agent: AIAgent;
  history: Message[];
  includeHistory: boolean;
  extraEnv?: Record<string, string>;
}
```

- [ ] **Step 2: 新建 `src/providers/cli-provider.ts` 包装现有 CLI 调用**

该 provider 应直接复用 `callClaudeCLI()`，并把返回值转成 `AgentInvokeResult`。

- [ ] **Step 3: 新建 `src/agent-invoker.ts`**

核心逻辑：
- 根据 agent normalize 后的 `executionMode`
- `cli` -> 调 CLI provider
- `api` -> 先留待 Task 5 接入 API provider

- [ ] **Step 4: 调整 `src/claude-cli.ts`，避免命名过度绑定 Claude**

最小改法可以先保留文件名不动，只导出被 provider 复用的稳定接口。

- [ ] **Step 5: 构建**

Run: `npm run build`
Expected: 失败点收敛到尚未实现的 API provider 或 `server.ts` 接线处

- [ ] **Step 6: 提交**

```bash
git add src/agent-invoker.ts src/providers/cli-provider.ts src/claude-cli.ts
git commit -m "refactor: add unified agent invoker and cli provider"
```

### Task 5: 实现 OpenAI-compatible provider

**Files:**
- Create: `src/providers/openai-compatible-provider.ts`
- Modify: `src/agent-invoker.ts`
- Test: `tests/integration/chat-server.integration.test.js`

- [ ] **Step 1: 先写 API provider 集成测试场景**

建议用本地 HTTP 测试桩覆盖：
- 正常返回 `choices[0].message.content`
- 401/403 返回明确失败消息
- 429/500 返回明确失败消息
- 返回体不兼容时返回可诊断错误

- [ ] **Step 2: 实现 provider 的请求拼装**

请求示例：
```json
{
  "model": "gpt-4.1",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "temperature": 0.7,
  "max_tokens": 2000,
  "stream": false
}
```

- [ ] **Step 3: 解析响应并转成 `AgentInvokeResult`**

需要提取：
- 文本内容
- usage（若有）
- finishReason（若有）
- `extractRichBlocks(text)`

- [ ] **Step 4: 在 `src/agent-invoker.ts` 接入 API provider**

需要：
- 读取 `apiConnectionId`
- 从 connection store 找到对应连接
- 缺配置时抛出明确错误

- [ ] **Step 5: 运行针对 provider 的测试**

Run: `npm test -- tests/integration/chat-server.integration.test.js`
Expected: API 模式场景通过，失败时返回明确错误文本

- [ ] **Step 6: 提交**

```bash
git add src/providers/openai-compatible-provider.ts src/agent-invoker.ts tests/integration/chat-server.integration.test.js
git commit -m "feat: add openai compatible agent provider"
```

### Task 6: 将聊天执行链切换到统一 invoker

**Files:**
- Modify: `src/server.ts`
- Modify: `src/types.ts`（如需）
- Test: `tests/integration/chat-server.integration.test.js`

- [x] **Step 1: 修改 `runAgentTask()` 中的执行入口**

将：
```ts
const result = await callClaudeCLI(...)
```
替换为：
```ts
const result = await invokeAgent(...)
```

- [x] **Step 2: 保持现有 callbackReplies 逻辑只对 CLI 生效也能兼容 API**

要求：
- CLI 模式保持现有行为
- API 模式通常无 callbackReplies，但仍能直接显示 provider 返回文本

- [x] **Step 3: 调整日志字段**

新增或区分：
- `stage=api_start/api_done/api_error`
- 保留 CLI 原有日志

- [x] **Step 4: 运行聊天集成测试**

Run: `npm test -- tests/integration/chat-server.integration.test.js`
Expected: 现有 CLI 场景不回归，新增 API 场景通过

- [ ] **Step 5: 提交**

```bash
git add src/server.ts tests/integration/chat-server.integration.test.js
git commit -m "refactor: route chat execution through agent invoker"
```

### Task 7: 扩展管理后台页面以支持 connection 与 API 模式 agent

**Files:**
- Modify: `public-auth/admin.html`
- Test: `tests/integration/admin-page-agent-prompt.integration.test.js`

- [x] **Step 1: 先补页面结构断言测试**

新增断言：
- 存在 connection 管理区域
- agent 表单存在 `executionMode`
- API 模式存在 `connection/model/temperature/maxTokens`
- CLI/API 切换时对应字段出现或隐藏

- [x] **Step 2: 在页面中新增 connection 管理卡片**

包含：
- 列表容器
- 新增/编辑表单
- 测试连接按钮

- [x] **Step 3: 扩展 agent 表单与读取/回填逻辑**

要求：
- `CLI` 时显示 `cliName + workdir`
- `API` 时显示 `connection + model + temperature + maxTokens`
- 编辑 agent 时回填对应配置

- [x] **Step 4: 更新 agent 列表展示摘要**

示例：
- `CLI · CLAUDE`
- `API · OpenAI Proxy · gpt-4.1`

- [x] **Step 5: 运行页面相关测试**

Run: `npm test -- tests/integration/admin-page-agent-prompt.integration.test.js`
Expected: 页面结构断言通过

- [ ] **Step 6: 提交**

```bash
git add public-auth/admin.html tests/integration/admin-page-agent-prompt.integration.test.js
git commit -m "feat: add admin ui for api connections and agent api mode"
```

### Task 8: 全量验证与文档收尾

**Files:**
- Modify: `docs/superpowers/specs/2026-03-25-llm-api-direct-design.md`（若实现与设计有偏差则回写）
- Test: `tests/integration/*.integration.test.js`

- [ ] **Step 1: 运行全量构建与测试**

Run: `npm run build && npm test`
Expected: 全部通过

> 2026-03-27 追踪：已在隔离 worktree 中执行 `npm run build && timeout 180s npm test`。`build` 成功，集成测试在超时前已连续通过到第 65 个子测试，但未在时限内完整跑完，因此此项暂不勾选为完成。

- [ ] **Step 2: 人工回归关键路径**

至少验证：
- CLI agent 仍正常
- API agent 可正常回复
- 管理员能新增 connection 并绑定给 agent
- 被引用 connection 无法删除

- [ ] **Step 3: 若实现偏离 spec，则更新 spec**

仅记录实际差异，不做无关改写。

- [ ] **Step 4: 提交**

```bash
git add docs/superpowers/specs/2026-03-25-llm-api-direct-design.md
git commit -m "docs: finalize llm api direct implementation plan alignment"
```
