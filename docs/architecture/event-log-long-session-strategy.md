# Event-log Long-session Strategy

This document describes **how the current event-log architecture can evolve for long-running sessions**, without changing today’s runtime guarantees. It focuses on paging/archival options, recommended API boundaries, and what is intentionally deferred.

> Scope note: as of this writing (2026-04-12), the implementation keeps the session event log in-memory and builds projections by replaying the full event list per request. The only incremental read supported today is `afterSeq` filtering on `events` and `timeline`.

---

## 1) Current baseline (what exists today)

### 1.1 Read APIs

- **Events (canonical)**
  - `GET /api/sessions/:id/events`
  - `GET /api/sessions/:id/events?afterSeq=<n>`

- **Timeline (UI projection)**
  - `GET /api/sessions/:id/timeline`
  - `GET /api/sessions/:id/timeline?afterSeq=<n>`

- **Call graph (analysis projection)**
  - `GET /api/sessions/:id/call-graph`

- **Sync diagnostics (observability)**
  - `GET /api/sessions/:id/sync-status`

### 1.2 Projection cost model

Today, both `timeline` and `call-graph` are computed by:

1) listing all session events, then  
2) sorting and projecting them in-memory.

This is straightforward and correct, but it scales linearly with the number of events per session.

---

## 2) Recommended API role boundaries (next-step shaping)

To keep the system maintainable as sessions grow, keep these responsibilities separated:

### 2.1 `events` — canonical, append-only log (source of truth)

Recommended responsibilities:

- Stable envelope contract (`seq`, `eventId`, correlation fields, etc.)
- Cursor-based paging by `seq` (today: `afterSeq`; future: `beforeSeq`, `limit`)
- WebSocket backfill source (subscribe with `afterSeq`)
- Debug/replay tooling

Non-goals:
- Not optimized for UI consumption (it is raw, verbose, and includes non-renderable events).

### 2.2 `timeline` — UI-focused read model

Recommended responsibilities:

- Returns renderable rows only (message/thinking/dispatch/review)
- Cursor semantics aligned to event `seq` (already true today)
- Supports “tail catch-up” efficiently (today: `afterSeq`)

Potential future extensions (not implemented yet):

- `limit` (cap row count per response)
- `beforeSeq` (scrollback paging)
- “tail window” API for fast initial load (e.g., last N rows) while retaining correctness

### 2.3 `call-graph` — derived structural/analytics view

Recommended responsibilities:

- Derived graph for debugging orchestration (dispatch/review/reply structure)
- Potential caching or partial recompute strategies (future)

Non-goals:
- Do not overload the call graph to serve as the UI’s primary history; it is lossy and best-effort.
- Paging, caching, snapshots, or archival may optimize read paths later, but must not change the call-graph semantics: it stays a derived view built from the same canonical event stream with the same ordering and edge-construction rules.

### 2.4 `history` — prompt/LLM-facing message list (legacy-compatible)

Even in an event-log-first system, “history” remains a useful boundary:

- It represents the message list used for prompting agents and session hydration.
- It is not the authoritative realtime UI projection; realtime display should continue to read from `timeline`.
- It can stay decoupled from the UI timeline shape (timeline may include non-message activity rows).

Potential future direction (explicitly not done yet):

- Keep `history` as an event-log-derived message projection (or cache/materialized view of that projection), with compaction/summarization layered on top if needed.

---

## 3) Paging and archival options

The options below are **strategy candidates**. They are not implemented yet; choose based on operational constraints and session size targets.

### Option A — Pure cursor paging on the canonical event log

Add server-side paging parameters to `events` (and optionally `timeline`):

- `afterSeq` (tail catch-up; already present)
- `beforeSeq` + `limit` (scrollback)
- `limit` for safety bounds

Pros:
- Minimal conceptual change
- Keeps event log as the authoritative source

Cons:
- Timeline/call-graph still need to project “enough” events to produce correct rows unless projections become incremental.

### Option B — Projection caching (incremental read models)

Maintain per-session cached projections:

- cache of timeline rows (append-only, keyed by last projected seq)
- cache of call-graph nodes/edges (incrementally updated for dispatch/review/message creation)

Pros:
- Dramatically reduces repeated full replay cost

Cons:
- Introduces cache invalidation and versioning requirements
- Needs careful rebuild triggers when projection logic changes

### Option C — Snapshot + delta (“event log segments”)

Persist periodic snapshots:

- store a snapshot at seq `S` (e.g., timeline rows up to `S`, and/or a summarized session state)
- keep events after `S` as a delta segment

Pros:
- Bounded replay time for cold start

Cons:
- Snapshot format/versioning becomes a long-term compatibility surface
- Requires migration tooling when projection/schema evolves

### Option D — Archival / compaction policies

For very long sessions, support archiving older portions:

- move older event segments to disk/Redis/object storage
- serve recent tail from hot storage and older ranges via a slower path
- optionally compact “update” events into periodic “folded state” snapshots (e.g., only keep the last message update per message id)

Pros:
- Keeps hot path fast while retaining full history

Cons:
- Increases operational complexity and requires clear retention rules

---

## 4) What is intentionally deferred (non-goals for now)

To keep the current rewrite focused and verifiable, the following are intentionally **out of scope** today:

- Server-side `beforeSeq`/`limit` paging for timeline and events (beyond `afterSeq`)
- Persistent event-store durability guarantees (the event repository is currently in-memory)
- Automatic event compaction/snapshotting/migrations
- Partial projection materialization (timeline/call-graph are recomputed from events today)
- Cross-session/global indexing or search over events
- A formal “projection version” negotiation between client and server

---

## 5) Related docs

- Runtime architecture and sync contract: `docs/architecture/event-log-chat-runtime.md`
