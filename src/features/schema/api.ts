import { invoke } from "../../lib/ipc";
import type { ColumnDef, SchemaObjects } from './types';

export const schemaApi = {
  listSchemas: (sessionId: string, database: string) =>
    invoke<string[]>('list_schemas', { sessionId, database }),

  listObjects: (sessionId: string, database: string, schema: string) =>
    invoke<SchemaObjects>('list_objects', { sessionId, database, schema }),

  listColumns: (sessionId: string, database: string, schema: string, table: string) =>
    invoke<ColumnDef[]>('list_columns', { sessionId, database, schema, table }),
};
