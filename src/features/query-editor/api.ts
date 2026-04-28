import { invoke } from "@tauri-apps/api/core";
import type { QueryResult, SavedQuery } from "./types";

export const queryEditorApi = {
  executeSql(sessionId: string, sql: string): Promise<QueryResult[]> {
    return invoke("execute_sql", { sessionId, sql });
  },
};

export const savedQueriesApi = {
  list(): Promise<SavedQuery[]> {
    return invoke("list_saved_queries");
  },

  save(params: {
    id?: string;
    name: string;
    folder?: string;
    sql: string;
  }): Promise<string> {
    return invoke("save_query", {
      id: params.id ?? null,
      name: params.name,
      folder: params.folder ?? null,
      sql: params.sql,
    });
  },

  get(id: string): Promise<SavedQuery> {
    return invoke("get_saved_query", { id });
  },

  delete(id: string): Promise<void> {
    return invoke("delete_saved_query", { id });
  },
};
