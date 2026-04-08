# CLAUDE.md

本文件提供此多 AI 智能体聊天室项目的开发指南。

## 项目概述

多 AI 智能体聊天室，支持多个 AI 智能体与用户共同对话，每个智能体有独特的名字和性格。用户通过 `@智能体名` 召唤特定 AI，系统会记住当前对话的智能体，后续消息自动发送。

## 核心模块

| 路径 | 功能 |
|------|------|
| `src/server.ts` | 聊天服务组合根：配置、依赖装配、启动 |
| `src/auth-admin-server.ts` | 鉴权/管理服务组合根：配置、依赖装配、启动 |
| `src/shared/http/*` | 共享 HTTP 工具：body/json/cors/static/errors |
| `src/chat/http/*` | 聊天服务路由适配层（chat/auth/callback/ops） |
| `src/chat/application/*` | 聊天领域用例（chat/session/auth） |
| `src/chat/infrastructure/*` | 聊天侧基础设施（auth-admin client、持久化 helper、依赖日志等） |
| `src/chat/runtime/*` | 聊天运行时状态（session/runtime/agent store） |
| `src/admin/http/*` | 管理端路由与 admin 鉴权 helper |
| `src/admin/application/*` | 管理端用例（user/agent/group/model/system） |
| `src/admin/infrastructure/*` | 管理端基础设施（user store） |
| `src/admin/runtime/*` | 管理端运行时与启动/安全检查 |
| `src/agent-manager.ts` | 智能体管理和 @ / @@ 提及提取 |
| `src/agent-config-store.ts` | 智能体配置持久化存储 |
| `src/claude-cli.ts` | Claude CLI 调用（支持 stream-json 输出） |
| `src/types.ts` | 类型定义 |
| `src/rich-extract.ts` | 富文本块提取 |
| `src/rich-digest.ts` | 富文本摘要（用于 prompt） |
| `src/block-buffer.ts` | Block 缓冲区（Route A） |
| `src/rate-limiter.ts` | 内存速率限制器 |

## 模块放置约定

- **新增聊天 HTTP 端点**：优先放到 `src/chat/http/`
- **新增管理端 HTTP 端点**：优先放到 `src/admin/http/`
- **新增业务编排 / 用例逻辑**：优先放到 `src/chat/application/` 或 `src/admin/application/`
- **新增 Redis / 文件系统 / 上游 HTTP / 运行时状态逻辑**：优先放到 `src/chat/infrastructure/`、`src/chat/runtime/`、`src/admin/infrastructure/` 或 `src/admin/runtime/`
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

### 聊天服务器 (server.ts)

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 3002 | 服务端口 |
| `BOT_ROOM_AUTH_ENABLED` | true | 是否启用鉴权 |
| `AUTH_ADMIN_BASE_URL` | http://127.0.0.1:3003 | 鉴权服务地址 |
| `AGENT_DATA_FILE` | data/agents.json | 智能体配置文件 |
| `BOT_ROOM_VERBOSE_LOG_DIR` | logs/ai-cli-verbose | verbose 日志目录 |
| `AUTH_ADMIN_TOKEN` | - | 管理员令牌（生产环境必须） |
| `BOT_ROOM_DEFAULT_PASSWORD` | - | 聊天服务仅在生产环境用它做安全检查；真正的默认兜底值见下方鉴权服务表 |

### Redis 配置来源（聊天服务）

聊天服务启动时默认连接 `redis://127.0.0.1:6379`，并从 `bot-room:config` 读取运行配置（例如 `chat_sessions_key`），不依赖环境变量注入 Redis 配置。

可通过以下命令修改会话存储 key：

```bash
redis-cli HSET bot-room:config chat_sessions_key bot-room:chat:sessions:v1
```

### 鉴权管理服务 (auth-admin-server.ts)

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AUTH_ADMIN_PORT` | 3003 | 服务端口 |
| `AUTH_ADMIN_TOKEN` | - | 管理员令牌 |
| `AUTH_DATA_FILE` | data/users.json | 用户数据文件 |
| `AGENT_DATA_FILE` | data/agents.json | 智能体配置文件 |
| `BOT_ROOM_DEFAULT_USER` | admin | 默认用户名 |
| `BOT_ROOM_DEFAULT_PASSWORD` | admin123! | 默认密码兜底值（生产环境请显式覆盖为强密码） |

## 聊天服务主要 API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/agents` | GET | 获取智能体列表 |
| `/api/chat` | POST | 发送消息（同步响应） |
| `/api/chat-stream` | POST | 发送消息（SSE 流式响应） |
| `/api/chat-resume` | POST | 继续执行中断的链式对话 |
| `/api/chat-summary` | POST | 为会话生成总结 |
| `/api/history` | GET | 获取历史记录 |
| `/api/clear` | POST | 清空历史 |
| `/api/sessions` | POST | 创建会话 |
| `/api/sessions/select` | POST | 切换当前会话 |
| `/api/sessions/update` | POST | 更新会话元数据 |
| `/api/sessions/rename` | POST | 重命名会话 |
| `/api/sessions/delete` | POST | 删除会话 |
| `/api/session-agents` | POST | 按会话启用/停用智能体 |
| `/api/login` | POST | 用户名+密码登录 |
| `/api/logout` | POST | 登出并清除 Cookie |
| `/api/auth-status` | GET | 查看鉴权状态 |
| `/api/create-block` | POST | Route A: 创建 block |
| `/api/block-status` | GET | 查看 BlockBuffer 状态 |
| `/api/dependencies/status` | GET | 查看依赖服务运行状态（Redis） |
| `/api/workdirs/select` | POST | 为当前会话设置工作目录 |
| `/api/verbose/agents` | GET | 查看 verbose 日志智能体列表 |
| `/api/verbose/logs` | GET | 查看智能体日志文件列表 |
| `/api/verbose/log-content` | GET | 查看日志文件内容 |

