# Session Chain Settings Design

## Goal

为每个聊天 session 增加独立的链式传播配置，让用户可以在控制栏的“会话”面板里设置当前会话的最多传播轮数，以及是否限制同一智能体在单轮中的最多调用次数。

## Scope

包含：

- `UserChatSession` 增加 session 级链路配置字段
- 新建 session 自动继承系统默认传播轮数
- 老 session 缺字段时自动补默认值
- 聊天链式调度逻辑改为优先读取 session 配置
- 新增通用 session 更新接口
- 控制栏“会话”区域增加当前会话设置 UI
- 对链式传播总轮数与单 agent 调用次数增加输入校验与 1000 上限保护

不包含：

- 其他 session 设置项（如 prompt、颜色、模型选择）
- 管理后台 `public-auth/` 的配置页面
- 对链式传播调度算法本身做重构
- 将所有现有全局链路配置全部 session 化

## Current Context

当前系统中：

- `src/server.ts` 通过全局常量 `AGENT_CHAIN_MAX_HOPS` 控制链式传播总跳数，默认来自 `BOT_ROOM_AGENT_CHAIN_MAX_HOPS || 4`
- `src/server.ts` 通过全局常量 `AGENT_CHAIN_MAX_CALLS_PER_TURN` 限制同一 agent 在一轮中最多调用 2 次
- `UserChatSession` 已经支持 session 级状态（如 `enabledAgents`、`agentWorkdirs`）
- `public/index.html` 的控制栏已有“会话”面板与 session 管理区，但尚无 session 级链路配置入口

## Proposed Design

### Data Model

在 `UserChatSession` 中新增：

- `agentChainMaxHops?: number`
- `agentChainMaxCallsPerAgent?: number | null`

运行时规范化后保证：

- `agentChainMaxHops` 为 `1..1000` 的整数
- `agentChainMaxCallsPerAgent` 为 `null` 或 `1..1000` 的整数

默认规则：

- 新建 session 时：
  - `agentChainMaxHops = AGENT_CHAIN_MAX_HOPS`
  - `agentChainMaxCallsPerAgent = null`
- 旧 session 恢复时若字段缺失，也按同样默认值补齐

其中：

- `agentChainMaxHops` 表示该 session 一轮消息处理中最多允许多少次链式传播 hop
- `agentChainMaxCallsPerAgent = null` 表示不限制同一 agent 的重复调用次数

### Validation Rules

后端新增统一规范化逻辑：

- 正整数输入：保存时 clamp 到 `1..1000`
- `agentChainMaxCallsPerAgent` 若传 `null`：表示不限制
- 空字符串、0、负数、小数、非数字：返回 400
- 未在 patch 中出现的字段：不修改

前端也做基础校验，但以后端为准。

### API

新增通用接口：

- `POST /api/sessions/update`

请求：

```json
{
  "sessionId": "xxx",
  "patch": {
    "agentChainMaxHops": 12,
    "agentChainMaxCallsPerAgent": null
  }
}
```

规则：

- `sessionId` 必填
- `patch` 必须至少包含一个受支持字段
- 当前阶段仅允许更新：
  - `agentChainMaxHops`
  - `agentChainMaxCallsPerAgent`

响应：

```json
{
  "success": true,
  "session": { ... },
  "enabledAgents": [...],
  "chatSessions": [...],
  "activeSessionId": "..."
}
```

同时扩展现有会话相关响应，确保前端始终能拿到完整 session 配置：

- `GET /api/history`
- `POST /api/sessions`
- `POST /api/sessions/select`
- `POST /api/sessions/rename`
- `POST /api/sessions/delete`

### Runtime Behavior

链式传播执行时：

- 总传播轮数限制改为使用当前 session 的 `agentChainMaxHops`
- 单 agent 最大调用次数改为使用当前 session 的 `agentChainMaxCallsPerAgent`
  - `null` 时不做该项限制
  - 数字时按该值限制

全局环境变量保留，但职责变化为：

- `BOT_ROOM_AGENT_CHAIN_MAX_HOPS`：仅用于新 session 默认值与旧数据兼容补值
- `BOT_ROOM_AGENT_CHAIN_MAX_CALLS_PER_TURN`：不再作为默认运行限制，保留兼容常量或迁移期辅助逻辑即可；最终运行时默认行为应是 session 级 `null = 不限制`

生效时机：

- 保存成功后，对后续新消息立即生效
- 不追改当前已经开始执行的一轮链式传播

### Frontend Interaction

位置：

- 控制栏 → 会话
- 位于“新建 / 重命名 / 删除”按钮下方
- 增加“当前会话设置”区块

区块内容：

1. `最多传播轮数`
   - 数字输入框
   - 保存按钮

2. `单个智能体最多调用次数`
   - `不限制` 复选框
   - 未勾选时显示数字输入框
   - 保存按钮

交互细节：

- 切换 session 时输入框与复选框同步刷新
- 保存前前端校验正整数
- 若提交值大于 1000，后端按 1000 保存并回传真实值
- 保存成功后显示提示
- 保存失败时提示错误并保持当前 UI 状态与服务端一致

### Error Handling

- session 不存在：返回 400
- patch 为空或字段不支持：返回 400
- 输入非法：返回 400，并给出明确错误信息
- 前端提交失败：显示 alert/toast，并把输入框回退为服务端返回的当前 session 值

## Testing Strategy

服务端集成测试覆盖：

- 新建 session 默认带 `agentChainMaxHops` 与 `agentChainMaxCallsPerAgent`
- 旧 session 缺字段时自动补默认值
- `/api/sessions/update` 可分别更新两个字段
- 非法值返回 400
- 超过 1000 时 clamp 为 1000
- 不同 session 配置互不影响
- 链式传播遵守当前 session 的 `agentChainMaxHops`
- `agentChainMaxCallsPerAgent = null` 时不限制重复调用
- `agentChainMaxCallsPerAgent = n` 时限制生效

前端测试覆盖：

- “会话”面板渲染当前会话设置区块
- 数字输入、复选框与保存按钮存在
- 前端状态从 history/session 接口响应中读取并同步
- 页面脚本包含 session 更新请求逻辑

## Notes

本次采用直接在 `UserChatSession` 顶层增加字段的方式，而不是引入通用 `settings` 对象。原因是当前只增加两个明确字段，直接扩展现有 session 模型更符合仓库风格，也能减少本轮改动面。若未来 session 设置项继续增长，再考虑把多个字段收敛为 `settings` 对象。
