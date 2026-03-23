# Maintainability Modular Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the chat and auth-admin servers into a modular single-process architecture that preserves every existing external API and runtime entrypoint while materially improving maintainability.

**Architecture:** Keep deployment and API shape unchanged, but move from monolithic entry files to composition-root bootstraps plus focused route, application, and infrastructure modules. Extract shared HTTP utilities first, then peel chat and admin responsibilities behind stable module boundaries so integration tests remain the contract gate.

**Tech Stack:** TypeScript, Node.js `http`, `node:test`, Redis (`ioredis`), existing `dist/*.js` build pipeline

---

## File Structure

### Existing files to keep as entrypoints
- Modify: `src/server.ts`
- Modify: `src/auth-admin-server.ts`

### Shared HTTP and bootstrap utilities
- Create: `src/shared/http/body.ts`
- Create: `src/shared/http/json.ts`
- Create: `src/shared/http/cors.ts`
- Create: `src/shared/http/static-files.ts`
- Create: `src/shared/http/errors.ts`

### Chat server modules
- Create: `src/chat/bootstrap/create-chat-server.ts`
- Create: `src/chat/http/chat-routes.ts`
- Create: `src/chat/http/auth-routes.ts`
- Create: `src/chat/http/callback-routes.ts`
- Create: `src/chat/http/ops-routes.ts`
- Create: `src/chat/application/chat-service.ts`
- Create: `src/chat/application/session-service.ts`
- Create: `src/chat/application/auth-service.ts`
- Create: `src/chat/infrastructure/chat-session-repository.ts`
- Create: `src/chat/infrastructure/auth-admin-client.ts`
- Create: `src/chat/infrastructure/dependency-log-store.ts`
- Create: `src/chat/runtime/chat-runtime.ts`

### Auth-admin server modules
- Create: `src/admin/bootstrap/create-auth-admin-server.ts`
- Create: `src/admin/http/auth-admin-routes.ts`
- Create: `src/admin/application/user-admin-service.ts`
- Create: `src/admin/application/agent-admin-service.ts`
- Create: `src/admin/infrastructure/user-store.ts`
- Create: `src/admin/runtime/auth-admin-runtime.ts`

### Regression tests
- Modify: `tests/integration/chat-server.integration.test.js`
- Modify: `tests/integration/auth-admin-server.integration.test.js`
- Modify: `tests/integration/callbacks.integration.test.js`
- Create: `tests/integration/chat-server-sessions.integration.test.js`
- Create: `tests/integration/chat-server-ops.integration.test.js`

## Target Directory Layout

```text
src/
  server.ts
  auth-admin-server.ts
  shared/
    http/
      body.ts
      cors.ts
      errors.ts
      json.ts
      static-files.ts
  chat/
    bootstrap/
      create-chat-server.ts
    http/
      auth-routes.ts
      callback-routes.ts
      chat-routes.ts
      ops-routes.ts
    application/
      auth-service.ts
      chat-service.ts
      session-service.ts
    infrastructure/
      auth-admin-client.ts
      chat-session-repository.ts
      dependency-log-store.ts
    runtime/
      chat-runtime.ts
  admin/
    bootstrap/
      create-auth-admin-server.ts
    http/
      auth-admin-routes.ts
    application/
      agent-admin-service.ts
      user-admin-service.ts
    infrastructure/
      user-store.ts
    runtime/
      auth-admin-runtime.ts
```

## Boundary Rules

- `src/server.ts` and `src/auth-admin-server.ts` become composition roots only: env parsing, startup, shutdown hooks, and module wiring.
- Route modules handle HTTP concerns only: method/path matching, DTO parsing, response mapping.
- Application services own use-case orchestration.
- Runtime/repository modules encapsulate mutable state, Redis, filesystem access, and upstream auth/admin HTTP calls.
- Shared HTTP helpers must not depend on chat-specific or admin-specific modules.
- No new deployment unit, no API path changes, no fixture startup contract changes.

## Module Contracts

- `chat/runtime/chat-runtime.ts`
  Owns mutable session state, Redis hydration/persistence lifecycle, and shutdown hooks. It must not parse HTTP requests or construct HTTP responses.
- `chat/infrastructure/chat-session-repository.ts`
  Exposes storage-oriented methods such as `loadSessions`, `saveSessions`, `schedulePersist`, `appendCallbackMessage`, `consumeCallbackMessages`. It must not know route names or cookies.
