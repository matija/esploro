use super::type_mapping::pg_native_udt;
use super::{validate_column_identifier, ResultColumn, SortDirection};

fn order_direction_sql(direction: &SortDirection) -> &'static str {
    match direction {
        SortDirection::Asc => "ASC",
        SortDirection::Desc => "DESC",
    }
}

pub(super) fn build_pg_order_sql(
    sort_column: &Option<String>,
    sort_direction: &Option<SortDirection>,
) -> Result<String, String> {
    match (sort_column, sort_direction) {
        (Some(col), Some(dir)) => {
            validate_column_identifier(col)?;
            Ok(format!("ORDER BY \"{col}\" {}", order_direction_sql(dir)))
        }
        _ => Ok(String::new()),
    }
}

pub(super) fn build_mysql_order_sql(
    sort_column: &Option<String>,
    sort_direction: &Option<SortDirection>,
) -> Result<String, String> {
    match (sort_column, sort_direction) {
        (Some(col), Some(dir)) => {
            validate_column_identifier(col)?;
            Ok(format!("ORDER BY `{col}` {}", order_direction_sql(dir)))
        }
        _ => Ok(String::new()),
    }
}

pub(super) fn build_pg_select_list(
    columns: &[ResultColumn],
    col_type_map: &std::collections::HashMap<String, String>,
) -> String {
    columns
        .iter()
        .map(|c| {
            let udt = col_type_map
                .get(&c.name)
                .map(|s| s.as_str())
                .unwrap_or("text");
            if pg_native_udt(udt) {
                format!("\"{}\"", c.name)
            } else {
                format!("\"{}\"::text", c.name)
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

pub(super) fn build_mysql_select_list(columns: &[ResultColumn]) -> String {
    columns
        .iter()
        .map(|c| format!("`{}`", c.name))
        .collect::<Vec<_>>()
        .join(", ")
}

pub(super) fn build_pg_data_sql(
    schema: &str,
    table: &str,
    select_list: &str,
    include_ctid: bool,
    where_sql: &str,
    order_sql: &str,
    page: u32,
    page_size: u32,
) -> String {
    let offset = (page * page_size) as i64;
    let limit = page_size as i64;
    let ctid_select = if include_ctid {
        ", ctid::text AS __ctid"
    } else {
        ""
    };
    format!(
        "SELECT {select_list}{ctid_select} FROM \"{schema}\".\"{table}\" {where_sql} {order_sql} LIMIT {limit} OFFSET {offset}"
    )
}

pub(super) fn build_pg_count_sql(schema: &str, table: &str, where_sql: &str) -> String {
    format!("SELECT COUNT(*) FROM \"{schema}\".\"{table}\" {where_sql}")
}

pub(super) fn build_mysql_data_sql(
    schema: &str,
    table: &str,
    select_list: &str,
    where_sql: &str,
    order_sql: &str,
    page: u32,
    page_size: u32,
) -> String {
    let offset = (page * page_size) as u64;
    let limit = page_size as u64;
    format!(
        "SELECT {select_list} FROM `{schema}`.`{table}` {where_sql} {order_sql} LIMIT {limit} OFFSET {offset}"
    )
}

pub(super) fn build_mysql_count_sql(schema: &str, table: &str, where_sql: &str) -> String {
    format!("SELECT COUNT(*) FROM `{schema}`.`{table}` {where_sql}")
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn column(name: &str) -> ResultColumn {
        ResultColumn {
            name: name.to_string(),
            data_type: String::new(),
            is_nullable: false,
            is_primary_key: false,
            is_foreign_key: false,
            is_enum: false,
        }
    }

    #[test]
    fn pg_order_sql_quotes_column_and_direction() {
        let sql = build_pg_order_sql(&Some("created_at".to_string()), &Some(SortDirection::Desc))
            .unwrap();

        assert_eq!(sql, "ORDER BY \"created_at\" DESC");
    }

    #[test]
    fn mysql_order_sql_quotes_column_and_direction() {
        let sql =
            build_mysql_order_sql(&Some("name".to_string()), &Some(SortDirection::Asc)).unwrap();

        assert_eq!(sql, "ORDER BY `name` ASC");
    }

    #[test]
    fn order_sql_requires_complete_sort_state() {
        let sql = build_pg_order_sql(&Some("created_at".to_string()), &None).unwrap();

        assert!(sql.is_empty());
    }

    #[test]
    fn order_sql_rejects_unsafe_column_names() {
        let err = build_mysql_order_sql(&Some("name` DESC".to_string()), &Some(SortDirection::Asc))
            .unwrap_err();

        assert!(err.contains("Invalid identifier"));
    }

    #[test]
    fn pg_select_list_keeps_native_columns_typed_and_casts_others() {
        let columns = vec![column("id"), column("payload")];
        let col_type_map = HashMap::from([
            ("id".to_string(), "int8".to_string()),
            ("payload".to_string(), "uuid".to_string()),
        ]);

        let select_list = build_pg_select_list(&columns, &col_type_map);

        assert_eq!(select_list, r#""id", "payload"::text"#);
    }

    #[test]
    fn pg_data_sql_includes_ctid_and_pagination() {
        let sql = build_pg_data_sql(
            "public",
            "users",
            r#""id", "name""#,
            true,
            r#"WHERE "name"::text LIKE $1"#,
            r#"ORDER BY "id" ASC"#,
            2,
            50,
        );

        assert_eq!(
            sql,
            r#"SELECT "id", "name", ctid::text AS __ctid FROM "public"."users" WHERE "name"::text LIKE $1 ORDER BY "id" ASC LIMIT 50 OFFSET 100"#
        );
    }

    #[test]
    fn pg_data_sql_can_omit_ctid_for_views() {
        let sql = build_pg_data_sql(
            "public",
            "active_users",
            r#""id", "name""#,
            false,
            "",
            "",
            0,
            25,
        );

        assert_eq!(
            sql,
            r#"SELECT "id", "name" FROM "public"."active_users"   LIMIT 25 OFFSET 0"#
        );
    }

    #[test]
    fn pg_count_sql_keeps_filter_fragment() {
        let sql = build_pg_count_sql("public", "users", r#"WHERE "active" = $1::text::boolean"#);

        assert_eq!(
            sql,
            r#"SELECT COUNT(*) FROM "public"."users" WHERE "active" = $1::text::boolean"#
        );
    }

    #[test]
    fn mysql_count_sql_keeps_filter_fragment() {
        let sql = build_mysql_count_sql("app", "users", "WHERE `active` = ?");

        assert_eq!(sql, "SELECT COUNT(*) FROM `app`.`users` WHERE `active` = ?");
    }
}
