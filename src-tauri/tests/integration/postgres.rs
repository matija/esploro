//! Postgres leg of the `integration-db` suite. Skips cleanly when
//! `ESPLORO_TEST_POSTGRES_URL` isn't set.

use esploro_lib::commands::data::{
    self, ColumnChange, ColumnFilter, DeleteRowRequest, DeleteRowsRequest, PkCondition, RowChange,
    SortDirection, TableQueryRequest, UpdateRowsRequest,
};
use esploro_lib::commands::schema;

use super::common;

const ENV_VAR: &str = "ESPLORO_TEST_POSTGRES_URL";

#[tokio::test]
async fn schema_introspection_and_row_mutations_round_trip() {
    let Some(url) = common::env_url(ENV_VAR) else {
        return common::skip(&format!("{ENV_VAR} not set"));
    };

    let harness = common::setup_pg(&url).await;
    let state = harness.state();
    let session_id = harness.session_id.clone();
    let database = common::db_name_from_url(&url);
    let table = common::unique_table_name("esploro_it_pg");

    // Schema setup goes through `execute_sql` (arbitrary DDL/DML path), then
    // every read/mutation below goes through the same command surface the
    // frontend calls.
    let create = data::execute_sql(
        session_id.clone(),
        format!(
            "CREATE TABLE public.\"{table}\" (id serial primary key, name text not null)"
        ),
        state.clone(),
    )
    .await
    .expect("create table failed");
    assert!(sql_errors(&create).is_empty(), "{:?}", sql_errors(&create));

    // Schema introspection: the freshly created table must show up, with the
    // `id` column recognised as the primary key.
    let objects = schema::list_objects(session_id.clone(), database.clone(), "public".into(), state.clone())
        .await
        .expect("list_objects failed");
    let table_names: Vec<&str> = objects.tables.iter().map(|t| t.name.as_str()).collect();
    assert!(
        table_names.contains(&table.as_str()),
        "expected {table} in {table_names:?}"
    );

    let columns = schema::list_columns(
        session_id.clone(),
        database.clone(),
        "public".into(),
        table.clone(),
        state.clone(),
    )
    .await
    .expect("list_columns failed");
    let id_col = columns
        .iter()
        .find(|c| c.name == "id")
        .expect("id column missing");
    assert!(id_col.is_primary_key);
    assert!(columns.iter().any(|c| c.name == "name"));

    // Seed rows via DML, then read them back through the paginated query path.
    let insert = data::execute_sql(
        session_id.clone(),
        format!("INSERT INTO public.\"{table}\" (name) VALUES ('alpha'), ('beta')"),
        state.clone(),
    )
    .await
    .expect("insert failed");
    assert!(sql_errors(&insert).is_empty(), "{:?}", sql_errors(&insert));

    let query_request = TableQueryRequest {
        database: database.clone(),
        schema: "public".into(),
        table: table.clone(),
        filters: Vec::<ColumnFilter>::new(),
        sort_column: Some("id".into()),
        sort_direction: Some(SortDirection::Asc),
        page: 0,
        page_size: 50,
        raw_where: None,
    };

    let result = data::query_table_data(session_id.clone(), query_request.clone(), state.clone())
        .await
        .expect("query_table_data failed");
    assert_eq!(result.rows.len(), 2);
    let id_idx = result
        .columns
        .iter()
        .position(|c| c.name == "id")
        .expect("id column not in result set");
    let name_idx = result
        .columns
        .iter()
        .position(|c| c.name == "name")
        .expect("name column not in result set");

    let first_row_id = cell_as_string(&result.rows[0][id_idx]);
    assert_eq!(cell_as_string(&result.rows[0][name_idx]), "alpha");

    // update_rows: exercise the row-mutation command path end to end.
    let update_request = UpdateRowsRequest {
        schema: "public".into(),
        table: table.clone(),
        changes: vec![RowChange {
            pk_conditions: vec![PkCondition {
                column: "id".into(),
                value: first_row_id.clone(),
            }],
            ctid: None,
            column_changes: vec![ColumnChange {
                column: "name".into(),
                value: Some("alpha-updated".into()),
            }],
        }],
    };
    data::update_rows(session_id.clone(), update_request, state.clone())
        .await
        .expect("update_rows failed");

    let after_update = data::query_table_data(session_id.clone(), query_request.clone(), state.clone())
        .await
        .expect("query_table_data after update failed");
    assert_eq!(cell_as_string(&after_update.rows[0][name_idx]), "alpha-updated");

    // delete_rows: remove the row we just updated and confirm the count drops.
    let delete_request = DeleteRowsRequest {
        schema: "public".into(),
        table: table.clone(),
        rows: vec![DeleteRowRequest {
            pk_conditions: vec![PkCondition {
                column: "id".into(),
                value: first_row_id,
            }],
            ctid: None,
        }],
    };
    let delete_results = data::delete_rows(session_id.clone(), delete_request, state.clone())
        .await
        .expect("delete_rows failed");
    let delete_errors: Vec<&String> = delete_results.iter().filter_map(|r| r.error.as_ref()).collect();
    assert!(delete_errors.is_empty(), "{delete_errors:?}");

    let count = data::query_table_count(session_id.clone(), query_request, state.clone())
        .await
        .expect("query_table_count failed");
    assert_eq!(count.count, 1);

    let cleanup = data::execute_sql(
        session_id.clone(),
        format!("DROP TABLE public.\"{table}\""),
        state.clone(),
    )
    .await
    .expect("drop table failed");
    assert!(sql_errors(&cleanup).is_empty(), "{:?}", sql_errors(&cleanup));
}

fn cell_as_string(cell: &data::CellValue) -> String {
    match cell {
        data::CellValue::Text(s) => s.clone(),
        data::CellValue::Int(n) => n.to_string(),
        data::CellValue::Other(s) => s.clone(),
        _ => panic!("unexpected cell value type"),
    }
}

fn sql_errors(results: &[data::QueryResult]) -> Vec<String> {
    results
        .iter()
        .filter_map(|r| r.error.as_ref().map(|e| e.message.clone()))
        .collect()
}
