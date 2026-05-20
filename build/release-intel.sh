#!/usr/bin/env bash
set -euo pipefail

# Builds, notarizes, and uploads an x86_64 (Intel Mac) release artifact.
# Run this AFTER build-and-release (ARM) has already created the GitHub release.
# It patches latest.json on the release to add the darwin-x86_64 entry.

: "${APPLE_SIGNING_IDENTITY:?APPLE_SIGNING_IDENTITY not set}"
: "${APPLE_API_KEY_PATH:?APPLE_API_KEY_PATH not set}"
: "${APPLE_API_ISSUER:?APPLE_API_ISSUER not set}"

if [[ -z "${APPLE_API_KEY:-}" && -n "${APPLE_API_KEY_ID:-}" ]]; then
  APPLE_API_KEY="$APPLE_API_KEY_ID"
fi

: "${APPLE_API_KEY:?APPLE_API_KEY not set}"

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" && -z "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
  echo "error: TAURI_SIGNING_PRIVATE_KEY_PATH or TAURI_SIGNING_PRIVATE_KEY not set." >&2
  exit 1
fi

if [[ "$APPLE_API_KEY_PATH" == "~/"* ]]; then
  APPLE_API_KEY_PATH="$HOME/${APPLE_API_KEY_PATH#"~/"}"
fi

if [[ "${TAURI_SIGNING_PRIVATE_KEY:-}" == "~/"* ]]; then
  TAURI_SIGNING_PRIVATE_KEY="$HOME/${TAURI_SIGNING_PRIVATE_KEY#"~/"}"
fi