## 鉴权管理服务主要 API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/` | GET | 管理页面 |
| `/healthz` | GET | 健康检查 |
| `/api/auth/verify` | POST | 验证用户凭据 |
| `/api/users` | GET | 获取用户列表（需 x-admin-token） |
| `/api/users` | POST | 创建用户（需 x-admin-token） |
| `/api/users/:name/password` | PUT | 修改用户密码（需 x-admin-token） |
| `/api/users/:name` | DELETE | 删除用户（需 x-admin-token） |
| `/api/agents` | GET | 获取智能体配置（需 x-admin-token） |
| `/api/agents` | POST | 创建智能体（需 x-admin-token） |
| `/api/agents/:name` | PUT | 更新智能体（需 x-admin-token） |
| `/api/agents/:name/prompt` | PUT | 更新智能体提示词（需 x-admin-token） |
| `/api/agents/:name/prompt/template` | GET | 获取模板提示词（需 x-admin-token） |
| `/api/agents/:name/prompt/restore-template` | POST | 恢复模板提示词（需 x-admin-token） |
| `/api/agents/:name` | DELETE | 删除智能体（需 x-admin-token） |
| `/api/agents/apply-pending` | POST | 应用待生效配置（需 x-admin-token） |
| `/api/groups` | GET/POST | 查询/创建分组（需 x-admin-token） |
| `/api/groups/:id` | PUT/DELETE | 更新/删除分组（需 x-admin-token） |
| `/api/model-connections` | GET/POST | 查询/创建模型连接（需 x-admin-token） |
| `/api/model-connections/:id` | PUT/DELETE | 更新/删除模型连接（需 x-admin-token） |
| `/api/model-connections/:id/test` | POST | 测试模型连接（需 x-admin-token） |
| `/api/system/dirs` | GET | 列出可选工作目录（需 x-admin-token） |

## 智能体配置

### 默认智能体

在 `src/agent-manager.ts` 中的 `DEFAULT_AGENTS` 数组定义：

- Claude (🤖) - 技术和编程专家
- Alice (👩‍💻) - 艺术和设计专家
- Bob (🧑‍💻) - 工程实践专家

### 配置结构

```typescript
interface AIAgentConfig {
  name: string;        // 智能体名称（2-32 字符）
  avatar: string;      // 头像（建议 1 个 emoji）
  personality: string; // 性格描述
  color: string;       // 显示颜色（#RRGGBB）
  systemPrompt?: string; // 自定义系统提示词（可选）
}
```

### 动态配置

智能体配置存储在 `data/agents.json`，支持热更新：

- `applyMode: "immediate"` - 立即生效
- `applyMode: "after_chat"` - 会话结束后生效

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

### 分组 API

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/groups` | GET | 获取所有分组 |
| `/api/groups` | POST | 创建分组（需 x-admin-token） |
| `/api/groups/:id` | PUT | 更新分组（需 x-admin-token） |
| `/api/groups/:id` | DELETE | 删除分组（需 x-admin-token） |

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

## 流式响应 (SSE)

`/api/chat-stream` 端点支持 Server-Sent Events：

| 事件 | 数据 |
|------|------|
| `user_message` | 用户消息对象 |
| `agent_thinking` | `{ agent: string }` |
| `agent_message` | AI 消息对象 |
| `done` | `{ currentAgent: string \| null }` |
| `error` | `{ error: string }` |

## 安全特性

### 速率限制

- 全局请求：每分钟 100 次
- 登录尝试：每分钟 5 次

### 生产环境检查

- `AUTH_ADMIN_TOKEN` 必须 ≥ 32 字符
- `BOT_ROOM_DEFAULT_PASSWORD` 必须 ≥ 12 字符，包含大小写字母、数字、特殊字符

## iOS / PWA

- `public/manifest.json` + `public/service-worker.js` 提供基础 PWA 能力
- iOS Safari 可通过「添加到主屏幕」安装为类 App 体验
- 已添加 `apple-touch-icon`（SVG）与 iOS web app meta 标签

## Verbose 日志

Claude CLI / Codex CLI 的详细输出会记录到 `BOT_ROOM_VERBOSE_LOG_DIR`（默认 `logs/ai-cli-verbose`）：

- 文件命名格式：`{timestamp}-{cli}-{agentName}.log`
- 包含 stdout、stderr、meta 信息
- 可通过 `/api/verbose/*` 端点查询
