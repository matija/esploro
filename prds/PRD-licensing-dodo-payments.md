# PRD: Commercial License via Dodo Payments

## Problem Statement

Esploro already has a full licensing scaffold — the `LicenseTier` model (Personal / Commercial / Unlicensed), the usage-type dialog, the commercial-use detector, the activation sheet, the warning banner, and local key storage with HMAC verification — but it has no way for a user to actually *buy* a license. The "Get a license" button opens a placeholder URL (`https://esploro.app/buy`) and the activation flow accepts only self-signed HMAC keys (`ESPLORO-<payload>.<sig>`) that nobody can issue. The result is a UI that looks complete but a transaction loop that doesn't close.

We want to close the loop without standing up a backend.

## Solution

Use Dodo Payments — already configured with two products in the dashboard — as the system of record for purchases, license keys, and validity. The user clicks "Purchase license" inside Esploro, picks lifetime or annual, completes checkout in the system browser, receives the key by email from Dodo, and pastes it into the existing activation sheet. The app calls Dodo's public `POST /licenses/validate` endpoint to confirm the key is real and active, stores it in the macOS Keychain, and re-validates it periodically to enforce subscription expiry and admin revocation.

We deliberately do *not* call `POST /licenses/activate`. That means:
- No per-machine activation slot accounting, no `instance_id` tracking, no "deactivate this machine" dance.
- The same key works on as many machines as the user pastes it on.
- Sharing the key with friends is unenforced — we accept this on the honor-system theory and the fact that any client-side enforcement is bypassable anyway. If sharing becomes a measurable problem, we add a thin backend later that does region/UA heuristics before forwarding to Dodo's validate endpoint.

The existing self-signed HMAC system is removed; it was never used by real customers (the app is pre-1.0).

## User Stories

1. [x] As a user, when I click "Purchase license", I want to see Esploro Lifetime ($99.99) and Esploro Annual ($39.99/yr) side-by-side, so that I can pick the one that fits how I work.
2. [x] As a user, when I pick a plan, I want the macOS system browser to open the matching Dodo checkout page, so that payment happens in a familiar, trusted browser context.
3. [x] As a user, after a successful purchase, I want to receive my license key by email automatically, so that I don't have to copy anything from a thank-you page. (Handled by Dodo Payments — no app-side implementation needed.)
4. [x] As a user, I want to paste my emailed key into the existing License Activation sheet and have it validated against Dodo, so that I'm marked as Commercial within a second of pasting.
5. [x] As a user, when validation succeeds, I want the License pane to show "Commercial" status, so that I can confirm the app accepted my key.
6. [x] As a user, when validation fails — wrong key, revoked, lapsed subscription — I want a clear error in the activation sheet, so that I know whether to retry, renew, or contact support.
7. [x] As a user, I want my license to keep working offline, so that I can use Esploro on a plane or with a flaky connection.
8. [x] As a user, my yearly subscription's expiry should be enforced automatically — the app should revert to Unlicensed within 24 hours of the subscription lapsing, so that licensing reflects what I actually paid for.
9. [x] As a user, I want my license key stored in the macOS Keychain rather than a plain file, so that another local process can't trivially copy it and so it survives reinstalling the app.
10. [x] As a user, I want a "Remove license" button in the License pane that clears the key from this machine, so that I can clean up if I'm selling the machine or troubleshooting.
11. [x] As a user, my existing experience around the warning banner, the usage-type dialog, and the commercial-use detector should be unchanged — I just want a real way to buy what the banner is telling me to buy.

## Implementation Decisions

### Dodo dashboard (already configured)

- [x] **Esploro Lifetime** — one-time, $99.99, license keys enabled, no expiry, activation limit irrelevant. Product ID `pdt_0NeCDJbPgj9avsXtryxJt`.
- [x] **Esploro Annual** — yearly subscription, $39.99/yr, license keys enabled, expiry tied to subscription period (auto-extends on renewal). Product ID `pdt_0NeCDnINEsohTubKMTSQ0`.

### Plan picker UI

