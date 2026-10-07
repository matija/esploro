# MCP SQL policy

`mod.rs` defines the endpoint and limits. Result payload size counts UTF-8 bytes of the result, excluding the MCP envelope. These constants define policy, not an HTTP server or query executor.

`validate_sql` uses the pinned `sqlparser` AST with PostgreSQL or MySQL dialects. MariaDB uses the MySQL dialect. It accepts one SELECT, including read-only WITH queries, joins, subqueries, grouping, sorting, pagination, and SELECT set operations.

The function allowlist contains only unquoted, unqualified names:

| Functions | Purpose |
| --- | --- |
| `count`, `sum`, `avg`, `min`, `max` | Aggregates |
| `abs`, `round` | Numeric operations |
| `lower`, `upper`, `length` | String operations |
| `coalesce`, `nullif` | Null handling |

These built-ins do not intentionally change database or session state. The validator rejects all other function names, schema-qualified functions, and table-valued functions. It visits function arguments, CTEs, and nested queries recursively. It rejects mutations, SELECT INTO, locks, output files, assignments, executable comments, and non-query statements. Unsupported expression forms also fail validation, including casts to potentially user-defined types.

AST validation cannot prove the behavior of database objects. Views, operators, or database name resolution can invoke user code. Execution must also use database permissions and read-only transactions. This module does not implement those execution controls.
