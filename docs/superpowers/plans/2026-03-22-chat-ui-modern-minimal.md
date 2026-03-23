# Chat UI Modern Minimal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the chat page into a modern minimal interface that prioritizes message content while moving sessions, agent controls, and workdir controls behind collapsible desktop and mobile surfaces.

**Architecture:** Keep the existing single-file React-in-HTML page and browser-side state management intact, but restructure the DOM into a narrow desktop utility rail, a primary chat stage, a desktop context panel, and a mobile bottom sheet. Preserve all existing runtime IDs and API calls that power sessions, agent toggles, workdir selection, auth, markdown rendering, and stream fallback behavior.

**Tech Stack:** Static HTML with inline React JSX in `public/index.html`, CSS in `public/styles.css`, Node test runner integration tests in `tests/integration/frontend-react-bindings.integration.test.js`

---

### Task 1: Lock In Layout Hooks With Tests

**Files:**
- Modify: `tests/integration/frontend-react-bindings.integration.test.js`
- Test: `tests/integration/frontend-react-bindings.integration.test.js`

- [ ] **Step 1: Write the failing test**

Add assertions for the new UI shell hooks:
- `className="utility-rail"`
- `id="mobileControlSheetBackdrop"`
- `id="contextPanel"`
- `window.toggleContextPanel = toggleContextPanel;`
- `window.openMobileControlHub = openMobileControlHub;`

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/integration/frontend-react-bindings.integration.test.js`
Expected: FAIL because the new layout hooks do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Add the corresponding DOM structure and exported helpers in `public/index.html`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/integration/frontend-react-bindings.integration.test.js`
Expected: PASS for the updated binding/layout assertions.

### Task 2: Restructure The Chat Shell

**Files:**
- Modify: `public/index.html`
- Test: `tests/integration/frontend-react-bindings.integration.test.js`

- [ ] **Step 1: Move existing controls into the new shell**

Keep session selectors, agent list, zero-state notice, current-agent info, and workdir selectors in the page, but reorganize them into:
- desktop utility rail
- top app bar
- desktop context panel
- mobile bottom-sheet hub

- [ ] **Step 2: Preserve interaction bindings**

Ensure `cacheDomElements`, `bindDomEvents`, session switching, workdir selectors, and auth controls still bind to the same runtime nodes.

- [ ] **Step 3: Add minimal panel state helpers**

Implement helper functions for:
- opening/closing desktop context panel
- switching context tabs
- opening/closing the mobile control hub

- [ ] **Step 4: Re-run the targeted test**

Run: `node --test tests/integration/frontend-react-bindings.integration.test.js`
Expected: PASS.

### Task 3: Apply The Modern Minimal Visual System

**Files:**
- Modify: `public/styles.css`
- Test: `tests/integration/frontend-react-bindings.integration.test.js`

- [ ] **Step 1: Replace the current blueprint-heavy theme tokens**

Introduce a restrained graphite palette, softer translucent surfaces, refined spacing, and a quieter background.

- [ ] **Step 2: Style the new layout surfaces**

Add styles for:
- utility rail
- compact top bar
- context panel
- mobile bottom sheet
- message stage
- elevated composer

- [ ] **Step 3: Preserve responsive behavior**

Keep the chat-first mobile layout, with the control hub hidden until opened and the message viewport remaining dominant.

- [ ] **Step 4: Re-run the targeted test**

Run: `node --test tests/integration/frontend-react-bindings.integration.test.js`
Expected: PASS because the DOM hooks still match the tested structure.

### Task 4: Verify The Redesign End-To-End

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Test: `tests/integration/frontend-react-bindings.integration.test.js`

- [ ] **Step 1: Run the focused integration test**

Run: `node --test tests/integration/frontend-react-bindings.integration.test.js`
Expected: PASS.

- [ ] **Step 2: Inspect the final diff**

Run: `git diff -- public/index.html public/styles.css tests/integration/frontend-react-bindings.integration.test.js`
Expected: only the approved chat UI redesign and test updates appear.
