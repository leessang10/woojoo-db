# Native Redis backend implementation report

Date: 2026-10-25. Scope: implementation plan Task 1. Changes remain uncommitted.

## Implemented

- Independent `src-tauri/src/redis` module, exact camelCase IPC DTOs and all requested command exports. Controller owns `main.rs` registration.
- State initialization: `redis::State::new(app_data_dir.join("redis-workspace-v1.json"))?`. Shutdown: `state.shutdown().await`.
- Bounded RESP2 transport implemented directly over Tokio sockets. redis-rs was not added because receive allocation limits must be enforced before allocating a bulk response.
- Verified TLS through tokio-rustls with ring and public WebPKI roots. Certificate/hostname failure returns TLS_FAILED; there is no plaintext fallback. Existing locked TLS versions are reused (`tokio-rustls` 0.26.6, `rustls` 0.23.46, `webpki-roots` 1.0.10).
- Fixed profile/DB sessions. Each operation owns its socket, authenticates, and selects its fixed DB once; no concurrent shared SELECT state. DB 0 permits ACL-denied SELECT because a fresh Redis socket starts in DB 0. Other DB selection failures fail the operation.
- INFO cluster detection and internal fixed CLUSTER INFO fallback reject detected Cluster endpoints. Sentinel and old Redis versions are rejected when server metadata is available. If both topology probes are ACL-denied, readable keys remain available and Scan returns `topologyVerified:false`; UI must label endpoint scope unverified.
- Explicit read allowlist, six type readers, original binary key bytes, decimal string integers/IDs, SCAN COUNT 200, metadata pipelining in batches of 50, optional metadata ACL degradation, INFO/DBSIZE and nonconsuming XINFO/XPENDING queue observation.
- Hash/Set compact scan responses retain bounded leftover rows behind opaque cursors. List/Zset/Stream pages stop at the actual 64 KiB raw-byte budget and continue immediately after the last displayed index/ID. String fragments remain marked truncated, including the final fragment.
- Opaque cursors bind session, query generation, key, pattern and type. Repeated refresh reuses matching tokens. Cursor storage uses generation pruning, bounded LRU eviction and a maximum generation watermark so late old responses cannot evict newer pages.
- Versioned Redis-only profile/view persistence, checked load size, bounded profile/view counts, atomic replacement with flushed temporary files. No values, queue payloads or passwords are persisted in this file.
- Credential namespace `Woojoo/Redis/{id}`; existing `Woojoo/Database/{id}` unchanged. Host/port/user/DB/TLS identity binding, explicit forget, memory-only caching without deleting an existing remembered vault entry, revision checks against late credential recreation. Password/request buffers zeroize on cancellation/drop.
- Cancellation and disconnect drop operation sockets and remove active requests. Shutdown blocks new connections and prevents in-flight connection resurrection. Profile deletion closes its sessions and removes namespaced credentials.

## Bounds

- Per bulk: 65,536 bytes, checked from header before body allocation.
- Per RESP response: 1 MiB cumulative allocation/read budget, maximum 8,192 array children, 16 nesting levels and 4 KiB protocol lines.
- Per detail page: 100 rows and 64 KiB decoded payload. One oversized item produces TOO_LARGE.
- Per serialized IPC response: 2 MiB. Request/credential lengths and persisted workspace size are bounded.
- Per session: 128 cursor entries and at most four buffered RESP pages (each received under the 1 MiB parser budget); LRU eviction returns INVALID_CURSOR for an evicted page.
- At most 16 sessions, 16 concurrent reads, eight concurrent connection attempts. Connection deadline five seconds; total read deadline ten seconds.
- SCAN issuance stops after ten iterations or the one-second iteration budget; metadata for an already received page is completed under the total read deadline. The frontend owns the 10,000-key/32-MiB retained index cap.

## Verification actually run

Initial protocol allocation, read-only dispatch and profile validation tests were run red before implementation: four failed for the expected missing behavior. Subsequent metadata pipeline, compact hash pagination, TTL distinction, cursor refresh exhaustion, byte-budget range paging, topology and late-generation race regressions were also observed red and then green.

Final command: `cargo test --manifest-path src-tauri/Cargo.toml --no-fail-fast`.

Result: **95 passed, 0 failed, 6 ignored** (101 tests total), including **29 Redis tests** and two new credential namespace/vault tests. Ignored tests are the existing AWS discovery/resources, disposable SQL Docker fixture, two authorized RDS tests and privileged disposable VHDX fixture.

Redis coverage includes real loopback TCP protocol fixtures for all six types, non-UTF-8 original keys, large string integers/stream IDs, metadata ACL denial with readable values, queue command trace without consuming commands, fixed DB socket isolation, oversized bulk headers with no body, compact 125-field hash pagination, 100 x 1-KiB List/Zset/Stream pagination, exact 65,536-byte Set member with base64 padding, topology states, cancellation, a real ten-second read timeout, authentication sanitization and TLS failure without fallback. Additional tests cover cumulative small-value allocation, nesting bounds, persisted workspace roundtrip/cascading profile deletion, Windows vault persistence and unchanged Database namespace.

`rustfmt --check --edition 2021 src-tauri/src/redis/mod.rs` and scoped `git diff --check` pass.

## Remaining external validation

A real Redis server was **not** run. `docker info` failed because `dockerDesktopLinuxEngine` was unavailable. WSL inventory contained only Docker Desktop; no general Linux distribution or redis-server executable was available. The user daemon was not started and no user Redis instance was touched.

Consequently Redis 6.2+ wire fixtures, trusted-server TLS success/certificate rejection, actual Redis ACL configuration, queue state invariance on a real server, 100,000-key latency and real-server race behavior still need an isolated server fixture. Socket tests establish emitted read commands and transport/parser behavior, but are not represented as real Redis integration results. Release build and desktop/UI verification are owned by the controller.
