# Bot Room

**Bot Room** is a self-hosted multi-agent chat room built with Node.js and TypeScript. It combines a focused chat UI, per-session agent management, lightweight auth/admin tooling, PWA support, and integration-oriented backend flows for CLI-based AI agents.

**Bot Room** 是一个基于 Node.js 和 TypeScript 的自托管多智能体聊天室。它把聚焦聊天界面、按会话管理智能体、轻量鉴权后台、PWA 支持，以及面向 CLI 智能体的后端集成流程放在同一个项目里。

## Highlights / 项目亮点

- **Multi-agent conversations** with built-in agents such as Claude, Codex Architect, Alice, and Bob.
- **Session isolation** with per-session history, enabled-agent sets, and current-agent focus state.
- **Focused chat UI** optimized for desktop and mobile, with a sticky top control bar and a scrolling message area.
- **Admin/auth service** for login, user management, agent configuration, prompt updates, and workdir selection.
- **PWA-ready frontend** with install prompt support for mobile home-screen usage.
- **Operational pages** for verbose CLI logs and dependency/runtime status inspection.
- **Integration tests** covering chat flows, auth/admin APIs, callbacks, and frontend bindings.

- **多智能体对话**，内置 Claude、Codex 架构师、Alice、Bob 等智能体。
- **会话级隔离**，支持每个会话独立的消息历史、启用智能体列表和当前对话目标。
- **聚焦式聊天界面**，同时兼顾桌面端与移动端，顶部控制栏吸顶，消息列表独立滚动。
- **独立鉴权与管理服务**，用于登录、用户管理、智能体配置、提示词更新和工作目录设置。
- **PWA 前端支持**，可在移动端作为主屏应用安装。
- **运维观察页面**，可查看 CLI 详细日志和依赖状态。
- **集成测试覆盖**，包括聊天流程、鉴权后台、回调链路和前端绑定行为。

## Architecture / 架构概览

This repository currently ships two HTTP services:

当前仓库包含两个 HTTP 服务：

- **Chat service**: [`src/server.ts`](/root/chat/src/server.ts), default port `3002`
- **Auth/Admin service**: [`src/auth-admin-server.ts`](/root/chat/src/auth-admin-server.ts), default port `3003`

The chat service serves the main UI from [`public/index.html`](/root/chat/public/index.html).  
The auth/admin service serves the admin page from [`public-auth/admin.html`](/root/chat/public-auth/admin.html).

聊天服务负责主聊天 UI，静态页面入口是 [`public/index.html`](/root/chat/public/index.html)。  
鉴权管理服务负责后台管理页，入口是 [`public-auth/admin.html`](/root/chat/public-auth/admin.html)。

## Quick Start / 快速开始

### 1. Install dependencies / 安装依赖

```bash
npm install
```

### 2. Initialize local directories / 初始化本地目录

```bash
npm run init
```

This script prepares local runtime directories such as `data/` and verbose log folders.

这个脚本会准备本地运行所需目录，例如 `data/` 和详细日志目录。

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
- Redis-backed persistence is optional for local development. If you set `BOT_ROOM_REDIS_REQUIRED=false`, the chat service can continue without requiring Redis as a hard dependency.
- If the auth data file does not exist, the admin service will create a default user on first startup.

- 默认开启鉴权，除非显式设置 `BOT_ROOM_AUTH_ENABLED=false`。
- 聊天服务默认通过 `AUTH_ADMIN_BASE_URL` 访问鉴权后台，默认值是 `http://127.0.0.1:3003`。
- 本地开发时 Redis 可以不是强依赖；设置 `BOT_ROOM_REDIS_REQUIRED=false` 后，即使 Redis 不可用也可以继续开发。
- 如果鉴权数据文件不存在，管理服务会在首次启动时自动创建默认用户。

Default dev credentials / 默认开发账号：

- Username / 用户名: `admin`
- Password / 密码: `admin123!`

## Useful Scripts / 常用脚本

```bash
npm run init
npm run build
npm run dev
npm run start:chat
npm run start:auth
npm test
```

Additional deployment-related helpers currently in the repo:

仓库中还包含一些部署辅助脚本：

- [`scripts/install-systemd.sh`](/root/chat/scripts/install-systemd.sh)
- [`scripts/one-click-deploy.sh`](/root/chat/scripts/one-click-deploy.sh)

## Project Structure / 目录结构

```text
src/
  server.ts              Main chat service
  auth-admin-server.ts   Auth and admin service
  agent-manager.ts       Built-in agent definitions and mention parsing
  agent-config-store.ts  Agent persistence and apply modes
public/
  index.html             Main chat UI
  styles.css             Frontend styles
  verbose-logs.html      CLI verbose logs page
  deps-monitor.html      Dependency status page
public-auth/
  admin.html             Admin UI
tests/integration/
  *.integration.test.js  End-to-end oriented integration coverage
```

## What It Supports Today / 当前已支持的能力

- Session create, switch, rename, and delete flows
- Per-session enabled/disabled agent sets
- Current-agent focus and `@agent` routing
- Agent workdir configuration
- Authenticated login flow with cookie-backed sessions
- Callback-based agent replies
- Rich blocks such as cards and checklists
- Mobile-friendly PWA chat experience

- 会话创建、切换、重命名、删除
- 按会话启用或停用智能体
- 当前对话智能体聚焦，以及 `@智能体名` 路由
- 智能体工作目录配置
- 基于 Cookie 会话的登录鉴权
- 回调式智能体回复链路
- 富文本区块，例如卡片和清单
- 面向移动端的 PWA 聊天体验

## Testing / 测试

Run all integration tests:

运行全部集成测试：

```bash
npm test
```

The repository also includes focused Node test files under [`tests/integration/`](/root/chat/tests/integration).

仓库中也提供了位于 [`tests/integration/`](/root/chat/tests/integration) 下的可单独执行测试文件。

## Status / 当前状态

Bot Room is already runnable as a self-hosted project, but the repository is still evolving. Expect iteration in deployment ergonomics, docs completeness, and some internal module boundaries.

Bot Room 已经可以作为自托管项目运行，但仓库仍在持续演进中。部署体验、文档完整度以及部分内部模块边界仍会继续迭代。

## License / 许可证

The current `package.json` declares `ISC`.

当前 [`package.json`](/root/chat/package.json) 中声明的许可证是 `ISC`。
