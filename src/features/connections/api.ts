import { invoke } from "../../lib/ipc";
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

export type ParsedConnectionUrl = Partial<ConnectionInput> & {
  password?: string;
};

/** @deprecated use parseConnectionUrl */
export const parsePostgresUrl = parseConnectionUrl;

export function parseConnectionUrl(url: string): ParsedConnectionUrl {
  try {
    const u = new URL(url);
    if (u.protocol === 'postgres:' || u.protocol === 'postgresql:') {
      return {
        driver: 'postgres',
        host: u.hostname || undefined,
        port: u.port ? parseInt(u.port) : 5432,
        database: u.pathname.slice(1) || undefined,
        username: u.username ? decodeURIComponent(u.username) : undefined,
        password: u.password ? decodeURIComponent(u.password) : undefined,
      };
    }
    if (u.protocol === 'mysql:') {
      return {
        driver: 'mysql',
        host: u.hostname || undefined,
        port: u.port ? parseInt(u.port) : 3306,
        database: u.pathname.slice(1) || undefined,
        username: u.username ? decodeURIComponent(u.username) : undefined,
        password: u.password ? decodeURIComponent(u.password) : undefined,
      };
    }
    return {};
  } catch {
    return {};
  }
}