- `chat/application/chat-service.ts`
  Orchestrates message sending, stream events, Route A block merge, and agent invocation. It consumes repositories/gateways and returns plain result objects.
- `chat/application/session-service.ts`
  Owns session CRUD, active-session selection, history lookup, and current-agent mutation rules. It is the only module allowed to change session metadata.
- `chat/application/auth-service.ts`
  Owns login/logout/auth-status flows, cookie decisions, and delegation to the auth-admin HTTP client.
- `chat/http/*`
  Performs request validation, calls one application service per use case, and maps typed failures to HTTP status codes.
- `admin/infrastructure/user-store.ts`
  Owns file bootstrapping, password hashing, persistence, and low-level user CRUD helpers.
- `admin/application/user-admin-service.ts`
  Owns `/api/auth/verify`, user lifecycle, and validation decisions above raw persistence.
- `admin/application/agent-admin-service.ts`
  Owns active/pending agent configuration workflows and apply-mode semantics.
- `admin/http/auth-admin-routes.ts`
  Owns admin-token enforcement and path dispatch for `/api/users*` and `/api/agents*`.

## Migration Slice Order

1. Shared HTTP helpers first
   This reduces duplicate plumbing in both servers without changing business flow.
2. Chat runtime and repositories second
   This extracts mutable state before touching route structure, lowering regression risk in the largest file.
3. Chat route and application split third
   After state is isolated, route handlers can become thin adapters with smaller diff surface.
4. Auth-admin modularization fourth
   It is smaller and should follow the same pattern once shared helpers and chat extraction validate the approach.
5. Documentation and dead-code cleanup last
   Cleanup earlier tends to hide regressions and complicate review.

## Task 1: Lock the Current HTTP Contract Before Refactor

**Files:**
- Modify: `tests/integration/chat-server.integration.test.js`
- Modify: `tests/integration/auth-admin-server.integration.test.js`
- Modify: `tests/integration/callbacks.integration.test.js`
- Create: `tests/integration/chat-server-sessions.integration.test.js`
- Create: `tests/integration/chat-server-ops.integration.test.js`

- [ ] **Step 1: Add missing chat-session contract coverage**

Add regression tests for:
- `POST /api/sessions`
- `POST /api/sessions/select`
- `POST /api/sessions/rename`
- `POST /api/sessions/delete`

Expected assertions:
- session creation returns a new `activeSessionId`
- selecting a session changes subsequent `/api/history`
- renaming is reflected in history/session summary payloads
- deleting the active session falls back to a valid remaining session

- [ ] **Step 2: Add missing ops/verbose contract coverage**

Add regression tests for:
- `GET /api/dependencies/status`
- `GET /api/dependencies/logs`
- `GET /api/verbose/logs`
- `GET /api/verbose/log-content`

Expected assertions:
- endpoints keep returning JSON payloads with current top-level keys
- verbose endpoints still support Chinese agent names
- dependency log query parameters still filter without server error

- [ ] **Step 3: Run the new tests to verify they fail only when coverage is incomplete**

Run:
```bash
npm run build
node --test tests/integration/chat-server-sessions.integration.test.js tests/integration/chat-server-ops.integration.test.js
```

Expected:
- On first run after writing tests, either PASS against existing behavior or reveal undocumented contract mismatches that must be resolved before refactor

- [ ] **Step 4: Run the existing regression suite as a baseline snapshot**

Run:
```bash
npm test
```

Expected:
- PASS before refactor starts

- [ ] **Step 5: Commit the contract lock**

```bash
git add tests/integration/chat-server.integration.test.js tests/integration/auth-admin-server.integration.test.js tests/integration/callbacks.integration.test.js tests/integration/chat-server-sessions.integration.test.js tests/integration/chat-server-ops.integration.test.js
git commit -m "test: lock server contracts before modular refactor"
```

## Task 2: Extract Shared HTTP Utilities and Reduce Duplicate Server Plumbing

**Files:**
- Create: `src/shared/http/body.ts`
- Create: `src/shared/http/json.ts`
- Create: `src/shared/http/cors.ts`
- Create: `src/shared/http/static-files.ts`
- Create: `src/shared/http/errors.ts`
- Modify: `src/server.ts`
- Modify: `src/auth-admin-server.ts`
- Test: `tests/integration/chat-server.integration.test.js`
- Test: `tests/integration/auth-admin-server.integration.test.js`

