use std::collections::HashMap;
use std::sync::Arc;

use mysql_async::prelude::Queryable;
use serde::Serialize;
use tauri::State;
use tokio::sync::Mutex;

use crate::{AppError, AppState, DriverSession};

#[derive(Serialize, specta::Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TableSummary {
    pub name: String,
    pub estimated_row_count: Option<i64>,
}

#[derive(Serialize, specta::Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FunctionSummary {
    pub name: String,
    pub result_type: String,
}

#[derive(Serialize, specta::Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SchemaObjects {
    pub tables: Vec<TableSummary>,
    pub views: Vec<String>,
    pub sequences: Vec<String>,
    pub functions: Vec<FunctionSummary>,
}

#[derive(Serialize, specta::Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDef {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub column_default: Option<String>,
    pub is_primary_key: bool,
    pub is_foreign_key: bool,
    pub foreign_key_ref: Option<String>,
    pub is_enum: bool,
}

// ─── Introspection cache ─────────────────────────────────────────────────────

/// Identifies one cached introspection scope. `database` is carried even though
/// the object/column queries resolve against the session's current catalog, so
/// that a session pointed at a different database never reads another one's
/// entry.
#[derive(PartialEq, Eq, Hash, Clone, Debug)]
pub struct SchemaCacheKey {
    pub session_id: String,
    pub database: String,
    pub schema: String,
}

/// Everything introspected for a single (session, database, schema) scope.
/// `objects` and `columns` fill in independently: the tree lists objects first
/// and only asks for columns once a table is expanded.
#[derive(Default)]
pub struct SchemaCacheEntry {
    pub objects: Option<SchemaObjects>,
    /// table name -> its columns
    pub columns: HashMap<String, Vec<ColumnDef>>,
}

/// Session-scoped introspection results, cleared on explicit refresh, on
/// disconnect, and whenever DDL runs through `execute_sql`.
#[derive(Default)]
pub struct SchemaCache {
    entries: Mutex<HashMap<SchemaCacheKey, SchemaCacheEntry>>,
}

impl SchemaCache {
    pub async fn cached_objects(&self, key: &SchemaCacheKey) -> Option<SchemaObjects> {
        let entries = self.entries.lock().await;
        entries.get(key)?.objects.clone()
    }

    pub async fn store_objects(&self, key: SchemaCacheKey, objects: &SchemaObjects) {
        let mut entries = self.entries.lock().await;
        entries.entry(key).or_default().objects = Some(objects.clone());
    }

    pub async fn cached_columns(
        &self,
        key: &SchemaCacheKey,
        table: &str,
    ) -> Option<Vec<ColumnDef>> {
        let entries = self.entries.lock().await;
        entries.get(key)?.columns.get(table).cloned()
    }

    pub async fn store_columns(&self, key: SchemaCacheKey, table: &str, columns: &[ColumnDef]) {
        let mut entries = self.entries.lock().await;
        entries
            .entry(key)
            .or_default()
            .columns
            .insert(table.to_string(), columns.to_vec());
    }

    /// Drops every entry for `session_id`, optionally narrowed to one database
    /// and/or one schema within it. Used by all three invalidation paths.
    pub async fn invalidate(&self, session_id: &str, database: Option<&str>, schema: Option<&str>) {
        let mut entries = self.entries.lock().await;
        entries.retain(|key, _| {
            !(key.session_id == session_id
                && database.is_none_or(|db| key.database == db)
                && schema.is_none_or(|s| key.schema == s))
        });
    }
}

/// Leading keywords that can change the shape of a schema. `execute_sql` runs
/// arbitrary user SQL, so anything that might be DDL invalidates the session's
/// cache rather than trying to pin down exactly what changed.
const DDL_KEYWORDS: &[&str] = &[
    "create", "alter", "drop", "truncate", "rename", "comment", "grant", "revoke", "refresh",
    "import", "reindex", "security",
];

