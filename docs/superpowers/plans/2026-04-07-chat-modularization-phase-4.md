# Chat Modularization Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (preferred) or `superpowers:executing-plans` to execute task-by-task with implementation + review checkpoints.

**Goal:** Continue the maintainability refactor by slimming remaining HTTP adapters, extracting pure discussion / chain rules from orchestration services, introducing a small provider-registry seam for invocation extensibility, and clarifying runtime persistence/store boundaries without duplicating abstractions that already exist.

**Architecture direction:** Preserve the Phase 2/3 layered split (`http -> application -> runtime/infrastructure`) and keep public behavior stable. Phase 4 focuses on four high-leverage seams that are still too orchestration-heavy today: route parsing/response helpers, pure discussion-chain policy functions, provider selection, and runtime store composition. Existing repository seams such as `ChatSessionRepository` stay in place and are refined rather than replaced.

**Tech stack:** TypeScript, Node.js HTTP server, Node test runner (`node:test`), existing integration tests plus `test:unit` / `test:fast`.

---

## File Structure

### Existing files to modify
- `src/chat/http/chat-routes.ts` — reduce inline request parsing / duplicated response logic.
- `src/chat/http/auth-routes.ts` — keep login/logout/status route adapter only; move cookie/header/body helper logic where reusable.
- `src/chat/http/callback-routes.ts` — move callback auth/header/body parsing into helper seams.
- `src/chat/http/request-context.ts` — extend only if helper extraction needs normalized context assembly.
- `src/chat/application/chat-dispatch-orchestrator.ts` — delegate pure chain-limit / continuation decisions to policy helpers.
- `src/chat/application/chat-summary-service.ts` — delegate peer-summary precondition checks to discussion policy.
- `src/chat/application/chat-resume-service.ts` — rely on extracted continuation / summary-state policy where appropriate.
- `src/chat/application/session-discussion-service.ts` — keep mutation orchestration, but move pure discussion/session rules out.
- `src/agent-invocation/agent-invoker.ts` — remove hardcoded provider branching from top-level invoker.
- `src/agent-invocation/invoke-api-agent.ts` — route provider selection through registry seam.
- `src/providers/cli-provider.ts` — adapt only if registry contracts require minimal metadata.
- `src/providers/openai-compatible-provider.ts` — adapt only if registry contracts require minimal metadata.
- `src/chat/runtime/chat-runtime.ts` — compose runtime stores behind explicit runtime-store dependencies.
- `src/chat/runtime/chat-runtime-persistence.ts` — depend on explicit persistence/store inputs, not ad hoc concrete wiring.
- `src/chat/infrastructure/chat-session-repository.ts` — keep existing session repository seam; split callback-message responsibilities only if needed.
- `src/chat/infrastructure/dependency-log-store.ts` — may become one concrete runtime store implementation behind a narrower runtime-store contract.
- `tests/integration/chat-server.integration.test.js`
- `tests/integration/chat-server-sessions.integration.test.js`
- `tests/integration/chat-server-ops.integration.test.js`

### New files to create
- `src/chat/http/chat-route-helpers.ts` — reusable parsing / validation / response helpers for chat/session endpoints.
- `src/chat/http/callback-route-helpers.ts` — callback auth/header/body parsing helpers.
- `src/chat/http/auth-route-helpers.ts` — auth cookie application and auth request parsing helpers.
- `src/chat/domain/discussion-policy.ts` — pure rules for peer-discussion state, summary preconditions, summary restore behavior, and manual-summary agent selection.
- `src/chat/domain/agent-chain-policy.ts` — pure rules for chain hop/call limits, implicit peer continuation eligibility, and continuation queue decisions.
- `src/agent-invocation/provider-registry.ts` — provider registration / lookup seam for current invocation modes.
- `src/agent-invocation/provider-capabilities.ts` — capability descriptors and selection helpers for current providers.
- `src/chat/runtime/chat-runtime-stores.ts` — explicit runtime store contracts for session state / callback queue / dependency logs used by runtime composition.
- `src/chat/infrastructure/callback-message-store.ts` — callback queue implementation split from session repository if extraction is justified during execution.
- `tests/integration/chat-server-http-boundaries.integration.test.js` — HTTP boundary / contract coverage for helper extraction.
- `tests/unit/discussion-policy.unit.test.js` — pure rule tests for discussion / summary decisions.
- `tests/unit/agent-chain-policy.unit.test.js` — pure rule tests for chain-limit / continuation decisions.
- `tests/unit/provider-registry.unit.test.js` — registry selection / duplicate-registration tests.
- `tests/integration/chat-server-runtime-store-boundaries.integration.test.js` — boundary coverage for runtime store composition.

