# Development

## Local verification

Run these commands from the repository root:

```sh
npm ci
npm run verify
```

The verification suite runs TypeScript checks, ESLint, and frontend tests.

## MCP acceptance tests

On macOS, install Node.js, Rust, Xcode Command Line Tools, and Docker.

If the Docker daemon is running, run:

```sh
npm run verify:mcp
```

The command creates disposable PostgreSQL 17, MySQL 8.4, and MariaDB 11.4 containers. It runs authenticated HTTP tool calls, database acceptance tests, Rust checks, and frontend checks.

Missing databases fail the command instead of silently skipping cases. The command removes its containers and database volumes on success or failure.

The native app is `target/release/bundle/macos/Esploro.app`. This local build does not require an updater signing key.
