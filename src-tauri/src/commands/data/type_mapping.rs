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
    /// A value clipped by the payload guard in `table_queries`. Carries the
    /// clipped rendering plus the `truncated` flag the UI branches on, so an
    /// oversized cell still round-trips as a displayable string.
    Truncated(TruncatedCell),
}

/// Payload of [`CellValue::Truncated`]: the clipped prefix of an oversized
/// cell, the always-set truncation flag, and the original byte length so the
/// UI can tell the user how much was dropped.
#[derive(Serialize, specta::Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TruncatedCell {
    pub value: String,
    pub truncated: bool,
    pub original_bytes: usize,
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
        None => CellValue::Null,
        Some(value) => mysql_value_to_cell(value),
    }
}

pub(super) fn mysql_value_to_cell(value: &Value) -> CellValue {
    match value {
        Value::NULL => CellValue::Null,
        Value::Int(n) => CellValue::Int(*n),
        Value::UInt(n) => CellValue::Int(*n as i64),
        Value::Float(f) => CellValue::Float(*f as f64),
        Value::Double(f) => CellValue::Float(*f),
        Value::Bytes(b) => CellValue::Text(String::from_utf8_lossy(b).into_owned()),
        Value::Date(y, m, d, h, min, s, _) => {
            if *h == 0 && *min == 0 && *s == 0 {
                CellValue::Other(format!("{y:04}-{m:02}-{d:02}"))
            } else {
                CellValue::Other(format!("{y:04}-{m:02}-{d:02} {h:02}:{min:02}:{s:02}"))
            }
        }
        Value::Time(neg, days, h, min, s, _) => {
            let sign = if *neg { "-" } else { "" };
            let total_h = days * 24 + *h as u32;
            CellValue::Other(format!("{sign}{total_h:02}:{min:02}:{s:02}"))
        }
    }
}

pub(super) fn mysql_str(row: &mysql_async::Row, idx: usize) -> Option<String> {
    mysql_value_to_str(row.as_ref(idx)?)
}

