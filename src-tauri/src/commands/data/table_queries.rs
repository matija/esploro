use super::type_mapping::{pg_native_udt, CellValue, TruncatedCell};
use super::{validate_column_identifier, ResultColumn, SortDirection};

// ─── serialised-payload guard ────────────────────────────────────────────────

/// Per-cell ceiling, in bytes of the value's serialised rendering. A single
/// cell above this (a large `text`/`bytea`-as-text column, a fat `jsonb`
/// document) is clipped to this many bytes and re-tagged as
/// [`CellValue::Truncated`]; the full value is still reachable by querying the
/// column directly. 256 KiB comfortably fits any value a grid cell can show.
pub(super) const MAX_CELL_VALUE_BYTES: usize = 256 * 1024;

/// Ceiling on the summed cell payload of one page of rows. Rows are added
/// until the accumulated size crosses this, so a page of wide rows can never
/// serialise a multi-hundred-megabyte IPC message into the webview. 32 MiB is
/// far more than a visible page needs and far below where the IPC bridge
/// starts to stall.
pub(super) const MAX_PAYLOAD_BYTES: usize = 32 * 1024 * 1024;

/// Byte cost we charge a cell against the payload ceiling: the length of its
/// serialised value, ignoring the constant per-cell `{"t":…}` envelope.
pub(super) fn cell_payload_bytes(cell: &CellValue) -> usize {
    match cell {
        CellValue::Null => 0,
        CellValue::Bool(_) => 5,
        // Both serialise as JSON numbers; 20 bytes covers i64::MIN and any f64.
        CellValue::Int(_) | CellValue::Float(_) => 20,
        CellValue::Text(s) | CellValue::Other(s) => s.len(),
        CellValue::Json(v) => serde_json::to_string(v).map(|s| s.len()).unwrap_or(0),
        CellValue::Truncated(t) => t.value.len(),
    }
}

