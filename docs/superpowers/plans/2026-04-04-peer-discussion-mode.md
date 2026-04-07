# Peer Discussion Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a session-level `peer` discussion mode so equal-status agents can discuss without a fixed controller, pause naturally when no valid continuation exists, and let the user manually trigger summarization.

**Architecture:** Extend session state with discussion-mode metadata while preserving classic chain behavior as the default path. Rework agent-turn dispatch to distinguish explicit chaining from peer-mode pause semantics, then add minimal UI affordances for mode selection, pause-state rendering, and manual summary triggering without implementing automatic proactive interjection in phase 1.

**Tech Stack:** TypeScript, Node.js HTTP server, server-rendered React-ish frontend in `public/index.html`, Node test runner (`node:test`), assert/strict integration tests.

---

## File Map

### Server and shared types
- Modify: `src/types.ts`
  - Add session/message types for `discussionMode`, `discussionState`, richer `dispatchKind`, and summary/pause metadata.
- Modify: `src/server.ts`
  - Normalize and persist new session settings.
  - Keep `classic` behavior unchanged.
  - Add `peer` pause semantics to dispatch flow.
  - Add a summary endpoint or summary action branch.

### Frontend
- Modify: `public/index.html`
  - Add session-level mode controls.
  - Hydrate and save mode/state.
  - Render “讨论已暂停” card.
  - Trigger manual summary action.

### Tests
- Modify: `tests/integration/chat-server-session-block.integration.test.js`
  - Cover session persistence/update for `discussionMode` and `discussionState` defaults.
- Modify: `tests/integration/chat-server.integration.test.js`
  - Cover peer-mode pause semantics and manual summary entry point.
- Modify: `tests/integration/frontend-react-bindings.integration.test.js`
  - Cover new controls and pause-card rendering/binding.

### Spec references
- Reference: `docs/superpowers/specs/2026-04-04-peer-discussion-mode-design.md`
- Reference existing behavior: `docs/superpowers/specs/2026-03-24-session-chain-settings-design.md`

---

## Implementation Notes / Constraints

- Phase 1 intentionally does **not** implement automatic proactive interjection (`implicit_chained`) logic. Peer mode should still pause correctly when no explicit continuation exists.
- `classic` must remain backward-compatible with existing tests and runtime semantics.
- Session updates must remain partial and safe: new fields should be additive and normalized.
- Manual summary must be modeled as a separate action, not as hidden automatic chaining back to a controller agent.
- Follow TDD: write or update tests first, verify failure, then implement the minimum change to pass.

---

### Task 1: Extend session and dispatch types for peer discussion mode

**Files:**
- Modify: `src/types.ts`
- Modify: `src/server.ts` (type-adjacent normalization sections around session defaults / patches)
- Test: `tests/integration/chat-server-session-block.integration.test.js`

- [ ] **Step 1: Write the failing session-state tests for new fields**

Add tests that assert:
- newly created sessions expose `discussionMode: 'classic'`
- newly created sessions expose `discussionState: 'active'`
- session list / history payloads include those fields
- session update API accepts `discussionMode: 'peer'`
- session update API rejects invalid `discussionMode` / `discussionState` when sent directly

Suggested new cases in `tests/integration/chat-server-session-block.integration.test.js`:
- `test('新建会话返回默认 discussionMode 与 discussionState', async () => {})`
- `test('POST /api/sessions/update 支持切换 discussionMode', async () => {})`
- `test('POST /api/sessions/update 会拒绝非法 discussionMode', async () => {})`

- [ ] **Step 2: Run only the new/updated session tests to verify failure**

Run:
```bash
npm test -- --test-name-pattern="discussionMode|discussionState|切换 discussionMode|默认 discussionMode"
```

Expected: FAIL because the fields and validation do not exist yet.

- [ ] **Step 3: Add shared type definitions**

In `src/types.ts`, add narrow string unions and fields similar to:
```ts
export type DiscussionMode = 'classic' | 'peer';
export type DiscussionState = 'active' | 'paused' | 'summarizing';
export type AgentDispatchKind = 'initial' | 'explicit_chained' | 'implicit_chained' | 'summary';
```

Extend session/message-related interfaces to include optional/new fields needed by phase 1.

- [ ] **Step 4: Normalize defaults and update API validation**

