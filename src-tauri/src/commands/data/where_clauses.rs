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

    fn bytes(s: &str) -> Value {
        Value::Bytes(s.as_bytes().to_vec())
    }

    #[test]
    fn pg_comparison_operators_all_cast_through_text() {
        let map = make_map(&[("n", "bigint")]);
        let filters = vec![
            f("n", FilterOperator::Eq, Some("1")),
            f("n", FilterOperator::Neq, Some("2")),
            f("n", FilterOperator::Gt, Some("3")),
            f("n", FilterOperator::Lt, Some("4")),
            f("n", FilterOperator::Gte, Some("5")),
            f("n", FilterOperator::Lte, Some("6")),
        ];

        let (clauses, params) = build_pg_where_clause(&filters, &map).unwrap();

        assert_eq!(
            clauses,
            vec![
                r#""n" = $1::text::bigint"#,
                r#""n" != $2::text::bigint"#,
                r#""n" > $3::text::bigint"#,
                r#""n" < $4::text::bigint"#,
                r#""n" >= $5::text::bigint"#,
                r#""n" <= $6::text::bigint"#,
            ]
        );
        assert_eq!(params, vec!["1", "2", "3", "4", "5", "6"]);
    }

    #[test]
    fn mysql_comparison_operators_use_positional_placeholders_without_casts() {
        let filters = vec![
            f("n", FilterOperator::Eq, Some("1")),
            f("n", FilterOperator::Neq, Some("2")),
            f("n", FilterOperator::Gt, Some("3")),
            f("n", FilterOperator::Lt, Some("4")),
            f("n", FilterOperator::Gte, Some("5")),
            f("n", FilterOperator::Lte, Some("6")),
        ];

        let (clauses, params) = build_mysql_where_clause(&filters).unwrap();

        assert_eq!(
            clauses,
            vec!["`n` = ?", "`n` != ?", "`n` > ?", "`n` < ?", "`n` >= ?", "`n` <= ?",]
        );
        assert_eq!(
            params,
            vec![
                bytes("1"),
                bytes("2"),
                bytes("3"),
                bytes("4"),
                bytes("5"),
                bytes("6")
            ]
        );
    }

    #[test]
    fn mysql_eq_ignores_the_column_type_and_binds_bytes() {
        let (clauses, params) =
            build_mysql_where_clause(&[f("id", FilterOperator::Eq, Some("abc"))]).unwrap();

        assert_eq!(clauses[0], "`id` = ?");
        assert_eq!(params[0], bytes("abc"));
    }

    #[test]
    fn mysql_like_casts_the_column_to_char() {
        let (clauses, params) =
            build_mysql_where_clause(&[f("name", FilterOperator::Like, Some("%foo%"))]).unwrap();

        assert_eq!(clauses[0], "CAST(`name` AS CHAR) LIKE ?");
        assert_eq!(params[0], bytes("%foo%"));
    }

    #[test]
    fn pg_ilike_has_a_dedicated_operator_while_mysql_reuses_like() {
        let map = make_map(&[("name", "text")]);
        let (pg_clauses, _) =
            build_pg_where_clause(&[f("name", FilterOperator::ILike, Some("%foo%"))], &map)
                .unwrap();
        let (mysql_clauses, _) =
            build_mysql_where_clause(&[f("name", FilterOperator::ILike, Some("%foo%"))]).unwrap();

        assert_eq!(pg_clauses[0], r#""name"::text ILIKE $1"#);
        assert_eq!(mysql_clauses[0], "CAST(`name` AS CHAR) LIKE ?");
    }

    #[test]
    fn mysql_null_checks_produce_no_params() {
        let (clauses, params) = build_mysql_where_clause(&[
            f("id", FilterOperator::IsNull, None),
            f("name", FilterOperator::IsNotNull, None),
        ])
        .unwrap();

        assert_eq!(clauses, vec!["`id` IS NULL", "`name` IS NOT NULL"]);
        assert!(params.is_empty());
    }

    #[test]
    fn pg_is_not_null_produces_no_param() {
        let map = make_map(&[("name", "text")]);
        let (clauses, params) =
            build_pg_where_clause(&[f("name", FilterOperator::IsNotNull, None)], &map).unwrap();

        assert_eq!(clauses[0], r#""name" IS NOT NULL"#);
        assert!(params.is_empty());
    }

    #[test]
    fn mysql_multi_filter_params_stay_in_clause_order() {
        let filters = vec![
            f("id", FilterOperator::Eq, Some("7")),
            f("name", FilterOperator::Like, Some("%foo%")),
        ];

        let (clauses, params) = build_mysql_where_clause(&filters).unwrap();

        assert_eq!(clauses[0], "`id` = ?");
        assert_eq!(clauses[1], "CAST(`name` AS CHAR) LIKE ?");
        assert_eq!(params, vec![bytes("7"), bytes("%foo%")]);
    }

    #[test]
    fn missing_filter_values_become_empty_params_on_both_drivers() {
        let map = make_map(&[("name", "text")]);
        let (_, pg_params) =
            build_pg_where_clause(&[f("name", FilterOperator::Eq, None)], &map).unwrap();
        let (_, mysql_params) =
            build_mysql_where_clause(&[f("name", FilterOperator::Eq, None)]).unwrap();

        assert_eq!(pg_params, vec![String::new()]);
        assert_eq!(mysql_params, vec![bytes("")]);
    }

    #[test]
    fn pg_where_clause_rejects_unsafe_column_names() {
        let err = build_pg_where_clause(
            &[f(r#"id" = 1 OR ""#, FilterOperator::Eq, Some("x"))],
            &make_map(&[]),
        )
        .unwrap_err();

        assert!(err.contains("Invalid identifier"));
    }

    #[test]
    fn mysql_where_clause_rejects_unsafe_column_names() {
        let err = build_mysql_where_clause(&[f("id` = 1 OR `", FilterOperator::Eq, Some("x"))])
            .unwrap_err();

        assert!(err.contains("Invalid identifier"));
    }

    #[test]
    fn where_sql_joins_driver_specific_clauses_identically() {
        assert_eq!(
            build_where_sql(&[r#""id" = $1::text::uuid"#.to_string()], &None),
            r#"WHERE "id" = $1::text::uuid"#
        );
        assert_eq!(
            build_where_sql(&["`id` = ?".to_string()], &None),
            "WHERE `id` = ?"
        );
    }
}
