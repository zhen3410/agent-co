# Session Agent Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add session-scoped agent enable/disable controls so each session starts with no enabled agents, disabled agents cannot be mentioned, and the chat UI manages the state with inline sliders.

**Architecture:** Extend `UserChatSession` with an `enabledAgents` list as the single source of truth for session-level availability. Filter mentions and continuous-chat routing through that list on the server, then update the chat page to render enabled agents first, disabled agents last, with inline slider controls and zero-enabled guidance.

**Tech Stack:** Node.js HTTP server, TypeScript, vanilla JS in `public/index.html`, CSS in `public/styles.css`, Node integration tests

---

### Task 1: Lock Session-Agent Behavior In Failing Tests

**Files:**
- Modify: `tests/integration/chat-server-session-block.integration.test.js`
- Modify: `tests/integration/frontend-react-bindings.integration.test.js`

- [ ] **Step 1: Write the failing tests**

Add server assertions for:
- new sessions returning `enabledAgents: []`
- toggling session agent state through `POST /api/session-agents`
- disabled agents being ignored by mention routing
- zero-enabled sessions returning a clear user-facing prompt
- disabled `currentAgent` expiring on the next message

Add frontend assertions for:
- slider control markup in the chat agent list
- disabled agent styling and state attributes
- session-enabled agent references in the mention suggestion logic

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="会话接口支持创建、切换、重命名与删除|对话页支持读取并设置当前智能体工作目录|React 页面将内联事件处理函数挂载到 window，并在 load 后绑定 DOM"`
Expected: FAIL because the session model and chat page do not yet expose session-level agent enablement.

### Task 2: Add Session-Level Agent State To The Chat Server

**Files:**
- Modify: `src/types.ts`
- Modify: `src/server.ts`
- Test: `tests/integration/chat-server-session-block.integration.test.js`

- [ ] **Step 1: Implement minimal session data support**

Add `enabledAgents` to the in-memory and persisted session shape, default new sessions to `[]`, and compatibly hydrate legacy sessions by enabling all currently configured agents.

- [ ] **Step 2: Add the session-agent toggle endpoint**

Expose `POST /api/session-agents`, validate target agents against the global agent manager, and return the updated `enabledAgents` plus `currentAgentWillExpire`.

- [ ] **Step 3: Filter chat routing through enabled agents**

Gate mention routing, `@所有人`, and follow-up `currentAgent` reuse on the session’s enabled set. Return a clear response when no enabled agents are available.

- [ ] **Step 4: Run the targeted server tests**

Run: `node --test tests/integration/chat-server-session-block.integration.test.js`
Expected: PASS

### Task 3: Update The Chat UI For Inline Session Agent Toggles

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Test: `tests/integration/frontend-react-bindings.integration.test.js`

- [ ] **Step 1: Implement the inline toggle UI**

Render enabled agents first and disabled agents last, add inline slider controls, disable mention-click behavior for disabled agents, and show the zero-enabled guidance state.

- [ ] **Step 2: Wire the page to the new session-agent API**

Store `enabledAgents` in page state, load it from history/session responses, update it through `POST /api/session-agents`, and filter mention suggestions against the enabled set.

- [ ] **Step 3: Preserve current-agent UX**

Show a lightweight pending-expiry hint when the current agent is disabled and clear the current agent after the next send when the server reports it expired.

- [ ] **Step 4: Run the targeted frontend test**

Run: `node --test tests/integration/frontend-react-bindings.integration.test.js`
Expected: PASS

### Task 4: Verify The End-To-End Change

**Files:**
- No additional edits

- [ ] **Step 1: Run relevant verification**

Run: `npm test`
Expected: PASS

- [ ] **Step 2: Review the final diff**

Confirm the diff only contains the intended session-agent data model, routing, UI, and tests.
