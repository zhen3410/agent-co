# Agent Caller Review Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all agent-to-agent invocations enter a caller-owned review loop so the caller can accept, follow up, or retry when the callee gives no reply or an insufficient reply.

**Architecture:** Extend session/runtime state with lightweight invocation tasks instead of overloading message history with mutable workflow state. Rework dispatch orchestration so every agent-originated call creates a tracked task, every callee reply is routed back to the caller for review, and timeout/retry paths are handled by the same review mechanism with bounded retry limits.

**Tech Stack:** TypeScript, Node.js HTTP server, in-memory/Redis-backed chat runtime persistence, Node test runner (`node:test`), assert/strict integration tests.

---

## File Map

### Shared types and persisted session state
- Modify: `src/types.ts`
  - Add invocation-review metadata for messages and task status unions.
- Modify: `src/chat/infrastructure/chat-session-repository.ts`
  - Persist tracked invocation tasks on the session object.
- Modify: `src/chat/runtime/chat-runtime-types.ts`
  - Add runtime APIs and normalized session types for invocation tasks.
- Modify: `src/chat/runtime/chat-runtime.ts`
  - Wire new invocation-task runtime helpers into the composed runtime.
- Modify: `src/chat/runtime/chat-session-state.ts`
  - Normalize persisted task state and keep session updates touching invocation state.

### Dispatch and execution flow
- Modify: `src/chat/application/chat-service-types.ts`
  - Extend dispatch task/result types with invocation-task metadata.
- Modify: `src/chat/application/chat-dispatch-orchestrator.ts`
  - Create invocation tasks, correlate callee replies, enqueue caller review turns, and schedule retry/timeout continuations.
- Modify: `src/chat/application/chat-agent-execution.ts`
  - Preserve reply metadata from callback/direct messages so orchestration can correlate task results.
- Modify: `src/chat/domain/agent-chain-policy.ts`
  - Add policy helpers for retry/follow-up caps and timeout eligibility.

### Agent behavior and prompts
- Modify: `data/agents.json`
  - Tell collaborative agents that, when they are reviewing a delegated result, they must explicitly output `accept`, `follow_up`, or `retry` with a concise reason and next prompt.

### Tests
- Modify: `tests/integration/chat-server.integration.test.js`
  - Cover reply review, insufficient-reply follow-up, and timeout retry behavior.
- Modify: `tests/integration/chat-server-session-block.integration.test.js`
  - Cover persistence/resume of pending invocation tasks if orchestration pauses mid-loop.
- Modify: `tests/unit/*.unit.test.js` or create `tests/unit/agent-chain-policy.unit.test.js`
  - Cover helper policy functions for retry/follow-up limits and timeout gating.

### References
- Reference: `docs/superpowers/plans/2026-04-04-peer-discussion-mode.md`
- Reference existing orchestration: `src/chat/application/chat-dispatch-orchestrator.ts`
- Reference existing session persistence: `src/chat/runtime/chat-runtime.ts`

---

## Implementation Notes / Constraints

- All agent-to-agent invocations default into this loop, not only explicit `@@agent` chaining.
- User-originated `@agent` messages do not create a caller review loop because the user is not an autonomous reviewer.
- `summary` dispatches must remain outside the review loop.
- Keep retry/follow-up limits bounded to prevent infinite loops. Recommended defaults: `maxFollowUps = 2`, `maxRetries = 1`.
- Timeout handling should reuse the same caller-review flow instead of inventing a second recovery path.
- Preserve backward compatibility for sessions that have no invocation-task state persisted.
- Follow TDD: write tests first, verify failure, implement the minimum code to pass, then run focused regression coverage.

---

### Task 1: Add invocation-task state and message metadata

**Files:**
- Modify: `src/types.ts`
- Modify: `src/chat/infrastructure/chat-session-repository.ts`
- Modify: `src/chat/runtime/chat-runtime-types.ts`
- Modify: `src/chat/runtime/chat-session-state.ts`
- Test: `tests/integration/chat-server-session-block.integration.test.js`

