# PRD: Architecture Hardening — Typed IPC, Error Model, and Boilerplate Consolidation

**Status:** Draft
**Owner:** Matija Munjaković
**Date:** 2026-06-06
**Target:** Esploro (Tauri 2 + React/TS Postgres/MySQL client)

---

## 1. Context & Motivation

Esploro is architecturally sound. A full review of `src-tauri/` (~5.7k LOC Rust, 45 Tauri
commands) and `src/` (~14k LOC React/TS) confirms it already follows the patterns mature
Tauri 2 apps converge on:

- Backend organized **by feature/domain** (`commands/{connections,schema,roles,data,
  license,saved_queries,updater}`) with a clean **thin-command → business-logic → driver**
  layering.
- `tauri::State` + `Mutex<HashMap<session_id, SessionInfo>>` with `Arc`-wrapped pools — the
  canonical shared-state model.
- Frontend **feature-folder vertical slices** (`features/<x>/{api,types,components}`) with
  all `invoke` calls centralized in per-feature `api.ts`.
- **Zustand** (UI state) + **TanStack Query** (server/DB state) — the correct modern split.
- Virtualized grids, strict TypeScript, OS-keychain secrets, atomic license writes,
  one-shot connection-error retry. Solid production details.

Against current best practice there are **two real gaps** plus three pieces of housekeeping.
This PRD specifies fixing them. Doing so removes the codebase's main latent-bug surfaces
(runtime FE/BE type drift and error-handling by string-matching) while it's still cheap —
at ~45 commands, retrofitting later is materially harder.

This PRD does **not** propose changing the app's behavior, feature set, or UX. It is a
structural hardening effort; every change must be behavior-preserving.

---

## 2. Goals

1. **End-to-end type safety across the IPC boundary** — Rust DTOs are the single source of
   truth; TypeScript types are generated, not hand-maintained.
2. **A real error model** — commands return a structured, tagged error type the frontend
   can branch on by kind, eliminating string-matching of error semantics.
3. **Single-sourced session/pool/retry boilerplate** — one helper, not ~6 copies.
4. **Reduced cognitive load** in the few oversized modules/components.
5. **Field-debuggable logging.**

### Non-goals

- No ORM or query-builder library. Raw SQL + identifier validation + parameterized queries
  is correct for a DB *client*.
- No client-side router. Tab-based app-shell navigation stays.
- No unpinning of dependency versions (`=x.y.z` is a deliberate reproducibility choice).
- No form library.
- No new product features.

---

## 3. Current-State Reference (key files)

| Area | Files |
|---|---|
| State / entry | `src-tauri/src/lib.rs` (AppState, 45-command handler) |
| Command dispatch | `src-tauri/src/commands/*.rs`, `commands/data/*` |
| Error grepping (to remove) | `commands/data.rs:98-107` (`is_pg_connection_err`) |
| FE IPC clients | `src/features/*/api.ts` |
| FE hand-mirrored types | `src/features/*/types.ts` |
| FE retry / error matching | `src/lib/sessionRetry.ts` |
| FE state | `src/store/index.ts` (Zustand), TanStack Query usage in features |

---

## 4. Requirements

### P1 — Typed IPC boundary (`tauri-specta`)

