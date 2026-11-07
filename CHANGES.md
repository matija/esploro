# Changes

## 0.10.1

- Bind cached database sessions to saved profiles and invalidate them after profile updates.
- Apply MySQL TLS settings and expose the TLS selector for MySQL connections. MySQL `prefer` now requires TLS.
- Preserve required PostgreSQL TLS settings when importing connection URLs.
- Encode MySQL mutation preview values independently of SQL backslash escape settings.
- Send license keys through a private stdin pipe instead of process arguments.
- Restrict native URL opening to approved HTTPS destinations.

The MCP server-identity lead remains open. See [remediation and release checks](docs/security-audit-run-2-remediation.md).

## 0.9.2

Changes since 0.9.1:

- Honor PostgreSQL TLS modes, including certificate and hostname checks for `verify-full`. Reject Unix sockets when TLS is required.
- Escape catalog column names in PostgreSQL and MySQL queries, and quote PostgreSQL custom type and array casts.
- Set and verify SQL session modes and encodings before MCP queries so execution matches SQL validation.
- Use a private temporary directory for Intel release metadata and remove it on exit.