- [ ] **Step 1: Write a focused regression test for invalid JSON handling**

Add one assertion per server ensuring malformed JSON still returns the current status code and payload shape.

- [ ] **Step 2: Extract `parseBody`, JSON response writing, static file serving, CORS header setup, and top-level error mapping**

Target utility responsibilities:
- `body.ts`: request body parsing only
- `json.ts`: `sendJson` and plain-text/not-found helpers
- `cors.ts`: deterministic header application for chat vs admin
- `static-files.ts`: static file resolution under `public/` and `public-auth/`
- `errors.ts`: map known error categories to HTTP responses

- [ ] **Step 3: Update both entry files to use the shared helpers without changing route behavior**

Constraints:
- do not reorder public route matching
- preserve current CORS header differences between chat and admin
- keep existing startup output and environment validation behavior

- [ ] **Step 4: Verify shared extraction did not change behavior**

Run:
```bash
npm run build
node --test tests/integration/chat-server.integration.test.js tests/integration/auth-admin-server.integration.test.js
```

Expected:
- PASS

- [ ] **Step 5: Commit the shared HTTP extraction**

```bash
git add src/shared/http src/server.ts src/auth-admin-server.ts tests/integration/chat-server.integration.test.js tests/integration/auth-admin-server.integration.test.js
git commit -m "refactor: extract shared http helpers"
```

## Task 3: Modularize the Chat Server Behind a Composition Root

**Files:**
- Create: `src/chat/bootstrap/create-chat-server.ts`
- Create: `src/chat/http/chat-routes.ts`
- Create: `src/chat/http/auth-routes.ts`
- Create: `src/chat/http/callback-routes.ts`
- Create: `src/chat/http/ops-routes.ts`
- Create: `src/chat/application/chat-service.ts`
- Create: `src/chat/application/session-service.ts`
- Create: `src/chat/application/auth-service.ts`
- Create: `src/chat/infrastructure/chat-session-repository.ts`
- Create: `src/chat/infrastructure/auth-admin-client.ts`
- Create: `src/chat/infrastructure/dependency-log-store.ts`
- Create: `src/chat/runtime/chat-runtime.ts`
- Modify: `src/server.ts`
- Test: `tests/integration/chat-server.integration.test.js`
- Test: `tests/integration/callbacks.integration.test.js`
- Test: `tests/integration/chat-server-sessions.integration.test.js`
- Test: `tests/integration/chat-server-ops.integration.test.js`

- [ ] **Step 1: Introduce a `chat-runtime` module that owns mutable in-memory state and Redis hydration/persistence**

Move these responsibilities out of `src/server.ts`:
- user/session maps
- callback message buffer access
- Redis config loading, hydration, persistence scheduling
- dependency status log accumulation

Keep behavior unchanged:
- same default session naming
- same Redis fallback behavior when `BOT_ROOM_REDIS_REQUIRED=false`
- same shutdown persistence flow

- [ ] **Step 2: Introduce application services around use cases**

Service split:
- `chat-service.ts`: send message, stream message, block creation integration, rich block merge, agent call orchestration
- `session-service.ts`: create/select/rename/delete session, history lookup, current-agent mutation
- `auth-service.ts`: login/logout/auth-status, cookie issuance, auth requirement checks, auth-admin verification calls

Rule:
- services return plain result objects or typed errors, not raw HTTP responses

- [ ] **Step 3: Introduce route modules and a composition root**

Route split:
- `auth-routes.ts`: `/api/login`, `/api/logout`, `/api/auth-status`
- `chat-routes.ts`: `/api/agents`, `/api/chat`, `/api/chat-stream`, `/api/history`, `/api/clear`, session CRUD endpoints
- `callback-routes.ts`: callback endpoints and callback auth extraction
- `ops-routes.ts`: dependency status/logs, block status, verbose log queries, static asset routing

`create-chat-server.ts` should:
- apply chat CORS headers
- create the `http.Server`
- register routes in the same precedence order as today
- expose `{ server, shutdown }`

`src/server.ts` should only:
- parse env/config constants
- create runtime/dependencies
- call `createChatServer`
- register process signal handlers
- start listening

- [ ] **Step 4: Run the chat regression suite after each extraction boundary**

Run:
```bash
npm run build
node --test tests/integration/chat-server.integration.test.js tests/integration/callbacks.integration.test.js tests/integration/chat-server-sessions.integration.test.js tests/integration/chat-server-ops.integration.test.js
```

