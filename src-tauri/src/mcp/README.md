# MCP access and protocol reference

## Access and migration

MCP starts disabled with no permitted Connection profiles. This change also applies to existing installations from the MCP MVP. Earlier automatic access does not create grants. New profiles remain unavailable until the user grants access.

The versioned app-data file `mcp_policy.json` stores `enabled` and `permittedConnectionIds`, separate from credentials and UI preferences. Missing policy storage uses disabled defaults. Invalid or unreadable storage denies access. Saves replace the file atomically.

In **Settings → MCP**, select permitted profiles and enable MCP. Only permitted profiles appear in `list_connections`. Denied and missing IDs return the same unavailable error without opening a Session. Backend authorization applies before Session acquisition and database work.

Disabled MCP does not bind a listener. Disable stops admission, cancels MCP work, and releases port 19482. Grant changes cancel current MCP work before the listener restarts. Normal app Sessions remain open. **Retry listener** retries startup after a port conflict or Keychain error without an app restart.

**Replace token** requires confirmation. Replacement stops admission and cancels MCP work before saving a fresh token in Keychain. After persistence succeeds, the listener restarts if MCP remains enabled. The old token then fails on new and existing HTTP connections.

After successful replacement, replace the configuration in every agent. If persistence fails, the previous persisted token remains valid and MCP stays stopped. Review the Settings status before retrying.

Profile grants do not replace database Roles. Read-only access does not prevent disclosure, including disclosure to a cloud agent provider. Views, operators, and database name resolution can invoke user code. Use restricted database Roles for sensitive data. Result limits do not cap process memory for individual values received by database drivers.

## Supported client setup

Esploro supports authenticated Streamable HTTP at `http://127.0.0.1:19482/mcp` and negotiates MCP protocol version `2025-06-18`. Keep Esploro open while the client uses MCP. Clients must support this negotiated version and custom bearer headers. The server provides tools, without resources, prompts, or server event streams.

1. Open **Settings → MCP**.
2. Grant the required Connection profiles.
3. Select **Enable MCP**.
4. Select **Copy configuration**.
5. Add the configuration to the client settings for MCP servers.

For clients that accept the `mcpServers` format, the copied configuration has this shape:

```json
{
  "mcpServers": {
    "esploro": {
      "type": "http",
      "url": "http://127.0.0.1:19482/mcp",
      "headers": {
        "Authorization": "Bearer <token from Settings>"
      }
    }
  }
}
```

If a client uses another configuration format, enter the endpoint and Authorization header in its corresponding fields. The copied configuration contains a secret. Protect it like a database credential.

The repository pins the official TypeScript MCP SDK for independent system acceptance. From the repository environment, a client can connect with that SDK:

```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({ name: 'esploro-client', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(
  new URL('http://127.0.0.1:19482/mcp'),
  { requestInit: { headers: { Authorization: `Bearer ${process.env.ESPLORO_MCP_TOKEN}` } } },
);
try {
  await client.connect(transport);
  const result = await client.callTool({ name: 'list_connections', arguments: {} });
  console.log(result.structuredContent.connections);
} finally {
  await client.close();
}
```

Supply the token through `ESPLORO_MCP_TOKEN`. The system acceptance client lives in `tools/mcp/verify-client.mjs`.

Raw HTTP clients send JSON-RPC POST requests to `/mcp`. Requests require `Content-Type: application/json` and an Accept header with both `application/json` and `text/event-stream`. After initialization, requests also require `MCP-Protocol-Version: 2025-06-18`. The exact Host value is `127.0.0.1:19482`. Requests with an Origin header fail. The endpoint binds only to loopback and requires bearer authentication.

## Tools and paginated inspection

`list_connections` accepts an empty argument object. Its structured result contains `connections`, with `connectionId` and `label` for each permitted profile. Discovery does not connect to databases or return credentials.

`inspect_schema` uses three modes:

| Arguments | Mode and entries |
| --- | --- |
| `connectionId` | `schemas`: schema names |
| `connectionId`, `schema` | `objects`: table/view names and kinds |
| `connectionId`, `schema`, `object` | `columns`: names, data types, nullability, and defaults |

Calls with only `connectionId` remain valid but now return schema pages instead of the full recursive structure. An `object` argument requires `schema`. Unknown arguments and invalid combinations fail.

Each request accepts an integer `limit` from 1 through 100, with a default of 50. Metadata queries retrieve bounded pages with stable name ordering. Concurrent schema changes can alter page contents.

Start with arguments such as:

```json
{"connectionId":"<permitted ID>","schema":"public","limit":50}
```

