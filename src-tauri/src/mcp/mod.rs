pub mod token;
pub mod transport;

use sqlparser::ast::{Expr, Query, SetExpr, Statement, TableFactor, Visit, Visitor};
use sqlparser::dialect::{Dialect, MySqlDialect, PostgreSqlDialect};
use sqlparser::parser::Parser;
use std::ops::ControlFlow;
use std::time::Duration;

pub const ENDPOINT: &str = "http://127.0.0.1:19482/mcp";
pub const HISTORY_RETENTION: usize = 20;
pub const MAX_RESULT_ROWS: usize = 1_000;
pub const MAX_RESULT_PAYLOAD_BYTES: usize = 1_000_000;
pub const QUERY_TIMEOUT: Duration = Duration::from_secs(30);
pub const MAX_CONCURRENT_QUERIES: usize = 2;
pub const MAX_HTTP_BODY_BYTES: usize = 128 * 1024;
pub const MAX_SQL_BYTES: usize = 64 * 1024;

pub enum SqlDialect {
    Postgres,
    Mysql,
}

pub fn validate_sql(sql: &str, dialect: SqlDialect) -> Result<(), String> {
    if sql.contains("/*!") || sql.contains("/*M!") {
        return Err("Executable comments are not allowed".into());
    }
    if sql.len() > MAX_SQL_BYTES {
        return Err("SQL exceeds 64 KiB".into());
    }
    let dialect: &dyn Dialect = match dialect {
        SqlDialect::Postgres => &PostgreSqlDialect {},
        SqlDialect::Mysql => &MySqlDialect {},
    };
    let statements = Parser::parse_sql(dialect, sql).map_err(|e| e.to_string())?;
    if statements.len() != 1 {
        return Err("Exactly one SELECT is required".into());
    }
    match statements.visit(&mut ReadOnly) {
        ControlFlow::Continue(()) => Ok(()),
        ControlFlow::Break(()) => Err("SQL is outside the read-only allowlist".into()),
    }
}

struct ReadOnly;

fn check(ok: bool) -> ControlFlow<()> {
    if ok {
        ControlFlow::Continue(())
    } else {
        ControlFlow::Break(())
    }
}

fn safe_body(body: &SetExpr) -> bool {
    match body {
        SetExpr::Select(s) => {
            s.into.is_none() && s.lateral_views.is_empty() && s.connect_by.is_none()
        }
        SetExpr::Query(_) => true,
        SetExpr::SetOperation { left, right, .. } => safe_body(left) && safe_body(right),
        _ => false,
    }
}

impl Visitor for ReadOnly {
    type Break = ();

    fn pre_visit_statement(&mut self, statement: &Statement) -> ControlFlow<()> {
        check(matches!(statement, Statement::Query(_)))
    }

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<()> {
        check(
            safe_body(&query.body)
                && query.locks.is_empty()
                && query.for_clause.is_none()
                && query.settings.is_none()
                && query.format_clause.is_none()
                && query.pipe_operators.is_empty(),
        )
    }

    fn pre_visit_table_factor(&mut self, table: &TableFactor) -> ControlFlow<()> {
        check(match table {
            TableFactor::Table {
                args,
                with_hints,
                version,
                json_path,
                sample,
                ..
            } => {
                args.is_none()
                    && with_hints.is_empty()
                    && version.is_none()
                    && json_path.is_none()
                    && sample.is_none()
            }
            TableFactor::Derived { .. } | TableFactor::NestedJoin { .. } => true,
            _ => false,
        })
    }

