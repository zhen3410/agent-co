# 智能体强制停止设计

**日期：** 2026-04-09
**状态：** 已通过会话讨论确认，待实现
**适用范围：** 聊天室多智能体流式执行与恢复链路

---

## 1. 目标

当前系统已经具备以下基础能力：

- `chat-stream` 通过 SSE 向前端持续推送 `agent_thinking`、`agent_delta`、`agent_message` 等事件；
- 服务端在客户端断开连接时，会通过 `AbortSignal` 中止当前执行；
- 调度器支持把未完成的后续链路保存在 `pendingTasks` 中，并通过 `chat-resume` 继续执行。

但现有能力的“停止”语义主要来自 **连接中断**，而不是 **用户主动发起的强制停止**。因此它无法清晰表达以下两类用户意图：

1. **停止当前正在思考的智能体，但保留后续链路，稍后继续；**
2. **停止整个本次执行，并彻底取消剩余链路。**

本设计目标是补齐这两种显式控制能力，并与现有 `pendingTasks` / `chat-resume` / SSE 推送机制保持一致。

---

## 2. 非目标

本次设计不覆盖以下内容：

- 不做跨会话的全局任务调度中心；
- 不实现“暂停后自动重试”或“定时恢复”；
- 不改变现有 agent 生成内容、回调消息、caller review loop 的业务语义；
- 不引入复杂的执行审计页面，仅补足必要的运行态控制与前端反馈；
- 不在首版支持“停止某个指定排队中的 future task 但不中止当前 task”的细粒度控制。

---

## 3. 用户确认的产品语义

### 3.1 支持两种停止动作

用户已确认两种都支持：

1. **停止当前智能体**
2. **停止整个本次会话执行**

### 3.2 停止当前智能体后的处理

用户已确认：

- 当前智能体应被强制中止；
- **后续待执行链路保留**；
- 用户稍后可通过 `chat-resume` 恢复剩余链路。

### 3.3 停止整个会话后的处理

用户已确认：

- 当前智能体应被强制中止；
- **整个本次执行剩余链路彻底取消**；
- 不再为该轮执行保留可恢复链路。

---

## 4. 方案对比与结论

### 4.1 方案 A：仅复用 SSE 断连

做法：前端点击“停止”后直接断开 `/api/chat-stream` 连接，完全复用已有 `AbortSignal`。

问题：

- 无法区分“停止当前智能体”和“停止整个会话”；
- 停止语义依赖连接层，难以在后端形成明确的执行意图；
- 对恢复链路是否保留的控制不够显式；
- 对未来非浏览器客户端或多控制入口扩展不友好。

### 4.2 方案 B：新增显式执行控制接口

做法：新增独立的执行控制接口，由后端维护会话级活动执行状态；停止时写入 stop scope 并触发对应执行的 abort。

优势：

- 语义清晰；
- 能直接表达“停止当前智能体 / 停止整个执行”；
- 能与 `pendingTasks`、`chat-resume`、SSE 状态反馈形成一致模型；
- 更适合后续扩展暂停、取消、恢复等控制能力。

### 4.3 结论

采用 **方案 B：显式执行控制接口 + 会话级活动执行状态**。

---

## 5. 功能行为定义

### 5.1 停止当前智能体（`scope = 'current_agent'`）

当用户对正在执行的会话发送“停止当前智能体”请求时：

- 当前正在运行的 agent 调用立刻收到 abort；
- 当前 task 视为 **被丢弃**，不再重新排回队列；
- 已排队但尚未开始的后续任务保留在 `pendingTasks`；
- 本次流式执行结束；
- 前端收到显式“已停止当前智能体”的反馈；
- 后续可通过 `POST /api/chat-resume` 继续剩余链路。

### 5.2 停止整个会话执行（`scope = 'session'`）

当用户发送“停止整个会话执行”请求时：

- 当前正在运行的 agent 调用立刻收到 abort；
- 当前 task 被丢弃；
- 所有尚未执行的后续任务全部清空；
- 本次流式执行结束；
- 前端收到显式“本次执行已终止，剩余链路已取消”的反馈；
- 后续 `chat-resume` 不应恢复这轮已取消链路。

### 5.3 无活动执行时的行为

若目标 session 当前没有活动执行：

- stop 请求返回成功响应，但 `stopped: false`；
- 不报错，不影响历史消息与 pending state。

---

## 6. 总体架构

### 6.1 新增会话级活动执行注册表

在 chat runtime 层维护一个“活动执行注册表”，按 `sessionId` 建立索引。每个活动执行项至少包含：

