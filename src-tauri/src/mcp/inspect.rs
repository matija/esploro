use crate::{AppError, DriverSession};
use mysql_async::prelude::Queryable;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

const MAX_BYTES: usize = 256_000;
type Target = (String, Option<String>, Option<String>);
static CURSORS: OnceLock<Mutex<HashMap<String, (Target, u64)>>> = OnceLock::new();

pub struct Request {
    target: Target,
    limit: u64,
    position: u64,
}

impl Request {
    pub fn parse(args: &Value) -> Result<Self, &'static str> {
        let invalid = "Invalid inspection arguments or cursor";
        let args = args.as_object().ok_or(invalid)?;
        if args
            .keys()
            .any(|k| !["connectionId", "schema", "object", "limit", "cursor"].contains(&k.as_str()))
        {
            return Err(invalid);
        }
        let text = |key: &str| -> Result<Option<String>, &'static str> {
            args.get(key)
                .map(|v| {
                    v.as_str()
                        .filter(|s| !s.is_empty() && s.len() <= 1024)
                        .map(str::to_owned)
                        .ok_or(invalid)
                })
                .transpose()
        };
        let target = (
            text("connectionId")?.ok_or(invalid)?,
            text("schema")?,
            text("object")?,
        );
        if target.2.is_some() && target.1.is_none() {
            return Err(invalid);
        }
        let limit = args
            .get("limit")
            .map(|v| v.as_u64().filter(|n| (1..=100).contains(n)).ok_or(invalid))
            .transpose()?
            .unwrap_or(50);
        let position = match text("cursor")? {
            None => 0,
            Some(cursor) => {
                let cursors = CURSORS.get_or_init(Default::default).lock().unwrap();
                let (bound, position) = cursors.get(&cursor).ok_or(invalid)?;
                if bound != &target {
                    return Err(invalid);
                }
                *position
            }
        };
        Ok(Self {
            target,
            limit,
            position,
        })
    }

    pub async fn execute(&self, driver: &DriverSession) -> Result<Value, AppError> {
        let mode = if self.target.2.is_some() {
            "columns"
        } else if self.target.1.is_some() {
            "objects"
        } else {
            "schemas"
        };
        let schema = self.target.1.as_deref().unwrap_or("");
        let object = self.target.2.as_deref().unwrap_or("");
        let (fields, source, filter, order) = match mode {
            "schemas" => ("schema_name AS name", "information_schema.schemata", "", "schema_name"),
            "objects" => ("table_name AS name, table_type AS kind", "information_schema.tables", "table_schema = $1", "table_name"),
            _ => ("column_name AS name, data_type AS \"dataType\", (is_nullable = 'YES') AS \"isNullable\", column_default AS \"columnDefault\"", "information_schema.columns", "table_schema = $1 AND table_name = $2", "column_name"),
        };
        let condition = if filter.is_empty() {
            String::new()
        } else {
            format!("WHERE {filter}")
        };
        let sql = format!(
            "SELECT {fields} FROM {source} {condition} ORDER BY {order} COLLATE \"C\" LIMIT {} OFFSET {}",
            self.limit + 1,
            self.position
        );
        let entries: Vec<Value> = match driver {
            DriverSession::Postgres(pool) => {
                let client = deadpool_postgres::Object::take(pool.get().await?);
                let _cancel = super::query::PgCancellation(client.cancel_token());
                let params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = match mode {
                    "schemas" => vec![],
                    "objects" => vec![&schema],
                    _ => vec![&schema, &object],
                };
                client
                    .query(
                        &format!("SELECT row_to_json(entry)::text FROM ({sql}) entry"),
                        &params,
                    )
                    .await?
                    .iter()
                    .map(|r| serde_json::from_str::<Value>(r.get::<_, &str>(0)))
                    .collect::<Result<_, _>>()?
            }
            DriverSession::Mysql(pool) => {
                let mut isolated =
                    crate::db::IsolatedMysql(Some(crate::db::mysql_conn(pool).await?));
                let connection = isolated.0.as_mut().unwrap();
                let _cancel = super::query::MysqlCancellation(pool.clone(), connection.id());
                let fields = match mode {
                    "schemas" => "JSON_OBJECT('name', schema_name)",
                    "objects" => "JSON_OBJECT('name', table_name, 'kind', table_type)",
                    _ => "JSON_OBJECT('name', column_name, 'dataType', column_type, 'isNullable', JSON_EXTRACT(IF(is_nullable = 'YES', 'true', 'false'), '$'), 'columnDefault', column_default)",
                };
                let condition = condition.replace("$1", "?").replace("$2", "?");
                let sql = format!(
                    "SELECT {fields} FROM {source} {condition} ORDER BY BINARY {order} LIMIT {} OFFSET {}",
                    self.limit + 1,
                    self.position
                );
                let params = match mode {
                    "schemas" => vec![],
                    "objects" => vec![schema],
                    _ => vec![schema, object],
                };
                let rows: Vec<String> = connection.exec(sql, params).await?;
                rows.iter()
                    .map(|r| serde_json::from_str(r))
                    .collect::<Result<_, _>>()?
            }
        };
        self.page(mode, entries)
    }

    fn page(&self, mode: &str, entries: Vec<Value>) -> Result<Value, AppError> {
        let mut page = json!({"connectionId":self.target.0,"schema":self.target.1,"object":self.target.2,"mode":mode,mode:[],"truncated":false,"truncationReasons":[],"omittedEntries":0,"nextCursor":null});
        let mut consumed = 0;
        let mut omitted = 0;
        let mut byte_limit = false;
        for entry in entries.iter().take(self.limit as usize) {
            page[mode].as_array_mut().unwrap().push(entry.clone());
            if serde_json::to_vec(&page)?.len() > MAX_BYTES - 512 {
                page[mode].as_array_mut().unwrap().pop();
                byte_limit = true;
                if !page[mode].as_array().unwrap().is_empty() {
                    break;
                }
                omitted += 1;
            }
            consumed += 1;
        }
        let more = entries.len() > consumed;
        if more {
            let cursor = uuid::Uuid::new_v4().to_string();
            let mut cursors = CURSORS.get_or_init(Default::default).lock().unwrap();
            if cursors.len() >= 4096 {
                cursors.clear();
            }
            cursors.insert(
                cursor.clone(),
                (self.target.clone(), self.position + consumed as u64),
            );
            page["nextCursor"] = json!(cursor);
        }
        page["omittedEntries"] = json!(omitted);
        page["truncated"] = json!(more || omitted > 0);
        page["truncationReasons"] = json!(if byte_limit {
            vec!["byteLimit"]
        } else if more {
            vec!["pageLimit"]
        } else {
            vec![]
        });
        Ok(page)
    }
}
