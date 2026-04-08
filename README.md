# Bot Room

**Bot Room** is a self-hosted multi-agent chat room built with Node.js and TypeScript. It supports CLI-based (Claude CLI / Codex CLI) and API-based (OpenAI-compatible) agent backends, per-session agent management with peer discussion mode, lightweight auth/admin tooling, PWA support, and integration-oriented callback flows.

**Bot Room** 是一个基于 Node.js 和 TypeScript 的自托管多智能体聊天室。支持 CLI 调用（Claude CLI / Codex CLI）和 API 调用（OpenAI 兼容接口）两种智能体后端，提供按会话管理智能体、peer 讨论模式、轻量鉴权后台、PWA 支持，以及基于回调的集成流程。

## Highlights / 项目亮点

- **Multi-agent conversations** with built-in agents such as Claude, Codex Architect, Alice, and Bob.
- **Dual execution modes** — agents can run via CLI (Claude/Codex CLI) or API (OpenAI-compatible endpoints) with configurable model, temperature, and token limits.
- **Peer discussion mode** — agents can engage in multi-turn peer discussions with chain dispatch, pause/resume, and manual summarization.
- **Session isolation** with per-session history, enabled-agent sets, current-agent focus state, and configurable chain limits.
- **Agent chaining** — agents can invoke other agents via `@@AgentName` syntax or callback `invokeAgents`, with configurable max hops and per-agent call limits.
- **Agent groups** — organize agents into groups for sidebar display and batch `@group` mentions.
- **API connection management** — create, test, and manage OpenAI-compatible API connections with secure credential storage.
- **Focused chat UI** optimized for desktop and mobile, with a sticky top control bar and scrolling message area.
- **Admin/auth service** for login, user management, agent configuration, prompt updates, workdir selection, and model connection management.
- **Rich text blocks** — agents can render cards and checklists via `cc_rich` code blocks or HTTP callback.
- **PWA-ready frontend** with install prompt support for mobile home-screen usage.
- **Operational pages** for verbose CLI logs, dependency status, and dependency log queries.
- **MCP server** for agent callbacks — agents can post messages and read thread context via MCP tools.
- **Integration tests** covering chat flows, auth/admin APIs, callbacks, and frontend bindings.

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

## Architecture / 架构概览

This repository currently ships two HTTP services:

当前仓库包含两个 HTTP 服务：

- **Chat service**: `src/server.ts`, default port `3002`
- **Auth/Admin service**: `src/auth-admin-server.ts`, default port `3003`

The chat service serves the main UI from `public/index.html`.
The auth/admin service serves the admin page from `public-auth/admin.html`.

聊天服务负责主聊天 UI，静态页面入口是 `public/index.html`。
鉴权管理服务负责后台管理页，入口是 `public-auth/admin.html`。

## Quick Start / 快速开始

### 1. Install dependencies / 安装依赖

```bash
npm install
```

### 2. Initialize local directories / 初始化本地目录

```bash
npm run init
```

This script prepares local runtime directories such as `data/` and verbose log folders, and creates `.env` from `.env.example` when missing. The npm start scripts do **not** load `.env` automatically, so for local development you should export it before starting services:

这个脚本会准备本地运行所需目录，例如 `data/` 和详细日志目录；如果 `.env` 不存在，还会基于 `.env.example` 创建它。注意 npm 启动脚本**不会自动加载** `.env`，因此本地开发前建议先导出环境变量：

```bash
set -a
source .env
set +a
```

### 3. Build / 构建

```bash
npm run build
```

### 4. Start the chat service / 启动聊天服务

```bash
npm run dev
```

Or run the compiled build:

也可以直接运行编译产物：

```bash
npm run start:chat
```

### 5. Start the auth/admin service / 启动鉴权管理服务

```bash
npm run start:auth
```

By default, the services are available at:

默认地址：

- Chat UI / 聊天页: `http://127.0.0.1:3002`
- Admin UI / 管理页: `http://127.0.0.1:3003`

## Default Development Behavior / 默认开发行为

- Auth is enabled by default unless `BOT_ROOM_AUTH_ENABLED=false`.
- The chat service expects the auth/admin service at `AUTH_ADMIN_BASE_URL`, defaulting to `http://127.0.0.1:3003`.
- Redis-backed persistence is optional for local development. If you set `BOT_ROOM_REDIS_REQUIRED=false`, the chat service can continue without requiring Redis as a hard dependency. You can also fully disable Redis with `BOT_ROOM_DISABLE_REDIS=true`.
- If the auth data file does not exist, the admin service will create a default user on first startup.