- `sessionId`
- `executionId`
- `abortController`
- `currentAgentName`
- `stopMode: 'none' | 'current_agent' | 'session'`
- `startedAt`

职责：

- 让 stop 接口能找到当前正在执行的 session；
- 让调度器在 abort 后区分本次中止的产品语义；
- 避免旧请求误伤新请求。

### 6.2 每次 chat-stream / chat-resume 都生成 executionId

每次新的流式执行（包括恢复执行）启动时：

- 创建新的 `executionId`；
- 注册到 runtime 的活动执行表；
- 在 agent 切换时更新 `currentAgentName`；
- 在执行结束、异常结束、或 stop 完成后注销。

这样即使用户快速发起新的流式请求，也能用 `executionId` 辨别“当前活动执行”与“已结束执行”。

### 6.3 控制接口与执行链路解耦

- `chat-stream` / `chat-resume` 负责启动执行；
- `chat-stop` 只负责控制活动执行，不直接修改消息历史；
- 调度器在读取到 stopMode 后，决定如何处理当前 task 与剩余 queue；
- `sessionService.updatePendingExecution(...)` 负责把最终保留下来的剩余链路落到 session state。

---

## 7. 接口设计

### 7.1 新增 `POST /api/chat-stop`

请求体建议：

```json
{
  "sessionId": "session-123",
  "scope": "current_agent"
}
```

字段说明：

- `sessionId`：目标会话 ID；若缺省则沿用当前选中的 chat session 解析逻辑；
- `scope`：
  - `current_agent`
  - `session`

成功响应建议：

```json
{
  "success": true,
  "stopped": true,
  "scope": "current_agent"
}
```

若当前无活动执行：

```json
{
  "success": true,
  "stopped": false,
  "scope": "current_agent"
}
```

### 7.2 路由层职责

在 `src/chat/http/chat-routes.ts` 中：

- 增加 `/api/chat-stop` 路由；
- 解析 `sessionId` 与 `scope`；
- 调用 `ChatService` 新增的 stop 能力；
- 对非法 `scope` 返回校验错误。

### 7.3 ChatService 新增 stop 能力

建议为 `ChatService` 增加类似方法：

- `stopExecution(context, payload): Promise<{ success: true; stopped: boolean; scope: ... }>`

其职责：

- 解析目标 session；
- 调用 runtime 的活动执行控制接口；
- 返回 stop 结果给 HTTP 层；
- 不直接承担队列清理逻辑，队列语义由调度器收口。

---

## 8. 运行态数据结构建议

### 8.1 新类型建议

建议新增：

```ts
export type ChatExecutionStopMode = 'none' | 'current_agent' | 'session';

export interface ActiveChatExecution {
  sessionId: string;
  executionId: string;
  abortController: AbortController;
  currentAgentName: string | null;
  stopMode: ChatExecutionStopMode;
  startedAt: number;
}
```

### 8.2 Runtime 暴露的能力

建议在 runtime/types 中增加：

- `registerActiveExecution(sessionId, execution): ActiveChatExecution`
- `getActiveExecution(sessionId): ActiveChatExecution | null`
- `updateActiveExecutionAgent(sessionId, executionId, agentName): void`
- `requestExecutionStop(sessionId, scope): { stopped: boolean; executionId?: string }`
- `consumeExecutionStopMode(sessionId, executionId): ChatExecutionStopMode`
- `clearActiveExecution(sessionId, executionId): void`

关键点：

- `requestExecutionStop` 在写入 `stopMode` 后立刻调用 `abortController.abort()`；
- `consumeExecutionStopMode` 只读取当前 execution 的 stopMode，避免不同 execution 串扰；
- `clearActiveExecution` 应以 `executionId` 为 guard，只清理当前这次执行自己的注册项。

---

## 9. 调度器改造

核心改造点位于 `src/chat/application/chat-dispatch-orchestrator.ts` 的 `executeAgentTurn()`。

### 9.1 现状

当前中断逻辑更偏向“连接断开”语义：

- 若 `runAgentTask()` 返回后发现 `signal.aborted` 且没有可见消息；
- 会将当前 `task` 重新 `unshift` 回队列；
- 然后把剩余 queue 作为 `pendingTasks` 返回。

这适合客户端掉线后恢复当前未完成 task，但不适合“用户明确要求停止当前智能体”。

### 9.2 目标行为

调度器在检测到 `signal.aborted` 后，需继续判断这是不是一次**显式 stop**。建议流程：

