<p align="center">
  <img src="public/logo.svg" alt="agent-co" width="480" />
</p>

<h1 align="center">agent-co</h1>

<p align="center">
  <b>English</b> | <a href="README.md">中文</a>
</p>

---

A self-hosted multi-agent chat room built with Node.js and TypeScript. It supports CLI-based (Claude CLI / Codex CLI) and API-based (OpenAI-compatible) agent backends, per-session agent management with peer discussion mode, lightweight auth/admin tooling, PWA support, and integration-oriented callback flows.

### Highlights

- **Multi-agent conversations** with built-in agents such as Claude, Codex Architect, Alice, and Bob.
- **Dual execution modes** — agents can run via CLI (Claude/Codex CLI) or API (OpenAI-compatible endpoints) with configurable model, temperature, and token limits.
- **Peer discussion mode** — agents can engage in multi-turn peer discussions with chain dispatch, pause/resume, and manual summarization.
- **Session isolation** with per-session history, enabled-agent sets, current-agent focus state, and configurable chain limits.
- **Agent chaining** — agents can invoke other agents via `@@AgentName` syntax or callback `invokeAgents`, with configurable max hops and per-agent call limits.
- **Agent groups** — organize agents into groups for sidebar display and batch `@group` mentions.
- **API connection management** — create, test, and manage OpenAI-compatible API connections with secure credential storage.
- **Focused chat UI** optimized for desktop and mobile, with a sticky top control bar and scrolling message area.
- **Admin/auth service** for login, user management, agent configuration, prompt updates, workdir selection, and model connection management.
- **Rich text blocks** — agents can render cards and checklists via `cc_rich` code blocks or HTTP callback.
- **PWA-ready frontend** with install prompt support for mobile home-screen usage.
- **Operational pages** for verbose CLI logs, dependency status, and dependency log queries.
- **MCP server** for agent callbacks — agents can post messages and read thread context via MCP tools.
- **Integration tests** covering chat flows, auth/admin APIs, callbacks, and frontend bindings.

### Architecture

This repository ships two HTTP services:

- **Chat service**: `src/server.ts`, default port `3002`
- **Auth/Admin service**: `src/auth-admin-server.ts`, default port `3003`

The chat service serves the main UI from `public/index.html`.
The auth/admin service serves the admin page from `public-auth/admin.html`.

### Quick Start

#### 1. Install dependencies

```bash
npm install
```

#### 2. Initialize local directories

```bash
npm run init
```

This script prepares local runtime directories (`data/`, verbose log folders) and creates `.env` from `.env.example` when missing. The npm start scripts do **not** load `.env` automatically, so for local development you should export it before starting services:

```bash
set -a
source .env
set +a
```

#### 3. Build

```bash
npm run build
```

#### 4. Start the chat service

```bash
npm run dev
```

Or run the compiled build:

```bash
npm run start:chat
```

#### 5. Start the auth/admin service

```bash
npm run start:auth
```

Default addresses:

- Chat UI: `http://127.0.0.1:3002`
- Admin UI: `http://127.0.0.1:3003`

### Default Development Behavior

- Auth is enabled by default unless `AGENT_CO_AUTH_ENABLED=false`.
- The chat service expects the auth/admin service at `AUTH_ADMIN_BASE_URL`, defaulting to `http://127.0.0.1:3003`.
- Redis-backed persistence is optional for local development. Set `AGENT_CO_REDIS_REQUIRED=false` to continue without Redis, or `AGENT_CO_DISABLE_REDIS=true` to fully disable it.
- If the auth data file does not exist, the admin service will create a default user on first startup.

Default dev credentials:

- Username: `admin`
- Password: `admin123!`

### Useful Scripts

```bash
npm run init            # Initialize local directories
npm run build           # Compile TypeScript
npm run dev             # Run in development mode
npm run start:chat      # Run compiled chat service
npm run start:auth      # Run compiled auth/admin service
npm test                # Run integration tests
npm run test:unit       # Run unit tests
npm run test:fast       # Fast run (unit + key integration)
npm run deploy:one-click  # One-click deploy (Redis + systemd)
```

