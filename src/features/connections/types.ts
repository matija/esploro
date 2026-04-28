export type SslMode = 'Disable' | 'Prefer' | 'Require' | 'VerifyFull';

export interface ConnectionProfile {
  id: string;
  displayName: string;
  color?: string;
  folder?: string;
  host?: string;
  port: number;
  socketPath?: string;
  database: string;
  username: string;
  sslMode: SslMode;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionInput {
  displayName: string;
  color?: string;
  folder?: string;
  host?: string;
  port: number;
  socketPath?: string;
  database: string;
  username: string;
  sslMode: SslMode;
}

export const DEFAULT_COLORS = [
  '#007AFF', // blue
  '#34C759', // green
  '#FFCC00', // yellow
  '#FF9500', // orange
  '#FF3B30', // red
  '#AF52DE', // purple
] as const;
