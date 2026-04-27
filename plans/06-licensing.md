# Phase 06 — Licensing

**Goal:** Implement the personal/commercial license model. Free indefinitely for personal use. Commercial use triggers a grace period, then a persistent banner. License key activation unlocks the commercial tier. Honor-system enforcement in v1.

**Done when:**
- App tracks "commercial usage" heuristic (>3 connection profiles, or user explicitly answers "commercial" to a one-time prompt).
- Commercial users without a valid license see a non-blocking banner after a 14-day grace period.
- License key file can be activated in-app; valid key removes the banner.
- License status visible in Settings → License.
- Activation works fully offline (HMAC verification, no network call required).
- Invalid/tampered keys rejected with a clear error.

---

## 6.1 License key format

```
ESPLORO-<base64url(JSON payload)>.<base64url(HMAC-SHA256 signature)>
```

### Payload schema

```json
{
  "version": 1,
  "tier": "commercial",
  "issued_at": "2025-01-15T00:00:00Z",
  "expires_at": null,           // null = perpetual; ISO 8601 date for annual licenses
  "licensee": "Acme Corp",
  "max_seats": null,            // null = unlimited; int for seat-limited
  "key_id": "uuid-v4"
}
```

### Signing (build-time, offline)

A `keygen` CLI tool in `tools/keygen/` (excluded from the public repo) signs payloads using HMAC-SHA256 with a 64-byte secret key baked into the Tauri binary as a compile-time constant (`env!("ESPLORO_LICENSE_KEY")`). The secret is set via environment variable during the release build and never committed.

```rust
// src-tauri/src/license.rs
const SIGNING_KEY: &[u8] = env!("ESPLORO_LICENSE_SECRET_KEY").as_bytes();

fn verify_license_key(raw_key: &str) -> Result<LicensePayload, LicenseError> {
    let parts: Vec<&str> = raw_key.trim_start_matches("ESPLORO-")
        .splitn(2, '.')
        .collect();
    if parts.len() != 2 {
        return Err(LicenseError::InvalidFormat);
    }

    let payload_bytes = base64_url::decode(parts[0])
        .map_err(|_| LicenseError::InvalidFormat)?;
    let sig_bytes = base64_url::decode(parts[1])
        .map_err(|_| LicenseError::InvalidFormat)?;

    // Constant-time HMAC comparison
    let mut mac = HmacSha256::new_from_slice(SIGNING_KEY)
        .expect("HMAC accepts any key length");
    mac.update(&payload_bytes);
    mac.verify_slice(&sig_bytes)
        .map_err(|_| LicenseError::InvalidSignature)?;

    let payload: LicensePayload = serde_json::from_slice(&payload_bytes)
        .map_err(|_| LicenseError::InvalidFormat)?;

    // Check expiry
    if let Some(expires) = &payload.expires_at {
        let exp = chrono::DateTime::parse_from_rfc3339(expires)
            .map_err(|_| LicenseError::InvalidFormat)?;
        if exp < chrono::Utc::now() {
            return Err(LicenseError::Expired);
        }
    }

    Ok(payload)
}
```

Crates needed:
```toml
hmac = "0.12"
sha2 = "0.10"
base64 = { version = "0.21", features = ["url-safe"] }
chrono = { version = "0.4", features = ["serde"] }
```

---

## 6.2 Tauri commands

File: `src-tauri/src/commands/license.rs`

```rust
#[tauri::command]
pub fn get_license_status(state: State<'_, AppState>) -> LicenseStatus

#[tauri::command]
pub fn activate_license(key: String, state: State<'_, AppState>)
    -> Result<LicenseStatus, String>

#[tauri::command]
pub fn deactivate_license(state: State<'_, AppState>) -> Result<(), String>

#[derive(Serialize, Clone)]
pub struct LicenseStatus {
    pub tier: LicenseTier,           // Personal | Commercial | Unlicensed
    pub licensee: Option<String>,
    pub expires_at: Option<String>,
    pub days_until_expiry: Option<i64>,
    pub banner_visible: bool,        // should UI show the commercial banner?
    pub grace_period_ends: Option<String>,
}

#[derive(Serialize, Clone)]
pub enum LicenseTier { Personal, Commercial, Unlicensed }
```

License key file stored at `$APP_DATA_DIR/license.key` (raw key string). Loaded and verified at startup; result cached in `AppState`.

