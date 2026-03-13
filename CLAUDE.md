# CLAUDE.md

本文件提供此多 AI 智能体聊天室项目的开发指南。

## 项目概述

多 AI 智能体聊天室，支持多个 AI 智能体与用户共同对话， 每个智能体有独特的名字和性格。 用户通过 `@智能体名` 召唤特定 AI，系统会记住当前对话的智能体， 后续消息自动发送。

## 巻加新智能体

在 `src/agent-manager.ts` 中的 `DEFAULT_AGENTS` 数组添加新配置:

```typescript
{
  name: 'NewAgent',
  avatar: '🤖',
  personality: '智能体性格描述',
  color: '#颜色代码'
}
```

## API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/agents` | GET | 获取智能体列表 |
| `/api/chat` | POST | 发送消息 |
| `/api/history` | GET | 获取历史记录 |
| `/api/clear` | POST | 清空历史 |
| `/api/create-block` | POST | Route A: 创建 block |
| `/api/block-status` | GET | 查看 BlockBuffer 状态 |

## 富文本支持

AI 回复支持两种富文本块：

 使用 `cc_rich` 代码块：

### Card
```json
{
  "kind": "card",
  "title": "标题",
  "body": "内容",
  "tone": "info" | "success" | "warning"
}
```

### Checklist
```json
{
  "kind": "checklist",
  "title": "标题",
  "items": [
    { "text": "任务", "done": false }
  ]
}
```

## 核心模块

- `server.ts` - HTTP 服务器和路由处理
- `agent-manager.ts` - 智能体管理和 @ 提及提取
- `claude-cli.ts` - Claude CLI 调用（参考 minimal-claude.js）
- `types.ts` - 类型定义
- `rich-extract.ts` - 富文本块提取
- `rich-digest.ts` - 富文本摘要（用于 prompt）
- `block-buffer.ts` - Block 缓冲区

## 运行项目

```bash
npm run build   # 编译 TypeScript
npm start       # 启动服务器 (端口 3002)
npm run dev       # 开发模式运行
```

## 会话记忆机制

系统通过 `SessionState` 记住当前对话的智能体:
- 用户 `@Claude` 后，`currentAgent` 设置为 "Claude"
- 后续消息无 @ 提及时，自动发送给当前智能体
- 清空历史时重置 `currentAgent`

## 双路由富文本

- **Route A**: 通过 `/api/create-block` HTTP 回调预存 blocks
- **Route B**: 从 AI 回复文本中提取 `cc_rich` 代码块
- 最终合并两种来源的 blocks（按 id 去重）
