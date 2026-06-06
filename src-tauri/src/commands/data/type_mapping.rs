use std::collections::BTreeMap;

use mysql_async::Value;
use serde::Serialize;

#[allow(dead_code)]
#[derive(Serialize, specta::Type)]
#[serde(untagged)]
enum JsonValue {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<JsonValue>),
    Object(BTreeMap<String, JsonValue>),
}

// Tagged cell value sent to the frontend.
// serde serialises as {"t":"null"} or {"t":"int","v":42} etc.
#[derive(Serialize, specta::Type, Clone)]
#[serde(tag = "t", content = "v", rename_all = "lowercase")]
pub enum CellValue {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Text(String),
    Json(#[specta(type = JsonValue)] serde_json::Value),
    Other(String),
}

fn pg_cast_for_udt(udt: &str) -> &'static str {
    match udt {
        "int2" | "int4" | "int8" => "bigint",
        "float4" | "float8" | "numeric" | "money" => "numeric",
        "date" => "date",
        "timestamp" | "timestamptz" => "timestamptz",
        "timetz" | "time" => "time",
        "bool" | "boolean" => "boolean",
        "uuid" => "uuid",
        "json" => "json",
        "jsonb" => "jsonb",
        _ => "text",
    }
}

// Map SQL-standard data_type names (from information_schema.columns.data_type) to
// PostgreSQL cast target types. This is a fallback when udt_name doesn't match
// pg_cast_for_udt (e.g. for domain types where udt_name is the domain name while
// data_type is the underlying base type).
fn pg_cast_for_data_type(dt: &str) -> &'static str {
    match dt {
        "smallint" | "integer" | "bigint" => "bigint",
        "real" | "double precision" | "numeric" | "money" => "numeric",
        "date" => "date",
        "timestamp without time zone" | "timestamp with time zone" => "timestamptz",
        "time without time zone" | "time with time zone" => "time",
        "boolean" => "boolean",
        "uuid" => "uuid",
        "json" | "jsonb" => "jsonb",
        "character varying" | "character" | "text" => "text",
        _ => "text",
    }
}

// Resolve the cast target type for a filter comparison on a PostgreSQL column.
// Tries udt_name (internal PG type name) first, then falls back to data_type
// (SQL-standard name) so that domain and custom types still produce valid casts
// (e.g. a domain-over-uuid resolves to "uuid" via data_type).
// For USER-DEFINED types (enums, composites) the udt_name itself is used as the
// cast target so that "type" = $1::text::alert_action_type works instead of
// the broken "type" = $1::text::text.
pub(super) fn resolve_pg_cast(udt_name: &str, data_type: &str) -> String {
    let cast = pg_cast_for_udt(udt_name);
    if cast != "text" {
        return cast.to_string();
    }
    if data_type == "USER-DEFINED" {
        return udt_name.to_string();
    }
    let dt_cast = pg_cast_for_data_type(data_type);
    dt_cast.to_string()
}