pub(super) fn mysql_value_to_str(value: &Value) -> Option<String> {
    match value {
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

    // CellValue has no PartialEq; compare the serialised wire shape the
    // frontend actually receives instead.
    fn tagged(value: &CellValue) -> serde_json::Value {
        serde_json::to_value(value).unwrap()
    }

    fn tag(t: &str) -> serde_json::Value {
        serde_json::json!({ "t": t })
    }

    fn tag_v(t: &str, v: serde_json::Value) -> serde_json::Value {
        serde_json::json!({ "t": t, "v": v })
    }

    #[test]
    fn pg_numeric_udts_resolve_to_bigint_or_numeric_casts() {
        for udt in ["int2", "int4", "int8"] {
            assert_eq!(resolve_pg_cast(udt, "integer"), "bigint");
        }
        for udt in ["float4", "float8", "numeric", "money"] {
            assert_eq!(resolve_pg_cast(udt, "numeric"), "numeric");
        }
    }

    #[test]
    fn pg_temporal_and_scalar_udts_resolve_to_their_own_casts() {
        assert_eq!(resolve_pg_cast("date", "date"), "date");
        assert_eq!(
            resolve_pg_cast("timestamp", "timestamp without time zone"),
            "timestamptz"
        );
        assert_eq!(
            resolve_pg_cast("timestamptz", "timestamp with time zone"),
            "timestamptz"
        );
        assert_eq!(resolve_pg_cast("time", "time without time zone"), "time");
        assert_eq!(resolve_pg_cast("timetz", "time with time zone"), "time");
        assert_eq!(resolve_pg_cast("bool", "boolean"), "boolean");
        assert_eq!(resolve_pg_cast("uuid", "uuid"), "uuid");
        assert_eq!(resolve_pg_cast("json", "json"), "json");
        assert_eq!(resolve_pg_cast("jsonb", "jsonb"), "jsonb");
    }

    #[test]
    fn unknown_pg_types_fall_back_to_text() {
        assert_eq!(resolve_pg_cast("inet", "inet"), "text");
        assert_eq!(resolve_pg_cast("varchar", "character varying"), "text");
    }

    #[test]
    fn pg_native_udts_are_read_without_a_text_cast() {
        for udt in [
            "bool", "boolean", "int2", "int4", "int8", "float4", "float8", "text", "varchar",
            "bpchar", "char", "name", "citext", "json", "jsonb",
        ] {
            assert!(pg_native_udt(udt), "{udt} should be native");
        }
        for udt in ["uuid", "date", "timestamptz", "numeric", "inet", "_int4"] {
            assert!(!pg_native_udt(udt), "{udt} should not be native");
        }
    }

    #[test]
    fn json_array_literal_rejects_non_arrays_and_invalid_json() {
        assert!(json_to_pg_array_literal("{}")
            .unwrap_err()
            .contains("Expected a JSON array"));
        assert!(json_to_pg_array_literal("[1,")
            .unwrap_err()
            .contains("Invalid JSON array"));
    }

    #[test]
    fn json_array_literal_escapes_backslashes_and_nests_objects() {
        assert_eq!(
            json_to_pg_array_literal(r#"["a\\b"]"#).unwrap(),
            r#"{"a\\b"}"#
        );
        assert_eq!(json_to_pg_array_literal("[]").unwrap(), "{}");
    }

    #[test]
    fn mysql_null_and_integers_map_to_tagged_cells() {
        assert_eq!(tagged(&mysql_value_to_cell(&Value::NULL)), tag("null"));
        assert_eq!(
            tagged(&mysql_value_to_cell(&Value::Int(-7))),
            tag_v("int", serde_json::json!(-7))
        );
        assert_eq!(
            tagged(&mysql_value_to_cell(&Value::UInt(7))),
            tag_v("int", serde_json::json!(7))
        );
    }

    #[test]
    fn mysql_floats_and_bytes_map_to_tagged_cells() {
        assert_eq!(
            tagged(&mysql_value_to_cell(&Value::Float(1.5))),
            tag_v("float", serde_json::json!(1.5))
        );
        assert_eq!(
            tagged(&mysql_value_to_cell(&Value::Double(2.25))),
            tag_v("float", serde_json::json!(2.25))
        );
        assert_eq!(
            tagged(&mysql_value_to_cell(&Value::Bytes(b"hello".to_vec()))),
            tag_v("text", serde_json::json!("hello"))
        );
    }

    #[test]
    fn mysql_invalid_utf8_bytes_are_lossily_decoded_rather_than_dropped() {
        assert_eq!(
            tagged(&mysql_value_to_cell(&Value::Bytes(vec![0xff, 0xfe]))),
            tag_v("text", serde_json::json!("\u{fffd}\u{fffd}"))
        );
    }

    #[test]
    fn mysql_dates_drop_a_zero_time_component() {
        assert_eq!(
            tagged(&mysql_value_to_cell(&Value::Date(2024, 1, 2, 0, 0, 0, 0))),
            tag_v("other", serde_json::json!("2024-01-02"))
        );
        assert_eq!(
            tagged(&mysql_value_to_cell(&Value::Date(2024, 1, 2, 3, 4, 5, 0))),
            tag_v("other", serde_json::json!("2024-01-02 03:04:05"))
        );
    }

    #[test]
    fn mysql_times_roll_days_into_hours_and_keep_the_sign() {
        assert_eq!(
            tagged(&mysql_value_to_cell(&Value::Time(false, 1, 2, 3, 4, 0))),
            tag_v("other", serde_json::json!("26:03:04"))
        );
        assert_eq!(
            tagged(&mysql_value_to_cell(&Value::Time(true, 0, 2, 3, 4, 0))),
            tag_v("other", serde_json::json!("-02:03:04"))
        );
    }

    #[test]
    fn mysql_str_stringifies_every_value_kind_except_null() {
        assert_eq!(mysql_value_to_str(&Value::NULL), None);
        assert_eq!(
            mysql_value_to_str(&Value::Bytes(b"public".to_vec())).as_deref(),
            Some("public")
        );
        assert_eq!(mysql_value_to_str(&Value::Int(-7)).as_deref(), Some("-7"));
        assert_eq!(mysql_value_to_str(&Value::UInt(7)).as_deref(), Some("7"));
        assert_eq!(
            mysql_value_to_str(&Value::Double(2.25)).as_deref(),
            Some("2.25")
        );
        assert_eq!(
            mysql_value_to_str(&Value::Date(2024, 1, 2, 0, 0, 0, 0)).as_deref(),
            Some("2024-01-02")
        );
        assert_eq!(
            mysql_value_to_str(&Value::Time(true, 1, 2, 3, 4, 0)).as_deref(),
            Some("-26:03:04")
        );
    }
}
