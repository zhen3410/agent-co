# Event-log Chat Runtime Architecture

This document describes the **runtime contract** of the current event-log-driven chat system: the canonical session event model, projection rules (timeline + call-graph), discussion-state transitions, and the WebSocket + HTTP timeline sync contract.

> Scope note: this doc is intentionally limited to behavior present in the current codebase (see `src/chat/domain/session-events.ts`, `src/chat/application/chat-timeline-projection.ts`, `src/chat/application/call-graph-projection.ts`, `src/chat/http/ws-routes.ts`, `src/chat/http/event-query-routes.ts`, and `public/index.html`).

---

## 1) Canonical session events

### 1.1 Event envelope

Each session event is an append-only envelope (`SessionEventEnvelope`) with:

- `sessionId`: session identifier
- `seq`: **monotonic per-session sequence**, starting at `1` (empty session has latest seq `0`)
- `eventId`: unique id (includes `sessionId` + `seq` + random suffix)
- `eventType`: string union (see below)
- `actorType`: `user | agent | system`
- `actorId?`, `actorName?`
- `payload`: JSON object (event-type specific; may be `{}`)
- `metadata?`: string/number map
- `createdAt`: ISO string
- Correlation fields (optional): `correlationId?`, `causationId?`, `causedByEventId?`, `causedBySeq?`

### 1.2 Canonical event types (by category)

The canonical `eventType` set is:

**Session lifecycle**
- `session_created`
- `session_metadata_updated`
- `session_closed`

**Message lifecycle**
- `user_message_created`
- `user_message_updated`
- `agent_message_created`
- `agent_message_updated`

**Thinking markers**
- `message_thinking_started`
- `message_thinking_finished`
- `message_thinking_cancelled`

**Dispatch tasks**
- `dispatch_task_created`
- `dispatch_task_completed`

**Invocation review**
- `agent_review_requested`
- `agent_review_submitted`

Notes:
- `payload` is untyped at the envelope layer. Projections read only the fields they need (see sections below).
- Timeline/call-graph projections do **not** assume every event is renderable; “non-projectable” events are ignored by that projection.

---

## 2) Timeline projection rules

### 2.1 Endpoint + cursor

- `GET /api/sessions/:id/timeline` returns `{ timeline: ChatTimelineRow[] }`.
- `GET /api/sessions/:id/timeline?afterSeq=<n>` returns only rows with `row.seq > n`.
  - `afterSeq` must be a non-negative **safe integer**; otherwise the server returns HTTP `400`.

Important: the cursor (`afterSeq`) is the **event `seq`**, and timeline rows preserve that same `seq`.

### 2.2 Sorting and mapping

Timeline projection is:

1. Sort events by `(seq ASC, eventId ASC)`.
2. Map each event into one timeline row (or `null`), then keep only non-null rows.

Row kinds and their source events:

- `kind: "message"`
  - From: `*_message_created`, `*_message_updated`
  - Requires: `payload.message` to be an object with a non-empty `message.id`
  - Fields:
    - `messageId = message.id`
    - `message = payload.message`
    - `isUpdate = eventType endsWith "_updated"`

- `kind: "thinking"`
  - From: `message_thinking_*`
  - Fields:
    - `status = started | finished | cancelled` (derived from `eventType`)
    - `taskId? = payload.taskId` (string)
    - `messageId? = payload.messageId` (string)

- `kind: "dispatch"`
  - From: `dispatch_task_created`, `dispatch_task_completed`
  - Fields:
    - `status = created | completed`
    - `taskId? = payload.taskId`
    - `dispatchKind? = payload.dispatchKind`
    - `callerAgentName? = payload.callerAgentName`
    - `calleeAgentName? = payload.calleeAgentName`

- `kind: "review"`
  - From: `agent_review_requested`, `agent_review_submitted`
  - Fields:
    - `status = requested | submitted`
    - `taskId? = payload.taskId`
    - `reviewAction? = payload.reviewAction`
    - `reviewRawText? = payload.reviewRawText`
    - `reviewDisplayText? = payload.reviewDisplayText`
    - `callerAgentName? = payload.callerAgentName`
    - `calleeAgentName? = payload.calleeAgentName`

