# PRD: macOS Code Signing & Notarization

## Problem Statement

Esploro is currently distributed as an unsigned `.dmg`. On macOS 14+, Gatekeeper blocks unsigned apps with "Apple cannot check it for malicious software" — users must right-click → Open and confirm a warning dialog on first launch. This friction is unacceptable for a paid product. The fix is to sign the app with a Developer ID certificate and submit it to Apple's notary service so Gatekeeper clears it silently on every machine.

You are opening an Apple Developer Program account under **Tandoku d.o.o.** ($99/yr). This PRD covers everything from the moment that account is active to the point where you ship a `.dmg` that opens cleanly on a fresh Mac.

---

## Goals

- Zero Gatekeeper warnings on macOS 13+.
- Signing + notarization runs locally for release builds; eventually automated in CI.
- Secrets never committed to the repository.
- Bundle identifier locked to the canonical reverse-DNS form before v1.0 (changing it after customers have Keychain entries is painful).

---

## Non-Goals

- Mac App Store submission (different certificate type, sandboxing model, review process — separate future PRD if ever).
- Windows or Linux packaging.
- Auto-update machinery (Sparkle or Tauri updater) — out of scope here; notarization is a prerequisite.

---

## Prerequisites

### 1. Apple Developer Program enrollment

1. Enroll at developer.apple.com under the **Tandoku d.o.o.** entity (Organisation account). Individual accounts cannot sell software under a company name.
2. Note your **Team ID** (10-character alphanumeric, shown in Membership Details). You will need it everywhere.
3. Allow 24–48 h for Apple to verify the business entity (D-U-N-S number may be required for LLCs; start the D-U-N-S request early if you don't have one).

### 2. Certificates

In Xcode → Settings → Accounts → Manage Certificates, create:

| Certificate | Purpose |
|---|---|
| **Developer ID Application** | Signs the `.app` bundle and its contents |
| **Developer ID Installer** | Signs `.pkg` installers — only needed if you ever ship a `.pkg`; skip for now |

The Developer ID Application certificate will appear in Keychain Access under "login" as `Developer ID Application: Tandoku d.o.o. (XXXXXXXXXX)`. The `(XXXXXXXXXX)` suffix is your Team ID.

Export the certificate + private key as a `.p12` (password-protected) and store it in 1Password / secure storage. You will need it for CI later.

### 3. App Store Connect API key (for `notarytool`)

`altool` (the old notarization CLI) is removed in Xcode 16. Use `notarytool`, which requires an App Store Connect API key:

1. App Store Connect → Users and Access → Integrations → App Store Connect API.
2. Create a key with **Developer** role. Download the `.p8` file — Apple only shows it once.
3. Note the **Key ID** (10-char) and **Issuer ID** (UUID shown at the top of the page).
4. Store the `.p8` in the same secure location as the `.p12`.

---

## Bundle Identifier

The current identifier is `app.esploro.desktop`. This is the reverse-DNS of `desktop.esploro.app`, which is unusual. Before cutting a signed release, choose a canonical identifier and hard-lock it — once customers have Keychain entries or the app is submitted anywhere, changing it requires a migration.

**Chosen:** `app.esploro` — reverse DNS of `esploro.app` (the app's domain). Already applied in `tauri.conf.json` and `KEYCHAIN_SERVICE`.

Do this change in a single commit before any signed build goes out.

---

## Entitlements

Notarization requires **Hardened Runtime** (`--options runtime` flag on `codesign`). Hardened Runtime blocks certain capabilities by default; you need entitlements to re-enable what the app uses.

Create `src-tauri/entitlements.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- Outbound TCP: postgres connections + Dodo Payments API (via system curl) -->
    <key>com.apple.security.network.client</key>
    <true/>

    <!-- Keychain access: already works under hardened runtime for own app entries;
         no keychain-access-groups entitlement needed unless sharing with other apps -->
</dict>
</plist>
```

**Why only `network.client`:** The app connects outbound to Postgres servers and to `live.dodopayments.com` (via `curl` subprocess). Both are covered by `network.client`. Unix socket connections to a local Postgres instance are also covered. No JIT, no unsigned memory, no DYLD env vars — no additional entitlements needed.

If in testing you see crashes or permission denials in Console.app showing `code signing` or `sandbox`, add the relevant entitlement then. Do not pre-emptively add broad entitlements; Apple's notarization review flags them.

---

## Tauri Configuration Changes

### `src-tauri/tauri.conf.json`

Add a `bundle.macOS` section:

```json
{
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.png", "icons/icon.icns", "icons/icon.ico"],
    "macOS": {
      "signingIdentity": "Developer ID Application: Tandoku d.o.o. (XXXXXXXXXX)",
      "entitlements": "./entitlements.plist",
      "notarizationCredentials": {
        "appleApiKey": "APPLE_API_KEY_PATH",
        "appleApiIssuer": "APPLE_API_ISSUER"
      }
    }
  }
}
```

**Do not commit real values here.** `signingIdentity` is fine to commit (it's not secret). The `notarizationCredentials` block supports reading from environment variables — see the Environment Variables section below.

Tauri 2.x (`tauri-cli` ≥ 2.0) reads `APPLE_API_KEY` (path to `.p8`), `APPLE_API_ISSUER`, and `APPLE_API_KEY_ID` from the environment automatically when `notarizationCredentials` is configured. The JSON block only needs to be present; the actual secrets come from env vars.

Full env vars Tauri uses:

| Env var | Value |
|---|---|
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Tandoku d.o.o. (XXXXXXXXXX)` |
| `APPLE_API_KEY` | Absolute path to the `.p8` file on disk |
| `APPLE_API_KEY_ID` | 10-char Key ID from App Store Connect |
| `APPLE_API_ISSUER` | Issuer UUID from App Store Connect |

Tauri also reads `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` for the older password-based flow — but the API key flow above is preferred (no app-specific password, no 2FA friction in CI).

---

## Local Release Build Workflow

Once the Developer account is active and the certificate is in your login Keychain:

```bash
# Set secrets in your shell session (add to a gitignored .env.local and source it)
export APPLE_SIGNING_IDENTITY="Developer ID Application: Tandoku d.o.o. (XXXXXXXXXX)"
export APPLE_API_KEY="$HOME/.private_keys/AuthKey_XXXXXXXXXX.p8"
export APPLE_API_KEY_ID="XXXXXXXXXX"
export APPLE_API_ISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# Build, sign, notarize, staple — all in one command
npm run tauri build
```

Tauri's bundler will:
1. Compile the Rust binary in release mode.
2. Bundle the `.app` with your icons and `Info.plist`.
3. Codesign the `.app` and all nested binaries with Hardened Runtime + your entitlements.
4. Wrap it in a `.dmg`.
5. Codesign the `.dmg`.
6. Submit the `.dmg` to Apple's notary service and poll until it passes (typically 1–3 min).
7. Staple the notarization ticket to the `.dmg`.

The final artifact at `target/release/bundle/dmg/Esploro_x.y.z_aarch64.dmg` will open on any Mac without Gatekeeper warnings.

### Verifying locally before distributing

```bash
# Confirm the app is signed
codesign --verify --deep --strict "target/release/bundle/macos/Esploro.app"

# Confirm notarization is stapled
spctl --assess --type execute --verbose "target/release/bundle/macos/Esploro.app"
# Expected: "source=Notarized Developer ID"

# Also check the DMG
spctl --assess --type open --context context:primary-signature "target/release/bundle/dmg/Esploro_*.dmg"
```

---

## CI Workflow (GitHub Actions)

For automated release builds, set the following repository secrets in GitHub → Settings → Secrets:

| Secret name | Value |
|---|---|
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Tandoku d.o.o. (XXXXXXXXXX)` |
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` file (`base64 -i cert.p12 | pbcopy`) |
| `APPLE_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12` |
| `APPLE_API_KEY_ID` | 10-char Key ID |
| `APPLE_API_ISSUER` | Issuer UUID |
| `APPLE_API_KEY` | Contents of the `.p8` file (not base64, raw PEM text) |

Sample workflow step (add to your existing `.github/workflows/release.yml` or create one):

```yaml
- name: Import signing certificate
  run: |
    KEYCHAIN_PATH="$RUNNER_TEMP/build.keychain"
    security create-keychain -p "" "$KEYCHAIN_PATH"
    security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
    security unlock-keychain -p "" "$KEYCHAIN_PATH"
    echo "${{ secrets.APPLE_CERTIFICATE }}" | base64 --decode > /tmp/cert.p12
    security import /tmp/cert.p12 -k "$KEYCHAIN_PATH" -P "${{ secrets.APPLE_CERTIFICATE_PASSWORD }}" -T /usr/bin/codesign
    security set-key-partition-list -S apple-tool:,apple: -s -k "" "$KEYCHAIN_PATH"
    security list-keychain -d user -s "$KEYCHAIN_PATH"

- name: Write App Store Connect API key
  run: |
    mkdir -p ~/.private_keys
    echo "${{ secrets.APPLE_API_KEY }}" > ~/.private_keys/AuthKey_${{ secrets.APPLE_API_KEY_ID }}.p8
    chmod 600 ~/.private_keys/AuthKey_${{ secrets.APPLE_API_KEY_ID }}.p8

- name: Build, sign, notarize
  env:
    APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
    APPLE_API_KEY: ${{ env.HOME }}/.private_keys/AuthKey_${{ secrets.APPLE_API_KEY_ID }}.p8
    APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
    APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
  run: npm run tauri build

- name: Cleanup keychain
  if: always()
  run: security delete-keychain "$RUNNER_TEMP/build.keychain"
```

Use a **macOS runner** (`runs-on: macos-latest`). Notarization must happen on macOS — `notarytool` is a macOS-only CLI.

---

## Implementation Checklist

### Phase 1 — Before Apple account is active
- [ ] Decide on final bundle identifier and make the rename commit (`app.esploro` or `io.tandoku.esploro`)
- [ ] Create `src-tauri/entitlements.plist` with `network.client`
- [ ] Add `bundle.macOS` skeleton to `tauri.conf.json` (no secrets, just the structure)
- [ ] Create `.env.local` (gitignored) for local signing env vars

### Phase 2 — Once Developer account + certificates are ready
- [ ] Install Developer ID Application certificate into login Keychain
- [ ] Download `.p8` API key; store in `~/.private_keys/`
- [ ] Fill in `APPLE_SIGNING_IDENTITY` and API key env vars in `.env.local`
- [ ] Run first signed local build; fix any entitlement or signing errors
- [ ] Run `spctl --assess` checks to confirm notarization is stapled

### Phase 3 — CI setup
- [ ] Add all secrets to GitHub repository settings
- [ ] Create / update `.github/workflows/release.yml` with the signing steps above
- [ ] Test the workflow on a tag push; confirm the `.dmg` artifact passes `spctl`

### Phase 4 — Distribution
- [ ] Upload the notarized `.dmg` to GitHub Releases
- [ ] Test download + open on a clean macOS user account (no developer tools installed)
- [ ] Confirm Gatekeeper clears silently (no right-click required)

---

## Known Gotchas

**`keyring` crate and Hardened Runtime:** The `keyring` crate uses the macOS Security framework directly. Under Hardened Runtime without App Sandbox, it works without a `keychain-access-groups` entitlement — the app accesses its own Keychain items freely. If you later move to the App Sandbox (e.g., for Mac App Store), you will need to add that entitlement and migrate existing entries.

**`macOSPrivateApi: true`:** Tauri's `macos-private-api` feature (used for vibrancy / sidebar effects) does not affect notarization. It changes the Info.plist but doesn't require additional entitlements.

**Nested binaries:** Tauri bundles only the main executable; there are no additional helper binaries or frameworks to sign separately. The `--deep` flag on codesign covers everything. If you add a Sparkle-based updater later, its `.framework` and `Autoupdate` helper binary each need their own signing pass.

**D-U-N-S for the LLC:** Apple requires a D-U-N-S number for organisation enrollment. Request it at dnb.com/duns-number/get-a-duns.html. It can take up to 5 business days; do this in parallel with getting the developer account ready.

**Certificate expiry:** Developer ID certs are valid for 5 years. Timestamps embedded by notarization mean already-distributed apps remain valid even after the cert expires — but new builds require a valid cert. Calendar reminder: your cert expires in 2031.

---

---

# PRD: Performance & Scaling Fixes

## Problem Statement

Esploro has several architectural issues that cause visible degradation when used against production-scale databases (millions of rows, hundreds of tables, wide schemas). These were surfaced during an architecture review and are documented in `ARCHITECTURE.md`. This PRD defines the plan to fix each one.

Issues are grouped by severity.

---

## Critical Fixes

### C1 — Result streaming via Tauri channels (no more full-buffered IPC)

**Problem:** Every query — table viewer and SQL editor — materializes the complete result set into a `Vec<Vec<Option<String>>>` in Rust before sending it to the frontend in a single IPC call. For large queries (e.g. `SELECT *` on a wide table, or a `RETURNING *` on a bulk insert) this means the entire result must fit in memory twice: once in Rust, once as serialized JSON in the IPC buffer.

**Fix:** Use Tauri 2's `Channel` API to stream rows in chunks from Rust to the frontend as they arrive from the database.

- Replace `client.query(...)` with `client.query_raw(...)` (tokio-postgres) to get a `RowStream`.
- Iterate the stream and emit chunks of N rows (e.g. 500) via a `tauri::ipc::Channel<ChunkPayload>`.
- The frontend receives chunks incrementally and appends them to the result state; the grid renders what's available immediately.
- Define a `ChunkPayload` enum: `Rows { columns, rows }`, `Done { total_rows, execution_ms }`, `Error { message, position, code }`.

**Outcome:** Memory usage stays proportional to chunk size, not result size. The UI shows data immediately rather than after a full round-trip. `SELECT *` on a 10M-row table no longer OOMs the process.

**Scope:**
- `src-tauri/src/commands/data.rs`: `execute_sql_pg`, `execute_sql_mysql`
- `src/features/query-editor/`: replace `useMutation` result state with streaming state machine
- For the **table viewer**, keep the current paginated model (LIMIT/OFFSET) — the page size cap means streaming is less critical there; fix C2 instead.

---

### C2 — Make `COUNT(*)` optional and cached

**Problem:** The table viewer fires a `COUNT(*)` query on every page change to populate the "X of Y rows" footer. On a large table without a covering index, this is a full sequential scan — potentially seconds of latency per page flip. The count is also redundant across pages when filters haven't changed.

**Fix:**

1. **Cache the count in React Query** — include `{ filters, schema, table }` in the query key for the count, but separate it from the page key so navigating pages doesn't re-run it. Use a `staleTime` of 60 seconds for the count query.
2. **Run count asynchronously and lazily** — split `query_table` into two Tauri commands: `query_table_data` (returns rows only) and `query_table_count` (returns count only). The frontend calls both in parallel but renders data immediately without waiting for the count.
3. **Add a `show_total_count: bool` setting** (default `true`) so power users on very large tables can disable it entirely.
4. **Use `pg_class.reltuples` as a fast estimate** when exact count is disabled — already fetched during schema introspection, surfaced in the footer as "~N rows".

**Outcome:** Page navigation latency drops to the data query only. Count runs once per filter change, not per page.

**Scope:**
- `src-tauri/src/commands/data.rs`: split `query_table` into data + count commands
- `src/features/table-viewer/`: parallel queries, count cache, fallback to estimate
- `src/store/`: add `showTotalCount` preference

---

### C3 — Preserve column types through the query pipeline

**Problem:** All columns are cast to `text`/`CHAR` in the SQL layer (`col::text` for PG, `CAST(col AS CHAR)` for MySQL). Type information is discarded before it reaches the frontend. This makes NULL vs empty-string rendering ambiguous, breaks numeric sorting, and will block cell editing.

**Fix:** Stop casting to text in SQL. Instead, read native column types from the `tokio-postgres` row metadata and convert to a typed enum on the Rust side before serialization.

- Define a `CellValue` enum: `Null`, `Bool(bool)`, `Int(i64)`, `Float(f64)`, `Text(String)`, `Bytes(Vec<u8>)`, `Json(serde_json::Value)`, `Other(String)` (fallback for intervals, arrays, etc.).
- Use `row.try_get::<_, Option<T>>(i)` with type dispatch based on `column.type_()` (from tokio-postgres `Type`).
- Serialize `CellValue` as a tagged JSON union: `{ "t": "int", "v": 42 }` or `{ "t": "null" }`.
- Frontend renders and sorts based on the type tag, not string heuristics.

**Outcome:** Correct NULL rendering, correct numeric sort, foundation for cell editing.

**Scope:**
- `src-tauri/src/commands/data.rs`: new `cell_value` module, replace `Vec<Option<String>>` with `Vec<CellValue>`
- `src/features/table-viewer/` and `src/features/query-editor/`: update grid cell renderer and sort logic
- This is the largest change; do it after C1 so streaming and typing land together

---

### C4 — Configurable pool size

**Problem:** Connection pool sizes use library defaults (deadpool: 16, mysql_async: undocumented). There is no way to configure them. A user connecting to a small RDS instance with `max_connections=20` can accidentally saturate it.

**Fix:**

- Add `pool_min_connections: u32` (default 1) and `pool_max_connections: u32` (default 5) fields to `ConnectionProfile`.
- Pass these to `deadpool_postgres::PoolConfig` and `mysql_async::PoolOpts`.
- Expose them in the connection editor UI under an "Advanced" section.
- Apply a hard cap of 10 in the backend to prevent misconfiguration.

**Outcome:** User has explicit control; safe default of 5 prevents pool exhaustion on small servers.

**Scope:**
- `src-tauri/src/commands/connections.rs`: `build_pg_pool`, `build_mysql_pool`
- `src/features/connections/`: connection edit form
- `connections.json` schema: new fields (backward-compatible with default fallback)

---

## Moderate Fixes

### M1 — Cache schema introspection results

**Problem:** `list_objects` and `list_columns` query `information_schema` tables on every schema browser expand. `information_schema` is slow on databases with thousands of tables. TanStack Query's 30-second cache helps within a session but there is no configurable cache.

**Fix:**

- Increase `staleTime` for schema queries to 5 minutes (from the global 30s default) by using per-query `staleTime` overrides in the respective hooks.
- Add a "Refresh schema" button to the schema browser that calls `queryClient.invalidateQueries` for the schema keys.
- For `list_columns`, use PostgreSQL's `pg_catalog` tables (`pg_attribute`, `pg_class`, `pg_namespace`) instead of `information_schema.columns` — they are faster and avoid the view overhead.

**Outcome:** Schema browser loads near-instantly after first open; large databases are usable.

**Scope:**
- `src/features/schema-browser/`: query option overrides, refresh button
- `src-tauri/src/commands/schema.rs`: replace `information_schema.columns` with `pg_catalog` queries for PG

---

### M2 — Keyset pagination option for deep pages

**Problem:** `LIMIT n OFFSET m` forces the database to scan and discard the first `m` rows. At page 500 with page size 200 that's `OFFSET 100000` — a full scan even with an index on the sort column.

**Fix:** Add optional keyset pagination for the table viewer when a single primary-key sort column is active.

- If `sort_column` is a primary key and all PKs are single-column integers or UUIDs, use `WHERE pk_col > $last` instead of `OFFSET`.
- Track `last_pk_value` in the frontend alongside `current_page`.
- Fall back to OFFSET pagination for multi-column PKs, non-PK sorts, or when the user jumps to an arbitrary page.
- This is an optimization, not a replacement — OFFSET pagination stays for all non-eligible cases.

**Outcome:** Deep page navigation is O(1) instead of O(n) for the common case (integer PK, ascending sort).

**Scope:**
- `src-tauri/src/commands/data.rs`: `query_table_pg` WHERE clause builder
- `src/features/table-viewer/`: track last-seen PK value, pass to request
- Only implement for PostgreSQL initially; MySQL can follow

---

### M3 — Async file I/O for saved queries

**Problem:** `saved_queries.rs` reads and writes `saved_queries.json` with blocking (non-async) `std::fs` calls inside async Tauri command handlers. This blocks a Tokio thread for the duration of the I/O.

**Fix:** Replace `std::fs::read_to_string` / `std::fs::write` with `tokio::fs::read_to_string` / `tokio::fs::write`.

One-line change per call site. No interface changes.

**Scope:** `src-tauri/src/commands/saved_queries.rs` only.

---

## Minor Fixes

### N1 — Prune `expandedNodes` and `recentObjects` in localStorage

**Problem:** `expandedNodes` (schema tree state) and `recentObjects` accumulate indefinitely in localStorage with no eviction policy.

**Fix:**

- Cap `recentObjects` at 50 entries (FIFO eviction) in the Zustand store's `addRecentObject` action.
- Prune `expandedNodes` on session disconnect: remove all keys whose prefix matches the disconnected `connectionId`.

**Scope:** `src/store/index.ts`

---

### N2 — Clarify stale data UX (React Query stale time)

**Problem:** React Query's 30-second stale time means the table viewer can silently show stale data after another session or external tool modifies the table.

**Fix:** Add a subtle "Last fetched X seconds ago" indicator to the table viewer toolbar that updates every 10 seconds. When data is stale (>30s), show a refresh button. No change to the stale time itself.

**Scope:** `src/features/table-viewer/TableViewerTab.tsx`

---

## Implementation Order

| Priority | Item | Why first |
|---|---|---|
| 1 | C4 — Pool size config | Two-line backend change, immediate safety benefit |
| 2 | M3 — Async file I/O | Trivial, eliminate a latent bug |
| 3 | N1 — localStorage pruning | Trivial, eliminate creep |
| 4 | C2 — COUNT caching + split | High-impact for table browser UX, self-contained |
| 5 | M1 — Schema cache + pg_catalog | High-impact for large DBs, self-contained |
| 6 | C3 — Typed cell values | Required before cell editing; largest change |
| 7 | C1 — Result streaming | Requires C3 (streaming typed values); largest change |
| 8 | M2 — Keyset pagination | Depends on C3 (need PK type info); optional optimization |
| 9 | N2 — Stale data indicator | Polish; do last |

---

## Non-Goals

- Query plan visualization (`EXPLAIN ANALYZE`) — separate feature.
- Result set export (CSV/JSON) — separate feature.
- Auto-complete / IntelliSense in the SQL editor — separate feature.
- Any MySQL-specific optimizations beyond parity with PostgreSQL fixes.
- Connection pooler integration (PgBouncer, ProxySQL) — out of scope; this is client-side pooling only.
