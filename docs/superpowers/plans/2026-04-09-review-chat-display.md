# Invocation Review Chat Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make caller review interactions visible in the chat timeline for both classic and peer modes while preserving the existing internal review state machine.

**Architecture:** Keep `internal_review` as an internal control path, but emit a separate visible chat message with structured review metadata after a valid review result is parsed. The frontend renders these messages as review cards with expandable raw text; resume logic continues to rely on persisted history and must not regenerate display messages.

**Tech Stack:** TypeScript, Node built-in test runner, existing chat orchestrator/runtime, static frontend in `public/index.html`.

---

### Task 1: Backend visible review event + regression tests

**Files:**
- Modify: `src/types.ts`
- Modify: `src/chat/application/chat-dispatch-orchestrator.ts`
- Test: `tests/integration/chat-server.integration.test.js`

- [ ] **Step 1: Write failing backend regression tests**
  - Add focused integration assertions covering `accept`, `follow_up`, and `retry` so chat history contains a visible review event message.
  - Assert the message includes structured metadata for subtype/action/raw text/caller/callee/task id.
  - Assert follow-up/retry still queue the next invoke and accept still completes the invocation task.

- [ ] **Step 2: Run focused backend tests to verify they fail for the expected reason**
  - Run: `node --test tests/integration/chat-server.integration.test.js --test-name-pattern "review"`
  - Expected: new assertions fail because visible review messages are not emitted yet.

- [ ] **Step 3: Implement minimal backend support**
  - Extend `Message` typing with a visible invocation-review subtype and related metadata.
  - In `chat-dispatch-orchestrator`, keep suppressing internal review control messages but return `visibleMessages` for parsed review outcomes.
  - Append those visible messages through the normal orchestrator history pipeline.

- [ ] **Step 4: Re-run focused backend tests**
  - Run: `node --test tests/integration/chat-server.integration.test.js --test-name-pattern "review"`
  - Expected: new backend review visibility tests pass.

### Task 2: Frontend review card rendering + rendering tests

**Files:**
- Modify: `public/index.html`
- Test: `tests/integration/frontend-react-bindings.integration.test.js`

- [ ] **Step 1: Write failing frontend rendering tests**
  - Add assertions that the frontend contains an `invocation_review` rendering branch, action styling, and expand/collapse raw-text affordance.

- [ ] **Step 2: Run focused frontend tests to verify they fail**
  - Run: `node --test tests/integration/frontend-react-bindings.integration.test.js --test-name-pattern "review"`
  - Expected: new assertions fail because the renderer does not yet support review cards.

- [ ] **Step 3: Implement minimal frontend rendering**
  - Add a dedicated render path for invocation-review messages.
  - Default to structured summary and provide inline expand/collapse for raw review text.

- [ ] **Step 4: Re-run focused frontend tests**
  - Run: `node --test tests/integration/frontend-react-bindings.integration.test.js --test-name-pattern "review"`
  - Expected: new rendering tests pass.

### Task 3: Focused verification

**Files:**
- Verify only

- [ ] **Step 1: Run focused backend review tests**
  - Run: `node --test tests/integration/chat-server.integration.test.js --test-name-pattern "review|caller review|超时"`

- [ ] **Step 2: Run focused frontend review tests**
  - Run: `node --test tests/integration/frontend-react-bindings.integration.test.js --test-name-pattern "review"`

- [ ] **Step 3: Run build**
  - Run: `npm run build`

- [ ] **Step 4: Summarize any unrelated baseline failures separately from this change**