### Existing tests used for verification
- `tests/integration/callbacks.integration.test.js`
- `tests/integration/chat-server-runtime-contract.integration.test.js`
- `tests/integration/chat-server-service-boundaries.integration.test.js`
- `tests/integration/chat-server-session-service-boundaries.integration.test.js`
- `tests/integration/chat-server-ops-boundaries.integration.test.js`
- `tests/integration/chat-server-agent-invoker-boundaries.integration.test.js`
- `tests/integration/claude-cli-mcp.integration.test.js`
- `tests/unit/session-discussion-rules.unit.test.js`
- `tests/unit/agent-invocation.unit.test.js`
- `tests/unit/app-error.unit.test.js`

---

## Task 13: Slim the HTTP layer with focused route helper modules

**Files:**
- Create: `src/chat/http/chat-route-helpers.ts`
- Create: `src/chat/http/callback-route-helpers.ts`
- Create: `src/chat/http/auth-route-helpers.ts`
- Modify: `src/chat/http/chat-routes.ts`
- Modify: `src/chat/http/auth-routes.ts`
- Modify: `src/chat/http/callback-routes.ts`
- Modify: `src/chat/http/request-context.ts` (only if helper extraction needs shared normalized request context)
- Create: `tests/integration/chat-server-http-boundaries.integration.test.js`
- Verify against: `tests/integration/chat-server.integration.test.js`
- Verify against: `tests/integration/callbacks.integration.test.js`
- Verify against: `tests/integration/chat-server-ops.integration.test.js`

> Keep route files as thin HTTP adapters. Move repeated body parsing, callback header extraction, auth cookie application, and small validation helpers out only when the extracted functions are reused or independently testable. Do not change endpoint payloads or status codes.

- [ ] **Step 1: Write failing HTTP boundary / contract tests**

Add boundary tests that lock exported handler behavior while asserting helper-level parsing / validation contracts for chat, callback, and auth routes.

- [ ] **Step 2: Run the new boundary tests and confirm they fail**

Run: `npm run build && node --test tests/integration/chat-server-http-boundaries.integration.test.js`
Expected: FAIL before helper modules exist.

- [ ] **Step 3: Extract route helpers**

Move reusable request parsing / validation / response helpers into `chat-route-helpers.ts`, `callback-route-helpers.ts`, and `auth-route-helpers.ts`.

- [ ] **Step 4: Reduce route modules to thin adapters**

Update `chat-routes.ts`, `auth-routes.ts`, `callback-routes.ts`, and `request-context.ts` so transport handling is thinner while preserving exact behavior.

- [ ] **Step 5: Run focused verification**

Run: `npm run build && node --test tests/integration/chat-server-http-boundaries.integration.test.js tests/integration/chat-server.integration.test.js tests/integration/callbacks.integration.test.js tests/integration/chat-server-ops.integration.test.js`
Expected: PASS.

- [ ] **Step 6: Commit Task 13**

```bash
git add src/chat/http/*.ts tests/integration/chat-server-http-boundaries.integration.test.js
git commit -m "refactor: slim chat http route adapters"
```

## Task 14: Extract pure discussion and chain policy modules

**Files:**
- Create: `src/chat/domain/discussion-policy.ts`
- Create: `src/chat/domain/agent-chain-policy.ts`
- Modify: `src/chat/application/chat-dispatch-orchestrator.ts`
- Modify: `src/chat/application/chat-summary-service.ts`
- Modify: `src/chat/application/chat-resume-service.ts`
- Modify: `src/chat/application/session-discussion-service.ts`
- Create: `tests/unit/discussion-policy.unit.test.js`
- Create: `tests/unit/agent-chain-policy.unit.test.js`
- Verify against: `tests/integration/chat-server.integration.test.js`
- Verify against: `tests/integration/chat-server-sessions.integration.test.js`
- Verify against: `tests/unit/session-discussion-rules.unit.test.js`