### Docker Compose

The project includes a single-image, multi-container Docker Compose setup:

```bash
docker compose up --build
```

After startup:

- Chat service: `http://localhost:3002`
- Auth/admin service: `http://localhost:3003`
- Redis: `localhost:6379`

Compose reuses the same app image for both `chat` and `auth`, and runs Redis as a separate container. Inside the Compose network, chat reaches auth via `AUTH_ADMIN_BASE_URL=http://auth:3003` and Redis via `REDIS_URL=redis://redis:6379`.

### Project Structure

```text
src/
  server.ts                Chat service composition root (~57 lines)
  auth-admin-server.ts     Auth/admin service composition root (~69 lines)
  agent-invoker.ts         Backward-compat re-export shim
  agent-manager.ts         Agent definitions, @ mention parsing, @@ chain invocation parsing
  agent-config-store.ts    Agent persistence, apply modes (immediate / after_chat)
  api-connection-store.ts  OpenAI-compatible API connection CRUD and validation
  group-store.ts           Agent group storage and validation
  claude-cli.ts            CLI subprocess management, streaming JSON, MCP injection
  block-buffer.ts          Route A rich block buffering
  rich-extract.ts          Extract cc_rich blocks from model output
  rich-digest.ts           Rich block digest helpers for prompts
  rate-limiter.ts          In-memory rate limiting
  agent-co-mcp-server.ts   MCP callback server
  professional-agent-prompts.ts   Professional agent prompt builder
  professional-agent-prompts.json 7 professional role prompt templates
  types.ts                 Shared TypeScript type definitions
  chat/
    bootstrap/             Chat server bootstrap and startup wiring
    http/                  Chat/auth/callback/ops route adapters
      ops/                 Dependency, system, verbose-log route sub-modules
    application/           Chat, session, auth use cases
    infrastructure/        Auth-admin client, session repository, dependency log store
    runtime/               Chat runtime state, session state, discussion state, persistence
  admin/
    bootstrap/             Auth-admin bootstrap and startup wiring
    http/                  Admin routes and auth helpers
    application/           User/agent/group/model/system admin use cases
    infrastructure/        User persistence store (JSON + PBKDF2)
    runtime/               Admin runtime config and startup/security logic
  agent-invocation/        Agent dispatch routing (CLI vs API), target normalization
  shared/
    errors/                AppError class, error codes, HTTP status mapping
    http/                  Shared HTTP helpers: body, cors, json, static, error mapper
  providers/               CLI / OpenAI-compatible agent providers
public/                    Main chat UI and static assets
public-auth/               Admin UI static assets
data/                      Runtime data directory
logs/                      Runtime logs (including ai-cli-verbose/)
scripts/                   Bootstrap and deployment scripts
systemd/                   Example systemd service unit files
tests/unit/                Unit tests
tests/integration/         Integration tests
dist/                      Compiled build output
```

#### Module Conventions

- **Chat routes** go in `src/chat/http/`
- **Admin routes** go in `src/admin/http/`
- **Use cases / business logic** go in `src/chat/application/` or `src/admin/application/`
- **Infrastructure integrations** (filesystem, Redis, upstream HTTP, persistence) go in `src/chat/infrastructure/`, `src/chat/runtime/`, `src/admin/infrastructure/`, or `src/admin/runtime/`
- **Agent invocation logic** goes in `src/agent-invocation/`
- **HTTP utilities / error handling** goes in `src/shared/`
- Keep `src/server.ts` and `src/auth-admin-server.ts` as thin startup files

### Environment Variables

#### Chat Service

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3002` | Chat service port |
| `AGENT_CO_AUTH_ENABLED` | `true` | Enable/disable authentication |
| `AUTH_ADMIN_BASE_URL` | `http://127.0.0.1:3003` | Auth admin service URL |
| `AGENT_DATA_FILE` | `data/agents.json` | Agent config file path |
| `AGENT_CO_VERBOSE_LOG_DIR` | `logs/ai-cli-verbose` | Verbose log directory |
| `AGENT_CO_REDIS_REQUIRED` | `true` | Whether Redis is required |
| `AGENT_CO_DISABLE_REDIS` | `false` | Fully disable Redis persistence |
| `AGENT_CO_AGENT_CHAIN_MAX_HOPS` | `4` | Default max chain hops per session |
| `AGENT_CO_CALLBACK_TOKEN` | `agent-co-callback-token` | Token for callback auth |

