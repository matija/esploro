use std::collections::HashMap;

use mysql_async::Value;

use super::{validate_column_identifier, ColumnFilter, FilterOperator};

// Returns (where_clauses, param_values).
// All typed casts use $p::text::{cast} so PostgreSQL infers $p as text during
// the extended query describe phase, which &String serialises cleanly.
//
// `col_cast_map` maps column_name -> resolved cast target type (e.g. "uuid",
// "bigint", "numeric"). Map must be built by callers using resolve_pg_cast so
// that domain/custom UDTs resolve correctly via data_type fallback.
pub(super) fn build_pg_where_clause(
    filters: &[ColumnFilter],
    col_cast_map: &HashMap<String, String>,
) -> Result<(Vec<String>, Vec<String>), String> {
    let mut param_values: Vec<String> = vec![];
    let mut where_clauses: Vec<String> = vec![];

    for filter in filters {
        validate_column_identifier(&filter.column)?;
        let col_q = format!("\"{}\"", filter.column);
        // Use the pre-resolved cast type from the map, or fall back to "text"
        // for columns that somehow aren't in the schema (shouldn't happen).
        let cast = col_cast_map
            .get(&filter.column)
            .map(|s| s.as_str())
            .unwrap_or("text");

        let clause = match filter.operator {
            FilterOperator::IsNull => format!("{col_q} IS NULL"),
            FilterOperator::IsNotNull => format!("{col_q} IS NOT NULL"),
            FilterOperator::Like => {
                param_values.push(filter.value.clone().unwrap_or_default());
                let p = param_values.len();
                format!("{col_q}::text LIKE ${p}")
            }
            FilterOperator::ILike => {
                param_values.push(filter.value.clone().unwrap_or_default());
                let p = param_values.len();
                format!("{col_q}::text ILIKE ${p}")
            }
            _ => {
                param_values.push(filter.value.clone().unwrap_or_default());
                let p = param_values.len();
                match filter.operator {
                    FilterOperator::Eq => format!("{col_q} = ${p}::text::{cast}"),
                    FilterOperator::Neq => format!("{col_q} != ${p}::text::{cast}"),
                    FilterOperator::Gt => format!("{col_q} > ${p}::text::{cast}"),
                    FilterOperator::Lt => format!("{col_q} < ${p}::text::{cast}"),
                    FilterOperator::Gte => format!("{col_q} >= ${p}::text::{cast}"),
                    FilterOperator::Lte => format!("{col_q} <= ${p}::text::{cast}"),
                    _ => unreachable!(),
                }
            }
        };
        where_clauses.push(clause);
    }

    Ok((where_clauses, param_values))
}

pub(super) fn build_mysql_where_clause(
    filters: &[ColumnFilter],
) -> Result<(Vec<String>, Vec<Value>), String> {
    let mut param_values: Vec<Value> = vec![];
    let mut where_clauses: Vec<String> = vec![];

    for filter in filters {
        validate_column_identifier(&filter.column)?;
        let col_q = format!("`{}`", filter.column);

        let clause = match filter.operator {
            FilterOperator::IsNull => format!("{col_q} IS NULL"),
            FilterOperator::IsNotNull => format!("{col_q} IS NOT NULL"),
            // MySQL LIKE is case-insensitive by default (UTF-8); treat ILike as Like.
            FilterOperator::Like | FilterOperator::ILike => {
                param_values.push(Value::Bytes(
                    filter.value.clone().unwrap_or_default().into_bytes(),
                ));
                format!("CAST({col_q} AS CHAR) LIKE ?")
            }
            _ => {
                param_values.push(Value::Bytes(
                    filter.value.clone().unwrap_or_default().into_bytes(),
                ));
                match filter.operator {
                    FilterOperator::Eq => format!("{col_q} = ?"),
                    FilterOperator::Neq => format!("{col_q} != ?"),
                    FilterOperator::Gt => format!("{col_q} > ?"),
                    FilterOperator::Lt => format!("{col_q} < ?"),
                    FilterOperator::Gte => format!("{col_q} >= ?"),
                    FilterOperator::Lte => format!("{col_q} <= ?"),
                    _ => unreachable!(),
                }
            }
        };
        where_clauses.push(clause);
    }

    Ok((where_clauses, param_values))
}

