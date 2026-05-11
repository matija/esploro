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

export interface TableQueryResult {
  columns: ResultColumn[];
  rows: (string | null)[][];
  page: number;
  pageSize: number;
  executionMs: number;
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
