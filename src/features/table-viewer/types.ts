import type {
  CellValue,
  FilterOperator,
  ResultColumn,
} from "../../lib/bindings";

export type {
  CellValue,
  ColumnFilter,
  DeleteRowRequest,
  DeleteRowResult,
  DeleteRowsRequest,
  FilterOperator,
  ResultColumn,
  RowChange,
  SortDirection,
  TableCountResult,
  TableQueryRequest,
  TableQueryResult,
  UpdateRowsRequest,
} from "../../lib/bindings";

export function cellToString(cell: CellValue): string | null {
  if (cell.t === "null") return null;
  if (cell.t === "json") return JSON.stringify(cell.v);
  return String(cell.v);
}

export type EditableKind = "scalar" | "json" | "array" | "none";

export function editableKind(udt: string, driver: "postgres" | "mysql"): EditableKind {
  if (driver === "postgres") {
    if (udt === "json" || udt === "jsonb") return "json";
    if (udt.startsWith("_")) return "array";  // PG array types: _int4, _text, _uuid, …
    if (udt === "bytea") return "none";
    return "scalar";
  }
  // MySQL: COLUMN_TYPE is e.g. "int", "varchar(255)", "tinyint(1)", "enum('a','b')", "json"
  const t = udt.toLowerCase().replace(/\(.*\)$/, "").trim();
  if (t === "json") return "json";
  if (["binary", "varbinary", "tinyblob", "blob", "mediumblob", "longblob"].includes(t)) return "none";
  const mysqlScalars = [
    "int", "bigint", "smallint", "tinyint", "mediumint",
    "decimal", "float", "double",
    "char", "varchar", "text", "tinytext", "mediumtext", "longtext",
    "date", "datetime", "timestamp", "time", "year",
    "enum", "set",
  ];
  if (mysqlScalars.includes(t)) return "scalar";
  return "none";
}

export function isEditableType(udt: string): boolean {
  if (udt.endsWith("[]")) return false;
  const t = udt.toLowerCase();
  return t !== "json" && t !== "jsonb" && t !== "bytea";
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

// 8 theme-aware hues. Each class points at data-grid enum tokens that are
// derived from the active palette, keeping badges visually close to the theme.
const ENUM_BADGE_CLASSES: readonly string[] = [
  "enum-value-badge-0",
  "enum-value-badge-1",
  "enum-value-badge-2",
  "enum-value-badge-3",
  "enum-value-badge-4",
  "enum-value-badge-5",
  "enum-value-badge-6",
  "enum-value-badge-7",
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

// Returns the set of database-declared enum columns that should render their
// text/other cells as colored value badges.
export function detectEnumColumns(columns: ResultColumn[]): Set<number> {
  const enumCols = new Set<number>();

  for (let ci = 0; ci < columns.length; ci++) {
    if (columns[ci]?.isEnum) {
      enumCols.add(ci);
    }
  }

  return enumCols;
}