// Combines the column-filter WHERE clauses with an optional raw WHERE fragment
// (appended as `AND (<raw>)`) into the final `WHERE ...` SQL, or an empty string
// when there is nothing to filter on. The raw fragment is user-supplied SQL,
// acceptable for a desktop client querying the user's own database.
pub(super) fn build_where_sql(where_clauses: &[String], raw_where: &Option<String>) -> String {
    let mut parts: Vec<String> = where_clauses.to_vec();
    if let Some(raw) = raw_where {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            parts.push(format!("({trimmed})"));
        }
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", parts.join(" AND "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn f(col: &str, op: FilterOperator, val: Option<&str>) -> ColumnFilter {
        ColumnFilter {
            column: col.to_string(),
            operator: op,
            value: val.map(str::to_string),
        }
    }

    #[test]
    fn uuid_eq_uses_text_intermediate() {
        let map = make_map(&[("id", "uuid")]);
        let (clauses, params) =
            build_pg_where_clause(&[f("id", FilterOperator::Eq, Some("abc"))], &map).unwrap();
        assert_eq!(clauses[0], r#""id" = $1::text::uuid"#);
        assert_eq!(params[0], "abc");
    }

    #[test]
    fn date_gt_uses_text_intermediate() {
        let map = make_map(&[("created_at", "date")]);
        let (clauses, params) = build_pg_where_clause(
            &[f("created_at", FilterOperator::Gt, Some("2024-01-01"))],
            &map,
        )
        .unwrap();
        assert_eq!(clauses[0], r#""created_at" > $1::text::date"#);
        assert_eq!(params[0], "2024-01-01");
    }

    #[test]
    fn timestamptz_lt_uses_text_intermediate() {
        let map = make_map(&[("ts", "timestamptz")]);
        let (clauses, _params) = build_pg_where_clause(
            &[f("ts", FilterOperator::Lt, Some("2024-06-01T00:00:00Z"))],
            &map,
        )
        .unwrap();
        assert_eq!(clauses[0], r#""ts" < $1::text::timestamptz"#);
    }

    #[test]
    fn boolean_eq_uses_text_intermediate() {
        let map = make_map(&[("active", "boolean")]);
        let (clauses, _) =
            build_pg_where_clause(&[f("active", FilterOperator::Eq, Some("true"))], &map).unwrap();
        assert_eq!(clauses[0], r#""active" = $1::text::boolean"#);
    }

    #[test]
    fn numeric_gte_uses_text_intermediate() {
        let map = make_map(&[("amount", "numeric")]);
        let (clauses, params) =
            build_pg_where_clause(&[f("amount", FilterOperator::Gte, Some("100.50"))], &map)
                .unwrap();
        assert_eq!(clauses[0], r#""amount" >= $1::text::numeric"#);
        assert_eq!(params[0], "100.50");
    }

    #[test]
    fn text_like_unaffected() {
        let map = make_map(&[("name", "text")]);
        let (clauses, params) =
            build_pg_where_clause(&[f("name", FilterOperator::Like, Some("%foo%"))], &map).unwrap();
        assert_eq!(clauses[0], r#""name"::text LIKE $1"#);
        assert_eq!(params[0], "%foo%");
    }

    #[test]
    fn is_null_produces_no_param() {
        let map = make_map(&[("id", "uuid")]);
        let (clauses, params) =
            build_pg_where_clause(&[f("id", FilterOperator::IsNull, None)], &map).unwrap();
        assert_eq!(clauses[0], r#""id" IS NULL"#);
        assert!(params.is_empty());
    }

    #[test]
    fn multi_filter_params_numbered_sequentially() {
        let map = make_map(&[("id", "uuid"), ("name", "text")]);
        let filters = vec![
            f("id", FilterOperator::Eq, Some("some-uuid")),
            f("name", FilterOperator::Like, Some("%foo%")),
        ];
        let (clauses, params) = build_pg_where_clause(&filters, &map).unwrap();
        assert_eq!(clauses[0], r#""id" = $1::text::uuid"#);
        assert_eq!(clauses[1], r#""name"::text LIKE $2"#);
        assert_eq!(params.len(), 2);
    }

    #[test]
    fn raw_where_only_is_wrapped_in_parens() {
        let sql = build_where_sql(&[], &Some("created_at > now()".to_string()));
        assert_eq!(sql, "WHERE (created_at > now())");
    }

    #[test]
    fn raw_where_appended_to_column_filters_with_and() {
        let sql = build_where_sql(
            &[r#""id" = $1"#.to_string()],
            &Some("lower(email) LIKE '%@x.com'".to_string()),
        );
        assert_eq!(sql, r#"WHERE "id" = $1 AND (lower(email) LIKE '%@x.com')"#);
    }

    #[test]
    fn empty_raw_where_is_ignored() {
        assert_eq!(build_where_sql(&[], &None), "");
        assert_eq!(build_where_sql(&[], &Some("   ".to_string())), "");
        assert_eq!(
            build_where_sql(&[r#""id" = $1"#.to_string()], &Some("".to_string())),
            r#"WHERE "id" = $1"#,
        );
    }
}
