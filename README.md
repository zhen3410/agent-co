<p align="center">
  <img src="public/logo.svg" alt="agent-co" width="480" />
</p>

<h1 align="center">agent-co</h1>

<p align="center">
  <a href="README_EN.md">English</a> | <b>中文</b>
</p>

---

基于 Node.js 和 TypeScript 的自托管多智能体聊天室。支持 CLI 调用（Claude CLI / Codex CLI）和 API 调用（OpenAI 兼容接口）两种智能体后端，提供按会话管理智能体、peer 讨论模式、轻量鉴权后台、PWA 支持，以及基于回调的集成流程。

### 项目亮点

- **多智能体对话**，内置 Claude、Codex 架构师、Alice、Bob 等智能体。
- **双执行模式** — 智能体可通过 CLI（Claude/Codex CLI）或 API（OpenAI 兼容接口）运行，支持配置模型、温度和 token 限制。
- **Peer 讨论模式** — 智能体可参与多轮 peer 讨论，支持链式调度、暂停/恢复和手动总结。
- **会话级隔离**，支持每个会话独立的消息历史、启用智能体列表、当前对话目标和可配置的链路限制。
- **智能体链式调用** — 智能体可通过 `@@智能体名` 语法或回调 `invokeAgents` 触发其他智能体，支持配置最大跳数和单智能体调用上限。
- **智能体分组** — 将智能体按功能分组展示，支持 `@分组名` 批量提及。
- **API 连接管理** — 创建、测试和管理 OpenAI 兼容的 API 连接，安全存储凭据。
- **聚焦式聊天界面**，同时兼顾桌面端与移动端，顶部控制栏吸顶，消息列表独立滚动。
- **独立鉴权与管理服务**，用于登录、用户管理、智能体配置、提示词更新、工作目录设置和模型连接管理。
- **富文本区块** — 智能体可通过 `cc_rich` 代码块或 HTTP 回调渲染卡片和清单。
- **PWA 前端支持**，可在移动端作为主屏应用安装。
- **运维观察页面**，可查看 CLI 详细日志、依赖状态和依赖日志查询。
- **MCP 回调服务** — 智能体可通过 MCP 工具主动发送消息和读取会话上下文。
- **集成测试覆盖**，包括聊天流程、鉴权后台、回调链路和前端绑定行为。

### 架构概览

当前仓库包含两个 HTTP 服务：

- **聊天服务**：`src/server.ts`，默认端口 `3002`
- **鉴权管理服务**：`src/auth-admin-server.ts`，默认端口 `3003`

聊天服务负责主聊天 UI，当前由 `dist/frontend/chat.html` 构建产物提供（路由 `/`、`/index.html`、`/chat.html`）。
鉴权管理服务负责后台管理页，当前由 `dist/frontend/admin.html` 构建产物提供（路由 `/`、`/index.html`、`/admin.html`）。

#### 聊天读写架构

- **HTTP 命令入口**：`POST /api/chat`、`POST /api/chat-resume`、`POST /api/chat-summary`
- **Append-only event log**：会话事件是单一事实来源
- **Projection 查询**：
  - `GET /api/sessions/:id/events`
  - `GET /api/sessions/:id/timeline`
  - `GET /api/sessions/:id/call-graph`
- **WebSocket 展示出口**：`/api/ws/session-events`
- **前端渲染原则**：页面只展示 projection，智能体输出统一先落到事件流，再由 **WebSocket 作为“失效通知/缓冲通道”** + **HTTP timeline 权威刷新** 驱动界面；断线重连后优先使用 `timeline?afterSeq=` 做增量补偿，异常则回退全量刷新。
- **文档**：
  - 运行时事件模型与同步契约：`docs/architecture/event-log-chat-runtime.md`
  - 长会话演进策略（分页/归档/API 边界）：`docs/architecture/event-log-long-session-strategy.md`

### 快速开始

#### 1. 安装依赖

```bash
npm install
```

#### 2. 初始化本地目录

```bash
npm run init
```

