# Docker Project Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Assemble, inspect, save and run Docker Compose projects visually, including environment mappings and startup conditions.

**Architecture:** Keep YAML documents as the source of truth, derive typed service/resource views, and apply narrow Document patches. A project editor owns draft history and connection intents; Rust owns source files, catalog providers, effective Compose validation and cancellable execution. Existing Docker runtime inspection remains available.

**Tech Stack:** React 19, TypeScript, yaml Document, React Flow, existing shadcn controls, Tauri 2/Rust, Docker Compose CLI.

**Spec:** `docs/superpowers/specs/2026-10-27-docker-project-builder-design.md`

## Global Constraints

- New branch: `codex/docker-project-builder`; preserve unrelated audit files.
- Engine-independent drafts; adding a component never pulls or starts containers.
- Preserve comments, interpolation and unknown fields. Ambiguous aliases and merged-source GUI edits are read-only.
- Connection proposals require explicit application; existing values are kept by default. One proposal is one undo entry.
- No unclassified environment values, commands, build args, raw imported YAML or output logs in automatic persistent drafts.
- Browser connections cannot use internal DNS or secrets. Runtime environment and build arguments remain distinct.
- No automatic volume deletion, orphan removal, retry, rollback or detached background daemon.
- Use explicit context/project/source revisions; invalidate stale reviews before execution.
- Korean/English, light/dark, keyboard alternatives and 960×640 layouts.

## Review Focus

- Imported aliases/merge keys and long syntax must survive unrelated edits (Task 1).
- User edits after a managed connection must survive rename/removal and undo (Task 2).
- A source/env change between review and apply must invalidate the operation (Task 3).
- Closing/reopening or switching context during async work must never apply results to another project (Tasks 3, 5).
- Unclassified strings and raw YAML must not leak through autosave/history/log persistence (Tasks 1, 3, 5).

---

### Task 1: Source-preserving project document and safe drafts

**Files:** Create `src/docker/builder/document.ts`, `types.ts`, `persistence.ts`, `document.test.ts`.

**Interfaces:** `createProject(): ProjectDraft`; `readProject(source: string): ProjectView`; `patchProject(draft, patches): ProjectDraft`; `safeDraft(draft): PersistedDraft`; `restoreDraft(saved): ProjectDraft`. A draft contains stable id, name, source, revision, source files, context, connections and positions. Views expose services, networks, volumes, issues and editability with source paths. A patch is `{path: (string|number)[], value?: unknown, remove?: boolean}`.

- [x] Write tests: comment/x-field/interpolation preservation; alias lock; malformed YAML partial view; long ports/mounts; safe serializer excludes arbitrary env/command/build args/raw unknown fields.
- [x] Run `npm test -- src/docker/builder/document.test.ts`; expected missing module/export failures.
- [x] Implement Document-based read/patch, resource normalization, bounded history and allowlisted safe reconstruction. Imported drafts persist file identities only.
- [x] Run the same tests; expected all pass. Commit `feat(docker): add source-preserving project drafts`.

### Task 2: Catalog, connection proposals and validation

**Files:** Create `src/docker/builder/catalog.ts`, `connections.ts`, `validation.ts`, `connections.test.ts`.

**Interfaces:** `catalog` versioned manifests; `addComponent(draft, input): ProjectDraft`; `proposeConnection(draft, consumer, provider): ConnectionProposal`; `applyConnection(draft, proposal): ProjectDraft`; `removeConnection(draft, id): ProjectDraft`; `renameService(draft, oldKey, newKey): ProjectDraft`; `validateProject(draft): ValidationIssue[]`.

- [x] Write failing tests for Redis standalone loopback/dedicated volume, multi-service internal default, MySQL env/healthy proposal, conflict preservation, atomic undo, tracked rename, edited mapping removal, cyclic startup, browser-secret/internal-DNS rejection.
- [x] Run `npm test -- src/docker/builder`; expected new tests fail.
- [x] Implement four bundled manifests (Redis 7.4, MySQL 8.4, PostgreSQL 16, Elasticsearch 8.15.5), explicit unresolved secret references, endpoint metadata, ownership and source-aware mapping. Validate against official image documentation during implementation.
- [x] Validate missing references/healthcheck/required values/port collisions/shared DB volumes; report uncertainty independently from errors.
- [x] Run builder tests; expected all pass. Commit `feat(docker): propose component connections and startup conditions`.

### Task 3: Native project sources, discovery and reviewed jobs

**Files:** Create `src-tauri/src/docker/builder.rs`, `src-tauri/src/docker/builder_jobs.rs`, `src/docker/builder/api.ts`; modify Docker command registration and app lifecycle hooks.

**Interfaces:** native `docker_builder_import`, `docker_builder_pick_app`, `docker_builder_search`, `docker_builder_tags`, `docker_builder_review`, `docker_builder_save`, `docker_builder_start`, `docker_builder_cancel`, `docker_builder_operations`; typed frontend wrappers match serde camelCase DTOs. Review returns effective source, masked summary, token, expected originals and source identities. Start consumes saved revision token and emits job events through Channel; operations are backend-owned and queryable.

