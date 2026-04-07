# Chat Modularization Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Finish the next maintainability refactor wave by splitting `chat-runtime.ts`, `chat-service.ts`, and the remaining mixed `session-service.ts` / `ops-routes.ts` responsibilities into smaller focused modules without changing behavior.

**Architecture:** Keep the current composition-root architecture intact, but move stateful/runtime concerns, chat orchestration concerns, and mixed HTTP route concerns behind narrower modules. Preserve all public contracts by keeping the existing top-level exports (`createChatRuntime`, `createChatService`, `createSessionService`, `handleOpsRoutes`) as stable façades that delegate to newly extracted helpers.

**Tech Stack:** TypeScript, Node.js built-in HTTP server, Node test runner (`node:test`), existing integration tests in `tests/integration/*.integration.test.js`.

---

## File Structure

### Existing files to modify
- `src/chat/runtime/chat-runtime.ts` — reduce to composition façade plus shared types/exports.
- `src/chat/application/chat-service.ts` — reduce to orchestration façade and extracted helpers.
- `src/chat/application/session-service.ts` — keep public interface, delegate to focused helpers.
- `src/chat/http/ops-routes.ts` — keep top-level dispatcher, delegate to route groups.
- `tests/integration/chat-server.integration.test.js` — preserve broad chat/runtime behavior while internals split.
- `tests/integration/chat-server-sessions.integration.test.js` — preserve session CRUD/isolation behavior while runtime/session helpers split.
- `tests/integration/callbacks.integration.test.js` — preserve callback/thread-context behavior while runtime/chat helpers split.

### New structure-contract tests to create
- `tests/integration/chat-server-runtime-contract.integration.test.js` — structure-contract coverage for runtime façade extraction.
- `tests/integration/chat-server-service-boundaries.integration.test.js` — structure-contract coverage for chat-service façade extraction.
- `tests/integration/chat-server-session-service-boundaries.integration.test.js` — structure-contract coverage for session-service façade extraction.
- `tests/integration/chat-server-ops-boundaries.integration.test.js` — structure-contract coverage for ops-route façade extraction.

### Existing behavior tests used for verification
- `tests/integration/chat-server-ops.integration.test.js` — keep ops behavior locked while routes split.

### New runtime-focused files (Task 6)
- `src/chat/runtime/chat-runtime-types.ts` — shared runtime types/interfaces/constants currently embedded in `chat-runtime.ts`.
- `src/chat/runtime/chat-session-state.ts` — session CRUD, active-session resolution, workdir/enabled-agent/current-agent state mutations.
- `src/chat/runtime/chat-discussion-state.ts` — runtime-level discussion normalization, summary lock bookkeeping, and pending-dispatch state mutation helpers.
- `src/chat/runtime/chat-runtime-persistence.ts` — Redis hydration/persist key selection and shutdown behavior.
- `src/chat/runtime/chat-runtime-dependencies.ts` — dependency-status collection and operational-log delegation.

### New chat-service files (Task 7)
- `src/chat/application/chat-service-types.ts` — extracted task/callback/dependency types reused across chat-service helpers.
- `src/chat/application/chat-agent-execution.ts` — invoke one agent, consume callbacks, map visible messages/errors.
- `src/chat/application/chat-dispatch-orchestrator.ts` — queue/chain execution, max-hop/max-call enforcement, peer-mode continuation logic.
- `src/chat/application/chat-summary-service.ts` — summary-specific workflow and state restoration helpers.
- `src/chat/application/chat-resume-service.ts` — resume-specific flow for pending tasks.

### New session + ops files (Task 8)
- `src/chat/application/session-service-types.ts` — shared response/result shapes for session helpers.
- `src/chat/application/session-query-service.ts` — history/session payload assembly.
- `src/chat/application/session-command-service.ts` — session CRUD/update commands.
- `src/chat/application/session-agent-service.ts` — validation/orchestration helpers around current-agent/enabled-agent/workdir runtime primitives.
- `src/chat/application/session-discussion-service.ts` — validation/orchestration helpers that assemble/restore summary continuation state via runtime primitives.
- `src/chat/http/ops/dependency-routes.ts` — dependency status/log endpoints.
- `src/chat/http/ops/system-routes.ts` — `/api/system/dirs` and `/api/workdirs/options`.
- `src/chat/http/ops/verbose-log-routes.ts` — verbose log listing/content endpoints.

