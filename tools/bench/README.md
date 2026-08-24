# Benchmark fixtures

Seed data for testing Esploro against databases that are awkward in the ways real
ones are: too many columns, too many rows, too many objects.

| Fixture | Default size | What it exercises |
| --- | --- | --- |
| `bench.wide` | 128 text columns × 50,000 rows | Grid virtualisation, column sizing, horizontal scrolling |
| `bench.tall` | 10,000,000 rows | Paging, row counts, sorting and filtering on a table too big to buffer |
| `bench_many` | 2,000 tables + 1,000 views + 500 sequences | Object tree loading, schema filtering, autocomplete |

Two scripts, one per engine:

- `seed.sql` — PostgreSQL
- `seed.mysql.sql` — MySQL and MariaDB

They build the same fixtures. A single file cannot serve both engines: generating
ten million rows needs `generate_series` on PostgreSQL and a different trick on
MySQL, and the DDL differs besides.

## Prerequisites

- PostgreSQL 11 or later (the script commits inside `DO` blocks), with `psql` 10
  or later (it uses `\if`). Verified against PostgreSQL 16.
- MySQL 8 or MariaDB 10.5 or later, with the `mysql` client. Verified against
  MySQL 8 and MariaDB 11.
- Roughly 3 GB of free disk per engine at default sizes, plus a similar amount of
  transient space on MySQL while the helper numbers table exists.

Throwaway servers, if you do not already have one:

```sh
docker run -d --name esploro-bench-pg \
  -e POSTGRES_PASSWORD=bench -e POSTGRES_DB=bench -p 55432:5432 postgres:16

docker run -d --name esploro-bench-my \
  -e MYSQL_ROOT_PASSWORD=bench -p 53306:3306 mysql:8
```

## Loading

PostgreSQL — everything lands in schemas `bench` and `bench_many` of whichever
database you connect to:

```sh
psql "postgres://postgres:bench@127.0.0.1:55432/bench" -f tools/bench/seed.sql
```

MySQL — `bench` and `bench_many` are databases, so no database needs to be
selected on the command line:

```sh
mysql --host=127.0.0.1 --port=53306 --user=root --password=bench \
  < tools/bench/seed.mysql.sql
```

Both scripts drop and recreate their schemas on every run, so they are safe to
re-run and destructive to anything already sitting in `bench` or `bench_many`.
Both print a summary of what they built when they finish.

Do not wrap `seed.sql` in a single transaction (`psql -1`). Building thousands of
relations holds a lock on each one until commit and overflows
`max_locks_per_transaction`, so the script commits in batches and needs
autocommit.

## Cost

Measured on Docker Desktop, Apple Silicon, default sizes:

| Engine | Load time | On disk |
| --- | --- | --- |
| PostgreSQL 16 | ~30 s | ~1.2 GB |
| MySQL 8 | ~80 s | ~1.2 GB |

MySQL needs roughly another 400 MB while the helper `bench.numbers` table exists;
it is dropped before the script finishes.

## Smaller runs

The full fixture takes a few minutes and a few gigabytes. Every size is
overridable, which is usually what you want while iterating.

PostgreSQL takes `psql` variables:

```sh
psql "$URL" -f tools/bench/seed.sql \
  -v wide_cols=128 -v wide_rows=500 \
  -v tall_rows=100000 \
  -v many_tables=200 -v many_views=100 -v many_sequences=50
```

MySQL takes user variables, set on the same connection:

```sh
mysql --host=127.0.0.1 --port=53306 --user=root --password=bench \
  --init-command="SET @wide_rows=500, @tall_rows=100000, @many_tables=200, @many_views=100" \
  < tools/bench/seed.mysql.sql
```

| Variable | Default | Notes |
| --- | --- | --- |
| `wide_cols` | 128 | Text columns on `bench.wide`, on top of the `id` key |
| `wide_rows` | 50,000 | Rows in `bench.wide` |
| `tall_rows` | 10,000,000 | Rows in `bench.tall` |
| `many_tables` | 2,000 | Tables in `bench_many`, 10 rows each |
| `many_views` | 1,000 | Views in `bench_many`, spread over those tables |
| `many_sequences` | 500 | Sequences in `bench_many`; PostgreSQL only |

## Differences between the two scripts

- **Sequences.** MySQL has none, so `seed.mysql.sql` ignores `many_sequences` and
  creates 3,000 objects by default instead of 3,500. MariaDB does have sequences,
  but the script stays on the common subset.
- **Namespacing.** PostgreSQL gets two schemas inside one database; MySQL gets two
  databases.
- **Row generation.** PostgreSQL uses `generate_series`. MySQL builds a temporary
  `bench.numbers` table by repeated doubling — recursive CTEs are capped by
  `cte_max_recursion_depth`, which MariaDB spells differently — then drops it once
  both tables are filled.
- **Column types.** `bench.wide` uses `text` on PostgreSQL and `TEXT` on MySQL.
  `VARCHAR` would not fit: 128 wide `VARCHAR` columns overflow InnoDB's 65,535-byte
  row limit.

## Cleaning up

```sh
psql "$URL" -c 'DROP SCHEMA IF EXISTS bench CASCADE; DROP SCHEMA IF EXISTS bench_many CASCADE;'

mysql --host=127.0.0.1 --port=53306 --user=root --password=bench \
  -e 'DROP DATABASE IF EXISTS bench; DROP DATABASE IF EXISTS bench_many;'
```

Or, for the throwaway containers:

```sh
docker rm -f esploro-bench-pg esploro-bench-my
```
