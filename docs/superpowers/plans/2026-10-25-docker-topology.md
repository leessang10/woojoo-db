# Docker Topology Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Explain Docker image/container/storage/port relationships in a project-scoped graph with trustworthy status and logs.
**Architecture:** Rust invokes the installed Docker CLI with explicit contexts and returns sanitized DTOs. React Flow renders a normalized graph; a Tauri Channel carries bounded logs. Existing work areas remain mounted independently.
**Tech Stack:** React, TypeScript, React Flow, Dagre, Tauri, Rust/Tokio. No new dependencies.
**Spec:** `docs/superpowers/specs/2026-10-25-docker-topology-design.md`

## Global Constraints
- Preserve existing App.tsx and test changes; work on codex/docker-topology in current checkout.
- Native Windows CLI subprocesses are hidden; no shell interpolation; no global context mutation.
- 5-second container status and 30-second resource refresh, only while visible; stale responses cannot cross contexts.
- 200 initial log lines; maximum 5,000 lines or 2MiB; explicit truncation; no persistent logs or inspect secrets.
- No new Docker resources, deletes, Compose up/down, automatic retries of mutations or credential discovery.
- Korean/English and light/dark supported. No healthcheck means unknown service health.

## Review Focus
- Context changed while a request or confirmation is pending must never target the new context accidentally.
- Missing/deleted resources and partial permission failures must not produce false healthy or unreferenced claims.
- Non-HTTP published ports and remote/WSL paths must not be treated as local URLs/files.
- Hidden workspaces and rapid log switches must stop only the corresponding subscription.
- Huge output, partial UTF-8 and simultaneous stderr/stdout must not exhaust memory or hide process errors.

### Task 1: Typed graph semantics
**Files:** `src/docker/model.ts`, `src/docker/model.test.ts`, `src/docker/demo.ts`.
**Interfaces:** `Snapshot`, `Container`, `Resource`, `buildGraph(snapshot, project, language)`, `projects(snapshot)`, `statusLabel(container, language)`, `appendLogs`.
- [x] Write failing tests for published versus exposed ports, bind/volume/tmpfs distinction, shared resources, orphan project labels, context-qualified IDs, and independent lifecycle/health labels.
- [x] Run `npx vitest run src/docker/model.test.ts` and observe failure.
- [x] Implement typed graph transformation and bounded log buffer, with explicit demo fixtures.
- [x] Repeat targeted test; expected all pass.

### Task 2: Docker backend
**Files:** `src-tauri/src/docker/{mod,cli,logs}.rs`, `src-tauri/src/main.rs`.
**Interfaces:** `docker_contexts()`, `docker_snapshot(context, resources)`, `docker_action(context,id,action)`, `docker_logs_start(context,id,subscription,onEvent)`, `docker_logs_stop(subscription)`.
- [x] Add tests for command argument validation/context pinning, metadata sanitization, port/state/mount extraction, and bounded streaming frames.
- [x] Implement CLI limits, sanitized DTOs, partial warnings, resource refresh, exact-ID mutation locks, bounded cancellable Channel streams.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml docker::`; expected pass.

### Task 3: Docker workspace and application integration
**Files:** `src/docker/{api,Graph,Details,Logs,DockerWorkspace}.tsx/ts`, `src/docker/docker.css`, `src/App.tsx`.
**Interfaces:** `DockerWorkspace({visible, sidebarOpen, onToggleSidebar, theme})` consumes Task 1 DTOs and Task 2 commands.
- [x] Add Playwright mock scenarios covering project navigation, stale contexts, log cleanup, disabled stale mutations and confirmation.
- [x] Implement context/project navigation, graph/list selection, persistent layout, honest state details, logs and controls. Use cancellable generations and serialized polls; gate mutations on current successful snapshot.
- [x] Run `npm run build` and `npx playwright test tests/docker-workspace.spec.ts`; expected pass.

### Task 4: Verification and review
**Files:** feature tests and README feature notes.
- [x] Run unit/Rust suites and relevant workspace UI regression tests; inspect every result.
- [x] Inspect available Docker connection read-only; do not mutate unrelated containers for testing.
- [x] Request an independent final review against the spec; fix material issues with regression tests.
- [x] Record outcomes and actual-engine limitations, update checkboxes and commit only feature files/hunks.

## Execution record
- Native execution chosen to honor user's go-ahead without another approval round. Existing checkout reused to preserve in-progress application changes.
- Pre-flight: Task 1 DTOs are the shared contract for Tasks 2/3; Task 2 Channel events use subscription ownership, Task 3 guards context generations.

- Task 1 complete: topology semantics and bounded buffer tests; 6 focused tests pass.
- Task 2 complete: context-pinned CLI, bounded processes, sanitized snapshot and streams; full Rust suite 51 passed, 5 environment-dependent tests ignored.
- Task 3 complete: Docker area, project graph, details/actions, logs and explicit browser demo; production web build passes.
- Task 4 complete: 57 unit tests and 23 targeted UI/regression tests passed. Light/dark screenshots inspected.
- Final review fixed: native app exit prevents exit until log children are cancelled and reaped. Regression observed missing shutdown registry, then passed with a real quiet Windows child process.
- Final review fixed: filtered-out nodes retain manually arranged positions. Regression failed before position-cache merge and passed afterward. Reclassified as required behavior because layout preservation is in the spec.
- Additional regressions fixed: shared resources are not incorrectly called unreferenced; refreshing contexts cannot clear a stale engine error or re-enable actions.
- Actual-engine limitation: Docker CLI and contexts detected, but desktop-linux engine pipe is unavailable. No real Docker container mutations were performed. Live Docker integration remains unverified; mock UI coverage is not a substitute.
- Build has the existing large-chunk warning; Docker graph code is lazy-loaded. No dependencies added.
