# Compose management implementation plan

**Goal:** Import existing Compose projects, create them with a wizard, edit source with preview, and manage project/service/resource lifecycle in Woojoo.

**Architecture:** Existing React/Tauri Docker workspace, Docker Compose CLI as the configuration authority, explicit context/project/file/directory for every command. Registered paths are saved in app data; source and resolved environment values are not persisted there. User approved proceeding through the proposed workflow in chat.

**Constraints:** Preserve original directory and .env semantics. No daemon installation or data migration. No forced resource deletion, implicit volume removal, or global context switching. Editing Compose-managed containers updates the source of truth. Independent containers support lifecycle/deletion; immutable container settings require recreation through Compose.

- [x] Rust Compose file picker, registry, read/edit conflict detection, validation preview and guarded lifecycle commands.
- [x] Wizard generator, import/edit UI, service relationship preview and registered project controls.
- [x] Graph resource deletion and Compose editing entry points; independent container rename.
- [x] Regression tests for source preservation, quoting, stale previews, command scope, and user flows; production build and Rust checks.

Review focus: ambient COMPOSE variables, external file edits, failed apply after successful save, missing files/engines, profile services, anonymous volumes, remote contexts, secrets in config output. Compose validation is not a health check; execution remains user-triggered. Import references one chosen file; multi-file projects can be imported through a consolidated Compose file. Preserve arbitrary source YAML when editing, rather than round-tripping it through the wizard.

## Verification and review ledger

- Implementation uses existing React/Tauri dependencies. Wizard writes YAML-compatible JSON rather than implementing a partial YAML serializer. Imported source retains arbitrary YAML/comments.
- Unit regression initially failed on dollar replacement semantics; callback replacement preserves literal dollar values. Duplicate template services use separate named volumes and avoid duplicate default ports.
- Installed Compose CLI integration validates relative env_file, .env interpolation, bind paths, profile service catalog and temporary-file cleanup without daemon mutations.
- Full verification: npm test 62 passed; cargo test 56 passed / 5 environment-dependent ignored; Docker Playwright 17 passed; production build passed (existing chunk-size warning).
- Fresh final review by compose_review found four important issues; all addressed: explicit --remove-orphans=false plus operational environment pins; full profile catalog using --profile '*'; source reread immediately after async validation and before spawn; unlink controls independent of successful source reads. Orphan flags, profile catalog and missing-file unlink regressions observed failing then passing. Source guard tested against replaced content.
- Ruling: operational COMPOSE_PROFILES is empty for project-wide actions; explicitly targeted services activate their own profiles. Full configuration preview includes profiles and labels them.
- Ruling: no live daemon mutation tests on user's resources. Remote bind behavior and anonymous-volume reconnection follow Docker semantics and are explained in UI/docs. Docker command timeout reports unknown outcome, not cancellation; process-tree cancellation for long builds is not claimed. Successful previews exclude environment values; CLI error diagnostics are displayed only in the error UI and may include configuration text, never stored in the project registry.
- Ruling: guarded source rereads catch edits during async validation; this does not provide a cross-process transaction over external Compose dependencies. A narrow external edit race after the final check remains possible, as with CLI execution from a concurrently edited folder.
- Existing unrelated edits in App.tsx, package.json, structure/table-view tests and research screenshot are preserved.

- Final mount preview regression verifies bind-vs-volume classification and a shared named volume across different container paths; targeted Compose tests and final production build passed after this correction.
