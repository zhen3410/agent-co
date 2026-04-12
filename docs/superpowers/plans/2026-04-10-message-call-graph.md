# Message Call Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-message call-graph metadata and an expandable message-card UI that shows a graph summary plus a readable structural projection for graph-shaped invocation flows, including cycles.

**Architecture:** Build a lightweight `callGraph` snapshot on each message from existing message/task relationships already present in session history, then return those enriched messages through history/query paths and render them inline in the chat UI. Keep graph construction in focused shared helpers so backend enrichment and frontend rendering stay simple, and defer true mini-canvas graph drawing to a later phase.

**Tech Stack:** TypeScript, Node test runner, existing chat runtime/session services, React-in-HTML frontend in `public/index.html`.

---

### Task 1: Define call-graph contracts and pure graph builder helpers

**Files:**
- Modify: `src/types.ts`
- Create: `src/chat/domain/message-call-graph.ts`
- Test: `tests/unit/message-call-graph.unit.test.js`

- [ ] **Step 1: Write the failing unit tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMessageCallGraph, enrichMessagesWithCallGraphs } = require('../../dist/chat/domain/message-call-graph.js');

test('message call graph builds a cyclic local graph around the focus message', () => {
  // Arrange a small history with taskId / parentTaskId / callerAgentName / calleeAgentName
  // Assert hasCycle, nodeCount, edgeCount, and loopback edge.
});

test('message call graph omits graph metadata for plain user messages without related invocation context', () => {
  // Assert undefined callGraph.
});
```

- [ ] **Step 2: Run the unit tests to verify RED**

Run: `npm run build && node --test tests/unit/message-call-graph.unit.test.js`
Expected: FAIL because the helper module / types do not exist yet.

- [ ] **Step 3: Implement minimal contracts and graph builder**

Implement:
- `MessageCallGraph*` types in `src/types.ts`
- `buildMessageCallGraph(history, focusMessage)` in `src/chat/domain/message-call-graph.ts`
- `enrichMessagesWithCallGraphs(history)` helper that preserves old messages and attaches `callGraph` only when derivable.

Graph rules:
- focus node is the current message
- use `taskId`, `parentTaskId`, `callerAgentName`, `calleeAgentName`, `role`, `sender`
- model nodes as `message` / `execution`
- mark cycle if task-parent links create a back-reference in the local slice
- cap slice size conservatively and set `truncated` when capped

- [ ] **Step 4: Re-run the unit tests to verify GREEN**

Run: `npm run build && node --test tests/unit/message-call-graph.unit.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/chat/domain/message-call-graph.ts tests/unit/message-call-graph.unit.test.js
git commit -m "feat: add message call graph contracts"
```

### Task 2: Enrich history and live chat responses with call-graph snapshots

**Files:**
- Modify: `src/chat/application/session-query-service.ts`
- Modify: `src/chat/application/chat-service.ts`
- Test: `tests/integration/chat-server.integration.test.js`

- [ ] **Step 1: Write failing integration tests**

Add tests that verify:
- `/api/history` returns `callGraph` on invocation-related assistant messages
- streamed / direct chat responses include `callGraph` on returned AI messages
- plain user messages still omit `callGraph`

- [ ] **Step 2: Run the targeted integration tests to verify RED**

Run: `npm run build && node --test tests/integration/chat-server.integration.test.js --test-name-pattern "callGraph|调用图"`
Expected: FAIL because no response includes `callGraph` yet.

- [ ] **Step 3: Implement response enrichment**

Implement:
- history enrichment in `session-query-service`
- live response enrichment in `chat-service` before returning / streaming final messages
- keep persisted session history compatible: enriching response payloads is enough for v1 unless existing write paths make snapshot persistence trivial

- [ ] **Step 4: Re-run targeted integration tests to verify GREEN**

Run: `npm run build && node --test tests/integration/chat-server.integration.test.js --test-name-pattern "callGraph|调用图"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat/application/session-query-service.ts src/chat/application/chat-service.ts tests/integration/chat-server.integration.test.js
git commit -m "feat: expose message call graphs in chat responses"
```

### Task 3: Render expandable call-graph UI in message cards

**Files:**
- Modify: `public/index.html`
- Test: `tests/integration/frontend-react-bindings.integration.test.js`

- [ ] **Step 1: Write failing frontend contract tests**

Add tests that assert the HTML app includes:
- call-graph summary markup and toggle action hooks
- expanded panel renderer for graph details
- cycle/truncated badges and grouped detail rendering
- event delegation for expand/collapse

- [ ] **Step 2: Run the frontend integration tests to verify RED**

Run: `npm run build && node --test tests/integration/frontend-react-bindings.integration.test.js --test-name-pattern "调用图|call graph"`
Expected: FAIL because the UI hooks do not exist yet.

- [ ] **Step 3: Implement minimal inline UI**

Implement in `public/index.html`:
- `renderMessageGraphSummary(callGraph)`
- `renderMessageGraphPanel(callGraph)`
- grouped detail rendering from nodes / edges
- one-open-at-a-time expand/collapse behavior
- CSS for badges/panel/groups

Do not implement canvas/mini-graph yet; leave a placeholder container only if needed.

- [ ] **Step 4: Re-run the frontend integration tests to verify GREEN**

Run: `npm run build && node --test tests/integration/frontend-react-bindings.integration.test.js --test-name-pattern "调用图|call graph"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/index.html tests/integration/frontend-react-bindings.integration.test.js
git commit -m "feat: render expandable message call graph panel"
```

### Task 4: Final verification

**Files:**
- Modify: only files changed above
- Test: `tests/unit/message-call-graph.unit.test.js`
- Test: `tests/integration/frontend-react-bindings.integration.test.js`
- Test: `tests/integration/chat-server.integration.test.js`

- [ ] **Step 1: Run focused verification suite**

Run:
```bash
npm run build && \
node --test tests/unit/message-call-graph.unit.test.js && \
node --test tests/integration/frontend-react-bindings.integration.test.js --test-name-pattern "调用图|call graph" && \
node --test tests/integration/chat-server.integration.test.js --test-name-pattern "callGraph|调用图"
```
Expected: PASS.

- [ ] **Step 2: Run broader regression checks if focused suite passes**

Run:
```bash
npm test
```
Expected: PASS.

- [ ] **Step 3: Prepare handoff**

Capture:
- files changed
- tests run and results
- known limitations (no mini-graph yet; graph built from current message/task metadata)
