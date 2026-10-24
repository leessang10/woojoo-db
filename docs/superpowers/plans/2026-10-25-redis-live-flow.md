# Redis Live Flow Implementation Plan

> Execute using superpowers:subagent-driven-development for independent backend and observation-model tasks; integrate and visually verify in this chat.

**Goal:** React Flow queue cylinders and cache lifecycle effects backed by bounded real observation and explicit demo events.
**Architecture:** Read-only Redis snapshots establish state; a separate observation Stream supplies job/cache events. Pure reducers enforce identity, ordering and bounded history. React Flow preserves viewport while rendering lightweight cards and tokens.
**Tech stack:** Existing React, TypeScript, @xyflow/react, Tauri/Rust, shadcn, Vitest and Playwright.
**Spec:** docs/design/redis-live-flow.md

## Constraints
- Preserve existing uncommitted UI edits. Do not consume business queues or modify server configuration.
- Unknown worker/job outcomes stay unknown; initial baselines do not animate as newly created data.
- Explicit demo data; no payload persistence. 200 cache nodes, 12 queue cards, bounded history and cancellation on hidden workspace/session change.

## Review focus
- Equal List payloads, moving indexes and incomplete pages cannot identify job departures.
- Streams ACK does not delete log entries; consumer-group identity is separate.
- Changed TTL requires comparing expiration deadlines, not raw countdowns.
- Reconnects, duplicate and delayed events must not animate stale work or reverse state.
- Narrow layouts, reduced motion and real animation progression require browser verification.

## Tasks
- [x] Backend: bounded read-only observation Stream reader with baseline/gap detection, optional keyspace notification subscription; Rust tests and isolated Redis checks. Return records as `{id, fields}`; fields carry the normalized event contract.
- [x] Observation model: event validation/reducer and snapshot diff, numeric strings, bounded dedup/history, explicit uncertainty; unit tests.
- [x] Frontend: custom queue cylinder, cache nodes and inspector; observation controls, flow/list switch, demo event generator, real snapshot/event integration.
- [x] Verify: browser animation frames and screenshots, list regressions, themes/languages/960x640/reduced-motion, frontend build and backend tests.
- [x] Document the event producer contract and final supported/unsupported capabilities with evidence.


## Verification result — 2026-10-25

- `npm run build`: passed (existing large-chunk advisory remains).
- `npx vitest run src/redis`: 19 passed.
- `npx playwright test tests/redis-flow.spec.ts tests/redis-native-contract.spec.ts tests/redis-workspace.spec.ts`: 21 passed.
- `cargo test --manifest-path src-tauri/Cargo.toml redis:: -- --nocapture`: 33 passed, isolated live test intentionally ignored in this normal run.
- Backend worker separately ran `live_flow_observation_transport --ignored` against disposable Redis 7 on port 16388: passed; container removed.
- Inspected screenshots of queue entry/exit, cache refresh, English light and Korean dark at 960×640. Playwright confirms moving CSS transforms, reduced motion, pause, viewport persistence, duplicate suppression, scope filtering, and delayed received events.
- Browser verifies the rendered UI and a mocked native IPC contract; real Redis transport was verified separately. An end-to-end production service connection has not been configured.

## Scope delivered

Flow/List views; horizontal queue cylinder; sampled retained cards plus transient event tokens; cache namespace groups, TTL deadline-aware progress, hit/write/miss effects; selected inspector; event history; explicit demo playback; read-only snapshots; optional keyevents; generic observation Stream. Successful business processing and cache hit/miss require the service event integration documented in `docs/design/redis-flow-events.md`.

The first visible cache namespace is framed initially at a readable scale; users can pan or use Fit View for all groups. Values are sampled 12 at a time, not a full-database continuous read. The canvas shows at most 200 observed keys, 8 preview cards per cylinder and at most 30 simultaneous effects overall. Existing List views retain detailed Stream groups/pending inspection. No library-specific queue adapter or whole-database activity guarantee is claimed.
