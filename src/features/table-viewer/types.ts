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

export type TypeFamily = "text" | "numeric" | "date" | "other";

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
  const textTypes = ["text", "varchar", "bpchar", "char", "name", "uuid", "citext"];
  const numericTypes = ["int2", "int4", "int8", "float4", "float8", "numeric", "money"];
  const dateTypes = ["date", "timestamp", "timestamptz", "timetz", "time", "interval"];
  if (textTypes.includes(udt)) return "text";
  if (numericTypes.includes(udt)) return "numeric";
  if (dateTypes.includes(udt)) return "date";
  return "other";
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
