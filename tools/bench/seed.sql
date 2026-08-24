-- Esploro benchmark seed data (PostgreSQL).
--
-- Creates two schemas that stress the parts of the client that tend to fall over:
--   bench.wide       a table with 128 text columns   (grid virtualisation, column sizing)
--   bench.tall       a table with 10,000,000 rows    (paging, count estimation, streaming)
--   bench_many.*     ~3,500 relations in one schema  (object tree loading, filtering)
--
-- Load with:
--   psql "$ESPLORO_BENCH_PG_URL" -f tools/bench/seed.sql
--
-- Every size is overridable, so a laptop run does not have to be the full 10M rows:
--   psql "$URL" -v tall_rows=100000 -v many_tables=200 -f tools/bench/seed.sql
--
-- The bench_many part commits in batches, so the script must run in autocommit:
-- do not pass psql's -1/--single-transaction.
--
-- See tools/bench/README.md for timings, prerequisites and the MySQL twin of this
-- file (tools/bench/seed.mysql.sql).

\set ON_ERROR_STOP on
\timing on

\if :{?wide_cols}
\else
  \set wide_cols 128
\endif

\if :{?wide_rows}
\else
  \set wide_rows 50000
\endif

\if :{?tall_rows}
\else
  \set tall_rows 10000000
\endif

\if :{?many_tables}
\else
  \set many_tables 2000
\endif

\if :{?many_views}
\else
  \set many_views 1000
\endif

\if :{?many_sequences}
\else
  \set many_sequences 500
\endif

\echo 'esploro bench: wide_cols=':wide_cols ' wide_rows=':wide_rows ' tall_rows=':tall_rows
\echo 'esploro bench: many_tables=':many_tables ' many_views=':many_views ' many_sequences=':many_sequences

-- psql does not interpolate :variables inside dollar-quoted bodies, so the
-- sizes are handed to the DO blocks below as session settings instead.
SELECT set_config('bench.wide_cols',      :'wide_cols',      false) AS wide_cols,
       set_config('bench.wide_rows',      :'wide_rows',      false) AS wide_rows,
       set_config('bench.many_tables',    :'many_tables',    false) AS many_tables,
       set_config('bench.many_views',     :'many_views',     false) AS many_views,
       set_config('bench.many_sequences', :'many_sequences', false) AS many_sequences;

DROP SCHEMA IF EXISTS bench CASCADE;

-- bench_many can hold thousands of relations, and dropping them all in one
-- transaction exhausts max_locks_per_transaction. Drop in committed batches.
DO $reset$
DECLARE
  names text[];
  i     int;
BEGIN
  -- Views first, so dropping their base tables does not cascade underneath us.
  SELECT coalesce(
           array_agg(c.relkind::text || ':' || c.relname
                     ORDER BY CASE c.relkind WHEN 'v' THEN 1 WHEN 'r' THEN 2 ELSE 3 END,
                              c.relname),
           '{}')
    INTO names
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'bench_many' AND c.relkind IN ('r', 'v', 'S');

  FOR i IN 1 .. coalesce(array_length(names, 1), 0) LOOP
    EXECUTE format('DROP %s IF EXISTS bench_many.%I CASCADE',
                   CASE left(names[i], 1)
                     WHEN 'r' THEN 'TABLE'
                     WHEN 'v' THEN 'VIEW'
                     ELSE 'SEQUENCE'
                   END,
                   substr(names[i], 3));
    IF i % 200 = 0 THEN
      COMMIT;
    END IF;
  END LOOP;
END
$reset$;

DROP SCHEMA IF EXISTS bench_many CASCADE;

CREATE SCHEMA bench;
CREATE SCHEMA bench_many;

COMMENT ON SCHEMA bench IS 'Esploro benchmark fixtures: wide and tall tables.';
COMMENT ON SCHEMA bench_many IS 'Esploro benchmark fixtures: many small objects.';

-- ---------------------------------------------------------------------------
-- Wide table: :wide_cols text columns.
-- ---------------------------------------------------------------------------

\echo '==> creating bench.wide'

DO $wide$
DECLARE
  n_cols int := current_setting('bench.wide_cols')::int;
  cols   text;
BEGIN
  SELECT string_agg(format('col_%s text', to_char(i, 'FM000')), E',\n  ' ORDER BY i)
    INTO cols
    FROM generate_series(1, n_cols) AS g(i);

  EXECUTE format($ddl$
    CREATE TABLE bench.wide (
      id bigint PRIMARY KEY,
      %s
    )
  $ddl$, cols);
END
$wide$;

COMMENT ON TABLE bench.wide IS 'Wide table: one bigint key plus many text columns.';

DO $wide_fill$
DECLARE
  n_cols int    := current_setting('bench.wide_cols')::int;
  n_rows bigint := current_setting('bench.wide_rows')::bigint;
  vals   text;
