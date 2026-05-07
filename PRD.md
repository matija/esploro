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
