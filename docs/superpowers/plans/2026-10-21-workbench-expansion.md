# Database workbench expansion implementation plan

> For agentic workers: use superpowers:subagent-driven-development for independently owned tasks and integration reviews.

Goal: Implement the user-selected connection persistence, SQL files, workspace restore, connection organization and the data/SQL/structure/transfer feature groups from the prior numbered comparison. Additional database: SQLite, selected explicitly by user.
Architecture: Keep React/shadcn and Tauri/Rust. Dedicated modules expose composable workbench tools; native adapters enforce connection, transaction and read-only semantics. Persist profiles and editor state without passwords or result rows. Keep demo usable and truthful.
Tech stack: existing React 19, TypeScript, Tauri 2, SQLx, CodeMirror, shadcn/Radix.
Spec: User selected items 1,2,3,6 and 7–29, with item29 narrowed to SQLite.

Global constraints: preserve existing uncommitted shadcn and AWS work; no database writes during verification on user databases; no push or commit requested; Korean and English labels; real actions rather than placeholder buttons. Existing DBs PostgreSQL/MySQL/MariaDB, add SQLite. Do not silently discard pending edits. SQL files and credentials are user data; persist passwords only if OS-backed secure storage is implemented, otherwise do not persist.

Review focus: restoration must not reuse dead native session IDs; read-only guards must cover DDL/import/SQL/data edits; cancellation must reach DB server; CSV parser must handle quoted newlines and null/default distinction; transaction rollback and failed execution must preserve accurate state.

- [x] Task 1 — Native sessions and SQLite (backend worker): db.rs/structure.rs/new native modules. Add SQLite to every DB match, persistent execution contexts, commit/rollback/cancel, multi-statement support helpers, metadata/DDL/object APIs. Tests: SQL identifier and parser safety; disposable SQLite roundtrip; no user DB writes.
- [x] Task 2 — SQL tools (SQL worker): standalone QueryTools + sql-workbench helpers + native files module. SQL open/save/save-as, formatting, bound parameters, scripts/multiple results, explain and searchable persistent execution history. Integrates through callbacks so root retains tab ownership. Tests: script splitting, parameter literals, file cancellation and errors, script result handling.
- [x] Task 3 — Data tools (data worker): standalone DataWorkbench + data native module where needed. Server paging/filter/order, insert/duplicate/delete, multi-cell paste, column configuration/record/value viewer, FK navigation, CSV import and JSON/SQL/full-result export, table copy. Tests: quoted CSV, identifiers, draft preservation, paging and edits.
- [x] Task 4 — Saved profiles/workspace (root): profile CRUD/groups/environments/read-only, reconnect with password prompt, SQLite file path, durable tabs/SQL/history without result data, close/delete behavior and SQL tab file metadata.
- [x] Task 5 — Structure/maintenance integration (root with backend interfaces): indexes/FK/unique/check/PK operations and full DDL, view/function/procedure/trigger explorer/editor, backup/restore native tooling. Tests: preview before mutation, unsupported DB operations explicit.
- [x] Task 6 — Integration and review: connect standalone workbenches, all i18n, meaningful tests, screenshots both themes, native build. Record limitations precisely; do not claim unimplemented items complete.

Ruling: use current checkout on a new codex branch to preserve existing uncommitted user work. Existing original connection UI behaviors and test labels remain compatible. Agent ownership excludes App.tsx/model.ts/api.ts/main.rs/package manifests unless coordinated; root integrates shared files.

Validation: 30 Vitest + 50 Playwright + 18 Rust tests passed, 2 external-service native tests intentionally ignored. Temporary SQLite used for writes. Windows release build passed. Packaged releases/Woojoo-0.1.0-windows-x64-workbench.exe (15,917,568 bytes); source and packaged SHA256 match: A33597D4843573C1B13A8D32E4A6096C137136DB2309CF950C5CA17C5B68A5D9.

Supported scope and limits recorded in README: grid/DDL transactions separate from SQL session; single-column FK picker; 10k CSV import / 100k copy; copy/export no cross-page snapshot; SQLite rebuild-required structure edits explicit; PG DDL reconstruction excludes dependent objects; native maintenance requires installed vendor tools (SQLite backup built in). SQL file grants are renewed by destination dialog after restart.


Final review fixes: guarded reconnect/SQL execution/new-tab navigation against pending data edits; schema-qualified SQL provenance only; CHECK preview and MySQL DROP syntax; explicit MySQL object-script adapter with read-only/CREATE policy and conservative transaction-state tracking. Full final UI suite passed 50 tests.