    fn pre_visit_expr(&mut self, expr: &Expr) -> ControlFlow<()> {
        check(match expr {
            Expr::Function(f) => {
                f.name.0.len() == 1
                    && matches!(
                        f.name.to_string().to_ascii_lowercase().as_str(),
                        "count"
                            | "sum"
                            | "avg"
                            | "min"
                            | "max"
                            | "abs"
                            | "round"
                            | "lower"
                            | "upper"
                            | "length"
                            | "coalesce"
                            | "nullif"
                    )
            }
            Expr::Identifier(i) => !i.value.starts_with('@'),
            Expr::CompoundIdentifier(ids) => ids.iter().all(|i| !i.value.starts_with('@')),
            Expr::BinaryOp { op, .. } => !matches!(
                op,
                sqlparser::ast::BinaryOperator::Assignment
                    | sqlparser::ast::BinaryOperator::Custom(_)
                    | sqlparser::ast::BinaryOperator::PGCustomBinaryOperator(_)
            ),
            Expr::Value(_)
            | Expr::Nested(_)
            | Expr::UnaryOp { .. }
            | Expr::IsNull(_)
            | Expr::IsNotNull(_)
            | Expr::IsTrue(_)
            | Expr::IsNotTrue(_)
            | Expr::IsFalse(_)
            | Expr::IsNotFalse(_)
            | Expr::IsUnknown(_)
            | Expr::IsNotUnknown(_)
            | Expr::IsDistinctFrom(..)
            | Expr::IsNotDistinctFrom(..)
            | Expr::InList { .. }
            | Expr::InSubquery { .. }
            | Expr::Between { .. }
            | Expr::Like { .. }
            | Expr::ILike { .. }
            | Expr::Case { .. }
            | Expr::Exists { .. }
            | Expr::Subquery(_)
            | Expr::Tuple(_)
            | Expr::Wildcard(_)
            | Expr::QualifiedWildcard(..) => true,
            _ => false,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_read_queries() {
        for dialect in [SqlDialect::Postgres, SqlDialect::Mysql] {
            for sql in [
                "SELECT 1;",
                "WITH x AS (SELECT id FROM users) SELECT x.id, count(*) FROM x JOIN users u ON u.id = x.id WHERE x.id IN (SELECT id FROM users) GROUP BY x.id HAVING count(*) > 0 ORDER BY x.id LIMIT 10 OFFSET 2",
                "SELECT coalesce(lower(name), 'none'), abs(id) FROM users",
                "SELECT 1 UNION ALL SELECT 2",
            ] {
                assert!(validate_sql(sql, match dialect { SqlDialect::Postgres => SqlDialect::Postgres, SqlDialect::Mysql => SqlDialect::Mysql }).is_ok(), "{sql}");
            }
        }
    }

    #[test]
    fn rejects_unsafe_queries() {
        for sql in [
            "",
            "SELECT 1; SELECT 2",
            "DELETE FROM users",
            "INSERT INTO users VALUES (1)",
            "UPDATE users SET id = 1",
            "DROP TABLE users",
            "BEGIN",
            "COMMIT",
            "SET x = 1",
            "EXPLAIN SELECT 1",
            "CALL foo()",
            "VACUUM",
            "SELECT * INTO copy FROM users",
            "WITH x AS (DELETE FROM users RETURNING *) SELECT * FROM x",
            "WITH x AS (UPDATE users SET id = 1 RETURNING *) SELECT * FROM x",
            "SELECT * FROM users FOR UPDATE",
            "SELECT * FROM users FOR SHARE",
            "SELECT (SELECT id FROM users FOR UPDATE)",
            "SELECT pg_sleep(1)",
            "SELECT nextval('seq')",
            "SELECT custom_function()",
            "SELECT public.count(*) FROM users",
            "SELECT * FROM custom_function()",
            "SELECT count(pg_sleep(1))",
            "SELECT @x := 1",
            "SELECT 1 INTO OUTFILE '/tmp/x'",
            "SELECT 1 INTO DUMPFILE '/tmp/x'",
            "SELECT * FROM users LOCK IN SHARE MODE",
            "SELECT get_lock('x', 1)",
            "SELECT 1 /*! INTO OUTFILE '/tmp/x' */",
            "SELECT 1 /*M! INTO OUTFILE '/tmp/x' */",
        ] {
            assert!(
                validate_sql(sql, SqlDialect::Postgres).is_err(),
                "postgres: {sql}"
            );
            assert!(
                validate_sql(sql, SqlDialect::Mysql).is_err(),
                "mysql: {sql}"
            );
        }
    }

    #[test]
    fn uses_database_dialects() {
        assert!(validate_sql("SELECT `id` FROM `users` LIMIT 2, 10", SqlDialect::Mysql).is_ok());
        assert!(validate_sql("SELECT `id` FROM `users`", SqlDialect::Postgres).is_err());
        assert!(validate_sql(
            "SELECT \"id\" FROM \"users\" FETCH FIRST 10 ROWS ONLY",
            SqlDialect::Postgres
        )
        .is_ok());
        assert!(validate_sql(
            "SELECT 'pg_sleep(1); DELETE FROM users'",
            SqlDialect::Postgres
        )
        .is_ok());
        assert!(validate_sql(
            "SELECT count(*) FROM (SELECT * FROM users FOR UPDATE) x",
            SqlDialect::Postgres
        )
        .is_err());
    }

    #[test]
    fn enforces_utf8_sql_limit() {
        assert!(validate_sql(
            &format!("SELECT '{}'", "é".repeat(MAX_SQL_BYTES / 2)),
            SqlDialect::Postgres
        )
        .is_err());
    }
}
