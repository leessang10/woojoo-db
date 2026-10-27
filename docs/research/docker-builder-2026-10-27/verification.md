# Docker project builder verification

Branch: `codex/docker-project-builder` · 2026-10-27

## Implemented workflows

- Immediate engine-independent project drafts, safe structural restoration and connection-reference metadata.
- Bundled Redis 7.4, MySQL 8.4, PostgreSQL 16 and Elasticsearch 8.15.5 manifests; public Hub search/tags/platform/digest selection; existing local images and Dockerfiles.
- Service canvas and keyboard-accessible list, network/storage/startup layers, environment/port/mount/build/health/restart editing.
- Reviewed connection proposals, existing-value preservation, one-step undo, tracked rename/value changes and ownership-aware disconnect.
- Source-preserving YAML patches; aliases/anchors/include/extends and merged-file GUI edits restricted to source editing.
- Ordered multiple-file import, effective Compose review, source revision checks, `.env` additions reviewed with `.env.example` and `.gitignore` updates.
- Cancellable backend operations, bounded output, masked known values, metadata-only recovery records, exit/wait choice and runtime reconciliation.

## Executed checks

- `npm test`: 142 passed at the integration checkpoint.
- `npm run build`: passed; existing large-chunk advisory remains.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 106 passed, 8 explicitly ignored integration tests.
- Browser checks use real React UI and mocked native IPC where required. They do not establish that the full installed desktop application's native dialogs were exercised.
- Small-window checks cover 960×640, Korean/English and light/dark, including keyboard activation of component addition.

## Real Docker verification

Environment: local `desktop-linux`, Docker Engine 29.8.2, Compose 5.5.1.

Command:

```text
cargo test --manifest-path src-tauri/Cargo.toml docker::builder::tests::native_review_run_recreate_and_data_retention -- --ignored --nocapture
```

Passed twice, including the normalized-model execution path. It creates a UUID-scoped `woojoo-builder-test-*` project and checks:

1. A changed `.env` invalidates the earlier review.
2. Execution consumes the reviewed model even if the original YAML is modified afterward.
3. Redis starts and becomes healthy.
4. A stored key survives service recreation.
5. A second service reaches Redis using service DNS and startup dependency.
6. An intentionally failed service is detected and can be corrected and restarted.
7. Only the test project's containers/network/volume are removed afterward.

No test project containers remained after cleanup. The downloaded Redis image is retained as a reusable local cache.

## Boundaries shown in the product

- Static/config validation does not prove image existence, application variable consumption, reachability or readiness.
- Imported multi-file effective views are read-only; edit the original file tabs.
- Unclassified environment values, commands, build arguments and unsaved raw YAML are excluded from automatic restoration.
- Imported raw files remain in their original locations. Explicit source saves may contain plaintext secrets.
- Build contexts and bind/config/secret file contents remain external inputs; the application does not freeze the full build tree.
- Cancellation stops owned CLI processes. Docker daemon work may continue; the result is marked unknown and reconciled, not automatically replayed.
- Elasticsearch's pinned compatibility template is explicitly labeled unmaintained and does not disable authentication/TLS.

![Redis draft](redis-draft.png)