BEGIN
  -- Column i of row n gets a distinct, cheaply generated string so that no two
  -- cells collapse to the same rendered width in the grid.
  SELECT string_agg(format('''c%s-'' || g.i::text', i), ', ' ORDER BY i)
    INTO vals
    FROM generate_series(1, n_cols) AS s(i);

  EXECUTE format(
    'INSERT INTO bench.wide SELECT g.i, %s FROM generate_series(1, %s) AS g(i)',
    vals, n_rows);
END
$wide_fill$;

-- ---------------------------------------------------------------------------
-- Tall table: :tall_rows rows.
-- ---------------------------------------------------------------------------

\echo '==> creating bench.tall'

CREATE TABLE bench.tall (
  id         bigint PRIMARY KEY,
  created_at timestamptz NOT NULL,
  category   text        NOT NULL,
  amount     numeric(12, 2) NOT NULL,
  flag       boolean     NOT NULL,
  payload    text        NOT NULL
);

COMMENT ON TABLE bench.tall IS 'Tall table: many narrow rows for paging and scan benchmarks.';

INSERT INTO bench.tall (id, created_at, category, amount, flag, payload)
SELECT
  g.i,
  timestamptz '2020-01-01 00:00:00+00' + ((g.i % 1000000)::int * interval '1 second'),
  (ARRAY['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'])[1 + (g.i % 8)::int],
  ((g.i::bigint * 7919) % 1000000)::numeric / 100,
  g.i % 3 = 0,
  'payload-' || g.i
FROM generate_series(1::bigint, :tall_rows) AS g(i);

-- A secondary index so filter/sort benchmarks have a plan that is not a seq scan.
CREATE INDEX tall_category_created_at_idx ON bench.tall (category, created_at);

-- ---------------------------------------------------------------------------
-- Many objects: :many_tables tables + :many_views views + :many_sequences sequences.
-- ---------------------------------------------------------------------------

\echo '==> creating bench_many objects'

DO $many$
DECLARE
  n_tables    int := current_setting('bench.many_tables')::int;
  n_views     int := current_setting('bench.many_views')::int;
  n_sequences int := current_setting('bench.many_sequences')::int;
  i           int;
BEGIN
  FOR i IN 1 .. n_tables LOOP
    EXECUTE format($ddl$
      CREATE TABLE bench_many.t_%1$s (
        id       bigint PRIMARY KEY,
        name     text NOT NULL,
        value    numeric(10, 2),
        made_at  timestamptz NOT NULL DEFAULT now()
      )
    $ddl$, to_char(i, 'FM0000'));

    -- A couple of rows each: enough that previews and row counts do real work.
    EXECUTE format(
      'INSERT INTO bench_many.t_%1$s (id, name, value) '
      || 'SELECT g.i, ''row-'' || g.i, g.i * 1.5 FROM generate_series(1, 10) AS g(i)',
      to_char(i, 'FM0000'));

    -- Each new relation holds a lock until commit, and thousands of them
    -- overflow the lock table, so commit as we go.
    IF i % 200 = 0 THEN
      COMMIT;
    END IF;
  END LOOP;
  COMMIT;

  FOR i IN 1 .. n_views LOOP
    EXECUTE format(
      'CREATE VIEW bench_many.v_%1$s AS SELECT id, name, value FROM bench_many.t_%2$s',
      to_char(i, 'FM0000'),
      to_char(1 + (i - 1) % greatest(n_tables, 1), 'FM0000'));

    IF i % 200 = 0 THEN
      COMMIT;
    END IF;
  END LOOP;
  COMMIT;

  FOR i IN 1 .. n_sequences LOOP
    EXECUTE format('CREATE SEQUENCE bench_many.s_%1$s', to_char(i, 'FM0000'));

    IF i % 200 = 0 THEN
      COMMIT;
    END IF;
  END LOOP;
  COMMIT;
END
$many$;

-- ---------------------------------------------------------------------------
-- Statistics + summary.
-- ---------------------------------------------------------------------------

\echo '==> analysing'

ANALYZE bench.wide;
ANALYZE bench.tall;
ANALYZE;

\echo '==> done'

SELECT 'bench.wide columns' AS metric,
       count(*)::text       AS value
  FROM information_schema.columns
 WHERE table_schema = 'bench' AND table_name = 'wide'
UNION ALL
SELECT 'bench.wide rows', count(*)::text FROM bench.wide
UNION ALL
SELECT 'bench.tall rows', count(*)::text FROM bench.tall
UNION ALL
SELECT 'bench_many tables', count(*)::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'bench_many' AND c.relkind = 'r'
UNION ALL
SELECT 'bench_many views', count(*)::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'bench_many' AND c.relkind = 'v'
UNION ALL
SELECT 'bench_many sequences', count(*)::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'bench_many' AND c.relkind = 'S';
