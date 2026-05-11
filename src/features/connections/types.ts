export type DbDriver = 'postgres' | 'mysql';
export type SslMode = 'disable' | 'prefer' | 'require' | 'verifyFull';

export interface ConnectionProfile {
  id: string;
  displayName: string;
  color?: string;
  folder?: string;
  driver: DbDriver;
  host?: string;
  port: number;
  socketPath?: string;
  database: string;
  username: string;
  sslMode: SslMode;
  poolMaxConnections?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionInput {
  displayName: string;
  color?: string;
  folder?: string;
  driver: DbDriver;
  host?: string;
  port: number;
  socketPath?: string;
  database: string;
  username: string;
  sslMode: SslMode;
  poolMaxConnections?: number;
}

export const DEFAULT_COLORS = [
  '#007AFF', // blue
  '#34C759', // green
  '#FFCC00', // yellow
  '#FF9500', // orange
  '#FF3B30', // red
  '#AF52DE', // purple
] as const;