- [x] Add a `PlanPickerDialog` component (Radix `Dialog`, styled like `UsageTypeDialog`) with two cards: Esploro Lifetime ($99.99, "pay once, use forever") and Esploro Annual ($39.99/yr, "auto-renews, always up-to-date"). Each card has a "Continue to checkout" button.
- [x] Replace the current `licenseApi.openLicenseUrl()` call sites in `LicenseSettings.tsx` and `LicenseBanner.tsx` so "Get a license" / "Purchase license" opens the dialog instead of a placeholder URL.
- [x] On button click, call a new Tauri command `open_checkout_url(plan: "lifetime" | "annual")` which opens `https://checkout.dodopayments.com/buy/<product_id>?quantity=1` via `std::process::Command::new("open")` (same pattern as the rest of the codebase; tauri-plugin-shell not added).
- [x] Replace the `open_license_url` Rust command with `open_checkout_url` + `open_customer_portal`. Both product IDs are baked into the binary as `const` strings; no env vars needed since they're not secrets.
- [x] Rename "Get a license" to "Purchase license" everywhere for consistency.

### Validation against Dodo

- [x] Replace HMAC verification in `verify_license_key()` with `POST {BASE}/licenses/validate` carrying `{ license_key }`. Use `https://live.dodopayments.com` in release builds and `https://test.dodopayments.com` in dev (controlled by a single `cfg!(debug_assertions)` check).
- [x] On HTTP 200 with `{ valid: true }`, persist `{ license_key, validated_at }` in Keychain and report tier `Commercial`.
- [x] On HTTP 200 with `{ valid: false }`, surface "License key is not valid or has expired — check your subscription in the customer portal" and do not store anything.
- [x] On HTTP 422 (invalid request format), surface "Invalid license key format — check for typos".
- [x] On HTTP 5xx or network failure during the *initial* paste, surface "Could not reach the license server — check your connection and try again". Do not store anything; the user has to retry.

### Storage

- [x] Store the activated license in macOS Keychain via the existing `keyring` crate (already in `Cargo.toml`). Service `com.esploro.app`, account `commercial-license`, value is a small JSON blob `{ license_key, validated_at }`.
- [x] Keychain entries persist across app uninstall/reinstall on macOS by default, so reinstalling the app does not require re-pasting the key.
- [x] Remove the existing `license.key` file path and best-effort delete it on first launch with the new build (`if path.exists() { fs::remove_file(...).ok(); }`).

### Periodic re-validation and offline grace

- [x] On every app launch and once per 24 hours while running, re-validate the cached key against Dodo. Refresh `validated_at` on success.
- [x] On `{ valid: false }`, clear the Keychain entry, revert to `Unlicensed`, and show the warning banner again.
- [x] On network failure, fall back to the cached state. The license remains valid offline for **14 days** since `validated_at`. After that, revert to `Unlicensed` and show a banner reading "License re-validation required — connect to the internet".
- [x] The 14-day window mirrors the existing 14-day commercial-use grace period in `compute_status()` for consistency.
- [x] Re-validation runs on a background `tokio` task in `lib.rs` and pushes results to the frontend via the existing `LicenseStatus` query (already polled by React Query with `staleTime: 60_000`). The task fires immediately on launch and then every 24 hours; `get_license_status` now returns immediately from cache.

### HTTP plumbing in Rust

- [x] Drop `hmac`, `sha2`, and `base64` from `Cargo.toml` once HMAC verification is removed.
- [x] All Dodo HTTP calls route through `call_dodo_validate()` which shells out to the system `curl` binary via `tokio::process::Command` with a 10-second timeout. (No reqwest added — TLS dependencies for reqwest were unavailable in the build environment; system curl on macOS handles TLS natively via SecureTransport.)

### Removing the legacy HMAC system

- [x] Delete `SIGNING_KEY`, `LicensePayload`, `LicenseError`, `verify_license_key()` from `src-tauri/src/commands/license.rs`. (`LICENSE_URL` kept temporarily for the existing `open_license_url` command until the Plan Picker UI task replaces it with `open_checkout_url`.)
- [x] Update `LicenseTier` to drop any HMAC-specific paths in `compute_status()`.
- [x] No customer migration needed — the HMAC format was never issued.

