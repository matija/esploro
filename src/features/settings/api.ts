import { commands } from "../../lib/bindings";
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
  getUiPreferences: (): Promise<unknown> =>
    normalizeCommandError(commands.getUiPreferences()),
  setUiPreferences: (preferences: UiPreferences): Promise<void> =>
    normalizeCommandError(commands.setUiPreferences(preferences)).then(() => undefined),
};
