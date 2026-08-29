import { commands } from "../../lib/bindings";
import { normalizeError } from "../../lib/ipc";
import type {
  DeleteRowResult,
  DeleteRowsRequest,
  InsertRowResult,
  InsertRowsRequest,
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

// Tauri's IPC doesn't natively support AbortSignal, so a stale in-flight call
// keeps running on the Rust side. What we *can* do on the client is stop the
// stale response from resolving the caller's promise once its query has been
// superseded — this races the command against the signal so React Query sees
// a rejected (cancelled) fetch instead of applying outdated data.
function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

export const tableApi = {
  queryTableData(sessionId: string, request: TableQueryRequest, signal?: AbortSignal): Promise<TableQueryResult> {
    return withAbort(normalizeCommandError(commands.queryTableData(sessionId, request)), signal);
  },
  queryTableCount(sessionId: string, request: TableQueryRequest, signal?: AbortSignal): Promise<TableCountResult> {
    return withAbort(normalizeCommandError(commands.queryTableCount(sessionId, request)), signal);
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
  insertRows(sessionId: string, request: InsertRowsRequest): Promise<InsertRowResult[]> {
    return normalizeCommandError(commands.insertRows(sessionId, request));
  },
  previewInsertRowsSql(sessionId: string, request: InsertRowsRequest): Promise<string> {
    return normalizeCommandError(commands.previewInsertRowsSql(sessionId, request));
  },
};
