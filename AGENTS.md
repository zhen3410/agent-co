# Repository Guidelines

## Project Structure & Module Organization
Core application code lives in [`src/`](/root/chat/src): `server.ts` runs the chat service, `auth-admin-server.ts` runs the admin/auth service, and supporting modules cover agent config, CLI execution, rate limiting, block buffering, and rich message parsing. Compiled output goes to `dist/`. Static UI assets live in `public/` and `public-auth/`. Integration tests are in `tests/integration/`. Deployment and bootstrap scripts are in `scripts/` and `systemd/`. Runtime data and local logs commonly appear under `data/` and `logs/`.

## Build, Test, and Development Commands
- `npm run build` compiles TypeScript from `src/` into `dist/`.
- `npm run dev` starts the chat server with `ts-node` for local development.
- `npm run start:chat` runs `dist/server.js`.
- `npm run start:auth` runs `dist/auth-admin-server.js`.
- `npm test` runs the full integration suite (`npm run build && node --test tests/integration/*.integration.test.js`).
- `bash scripts/init-dev.sh` prepares a local dev environment.
- **Production services must be managed via systemd** — use `npm run deploy:one-click` or `bash scripts/install-systemd.sh` to register the unified service (`agent-co`). Do not manually run `npm start` or `node dist/server.js` in production.

## Coding Style & Naming Conventions
Use TypeScript with `strict` compiler settings. Follow the existing style: 2-space indentation, semicolons, single quotes, `camelCase` for variables/functions, `PascalCase` for types/interfaces, and `SCREAMING_SNAKE_CASE` for top-level config constants. Keep modules focused; avoid adding more responsibilities to already large entrypoints such as `src/server.ts`. There is no configured formatter or linter in `package.json`, so match surrounding code closely.

## Testing Guidelines
Tests use Node’s built-in test runner (`node:test`) with `assert/strict`. Put new coverage in `tests/integration/*.integration.test.js`. Name tests as behavior statements, preferably in Chinese when matching existing suite style, for example: `test('已停用的智能体不能被 @', async () => {})`. Prefer fixture-based tests over ad hoc scripts, and avoid depending on untracked local files.

## Commit & Pull Request Guidelines
Recent history uses concise, imperative commit subjects such as `fix: keep chat header sticky on mobile`, `test: cover sticky mobile chat header`, and `Fix CI fixture agent setup`. Keep commits scoped and readable. PRs should include a short summary, a concrete test plan, and any UI evidence when changing `public/` or `public-auth/`. If a change depends on local config or runtime data, state that explicitly in the PR body.

## Security & Configuration Tips
Do not commit secrets, tokens, or machine-specific runtime data. Prefer temporary test fixtures over checked-in files under `data/`. Validate absolute paths and environment-driven config carefully; this codebase uses auth tokens, callback headers, Redis settings, and per-agent work directories extensively.