这个脚本会准备本地运行所需目录（例如 `data/` 和详细日志目录）；如果 `.env` 不存在，还会基于 `.env.example` 创建它。注意 npm 启动脚本**不会自动加载** `.env`，因此本地开发前建议先导出环境变量：

```bash
set -a
source .env
set +a
```

#### 3. 构建

```bash
npm run build
```

> `npm run build` 会先编译后端 TypeScript，再构建 React + Vite 多页面前端；聊天页、管理页与运维页静态壳都会输出到 `dist/frontend/`。

#### 3.1 前端本地开发循环

```bash
npm run dev:frontend
```

- `npm run dev:frontend` 会启动 Vite，用于独立调试 React 多页面前端。
- Node 聊天/管理服务在本地与生产环境中都只读取 `dist/frontend/` 下的静态壳。
- 只要修改了 `frontend/`，就需要重新执行 `npm run build`，然后再刷新 `/`、`/admin.html`、`/deps-monitor.html` 或 `/verbose-logs.html`。
- 如果 `dist/frontend` 缺失，服务会返回 `500`，错误信息包含“前端构建产物缺失”。回滚时必须一并恢复匹配版本的 `dist/frontend`，或在切回旧代码后重新执行 `npm run build`。

### 4. Start services / 启动服务

**Production** — use systemd (recommended):

**生产环境**使用 systemd 管理（推荐）：

```bash
npm run deploy:one-click  # 一键部署（安装 Redis + 注册 systemd 服务 + 启动）
```

Or register systemd services only:

或仅注册 systemd 服务：

```bash
bash scripts/install-systemd.sh
```

Day-to-day operations:

日常运维命令：

```bash
sudo systemctl status agent-co              # 查看服务状态
sudo systemctl restart agent-co             # 重启服务
sudo journalctl -u agent-co -f              # 实时日志
```

**Local development** — run directly:

**本地开发**可直接运行：

```bash
npm run dev          # 开发模式（ts-node）
npm run start:chat   # 编译后的聊天服务
npm run start:auth   # 编译后的鉴权管理服务
```

默认地址：

- 聊天页：`http://127.0.0.1:3002`
- 管理页：`http://127.0.0.1:3003`

### 默认开发行为

- 默认开启鉴权，除非显式设置 `AGENT_CO_AUTH_ENABLED=false`。
- 聊天服务默认通过 `AUTH_ADMIN_BASE_URL` 访问鉴权后台，默认值是 `http://127.0.0.1:3003`。
- 本地开发时 Redis 可以不是强依赖；设置 `AGENT_CO_REDIS_REQUIRED=false` 后，即使 Redis 不可用也可以继续开发。也可以通过 `AGENT_CO_DISABLE_REDIS=true` 完全禁用 Redis。
- 如果鉴权数据文件不存在，管理服务会在首次启动时自动创建默认用户。

默认开发账号：

- 用户名：`admin`
- 密码：`admin123!`

### 常用脚本

```bash
npm run init            # 初始化本地目录
npm run build           # 先编译后端，再生成 dist/frontend 多页面前端产物
npm run dev             # 开发模式运行聊天服务（读取 dist/frontend）
npm run start:chat      # 运行编译后的聊天服务
npm run start:auth      # 运行编译后的鉴权管理服务
npm run dev:frontend    # 启动 React/Vite 本地前端开发服务器
npm test                # 运行集成测试
npm run test:unit       # 运行单元测试
npm run test:fast       # 快速测试（单元 + 关键集成）
npm run deploy:one-click  # 一键部署（安装 Redis + systemd）
```

### Docker Compose

项目包含单镜像、多容器的 Docker Compose 方案：

```bash
docker compose up --build
```

启动后：

- 聊天服务：`http://localhost:3002`
- 鉴权管理服务：`http://localhost:3003`
- Redis：`localhost:6379`

Compose 会复用同一个应用镜像启动 `chat` 与 `auth`，并使用独立 `redis` 容器。容器内聊天服务通过 `AUTH_ADMIN_BASE_URL=http://auth:3003` 访问鉴权服务，并通过 `REDIS_URL=redis://redis:6379` 连接 Redis。

### 目录结构

