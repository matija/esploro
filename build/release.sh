#!/usr/bin/env bash
set -euo pipefail

# Release flow (Apple Silicon path):
#   1. Bump the version in package.json, src-tauri/tauri.conf.json,
#      and src-tauri/Cargo.toml. Commit.
#   2. Run build/release.sh from the repo root. It builds the aarch64 DMG,
#      notarizes + staples it, writes the updater manifest, and creates the
#      GitHub release tagged with the package.json version (plus the aarch64
#      assets). The previous-release tag is fetched from GitHub, not local
#      git tags, so the diff link in the release notes is always correct
#      regardless of whether you've pulled tags locally.
#   3. Run build/release-intel.sh to add the x86_64 assets to the same release.

source "$(dirname "${BASH_SOURCE[0]}")/release-common.sh"

UPDATER_PUBLIC_KEY=$(node -e 'const c=require("./src-tauri/tauri.conf.json");process.stdout.write(c.plugins?.updater?.pubkey??"");')
if [[ -z "$UPDATER_PUBLIC_KEY" || "$UPDATER_PUBLIC_KEY" == "PLACEHOLDER_PUBLIC_KEY" ]]; then
  echo "error: src-tauri/tauri.conf.json plugins.updater.pubkey is missing." >&2
  exit 1
fi

RELEASE_TITLE="${RELEASE_TITLE:-Esploro $RELEASE_VERSION}"
if [[ -z "${RELEASE_NOTES:-}" ]]; then
  PREVIOUS_RELEASE_TAG=$(gh release list --repo "$GH_REPO" --limit 20 --exclude-drafts \
    --json tagName --jq "[.[] | select(.tagName != \"$RELEASE_TAG\")] | .[0].tagName // \"\"")
  if [[ -n "$PREVIOUS_RELEASE_TAG" ]]; then
    RELEASE_NOTES="**Full Changelog**: https://github.com/$GH_REPO/compare/$PREVIOUS_RELEASE_TAG...$RELEASE_TAG"
  else
    RELEASE_NOTES="Release $RELEASE_TAG"
  fi
fi

echo "==> Building (aarch64)..."
CI=true npm run tauri build

DMG=$(ls -t target/release/bundle/dmg/*.dmg | head -1)
APP_TAR="target/release/bundle/macos/Esploro.app.tar.gz"
APP_TAR_SIG="$APP_TAR.sig"
LATEST_JSON="target/release/bundle/latest.json"

[[ -f "$APP_TAR" && -f "$APP_TAR_SIG" ]] || {
  echo "error: updater artifacts not found:" >&2
  echo "  $APP_TAR" >&2; echo "  $APP_TAR_SIG" >&2
  exit 1
}

echo "==> Found: $DMG"
notarize_dmg "$DMG"

echo "==> Writing updater manifest..."
APP_TAR_SIG="$APP_TAR_SIG" LATEST_JSON="$LATEST_JSON" node -e '
const fs = require("fs");
const sig = fs.readFileSync(process.env.APP_TAR_SIG, "utf8").trim();
const manifest = {
  version: process.env.RELEASE_VERSION,
  notes: "",
  pub_date: new Date().toISOString(),
  platforms: {
    "darwin-aarch64": {
      signature: sig,
      url: `https://github.com/${process.env.GH_REPO}/releases/download/${process.env.RELEASE_TAG}/Esploro.app.tar.gz`,
    },
  },
};
fs.writeFileSync(process.env.LATEST_JSON, JSON.stringify(manifest, null, 2) + "\n");
'

echo "==> Uploading release assets..."
if gh release view "$RELEASE_TAG" --repo "$GH_REPO" >/dev/null 2>&1; then
  gh release upload "$RELEASE_TAG" "$DMG" "$APP_TAR" "$LATEST_JSON" --repo "$GH_REPO" --clobber
else
  gh release create "$RELEASE_TAG" "$DMG" "$APP_TAR" "$LATEST_JSON" \
    --repo "$GH_REPO" \
    --target "$(git rev-parse HEAD)" \
    --title "$RELEASE_TITLE" \
    --notes "$RELEASE_NOTES" \
    --latest
fi

echo "==> Done: $DMG"
