# Invocation Lane Queues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将同一会话的智能体执行从“全会话串行”改造为“同一智能体串行、不同智能体并行”，并显式记录 lane 队列生命周期事件。

**Architecture:** 引入以 `sessionId::agentName` 为 key 的 invocation lane 状态机，队列状态通过 runtime 内存投影管理，调度器将待执行任务按 lane 分组并并发推进，每个 lane 内仍保持 FIFO 串行。保留现有 `runAgentTask` 作为单任务执行器，只把 active execution 控制和 stop 语义升级为 lane 感知。

**Tech Stack:** TypeScript, Node.js built-in test runner, existing chat runtime / session event infrastructure

---

### Task 1: 建立 lane 队列领域模型与纯状态投影

**Files:**
- Create: `src/chat/domain/invocation-lane.ts`
- Create: `src/chat/runtime/chat-invocation-lane-state.ts`
- Test: `tests/unit/chat-invocation-lane-state.unit.test.js`

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run the targeted unit tests to verify they fail**
- [ ] **Step 3: Implement minimal lane state + projector**
- [ ] **Step 4: Re-run targeted unit tests to verify they pass**

### Task 2: 让 active execution 具备 lane 维度

**Files:**
- Modify: `src/chat/runtime/chat-active-execution-state.ts`
- Modify: `src/chat/runtime/chat-runtime-types.ts`
- Modify: `src/chat/runtime/chat-runtime.ts`
- Test: `tests/unit/chat-active-execution-state.unit.test.js`

- [ ] **Step 1: Write the failing tests for per-lane active execution**
- [ ] **Step 2: Run the targeted unit tests to verify they fail**
- [ ] **Step 3: Implement lane-aware active execution tracking**
- [ ] **Step 4: Re-run targeted unit tests to verify they pass**

### Task 3: 将调度器改造成 lane 并发执行 + 同 agent 串行

**Files:**
- Modify: `src/chat/application/chat-service-types.ts`
- Modify: `src/chat/application/chat-dispatch-orchestrator.ts`
- Modify: `src/chat/application/chat-agent-execution.ts`
- Test: `tests/integration/chat-server-event-log.integration.test.js`

- [ ] **Step 1: Write failing integration tests for same-agent serial / cross-agent parallel execution**
- [ ] **Step 2: Run the targeted integration tests to verify they fail**
- [ ] **Step 3: Implement orchestrator lane scheduling and event emission**
- [ ] **Step 4: Re-run targeted integration tests to verify they pass**

### Task 4: 兼容 stop / resume / event-log 语义并做全量验证

**Files:**
- Modify: `src/chat/application/chat-service.ts`
- Modify: `src/chat/application/chat-resume-service.ts`
- Modify: any touched tests as needed

- [ ] **Step 1: Run focused integration tests around stop/resume and fix regressions**
- [ ] **Step 2: Run build and full test suite**
- [ ] **Step 3: Inspect git diff and summarize behavior changes**
