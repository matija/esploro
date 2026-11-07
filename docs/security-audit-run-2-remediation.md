# Security audit run 2: remediation

## Scope

The source audit reviewed commit `cabc2e5f4484e2ad445dae19ac86825653e0c785`.
It reported six leads that need runtime validation, not confirmed vulnerabilities.
These changes address five source-level causes. They do not establish security clearance.

## Implemented changes

- Session reuse requires the same serialized saved profile, not just the same connection ID.
  Profile updates also remove cached sessions, including updates to passwords.
- MySQL pool settings apply the saved TLS policy and disable automatic socket substitution.
  `require` encrypts without certificate verification. `verifyFull` verifies certificates and hostnames.
  MySQL also treats `prefer` as required TLS; it does not silently retry without encryption.
  The connection form exposes the TLS selector for both drivers.
- PostgreSQL URL imports retain `sslmode=require` and `sslmode=verify-full`.
  `verify-ca` maps to the stricter `verifyFull` policy. Unknown modes also select `verifyFull`.
- MySQL mutation previews encode text as UTF-8 hexadecimal expressions.
  These expressions do not depend on backslash escape settings. Direct Save remains parameterized.
- License validation sends JSON through curl's stdin, not its argument vector.
  It uses the system curl, ignores curl's startup file, and terminates the child on cancellation.
- Native URL opening accepts only the four HTTPS destinations used by current callers.

## Open lead: MCP server identity

The copied MCP configuration still uses a persistent bearer token and a fixed plaintext loopback endpoint.
The client does not authenticate the server before it sends that token.
A different local user might occupy that endpoint while Esploro is stopped.
The audit did not establish whether supported clients disclose the token under those conditions.

Host and Origin checks protect inbound requests; they do not authenticate the server to a client.
Token rotation alone does not fix server impersonation while the app is stopped.

Resolution requires an authenticated transport, such as a private per-user socket with a verified stdio bridge,
or TLS with client-enforced server identity. This requires a separate transport and client-compatibility change.
Existing copied HTTP configurations also need a migration plan.

Until that work is complete, keep MCP disabled on machines with untrusted local users.
If a copied configuration might have reached another listener, remove it and replace the MCP token.

## Verification and release gate

Local verification passed: `npm run verify` with 240 frontend tests, plus 192 existing Rust library tests.
ESLint reports one existing Fast Refresh warning in `src/features/data-grid/CellRenderer.tsx`.
No new unit or integration tests were added.

These checks do not replace the audit's isolated database and packaged-app acceptance checks.
Before security release approval:

1. Verify restricted-profile MCP reads against a disposable database with two dummy identities.
2. Verify MySQL TLS negotiation, plaintext refusal, and invalid-certificate rejection with fresh sessions.
3. Verify imported PostgreSQL TLS settings through the native connection form.
4. Verify MySQL preview round-trips with backslashes, apostrophes, Unicode, and both escape modes.
5. Verify packaged license activation with a dummy key and no secret in process arguments.
6. Resolve the MCP server-identity lead, or explicitly accept the trusted-local-user limitation.

Dependency advisory checks, Keychain ACL checks, updater hardening, CSP, and build-input pinning remain outside these fixes.
No release artifact was built, signed, published, or deployed by this remediation.