---

### Task 6: Split `chat-runtime.ts` into focused state/persistence modules

**Files:**
- Create: `src/chat/runtime/chat-runtime-types.ts`
- Create: `src/chat/runtime/chat-session-state.ts`
- Create: `src/chat/runtime/chat-discussion-state.ts`
- Create: `src/chat/runtime/chat-runtime-persistence.ts`
- Create: `src/chat/runtime/chat-runtime-dependencies.ts`
- Modify: `src/chat/runtime/chat-runtime.ts`
- Create: `tests/integration/chat-server-runtime-contract.integration.test.js`
- Verify against: `tests/integration/chat-server.integration.test.js`
- Verify against: `tests/integration/chat-server-sessions.integration.test.js`
- Verify against: `tests/integration/chat-server-session-block.integration.test.js`
- Verify against: `tests/integration/chat-server-ops.integration.test.js`
- Verify against: `tests/integration/callbacks.integration.test.js`

> Runtime helper tests are structure-contract supplements only; they do **not** replace the existing behavior-oriented integration tests.

- [x] **Step 1: Write/extend the failing runtime-boundary contract test**

Add assertions that `chat-runtime.ts` remains a façade and that the extracted helper module names are referenced from there instead of re-embedding the previous monolith logic.

- [x] **Step 2: Run the focused runtime contract test and verify it fails**

Run: `node --test tests/integration/chat-server-runtime-contract.integration.test.js`
Expected: FAIL because the new helper modules and façade delegation do not exist yet.

- [x] **Step 3: Extract shared runtime types/constants**

Move public runtime types and stable helper constants/functions that do not need captured closure state into `chat-runtime-types.ts`, keeping import paths internal to the runtime package.

- [x] **Step 4: Extract session-state and discussion-state helpers**

Move session CRUD/current-agent/workdir/enabled-agent logic into `chat-session-state.ts`, and move discussion normalization/pending-dispatch/summary-request helpers into `chat-discussion-state.ts`. As part of this split, add/retain runtime primitives for direct state mutation paths currently reached from services (`appendMessage`, `prepareForIncomingMessage`, `updatePendingExecution`, `takePendingExecution`, `setDiscussionState`, `restoreSummaryContinuationState`, `markSummaryInProgress`). Keep behavior identical by reusing the same repository and in-memory state containers.

- [x] **Step 5: Extract persistence and dependency-status helpers**

Move Redis hydrate/persist/shutdown flows into `chat-runtime-persistence.ts`, and move operational log / dependency status collection into `chat-runtime-dependencies.ts`.

- [x] **Step 6: Reduce `chat-runtime.ts` to a composition façade**

Wire the extracted modules together inside `createChatRuntime`, preserve the existing `ChatRuntime` interface/export surface, and avoid changing callers.

- [x] **Step 8: Run focused verification**

Run: `npm run build && node --test tests/integration/chat-server-runtime-contract.integration.test.js tests/integration/chat-server-ops.integration.test.js tests/integration/chat-server-session-block.integration.test.js tests/integration/chat-server-sessions.integration.test.js tests/integration/callbacks.integration.test.js tests/integration/chat-server.integration.test.js`
Expected: PASS.

- [x] **Step 8: Commit Task 6**

```bash
git add src/chat/runtime/*.ts tests/integration/chat-server-runtime-contract.integration.test.js
git commit -m "refactor: split chat runtime state and persistence"
```

### Task 7: Split `chat-service.ts` into execution/orchestration/resume/summary modules

**Files:**
- Create: `src/chat/application/chat-service-types.ts`
- Create: `src/chat/application/chat-agent-execution.ts`
- Create: `src/chat/application/chat-dispatch-orchestrator.ts`
- Create: `src/chat/application/chat-summary-service.ts`
- Create: `src/chat/application/chat-resume-service.ts`
- Modify: `src/chat/application/chat-service.ts`
- Create: `tests/integration/chat-server-service-boundaries.integration.test.js`
- Verify against: `tests/integration/chat-server.integration.test.js`
- Verify against: `tests/integration/chat-server-session-block.integration.test.js`
- Verify against: `tests/integration/callbacks.integration.test.js`

