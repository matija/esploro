export type FilterOperator =
  | "Eq"
  | "Neq"
  | "Like"
  | "ILike"
  | "Gt"
  | "Lt"
  | "Gte"
  | "Lte"
  | "IsNull"
  | "IsNotNull";

export type SortDirection = "Asc" | "Desc";

export interface ColumnFilter {
  column: string;
  operator: FilterOperator;
  value?: string;
}

export interface TableQueryRequest {
  database: string;
  schema: string;
  table: string;
  filters: ColumnFilter[];
  sortColumn?: string;
  sortDirection?: SortDirection;
  page: number;
  pageSize: number;
}

export interface ResultColumn {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
}

export type CellValue =
  | { t: "null" }
  | { t: "bool"; v: boolean }
  | { t: "int"; v: number }
  | { t: "float"; v: number }
  | { t: "text"; v: string }
  | { t: "json"; v: unknown }
  | { t: "other"; v: string };

export function cellToString(cell: CellValue): string | null {
  if (cell.t === "null") return null;
  if (cell.t === "json") return JSON.stringify(cell.v);
  return String(cell.v);
}

export interface TableQueryResult {
  columns: ResultColumn[];
  rows: CellValue[][];
  ctids: (string | null)[];
  page: number;
  pageSize: number;
  executionMs: number;
}

export interface PkCondition {
  column: string;
  value: string;
}

export interface ColumnChange {
  column: string;
  value: string | null;
}

export interface RowChange {
  pkConditions: PkCondition[];
  ctid?: string;
  columnChanges: ColumnChange[];
}

export interface UpdateRowsRequest {
  schema: string;
  table: string;
  changes: RowChange[];
}

export function isEditableType(udt: string): boolean {
  if (udt.endsWith("[]")) return false;
  const t = udt.toLowerCase();
  return t !== "json" && t !== "jsonb" && t !== "bytea";
}

export interface TableCountResult {
  count: number;
  isEstimate: boolean;
}

export type TypeFamily = "text" | "numeric" | "date" | "boolean" | "json" | "other";

export function typeFamilyBadgeClass(family: TypeFamily): string {
  switch (family) {
    case "text":    return "text-syntax-string bg-syntax-string/10";
    case "numeric": return "text-syntax-number bg-syntax-number/10";
    case "date":    return "text-syntax-type bg-syntax-type/10";
    case "boolean": return "text-syntax-special bg-syntax-special/10";
    case "json":    return "text-syntax-enum bg-syntax-enum/10";
    default:        return "text-secondary bg-control";
  }
}

export const OP_LABELS: Record<FilterOperator, string> = {
  Eq: "=",
  Neq: "≠",
  Like: "LIKE",
  ILike: "ILIKE",
  Gt: ">",
  Lt: "<",
  Gte: "≥",
  Lte: "≤",
  IsNull: "IS NULL",
  IsNotNull: "IS NOT NULL",
};

export function getTypeFamily(udt: string): TypeFamily {
  // MySQL: tinyint(1) is boolean
  if (udt.toLowerCase() === "tinyint(1)") return "boolean";

  // Strip array suffix (Postgres) and parenthesised length/precision (MySQL)
  const t = udt.toLowerCase().replace(/\[\]$/, "").replace(/\(.*\)$/, "").trim();

  // Postgres types
  if (["text", "varchar", "bpchar", "char", "name", "uuid", "citext"].includes(t)) return "text";
  if (["int2", "int4", "int8", "float4", "float8", "numeric", "money", "oid", "serial", "bigserial"].includes(t)) return "numeric";
  if (["date", "timestamp", "timestamptz", "timetz", "time", "interval"].includes(t)) return "date";
  if (["bool", "boolean"].includes(t)) return "boolean";
  if (["json", "jsonb"].includes(t)) return "json";

  // MySQL types
  if (["varchar", "char", "text", "tinytext", "mediumtext", "longtext", "enum", "set"].includes(t)) return "text";
  if (["int", "bigint", "smallint", "tinyint", "mediumint", "float", "double", "decimal"].includes(t)) return "numeric";
  if (["date", "datetime", "timestamp", "time", "year"].includes(t)) return "date";
  if (["json"].includes(t)) return "json";
  if (["binary", "varbinary", "blob", "tinyblob", "mediumblob", "longblob"].includes(t)) return "other";

  return "other"; // likely enum or custom type
}