if [[ "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" == "~/"* ]]; then
  TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/${TAURI_SIGNING_PRIVATE_KEY_PATH#"~/"}"
fi

if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" && -z "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" && -f "$TAURI_SIGNING_PRIVATE_KEY" ]]; then
  TAURI_SIGNING_PRIVATE_KEY_PATH="$TAURI_SIGNING_PRIVATE_KEY"
  unset TAURI_SIGNING_PRIVATE_KEY
fi

if [[ ! -f "$APPLE_API_KEY_PATH" ]]; then
  echo "error: APPLE_API_KEY_PATH must point to an App Store Connect .p8 key file: $APPLE_API_KEY_PATH" >&2
  exit 1
fi

if [[ -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" && ! -f "$TAURI_SIGNING_PRIVATE_KEY_PATH" ]]; then
  echo "error: TAURI_SIGNING_PRIVATE_KEY_PATH must point to the Tauri updater private key file: $TAURI_SIGNING_PRIVATE_KEY_PATH" >&2
  exit 1
fi

if [[ -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
  TAURI_SIGNING_PRIVATE_KEY_FIRST_LINE="$(head -n 1 "$TAURI_SIGNING_PRIVATE_KEY_PATH")"
  if grep -Eq '^(untrusted|trusted) comment:' <<< "$TAURI_SIGNING_PRIVATE_KEY_FIRST_LINE"; then
    :
  elif TAURI_SIGNING_PRIVATE_KEY_DECODED="$(base64 -d < "$TAURI_SIGNING_PRIVATE_KEY_PATH" 2>/dev/null)" &&
    grep -Eq '^(untrusted|trusted) comment:' <<< "${TAURI_SIGNING_PRIVATE_KEY_DECODED%%$'\n'*}"; then
    TAURI_SIGNING_PRIVATE_KEY="$(tr -d '\n\r' < "$TAURI_SIGNING_PRIVATE_KEY_PATH")"
    unset TAURI_SIGNING_PRIVATE_KEY_PATH
    unset TAURI_SIGNING_PRIVATE_KEY_DECODED
  else
    echo "error: TAURI_SIGNING_PRIVATE_KEY_PATH does not look like a Tauri/minisign secret key file: $TAURI_SIGNING_PRIVATE_KEY_PATH" >&2
    exit 1
  fi
  unset TAURI_SIGNING_PRIVATE_KEY_FIRST_LINE
fi

if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  TAURI_SIGNING_PRIVATE_KEY_FIRST_LINE="${TAURI_SIGNING_PRIVATE_KEY%%$'\n'*}"
  if grep -Eq '^(untrusted|trusted) comment:' <<< "$TAURI_SIGNING_PRIVATE_KEY_FIRST_LINE"; then
    TAURI_SIGNING_PRIVATE_KEY="$(printf '%s' "$TAURI_SIGNING_PRIVATE_KEY" | base64 | tr -d '\n')"
  elif TAURI_SIGNING_PRIVATE_KEY_DECODED="$(printf '%s' "$TAURI_SIGNING_PRIVATE_KEY" | base64 -d 2>/dev/null)" &&
    grep -Eq '^(untrusted|trusted) comment:' <<< "${TAURI_SIGNING_PRIVATE_KEY_DECODED%%$'\n'*}"; then
    TAURI_SIGNING_PRIVATE_KEY="$(printf '%s' "$TAURI_SIGNING_PRIVATE_KEY" | tr -d '\n\r')"
    unset TAURI_SIGNING_PRIVATE_KEY_DECODED
  else
    echo "error: TAURI_SIGNING_PRIVATE_KEY must contain the full Tauri/minisign secret key, including the comment line." >&2
    exit 1
  fi
  unset TAURI_SIGNING_PRIVATE_KEY_FIRST_LINE
fi

if ! security find-identity -v -p codesigning | grep -Fq "$APPLE_SIGNING_IDENTITY"; then
  echo "error: signing identity not found in the local keychain: $APPLE_SIGNING_IDENTITY" >&2
  exit 1
fi

export APPLE_SIGNING_IDENTITY
export APPLE_API_KEY
export APPLE_API_KEY_PATH
export APPLE_API_ISSUER
export TAURI_SIGNING_PRIVATE_KEY="${TAURI_SIGNING_PRIVATE_KEY:-}"
export TAURI_SIGNING_PRIVATE_KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-}"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

RELEASE_VERSION=$(node -e 'process.stdout.write(require("./package.json").version)')
RELEASE_TAG="${RELEASE_TAG:-$RELEASE_VERSION}"
GH_REPO="${GH_REPO:-matija/esploro}"

if ! gh release view "$RELEASE_TAG" --repo "$GH_REPO" >/dev/null 2>&1; then
  echo "error: GitHub release '$RELEASE_TAG' not found on $GH_REPO." >&2
  echo "Run build-and-release (ARM) first to create the release." >&2
  exit 1
fi

echo "==> Building (x86_64-apple-darwin)..."
CI=true npm run tauri build -- --target x86_64-apple-darwin

BUNDLE_DIR="target/x86_64-apple-darwin/release/bundle"
DMG=$(ls -t "$BUNDLE_DIR/dmg/"*.dmg | head -1)
APP_TAR_ORIG="$BUNDLE_DIR/macos/Esploro.app.tar.gz"
APP_TAR_SIG="$APP_TAR_ORIG.sig"
APP_TAR="$BUNDLE_DIR/macos/Esploro-x86_64.app.tar.gz"

if [[ ! -f "$APP_TAR_ORIG" || ! -f "$APP_TAR_SIG" ]]; then
  echo "error: expected updater artifacts not found:" >&2
  echo "  $APP_TAR_ORIG" >&2
  echo "  $APP_TAR_SIG" >&2
  exit 1
fi
cp "$APP_TAR_ORIG" "$APP_TAR"

echo "==> Found: $DMG"

echo "==> Notarizing..."
xcrun notarytool submit "$DMG" \
  --key "$APPLE_API_KEY_PATH" \
  --key-id "$APPLE_API_KEY" \
  --issuer "$APPLE_API_ISSUER" \
  --wait

echo "==> Stapling..."
xcrun stapler staple "$DMG"

echo "==> Verifying..."
spctl --assess --type open --context context:primary-signature "$DMG"

echo "==> Patching latest.json with darwin-x86_64 entry..."
EXISTING_JSON=$(gh release view "$RELEASE_TAG" --repo "$GH_REPO" --json assets \
  | node -e '
    const chunks = [];
    process.stdin.on("data", c => chunks.push(c));
    process.stdin.on("end", () => {
      const data = JSON.parse(chunks.join(""));
      const asset = data.assets.find(a => a.name === "latest.json");
      process.stdout.write(asset ? asset.url : "");
    });
  ')

LATEST_JSON="target/x86_64-apple-darwin/release/bundle/latest.json"

if [[ -n "$EXISTING_JSON" ]]; then
  curl -fsSL -H "Authorization: token $(gh auth token)" \
    -H "Accept: application/octet-stream" \
    "$EXISTING_JSON" -o /tmp/latest_existing.json
  node -e '
    const fs = require("fs");
    const version = process.env.RELEASE_VERSION;
    const tag = process.env.RELEASE_TAG;
    const repo = process.env.GH_REPO;
    const sig = fs.readFileSync("'"$APP_TAR_SIG"'", "utf8").trim();
    const manifest = JSON.parse(fs.readFileSync("/tmp/latest_existing.json", "utf8"));
    manifest.platforms["darwin-x86_64"] = {
      signature: sig,
      url: `https://github.com/${repo}/releases/download/${tag}/Esploro-x86_64.app.tar.gz`
    };
    fs.writeFileSync("'"$LATEST_JSON"'", JSON.stringify(manifest, null, 2) + "\n");
  '
else
  echo "warning: no existing latest.json found on release; creating one with only darwin-x86_64" >&2
  node -e '
    const fs = require("fs");
    const version = process.env.RELEASE_VERSION;
    const tag = process.env.RELEASE_TAG;
    const repo = process.env.GH_REPO;
    const sig = fs.readFileSync("'"$APP_TAR_SIG"'", "utf8").trim();
    const manifest = {
      version,
      notes: "",
      pub_date: new Date().toISOString(),
      platforms: {
        "darwin-x86_64": {
          signature: sig,
          url: `https://github.com/${repo}/releases/download/${tag}/Esploro-x86_64.app.tar.gz`
        }
      }
    };
    fs.writeFileSync("'"$LATEST_JSON"'", JSON.stringify(manifest, null, 2) + "\n");
  '
fi

echo "==> Uploading Intel assets..."
gh release upload "$RELEASE_TAG" "$DMG" "$APP_TAR" "$LATEST_JSON" \
  --repo "$GH_REPO" --clobber

echo "==> Done: $DMG"
