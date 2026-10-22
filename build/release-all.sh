#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if [[ $# -ne 0 ]]; then
  echo "Usage: $0 (run build/bump.sh first to change the version)" >&2
  exit 1
fi
node build/release-website.mjs --check
for target in aarch64-apple-darwin x86_64-apple-darwin; do
  if ! rustup target list --installed | grep -Fqx "$target"; then
    echo "Install the Rust target first: rustup target add $target" >&2
    exit 1
  fi
done
TARGET_TRIPLE=aarch64-apple-darwin ./build/release.sh "$@"
./build/release-intel.sh
node build/release-website.mjs
