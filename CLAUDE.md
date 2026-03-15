# CLAUDE.md

本文件提供此多 AI 智能体聊天室项目的开发指南。

## 项目概述

多 AI 智能体聊天室，支持多个 AI 智能体与用户共同对话，每个智能体有独特的名字和性格。用户通过 `@智能体名` 召唤特定 AI，系统会记住当前对话的智能体，后续消息自动发送。

## 核心模块

| 文件 | 功能 |
|------|------|
| `server.ts` | HTTP 服务器和路由处理 |
| `agent-manager.ts` | 智能体管理和 @ 提及提取 |
| `agent-config-store.ts` | 智能体配置持久化存储 |
| `claude-cli.ts` | Claude CLI 调用（支持 stream-json 输出） |
| `types.ts` | 类型定义 |
| `rich-extract.ts` | 富文本块提取 |
| `rich-digest.ts` | 富文本摘要（用于 prompt） |
| `block-buffer.ts` | Block 缓冲区（Route A） |
| `rate-limiter.ts` | 内存速率限制器 |
| `auth-admin-server.ts` | 独立鉴权管理服务 |

## 运行项目

```bash
npm run build        # 编译 TypeScript
npm start            # 启动聊天服务器 (端口 3002)
npm run dev          # 开发模式运行
npm run start:auth   # 启动鉴权管理服务 (端口 3003)
```

## 环境变量配置

### 聊天服务器 (server.ts)

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 3002 | 服务端口 |
| `BOT_ROOM_AUTH_ENABLED` | true | 是否启用鉴权 |
| `AUTH_ADMIN_BASE_URL` | http://127.0.0.1:3003 | 鉴权服务地址 |
| `AGENT_DATA_FILE` | data/agents.json | 智能体配置文件 |
| `BOT_ROOM_VERBOSE_LOG_DIR` | logs/claude-verbose | verbose 日志目录 |
| `AUTH_ADMIN_TOKEN` | - | 管理员令牌（生产环境必须） |
| `BOT_ROOM_DEFAULT_PASSWORD` | - | 默认用户密码（生产环境必须） |

### 鉴权管理服务 (auth-admin-server.ts)

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AUTH_ADMIN_PORT` | 3003 | 服务端口 |
| `AUTH_ADMIN_TOKEN` | - | 管理员令牌 |
| `AUTH_DATA_FILE` | data/users.json | 用户数据文件 |
| `AGENT_DATA_FILE` | data/agents.json | 智能体配置文件 |
| `BOT_ROOM_DEFAULT_USER` | admin | 默认用户名 |
| `BOT_ROOM_DEFAULT_PASSWORD` | - | 默认密码 |

## 聊天服务 API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/agents` | GET | 获取智能体列表 |
| `/api/chat` | POST | 发送消息（同步响应） |
| `/api/chat-stream` | POST | 发送消息（SSE 流式响应） |
| `/api/history` | GET | 获取历史记录 |
| `/api/clear` | POST | 清空历史 |
| `/api/switch-agent` | POST | 切换当前智能体 |
| `/api/login` | POST | 用户名+密码登录 |
| `/api/logout` | POST | 登出并清除 Cookie |
| `/api/auth-status` | GET | 查看鉴权状态 |
| `/api/create-block` | POST | Route A: 创建 block |
| `/api/block-status` | GET | 查看 BlockBuffer 状态 |
| `/api/verbose/agents` | GET | 查看 verbose 日志智能体列表 |
| `/api/verbose/logs` | GET | 查看智能体日志文件列表 |
| `/api/verbose/log-content` | GET | 查看日志文件内容 |

## 鉴权管理服务 API 端点

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
| `/api/agents/:name` | DELETE | 删除智能体（需 x-admin-token） |
| `/api/agents/apply-pending` | POST | 应用待生效配置（需 x-admin-token） |

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

当设置 `BOT_ROOM_VERBOSE_LOG_DIR` 时，Claude CLI 的详细输出会记录到日志文件：

- 文件命名格式：`{timestamp}-{agentName}.log`
- 包含 stdout、stderr、meta 信息
- 可通过 `/api/verbose/*` 端点查询
