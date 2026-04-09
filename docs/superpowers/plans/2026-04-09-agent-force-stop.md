# Agent Force Stop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit stop controls so users can stop the current agent while preserving later pending tasks, or stop the whole execution and discard the remaining chain.

**Architecture:** Introduce a session-scoped active execution registry in chat runtime, wire stream/resume execution through that registry, and add an explicit `/api/chat-stop` control path. Rework orchestration to distinguish client disconnect from explicit stop intent, then surface stop results to the frontend with a dedicated SSE event and UI controls.

**Tech Stack:** TypeScript, Node.js HTTP server, in-memory/Redis-backed chat runtime persistence, Node test runner (`node:test`), assert/strict, browser UI in `public/index.html`.

---

## File Map

### Shared types and public contracts
- Modify: `src/types.ts`
  - Add execution stop mode and stopped-result metadata types shared across runtime/application boundaries.
- Modify: `src/chat/application/chat-service-types.ts`
  - Add stop request/result types, active execution context types, and extend stream/SSE result payloads with stopped metadata.

### Runtime active execution registry
- Modify: `src/chat/runtime/chat-runtime-types.ts`
  - Add `ActiveChatExecution` type plus runtime method signatures for register/update/stop/consume/clear flows.
- Modify: `src/chat/runtime/chat-runtime.ts`
  - Compose new active-execution state into the runtime object.
- Create: `src/chat/runtime/chat-active-execution-state.ts`
  - Encapsulate session-scoped active execution registry and guard logic keyed by `executionId`.

### HTTP + application service flow
- Modify: `src/chat/http/chat-routes.ts`
  - Add `POST /api/chat-stop` route.
- Modify: `src/chat/http/chat-sse.ts`
  - Carry stopped metadata from execution results to a new `execution_stopped` SSE event.
- Modify: `src/chat/application/chat-service.ts`
  - Register active executions for `streamMessage`, add `stopExecution`, and preserve pending execution state according to stop results.
- Modify: `src/chat/application/chat-resume-service.ts`
  - Run resume flow through the active execution registry so resumed chains can also be stopped explicitly.

### Dispatch/orchestration behavior
- Modify: `src/chat/application/chat-dispatch-orchestrator.ts`
  - Distinguish disconnect abort from explicit `current_agent` / `session` stop and decide whether to requeue current work.
- Modify: `src/chat/application/chat-agent-execution.ts`
  - Preserve current signal behavior and emit clearer stopped logs where useful.

### Frontend UI
- Modify: `public/index.html`
  - Add stop buttons, call `/api/chat-stop`, handle `execution_stopped`, and update status/resume UI.
- Modify: `public/styles.css`
  - Style stop actions near the streaming/thinking controls.

### Tests
- Modify: `tests/integration/chat-server.integration.test.js`
  - Add end-to-end coverage for stopping current agent, stopping whole execution, stop-with-resume, and SSE stop events.
- Modify: `tests/integration/frontend-react-bindings.integration.test.js`
  - Assert the frontend HTML/JS wiring includes stop controls and `execution_stopped` handling.
- Optional Modify if needed: `tests/integration/chat-server-service-boundaries.integration.test.js`
  - Cover the new ChatService stop API contract if a focused boundary test is cleaner than pushing all checks into the broad integration suite.

### References
- Spec: `docs/superpowers/specs/2026-04-09-agent-force-stop-design.md`
- Existing stream route: `src/chat/http/chat-sse.ts`
- Existing orchestration: `src/chat/application/chat-dispatch-orchestrator.ts`
- Existing resume flow: `src/chat/application/chat-resume-service.ts`

---

## Implementation Notes / Constraints

