# Chat Modularization Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Continue the modularization wave by slimming the chat bootstrap path, unifying application/http error handling, extracting a dedicated agent-invocation subsystem, and adding a faster lower-level test layer to support future refactors.

**Architecture:** Keep current behavior and top-level entrypoints stable, but push startup wiring, provider dispatch, and error semantics behind narrower feature-oriented modules. Preserve the current composition-root approach while reducing `server.ts` and `src/agent-invoker.ts` to thin façades. Add focused low-cost tests so future architectural changes do not rely exclusively on the slow full integration suite.

**Tech Stack:** TypeScript, Node.js built-in HTTP server, Node test runner (`node:test`), existing integration tests, new unit/contract tests.

---

## File Structure

### Existing files to modify
- `src/server.ts` — reduce to minimal process entrypoint and startup error handling.
- `src/chat/bootstrap/create-chat-server.ts` — keep HTTP server composition focused on request pipeline, and fold the pre-route auth gate into the shared error-mapping strategy.
- `src/chat/bootstrap/chat-server-startup.ts` — keep startup lifecycle, but delegate security/banner details.
- `src/shared/http/errors.ts` — evolve from generic fallback sender into adapter over typed app errors.
- `src/chat/application/auth-service.ts` — migrate validation/auth failures to typed errors where appropriate.
- `src/chat/application/chat-service.ts` — preserve public API while delegating typed failure mapping to helper modules.
- `src/chat/application/session-service.ts` — preserve public API while delegating typed validation failures to helper modules.
- `src/chat/http/auth-routes.ts` — map typed app errors through shared HTTP error mapper.
- `src/chat/http/chat-routes.ts` — map typed app/service errors consistently.
- `src/chat/http/callback-routes.ts` — reuse shared error mapping instead of ad hoc response semantics.
- `src/chat/http/ops-routes.ts` — keep current top-level route split stable while shared error mapping moves into the underlying ops route groups.
- `src/chat/http/ops/dependency-routes.ts` — migrate ops dependency endpoints to shared error mapping.
- `src/chat/http/ops/system-routes.ts` — migrate system/workdir endpoints to shared error mapping.
- `src/chat/http/ops/verbose-log-routes.ts` — migrate verbose-log endpoints to shared error mapping.
- `src/agent-invoker.ts` — reduce to a compatibility façade over the new invocation subsystem.
- `src/providers/cli-provider.ts` — keep provider-specific execution isolated behind invocation subsystem contracts.
- `src/providers/openai-compatible-provider.ts` — keep provider-specific execution isolated behind invocation subsystem contracts.
- `package.json` — add lower-level test scripts without breaking existing `npm test`.

### New files to create
- `src/chat/bootstrap/chat-env-config.ts` — normalize environment/config loading for chat server startup.
- `src/chat/bootstrap/create-chat-runtime-deps.ts` — build runtime + agent-store dependencies from normalized config.
- `src/chat/bootstrap/create-chat-application.ts` — assemble auth/session/chat services from runtime and agent dependencies.
- `src/chat/bootstrap/chat-startup-security.ts` — production/dev security validation currently embedded in startup.
- `src/chat/bootstrap/chat-startup-banner.ts` — startup banner/log output currently embedded in startup.
- `src/shared/errors/app-error.ts` — base typed error model with machine-readable code + status metadata.
- `src/shared/errors/app-error-codes.ts` — shared error code constants and helpers.
- `src/shared/http/error-mapper.ts` — translate typed app errors to stable JSON HTTP responses.
- `src/agent-invocation/agent-invoker-types.ts` — invocation contracts shared by orchestration and providers.
- `src/agent-invocation/invoke-target.ts` — normalize agent execution target/cli selection.
- `src/agent-invocation/model-connection-loader.ts` — isolate API connection file resolution/loading.
- `src/agent-invocation/invoke-cli-agent.ts` — CLI path orchestration over `src/providers/cli-provider.ts`.
- `src/agent-invocation/invoke-api-agent.ts` — API path orchestration over `src/providers/openai-compatible-provider.ts`.
- `src/agent-invocation/agent-invoker.ts` — new internal invocation entrypoint.
- `tests/integration/chat-server-bootstrap-boundaries.integration.test.js` — structure-contract coverage for bootstrap extraction.
- `tests/integration/chat-server-error-contracts.integration.test.js` — behavior/contract coverage for typed error mapping.
- `tests/integration/chat-server-agent-invoker-boundaries.integration.test.js` — structure-contract coverage for invocation subsystem extraction.
- `tests/unit/app-error.unit.test.js` — low-cost tests for typed errors and HTTP mapping.
- `tests/unit/agent-invocation.unit.test.js` — low-cost tests for invoke target normalization and connection resolution.
- `tests/unit/session-discussion-rules.unit.test.js` — low-cost rule tests for discussion/session constraints already encoded in helper modules.

