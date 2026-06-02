import { invoke } from "@tauri-apps/api/core";
import type {
  DeleteRowResult,
  DeleteRowsRequest,
  TableCountResult,
  TableQueryRequest,
  TableQueryResult,
  UpdateRowsRequest,
} from "./types";

export const tableApi = {
  queryTableData(sessionId: string, request: TableQueryRequest): Promise<TableQueryResult> {
    return invoke("query_table_data", { sessionId, request });
  },
  queryTableCount(sessionId: string, request: TableQueryRequest): Promise<TableCountResult> {
    return invoke("query_table_count", { sessionId, request });
  },
  updateRows(sessionId: string, request: UpdateRowsRequest): Promise<void> {
    return invoke("update_rows", { sessionId, request });
  },
  previewUpdateRowsSql(sessionId: string, request: UpdateRowsRequest): Promise<string> {
    return invoke("preview_update_rows_sql", { sessionId, request });
  },
  deleteRows(sessionId: string, request: DeleteRowsRequest): Promise<DeleteRowResult[]> {
    return invoke("delete_rows", { sessionId, request });
  },
  previewDeleteRowsSql(sessionId: string, request: DeleteRowsRequest): Promise<string> {
    return invoke("preview_delete_rows_sql", { sessionId, request });
  },
};
