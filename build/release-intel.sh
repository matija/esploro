#!/usr/bin/env bash
set -euo pipefail

# Builds the x86_64 (Intel) DMG and adds it to the existing GitHub release.
# Run this AFTER build/release.sh has created the release for the aarch64 build.
# Patches latest.json on the release to add the darwin-x86_64 entry.

source "$(dirname "${BASH_SOURCE[0]}")/release-common.sh"

banner "Release  v${RELEASE_VERSION}  (x86_64 / Intel)"

if ! gh release view "$RELEASE_TAG" --repo "$GH_REPO" >/dev/null 2>&1; then
  err "GitHub release '$RELEASE_TAG' not found on $GH_REPO."
  info "Run build/release.sh first."
  exit 1
fi

step "Building (x86_64-apple-darwin)..."
CI=true npm run tauri build -- --target x86_64-apple-darwin

BUNDLE_DIR="target/x86_64-apple-darwin/release/bundle"
DMG=$(ls -t "$BUNDLE_DIR/dmg/"*.dmg | head -1)
APP_TAR_ORIG="$BUNDLE_DIR/macos/Esploro.app.tar.gz"
APP_TAR_SIG="$APP_TAR_ORIG.sig"
APP_TAR="$BUNDLE_DIR/macos/Esploro-x86_64.app.tar.gz"
LATEST_JSON="$BUNDLE_DIR/latest.json"

[[ -f "$APP_TAR_ORIG" && -f "$APP_TAR_SIG" ]] || {
  err "updater artifacts not found:"
  info "$APP_TAR_ORIG"; info "$APP_TAR_SIG"
  exit 1
}
cp "$APP_TAR_ORIG" "$APP_TAR"

ok "Built ${_c_dim}$DMG${_c_reset}"
notarize_dmg "$DMG"

step "Patching latest.json with darwin-x86_64 entry..."
EXISTING_URL=$(gh release view "$RELEASE_TAG" --repo "$GH_REPO" --json assets \
  --jq '.assets[] | select(.name=="latest.json") | .url')

if [[ -n "$EXISTING_URL" ]]; then
  curl -fsSL -H "Authorization: token $(gh auth token)" \
    -H "Accept: application/octet-stream" \
    "$EXISTING_URL" -o /tmp/latest_existing.json
else
  warn "no existing latest.json on release; creating one with only darwin-x86_64."
  printf '{"version":"%s","notes":"","pub_date":"%s","platforms":{}}\n' \
    "$RELEASE_VERSION" "$(date -u +%FT%TZ)" > /tmp/latest_existing.json
fi

APP_TAR_SIG="$APP_TAR_SIG" LATEST_JSON="$LATEST_JSON" node -e '
const fs = require("fs");
const sig = fs.readFileSync(process.env.APP_TAR_SIG, "utf8").trim();
const manifest = JSON.parse(fs.readFileSync("/tmp/latest_existing.json", "utf8"));
manifest.platforms = manifest.platforms || {};
manifest.platforms["darwin-x86_64"] = {
  signature: sig,
  url: `https://github.com/${process.env.GH_REPO}/releases/download/${process.env.RELEASE_TAG}/Esploro-x86_64.app.tar.gz`,
};
fs.writeFileSync(process.env.LATEST_JSON, JSON.stringify(manifest, null, 2) + "\n");
'

step "Uploading Intel assets..."
gh release upload "$RELEASE_TAG" "$DMG" "$APP_TAR" "$LATEST_JSON" \
  --repo "$GH_REPO" --clobber

ok "Release ${_c_bold}$RELEASE_TAG${_c_reset} (x86_64) published"
info "Both architectures are now on the release."
