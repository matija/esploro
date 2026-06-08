import { commands } from "../../lib/bindings";
import { normalizeError } from "../../lib/ipc";
import type { ConnectionInput, ConnectionProfile } from './types';

async function normalizeCommandError<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (raw) {
    throw normalizeError(raw);
  }
}

export const connectionsApi = {
  list: (): Promise<ConnectionProfile[]> =>
    normalizeCommandError(commands.listConnections()),

  create: (input: ConnectionInput, password: string) =>
    normalizeCommandError(commands.createConnection(input, password)),

  update: (id: string, input: ConnectionInput, password?: string) =>
    normalizeCommandError(commands.updateConnection(id, input, password ?? null)).then(() => undefined),

  delete: (id: string): Promise<void> =>
    normalizeCommandError(commands.deleteConnection(id)).then(() => undefined),

  test: (input: ConnectionInput, password: string) =>
    normalizeCommandError(commands.testConnection(input, password)),

  connect: (id: string): Promise<string> =>
    normalizeCommandError(commands.connect(id)),

  disconnect: (sessionId: string): Promise<void> =>
    normalizeCommandError(commands.disconnect(sessionId)).then(() => undefined),
};

export type ParsedConnectionUrl = Partial<ConnectionInput> & {
  password?: string;
};

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