### Existing tests used for verification
- `tests/integration/chat-server.integration.test.js`
- `tests/integration/chat-server-sessions.integration.test.js`
- `tests/integration/chat-server-session-block.integration.test.js`
- `tests/integration/chat-server-ops.integration.test.js`
- `tests/integration/callbacks.integration.test.js`
- `tests/integration/claude-cli-mcp.integration.test.js`
- `tests/integration/frontend-react-bindings.integration.test.js`

---

### Task 9: Split chat bootstrap and reduce `server.ts` to a true entrypoint

**Files:**
- Create: `src/chat/bootstrap/chat-env-config.ts`
- Create: `src/chat/bootstrap/create-chat-runtime-deps.ts`
- Create: `src/chat/bootstrap/create-chat-application.ts`
- Create: `src/chat/bootstrap/chat-startup-security.ts`
- Create: `src/chat/bootstrap/chat-startup-banner.ts`
- Modify: `src/server.ts`
- Modify: `src/chat/bootstrap/chat-server-startup.ts`
- Create: `tests/integration/chat-server-bootstrap-boundaries.integration.test.js`
- Verify against: `tests/integration/chat-server.integration.test.js`
- Verify against: `tests/integration/chat-server-ops.integration.test.js`
- Verify against: `tests/integration/callbacks.integration.test.js`

> Keep `src/server.ts` as the Node entrypoint only. It may read config, call the new bootstrap helpers, attach signal handlers, and handle top-level startup failure logging. It should stop assembling low-level runtime/application dependencies inline.

- [x] **Step 1: Write the failing bootstrap boundary test**

Assert a stable bootstrap boundary: `src/server.ts` remains a thin entrypoint with a narrow runtime value-export surface, while startup wiring lives behind the dedicated bootstrap helpers. Prefer AST or export-surface checks over brittle line-count/import-shape assertions.

- [x] **Step 2: Run the bootstrap boundary test and verify it fails**

Run: `node --test tests/integration/chat-server-bootstrap-boundaries.integration.test.js`
Expected: FAIL before the new bootstrap helpers exist.

- [x] **Step 3: Extract environment/config normalization**

Move env parsing and default-path resolution from `src/server.ts` into `src/chat/bootstrap/chat-env-config.ts`. Keep all current defaults and names identical.

- [x] **Step 4: Extract runtime/application assembly helpers**

Move runtime/agent-store creation into `create-chat-runtime-deps.ts`, and move auth/session/chat service assembly into `create-chat-application.ts`.

- [x] **Step 5: Extract startup security/banner helpers**

Move `performSecurityChecks` into `chat-startup-security.ts` and `logStartupBanner` into `chat-startup-banner.ts`. Keep `chat-server-startup.ts` responsible only for calling them in order around hydrate/listen.

- [x] **Step 6: Reduce `src/server.ts` to a minimal entrypoint**

Leave only: config loading, dependency assembly calls, signal hooks, and `startChatServer(...)` invocation.

- [x] **Step 7: Run focused verification**

Run: `npm run build && node --test tests/integration/chat-server-bootstrap-boundaries.integration.test.js tests/integration/chat-server.integration.test.js tests/integration/chat-server-ops.integration.test.js tests/integration/callbacks.integration.test.js`
Expected: PASS.

- [x] **Step 8: Commit Task 9**

```bash
git add src/server.ts src/chat/bootstrap/*.ts tests/integration/chat-server-bootstrap-boundaries.integration.test.js
git commit -m "refactor: split chat bootstrap wiring"
```

### Task 10: Introduce a typed application/http error model

**Files:**
- Create: `src/shared/errors/app-error.ts`
- Create: `src/shared/errors/app-error-codes.ts`
- Create: `src/shared/http/error-mapper.ts`
- Modify: `src/shared/http/errors.ts`
- Modify: `src/chat/application/auth-service.ts`
- Modify: `src/chat/application/chat-service.ts`
- Modify: `src/chat/application/session-service.ts`
- Modify: `src/chat/http/auth-routes.ts`
- Modify: `src/chat/http/chat-routes.ts`
- Modify: `src/chat/http/callback-routes.ts`
- Modify: `src/chat/http/ops-routes.ts`
- Modify: `src/chat/http/ops/dependency-routes.ts`
- Modify: `src/chat/http/ops/system-routes.ts`
- Modify: `src/chat/http/ops/verbose-log-routes.ts`
- Modify: `src/chat/bootstrap/create-chat-server.ts`
- Create: `tests/integration/chat-server-error-contracts.integration.test.js`
- Create: `tests/unit/app-error.unit.test.js`
- Verify against: `tests/integration/chat-server.integration.test.js`
- Verify against: `tests/integration/chat-server-sessions.integration.test.js`
- Verify against: `tests/integration/chat-server-ops.integration.test.js`
- Verify against: `tests/integration/callbacks.integration.test.js`

