# Development

## Local verification

Run these commands from the repository root:

```sh
npm ci
npm run verify
```

The verification suite runs TypeScript checks, ESLint, and frontend tests.

It includes automated Settings and MCP Activity interface tests. To run those tests separately:

```sh
npm test -- src/features/settings/McpSettings.test.tsx src/features/settings/McpActivitySettings.test.tsx
```

These tests cover listener controls, profile grants, confirmed token replacement, secret-safe errors, activity display, and degraded history controls.

## MCP acceptance tests

On macOS, install Node.js, Rust, Xcode Command Line Tools, and Docker with Compose support.

If the Docker daemon is running, run:

```sh
npm run verify:mcp
```

The command creates disposable PostgreSQL 17, MySQL 8.4, and MariaDB 11.4 containers with dummy credentials. It does not provision a host VM.

The suite runs locked Cargo dependency resolution, formatting, Clippy, Rust tests, `npm run verify`, and `git diff --check`. It also builds the native app without updater artifacts.

The system client in `tools/mcp/verify-client.mjs` uses the pinned official TypeScript MCP SDK. The Rust fixture host supplies disposable profile grants and credentials. Acceptance covers protocol negotiation, discovery, granted/denied profiles, all inspection modes, queries, errors, cancellation, and token replacement.

Missing databases fail the command instead of silently skipping cases. The command removes its containers and database volumes on success or failure. SDK clients and fixture listeners also close after the tests. A failed or skipped check does not establish acceptance.

The native app is `target/release/bundle/macos/Esploro.app`. This local build does not require an updater signing key.

## MCP behavior and client setup

MCP defaults to disabled with no profile grants, including on existing installations without a policy file. The versioned `mcp_policy.json` lives in the app-data directory, separate from credentials and UI preferences. Invalid or unreadable policy storage denies access. Policy saves use an atomic replacement.

In **Settings → MCP**, grant individual Connection profiles before enabling access. New profiles receive no automatic grant. Enable, disable, listener retry, grant changes, and token replacement require no app restart. Revocation cancels MCP work. Normal app Sessions remain open.

Token replacement stops MCP work before saving a fresh token in Keychain. Success invalidates the old token on new and existing HTTP connections. Replace every agent configuration afterward. If persistence fails, the previous token remains valid and the listener stays stopped. Settings reports the resulting state.

Supported clients use Streamable HTTP with an `Authorization: Bearer` header at `http://127.0.0.1:19482/mcp`. Esploro negotiates protocol version `2025-06-18`. The Settings configuration and an SDK example appear in the [MCP reference](../src-tauri/src/mcp/README.md).

`inspect_schema` returns schema pages with only `connectionId`. Adding `schema` selects table/view pages. Adding `schema` and `object` selects column pages. Limits range from 1 through 100, with a default of 50. Continue with the same target and the returned opaque `nextCursor`. Pages stay within 256,000 UTF-8 bytes and report truncation and omitted entries.

Inspection and queries share two immediate-admission execution slots and one 30-second deadline per accepted request. The deadline includes profile loading, authorization, Session acquisition, database work, and result construction. Overload returns a retryable busy error. HTTP allows 16 active sockets, five seconds each for headers and bodies, and 15 seconds for idle keep-alive sockets.

PostgreSQL queries use transaction-local statement and lock timeouts. MySQL and MariaDB queries use supported server-side SELECT limits. Unsupported versions fail closed. Explicit cancellation, disable, revocation, and token replacement cancel MCP work. HTTP disconnect alone does not cancel a request.

Read-only access does not prevent disclosure to an agent or its cloud provider. Restricted database Roles remain necessary. Payload limits do not cap process memory for individual values received by database drivers.

**Settings → MCP Activity** retains the latest 20 query attempts, without result rows or bearer tokens. SQL literals and database error messages can contain sensitive information. Storage failures preserve successful tool output and allow startup. History falls back to memory. Accessible corrupt files receive unique recovery names. **Clear History** and **Retry Storage** provide recovery controls.

## Manual release review

Human native interaction belongs to release review and does not gate implementation tasks. Automated interface tests do not establish manual native acceptance.

Before release, review these items in the native release candidate:

- Settings and MCP Activity presentation
- Enable/disable state and listener retry after a port conflict
- Profile grant and revocation behavior
- Token replacement cancellation and confirmation with disposable credentials
- Rejection of the old token after replacement
- Status, errors, and activity for unintended token disclosure

These manual checks remain pending human release review until a reviewer records the results.
