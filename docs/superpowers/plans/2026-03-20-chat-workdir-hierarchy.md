# Chat Workdir Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chat page workdir control easier to use by moving it to the top of the chat pane and switching from a flat selector to hierarchical directory selection.

**Architecture:** Reuse the existing directory-listing approach already used by the admin page. Add the same directory browsing API to the chat server, then update the chat page to render a top-of-pane workdir bar with root/child selectors and a final preview that still saves through the existing `/api/workdirs/select` endpoint.

**Tech Stack:** Node.js HTTP server, vanilla JS in `public/index.html`, CSS in `public/styles.css`, Node integration tests

---

### Task 1: Lock The Expected UI Contract In Tests

**Files:**
- Modify: `tests/integration/frontend-react-bindings.integration.test.js`
- Modify: `tests/integration/chat-server-session-block.integration.test.js`

- [ ] **Step 1: Write the failing tests**

Add assertions that the chat page:
- renders `agentWorkdirRoot`, `agentWorkdirLevel2`, and `agentWorkdirPreview`
- loads hierarchy data from `/api/system/dirs`
- places `workdirBar` before `currentAgentBar`

Add a server integration assertion that authenticated chat users can browse `/api/system/dirs`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="对话页支持读取并设置当前智能体工作目录|React 页面将内联事件处理函数挂载到 window，并在 load 后绑定 DOM"`
Expected: FAIL because the chat page still renders a flat select and the chat server does not expose `/api/system/dirs`.

### Task 2: Add Chat-Side Directory Browsing API

**Files:**
- Modify: `src/server.ts`
- Test: `tests/integration/chat-server-session-block.integration.test.js`

- [ ] **Step 1: Add the minimal route**

Expose `GET /api/system/dirs?path=...` from the chat server using the existing `listDirectories()` helper and keep it behind normal chat authentication.

- [ ] **Step 2: Run the targeted server test**

Run: `node --test tests/integration/chat-server-session-block.integration.test.js`
Expected: PASS for the new directory-browsing assertion and existing workdir persistence assertions.

### Task 3: Replace The Flat Workdir Selector In Chat UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Test: `tests/integration/frontend-react-bindings.integration.test.js`

- [ ] **Step 1: Implement the UI**

Move `workdirBar` above `currentAgentBar`, replace the single select with hierarchical selectors plus a readonly preview, and load child directories on demand from `/api/system/dirs`.

- [ ] **Step 2: Keep save behavior compatible**

Continue saving the chosen final path through `window.applyAgentWorkdir` and `/api/workdirs/select`, preserving per-agent session overrides.

- [ ] **Step 3: Run the targeted frontend test**

Run: `node --test tests/integration/frontend-react-bindings.integration.test.js`
Expected: PASS with the new structure and API references.

### Task 4: Verify The Full Change

**Files:**
- No additional edits

- [ ] **Step 1: Run relevant verification**

Run: `npm test`
Expected: PASS

- [ ] **Step 2: Review final diff**

Confirm only the intended chat workdir UX, route, and tests changed.
