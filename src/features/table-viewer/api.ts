import { commands } from "../../lib/bindings";
import { normalizeError } from "../../lib/ipc";
import type {
  DeleteRowResult,
  DeleteRowsRequest,
  TableCountResult,
  TableQueryRequest,
  TableQueryResult,
  UpdateRowsRequest,
} from "./types";

async function normalizeCommandError<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (raw) {
    throw normalizeError(raw);
  }
}

export const tableApi = {
  queryTableData(sessionId: string, request: TableQueryRequest): Promise<TableQueryResult> {
    return normalizeCommandError(commands.queryTableData(sessionId, request));
  },
  queryTableCount(sessionId: string, request: TableQueryRequest): Promise<TableCountResult> {
    return normalizeCommandError(commands.queryTableCount(sessionId, request));
  },
  updateRows(sessionId: string, request: UpdateRowsRequest): Promise<void> {
    return normalizeCommandError(commands.updateRows(sessionId, request)).then(() => undefined);
  },
  previewUpdateRowsSql(sessionId: string, request: UpdateRowsRequest): Promise<string> {
    return normalizeCommandError(commands.previewUpdateRowsSql(sessionId, request));
  },
  deleteRows(sessionId: string, request: DeleteRowsRequest): Promise<DeleteRowResult[]> {
    return normalizeCommandError(commands.deleteRows(sessionId, request));
  },
  previewDeleteRowsSql(sessionId: string, request: DeleteRowsRequest): Promise<string> {
    return normalizeCommandError(commands.previewDeleteRowsSql(sessionId, request));
  },
};
