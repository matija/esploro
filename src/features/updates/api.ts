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

/**
 * Whether the running build may install updates in place.
 *
 * Only the packaged Distribution build ships the signed bundle and updater
 * endpoints configured in `src-tauri/tauri.conf.json`; a dev build served by
 * Vite has neither, so `check_for_update` can only ever fail there. Callers use
 * this to hide the update affordances rather than surface an unavoidable error.
 * The native "Check for Updates…" menu item is gated on the Rust-side
 * equivalent (`cfg!(not(debug_assertions))`) in `src-tauri/src/lib.rs`.
 */
export function isSelfUpdateAvailable(): boolean {
  return import.meta.env.PROD;
}