- Preserve current behavior for plain client disconnects: the in-flight task may still be resumed later.
- Explicit `scope = 'current_agent'` must **drop only the current task** and keep remaining queue items resumable.
- Explicit `scope = 'session'` must **drop current task and clear remaining queue items**.
- Active execution cleanup must be guarded by `executionId` so an old request cannot clear a newer execution.
- `chat-stop` should be safe when nothing is running and return `stopped: false` instead of erroring.
- `chat-resume` must not resurrect a task explicitly dropped by stop.
- Prefer small focused helpers over bloating `chat-service.ts` or `chat-runtime.ts`.
- Follow TDD: write failing tests first, run them, implement the minimum passing change, then rerun focused regressions.

---

### Task 1: Model active execution and stop contracts

**Files:**
- Modify: `src/types.ts`
- Modify: `src/chat/application/chat-service-types.ts`
- Modify: `src/chat/runtime/chat-runtime-types.ts`
- Test: `tests/integration/chat-server-service-boundaries.integration.test.js` (or `tests/integration/chat-server.integration.test.js` if that suite already owns the assertions)

- [ ] **Step 1: Write the failing contract tests**

Add focused coverage for the new stop-facing types/contracts, for example:
- `ChatService` exposes `stopExecution(...)`
- stream/SSE execution results can carry stopped metadata
- invalid stop scope is rejected by service or route validation

Suggested test names:
```js
test('ChatService 暴露 stopExecution 能力', async () => {})
test('显式停止结果会携带 stopped 元数据', async () => {})
```

- [ ] **Step 2: Run the focused contract tests to verify failure**

Run:
```bash
node --test tests/integration/chat-server-service-boundaries.integration.test.js
```

Expected: FAIL because stop contracts and stopped result types do not exist yet.

- [ ] **Step 3: Add shared stop-mode types**

In `src/types.ts`, add narrow shared unions such as:
```ts
export type ChatExecutionStopMode = 'none' | 'current_agent' | 'session';
```

Only add types that truly need to cross module boundaries.

- [ ] **Step 4: Extend chat service contracts**

In `src/chat/application/chat-service-types.ts`, add exact request/result types, for example:
```ts
export interface StopExecutionRequest {
  sessionId?: string;
  scope: Exclude<ChatExecutionStopMode, 'none'>;
}

export interface StoppedExecutionMetadata {
  scope: Exclude<ChatExecutionStopMode, 'none'>;
  currentAgent: string | null;
  resumeAvailable: boolean;
}
```

Then extend stream execution result types and the `ChatService` interface with `stopExecution(...)`.

- [ ] **Step 5: Extend runtime method signatures**

In `src/chat/runtime/chat-runtime-types.ts`, add `ActiveChatExecution` plus signatures for:
- register active execution
- get/update active execution
- request stop
- consume stop mode/result
- clear active execution by `executionId`

Keep the runtime interface narrow and explicit.

- [ ] **Step 6: Run the focused contract tests again**

Run:
```bash
node --test tests/integration/chat-server-service-boundaries.integration.test.js
```

Expected: PASS for the new contract assertions.

- [ ] **Step 7: Commit the contract groundwork**

```bash
git add src/types.ts src/chat/application/chat-service-types.ts src/chat/runtime/chat-runtime-types.ts tests/integration/chat-server-service-boundaries.integration.test.js
git commit -m "feat: add chat execution stop contracts"
```

---

### Task 2: Add runtime active execution registry

**Files:**
- Create: `src/chat/runtime/chat-active-execution-state.ts`
- Modify: `src/chat/runtime/chat-runtime.ts`
- Modify: `src/chat/runtime/chat-runtime-types.ts`
- Test: `tests/integration/chat-server.integration.test.js`

- [ ] **Step 1: Write the failing runtime/integration tests**

Add coverage that proves:
- a session can register one active execution
- `currentAgentName` can be updated for that execution
- requesting stop records the requested scope and aborts the controller
- clearing by stale `executionId` does not remove a newer execution

Suggested test names:
```js
test('活动执行状态可记录停止范围并触发 abort', async () => {})
test('旧 executionId 不能清理新活动执行', async () => {})
```

