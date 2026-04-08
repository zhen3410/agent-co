# CLAUDE.md

本文件提供此多 AI 智能体聊天室项目的开发指南。

## 项目概述

多 AI 智能体聊天室，支持多个 AI 智能体与用户共同对话，每个智能体有独特的名字和性格。用户通过 `@智能体名` 召唤特定 AI，系统会记住当前对话的智能体，后续消息自动发送。支持 CLI 调用（Claude CLI / Codex CLI）和 API 调用（OpenAI 兼容接口）两种智能体后端，提供 peer 讨论模式、智能体链式调用、MCP 回调服务和轻量鉴权后台。

## 核心模块

### 入口（组合根）

| 路径 | 功能 |
|------|------|
| `src/server.ts` | 聊天服务组合根：配置、依赖装配、启动（~57 行） |
| `src/auth-admin-server.ts` | 鉴权/管理服务组合根：配置、依赖装配、启动（~69 行） |

### 聊天服务 `src/chat/`

| 路径 | 功能 |
|------|------|
| `chat/bootstrap/` | 启动装配：环境配置、安全检查、服务创建、启动横幅 |
| `chat/http/` | 路由适配层：chat-routes、auth-routes、callback-routes、ops-routes（含 ops/ 子模块）、SSE 流 |
| `chat/application/` | 领域用例：chat-service（发送/流式/block/回调）、session-service（门面模式）、chat-agent-execution、chat-dispatch-orchestrator、chat-resume-service、chat-summary-service |
| `chat/infrastructure/` | 基础设施：auth-admin-client（HTTP 鉴权代理）、chat-session-repository（内存会话存储）、dependency-log-store（依赖状态日志环形缓冲） |
| `chat/runtime/` | 运行时状态：chat-runtime（组合 session/discussion/persistence/dependencies）、chat-session-state、chat-discussion-state、chat-runtime-persistence（Redis 持久化）、chat-agent-store-runtime |

### 管理服务 `src/admin/`

| 路径 | 功能 |
|------|------|
| `admin/bootstrap/` | 启动装配：创建 HTTP 服务 |
| `admin/http/` | 路由层：auth-admin-routes、auth-admin-support-routes、admin-auth（鉴权中间件） |
| `admin/application/` | 用例：user-admin-service、agent-admin-service、group-admin-service、model-connection-admin-service、system-admin-service |
| `admin/infrastructure/` | 基础设施：user-store（JSON 文件用户存储、PBKDF2 密码哈希） |
| `admin/runtime/` | 运行时：配置、安全检查、启动横幅 |

### 智能体调用 `src/agent-invocation/`

| 路径 | 功能 |
|------|------|
| `agent-invoker.ts` | 入口：根据 executionMode 路由到 CLI 或 API |
| `invoke-target.ts` | 目标规范化：normalizeInvokeTarget、normalizeCliName |
| `invoke-cli-agent.ts` | CLI 调用：构建参数、调用 CLI provider |
| `invoke-api-agent.ts` | API 调用：加载连接配置、调用 OpenAI 兼容 provider |
| `model-connection-loader.ts` | 模型连接加载器 |

### 共享模块 `src/shared/`

| 路径 | 功能 |
|------|------|
| `shared/errors/` | 统一错误：AppError 类、错误码常量、HTTP 状态码映射 |
| `shared/http/` | HTTP 工具：body 解析、CORS、JSON 响应、静态文件服务、错误映射 |

### 提供者 `src/providers/`

| 路径 | 功能 |
|------|------|
| `providers/cli-provider.ts` | CLI 提供者：Claude/Codex CLI 子进程管理 |
| `providers/openai-compatible-provider.ts` | OpenAI 兼容 API 提供者：流式/非流式模式 |

### 根级遗留模块