All row kinds share a base (`ChatTimelineRowBase`) copied from the event envelope:

- `id = eventId`, `seq`, `eventType`, `actorType`, `actorName?`, `createdAt`, `metadata?`, `payload?`
- Correlation fields: `correlationId?`, `causationId?`, `causedByEventId?`, `causedBySeq?`

### 2.3 Grouping rule (`groupId`)

Each row gets a `groupId` derived in this priority order:

1. `correlationId`
2. `causationId`
3. `causedByEventId`
4. fallback: `eventType`

This is a lightweight UI grouping hint; it is not a strict causal model.

---

## 3) Call-graph projection rules

### 3.1 Endpoint

- `GET /api/sessions/:id/call-graph` returns `{ callGraph: { nodes, edges } }`.

### 3.2 Sorting and participating events

The call-graph projection sorts events by `(seq ASC, eventId ASC)` and currently reacts to:

- Message creation: `user_message_created`, `agent_message_created`
- Dispatch: `dispatch_task_created`, `dispatch_task_completed`
- Review: `agent_review_requested`, `agent_review_submitted`

Other events are ignored by the call-graph projection.

### 3.3 Node creation

The projection creates three node kinds:

- `message` node (`id = "message-<messageId>"`)
  - Source: message creation events only
  - Requires: `payload.message.id`
  - Label: `message.text.trim()` else `message.sender` else `messageId`
  - Metadata: `seq`, `eventId`, and an approximate `timestamp` (`message.timestamp` when present, otherwise `event.seq`)

- `task` node (`id = "task-<taskId>"`)
  - Source: dispatch/review events and also message nodes when `message.taskId` is present
  - Label: `taskId`
  - Metadata: creation `eventId` + `seq`

- `agent` node (`id = "agent-<agentName>"`)
  - Source: agent message creation events and dispatch/review payload hints
  - Label: `agentName`

Nodes are de-duplicated by their `id`.

### 3.4 Edge creation

Edges are appended in event order. Current edge types:

- `reply`
  - `message -> message` when an event can be linked to a prior message via:
    1) `causedByEventId` (preferred)
    2) `causationId`
    3) `correlationId` (mapped from earlier message events that carried the same correlation id)
    4) `causedBySeq` (resolved via an internal `seq -> event` map)
  - `task -> message` when the created message carries `message.taskId`

- `invoke`
  - `message -> task` if `dispatch_task_created` can be linked to a message via the same “resolve message for event” rule above
  - `agent(caller) -> task` when `dispatch_task_created.payload.callerAgentName` is present

- `resume`
  - `task(parent) -> task(child)` when `dispatch_task_created.payload.parentTaskId` is present

- `stop`
  - `task -> agent(callee)` on `dispatch_task_completed` when `payload.calleeAgentName` is present

- `review`
  - `task -> agent(reviewer)` on `agent_review_requested`
  - `agent(reviewer) -> task` on `agent_review_submitted`

This graph is a **best-effort structural view** derived from correlation hints. It is not guaranteed to be a complete causal DAG.

---

## 4) Discussion-mode / discussion-state transitions

Discussion state is persisted on the session object (not derived from event projections).

### 4.1 Normalization

- `discussionMode`: `classic | peer` (invalid values fall back to the default)
- `discussionState`: `active | paused | summarizing` (invalid values fall back to the default)

Normalization rules:
- In `classic` mode, the normalized `discussionState` is always `active`.
- Only `peer` mode uses `paused` / `summarizing`.

### 4.2 Runtime transitions (peer mode)

The core transitions enforced by runtime helpers:

- **Incoming user message / new turn preparation** → `discussionState = "active"`
  - Also clears any pending execution snapshot (`pendingAgentTasks`, `pendingVisibleMessages`).

- **Manual summary starts** → `discussionState = "summarizing"`
  - Also clears pending execution snapshot.
  - A per-session summary lock prevents concurrent summary requests.

