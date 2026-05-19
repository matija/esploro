#!/usr/bin/env bash
#
# build-mas.sh — Build the Mac App Store target.
#
# Strips the literal "macos-private-api" feature from src-tauri/Cargo.toml's
# `tauri` dependency, runs `cargo tauri build` with the MAS overlay config and
# the `mas` Cargo feature, then unconditionally restores Cargo.toml on exit
# (success or failure, including Ctrl+C). The Direct (GitHub Releases /
# Homebrew) build remains the day-to-day default — `cargo tauri dev` keeps
# working unchanged.
#
# Why the patch is needed: `tauri-build` strictly compares the literal `tauri`
# features array in Cargo.toml against the merged config allowlist. Feature
# aliases (`mas = ["tauri/..."]`) are NOT resolved during that check (see
# tauri-apps/tauri#11142, #7940), so physically removing the feature from the
# array is the only way to produce a binary without `macos-private-api`
# linkage. App Store review rejects any binary that links private APIs.
#
# Usage:
#   scripts/build-mas.sh                 # build aarch64-apple-darwin (default)
#   TAURI_TARGET=x86_64-apple-darwin \
#     scripts/build-mas.sh               # override target
#   scripts/build-mas.sh --verbose       # extra args forwarded to `tauri build`
#
# Environment:
#   TAURI_TARGET    Rust target triple. Default: aarch64-apple-darwin.
#                   PRD scope is ARM-only for the first MAS submission; the
#                   variable exists for future fat-binary work.
#
# Exit codes:
#   0   success
#   1   precondition failure (Cargo.toml missing, expected line absent, …)
#   *   propagated from `cargo tauri build`
#
# The patched Cargo.toml is always restored via `trap … EXIT` — including on
# SIGINT — so a Ctrl+C during the build does not leave the working tree in a
# half-patched state. See `restore` below.

set -euo pipefail

TARGET="${TAURI_TARGET:-aarch64-apple-darwin}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
CARGO_TOML="$ROOT_DIR/src-tauri/Cargo.toml"
MAS_CONFIG="$ROOT_DIR/src-tauri/tauri.mas.conf.json"

# The exact line we expect to patch. Strict equality (anchored ^ … $) so this
# script fails loudly the moment the `tauri` dependency line changes shape —
# better to force a conscious script update than to silently produce a
# half-patched Cargo.toml that builds the wrong binary.
EXPECTED_LINE='tauri = { version = "2", features = ["macos-private-api"] }'
PATCHED_LINE='tauri = { version = "2", features = [] }'

if [[ ! -f "$CARGO_TOML" ]]; then
  echo "error: $CARGO_TOML not found" >&2
  exit 1
fi

if [[ ! -f "$MAS_CONFIG" ]]; then
  echo "error: $MAS_CONFIG not found" >&2
  exit 1
fi

if ! grep -Fxq "$EXPECTED_LINE" "$CARGO_TOML"; then
  echo "error: expected line not found in $CARGO_TOML" >&2
  echo "       expected: $EXPECTED_LINE" >&2
  echo "       The MAS build script needs to match this exact line so it can" >&2
  echo "       strip 'macos-private-api' from the tauri features array." >&2
  echo "       If the tauri dependency declaration has changed, update both" >&2
  echo "       EXPECTED_LINE and PATCHED_LINE in this script accordingly." >&2
  exit 1
fi

BACKUP="$(mktemp -t esploro-cargo-toml.XXXXXX)"
cp "$CARGO_TOML" "$BACKUP"

restore() {
  if [[ -f "$BACKUP" ]]; then
    cp "$BACKUP" "$CARGO_TOML"
    rm -f "$BACKUP"
  fi
}
trap restore EXIT

# In-place patch via a temp file (portable across BSD/GNU sed without -i'').
# We pin the replacement to the full literal line — any drift in formatting
# (extra spaces, reordered features) would have already tripped the grep
# preflight check above.
awk -v expected="$EXPECTED_LINE" -v patched="$PATCHED_LINE" '
  $0 == expected { print patched; next }
  { print }
' "$CARGO_TOML" > "$CARGO_TOML.new"
mv "$CARGO_TOML.new" "$CARGO_TOML"

echo "==> Patched Cargo.toml (stripped 'macos-private-api' from tauri features)"
echo "==> Building MAS binary"
echo "    target:  $TARGET"
echo "    config:  $MAS_CONFIG"
echo "    feature: mas"

# We invoke `npm run tauri -- build` rather than `cargo tauri build` so this
# script uses the same Tauri CLI version pinned in package.json — matching the
# Direct build path and avoiding "which cargo-tauri is on PATH?" drift in CI.
(
  cd "$ROOT_DIR"
  npm run tauri -- build \
    --target "$TARGET" \
    --config "$MAS_CONFIG" \
    --features mas \
    "$@"
)

echo "==> MAS build complete"
echo "==> Bundle: src-tauri/target/$TARGET/release/bundle/"
