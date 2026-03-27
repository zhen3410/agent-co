# Session Chain Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add session-scoped chain propagation settings so each chat session can configure the maximum chain hops and whether repeated calls to the same agent are limited.

**Architecture:** Extend `UserChatSession` with two session-owned fields: a required normalized `agentChainMaxHops` integer and an optional `agentChainMaxCallsPerAgent` integer-or-null. Route all chain-dispatch limit checks through per-session normalized values, expose a generic `POST /api/sessions/update` patch endpoint, and add a “当前会话设置” panel in `public/index.html` to edit and persist those values.

**Tech Stack:** Node.js HTTP server, TypeScript, Redis-backed session persistence, vanilla JS in `public/index.html`, Node integration tests

---

### Task 1: Lock In Session Chain Settings With Failing Tests

**Files:**
- Modify: `tests/integration/chat-server-session-block.integration.test.js`
- Modify: `tests/integration/chat-server.integration.test.js`
- Modify: `tests/integration/frontend-react-bindings.integration.test.js`

- [ ] **Step 1: Write the failing server tests**

Add coverage for:
- new sessions returning `agentChainMaxHops` and `agentChainMaxCallsPerAgent`
- `POST /api/sessions/update` updating one or both fields
- invalid patch values returning 400
- values above 1000 being clamped to 1000
- per-session chain-hop settings staying isolated after session switching
- same-agent call limit being unlimited when `agentChainMaxCallsPerAgent` is `null`
- same-agent call limit being enforced when set to a positive integer

- [ ] **Step 2: Write the failing frontend binding tests**

Add assertions for:
- “当前会话设置” markup in `public/index.html`
- session settings state variables and render/update functions
- fetch call to `POST /api/sessions/update`
- “不限制” toggle logic for same-agent call limit

- [ ] **Step 3: Run the targeted tests to verify failure**

Run: `node --test tests/integration/chat-server-session-block.integration.test.js tests/integration/chat-server.integration.test.js tests/integration/frontend-react-bindings.integration.test.js`
Expected: FAIL because session data, APIs, and UI do not yet support chain settings.

### Task 2: Add Session-Level Chain Settings To The Chat Server

**Files:**
- Modify: `src/server.ts`
- Modify: `src/types.ts`
- Test: `tests/integration/chat-server-session-block.integration.test.js`
- Test: `tests/integration/chat-server.integration.test.js`

- [ ] **Step 1: Add normalized session fields and helpers**

Define constants/helpers for:
- session chain value max clamp `1000`
- default session hop limit from `AGENT_CHAIN_MAX_HOPS`
- default same-agent setting `null`
- normalization helpers for parsing/clamping/restoring legacy session values

Update `UserChatSession` creation, hydration, cloning, and summary-return paths so every active session has normalized chain settings.

- [ ] **Step 2: Add the generic session update endpoint**

Implement `POST /api/sessions/update` with:
- payload parsing for `sessionId` and `patch`
- allowlist validation of supported fields
- per-field normalization and 400 errors for invalid values
- updated session response including `session`, `enabledAgents`, `chatSessions`, and `activeSessionId`

- [ ] **Step 3: Route dispatch limits through session settings**

Replace direct use of `AGENT_CHAIN_MAX_HOPS` inside chain execution with a resolved session value. Replace direct use of `AGENT_CHAIN_MAX_CALLS_PER_TURN` with session-based logic that skips the check when `agentChainMaxCallsPerAgent === null` and enforces it otherwise.

- [ ] **Step 4: Run targeted server tests**

Run: `node --test tests/integration/chat-server-session-block.integration.test.js tests/integration/chat-server.integration.test.js`
Expected: PASS

### Task 3: Add Session Settings Controls To The Chat UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Test: `tests/integration/frontend-react-bindings.integration.test.js`

- [ ] **Step 1: Add the current-session settings markup**

Render a new block under session actions containing:
- a labeled numeric input for `最多传播轮数`
- a save button for hop limit
- a labeled `不限制` checkbox for same-agent call limit
- a conditional numeric input plus save button when the checkbox is off
- helper copy explaining the limit semantics

- [ ] **Step 2: Wire page state to session settings data**

Store the active session object (or derived chain-setting state), hydrate it from `loadHistory`, create/select/update/delete responses, and update the UI whenever the active session changes.

- [ ] **Step 3: Add save handlers and validation**

Implement client-side validation for positive integers, submit patches to `POST /api/sessions/update`, consume the returned session state, and show success/failure feedback. Ensure values above 1000 end up rendered as the clamped server response.

- [ ] **Step 4: Run the targeted frontend test**

Run: `node --test tests/integration/frontend-react-bindings.integration.test.js`
Expected: PASS

### Task 4: Final Verification

**Files:**
- No additional edits

- [ ] **Step 1: Run the focused full verification**

Run: `npm test`
Expected: PASS

- [ ] **Step 2: Review the final diff**

Confirm the diff is limited to session model changes, the generic session update API, session-aware chain dispatch logic, chat UI controls, and related tests.
