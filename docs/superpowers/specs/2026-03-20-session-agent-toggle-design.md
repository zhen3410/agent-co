# Session Agent Toggle Design

## Goal

为每个聊天 session 增加独立的 agent 启用/停用能力。停用状态的 agent 仍显示在聊天页顶部列表中，但灰态、不可点击、排在启用 agent 之后，并且不能通过 `@` 或连续对话被触发。

## Scope

- 聊天 session 维护独立的 `enabledAgents`
- 新建 session 默认不启用任何 agent
- 聊天页顶部通过滑块启用/停用 agent
- `@` 提示和聊天分发只作用于当前 session 已启用的 agent
- 关闭当前连续对话 agent 后，从下一条消息开始失效

不包含：

- 管理后台的 agent 配置界面改版
- session 级 prompt、颜色或其他 agent 覆盖配置

## Current Context

当前系统中：

- 全局 agent 元数据由 `src/agent-manager.ts` 和 agent store 管理
- 聊天会话状态保存在 `src/server.ts` 的 `UserChatSession`
- 前端聊天页在 `public/index.html`，顶部 agent 列表目前只支持点击插入 `@Agent`
- `@` 提及解析基于当前全局 agent 列表，没有 session 级过滤

## Proposed Design

### Data Model

在 `UserChatSession` 中新增：

- `enabledAgents?: string[]`

约束：

- 新建 session 时写入 `enabledAgents: []`
- 运行时读取旧 session 且字段缺失时，兼容为“当前全局 agent 全部启用”，避免历史会话被突然锁死
- `enabledAgents` 只保存 agent 名称，真实展示信息仍来自全局 agent 配置
- 如果 session 内保存了已被全局删除的 agent 名称，读取和渲染时自动忽略

### API

保留现有接口，并扩展当前 session 相关返回：

- `GET /api/history`
  - 增加 `enabledAgents`
- `POST /api/sessions`
  - 返回新 session 的 `enabledAgents`
- `POST /api/sessions/select`
  - 返回目标 session 的 `enabledAgents`
- `POST /api/sessions/delete`
  - 返回 fallback active session 的 `enabledAgents`

新增接口：

- `POST /api/session-agents`
  - 请求：`{ sessionId?: string, agentName: string, enabled: boolean }`
  - 响应：`{ success: true, enabledAgents: string[], currentAgentWillExpire: boolean }`

其中 `currentAgentWillExpire` 用于前端提示“你关闭的是当前连续对话 agent，它会从下一条消息开始失效”。

### Chat Behavior

服务端在聊天入口统一按当前 session 的 `enabledAgents` 过滤：

- `@Agent` 仅匹配已启用 agent
- `@所有人` 仅广播给已启用 agent
- 没有显式 `@` 时，仅当 `currentAgent` 仍处于已启用状态才继续连续对话
- 若 `currentAgent` 已被停用，则本条消息开始前自动清空，不再续聊
- 若当前 session 没有任何已启用 agent，则不触发 AI，返回显式提示

### Frontend Interaction

聊天页顶部 `agents-bar` 直接升级为 session 级 agent 管理区：

- 已启用 agent 排在前面，保留当前鲜明样式
- 已停用 agent 排在后面，灰态、不可点击
- 每个 agent tag 内有独立滑块，点击滑块切换当前 session 的启用状态
- 点击 tag 名称区域时，仅已启用 agent 会插入 `@Agent`
- `@` 提示浮层只显示已启用 agent；零启用时不显示 `@所有人`
- 当零启用时，消息区展示引导态，提示用户先启用 agent
- 若关闭当前连续对话 agent，当前对话条保留一条轻提示，直到下一条消息发送后失效

## Error Handling

- 切换 session agent 失败时，前端回滚滑块 UI 并提示错误
- 向零启用 session 发送消息时，前端展示服务端返回的提示，而不是假装发送成功
- 遇到无效 agentName 或已不存在的 agent，接口返回 400

## Testing Strategy

- 服务端集成测试覆盖：
  - 新建 session 默认 `enabledAgents = []`
  - 旧 session 缺字段时兼容读取
  - 停用 agent 不能被 `@`
  - `@所有人` 只命中已启用 agent
  - 当前 agent 被关闭后下一条消息起失效
  - 零启用时返回明确提示
- 前端测试覆盖：
  - 顶部 agent 列表有滑块
  - 已启用在前、停用在后
  - 停用态元素不可点击
  - `@` 提示只展示已启用 agent

## Notes

本次先使用 `enabledAgents` 这一最小模型，不提前引入 session 级 agent 配置 map。若未来需要 session 级 prompt/workdir/优先级，再在独立需求中演进。