### Removing per-machine state

- [x] Drop the `licensee` and `expiresAt` fields from the `LicenseStatus` returned to the frontend (we no longer have these — Dodo's validate response is just `{ valid: bool }`). Update `LicenseSettings.tsx` to remove the "Licensed to: …" and "Expires: …" lines; show only "Commercial" with a green dot.
- [x] Add a "Manage subscription / Find my key" link in the License pane that opens Dodo's customer portal in the system browser, for users who want to renew, update payment, or recover a lost key.

## Testing Decisions

**What makes a good test here:**
The state machine around validation-and-grace is the valuable surface. The HTTP wire format is Dodo's responsibility; mocking it would just re-verify our mock.

**What to test:**
- [x] State-machine transitions in `compute_status()`: just-pasted+`valid:true` → `Commercial`; cached+recently validated → `Commercial`; cached+last_validated >14 days ago + offline → `Unlicensed` with re-validation banner; cached + Dodo returns `valid:false` → `Unlicensed` with normal banner.
- [x] Error-code → message mapping for `200 valid:false`, `422`, `5xx`, network failure.
- [x] URL construction for the plan picker: given a plan, the right `https://checkout.dodopayments.com/buy/<product_id>?quantity=1` is opened.
- [ ] Smoke test against Dodo's test environment with a real test key, run manually before each release. Document the flow in `README.md`.

**What not to test:**
- The Dodo HTTP API itself.
- The `keyring` crate's Keychain behavior.
- `tauri-plugin-shell`'s `open()` behavior.

## Out of Scope

- **Per-machine activation limits.** No call to `/licenses/activate`, no `instance_id` tracking, no "deactivate this machine" UI. If sharing becomes measurable, add a thin proxy backend that does region/UA heuristics and is the only thing that calls Dodo. Documented as a future enhancement, not a v1 feature.
- A marketing landing page on `esploro.app`. The plan picker dialog inside the app is the entire purchase entry point.
- Deep-link return via a custom `esploro://` URL scheme. The user pastes from email; that's the whole flow.
- Embedded webview checkout. System browser only.
- Server-side issuance, signing, or escrow of license keys.
- Discount codes (Dodo handles them on their checkout page if enabled), free trials beyond the existing personal-use tier, team/seat licensing.
- Migration off the legacy HMAC format — no users exist.
- Per-feature gating beyond the existing Commercial / Personal / Unlicensed split.
- In-app subscription management (cancel, change plan, update card). Link out to Dodo's customer portal.
- License-gated auto-update server. Updates remain free for everyone.

## Further Notes

- **Why validate-only.** Dodo's `/licenses/validate` is a public endpoint that returns `{ valid: bool }` and respects subscription expiry and admin revocation. That's enough to enforce the two things we actually care about: "did this person pay" and "is their subscription still active". Skipping `/licenses/activate` removes an entire category of UX papercuts (slot-burn on reinstall, "deactivate first" errors, instance bookkeeping) for the price of trusting users not to share keys — which any client-side enforcement could be bypassed around anyway.
- **The future-backend escape hatch.** If sharing becomes a problem, the right fix is a small backend that ingests `(license_key, request_metadata)`, applies whatever heuristics make sense (per-region rate limits, repeated UA mismatches, geographic spread), and only then forwards to Dodo's validate endpoint. The app's contract becomes "validate against `license.esploro.app`" instead of "validate against `live.dodopayments.com`" — a one-line change.
- **Why Keychain.** Plain files in `~/Library/Application Support/com.esploro.app/` are readable by every process running as the user. Keychain entries require explicit consent the first time another app reads them. The other crucial property: Keychain entries survive app uninstall, so reinstalling Esploro is a non-event for licensing.
- **Why 14 days offline.** Long enough for a two-week trip, short enough that a cancelled subscription stops working within a reasonable window.
- **Customer portal as recovery.** The "Manage subscription / Find my key" link covers lost keys, expired cards, and "I want to cancel" without us building any of those flows.
