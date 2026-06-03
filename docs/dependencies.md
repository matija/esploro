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