#### Auth/Admin Service

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_ADMIN_PORT` | `3003` | Admin service port |
| `AUTH_ADMIN_TOKEN` | - | Admin token (required in production, >= 32 chars) |
| `AUTH_DATA_FILE` | `data/users.json` | User data file path |
| `AGENT_DATA_FILE` | `data/agents.json` | Agent config file path |
| `MODEL_CONNECTION_DATA_FILE` | `data/api-connections.json` | API connections file path |
| `GROUP_DATA_FILE` | `data/groups.json` | Agent groups file path |
| `AGENT_CO_DEFAULT_USER` | `admin` | Default username |
| `AGENT_CO_DEFAULT_PASSWORD` | `admin123!` | Default password fallback (override in production) |

#### Redis

The chat service connects to `redis://127.0.0.1:6379` by default and reads runtime config from `agent-co:config`.

```bash
redis-cli HSET agent-co:config chat_sessions_key agent-co:chat:sessions:v1
```

### Chat Service API

#### Core Chat

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat` | POST | Send message (sync response) |
| `/api/chat-stream` | POST | Send message (SSE streaming response) |
| `/api/chat-resume` | POST | Resume interrupted pending chain tasks |
| `/api/chat-summary` | POST | Manual peer discussion summary (peer mode only) |
| `/api/history` | GET | Get chat history and session info |
| `/api/clear` | POST | Clear chat history |

#### Agents

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agents` | GET | Get agent list |
| `/api/session-agents` | POST | Enable/disable agent for session |
| `/api/groups` | GET | Get agent groups |

#### Sessions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sessions` | POST | Create new chat session |
| `/api/sessions/select` | POST | Switch active session |
| `/api/sessions/rename` | POST | Rename a session |
| `/api/sessions/delete` | POST | Delete a session |
| `/api/sessions/update` | POST | Update session settings (chain limits, discussion mode) |

#### Agent Workdirs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/workdirs/options` | GET | Get available workdir directories |
| `/api/workdirs/select` | POST | Set agent workdir for session |
| `/api/system/dirs` | GET | Browse system directories |

#### Auth

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/login` | POST | Login with username + password |
| `/api/logout` | POST | Logout and clear cookie |
| `/api/auth-status` | GET | Check auth status |

#### Callbacks & Blocks

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/create-block` | POST | Route A: create rich block |
| `/api/block-status` | GET | View BlockBuffer status |
| `/api/callbacks/post-message` | POST | Agent posts message via callback |
| `/api/callbacks/thread-context` | GET | Get session history for agent |

#### Operations

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dependencies/status` | GET | Check dependency health (Redis) |
| `/api/dependencies/logs` | GET | Query dependency logs with filters |
| `/api/verbose/agents` | GET | List agents with verbose logs |
| `/api/verbose/logs` | GET | List log files for an agent |
| `/api/verbose/log-content` | GET | Read a specific log file |

### Auth/Admin Service API

#### Users

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/verify` | POST | Verify user credentials |
| `/api/users` | GET | List users (requires `x-admin-token`) |
| `/api/users` | POST | Create user (requires `x-admin-token`) |
| `/api/users/:name/password` | PUT | Change password (requires `x-admin-token`) |
| `/api/users/:name` | DELETE | Delete user (requires `x-admin-token`) |

