# Message Call Mini Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inline SVG mini-graph to expanded message call-graph panels, showing a stable default core view of up to 8 nodes and allowing users to expand to the full local graph and drag the canvas to inspect it.

**Architecture:** Keep layout logic in pure frontend helpers so it can be unit-tested and remain deterministic. Render the mini-graph as SVG inside each message card, with a lightweight UI state store for per-message expansion/full-view/pan offsets, and preserve the existing structured detail list below the graph.

**Tech Stack:** TypeScript data contracts, existing HTML/JS frontend in `public/index.html`, CSS in `public/styles.css`, Node test runner integration contracts.

---

### Task 1: Add failing frontend contract tests for mini-graph hooks

**Files:**
- Modify: `tests/integration/frontend-react-bindings.integration.test.js`
- Test: `tests/integration/frontend-react-bindings.integration.test.js`

- [ ] **Step 1: Write the failing tests**

Add assertions for:
- `renderMessageGraphCanvas` / `renderMessageGraphSvg`
- `message__graph-canvas-wrap`, `message__graph-svg`, `data-node-id`
- `expand-call-graph`, `reset-call-graph-view`
- pointer drag handlers for mini-graph panning

- [ ] **Step 2: Run the targeted tests to verify RED**

Run: `node --test tests/integration/frontend-react-bindings.integration.test.js --test-name-pattern "mini graph|调用图"`
Expected: FAIL because the mini-graph hooks do not exist yet.

- [ ] **Step 3: Commit test-only red state only if requested**

Do not commit red state unless the human explicitly asks.

### Task 2: Add pure graph selection and layout helpers

**Files:**
- Modify: `public/index.html`
- Test: `tests/integration/frontend-react-bindings.integration.test.js`

- [ ] **Step 1: Extend failing tests to cover layout helper contracts**

Assert presence of helper names and stable responsibilities:
- `selectCoreGraph`
- `assignGraphDepths`
- `layoutGraphNodes`
- `buildGraphEdgePaths`

- [ ] **Step 2: Run targeted tests to verify RED**

Run: `node --test tests/integration/frontend-react-bindings.integration.test.js --test-name-pattern "mini graph|调用图"`
Expected: FAIL because helper contracts do not exist yet.

- [ ] **Step 3: Implement minimal pure helpers in `public/index.html`**

Implement deterministic helpers that:
- keep focus node in the graph
- choose at most 8 default nodes for core mode
- assign stable depth/column positions
- build SVG edge paths, including loopback styling for cycle edges

- [ ] **Step 4: Re-run targeted tests to verify GREEN**

Run: `node --test tests/integration/frontend-react-bindings.integration.test.js --test-name-pattern "mini graph|调用图"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/index.html tests/integration/frontend-react-bindings.integration.test.js
git commit -m "feat: add message call mini-graph layout helpers"
```

### Task 3: Render SVG mini-graph and toolbar in message panels

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Test: `tests/integration/frontend-react-bindings.integration.test.js`

- [ ] **Step 1: Add failing tests for canvas/toolbar markup**

Assert markup for:
- SVG canvas wrapper
- toolbar buttons
- hidden/full-mode markers
- active node styling hooks

- [ ] **Step 2: Run targeted tests to verify RED**

Run: `node --test tests/integration/frontend-react-bindings.integration.test.js --test-name-pattern "mini graph|调用图"`
Expected: FAIL because the SVG renderer does not exist yet.

- [ ] **Step 3: Implement minimal SVG rendering**

Implement:
- `renderMessageGraphCanvas(callGraph, messageId)`
- `renderMessageGraphSvg(graphView, messageId)`
- SVG nodes/edges for core mode first
- toolbar with expand-all/reset buttons
- styles in `public/styles.css`

- [ ] **Step 4: Re-run targeted tests to verify GREEN**

Run: `node --test tests/integration/frontend-react-bindings.integration.test.js --test-name-pattern "mini graph|调用图"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/styles.css tests/integration/frontend-react-bindings.integration.test.js
git commit -m "feat: render inline message call mini graph"
```

### Task 4: Add expand-all and drag-to-pan behavior

**Files:**
- Modify: `public/index.html`
- Test: `tests/integration/frontend-react-bindings.integration.test.js`

- [ ] **Step 1: Add failing tests for interaction state hooks**

Assert contracts for:
- per-message graph UI state storage
- `expand-call-graph`
- `reset-call-graph-view`
- `pointerdown` / `pointermove` / `pointerup`
- pan transform application

- [ ] **Step 2: Run targeted tests to verify RED**

Run: `node --test tests/integration/frontend-react-bindings.integration.test.js --test-name-pattern "mini graph|调用图"`
Expected: FAIL because expand-all / drag state is missing.

- [ ] **Step 3: Implement minimal interaction logic**

Implement:
- per-message graph UI state map
- full graph mode toggle
- panning offsets
- reset view button
- rerender current panel after interaction changes

- [ ] **Step 4: Re-run targeted tests to verify GREEN**

Run: `node --test tests/integration/frontend-react-bindings.integration.test.js --test-name-pattern "mini graph|调用图"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/index.html tests/integration/frontend-react-bindings.integration.test.js
git commit -m "feat: support expanding and panning mini call graphs"
```

### Task 5: Final verification

**Files:**
- Modify: only files changed above
- Test: `tests/integration/frontend-react-bindings.integration.test.js`
- Test: `tests/unit/message-call-graph.unit.test.js`

- [ ] **Step 1: Run focused verification**

Run:
```bash
npm run build && \
node --test tests/unit/message-call-graph.unit.test.js && \
node --test tests/integration/frontend-react-bindings.integration.test.js --test-name-pattern "mini graph|调用图"
```
Expected: PASS.

- [ ] **Step 2: Run broader regression check if focused suite passes**

Run:
```bash
npm run build
```
Expected: PASS.

- [ ] **Step 3: Prepare handoff**

Capture:
- files changed
- tests run and results
- known limits (SVG only, fixed layout, no free node dragging)