- [ ] **Step 2: Run the targeted integration tests to verify failure**

Run:
```bash
node --test tests/integration/chat-server.integration.test.js
```

Expected: FAIL because no active execution registry exists yet.

- [ ] **Step 3: Implement a focused active execution state module**

Create `src/chat/runtime/chat-active-execution-state.ts` with an in-memory registry keyed by `sessionId`. Provide helpers along these lines:
```ts
registerActiveExecution(sessionId, execution)
getActiveExecution(sessionId)
updateActiveExecutionAgent(sessionId, executionId, agentName)
requestExecutionStop(sessionId, scope)
consumeExecutionStopMode(sessionId, executionId)
clearActiveExecution(sessionId, executionId)
```

Make `clearActiveExecution` a guarded no-op on mismatched ids.

- [ ] **Step 4: Compose the registry into runtime**

In `src/chat/runtime/chat-runtime.ts`, instantiate the new state module and expose its methods through the returned `ChatRuntime` object.

- [ ] **Step 5: Add operational logging around stop registration**

Log key state changes such as register / stop request / guarded clear to aid debugging, but keep logs concise.

- [ ] **Step 6: Run the targeted integration tests again**

Run:
```bash
node --test tests/integration/chat-server.integration.test.js
```

Expected: PASS for the new active-execution coverage, with later stop-flow tests still failing.

- [ ] **Step 7: Commit the runtime registry**

```bash
git add src/chat/runtime/chat-active-execution-state.ts src/chat/runtime/chat-runtime.ts src/chat/runtime/chat-runtime-types.ts tests/integration/chat-server.integration.test.js
git commit -m "feat: track active chat executions"
```

---

### Task 3: Add stop API and stream-service registration

**Files:**
- Modify: `src/chat/http/chat-routes.ts`
- Modify: `src/chat/application/chat-service.ts`
- Modify: `src/chat/application/chat-service-types.ts`
- Test: `tests/integration/chat-server.integration.test.js`

- [ ] **Step 1: Write the failing API tests**

Add tests that verify:
- `POST /api/chat-stop` returns `stopped: false` when nothing is active
- invalid `scope` returns validation failure
- stop against an active stream returns `stopped: true` and the requested scope

Suggested test names:
```js
test('chat-stop 在无活动执行时返回 stopped false', async () => {})
test('chat-stop 可停止当前活动执行并返回 scope', async () => {})
```

- [ ] **Step 2: Run the targeted API tests to verify failure**

Run:
```bash
node --test tests/integration/chat-server.integration.test.js
```

Expected: FAIL because `/api/chat-stop` does not exist and `ChatService` cannot stop executions.

- [ ] **Step 3: Add route parsing and validation**

In `src/chat/http/chat-routes.ts`, add `/api/chat-stop` with body parsing similar to other chat APIs. Validate `scope` strictly against `current_agent` and `session`.

- [ ] **Step 4: Add `stopExecution(...)` to ChatService**

In `src/chat/application/chat-service.ts`, implement a focused service method that:
- resolves the target session
- calls `runtime.requestExecutionStop(session.id, scope)`
- returns `{ success: true, stopped, scope }`

Do not let this method manipulate `pendingAgentTasks` directly.

- [ ] **Step 5: Register active executions for stream runs**

Still in `src/chat/application/chat-service.ts`, wrap `streamMessage` with:
- `const executionId = buildMessageId()` (or a dedicated helper)
- `const controller = callbacks.signal ?? new AbortController()` only if contract requires; otherwise register the existing signal/controller pair via SSE layer changes in later tasks
- runtime registration before dispatch starts
- cleanup in `finally`

If a small helper like `withRegisteredExecution(...)` keeps the function readable, add it inside the same file for now.

- [ ] **Step 6: Run the targeted API tests again**

Run:
```bash
node --test tests/integration/chat-server.integration.test.js
```