> Boundary tests here are structural supplements only; behavior remains gated by the existing integration suite.

- [x] **Step 1: Write/extend the failing chat-service boundary test**

Lock that `chat-service.ts` delegates to extracted orchestration helpers and no longer carries the full execution/resume/summary implementation inline.

- [x] **Step 2: Run the focused boundary test and verify it fails**

Run: `node --test tests/integration/chat-server-service-boundaries.integration.test.js`
Expected: FAIL because the new modules and boundary assertions are not implemented yet.

- [x] **Step 3: Extract shared chat-service types**

Create `chat-service-types.ts` for `AgentDispatchTask`, stream callback types, and shared dependency/result types used by the helper modules.

- [x] **Step 4: Extract single-agent execution helper**

Create `chat-agent-execution.ts` for CLI/API visible-message mapping, callback consumption, fallback handling, and internal-tool-leak filtering.

- [x] **Step 5: Extract chain orchestration logic**

Move queue execution, mention collection, peer-mode continuation rules, max-hop/max-call enforcement, and stream-stop handling into `chat-dispatch-orchestrator.ts`.

- [x] **Step 6: Extract resume and summary flows separately**

Move resume-specific workflow into `chat-resume-service.ts`, then move summary-specific workflow into `chat-summary-service.ts`, preserving session-state transitions and operational logs.

- [x] **Step 7: Reduce `chat-service.ts` to a façade**

Keep `createChatService` public API intact while delegating implementation to the extracted modules. Preserve all response payloads and error semantics.

- [x] **Step 8: Run focused verification**

Run: `npm run build && node --test tests/integration/chat-server-service-boundaries.integration.test.js tests/integration/chat-server.integration.test.js tests/integration/chat-server-session-block.integration.test.js tests/integration/callbacks.integration.test.js`
Expected: PASS.

- [x] **Step 9: Commit Task 7**

```bash
git add src/chat/application/*.ts tests/integration/chat-server-service-boundaries.integration.test.js tests/integration/chat-server.integration.test.js
git commit -m "refactor: split chat service orchestration"
```

### Task 8A: Split `session-service.ts` mixed application responsibilities

**Files:**
- Create: `src/chat/application/session-service-types.ts`
- Create: `src/chat/application/session-query-service.ts`
- Create: `src/chat/application/session-command-service.ts`
- Create: `src/chat/application/session-agent-service.ts`
- Create: `src/chat/application/session-discussion-service.ts`
- Modify: `src/chat/application/session-service.ts`
- Create: `tests/integration/chat-server-session-service-boundaries.integration.test.js`
- Verify against: `tests/integration/chat-server-sessions.integration.test.js`
- Verify against: `tests/integration/chat-server.integration.test.js`
- Verify against: `tests/integration/chat-server-session-block.integration.test.js`

> Runtime owns normalization, summary locks, `pendingAgentTasks`, `discussionState`, and all persistence-safe state mutation. Session-service helpers only perform use-case validation, orchestration, and response shaping via runtime primitives.

- [x] **Step 1: Write/extend failing boundary tests for session-service split**

Add assertions that `session-service.ts` delegates to focused helper modules while keeping behavior-based session tests intact.

- [x] **Step 2: Run focused boundary tests and verify they fail**

Run: `node --test tests/integration/chat-server-session-service-boundaries.integration.test.js`
Expected: FAIL on the new façade/helper assertions before extraction.

- [x] **Step 3: Extract session query + command helpers**

Move session payload shaping to `session-query-service.ts`, and move CRUD/update commands to `session-command-service.ts`.

- [x] **Step 4: Extract session agent/discussion orchestration helpers**

Move current-agent/enabled-agent/workdir validation-orchestration to `session-agent-service.ts`, and move summary continuation orchestration to `session-discussion-service.ts`. `session-service` must stop directly mutating low-level session state; it should call runtime primitives for `appendMessage`, `prepareForIncomingMessage`, `updatePendingExecution`, `takePendingExecution`, `setDiscussionState`, `restoreSummaryContinuationState`, and `markSummaryInProgress`.

- [x] **Step 5: Reduce `session-service.ts` to a façade**

