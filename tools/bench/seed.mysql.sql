-- Esploro benchmark seed data (MySQL / MariaDB).
--
-- The MySQL twin of tools/bench/seed.sql. It builds the same three fixtures,
-- mapped onto MySQL's one-database-per-namespace model:
--   bench.wide       a table with 128 text columns   (grid virtualisation, column sizing)
--   bench.tall       a table with 10,000,000 rows    (paging, count estimation, streaming)
--   bench_many.*     ~3,000 tables and views         (object tree loading, filtering)
--
-- Load with:
--   mysql --host=127.0.0.1 --user=root --password < tools/bench/seed.mysql.sql
--
-- Sizes are overridable through user variables set on the same connection:
--   mysql --init-command="SET @tall_rows=100000, @many_tables=200" < tools/bench/seed.mysql.sql
--
-- MySQL has no sequences, so the sequence part of the PostgreSQL fixture has no
-- counterpart here. See tools/bench/README.md.

SET @wide_cols   = IFNULL(@wide_cols,   128);
SET @wide_rows   = IFNULL(@wide_rows,   50000);
SET @tall_rows   = IFNULL(@tall_rows,   10000000);
SET @many_tables = IFNULL(@many_tables, 2000);
SET @many_views  = IFNULL(@many_views,  1000);

SET @old_autocommit = @@autocommit;
SET autocommit = 1;
SET foreign_key_checks = 0;
SET unique_checks = 0;

DROP DATABASE IF EXISTS bench;
DROP DATABASE IF EXISTS bench_many;
CREATE DATABASE bench;
CREATE DATABASE bench_many;
USE bench;

-- ---------------------------------------------------------------------------
-- Helper: a contiguous 1..N numbers table, built by repeated doubling.
-- Recursive CTEs cap out at cte_max_recursion_depth and MariaDB spells that
-- setting differently, so doubling is the portable way to reach 10M rows.
-- ---------------------------------------------------------------------------

CREATE TABLE bench.numbers (n BIGINT NOT NULL PRIMARY KEY) ENGINE = InnoDB;

DELIMITER $$

CREATE PROCEDURE bench.fill_numbers(IN target BIGINT)
BEGIN
  DECLARE cnt  BIGINT DEFAULT 1;
  DECLARE step BIGINT DEFAULT 0;

  DELETE FROM bench.numbers;
  INSERT INTO bench.numbers (n) VALUES (1);

  WHILE cnt < target DO
    SET step = LEAST(cnt, target - cnt);
    SET @sql = CONCAT(
      'INSERT INTO bench.numbers (n) SELECT n + ', cnt,
      ' FROM bench.numbers ORDER BY n LIMIT ', step);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
    SET cnt = cnt + step;
  END WHILE;
END$$

-- ---------------------------------------------------------------------------
-- Wide table: @wide_cols TEXT columns.
-- ---------------------------------------------------------------------------

CREATE PROCEDURE bench.make_wide(IN n_cols INT, IN n_rows BIGINT)
BEGIN
  DECLARE i    INT DEFAULT 1;
  DECLARE cols LONGTEXT DEFAULT '';
  DECLARE vals LONGTEXT DEFAULT '';

  WHILE i <= n_cols DO
    SET cols = CONCAT(cols, ', col_', LPAD(i, 3, '0'), ' TEXT');
    -- Column i of row n gets a distinct, cheaply generated string so that no
    -- two cells collapse to the same rendered width in the grid.
    SET vals = CONCAT(vals, ', CONCAT(''c', i, '-'', n)');
    SET i = i + 1;
  END WHILE;

  SET @sql = CONCAT(
    'CREATE TABLE bench.wide (id BIGINT NOT NULL PRIMARY KEY', cols,
    ') ENGINE = InnoDB ROW_FORMAT = DYNAMIC');
  PREPARE stmt FROM @sql;
  EXECUTE stmt;
  DEALLOCATE PREPARE stmt;

  SET @sql = CONCAT(
    'INSERT INTO bench.wide SELECT n', vals,
    ' FROM bench.numbers WHERE n <= ', n_rows);
  PREPARE stmt FROM @sql;
  EXECUTE stmt;
  DEALLOCATE PREPARE stmt;
END$$

-- ---------------------------------------------------------------------------
-- Many objects: @many_tables tables + @many_views views.
-- ---------------------------------------------------------------------------