1. 通过 runtime 读取当前 execution 的 `stopMode`；
2. 若 `stopMode = 'current_agent'`：
   - 当前 task **不回队**；
   - 保留当前 queue 中尚未执行的任务；
   - 返回剩余 queue 作为 `pendingTasks`；
3. 若 `stopMode = 'session'`：
   - 当前 task 不回队；
   - 清空 queue；
   - 返回空 `pendingTasks`；
4. 若没有显式 stop（例如纯连接中断）：
   - 保持当前兼容行为：当前 task 可回队，供 resume 后继续。

### 9.3 为什么 stop 语义必须与 disconnect 分离

原因如下：

- “连接断开”未必表示用户不想继续当前 task；
- “停止当前智能体”明确要求 **丢弃当前 task**；
- “停止整个会话”明确要求 **丢弃当前 task + 丢弃剩余 queue**；
- 这三种产品语义不同，不能继续共用单一 abort 分支。

### 9.4 onThinking / currentAgent 同步

调度器在每次真正开始执行一个 task 前，应更新 runtime 中该 execution 的 `currentAgentName`，以便：

- stop 接口返回时能知道当前停止的是谁；
- SSE 停止事件能带上 `currentAgent`；
- 前端能提示“已停止 Alice”。

---

## 10. SSE 与前端状态反馈

### 10.1 现状问题

当前 SSE 的完成与异常反馈主要有：

- `agent_thinking`
- `agent_delta`
- `agent_message`
- `notice`
- `error`
- `done`

这些事件不足以区分：

- 正常完成；
- 客户端断连；
- 用户主动停止当前智能体；
- 用户主动停止整个会话。

### 10.2 新增 `execution_stopped` 事件

建议新增 SSE 事件：

- `execution_stopped`

数据建议：

```json
{
  "scope": "current_agent",
  "currentAgent": "Alice",
  "resumeAvailable": true
}
```

或：

```json
{
  "scope": "session",
  "currentAgent": "Alice",
  "resumeAvailable": false
}
```

### 10.3 SSE 层职责

在 `runChatSse()` 中：

- 执行结束后除了现有 `done`，还要能根据执行结果发送 `execution_stopped`；
- 若本次停止是显式 stop，则优先发送 `execution_stopped`，再结束流；
- `done` 是否保留可实现为：
  - 正常完成发送 `done`
  - 显式 stop 发送 `execution_stopped` 后直接 `end`

建议首版采用后一种，避免前端把“已停止”误判为“正常完成”。

---

## 11. 前端交互设计

### 11.1 按钮位置

在已有“思考中”展示区域附近增加控制入口：

- `停止当前智能体`
- `停止本次执行`

触发条件：

- 仅在当前存在 thinking agent / 活动流式执行时显示或启用。

### 11.2 点击行为

- 点击按钮后调用 `POST /api/chat-stop`；
- 使用当前 sessionId 和对应 scope；
- 请求发出后按钮进入短暂 loading / disabled 状态，防止重复点击。

### 11.3 收到停止事件后的 UI 更新

若收到：

```json
{ "scope": "current_agent", "resumeAvailable": true }
```

则：

- 移除 thinking indicator；
- 状态文案更新为：`已停止当前智能体，可继续剩余链路`；
- 保留“继续执行”入口。

若收到：

```json
{ "scope": "session", "resumeAvailable": false }
```

则：

- 移除 thinking indicator；
- 状态文案更新为：`已停止本次执行，剩余链路已取消`；
- 不再展示 resume 入口。

---

## 12. 对现有恢复语义的影响

### 12.1 停止当前智能体

恢复行为应保持：

- `chat-resume` 只恢复 **未执行的后续链路**；
- 被用户显式停止的当前 task 不应重新执行；
- 已经成功落库的可见消息不重复发送。

### 12.2 停止整个会话

恢复行为应变为：

- `chat-resume` 返回 `resumed: false` 或等价无任务状态；
- 不再恢复被用户主动取消的这轮链路。

---

## 13. 错误处理与边界条件

### 13.1 活动执行已结束但 stop 请求晚到

若 stop 请求抵达时该 execution 已结束并清理：

- 返回 `stopped: false`；
- 不视为错误。

### 13.2 快速切换执行导致的串扰

若用户上一轮 stop 发出时，新的 `chat-stream` 已开始：

- stop 只能命中当前 active execution；
- 旧 execution 清理时不能误删新 execution；
- 因此所有 clear/update 操作必须带 `executionId` guard。

### 13.3 当前 agent 已有部分 delta 输出