Expected: PASS for route/service stop basics, while orchestration and SSE-specific stop behavior may still fail.

- [ ] **Step 7: Commit the API/service wiring**

```bash
git add src/chat/http/chat-routes.ts src/chat/application/chat-service.ts src/chat/application/chat-service-types.ts tests/integration/chat-server.integration.test.js
git commit -m "feat: add chat stop api"
```

---

### Task 4: Make the orchestrator honor explicit stop scopes

**Files:**
- Modify: `src/chat/application/chat-dispatch-orchestrator.ts`
- Modify: `src/chat/application/chat-service-types.ts`
- Modify: `src/chat/application/chat-agent-execution.ts`
- Test: `tests/integration/chat-server.integration.test.js`

- [ ] **Step 1: Write the failing stop-behavior tests**

Add coverage for the two core stop semantics:
- stopping current agent drops only the current task and preserves later queued tasks
- stopping session drops current task and clears the remaining queue
- plain disconnect still requeues the in-flight task for resume

Suggested test names:
```js
test('显式停止当前智能体时只丢弃当前任务并保留后续链路', async () => {})
test('显式停止整个执行时会清空剩余链路', async () => {})
test('客户端断流仍保留当前任务以便恢复', async () => {})
```

- [ ] **Step 2: Run the targeted stop-behavior tests to verify failure**

Run:
```bash
node --test tests/integration/chat-server.integration.test.js
```

Expected: FAIL because abort handling still treats stop like disconnect.

- [ ] **Step 3: Pass execution identity into orchestration**

Extend execution params/results in `src/chat/application/chat-service-types.ts` so `executeAgentTurn(...)` can read:
- `executionId`
- optional stop-mode lookup or runtime access needed to inspect explicit stop state

Choose the smallest contract that keeps orchestration testable.

- [ ] **Step 4: Update current-agent tracking before each task**

In `src/chat/application/chat-dispatch-orchestrator.ts`, update the runtime active execution with the task's `agentName` immediately before `onThinking?.(task.agentName)`.

- [ ] **Step 5: Split explicit stop from disconnect aborts**

When `runAgentTask(...)` returns and `signal?.aborted` is true with no visible messages:
- inspect the execution stop mode from runtime
- for `current_agent`, do **not** `queue.unshift(task)`
- for `session`, do **not** requeue current task and clear `queue`
- for `none`, preserve the existing disconnect behavior

Return enough stopped metadata in `ExecuteAgentTurnResult` for upstream SSE/UI layers.

- [ ] **Step 6: Add concise stopped logging**

In `src/chat/application/chat-agent-execution.ts` and/or the orchestrator, log which scope caused the abort so production debugging can distinguish explicit stop from transport disconnect.

- [ ] **Step 7: Run the targeted stop-behavior tests again**

Run:
```bash
node --test tests/integration/chat-server.integration.test.js
```

Expected: PASS for current-agent/session stop semantics while frontend/SSE-specific assertions may still fail.

- [ ] **Step 8: Commit the orchestration changes**

```bash
git add src/chat/application/chat-dispatch-orchestrator.ts src/chat/application/chat-service-types.ts src/chat/application/chat-agent-execution.ts tests/integration/chat-server.integration.test.js
git commit -m "feat: honor explicit chat stop scopes"
```

---

### Task 5: Allow resumed chains to be explicitly stopped too

**Files:**
- Modify: `src/chat/application/chat-resume-service.ts`
- Modify: `src/chat/application/chat-service-types.ts`
- Modify: `src/chat/application/chat-service.ts`
- Test: `tests/integration/chat-server.integration.test.js`

- [ ] **Step 1: Write the failing resume-stop tests**

Add coverage that verifies:
- `chat-resume` registers an active execution
- a resumed chain can be stopped with `scope = 'current_agent'`
- explicitly stopped current resumed task is not replayed on the next `chat-resume`
- `scope = 'session'` against a resumed chain leaves no further resumable work

