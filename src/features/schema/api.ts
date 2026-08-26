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

  // Drops the backend's introspection cache so the refetch that follows a
  // React Query invalidation actually re-reads the catalog. Passing null for
  // database/schema clears the whole session.
  refreshSchemaCache: (sessionId: string, database: string | null = null, schema: string | null = null): Promise<null> =>
    normalizeCommandError(commands.refreshSchemaCache(sessionId, database, schema)),
};