// Convert a JSON-array string (e.g. `[1, 2, 3]`) to a PostgreSQL array literal
// (e.g. `{1,2,3}`). Each element is double-quoted to let Postgres do the type
// coercion from text. NULL JSON elements become SQL NULL elements.
pub(super) fn json_to_pg_array_literal(json_str: &str) -> Result<String, String> {
    let arr: serde_json::Value =
        serde_json::from_str(json_str).map_err(|e| format!("Invalid JSON array: {e}"))?;
    let elements = arr
        .as_array()
        .ok_or_else(|| "Expected a JSON array".to_string())?;
    let parts: Vec<String> = elements
        .iter()
        .map(|v| {
            if v.is_null() {
                "NULL".to_string()
            } else {
                let s = match v {
                    serde_json::Value::Number(n) => n.to_string(),
                    serde_json::Value::Bool(b) => if *b { "true" } else { "false" }.to_string(),
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                let escaped = s.replace('\\', "\\\\").replace('"', "\\\"");
                format!("\"{escaped}\"")
            }
        })
        .collect();
    Ok(format!("{{{}}}", parts.join(",")))
}

pub(super) fn pg_native_udt(udt: &str) -> bool {
    matches!(
        udt,
        "bool"
            | "boolean"
            | "int2"
            | "int4"
            | "int8"
            | "float4"
            | "float8"
            | "text"
            | "varchar"
            | "bpchar"
            | "char"
            | "name"
            | "citext"
            | "json"
            | "jsonb"
    )
}

pub(super) fn pg_cell_value(row: &tokio_postgres::Row, i: usize, udt: &str) -> CellValue {
    macro_rules! get_opt {
        ($T:ty, $variant:expr) => {
            match row.try_get::<_, Option<$T>>(i) {
                Ok(None) => CellValue::Null,
                Ok(Some(v)) => $variant(v),
                Err(_) => CellValue::Null,
            }
        };
    }
    match udt {
        "bool" | "boolean" => get_opt!(bool, CellValue::Bool),
        "int2" => get_opt!(i16, |v: i16| CellValue::Int(v as i64)),
        "int4" => get_opt!(i32, |v: i32| CellValue::Int(v as i64)),
        "int8" => get_opt!(i64, CellValue::Int),
        "float4" => get_opt!(f32, |v: f32| CellValue::Float(v as f64)),
        "float8" => get_opt!(f64, CellValue::Float),
        "json" | "jsonb" => get_opt!(serde_json::Value, CellValue::Json),
        "text" | "varchar" | "bpchar" | "char" | "name" | "citext" => {
            get_opt!(String, CellValue::Text)
        }
        _ => match row.try_get::<_, Option<String>>(i) {
            Ok(None) => CellValue::Null,
            Ok(Some(s)) => CellValue::Other(s),
            Err(_) => CellValue::Null,
        },
    }
}

pub(super) fn mysql_cell_value(row: &mysql_async::Row, idx: usize) -> CellValue {
    match row.as_ref(idx) {
        None | Some(Value::NULL) => CellValue::Null,
        Some(Value::Int(n)) => CellValue::Int(*n),
        Some(Value::UInt(n)) => CellValue::Int(*n as i64),
        Some(Value::Float(f)) => CellValue::Float(*f as f64),
        Some(Value::Double(f)) => CellValue::Float(*f),
        Some(Value::Bytes(b)) => CellValue::Text(String::from_utf8_lossy(b).into_owned()),
        Some(Value::Date(y, m, d, h, min, s, _)) => {
            if *h == 0 && *min == 0 && *s == 0 {
                CellValue::Other(format!("{y:04}-{m:02}-{d:02}"))
            } else {
                CellValue::Other(format!("{y:04}-{m:02}-{d:02} {h:02}:{min:02}:{s:02}"))
            }
        }
        Some(Value::Time(neg, days, h, min, s, _)) => {
            let sign = if *neg { "-" } else { "" };
            let total_h = days * 24 + *h as u32;
            CellValue::Other(format!("{sign}{total_h:02}:{min:02}:{s:02}"))
        }
    }
}

pub(super) fn mysql_str(row: &mysql_async::Row, idx: usize) -> Option<String> {
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

    #[test]
    fn user_defined_types_cast_to_the_udt_name() {
        assert_eq!(
            resolve_pg_cast("alert_action_type", "USER-DEFINED"),
            "alert_action_type"
        );
    }

    #[test]
    fn domain_data_type_falls_back_to_base_cast() {
        assert_eq!(resolve_pg_cast("custom_uuid_domain", "uuid"), "uuid");
    }

    #[test]
    fn json_array_literal_quotes_and_escapes_elements() {
        let literal = json_to_pg_array_literal(r#"[1, "a\"b", null, true]"#).unwrap();

        assert_eq!(literal, r#"{"1","a\"b",NULL,"true"}"#);
    }
}