> **Status: in progress (data slice).** Added the locked P1 dependencies
> (`specta`, `tauri-specta`, `specta-typescript`) and enabled Tauri's
> `specta` feature. The data/table-viewer command DTO surface now derives
> `specta::Type` (including the structured `AppError` wire shape and
> `CellValue` JSON payload override), the seven data commands are annotated
> with `#[specta::specta]`, and a debug/test exporter writes
> `src/lib/bindings.ts`. `src/features/table-viewer/api.ts` now calls the
> generated `commands.*` wrappers instead of raw `invoke("<data command>")`,
> while preserving `IpcError` normalization for retry/toast behavior.
> `src/features/table-viewer/types.ts` re-exports generated data DTOs and keeps
> only UI-local helper types/functions. Runtime command dispatch remains on the
> existing Tauri `generate_handler!` until every command is registered with the
> Specta builder; otherwise un-migrated commands would be dropped. Verified:
> `cargo test` (50 pass, using a project-local `CARGO_HOME` because the global
> cargo registry is read-only), `cargo clippy`, `tsc --noEmit`, and `eslint`
> clean apart from the pre-existing `SchemaTree.tsx` hook warning.
>
> **Query-editor/saved-queries slice complete.** `SavedQuery` now derives
> `specta::Type`, the four saved-query commands are annotated and registered
> with the debug/test Specta builder, and regenerated bindings include
> `saveQuery`, `listSavedQueries`, `getSavedQuery`, and `deleteSavedQuery`.
> `src/features/query-editor/api.ts` now calls generated wrappers for
> `executeSql` and saved-query operations while preserving `IpcError`
> normalization; `query-editor/types.ts` re-exports generated `QueryResult`,
> `QueryError`, `ResultColumn`, and `SavedQuery`. Verified: `cargo test` (50
> pass), `cargo clippy`, `tsc --noEmit`, and `eslint` clean apart from the
> pre-existing `SchemaTree.tsx` hook warning.
>
> **Schema slice complete.** `TableSummary`, `FunctionSummary`,
> `SchemaObjects`, and `ColumnDef` now derive `specta::Type`, the three schema
> commands are annotated and registered with the debug/test Specta builder, and
> regenerated bindings include `listSchemas`, `listObjects`, and `listColumns`.
> `src/features/schema/api.ts` now calls generated wrappers while preserving
> `IpcError` normalization; `schema/types.ts` re-exports generated schema DTOs
> and keeps only UI-local tree types/helpers. Verified: `cargo test` (50 pass),
> `cargo clippy`, `tsc --noEmit`, and `eslint` clean apart from the pre-existing
> `SchemaTree.tsx` hook warning.
>
> **Connections slice complete.** `DbDriver`, `SslMode`, `ConnectionProfile`,
> and `ConnectionInput` now derive `specta::Type`, the seven connection commands
> are annotated and registered with the debug/test Specta builder, and regenerated
> bindings include `listConnections`, `createConnection`, `updateConnection`,
> `deleteConnection`, `testConnection`, `connect`, and `disconnect`.
> `src/features/connections/api.ts` now calls generated wrappers while preserving
> `IpcError` normalization; `connections/types.ts` re-exports generated
> connection DTOs and keeps only local color constants. Nullable connection
> fields are now sent as explicit `null` at the frontend boundary. Verified:
> `cargo test` (50 pass), `cargo clippy`, `tsc --noEmit`, and `eslint` clean
> apart from the pre-existing `SchemaTree.tsx` hook warning.

**Problem.** Rust structs (`TableQueryRequest`, `CellValue`, `ResultColumn`,
`UpdateRowsRequest`, …) are hand-mirrored in `src/features/*/types.ts`. Nothing enforces
sync; a Rust field rename breaks the frontend at runtime, not compile time.

**Requirements.**
- R1.1 Add `specta` + `tauri-specta` to `src-tauri/Cargo.toml`.
- R1.2 Derive `specta::Type` on every DTO crossing the boundary (they already derive
  `Serialize`/`Deserialize`). Preserve existing `#[serde(rename_all = "camelCase")]`.
- R1.3 Register commands through the specta builder so it can emit both types and a typed
  command wrapper.
- R1.4 Export `bindings.ts` (to `src/lib/bindings.ts`) on debug build / build script.
  Commit the generated file and document the regeneration step.
- R1.5 Migrate per-feature `api.ts` to call the generated typed commands instead of
  stringly-typed `invoke("...", {...})`. Migrate **`data` first** (hottest, most complex
  DTO surface), then roll outward feature-by-feature.
- R1.6 Delete the now-redundant hand-written interfaces in `features/*/types.ts` as each
  feature migrates; let `tsc` surface every drift (that compile-time failure list is the
  payoff).

**Acceptance.** `cargo build` regenerates `bindings.ts`; `tsc -b` passes using generated
types; no remaining hand-mirrored DTO interfaces for migrated features; no raw
`invoke("<data command>")` calls remain in `data`'s `api.ts`.