- [x] Add failing Rust tests for file revisions, ordered source args, source-local temp files, input fingerprint changes (.env/env_file/config/secret/Dockerfile), bounded redaction, safe recovery metadata and duplicate job rejection.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml docker::builder`; expected new assertions fail.
- [x] Implement read-only multi-file import/file selection, Dockerfile discovery, Docker CLI search and official Hub tags with pagination/cache dates/error responses.
- [x] Implement per-file optimistic writes, explicit secret-file/save review, Compose capability/config validation and fingerprint-bound plan. Preserve original YAML; multi-file effective view is read-only.
- [x] Implement jobs with configurable timeout, cancellation, bounded in-memory output, durable secret-free status, context/project mutex and shutdown cancellation/reconciliation. Up explicitly avoids orphan removal and never deletes volumes.
- [x] Run Rust tests; expected pass. Commit `feat(docker): add reviewed project sources and cancellable compose jobs`.

### Task 4: Visual editor and component/property panels

**Files:** Create `src/docker/builder/ProjectBuilder.tsx`, `ComponentPicker.tsx`, `ServiceProperties.tsx`, `ConnectionPanel.tsx`, `ProjectCanvas.tsx`, `builder.css`; create `tests/docker-builder.spec.ts`.

**Interfaces:** `ProjectBuilder({context,snapshot,language,theme,onRuntimeChanged})` owns project sessions. Canvas accepts semantic view/intents and emits selection, drag connection and position changes. Picker emits catalog/image/build selections. Properties emit patches. Connection panel edits a proposal before calling apply.

- [x] Write browser tests for immediate new draft, card-based Redis, API→MySQL proposal, existing-value preservation, undo, network/storage membership and original-source inspection.
- [x] Run `npx playwright test tests/docker-builder.spec.ts`; expected missing editor failures.
- [x] Implement canvas plus accessible service list, layers for connections/networks/storage/startup, foldable/resizable panels, no mandatory initial fields, inline name, catalog/search/local/build choices and source editor.
- [x] Implement env key/value/reference editing, ports, networks/external resources, named/bind/tmpfs mounts, healthcheck/restart/depends/build settings and browser/build-time connection options.
- [x] Run browser tests and `npm run build`; expected pass. Commit `feat(docker): assemble projects in a visual workspace`.

### Task 5: Workspace integration, import, review and runtime reconciliation

**Files:** Modify `src/docker/DockerWorkspace.tsx`; create `src/docker/builder/ReviewPanel.tsx`, `OperationPanel.tsx`; extend browser native-contract coverage.

**Interfaces:** Builder is the default project work surface, with runtime resources available as a separate view. Existing operations and storage tools retain guards. Review is tied to the immutable document revision, context and ordered source set.

- [x] Add failing browser/native-contract tests for engine-off drafts, source conflict, late response/context switch, stale review, masked save review and job progress/cancel/reopen.
- [x] Integrate unified draft/saved/runtime project navigation, imports and file source tabs, save-only/reviewed-run, issue navigation, expected changes, persistent job status and snapshot/health reconciliation.
- [x] Implement safe autosave and explicit unsaved-raw/secret loss boundaries; show orphan runtime services without automatic removal; app exit offers waiting or cancelling/reconciling.
- [x] Run `npm test`, `npm run build`, Docker browser tests and Rust Docker tests; expected pass. Commit `feat(docker): integrate project review and runtime reconciliation`.

### Task 6: Acceptance verification and branch review

**Files:** Create `docs/research/docker-builder-2026-10-27/verification.md`; update plan checkboxes.

- [x] Run full frontend and Rust suites; record real output and distinguish environment blockers.
- [x] Exercise new-project, multi-service, import/edit, invalid config, stale files and recovery in Korean/English and small/light/dark layouts.
- [x] When local Docker is available, use uniquely named disposable projects to verify Redis, multiple services, change/recreate, data retention and failure/recovery. Remove only task-owned containers/networks; delete test data only after verification.
- [x] Fresh whole-branch reviewer reads spec/plan/diff; fix important findings with regression tests. Never describe mocked runs as native validation.
- [x] Commit verified result on the feature branch; leave branch for user's review, without merge/push.

## Execution notes

Completed on the requested feature branch. The final verification report records exact executed checks and remaining manual coverage boundaries; the checklist above tracks completion of the implementation tasks, not a claim that every proposed test was run as a separate command.

- Native tests cover revisions, ordered files, output redaction, metadata-only recovery, file-save recovery, merged effective review and dotenv round trips. Context/project exclusion is enforced by the backend job registry; installed-app restart timing remains a manual validation boundary.
- Safe structural metadata uses the app WebView's local persistent storage. Raw imported files remain at their source paths and operation recovery metadata uses native app-data storage.
- Draft/file projects now appear in the Docker sidebar alongside runtime-only projects. The Compose context/project name identifies runtime resources; review and file writes additionally require project UUID, ordered source identities and revision/fingerprint.
- Final review found ten Important issues. All were addressed in one correction pass with focused regressions, then the complete suites were rerun. The review and resolution evidence is summarized in the verification report.
- User requested a new branch; keep the result on that branch without merging or publishing.