- **Manual summary ends** → restore “continuation snapshot”
  - Restores pending execution snapshot (if any).
  - Restores `discussionState` as:
    - `active` if snapshot was `active`
    - otherwise `paused` (snapshot `summarizing` is normalized back to `paused`)

UI note: in peer mode, when `discussionState === "paused"`, the chat page renders a pause card instead of continuing the timeline flow.

---

## 5) WebSocket + timeline sync contract

### 5.1 Roles: WS is a buffer/invalidation channel; timeline is authoritative

- **Authoritative display**: `GET /api/sessions/:id/timeline` (full) or `?afterSeq=` (incremental).
- **WebSocket** (`/api/ws/session-events`) is used to:
  1) deliver session events (and optional backfill on subscribe), and
  2) signal the client that it should reconcile via HTTP timeline refresh.

The browser does **not** render directly from WS event payloads; it uses them to advance a cursor and schedule a timeline refresh.

### 5.2 WebSocket messages

Client → server:

- `{"type":"subscribe","sessionId":"...","afterSeq":<n>}`
- `{"type":"unsubscribe"}`
- `{"type":"ping"}`

Server → client:

- `{"type":"subscribed","sessionId":"...","latestSeq":<n>,"backfilled":<count>}`
  - The server uses `afterSeq` to backfill events with `seq > afterSeq` **before** returning this ack, then reports:
    - `latestSeq`: the last delivered backfill seq, or the normalized `afterSeq` if no backfill
    - `backfilled`: number of backfilled events delivered over `session_event`
- `{"type":"session_event","sessionId":"...","event": <SessionEventEnvelope>}`
- `{"type":"heartbeat","timestamp":<ms>}` (server-side keepalive)
- `{"type":"pong","timestamp":<ms>}` (reply to client `ping`)
- `{"type":"unsubscribed","success":true}`
- `{"type":"error","error":"...","sessionId?":"..."}`

### 5.3 Browser cursor and refresh loop (current implementation)

The chat page tracks:

- `lastSeenEventSeq`: an **event-seq cursor** (advanced on WS events and subscribe acks)
- `timelineRows`: the rendered authoritative projection
- `socketConnectionState` and `timelineRefreshState` (explicit state machine)
- `activeSessionSyncNonce`: increments when switching sessions; used to ignore stale responses

#### Triggering a refresh

When a `session_event` arrives for the active session:

1. Update `lastSeenEventSeq = max(lastSeenEventSeq, event.seq)`.
2. Mark the refresh as pending and schedule a coalesced timeline refresh.

#### Coalescing (no concurrent refresh)

If a timeline refresh is already in-flight:

- mark `timelineRefreshState.pending = true`
- once the in-flight request finishes, run **one** follow-up refresh if `pending` was set.

#### Incremental refresh and fallback

The browser prefers incremental timeline reads after reconnect/subscribe:

- Incremental request: `GET /api/sessions/:id/timeline?afterSeq=<cursor>`
- Full request: `GET /api/sessions/:id/timeline`

Incremental results are **appended** to `timelineRows` only when the response passes a strict sanity check; otherwise the browser falls back to a full refresh. The current fallback triggers include:

- response is for a stale session (`activeSessionId` mismatch) or stale sync nonce
- response timeline is not an array
- first incremental row has invalid `seq`, or `firstSeq > afterSeq + 1`
- any incremental row:
  - has invalid `seq`
  - has `seq <= afterSeq`
  - has `seq <= renderedTailSeq` (would duplicate/regress the already-rendered tail)

If the incremental response is empty, it is accepted (no UI change) and the cursor remains authoritative for future WS-triggered refreshes.

---

## 6) Related observability endpoints

These endpoints are for debugging and integration tests (not for “client truth”):

- `GET /api/sessions/:id/events[?afterSeq=]` → raw event envelopes
- `GET /api/sessions/:id/sync-status` → `{ latestEventSeq, latestTimelineSeq, timelineRowCount, discussionState }`
  - Empty session contract: `latestEventSeq: 0`, `latestTimelineSeq: null`, `timelineRowCount: 0`