CREATE PROCEDURE bench.make_many(IN n_tables INT, IN n_views INT)
BEGIN
  DECLARE i INT DEFAULT 1;

  WHILE i <= n_tables DO
    SET @sql = CONCAT(
      'CREATE TABLE bench_many.t_', LPAD(i, 4, '0'), ' (',
      '  id BIGINT NOT NULL PRIMARY KEY,',
      '  name VARCHAR(64) NOT NULL,',
      '  value DECIMAL(10,2) NULL,',
      '  made_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP',
      ') ENGINE = InnoDB');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;

    -- A few rows each: enough that previews and row counts do real work.
    SET @sql = CONCAT(
      'INSERT INTO bench_many.t_', LPAD(i, 4, '0'), ' (id, name, value) ',
      'SELECT n, CONCAT(''row-'', n), n * 1.5 FROM bench.numbers WHERE n <= 10');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;

    SET i = i + 1;
  END WHILE;

  SET i = 1;
  WHILE i <= n_views DO
    SET @sql = CONCAT(
      'CREATE VIEW bench_many.v_', LPAD(i, 4, '0'), ' AS SELECT id, name, value ',
      'FROM bench_many.t_', LPAD(1 + MOD(i - 1, GREATEST(n_tables, 1)), 4, '0'));
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
    SET i = i + 1;
  END WHILE;
END$$

DELIMITER ;

SELECT CONCAT('esploro bench: wide_cols=', @wide_cols, ' wide_rows=', @wide_rows,
              ' tall_rows=', @tall_rows, ' many_tables=', @many_tables,
              ' many_views=', @many_views) AS config;

SELECT '==> filling helper numbers table' AS step;
CALL bench.fill_numbers(GREATEST(@wide_rows, @tall_rows, 10));

SELECT '==> creating bench.wide' AS step;
CALL bench.make_wide(@wide_cols, @wide_rows);

-- ---------------------------------------------------------------------------
-- Tall table: @tall_rows rows.
-- ---------------------------------------------------------------------------

SELECT '==> creating bench.tall' AS step;

CREATE TABLE bench.tall (
  id         BIGINT       NOT NULL PRIMARY KEY,
  created_at DATETIME     NOT NULL,
  category   VARCHAR(16)  NOT NULL,
  amount     DECIMAL(12,2) NOT NULL,
  flag       TINYINT(1)   NOT NULL,
  payload    VARCHAR(64)  NOT NULL,
  KEY tall_category_created_at_idx (category, created_at)
) ENGINE = InnoDB;

INSERT INTO bench.tall (id, created_at, category, amount, flag, payload)
SELECT
  n,
  TIMESTAMPADD(SECOND, MOD(n, 1000000), TIMESTAMP '2020-01-01 00:00:00'),
  ELT(1 + MOD(n, 8), 'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'),
  MOD(n * 7919, 1000000) / 100,
  MOD(n, 3) = 0,
  CONCAT('payload-', n)
FROM bench.numbers
WHERE n <= @tall_rows;

SELECT '==> creating bench_many objects' AS step;
CALL bench.make_many(@many_tables, @many_views);

-- ---------------------------------------------------------------------------
-- Cleanup + summary.
-- ---------------------------------------------------------------------------

SELECT '==> analysing' AS step;
ANALYZE TABLE bench.wide, bench.tall;

DROP PROCEDURE bench.fill_numbers;
DROP PROCEDURE bench.make_wide;
DROP PROCEDURE bench.make_many;
DROP TABLE bench.numbers;

SET foreign_key_checks = 1;
SET unique_checks = 1;
SET autocommit = @old_autocommit;

SELECT '==> done' AS step;

SELECT 'bench.wide columns' AS metric, CAST(COUNT(*) AS CHAR) AS value
  FROM information_schema.columns
 WHERE table_schema = 'bench' AND table_name = 'wide'
UNION ALL
SELECT 'bench.wide rows', CAST(COUNT(*) AS CHAR) FROM bench.wide
UNION ALL
SELECT 'bench.tall rows', CAST(COUNT(*) AS CHAR) FROM bench.tall
UNION ALL
SELECT 'bench_many objects', CAST(COUNT(*) AS CHAR)
  FROM information_schema.tables WHERE table_schema = 'bench_many';
