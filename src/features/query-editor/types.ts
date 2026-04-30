export interface ResultColumn {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
}

export interface QueryError {
  message: string;
  position: number | null;
  code: string | null;
}

export interface QueryResult {
  columns: ResultColumn[];
  rows: (string | null)[][];
  rowsAffected: number | null;
  executionMs: number;
  error: QueryError | null;
}

export interface SavedQuery {
  id: string;
  name: string;
  folder: string | null;
  sql: string;
  createdAt: string;
  updatedAt: string;
}