| 路径 | 功能 |
|------|------|
| `agent-manager.ts` | 智能体注册与管理、@ 提及提取、@@ 链式调用解析 |
| `agent-config-store.ts` | 智能体配置持久化（active/pending 双层，支持 immediate/after_chat） |
| `api-connection-store.ts` | OpenAI 兼容 API 连接的 CRUD、凭据验证、密钥遮蔽 |
| `group-store.ts` | 智能体分组存储与验证、级联清理 |
| `claude-cli.ts` | CLI 子进程执行：流式 JSON 解析、MCP 工具注入、mock 回退 |
| `agent-co-mcp-server.ts` | MCP 回调服务：`agent_co_post_message` 和 `agent_co_get_context` |
| `types.ts` | 共享 TypeScript 类型定义 |
| `rich-extract.ts` | 从 AI 文本中提取 `cc_rich` 富文本块 |
| `rich-digest.ts` | 富文本摘要（用于 prompt，如 `[card: 标题]`） |
| `block-buffer.ts` | Block 缓冲区（Route A，内存中按会话暂存富文本块） |
| `rate-limiter.ts` | 内存滑动窗口速率限制器（1 分钟窗口） |
| `professional-agent-prompts.ts` | 专业智能体提示词构建器 |
| `professional-agent-prompts.json` | 7 个专业角色的提示词模板 |
| `agent-invoker.ts` | 3 行 re-export shim（向后兼容） |

## 模块放置约定

- **新增聊天 HTTP 端点**：优先放到 `src/chat/http/`
- **新增管理端 HTTP 端点**：优先放到 `src/admin/http/`
- **新增业务编排 / 用例逻辑**：优先放到 `src/chat/application/` 或 `src/admin/application/`
- **新增 Redis / 文件系统 / 上游 HTTP / 运行时状态逻辑**：优先放到 `src/chat/infrastructure/`、`src/chat/runtime/`、`src/admin/infrastructure/` 或 `src/admin/runtime/`
- **新增智能体调用逻辑**：优先放到 `src/agent-invocation/`
- **新增 HTTP 工具/错误处理**：优先放到 `src/shared/`
- **除非只是组合装配，否则不要把新业务逻辑继续塞回 `src/server.ts` / `src/auth-admin-server.ts`**

## 运行项目

```bash
npm run init         # 初始化 data/、logs/ 与 .env（若不存在）
set -a && source .env && set +a  # 本地开发时导出 .env；npm 脚本不会自动加载
npm run build        # 编译 TypeScript
npm run dev          # 开发模式运行 (ts-node，端口 3002)
npm run start:chat   # 运行编译后的聊天服务（端口 3002）
npm run start:auth   # 运行编译后的鉴权管理服务（端口 3003）
npm run deploy:one-click  # 一键部署（安装 Redis + systemd）
npm test             # 运行集成测试
npm run test:unit    # 运行单元测试
npm run test:fast    # 快速测试（单元 + 关键集成）
```

### 生产环境（systemd）

生产环境**必须通过 systemd 管理**，不要手动 `npm start` 或 `node dist/server.js`。

```bash
# 一键部署（安装 Redis + 注册 systemd 服务 + 启动）
npm run deploy:one-click

# 或仅注册/更新 systemd 服务
bash scripts/install-systemd.sh

# 日常运维
sudo systemctl status agent-co              # 查看服务状态
sudo systemctl restart agent-co             # 重启服务
sudo journalctl -u agent-co -f              # 查看实时日志
```

## 环境变量配置

### 聊天服务器

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 3002 | 服务端口 |
| `AGENT_CO_AUTH_ENABLED` | true | 是否启用鉴权 |
| `AUTH_ADMIN_BASE_URL` | http://127.0.0.1:3003 | 鉴权服务地址 |
| `AGENT_DATA_FILE` | data/agents.json | 智能体配置文件 |
| `AGENT_CO_VERBOSE_LOG_DIR` | logs/ai-cli-verbose | verbose 日志目录 |
| `AGENT_CO_REDIS_REQUIRED` | true | Redis 是否为强依赖 |
| `AGENT_CO_DISABLE_REDIS` | false | 完全禁用 Redis 持久化 |
| `AGENT_CO_AGENT_CHAIN_MAX_HOPS` | 4 | 默认最大链式调用跳数 |
| `AGENT_CO_CALLBACK_TOKEN` | agent-co-callback-token | 回调鉴权令牌 |
| `AUTH_ADMIN_TOKEN` | - | 管理员令牌（生产环境必须，≥ 32 字符） |
| `AGENT_CO_DEFAULT_PASSWORD` | admin123! | 默认密码兜底值（生产环境请显式覆盖为强密码） |

### Redis 配置来源（聊天服务）