Expected:
- PASS

- [ ] **Step 5: Run the full suite and inspect startup/teardown behavior**

Run:
```bash
npm test
```

Expected:
- PASS with no fixture startup regressions

- [ ] **Step 6: Commit the chat modularization**

```bash
git add src/chat src/server.ts tests/integration/chat-server.integration.test.js tests/integration/callbacks.integration.test.js tests/integration/chat-server-sessions.integration.test.js tests/integration/chat-server-ops.integration.test.js
git commit -m "refactor: modularize chat server"
```

## Task 4: Modularize the Auth-Admin Server Without Changing the Admin Contract

**Files:**
- Create: `src/admin/bootstrap/create-auth-admin-server.ts`
- Create: `src/admin/http/auth-admin-routes.ts`
- Create: `src/admin/application/user-admin-service.ts`
- Create: `src/admin/application/agent-admin-service.ts`
- Create: `src/admin/infrastructure/user-store.ts`
- Create: `src/admin/runtime/auth-admin-runtime.ts`
- Modify: `src/auth-admin-server.ts`
- Test: `tests/integration/auth-admin-server.integration.test.js`

- [ ] **Step 1: Move user persistence into `user-store.ts`**

Responsibilities:
- data file bootstrapping
- password hashing/salt generation
- user CRUD persistence
- username sanitation and credential validation helpers

- [ ] **Step 2: Split admin use cases from HTTP routing**

Service split:
- `user-admin-service.ts`: verify credentials, list users, create user, change password, delete user
- `agent-admin-service.ts`: list agents, create/update/delete agent, apply pending config

Route module responsibilities:
- admin token enforcement
- method/path dispatch
- request DTO parsing
- response mapping

- [ ] **Step 3: Create a bootstrap module and slim `src/auth-admin-server.ts` to startup wiring**

Keep unchanged:
- `/healthz`
- `/api/auth/verify`
- admin page serving
- all `/api/users*` and `/api/agents*` paths
- current startup log output
- current production security checks

- [ ] **Step 4: Run the auth-admin regression suite**

Run:
```bash
npm run build
node --test tests/integration/auth-admin-server.integration.test.js
```

Expected:
- PASS

- [ ] **Step 5: Commit the auth-admin modularization**

```bash
git add src/admin src/auth-admin-server.ts tests/integration/auth-admin-server.integration.test.js
git commit -m "refactor: modularize auth admin server"
```

## Task 5: Final Hardening, Cleanup, and Handoff

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `src/server.ts`
- Modify: `src/auth-admin-server.ts`
- Modify: `docs/superpowers/plans/2026-03-19-maintainability-modular-refactor.md`

- [ ] **Step 1: Remove dead helper code left in entry files after extraction**

Checks:
- no duplicate `parseBody`/`sendJson` copies remain
- no route handler business logic remains inline in either entry file
- startup files stay comfortably reviewable (target: each well under 300 lines)

- [ ] **Step 2: Update developer docs to reflect the new module layout**

Document:
- where chat routes live
- where auth-admin routes live
- where shared HTTP helpers live
- where to add new use cases vs new infrastructure integrations

- [ ] **Step 3: Run build and full regression suite**

Run:
```bash
npm run build
npm test
```

Expected:
- PASS

- [ ] **Step 4: Capture architecture acceptance notes in this plan**

Record:
- actual files created
- any deviations from the target module list
- follow-up items intentionally deferred

- [ ] **Step 5: Commit the documentation and cleanup**

```bash
git add README.md CLAUDE.md src/server.ts src/auth-admin-server.ts docs/superpowers/plans/2026-03-19-maintainability-modular-refactor.md
git commit -m "docs: record modular server architecture"
```

## Deferred Until After MVP

- Converting legacy root-level `.js` scripts into the same module system
- Introducing a dedicated unit-test harness for application services
- Changing storage schema or Redis key formats
- Migrating from Node `http` to Express/Fastify
- Splitting chat and auth-admin into separate deployable services

## Acceptance Criteria

- `src/server.ts` and `src/auth-admin-server.ts` are thin composition roots rather than feature containers
- Existing API endpoints, payload shapes, cookies, startup commands, and fixture contracts remain unchanged
- Full integration suite passes
- New code has a stable place for future chat routes, admin routes, application logic, and infrastructure integrations
- Operational behavior for Redis, callback auth, verbose logs, and admin token checks is preserved
