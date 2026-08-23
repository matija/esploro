import { listen } from "@tauri-apps/api/event";

/**
 * Menu events emitted by the Rust side; see the `menu:*` emits in
 * `src-tauri/src/lib.rs`. They carry no payload — the name is the message.
 */
export type MenuEvent =
  | "menu:open-settings"
  | "menu:open-about"
  | "menu:check-for-updates";

/**
 * Subscribe to a menu event. Returns a synchronous cleanup function so it can
 * be returned directly from `useEffect`; unsubscribing before `listen` resolves
 * is handled (the listener is torn down as soon as it exists).
 */
export function onMenuEvent(name: MenuEvent, handler: () => void): () => void {
  const unlisten = listen(name, () => handler());
  return () => { void unlisten.then((fn) => fn()); };
}
