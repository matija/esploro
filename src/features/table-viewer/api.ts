import { invoke } from "@tauri-apps/api/core";
import type { TableCountResult, TableQueryRequest, TableQueryResult, UpdateRowsRequest } from "./types";

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
};
