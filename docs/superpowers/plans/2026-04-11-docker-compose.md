# Docker Compose Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-friendly Docker image and Docker Compose stack that runs `chat`, `auth`, and `redis` as separate containers while reusing one application image.

**Architecture:** Keep the application split exactly as it is today, add one backwards-compatible `REDIS_URL` env override in chat bootstrap, build a multi-stage Node image, and compose three services (`chat`, `auth`, `redis`) with persistent volumes and health checks.

**Tech Stack:** TypeScript, Node.js, Docker, Docker Compose, Redis, Node test runner (`node:test`).

---

## File Map

- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `docker-compose.yml`
- Modify: `src/chat/bootstrap/chat-env-config.ts`
- Modify: `tests/integration/chat-server-bootstrap-boundaries.integration.test.js`
- Optional Modify: `README.md`
- Spec: `docs/superpowers/specs/2026-04-11-docker-compose-design.md`

---

### Task 1: Make Redis endpoint configurable for containers

**Files:**
- Modify: `tests/integration/chat-server-bootstrap-boundaries.integration.test.js`
- Modify: `src/chat/bootstrap/chat-env-config.ts`

- [ ] Add a failing test asserting `createChatEnvConfig(...).redis.url` uses `REDIS_URL` when set.
- [ ] Run `node --test tests/integration/chat-server-bootstrap-boundaries.integration.test.js` and confirm it fails for the expected reason.
- [ ] Update `src/chat/bootstrap/chat-env-config.ts` to read `env.REDIS_URL || 'redis://127.0.0.1:6379'`.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Add the reusable application image

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] Add a multi-stage Dockerfile that installs dependencies, builds TypeScript, prunes dev dependencies, and copies runtime assets.
- [ ] Add `.dockerignore` to exclude `node_modules`, `dist`, git metadata, logs, runtime data, and other non-build inputs.

### Task 3: Add Compose orchestration

**Files:**
- Create: `docker-compose.yml`

- [ ] Define `redis`, `auth`, and `chat` services.
- [ ] Reuse the same built image for `auth` and `chat` with different commands.
- [ ] Add health checks and named volumes for data persistence.
- [ ] Ensure `AUTH_ADMIN_BASE_URL=http://auth:3003` and `REDIS_URL=redis://redis:6379` are wired for the `chat` service.

### Task 4: Verify the packaging

**Files:**
- No source changes required unless verification fails.

- [ ] Run `npm run build`.
- [ ] Run `node --test tests/integration/chat-server-bootstrap-boundaries.integration.test.js`.
- [ ] Run `docker compose config`.
- [ ] Run `docker compose build`.

