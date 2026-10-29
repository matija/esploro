pub mod activity;
pub mod lifecycle;
pub mod policy;
pub mod server;
pub use server::McpListener;
pub mod query;
pub mod token;
mod tools;
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
    fn policy_defaults_persistence_and_fail_closed_errors() {
        use policy::{McpPolicy, PolicyStore};

        let directory = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("connections.json"), "[]").unwrap();
        let path = directory.join("mcp_policy.json");
        let store = PolicyStore::open(path.clone());
        assert_eq!(store.get(), McpPolicy::default());
        assert!(!store.permits("saved"));
        let allowed = McpPolicy {
            enabled: true,
            permitted_connection_ids: vec!["saved".into()],
            ..McpPolicy::default()
        };
        store.save(allowed.clone()).unwrap();
        let reopened = PolicyStore::open(path.clone());
        assert_eq!(reopened.get(), allowed);
        assert!(reopened.permits("saved"));
        assert!(!reopened.permits("other"));
        let persisted: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(persisted["version"], 1);
        assert_eq!(
            persisted["permittedConnectionIds"],
            serde_json::json!(["saved"])
        );
        store.save(McpPolicy::default()).unwrap();
        assert!(!PolicyStore::open(path.clone()).permits("saved"));
        for invalid in [
            "{",
            "{}",
            r#"{"version":2,"enabled":true,"permittedConnectionIds":["saved"]}"#,
            r#"{"version":1,"enabled":"true","permittedConnectionIds":["saved"]}"#,
            r#"{"version":1,"enabled":true,"permittedConnectionIds":[""]}"#,
        ] {
            std::fs::write(&path, invalid).unwrap();
            let failed = PolicyStore::open(path.clone());
            assert_eq!(failed.get(), McpPolicy::default());
            assert!(!failed.permits("saved"));
        }
        std::fs::write(&path, r#"{"version":1}"#).unwrap();
        assert_eq!(PolicyStore::open(path.clone()).get(), McpPolicy::default());
        store.save(allowed.clone()).unwrap();
        let mut invalid = allowed.clone();
        invalid.version = 2;
        assert!(store.save(invalid).is_err());
        assert!(!store.permits("saved"));
        store.save(allowed.clone()).unwrap();
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        assert!(!PolicyStore::open(path.clone()).permits("saved"));
        assert!(store.save(allowed.clone()).is_err());
        assert_eq!(store.get(), McpPolicy::default());
        assert!(!store.permits("saved"));
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 2);
        std::fs::remove_dir(&path).unwrap();
        std::fs::remove_file(directory.join("connections.json")).unwrap();
        std::fs::remove_dir(&directory).unwrap();
        std::fs::write(&directory, "blocked parent").unwrap();
        let blocked = PolicyStore::open(path);
        assert!(blocked.save(allowed).is_err());
        assert!(!blocked.permits("saved"));
        std::fs::remove_file(directory).unwrap();
    }

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
