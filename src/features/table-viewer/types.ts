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
}

export interface TableQueryResult {
  columns: ResultColumn[];
  rows: (string | null)[][];
  totalCount: number;
  page: number;
  pageSize: number;
  executionMs: number;
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
  const t = udt.toLowerCase().replace(/\[\]$/, ""); // strip array suffix
  if (["text", "varchar", "bpchar", "char", "name", "uuid", "citext"].includes(t)) return "text";
  if (["int2", "int4", "int8", "float4", "float8", "numeric", "money", "oid", "serial", "bigserial"].includes(t)) return "numeric";
  if (["date", "timestamp", "timestamptz", "timetz", "time", "interval"].includes(t)) return "date";
  if (["bool", "boolean"].includes(t)) return "boolean";
  if (["json", "jsonb"].includes(t)) return "json";
  return "other"; // likely enum or custom type
}

export function getOperatorsForFamily(family: TypeFamily): FilterOperator[] {
  switch (family) {
    case "text":
      return ["Eq", "Neq", "Like", "ILike", "IsNull", "IsNotNull"];
    case "numeric":
    case "date":
      return ["Eq", "Neq", "Gt", "Lt", "Gte", "Lte", "IsNull", "IsNotNull"];
    default:
      return ["Eq", "Neq", "IsNull", "IsNotNull"];
  }
}
