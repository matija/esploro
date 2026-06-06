import { commands } from "../../lib/bindings";
import { normalizeError } from "../../lib/ipc";
import type { ColumnDef, SchemaObjects } from './types';

async function normalizeCommandError<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (raw) {
    throw normalizeError(raw);
  }
}

export const schemaApi = {
  listSchemas: (sessionId: string, database: string): Promise<string[]> =>
    normalizeCommandError(commands.listSchemas(sessionId, database)),

  listObjects: (sessionId: string, database: string, schema: string): Promise<SchemaObjects> =>
    normalizeCommandError(commands.listObjects(sessionId, database, schema)),

  listColumns: (sessionId: string, database: string, schema: string, table: string): Promise<ColumnDef[]> =>
    normalizeCommandError(commands.listColumns(sessionId, database, schema, table)),
};