- 默认开启鉴权，除非显式设置 `BOT_ROOM_AUTH_ENABLED=false`。
- 聊天服务默认通过 `AUTH_ADMIN_BASE_URL` 访问鉴权后台，默认值是 `http://127.0.0.1:3003`。
- 本地开发时 Redis 可以不是强依赖；设置 `BOT_ROOM_REDIS_REQUIRED=false` 后，即使 Redis 不可用也可以继续开发。也可以通过 `BOT_ROOM_DISABLE_REDIS=true` 完全禁用 Redis。
- 如果鉴权数据文件不存在，管理服务会在首次启动时自动创建默认用户。

Default dev credentials / 默认开发账号：

- If you rely on runtime fallback defaults, the initial credentials are `admin` / `admin123!`.
- If you `source .env` generated from `.env.example`, the initial credentials are `admin` / `admin123!`.

- 如果使用运行时代码内置默认值，初始化账号为 `admin` / `admin123!`。
- 如果使用 `npm run init` 生成并 `source .env` 的开发配置，初始化账号同样为 `admin` / `admin123!`。

## Useful Scripts / 常用脚本

```bash
npm run init            # 初始化本地目录
npm run build           # 编译 TypeScript
npm run dev             # 开发模式运行
npm run start:chat      # 运行编译后的聊天服务
npm run start:auth      # 运行编译后的鉴权管理服务
npm test                # 运行集成测试
npm run deploy:one-click  # 一键部署（安装 Redis + systemd）
```

## Project Structure / 目录结构

Key structure snapshot (not an exhaustive file list) / 关键结构快照（非完整清单）：

```text
src/
  server.ts                Chat service composition root (~57 lines)
  auth-admin-server.ts     Auth/admin service composition root (~69 lines)
  agent-invoker.ts         Re-export shim for backward compatibility
  agent-manager.ts         Agent definitions, @ mention parsing, @@ chain invocation parsing
  agent-config-store.ts    Agent persistence, apply modes (immediate / after_chat)
  api-connection-store.ts  OpenAI-compatible API connection CRUD and validation
  group-store.ts           Agent group storage and validation
  claude-cli.ts            CLI subprocess management, streaming JSON, MCP injection
  block-buffer.ts          Rich block buffering for callback-based flows
  rich-extract.ts          Extract cc_rich blocks from model output
  rich-digest.ts           Rich block digest helpers for prompts
  rate-limiter.ts          In-memory rate limiting helpers
  bot-room-mcp-server.ts   MCP server for agent callbacks
  professional-agent-prompts.ts  Professional agent prompt builder
  professional-agent-prompts.json  Professional role prompt templates (7 roles)
  types.ts                 Shared TypeScript type definitions
  chat/
    bootstrap/             Chat server bootstrap and startup wiring
    http/                  Chat/auth/callback/ops route adapters
      ops/                 Dependency, system, verbose-log route sub-modules
    application/           Chat, session, auth use cases
    infrastructure/        Auth-admin client, session repository, dependency log store
    runtime/               Chat runtime state, session state, discussion state, persistence
  admin/
    bootstrap/             Auth-admin bootstrap and startup wiring
    http/                  Admin routes and auth helpers
    application/           User/agent/group/model/system admin use cases
    infrastructure/        User persistence store (JSON + PBKDF2)
    runtime/               Admin runtime config and startup/security logic
  agent-invocation/        Agent dispatch routing (CLI vs API), target normalization
  shared/
    errors/                AppError class, error codes, HTTP status mapping
    http/                  Shared HTTP helpers: body, cors, json, static, error mapper
  providers/               CLI / OpenAI-compatible agent providers
public/                    Main chat UI and static assets
public-auth/               Admin UI static assets
data/                      Runtime data directory
logs/                      Runtime logs (including ai-cli-verbose/)
scripts/                   Bootstrap and deployment scripts
systemd/                   Example service unit files
tests/unit/                Unit tests (agent-invocation, app-error, session-discussion-rules)
tests/integration/         End-to-end oriented integration coverage
dist/                      Compiled build output
```

### Module responsibilities / 模块职责

- **Chat routes** live under `src/chat/http/`
- **Auth/admin routes** live under `src/admin/http/`
- **Shared HTTP helpers** live under `src/shared/http/`
- **New use cases / 业务编排** should usually be added under `src/chat/application/` or `src/admin/application/`
- **New infrastructure integrations** (filesystem, Redis, upstream HTTP, persistence helpers) should usually be added under `src/chat/infrastructure/`, `src/chat/runtime/`, `src/admin/infrastructure/`, or `src/admin/runtime/`

