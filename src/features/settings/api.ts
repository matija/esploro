import { invoke } from "@tauri-apps/api/core";
import { commands, type McpStatus } from "../../lib/bindings";
import { normalizeError } from "../../lib/ipc";
import type { UiPreferences } from "./preferences";

async function normalizeCommandError<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (raw) {
    throw normalizeError(raw);
  }
}

export interface McpActivity {
  id: string;
  startedAt: string;
  profileId: string;
  profileLabel: string | null;
  sql: string;
  status: "running" | "succeeded" | "failed" | "interrupted";
  durationMs: number | null;
  returnedRowCount: number | null;
  truncated: boolean;
  error: { kind: string; message: string; code: string | null; position: number | null } | null;
}

export const settingsApi = {
  getMcpHistory: (): Promise<McpActivity[]> => normalizeCommandError(invoke("get_mcp_history")),
  clearMcpHistory: (): Promise<void> => normalizeCommandError(invoke("clear_mcp_history")),
  getMcpStatus: (): Promise<McpStatus> => normalizeCommandError(commands.getMcpStatus()),
  getMcpEndpoint: (): Promise<string> => normalizeCommandError(commands.getMcpEndpoint()),
  getMcpToken: (): Promise<string> => normalizeCommandError(commands.getMcpToken()),
  getUiPreferences: (): Promise<unknown> =>
    normalizeCommandError(commands.getUiPreferences()),
  setUiPreferences: (preferences: UiPreferences): Promise<void> =>
    normalizeCommandError(commands.setUiPreferences(preferences)).then(() => undefined),
};
