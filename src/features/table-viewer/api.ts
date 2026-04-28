import { invoke } from "@tauri-apps/api/core";
import type { TableQueryRequest, TableQueryResult } from "./types";

export const tableApi = {
  queryTable(sessionId: string, request: TableQueryRequest): Promise<TableQueryResult> {
    return invoke("query_table", { sessionId, request });
  },
};