/// True when any statement in `sql` starts with a DDL keyword. Deliberately
/// errs towards invalidating: a false positive costs one re-introspection,
/// while a false negative leaves the tree showing objects that no longer exist.
pub fn sql_contains_ddl(sql: &str) -> bool {
    sql.split(';').any(|stmt| {
        let stripped = strip_leading_noise(stmt);
        let first_word: String = stripped
            .chars()
            .take_while(|c| c.is_alphabetic())
            .flat_map(char::to_lowercase)
            .collect();
        DDL_KEYWORDS.contains(&first_word.as_str())
    })
}

/// Skips whitespace and leading `--` line comments / `/* */` block comments so
/// the first real keyword of a statement can be inspected.
fn strip_leading_noise(stmt: &str) -> &str {
    let mut rest = stmt.trim_start();
    loop {
        if let Some(after) = rest.strip_prefix("--") {
            rest = match after.find('\n') {
                Some(idx) => &after[idx + 1..],
                None => "",
            };
        } else if let Some(after) = rest.strip_prefix("/*") {
            rest = match after.find("*/") {
                Some(idx) => &after[idx + 2..],
                None => "",
            };
        } else {
            return rest;
        }
        rest = rest.trim_start();
    }
}

// ─── refresh_schema_cache ────────────────────────────────────────────────────

/// Explicitly drops cached introspection for a session. Omitting `database`
/// and/or `schema` widens the reset: `None`/`None` clears the whole session.
#[tauri::command]
#[specta::specta]
pub async fn refresh_schema_cache(
    session_id: String,
    database: Option<String>,
    schema: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state
        .schema_cache
        .invalidate(&session_id, database.as_deref(), schema.as_deref())
        .await;
    Ok(())
}

// ─── Driver lookup ───────────────────────────────────────────────────────────

/// A session's pool, cloned out of `AppState::sessions` so the sessions lock is
/// released before the (potentially slow) introspection query runs.
enum PoolHandle {
    Pg(Arc<deadpool_postgres::Pool>),
    Mysql(Arc<mysql_async::Pool>),
}

async fn pool_for(state: &AppState, session_id: &str) -> Result<PoolHandle, AppError> {
    let sessions = state.sessions.lock().await;
    let info = sessions.get(session_id).ok_or(AppError::SessionNotFound)?;
    Ok(match &info.driver {
        DriverSession::Postgres(pool) => PoolHandle::Pg(pool.clone()),
        DriverSession::Mysql(pool) => PoolHandle::Mysql(pool.clone()),
    })
}

// ─── list_schemas ────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn list_schemas(
    session_id: String,
    database: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let sessions = state.sessions.lock().await;
    let info = sessions.get(&session_id).ok_or(AppError::SessionNotFound)?;

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await?;
            let rows = client
                .query(
                    "SELECT schema_name \
                     FROM information_schema.schemata \
                     WHERE catalog_name = current_database() \
                       AND schema_name NOT IN \
                         ('pg_catalog','information_schema','pg_toast') \
                       AND schema_name NOT LIKE 'pg_temp_%' \
                       AND schema_name NOT LIKE 'pg_toast_temp_%' \
                     ORDER BY schema_name",
                    &[],
                )
                .await?;
            Ok(rows.iter().map(|r| r.get::<_, String>(0)).collect())
        }
        DriverSession::Mysql(_) => {
            // MySQL has no schema level; return the database name as pseudo-schema
            // so the tree can fetch objects without additional branching.
            Ok(vec![database])
        }
    }
}