聊天服务启动时默认连接 `redis://127.0.0.1:6379`，并从 `agent-co:config` 读取运行配置（例如 `chat_sessions_key`），不依赖环境变量注入 Redis 配置。

可通过以下命令修改会话存储 key：

```bash
redis-cli HSET agent-co:config chat_sessions_key agent-co:chat:sessions:v1
```

### 鉴权管理服务

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AUTH_ADMIN_PORT` | 3003 | 服务端口 |
| `AUTH_ADMIN_TOKEN` | - | 管理员令牌（生产环境必须，≥ 32 字符） |
| `AUTH_DATA_FILE` | data/users.json | 用户数据文件 |
| `AGENT_DATA_FILE` | data/agents.json | 智能体配置文件 |
| `MODEL_CONNECTION_DATA_FILE` | data/api-connections.json | API 连接文件 |
| `GROUP_DATA_FILE` | data/groups.json | 分组数据文件 |
| `AGENT_CO_DEFAULT_USER` | admin | 默认用户名 |
| `AGENT_CO_DEFAULT_PASSWORD` | admin123! | 默认密码兜底值（生产环境请显式覆盖为强密码） |

## 聊天服务 API 端点

### 核心聊天

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/chat` | POST | 发送消息（同步响应） |
| `/api/chat-stream` | POST | 发送消息（SSE 流式响应） |
| `/api/chat-resume` | POST | 恢复中断的链式任务 |
| `/api/chat-summary` | POST | 手动触发 peer 讨论总结（仅 peer 模式） |
| `/api/history` | GET | 获取历史记录和会话信息 |
| `/api/clear` | POST | 清空历史 |

### 智能体

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/agents` | GET | 获取智能体列表 |
| `/api/session-agents` | POST | 启用/禁用会话智能体 |
| `/api/groups` | GET | 获取智能体分组 |

### 会话管理

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/sessions` | POST | 创建新会话 |
| `/api/sessions/select` | POST | 切换活跃会话 |
| `/api/sessions/rename` | POST | 重命名会话 |
| `/api/sessions/delete` | POST | 删除会话（保留至少一个） |
| `/api/sessions/update` | POST | 更新会话设置（链路限制、讨论模式） |

### 工作目录

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/workdirs/options` | GET | 获取可用工作目录 |
| `/api/workdirs/select` | POST | 设置智能体工作目录 |
| `/api/system/dirs` | GET | 浏览系统目录 |

### 鉴权

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/login` | POST | 用户名+密码登录 |
| `/api/logout` | POST | 登出并清除 Cookie |
| `/api/auth-status` | GET | 查看鉴权状态 |

### 回调与区块

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/create-block` | POST | Route A: 创建富文本块 |
| `/api/block-status` | GET | 查看 BlockBuffer 状态 |
| `/api/callbacks/post-message` | POST | 智能体回调发消息（需 x-agent-co-callback-token） |
| `/api/callbacks/thread-context` | GET | 智能体获取会话历史（需鉴权） |

### 运维

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/dependencies/status` | GET | 查看依赖服务运行状态（Redis） |
| `/api/dependencies/logs` | GET | 查询依赖状态日志 |
| `/api/verbose/agents` | GET | 查看 verbose 日志智能体列表 |
| `/api/verbose/logs` | GET | 查看智能体日志文件列表 |
| `/api/verbose/log-content` | GET | 查看日志文件内容 |

## 鉴权管理服务 API 端点

### 用户管理

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/auth/verify` | POST | 验证用户凭据 |
| `/api/users` | GET | 获取用户列表（需 x-admin-token） |
| `/api/users` | POST | 创建用户（需 x-admin-token） |
| `/api/users/:name/password` | PUT | 修改用户密码（需 x-admin-token） |
| `/api/users/:name` | DELETE | 删除用户（需 x-admin-token） |

### 智能体配置

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/agents` | GET | 获取智能体配置（需 x-admin-token） |
| `/api/agents` | POST | 创建智能体（需 x-admin-token） |
| `/api/agents/:name` | PUT | 更新智能体（需 x-admin-token） |
| `/api/agents/:name/prompt` | PUT | 更新智能体提示词（需 x-admin-token） |
| `/api/agents/:name/prompt/template` | GET | 预览模板提示词（需 x-admin-token） |
| `/api/agents/:name/prompt/restore-template` | POST | 恢复模板提示词（需 x-admin-token） |
| `/api/agents/:name` | DELETE | 删除智能体（需 x-admin-token，级联清理分组引用） |
| `/api/agents/apply-pending` | POST | 应用待生效配置（需 x-admin-token） |

