# Dependency policy

This project treats every version change as a deliberate, reviewed act. The
supporting machinery lives in `tools/check-dep-cooldown.mjs`, `.npmrc`
(`save-exact=true`), exact pins in `package.json` and the Cargo manifests, the
committed lockfiles, and the CI `check` job in `.github/workflows/ci.yml`.

## Automated dependency bots — policy: none

**Esploro does not use Dependabot, Renovate, or any other automated
dependency-update bot.** This is an intentional, checked-in decision, not an
oversight.

Why: the cooldown gate and exact version pins already make an automated bump PR
low-value — a bot PR would either be blocked by the cooldown gate (young
version) or would simply re-pin to a version we would review by hand anyway. A
stream of bot PRs adds review noise without adding safety the existing tooling
does not already provide.

What this means in practice:

- There is no `.github/dependabot.yml`, `renovate.json`, `.renovaterc`, or any
  equivalent in this repository, and there must not be one.
- CI enforces this: the `check` job fails if a bot config file appears, so the
  policy cannot be silently reversed by dropping in a default config (see the
  "No dependency-bot config" step in `.github/workflows/ci.yml`).
- Dependency updates are performed manually and deliberately. The upgrade flow
  is documented below.

To revisit this decision, change it in the open: update this file and remove the
CI guard in the same reviewed change-set. That keeps the policy reversal
explicit instead of accidental.

## Updating dependencies

Upgrades are intentional here. Nothing bumps a version on its own, so when you
want a newer version you perform these steps by hand.

### npm

1. **Edit the manifest.** Set the new exact version in `package.json` (no `^`
   or `~` — `.npmrc` has `save-exact=true`, so `npm install <pkg>@<version>`
   also writes an exact pin).
2. **Refresh the lockfile.** Run `npm install`. This updates
   `package-lock.json`. The `preinstall` hook runs the cooldown gate against the
   new lockfile and aborts if any version is younger than 14 days (see the
   cooldown-window step below).
3. **Verify.** `npm run type-check`, `npm run lint`, and a full `npm run tauri
   build` must pass with the new version.

### cargo

1. **Edit the manifest.** Set the new exact version (`=x.y.z`) in
   `src-tauri/Cargo.toml` or `tools/keygen/Cargo.toml`. Direct crates are pinned
   exactly; transitive crates are governed by `Cargo.lock`.
2. **Refresh the lockfile.** Run `cargo update -p <crate> --precise <version>`
   (or `cargo check` to let the resolver update `Cargo.lock`). Commit the
   resulting `Cargo.lock` change.
3. **Verify.** `cargo check --workspace --locked` must pass, and so must the app
   build.

### Inside the cooldown window

The cooldown gate refuses any version published less than 14 days ago, in either
ecosystem. If you genuinely need a version that young, add a dated entry to
`.dep-cooldown-allowlist.toml`:

```toml
[[allowlist]]
package    = "name"
version    = "x.y.z"
reason     = "why this young version is accepted"
expires_at = "YYYY-MM-DD"   # the date it turns 14 days old
```

Entries are time-boxed: the tool ignores an entry once `expires_at` has passed,
so delete it once the package ages out — a stale entry grants nothing. Set
`expires_at` to the publish date plus 14 days.

### One command to reproduce CI's verdict

```
npm run deps:check
```

This runs the cooldown gate over both npm and cargo (`package-lock.json` and
`Cargo.lock`) and exits non-zero on any violation — the same check CI runs.
Run it before pushing to see CI's answer locally. (The `preinstall` hook runs
the npm half automatically on every `npm install`.)

### Behavior on a fresh clone

`.dep-cooldown-allowlist.toml` is committed and exists with zero `[[allowlist]]`
entries, so the gate behaves identically on a new machine or a CI runner as it
does on the maintainer's laptop: a version younger than 14 days **fails loudly**
and demands a manual allowlist entry. The tool only auto-bootstraps an allowlist
when the file is entirely absent; because it is present (header only), there is
no silent bootstrap path and no machine-to-machine difference.