// ─── list_objects ────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn list_objects(
    session_id: String,
    database: String,
    schema: String,
    state: State<'_, AppState>,
) -> Result<SchemaObjects, AppError> {
    let key = SchemaCacheKey {
        session_id: session_id.clone(),
        database,
        schema: schema.clone(),
    };
    if let Some(cached) = state.schema_cache.cached_objects(&key).await {
        return Ok(cached);
    }

    let objects = match pool_for(&state, &session_id).await? {
        PoolHandle::Pg(pool) => {
            let client = pool.get().await?;

            let table_rows = client
                .query(
                    "SELECT t.table_name, t.table_type, \
                            CASE WHEN s.reltuples >= 0 THEN s.reltuples::bigint ELSE NULL END \
                     FROM information_schema.tables t \
                     LEFT JOIN pg_class s \
                       ON s.relname = t.table_name \
                       AND s.relnamespace = \
                         (SELECT oid FROM pg_namespace WHERE nspname = $1) \
                     WHERE t.table_schema = $1 \
                     ORDER BY t.table_type, t.table_name",
                    &[&schema],
                )
                .await?;

            let mut tables = Vec::new();
            let mut views = Vec::new();
            for row in &table_rows {
                let name: String = row.get(0);
                let table_type: String = row.get(1);
                let estimated_rows: Option<i64> = row.get(2);
                if table_type == "BASE TABLE" {
                    tables.push(TableSummary {
                        name,
                        estimated_row_count: estimated_rows,
                    });
                } else {
                    views.push(name);
                }
            }

            let seq_rows = client
                .query(
                    "SELECT sequence_name FROM information_schema.sequences \
                     WHERE sequence_schema = $1 ORDER BY sequence_name",
                    &[&schema],
                )
                .await?;
            let sequences: Vec<String> = seq_rows.iter().map(|r| r.get(0)).collect();

            let fn_rows = client
                .query(
                    "SELECT p.proname, pg_get_function_result(p.oid) \
                     FROM pg_proc p \
                     JOIN pg_namespace n ON n.oid = p.pronamespace \
                     WHERE n.nspname = $1 AND p.prokind = 'f' \
                     ORDER BY p.proname",
                    &[&schema],
                )
                .await?;
            let functions: Vec<FunctionSummary> = fn_rows
                .iter()
                .map(|r| FunctionSummary {
                    name: r.get(0),
                    result_type: r.get(1),
                })
                .collect();

            SchemaObjects {
                tables,
                views,
                sequences,
                functions,
            }
        }
        PoolHandle::Mysql(pool) => {
            // For MySQL, `schema` is the database name.
            let mut conn = pool.get_conn().await?;
            let rows: Vec<mysql_async::Row> = conn
                .exec(
                    "SELECT TABLE_NAME, TABLE_TYPE \
                     FROM information_schema.TABLES \
                     WHERE TABLE_SCHEMA = ? \
                     ORDER BY TABLE_TYPE, TABLE_NAME",
                    (&schema,),
                )
                .await?;

            let mut tables = Vec::new();
            let mut views = Vec::new();
            for row in &rows {
                let name = mysql_str(row, 0).unwrap_or_default();
                let table_type = mysql_str(row, 1).unwrap_or_default();
                if table_type == "BASE TABLE" {
                    tables.push(TableSummary {
                        name,
                        estimated_row_count: None,
                    });
                } else if table_type == "VIEW" {
                    views.push(name);
                }
            }

            SchemaObjects {
                tables,
                views,
                sequences: vec![],
                functions: vec![],
            }
        }
    };

    state.schema_cache.store_objects(key, &objects).await;
    Ok(objects)
}