- [ ] **Step 1: Write the failing persistence/session tests**

Add coverage that asserts:
- session payloads can persist invocation tasks alongside history
- legacy sessions without invocation tasks still hydrate cleanly
- pending invocation tasks survive pause/resume normalization

Suggested test names:
```js
test('会话状态可持久化待复核的 agent 调用任务', async () => {})
test('旧会话缺少 invocationTasks 字段时仍可正常恢复', async () => {})
```

- [ ] **Step 2: Run the targeted session tests to verify failure**

Run:
```bash
node --test tests/integration/chat-server-session-block.integration.test.js
```

Expected: FAIL because invocation-task state is not modeled or normalized yet.

- [ ] **Step 3: Add shared types for invocation review**

In `src/types.ts`, add narrow unions and metadata similar to:
```ts
export type InvocationTaskStatus =
  | 'pending_reply'
  | 'awaiting_caller_review'
  | 'completed'
  | 'failed'
  | 'timed_out';

export type InvocationReviewAction = 'accept' | 'follow_up' | 'retry';
```

Add optional message metadata for correlation only, such as:
```ts
taskId?: string;
parentTaskId?: string;
callerAgentName?: string;
calleeAgentName?: string;
reviewAction?: InvocationReviewAction;
```

- [ ] **Step 4: Persist invocation tasks on the session object**

Extend `UserChatSession` in `src/chat/infrastructure/chat-session-repository.ts` with a focused `invocationTasks?: InvocationTask[]` field and normalize it in runtime/session-state code. Keep the runtime task record separate from user-visible history fields that can change later.

- [ ] **Step 5: Expose runtime helpers**

Add runtime helper signatures in `src/chat/runtime/chat-runtime-types.ts` / `src/chat/runtime/chat-runtime.ts` for:
- creating/updating an invocation task
- listing active invocation tasks for a session
- resolving overdue tasks
- marking tasks completed/failed

- [ ] **Step 6: Run the targeted session tests again**

Run:
```bash
node --test tests/integration/chat-server-session-block.integration.test.js
```

Expected: PASS for the new persistence coverage.

- [ ] **Step 7: Commit the session state groundwork**

```bash
git add src/types.ts src/chat/infrastructure/chat-session-repository.ts src/chat/runtime/chat-runtime-types.ts src/chat/runtime/chat-runtime.ts src/chat/runtime/chat-session-state.ts tests/integration/chat-server-session-block.integration.test.js
git commit -m "feat: persist agent invocation review tasks"
```

---

### Task 2: Track every agent-to-agent invocation as a reviewable task

**Files:**
- Modify: `src/chat/application/chat-service-types.ts`
- Modify: `src/chat/application/chat-dispatch-orchestrator.ts`
- Test: `tests/integration/chat-server.integration.test.js`

- [ ] **Step 1: Write the failing orchestration test for task creation**

Add a test that verifies:
- when agent A triggers agent B, the system creates a pending invocation task
- the task records `callerAgentName`, `calleeAgentName`, `deadlineAt`, `retryCount`, and `followupCount`
- user-originated messages do not create such tasks

Suggested test names:
```js
test('agent 间调用会默认创建待复核任务', async () => {})
test('用户直接 @agent 不会创建调用者复核任务', async () => {})
```

- [ ] **Step 2: Run the targeted orchestration tests to verify failure**

Run:
```bash
node --test tests/integration/chat-server.integration.test.js
```

Expected: FAIL because the orchestrator does not track caller-owned tasks yet.

- [ ] **Step 3: Extend dispatch task payloads**

In `src/chat/application/chat-service-types.ts`, add metadata to `AgentDispatchTask` / `PendingAgentDispatchTask` for:
- `taskId`
- `callerAgentName`
- `reviewMode?: 'none' | 'caller_review'`
- `deadlineAt`

Keep the type additions minimal and optional for backward compatibility.

