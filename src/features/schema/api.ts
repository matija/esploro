import { invoke } from '@tauri-apps/api/core';
import type { ColumnDef, SchemaObjects } from './types';

export const schemaApi = {
  listDatabases: (sessionId: string) =>
    invoke<string[]>('list_databases', { sessionId }),

  listSchemas: (sessionId: string, database: string) =>
    invoke<string[]>('list_schemas', { sessionId, database }),

  listObjects: (sessionId: string, database: string, schema: string) =>
    invoke<SchemaObjects>('list_objects', { sessionId, database, schema }),

  listColumns: (sessionId: string, database: string, schema: string, table: string) =>
    invoke<ColumnDef[]>('list_columns', { sessionId, database, schema, table }),
};
