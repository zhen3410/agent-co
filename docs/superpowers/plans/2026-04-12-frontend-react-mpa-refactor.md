# Frontend React MPA Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current hand-written HTML frontend with a React + Vite + TypeScript multi-page frontend that covers chat, admin, and ops pages while preserving the existing Node server boundaries.

**Architecture:** Add a dedicated `frontend/` application organized by `chat`, `admin`, and `ops` domains plus a shared design-system/infrastructure layer. Use Vite multi-entry builds to produce static assets served by the existing chat/admin servers, then migrate pages incrementally: foundation first, chat first, admin second, ops third, cleanup last.

**Tech Stack:** TypeScript, React, Vite, Node.js HTTP servers, existing `src/chat` and `src/admin` routing layers, Node test runner (`node:test`), assert/strict.

---

## File Structure / Responsibility Map

### New frontend workspace
- Create: `frontend/package.json` — frontend-only scripts and dependencies.
- Create: `frontend/tsconfig.json` — isolated TS config for React app.
- Create: `frontend/vite.config.ts` — MPA build config and output paths.
- Create: `frontend/index.html` — Vite root shell if needed for local dev.
- Create: `frontend/src/entries/chat-main.tsx` — chat page entry.
- Create: `frontend/src/entries/admin-main.tsx` — admin page entry.
- Create: `frontend/src/entries/deps-monitor-main.tsx` — ops dependency monitor entry.
- Create: `frontend/src/entries/verbose-logs-main.tsx` — ops verbose log entry.

### Shared frontend foundation
- Create: `frontend/src/shared/ui/*` — basic UI components.
- Create: `frontend/src/shared/layouts/*` — app/page layouts for chat/admin/ops.
- Create: `frontend/src/shared/styles/tokens.css` — design tokens.
- Create: `frontend/src/shared/styles/base.css` — reset/base typography/theme rules.
- Create: `frontend/src/shared/lib/http/*` — API client foundation.
- Create: `frontend/src/shared/lib/realtime/*` — WebSocket/SSE client wrappers.
- Create: `frontend/src/shared/types/*` — shared frontend types.

### Chat migration targets
- Create: `frontend/src/chat/pages/ChatPage.tsx`
- Create: `frontend/src/chat/features/session-sidebar/*`
- Create: `frontend/src/chat/features/message-list/*`
- Create: `frontend/src/chat/features/composer/*`
- Create: `frontend/src/chat/features/timeline-panel/*`
- Create: `frontend/src/chat/services/chat-api.ts`
- Create: `frontend/src/chat/services/chat-realtime.ts`
- Modify eventually: `public/index.html` or server route that currently serves it, switching to built frontend asset.
- Replace logic from: `public/chat-composer.js`, `public/chat-markdown.js`

### Admin migration targets
- Create: `frontend/src/admin/pages/AdminPage.tsx`
- Create: `frontend/src/admin/features/*`
- Create: `frontend/src/admin/services/admin-api.ts`
- Modify eventually: `public-auth/admin.html` or admin route that serves it.

### Ops migration targets
- Create: `frontend/src/ops/pages/DepsMonitorPage.tsx`
- Create: `frontend/src/ops/pages/VerboseLogsPage.tsx`
- Create: `frontend/src/ops/features/*`
- Create: `frontend/src/ops/services/ops-api.ts`
- Modify eventually: `public/deps-monitor.html`, `public/verbose-logs.html` serving path.

### Server integration targets
- Modify: `package.json` — root scripts to build frontend + backend.
- Modify: `src/chat/http/chat-routes.ts` and/or related static serving helpers — serve built chat frontend entry.
- Modify: `src/admin/http/auth-admin-routes.ts` and/or related support routes — serve built admin frontend entry.
- Modify: static asset support helpers if necessary so Vite output is mounted cleanly.

### Tests / docs
- Create: `tests/integration/frontend-build.integration.test.js` — sanity check frontend build artifacts are produced and mountable.
- Create: `tests/integration/chat-frontend-shell.integration.test.js` — chat page shell served.
- Create: `tests/integration/admin-frontend-shell.integration.test.js` — admin shell served.
- Update: docs and deployment scripts only after core integration is stable.

---

### Task 1: Inventory current frontend behavior and freeze page contracts

**Files:**
- Review: `public/index.html`
- Review: `public/chat-composer.js`
- Review: `public/chat-markdown.js`
- Review: `public-auth/admin.html`
- Review: `public/deps-monitor.html`
- Review: `public/verbose-logs.html`
- Create: `docs/architecture/2026-04-12-frontend-page-contracts.md`

- [ ] **Step 1: Document each existing page's responsibilities, API dependencies, and boot sequence**

