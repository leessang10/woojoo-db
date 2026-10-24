# Windows Docker disk reclaim

User requested reclaiming host disk space after Docker resources have been removed. Extend the existing Docker workspace with a local Windows maintenance dialog.

## Design and implementation

- [x] Discover conventional Docker WSL data VHDX paths, allow explicit custom VHDX selection, and show file length versus allocated host bytes.
- [x] Native Windows CompactVirtualDisk helper in the same executable, elevated with ShellExecuteExW runas. No command shell, DiskPart scripts, Hyper-V module dependency, resource prune or zero-fill.
- [x] Require detached disk, validate VHDX header and canonical path, compare file identity/size reviewed by UI, recheck in elevated helper; refuse attached/locked disks. Compact only, never resize the guest filesystem or delete resources.
- [x] Explicit confirmed Desktop stop command, separate confirmed compact action, show before/after allocated bytes, distinguish zero reclaimed from failure, permit manual engine restart afterward.
- [x] Block app close while maintenance is active; prevent competing Woojoo engine/resource commands. Do not kill a compaction helper on timeout or automatically stop all WSL distributions.
- [x] Unit and UI tests; compile native helper without running it on the user's real disk. Inspect documentation and preview UI.

Rulings: synchronous Windows compaction runs in a dedicated elevated process and cannot be canceled from the UI; status is indeterminate rather than a fabricated percentage. Without prior guest TRIM, not all deleted blocks are reclaimable; report measured results and never promise a specific saving. Docker stop does not forcibly terminate unrelated WSL distributions. If the disk remains attached, explain that the user must close the owning environment. Other Windows UAC credentials may not have access to the selected file; surface the OS error.

References: Microsoft CompactVirtualDisk and compact vdisk documentation; Docker Desktop backup documentation (current WSL data location).


## Verification ledger

- npm test: 64 passed. cargo test: 63 passed / 6 opt-in integration tests ignored. Docker Playwright: 23 passed. npm run build passed, existing bundle-size warning only.
- Explicit native integration: created an isolated disposable 64 MiB VHDX using CreateVirtualDisk, executed the same helper compaction code, verified its header remained valid, and removed the test file. Passed both before and after file-pinning fix. No UAC elevation was needed for this disposable owned-file integration; the production UI uses a dedicated runas helper for deployment permissions.
- Native entry/UAC transport compiles; UI tests cover cancellation, locked disks, selected token/context, remote rejection, independent stop confirmation, measured allocation and zero-byte results. Actual UAC credential switching and the user's running Docker disk were not exercised.
- Fresh read-only review by storage_review found two important races. Fixed with a shared read/write admission gate held across CLI/Compose execution (maintenance drains queued/running operations and rejects new ones), and a non-delete-sharing file handle held through native open/compaction with identity revalidation. Regression tests were added, initially failed to compile before implementation, then passed; disposable native test passed with the pin held.
- Ruling on declined runtime cases: supported native API path verified on disposable disk; real attached/user disk rejection and UAC credential switching remain integration limitations, with exclusive-open and native attachment checks failing closed. fstrim availability/mount layout varies with Docker Desktop; failures are shown and compaction remains a separate optional operation. No test stopped Docker, ran TRIM on user storage, or compacted user data.
- Windows path allocation uses GetCompressedFileSizeW. Tokens include canonical path, volume/file identity, length and modification time. Disk header is validated in the parent and again by the elevated helper. No resource prune or zero-fill occurs.
- Unrelated user edits remain untouched. Screenshot inspected in dark theme; full modal fits within viewport and scrolls normally.