/// Largest prefix of `s` that is at most `max` bytes and ends on a char
/// boundary, so clipping never splits a multi-byte character.
fn clip_to_char_boundary(s: &str, max: usize) -> &str {
    let mut end = max.min(s.len());
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// Clip a cell whose serialised value exceeds [`MAX_CELL_VALUE_BYTES`], marking
/// it with the truncation flag. Values within the limit are returned unchanged.
pub(super) fn clamp_cell_value(cell: CellValue) -> CellValue {
    let original_bytes = cell_payload_bytes(&cell);
    if original_bytes <= MAX_CELL_VALUE_BYTES {
        return cell;
    }
    let rendered = match cell {
        CellValue::Text(s) | CellValue::Other(s) => s,
        CellValue::Json(v) => serde_json::to_string(&v).unwrap_or_default(),
        CellValue::Truncated(t) => t.value,
        // Scalars are bounded by construction and never reach this arm.
        other => return other,
    };
    CellValue::Truncated(TruncatedCell {
        value: clip_to_char_boundary(&rendered, MAX_CELL_VALUE_BYTES).to_string(),
        truncated: true,
        original_bytes,
    })
}

/// Accumulates the serialised size of the rows built for one page and stops
/// the caller once [`MAX_PAYLOAD_BYTES`] is crossed.
///
/// A row that crosses the ceiling is still kept — the first row is therefore
/// always returned, however wide it is — and every row after it is refused, so
/// the page is a prefix of the result set rather than an arbitrary subset.
pub(super) struct PayloadBudget {
    limit: usize,
    used: usize,
}

impl PayloadBudget {
    pub(super) fn new() -> Self {
        Self::with_limit(MAX_PAYLOAD_BYTES)
    }

    pub(super) fn with_limit(limit: usize) -> Self {
        Self { limit, used: 0 }
    }

    /// True once the accumulated payload has crossed the ceiling; the caller
    /// must stop building rows (and report `has_more`).
    pub(super) fn is_exhausted(&self) -> bool {
        self.used > self.limit
    }

    /// Clamp each cell of `cells`, charge the row against the budget and hand
    /// the row back. Callers check [`Self::is_exhausted`] afterwards.
    pub(super) fn accept_row(&mut self, cells: Vec<CellValue>) -> Vec<CellValue> {
        let clamped: Vec<CellValue> = cells.into_iter().map(clamp_cell_value).collect();
        self.used = self
            .used
            .saturating_add(clamped.iter().map(cell_payload_bytes).sum::<usize>());
        clamped
    }
}

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

/// Builds the page query. The `LIMIT` is `page_size + 1`: the extra "probe"
/// row is never shown — its presence tells the caller a next page exists
/// without running a `COUNT(*)`. Callers must trim it (see `query_table_pg`).
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
    let limit = page_size.saturating_add(1) as i64;
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

/// MySQL counterpart of [`build_pg_data_sql`]; also fetches one probe row
/// beyond `page_size` so the caller can report `has_more`.
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
    let limit = page_size.saturating_add(1) as u64;
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
    fn pg_data_sql_includes_ctid_and_fetches_one_probe_row() {
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
            r#"SELECT "id", "name", ctid::text AS __ctid FROM "public"."users" WHERE "name"::text LIKE $1 ORDER BY "id" ASC LIMIT 51 OFFSET 100"#
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
            r#"SELECT "id", "name" FROM "public"."active_users"   LIMIT 26 OFFSET 0"#
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

    #[test]
    fn pg_order_sql_requires_complete_sort_state() {
        assert!(build_pg_order_sql(&None, &Some(SortDirection::Asc))
            .unwrap()
            .is_empty());
        assert!(build_pg_order_sql(&None, &None).unwrap().is_empty());
    }

    #[test]
    fn mysql_order_sql_requires_complete_sort_state() {
        assert!(build_mysql_order_sql(&Some("name".to_string()), &None)
            .unwrap()
            .is_empty());
        assert!(build_mysql_order_sql(&None, &Some(SortDirection::Desc))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn pg_order_sql_rejects_unsafe_column_names() {
        let err = build_pg_order_sql(
            &Some(r#"name" DESC"#.to_string()),
            &Some(SortDirection::Asc),
        )
        .unwrap_err();

        assert!(err.contains("Invalid identifier"));
    }

    #[test]
    fn order_sql_quoting_differs_per_driver_for_the_same_sort() {
        let column = Some("created_at".to_string());
        let direction = Some(SortDirection::Asc);

        assert_eq!(
            build_pg_order_sql(&column, &direction).unwrap(),
            r#"ORDER BY "created_at" ASC"#
        );
        assert_eq!(
            build_mysql_order_sql(&column, &direction).unwrap(),
            "ORDER BY `created_at` ASC"
        );
    }

    #[test]
    fn pg_select_list_treats_columns_missing_from_the_type_map_as_text() {
        // Unknown columns fall back to udt "text", which is natively readable.
        let select_list = build_pg_select_list(&[column("mystery")], &HashMap::new());

        assert_eq!(select_list, r#""mystery""#);
    }

    #[test]
    fn mysql_select_list_backtick_quotes_every_column_without_casting() {
        let select_list = build_mysql_select_list(&[column("id"), column("payload")]);

        assert_eq!(select_list, "`id`, `payload`");
    }

    #[test]
    fn select_list_quoting_differs_per_driver_for_the_same_columns() {
        let columns = vec![column("id"), column("payload")];
        let col_type_map = HashMap::from([
            ("id".to_string(), "int8".to_string()),
            ("payload".to_string(), "uuid".to_string()),
        ]);

        assert_eq!(
            build_pg_select_list(&columns, &col_type_map),
            r#""id", "payload"::text"#
        );
        assert_eq!(build_mysql_select_list(&columns), "`id`, `payload`");
    }

    #[test]
    fn mysql_data_sql_backticks_identifiers_and_fetches_one_probe_row() {
        let sql = build_mysql_data_sql(
            "app",
            "users",
            "`id`, `name`",
            "WHERE `name` LIKE ?",
            "ORDER BY `id` ASC",
            2,
            50,
        );

        assert_eq!(
            sql,
            "SELECT `id`, `name` FROM `app`.`users` WHERE `name` LIKE ? ORDER BY `id` ASC LIMIT 51 OFFSET 100"
        );
    }

    #[test]
    fn mysql_data_sql_never_selects_a_ctid_column() {
        let sql = build_mysql_data_sql("app", "users", "`id`", "", "", 0, 25);

        assert_eq!(sql, "SELECT `id` FROM `app`.`users`   LIMIT 26 OFFSET 0");
        assert!(!sql.contains("__ctid"));
    }

    #[test]
    fn data_sql_differs_per_driver_for_the_same_page() {
        let pg = build_pg_data_sql("public", "users", r#""id""#, false, "", "", 1, 10);
        let mysql = build_mysql_data_sql("app", "users", "`id`", "", "", 1, 10);

        assert_eq!(
            pg,
            r#"SELECT "id" FROM "public"."users"   LIMIT 11 OFFSET 10"#
        );
        assert_eq!(mysql, "SELECT `id` FROM `app`.`users`   LIMIT 11 OFFSET 10");
    }

    #[test]
    fn count_sql_without_filters_differs_per_driver() {
        assert_eq!(
            build_pg_count_sql("public", "users", ""),
            r#"SELECT COUNT(*) FROM "public"."users" "#
        );
        assert_eq!(
            build_mysql_count_sql("app", "users", ""),
            "SELECT COUNT(*) FROM `app`.`users` "
        );
    }

    // ─── payload guard ───────────────────────────────────────────────────────

    // CellValue has no PartialEq; compare the serialised wire shape instead.
    fn tagged(cell: &CellValue) -> serde_json::Value {
        serde_json::to_value(cell).unwrap()
    }

    fn text_of(bytes: usize) -> CellValue {
        CellValue::Text("a".repeat(bytes))
    }

    #[test]
    fn cells_within_the_per_cell_limit_are_left_alone() {
        let cell = clamp_cell_value(text_of(MAX_CELL_VALUE_BYTES));

        assert_eq!(tagged(&cell), tagged(&text_of(MAX_CELL_VALUE_BYTES)));
    }

    #[test]
    fn oversized_text_is_clipped_and_flagged_as_truncated() {
        let original = MAX_CELL_VALUE_BYTES + 10;

        let cell = clamp_cell_value(text_of(original));

        let wire = tagged(&cell);
        assert_eq!(wire["t"], "truncated");
        assert_eq!(wire["v"]["truncated"], true);
        assert_eq!(wire["v"]["originalBytes"], original);
        assert_eq!(
            wire["v"]["value"].as_str().unwrap().len(),
            MAX_CELL_VALUE_BYTES
        );
    }

    #[test]
    fn oversized_json_is_clipped_to_its_serialised_prefix() {
        let payload = "b".repeat(MAX_CELL_VALUE_BYTES + 100);
        let cell = clamp_cell_value(CellValue::Json(serde_json::json!({ "k": payload })));

        let wire = tagged(&cell);
        assert_eq!(wire["t"], "truncated");
        assert!(wire["v"]["value"]
            .as_str()
            .unwrap()
            .starts_with(r#"{"k":"b"#));
        assert_eq!(
            wire["v"]["value"].as_str().unwrap().len(),
            MAX_CELL_VALUE_BYTES
        );
    }

    #[test]
    fn clipping_never_splits_a_multi_byte_character() {
        // "é" is two bytes, so the limit lands mid-character for odd prefixes.
        let value = "é".repeat(MAX_CELL_VALUE_BYTES);
        let cell = clamp_cell_value(CellValue::Text(value));

        let wire = tagged(&cell);
        let clipped = wire["v"]["value"].as_str().unwrap();
        assert!(clipped.len() <= MAX_CELL_VALUE_BYTES);
        assert!(clipped.chars().all(|c| c == 'é'));
    }

    #[test]
    fn scalar_cells_are_never_truncated() {
        for cell in [
            CellValue::Null,
            CellValue::Bool(true),
            CellValue::Int(i64::MIN),
            CellValue::Float(1.5),
        ] {
            let wire = tagged(&clamp_cell_value(cell));
            assert_ne!(wire["t"], "truncated");
        }
    }

    #[test]
    fn payload_bytes_counts_the_value_not_the_envelope() {
        assert_eq!(cell_payload_bytes(&CellValue::Null), 0);
        assert_eq!(cell_payload_bytes(&CellValue::Text("abcd".into())), 4);
        assert_eq!(cell_payload_bytes(&CellValue::Other("abcd".into())), 4);
        assert_eq!(
            cell_payload_bytes(&CellValue::Json(serde_json::json!({ "k": 1 }))),
            r#"{"k":1}"#.len()
        );
    }

    #[test]
    fn rows_are_accepted_until_the_ceiling_is_crossed() {
        let mut budget = PayloadBudget::with_limit(100);

        let mut accepted = 0;
        for _ in 0..10 {
            if budget.is_exhausted() {
                break;
            }
            budget.accept_row(vec![text_of(40)]);
            accepted += 1;
        }

        // 40 + 40 + 40 = 120 > 100, so the third row is the last one added.
        assert_eq!(accepted, 3);
        assert!(budget.is_exhausted());
    }

    #[test]
    fn a_single_oversized_row_is_still_returned() {
        let mut budget = PayloadBudget::with_limit(10);

        assert!(!budget.is_exhausted());
        let row = budget.accept_row(vec![text_of(1_000)]);

        assert_eq!(row.len(), 1);
        assert!(budget.is_exhausted());
    }

    #[test]
    fn a_budget_charges_the_clipped_size_of_truncated_cells() {
        let mut budget = PayloadBudget::with_limit(MAX_PAYLOAD_BYTES);

        let row = budget.accept_row(vec![text_of(MAX_CELL_VALUE_BYTES * 4)]);

        assert_eq!(tagged(&row[0])["t"], "truncated");
        assert_eq!(cell_payload_bytes(&row[0]), MAX_CELL_VALUE_BYTES);
        assert!(!budget.is_exhausted());
    }

    #[test]
    fn a_page_of_ordinary_rows_stays_well_inside_the_ceiling() {
        let mut budget = PayloadBudget::new();

        for _ in 0..500 {
            budget.accept_row(vec![
                CellValue::Int(42),
                CellValue::Text("some ordinary value".into()),
                CellValue::Null,
            ]);
            assert!(!budget.is_exhausted());
        }
    }
}