---

## 6.3 Commercial usage heuristic

Stored in `$APP_DATA_DIR/prefs.json`:

```json
{
  "usage_type_answered": false,
  "usage_type": null,              // "personal" | "commercial"
  "first_launch": "2025-01-15T...",
  "commercial_detected_at": null
}
```

**Triggers for commercial detection (heuristic):**
- User saves ≥ 4 connection profiles.

**First-time dialog** (shown once, ~3 days after first launch, only if no license):
```
How are you using Esploro?

  ○  Personal / hobby projects   (free forever)
  ○  Work / client projects      (commercial license required)

[Continue]
```

Answering "Work" sets `usage_type = "commercial"` and records `commercial_detected_at`. This starts the 14-day grace period.

If the heuristic triggers (≥4 connections) without the user answering, it also sets `commercial_detected_at`.

---

## 6.4 Banner component

`src/features/license/LicenseBanner.tsx`

Shown at the bottom of the main content area (not modal, not blocking):

```
┌────────────────────────────────────────────────────────────────────────┐
│ Esploro is free for personal use. Commercial use requires a license.   │
│ [Get a license]   [I have a license key]   [Learn more]          [×]  │
└────────────────────────────────────────────────────────────────────────┘
```

- Appears only when `banner_visible === true` in license status.
- `[×]` dismisses for the current session (not permanently — reappears on next launch).
- `[Get a license]` → opens Stripe Checkout URL in the default browser (URL configured at build time via env var).
- `[I have a license key]` → opens the license activation sheet.
- Soft yellow background in light mode, amber-900 in dark mode.

---

## 6.5 License activation sheet

`src/features/license/LicenseActivationSheet.tsx`

Radix Dialog sheet from the right:
```
Activate License

License Key:
┌──────────────────────────────────────────────────────┐
│ ESPLORO-...                                          │
└──────────────────────────────────────────────────────┘

[Activate]

Licensed to: —
Tier: —
Expires: Never
```

On activation:
- Call `activate_license(key)`.
- On success: show licensee name + tier; banner disappears.
- On error: show error message inline (`LicenseError::InvalidSignature` → "Invalid key", `LicenseError::Expired` → "This license has expired").

---

## 6.6 Settings → License tab

`src/features/license/LicenseSettings.tsx`

```
License

Status:  ● Commercial   Licensed to: Acme Corp
Expires: Never

[Enter a different key]   [Remove license]
```

For personal/unlicensed users:
```
Status:  Personal (free)
         Commercial use requires a license.

[Get a license →]
```

---

## 6.7 Future hardening (post-v1 notes, not implemented now)

- **Machine binding:** include `machine_id` in payload (hash of hardware UUID); reject on mismatch.
- **Online seat check:** optional ping to `api.esploro.app/v1/seats/check` at launch; degrade gracefully if offline.
- **Seat limit enforcement:** parse `max_seats`; compare against online seat count.
- **Renewal reminders:** 30/7/1 days before expiry for annual licenses.

---

## 6.8 `keygen` tool

`tools/keygen/src/main.rs` — simple CLI, not part of the app binary:

```
Usage: keygen --tier commercial --licensee "Acme Corp" [--expires 2026-01-15]

Outputs: ESPLORO-<payload>.<sig>
```

Reads `ESPLORO_LICENSE_SECRET_KEY` from the environment. Used manually or via a fulfillment script triggered by Stripe webhook.

---

## Acceptance checklist

- [ ] Fresh install: no banner on first launch.
- [ ] Answer "Work" in the dialog → `commercial_detected_at` recorded; banner appears after 14 days (test by manually setting the date back in prefs.json).
- [ ] Create 4+ connection profiles → same banner trigger path.
- [ ] Banner shows with correct text; `[×]` dismisses for session only (reappears after restart).
- [ ] Generate a test commercial key with the keygen tool.
- [ ] Activate key in-app → banner disappears; Settings → License shows "Licensed to" + tier.
- [ ] Tamper with key (flip one character) → activation shows "Invalid key" error.
- [ ] Set `expires_at` to past date in generated key → activation shows "This license has expired".
- [ ] Remove license from Settings → banner reappears.
- [ ] App works fully offline; no network call required for license verification.
- [ ] `ESPLORO_LICENSE_SECRET_KEY` is not present in any committed source file.