Capture for each page:
- initial data sources
- user interactions
- realtime dependencies
- auth assumptions
- critical DOM sections worth preserving functionally

- [ ] **Step 2: Record the migration mapping from old pages/scripts to new React modules**

Write a table mapping:
- source page/script
- target entry/page/component
- migration notes

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/2026-04-12-frontend-page-contracts.md
git commit -m "docs: capture frontend page contracts"
```

### Task 2: Add frontend workspace and build plumbing

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Modify: `package.json`
- Test: `tests/integration/frontend-build.integration.test.js`

- [ ] **Step 1: Write the failing integration test for frontend build output**

Test exact behavior:
- `npm run build:frontend` exits successfully
- expected HTML entry files and asset manifest are emitted
- output directory is deterministic and does not overwrite backend source files

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/integration/frontend-build.integration.test.js`
Expected: FAIL because frontend workspace/scripts do not exist yet.

- [ ] **Step 3: Add minimal frontend workspace files and root build scripts**

Implement:
- isolated frontend dependency manifest
- Vite MPA config with named entries
- root scripts like `build:frontend`, `dev:frontend`

- [ ] **Step 4: Re-run the targeted test**

Run: `npm install && npm run build:frontend && node --test tests/integration/frontend-build.integration.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/tsconfig.json frontend/vite.config.ts frontend/index.html package.json tests/integration/frontend-build.integration.test.js
git commit -m "feat: add frontend workspace and build pipeline"
```

### Task 3: Build shared design-system foundation

**Files:**
- Create: `frontend/src/shared/styles/tokens.css`
- Create: `frontend/src/shared/styles/base.css`
- Create: `frontend/src/shared/ui/Button.tsx`
- Create: `frontend/src/shared/ui/Input.tsx`
- Create: `frontend/src/shared/ui/Card.tsx`
- Create: `frontend/src/shared/ui/Table.tsx`
- Create: `frontend/src/shared/ui/EmptyState.tsx`
- Create: `frontend/src/shared/ui/ErrorState.tsx`
- Create: `frontend/src/shared/ui/Spinner.tsx`
- Create: `frontend/src/shared/ui/index.ts`

- [ ] **Step 1: Write failing unit-level rendering tests for the first shared UI components**

Cover:
- components render semantic markup
- theme tokens are referenced consistently
- loading/error/empty patterns are composable

- [ ] **Step 2: Run the targeted tests and confirm failure**

Run: `npm run build:frontend && node --test tests/unit/frontend-shared-ui.unit.test.js`
Expected: FAIL because shared UI components do not exist.

- [ ] **Step 3: Implement minimal shared UI and token files**

Token categories must include:
- color
- spacing
- radius
- shadow
- typography
- status colors

- [ ] **Step 4: Re-run the tests**

Run: `npm run build:frontend && node --test tests/unit/frontend-shared-ui.unit.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/styles frontend/src/shared/ui tests/unit/frontend-shared-ui.unit.test.js
git commit -m "feat: add shared frontend design system foundation"
```

### Task 4: Add shared app shell, HTTP client, and realtime client

**Files:**
- Create: `frontend/src/shared/layouts/AppShell.tsx`
- Create: `frontend/src/shared/layouts/ToolPageLayout.tsx`
- Create: `frontend/src/shared/lib/http/http-client.ts`
- Create: `frontend/src/shared/lib/http/json-request.ts`
- Create: `frontend/src/shared/lib/realtime/realtime-client.ts`
- Create: `frontend/src/shared/lib/realtime/reconnect-policy.ts`
- Create: `frontend/src/shared/config/runtime-config.ts`

- [ ] **Step 1: Write failing tests for shared infrastructure behavior**

Cover:
- API client normalizes errors and JSON responses
- realtime client emits connect/disconnect/message lifecycle callbacks
- layouts render consistent chrome and slots

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run build:frontend && node --test tests/unit/frontend-infra.unit.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement shared infrastructure**

Expose exact primitives:
- `createHttpClient(...)`
- `requestJson(...)`
- `createRealtimeClient(...)`
- `AppShell`
- `ToolPageLayout`
- runtime config helpers reading page bootstrap config

- [ ] **Step 4: Re-run tests**

Run: `npm run build:frontend && node --test tests/unit/frontend-infra.unit.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/layouts frontend/src/shared/lib frontend/src/shared/config tests/unit/frontend-infra.unit.test.js
git commit -m "feat: add shared frontend app shell and clients"
```

### Task 5: Wire Vite output into the existing Node servers

