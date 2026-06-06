import { commands } from "../../lib/bindings";
import { normalizeError } from "../../lib/ipc";

export type { UpdateInfo } from "../../lib/bindings";

async function normalizeCommandError<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (raw) {
    throw normalizeError(raw);
  }
}

export const updatesApi = {
  checkForUpdate: () =>
    normalizeCommandError(commands.checkForUpdate()),
  installUpdate: (): Promise<void> =>
    normalizeCommandError(commands.installUpdate()).then(() => undefined),
};