Suggested test names:
```js
test('恢复后的链路也可被显式停止当前任务', async () => {})
test('恢复中的 session stop 会清空剩余可恢复链路', async () => {})
```

- [ ] **Step 2: Run the targeted resume-stop tests to verify failure**

Run:
```bash
node --test tests/integration/chat-server.integration.test.js
```

Expected: FAIL because resume flow is not registered as an active execution yet.

- [ ] **Step 3: Wrap resume execution with the active execution registry**

In `src/chat/application/chat-resume-service.ts`, mirror the stream registration lifecycle:
- create/register an `executionId`
- update active agent as execution proceeds via orchestrator hooks
- clear by guarded `executionId` in `finally`

If the same registration helper can be shared cleanly from `chat-service.ts`, extract a tiny helper only if it reduces duplication.

- [ ] **Step 4: Preserve pending execution state correctly after stopped resumes**

Ensure resumed execution persists:
- remaining queue when stop scope is `current_agent`
- no remaining queue when stop scope is `session`

and does not duplicate already-buffered visible messages.

- [ ] **Step 5: Run the targeted resume-stop tests again**

Run:
```bash
node --test tests/integration/chat-server.integration.test.js
```

Expected: PASS for explicit stop during resumed chains.

- [ ] **Step 6: Commit the resume stop support**

```bash
git add src/chat/application/chat-resume-service.ts src/chat/application/chat-service.ts src/chat/application/chat-service-types.ts tests/integration/chat-server.integration.test.js
git commit -m "feat: support stopping resumed chat chains"
```

---

### Task 6: Emit explicit stop SSE events

**Files:**
- Modify: `src/chat/http/chat-sse.ts`
- Modify: `src/chat/application/chat-service-types.ts`
- Test: `tests/integration/chat-server.integration.test.js`

- [ ] **Step 1: Write the failing SSE tests**

Add coverage that proves:
- explicit current-agent stop emits `event: execution_stopped`
- the payload includes `scope`, `currentAgent`, and `resumeAvailable`
- explicit stop does not fall through as a normal `done` event if your chosen behavior is stop-only termination

Suggested test names:
```js
test('显式停止当前智能体时 SSE 会发送 execution_stopped 事件', async () => {})
test('显式停止整个执行时 SSE 会标记 resumeAvailable false', async () => {})
```

- [ ] **Step 2: Run the targeted SSE tests to verify failure**

Run:
```bash
node --test tests/integration/chat-server.integration.test.js
```

Expected: FAIL because SSE only knows about `done`, `notice`, and `error` today.

- [ ] **Step 3: Extend SSE execution result type**

In `src/chat/application/chat-service-types.ts`, ensure the stream execution result type includes optional stopped metadata in the exact shape the frontend needs.

- [ ] **Step 4: Emit `execution_stopped` from SSE**

In `src/chat/http/chat-sse.ts`, after `params.execute(...)` returns:
- if `result.stopped` exists, send `execution_stopped` with that payload and end the response
- otherwise preserve the current `done` path

Keep existing heartbeat and error behavior unchanged.

- [ ] **Step 5: Run the targeted SSE tests again**

Run:
```bash
node --test tests/integration/chat-server.integration.test.js
```

Expected: PASS for explicit stop event coverage.

- [ ] **Step 6: Commit the SSE stop signaling**

```bash
git add src/chat/http/chat-sse.ts src/chat/application/chat-service-types.ts tests/integration/chat-server.integration.test.js
git commit -m "feat: emit explicit execution stopped events"
```

---

### Task 7: Add frontend stop controls and stopped-state handling

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Test: `tests/integration/frontend-react-bindings.integration.test.js`

- [ ] **Step 1: Write the failing frontend binding tests**

