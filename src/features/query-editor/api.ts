import { commands } from "../../lib/bindings";
import { normalizeError } from "../../lib/ipc";
import type { QueryResult, SavedQuery } from "./types";

async function normalizeCommandError<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (raw) {
    throw normalizeError(raw);
  }
}

export const queryEditorApi = {
  executeSql(sessionId: string, sql: string): Promise<QueryResult[]> {
    return normalizeCommandError(commands.executeSql(sessionId, sql));
  },
};

export const savedQueriesApi = {
  list(): Promise<SavedQuery[]> {
    return normalizeCommandError(commands.listSavedQueries());
  },

  save(params: {
    id?: string;
    name: string;
    folder?: string;
    sql: string;
  }): Promise<string> {
    return normalizeCommandError(commands.saveQuery(
      params.id ?? null,
      params.name,
      params.folder ?? null,
      params.sql,
    ));
  },

  get(id: string): Promise<SavedQuery> {
    return normalizeCommandError(commands.getSavedQuery(id));
  },

  delete(id: string): Promise<void> {
    return normalizeCommandError(commands.deleteSavedQuery(id)).then(() => undefined);
  },
};