Keep the public `SessionService` interface intact, but delegate implementation to the extracted helpers.

- [x] **Step 6: Run focused verification**

Run: `npm run build && node --test tests/integration/chat-server-session-service-boundaries.integration.test.js tests/integration/chat-server-sessions.integration.test.js tests/integration/chat-server.integration.test.js tests/integration/chat-server-session-block.integration.test.js`
Expected: PASS.

- [x] **Step 7: Commit Task 8A**

```bash
git add src/chat/application/*.ts tests/integration/chat-server-session-service-boundaries.integration.test.js tests/integration/chat-server-sessions.integration.test.js tests/integration/chat-server.integration.test.js tests/integration/chat-server-session-block.integration.test.js
git commit -m "refactor: split session service responsibilities"
```

### Task 8B: Split `ops-routes.ts` mixed JSON/ops responsibilities

**Files:**
- Create: `src/chat/http/ops/dependency-routes.ts`
- Create: `src/chat/http/ops/system-routes.ts`
- Create: `src/chat/http/ops/verbose-log-routes.ts`
- Modify: `src/chat/http/ops-routes.ts`
- Create: `tests/integration/chat-server-ops-boundaries.integration.test.js`
- Verify against: `tests/integration/chat-server-ops.integration.test.js`
- Verify against: `tests/integration/frontend-react-bindings.integration.test.js`
- Verify against: `tests/integration/chat-server.integration.test.js`

> Keep static asset dispatch in `ops-routes.ts`; this task focuses only on JSON/ops route groups.

- [x] **Step 1: Write/extend failing boundary tests for ops-route split**

Add assertions that `ops-routes.ts` delegates JSON/ops endpoints to focused helper modules, without replacing existing behavior-oriented ops/frontend tests.

- [x] **Step 2: Run focused boundary tests and verify they fail**

Run: `node --test tests/integration/chat-server-ops-boundaries.integration.test.js tests/integration/chat-server-ops.integration.test.js`
Expected: FAIL on the new façade/helper assertions before extraction.

- [x] **Step 3: Extract dependency route group**

Move dependency status/log endpoints into `src/chat/http/ops/dependency-routes.ts`.

- [x] **Step 4: Extract system + verbose-log route groups**

Move system/workdir endpoints into `system-routes.ts`, and move verbose-log endpoints into `verbose-log-routes.ts`, while keeping shared helper logic small and explicit.

- [x] **Step 5: Reduce `ops-routes.ts` to a thin dispatcher**

Delegate JSON/ops routes to the new modules and preserve current static asset handling plus final 404 behavior.

- [x] **Step 6: Run focused verification**

Run: `npm run build && node --test tests/integration/chat-server-ops-boundaries.integration.test.js tests/integration/chat-server-ops.integration.test.js tests/integration/frontend-react-bindings.integration.test.js tests/integration/chat-server.integration.test.js`
Expected: PASS.

- [x] **Step 7: Commit Task 8B**

```bash
git add src/chat/http/ops-routes.ts src/chat/http/ops/*.ts tests/integration/chat-server-ops-boundaries.integration.test.js tests/integration/chat-server-ops.integration.test.js tests/integration/frontend-react-bindings.integration.test.js tests/integration/chat-server.integration.test.js
git commit -m "refactor: split ops route groups"
```

### Execution Notes

- Boundary tests were adjusted toward stable export-surface, AST-based, or behavior-level contracts to avoid brittle implementation-shape assertions.
- `ChatRuntime` public API intentionally remained narrow; low-level session mutation stayed behind runtime/discussion helpers instead of re-expanding façade methods.
- Full verification completed on 2026-04-07 with: `npm run build && npm test` → `pass 185`, `fail 0`.

### Final Verification and Handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-04-07-chat-modularization-phase-2.md`

- [x] **Step 1: Run full verification**

Run: `npm run build && npm test`
Expected: PASS with all integration tests green.

- [x] **Step 2: Update plan checkboxes / notes**

Mark completed steps, add any deviation notes, and record final verification commands/results.

- [x] **Step 3: Final review-ready commit if needed**

```bash
git add docs/superpowers/plans/2026-04-07-chat-modularization-phase-2.md
git commit -m "docs: record phase 2 modularization execution"
```