若当前 agent 在 stop 前已输出过部分 delta，但尚未形成最终可见消息：

- 首版允许前端只把这部分视为“中途被停止”；
- 不要求服务端把 delta 组装成最终 assistant message；
- 当前 task 仍视为已丢弃，不进入 resume。

### 13.4 与 caller review / internal review 任务的关系

stop 语义对 task 类型一视同仁：

- `current_agent`：仅丢弃当前正在执行的那个 task，保留剩余 queue；
- `session`：丢弃当前 task 并清空整个剩余 queue。

这样可以避免在 stop 时引入额外的 review 特判复杂度。

---

## 14. 文件改动范围建议

### 14.1 HTTP / API

- `src/chat/http/chat-routes.ts`
  - 新增 `/api/chat-stop` 路由
- `src/chat/http/chat-sse.ts`
  - 透传停止结果，发送 `execution_stopped`

### 14.2 Application

- `src/chat/application/chat-service-types.ts`
  - 增加 stop request/result 类型
  - 扩展 stream execution result 以承载 stopped metadata
- `src/chat/application/chat-service.ts`
  - 新增 `stopExecution(...)`
  - 在 stream / resume 启动时注册 active execution
- `src/chat/application/chat-dispatch-orchestrator.ts`
  - 区分 disconnect abort 与 explicit stop abort
  - 依据 stopMode 决定是否回队 / 清队
- `src/chat/application/chat-agent-execution.ts`
  - 维持现有 signal 透传；必要时补充 stopped 日志

### 14.3 Runtime

- `src/chat/runtime/chat-runtime-types.ts`
  - 增加 active execution 类型与 runtime 能力声明
- `src/chat/runtime/chat-runtime.ts`
  - 挂接 active execution 管理能力
- 如已有独立 state 文件，也可放到：
  - `src/chat/runtime/chat-session-state.ts`
  - 或新增 focused module，例如 `chat-active-execution-state.ts`

### 14.4 Frontend

- `public/index.html`
  - 增加停止按钮
  - 处理 `execution_stopped` 事件
  - 更新状态文案与 resume 入口逻辑
- 若有样式：
  - `public/styles.css`

### 14.5 Tests

- `tests/integration/chat-server.integration.test.js`
  - stop 当前智能体
  - stop 整个会话
  - stop 与 resume 协同
- 如 session state 持久化相关需要覆盖：
  - `tests/integration/chat-server-session-block.integration.test.js`

---

## 15. 测试策略

### 15.1 必测场景

1. **停止当前智能体时保留后续链路**
   - 当前 task 被 abort；
   - 当前 task 不重新执行；
   - 后续 `pendingTasks` 被保存；
   - `chat-resume` 只继续剩余链路。

2. **停止整个会话时清空后续链路**
   - 当前 task 被 abort；
   - 剩余 queue 被清空；
   - `chat-resume` 不再恢复这轮链路。

3. **无活动执行时 stop**
   - 返回 `stopped: false`；
   - 不报错。

4. **executionId 防串扰**
   - stop 不误伤已结束执行；
   - 旧 execution 的清理不误删新 execution。

5. **SSE 事件正确性**
   - 显式 stop 时推送 `execution_stopped`；
   - 正常完成时仍推送 `done`；
   - 前端据此区分状态。

### 15.2 建议测试方法

优先沿用现有集成测试风格：

- 构造可控的假 agent / fake stream；
- 在收到 `agent_thinking` 后触发 stop；
- 断言后续消息序列、pending state、resume 结果与前端事件。

---

## 16. 向后兼容性

本设计应保持以下兼容性：

- 现有未使用 stop 功能的普通聊天流程不受影响；
- 纯客户端断流语义保持原有“可恢复当前任务”的逻辑；
- `chat-resume` 对历史会话和已有 pendingTasks 的处理方式保持兼容；
- 未升级前端按钮时，后端 stop API 不影响原有页面功能。

---

## 17. 最终结论

本设计通过引入：

- 会话级活动执行注册表；
- 显式 `chat-stop` 控制接口；
- stop scope 区分；
- 调度器对 abort 原因的细分；
- SSE `execution_stopped` 事件；

实现两种用户可理解且可恢复/可取消语义明确的停止能力：

1. **停止当前智能体，保留后续链路可恢复**；
2. **停止整个执行，彻底取消剩余链路**。

该方案与现有系统的 `AbortSignal`、`pendingTasks`、`chat-resume`、SSE 推送机制自然衔接，改动面可控，且为后续更细粒度的执行控制能力预留了清晰扩展点。