> Alternative considered: `taurpc` (fuller RPC layer). Rejected as the default because it
> reshapes the existing clean `api.ts` pattern more than needed; `tauri-specta` is the
> lighter fit. Revisit only if a typed event bus becomes a priority.

### P2 — Structured error type (`thiserror`) ✅ Done

> **Status: complete (Phase 1).** `AppError` lives in `src-tauri/src/error.rs`
> (internally-tagged `{ kind, message, code, position }` serialization, `From`
> impls for the PG/MySQL/IO/keyring/tauri/updater error types, and
> `is_retryable()`/`context()`). All `#[tauri::command]` signatures now return
> `Result<_, AppError>`; `is_pg_connection_err` is deleted and the `data`
> command retries branch on `AppError::is_retryable()`. Pure SQL-builder and
> identifier-validator helpers intentionally keep `Result<_, String>` —
> command-level callers convert via `From<String>` → `AppError::Internal`, and
> per-row error fields (`DeleteRowResult.error`, `PrivilegeResult.error`) remain
> `Option<String>`. Frontend: `src/lib/ipc.ts` wraps `invoke`, normalizing the
> serialized error into an `IpcError` (carries `.kind`/`.code`, keeps a readable
> `.message`); `sessionRetry.ts` branches on `kind === "SessionNotFound"` via
> `isSessionNotFound`. Verified: `cargo test` (49 pass), `cargo clippy`,
> `tsc -b`, `eslint` all clean.

**Problem.** Every command returns `Result<T, String>` via `.map_err(|e| e.to_string())`.
The frontend cannot distinguish error classes except by substring matching — already done
fragilely in `is_pg_connection_err` (greps `"broken pipe"`, `"connection closed"`, SQLSTATE
codes) and `sessionRetry.ts` (matches `"Session not found"`). String-matching error
semantics is a latent bug source.

**Requirements.**
- R2.1 Add `thiserror`. Define `AppError` (suggested: `src-tauri/src/error.rs`) with
  variants at least: `SessionNotFound`, `Connection`, `Sql { code: Option<String>,
  position: Option<u32>, message: String }`, `Validation(String)`, `License(String)`,
  `Io(String)`, `Internal(String)`.
- R2.2 Implement `Serialize` for `AppError` as an **internally-tagged enum**
  (`{ "kind": "...", ... }`) and derive `specta::Type` so P1 exports it too.
- R2.3 Migrate command signatures from `Result<T, String>` to `Result<T, AppError>`.
  Provide `From` impls for `tokio_postgres::Error`, `mysql_async::Error`, `std::io::Error`,
  keyring errors, etc., so existing `?`/`map_err` sites convert cleanly.
- R2.4 Move connection-error detection into the type: a `AppError::is_retryable()` /
  classification on the `Sql`/`Connection` variant, replacing the string-grep
  `is_pg_connection_err`.
- R2.5 Frontend: replace substring checks in `sessionRetry.ts` (and anywhere else) with
  `error.kind === "SessionNotFound"` etc., using the generated error type.

**Acceptance.** No command returns `Result<_, String>`; `is_pg_connection_err` string-grep
removed; `sessionRetry.ts` branches on `kind`; `cargo test` (existing 43 unit tests) and
`cargo clippy` clean; manual: a syntax-error query and a mid-session server restart both
surface the correct `kind` to the UI.

**Sequencing note:** Do **P2 before P1** — the error type should be defined before specta
export so bindings include it from the start, and removing string-matching first
simplifies the P1 migration.

### P3 — Consolidate session/pool/retry boilerplate ✅ Done