> These modules must stay pure. Runtime/session mutation remains in services/runtime; policy helpers only answer rule questions such as “is manual summary allowed,” “which agent should summarize,” “should peer discussion pause,” and “can this chained continuation be queued.”

- [ ] **Step 1: Write failing unit tests for policy extraction**

Add pure tests for peer summary preconditions, manual-summary agent selection, summary continuation restoration, implicit peer continuation eligibility, hop-limit enforcement, and per-agent call-limit decisions.

- [ ] **Step 2: Run unit tests and confirm they fail**

Run: `npm run build && node --test tests/unit/discussion-policy.unit.test.js tests/unit/agent-chain-policy.unit.test.js`
Expected: FAIL before the policy modules exist.

- [ ] **Step 3: Extract discussion policy**

Move pure rules currently embedded in `chat-summary-service.ts`, `chat-resume-service.ts`, and `session-discussion-service.ts` into `discussion-policy.ts`.

- [ ] **Step 4: Extract chain policy**

Move pure chain-limit / continuation rules from `chat-dispatch-orchestrator.ts` into `agent-chain-policy.ts`, then adapt orchestrator code to consume them.

- [ ] **Step 5: Run focused verification**

Run: `npm run build && node --test tests/unit/discussion-policy.unit.test.js tests/unit/agent-chain-policy.unit.test.js tests/unit/session-discussion-rules.unit.test.js tests/integration/chat-server.integration.test.js tests/integration/chat-server-sessions.integration.test.js`
Expected: PASS.

- [ ] **Step 6: Commit Task 14**

```bash
git add src/chat/domain/*.ts src/chat/application/*.ts tests/unit/discussion-policy.unit.test.js tests/unit/agent-chain-policy.unit.test.js tests/unit/session-discussion-rules.unit.test.js
git commit -m "refactor: extract chat discussion and chain policies"
```

## Task 15: Introduce provider registry seams for invocation extensibility

**Files:**
- Create: `src/agent-invocation/provider-registry.ts`
- Create: `src/agent-invocation/provider-capabilities.ts`
- Modify: `src/agent-invocation/agent-invoker.ts`
- Modify: `src/agent-invocation/invoke-api-agent.ts`
- Modify: `src/providers/cli-provider.ts` (only if registry metadata is required)
- Modify: `src/providers/openai-compatible-provider.ts` (only if registry metadata is required)
- Create: `tests/unit/provider-registry.unit.test.js`
- Modify: `tests/unit/agent-invocation.unit.test.js`
- Verify against: `tests/integration/chat-server-agent-invoker-boundaries.integration.test.js`
- Verify against: `tests/integration/chat-server.integration.test.js`
- Verify against: `tests/integration/claude-cli-mcp.integration.test.js`

> Do not build a plugin system. The goal is a small registry seam that removes hardcoded provider selection from the invoker and makes future providers lower-risk to add.

- [ ] **Step 1: Write failing unit tests for provider registry behavior**

Add tests for provider registration, lookup, duplicate-registration protection, and selection behavior for current CLI/API flows.

- [ ] **Step 2: Run the new tests and confirm they fail**

Run: `npm run build && node --test tests/unit/provider-registry.unit.test.js tests/unit/agent-invocation.unit.test.js`
Expected: FAIL before registry/capability modules exist.

- [ ] **Step 3: Extract provider registry/capability modules**

Create `provider-registry.ts` and `provider-capabilities.ts`, then route current invocation flows through that seam.

- [ ] **Step 4: Adapt current invoker/provider wiring**

Update `agent-invoker.ts` and `invoke-api-agent.ts` so selection depends on the registry rather than hardcoded branching, with only minimal provider metadata changes if needed.

- [ ] **Step 5: Run focused verification**

