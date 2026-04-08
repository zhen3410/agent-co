# Repository Guidelines

## Project Structure & Module Organization
Application code lives in [`src/`](/root/chat/src), with the current architecture split by responsibility instead of centering new work in the top-level entrypoints. `src/chat/` contains the chat system’s bootstrap, HTTP routes, application services, runtime state, domain policies, and infrastructure adapters. `src/admin/` contains the auth/admin server’s bootstrap, HTTP routes, application services, runtime wiring, and persistence helpers. Shared agent execution logic lives under `src/agent-invocation/` and `src/providers/`, while reusable HTTP and error helpers live in `src/shared/`. Top-level files such as `src/server.ts` and `src/auth-admin-server.ts` should stay thin composition roots. Compiled output goes to `dist/`. Static UI assets live in `public/` and `public-auth/`. Integration tests are in `tests/integration/`, with smaller targeted tests in `tests/unit/` when appropriate. Deployment and bootstrap scripts are in `scripts/` and `systemd/`. Runtime data and local logs commonly appear under `data/` and `logs/`.

## Build, Test, and Development Commands
- `npm run build` compiles TypeScript from `src/` into `dist/`.
- `npm run dev` starts the chat server with `ts-node` for local development.
- `npm run start:chat` runs `dist/server.js`.
- `npm run start:auth` runs `dist/auth-admin-server.js`.
- `npm test` runs the full integration suite (`npm run build && node --test tests/integration/*.integration.test.js`).
- `node --test tests/unit/*.unit.test.js` runs targeted unit tests when present.
- `bash scripts/init-dev.sh` prepares a local dev environment.
- **Production services must be managed via systemd** — use `npm run deploy:one-click` or `bash scripts/install-systemd.sh` to register the unified service (`agent-co`). Do not manually run `npm start` or `node dist/server.js` in production.

## Coding Style & Naming Conventions
Use TypeScript with `strict` compiler settings. Follow the existing style: 2-space indentation, semicolons, single quotes, `camelCase` for variables/functions, `PascalCase` for types/interfaces, and `SCREAMING_SNAKE_CASE` for top-level config constants. Keep modules focused and place changes in the matching layer or subsystem (`chat`, `admin`, `agent-invocation`, `providers`, `shared`) instead of adding new responsibilities to top-level composition roots such as `src/server.ts` and `src/auth-admin-server.ts`. When editing existing code, preserve the current bootstrap/application/http/runtime/infrastructure boundaries unless the task explicitly calls for refactoring them. There is no configured formatter or linter in `package.json`, so match surrounding code closely.

## Testing Guidelines
Tests use Node’s built-in test runner (`node:test`) with `assert/strict`. Put cross-layer or end-to-end coverage in `tests/integration/*.integration.test.js`. Prefer smaller targeted tests in `tests/unit/` when validating parser logic, pure helpers, or other isolated module behavior. Name tests as behavior statements, preferably in Chinese when matching existing suite style, for example: `test('已停用的智能体不能被 @', async () => {})`. Prefer fixture-based tests over ad hoc scripts, and avoid depending on untracked local files.

## Commit & Pull Request Guidelines
Recent history uses concise, imperative commit subjects such as `fix: keep chat header sticky on mobile`, `test: cover sticky mobile chat header`, and `Fix CI fixture agent setup`. Keep commits scoped and readable. PRs should include a short summary, a concrete test plan, and any UI evidence when changing `public/` or `public-auth/`. If a change depends on local config or runtime data, state that explicitly in the PR body.

## Security & Configuration Tips
Do not commit secrets, tokens, or machine-specific runtime data. Prefer temporary test fixtures over checked-in files under `data/`. Validate absolute paths and environment-driven config carefully; this codebase uses auth tokens, callback headers, model connection settings, Redis/session persistence, and per-agent work directories extensively.