#### Agents

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agents` | GET | Get agent configs (requires `x-admin-token`) |
| `/api/agents` | POST | Create agent (requires `x-admin-token`) |
| `/api/agents/:name` | PUT | Update agent (requires `x-admin-token`) |
| `/api/agents/:name/prompt` | PUT | Update agent prompt (requires `x-admin-token`) |
| `/api/agents/:name/prompt/template` | GET | Preview shared template prompt (requires `x-admin-token`) |
| `/api/agents/:name/prompt/restore-template` | POST | Restore template prompt (requires `x-admin-token`) |
| `/api/agents/:name` | DELETE | Delete agent (requires `x-admin-token`) |
| `/api/agents/apply-pending` | POST | Apply pending agent configs (requires `x-admin-token`) |

#### API Connections

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/model-connections` | GET | List API connections (requires `x-admin-token`) |
| `/api/model-connections` | POST | Create API connection (requires `x-admin-token`) |
| `/api/model-connections/:id` | PUT | Update API connection (requires `x-admin-token`) |
| `/api/model-connections/:id` | DELETE | Delete API connection (requires `x-admin-token`) |
| `/api/model-connections/:id/test` | POST | Test API connection (requires `x-admin-token`) |

#### Groups

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/groups` | GET | List groups (requires `x-admin-token`) |
| `/api/groups` | POST | Create group (requires `x-admin-token`) |
| `/api/groups/:id` | PUT | Update group (requires `x-admin-token`) |
| `/api/groups/:id` | DELETE | Delete group (requires `x-admin-token`) |

#### System

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/healthz` | GET | Health check |
| `/api/system/dirs` | GET | Browse system directories (requires `x-admin-token`) |

### Agent Configuration

#### Default Agents

Defined in `src/agent-manager.ts`:

- Claude (🤖) — Technical and programming expert
- Codex Architect (🏗️) — Senior architect emphasizing high cohesion, low coupling
- Alice (👩‍💻) — Creative expert in art and design
- Bob (🧑‍💻) — Pragmatic engineering expert

#### Agent Config Structure

```typescript
interface AIAgentConfig {
  name: string;             // Agent name (2-32 chars)
  avatar: string;           // Avatar (1 emoji recommended)
  personality: string;      // Personality description
  color: string;            // Display color (#RRGGBB)
  systemPrompt?: string;    // Custom system prompt (optional)
  executionMode?: 'cli' | 'api';  // Execution mode
  cliName?: 'claude' | 'codex';   // CLI backend (for cli mode)
  apiConnectionId?: string;       // API connection ID (for api mode)
  apiModel?: string;              // Model name (for api mode)
  apiTemperature?: number;        // Temperature (for api mode)
  apiMaxTokens?: number;          // Max tokens (for api mode)
  workdir?: string;               // Working directory
}
```

#### Dynamic Config

Agent configs are stored in `data/agents.json` with hot reload:

- `applyMode: "immediate"` — Takes effect immediately
- `applyMode: "after_chat"` — Takes effect after current session ends

The runtime store in `data/agents.json` may also include these fields so deleted built-in default agents stay deleted across reloads:

- `removedDefaultAgentNames` — built-in default agents explicitly removed from the active config
- `pendingRemovedDefaultAgentNames` — built-in default agents explicitly removed from the pending config

This means:

- built-in defaults are still auto-seeded for an empty store
- but once a built-in agent is deleted, reloads will not silently add it back
- for `after_chat` deletions, the agent remains visible in the active config until pending changes are applied

#### Agent Groups

Groups are stored in `data/groups.json`:

```typescript
interface AgentGroup {
  id: string;          // Unique ID (2-20 chars, alphanumeric + underscore)
  name: string;        // Display name (2-16 chars)
  icon: string;        // Emoji icon (1-2 emojis)
  agentNames: string[]; // Agent name array
}
```

- **Sidebar grouping**: Agents organized by groups in the sidebar
- **Batch mention**: Type `@groupName` to mention all agents in the group

#### API Connections

API connections are stored in `data/api-connections.json`, supporting any OpenAI-compatible endpoint:

- Secure credential storage with masked API keys
- Connection test endpoint for validation
- Only HTTPS allowed (or localhost HTTP)
- Agents reference connections via `apiConnectionId`

### Agent Execution

#### Dual Execution Modes

Agents can be configured to run via:

1. **CLI mode** — Invokes Claude CLI or Codex CLI as subprocess with streaming support
2. **API mode** — Calls OpenAI-compatible API endpoints with configurable model parameters

#### Agent Chaining

