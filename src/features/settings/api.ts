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

export const settingsApi = {
  getMcpStatus: (): Promise<McpStatus> => normalizeCommandError(commands.getMcpStatus()),
  getMcpEndpoint: (): Promise<string> => normalizeCommandError(commands.getMcpEndpoint()),
  getMcpToken: (): Promise<string> => normalizeCommandError(commands.getMcpToken()),
  getUiPreferences: (): Promise<unknown> =>
    normalizeCommandError(commands.getUiPreferences()),
  setUiPreferences: (preferences: UiPreferences): Promise<void> =>
    normalizeCommandError(commands.setUiPreferences(preferences)).then(() => undefined),
};