This keeps `src/server.ts` and `src/auth-admin-server.ts` as thin startup files instead of feature containers.
这样可以让 `src/server.ts` 与 `src/auth-admin-server.ts` 保持为精简的启动入口，而不是再次膨胀成业务容器。

## Environment Variables / 环境变量配置

### Chat Service / 聊天服务

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3002` | Chat service port |
| `BOT_ROOM_AUTH_ENABLED` | `true` | Enable/disable authentication |
| `AUTH_ADMIN_BASE_URL` | `http://127.0.0.1:3003` | Auth admin service URL |
| `AGENT_DATA_FILE` | `data/agents.json` | Agent config file path |
| `BOT_ROOM_VERBOSE_LOG_DIR` | `logs/ai-cli-verbose` | Verbose log directory |
| `BOT_ROOM_REDIS_REQUIRED` | `true` | Whether Redis is required |
| `BOT_ROOM_DISABLE_REDIS` | `false` | Fully disable Redis persistence |
| `BOT_ROOM_AGENT_CHAIN_MAX_HOPS` | `4` | Default max chain hops per session |
| `BOT_ROOM_CALLBACK_TOKEN` | `bot-room-callback-token` | Token for callback auth |

### Auth/Admin Service / 鉴权管理服务

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_ADMIN_PORT` | `3003` | Admin service port |
| `AUTH_ADMIN_TOKEN` | - | Admin token (required in production, >= 32 chars) |
| `AUTH_DATA_FILE` | `data/users.json` | User data file path |
| `AGENT_DATA_FILE` | `data/agents.json` | Agent config file path |
| `MODEL_CONNECTION_DATA_FILE` | `data/api-connections.json` | API connections file path |
| `GROUP_DATA_FILE` | `data/groups.json` | Agent groups file path |
| `BOT_ROOM_DEFAULT_USER` | `admin` | Default username |
| `BOT_ROOM_DEFAULT_PASSWORD` | `admin123!` | Default password fallback (override in production with a strong secret) |

### Redis / Redis 配置

The chat service connects to `redis://127.0.0.1:6379` by default and reads runtime config from `bot-room:config` (e.g., `chat_sessions_key`).

聊天服务启动时默认连接 `redis://127.0.0.1:6379`，并从 `bot-room:config` 读取运行配置。

```bash
redis-cli HSET bot-room:config chat_sessions_key bot-room:chat:sessions:v1
```

## Chat Service API / 聊天服务 API 端点

### Core Chat / 核心聊天

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat` | POST | Send message (sync response) |
| `/api/chat-stream` | POST | Send message (SSE streaming response) |
| `/api/chat-resume` | POST | Resume interrupted pending chain tasks |
| `/api/chat-summary` | POST | Manual peer discussion summary (peer mode only) |
| `/api/history` | GET | Get chat history and session info |
| `/api/clear` | POST | Clear chat history |

### Agents / 智能体

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agents` | GET | Get agent list |
| `/api/session-agents` | POST | Enable/disable agent for session |
| `/api/groups` | GET | Get agent groups |

### Sessions / 会话管理

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sessions` | POST | Create new chat session |
| `/api/sessions/select` | POST | Switch active session |
| `/api/sessions/rename` | POST | Rename a session |
| `/api/sessions/delete` | POST | Delete a session |
| `/api/sessions/update` | POST | Update session settings (chain limits, discussion mode) |

### Agent Workdirs / 智能体工作目录

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/workdirs/options` | GET | Get available workdir directories |
| `/api/workdirs/select` | POST | Set agent workdir for session |
| `/api/system/dirs` | GET | Browse system directories |

### Auth / 鉴权

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/login` | POST | Login with username + password |
| `/api/logout` | POST | Logout and clear cookie |
| `/api/auth-status` | GET | Check auth status |

### Callbacks & Blocks / 回调与区块

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/create-block` | POST | Route A: create rich block |
| `/api/block-status` | GET | View BlockBuffer status |
| `/api/callbacks/post-message` | POST | Agent posts message via callback |
| `/api/callbacks/thread-context` | GET | Get session history for agent |