Results include `mode`, the corresponding entry array, `truncated`, `truncationReasons`, `omittedEntries`, and `nextCursor`. Each result stays within 256,000 serialized UTF-8 bytes, excluding the MCP envelope. Reasons include `pageLimit` and `byteLimit`. Oversized entries count as omissions and advance the continuation position.

If `nextCursor` is not null, repeat the same target arguments with that value as `cursor`. Continue until `nextCursor` is null. Treat cursors as opaque.

Cursors bind to the profile, mode, schema, and object. Invalid or mismatched cursors fail before database work. Cursors expire on restart or cache eviction. A final page can still report truncation because of omitted entries.

After cursor expiry, restart traversal without a cursor.

`execute_query` requires `connectionId` and `sql`. Its structured result contains `columns`, `rows`, `truncated`, `truncationReasons`, and `omittedValues`. Results contain at most 1,000 rows and 1,000,000 serialized UTF-8 bytes, excluding the MCP envelope. Oversized values can produce explicit omission markers. Database drivers can allocate individual values before these output limits apply.

## Deadlines, admission, and cancellation

Inspection and queries share two execution slots. A third concurrent database tool fails immediately with a busy error and `retryable: true`. Accepted work has one 30-second deadline from tool entry through result construction. This budget includes profile loading, authorization, Session acquisition, and database work.

PostgreSQL queries apply transaction-local statement and lock timeouts within the remaining budget. MySQL uses `max_execution_time`, and MariaDB uses `max_statement_time`. Unsupported server versions fail closed. Query execution uses read-only transactions. Cancellation and cleanup discard uncertain connections instead of returning them for normal pool reuse.

HTTP admission permits at most 16 active sockets. Header receipt and body receipt each have a five-second deadline. Idle keep-alive sockets expire after 15 seconds. Request bodies have a 128 KiB limit. SQL has a 64 KiB limit.

Authenticated `notifications/cancelled` messages identify active work through `params.requestId`. Duplicate active request IDs fail instead of replacing work. Explicit cancellation, disable, grant revocation, and token replacement cancel MCP work. HTTP disconnect alone does not cancel a request.

Tool execution failures return `isError: true` with an error in `structuredContent`. Protocol and argument errors use JSON-RPC errors. SQL rejection messages identify the unsupported category without echoing SQL or credentials.

## SQL policy

`mod.rs` defines the endpoint, shared request limits, and SQL validator. `query.rs` implements read-only execution controls. `server.rs` and `transport.rs` implement HTTP admission and protocol handling.

`validate_sql` uses the pinned `sqlparser` AST with PostgreSQL or MySQL dialects. MariaDB uses the MySQL dialect. It accepts one SELECT, including read-only WITH queries, joins, subqueries, grouping, sorting, pagination, and SELECT set operations.

Expressions support identifiers, literals, nested expressions, ordinary unary and binary operators, null and Boolean tests, and distinctness tests. They also support IN, BETWEEN, LIKE/ILIKE, CASE, EXISTS, subqueries, tuples, and wildcards. The validator rejects assignments and custom binary operators. Other expression forms fail closed.

Rejections identify multiple statements, functions, locks, unsupported expressions, non-query statements, or invalid syntax. Submit one SELECT, remove locking clauses, and use only the documented expressions and functions. Syntax errors use a fixed message rather than parser details. Errors do not include SQL, identifiers, literals, or credentials.

The function allowlist contains only unqualified names (matched without case sensitivity):

| Functions | Purpose |
| --- | --- |
| `count`, `sum`, `avg`, `min`, `max` | Aggregates |
| `abs`, `round` | Numeric operations |
| `lower`, `upper`, `length` | String operations |
| `coalesce`, `nullif` | Null handling |

These built-ins do not intentionally change database or session state. The validator rejects all other function names, schema-qualified functions, and table-valued functions. It visits function arguments, CTEs, and nested queries recursively. It rejects mutations, SELECT INTO, locks, output files, assignments, executable comments, and non-query statements. Unsupported expression forms also fail validation, including casts to potentially user-defined types.

## Activity and verification

**Settings → MCP Activity** shows the latest 20 query attempts. History stores full SQL and database errors, which can contain sensitive literals. It excludes result rows and bearer tokens.

History failures do not prevent startup or replace successful tool results. Storage failures retain history in memory. Accessible corrupt files remain under unique recovery names. **Clear History** and **Retry Storage** provide recovery controls.

Run `npm run verify` and `npm run verify:mcp` from the repository root. The [development guide](../../../docs/development.md) lists prerequisites and automated Settings and MCP Activity interface tests. The MCP suite requires disposable PostgreSQL, MySQL, and MariaDB fixtures. Missing fixtures fail acceptance. Manual native interaction remains pending human release review and does not gate implementation tasks.
