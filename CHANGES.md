# Changes

## 0.9.2

Changes since 0.9.1:

- Honor PostgreSQL TLS modes, including certificate and hostname checks for `verify-full`. Reject Unix sockets when TLS is required.
- Escape catalog column names in PostgreSQL and MySQL queries, and quote PostgreSQL custom type and array casts.
- Set and verify SQL session modes and encodings before MCP queries so execution matches SQL validation.
- Use a private temporary directory for Intel release metadata and remove it on exit.
