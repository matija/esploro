# Esploro

Esploro is an open source SQL client for Mac. It supports PostgreSQL, MySQL, and MariaDB in one focused app.

[Website](https://esploro.app) · [Download](https://github.com/matija/esploro/releases) · [Issues](https://github.com/matija/esploro/issues)

![Esploro table browser](assets/readme/table-browser.png)

The website screenshot uses fictional database names, table names, column names, and values.

## Why Esploro?

Esploro focuses on the database work that Mac developers do each day. It gives you a clear interface for PostgreSQL, MySQL, and MariaDB.

## Features

- Browse connections, schemas, tables, views, sequences, and roles
- Inspect and edit table data in a fast grid
- Write and run SQL queries
- Filter table data and copy the generated SQL
- Copy values, columns, and rows as JSON or CSV
- Save queries for repeated work
- Review roles and table privileges
- Choose themes, fonts, row density, and rows per page
- Store database passwords in the macOS Keychain
- Connect AI agents through a local MCP server for schema inspection and read-only SQL

## Download

Esploro supports macOS 13 or later. Apple Silicon and Intel builds are available on [GitHub Releases](https://github.com/matija/esploro/releases).

Personal, non-commercial use is free. Paid work requires a commercial license. See the [pricing page](https://esploro.app/pricing) for current options.

Linux and Windows builds are planned.

## MCP access for AI agents

Esploro exposes a local Model Context Protocol (MCP) server through Streamable HTTP. An external AI agent can use three tools:

| Tool | Input | Function |
| --- | --- | --- |
| `list_connections` | `{}` | Lists saved connection IDs and labels without credentials. It does not report database health. |
| `inspect_schema` | `connectionId` | Lists schemas, tables, views, sequences, functions, and table/view columns. Includes key flags, types, defaults, and estimated table row counts. |
| `execute_query` | `connectionId`, `sql` | Runs one validated read-only `SELECT` and returns bounded results. |

Schema inspection and queries open database sessions with saved credentials from Keychain. MCP exposes tools only, without resources or prompts.

### Connect an agent

1. Keep Esploro open with your saved database connections.
2. Open **Settings → MCP**.
3. Click **Copy configuration**.
4. Add the configuration to an agent client that supports Streamable HTTP and bearer authentication.
5. Ask the agent to list connections, inspect a schema, or query a database.

The MCP panel shows server status and provides controls to copy the endpoint, reveal or copy the token, and copy configuration.

The endpoint is `http://127.0.0.1:19482/mcp`. Configuration formats differ between clients. A typical configuration is:

```json
{
  "mcpServers": {
    "esploro": {
      "type": "http",
      "url": "http://127.0.0.1:19482/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_TOKEN>"
      }
    }
  }
}
```

For example, ask: “Show the last 10 users in my sandbox database.” The agent inspects the schema and supplies SQL to Esploro.

### Query support and limits

MCP queries support PostgreSQL, MySQL, and MariaDB. Read-only queries can include CTEs, joins, subqueries, filters, grouping, sorting, pagination, and set operations.

Allowed SQL functions are `count`, `sum`, `avg`, `min`, `max`, `abs`, `round`, `lower`, `upper`, `length`, `coalesce`, and `nullif`. Function names must be unquoted and unqualified.

Esploro rejects writes, schema changes, multiple statements, row locks, arbitrary functions, and unsupported expressions. It uses SQL validation and database read-only transactions.

Each query has these limits:

- 1,000 returned rows
- 1,000,000 bytes of result payload
- A 30-second execution timeout
- Two concurrent query executions
- 64 KiB of SQL text.

Results report truncation. Busy errors are retryable. Schema inspection returns all available schemas and columns, so large databases can produce large responses.

### Query activity

**Settings → MCP Activity** shows the latest 20 persisted query attempts. Each entry includes SQL, connection, status, duration, returned rows, and error details.

**Clear History** removes the history. Esploro stores full SQL locally, including SQL literals, but does not store result data in this history.

### Access boundary

The bearer token persists across app restarts and grants read-only access to all saved connection profiles. Keep the token secret.

The server accepts local clients, not direct browser requests. MCP does not expose tools to modify data, manage connection profiles, or change access permissions.

Read-only access does not prevent data disclosure or guarantee absolute isolation. Query results can reach cloud agents. Use restricted database roles for sensitive databases.

## Privacy

Esploro connects from your Mac to your database server. Queries and results do not pass through an Esploro cloud service.

Esploro stores database passwords in macOS Keychain. Commercial license checks use an online service. Read the [privacy policy](https://esploro.app/privacy) for website analytics, payments, license checks, and support information.

## Source

Esploro uses [Tauri 2](https://tauri.app/), Rust, React, and TypeScript.

Issues and pull requests are welcome on [GitHub](https://github.com/matija/esploro).

## MCP acceptance tests

On macOS, install Node.js, Rust, Xcode Command Line Tools, and Docker with a running daemon.

```sh
npm ci
npm run verify:mcp
```

The command creates disposable PostgreSQL 17, MySQL 8.4, and MariaDB 11.4 containers. It runs authenticated HTTP tool calls, database acceptance tests, Rust checks, and frontend checks. Missing databases fail the command instead of silently skipping cases. The command removes its containers and database volumes on success or failure.

The native app is `target/release/bundle/macos/Esploro.app`. This local build does not require an updater signing key.

## License

The source code uses the MIT License. Commercial use of distributed Esploro builds requires a paid license.