In `src/server.ts`:
- add session default normalization for `discussionMode` / `discussionState`
- include them in session serialization / restore logic
- extend the session patch validator so `discussionMode` is updatable and validated
- do **not** allow arbitrary client-side mutation of `discussionState` unless there is a clear server-owned path

- [ ] **Step 5: Run the targeted session tests again**

Run:
```bash
node --test tests/integration/chat-server-session-block.integration.test.js
```

Expected: PASS for the new discussion-mode coverage and no regressions in nearby session-state tests.

- [ ] **Step 6: Commit the type/defaults work**

```bash
git add src/types.ts src/server.ts tests/integration/chat-server-session-block.integration.test.js
git commit -m "feat: add peer discussion session state"
```

---

### Task 2: Preserve classic behavior while adding peer-mode pause semantics

**Files:**
- Modify: `src/server.ts`
- Test: `tests/integration/chat-server.integration.test.js`

- [ ] **Step 1: Write failing integration tests for peer-mode pause behavior**

Add tests that verify:
- in `classic` mode, current explicit chain behavior remains unchanged
- in `peer` mode, if a reply contains no `invokeAgents` and no `@@AgentName`, the turn finishes with discussion paused instead of being treated as a broken chain
- the session stores `discussionState: 'paused'` when peer discussion naturally stops

Suggested test names:
- `test('peer 模式下无显式继续对象时会将讨论标记为 paused', async () => {})`
- `test('classic 模式下原有链式传播行为保持不变', async () => {})`

Use existing fake API / callback test helpers as reference.

- [ ] **Step 2: Run the targeted chat-server tests to verify failure**

Run:
```bash
node --test tests/integration/chat-server.integration.test.js
```

Expected: FAIL because peer-specific pause semantics do not exist yet.

- [ ] **Step 3: Refactor dispatchKind handling without changing classic semantics**

In `src/server.ts`:
- replace the hard-coded `'chained'` usage with the new dispatch-kind union
- map existing classic chain continuations to `explicit_chained`
- ensure persisted pending tasks survive restart/resume with backward-compatible mapping from legacy `'chained'`

- [ ] **Step 4: Implement phase-1 peer pause semantics in `executeAgentTurn`**

Add server logic so that, when `discussionMode === 'peer'`:
- explicit continuation still queues next tasks
- if no explicit continuation is present after processing visible messages, mark the session as `discussionState = 'paused'`
- if at least one explicit continuation is queued, keep `discussionState = 'active'`
- do not attempt implicit/proactive interjection yet

Also ensure user-originated fresh messages reset `discussionState` back to `active`.

- [ ] **Step 5: Add operational logging for pause events**

Add logs such as:
```txt
session=<id> stage=discussion_pause reason=no_explicit_continuation mode=peer
```

This makes later debugging of “为什么停了” much easier.

- [ ] **Step 6: Run the targeted chat-server tests again**

Run:
```bash
node --test tests/integration/chat-server.integration.test.js
```

Expected: PASS for the new peer pause tests and no regressions for classic chain tests.

- [ ] **Step 7: Commit the peer dispatch behavior**

```bash
git add src/server.ts tests/integration/chat-server.integration.test.js
git commit -m "feat: add peer discussion pause semantics"
```

---

### Task 3: Add manual summary action as a separate server flow

**Files:**
- Modify: `src/server.ts`
- Modify: `src/types.ts` (if summary-specific message/task metadata is needed)
- Test: `tests/integration/chat-server.integration.test.js`

- [ ] **Step 1: Write failing tests for manual summary triggering**

Add tests that verify:
- paused peer sessions can trigger a summary action through a dedicated API entrypoint
- triggering summary flips `discussionState` to `summarizing` during execution and back to `paused` or `active` as appropriate after completion
- summary execution is independent from automatic chained dispatch

Suggested test names:
- `test('peer 模式下可手动触发生成总结', async () => {})`
- `test('生成总结不会隐式恢复普通链式传播', async () => {})`

- [ ] **Step 2: Run the targeted summary tests to verify failure**

Run:
```bash
node --test tests/integration/chat-server.integration.test.js
```

Expected: FAIL because no summary action endpoint exists.

- [ ] **Step 3: Implement the minimal manual-summary endpoint/path**

In `src/server.ts`, add one minimal server-owned action, e.g.:
- `POST /api/chat-summary`

