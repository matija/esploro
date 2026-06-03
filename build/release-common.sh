#!/usr/bin/env bash
# Shared validation + setup for build/release.sh and build/release-intel.sh.
# Sourced by both; exports APPLE_*, TAURI_SIGNING_PRIVATE_KEY, RELEASE_VERSION,
# RELEASE_TAG, GH_REPO, defines notarize_dmg(), and the logging helpers below.

# --- pretty output -------------------------------------------------------
# Colors only when attached to a terminal and NO_COLOR is unset.
if [[ ( -t 1 || -t 2 ) && -z "${NO_COLOR:-}" ]]; then
  _c_reset=$'\033[0m'; _c_bold=$'\033[1m'; _c_dim=$'\033[2m'
  _c_blue=$'\033[34m'; _c_green=$'\033[32m'
  _c_yellow=$'\033[33m'; _c_red=$'\033[31m'; _c_cyan=$'\033[36m'
else
  _c_reset=''; _c_bold=''; _c_dim=''
  _c_blue=''; _c_green=''; _c_yellow=''; _c_red=''; _c_cyan=''
fi

step() { printf '%s\n' "${_c_bold}${_c_blue}==>${_c_reset} ${_c_bold}$*${_c_reset}"; }
info() { printf '%s\n' "    ${_c_dim}$*${_c_reset}"; }
ok()   { printf '%s\n' "${_c_green}✓${_c_reset}  $*"; }
warn() { printf '%s\n' "${_c_yellow}⚠  warning:${_c_reset} $*" >&2; }
err()  { printf '%s\n' "${_c_red}✗  error:${_c_reset} $*" >&2; }

# A boxed banner summarizing the run, e.g. banner "Release (aarch64)".
banner() {
  printf '\n%s%s%s\n' "${_c_bold}${_c_cyan}" "──────────────────────────────────────────" "${_c_reset}"
  printf '%s %s%s\n'  "${_c_bold}${_c_cyan}" "$*" "${_c_reset}"
  printf '%s%s%s\n\n' "${_c_bold}${_c_cyan}" "──────────────────────────────────────────" "${_c_reset}"
}

require_env() {
  local var
  for var in "$@"; do
    [[ -n "${!var:-}" ]] || { err "$var not set"; exit 1; }
  done
}

expand_tilde() {
  case "$1" in
    "~/"*) printf '%s/%s' "$HOME" "${1#"~/"}" ;;
    *)     printf '%s' "$1" ;;
  esac
}

# Refuse to release from a dirty tree or an unpushed HEAD. GitHub rejects
# `gh release create --target <sha>` (HTTP 422) if the SHA isn't on the remote,
# and a dirty tree means the built artifacts don't correspond to any commit.
require_clean_pushed_tree() {
  if ! git diff --quiet --ignore-submodules HEAD; then
    err "working tree has uncommitted changes. Commit your version bump first."
    git status --short >&2
    exit 1
  fi
  if ! git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    err "current branch has no upstream. Run 'git push -u origin <branch>' first."
    exit 1
  fi
  git fetch --quiet
  if ! git merge-base --is-ancestor HEAD '@{u}'; then
    err "HEAD is not on the remote. Run 'git push' first."
    exit 1
  fi
}

require_clean_pushed_tree

require_env APPLE_SIGNING_IDENTITY APPLE_API_KEY_PATH APPLE_API_ISSUER
APPLE_API_KEY="${APPLE_API_KEY:-${APPLE_API_KEY_ID:-}}"
require_env APPLE_API_KEY

APPLE_API_KEY_PATH=$(expand_tilde "$APPLE_API_KEY_PATH")
[[ -f "$APPLE_API_KEY_PATH" ]] || {
  err "APPLE_API_KEY_PATH file not found: $APPLE_API_KEY_PATH"; exit 1
}

if ! security find-identity -v -p codesigning | grep -Fq "$APPLE_SIGNING_IDENTITY"; then
  err "signing identity not in keychain: $APPLE_SIGNING_IDENTITY"
  info "Run 'security find-identity -v -p codesigning' to list installed identities."
  exit 1
fi

# Normalize the Tauri updater signing key to TAURI_SIGNING_PRIVATE_KEY (base64).
# Accepts TAURI_SIGNING_PRIVATE_KEY_PATH (file) or TAURI_SIGNING_PRIVATE_KEY (inline);
# either may hold a plaintext minisign secret ("untrusted comment: ...") or its base64.
TAURI_SIGNING_PRIVATE_KEY="${TAURI_SIGNING_PRIVATE_KEY:-}"
TAURI_SIGNING_PRIVATE_KEY_PATH=$(expand_tilde "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}")
if [[ -n "$TAURI_SIGNING_PRIVATE_KEY_PATH" ]]; then
  [[ -f "$TAURI_SIGNING_PRIVATE_KEY_PATH" ]] || {
    err "TAURI_SIGNING_PRIVATE_KEY_PATH file not found: $TAURI_SIGNING_PRIVATE_KEY_PATH"; exit 1
  }
  TAURI_SIGNING_PRIVATE_KEY=$(<"$TAURI_SIGNING_PRIVATE_KEY_PATH")
elif [[ -z "$TAURI_SIGNING_PRIVATE_KEY" ]]; then
  err "set TAURI_SIGNING_PRIVATE_KEY_PATH or TAURI_SIGNING_PRIVATE_KEY."
  info "Generate one with: npm run tauri signer generate -- --ci -w ~/.tauri/esploro.key"
  exit 1
fi
unset TAURI_SIGNING_PRIVATE_KEY_PATH

if [[ "$TAURI_SIGNING_PRIVATE_KEY" == "untrusted comment:"* \
   || "$TAURI_SIGNING_PRIVATE_KEY" == "trusted comment:"* ]]; then
  TAURI_SIGNING_PRIVATE_KEY=$(printf '%s' "$TAURI_SIGNING_PRIVATE_KEY" | base64 | tr -d '\n')
elif printf '%s' "$TAURI_SIGNING_PRIVATE_KEY" | tr -d '\n\r' | base64 -d 2>/dev/null \
     | head -n 1 | grep -Eq '^(untrusted|trusted) comment:'; then
  TAURI_SIGNING_PRIVATE_KEY=$(printf '%s' "$TAURI_SIGNING_PRIVATE_KEY" | tr -d '\n\r')
else
  err "Tauri signing key isn't a recognizable minisign secret (plaintext or base64)."
  exit 1
fi

export APPLE_SIGNING_IDENTITY APPLE_API_KEY APPLE_API_KEY_PATH APPLE_API_ISSUER
export TAURI_SIGNING_PRIVATE_KEY
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

RELEASE_VERSION=$(node -e 'process.stdout.write(require("./package.json").version)')
RELEASE_TAG="${RELEASE_TAG:-$RELEASE_VERSION}"
GH_REPO="${GH_REPO:-matija/esploro}"
export RELEASE_VERSION RELEASE_TAG GH_REPO

ok "Environment validated ${_c_dim}(repo ${GH_REPO}, tag ${RELEASE_TAG})${_c_reset}"

notarize_dmg() {
  local dmg="$1"
  step "Notarizing $(basename "$dmg")..."
  xcrun notarytool submit "$dmg" \
    --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" \
    --issuer "$APPLE_API_ISSUER" --wait
  step "Stapling..."
  xcrun stapler staple "$dmg"
  step "Verifying signature..."
  spctl --assess --type open --context context:primary-signature "$dmg"
  ok "Notarized & stapled"
}