### Operations / 运维

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dependencies/status` | GET | Check dependency health (Redis) |
| `/api/dependencies/logs` | GET | Query dependency logs with filters |
| `/api/verbose/agents` | GET | List agents with verbose logs |
| `/api/verbose/logs` | GET | List log files for an agent |
| `/api/verbose/log-content` | GET | Read a specific log file |

## Auth/Admin Service API / 鉴权管理服务 API 端点

### Users / 用户管理

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/verify` | POST | Verify user credentials |
| `/api/users` | GET | List users (requires `x-admin-token`) |
| `/api/users` | POST | Create user (requires `x-admin-token`) |
| `/api/users/:name/password` | PUT | Change password (requires `x-admin-token`) |
| `/api/users/:name` | DELETE | Delete user (requires `x-admin-token`) |

### Agents / 智能体配置

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agents` | GET | Get agent configs (requires `x-admin-token`) |
| `/api/agents` | POST | Create agent (requires `x-admin-token`) |
| `/api/agents/:name` | PUT | Update agent (requires `x-admin-token`) |
| `/api/agents/:name/prompt` | PUT | Update agent prompt (requires `x-admin-token`) |
| `/api/agents/:name/prompt/template` | GET | Preview shared template prompt (requires `x-admin-token`) |
| `/api/agents/:name/prompt/restore-template` | POST | Restore template prompt (requires `x-admin-token`) |
| `/api/agents/:name` | DELETE | Delete agent (requires `x-admin-token`) |
| `/api/agents/apply-pending` | POST | Apply pending agent configs (requires `x-admin-token`) |

### API Connections / 模型连接管理

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/model-connections` | GET | List API connections (requires `x-admin-token`) |
| `/api/model-connections` | POST | Create API connection (requires `x-admin-token`) |
| `/api/model-connections/:id` | PUT | Update API connection (requires `x-admin-token`) |
| `/api/model-connections/:id` | DELETE | Delete API connection (requires `x-admin-token`) |
| `/api/model-connections/:id/test` | POST | Test API connection (requires `x-admin-token`) |

### Groups / 分组管理

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/groups` | GET | List groups (requires `x-admin-token`) |
| `/api/groups` | POST | Create group (requires `x-admin-token`) |
| `/api/groups/:id` | PUT | Update group (requires `x-admin-token`) |
| `/api/groups/:id` | DELETE | Delete group (requires `x-admin-token`) |

### System / 系统

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/healthz` | GET | Health check |
| `/api/system/dirs` | GET | Browse system directories (requires `x-admin-token`) |

## Agent Configuration / 智能体配置

### Default Agents / 默认智能体

Defined in `src/agent-manager.ts`:

- Claude (🤖) — Technical and programming expert
- Codex架构师 (🏗️) — Senior architect emphasizing high cohesion, low coupling
- Alice (👩‍💻) — Creative expert in art and design
- Bob (🧑‍💻) — Pragmatic engineering expert

### Agent Config Structure / 配置结构

```typescript
interface AIAgentConfig {
  name: string;             // Agent name (2-32 chars)
  avatar: string;           // Avatar (1 emoji recommended)
  personality: string;      // Personality description
  color: string;            // Display color (#RRGGBB)
  systemPrompt?: string;    // Custom system prompt (optional)
  executionMode?: 'cli' | 'api';  // Execution mode
  cliName?: 'claude' | 'codex';   // CLI backend (for cli mode)
  apiConnectionId?: string;       // API connection ID (for api mode)
  apiModel?: string;              // Model name (for api mode)
  apiTemperature?: number;        // Temperature (for api mode)
  apiMaxTokens?: number;          // Max tokens (for api mode)
  workdir?: string;               // Working directory
}
```

### Dynamic Config / 动态配置

Agent configs are stored in `data/agents.json` with hot reload:

- `applyMode: "immediate"` — Takes effect immediately
- `applyMode: "after_chat"` — Takes effect after current session ends

### Agent Groups / 智能体分组

Groups are stored in `data/groups.json`:

```typescript
interface AgentGroup {
  id: string;          // Unique ID (2-20 chars, alphanumeric + underscore)
  name: string;        // Display name (2-16 chars)
  icon: string;        // Emoji icon (1-2 emojis)
  agentNames: string[]; // Agent name array
}
```

- **Sidebar grouping**: Agents organized by groups in the sidebar
- **Batch mention**: Type `@groupName` to mention all agents in the group

### API Connections / 模型连接

API connections are stored in `data/api-connections.json`, supporting any OpenAI-compatible endpoint:

- Secure credential storage with masked API keys
- Connection test endpoint for validation
- Only HTTPS allowed (or localhost HTTP)
- Agents reference connections via `apiConnectionId`

## Agent Execution / 智能体执行

### Dual Execution Modes / 双执行模式

Agents can be configured to run via:

1. **CLI mode** — Invokes Claude CLI or Codex CLI as subprocess with streaming support
2. **API mode** — Calls OpenAI-compatible API endpoints with configurable model parameters

### Agent Chaining / 链式调用

- Single `@AgentName` — Reference/mention, does not trigger chain
- Double `@@AgentName` — Explicit chain invocation
- Callback `invokeAgents` — Agents can programmatically chain to other agents
- Configurable limits: `agentChainMaxHops` (default 4) and `agentChainMaxCallsPerAgent`

### Peer Discussion Mode / Peer 讨论模式

Sessions can operate in two discussion modes:

- **classic** — Standard single-turn or chained responses
- **peer** — Multi-turn peer discussion with automatic pause/resume:
  - Discussion auto-pauses when no explicit chain continuation is detected
  - Manual summarization via `/api/chat-summary`
  - Discussion state: `active` / `paused` / `summarizing`

### MCP Callback Server / MCP 回调服务

The built-in MCP server (`src/bot-room-mcp-server.ts`) provides tools for CLI agents:

- `bot_room_post_message` — Post a message to the chat room
- `bot_room_thread_context` — Read current session history

Environment variables for agent context:
- `BOT_ROOM_API_URL` — Chat service URL
- `BOT_ROOM_SESSION_ID` — Current session ID
- `BOT_ROOM_AGENT_NAME` — Agent name
- `BOT_ROOM_CALLBACK_TOKEN` — Auth token

## Rich Text / 富文本支持

AI responses support `cc_rich` code blocks:

### Card / 卡片

```json
{
  "kind": "card",
  "title": "Title",
  "body": "Content",
  "tone": "info"
}
```

### Checklist / 清单

```json
{
  "kind": "checklist",
  "title": "Title",
  "items": [
    { "text": "Task", "done": false },
    { "text": "Done", "done": true }
  ]
}
```

### Dual Route / 双路由富文本

- **Route A**: Pre-store blocks via `/api/create-block` HTTP callback
- **Route B**: Extract `cc_rich` blocks from AI response text
- Blocks from both routes are merged (deduplicated by id)

## Streaming Response (SSE) / 流式响应

`/api/chat-stream` supports Server-Sent Events:

| Event | Data |
|-------|------|
| `user_message` | User message object |
| `agent_thinking` | `{ agent: string }` |
| `agent_delta` | `{ agent: string, delta: string }` |
| `agent_message` | AI message object |
| `notice` | `{ notice: string }` |
| `done` | `{ currentAgent: string \| null }` |
| `error` | `{ error: string }` |

## Session Mechanism / 会话机制

### Session Memory / 会话记忆

- After `@Claude`, `currentAgent` is set to "Claude"
- Subsequent messages without @ are automatically sent to the current agent
- Clearing history resets `currentAgent`

### User Isolation / 用户隔离

- Logged-in users: session token as identifier
- Unauthenticated users: IP address as identifier
- Each user has independent chat history, sessions, and agent state

### Multi-Session / 多会话

- Users can create, rename, switch, and delete sessions
- Session settings (chain limits, discussion mode) are per-session
- Agent workdirs are per-session-per-agent

## Security / 安全特性

### Rate Limiting / 速率限制

- Global requests: 100 per minute
- Login attempts: 5 per minute

### Production Checks / 生产环境检查

- `AUTH_ADMIN_TOKEN` must be >= 32 characters
- `BOT_ROOM_DEFAULT_PASSWORD` must be >= 12 characters with uppercase, lowercase, digits, and special characters

### Callback Auth / 回调鉴权

- Callback endpoints require `x-bot-room-callback-token` or `Authorization: Bearer` header
- Token configurable via `BOT_ROOM_CALLBACK_TOKEN`

## iOS / PWA

- `public/manifest.json` + `public/service-worker.js` provide basic PWA capability
- iOS Safari supports "Add to Home Screen" for app-like experience
- `apple-touch-icon` (SVG) and iOS web app meta tags included

## Verbose Logging / Verbose 日志

CLI agent verbose output is recorded under `BOT_ROOM_VERBOSE_LOG_DIR` (default: `logs/ai-cli-verbose`):

- File naming: `{timestamp}-{cliName}-{agentName}.log`
- Includes stdout, stderr, and meta information
- Queryable via `/api/verbose/*` endpoints

## Testing / 测试

```bash
npm test                # Run all integration tests
npm run test:unit       # Run unit tests only
npm run test:fast       # Fast run: unit tests + key integration tests
```

Unit tests are under `tests/unit/`, integration tests under `tests/integration/`.

## License / 许可证

ISC