- Single `@AgentName` — Reference/mention, does not trigger chain
- Double `@@AgentName` — Explicit chain invocation
- Callback `invokeAgents` — Agents can programmatically chain to other agents
- Configurable limits: `agentChainMaxHops` (default 4) and `agentChainMaxCallsPerAgent`

#### Peer Discussion Mode

Sessions can operate in two discussion modes:

- **classic** — Standard single-turn or chained responses
- **peer** — Multi-turn peer discussion with automatic pause/resume:
  - Discussion auto-pauses when no explicit chain continuation is detected
  - Manual summarization via `/api/chat-summary`
  - Discussion state: `active` / `paused` / `summarizing`

#### MCP Callback Server

The built-in MCP server (`src/agent-co-mcp-server.ts`) provides tools for CLI agents:

- `agent_co_post_message` — Post a message to the chat room
- `agent_co_get_context` — Read current session history

Environment variables for agent context:
- `AGENT_CO_API_URL` — Chat service URL
- `AGENT_CO_SESSION_ID` — Current session ID
- `AGENT_CO_AGENT_NAME` — Agent name
- `AGENT_CO_CALLBACK_TOKEN` — Auth token

### Rich Text

AI responses support `cc_rich` code blocks:

#### Card

```json
{
  "kind": "card",
  "title": "Title",
  "body": "Content",
  "tone": "info"
}
```

#### Checklist

```json
{
  "kind": "checklist",
  "title": "Title",
  "items": [
    { "text": "Task", "done": false },
    { "text": "Done", "done": true }
  ]
}
```

#### Dual Route

- **Route A**: Pre-store blocks via `/api/create-block` HTTP callback
- **Route B**: Extract `cc_rich` blocks from AI response text
- Blocks from both routes are merged (deduplicated by id)

### Streaming Response (SSE)

`/api/chat-stream` supports Server-Sent Events:

| Event | Data |
|-------|------|
| `user_message` | User message object |
| `agent_thinking` | `{ agent: string }` |
| `agent_delta` | `{ agent: string, delta: string }` |
| `agent_message` | AI message object |
| `notice` | `{ notice: string }` |
| `done` | `{ currentAgent: string \| null }` |
| `error` | `{ error: string }` |

### Session Mechanism

#### Session Memory

- After `@Claude`, `currentAgent` is set to "Claude"
- Subsequent messages without @ are automatically sent to the current agent
- Clearing history resets `currentAgent`

#### User Isolation

- Logged-in users: session token as identifier
- Unauthenticated users: IP address as identifier
- Each user has independent chat history, sessions, and agent state

#### Multi-Session

- Users can create, rename, switch, and delete sessions
- Session settings (chain limits, discussion mode) are per-session
- Agent workdirs are per-session-per-agent

### Security

#### Rate Limiting

- Global requests: 100 per minute
- Login attempts: 5 per minute

#### Production Checks

- `AUTH_ADMIN_TOKEN` must be >= 32 characters
- `AGENT_CO_DEFAULT_PASSWORD` must be >= 12 characters with uppercase, lowercase, digits, and special characters

#### Callback Auth

- Callback endpoints require `x-agent-co-callback-token` or `Authorization: Bearer` header
- Token configurable via `AGENT_CO_CALLBACK_TOKEN`

### iOS / PWA

- `public/manifest.json` + `public/service-worker.js` provide basic PWA capability
- iOS Safari supports "Add to Home Screen" for app-like experience
- `apple-touch-icon` (SVG) and iOS web app meta tags included

### Verbose Logging

CLI agent verbose output is recorded under `AGENT_CO_VERBOSE_LOG_DIR` (default: `logs/ai-cli-verbose`):

- File naming: `{timestamp}-{cliName}-{agentName}.log`
- Includes stdout, stderr, and meta information
- Queryable via `/api/verbose/*` endpoints

### Testing

```bash
npm test                # Run all integration tests
npm run test:unit       # Run unit tests only
npm run test:fast       # Fast run: unit tests + key integration tests
```

Unit tests are under `tests/unit/`, integration tests under `tests/integration/`.

### License

ISC