### 模型连接管理

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/model-connections` | GET/POST | 查询/创建 API 连接（需 x-admin-token） |
| `/api/model-connections/:id` | PUT/DELETE | 更新/删除 API 连接（需 x-admin-token） |
| `/api/model-connections/:id/test` | POST | 测试 API 连接（需 x-admin-token） |

### 分组管理

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/groups` | GET/POST | 查询/创建分组（需 x-admin-token） |
| `/api/groups/:id` | PUT/DELETE | 更新/删除分组（需 x-admin-token） |

### 系统

| 端点 | 方法 | 描述 |
|------|------|------|
| `/healthz` | GET | 健康检查 |
| `/api/system/dirs` | GET | 浏览系统目录（需 x-admin-token） |

## 智能体配置

### 默认智能体

在 `src/agent-manager.ts` 中的 `DEFAULT_AGENTS` 数组定义：

- Claude (🤖) - 技术和编程专家（CLI: claude）
- Codex架构师 (🏗️) - 资深架构师，高内聚低耦合（CLI: codex）
- Alice (👩‍💻) - 艺术和设计专家（CLI: claude）
- Bob (🧑‍💻) - 工程实践专家（CLI: claude）

### 配置结构

```typescript
interface AIAgentConfig {
  name: string;                    // 智能体名称（2-32 字符）
  avatar: string;                  // 头像（建议 1 个 emoji）
  personality: string;             // 性格描述
  color: string;                   // 显示颜色（#RRGGBB）
  systemPrompt?: string;           // 自定义系统提示词（可选）
  executionMode?: 'cli' | 'api';   // 执行模式
  cliName?: 'claude' | 'codex';    // CLI 后端（cli 模式）
  apiConnectionId?: string;        // API 连接 ID（api 模式）
  apiModel?: string;               // 模型名称（api 模式）
  apiTemperature?: number;         // 温度参数（api 模式）
  apiMaxTokens?: number;           // 最大 token 数（api 模式）
  workdir?: string;                // 工作目录
}
```

### 动态配置

智能体配置存储在 `data/agents.json`，支持热更新：

- `applyMode: "immediate"` - 立即生效
- `applyMode: "after_chat"` - 会话结束后生效

### API 连接

API 连接存储在 `data/api-connections.json`，支持任何 OpenAI 兼容端点：

- 安全凭据存储（API 密钥遮蔽）
- 连接测试端点
- 仅允许 HTTPS（或 localhost HTTP）
- 智能体通过 `apiConnectionId` 引用连接

## 智能体执行

### 双执行模式

1. **CLI 模式** — 调用 Claude CLI 或 Codex CLI 子进程，支持流式输出
2. **API 模式** — 调用 OpenAI 兼容 API 端点，可配置模型、温度、token 限制

### 链式调用

- 单 `@AgentName` — 引用/提及，不触发链式调用
- 双 `@@AgentName` — 显式链式调用
- 回调 `invokeAgents` — 智能体通过回调编程式调用其他智能体
- 可配置限制：`agentChainMaxHops`（默认 4）和 `agentChainMaxCallsPerAgent`

### Peer 讨论模式

会话支持两种讨论模式：

- **classic** — 标准单轮或链式响应
- **peer** — 多轮 peer 讨论，支持自动暂停/恢复：
  - 检测不到显式链式延续时自动暂停
  - 通过 `/api/chat-summary` 手动总结
  - 讨论状态：`active` / `paused` / `summarizing`

### MCP 回调服务

内置 MCP 服务（`src/agent-co-mcp-server.ts`）为 CLI 智能体提供工具：

- `agent_co_post_message` — 向聊天室发送消息
- `agent_co_get_context` — 获取当前会话历史

注入给 CLI 智能体的环境变量：
- `AGENT_CO_API_URL` — 聊天服务 URL
- `AGENT_CO_SESSION_ID` — 当前会话 ID
- `AGENT_CO_AGENT_NAME` — 智能体名称
- `AGENT_CO_CALLBACK_TOKEN` — 鉴权令牌