// ─── list_columns ────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn list_columns(
    session_id: String,
    database: String,
    schema: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<Vec<ColumnDef>, AppError> {
    let key = SchemaCacheKey {
        session_id: session_id.clone(),
        database,
        schema: schema.clone(),
    };
    if let Some(cached) = state.schema_cache.cached_columns(&key, &table).await {
        return Ok(cached);
    }

    let columns: Vec<ColumnDef> = match pool_for(&state, &session_id).await? {
        PoolHandle::Pg(pool) => {
            let client = pool.get().await?;
            let rows = client
                .query(
                    "SELECT \
                       a.attname, \
                       t.typname, \
                       NOT a.attnotnull, \
                       pg_get_expr(d.adbin, d.adrelid), \
                       EXISTS ( \
                         SELECT 1 FROM pg_constraint con \
                         WHERE con.conrelid = a.attrelid \
                           AND con.contype = 'p' \
                           AND a.attnum = ANY(con.conkey) \
                       ), \
                       EXISTS ( \
                         SELECT 1 FROM pg_constraint con \
                         WHERE con.conrelid = a.attrelid \
                           AND con.contype = 'f' \
                           AND a.attnum = ANY(con.conkey) \
                       ), \
                       t.typtype = 'e' \
                     FROM pg_attribute a \
                     JOIN pg_class c ON c.oid = a.attrelid \
                     JOIN pg_namespace n ON n.oid = c.relnamespace \
                     JOIN pg_type t ON t.oid = a.atttypid \
                     LEFT JOIN pg_attrdef d \
                       ON d.adrelid = a.attrelid AND d.adnum = a.attnum \
                     WHERE n.nspname = $1 \
                       AND c.relname = $2 \
                       AND a.attnum > 0 \
                       AND NOT a.attisdropped \
                     ORDER BY a.attnum",
                    &[&schema, &table],
                )
                .await?;

            rows.iter()
                .map(|r| ColumnDef {
                    name: r.get(0),
                    data_type: r.get(1),
                    is_nullable: r.get(2),
                    column_default: r.get(3),
                    is_primary_key: r.get(4),
                    is_foreign_key: r.get(5),
                    foreign_key_ref: None,
                    is_enum: r.get(6),
                })
                .collect()
        }
        PoolHandle::Mysql(pool) => {
            // For MySQL, `schema` is the database name.
            let mut conn = pool.get_conn().await?;
            let rows: Vec<mysql_async::Row> = conn
                .exec(
                    "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT \
                     FROM information_schema.COLUMNS \
                     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
                     ORDER BY ORDINAL_POSITION",
                    (&schema, &table),
                )
                .await?;

            rows.iter()
                .map(|r| {
                    let col_type = mysql_str(r, 1).unwrap_or_default();
                    let col_key = mysql_str(r, 3).unwrap_or_default();
                    let is_enum = col_type.to_lowercase().starts_with("enum");
                    ColumnDef {
                        name: mysql_str(r, 0).unwrap_or_default(),
                        data_type: col_type,
                        is_nullable: mysql_str(r, 2).as_deref() == Some("YES"),
                        column_default: mysql_str(r, 4),
                        is_primary_key: col_key == "PRI",
                        is_foreign_key: col_key == "MUL",
                        foreign_key_ref: None,
                        is_enum,
                    }
                })
                .collect()
        }
    };

    state
        .schema_cache
        .store_columns(key, &table, &columns)
        .await;
    Ok(columns)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn mysql_str(row: &mysql_async::Row, idx: usize) -> Option<String> {
    use mysql_async::Value;
    match row.as_ref(idx)? {
        Value::NULL => None,
        Value::Bytes(b) => Some(String::from_utf8_lossy(b).into_owned()),
        Value::Int(n) => Some(n.to_string()),
        Value::UInt(n) => Some(n.to_string()),
        Value::Float(f) => Some(f.to_string()),
        Value::Double(f) => Some(f.to_string()),
        Value::Date(y, m, d, h, min, s, _) => {
            if *h == 0 && *min == 0 && *s == 0 {
                Some(format!("{y:04}-{m:02}-{d:02}"))
            } else {
                Some(format!("{y:04}-{m:02}-{d:02} {h:02}:{min:02}:{s:02}"))
            }
        }
        Value::Time(neg, days, h, min, s, _) => {
            let sign = if *neg { "-" } else { "" };
            let total_h = days * 24 + *h as u32;
            Some(format!("{sign}{total_h:02}:{min:02}:{s:02}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(session: &str, database: &str, schema: &str) -> SchemaCacheKey {
        SchemaCacheKey {
            session_id: session.into(),
            database: database.into(),
            schema: schema.into(),
        }
    }

    fn objects(table: &str) -> SchemaObjects {
        SchemaObjects {
            tables: vec![TableSummary {
                name: table.into(),
                estimated_row_count: None,
            }],
            views: vec![],
            sequences: vec![],
            functions: vec![],
        }
    }

    fn column(name: &str) -> ColumnDef {
        ColumnDef {
            name: name.into(),
            data_type: "text".into(),
            is_nullable: true,
            column_default: None,
            is_primary_key: false,
            is_foreign_key: false,
            foreign_key_ref: None,
            is_enum: false,
        }
    }

    #[tokio::test]
    async fn objects_and_columns_round_trip_per_key() {
        let cache = SchemaCache::default();
        cache
            .store_objects(key("s1", "db", "public"), &objects("users"))
            .await;
        cache
            .store_columns(key("s1", "db", "public"), "users", &[column("id")])
            .await;

        let cached = cache
            .cached_objects(&key("s1", "db", "public"))
            .await
            .unwrap();
        assert_eq!(cached.tables[0].name, "users");
        let cols = cache
            .cached_columns(&key("s1", "db", "public"), "users")
            .await
            .unwrap();
        assert_eq!(cols[0].name, "id");

        // A different session, database, or schema is a different scope.
        assert!(cache
            .cached_objects(&key("s2", "db", "public"))
            .await
            .is_none());
        assert!(cache
            .cached_objects(&key("s1", "other", "public"))
            .await
            .is_none());
        assert!(cache
            .cached_objects(&key("s1", "db", "sales"))
            .await
            .is_none());
        assert!(cache
            .cached_columns(&key("s1", "db", "public"), "orders")
            .await
            .is_none());
    }

    #[tokio::test]
    async fn invalidate_narrows_by_database_and_schema() {
        let cache = SchemaCache::default();
        for k in [
            key("s1", "db", "public"),
            key("s1", "db", "sales"),
            key("s1", "other", "public"),
            key("s2", "db", "public"),
        ] {
            cache.store_objects(k, &objects("users")).await;
        }

        cache.invalidate("s1", Some("db"), Some("public")).await;
        assert!(cache
            .cached_objects(&key("s1", "db", "public"))
            .await
            .is_none());
        assert!(cache
            .cached_objects(&key("s1", "db", "sales"))
            .await
            .is_some());
        assert!(cache
            .cached_objects(&key("s2", "db", "public"))
            .await
            .is_some());

        cache.invalidate("s1", Some("db"), None).await;
        assert!(cache
            .cached_objects(&key("s1", "db", "sales"))
            .await
            .is_none());
        assert!(cache
            .cached_objects(&key("s1", "other", "public"))
            .await
            .is_some());

        cache.invalidate("s1", None, None).await;
        assert!(cache
            .cached_objects(&key("s1", "other", "public"))
            .await
            .is_none());
        // Other sessions are untouched by a session-wide invalidation.
        assert!(cache
            .cached_objects(&key("s2", "db", "public"))
            .await
            .is_some());
    }

    #[tokio::test]
    async fn invalidate_drops_columns_along_with_objects() {
        let cache = SchemaCache::default();
        cache
            .store_columns(key("s1", "db", "public"), "users", &[column("id")])
            .await;

        cache.invalidate("s1", None, None).await;

        assert!(cache
            .cached_columns(&key("s1", "db", "public"), "users")
            .await
            .is_none());
    }

    #[test]
    fn detects_ddl_regardless_of_case_position_or_comments() {
        assert!(sql_contains_ddl("CREATE TABLE t (id int)"));
        assert!(sql_contains_ddl("  drop table t  "));
        assert!(sql_contains_ddl("SELECT 1; ALTER TABLE t ADD COLUMN c int"));
        assert!(sql_contains_ddl("-- set up\nCREATE INDEX i ON t (c)"));
        assert!(sql_contains_ddl("/* migration */ TRUNCATE t"));
        assert!(sql_contains_ddl("GRANT SELECT ON t TO analyst"));
    }

    #[test]
    fn leaves_pure_dml_alone() {
        assert!(!sql_contains_ddl("SELECT * FROM users"));
        assert!(!sql_contains_ddl(
            "INSERT INTO t VALUES (1); UPDATE t SET c = 2"
        ));
        assert!(!sql_contains_ddl("DELETE FROM t WHERE id = 1"));
        // A DDL keyword that is not the leading keyword is not a schema change.
        assert!(!sql_contains_ddl("SELECT 'create table' AS note"));
        assert!(!sql_contains_ddl(""));
    }
}