Add assertions that the shipped frontend contains:
- stop-current and stop-session controls near streaming state
- a fetch call to `/api/chat-stop`
- `execution_stopped` event handling
- status copy for resumable vs non-resumable stop outcomes

Suggested test names:
```js
test('前端流式界面提供停止当前智能体和停止本次执行按钮', async () => {})
test('前端会处理 execution_stopped 事件并更新恢复提示', async () => {})
```

- [ ] **Step 2: Run the targeted frontend tests to verify failure**

Run:
```bash
node --test tests/integration/frontend-react-bindings.integration.test.js
```

Expected: FAIL because no stop controls or stop event handling are present.

- [ ] **Step 3: Add stop action UI and helpers**

In `public/index.html`:
- render two stop controls during active streaming
- implement a helper like `requestChatStop(scope)` that calls `/api/chat-stop`
- disable controls while the stop request is in flight

Prefer reusing existing loading/status state instead of creating a parallel state machine.

- [ ] **Step 4: Handle `execution_stopped` in the SSE loop**

Update the stream event parser to:
- clear thinking indicators
- set status text based on `resumeAvailable`
- show resume notice only when `resumeAvailable === true`
- avoid later treating a deliberate stop as a generic connection failure

- [ ] **Step 5: Add minimal styles**

In `public/styles.css`, add focused button styles consistent with the existing preview/cancel controls. Avoid broad unrelated CSS churn.

- [ ] **Step 6: Run the targeted frontend tests again**

Run:
```bash
node --test tests/integration/frontend-react-bindings.integration.test.js
```

Expected: PASS for stop control and event binding coverage.

- [ ] **Step 7: Commit the frontend controls**

```bash
git add public/index.html public/styles.css tests/integration/frontend-react-bindings.integration.test.js
git commit -m "feat: add frontend chat stop controls"
```

---

### Task 8: Run focused regression and full verification

**Files:**
- Modify as needed: any files touched above to address final test failures

- [ ] **Step 1: Run the focused fast suite**

Run:
```bash
npm run test:fast
```

Expected: PASS, including the updated chat runtime/service/frontend coverage.

- [ ] **Step 2: Run the targeted frontend and integration suites that changed**

Run:
```bash
node --test tests/integration/frontend-react-bindings.integration.test.js
node --test tests/integration/chat-server.integration.test.js
```

Expected: PASS.

- [ ] **Step 3: Run the full integration suite**

Run:
```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Review git diff for accidental churn**

Run:
```bash
git diff --stat --cached
git diff --stat
```

Expected: only the planned runtime/application/http/frontend/test files changed.

- [ ] **Step 5: Commit any final fixes**

```bash
git add src/chat/http/chat-routes.ts src/chat/http/chat-sse.ts src/chat/application/chat-service.ts src/chat/application/chat-service-types.ts src/chat/application/chat-resume-service.ts src/chat/application/chat-dispatch-orchestrator.ts src/chat/application/chat-agent-execution.ts src/chat/runtime/chat-runtime.ts src/chat/runtime/chat-runtime-types.ts src/chat/runtime/chat-active-execution-state.ts src/types.ts public/index.html public/styles.css tests/integration/chat-server.integration.test.js tests/integration/frontend-react-bindings.integration.test.js tests/integration/chat-server-service-boundaries.integration.test.js
git commit -m "feat: support force stopping active chat agents"
```

---

## Notes for the implementing engineer

- Keep `src/server.ts` and other composition roots thin; place behavior in the existing chat http/application/runtime layers.
- Prefer a small runtime state module for active executions rather than stuffing another mutable map into `chat-runtime.ts` directly.
- When you change stream result types, update both the non-stream service path and the resume path carefully so TypeScript forces all call sites to decide how stopped metadata should behave.
- Do not regress the existing disconnect-resume semantics already covered by the integration suite.
- If a boundary test and a broad integration test cover the same contract, keep the narrower one and delete the redundant assertion rather than duplicating maintenance burden.