- [ ] **Step 4: Create tasks when one agent invokes another**

In `src/chat/application/chat-dispatch-orchestrator.ts`, when a visible assistant message queues another agent:
- generate a task id
- persist an invocation task record on the session
- enqueue the callee with task metadata
- skip this path for `summary` dispatches and user-originated invocations

- [ ] **Step 5: Run the targeted orchestration tests again**

Run:
```bash
node --test tests/integration/chat-server.integration.test.js
```

Expected: PASS for task-creation coverage, with other new tests still failing until later tasks land.

- [ ] **Step 6: Commit the task-creation flow**

```bash
git add src/chat/application/chat-service-types.ts src/chat/application/chat-dispatch-orchestrator.ts tests/integration/chat-server.integration.test.js
git commit -m "feat: track agent invocation review tasks"
```

---

### Task 3: Route callee replies back to the caller for review

**Files:**
- Modify: `src/chat/application/chat-agent-execution.ts`
- Modify: `src/chat/application/chat-dispatch-orchestrator.ts`
- Modify: `data/agents.json`
- Test: `tests/integration/chat-server.integration.test.js`

- [ ] **Step 1: Write the failing review-loop tests**

Add tests that verify:
- B replies with substantive output, then A receives a hidden/system review turn and marks the task accepted
- B replies with an acknowledgement-only answer, then A follows up instead of closing the task

Suggested test names:
```js
test('被调用者回复会回传给调用者做 accept 复核', async () => {})
test('被调用者敷衍回复时调用者会自动 follow_up', async () => {})
```

- [ ] **Step 2: Run the targeted tests to verify failure**

Run:
```bash
node --test tests/integration/chat-server.integration.test.js
```

Expected: FAIL because callee output is not correlated to a caller review step.

- [ ] **Step 3: Preserve correlation metadata on visible replies**

In `src/chat/application/chat-agent-execution.ts`, ensure callback/direct visible messages inherit `taskId`, `callerAgentName`, and `calleeAgentName` from the dispatch task so the orchestrator can match the reply to the correct invocation task.

- [ ] **Step 4: Add caller review turns in the orchestrator**

When a callee reply arrives for a tracked task:
- mark the task `awaiting_caller_review`
- enqueue a new turn for the caller agent with a concise review prompt that includes:
  - original delegation request
  - callee reply
  - allowed outputs: `accept`, `follow_up`, `retry`
- parse the caller’s review result and either:
  - close the task as `completed`
  - enqueue a follow-up task back to the same callee
  - enqueue a retry back to the same callee

- [ ] **Step 5: Strengthen collaborative agent prompts**

Update `data/agents.json` so collaborative agents know:
- delegated work should be answered directly, not with “收到/稍后”
- review turns must output one of `accept` / `follow_up` / `retry`
- follow-up/retry should include the next concrete ask

- [ ] **Step 6: Run the targeted review-loop tests again**

Run:
```bash
node --test tests/integration/chat-server.integration.test.js
```

Expected: PASS for the new review-loop behavior.

- [ ] **Step 7: Commit the caller-review flow**

```bash
git add src/chat/application/chat-agent-execution.ts src/chat/application/chat-dispatch-orchestrator.ts data/agents.json tests/integration/chat-server.integration.test.js
git commit -m "feat: add caller review loop for agent replies"
```

---

### Task 4: Add timeout-driven retry through the same caller review path

**Files:**
- Modify: `src/chat/domain/agent-chain-policy.ts`
- Modify: `src/chat/application/chat-dispatch-orchestrator.ts`
- Modify: `src/chat/runtime/chat-runtime-types.ts`
- Test: `tests/unit/agent-chain-policy.unit.test.js`
- Test: `tests/integration/chat-server.integration.test.js`

- [ ] **Step 1: Write failing tests for timeout retry behavior**

Add coverage that verifies:
- if B never replies before `deadlineAt`, A receives a timeout review turn
- A can emit `retry`, which requeues B once
- exceeding retry/follow-up caps marks the task failed and stops the loop

