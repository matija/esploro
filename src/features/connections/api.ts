import { invoke } from '@tauri-apps/api/core';
import type { ConnectionInput, ConnectionProfile } from './types';

export const connectionsApi = {
  list: () => invoke<ConnectionProfile[]>('list_connections'),

  create: (input: ConnectionInput, password: string) =>
    invoke<string>('create_connection', { input, password }),

  update: (id: string, input: ConnectionInput, password?: string) =>
    invoke<void>('update_connection', { id, input, password: password ?? null }),

  delete: (id: string) => invoke<void>('delete_connection', { id }),

  test: (input: ConnectionInput, password: string) =>
    invoke<number>('test_connection', { input, password }),

  connect: (id: string) => invoke<string>('connect', { id }),

  disconnect: (sessionId: string) => invoke<void>('disconnect', { sessionId }),
};

export function parsePostgresUrl(url: string): Partial<ConnectionInput> {
  try {
    const u = new URL(url);
    if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') return {};
    return {
      host: u.hostname || undefined,
      port: u.port ? parseInt(u.port) : 5432,
      database: u.pathname.slice(1) || undefined,
      username: u.username ? decodeURIComponent(u.username) : undefined,
    };
  } catch {
    return {};
  }
}