**Files:**
- Modify: `src/chat/http/chat-routes.ts`
- Modify: `src/admin/http/auth-admin-routes.ts`
- Modify: `src/chat/http/chat-route-helpers.ts` and/or relevant static helper modules
- Modify: `src/admin/http/auth-admin-support-routes.ts` if needed
- Test: `tests/integration/chat-frontend-shell.integration.test.js`
- Test: `tests/integration/admin-frontend-shell.integration.test.js`

- [ ] **Step 1: Write failing integration tests for serving built frontend shells**

Test exact expectations:
- chat server returns built chat entry HTML at the existing main page URL
- admin server returns built admin entry HTML at the existing admin URL
- static assets under Vite output path are served with correct content types

- [ ] **Step 2: Run the tests and confirm failure**

Run: `npm run build && node --test tests/integration/chat-frontend-shell.integration.test.js tests/integration/admin-frontend-shell.integration.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement static asset mounting without bloating top-level composition roots**

Ensure:
- path resolution is centralized
- chat/admin route layers stay thin
- missing frontend build produces clear startup/runtime errors

- [ ] **Step 4: Re-run tests**

Run: `npm run build && node --test tests/integration/chat-frontend-shell.integration.test.js tests/integration/admin-frontend-shell.integration.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat/http/chat-routes.ts src/admin/http/auth-admin-routes.ts src/chat/http/chat-route-helpers.ts src/admin/http/auth-admin-support-routes.ts tests/integration/chat-frontend-shell.integration.test.js tests/integration/admin-frontend-shell.integration.test.js
git commit -m "feat: serve frontend build outputs from chat and admin servers"
```

### Task 6: Implement the chat page shell and migrate the composer/message rendering path

**Files:**
- Create: `frontend/src/entries/chat-main.tsx`
- Create: `frontend/src/chat/pages/ChatPage.tsx`
- Create: `frontend/src/chat/features/session-sidebar/SessionSidebar.tsx`
- Create: `frontend/src/chat/features/message-list/ChatMessageList.tsx`
- Create: `frontend/src/chat/features/composer/ChatComposer.tsx`
- Create: `frontend/src/chat/features/composer/useChatComposer.ts`
- Create: `frontend/src/chat/services/chat-api.ts`
- Create: `frontend/src/chat/services/chat-realtime.ts`
- Create: `frontend/src/chat/types/*`
- Replace legacy logic from: `public/chat-composer.js`, `public/chat-markdown.js`

- [ ] **Step 1: Write failing integration tests for the new chat shell behavior**

Cover:
- page renders shell + composer + message list
- send action issues the same backend request contract as current page
- basic message markdown rendering still works
- realtime adapter can append incoming events/messages into the visible list

- [ ] **Step 2: Run the targeted tests and confirm failure**

Run: `npm run build:frontend && node --test tests/integration/chat-frontend-shell.integration.test.js`
Expected: FAIL because the new chat frontend is not implemented.

- [ ] **Step 3: Implement the minimal chat page end-to-end**

Preserve current behavior first:
- load initial session state
- submit prompts
- render user/assistant/system messages
- render disabled/loading/error states

Do not add new product behavior in this task.

- [ ] **Step 4: Re-run tests**

Run: `npm run build:frontend && node --test tests/integration/chat-frontend-shell.integration.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/entries/chat-main.tsx frontend/src/chat
git commit -m "feat: migrate chat page to React shell"
```

### Task 7: Add advanced chat panels for timeline/call-graph/runtime status

**Files:**
- Create: `frontend/src/chat/features/timeline-panel/TimelinePanel.tsx`
- Create: `frontend/src/chat/features/runtime-status/RuntimeStatusBadge.tsx`
- Create: `frontend/src/chat/features/call-graph/CallGraphPanel.tsx`
- Modify: `frontend/src/chat/pages/ChatPage.tsx`

- [ ] **Step 1: Write failing tests for secondary chat panels and status rendering**
- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run build:frontend && node --test tests/integration/chat-frontend-shell.integration.test.js`
Expected: FAIL on missing timeline/call-graph/status behaviors.

- [ ] **Step 3: Implement panels using existing backend endpoints/events**

Keep boundaries clear:
- page orchestrates layout only
- panel-level hooks own fetch/subscription logic
- shared UI handles empty/error/loading states

- [ ] **Step 4: Re-run tests**

Run: `npm run build:frontend && node --test tests/integration/chat-frontend-shell.integration.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/chat/features frontend/src/chat/pages/ChatPage.tsx
git commit -m "feat: add timeline and runtime panels to chat frontend"
```

### Task 8: Implement the admin page shell and core management screens

**Files:**
- Create: `frontend/src/entries/admin-main.tsx`
- Create: `frontend/src/admin/pages/AdminPage.tsx`
- Create: `frontend/src/admin/features/agents/*`
- Create: `frontend/src/admin/features/groups/*`
- Create: `frontend/src/admin/features/users/*`
- Create: `frontend/src/admin/features/model-connections/*`
- Create: `frontend/src/admin/services/admin-api.ts`
- Create: `frontend/src/admin/types/*`

- [ ] **Step 1: Write failing integration tests for the admin shell and first management panels**

Cover:
- authenticated shell renders predictable navigation/layout
- resource lists load through shared API client
- create/edit actions surface success/error states consistently

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run build:frontend && node --test tests/integration/admin-frontend-shell.integration.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement the minimal admin frontend**

Prioritize:
- navigation shell
- agents/groups/model connection list + edit workflows
- empty/error/loading states

- [ ] **Step 4: Re-run tests**

Run: `npm run build:frontend && node --test tests/integration/admin-frontend-shell.integration.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/entries/admin-main.tsx frontend/src/admin
git commit -m "feat: migrate admin frontend to React"
```

### Task 9: Implement ops pages on the shared tooling layout

**Files:**
- Create: `frontend/src/entries/deps-monitor-main.tsx`
- Create: `frontend/src/entries/verbose-logs-main.tsx`
- Create: `frontend/src/ops/pages/DepsMonitorPage.tsx`
- Create: `frontend/src/ops/pages/VerboseLogsPage.tsx`
- Create: `frontend/src/ops/features/dependency-health/*`
- Create: `frontend/src/ops/features/log-viewer/*`
- Create: `frontend/src/ops/services/ops-api.ts`

- [ ] **Step 1: Write failing integration tests for ops page shells**

Cover:
- shared tool layout renders on both pages
- dependency data and verbose logs load through `opsApi`
- filters and refresh controls behave consistently

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run build:frontend && node --test tests/integration/ops-frontend-shell.integration.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement ops pages and shared diagnostic components**

Preserve:
- high-density data readability
- explicit status colors/badges
- resilient empty/error/loading handling

- [ ] **Step 4: Re-run tests**

Run: `npm run build:frontend && node --test tests/integration/ops-frontend-shell.integration.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/entries/deps-monitor-main.tsx frontend/src/entries/verbose-logs-main.tsx frontend/src/ops tests/integration/ops-frontend-shell.integration.test.js
git commit -m "feat: migrate ops pages to shared React tooling layout"
```

### Task 10: Remove or archive obsolete static pages and scripts

**Files:**
- Delete/retire: `public/chat-composer.js`
- Delete/retire: `public/chat-markdown.js` (if fully replaced)
- Delete/retire: legacy static HTML pages no longer used as product entrypoints
- Modify: deployment/bootstrap scripts if they reference retired assets
- Modify: docs referencing old pages

- [ ] **Step 1: Write/adjust regression tests to ensure current routes still work after removal**
- [ ] **Step 2: Run the full fast suite and confirm expected failures if references remain**

Run: `npm run test:fast`
Expected: FAIL until all legacy references are removed or redirected.

- [ ] **Step 3: Remove dead assets or convert them into redirects/archive docs**

Keep only files that still serve a real runtime purpose.

- [ ] **Step 4: Re-run the fast suite**

Run: `npm run test:fast`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: retire legacy static frontend assets"
```

### Task 11: Add frontend regression coverage and deployment documentation

**Files:**
- Create/modify: `tests/integration/*.integration.test.js` covering key page shells and static asset mounting
- Modify: `scripts/init-dev.sh`
- Modify: deployment/systemd docs if frontend build step must be included
- Modify: `docs/architecture/` or `README`-equivalent docs for frontend workflow

- [ ] **Step 1: Add failing tests/docs checks for developer and deploy workflow expectations**
- [ ] **Step 2: Run targeted tests and confirm failure where workflow is incomplete**

Run: `npm test`
Expected: FAIL until build/deploy docs and scripts match the new frontend pipeline.

- [ ] **Step 3: Update scripts and docs**

Must cover:
- local frontend dev loop
- production build order
- static asset output location
- rollback implications if frontend build is missing

- [ ] **Step 4: Re-run full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests scripts/init-dev.sh docs package.json
git commit -m "docs: document frontend build and deployment workflow"
```

---

## Notes for Execution

- Keep `src/server.ts` and `src/auth-admin-server.ts` as thin composition roots; do not stuff Vite/build logic there.
- Prefer introducing a dedicated server-side frontend asset resolver helper instead of scattering file-path logic across routes.
- During migration, preserve route compatibility first; visual refinement can land after parity.
- Avoid adding a global frontend store until a concrete shared-state need is proven.
- If a backend endpoint shape is hostile to componentized consumption, add a mapper in frontend first; only then consider a narrow backend adjustment.