> Do not redesign every error in one shot. Start with the repeated validation/auth/not-found/conflict/provider-style failures that already surface through HTTP, and preserve current response bodies unless the plan explicitly changes them. This task includes the pre-route unauthorized response in `create-chat-server.ts` so 401 handling is unified end-to-end.

- [x] **Step 1: Write failing tests for typed error contracts**

Add unit coverage for status/code/body mapping and integration coverage proving key routes still return the same HTTP semantics while using typed app errors internally.

- [x] **Step 2: Run the new tests and verify they fail**

Run: `npm run build && node --test tests/unit/app-error.unit.test.js tests/integration/chat-server-error-contracts.integration.test.js`
Expected: FAIL before typed errors and mapper exist.

- [x] **Step 3: Add the base typed error model**

Create `AppError` plus shared codes for validation, unauthorized, forbidden, not-found, conflict, dependency-failure, and internal-failure paths.

- [x] **Step 4: Add shared HTTP error mapping**

Create `error-mapper.ts` and update `src/shared/http/errors.ts` to delegate to it while retaining invalid-JSON handling.

- [x] **Step 5: Migrate application and route hotspots incrementally**

Update `auth-service`, `chat-service`, `session-service`, `create-chat-server.ts`, and the main route modules (including the split ops route-group files) to throw or map typed errors in repeated validation and not-found cases, but preserve current HTTP payload contracts.

- [x] **Step 6: Run focused verification**

Run: `npm run build && node --test tests/unit/app-error.unit.test.js tests/integration/chat-server-error-contracts.integration.test.js tests/integration/chat-server.integration.test.js tests/integration/chat-server-sessions.integration.test.js tests/integration/chat-server-ops.integration.test.js tests/integration/callbacks.integration.test.js`
Expected: PASS.

- [x] **Step 7: Commit Task 10**

```bash
git add src/shared/errors/*.ts src/shared/http/*.ts src/chat/application/*.ts src/chat/http/*.ts src/chat/http/ops/*.ts src/chat/bootstrap/create-chat-server.ts tests/unit/app-error.unit.test.js tests/integration/chat-server-error-contracts.integration.test.js
git commit -m "refactor: add typed app error mapping"
```

### Task 11: Extract a dedicated agent-invocation subsystem behind a façade

**Files:**
- Create: `src/agent-invocation/agent-invoker-types.ts`
- Create: `src/agent-invocation/invoke-target.ts`
- Create: `src/agent-invocation/model-connection-loader.ts`
- Create: `src/agent-invocation/invoke-cli-agent.ts`
- Create: `src/agent-invocation/invoke-api-agent.ts`
- Create: `src/agent-invocation/agent-invoker.ts`
- Modify: `src/agent-invoker.ts`
- Modify: `src/providers/cli-provider.ts`
- Modify: `src/providers/openai-compatible-provider.ts`
- Create: `tests/integration/chat-server-agent-invoker-boundaries.integration.test.js`
- Create: `tests/unit/agent-invocation.unit.test.js`
- Verify against: `tests/integration/chat-server.integration.test.js`
- Verify against: `tests/integration/claude-cli-mcp.integration.test.js`
- Verify against: `tests/integration/callbacks.integration.test.js`

> Keep public import compatibility for current callers of `src/agent-invoker.ts`. The root file should become a thin forwarding façade so this extraction is behavior-preserving and low-risk.

- [x] **Step 1: Write failing boundary/unit tests for invocation extraction**

Add boundary coverage that `src/agent-invoker.ts` preserves a stable compatibility surface while the new subsystem owns normalization and provider dispatch. Prefer export-surface or behavior-level checks over brittle import-shape assertions. Also add unit coverage for cli-name normalization, execution-mode selection, and model-connection lookup failures.

- [x] **Step 2: Run the new tests and verify they fail**

Run: `npm run build && node --test tests/unit/agent-invocation.unit.test.js tests/integration/chat-server-agent-invoker-boundaries.integration.test.js`
Expected: FAIL before the new subsystem exists.

- [x] **Step 3: Extract target normalization and connection loading**

Move execution target normalization to `invoke-target.ts`, and isolate model connection file resolution/loading in `model-connection-loader.ts`.

- [x] **Step 4: Extract provider-specific orchestration helpers**

Create `invoke-cli-agent.ts` and `invoke-api-agent.ts` as the only modules that know how to call the underlying provider implementations.