Run: `npm run build && node --test tests/unit/provider-registry.unit.test.js tests/unit/agent-invocation.unit.test.js tests/integration/chat-server-agent-invoker-boundaries.integration.test.js tests/integration/chat-server.integration.test.js tests/integration/claude-cli-mcp.integration.test.js`
Expected: PASS.

- [ ] **Step 6: Commit Task 15**

```bash
git add src/agent-invocation/*.ts src/providers/*.ts tests/unit/provider-registry.unit.test.js tests/unit/agent-invocation.unit.test.js tests/integration/chat-server-agent-invoker-boundaries.integration.test.js
git commit -m "refactor: add invocation provider registry"
```

## Task 16: Clarify runtime persistence/store composition boundaries

**Files:**
- Create: `src/chat/runtime/chat-runtime-stores.ts`
- Create: `src/chat/infrastructure/callback-message-store.ts` (only if callback queue extraction proves useful during implementation)
- Modify: `src/chat/runtime/chat-runtime.ts`
- Modify: `src/chat/runtime/chat-runtime-persistence.ts`
- Modify: `src/chat/infrastructure/chat-session-repository.ts`
- Modify: `src/chat/infrastructure/dependency-log-store.ts`
- Create: `tests/integration/chat-server-runtime-store-boundaries.integration.test.js`
- Verify against: `tests/integration/chat-server-runtime-contract.integration.test.js`
- Verify against: `tests/integration/chat-server-sessions.integration.test.js`
- Verify against: `tests/integration/chat-server.integration.test.js`

> `ChatSessionRepository` already exists and remains the session repository seam. This task is specifically about clarifying runtime composition boundaries: separating session repository, callback queue storage, and dependency-log storage behind explicit runtime-store contracts so `chat-runtime.ts` and `chat-runtime-persistence.ts` stop knowing unnecessary concrete details.

- [ ] **Step 1: Write failing runtime-store boundary tests**

Add tests that lock the runtime façade surface while asserting runtime composition depends on explicit store contracts rather than ad hoc concrete store wiring.

- [ ] **Step 2: Run the new boundary tests and confirm they fail**

Run: `npm run build && node --test tests/integration/chat-server-runtime-store-boundaries.integration.test.js`
Expected: FAIL before runtime-store contracts exist.

- [ ] **Step 3: Extract runtime-store contracts**

Create `chat-runtime-stores.ts` to define the explicit store contracts used by runtime composition. Split callback-message storage from `chat-session-repository.ts` only if that extraction materially simplifies runtime/store ownership.

- [ ] **Step 4: Rewire runtime composition without changing behavior**

Update `chat-runtime.ts`, `chat-runtime-persistence.ts`, `chat-session-repository.ts`, and `dependency-log-store.ts` to use the explicit runtime-store seam while preserving file/Redis behavior.

- [ ] **Step 5: Run focused verification**

Run: `npm run build && node --test tests/integration/chat-server-runtime-store-boundaries.integration.test.js tests/integration/chat-server-runtime-contract.integration.test.js tests/integration/chat-server-sessions.integration.test.js tests/integration/chat-server.integration.test.js`
Expected: PASS.

- [ ] **Step 6: Commit Task 16**

```bash
git add src/chat/runtime/*.ts src/chat/infrastructure/*.ts tests/integration/chat-server-runtime-store-boundaries.integration.test.js tests/integration/chat-server-runtime-contract.integration.test.js
git commit -m "refactor: clarify runtime store boundaries"
```

## Final Verification and Handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-04-07-chat-modularization-phase-4.md`

- [ ] **Step 1: Run full verification**

Run: `npm run build && npm test && npm run test:unit && npm run test:fast`
Expected: PASS.

- [ ] **Step 2: Update plan checkboxes / notes**

Mark completed steps, record any deviations, and note whether callback-message extraction in Task 16 was needed or intentionally skipped.

- [ ] **Step 3: Prepare handoff summary**

Document:
1. Which route helpers, policy modules, provider seams, and runtime-store seams were introduced.
2. Which files remained intentionally unchanged.
3. Which verification commands were run and their outcomes.
4. Follow-up refactors that still remain after Phase 4.