```text
src/
  server.ts                聊天服务组合根（~57 行）
  auth-admin-server.ts     鉴权管理服务组合根（~69 行）
  agent-invoker.ts         向后兼容 re-export shim
  agent-manager.ts         智能体定义、@ 提及解析、@@ 链式调用解析
  agent-config-store.ts    智能体持久化，生效模式（immediate / after_chat）
  api-connection-store.ts  OpenAI 兼容 API 连接 CRUD 与验证
  group-store.ts           智能体分组存储与验证
  claude-cli.ts            CLI 子进程管理、流式 JSON、MCP 注入
  block-buffer.ts          Route A 富文本块缓冲
  rich-extract.ts          从模型输出中提取 cc_rich 块
  rich-digest.ts           富文本摘要辅助（用于 prompt）
  rate-limiter.ts          内存速率限制
  agent-co-mcp-server.ts   MCP 回调服务
  professional-agent-prompts.ts   专业智能体提示词构建器
  professional-agent-prompts.json 7 个专业角色提示词模板
  types.ts                 共享 TypeScript 类型定义
  chat/
    bootstrap/             聊天服务启动装配
    http/                  聊天/鉴权/回调/运维路由适配层
      ops/                 依赖状态、系统目录、verbose 日志子路由
    application/           聊天、会话、鉴权领域用例
    infrastructure/        鉴权代理、会话存储、依赖日志
    runtime/               聊天运行时状态、会话状态、讨论状态、持久化
  admin/
    bootstrap/             管理服务启动装配
    http/                  管理端路由与鉴权中间件
    application/           用户/智能体/分组/模型/系统管理用例
    infrastructure/        用户持久化存储（JSON + PBKDF2）
    runtime/               管理运行时配置与安全检查
  agent-invocation/        智能体调度路由（CLI vs API）、目标规范化
  shared/
    errors/                AppError 类、错误码、HTTP 状态映射
    http/                  共享 HTTP 工具：body、cors、json、静态文件、错误映射
  providers/               CLI / OpenAI 兼容智能体提供者
public/                    运行时共享静态资源（PWA / icon / 样式等）
data/                      运行时数据目录
logs/                      运行时日志（含 ai-cli-verbose/）
scripts/                   启动与部署脚本
systemd/                   systemd 服务配置示例
tests/unit/                单元测试
tests/integration/         集成测试
dist/                      编译输出（含 `dist/frontend/*.html` 多页面前端产物）
```

#### 模块放置约定

- **聊天路由**放到 `src/chat/http/`
- **管理端路由**放到 `src/admin/http/`
- **业务编排 / 用例逻辑**放到 `src/chat/application/` 或 `src/admin/application/`
- **基础设施集成**（文件系统、Redis、上游 HTTP、持久化）放到 `src/chat/infrastructure/`、`src/chat/runtime/`、`src/admin/infrastructure/` 或 `src/admin/runtime/`
- **智能体调用逻辑**放到 `src/agent-invocation/`
- **HTTP 工具/错误处理**放到 `src/shared/`
- 保持 `src/server.ts` 与 `src/auth-admin-server.ts` 为精简启动入口

### 环境变量配置

#### 聊天服务

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3002` | 服务端口 |
| `AGENT_CO_AUTH_ENABLED` | `true` | 是否启用鉴权 |
| `AUTH_ADMIN_BASE_URL` | `http://127.0.0.1:3003` | 鉴权管理服务地址 |
| `AGENT_DATA_FILE` | `data/agents.json` | 智能体配置文件路径 |
| `AGENT_CO_VERBOSE_LOG_DIR` | `logs/ai-cli-verbose` | 详细日志目录 |
| `AGENT_CO_REDIS_REQUIRED` | `true` | Redis 是否为强依赖 |
| `AGENT_CO_DISABLE_REDIS` | `false` | 完全禁用 Redis 持久化 |
| `AGENT_CO_AGENT_CHAIN_MAX_HOPS` | `4` | 默认最大链式调用跳数 |
| `AGENT_CO_CALLBACK_TOKEN` | `agent-co-callback-token` | 回调鉴权令牌 |

#### 鉴权管理服务

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AUTH_ADMIN_PORT` | `3003` | 服务端口 |
| `AUTH_ADMIN_TOKEN` | - | 管理员令牌（生产环境必须，≥ 32 字符） |
| `AUTH_DATA_FILE` | `data/users.json` | 用户数据文件路径 |
| `AGENT_DATA_FILE` | `data/agents.json` | 智能体配置文件路径 |
| `MODEL_CONNECTION_DATA_FILE` | `data/api-connections.json` | API 连接文件路径 |
| `GROUP_DATA_FILE` | `data/groups.json` | 分组数据文件路径 |
| `AGENT_CO_DEFAULT_USER` | `admin` | 默认用户名 |
| `AGENT_CO_DEFAULT_PASSWORD` | `admin123!` | 默认密码（生产环境请覆盖为强密码） |

#### Redis 配置

聊天服务启动时默认连接 `redis://127.0.0.1:6379`，并从 `agent-co:config` 读取运行配置。

```bash
redis-cli HSET agent-co:config chat_sessions_key agent-co:chat:sessions:v1
```

### 聊天服务 API 端点

#### 核心聊天

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/chat` | POST | 发送消息命令（accepted 响应，异步执行） |
| `/api/chat-resume` | POST | 恢复中断的链式任务 |
| `/api/chat-summary` | POST | 手动触发 peer 讨论总结（仅 peer 模式） |
| `/api/history` | GET | 获取聊天历史和会话信息 |
| `/api/clear` | POST | 清空聊天历史 |

#### 事件与投影

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/sessions/:id/events` | GET | 查询原始会话事件（支持 `afterSeq`） |
| `/api/sessions/:id/timeline` | GET | 查询会话时间线投影 |
| `/api/sessions/:id/call-graph` | GET | 查询会话调用图投影 |
| `/api/sessions/:id/sync-status` | GET | 查询会话事件/时间线同步诊断（观测用途，不作为客户端权威真相） |
| `/api/ws/session-events` | WS | 订阅会话事件推送与重连追赶 |

#### 智能体

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/agents` | GET | 获取智能体列表 |
| `/api/session-agents` | POST | 启用/禁用会话智能体 |
| `/api/groups` | GET | 获取智能体分组 |

#### 会话管理

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/sessions` | POST | 创建新会话 |
| `/api/sessions/select` | POST | 切换活跃会话 |
| `/api/sessions/rename` | POST | 重命名会话 |
| `/api/sessions/delete` | POST | 删除会话 |
| `/api/sessions/update` | POST | 更新会话设置（链路限制、讨论模式） |

#### 工作目录

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/workdirs/options` | GET | 获取可用工作目录 |
| `/api/workdirs/select` | POST | 设置智能体工作目录 |
| `/api/system/dirs` | GET | 浏览系统目录 |

#### 鉴权

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/login` | POST | 用户名+密码登录 |
| `/api/logout` | POST | 登出并清除 Cookie |
| `/api/auth-status` | GET | 查看鉴权状态 |

#### 回调与区块

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/create-block` | POST | Route A：创建富文本块 |
| `/api/block-status` | GET | 查看 BlockBuffer 状态 |
| `/api/callbacks/post-message` | POST | 智能体通过回调发送消息 |
| `/api/callbacks/thread-context` | GET | 智能体获取会话历史 |

#### 运维

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/dependencies/status` | GET | 查看依赖健康状态（Redis） |
| `/api/dependencies/logs` | GET | 查询依赖状态日志 |
| `/api/verbose/agents` | GET | 查看 verbose 日志智能体列表 |
| `/api/verbose/logs` | GET | 查看智能体日志文件列表 |
| `/api/verbose/log-content` | GET | 查看日志文件内容 |

### 鉴权管理服务 API 端点

#### 用户管理

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/auth/verify` | POST | 验证用户凭据 |
| `/api/users` | GET | 获取用户列表（需 x-admin-token） |
| `/api/users` | POST | 创建用户（需 x-admin-token） |
| `/api/users/:name/password` | PUT | 修改用户密码（需 x-admin-token） |
| `/api/users/:name` | DELETE | 删除用户（需 x-admin-token） |

#### 智能体配置

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/agents` | GET | 获取智能体配置（需 x-admin-token） |
| `/api/agents` | POST | 创建智能体（需 x-admin-token） |
| `/api/agents/:name` | PUT | 更新智能体（需 x-admin-token） |
| `/api/agents/:name/prompt` | PUT | 更新智能体提示词（需 x-admin-token） |
| `/api/agents/:name/prompt/template` | GET | 预览模板提示词（需 x-admin-token） |
| `/api/agents/:name/prompt/restore-template` | POST | 恢复模板提示词（需 x-admin-token） |
| `/api/agents/:name` | DELETE | 删除智能体（需 x-admin-token） |
| `/api/agents/apply-pending` | POST | 应用待生效配置（需 x-admin-token） |

#### 模型连接管理

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/model-connections` | GET/POST | 查询/创建 API 连接（需 x-admin-token） |
| `/api/model-connections/:id` | PUT/DELETE | 更新/删除 API 连接（需 x-admin-token） |
| `/api/model-connections/:id/test` | POST | 测试 API 连接（需 x-admin-token） |

#### 分组管理

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/groups` | GET/POST | 查询/创建分组（需 x-admin-token） |
| `/api/groups/:id` | PUT/DELETE | 更新/删除分组（需 x-admin-token） |

#### 系统

| 端点 | 方法 | 说明 |
|------|------|------|
| `/healthz` | GET | 健康检查 |
| `/api/system/dirs` | GET | 浏览系统目录（需 x-admin-token） |

### 智能体配置

#### 默认智能体

定义在 `src/agent-manager.ts`：

- Claude (🤖) — 技术和编程专家
- Codex架构师 (🏗️) — 资深架构师，高内聚低耦合
- Alice (👩‍💻) — 艺术和设计专家
- Bob (🧑‍💻) — 工程实践专家

#### 配置结构

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

#### 动态配置

智能体配置存储在 `data/agents.json`，支持热更新：

- `applyMode: "immediate"` — 立即生效
- `applyMode: "after_chat"` — 会话结束后生效

`data/agents.json` 的运行时存储结构还会包含以下字段，用于正确处理默认内置智能体的删除与延迟生效：

- `removedDefaultAgentNames` — 当前已生效配置里，被明确删除的默认内置智能体名称列表
- `pendingRemovedDefaultAgentNames` — 待生效配置里，被明确删除的默认内置智能体名称列表

这样做的目的是：

- 默认智能体仍会在空配置初始化时自动补齐
- 但一旦某个默认智能体被删除，就不会在重新加载后被自动补回
- `after_chat` 删除时，应用前仍按当前生效配置展示，应用后才真正移除

#### 智能体分组

分组存储在 `data/groups.json`：

```typescript
interface AgentGroup {
  id: string;          // 唯一标识（2-20 字符，字母数字下划线）
  name: string;        // 显示名称（2-16 字符）
  icon: string;        // emoji 图标（1-2 个）
  agentNames: string[]; // 智能体名称数组
}
```

- **侧边栏分组展示**：智能体按分组折叠显示
- **批量提及**：输入 `@分组名` 提及该分组所有智能体

#### API 连接

API 连接存储在 `data/api-connections.json`，支持任何 OpenAI 兼容端点：

- 安全凭据存储（API 密钥遮蔽）
- 连接测试端点
- 仅允许 HTTPS（或 localhost HTTP）
- 智能体通过 `apiConnectionId` 引用连接

### 智能体执行

#### 双执行模式

1. **CLI 模式** — 调用 Claude CLI 或 Codex CLI 子进程
2. **API 模式** — 调用 OpenAI 兼容 API 端点，可配置模型、温度、token 限制

#### 链式调用

- 单 `@智能体名` — 引用/提及，不触发链式调用
- 双 `@@智能体名` — 显式链式调用
- 回调 `invokeAgents` — 智能体通过回调编程式调用其他智能体
- 可配置限制：`agentChainMaxHops`（默认 4）和 `agentChainMaxCallsPerAgent`

#### Peer 讨论模式

会话支持两种讨论模式：

- **classic** — 标准单轮或链式响应
- **peer** — 多轮 peer 讨论，支持自动暂停/恢复：
  - 检测不到显式链式延续时自动暂停
  - 通过 `/api/chat-summary` 手动总结
  - 讨论状态：`active` / `paused` / `summarizing`

#### MCP 回调服务

内置 MCP 服务（`src/agent-co-mcp-server.ts`）为 CLI 智能体提供工具：

- `agent_co_post_message` — 向聊天室发送消息
- `agent_co_get_context` — 获取当前会话历史

注入给 CLI 智能体的环境变量：
- `AGENT_CO_API_URL` — 聊天服务 URL
- `AGENT_CO_SESSION_ID` — 当前会话 ID
- `AGENT_CO_AGENT_NAME` — 智能体名称
- `AGENT_CO_CALLBACK_TOKEN` — 鉴权令牌

### 富文本支持

AI 回复支持 `cc_rich` 代码块：

#### Card 卡片

```json
{
  "kind": "card",
  "title": "标题",
  "body": "内容",
  "tone": "info"
}
```

#### Checklist 清单

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

#### 双路由富文本

- **Route A**：通过 `/api/create-block` HTTP 回调预存 blocks
- **Route B**：从 AI 回复文本中提取 `cc_rich` 代码块
- 最终合并两种来源的 blocks（按 id 去重）

### 实时更新机制

- `POST /api/chat` 只负责写入命令并返回 accepted 响应
- 智能体执行生命周期统一写入会话事件流
- 前端通过 `/api/ws/session-events` 订阅事件
- 前端通过 `/api/sessions/:id/timeline` 刷新权威展示
- 重连后优先通过 `/api/sessions/:id/timeline?afterSeq=...` 做增量追赶，不一致时回退全量刷新
- 调用图通过 `/api/sessions/:id/call-graph` 从同一事件流派生

### 会话机制

#### 会话记忆

- `@Claude` 后，`currentAgent` 设为 "Claude"
- 后续无 @ 的消息自动发送给当前智能体
- 清空历史时重置 `currentAgent`

#### 用户隔离

- 登录用户：session token 作为标识
- 未登录用户：IP 地址作为标识
- 每个用户独立聊天历史和智能体状态

#### 多会话

- 用户可创建、重命名、切换和删除会话
- 会话设置（链路限制、讨论模式）按会话独立
- 智能体工作目录按会话按智能体独立配置

### 安全特性

#### 速率限制

- 全局请求：每分钟 100 次
- 登录尝试：每分钟 5 次

#### 生产环境检查

- `AUTH_ADMIN_TOKEN` 必须 ≥ 32 字符
- `AGENT_CO_DEFAULT_PASSWORD` 必须 ≥ 12 字符，包含大小写字母、数字和特殊字符

#### 回调鉴权

- 回调端点需要 `x-agent-co-callback-token` 或 `Authorization: Bearer` 头
- 令牌通过 `AGENT_CO_CALLBACK_TOKEN` 配置

### iOS / PWA

- `public/manifest.json` + `public/service-worker.js` 提供基础 PWA 能力
- iOS Safari 可通过「添加到主屏幕」安装为类 App 体验
- 已添加 `apple-touch-icon`（SVG）与 iOS web app meta 标签

### Verbose 日志

CLI 智能体的详细输出记录在 `AGENT_CO_VERBOSE_LOG_DIR`（默认 `logs/ai-cli-verbose`）：

- 文件命名：`{timestamp}-{cliName}-{agentName}.log`
- 包含 stdout、stderr 和 meta 信息
- 可通过 `/api/verbose/*` 端点查询

### 测试

```bash
npm test                # 运行所有集成测试
npm run test:unit       # 仅运行单元测试
npm run test:fast       # 快速测试（单元 + 关键集成）
```

单元测试位于 `tests/unit/`，集成测试位于 `tests/integration/`。

### 许可证

ISC
