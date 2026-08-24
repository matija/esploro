import type {
  CellValue,
  JsonValue,
  ResultColumn,
  TableQueryResult,
} from "../lib/bindings";

// Fixtures mirroring the shapes returned by `query_table_data`
// (see `TableQueryResult` in src-tauri/src/commands/data.rs). Everything is
// built through factories so a test can override just the field it cares about
// without hand-writing a full result object.

// ─── Cells ───────────────────────────────────────────────────────────────────

export const cell = {
  null: (): CellValue => ({ t: "null" }),
  bool: (v: boolean): CellValue => ({ t: "bool", v }),
  int: (v: number): CellValue => ({ t: "int", v }),
  float: (v: number | null): CellValue => ({ t: "float", v }),
  text: (v: string): CellValue => ({ t: "text", v }),
  json: (v: JsonValue): CellValue => ({ t: "json", v }),
  other: (v: string): CellValue => ({ t: "other", v }),
};

// ─── Columns ─────────────────────────────────────────────────────────────────

export function makeColumn(overrides: Partial<ResultColumn> = {}): ResultColumn {
  return {
    name: "column",
    dataType: "text",
    isNullable: true,
    isPrimaryKey: false,
    isForeignKey: false,
    isEnum: false,
    ...overrides,
  };
}

// A representative table: primary key, text, enum, foreign key, nullable
// timestamp and boolean — one column per rendering path in the data grid.
export const usersColumns: ResultColumn[] = [
  makeColumn({ name: "id", dataType: "int4", isNullable: false, isPrimaryKey: true }),
  makeColumn({ name: "email", dataType: "text", isNullable: false }),
  makeColumn({ name: "status", dataType: "user_status", isEnum: true }),
  makeColumn({ name: "team_id", dataType: "int4", isForeignKey: true }),
  makeColumn({ name: "created_at", dataType: "timestamptz" }),
  makeColumn({ name: "is_active", dataType: "bool", isNullable: false }),
];

// ─── Rows ────────────────────────────────────────────────────────────────────

// Rows aligned with `usersColumns`. Row 2 exercises NULL rendering.
export const usersRows: CellValue[][] = [
  [
    cell.int(1),
    cell.text("ada@example.com"),
    cell.other("active"),
    cell.int(10),
    cell.text("2024-01-15T09:30:00Z"),
    cell.bool(true),
  ],
  [
    cell.int(2),
    cell.text("grace@example.com"),
    cell.other("invited"),
    cell.null(),
    cell.null(),
    cell.bool(false),
  ],
  [
    cell.int(3),
    cell.text("linus@example.com"),
    cell.other("suspended"),
    cell.int(11),
    cell.text("2024-03-02T17:05:00Z"),
    cell.bool(true),
  ],
];

// Postgres row identifiers, one per row. MySQL results carry `null` here.
export const usersCtids: (string | null)[] = ["(0,1)", "(0,2)", "(0,3)"];

// ─── Query results ───────────────────────────────────────────────────────────

export function makeTableQueryResult(
  overrides: Partial<TableQueryResult> = {},
): TableQueryResult {
  const rows = overrides.rows ?? usersRows;
  return {
    columns: usersColumns,
    rows,
    ctids: overrides.ctids ?? rows.map((_, i) => `(0,${i + 1})`),
    page: 0,
    pageSize: 100,
    executionMs: 12,
    hasMore: false,
    ...overrides,
  };
}

export const usersQueryResult: TableQueryResult = makeTableQueryResult({
  ctids: usersCtids,
});

export const emptyQueryResult: TableQueryResult = makeTableQueryResult({
  rows: [],
  ctids: [],
  executionMs: 3,
});