- [x] **Step 5: Reduce `src/agent-invoker.ts` to a façade**

Create `src/agent-invocation/agent-invoker.ts` as the new internal entrypoint and keep the root `src/agent-invoker.ts` as a compatibility re-export/delegator.

- [x] **Step 6: Run focused verification**

Run: `npm run build && node --test tests/unit/agent-invocation.unit.test.js tests/integration/chat-server-agent-invoker-boundaries.integration.test.js tests/integration/chat-server.integration.test.js tests/integration/claude-cli-mcp.integration.test.js tests/integration/callbacks.integration.test.js`
Expected: PASS.

- [x] **Step 7: Commit Task 11**

```bash
git add src/agent-invocation/*.ts src/agent-invoker.ts src/providers/*.ts tests/unit/agent-invocation.unit.test.js tests/integration/chat-server-agent-invoker-boundaries.integration.test.js
git commit -m "refactor: extract agent invocation subsystem"
```

### Task 12: Add a lower-level test layer for faster architectural refactors

**Files:**
- Modify: `package.json`
- Create: `tests/unit/app-error.unit.test.js`
- Create: `tests/unit/agent-invocation.unit.test.js`
- Create: `tests/unit/session-discussion-rules.unit.test.js`
- Modify: `tests/integration/chat-server-runtime-contract.integration.test.js`
- Modify: `tests/integration/chat-server-service-boundaries.integration.test.js`
- Modify: `tests/integration/chat-server-session-service-boundaries.integration.test.js`
- Modify: `tests/integration/chat-server-ops-boundaries.integration.test.js`
- Verify against: `tests/integration/chat-server.integration.test.js`
- Verify against: `tests/integration/chat-server-sessions.integration.test.js`
- Verify against: `tests/integration/chat-server-ops.integration.test.js`

> This task does not replace integration coverage. It adds a faster layer for pure logic and stable module-boundary contracts, so the full suite remains the final safety net but is no longer the only safety net.

- [x] **Step 1: Add failing low-level tests and scripts**

Add `test:unit` and `test:fast` scripts to `package.json`, create the new unit tests, and tighten boundary tests toward stable exports/behavior rather than brittle file-shape checks.

- [x] **Step 2: Run the new fast test commands and verify they fail**

Run: `npm run build && npm run test:unit && npm run test:fast`
Expected: FAIL before the new files/scripts are fully implemented.

- [x] **Step 3: Implement the fast test layer**

Wire `package.json` scripts, add the unit tests, and refactor existing boundary tests where needed so they clearly cover stable contracts instead of implementation trivia.

- [x] **Step 4: Run focused verification**

Run: `npm run build && npm run test:unit && npm run test:fast`
Expected: PASS.

- [x] **Step 5: Commit Task 12**

```bash
git add package.json tests/unit/*.test.js tests/integration/chat-server-*.integration.test.js
git commit -m "test: add fast contract and unit coverage"
```

### Execution Notes

- Boundary and fast-layer tests were refined toward stable export-surface, compiled-module behavior, and helper-contract checks instead of brittle line-count or exact import-shape assertions.
- Task 10 kept legacy wire contracts where needed; in a few legacy `400` paths the semantic error code was intentionally aligned to `VALIDATION_FAILED` rather than forcing `NOT_FOUND` with a mismatched status override.
- Task 12 moved build orchestration into `package.json` (`test:unit`, `test:fast`) so the fast layer validates fresh compiled output instead of self-building opportunistically inside test files.
- Execution commits:
  - `f0c2806` `refactor: split chat bootstrap wiring`
  - `a781743` `refactor: add typed app error mapping`
  - `ed2880a` `refactor: extract agent invocation subsystem`
  - `de72e76` `test: add fast contract and unit coverage`
- Final verification completed on 2026-04-07 with:
  - `npm run build && npm test && npm run test:unit && npm run test:fast`
  - integration: `pass 208`, `fail 0`
  - unit: `pass 18`, `fail 0`
  - fast: `pass 34`, `fail 0`

### Final Verification and Handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-04-07-chat-modularization-phase-3.md`

- [x] **Step 1: Run full verification**

Run: `npm run build && npm test`
Expected: PASS with all integration tests green.

- [x] **Step 2: Run the new fast verification layer**

Run: `npm run build && npm run test:unit && npm run test:fast`
Expected: PASS.

- [x] **Step 3: Update plan checkboxes / notes**

Mark completed steps, record any deviations, and note final verification results.

- [x] **Step 4: Final review-ready commit if needed**

```bash
git add docs/superpowers/plans/2026-04-07-chat-modularization-phase-3.md
git commit -m "docs: record phase 3 modularization plan"
```