## 智能体分组

### 分组配置

分组存储在 `data/groups.json`，支持将智能体按功能分组管理。

### 分组结构

```typescript
interface AgentGroup {
  id: string;        // 唯一标识（2-20 字符，字母数字下划线）
  name: string;      // 显示名称（2-16 字符）
  icon: string;      // emoji 图标（1-2 个）
  agentNames: string[]; // 智能体名称数组
}
```

### 分组功能

- **侧边栏分组展示**：智能体按分组折叠显示
- **快速切换**：点击分组按钮切换当前会话激活的智能体
- **批量 @ 提及**：输入 `@分组名` 弹出预览，确认后展开为多个 @ 提及

## 富文本支持

AI 回复支持 `cc_rich` 代码块：

### Card 卡片

```json
{
  "kind": "card",
  "title": "标题",
  "body": "内容",
  "tone": "info" | "success" | "warning"
}
```

### Checklist 清单

```json
{
  "kind": "checklist",
  "title": "标题",
  "items": [
    { "text": "任务", "done": false },
    { "text": "已完成", "done": true }
  ]
}
```

## 双路由富文本

- **Route A**: 通过 `/api/create-block` HTTP 回调预存 blocks
- **Route B**: 从 AI 回复文本中提取 `cc_rich` 代码块
- 最终合并两种来源的 blocks（按 id 去重）

## 会话机制

### 会话记忆

系统通过 `SessionState` 记住当前对话的智能体：

- 用户 `@Claude` 后，`currentAgent` 设置为 "Claude"
- 后续消息无 @ 提及时，自动发送给当前智能体
- 清空历史时重置 `currentAgent`

### 用户隔离

- 登录用户：使用 session token 作为会话标识
- 未登录用户：使用 IP 地址作为会话标识
- 每个用户有独立的聊天历史和智能体状态

### 多会话

- 用户可创建、重命名、切换和删除会话
- 会话设置（链路限制、讨论模式）按会话独立
- 智能体工作目录按会话按智能体独立配置

## 流式响应 (SSE)

`/api/chat-stream` 端点支持 Server-Sent Events：

| 事件 | 数据 |
|------|------|
| `user_message` | 用户消息对象 |
| `agent_thinking` | `{ agent: string }` |
| `agent_delta` | `{ agent: string, delta: string }` |
| `agent_message` | AI 消息对象 |
| `notice` | `{ notice: string }` |
| `done` | `{ currentAgent: string \| null }` |
| `error` | `{ error: string }` |

## 安全特性

### 速率限制

- 全局请求：每分钟 100 次
- 登录尝试：每分钟 5 次

### 生产环境检查

- `AUTH_ADMIN_TOKEN` 必须 ≥ 32 字符
- `AGENT_CO_DEFAULT_PASSWORD` 必须 ≥ 12 字符，包含大小写字母、数字、特殊字符

### 回调鉴权

- 回调端点需要 `x-agent-co-callback-token` 或 `Authorization: Bearer` 头
- 令牌通过 `AGENT_CO_CALLBACK_TOKEN` 配置

## iOS / PWA

- `public/manifest.json` + `public/service-worker.js` 提供基础 PWA 能力
- iOS Safari 可通过「添加到主屏幕」安装为类 App 体验
- 已添加 `apple-touch-icon`（SVG）与 iOS web app meta 标签

## Verbose 日志

CLI 智能体的详细输出会记录到 `AGENT_CO_VERBOSE_LOG_DIR`（默认 `logs/ai-cli-verbose`）：

- 文件命名格式：`{timestamp}-{cliName}-{agentName}.log`
- 包含 stdout、stderr、meta 信息
- 可通过 `/api/verbose/*` 端点查询

## 测试

- **单元测试** `tests/unit/`：agent-invocation、app-error、session-discussion-rules
- **集成测试** `tests/integration/`：聊天流程、会话管理、服务边界、鉴权后台、回调链路、MCP 工具、前端绑定

```bash
npm test           # 运行所有集成测试
npm run test:unit  # 运行单元测试
npm run test:fast  # 快速测试（单元 + 关键集成）
```