export function getOperatorsForFamily(family: TypeFamily, driver: "postgres" | "mysql" = "postgres"): FilterOperator[] {
  switch (family) {
    case "text":
      // MySQL LIKE is case-insensitive by default; ILike is not available
      return driver === "mysql"
        ? ["Eq", "Neq", "Like", "IsNull", "IsNotNull"]
        : ["Eq", "Neq", "Like", "ILike", "IsNull", "IsNotNull"];
    case "numeric":
    case "date":
      return ["Eq", "Neq", "Gt", "Lt", "Gte", "Lte", "IsNull", "IsNotNull"];
    default:
      return ["Eq", "Neq", "IsNull", "IsNotNull"];
  }
}

// ─── Enum badge palette ──────────────────────────────────────────────────────

// 8 muted hues from the Tailwind palette. Each value is a full class string so
// Tailwind's JIT picks them all up at build time. dark: variants follow the
// existing convention used in LicenseBadge / AppShell.
const ENUM_BADGE_CLASSES: readonly string[] = [
  "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  "bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  "bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300",
  "bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300",
  "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
  "bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300",
  "bg-pink-100 text-pink-800 dark:bg-pink-950/60 dark:text-pink-300",
];

// djb2 — stable across sessions and rows so the same value always maps to the
// same colour bucket.
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function getEnumBadgeClass(value: string): string {
  return ENUM_BADGE_CLASSES[hashString(value) % ENUM_BADGE_CLASSES.length];
}

// ─── Enum column detection ───────────────────────────────────────────────────

// Maximum distinct values for a column to be treated as enum-like.
const ENUM_MAX_DISTINCT = 10;
// Maximum length per value — prevents long free-text columns from being badged.
const ENUM_MAX_LENGTH = 30;
// Minimum non-null rows needed to call the heuristic reliable.
const ENUM_MIN_ROWS = 3;

// Returns the set of column indices that should render their text/other cells
// as colored pill badges.
//
// Detection order (most reliable first):
//  1. MySQL: column data_type starts with "enum(" — definitive.
//  2. Heuristic: column has ≥ENUM_MIN_ROWS non-null cells, all of type
//     text/other and ≤ENUM_MAX_LENGTH chars, with ≤ENUM_MAX_DISTINCT distinct
//     values, AND values repeat at least 2× on average (distinct*2 ≤ nonNull).
//     The repetition guard prevents short-unique-string columns (e.g. names in
//     a tiny result set) from being treated as enums.
export function detectEnumColumns(
  columns: ResultColumn[],
  rows: CellValue[][],
): Set<number> {
  const enumCols = new Set<number>();
  if (columns.length === 0) return enumCols;

  for (let ci = 0; ci < columns.length; ci++) {
    const dt = columns[ci]?.dataType?.toLowerCase() ?? "";
    if (dt.startsWith("enum(")) {
      enumCols.add(ci);
      continue;
    }

    if (rows.length < ENUM_MIN_ROWS) continue;

    const distinct = new Set<string>();
    let nonNullCount = 0;
    let qualifies = true;

    for (const row of rows) {
      const cell = row[ci];
      if (!cell || cell.t === "null") continue;
      if (cell.t !== "text" && cell.t !== "other") {
        qualifies = false;
        break;
      }
      const v = cell.v;
      if (v.length === 0 || v.length > ENUM_MAX_LENGTH) {
        qualifies = false;
        break;
      }
      nonNullCount += 1;
      distinct.add(v);
      if (distinct.size > ENUM_MAX_DISTINCT) {
        qualifies = false;
        break;
      }
    }

    if (
      qualifies &&
      nonNullCount >= ENUM_MIN_ROWS &&
      distinct.size >= 1 &&
      distinct.size <= ENUM_MAX_DISTINCT &&
      distinct.size * 2 <= nonNullCount
    ) {
      enumCols.add(ci);
    }
  }

  return enumCols;
}