> **Status: complete (Phase 3).** Added `with_pool(state, &session_id, on_pg,
> on_mysql)` plus a small `lock_pool` helper in `commands/data.rs`. `with_pool`
> encapsulates lock → `resolve_pool` → drop-lock, then dispatches to the
> driver closure, retrying the PG closure **once** on a retryable `AppError`
> (`is_retryable()`). The five retry commands (`query_table_data`,
> `query_table_count`, `update_rows`, `delete_rows`, `execute_sql`) now call
> `with_pool`; the two preview commands (no retry) use `lock_pool`. The ~6
> duplicated lock/resolve/retry blocks collapsed to single-line helper calls
> (net −76/+70 lines, all in `data.rs`). `roles.rs`/`schema.rs` intentionally
> untouched — they hold the lock across the query and have no retry, so they
> are *not* structurally identical. Behavior-preserving: identical retry policy
> and error surface. Verified: `cargo test` (49 pass), `cargo clippy`,
> `tsc -b` all clean.

**Problem.** Nearly every command repeats: lock `state.sessions` → look up session →
`resolve_pool` → `match handle { Pg => inline one-shot retry, Mysql => ... }`. The PG retry
is re-implemented inline at `data.rs:225, 248, 273, 320, 392` and similarly elsewhere.

**Requirements.**
- R3.1 Add a helper, e.g. `with_pool(state, &session_id, |pool: PoolHandle| async { ... })`,
  encapsulating: lock → resolve → for PG, run the closure and retry once on a retryable
  `AppError` (depends on P2's classification).
- R3.2 Refactor the `data` commands (and any structurally identical commands) to use it,
  removing the duplicated blocks.
- R3.3 Behavior-preserving: retry policy and error surface must be identical to today.

**Acceptance.** The ~6 duplicated lock/resolve/retry blocks collapse to single-line helper
calls; `cargo test` passes; manual smoke of query/update/delete with a server restart
mid-session still reconnects.

### P4 — Split oversized modules/components (opportunistic)

**Problem.** A few files are at the size where navigation/testing degrade. They are
*justified by complexity* and already extract sub-components — not god objects — so this is
refinement, not rescue.

- Backend: `roles.rs` (866), `license.rs` (641), `row_mutations.rs` (586).
- Frontend: `TableViewerTab.tsx` (1,727), `SchemaTree.tsx` (1,347), `RoleDetailPanel.tsx`
  (1,116).

**Requirements.**
- R4.1 Split `license.rs` along its three concerns: license domain logic / UI preferences /
  external (Dodo) API + background task. ✅ **Done.** UI preferences already lived in
  `license/ui_preferences.rs`; the Dodo external API (`DodoError`, `call_dodo_validate`,
  error-message helpers) plus the background re-validation task
  (`revalidate_license_background`) were extracted to `license/dodo.rs` (re-exported from the
  module root so `commands::license::revalidate_license_background` is unchanged). `license.rs`
  now holds only license-domain logic: types, keychain/prefs plumbing, status computation, and
  the thin Tauri commands (640 → 470 lines). Child module reads parent-private keychain helpers
  via `super::`; no visibility widening. Behavior-preserving. Verified: `cargo test` (49 pass),
  `cargo clippy`, `tsc -b` clean.
- R4.2 Continue the table-viewer extraction trend already in recent commits (footer,
  popovers, privileges sub-tab were just pulled out). Extract further only where cohesion is
  genuinely separable; do not force splits that fragment tightly-coupled logic. ◐ **In
  progress.** Pulled the three self-contained presentational sub-components out of
  `TableViewerTab.tsx` into their own files: `SkeletonGrid.tsx`, `RefreshButton.tsx`,
  `ColumnHeaderCell.tsx` (each has explicit props and zero coupling to the parent's state).
  `TableViewerTab.tsx`: 1,727 → 1,518 lines. The inline-editing state cluster
  (`pendingEdits`/`editingCell`/save/delete/`buildRowChanges`) was intentionally left in
  place — it is tightly coupled to `data`/`columns`/`rows`/`ctx`/`ctids`/query `refetch`, so
  extracting it would fragment cohesive logic (the case R4.2 warns against). Behavior-
  preserving. Verified: `cargo test` (49 pass), `tsc -b`, `eslint` clean.

**Acceptance.** No behavior change; `cargo test` + `tsc -b` pass; each split module/file has
a single clear responsibility.

### P5 — Structured logging (optional)

**Problem.** Logging is `eprintln!` only; no leveled/structured logs. (Test coverage is
otherwise good: 43 unit tests.)

**Requirements.**
- R5.1 Add `tauri-plugin-log` (or `tracing` + subscriber). Replace ad-hoc `eprintln!` at
  session lifecycle points with leveled logs.
- R5.2 Keep log volume low by default; no secrets in logs (passwords already live in
  keychain — verify none leak via connection-profile logging).

**Acceptance.** Logs are leveled and structured; a release build produces a usable log
trail for field debugging; no secret material in output.

---

## 5. Phasing

| Phase | Scope | Depends on |
|---|---|---|
| 1 ✅ | **P2** — `AppError` + migrate command signatures + remove string-grep | — |
| 2 ◐ | **P1** — `tauri-specta`, export bindings, migrate `data` ✅, `query-editor`/saved queries ✅, `schema` ✅, `connections` ✅, then roles/license/updater/settings | P2 |
| 3 ✅ | **P3** — `with_pool` helper, collapse duplication | P2 |
| 4 ◐ | **P4** — split `license.rs` ✅; continue table-viewer extraction (R4.2) pending | — |
| 5 | **P5** — structured logging | — |

> **P1 sequencing note.** The global cargo registry is still read-only in this
> dev environment, but P1 can be verified by setting `CARGO_HOME` to a writable
> project-local or temporary path. The compatible pins are now in
> `src-tauri/Cargo.toml`/`Cargo.lock`: `specta = "=2.0.0-rc.25"` (features
> `derive`, `serde_json`), `tauri-specta = "=2.0.0-rc.25"` (features `derive`,
> `typescript`), `specta-typescript = "=0.0.12"`, and Tauri's `specta` feature.
> Continue P1 feature-by-feature after the completed `data` slice.

P1+P2 are the meaningful architectural upgrade; P3–P5 are polish and can land independently.

---

## 6. Success Criteria

- Zero hand-maintained FE/BE DTO type definitions for migrated features.
- Zero `Result<_, String>` command signatures; zero error-semantics string-matching in
  Rust or TS.
- Duplicated session/pool/retry blocks reduced to a single helper.
- `cargo test`, `cargo clippy`, `tsc -b`, `eslint` all clean throughout.
- No behavioral or UX change observable to a user (this is structural hardening).

## 7. Verification

- **P2:** `cargo test` (43 tests pass), `cargo clippy` clean. Trigger a bad-syntax query and
  a dropped connection from the UI; confirm the frontend branches on `error.kind`.
- **P1:** `cargo build` regenerates `bindings.ts`; `tsc -b` passes with generated types;
  deleting hand-written interfaces produces no remaining type errors after migration.
- **P3:** `cargo test` + manual smoke of query/update/delete with a server restart
  mid-session (reconnect must still work).
- **P4:** `cargo test` + `tsc -b`; visual smoke of table viewer and roles panel.
- **P5:** inspect logs from a release build during a connect → query → disconnect cycle;
  confirm leveled output and no secrets.

## 8. Risks & Mitigations

- **Large mechanical migration (P1/P2) touches many files.** Mitigate by migrating
  feature-by-feature behind a passing `tsc`/`cargo test` at each step; `data` first.
- **specta version compatibility with Tauri 2.11 / pinned deps.** Verify exact compatible
  versions before pinning; keep the `=` pinning convention.
- **Behavior drift in retry consolidation (P3).** Mitigate with the mid-session
  server-restart smoke test as a regression gate.

## 9. References

- [Calling Rust from the Frontend — Tauri v2](https://v2.tauri.app/develop/calling-rust/)
- [Tauri error-handling discussion #5008](https://github.com/orgs/tauri-apps/discussions/5008)
- [Rust error handling in Tauri commands — the pattern that works](https://dev.to/hiyoyok/rust-error-handling-in-tauri-commands-the-pattern-that-actually-works-35le)
- [tauri-specta — typesafe Tauri commands](https://github.com/specta-rs/tauri-specta)
- [TauRPC — typed IPC layer](https://lib.rs/crates/taurpc)
- [Tauri best practices / coding standards](https://www.projectrules.ai/rules/tauri)