Behavior:
- resolve current session
- verify the session is in `peer` mode
- construct a dedicated summary task (`dispatchKind: 'summary'`)
- choose a minimal first implementation strategy (for example, send the conversation summary request to current agent or a fixed neutral summarizer config if one already exists)
- keep this action explicit and isolated from normal chain continuation

- [ ] **Step 4: Serialize summary result cleanly into session history**

Ensure summary output is stored as a visible assistant/agent message with enough metadata for the UI to render it normally.

- [ ] **Step 5: Run the chat-server integration tests again**

Run:
```bash
node --test tests/integration/chat-server.integration.test.js
```

Expected: PASS for manual summary behavior and no regression in regular chat endpoints.

- [ ] **Step 6: Commit the summary action**

```bash
git add src/server.ts src/types.ts tests/integration/chat-server.integration.test.js
git commit -m "feat: add manual peer discussion summary action"
```

---

### Task 4: Add peer discussion controls and pause-state UI

**Files:**
- Modify: `public/index.html`
- Test: `tests/integration/frontend-react-bindings.integration.test.js`

- [ ] **Step 1: Write failing frontend binding tests**

Add tests that assert:
- current-session settings area exposes a stable control marker for `discussionMode`
- history hydration reads `discussionMode` and `discussionState`
- a paused peer session renders a `讨论已暂停` card with a summary action button
- clicking the summary button calls the new summary endpoint

Suggested markers/assertions:
- `data-session-setting="discussionMode"`
- `data-session-pause-card`
- fetch call to `/api/chat-summary`

- [ ] **Step 2: Run the frontend integration test file to verify failure**

Run:
```bash
node --test tests/integration/frontend-react-bindings.integration.test.js
```

Expected: FAIL because these bindings and markup do not exist yet.

- [ ] **Step 3: Add minimal session setting UI for discussion mode**

In `public/index.html`:
- add a compact mode selector under current session settings
- reuse existing save/update plumbing where practical
- keep labels explicit, e.g. `经典链式` / `对等讨论`

- [ ] **Step 4: Hydrate and render discussion pause state**

Update frontend state initialization and render logic so that:
- `discussionMode` / `discussionState` are read from session payloads
- when `discussionMode === 'peer'` and `discussionState === 'paused'`, render the pause card
- pause-card CTA calls `/api/chat-summary`

- [ ] **Step 5: Run the frontend integration tests again**

Run:
```bash
node --test tests/integration/frontend-react-bindings.integration.test.js
```

Expected: PASS for the new bindings and no regression in existing session-setting tests.

- [ ] **Step 6: Commit the UI work**

```bash
git add public/index.html tests/integration/frontend-react-bindings.integration.test.js
git commit -m "feat: add peer discussion pause UI"
```

---

### Task 5: Full regression pass and docs sanity check

**Files:**
- Modify if needed: `docs/superpowers/specs/2026-04-04-peer-discussion-mode-design.md`
- Verify: changed source/test/frontend files

- [ ] **Step 1: Run the focused integration suite for touched areas**

Run:
```bash
node --test tests/integration/chat-server-session-block.integration.test.js
node --test tests/integration/chat-server.integration.test.js
node --test tests/integration/frontend-react-bindings.integration.test.js
```

Expected: PASS in all three files.

- [ ] **Step 2: Run the full project test suite**

Run:
```bash
npm test
```

Expected: full integration suite passes.

- [ ] **Step 3: Compare behavior against the approved spec**

Check the implementation against:
- `docs/superpowers/specs/2026-04-04-peer-discussion-mode-design.md`

Confirm phase-1 scope stayed minimal:
- no forced controller agent
- no automatic summary
- no proactive interjection yet
- peer pause + manual summary available

- [ ] **Step 4: Update the spec only if implementation exposed a necessary scope adjustment**

If behavior diverged for a valid reason, make the smallest documentation correction and include it in the final commit.

- [ ] **Step 5: Final commit if needed**

```bash
git add src/types.ts src/server.ts public/index.html tests/integration/*.test.js docs/superpowers/specs/2026-04-04-peer-discussion-mode-design.md
git commit -m "test: verify peer discussion mode rollout"
```

---

## Execution Guidance

- Implement in the listed order; later tasks assume the earlier session-state and dispatch primitives exist.
- Do not bundle “phase 2 proactive interjection” into this rollout.
- Favor additive changes and backward-compatible defaults.
- Keep operational logging specific enough to debug why a peer discussion paused.