Suggested test names:
```js
test('被调用者超时未回复时调用者会自动 retry', async () => {})
test('超过重试或追问上限后任务会失败并停止', async () => {})
```

For policy helpers, add unit tests similar to:
```js
test('timeout retry policy blocks retry after max retries', () => {})
test('follow_up policy blocks follow up after max follow ups', () => {})
```

- [ ] **Step 2: Run the targeted tests to verify failure**

Run:
```bash
node --test tests/unit/*.unit.test.js
node --test tests/integration/chat-server.integration.test.js
```

Expected: FAIL because there is no timeout review/retry handling yet.

- [ ] **Step 3: Add bounded retry/follow-up policy helpers**

In `src/chat/domain/agent-chain-policy.ts`, add helpers for:
- `isInvocationTaskOverdue`
- `canRetryInvocationTask`
- `canFollowUpInvocationTask`

Keep limits explicit and centrally defined.

- [ ] **Step 4: Sweep overdue tasks before/after turn execution**

In `src/chat/application/chat-dispatch-orchestrator.ts`, before exiting an execution pass:
- scan active invocation tasks for expired deadlines
- enqueue caller review turns for timed-out tasks
- when caller chooses retry, update the task counters and new deadline

- [ ] **Step 5: Run the targeted tests again**

Run:
```bash
node --test tests/unit/*.unit.test.js
node --test tests/integration/chat-server.integration.test.js
```

Expected: PASS for timeout and cap behavior.

- [ ] **Step 6: Commit timeout retry support**

```bash
git add src/chat/domain/agent-chain-policy.ts src/chat/application/chat-dispatch-orchestrator.ts src/chat/runtime/chat-runtime-types.ts tests/unit/agent-chain-policy.unit.test.js tests/integration/chat-server.integration.test.js
git commit -m "feat: retry timed out agent invocations via caller review"
```

---

### Task 5: Verify resume/stream behavior and prevent regressions

**Files:**
- Modify: `tests/integration/chat-server-session-block.integration.test.js`
- Modify: `tests/integration/chat-server.integration.test.js`
- Modify: implementation files only if regression fixes are needed

- [ ] **Step 1: Add failing regression tests for paused/resumed review loops**

Add tests that verify:
- if streaming stops mid-loop, pending invocation tasks survive and resume cleanly
- classic peer discussion pause semantics still work when there are no invocation tasks
- summary mode still bypasses caller review

Suggested test names:
```js
test('断流后恢复执行时会继续待复核的调用闭环', async () => {})
test('summary 调度不会进入调用者复核闭环', async () => {})
```

- [ ] **Step 2: Run the focused regression suite to verify failure**

Run:
```bash
node --test tests/integration/chat-server-session-block.integration.test.js
node --test tests/integration/chat-server.integration.test.js
```

Expected: FAIL until resume/summary edges are handled.

- [ ] **Step 3: Implement minimal regression fixes**

Adjust orchestration/runtime persistence so pending invocation review turns are stored alongside other pending tasks and restored without duplicating already-completed tasks.

- [ ] **Step 4: Run the focused regression suite**

Run:
```bash
node --test tests/integration/chat-server-session-block.integration.test.js
node --test tests/integration/chat-server.integration.test.js
```

Expected: PASS for the new resume/summary coverage and no regressions to nearby discussion-mode behavior.

- [ ] **Step 5: Run final targeted verification**

Run:
```bash
npm run build
node --test tests/unit/*.unit.test.js
node --test tests/integration/chat-server.integration.test.js
node --test tests/integration/chat-server-session-block.integration.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit the finish-up work**

```bash
git add tests/integration/chat-server.integration.test.js tests/integration/chat-server-session-block.integration.test.js src/chat/application/chat-dispatch-orchestrator.ts src/chat/runtime/chat-runtime.ts
git commit -m "test: cover agent caller review loop"
```
